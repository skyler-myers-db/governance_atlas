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
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import app as legacy_streamlit
from govhub.config import AppConfig
from govhub.store import GovernanceStore
from govhub.uc import UCSQLClient


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
    "Needs owner",
    "Needs certification",
    "Certified",
    "High coverage",
]
DISCOVERY_SORTS = [
    "Best match",
    "Coverage score",
    "Recently updated",
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


def _raw(fn: Callable[..., Any]) -> Callable[..., Any]:
    return getattr(fn, "__wrapped__", fn)


_cached_asset_inventory = _raw(legacy_streamlit._cached_asset_inventory)
_cached_comment = _raw(legacy_streamlit._cached_comment)
_cached_columns = _raw(legacy_streamlit._cached_columns)
_cached_table_detail = _raw(legacy_streamlit._cached_table_detail)
_cached_table_row_count = _raw(legacy_streamlit._cached_table_row_count)
_cached_sample_rows = _raw(legacy_streamlit._cached_sample_rows)
_cached_lineage_up = _raw(legacy_streamlit._cached_lineage_up)
_cached_lineage_down = _raw(legacy_streamlit._cached_lineage_down)
_cached_operational_context_up = _raw(legacy_streamlit._cached_operational_context_up)
_cached_operational_context_down = _raw(legacy_streamlit._cached_operational_context_down)

_normalize_str = legacy_streamlit._normalize_str
_filter_asset_rows = legacy_streamlit._filter_asset_rows
_split_uc_name = legacy_streamlit._split_uc_name
_catalog_filter_options = legacy_streamlit._catalog_filter_options
_tag_value = legacy_streamlit._tag_value
_lineage_asset_stub = legacy_streamlit._lineage_asset_stub
_enrich_operational_context_names = legacy_streamlit._enrich_operational_context_names
_summarize_operational_context = legacy_streamlit._summarize_operational_context


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


def _inventory() -> pd.DataFrame:
    return _ttl_value(
        "modern_inventory",
        600,
        lambda: _cached_asset_inventory(_uc(), _store_for_read()),
    )


def _visible_assets() -> pd.DataFrame:
    inventory = _inventory()
    if inventory is None or inventory.empty:
        return inventory
    return inventory[
        ~inventory["table_catalog"].fillna("").astype(str).str.lower().isin(HIDDEN_CATALOGS)
    ].reset_index(drop=True)


def _lineage_observed_catalogs() -> List[str]:
    try:
        df = _uc().list_lineage_catalogs()
    except Exception:
        return []
    if df is None or df.empty:
        return []
    return sorted(
        _normalize_str(value)
        for value in df.iloc[:, 0].tolist()
        if _normalize_str(value) and _normalize_str(value).lower() not in HIDDEN_CATALOGS
    )


def _inventory_row(asset_fqn: str) -> pd.Series:
    inventory = _visible_assets()
    if inventory is None or inventory.empty:
        return _lineage_asset_stub(pd.DataFrame(), asset_fqn)
    match = inventory[inventory["fqn"] == asset_fqn]
    if not match.empty:
        return match.iloc[0]
    return _lineage_asset_stub(inventory, asset_fqn)


def _asset_exists(asset_fqn: str) -> bool:
    inventory = _visible_assets()
    if inventory is None or inventory.empty:
        return False
    return bool((inventory["fqn"] == asset_fqn).any())


def _friendly_table_type(raw: Any) -> str:
    normalized = _normalize_str(raw).upper()
    mapping = {
        "BASE TABLE": "Table",
        "TABLE": "Table",
        "MANAGED": "Table",
        "MANAGED TABLE": "Table",
        "EXTERNAL": "Table",
        "EXTERNAL TABLE": "Table",
        "VIEW": "View",
        "MATERIALIZED VIEW": "Materialized View",
        "STREAMING TABLE": "Streaming Table",
    }
    if normalized in mapping:
        return mapping[normalized]
    return _normalize_str(raw).title() or "Table"


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
    return {
        "fqn": _normalize_str(row.get("fqn")),
        "name": _normalize_str(row.get("table_name")) or _normalize_str(row.get("fqn")).split(".")[-1],
        "catalog": _normalize_str(row.get("table_catalog")),
        "schema": _normalize_str(row.get("table_schema")),
        "objectType": _friendly_table_type(row.get("table_type")),
        "description": _normalize_str(row.get("comment")) or "No description has been captured for this asset yet.",
        "coverageScore": _safe_int(row.get("governance_score")),
        "rows": "—",
        "format": "",
        "size": "—",
        "files": "—",
        "domain": _normalize_str(row.get("domain")) or "Unassigned",
        "tier": _normalize_str(row.get("tier")) or "Unassigned",
        "certification": _normalize_str(row.get("certification")) or "Unassigned",
        "sensitivity": _normalize_str(row.get("sensitivity")) or "Unassigned",
        "criticality": _normalize_str(row.get("criticality")) or "Unassigned",
        "openRequests": _safe_int(row.get("pending_requests")),
        "owners": _owner_entries(row),
        "tags": _asset_badges(row),
        "relatedAssets": [],
        "preview": [],
        "columns": [],
        "governanceStatus": _normalize_str(row.get("governance_status")) or "Needs Work",
        "omTableFqn": _normalize_str(row.get("om_table_fqn")),
    }


def _related_assets(catalog: str, schema: str, table: str, focus_fqn: str) -> List[str]:
    try:
        upstream = _filter_asset_rows(
            _cached_lineage_up(_uc(), catalog, schema, table),
            ["source_table_name", "source_table_full_name"],
            exclude_fqn=focus_fqn,
        )
    except Exception:
        upstream = pd.DataFrame()
    try:
        downstream = _filter_asset_rows(
            _cached_lineage_down(_uc(), catalog, schema, table),
            ["target_table_name", "target_table_full_name"],
            exclude_fqn=focus_fqn,
        )
    except Exception:
        downstream = pd.DataFrame()
    values: List[str] = []
    if upstream is not None and not upstream.empty and "source_table_full_name" in upstream.columns:
        values.extend(upstream["source_table_full_name"].dropna().astype(str).tolist())
    if downstream is not None and not downstream.empty and "target_table_full_name" in downstream.columns:
        values.extend(downstream["target_table_full_name"].dropna().astype(str).tolist())
    normalized = [_normalize_str(item) for item in values if _normalize_str(item)]
    deduped = list(dict.fromkeys(item for item in normalized if item != focus_fqn))
    return deduped[:8]


def _asset_detail_payload(asset_fqn: str) -> Dict[str, Any]:
    def _loader() -> Dict[str, Any]:
        row = _inventory_row(asset_fqn)
        base = _base_asset_payload(row)
        catalog, schema, table = _split_uc_name(base["fqn"])
        try:
            detail_df = _cached_table_detail(_uc(), catalog, schema, table)
        except Exception:
            detail_df = pd.DataFrame()
        detail = _detail_map(detail_df)
        try:
            columns_df = _cached_columns(_uc(), catalog, schema, table)
        except Exception:
            columns_df = pd.DataFrame()
        try:
            sample_df = _cached_sample_rows(_uc(), catalog, schema, table)
        except Exception:
            sample_df = pd.DataFrame()

        if not base["description"]:
            try:
                base["description"] = _cached_comment(_uc(), catalog, schema, table)
            except Exception:
                pass

        try:
            row_count = _coalesce(
                detail.get("numrows"),
                _cached_table_row_count(_uc(), catalog, schema, table),
            )
        except Exception:
            row_count = _coalesce(detail.get("numrows"))
        base["rows"] = f"{_safe_int(row_count):,}" if _safe_int(row_count) else "—"
        base["format"] = _coalesce(detail.get("format"), base["objectType"]).lower() or "—"
        if base["format"] == "table":
            base["format"] = "delta"
        base["size"] = _human_bytes(detail.get("sizeinbytes"))
        base["files"] = str(_safe_int(detail.get("numfiles"))) if _safe_int(detail.get("numfiles")) else "—"
        base["objectType"] = _coalesce(_friendly_table_type(detail.get("type")), base["objectType"])
        base["relatedAssets"] = _related_assets(catalog, schema, table, base["fqn"])
        base["preview"] = _preview_records(sample_df)
        base["columns"] = _column_records(columns_df)
        return base

    return _ttl_value(f"modern_asset:{asset_fqn}", 300, _loader)


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
    item_kind = kind or _friendly_table_type(row.get("table_type"))
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
    row = _inventory_row(asset_fqn)
    catalog, schema, table = _split_uc_name(_normalize_str(row.get("fqn")))
    focus = _graph_node_for_asset(
        asset_fqn,
        "focus",
        50,
        50,
        kicker="Focus",
        kind=_friendly_table_type(row.get("table_type")),
        foot=[_normalize_str(row.get("certification")) or "Unassigned"],
        depth=0,
    )
    try:
        upstream_df = _filter_asset_rows(
            _cached_lineage_up(_uc(), catalog, schema, table),
            ["source_table_name", "source_table_full_name"],
            exclude_fqn=asset_fqn,
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = _filter_asset_rows(
            _cached_lineage_down(_uc(), catalog, schema, table),
            ["target_table_name", "target_table_full_name"],
            exclude_fqn=asset_fqn,
        )
    except Exception:
        downstream_df = pd.DataFrame()
    upstream_assets = (
        upstream_df["source_table_full_name"].dropna().astype(str).tolist()
        if upstream_df is not None and not upstream_df.empty and "source_table_full_name" in upstream_df.columns
        else []
    )
    downstream_assets = (
        downstream_df["target_table_full_name"].dropna().astype(str).tolist()
        if downstream_df is not None and not downstream_df.empty and "target_table_full_name" in downstream_df.columns
        else []
    )

    nodes = [focus]
    edges: List[Dict[str, Any]] = []
    for idx, (x, y) in enumerate(_stack_positions(len(upstream_assets), x=20)):
        upstream_fqn = _normalize_str(upstream_assets[idx])
        node = _graph_node_for_asset(upstream_fqn, "source", x, y, kicker="Source")
        nodes.append(node)
        edges.append({"source": node["id"], "target": "focus", "depth": 1})
    for idx, (x, y) in enumerate(_stack_positions(len(downstream_assets), x=80)):
        downstream_fqn = _normalize_str(downstream_assets[idx])
        node = _graph_node_for_asset(downstream_fqn, "target", x, y, kicker="Target")
        nodes.append(node)
        edges.append({"source": "focus", "target": node["id"], "depth": 1})

    if len(nodes) == 1:
        return {
            "nodes": [focus],
            "edges": [],
        }
    return {"nodes": nodes, "edges": edges}


def _build_operational_graph(asset_fqn: str) -> Dict[str, Any]:
    row = _inventory_row(asset_fqn)
    catalog, schema, table = _split_uc_name(_normalize_str(row.get("fqn")))
    focus = _graph_node_for_asset(
        asset_fqn,
        "focus",
        50,
        48,
        kicker="Focus",
        kind=_friendly_table_type(row.get("table_type")),
        foot=["Operational center"],
        depth=0,
    )
    try:
        upstream_df = _enrich_operational_context_names(
            _uc(), _cached_operational_context_up(_uc(), catalog, schema, table)
        )
    except Exception:
        upstream_df = pd.DataFrame()
    try:
        downstream_df = _enrich_operational_context_names(
            _uc(), _cached_operational_context_down(_uc(), catalog, schema, table)
        )
    except Exception:
        downstream_df = pd.DataFrame()
    upstream_cards = _summarize_operational_context(
        upstream_df,
        direction="upstream",
        focus_asset_name=focus["label"],
    )
    downstream_cards = _summarize_operational_context(
        downstream_df,
        direction="downstream",
        focus_asset_name=focus["label"],
    )

    nodes = [focus]
    edges: List[Dict[str, Any]] = []

    for idx, (x, y) in enumerate(_stack_positions(len(upstream_cards), x=21)):
        card = upstream_cards[idx]
        node = {
            "id": f"op-up-{idx + 1}",
            "label": card["title"],
            "subtitle": card["subtitle"] or card["note"],
            "kicker": card["entity_label"],
            "kind": card["entity_label"],
            "role": "source",
            "depth": 1,
            "x": x,
            "y": y,
            "foot": [f"{card['asset_count']} {card['assets_label']}"],
        }
        nodes.append(node)
        edges.append({"source": node["id"], "target": "focus", "depth": 1})

    for idx, (x, y) in enumerate(_stack_positions(len(downstream_cards), x=79)):
        card = downstream_cards[idx]
        node = {
            "id": f"op-down-{idx + 1}",
            "label": card["title"],
            "subtitle": card["subtitle"] or card["note"],
            "kicker": card["entity_label"],
            "kind": card["entity_label"],
            "role": "target",
            "depth": 1,
            "x": x,
            "y": y,
            "foot": [f"{card['asset_count']} {card['assets_label']}"],
        }
        nodes.append(node)
        edges.append({"source": "focus", "target": node["id"], "depth": 1})

    return {"nodes": nodes, "edges": edges}


def _lineage_payload(asset_fqn: str) -> Dict[str, Any]:
    def _loader() -> Dict[str, Any]:
        return {
            "fqn": asset_fqn,
            "graphs": {
                "data": _build_data_graph(asset_fqn),
                "operational": _build_operational_graph(asset_fqn),
            },
        }

    return _ttl_value(f"modern_lineage:{asset_fqn}", 300, _loader)


def _governance_summary() -> Dict[str, Any]:
    def _loader() -> Dict[str, Any]:
        inventory = _visible_assets()
        store = _store_for_read()
        try:
            pending = store.list_change_requests(status="pending", limit=200)
        except Exception:
            pending = pd.DataFrame()
        try:
            glossary = store.list_glossary_terms(limit=200)
        except Exception:
            glossary = pd.DataFrame()

        metrics = [
            {"label": "Assets", "value": int(len(inventory.index))},
            {
                "label": "Needs attention",
                "value": int(
                    inventory["governance_status"].eq("Needs Work").sum()
                    + inventory["pending_requests"].gt(0).sum()
                ),
            },
            {
                "label": "Certified",
                "value": int(inventory["certification"].fillna("").astype(str).str.lower().eq("certified").sum()),
            },
            {"label": "With stewards", "value": int(inventory["steward"].fillna("").astype(str).ne("").sum())},
            {"label": "Sensitive assets", "value": int(inventory["sensitivity"].fillna("").astype(str).ne("").sum())},
            {"label": "Open requests", "value": int(inventory["pending_requests"].fillna(0).astype(int).sum())},
        ]

        backlog: List[Dict[str, str]] = []
        if pending is not None and not pending.empty:
            for _, req in pending.head(8).iterrows():
                backlog.append(
                    {
                        "title": _normalize_str(req.get("new_comment")) or "Open governance request",
                        "asset": _normalize_str(req.get("uc_full_name")),
                        "status": _normalize_str(req.get("status")).title() or "Pending",
                        "note": _normalize_str(req.get("review_note")) or "Awaiting governance review.",
                    }
                )
        if not backlog and inventory is not None and not inventory.empty:
            needs_owner = inventory[inventory["owner_count"].fillna(0).astype(int).eq(0)].head(4)
            for _, row in needs_owner.iterrows():
                backlog.append(
                    {
                        "title": f"Assign owner to {_normalize_str(row.get('table_name'))}",
                        "asset": _normalize_str(row.get("fqn")),
                        "status": "Needs Owner",
                        "note": "High-value asset is missing a business, technical, or steward owner.",
                    }
                )

        glossary_rows: List[Dict[str, str]] = []
        if glossary is not None and not glossary.empty:
            for _, row in glossary.head(50).iterrows():
                glossary_rows.append(
                    {
                        "term": _normalize_str(row.get("name")),
                        "definition": _normalize_str(row.get("definition")) or "No definition",
                    }
                )

        return {"metrics": metrics, "backlog": backlog, "glossary": glossary_rows}

    return _ttl_value("modern_governance", 300, _loader)


def _bootstrap_payload(request: Request) -> Dict[str, Any]:
    store_status = _store_status()
    inventory = _visible_assets()
    assets = [_base_asset_payload(row) for _, row in inventory.iterrows()]
    asset_index = {asset["fqn"]: asset for asset in assets}
    catalogs = _catalog_filter_options(
        inventory,
        available_catalogs=list(inventory["table_catalog"].dropna().astype(str).unique()),
        observed_catalogs=_lineage_observed_catalogs(),
    )
    asset_types = sorted({asset["objectType"] for asset in assets if asset["objectType"]})
    domains = sorted({asset["domain"] for asset in assets if asset["domain"] and asset["domain"] != "Unassigned"})
    tiers = sorted({asset["tier"] for asset in assets if asset["tier"] and asset["tier"] != "Unassigned"})
    certifications = sorted({asset["certification"] for asset in assets if asset["certification"] and asset["certification"] != "Unassigned"})
    sensitivities = sorted({asset["sensitivity"] for asset in assets if asset["sensitivity"] and asset["sensitivity"] != "Unassigned"})
    governance = _governance_summary()

    selected_fqn = request.query_params.get("asset") or (assets[0]["fqn"] if assets else "")
    graphs: Dict[str, Any] = {}
    if selected_fqn and selected_fqn in asset_index:
        detail = _asset_detail_payload(selected_fqn)
        asset_index[selected_fqn] = {**asset_index[selected_fqn], **detail}
        for idx, asset in enumerate(assets):
            if asset["fqn"] == selected_fqn:
                assets[idx] = asset_index[selected_fqn]
                break
        graphs[selected_fqn] = _lineage_payload(selected_fqn)["graphs"]

    return {
        "version": "modern-ui-live-2",
        "bootState": "live" if store_status["state"] == "live" else "degraded",
        "bootMessage": "" if store_status["state"] == "live" else store_status["message"],
        "apiBase": "/api",
        "assets": assets,
        "assetIndex": asset_index,
        "graphs": graphs,
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
        },
        "governance": governance,
        "shell": {
            "metrics": governance["metrics"],
            "role": _user_role(request),
            "userEmail": _user_email(request),
        },
        "help": HELP_ITEMS,
        "apiContract": {
            "bootstrap": "/api/bootstrap",
            "discoverySearch": "/api/discovery/search",
            "assetDetail": "/api/assets/:fqn",
            "lineage": "/api/lineage/:fqn",
            "governanceSummary": "/api/governance/summary",
            "glossary": "/api/governance/glossary",
        },
    }


def _ensure_live_runtime() -> None:
    if not _live_runtime_available():
        raise HTTPException(status_code=503, detail="Live Databricks runtime is not available.")


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
        },
        "governance": {"metrics": [], "backlog": [], "glossary": []},
        "shell": {
            "metrics": [],
            "role": role,
            "userEmail": email,
        },
        "help": [
            {
                "title": "Modern mode unavailable",
                "body": message,
            }
        ],
    }


def _ensure_react_bundle() -> Path:
    index_path = REACT_DIST_DIR / "index.html"
    assets_dir = REACT_DIST_DIR / "assets"
    if index_path.exists() and assets_dir.exists():
        return index_path
    if (
        (FRONTEND_DIR / "package.json").exists()
        and (FRONTEND_DIR / "node_modules").exists()
        and shutil.which("npm")
    ):
        subprocess.run(
            ["npm", "run", "build"],
            cwd=str(FRONTEND_DIR),
            check=True,
        )
    if index_path.exists() and assets_dir.exists():
        return index_path
    raise RuntimeError(
        "Modern React bundle is missing. Build frontend/dist before running GOVHUB_APP_MODE=modern."
    )


def _inject_bootstrap(html_text: str, payload: Dict[str, Any]) -> str:
    bootstrap = json.dumps(payload, default=str).replace("</", "<\\/")
    inline_bootstrap = (
        "<script>"
        "window.__GOVHUB_BOOTSTRAP__ = "
        f"{bootstrap};"
        "</script>"
    )
    return html_text.replace("</head>", f"{inline_bootstrap}\n  </head>")


def _render_index(live_payload: Optional[Dict[str, Any]] = None) -> str:
    try:
        react_index = _ensure_react_bundle().read_text(encoding="utf-8")
    except Exception as exc:
        return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Governance Hub Modern Bundle Missing</title>
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
      <h1>Modern React bundle is missing</h1>
      <p>The app is running in <code>GOVHUB_APP_MODE=modern</code>, but the compiled frontend assets were not found.</p>
      <p>Build <code>frontend/dist</code> with <code>npm install</code> and <code>npm run build</code> inside <code>frontend/</code>, then redeploy.</p>
      <p>Runtime detail: {json.dumps(_normalize_str(exc) or 'unknown error')}</p>
    </div>
  </body>
</html>"""
    return _inject_bootstrap(react_index, live_payload or {})


def _render_unavailable_index(message: str) -> str:
    return _render_index(_bootstrap_unavailable_payload(None, message))


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    if not _live_runtime_available():
        return HTMLResponse(
            _render_index(
                _bootstrap_unavailable_payload(
                    request,
                    "Live Databricks metadata runtime is unavailable. Fix the warehouse or governance configuration or warehouse access, then retry modern mode.",
                )
            ),
            status_code=200,
        )
    try:
        return HTMLResponse(_render_index(_bootstrap_payload(request)))
    except Exception as exc:
        return HTMLResponse(
            _render_index(
                _bootstrap_unavailable_payload(
                    request,
                    f"Modern bootstrap failed: {_normalize_str(exc) or 'unknown error'}.",
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
                "Live Databricks metadata runtime is unavailable. Fix the warehouse or governance configuration or warehouse access, then retry modern mode.",
            )
        )
    try:
        return JSONResponse(_bootstrap_payload(request))
    except Exception as exc:
        return JSONResponse(
            _bootstrap_unavailable_payload(
                request,
                f"Modern bootstrap failed: {_normalize_str(exc) or 'unknown error'}.",
                state="error",
            )
        )


@app.get("/api/discovery/search")
def api_discovery_search(
    query: str = "",
    catalogs: Optional[List[str]] = Query(default=None),
    domains: Optional[List[str]] = Query(default=None),
    tiers: Optional[List[str]] = Query(default=None),
    certifications: Optional[List[str]] = Query(default=None),
    sensitivities: Optional[List[str]] = Query(default=None),
) -> JSONResponse:
    _ensure_live_runtime()
    rows = [_base_asset_payload(row) for _, row in _visible_assets().iterrows()]
    q = _normalize_str(query).lower()
    result: List[Dict[str, Any]] = []
    for asset in rows:
        haystack = " ".join(
            [
                asset["name"],
                asset["description"],
                asset["catalog"],
                asset["schema"],
                asset["domain"],
                asset["tier"],
                asset["certification"],
                asset["sensitivity"],
            ]
        ).lower()
        if q and q not in haystack:
            continue
        if catalogs and asset["catalog"] not in catalogs:
            continue
        if domains and asset["domain"] not in domains:
            continue
        if tiers and asset["tier"] not in tiers:
            continue
        if certifications and asset["certification"] not in certifications:
            continue
        if sensitivities and asset["sensitivity"] not in sensitivities:
            continue
        result.append(asset)
    return JSONResponse({"assets": result, "count": len(result)})


@app.get("/api/assets/{asset_fqn:path}")
def api_asset_detail(asset_fqn: str) -> JSONResponse:
    _ensure_live_runtime()
    if not _asset_exists(asset_fqn):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    return JSONResponse(_asset_detail_payload(asset_fqn))


@app.get("/api/lineage/{asset_fqn:path}")
def api_lineage(asset_fqn: str) -> JSONResponse:
    _ensure_live_runtime()
    if not _asset_exists(asset_fqn):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    return JSONResponse(_lineage_payload(asset_fqn))


@app.get("/api/governance/summary")
def api_governance_summary() -> JSONResponse:
    _ensure_live_runtime()
    return JSONResponse(_governance_summary())


@app.get("/api/governance/glossary")
def api_governance_glossary() -> JSONResponse:
    _ensure_live_runtime()
    return JSONResponse({"glossary": _governance_summary()["glossary"]})
