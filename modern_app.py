"""Modern Governance Hub runtime.

Serves a JS-first metadata workspace while preserving the legacy Streamlit app.
The modern shell reuses the existing Python metadata plane and gracefully falls
back to the bundled static demo shell when live Databricks runtime access is not
available.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import time
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from govhub.config import AppConfig
from govhub.services import assets as asset_service
from govhub.services import governance as governance_service
from govhub.services import lineage as lineage_service
from govhub.store import GovernanceStore
from govhub.uc import UCSQLClient, _is_skippable_metadata_error


ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"
LEGACY_UI_DIR = ROOT / "modern_ui"
REACT_DIST_DIR = ROOT / "frontend" / "dist"
LEGACY_INDEX_TEMPLATE = (LEGACY_UI_DIR / "index.html").read_text(encoding="utf-8")
STATIC_INDEX_BOOTSTRAP = '<script id="govhub-bootstrap-script" src="./data.js" defer></script>'
HIDDEN_CATALOGS = {"hive_metastore", "samples", "system", "__databricks_internal"}

HELP_ITEMS = [
    {
        "title": "Discovery",
        "body": "Search, facet, and open the most relevant asset directly from the result rail.",
    },
    {
        "title": "Lineage",
        "body": "Inspect real upstream and downstream dependencies through a graph workspace instead of static cards.",
    },
    {
        "title": "Governance",
        "body": "Keep ownership, glossary, certification, and request state close to the metadata itself.",
    },
]

DISCOVERY_VIEWS = [
    "All assets",
    "Needs attention",
    "Needs owner",
    "Needs certification",
    "Certified",
    "High coverage",
]
DISCOVERY_SORTS = [
    "Best match",
    "Coverage score",
    "Name (A-Z)",
    "Open requests",
]


app = FastAPI(title="Governance Hub Modern Runtime")
app.mount("/static", StaticFiles(directory=str(LEGACY_UI_DIR)), name="static")
app.mount(
    "/assets",
    StaticFiles(directory=str(REACT_DIST_DIR / "assets"), check_dir=False),
    name="react-assets",
)


class _NullGovernanceStore:
    def list_owner_assignments(self) -> pd.DataFrame:
        return pd.DataFrame(
            columns=["uc_full_name", "owner_email", "owner_type", "updated_at", "updated_by"]
        )

    def list_asset_links(self) -> pd.DataFrame:
        return pd.DataFrame(columns=["uc_full_name", "om_table_fqn", "updated_at", "updated_by"])

    def list_change_requests(
        self, status: Optional[str] = None, limit: int = 200
    ) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "request_id",
                "created_at",
                "created_by",
                "status",
                "uc_full_name",
                "new_comment",
                "review_note",
            ]
        )

    def list_glossary_terms(self, limit: int = 200) -> pd.DataFrame:
        return pd.DataFrame(columns=["term_id", "name", "definition"])

    def get_role(self, email: str, admin_emails: Optional[List[str]] = None) -> str:
        return "reader"

_normalize_str = asset_service.normalize_str
_split_uc_name = asset_service.split_uc_name
_catalog_filter_options = asset_service.catalog_filter_options


_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}


def _ttl_value(key: str, ttl_s: int, loader: Callable[[], Any]) -> Any:
    now = time.time()
    cached = _TTL_CACHE.get(key)
    if cached and now - cached[0] < ttl_s:
        return cached[1]
    value = loader()
    _TTL_CACHE[key] = (now, value)
    return value


@lru_cache(maxsize=1)
def _config() -> AppConfig:
    return AppConfig.from_env()


@lru_cache(maxsize=1)
def _uc() -> UCSQLClient:
    return UCSQLClient(warehouse_id=_config().warehouse_id)


@lru_cache(maxsize=1)
def _store() -> GovernanceStore:
    cfg = _config()
    store = GovernanceStore(uc=_uc(), catalog=cfg.gov_catalog, schema=cfg.gov_schema)
    store.ensure_tables()
    return store


def _uc_runtime_status() -> Dict[str, str]:
    def _loader() -> Dict[str, str]:
        try:
            _uc().list_catalogs()
            return {"state": "live", "message": ""}
        except Exception as exc:
            return {
                "state": "unavailable",
                "message": _normalize_str(exc) or "Live Databricks metadata runtime is unavailable.",
            }

    return _ttl_value("modern_uc_runtime_status", 30, _loader)


def _store_status() -> Dict[str, str]:
    def _loader() -> Dict[str, str]:
        try:
            _store()
            return {"state": "live", "message": ""}
        except Exception as exc:
            return {
                "state": "degraded",
                "message": _normalize_str(exc)
                or "Governance control plane is unavailable; falling back to read-only metadata.",
            }

    return _ttl_value("modern_store_status", 60, _loader)


def _live_runtime_available() -> bool:
    return _uc_runtime_status()["state"] == "live"


def _store_for_read() -> GovernanceStore | _NullGovernanceStore:
    status = _store_status()
    if status["state"] == "live":
        return _store()
    return _NullGovernanceStore()


def _allow_demo_fallback() -> bool:
    if not _normalize_str(os.getenv("DATABRICKS_WAREHOUSE_ID")):
        return True
    raw = _normalize_str(os.getenv("GOVHUB_ALLOW_DEMO_FALLBACK"))
    return raw.lower() in {"1", "true", "yes"}


def _user_email(request: Optional[Request]) -> str:
    if request is None:
        return "unknown"
    email = (
        request.headers.get("x-forwarded-email")
        or request.headers.get("x-forwarded-preferred-username")
        or ""
    )
    return email.strip() or "unknown"


def _user_role(request: Optional[Request]) -> str:
    email = _user_email(request)
    if email == "unknown":
        return "Reader"
    store = _store_for_read()
    try:
        role = store.get_role(email, admin_emails=_config().admin_emails)
    except Exception:
        return "Reader"
    return (role or "reader").title()


def _request_cache_scope(request: Optional[Request]) -> str:
    return _normalize_str(_user_email(request)) or _normalize_str(_user_role(request)) or "shared"


def _inventory() -> pd.DataFrame:
    return asset_service.inventory(
        _uc(),
        _store_for_read(),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _visible_assets(cache_scope: str = "") -> pd.DataFrame:
    normalized_scope = _normalize_str(cache_scope) or "shared"
    return _ttl_value(
        f"modern_inventory:{normalized_scope}",
        10,
        lambda: asset_service.visible_assets(
            _uc(),
            _store_for_read(),
            hidden_catalogs=HIDDEN_CATALOGS,
        ),
    )


def _inventory_catalogs() -> List[str]:
    return asset_service.inventory_catalogs(
        _uc(),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _lineage_observed_catalogs() -> List[str]:
    return asset_service.lineage_observed_catalogs(
        _uc(),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _inventory_row(asset_fqn: str) -> pd.Series:
    return asset_service.inventory_row(
        _uc(),
        _store_for_read(),
        asset_fqn,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _asset_exists(asset_fqn: str, request: Optional[Request] = None) -> bool:
    if request is not None:
        cache_scope = _request_cache_scope(request)
        inventory = _visible_assets(cache_scope)
        if asset_service.asset_is_visible(inventory, asset_fqn):
            return True
    return asset_service.asset_exists(
        _uc(),
        _store_for_read(),
        asset_fqn,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _asset_is_visible(asset_fqn: str, request: Optional[Request] = None) -> bool:
    if request is not None:
        cache_scope = _request_cache_scope(request)
        inventory = _visible_assets(cache_scope)
        return asset_service.asset_is_visible(inventory, asset_fqn)
    return asset_service.asset_is_visible(
        _uc(),
        _store_for_read(),
        asset_fqn,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _asset_is_openable(asset_fqn: str, request: Optional[Request] = None) -> bool:
    return _asset_exists(asset_fqn, request)


def _invalidate_cache_prefix(prefix: str) -> None:
    for key in list(_TTL_CACHE.keys()):
        if key.startswith(prefix):
            _TTL_CACHE.pop(key, None)


def _invalidate_asset_caches(asset_fqn: str) -> None:
    asset_service.invalidate_asset_caches(asset_fqn)
    lineage_service.invalidate_lineage_caches(asset_fqn)
    governance_service.invalidate_governance_caches()
    _TTL_CACHE.pop(f"modern_asset:{asset_fqn}", None)
    _TTL_CACHE.pop(f"modern_lineage:{asset_fqn}", None)
    _invalidate_cache_prefix("modern_inventory:")
    _invalidate_cache_prefix("modern_bootstrap_base:")
    _TTL_CACHE.pop("modern_governance", None)


def _friendly_table_type(raw: Any, data_source_format: Any = None) -> str:
    return asset_service.friendly_table_type(raw, data_source_format)


def _coalesce(*values: Any) -> str:
    for value in values:
        normalized = _normalize_str(value)
        if normalized:
            return normalized
    return ""


def _safe_int(value: Any) -> int:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return 0
        return int(float(str(value).replace(",", "")))
    except Exception:
        return 0


def _human_bytes(value: Any) -> str:
    try:
        size = float(value)
    except Exception:
        return "—"
    if size <= 0:
        return "—"
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024
        idx += 1
    if idx == 0:
        return f"{int(size)} {units[idx]}"
    return f"{size:.1f} {units[idx]}"


def _detail_map(detail_df: pd.DataFrame) -> Dict[str, Any]:
    if detail_df is None or detail_df.empty:
        return {}
    row = detail_df.iloc[0].to_dict()
    return {str(key).lower(): value for key, value in row.items()}


def _owner_entries(row: pd.Series) -> List[Dict[str, str]]:
    owners: List[Dict[str, str]] = []
    owner_fields = [
        ("business_owner", "Business Owner"),
        ("technical_owner", "Technical Owner"),
        ("steward", "Steward"),
    ]
    seen: set[Tuple[str, str]] = set()
    for field_name, title in owner_fields:
        raw = _normalize_str(row.get(field_name))
        if not raw:
            continue
        for item in [part.strip() for part in raw.split(",") if part.strip()]:
            key = (item.lower(), title)
            if key in seen:
                continue
            seen.add(key)
            owners.append({"name": item, "title": title})
    return owners


def _asset_badges(row: pd.Series) -> List[str]:
    badges = [
        _normalize_str(row.get("domain")),
        _normalize_str(row.get("tier")),
        _normalize_str(row.get("certification")),
        _normalize_str(row.get("sensitivity")),
        _normalize_str(row.get("criticality")),
    ]
    if isinstance(row.get("tags"), dict):
        for key, value in row.get("tags", {}).items():
            if key.startswith("__"):
                continue
            normalized = _normalize_str(value)
            if normalized and normalized not in badges:
                badges.append(normalized)
    return [badge for badge in badges if badge]


def _base_asset_payload(row: pd.Series) -> Dict[str, Any]:
    return asset_service.base_asset_payload(row)


def _discovery_result_haystack(asset: Dict[str, Any]) -> str:
    return " ".join(
        [
            _normalize_str(asset.get("name")),
            _normalize_str(asset.get("description")),
            _normalize_str(asset.get("catalog")),
            _normalize_str(asset.get("schema")),
            _normalize_str(asset.get("domain")),
            _normalize_str(asset.get("tier")),
            _normalize_str(asset.get("certification")),
            _normalize_str(asset.get("sensitivity")),
            _normalize_str(asset.get("objectType")),
            " ".join(_normalize_str(tag) for tag in asset.get("tags", []) if _normalize_str(tag)),
        ]
    ).lower()


def _discovery_match_score(asset: Dict[str, Any], query: str) -> int:
    q = _normalize_str(query).lower()
    if not q:
        return 0
    score = 0
    if q in _normalize_str(asset.get("name")).lower():
        score += 4
    if q in _normalize_str(asset.get("schema")).lower():
        score += 2
    if q in _normalize_str(asset.get("catalog")).lower():
        score += 2
    if q in _normalize_str(asset.get("description")).lower():
        score += 2
    if q in _discovery_result_haystack(asset):
        score += 1
    return score


def _view_matches(asset: Dict[str, Any], view: str) -> bool:
    normalized = _normalize_str(view)
    if not normalized or normalized == "All assets":
        return True
    if normalized == "Needs owner":
        return len(asset.get("owners", [])) == 0
    if normalized == "Needs certification":
        return _normalize_str(asset.get("certification")) == "Unassigned"
    if normalized == "Certified":
        return _normalize_str(asset.get("certification")) != "Unassigned"
    if normalized == "High coverage":
        return _safe_int(asset.get("coverageScore")) >= 75
    return True


def _normalize_filter_values(values: Optional[List[str]], all_label: str) -> List[str]:
    if not values:
        return []
    normalized = [
        _normalize_str(value)
        for value in values
        if _normalize_str(value) and _normalize_str(value) != all_label
    ]
    return normalized


def _facet_payload(
    assets: List[Dict[str, Any]],
    field: str,
    *,
    all_label: str,
) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {}
    for asset in assets:
        value = _normalize_str(asset.get(field))
        if not value or value == "Unassigned":
            continue
        counts[value] = counts.get(value, 0) + 1
    items = [{"value": all_label, "count": len(assets)}]
    items.extend(
        {"value": value, "count": counts[value]}
        for value in sorted(counts)
    )
    return items


def _sort_discovery_assets(
    assets: List[Dict[str, Any]],
    *,
    sort_by: str,
    query: str,
) -> List[Dict[str, Any]]:
    normalized_sort = _normalize_str(sort_by)

    def _best_match_key(asset: Dict[str, Any]) -> Tuple[int, int, int, str]:
        return (
            _discovery_match_score(asset, query),
            _safe_int(asset.get("coverageScore")),
            _safe_int(asset.get("openRequests")),
            _normalize_str(asset.get("fqn")),
        )

    if normalized_sort == "Coverage score":
        return sorted(
            assets,
            key=lambda asset: (
                _safe_int(asset.get("coverageScore")),
                _safe_int(asset.get("openRequests")),
                _normalize_str(asset.get("fqn")),
            ),
            reverse=True,
        )
    if normalized_sort == "Open requests":
        return sorted(
            assets,
            key=lambda asset: (
                _safe_int(asset.get("openRequests")),
                _safe_int(asset.get("coverageScore")),
                _normalize_str(asset.get("fqn")),
            ),
            reverse=True,
        )
    if normalized_sort == "Recently updated":
        return sorted(assets, key=lambda asset: _normalize_str(asset.get("name")).lower())
    return sorted(assets, key=_best_match_key, reverse=True)


def _discovery_search_payload(
    request: Optional[Request] = None,
    *,
    query: str = "",
    views: Optional[List[str]] = None,
    asset_types: Optional[List[str]] = None,
    catalogs: Optional[List[str]] = None,
    domains: Optional[List[str]] = None,
    tiers: Optional[List[str]] = None,
    certifications: Optional[List[str]] = None,
    sensitivities: Optional[List[str]] = None,
    sort_by: str = "Best match",
    limit: int = 60,
    offset: int = 0,
) -> Dict[str, Any]:
    return asset_service.discovery_search_payload(
        _visible_assets(_request_cache_scope(request)),
        query=query,
        views=views,
        asset_types=asset_types,
        catalogs=catalogs,
        domains=domains,
        tiers=tiers,
        certifications=certifications,
        sensitivities=sensitivities,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _related_assets(catalog: str, schema: str, table: str, focus_fqn: str) -> List[str]:
    return asset_service.related_assets(_uc(), catalog, schema, table, focus_fqn)


def _asset_detail_payload(asset_fqn: str, request: Optional[Request] = None) -> Dict[str, Any]:
    return asset_service.asset_detail_payload(
        _uc(),
        _store_for_read(),
        asset_fqn,
        cache_scope=_request_cache_scope(request),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _preview_records(sample_df: pd.DataFrame) -> List[Dict[str, str]]:
    if sample_df is None or sample_df.empty:
        return []
    view = sample_df.head(8).copy()
    limited_cols = list(view.columns[:8])
    view = view[limited_cols]
    rows: List[Dict[str, str]] = []
    for _, row in view.iterrows():
        rows.append({str(col): _normalize_str(row.get(col)) for col in limited_cols})
    return rows


def _column_records(columns_df: pd.DataFrame) -> List[Dict[str, str]]:
    if columns_df is None or columns_df.empty:
        return []
    rows: List[Dict[str, str]] = []
    for _, row in columns_df.head(50).iterrows():
        rows.append(
            {
                "name": _normalize_str(row.get("column_name")),
                "type": _normalize_str(row.get("data_type")),
                "description": _normalize_str(row.get("comment")) or "No description",
            }
        )
    return rows


def _graph_node_for_asset(
    asset_fqn: str,
    role: str,
    x: int,
    y: int,
    *,
    kicker: str,
    kind: str = "",
    foot: Optional[List[str]] = None,
    depth: int = 1,
) -> Dict[str, Any]:
    row = _inventory_row(asset_fqn)
    label = _normalize_str(row.get("table_name")) or asset_fqn.split(".")[-1]
    subtitle = " / ".join(
        part for part in [_normalize_str(row.get("table_catalog")), _normalize_str(row.get("table_schema"))] if part
    )
    item_kind = kind or _friendly_table_type(row.get("table_type"), row.get("data_source_format"))
    footer = foot or [item_kind]
    return {
        "id": f"{role}-{asset_fqn}",
        "assetFqn": asset_fqn,
        "label": label,
        "subtitle": subtitle,
        "kicker": kicker,
        "kind": item_kind,
        "role": role,
        "depth": depth,
        "x": x,
        "y": y,
        "foot": footer,
    }


def _stack_positions(count: int, *, x: int, top: int = 22, bottom: int = 78) -> List[Tuple[int, int]]:
    if count <= 0:
        return []
    if count == 1:
        return [(x, 50)]
    span = max(bottom - top, 10)
    step = span / (count - 1)
    return [(x, round(top + idx * step)) for idx in range(count)]


def _build_data_graph(asset_fqn: str) -> Dict[str, Any]:
    return lineage_service.build_data_graph(_uc(), _store_for_read(), asset_fqn)


def _build_operational_graph(asset_fqn: str) -> Dict[str, Any]:
    return lineage_service.build_operational_graph(
        _uc(),
        _store_for_read(),
        asset_fqn,
    )


def _lineage_payload(asset_fqn: str) -> Dict[str, Any]:
    return lineage_service.lineage_payload(_uc(), _store_for_read(), asset_fqn)


def _governance_summary() -> Dict[str, Any]:
    return governance_service.governance_summary(
        _uc(),
        _store_for_read(),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _bootstrap_payload(request: Request) -> Dict[str, Any]:
    cache_scope = _request_cache_scope(request)

    def load_base() -> Dict[str, Any]:
        store_status = _store_status()
        inventory = _visible_assets(cache_scope)
        assets = [asset_service.base_asset_payload(row) for _, row in inventory.iterrows()]
        asset_index = {asset["fqn"]: asset for asset in assets}
        available_catalogs = asset_service.inventory_catalogs(_uc(), HIDDEN_CATALOGS)
        observed_catalogs = asset_service.lineage_observed_catalogs(
            _uc(),
            hidden_catalogs=HIDDEN_CATALOGS,
        )
        catalogs = asset_service.catalog_filter_options(
            inventory,
            available_catalogs=available_catalogs,
            observed_catalogs=observed_catalogs,
        )
        asset_types = sorted({asset["objectType"] for asset in assets if asset["objectType"]})
        domains = sorted(
            {asset["domain"] for asset in assets if asset["domain"] and asset["domain"] != "Unassigned"}
        )
        tiers = sorted({asset["tier"] for asset in assets if asset["tier"] and asset["tier"] != "Unassigned"})
        certifications = sorted(
            {
                asset["certification"]
                for asset in assets
                if asset["certification"] and asset["certification"] != "Unassigned"
            }
        )
        sensitivities = sorted(
            {
                asset["sensitivity"]
                for asset in assets
                if asset["sensitivity"] and asset["sensitivity"] != "Unassigned"
            }
        )
        governance = _governance_summary()
        governance_gaps = sum(1 for asset in assets if asset.get("governanceStatus") == "Needs Work")
        certified_assets = sum(
            1
            for asset in assets
            if asset.get("certification") and asset.get("certification") != "Unassigned"
        )
        owned_assets = sum(1 for asset in assets if asset.get("owners"))

        boot_state = "live" if store_status["state"] == "live" else "degraded"
        boot_message = "" if store_status["state"] == "live" else store_status["message"]
        if not assets:
            boot_state = "degraded"
            if not boot_message:
                if available_catalogs:
                    boot_message = (
                        f"The workspace can enumerate {len(available_catalogs)} catalog(s), but no visible tables or views "
                        "were surfaced after filtering. Confirm the current principal can query Unity Catalog information_schema "
                        "inventory for those catalogs."
                    )
                elif observed_catalogs:
                    boot_message = (
                        f"Lineage system tables show activity in {len(observed_catalogs)} catalog(s), but direct catalog "
                        "inventory could not be enumerated. Confirm SHOW CATALOGS and information_schema access for the current principal."
                    )
                else:
                    boot_message = (
                        "The workspace connected successfully, but no visible metadata assets were returned yet. "
                        "Confirm the current principal can enumerate Unity Catalog objects in the selected workspace."
                    )

        return {
            "version": "modern-ui-live-2",
            "bootState": boot_state,
            "bootMessage": boot_message,
            "apiBase": "/api",
            "assets": assets,
            "assetIndex": asset_index,
            "graphs": {},
            "discovery": {
                "catalogs": ["All catalogs", *catalogs],
                "domains": ["All domains", *domains],
                "tiers": ["All tiers", *tiers],
                "certifications": ["All certifications", *certifications],
                "sensitivities": ["All sensitivities", *sensitivities],
                "assetTypes": ["All types", *asset_types],
                "views": DISCOVERY_VIEWS,
                "sortOptions": DISCOVERY_SORTS,
                "defaultQuery": "",
                "summary": {
                    "visibleAssets": len(assets),
                    "catalogCount": len(catalogs),
                    "availableCatalogCount": len(available_catalogs),
                    "observedCatalogCount": len(observed_catalogs),
                    "governanceGaps": governance_gaps,
                    "certifiedAssets": certified_assets,
                    "ownedAssets": owned_assets,
                    "catalogSnapshot": catalogs[:8],
                },
            },
            "governance": governance,
            "help": HELP_ITEMS,
        }

    base_payload = _ttl_value(f"modern_bootstrap_base:{cache_scope}", 10, load_base)
    assets = base_payload["assets"]
    selected_fqn = request.query_params.get("asset") or (assets[0]["fqn"] if assets else "")

    return {
        **base_payload,
        "initialSelection": {"primaryAssetFqn": selected_fqn},
        "shell": {
            "metrics": base_payload["governance"]["metrics"],
            "role": _user_role(request),
            "userEmail": _user_email(request),
        },
        "apiContract": {
            "bootstrap": "/api/bootstrap",
            "discoverySearch": "/api/discovery/search",
            "assetDetail": "/api/assets/:fqn",
            "assetAvailability": "/api/assets/availability",
            "assetMetadataUpdate": "/api/assets/:fqn/metadata",
            "lineage": "/api/lineage/:fqn",
            "governanceSummary": "/api/governance/summary",
            "glossary": "/api/governance/glossary",
        },
    }


def _ensure_live_runtime() -> None:
    if not _live_runtime_available():
        raise HTTPException(status_code=503, detail="Live Databricks runtime is not available.")


def _ensure_governance_store() -> GovernanceStore:
    status = _store_status()
    if status["state"] != "live":
        raise HTTPException(
            status_code=503,
            detail=status["message"] or "Governance control plane is unavailable.",
        )
    return _store()


class AssetDescriptionPatch(BaseModel):
    description: str = ""


class OwnerAssignment(BaseModel):
    ownerEmail: str
    ownerType: str = "steward"


class AssetOwnersPatch(BaseModel):
    owners: List[OwnerAssignment] = Field(default_factory=list)


class AssetMetadataPatch(BaseModel):
    description: str = ""
    domain: Optional[str] = None
    tier: Optional[str] = None
    certification: Optional[str] = None
    sensitivity: Optional[str] = None


class AssetTagsPatch(BaseModel):
    tags: Dict[str, str] = Field(default_factory=dict)


class AssetAvailabilityRequest(BaseModel):
    assets: List[str] = Field(default_factory=list)


class ColumnDescriptionPatch(BaseModel):
    description: str = ""


class ColumnTagsPatch(BaseModel):
    tags: Dict[str, str] = Field(default_factory=dict)


def _normalized_tag_map(df: pd.DataFrame) -> Dict[str, str]:
    if df is None or df.empty:
        return {}
    tags: Dict[str, str] = {}
    for _, row in df.iterrows():
        key = _normalize_str(row.get("tag_name"))
        value = _normalize_str(row.get("tag_value"))
        if key:
            tags[key] = value
    return tags


def _apply_table_tags(asset_fqn: str, tags: Dict[str, str]) -> Dict[str, str]:
    catalog, schema, table = _split_uc_name(asset_fqn)
    normalized_tags = {
        _normalize_str(key): _normalize_str(value)
        for key, value in tags.items()
        if _normalize_str(key)
    }
    current_tags = _normalized_tag_map(_uc().get_table_tags(catalog, schema, table))
    to_unset = [key for key in current_tags if key not in normalized_tags]
    to_set = {
        key: value
        for key, value in normalized_tags.items()
        if current_tags.get(key) != value
    }
    if to_unset:
        _uc().unset_table_tags(catalog, schema, table, to_unset)
    if to_set:
        _uc().set_table_tags(catalog, schema, table, to_set)
    return normalized_tags


def _apply_asset_metadata(
    asset_fqn: str,
    payload: AssetMetadataPatch,
    *,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    catalog, schema, table = _split_uc_name(asset_fqn)
    _uc().set_table_comment(catalog, schema, table, payload.description or "")
    current_tags = _normalized_tag_map(_uc().get_table_tags(catalog, schema, table))
    next_tags = {
        key: value
        for key, value in current_tags.items()
        if key not in {"domain", "tier", "certification", "sensitivity"}
    }
    structured = {
        "domain": _normalize_str(payload.domain),
        "tier": _normalize_str(payload.tier),
        "certification": _normalize_str(payload.certification),
        "sensitivity": _normalize_str(payload.sensitivity),
    }
    for key, value in structured.items():
        if value:
            next_tags[key] = value
    _apply_table_tags(asset_fqn, next_tags)
    _invalidate_asset_caches(asset_fqn)
    return _asset_detail_payload(asset_fqn, request=request)


def _apply_column_tags(asset_fqn: str, column_name: str, tags: Dict[str, str]) -> Dict[str, str]:
    catalog, schema, table = _split_uc_name(asset_fqn)
    normalized_tags = {
        _normalize_str(key): _normalize_str(value)
        for key, value in tags.items()
        if _normalize_str(key)
    }
    current_tags = _normalized_tag_map(_uc().get_column_tags(catalog, schema, table, column_name))
    to_unset = [key for key in current_tags if key not in normalized_tags]
    to_set = {
        key: value
        for key, value in normalized_tags.items()
        if current_tags.get(key) != value
    }
    if to_unset:
        _uc().unset_column_tags(catalog, schema, table, column_name, to_unset)
    if to_set:
        _uc().set_column_tags(catalog, schema, table, column_name, to_set)
    return normalized_tags


def _asset_availability_payload(
    asset_fqns: List[str],
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    cache_scope = _request_cache_scope(request)
    inventory = _visible_assets(cache_scope)
    visible_asset_set = (
        set(inventory["fqn"].dropna().astype(str).tolist())
        if isinstance(inventory, pd.DataFrame) and not inventory.empty
        else set()
    )
    unique_assets = [asset_fqn for asset_fqn in dict.fromkeys(asset_fqns or []) if _normalize_str(asset_fqn)]
    availability: Dict[str, Dict[str, bool]] = {}
    for asset_fqn in unique_assets[:200]:
        visible = asset_fqn in visible_asset_set
        exists = visible or _asset_exists(asset_fqn, request)
        availability[asset_fqn] = {
            "visible": visible,
            "exists": exists,
            "openable": exists,
        }
    return {"assets": availability}


def _bootstrap_unavailable_payload(
    request: Optional[Request], message: str, *, state: str = "unavailable"
) -> Dict[str, Any]:
    role = _user_role(request) if request is not None else "Unavailable"
    email = _user_email(request) if request is not None else "offline"
    return {
        "version": "modern-ui-unavailable-2",
        "bootState": state,
        "bootMessage": message,
        "apiBase": "/api",
        "assets": [],
        "assetIndex": {},
        "graphs": {},
        "discovery": {
            "catalogs": ["All catalogs"],
            "domains": ["All domains"],
            "tiers": ["All tiers"],
            "certifications": ["All certifications"],
            "sensitivities": ["All sensitivities"],
            "views": DISCOVERY_VIEWS,
            "sortOptions": DISCOVERY_SORTS,
            "assetTypes": ["All types"],
            "defaultQuery": "",
            "summary": {
                "visibleAssets": 0,
                "catalogCount": 0,
                "availableCatalogCount": 0,
                "observedCatalogCount": 0,
                "governanceGaps": 0,
                "certifiedAssets": 0,
                "ownedAssets": 0,
                "catalogSnapshot": [],
            },
        },
        "governance": {"metrics": [], "backlog": [], "glossary": []},
        "shell": {
            "metrics": [],
            "role": role,
            "userEmail": email,
        },
        "apiContract": {
            "bootstrap": "/api/bootstrap",
            "discoverySearch": "/api/discovery/search",
            "assetDetail": "/api/assets/:fqn",
            "assetAvailability": "/api/assets/availability",
            "assetMetadataUpdate": "/api/assets/:fqn/metadata",
            "lineage": "/api/lineage/:fqn",
            "governanceSummary": "/api/governance/summary",
            "glossary": "/api/governance/glossary",
        },
        "help": [
            {
                "title": "Workspace unavailable",
                "body": message,
            }
        ],
    }


def _ensure_react_bundle() -> Path:
    index_path = REACT_DIST_DIR / "index.html"
    assets_dir = REACT_DIST_DIR / "assets"
    if index_path.exists() and assets_dir.exists():
        return index_path
    raise RuntimeError(
        "The workspace bundle is missing. Build frontend/dist before running the JS workspace."
    )


@lru_cache(maxsize=1)
def _compiled_react_index() -> str:
    return _ensure_react_bundle().read_text(encoding="utf-8")


def _inject_bootstrap(html_text: str, payload: Optional[Dict[str, Any]]) -> str:
    if payload is None:
        return html_text
    bootstrap = json.dumps(payload, default=str).replace("</", "<\\/")
    inline_bootstrap = (
        "<script>"
        "window.__GOVHUB_BOOTSTRAP__ = "
        f"{bootstrap};"
        "</script>"
    )
    return html_text.replace("</head>", f"{inline_bootstrap}\n  </head>")


def _cached_bootstrap_seed(request: Request) -> Optional[Dict[str, Any]]:
    cache_scope = _request_cache_scope(request)
    cached = _TTL_CACHE.get(f"modern_bootstrap_base:{cache_scope}")
    if not cached:
        return None
    cached_at, base_payload = cached
    if time.time() - cached_at > 60:
        return None
    assets = base_payload.get("assets", [])
    selected_fqn = request.query_params.get("asset") or (assets[0]["fqn"] if assets else "")
    return {
        **base_payload,
        "initialSelection": {"primaryAssetFqn": selected_fqn},
        "shell": {
            "metrics": base_payload.get("governance", {}).get("metrics", {}),
            "role": _user_role(request),
            "userEmail": _user_email(request),
        },
        "apiContract": {
            "bootstrap": "/api/bootstrap",
            "discoverySearch": "/api/discovery/search",
            "assetDetail": "/api/assets/:fqn",
            "assetAvailability": "/api/assets/availability",
            "assetMetadataUpdate": "/api/assets/:fqn/metadata",
            "lineage": "/api/lineage/:fqn",
            "governanceSummary": "/api/governance/summary",
            "glossary": "/api/governance/glossary",
        },
    }


def _render_index(live_payload: Optional[Dict[str, Any]] = None) -> str:
    try:
        react_index = _compiled_react_index()
    except Exception as exc:
        return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Governance Hub Bundle Missing</title>
    <style>
      body {{ font-family: Inter, system-ui, sans-serif; background: #f5f7ff; color: #1d2740; padding: 40px; }}
      .card {{ max-width: 920px; margin: 40px auto; background: #fff; border: 1px solid #d8e1f5; border-radius: 24px; padding: 32px; box-shadow: 0 20px 44px rgba(21, 32, 65, 0.08); }}
      h1 {{ margin: 0 0 12px; font-size: 2rem; }}
      p {{ color: #5d6c8c; line-height: 1.6; }}
      code {{ background: #eef1ff; padding: 0.15rem 0.4rem; border-radius: 8px; }}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Workspace bundle is missing</h1>
      <p>The app is running in <code>GOVHUB_APP_MODE=modern</code>, but the compiled frontend assets were not found.</p>
      <p>Build <code>frontend/dist</code> with <code>npm install</code> and <code>npm run build</code> inside <code>frontend/</code>, then redeploy.</p>
      <p>Runtime detail: {json.dumps(_normalize_str(exc) or 'unknown error')}</p>
    </div>
  </body>
</html>"""
    return _inject_bootstrap(react_index, live_payload)


def _render_unavailable_index(message: str) -> str:
    return _render_index(_bootstrap_unavailable_payload(None, message))


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    cached_status = _TTL_CACHE.get("modern_uc_runtime_status")
    if cached_status:
        _, runtime_status = cached_status
        if runtime_status.get("state") == "unavailable":
            return HTMLResponse(
                _render_index(
                    _bootstrap_unavailable_payload(
                        request,
                        runtime_status.get("message")
                        or "Live Databricks metadata runtime is unavailable. Fix the warehouse or governance configuration or warehouse access, then retry.",
                    )
                ),
                status_code=200,
            )
    try:
        return HTMLResponse(_render_index(_cached_bootstrap_seed(request)))
    except Exception as exc:
        return HTMLResponse(
            _render_index(
                _bootstrap_unavailable_payload(
                    request,
                    f"Workspace bootstrap failed: {_normalize_str(exc) or 'unknown error'}.",
                    state="error",
                )
            ),
            status_code=200,
        )


@app.get("/api/bootstrap")
def api_bootstrap(request: Request) -> JSONResponse:
    if not _live_runtime_available():
        return JSONResponse(
            _bootstrap_unavailable_payload(
                request,
                "Live Databricks metadata runtime is unavailable. Fix the warehouse or governance configuration or warehouse access, then retry.",
            )
        )
    try:
        return JSONResponse(_bootstrap_payload(request))
    except Exception as exc:
        return JSONResponse(
            _bootstrap_unavailable_payload(
                request,
                f"Workspace bootstrap failed: {_normalize_str(exc) or 'unknown error'}.",
                state="error",
            )
        )


@app.get("/api/discovery/search")
def api_discovery_search(
    request: Request,
    query: str = "",
    view: str = "All assets",
    asset_type: str = Query(default="All types", alias="type"),
    views: Optional[List[str]] = Query(default=None),
    types: Optional[List[str]] = Query(default=None),
    catalogs: Optional[List[str]] = Query(default=None),
    domains: Optional[List[str]] = Query(default=None),
    tiers: Optional[List[str]] = Query(default=None),
    certifications: Optional[List[str]] = Query(default=None),
    sensitivities: Optional[List[str]] = Query(default=None),
    sort_by: str = Query(default="Best match", alias="sortBy"),
    limit: int = 60,
    offset: int = 0,
) -> JSONResponse:
    _ensure_live_runtime()
    try:
        payload = _discovery_search_payload(
            request=request,
            query=query,
            views=views or ([view] if _normalize_str(view) and view != "All assets" else []),
            asset_types=types or ([asset_type] if _normalize_str(asset_type) and asset_type != "All types" else []),
            catalogs=catalogs,
            domains=domains,
            tiers=tiers,
            certifications=certifications,
            sensitivities=sensitivities,
            sort_by=sort_by,
            limit=limit,
            offset=offset,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Discovery search is unavailable right now. "
                f"{_normalize_str(exc) or 'Unexpected metadata runtime error.'}"
            ),
        ) from exc
    return JSONResponse(payload)


@app.post("/api/assets/availability")
def api_asset_availability(
    payload: AssetAvailabilityRequest,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    return JSONResponse(_asset_availability_payload(payload.assets, request))


@app.get("/api/assets/{asset_fqn:path}")
def api_asset_detail(asset_fqn: str, request: Request) -> JSONResponse:
    _ensure_live_runtime()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    payload = _asset_detail_payload(asset_fqn, request=request)
    return JSONResponse(payload)


@app.patch("/api/assets/{asset_fqn:path}/description")
def api_patch_asset_description(
    asset_fqn: str,
    payload: AssetDescriptionPatch,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    _ensure_governance_store()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    governance_service.patch_asset_description(
        _uc(),
        asset_fqn=asset_fqn,
        description=payload.description or "",
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "description": payload.description or "",
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(),
        }
    )


@app.patch("/api/assets/{asset_fqn:path}/metadata")
def api_patch_asset_metadata(
    asset_fqn: str,
    payload: AssetMetadataPatch,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    asset = _apply_asset_metadata(asset_fqn, payload, request=request)
    return JSONResponse({"ok": True, "fqn": asset_fqn, "asset": asset})


@app.patch("/api/assets/{asset_fqn:path}/owners")
def api_patch_asset_owners(
    asset_fqn: str,
    payload: AssetOwnersPatch,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    store = _ensure_governance_store()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    governance_service.patch_asset_owners(
        store,
        asset_fqn=asset_fqn,
        owner_assignments=[owner.model_dump() for owner in payload.owners],
        updated_by=_user_email(request),
        replace=True,
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(),
        }
    )


@app.patch("/api/assets/{asset_fqn:path}/tags")
def api_patch_asset_tags(
    asset_fqn: str,
    payload: AssetTagsPatch,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    applied = _apply_table_tags(asset_fqn, payload.tags)
    _invalidate_asset_caches(asset_fqn)
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "tags": applied,
            "asset": _asset_detail_payload(asset_fqn, request=request),
        }
    )


@app.patch("/api/assets/{asset_fqn:path}/columns/{column_name}/description")
def api_patch_column_description(
    asset_fqn: str,
    column_name: str,
    payload: ColumnDescriptionPatch,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    _ensure_governance_store()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    columns_df = asset_service.asset_columns_df(_uc(), asset_fqn)
    column_names = set(columns_df["column_name"].dropna().astype(str).tolist())
    if column_name not in column_names:
        raise HTTPException(status_code=404, detail="Column not found.")
    governance_service.patch_column_description(
        _uc(),
        asset_fqn=asset_fqn,
        column_name=column_name,
        description=payload.description or "",
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "column": column_name,
            "description": payload.description or "",
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(),
        }
    )


@app.patch("/api/assets/{asset_fqn:path}/columns/{column_name}/tags")
def api_patch_column_tags(
    asset_fqn: str,
    column_name: str,
    payload: ColumnTagsPatch,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    applied = _apply_column_tags(asset_fqn, column_name, payload.tags)
    _invalidate_asset_caches(asset_fqn)
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "column": column_name,
            "tags": applied,
            "asset": _asset_detail_payload(asset_fqn, request=request),
        }
    )


@app.get("/api/lineage/{asset_fqn:path}")
def api_lineage(asset_fqn: str) -> JSONResponse:
    _ensure_live_runtime()
    try:
        _split_uc_name(asset_fqn)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Asset not found.") from exc
    return JSONResponse(_lineage_payload(asset_fqn))


@app.get("/api/governance/summary")
def api_governance_summary() -> JSONResponse:
    _ensure_live_runtime()
    return JSONResponse(_governance_summary())


@app.get("/api/governance/glossary")
def api_governance_glossary() -> JSONResponse:
    _ensure_live_runtime()
    return JSONResponse({"glossary": _governance_summary()["glossary"]})


@app.post("/api/governance/requests")
async def api_governance_create_request(request: Request) -> JSONResponse:
    _ensure_live_runtime()
    store = _ensure_governance_store()
    payload = await request.json()
    asset_fqn = _normalize_str(payload.get("assetFqn"))
    title = _normalize_str(payload.get("title"))
    note = _normalize_str(payload.get("note"))
    if not asset_fqn or not title:
        raise HTTPException(status_code=400, detail="assetFqn and title are required.")
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    request_id = governance_service.create_change_request(
        store,
        created_by=_user_email(request),
        asset_fqn=asset_fqn,
        title=title,
        note=note,
    )
    return JSONResponse({"ok": True, "requestId": request_id, "governance": _governance_summary()})


@app.post("/api/governance/owners")
async def api_governance_upsert_owner(request: Request) -> JSONResponse:
    _ensure_live_runtime()
    store = _ensure_governance_store()
    payload = await request.json()
    asset_fqn = _normalize_str(payload.get("assetFqn"))
    owner_email = _normalize_str(payload.get("ownerEmail")).lower()
    owner_type = (_normalize_str(payload.get("ownerType")) or "steward").lower()
    if not asset_fqn or not owner_email:
        raise HTTPException(status_code=400, detail="assetFqn and ownerEmail are required.")
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    governance_service.add_owner(
        store,
        asset_fqn=asset_fqn,
        owner_email=owner_email,
        owner_type=owner_type,
        updated_by=_user_email(request),
    )
    return JSONResponse(
        {
            "ok": True,
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(),
        }
    )


@app.post("/api/governance/glossary")
async def api_governance_upsert_glossary(request: Request) -> JSONResponse:
    _ensure_live_runtime()
    store = _ensure_governance_store()
    payload = await request.json()
    term_id = _normalize_str(payload.get("termId")) or uuid.uuid4().hex[:12]
    name = _normalize_str(payload.get("name"))
    definition = _normalize_str(payload.get("definition"))
    domain = _normalize_str(payload.get("domain"))
    owner_email = _normalize_str(payload.get("ownerEmail")).lower()
    status = (_normalize_str(payload.get("status")) or "draft").lower()
    if not name:
        raise HTTPException(status_code=400, detail="name is required.")
    governance_service.upsert_glossary_term(
        term_id=term_id,
        name=name,
        definition=definition,
        domain=domain,
        owner_email=owner_email,
        status=status,
        store=store,
        updated_by=_user_email(request),
    )
    return JSONResponse({"ok": True, "governance": _governance_summary()})
