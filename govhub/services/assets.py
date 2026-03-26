from __future__ import annotations

import math
import re
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import pandas as pd

import app as legacy_streamlit
from govhub.uc import _is_skippable_metadata_error


HIDDEN_CATALOGS = {"hive_metastore", "samples", "system", "__databricks_internal"}

_TTL_CACHE: Dict[str, Tuple[float, Any]] = {}


def _raw(fn):
    return getattr(fn, "__wrapped__", fn)


cached_asset_inventory = _raw(legacy_streamlit._cached_asset_inventory)
cached_catalog_inventory = _raw(legacy_streamlit._cached_catalog_inventory)
cached_catalog_table_tags = _raw(legacy_streamlit._cached_catalog_table_tags)
cached_catalogs = _raw(legacy_streamlit._cached_catalogs)
cached_comment = _raw(legacy_streamlit._cached_comment)
cached_columns = _raw(legacy_streamlit._cached_columns)
cached_table_detail = _raw(legacy_streamlit._cached_table_detail)
cached_table_row_count = _raw(legacy_streamlit._cached_table_row_count)
cached_sample_rows = _raw(legacy_streamlit._cached_sample_rows)
cached_lineage_up = _raw(legacy_streamlit._cached_lineage_up)
cached_lineage_down = _raw(legacy_streamlit._cached_lineage_down)

normalize_str = legacy_streamlit._normalize_str
filter_asset_rows = legacy_streamlit._filter_asset_rows
split_uc_name = legacy_streamlit._split_uc_name
catalog_filter_options = legacy_streamlit._catalog_filter_options
tag_value = legacy_streamlit._tag_value
lineage_asset_stub = legacy_streamlit._lineage_asset_stub
empty_inventory = legacy_streamlit._empty_inventory


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
    if asset_fqn is None:
        _TTL_CACHE.clear()
        return
    suffix = f":{normalize_str(asset_fqn)}"
    for key in list(_TTL_CACHE):
        if key.startswith("inventory:") or key.startswith("visible_assets:"):
            _TTL_CACHE.pop(key, None)
            continue
        if key.startswith("asset_detail:") and key.endswith(suffix):
            _TTL_CACHE.pop(key, None)


def inventory_catalogs(uc, hidden_catalogs: Sequence[str]) -> List[str]:
    values: set[str] = set()
    try:
        values.update(cached_catalogs(uc))
    except Exception:
        pass
    try:
        df = uc.list_lineage_catalogs()
    except Exception:
        df = pd.DataFrame()
    if df is not None and not df.empty:
        values.update(
            normalize_str(value)
            for value in df.iloc[:, 0].tolist()
            if normalize_str(value)
        )
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
        return lineage_asset_stub(pd.DataFrame(), resolved_asset_fqn)
    match = inventory_df[inventory_df["fqn"] == resolved_asset_fqn]
    if not match.empty:
        return match.iloc[0]
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
    normalized = normalize_str(raw).upper()
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
    return normalize_str(raw).replace("_", " ").title() or "Table"


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
            normalized = normalize_str(value)
            if normalized and normalized not in badges:
                badges.append(normalized)
    return [badge for badge in badges if badge]


def base_asset_payload(row: pd.Series) -> Dict[str, Any]:
    return {
        "fqn": normalize_str(row.get("fqn")),
        "name": normalize_str(row.get("table_name")) or normalize_str(row.get("fqn")).split(".")[-1],
        "catalog": normalize_str(row.get("table_catalog")),
        "schema": normalize_str(row.get("table_schema")),
        "objectType": friendly_table_type(row.get("table_type"), row.get("data_source_format")),
        "description": normalize_str(row.get("comment")) or "No description has been captured for this asset yet.",
        "coverageScore": safe_int(row.get("governance_score")),
        "rows": "—",
        "format": "",
        "size": "—",
        "files": "—",
        "domain": normalize_str(row.get("domain")) or "Unassigned",
        "tier": normalize_str(row.get("tier")) or "Unassigned",
        "certification": normalize_str(row.get("certification")) or "Unassigned",
        "sensitivity": normalize_str(row.get("sensitivity")) or "Unassigned",
        "criticality": normalize_str(row.get("criticality")) or "Unassigned",
        "openRequests": safe_int(row.get("pending_requests")),
        "owners": owner_entries(row),
        "tags": asset_badges(row),
        "relatedAssets": [],
        "preview": [],
        "columns": [],
        "governanceStatus": normalize_str(row.get("governance_status")) or "Needs Work",
        "omTableFqn": normalize_str(row.get("om_table_fqn")),
    }


def discovery_result_haystack(asset: Dict[str, Any]) -> str:
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
        " ".join(normalize_str(tag) for tag in asset.get("tags", []) if normalize_str(tag)),
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


def discovery_match_score(asset: Dict[str, Any], query: str) -> int:
    q = normalized_search_text(query)
    if not q:
        return 0
    terms = [term for term in q.split(" ") if term]
    haystack = discovery_result_haystack(asset)
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
    if normalized_sort == "Recently updated":
        return sorted(assets, key=lambda asset: normalize_str(asset.get("name")).lower())
    return sorted(assets, key=_best_match_key, reverse=True)


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
    inventory = _resolve_inventory_df(
        inventory_or_uc,
        store,
        hidden_catalogs=hidden_catalogs,
    )
    assets = [base_asset_payload(row) for _, row in inventory.iterrows()]
    query_text = normalize_str(query)
    selected_views = normalize_filter_values(views, "All assets")
    selected_catalogs = normalize_filter_values(catalogs, "All catalogs")
    selected_domains = normalize_filter_values(domains, "All domains")
    selected_tiers = normalize_filter_values(tiers, "All tiers")
    selected_certifications = normalize_filter_values(certifications, "All certifications")
    selected_sensitivities = normalize_filter_values(sensitivities, "All sensitivities")
    selected_types = normalize_filter_values(asset_types, "All types")

    matched_assets: List[Dict[str, Any]] = []
    for asset in assets:
        if query_text and discovery_match_score(asset, query_text) <= 0:
            continue
        if not views_match(asset, selected_views):
            continue
        matched_assets.append(asset)

    def in_scope(asset: Dict[str, Any], *, exclude: Optional[set[str]] = None) -> bool:
        excluded = exclude or set()
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


def related_assets(uc, catalog: str, schema: str, table: str, focus_fqn: str) -> List[str]:
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
    return deduped[:8]


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


def column_records(columns_df: pd.DataFrame) -> List[Dict[str, Any]]:
    if columns_df is None or columns_df.empty:
        return []
    rows: List[Dict[str, Any]] = []
    for _, row in columns_df.head(50).iterrows():
        rows.append(
            {
                "name": normalize_str(row.get("column_name")),
                "type": normalize_str(row.get("data_type")),
                "description": normalize_str(row.get("comment")) or "No description",
            }
        )
    return rows


def asset_detail_payload(
    uc,
    inventory_or_store,
    asset_fqn: str,
    *,
    hidden_catalogs: Sequence[str] = HIDDEN_CATALOGS,
) -> Dict[str, Any]:
    inventory = _resolve_inventory_df(
        inventory_or_store if isinstance(inventory_or_store, pd.DataFrame) else uc,
        None if isinstance(inventory_or_store, pd.DataFrame) else inventory_or_store,
        hidden_catalogs=hidden_catalogs,
    )
    row = inventory_row(inventory, asset_fqn)
    base = base_asset_payload(row)
    catalog, schema, table = split_uc_name(base["fqn"])
    try:
        detail_df = cached_table_detail(uc, catalog, schema, table)
    except Exception:
        detail_df = pd.DataFrame()
    detail = detail_map(detail_df)
    try:
        columns_df = cached_columns(uc, catalog, schema, table)
    except Exception:
        columns_df = pd.DataFrame()
    try:
        sample_df = cached_sample_rows(uc, catalog, schema, table)
    except Exception:
        sample_df = pd.DataFrame()

    if not base["description"]:
        try:
            base["description"] = cached_comment(uc, catalog, schema, table)
        except Exception:
            pass

    try:
        row_count = coalesce(detail.get("numrows"), cached_table_row_count(uc, catalog, schema, table))
    except Exception:
        row_count = coalesce(detail.get("numrows"))
    base["rows"] = f"{safe_int(row_count):,}" if safe_int(row_count) else "—"
    base["format"] = coalesce(detail.get("format"), base["objectType"]).lower() or "—"
    if base["format"] == "table":
        base["format"] = "delta"
    base["size"] = human_bytes(detail.get("sizeinbytes"))
    base["files"] = str(safe_int(detail.get("numfiles"))) if safe_int(detail.get("numfiles")) else "—"
    base["objectType"] = coalesce(
        friendly_table_type(detail.get("type"), detail.get("format")),
        base["objectType"],
    )
    if base["format"] == "delta":
        base["objectType"] = "Delta Table"
    base["relatedAssets"] = related_assets(uc, catalog, schema, table, base["fqn"])
    base["preview"] = preview_records(sample_df)
    base["columns"] = column_records(columns_df)
    base["metadataEditor"] = {
        "available": True,
        "updatePath": "/api/assets/:fqn/metadata",
        "updateMethod": "PATCH",
        "fields": [
            {
                "key": "description",
                "label": "Description",
                "type": "textarea",
                "placeholder": "Add a description for this asset",
            },
            {"key": "domain", "label": "Domain", "type": "select"},
            {"key": "tier", "label": "Tier", "type": "select"},
            {"key": "certification", "label": "Certification", "type": "select"},
            {"key": "sensitivity", "label": "Sensitivity", "type": "select"},
        ],
    }
    return base
