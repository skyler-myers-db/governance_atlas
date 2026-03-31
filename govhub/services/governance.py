from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Dict, List, Sequence, Tuple

import pandas as pd

from govhub.uc import UCSQLClient

from govhub.services import assets as asset_service


_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}
_OWNER_TYPES = {"business", "technical", "steward"}


def _ttl_value(key: str, ttl_s: int, loader: Callable[[], Any]) -> Any:
    now = time.time()
    cached = _TTL_CACHE.get(key)
    if cached and now - cached[0] < ttl_s:
        return cached[1]
    value = loader()
    _TTL_CACHE[key] = (now, value)
    return value


def _warehouse_key(uc: UCSQLClient) -> str:
    return asset_service.normalize_str(getattr(uc, "warehouse_id", "")) or "default"


def invalidate_governance_caches() -> None:
    _TTL_CACHE.clear()


def _invalidate_asset_dependent_caches(asset_fqn: str | None = None) -> None:
    asset_service.invalidate_asset_caches(asset_fqn)
    invalidate_governance_caches()


def governance_summary(
    uc: UCSQLClient,
    store: Any,
    *,
    hidden_catalogs: set[str] = asset_service.HIDDEN_CATALOGS,
) -> Dict[str, Any]:
    def _loader() -> Dict[str, Any]:
        inventory = asset_service.visible_assets(
            uc,
            store,
            hidden_catalogs=hidden_catalogs,
        )
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
                "value": int(
                    inventory["certification"]
                    .fillna("")
                    .astype(str)
                    .str.lower()
                    .eq("certified")
                    .sum()
                ),
            },
            {
                "label": "With stewards",
                "value": int(
                    inventory["steward"].fillna("").astype(str).ne("").sum()
                ),
            },
            {
                "label": "Sensitive assets",
                "value": int(
                    inventory["sensitivity"].fillna("").astype(str).ne("").sum()
                ),
            },
            {
                "label": "Open requests",
                "value": int(inventory["pending_requests"].fillna(0).astype(int).sum()),
            },
        ]

        backlog: List[Dict[str, str]] = []
        if pending is not None and not pending.empty:
            for _, req in pending.head(8).iterrows():
                backlog.append(
                    {
                        "requestId": asset_service.normalize_str(req.get("request_id")),
                        "title": asset_service.normalize_str(req.get("new_comment"))
                        or "Open governance request",
                        "asset": asset_service.normalize_str(req.get("uc_full_name")),
                        "assetFqn": asset_service.normalize_str(req.get("uc_full_name")),
                        "status": asset_service.normalize_str(req.get("status")).title()
                        or "Pending",
                        "note": asset_service.normalize_str(req.get("review_note"))
                        or "Awaiting governance review.",
                    }
                )
        if not backlog and inventory is not None and not inventory.empty:
            needs_owner = inventory[
                inventory["owner_count"].fillna(0).astype(int).eq(0)
            ].head(4)
            for _, row in needs_owner.iterrows():
                backlog.append(
                    {
                        "requestId": "",
                        "title": f"Assign owner to {asset_service.normalize_str(row.get('table_name'))}",
                        "asset": asset_service.normalize_str(row.get("fqn")),
                        "assetFqn": asset_service.normalize_str(row.get("fqn")),
                        "status": "Needs Owner",
                        "note": "High-value asset is missing a business, technical, or steward owner.",
                    }
                )

        glossary_asset_map: Dict[str, List[str]] = {}
        if inventory is not None and not inventory.empty and "glossary_term" in inventory.columns:
            glossary_inventory = inventory[
                inventory["glossary_term"].fillna("").astype(str).ne("")
            ].copy()
            if not glossary_inventory.empty:
                glossary_asset_map = (
                    glossary_inventory.groupby("glossary_term")["fqn"]
                    .apply(
                        lambda series: [
                            str(item)
                            for item in series.head(8).tolist()
                            if str(item)
                        ]
                    )
                    .to_dict()
                )

        glossary_rows: List[Dict[str, str]] = []
        if glossary is not None and not glossary.empty:
            for _, row in glossary.head(50).iterrows():
                term_name = asset_service.normalize_str(row.get("name"))
                related_assets = glossary_asset_map.get(term_name, [])
                glossary_rows.append(
                    {
                        "termId": asset_service.normalize_str(row.get("term_id")),
                        "term": term_name,
                        "definition": asset_service.normalize_str(row.get("definition"))
                        or "No definition",
                        "domain": asset_service.normalize_str(row.get("domain"))
                        or "Unassigned",
                        "ownerEmail": asset_service.normalize_str(row.get("owner_email"))
                        or "Unassigned",
                        "status": asset_service.normalize_str(row.get("status")).title()
                        or "Draft",
                        "assetCount": len(related_assets),
                        "assets": related_assets,
                    }
                )

        return {"metrics": metrics, "backlog": backlog, "glossary": glossary_rows}

    return _ttl_value(f"governance:{_warehouse_key(uc)}", 300, _loader)


def create_change_request(
    store: Any,
    *,
    created_by: str,
    asset_fqn: str,
    title: str,
    note: str,
) -> str:
    request_id = store.create_change_request(
        created_by=created_by,
        uc_full_name=asset_fqn,
        new_comment=f"{title}: {note}".strip(": "),
    )
    _invalidate_asset_dependent_caches(asset_fqn)
    return request_id


def patch_asset_description(
    uc: UCSQLClient,
    *,
    asset_fqn: str,
    description: str,
) -> None:
    catalog, schema, table = asset_service.split_uc_name(asset_fqn)
    uc.set_table_comment(catalog, schema, table, description)
    _invalidate_asset_dependent_caches(asset_fqn)


def _normalize_owner_assignments(
    owner_assignments: Sequence[Dict[str, Any]],
) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    seen: set[str] = set()
    for entry in owner_assignments:
        owner_email = asset_service.normalize_str(entry.get("ownerEmail")).lower()
        if not owner_email or owner_email in seen:
            continue
        seen.add(owner_email)
        owner_type = asset_service.normalize_str(entry.get("ownerType")).lower()
        if owner_type not in _OWNER_TYPES:
            owner_type = "steward"
        normalized.append(
            {
                "ownerEmail": owner_email,
                "ownerType": owner_type,
            }
        )
    return normalized


def patch_asset_owners(
    store: Any,
    *,
    asset_fqn: str,
    owner_assignments: Sequence[Dict[str, Any]],
    updated_by: str,
    replace: bool = True,
) -> List[Dict[str, str]]:
    normalized = _normalize_owner_assignments(owner_assignments)
    if replace:
        existing_df = store.get_owners(asset_fqn)
        if existing_df is not None and not existing_df.empty:
            desired_emails = {entry["ownerEmail"] for entry in normalized}
            for owner_email in existing_df["owner_email"].dropna().astype(str).tolist():
                email_n = asset_service.normalize_str(owner_email).lower()
                if email_n and email_n not in desired_emails:
                    store.remove_owner(asset_fqn, owner_email)
    for entry in normalized:
        store.upsert_owner(
            asset_fqn,
            entry["ownerEmail"],
            entry["ownerType"],
            updated_by,
        )
    _invalidate_asset_dependent_caches(asset_fqn)
    return normalized


def add_owner(
    store: Any,
    *,
    asset_fqn: str,
    owner_email: str,
    owner_type: str,
    updated_by: str,
) -> List[Dict[str, str]]:
    return patch_asset_owners(
        store,
        asset_fqn=asset_fqn,
        owner_assignments=[
            {
                "ownerEmail": owner_email,
                "ownerType": owner_type,
            }
        ],
        updated_by=updated_by,
        replace=False,
    )


def patch_column_description(
    uc: UCSQLClient,
    *,
    asset_fqn: str,
    column_name: str,
    description: str,
) -> None:
    catalog, schema, table = asset_service.split_uc_name(asset_fqn)
    uc.set_column_comment(catalog, schema, table, column_name, description)
    asset_service.invalidate_asset_caches(asset_fqn)


def upsert_glossary_term(
    store: Any,
    *,
    term_id: str,
    name: str,
    definition: str,
    domain: str,
    owner_email: str,
    status: str,
    updated_by: str,
) -> None:
    store.upsert_glossary_term(
        term_id=term_id or uuid.uuid4().hex[:12],
        name=name,
        definition=definition,
        domain=domain,
        owner_email=owner_email or None,
        status=status,
        updated_by=updated_by,
    )
    invalidate_governance_caches()
