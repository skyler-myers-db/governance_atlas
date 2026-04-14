from __future__ import annotations

import json
import math
import re
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import pandas as pd

from govhub.uc import _is_skippable_metadata_error
from govhub.services import live_metadata as metadata_service


HIDDEN_CATALOGS = {"hive_metastore", "samples", "system", "__databricks_internal"}
PLACEHOLDER_DESCRIPTION = "No description has been captured for this asset yet."
ASSET_DETAIL_SECTIONS = (
    "header",
    "activity",
    "schema",
    "preview",
    "properties",
    "operational",
    "profiler",
)

_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}

cached_asset_inventory = metadata_service.cached_asset_inventory
cached_catalog_inventory = metadata_service.cached_catalog_inventory
cached_catalog_table_tags = metadata_service.cached_catalog_table_tags
cached_catalogs = metadata_service.cached_catalogs
cached_comment = metadata_service.cached_comment
cached_columns = metadata_service.cached_columns
cached_table_detail = metadata_service.cached_table_detail
cached_table_row_count = metadata_service.cached_table_row_count
cached_sample_rows = metadata_service.cached_sample_rows
cached_lineage_up = metadata_service.cached_lineage_up
cached_lineage_down = metadata_service.cached_lineage_down

normalize_str = metadata_service.normalize_str
filter_asset_rows = metadata_service.filter_asset_rows
split_uc_name = metadata_service.split_uc_name
catalog_filter_options = metadata_service.catalog_filter_options
tag_value = metadata_service.tag_value
lineage_asset_stub = metadata_service.lineage_asset_stub
empty_inventory = metadata_service.empty_inventory


def _ttl_value(key: str, ttl_s: int, loader: Callable[[], Any]) -> Any:
    now = time.time()
    cached = _TTL_CACHE.get(key)
    if cached and now - cached[0] < ttl_s:
        return cached[1]
    value = loader()
    _TTL_CACHE[key] = (now, value)
    return value


def _warehouse_key(uc: Any) -> str:
    return normalize_str(getattr(uc, "warehouse_id", "")) or "default"


def invalidate_asset_caches(asset_fqn: str | None = None) -> None:
    metadata_service.invalidate_live_metadata_caches(asset_fqn)
    for key in list(_TTL_CACHE):
        if key.startswith("inventory:") or key.startswith("visible_assets:") or key.startswith("discovery_index:"):
            _TTL_CACHE.pop(key, None)
            continue
        if asset_fqn and key.startswith("asset_detail:") and normalize_str(asset_fqn) in key:
            _TTL_CACHE.pop(key, None)
    try:
        from govhub.services import lineage as lineage_service

        lineage_service.invalidate_lineage_caches(asset_fqn)
    except Exception:
        pass


def inventory_catalogs(uc, hidden_catalogs: Sequence[str]) -> List[str]:
    values: set[str] = set()
    try:
        values.update(cached_catalogs(uc))
    except Exception:
        pass
    hidden = {str(value).lower() for value in hidden_catalogs}
    return sorted(value for value in values if value and value.lower() not in hidden)


def lineage_observed_catalogs(
    uc,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> List[str]:
    try:
        df = uc.list_lineage_catalogs()
    except Exception:
        return []
    if df is None or df.empty:
        return []
    hidden = {str(value).lower() for value in hidden_catalogs}
    return sorted(
        normalize_str(value)
        for value in df.iloc[:, 0].tolist()
        if normalize_str(value) and normalize_str(value).lower() not in hidden
    )


def inventory(
    uc,
    store,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> pd.DataFrame:
    return _ttl_value(
        f"inventory:{_warehouse_key(uc)}",
        600,
        lambda: build_inventory(
            uc,
            store,
            hidden_catalogs,
            _is_skippable_metadata_error,
        ),
    )


def build_inventory(uc, store, hidden_catalogs: Sequence[str], is_skippable_metadata_error) -> pd.DataFrame:
    catalogs = inventory_catalogs(uc, hidden_catalogs)
    if not catalogs:
        fallback = cached_asset_inventory(uc, store)
        return fallback if fallback is not None and not fallback.empty else empty_inventory()

    inventory_frames: List[pd.DataFrame] = []
    tag_maps: Dict[str, Dict[str, str]] = {}

    for catalog in catalogs:
        try:
            inv = cached_catalog_inventory(uc, catalog)
        except Exception as exc:
            if is_skippable_metadata_error(exc):
                continue
            raise
        if not inv.empty:
            inv = inv.copy()
            inv["comment"] = inv["comment"].map(normalize_str)
            inv["fqn"] = (
                inv["table_catalog"].astype(str)
                + "."
                + inv["table_schema"].astype(str)
                + "."
                + inv["table_name"].astype(str)
            )
            inventory_frames.append(inv)

        try:
            tags_df = cached_catalog_table_tags(uc, catalog)
        except Exception as exc:
            if is_skippable_metadata_error(exc):
                continue
            raise
        if tags_df.empty:
            continue
        tags_df = tags_df.copy()
        tags_df["fqn"] = (
            tags_df["table_catalog"].astype(str)
            + "."
            + tags_df["table_schema"].astype(str)
            + "."
            + tags_df["table_name"].astype(str)
        )
        for fqn, group in tags_df.groupby("fqn"):
            tag_maps[str(fqn)] = {
                normalize_str(row.tag_name): normalize_str(row.tag_value)
                for row in group.itertuples()
                if normalize_str(row.tag_name)
            }

    if not inventory_frames:
        fallback = cached_asset_inventory(uc, store)
        return fallback if fallback is not None and not fallback.empty else empty_inventory()

    inventory = pd.concat(inventory_frames, ignore_index=True)
    inventory = filter_asset_rows(inventory, ["table_name", "fqn"])
    if inventory.empty:
        return empty_inventory()

    inventory["tags"] = inventory["fqn"].map(
        lambda fqn: tag_maps.get(str(fqn), {}) if pd.notna(fqn) else {}
    )
    inventory["domain"] = inventory["tags"].map(
        lambda tags: tag_value(tags if isinstance(tags, dict) else {}, "domain")
    )
    inventory["tier"] = inventory["tags"].map(
        lambda tags: tag_value(tags if isinstance(tags, dict) else {}, "tier")
    )
    inventory["certification"] = inventory["tags"].map(
        lambda tags: tag_value(tags if isinstance(tags, dict) else {}, "certification")
    )
    inventory["sensitivity"] = inventory["tags"].map(
        lambda tags: tag_value(tags if isinstance(tags, dict) else {}, "sensitivity")
    )
    inventory["criticality"] = inventory["tags"].map(
        lambda tags: tag_value(tags if isinstance(tags, dict) else {}, "criticality")
    )
    inventory["glossary_term"] = inventory["tags"].map(
        lambda tags: tag_value(tags if isinstance(tags, dict) else {}, "glossary_term")
    )
    inventory["data_product"] = inventory["tags"].map(
        lambda tags: tag_value(tags if isinstance(tags, dict) else {}, "data_product")
    )

    owners_df = store.list_owner_assignments()
    if not owners_df.empty:
        owner_rows = []
        for fqn, group in owners_df.groupby("uc_full_name"):
            owner_rows.append(
                {
                    "fqn": fqn,
                    "owner_count": int(group["owner_email"].nunique()),
                    "owners_summary": ", ".join(
                        sorted(
                            {
                                normalize_str(email)
                                for email in group["owner_email"].tolist()
                                if normalize_str(email)
                            }
                        )[:3]
                    ),
                    "business_owner": ", ".join(
                        sorted(
                            {
                                normalize_str(email)
                                for email in group.loc[
                                    group["owner_type"] == "business", "owner_email"
                                ].tolist()
                                if normalize_str(email)
                            }
                        )
                    ),
                    "technical_owner": ", ".join(
                        sorted(
                            {
                                normalize_str(email)
                                for email in group.loc[
                                    group["owner_type"] == "technical", "owner_email"
                                ].tolist()
                                if normalize_str(email)
                            }
                        )
                    ),
                    "steward": ", ".join(
                        sorted(
                            {
                                normalize_str(email)
                                for email in group.loc[
                                    group["owner_type"] == "steward", "owner_email"
                                ].tolist()
                                if normalize_str(email)
                            }
                        )
                    ),
                }
            )
        inventory = inventory.merge(pd.DataFrame(owner_rows), on="fqn", how="left")
    else:
        inventory["owner_count"] = 0
        inventory["owners_summary"] = ""
        inventory["business_owner"] = ""
        inventory["technical_owner"] = ""
        inventory["steward"] = ""

    links_df = store.list_asset_links()
    if not links_df.empty:
        links_df = links_df.rename(columns={"uc_full_name": "fqn", "om_table_fqn": "om_table_fqn"})
        inventory = inventory.merge(links_df[["fqn", "om_table_fqn"]], on="fqn", how="left")
    else:
        inventory["om_table_fqn"] = ""

    requests_df = store.list_change_requests(limit=500)
    if not requests_df.empty:
        request_rollup = (
            requests_df[requests_df["uc_full_name"].notna()]
            .groupby("uc_full_name")
            .agg(
                pending_requests=("status", lambda s: int((s == "pending").sum())),
                approved_requests=("status", lambda s: int((s == "approved").sum())),
                rejected_requests=("status", lambda s: int((s == "rejected").sum())),
                total_requests=("request_id", "count"),
            )
            .reset_index()
            .rename(columns={"uc_full_name": "fqn"})
        )
        inventory = inventory.merge(request_rollup, on="fqn", how="left")
    else:
        inventory["pending_requests"] = 0
        inventory["approved_requests"] = 0
        inventory["rejected_requests"] = 0
        inventory["total_requests"] = 0

    for col in [
        "owner_count",
        "pending_requests",
        "approved_requests",
        "rejected_requests",
        "total_requests",
    ]:
        if col not in inventory.columns:
            inventory[col] = 0
        inventory[col] = inventory[col].fillna(0).astype(int)

    for col in [
        "owners_summary",
        "business_owner",
        "technical_owner",
        "steward",
        "om_table_fqn",
    ]:
        if col not in inventory.columns:
            inventory[col] = ""
        inventory[col] = inventory[col].map(normalize_str)

    inventory["governance_score"] = (
        35 * inventory["comment"].ne("").astype(int)
        + 20 * inventory["owner_count"].gt(0).astype(int)
        + 15 * inventory["domain"].ne("").astype(int)
        + 15 * inventory["certification"].ne("").astype(int)
        + 15 * inventory["glossary_term"].ne("").astype(int)
    )
    inventory["governance_status"] = "Needs Work"
    inventory.loc[inventory["governance_score"] >= 55, "governance_status"] = "Operational"
    inventory.loc[inventory["governance_score"] >= 80, "governance_status"] = "Enterprise Ready"

    search_cols = [
        "fqn",
        "table_name",
        "table_schema",
        "comment",
        "domain",
        "tier",
        "certification",
        "sensitivity",
        "criticality",
        "glossary_term",
        "data_product",
        "owners_summary",
        "business_owner",
        "technical_owner",
        "steward",
    ]
    inventory["search_text"] = (
        inventory[search_cols].fillna("").astype(str).agg(" ".join, axis=1).str.lower()
    )
    return inventory.sort_values(
        ["governance_score", "pending_requests", "fqn"],
        ascending=[False, False, True],
    ).reset_index(drop=True)


def visible_assets(
    inventory_or_uc,
    store=None,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> pd.DataFrame:
    inventory_df = (
        inventory_or_uc
        if isinstance(inventory_or_uc, pd.DataFrame)
        else inventory(inventory_or_uc, store, hidden_catalogs=hidden_catalogs)
    )
    if inventory_df is None or inventory_df.empty:
        return inventory_df
    hidden = {str(value).lower() for value in hidden_catalogs}
    return inventory_df[
        ~inventory_df["table_catalog"].fillna("").astype(str).str.lower().isin(hidden)
    ].reset_index(drop=True)


def inventory_row(
    inventory_or_uc,
    store_or_asset_fqn,
    asset_fqn: str | None = None,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> pd.Series:
    exact_row: Optional[pd.Series] = None
    if isinstance(inventory_or_uc, pd.DataFrame):
        inventory_df = inventory_or_uc
        resolved_asset_fqn = str(store_or_asset_fqn)
    else:
        exact_row = exact_identity_row(inventory_or_uc, str(asset_fqn or ""))
        inventory_df = visible_assets(
            inventory_or_uc,
            store_or_asset_fqn,
            hidden_catalogs=hidden_catalogs,
        )
        resolved_asset_fqn = str(asset_fqn or "")
    if inventory_df is None or inventory_df.empty:
        return lineage_asset_stub(pd.DataFrame(), resolved_asset_fqn)
    match = inventory_df[inventory_df["fqn"] == resolved_asset_fqn]
    if not match.empty:
        return match.iloc[0]
    if exact_row is not None:
        return exact_row
    return lineage_asset_stub(inventory_df, resolved_asset_fqn)


def asset_exists(
    inventory_or_uc,
    store_or_asset_fqn,
    asset_fqn: str | None = None,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> bool:
    if isinstance(inventory_or_uc, pd.DataFrame):
        inventory_df = inventory_or_uc
        resolved_asset_fqn = str(store_or_asset_fqn)
        exact_row = None
    else:
        inventory_df = visible_assets(
            inventory_or_uc,
            store_or_asset_fqn,
            hidden_catalogs=hidden_catalogs,
        )
        resolved_asset_fqn = str(asset_fqn or "")
        exact_row = exact_identity_row(inventory_or_uc, resolved_asset_fqn)
    if inventory_df is None or inventory_df.empty:
        return exact_row is not None
    if bool((inventory_df["fqn"] == resolved_asset_fqn).any()):
        return True
    return exact_row is not None


def asset_is_visible(
    inventory_or_uc,
    store_or_asset_fqn,
    asset_fqn: str | None = None,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> bool:
    if isinstance(inventory_or_uc, pd.DataFrame):
        inventory_df = inventory_or_uc
        resolved_asset_fqn = str(store_or_asset_fqn)
    else:
        inventory_df = visible_assets(
            inventory_or_uc,
            store_or_asset_fqn,
            hidden_catalogs=hidden_catalogs,
        )
        resolved_asset_fqn = str(asset_fqn or "")
    if inventory_df is None or inventory_df.empty:
        return False
    return bool((inventory_df["fqn"] == resolved_asset_fqn).any())


def asset_columns_df(uc, asset_fqn: str) -> pd.DataFrame:
    catalog, schema, table = split_uc_name(asset_fqn)
    try:
        return cached_columns(uc, catalog, schema, table)
    except Exception:
        return pd.DataFrame()


def _resolve_inventory_df(
    inventory_or_uc,
    store=None,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> pd.DataFrame:
    if isinstance(inventory_or_uc, pd.DataFrame):
        return inventory_or_uc
    return visible_assets(
        inventory_or_uc,
        store,
        hidden_catalogs=hidden_catalogs,
    )


def friendly_table_type(raw: Any, data_source_format: Any = None) -> str:
    normalized = normalize_str(raw).upper().replace("_", " ")
    normalized_format = normalize_str(data_source_format).upper()
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
    if normalized_format == "DELTA" and normalized in {
        "",
        "BASE TABLE",
        "TABLE",
        "MANAGED",
        "MANAGED TABLE",
        "EXTERNAL",
        "EXTERNAL TABLE",
    }:
        return "Delta Table"
    if normalized in mapping:
        return mapping[normalized]
    if not normalized or normalized.startswith("UNKNOWN"):
        return ""
    return normalize_str(raw).replace("_", " ").title()


def _prefer_specific_table_type(detail_type: Any, inventory_type: Any) -> str:
    detail_normalized = normalize_str(detail_type).upper().replace("_", " ")
    inventory_normalized = normalize_str(inventory_type).upper().replace("_", " ")
    generic_table_types = {
        "",
        "TABLE",
        "BASE TABLE",
        "MANAGED",
        "MANAGED TABLE",
        "EXTERNAL",
        "EXTERNAL TABLE",
    }
    specific_types = {
        "MATERIALIZED VIEW",
        "STREAMING TABLE",
        "VIEW",
    }
    if detail_normalized in generic_table_types and inventory_normalized in specific_types:
        return normalize_str(inventory_type)
    return normalize_str(detail_type) or normalize_str(inventory_type)


def supports_direct_metadata_write(raw_table_type: Any) -> bool:
    normalized = normalize_str(raw_table_type).upper().replace("_", " ")
    return normalized in {
        "TABLE",
        "BASE TABLE",
        "MANAGED",
        "MANAGED TABLE",
        "EXTERNAL",
        "EXTERNAL TABLE",
        "VIEW",
        "METRIC VIEW",
        "MATERIALIZED VIEW",
        "STREAMING TABLE",
    }


def friendly_storage_format(raw: Any) -> str:
    normalized = normalize_str(raw).upper()
    if not normalized or normalized.startswith("UNKNOWN"):
        return "—"
    mapping = {
        "DELTA": "Delta",
        "PARQUET": "Parquet",
        "CSV": "CSV",
        "JSON": "JSON",
        "AVRO": "Avro",
        "ORC": "ORC",
        "ICEBERG": "Iceberg",
        "TEXT": "Text",
    }
    return mapping.get(normalized, normalize_str(raw).replace("_", " ").title() or "—")


def management_type(raw: Any) -> str:
    normalized = normalize_str(raw).upper()
    if normalized in {"MANAGED", "MANAGED TABLE"}:
        return "Managed"
    if normalized in {"EXTERNAL", "EXTERNAL TABLE"}:
        return "External"
    return "—"


def coalesce(*values: Any) -> str:
    for value in values:
        normalized = normalize_str(value)
        if normalized:
            return normalized
    return ""


def safe_int(value: Any) -> int:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return 0
        return int(float(str(value).replace(",", "")))
    except Exception:
        return 0


def human_bytes(value: Any) -> str:
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


def detail_map(detail_df: pd.DataFrame) -> Dict[str, Any]:
    if detail_df is None or detail_df.empty:
        return {}
    row = detail_df.iloc[0].to_dict()
    return {str(key).lower(): value for key, value in row.items()}


def normalize_asset_detail_sections(sections: Optional[Sequence[str]] = None) -> Tuple[str, ...]:
    normalized = {
        normalize_str(section).lower()
        for section in (sections or [])
        if normalize_str(section)
    }
    if not normalized:
        normalized = set(ASSET_DETAIL_SECTIONS)
    normalized.add("header")
    if "profiler" in normalized:
        normalized.update({"activity", "schema", "preview", "operational"})
    return tuple(section for section in ASSET_DETAIL_SECTIONS if section in normalized)


def owner_entries(row: pd.Series) -> List[Dict[str, str]]:
    owners: List[Dict[str, str]] = []
    owner_fields = [
        ("business_owner", "Business Owner"),
        ("technical_owner", "Technical Owner"),
        ("steward", "Steward"),
    ]
    seen: set[Tuple[str, str]] = set()
    for field_name, title in owner_fields:
        raw = normalize_str(row.get(field_name))
        if not raw:
            continue
        for item in [part.strip() for part in raw.split(",") if part.strip()]:
            key = (item.lower(), title)
            if key in seen:
                continue
            seen.add(key)
            owners.append({"name": item, "title": title})
    return owners


def asset_badges(row: pd.Series) -> List[str]:
    structured_keys = {
        "domain",
        "tier",
        "certification",
        "sensitivity",
        "criticality",
        "glossary_term",
        "data_product",
    }
    badges = [
        normalize_str(row.get("domain")),
        normalize_str(row.get("tier")),
        normalize_str(row.get("certification")),
        normalize_str(row.get("sensitivity")),
        normalize_str(row.get("criticality")),
    ]
    if isinstance(row.get("tags"), dict):
        for key, value in row.get("tags", {}).items():
            if key.startswith("__"):
                continue
            normalized_key = normalize_str(key)
            normalized_value = normalize_str(value)
            if normalized_key.lower() in structured_keys:
                continue
            label = (
                f"{normalized_key}={normalized_value}"
                if normalized_key and normalized_value
                else normalized_key or normalized_value
            )
            if label and label not in badges:
                badges.append(label)
    return [badge for badge in badges if badge]


def raw_tag_map(row: pd.Series) -> Dict[str, str]:
    tags = row.get("tags")
    if not isinstance(tags, dict):
        return {}
    return {
        normalize_str(key): normalize_str(value)
        for key, value in tags.items()
        if normalize_str(key)
    }


def base_asset_payload(row: pd.Series) -> Dict[str, Any]:
    raw_table_type = normalize_str(row.get("table_type"))
    raw_storage_format = normalize_str(row.get("data_source_format"))
    raw_tags = raw_tag_map(row)
    tag_labels = asset_badges(row)
    return {
        "fqn": normalize_str(row.get("fqn")),
        "name": normalize_str(row.get("table_name")) or normalize_str(row.get("fqn")).split(".")[-1],
        "catalog": normalize_str(row.get("table_catalog")),
        "schema": normalize_str(row.get("table_schema")),
        "objectType": friendly_table_type(raw_table_type, raw_storage_format),
        "description": normalize_str(row.get("comment")) or PLACEHOLDER_DESCRIPTION,
        "coverageScore": safe_int(row.get("governance_score")),
        "rows": "—",
        "format": friendly_storage_format(raw_storage_format),
        "storageFormat": friendly_storage_format(raw_storage_format),
        "tableTypeRaw": raw_table_type,
        "managementType": management_type(raw_table_type),
        "size": "—",
        "files": "—",
        "domain": normalize_str(row.get("domain")) or "Unassigned",
        "tier": normalize_str(row.get("tier")) or "Unassigned",
        "certification": normalize_str(row.get("certification")) or "Unassigned",
        "sensitivity": normalize_str(row.get("sensitivity")) or "Unassigned",
        "criticality": normalize_str(row.get("criticality")) or "Unassigned",
        "openRequests": safe_int(row.get("pending_requests")),
        "owners": owner_entries(row),
        "tags": raw_tags,
        "tagLabels": tag_labels,
        "relatedAssets": [],
        "preview": [],
        "columns": [],
        "governanceStatus": normalize_str(row.get("governance_status")) or "Needs Work",
        "omTableFqn": normalize_str(row.get("om_table_fqn")),
    }


def exact_identity_row(
    uc,
    asset_fqn: str,
    inventory_columns: Optional[Sequence[str]] = None,
) -> Optional[pd.Series]:
    catalog, schema, table = split_uc_name(asset_fqn)
    try:
        identity_df = uc.get_table_identity(catalog, schema, table)
    except Exception:
        return None
    if identity_df is None or identity_df.empty:
        return None

    columns = list(inventory_columns) if inventory_columns is not None else []
    base: Dict[str, Any] = {column: "" for column in columns}
    identity = identity_df.iloc[0].to_dict()
    base.update(
        {
            "fqn": asset_fqn,
            "table_catalog": normalize_str(identity.get("table_catalog")) or catalog,
            "table_schema": normalize_str(identity.get("table_schema")) or schema,
            "table_name": normalize_str(identity.get("table_name")) or table,
            "table_type": normalize_str(identity.get("table_type")),
            "data_source_format": normalize_str(identity.get("data_source_format")),
            "comment": normalize_str(identity.get("comment")),
        }
    )

    try:
        tags_df = uc.get_table_tags(catalog, schema, table)
    except Exception:
        tags_df = pd.DataFrame()

    tags = {
        normalize_str(row.get("tag_name")): normalize_str(row.get("tag_value"))
        for _, row in tags_df.iterrows()
        if normalize_str(row.get("tag_name"))
    }
    base["tags"] = tags
    base["domain"] = tag_value(tags, "domain")
    base["tier"] = tag_value(tags, "tier")
    base["certification"] = tag_value(tags, "certification")
    base["sensitivity"] = tag_value(tags, "sensitivity")
    base["criticality"] = tag_value(tags, "criticality")
    base["glossary_term"] = tag_value(tags, "glossary_term")
    base["data_product"] = tag_value(tags, "data_product")
    base.setdefault("governance_status", "Needs Work")
    return pd.Series(base)


def merge_identity_row(base_row: pd.Series, exact_row: Optional[pd.Series]) -> pd.Series:
    if exact_row is None:
        return base_row

    merged = base_row.copy()
    for key in [
        "fqn",
        "table_catalog",
        "table_schema",
        "table_name",
        "table_type",
        "data_source_format",
        "comment",
    ]:
        value = normalize_str(exact_row.get(key))
        if value:
            merged[key] = value

    base_tags = merged.get("tags") if isinstance(merged.get("tags"), dict) else {}
    exact_tags = exact_row.get("tags") if isinstance(exact_row.get("tags"), dict) else {}
    if exact_tags:
        merged["tags"] = {**base_tags, **exact_tags}

    for key in [
        "domain",
        "tier",
        "certification",
        "sensitivity",
        "criticality",
        "glossary_term",
        "data_product",
    ]:
        if not normalize_str(merged.get(key)) and normalize_str(exact_row.get(key)):
            merged[key] = exact_row.get(key)

    return merged


def discovery_result_haystack(asset: Dict[str, Any]) -> str:
    raw_tags = asset.get("tags")
    if isinstance(raw_tags, dict):
        tag_terms = []
        for key, value in raw_tags.items():
            normalized_key = normalize_str(key)
            normalized_value = normalize_str(value)
            if normalized_key:
                tag_terms.append(normalized_key)
            if normalized_value:
                tag_terms.extend([normalized_value, f"{normalized_key} {normalized_value}".strip()])
    else:
        tag_terms = [normalize_str(tag) for tag in asset.get("tags", []) if normalize_str(tag)]
    return normalized_search_text(
        asset.get("fqn"),
        asset.get("name"),
        asset.get("description"),
        asset.get("catalog"),
        asset.get("schema"),
        asset.get("domain"),
        asset.get("tier"),
        asset.get("certification"),
        asset.get("sensitivity"),
        asset.get("objectType"),
        " ".join(tag_terms),
        " ".join(
            normalize_str(owner.get("name"))
            for owner in asset.get("owners", [])
            if isinstance(owner, dict) and normalize_str(owner.get("name"))
        ),
    )


def normalized_search_text(*values: Any) -> str:
    raw = " ".join(normalize_str(value) for value in values if normalize_str(value))
    if not raw:
        return ""
    normalized = re.sub(r"[^0-9a-z]+", " ", raw.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def discovery_match_score(asset: Dict[str, Any], query: str, *, haystack: str = "") -> int:
    q = normalized_search_text(query)
    if not q:
        return 0
    terms = [term for term in q.split(" ") if term]
    haystack = haystack or discovery_result_haystack(asset)
    if not all(term in haystack for term in terms):
        return 0

    name = normalized_search_text(asset.get("name"))
    schema = normalized_search_text(asset.get("schema"))
    catalog = normalized_search_text(asset.get("catalog"))
    description = normalized_search_text(asset.get("description"))
    fqn = normalized_search_text(asset.get("fqn"))

    score = 0
    if q in name:
        score += 7
    elif all(term in name for term in terms):
        score += 5
    if q in fqn:
        score += 4
    elif all(term in fqn for term in terms):
        score += 3
    if q in schema or all(term in schema for term in terms):
        score += 2
    if q in catalog or all(term in catalog for term in terms):
        score += 2
    if q in description or all(term in description for term in terms):
        score += 2
    score += len(terms)
    return score


def view_matches(asset: Dict[str, Any], view: str) -> bool:
    normalized = normalize_str(view)
    if not normalized or normalized == "All assets":
        return True
    if normalized == "Needs attention":
        return (
            normalize_str(asset.get("governanceStatus")) == "Needs Work"
            or safe_int(asset.get("openRequests")) > 0
        )
    if normalized == "Needs owner":
        return len(asset.get("owners", [])) == 0
    if normalized == "Needs certification":
        return normalize_str(asset.get("certification")) == "Unassigned"
    if normalized == "Certified":
        return normalize_str(asset.get("certification")) != "Unassigned"
    if normalized == "High coverage":
        return safe_int(asset.get("coverageScore")) >= 75
    return True


def views_match(asset: Dict[str, Any], views: Sequence[str]) -> bool:
    normalized = [normalize_str(view) for view in views if normalize_str(view) and normalize_str(view) != "All assets"]
    if not normalized:
        return True
    return all(view_matches(asset, view) for view in normalized)


def normalize_filter_values(values: Optional[List[str]], all_label: str) -> List[str]:
    if not values:
        return []
    return [
        normalize_str(value)
        for value in values
        if normalize_str(value) and normalize_str(value) != all_label
    ]


def facet_payload(assets: List[Dict[str, Any]], field: str, *, all_label: str) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {}
    for asset in assets:
        value = normalize_str(asset.get(field))
        if not value or value == "Unassigned":
            continue
        counts[value] = counts.get(value, 0) + 1
    items = [{"value": all_label, "count": len(assets)}]
    items.extend({"value": value, "count": counts[value]} for value in sorted(counts))
    return items


def view_facet_payload(
    assets: List[Dict[str, Any]],
    *,
    all_label: str,
    views: Sequence[str],
) -> List[Dict[str, Any]]:
    items = [{"value": all_label, "count": len(assets)}]
    for view in views:
        normalized = normalize_str(view)
        if not normalized or normalized == all_label:
            continue
        items.append(
            {
                "value": view,
                "count": sum(1 for asset in assets if view_matches(asset, view)),
            }
        )
    return items


def sort_discovery_assets(
    assets: List[Dict[str, Any]],
    *,
    sort_by: str,
    query: str,
) -> List[Dict[str, Any]]:
    normalized_sort = normalize_str(sort_by)

    def _best_match_key(asset: Dict[str, Any]) -> Tuple[int, int, int, str]:
        return (
            discovery_match_score(asset, query),
            safe_int(asset.get("coverageScore")),
            safe_int(asset.get("openRequests")),
            normalize_str(asset.get("fqn")),
        )

    if normalized_sort == "Coverage score":
        return sorted(
            assets,
            key=lambda asset: (
                safe_int(asset.get("coverageScore")),
                safe_int(asset.get("openRequests")),
                normalize_str(asset.get("fqn")),
            ),
            reverse=True,
        )
    if normalized_sort == "Open requests":
        return sorted(
            assets,
            key=lambda asset: (
                safe_int(asset.get("openRequests")),
                safe_int(asset.get("coverageScore")),
                normalize_str(asset.get("fqn")),
            ),
            reverse=True,
        )
    if normalized_sort == "Name (A-Z)":
        return sorted(assets, key=lambda asset: normalize_str(asset.get("name")).lower())
    return sorted(assets, key=_best_match_key, reverse=True)


def _discovery_index_key(uc: Any) -> str:
    return f"discovery_index:{_warehouse_key(uc)}"


def _discovery_index(
    inventory_or_uc,
    store=None,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> List[Dict[str, Any]]:
    inventory = _resolve_inventory_df(
        inventory_or_uc,
        store,
        hidden_catalogs=hidden_catalogs,
    )
    entries: List[Dict[str, Any]] = []
    for _, row in inventory.iterrows():
        asset = base_asset_payload(row)
        entries.append({"asset": asset, "haystack": discovery_result_haystack(asset)})
    return entries


def cached_discovery_index(
    inventory_or_uc,
    store=None,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> List[Dict[str, Any]]:
    if isinstance(inventory_or_uc, pd.DataFrame):
        return _discovery_index(inventory_or_uc, store, hidden_catalogs=hidden_catalogs)
    return _ttl_value(
        _discovery_index_key(inventory_or_uc),
        300,
        lambda: _discovery_index(
            inventory_or_uc,
            store,
            hidden_catalogs=hidden_catalogs,
        ),
    )


def discovery_search_payload(
    inventory_or_uc,
    store=None,
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
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> Dict[str, Any]:
    index_entries = cached_discovery_index(
        inventory_or_uc,
        store,
        hidden_catalogs=hidden_catalogs,
    )
    query_text = normalize_str(query)
    selected_views = normalize_filter_values(views, "All assets")
    selected_catalogs = normalize_filter_values(catalogs, "All catalogs")
    selected_domains = normalize_filter_values(domains, "All domains")
    selected_tiers = normalize_filter_values(tiers, "All tiers")
    selected_certifications = normalize_filter_values(certifications, "All certifications")
    selected_sensitivities = normalize_filter_values(sensitivities, "All sensitivities")
    selected_types = normalize_filter_values(asset_types, "All types")

    matched_assets: List[Dict[str, Any]] = []
    for entry in index_entries:
        asset = entry["asset"]
        if query_text and discovery_match_score(asset, query_text, haystack=entry.get("haystack", "")) <= 0:
            continue
        matched_assets.append(asset)

    def in_scope(asset: Dict[str, Any], *, exclude: Optional[set[str]] = None) -> bool:
        excluded = exclude or set()
        if selected_views and "views" not in excluded and not views_match(asset, selected_views):
            return False
        if selected_types and asset.get("objectType") not in selected_types:
            if "types" not in excluded:
                return False
        if selected_catalogs and asset.get("catalog") not in selected_catalogs:
            if "catalogs" not in excluded:
                return False
        if selected_domains and asset.get("domain") not in selected_domains:
            if "domains" not in excluded:
                return False
        if selected_tiers and asset.get("tier") not in selected_tiers:
            if "tiers" not in excluded:
                return False
        if selected_certifications and asset.get("certification") not in selected_certifications:
            if "certifications" not in excluded:
                return False
        if selected_sensitivities and asset.get("sensitivity") not in selected_sensitivities:
            if "sensitivities" not in excluded:
                return False
        return True

    scoped_assets: List[Dict[str, Any]] = []
    for asset in matched_assets:
        if not in_scope(asset):
            continue
        scoped_assets.append(asset)

    sorted_assets = sort_discovery_assets(scoped_assets, sort_by=sort_by, query=query_text)
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    window = sorted_assets[safe_offset : safe_offset + safe_limit]

    facets = {
        "views": view_facet_payload(
            [asset for asset in matched_assets if in_scope(asset, exclude={"views"})],
            all_label="All assets",
            views=["All assets", "Needs attention", "Needs owner", "Needs certification", "Certified", "High coverage"],
        ),
        "assetTypes": facet_payload(
            [asset for asset in matched_assets if in_scope(asset, exclude={"types"})],
            "objectType",
            all_label="All types",
        ),
        "catalogs": facet_payload(
            [asset for asset in matched_assets if in_scope(asset, exclude={"catalogs"})],
            "catalog",
            all_label="All catalogs",
        ),
        "domains": facet_payload(
            [asset for asset in matched_assets if in_scope(asset, exclude={"domains"})],
            "domain",
            all_label="All domains",
        ),
        "tiers": facet_payload(
            [asset for asset in matched_assets if in_scope(asset, exclude={"tiers"})],
            "tier",
            all_label="All tiers",
        ),
        "certifications": facet_payload(
            [asset for asset in matched_assets if in_scope(asset, exclude={"certifications"})],
            "certification",
            all_label="All certifications",
        ),
        "sensitivities": facet_payload(
            [asset for asset in matched_assets if in_scope(asset, exclude={"sensitivities"})],
            "sensitivity",
            all_label="All sensitivities",
        ),
    }

    return {
        "assets": window,
        "count": len(sorted_assets),
        "facets": facets,
        "selection": {
            "primaryAssetFqn": window[0]["fqn"] if window else "",
            "reason": "top_result" if window else "none",
        },
    }


def related_assets(
    uc,
    catalog: str,
    schema: str,
    table: str,
    focus_fqn: str,
    inventory_df: Optional[pd.DataFrame] = None,
) -> List[str]:
    try:
        upstream = filter_asset_rows(
            cached_lineage_up(uc, catalog, schema, table),
            ["source_table_name", "source_table_full_name"],
            exclude_fqn=focus_fqn,
        )
    except Exception:
        upstream = pd.DataFrame()
    try:
        downstream = filter_asset_rows(
            cached_lineage_down(uc, catalog, schema, table),
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
    normalized = [normalize_str(item) for item in values if normalize_str(item)]
    deduped = list(dict.fromkeys(item for item in normalized if item != focus_fqn))
    openable: List[str] = []
    for item in deduped:
        if inventory_df is not None and asset_is_visible(inventory_df, item):
            openable.append(item)
    return openable[:8]


def preview_records(sample_df: pd.DataFrame) -> List[Dict[str, str]]:
    if sample_df is None or sample_df.empty:
        return []
    view = sample_df.head(8).copy()
    limited_cols = list(view.columns[:8])
    view = view[limited_cols]
    rows: List[Dict[str, str]] = []
    for _, row in view.iterrows():
        rows.append({str(col): normalize_str(row.get(col)) for col in limited_cols})
    return rows


def table_property_records(properties_df: pd.DataFrame) -> List[Dict[str, str]]:
    if properties_df is None or properties_df.empty:
        return []
    rows: List[Dict[str, str]] = []
    for _, row in properties_df.iterrows():
        key = normalize_str(row.get("key"))
        value = normalize_str(row.get("value"))
        if not key:
            continue
        rows.append({"key": key, "value": value or "—"})
    return rows


def infer_storage_format_from_properties(properties_df: pd.DataFrame) -> str:
    if properties_df is None or properties_df.empty:
        return ""
    keys = {
        normalize_str(row.get("key")).lower()
        for _, row in properties_df.iterrows()
        if normalize_str(row.get("key"))
    }
    if any(key.startswith("delta.") for key in keys):
        return "Delta"
    if any(key.startswith("iceberg.") for key in keys):
        return "Iceberg"
    return ""


def constraint_records(constraints_df: pd.DataFrame) -> List[Dict[str, Any]]:
    if constraints_df is None or constraints_df.empty:
        return []
    grouped: Dict[str, Dict[str, Any]] = {}
    for _, row in constraints_df.iterrows():
        name = normalize_str(row.get("constraint_name")) or "constraint"
        current = grouped.setdefault(
            name,
            {
                "name": name,
                "type": normalize_str(row.get("constraint_type")) or "Constraint",
                "columns": [],
                "matchOption": normalize_str(row.get("match_option")),
                "updateRule": normalize_str(row.get("update_rule")),
                "deleteRule": normalize_str(row.get("delete_rule")),
            },
        )
        column_name = normalize_str(row.get("column_name"))
        if column_name and column_name not in current["columns"]:
            current["columns"].append(column_name)
    return list(grouped.values())


def column_tag_lookup(column_tags_df: pd.DataFrame) -> Dict[str, List[Dict[str, str]]]:
    if column_tags_df is None or column_tags_df.empty:
        return {}
    lookup: Dict[str, List[Dict[str, str]]] = {}
    for _, row in column_tags_df.iterrows():
        column_name = normalize_str(row.get("column_name"))
        tag_name = normalize_str(row.get("tag_name"))
        tag_value = normalize_str(row.get("tag_value"))
        if not column_name or not tag_name:
            continue
        lookup.setdefault(column_name, []).append({"name": tag_name, "value": tag_value})
    return lookup


def column_records(
    columns_df: pd.DataFrame,
    column_tags_df: Optional[pd.DataFrame] = None,
) -> List[Dict[str, Any]]:
    if columns_df is None or columns_df.empty:
        return []
    tag_lookup = column_tag_lookup(column_tags_df)
    rows: List[Dict[str, Any]] = []
    for _, row in columns_df.head(50).iterrows():
        column_name = normalize_str(row.get("column_name"))
        tags = tag_lookup.get(column_name, [])
        glossary_term = next(
            (
                normalize_str(item.get("value"))
                for item in tags
                if normalize_str(item.get("name")).lower() == "glossary_term"
            ),
            "",
        )
        rows.append(
            {
                "name": column_name,
                "type": normalize_str(row.get("data_type")),
                "description": normalize_str(row.get("comment")) or "No description",
                "tags": tags,
                "tagLabels": [
                    f"{normalize_str(item.get('name'))}: {normalize_str(item.get('value'))}"
                    if normalize_str(item.get("value"))
                    else normalize_str(item.get("name"))
                    for item in tags
                    if normalize_str(item.get("name"))
                ],
                "glossaryTerm": glossary_term,
            }
        )
    return rows


def owner_assignment_records(store: Any, asset_fqn: str) -> List[Dict[str, str]]:
    if store is None or not hasattr(store, "get_owners"):
        return []
    try:
        owners_df = store.get_owners(asset_fqn)
    except Exception:
        return []
    if owners_df is None or owners_df.empty:
        return []
    rows: List[Dict[str, str]] = []
    for _, row in owners_df.iterrows():
        owner_email = normalize_str(row.get("owner_email"))
        owner_type = normalize_str(row.get("owner_type"))
        if not owner_email:
            continue
        rows.append(
            {
                "ownerEmail": owner_email,
                "ownerType": owner_type or "steward",
                "updatedAt": normalize_str(row.get("updated_at")),
                "updatedBy": normalize_str(row.get("updated_by")),
            }
        )
    return rows


def activity_records(store: Any, asset_fqn: str, limit: int = 20) -> List[Dict[str, str]]:
    if store is None or not hasattr(store, "list_change_requests"):
        return []
    try:
        requests_df = store.list_change_requests(limit=200)
    except Exception:
        return []
    if requests_df is None or requests_df.empty:
        return []
    scoped = requests_df[
        requests_df["uc_full_name"].fillna("").astype(str).eq(asset_fqn)
    ].head(limit)
    rows: List[Dict[str, str]] = []
    for _, row in scoped.iterrows():
        note = normalize_str(row.get("review_note"))
        raw_title = normalize_str(row.get("new_comment")) or "Governance request"
        rows.append(
            {
                "id": normalize_str(row.get("request_id")),
                "title": raw_title.split(":")[0] if ":" in raw_title else raw_title,
                "detail": raw_title,
                "status": normalize_str(row.get("status")).title() or "Pending",
                "createdAt": normalize_str(row.get("created_at")),
                "createdBy": normalize_str(row.get("created_by")),
                "reviewNote": note,
                "reviewedAt": normalize_str(row.get("reviewed_at")),
                "reviewedBy": normalize_str(row.get("reviewed_by")),
            }
        )
    return rows


def _operational_entity_label(raw: Any) -> str:
    normalized = normalize_str(raw).upper().replace(" ", "_").replace("-", "_")
    mapping = {
        "JOB": "Job",
        "WORKFLOW": "Workflow",
        "PIPELINE": "Pipeline",
        "DLT_PIPELINE": "DLT Pipeline",
        "LAKEFLOW_PIPELINE": "Lakeflow Pipeline",
        "NOTEBOOK": "Notebook",
        "SQL": "SQL Query",
        "SQL_QUERY": "SQL Query",
        "DBSQL_QUERY": "DBSQL Query",
        "QUERY": "Query",
        "DASHBOARD": "Dashboard",
        "DBSQL_DASHBOARD": "DBSQL Dashboard",
    }
    return mapping.get(normalized, normalize_str(raw).replace("_", " ").title() or "Operational Entity")


def _metadata_name_candidate(raw_metadata: Any) -> str:
    raw_text = normalize_str(raw_metadata)
    if not raw_text:
        return ""
    try:
        parsed = json.loads(raw_text)
    except Exception:
        return ""

    candidate_keys = [
        "display_name",
        "displayName",
        "name",
        "title",
        "job_name",
        "jobName",
        "pipeline_name",
        "pipelineName",
        "query_name",
        "queryName",
        "dashboard_name",
        "dashboardName",
        "dashboard_title",
        "dashboardTitle",
        "notebook_path",
        "notebookPath",
        "path",
    ]
    queue: List[Any] = [parsed]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            for key in candidate_keys:
                candidate = normalize_str(current.get(key))
                if candidate:
                    if "/" in candidate:
                        return candidate.rstrip("/").split("/")[-1] or candidate
                    return candidate
            queue.extend(value for value in current.values() if isinstance(value, (dict, list)))
        elif isinstance(current, list):
            queue.extend(value for value in current if isinstance(value, (dict, list)))
    return ""


def operational_entity_records(
    uc,
    operational_df: pd.DataFrame,
) -> List[Dict[str, Any]]:
    if operational_df is None or operational_df.empty:
        return []
    grouped: Dict[str, Dict[str, Any]] = {}
    for _, row in operational_df.iterrows():
        entity_type = normalize_str(row.get("entity_type"))
        entity_id = normalize_str(row.get("entity_id"))
        statement_id = normalize_str(row.get("statement_id"))
        run_id = normalize_str(row.get("entity_run_id"))
        group_key = entity_type or entity_id or statement_id or str(len(grouped))
        key = f"{group_key}:{entity_id or statement_id or run_id or len(grouped)}"
        current = grouped.get(key)
        if current is None:
            resolved_name = uc.resolve_operational_entity_name(entity_type, entity_id) if entity_type and entity_id else ""
            entity_label = _operational_entity_label(entity_type)
            fallback_identifier = entity_id or statement_id or run_id
            fallback_name = (
                resolved_name
                or normalize_str(row.get("entity_name"))
                or _metadata_name_candidate(row.get("entity_metadata"))
            )
            if not fallback_name and fallback_identifier:
                fallback_name = f"{entity_label} {fallback_identifier[:8]}".strip()
            current = {
                "key": key,
                "entityType": entity_type,
                "entityLabel": entity_label,
                "entityId": entity_id,
                "statementId": statement_id,
                "runId": run_id,
                "name": fallback_name or entity_label or "Unknown entity",
                "metadata": normalize_str(row.get("entity_metadata")),
                "relatedAssets": [],
            }
            grouped[key] = current
        related_asset = normalize_str(row.get("related_table_full_name"))
        if related_asset and related_asset not in current["relatedAssets"]:
            current["relatedAssets"].append(related_asset)
    return sorted(
        grouped.values(),
        key=lambda item: (
            item["entityLabel"],
            item["name"].lower(),
            item["statementId"],
        ),
    )


def query_records(operational_entities: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    query_types = {"SQL", "SQL_QUERY", "DBSQL_QUERY", "QUERY"}
    return [
        entity
        for entity in operational_entities
        if normalize_str(entity.get("entityType")).upper() in query_types
    ]


def profiler_payload(
    asset: Dict[str, Any],
    columns: Sequence[Dict[str, Any]],
    preview: Sequence[Dict[str, Any]],
    related_assets: Sequence[str],
    activity: Sequence[Dict[str, str]],
    operational_context: Dict[str, Sequence[Dict[str, Any]]],
) -> Dict[str, Any]:
    column_count = len(columns)
    described_count = sum(
        1 for column in columns if normalize_str(column.get("description")) not in {"", "No description"}
    )
    classified_count = sum(1 for column in columns if column.get("tags"))
    glossary_count = sum(1 for column in columns if normalize_str(column.get("glossaryTerm")))
    producer_count = len(operational_context.get("producers", []))
    consumer_count = len(operational_context.get("consumers", []))

    def status_for(count: int, total: int) -> str:
        if total <= 0:
            return "missing"
        if count == total:
            return "good"
        if count > 0:
            return "warn"
        return "bad"

    return {
        "cards": [
            {
                "title": "Description Coverage",
                "value": f"{described_count}/{column_count}" if column_count else "No schema",
                "status": status_for(described_count, column_count),
                "note": "Columns with captured descriptions.",
            },
            {
                "title": "Classification Coverage",
                "value": f"{classified_count}/{column_count}" if column_count else "No schema",
                "status": status_for(classified_count, column_count),
                "note": "Columns with at least one governance tag.",
            },
            {
                "title": "Glossary Coverage",
                "value": f"{glossary_count}/{column_count}" if column_count else "No schema",
                "status": status_for(glossary_count, column_count),
                "note": "Columns linked to glossary terms.",
            },
            {
                "title": "Sample Data",
                "value": "Available" if preview else "Missing",
                "status": "good" if preview else "warn",
                "note": "Sample rows surfaced from the live asset.",
            },
            {
                "title": "Lineage Context",
                "value": f"{len(related_assets)} assets",
                "status": "good" if related_assets else "warn",
                "note": "Connected assets surfaced in lineage.",
            },
            {
                "title": "Operational Usage",
                "value": f"{producer_count + consumer_count} workloads",
                "status": "good" if producer_count or consumer_count else "warn",
                "note": "Jobs, queries, pipelines, and dashboards linked through UC lineage.",
            },
            {
                "title": "Open Work",
                "value": str(len(activity)),
                "status": "warn" if activity else "good",
                "note": "Governance tasks or requests currently tied to this asset.",
            },
        ],
        "summary": {
            "columnCount": column_count,
            "describedColumns": described_count,
            "classifiedColumns": classified_count,
            "glossaryLinkedColumns": glossary_count,
            "hasSampleData": bool(preview),
            "openActivityCount": len(activity),
            "producerCount": producer_count,
            "consumerCount": consumer_count,
            "governanceStatus": normalize_str(asset.get("governanceStatus")) or "Needs Work",
        },
    }


def asset_detail_payload(
    uc,
    inventory_or_store,
    asset_fqn: str,
    *,
    cache_scope: str = "",
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
    sections: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    normalized_scope = normalize_str(cache_scope) or "shared"
    requested_sections = normalize_asset_detail_sections(sections)
    section_key = ",".join(requested_sections)
    cache_key = (
        f"asset_detail:{_warehouse_key(uc)}:{normalized_scope}:{normalize_str(asset_fqn)}:{section_key}"
    )

    cached = _TTL_CACHE.get(cache_key)
    if cached:
        age = time.time() - cached[0]
        payload = cached[1]
        ttl_s = 300 if asset_payload_has_live_signals(payload) else 20
        if age < ttl_s:
            return payload

    def load() -> Dict[str, Any]:
        store = None if isinstance(inventory_or_store, pd.DataFrame) else inventory_or_store
        inventory = _resolve_inventory_df(
            inventory_or_store if isinstance(inventory_or_store, pd.DataFrame) else uc,
            store,
            hidden_catalogs=hidden_catalogs,
        )
        if isinstance(inventory_or_store, pd.DataFrame):
            row = inventory_row(inventory, asset_fqn)
            inventory_columns = list(inventory.columns) if isinstance(inventory, pd.DataFrame) else None
        else:
            row = inventory_row(uc, inventory_or_store, asset_fqn, hidden_catalogs=hidden_catalogs)
            inventory_columns = list(inventory.columns) if isinstance(inventory, pd.DataFrame) else None
            row = merge_identity_row(
                row,
                exact_identity_row(
                    uc,
                    asset_fqn,
                    inventory_columns,
                ),
            )
        base = base_asset_payload(row)
        catalog, schema, table = split_uc_name(base["fqn"])
        detail_df = pd.DataFrame()
        detail = {}
        columns_df = pd.DataFrame()
        sample_df = pd.DataFrame()
        properties_df = pd.DataFrame()
        constraints_df = pd.DataFrame()
        column_tags_df = pd.DataFrame()
        operational_upstream_df = pd.DataFrame()
        operational_downstream_df = pd.DataFrame()
        loaded_sections = set(requested_sections)

        base["columnCount"] = 0
        base["ownerAssignments"] = []
        base["activity"] = []
        base["tableProperties"] = []
        base["constraints"] = []
        base["customProperties"] = []
        base["operationalContext"] = {"producers": [], "consumers": []}
        base["queries"] = []
        base["usage"] = {"queryCount": 0, "producerCount": 0, "consumerCount": 0}
        base["profiler"] = {"cards": [], "summary": {}}

        if "header" in loaded_sections:
            try:
                detail_df = cached_table_detail(uc, catalog, schema, table)
            except Exception:
                detail_df = pd.DataFrame()
            if detail_df.empty:
                try:
                    detail_df = uc.get_table_detail(catalog, schema, table)
                except Exception:
                    detail_df = pd.DataFrame()
            detail = detail_map(detail_df)

            if normalize_str(base["description"]) == PLACEHOLDER_DESCRIPTION:
                try:
                    base["description"] = cached_comment(uc, catalog, schema, table)
                except Exception:
                    base["description"] = ""
                if not normalize_str(base["description"]):
                    try:
                        base["description"] = uc.get_table_comment(catalog, schema, table)
                    except Exception:
                        base["description"] = ""
                if not normalize_str(base["description"]):
                    base["description"] = PLACEHOLDER_DESCRIPTION

            try:
                row_count = coalesce(detail.get("numrows"), cached_table_row_count(uc, catalog, schema, table))
            except Exception:
                row_count = coalesce(detail.get("numrows"))
            base["rows"] = f"{safe_int(row_count):,}" if safe_int(row_count) else "—"
            raw_detail_type = _prefer_specific_table_type(
                detail.get("type"),
                base.get("tableTypeRaw"),
            )
            raw_detail_format = coalesce(detail.get("format"), base.get("storageFormat"))
            base["tableTypeRaw"] = raw_detail_type or base.get("tableTypeRaw", "")
            base["objectType"] = coalesce(
                friendly_table_type(raw_detail_type, raw_detail_format),
                base["objectType"],
            )
            base["managementType"] = management_type(base.get("tableTypeRaw"))
            base["storageFormat"] = coalesce(
                friendly_storage_format(raw_detail_format),
                base.get("storageFormat"),
            )
            if base["storageFormat"] == "—":
                try:
                    properties_for_identity_df = uc.get_table_properties(catalog, schema, table)
                except Exception:
                    properties_for_identity_df = pd.DataFrame()
                inferred_storage_format = infer_storage_format_from_properties(properties_for_identity_df)
                if inferred_storage_format:
                    base["storageFormat"] = inferred_storage_format
            base["format"] = base["storageFormat"] or "—"
            base["size"] = human_bytes(detail.get("sizeinbytes"))
            base["files"] = str(safe_int(detail.get("numfiles"))) if safe_int(detail.get("numfiles")) else "—"
            metadata_write_supported = supports_direct_metadata_write(base.get("tableTypeRaw"))
            base["metadataEditor"] = {
                "available": metadata_write_supported,
                "updatePath": "/api/assets/:fqn/metadata",
                "updateMethod": "PATCH",
                "message": (
                    ""
                    if metadata_write_supported
                    else "Direct metadata edits are unavailable for this relation type or the current workspace permissions."
                ),
                "fields": [
                    {
                        "key": "description",
                        "label": "Description",
                        "type": "textarea",
                        "placeholder": "Add a description for this asset",
                    },
                    {"key": "domain", "label": "Domain", "type": "text"},
                    {"key": "tier", "label": "Tier", "type": "text"},
                    {"key": "certification", "label": "Certification", "type": "text"},
                    {"key": "sensitivity", "label": "Sensitivity", "type": "text"},
                    {"key": "criticality", "label": "Criticality", "type": "text"},
                    {"key": "glossaryTerm", "label": "Glossary Term", "type": "text"},
                    {"key": "dataProduct", "label": "Data Product", "type": "text"},
                    {
                        "key": "freeformTags",
                        "label": "Freeform Tags",
                        "type": "text",
                        "placeholder": "owner_team=FinOps, product_area=ERP",
                        "helpText": "Comma-separated key=value pairs for non-structured Unity Catalog tags.",
                    },
                ],
            }

        if "activity" in loaded_sections:
            base["ownerAssignments"] = owner_assignment_records(store, base["fqn"])
            base["activity"] = activity_records(store, base["fqn"])

        if "schema" in loaded_sections:
            try:
                columns_df = cached_columns(uc, catalog, schema, table)
            except Exception:
                columns_df = pd.DataFrame()
            if columns_df.empty:
                try:
                    columns_df = uc.get_table_columns(catalog, schema, table)
                except Exception:
                    columns_df = pd.DataFrame()
            try:
                column_tags_df = uc.get_table_column_tags(catalog, schema, table)
            except Exception:
                column_tags_df = pd.DataFrame()
            base["columns"] = column_records(columns_df, column_tags_df)
            base["columnCount"] = len(base["columns"])

        if "preview" in loaded_sections:
            try:
                sample_df = cached_sample_rows(uc, catalog, schema, table)
            except Exception:
                sample_df = pd.DataFrame()
            if sample_df.empty:
                try:
                    sample_df = uc.get_table_sample(catalog, schema, table, limit=15)
                except Exception:
                    sample_df = pd.DataFrame()
            base["preview"] = preview_records(sample_df)

        if "properties" in loaded_sections:
            try:
                properties_df = uc.get_table_properties(catalog, schema, table)
            except Exception:
                properties_df = pd.DataFrame()
            try:
                constraints_df = uc.get_table_constraints(catalog, schema, table)
            except Exception:
                constraints_df = pd.DataFrame()
            base["tableProperties"] = table_property_records(properties_df)
            base["constraints"] = constraint_records(constraints_df)
            base["customProperties"] = list(base["tableProperties"])

        if "operational" in loaded_sections:
            try:
                operational_upstream_df = uc.get_operational_context_upstream(catalog, schema, table)
            except Exception:
                operational_upstream_df = pd.DataFrame()
            try:
                operational_downstream_df = uc.get_operational_context_downstream(catalog, schema, table)
            except Exception:
                operational_downstream_df = pd.DataFrame()
            base["relatedAssets"] = related_assets(
                uc,
                catalog,
                schema,
                table,
                base["fqn"],
                inventory_df=inventory,
            )
            base["operationalContext"] = {
                "producers": operational_entity_records(uc, operational_upstream_df),
                "consumers": operational_entity_records(uc, operational_downstream_df),
            }
            base["queries"] = query_records(
                [*base["operationalContext"]["producers"], *base["operationalContext"]["consumers"]]
            )
            base["usage"] = {
                "queryCount": len(base["queries"]),
                "producerCount": len(base["operationalContext"]["producers"]),
                "consumerCount": len(base["operationalContext"]["consumers"]),
            }

        if "profiler" in loaded_sections:
            base["profiler"] = profiler_payload(
                base,
                base["columns"],
                base["preview"],
                base["relatedAssets"],
                base["activity"],
                base["operationalContext"],
            )

        base["loadedSections"] = list(requested_sections)
        base["deferredSections"] = [
            section for section in ASSET_DETAIL_SECTIONS if section not in loaded_sections
        ]
        return base

    payload = load()
    _TTL_CACHE[cache_key] = (time.time(), payload)
    return payload


def asset_payload_has_live_signals(payload: Dict[str, Any]) -> bool:
    if not payload:
        return False
    description = normalize_str(payload.get("description"))
    if description and description not in {"—", PLACEHOLDER_DESCRIPTION}:
        return True
    if payload.get("rows") not in {"", None, "—"}:
        return True
    if payload.get("size") not in {"", None, "—"}:
        return True
    if payload.get("files") not in {"", None, "—"}:
        return True
    if payload.get("columns") or payload.get("preview"):
        return True
    return False


def asset_payload_has_structured_detail(payload: Dict[str, Any]) -> bool:
    if not payload:
        return False
    return bool(payload.get("columns") or payload.get("preview"))
