from __future__ import annotations

import time
from functools import lru_cache
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import pandas as pd

from govhub.uc import UCSQLClient

HIDDEN_CATALOGS = {"hive_metastore", "samples", "system", "__databricks_internal"}
PLACEHOLDER_DESCRIPTION = "No description has been captured for this asset yet."
_EXCLUDED_ASSET_MARKERS = ("__materialization_mat_", "temp_metric_view_")
_STANDARD_TAG_ALIASES = {
    "domain": ("domain", "data_domain"),
    "tier": ("tier", "data_tier"),
    "certification": ("certification", "certified", "data_certification"),
    "sensitivity": ("sensitivity", "classification", "data_classification"),
    "criticality": ("criticality", "priority"),
    "glossary_term": ("glossary_term", "glossary"),
    "data_product": ("data_product", "product"),
}

_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}


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


def invalidate_live_metadata_caches(asset_fqn: str | None = None) -> None:
    _TTL_CACHE.clear()


def normalize_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def split_uc_name(name: str) -> Tuple[str, str, str]:
    parts = [part.strip() for part in normalize_str(name).split(".") if part.strip()]
    if len(parts) != 3:
        raise ValueError("Expected catalog.schema.table")
    return parts[0], parts[1], parts[2]


def _is_excluded_asset_name(value: Any) -> bool:
    lowered = normalize_str(value).lower()
    return any(marker in lowered for marker in _EXCLUDED_ASSET_MARKERS)


def filter_asset_rows(
    df: pd.DataFrame,
    columns: List[str],
    *,
    exclude_fqn: str = "",
) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=df.columns if df is not None else [])

    view = df.copy()
    keep_mask = pd.Series(True, index=view.index)
    excluded = normalize_str(exclude_fqn).lower()

    for column in columns:
        if column not in view.columns:
            continue
        values = view[column].map(normalize_str).str.lower()
        keep_mask &= ~values.map(_is_excluded_asset_name)
        if excluded:
            keep_mask &= values != excluded

    return view.loc[keep_mask].reset_index(drop=True)


def catalog_filter_options(
    inventory: pd.DataFrame,
    *,
    available_catalogs: Optional[List[str]] = None,
    observed_catalogs: Optional[List[str]] = None,
) -> List[str]:
    values: set[str] = set()
    if inventory is not None and not inventory.empty:
        if "table_catalog" in inventory.columns:
            values.update(
                normalize_str(value)
                for value in inventory["table_catalog"].dropna().astype(str).tolist()
                if normalize_str(value)
            )
        if "fqn" in inventory.columns:
            for raw in inventory["fqn"].dropna().astype(str).tolist():
                try:
                    catalog, _, _ = split_uc_name(normalize_str(raw))
                except ValueError:
                    continue
                if catalog:
                    values.add(catalog)
    if available_catalogs:
        values.update(
            normalize_str(catalog)
            for catalog in available_catalogs
            if normalize_str(catalog)
        )
    if observed_catalogs:
        values.update(
            normalize_str(catalog)
            for catalog in observed_catalogs
            if normalize_str(catalog)
        )
    return sorted(values)


def lineage_asset_stub(inventory: pd.DataFrame, asset_fqn: str) -> pd.Series:
    if inventory is not None and not inventory.empty:
        match = inventory[inventory["fqn"] == asset_fqn]
        if not match.empty:
            return match.iloc[0]
    try:
        catalog, schema, table = split_uc_name(asset_fqn)
    except ValueError:
        catalog, schema, table = "", "", asset_fqn
    base: Dict[str, Any] = {}
    if inventory is not None and not inventory.empty:
        base = {column: "" for column in inventory.columns}
    base.update(
        {
            "fqn": asset_fqn,
            "table_catalog": catalog,
            "table_schema": schema,
            "table_name": table,
            "table_type": "",
            "comment": "",
            "governance_score": 0,
            "pending_requests": 0,
            "owner_count": 0,
            "governance_status": "Needs Work",
            "tags": {},
            "domain": "",
            "tier": "",
            "certification": "",
            "sensitivity": "",
            "criticality": "",
            "steward": "",
        }
    )
    return pd.Series(base)


def tag_value(tags: Dict[str, str], key: str) -> str:
    for alias in _STANDARD_TAG_ALIASES.get(key, (key,)):
        value = normalize_str(tags.get(alias))
        if value:
            return value
    if key == "sensitivity":
        pii_value = normalize_str(tags.get("contains_pii") or tags.get("pii"))
        if pii_value.lower() in {"1", "true", "yes", "pii", "sensitive"}:
            return "Sensitive"
    return ""


def empty_inventory() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "table_catalog",
            "table_schema",
            "table_name",
            "table_type",
            "comment",
            "fqn",
            "tags",
            "domain",
            "tier",
            "certification",
            "sensitivity",
            "criticality",
            "glossary_term",
            "data_product",
            "owner_count",
            "owners_summary",
            "business_owner",
            "technical_owner",
            "steward",
            "pending_requests",
            "approved_requests",
            "rejected_requests",
            "total_requests",
            "om_table_fqn",
            "governance_score",
            "governance_status",
            "search_text",
        ]
    )


@lru_cache(maxsize=1)
def _hidden_catalog_set() -> set[str]:
    return {value.lower() for value in HIDDEN_CATALOGS}


def cached_catalogs(uc: UCSQLClient) -> List[str]:
    def _load() -> List[str]:
        values: set[str] = set()
        for loader in (uc.list_catalogs, getattr(uc, "list_lineage_catalogs", None)):
            if loader is None:
                continue
            try:
                df = loader()
            except Exception:
                continue
            if df is None or df.empty:
                continue
            values.update(
                normalize_str(value)
                for value in df.iloc[:, 0].tolist()
                if normalize_str(value)
            )
        hidden = _hidden_catalog_set()
        return sorted(value for value in values if value and value.lower() not in hidden)

    return _ttl_value(f"catalogs:{_warehouse_key(uc)}", 600, _load)


def cached_catalog_inventory(uc: UCSQLClient, catalog: str) -> pd.DataFrame:
    return _ttl_value(
        f"catalog_inventory:{_warehouse_key(uc)}:{normalize_str(catalog)}",
        600,
        lambda: uc.get_catalog_table_inventory(catalog),
    )


def cached_catalog_table_tags(uc: UCSQLClient, catalog: str) -> pd.DataFrame:
    return _ttl_value(
        f"catalog_table_tags:{_warehouse_key(uc)}:{normalize_str(catalog)}",
        600,
        lambda: uc.get_catalog_table_tags(catalog),
    )


def cached_columns(uc: UCSQLClient, catalog: str, schema: str, table: str) -> pd.DataFrame:
    return _ttl_value(
        f"columns:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_columns(catalog, schema, table),
    )


def cached_comment(uc: UCSQLClient, catalog: str, schema: str, table: str) -> str:
    return _ttl_value(
        f"comment:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_comment(catalog, schema, table),
    )


def cached_table_detail(uc: UCSQLClient, catalog: str, schema: str, table: str) -> pd.DataFrame:
    return _ttl_value(
        f"table_detail:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_detail(catalog, schema, table),
    )


def cached_table_row_count(uc: UCSQLClient, catalog: str, schema: str, table: str) -> Any:
    return _ttl_value(
        f"row_count:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_row_count(catalog, schema, table),
    )


def cached_table_properties(uc: UCSQLClient, catalog: str, schema: str, table: str) -> pd.DataFrame:
    return _ttl_value(
        f"table_properties:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_properties(catalog, schema, table),
    )


def cached_table_constraints(uc: UCSQLClient, catalog: str, schema: str, table: str) -> pd.DataFrame:
    return _ttl_value(
        f"table_constraints:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_constraints(catalog, schema, table),
    )


def cached_sample_rows(uc: UCSQLClient, catalog: str, schema: str, table: str) -> pd.DataFrame:
    return _ttl_value(
        f"sample_rows:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_sample(catalog, schema, table, limit=15),
    )


def cached_lineage_up(uc: UCSQLClient, catalog: str, schema: str, table: str) -> pd.DataFrame:
    return _ttl_value(
        f"lineage_up:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_lineage_upstream(catalog, schema, table),
    )


def cached_lineage_down(uc: UCSQLClient, catalog: str, schema: str, table: str) -> pd.DataFrame:
    return _ttl_value(
        f"lineage_down:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_table_lineage_downstream(catalog, schema, table),
    )


def cached_operational_context_up(
    uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _ttl_value(
        f"operational_up:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_operational_context_upstream(catalog, schema, table),
    )


def cached_operational_context_down(
    uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _ttl_value(
        f"operational_down:{_warehouse_key(uc)}:{normalize_str(catalog)}:{normalize_str(schema)}:{normalize_str(table)}",
        600,
        lambda: uc.get_operational_context_downstream(catalog, schema, table),
    )


def cached_operational_entity_name(uc: UCSQLClient, entity_type: str, entity_id: str) -> str:
    return _ttl_value(
        f"operational_entity_name:{_warehouse_key(uc)}:{normalize_str(entity_type)}:{normalize_str(entity_id)}",
        600,
        lambda: uc.resolve_operational_entity_name(entity_type, entity_id),
    )


def enrich_operational_context_names(uc: UCSQLClient, df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty or "entity_type" not in df.columns:
        return df
    view = df.copy()
    lookup: Dict[Tuple[str, str], str] = {}
    for row in view.itertuples(index=False):
        entity_type = normalize_str(getattr(row, "entity_type", ""))
        entity_id = normalize_str(getattr(row, "entity_id", ""))
        if not entity_type or not entity_id:
            continue
        key = (entity_type, entity_id)
        if key not in lookup:
            lookup[key] = cached_operational_entity_name(uc, entity_type, entity_id)
    resolved_names: List[str] = []
    for row in view.itertuples(index=False):
        entity_type = normalize_str(getattr(row, "entity_type", ""))
        entity_id = normalize_str(getattr(row, "entity_id", ""))
        resolved_names.append(lookup.get((entity_type, entity_id), ""))
    view["resolved_entity_name"] = resolved_names
    return view


def _inventory_rows_to_frames(uc: UCSQLClient, store: Any) -> pd.DataFrame:
    catalogs = cached_catalogs(uc)
    inventory_frames: List[pd.DataFrame] = []
    tag_maps: Dict[str, Dict[str, str]] = {}

    for catalog in catalogs:
        inv = cached_catalog_inventory(uc, catalog)
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

        tags_df = cached_catalog_table_tags(uc, catalog)
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
        return empty_inventory()

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


def cached_asset_inventory(_uc: UCSQLClient, _store: Any) -> pd.DataFrame:
    return _ttl_value(
        f"asset_inventory:{_warehouse_key(_uc)}",
        600,
        lambda: _inventory_rows_to_frames(_uc, _store),
    )
