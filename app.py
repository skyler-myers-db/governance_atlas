"""Governance Hub — Databricks App (Streamlit).

Enterprise discovery, lineage, and governance shell on top of Unity Catalog.
"""

from __future__ import annotations

import html
import json
from textwrap import shorten
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from govhub.auth import get_current_user_email
from govhub.config import AppConfig
from govhub.openmetadata import OpenMetadataClient, OpenMetadataError
from govhub.store import GovernanceStore
from govhub.uc import UCSQLClient

_HIDDEN_CATALOGS = {"hive_metastore", "samples", "system", "__databricks_internal"}
_META_TTL = 600
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
_STANDARD_TAG_KEYS = {
    key for aliases in _STANDARD_TAG_ALIASES.values() for key in aliases
}.union({"contains_pii", "pii"})
_TIER_OPTIONS = ["", "Tier 1", "Tier 2", "Tier 3", "Tier 4"]
_CERTIFICATION_OPTIONS = ["", "Certified", "Approved", "Needs Review", "Deprecated"]
_SENSITIVITY_OPTIONS = [
    "",
    "Public",
    "Internal",
    "Confidential",
    "Restricted",
    "Sensitive",
]
_CRITICALITY_OPTIONS = [
    "",
    "Mission Critical",
    "Business Critical",
    "Standard",
    "Exploratory",
]

_REQUEST_OWNER_EMAIL_KEY = "__request_owner_email"
_REQUEST_OWNER_TYPE_KEY = "__request_owner_type"
_REQUEST_COLUMN_NAME_KEY = "__request_column_name"
_REQUEST_COLUMN_COMMENT_KEY = "__request_column_comment"


@st.cache_resource(show_spinner=False)
def _get_config() -> AppConfig:
    return AppConfig.from_env()


@st.cache_resource(show_spinner=False)
def _get_uc_client(_cfg: AppConfig) -> UCSQLClient:
    return UCSQLClient(warehouse_id=_cfg.warehouse_id)


@st.cache_resource(show_spinner=False)
def _get_store(_cfg: AppConfig, _uc: UCSQLClient) -> GovernanceStore:
    store = GovernanceStore(uc=_uc, catalog=_cfg.gov_catalog, schema=_cfg.gov_schema)
    store.ensure_tables()
    return store


@st.cache_resource(show_spinner=False)
def _get_om_client(_cfg: AppConfig) -> Optional[OpenMetadataClient]:
    if not _cfg.openmetadata_enabled:
        return None
    return OpenMetadataClient(
        server_url=_cfg.om_server_url,
        jwt_token=_cfg.om_jwt_token,
    )


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_bootstrap_catalogs(_uc: UCSQLClient) -> List[str]:
    try:
        df = _uc.list_catalogs()
    except Exception:
        return []
    if df is None or df.empty:
        return []
    return sorted(
        _normalize_str(value)
        for value in df.iloc[:, 0].tolist()
        if _normalize_str(value)
        and _normalize_str(value).lower() not in _HIDDEN_CATALOGS
    )


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_catalogs(_uc: UCSQLClient) -> List[str]:
    values: set[str] = set()
    for loader in (_uc.list_catalogs, getattr(_uc, "list_lineage_catalogs", None)):
        if loader is None:
            continue
        try:
            df = loader()
        except Exception:
            continue
        if df is None or df.empty:
            continue
        values.update(
            _normalize_str(value)
            for value in df.iloc[:, 0].tolist()
            if _normalize_str(value)
        )
    return sorted(
        value for value in values if value.lower() not in _HIDDEN_CATALOGS
    )


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_schemas(_uc: UCSQLClient, catalog: str) -> List[str]:
    df = _uc.list_schemas(catalog)
    if df.empty:
        return []
    return df.iloc[:, 0].tolist()


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_tables(_uc: UCSQLClient, catalog: str, schema: str) -> List[str]:
    df = _uc.list_tables(catalog, schema)
    if df.empty:
        return []
    tcol = "tableName" if "tableName" in df.columns else df.columns[-1]
    return df[tcol].tolist()


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_catalog_inventory(_uc: UCSQLClient, catalog: str) -> pd.DataFrame:
    return _uc.get_catalog_table_inventory(catalog)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_catalog_table_tags(_uc: UCSQLClient, catalog: str) -> pd.DataFrame:
    return _uc.get_catalog_table_tags(catalog)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_columns(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_columns(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_comment(_uc: UCSQLClient, catalog: str, schema: str, table: str) -> str:
    return _uc.get_table_comment(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_table_tags(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_tags(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_table_detail(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_detail(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_table_row_count(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> Any:
    return _uc.get_table_row_count(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_table_properties(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_properties(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_table_constraints(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_constraints(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_lineage_up(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_lineage_upstream(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_lineage_down(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_lineage_downstream(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_col_lineage_up(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_column_lineage_upstream(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_col_lineage_down(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_column_lineage_downstream(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_operational_context_up(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_operational_context_upstream(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_operational_context_down(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_operational_context_downstream(catalog, schema, table)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_sample_rows(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_sample(catalog, schema, table, limit=15)


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_workspace_principals(_uc: UCSQLClient) -> pd.DataFrame:
    return _uc.list_workspace_principals()


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_operational_entity_name(
    _uc: UCSQLClient,
    entity_type: str,
    entity_id: str,
) -> str:
    return _uc.resolve_operational_entity_name(entity_type, entity_id)


def _normalize_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def _is_excluded_asset_name(value: Any) -> bool:
    lowered = _normalize_str(value).lower()
    return any(marker in lowered for marker in _EXCLUDED_ASSET_MARKERS)


def _filter_asset_rows(
    df: pd.DataFrame,
    columns: List[str],
    *,
    exclude_fqn: str = "",
) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=df.columns if df is not None else [])

    view = df.copy()
    keep_mask = pd.Series(True, index=view.index)
    excluded = _normalize_str(exclude_fqn).lower()

    for column in columns:
        if column not in view.columns:
            continue
        values = view[column].map(_normalize_str).str.lower()
        keep_mask &= ~values.map(_is_excluded_asset_name)
        if excluded:
            keep_mask &= values != excluded

    return view.loc[keep_mask].reset_index(drop=True)


def _split_uc_name(name: str) -> Tuple[str, str, str]:
    parts = [p.strip() for p in name.split(".") if p.strip()]
    if len(parts) != 3:
        raise ValueError("Expected catalog.schema.table")
    return parts[0], parts[1], parts[2]


def _catalog_schema_context(name: str) -> str:
    try:
        catalog, schema, _ = _split_uc_name(name)
    except ValueError:
        return ""
    return " / ".join(part for part in [catalog, schema] if part)


def _catalog_filter_options(
    inventory: pd.DataFrame,
    *,
    available_catalogs: Optional[List[str]] = None,
    observed_catalogs: Optional[List[str]] = None,
) -> List[str]:
    values: set[str] = set()
    if inventory is not None and not inventory.empty:
        if "table_catalog" in inventory.columns:
            values.update(
                _normalize_str(value)
                for value in inventory["table_catalog"].dropna().astype(str).tolist()
                if _normalize_str(value)
            )
        if "fqn" in inventory.columns:
            for raw in inventory["fqn"].dropna().astype(str).tolist():
                try:
                    catalog, _, _ = _split_uc_name(_normalize_str(raw))
                except ValueError:
                    continue
                if catalog:
                    values.add(catalog)
    if available_catalogs:
        values.update(
            _normalize_str(catalog)
            for catalog in available_catalogs
            if _normalize_str(catalog)
        )
    if observed_catalogs:
        values.update(
            _normalize_str(catalog)
            for catalog in observed_catalogs
            if _normalize_str(catalog)
        )
    return sorted(values)


def _remember_observed_catalogs(values: List[str]) -> List[str]:
    existing = st.session_state.get("observed_catalog_scopes", [])
    if not isinstance(existing, list):
        existing = [existing] if _normalize_str(existing) else []
    merged = sorted(
        {
            _normalize_str(value)
            for value in [*existing, *values]
            if _normalize_str(value)
        }
    )
    st.session_state["observed_catalog_scopes"] = merged
    return merged


def _lineage_asset_stub(inventory: pd.DataFrame, asset_fqn: str) -> pd.Series:
    if not inventory.empty:
        match = inventory[inventory["fqn"] == asset_fqn]
        if not match.empty:
            return match.iloc[0]
    try:
        catalog, schema, table = _split_uc_name(asset_fqn)
    except ValueError:
        catalog, schema, table = "", "", asset_fqn
    base: Dict[str, Any] = {}
    if not inventory.empty:
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


def _tag_value(tags: Dict[str, str], key: str) -> str:
    for alias in _STANDARD_TAG_ALIASES.get(key, (key,)):
        value = _normalize_str(tags.get(alias))
        if value:
            return value
    if key == "sensitivity":
        pii_value = _normalize_str(tags.get("contains_pii") or tags.get("pii"))
        if pii_value.lower() in {"1", "true", "yes", "pii", "sensitive"}:
            return "Sensitive"
    return ""


def _structured_tags(tags: Dict[str, str]) -> Dict[str, str]:
    return {
        "domain": _tag_value(tags, "domain"),
        "tier": _tag_value(tags, "tier"),
        "certification": _tag_value(tags, "certification"),
        "sensitivity": _tag_value(tags, "sensitivity"),
        "criticality": _tag_value(tags, "criticality"),
        "glossary_term": _tag_value(tags, "glossary_term"),
        "data_product": _tag_value(tags, "data_product"),
    }


def _custom_tags_df(existing: pd.DataFrame) -> pd.DataFrame:
    if existing is None or existing.empty:
        return pd.DataFrame(columns=["tag_name", "tag_value"])
    view = existing[~existing["tag_name"].isin(_STANDARD_TAG_KEYS)].copy()
    if view.empty:
        return pd.DataFrame(columns=["tag_name", "tag_value"])
    return view[["tag_name", "tag_value"]]


def _df_to_tags_map(df: pd.DataFrame) -> Dict[str, str]:
    tags: Dict[str, str] = {}
    if df is None or df.empty:
        return tags
    for _, row in df.iterrows():
        key = _normalize_str(row.get("tag_name"))
        value = _normalize_str(row.get("tag_value"))
        if key:
            tags[key] = value
    return tags


def _tags_map_to_df(tags: Dict[str, str]) -> pd.DataFrame:
    rows = [
        {"tag_name": _normalize_str(key), "tag_value": _normalize_str(value)}
        for key, value in (tags or {}).items()
        if _normalize_str(key)
    ]
    if not rows:
        return pd.DataFrame(columns=["tag_name", "tag_value"])
    return pd.DataFrame(rows).sort_values("tag_name").reset_index(drop=True)


def _tags_editor(
    existing: pd.DataFrame,
    key: str,
    *,
    suggestions: Optional[Dict[str, List[str]]] = None,
) -> pd.DataFrame:
    rows_key = f"{key}_rows"
    sig_key = f"{key}_signature"
    source = (
        existing[["tag_name", "tag_value"]]
        .fillna("")
        .astype(str)
        .sort_values(["tag_name", "tag_value"])
        .reset_index(drop=True)
        if existing is not None and not existing.empty
        else pd.DataFrame(columns=["tag_name", "tag_value"])
    )
    signature = json.dumps(source.to_dict("records"), sort_keys=True)
    if st.session_state.get(sig_key) != signature:
        rows = source.to_dict("records")
        if not rows:
            rows = [{"tag_name": "", "tag_value": ""}]
        st.session_state[rows_key] = rows
        st.session_state[sig_key] = signature

    rows = list(st.session_state.get(rows_key, []))
    if suggestions:
        suggestion_keys = [""] + list(suggestions.keys())
        add_cols = st.columns([0.42, 0.42, 0.16])
        selected_key = add_cols[0].selectbox(
            "Existing tag key",
            suggestion_keys,
            format_func=lambda value: value or "Suggested tag key",
            key=f"{key}_suggest_key",
        )
        suggested_values = [""] + suggestions.get(selected_key, [])
        selected_value = add_cols[1].selectbox(
            "Existing tag value",
            suggested_values,
            format_func=lambda value: value or "Suggested value",
            key=f"{key}_suggest_value",
            disabled=not selected_key,
        )
        if add_cols[2].button(
            "Add",
            key=f"{key}_suggest_add",
            disabled=not selected_key,
            use_container_width=True,
        ):
            candidate = {
                "tag_name": selected_key,
                "tag_value": selected_value,
            }
            if candidate not in rows:
                rows.append(candidate)
                st.session_state[rows_key] = rows
            st.rerun()
    elif suggestions is not None:
        st.caption("No existing workspace custom tags were found yet.")
    st.markdown(
        """
<div class="gh-tags-header">
  <div>Tag key</div>
  <div>Tag value</div>
  <div></div>
</div>
        """,
        unsafe_allow_html=True,
    )

    remove_idx: Optional[int] = None
    current_rows: List[Dict[str, str]] = []
    for idx, row in enumerate(rows):
        cols = st.columns([1.05, 1.05, 0.22])
        name = cols[0].text_input(
            "Tag key",
            value=_normalize_str(row.get("tag_name")),
            placeholder="domain_owner",
            label_visibility="collapsed",
            key=f"{key}_tag_name_{idx}",
        )
        value = cols[1].text_input(
            "Tag value",
            value=_normalize_str(row.get("tag_value")),
            placeholder="finance",
            label_visibility="collapsed",
            key=f"{key}_tag_value_{idx}",
        )
        if cols[2].button("Remove", key=f"{key}_remove_{idx}", disabled=len(rows) == 1):
            remove_idx = idx
        current_rows.append({"tag_name": name, "tag_value": value})

    if remove_idx is not None:
        current_rows.pop(remove_idx)
        if not current_rows:
            current_rows = [{"tag_name": "", "tag_value": ""}]
        st.session_state[rows_key] = current_rows
        st.rerun()

    if st.button("Add tag row", key=f"{key}_add_row", use_container_width=True):
        current_rows.append({"tag_name": "", "tag_value": ""})
        st.session_state[rows_key] = current_rows
        st.rerun()

    st.session_state[rows_key] = current_rows
    cleaned_rows = [
        {
            "tag_name": _normalize_str(row.get("tag_name")),
            "tag_value": _normalize_str(row.get("tag_value")),
        }
        for row in current_rows
        if _normalize_str(row.get("tag_name"))
    ]
    return pd.DataFrame(cleaned_rows, columns=["tag_name", "tag_value"])


def _select_index(options: List[str], current: str) -> int:
    try:
        return options.index(current)
    except ValueError:
        return 0


def _safe_badge(text: str, tone: str = "neutral") -> str:
    if not text:
        return ""
    return f"<span class='gh-badge gh-badge-{tone}'>{html.escape(text)}</span>"


def _route_subnav_html(
    items: List[Tuple[str, str]],
    current: str,
    *,
    label: str = "",
    help_text: Optional[Dict[str, str]] = None,
) -> str:
    links: List[str] = []
    for item_label, href in items:
        classes = "gh-subnav-link active" if item_label == current else "gh-subnav-link"
        tooltip = _normalize_str((help_text or {}).get(item_label))
        links.append(
            f"<a {_route_link_attrs(href, f'gh-route-link {classes}', tooltip=tooltip)}>"
            f"{html.escape(item_label)}"
            "</a>"
        )
    label_html = (
        f"<div class='gh-subnav-label'>{html.escape(label)}</div>" if label else ""
    )
    return f"""
<div class="gh-subnav-shell">
  {label_html}
  <div class="gh-subnav">{"".join(links)}</div>
</div>
    """


def _module_switcher_html(
    current_page: str,
    help_text: Dict[str, str],
) -> str:
    items = ["Discovery", "Lineage", "Governance", "Stewardship", "Admin"]
    links: List[str] = []
    for item in items:
        classes = "gh-module-link active" if item == current_page else "gh-module-link"
        tooltip = _normalize_str(help_text.get(item))
        links.append(
            f"<a {_route_link_attrs('?' + urlencode({'page': item}), classes, tooltip=tooltip)}>"
            f"{html.escape(item)}"
            "</a>"
        )
    help_classes = "gh-module-help active" if current_page == "Help" else "gh-module-help"
    help_title = _normalize_str(help_text.get("?", "Open Help"))
    help_link = (
        f"<a {_route_link_attrs('?' + urlencode({'page': 'Help'}), help_classes, tooltip=help_title)}>?</a>"
    )
    return f"""
<div class="gh-module-shell">
  <div class="gh-module-shell-head">
    <div class="gh-module-shell-title">Module Switcher</div>
    {help_link}
  </div>
  <div class="gh-module-nav">{"".join(links)}</div>
</div>
    """


def _format_object_type(raw: str) -> str:
    value = _normalize_str(raw).upper()
    if not value:
        return ""
    labels = {
        "MANAGED": "Managed Table",
        "EXTERNAL": "External Table",
        "VIEW": "View",
        "MATERIALIZED_VIEW": "Materialized View",
        "STREAMING_TABLE": "Streaming Table",
        "TEMPORARY_VIEW": "Temporary View",
        "FOREIGN": "Foreign Table",
    }
    if value in labels:
        return labels[value]
    return value.replace("_", " ").title()


def _format_entity_type(raw: str) -> str:
    value = _normalize_str(raw).upper().replace(" ", "_").replace("-", "_")
    if not value:
        return "Workload"
    labels = {
        "JOB": "Job",
        "WORKFLOW": "Workflow",
        "PIPELINE": "Pipeline",
        "LAKEFLOW_PIPELINE": "Lakeflow Pipeline",
        "DLT_PIPELINE": "DLT Pipeline",
        "NOTEBOOK": "Notebook",
        "SQL": "SQL",
        "DBSQL_QUERY": "DBSQL Query",
        "SQL_QUERY": "SQL Query",
        "QUERY": "Query",
        "STATEMENT": "Statement",
        "STATEMENT_EXECUTION": "Statement",
        "DASHBOARD": "Dashboard",
        "DBSQL_DASHBOARD": "DBSQL Dashboard",
    }
    if value in labels:
        return labels[value]
    return value.replace("_", " ").title()


def _friendly_metadata_label(raw: str) -> str:
    text = _normalize_str(raw)
    if not text:
        return ""
    base = text.split(".")[-1].split("[")[0]
    return base.replace("_", " ").title()


def _parse_metadata_dict(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = _normalize_str(raw)
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _flatten_metadata(metadata: Any, prefix: str = "") -> Dict[str, str]:
    flattened: Dict[str, str] = {}
    if isinstance(metadata, dict):
        for key, value in metadata.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            flattened.update(_flatten_metadata(value, next_prefix))
        return flattened
    if isinstance(metadata, list):
        simple_values = [
            _normalize_str(value)
            for value in metadata
            if not isinstance(value, (dict, list)) and _normalize_str(value)
        ]
        if simple_values and prefix:
            flattened[prefix] = ", ".join(simple_values[:5])
        for idx, value in enumerate(metadata[:5]):
            if isinstance(value, (dict, list)):
                next_prefix = f"{prefix}[{idx}]" if prefix else f"[{idx}]"
                flattened.update(_flatten_metadata(value, next_prefix))
        return flattened
    text = _normalize_str(metadata)
    if prefix and text:
        flattened[prefix] = text
    return flattened


def _metadata_value(flattened: Dict[str, str], candidates: List[str]) -> str:
    if not flattened:
        return ""
    lowered = {key.lower(): value for key, value in flattened.items()}
    for candidate in candidates:
        candidate_l = candidate.lower()
        if candidate_l in lowered and _normalize_str(lowered[candidate_l]):
            return _normalize_str(lowered[candidate_l])
    for key, value in lowered.items():
        if any(key.endswith(candidate.lower()) for candidate in candidates) and _normalize_str(value):
            return _normalize_str(value)
    return ""


def _short_identifier(value: str) -> str:
    text = _normalize_str(value)
    if len(text) <= 16:
        return text
    return f"{text[:8]}…{text[-4:]}"


def _path_leaf(value: str) -> str:
    text = _normalize_str(value).rstrip("/")
    if not text:
        return ""
    return text.split("/")[-1] or text


def _operational_fallback_title(
    entity_label: str,
    *,
    direction: str,
    focus_asset_name: str,
) -> str:
    asset_name = _normalize_str(focus_asset_name) or "this asset"
    verb = "producing" if direction == "upstream" else "consuming"
    return f"{entity_label} {verb} {asset_name}".strip()


def _operational_display_payload(row: pd.Series) -> Dict[str, str]:
    metadata = _parse_metadata_dict(row.get("entity_metadata"))
    flat = _flatten_metadata(metadata)
    entity_label = _format_entity_type(row.get("entity_type"))
    resolved_value = _normalize_str(row.get("resolved_entity_name"))
    path_value = _metadata_value(
        flat,
        [
            "notebook_path",
            "notebookPath",
            "workspace_path",
            "workspacePath",
            "object_path",
            "objectPath",
            "parent_path",
            "parentPath",
            "resource_path",
            "resourcePath",
            "path",
        ],
    )
    named_value = _metadata_value(
        flat,
        [
            "display_name",
            "displayName",
            "settings.name",
            "job_settings.name",
            "job_name",
            "jobName",
            "workflow_name",
            "workflowName",
            "pipeline_name",
            "pipelineName",
            "spec.name",
            "entity_name",
            "entityName",
            "dashboard_name",
            "dashboardName",
            "query_name",
            "queryName",
            "notebook_name",
            "notebookName",
            "workspace_object_name",
            "workspaceObjectName",
            "resource_name",
            "resourceName",
            "task_name",
            "taskName",
            "title",
            "object_name",
            "objectName",
            "name",
        ],
    )
    statement_value = _metadata_value(flat, ["statement_text", "query_text", "query"])

    title_source = "fallback"
    if resolved_value:
        title = resolved_value
        primary_subtitle = path_value if path_value and path_value != resolved_value else ""
        title_source = "resolved"
    elif named_value:
        title = named_value
        primary_subtitle = path_value if path_value and path_value != named_value else ""
        title_source = "name"
    elif path_value:
        title = _path_leaf(path_value)
        primary_subtitle = path_value
        title_source = "path"
    elif statement_value:
        title = shorten(statement_value.splitlines()[0], width=76, placeholder="…")
        primary_subtitle = ""
        title_source = "statement"
    else:
        fallback_id = (
            _normalize_str(row.get("entity_id"))
            or _normalize_str(row.get("statement_id"))
            or _normalize_str(row.get("entity_run_id"))
        )
        title = (
            f"{entity_label} {_short_identifier(fallback_id)}".strip()
            if fallback_id
            else entity_label
        )
        primary_subtitle = ""

    return {
        "entity_label": entity_label,
        "title": shorten(title, width=80, placeholder="…"),
        "primary_subtitle": primary_subtitle,
        "statement": statement_value,
        "flat_metadata": flat,
        "title_source": title_source,
    }


def _enrich_operational_context_names(
    uc: UCSQLClient,
    df: pd.DataFrame,
) -> pd.DataFrame:
    if df is None or df.empty or "entity_type" not in df.columns:
        return df
    view = df.copy()
    lookup: Dict[Tuple[str, str], str] = {}
    for row in view.itertuples(index=False):
        entity_type = _normalize_str(getattr(row, "entity_type", ""))
        entity_id = _normalize_str(getattr(row, "entity_id", ""))
        if not entity_type or not entity_id:
            continue
        key = (entity_type, entity_id)
        if key not in lookup:
            lookup[key] = _cached_operational_entity_name(uc, entity_type, entity_id)
    resolved_names: List[str] = []
    for row in view.itertuples(index=False):
        entity_type = _normalize_str(getattr(row, "entity_type", ""))
        entity_id = _normalize_str(getattr(row, "entity_id", ""))
        resolved_names.append(lookup.get((entity_type, entity_id), ""))
    view["resolved_entity_name"] = resolved_names
    return view


def _operational_group_key(row: pd.Series) -> str:
    entity_type = _normalize_str(row.get("entity_type"))
    display = _operational_display_payload(row)
    entity_id = _normalize_str(row.get("entity_id"))
    statement_id = _normalize_str(row.get("statement_id"))
    stable_key = (
        _normalize_str(display.get("title")).lower()
        or entity_id
        or statement_id
    )
    if stable_key:
        return "||".join([entity_type, stable_key])
    return "||".join(
        [
            entity_type,
            _normalize_str(row.get("related_table_full_name")),
            _normalize_str(row.get("related_type")),
        ]
    )


def _summarize_operational_context(
    df: pd.DataFrame,
    *,
    direction: str,
    focus_asset_name: str = "",
) -> List[Dict[str, Any]]:
    if df is None or df.empty:
        return []
    view = df.fillna("").copy()
    view["_group_key"] = view.apply(_operational_group_key, axis=1)
    cards: List[Dict[str, Any]] = []
    for _, group in view.groupby("_group_key", sort=False):
        row = group.iloc[0]
        payload = _operational_display_payload(row)
        entity_label = payload["entity_label"]
    title = payload["title"]
    has_specific_identifier = bool(
        _normalize_str(row.get("entity_id")) or statement_ids or run_ids
    )
    if payload.get("title_source") == "fallback" and not has_specific_identifier:
        title = _operational_fallback_title(
            entity_label,
            direction=direction,
            focus_asset_name=focus_asset_name,
        )
        flat = payload["flat_metadata"]
        run_ids = {
            _normalize_str(value)
            for value in group["entity_run_id"].tolist()
            if _normalize_str(value)
        }
        statement_ids = {
            _normalize_str(value)
            for value in group["statement_id"].tolist()
            if _normalize_str(value)
        }
        subtitle_parts: List[str] = []
        if payload["primary_subtitle"]:
            subtitle_parts.append(payload["primary_subtitle"])
        if _normalize_str(row.get("entity_id")) and not payload["primary_subtitle"]:
            subtitle_parts.append(
                f"ID {_short_identifier(_normalize_str(row.get('entity_id')))}"
            )
        if len(run_ids) > 1:
            subtitle_parts.append(f"{len(run_ids)} runs")
        elif len(run_ids) == 1:
            subtitle_parts.append(f"Run {_short_identifier(next(iter(run_ids)))}")
        elif len(statement_ids) > 1:
            subtitle_parts.append(f"{len(statement_ids)} statements")
        elif len(statement_ids) == 1:
            subtitle_parts.append(
                f"Stmt {_short_identifier(next(iter(statement_ids)))}"
            )
        subtitle = " · ".join(part for part in subtitle_parts if part)
        note = _metadata_value(flat, ["description", "details"])
        related_assets = [
            _normalize_str(value)
            for value in group["related_table_full_name"].tolist()
            if _normalize_str(value)
        ]
        related_assets = list(dict.fromkeys(related_assets))
        detail_rows: List[Tuple[str, str]] = []
        entity_id = _normalize_str(row.get("entity_id"))
        if entity_id:
            detail_rows.append(("Entity ID", entity_id))
        if payload["primary_subtitle"]:
            detail_rows.append(("Workspace Path", payload["primary_subtitle"]))
        if len(run_ids) > 1:
            detail_rows.append(("Runs", f"{len(run_ids)} runs"))
        elif len(run_ids) == 1:
            detail_rows.append(("Run ID", next(iter(run_ids))))
        if len(statement_ids) > 1:
            detail_rows.append(("Statements", f"{len(statement_ids)} statements"))
        elif len(statement_ids) == 1:
            detail_rows.append(("Statement ID", next(iter(statement_ids))))
        if note:
            detail_rows.append(("Description", note))
        if payload["statement"]:
            detail_rows.append(
                (
                    "Statement Text",
                    shorten(payload["statement"], width=240, placeholder="…"),
                )
            )
        metadata_details = [
            (
                _friendly_metadata_label(key),
                value,
            )
            for key, value in flat.items()
            if _normalize_str(value)
            and key.lower()
            not in {
                "display_name",
                "displayname",
                "settings.name",
                "job_settings.name",
                "job_name",
                "jobname",
                "workflow_name",
                "workflowname",
                "pipeline_name",
                "pipelinename",
                "spec.name",
                "entity_name",
                "entityname",
                "dashboard_name",
                "dashboardname",
                "query_name",
                "queryname",
                "notebook_name",
                "notebookname",
                "workspace_object_name",
                "workspaceobjectname",
                "resource_name",
                "resourcename",
                "path",
                "workspace_path",
                "workspacepath",
                "notebook_path",
                "notebookpath",
                "statement_text",
                "query_text",
                "query",
                "description",
                "details",
            }
        ]
        detail_rows.extend(metadata_details[:4])
        cards.append(
            {
                "entity_label": entity_label,
                "title": title,
                "subtitle": subtitle,
                "note": shorten(note, width=150, placeholder="…") if note else "",
                "asset_count": len(related_assets),
                "assets_label": (
                    "upstream assets" if direction == "upstream" else "downstream assets"
                ),
                "related_assets": related_assets[:6],
                "detail_rows": detail_rows,
                "direction": direction,
            }
        )
    cards.sort(key=lambda item: (item["entity_label"], item["title"]))
    return cards[:8]


def _operational_focus_summary_html(
    asset: pd.Series,
    upstream_cards: List[Dict[str, Any]],
    downstream_cards: List[Dict[str, Any]],
    upstream_df: pd.DataFrame,
    downstream_df: pd.DataFrame,
) -> str:
    selected_name = _normalize_str(asset.get("table_name")) or "Selected asset"
    upstream_assets = (
        upstream_df["related_table_full_name"]
        .fillna("")
        .astype(str)
        .str.strip()
        .replace("", pd.NA)
        .dropna()
        .nunique()
        if upstream_df is not None
        and not upstream_df.empty
        and "related_table_full_name" in upstream_df.columns
        else 0
    )
    downstream_assets = (
        downstream_df["related_table_full_name"]
        .fillna("")
        .astype(str)
        .str.strip()
        .replace("", pd.NA)
        .dropna()
        .nunique()
        if downstream_df is not None
        and not downstream_df.empty
        and "related_table_full_name" in downstream_df.columns
        else 0
    )
    if not upstream_cards and not downstream_cards:
        note = (
            f"No workload-level operational context is currently available for {selected_name}."
        )
    elif not downstream_cards:
        note = (
            "Use upstream workloads to find the job, pipeline, notebook, or query that produces this asset."
        )
    elif not upstream_cards:
        note = (
            "Use downstream consumers to understand where this asset is read before making changes."
        )
    else:
        note = (
            "Review producer workloads and downstream consumers together before changing schema, logic, or ownership."
        )

    summary_items = [
        ("Upstream Workloads", f"{len(upstream_cards)} entities"),
        ("Downstream Consumers", f"{len(downstream_cards)} entities"),
        ("Upstream Assets Touched", f"{upstream_assets} assets"),
        ("Downstream Assets Touched", f"{downstream_assets} assets"),
    ]
    items_html = "".join(
        f"""
<div class="gh-lineage-summary-item">
  <div class="gh-lineage-summary-item-label">{html.escape(label)}</div>
  <div class="gh-lineage-summary-item-value">{html.escape(value)}</div>
</div>
        """
        for label, value in summary_items
    )
    return f"""
<div class="gh-lineage-summary">
  <div class="gh-panel-label">Operational Summary</div>
  <div class="gh-lineage-summary-grid">{items_html}</div>
  <div class="gh-lineage-summary-note">{html.escape(note)}</div>
</div>
    """


def _lineage_asset_option_label(inventory: pd.DataFrame, fqn: str) -> str:
    normalized = _normalize_str(fqn)
    if not normalized:
        return ""
    if inventory is not None and not inventory.empty:
        match = inventory[inventory["fqn"] == normalized]
        if not match.empty:
            row = match.iloc[0]
            table_name = _normalize_str(row.get("table_name")) or normalized.split(".")[-1]
            context = " / ".join(
                part
                for part in [
                    _normalize_str(row.get("table_catalog")),
                    _normalize_str(row.get("table_schema")),
                ]
                if part
            )
            return f"{table_name} ({context})" if context else table_name
    table_name = normalized.split(".")[-1]
    context = _catalog_schema_context(normalized)
    return f"{table_name} ({context})" if context else table_name


def _profile_stat_html(label: str, value: str) -> str:
    return f"""
<div class="gh-profile-stat">
  <div class="gh-profile-stat-label">{html.escape(label)}</div>
  <div class="gh-profile-stat-value">{html.escape(value)}</div>
</div>
    """


def _operational_related_asset_link_html(asset_fqn: str) -> str:
    normalized = _normalize_str(asset_fqn)
    if not normalized:
        return ""
    label = normalized.split(".")[-1]
    context = _catalog_schema_context(normalized)
    if context:
        label = f"{label} · {context}"
    return (
        f"<a {_route_link_attrs(_lineage_query_href(normalized, context='Operational Context'), 'gh-operational-pill gh-operational-pill-link')}>"
        f"{html.escape(label)}</a>"
    )


def _operational_context_card_html(item: Dict[str, Any]) -> str:
    note_html = (
        f"<span class='gh-operational-note'>{html.escape(item['note'])}</span>"
        if _normalize_str(item.get("note"))
        else ""
    )
    subtitle_html = (
        f"<span class='gh-operational-subtitle'>{html.escape(item['subtitle'])}</span>"
        if _normalize_str(item.get("subtitle"))
        else ""
    )
    detail_rows = item.get("detail_rows", [])
    detail_html = "".join(
        f"""
<div class="gh-operational-detail-item">
  <div class="gh-operational-detail-label">{html.escape(label)}</div>
  <div class="gh-operational-detail-value">{html.escape(value)}</div>
</div>
        """
        for label, value in detail_rows
        if _normalize_str(label) and _normalize_str(value)
    )
    related_assets_html = "".join(
        _operational_related_asset_link_html(asset_fqn)
        for asset_fqn in item.get("related_assets", [])
        if _normalize_str(asset_fqn)
    )
    related_section_html = (
        f"""
  <div class="gh-operational-related">
    <div class="gh-operational-detail-label">Related Assets</div>
    <div class="gh-operational-pill-row">{related_assets_html}</div>
  </div>
        """
        if related_assets_html
        else ""
    )
    detail_body_html = related_section_html
    if detail_html:
        detail_body_html += f"""
  <div class="gh-operational-detail-grid">{detail_html}</div>
        """
    expandable_class = " expandable" if detail_body_html else ""
    return f"""
<details class="gh-operational-card{expandable_class}">
  <summary class="gh-operational-summary">
    <span class="gh-operational-head">
      <span class="gh-operational-head-main">
        <span class="gh-operational-type">{html.escape(item['entity_label'])}</span>
        <span class="gh-operational-title">{html.escape(item['title'])}</span>
        {subtitle_html}
      </span>
      <span class="gh-operational-count">
        {int(item['asset_count'])} {html.escape(item['assets_label'])}
      </span>
    </span>
    {note_html}
  </summary>
  <div class="gh-operational-detail-body">{detail_body_html}</div>
</details>
    """


def _render_operational_context_section(
    upstream_df: pd.DataFrame,
    downstream_df: pd.DataFrame,
    upstream_error: Optional[str],
    downstream_error: Optional[str],
) -> None:
    upstream_cards = _summarize_operational_context(upstream_df, direction="upstream")
    downstream_cards = _summarize_operational_context(
        downstream_df, direction="downstream"
    )
    st.markdown(
        """
<div class="gh-operational-section">
  <div class="gh-panel-label">Operational Context</div>
  <div class="gh-section-copy">
    Review the workload context behind this lineage, including jobs, pipelines,
    notebooks, statements, and other execution entities captured by Unity Catalog.
  </div>
</div>
        """,
        unsafe_allow_html=True,
    )
    left, right = st.columns(2)
    with left:
        st.markdown("#### Upstream Workloads")
        if upstream_error:
            st.warning(f"Could not query upstream workload context: {upstream_error}")
        elif not upstream_cards:
            st.info("No upstream workload context is available for this asset.")
        else:
            st.markdown(
                f"<div class='gh-operational-grid'>{''.join(_operational_context_card_html(item) for item in upstream_cards)}</div>",
                unsafe_allow_html=True,
            )
    with right:
        st.markdown("#### Downstream Consumers")
        if downstream_error:
            st.warning(
                f"Could not query downstream workload context: {downstream_error}"
            )
        elif not downstream_cards:
            st.info("No downstream workload context is available for this asset.")
        else:
            st.markdown(
                f"<div class='gh-operational-grid'>{''.join(_operational_context_card_html(item) for item in downstream_cards)}</div>",
                unsafe_allow_html=True,
            )


def _button_nav(
    options: List[str],
    state_key: str,
    *,
    disabled_options: Optional[List[str]] = None,
    help_map: Optional[Dict[str, str]] = None,
) -> str:
    disabled = set(disabled_options or [])
    current = st.session_state.get(state_key, options[0])
    if current in disabled:
        current = next((option for option in options if option not in disabled), options[0])
        st.session_state[state_key] = current
    cols = st.columns(len(options))
    for col, option in zip(cols, options):
        with col:
            if st.button(
                option,
                key=f"{state_key}_{option}",
                use_container_width=True,
                type="primary" if option == current else "secondary",
                disabled=option in disabled,
            ):
                if option != current:
                    st.session_state[state_key] = option
                    st.rerun()
    if help_map:
        _attach_button_titles(help_map)
    return st.session_state.get(state_key, current)


def _decorate_buttons(config_map: Optional[Dict[str, Dict[str, str]]]) -> None:
    if not config_map:
        return
    normalized: Dict[str, Dict[str, str]] = {}
    for label, config in config_map.items():
        if not _normalize_str(label):
            continue
        normalized[label] = {
            "tooltip": _normalize_str(config.get("tooltip")),
            "classes": _normalize_str(config.get("classes")),
        }
    if not normalized:
        return
    payload = json.dumps(normalized)
    components.html(
        f"""
<script>
(function() {{
  try {{
    const rootWindow =
      window.parent && window.parent.document ? window.parent : window;
    const doc = rootWindow.document || window.document;
    const configMap = {payload};
    Object.entries(configMap).forEach(([label, config]) => {{
      doc.querySelectorAll('button').forEach((button) => {{
        const text = (button.innerText || button.textContent || '').trim();
        if (text === label) {{
          if (config.tooltip) {{
            button.setAttribute('data-gh-tooltip', config.tooltip);
          }}
          if (config.classes) {{
            config.classes.split(/\\s+/).filter(Boolean).forEach((name) => button.classList.add(name));
          }}
        }}
      }});
    }});
  }} catch (error) {{}}
}})();
</script>
        """,
        height=0,
        width=0,
    )


def _attach_button_titles(title_map: Optional[Dict[str, str]]) -> None:
    if not title_map:
        return
    _decorate_buttons(
        {
            key: {"tooltip": value}
            for key, value in title_map.items()
            if _normalize_str(key) and _normalize_str(value)
        }
    )


def _route_link_attrs(href: str, classes: str, *, tooltip: str = "") -> str:
    safe_href = html.escape(href, quote=True)
    safe_classes = html.escape(classes, quote=True)
    click_js = (
        "if (event.button===0 && !event.metaKey && !event.ctrlKey && "
        "!event.shiftKey && !event.altKey) { "
        "try { "
        "var w=(window.parent && window.parent.document) ? window.parent : window; "
        "if (w.__ghSaveScroll) { w.__ghSaveScroll(); } "
        "w.location.assign(this.href); "
        "} catch (error) { window.location.assign(this.href); } "
        "return false; "
        "}"
    )
    safe_click_js = html.escape(click_js, quote=True)
    tooltip_attrs = ""
    if _normalize_str(tooltip):
        safe_tooltip = html.escape(_normalize_str(tooltip), quote=True)
        tooltip_attrs = f' data-gh-tooltip="{safe_tooltip}"'
    return (
        f'class="{safe_classes}" href="{safe_href}" data-gh-route="1" '
        f'target="_self" onclick="{safe_click_js}"{tooltip_attrs}'
    )


def _render_data_table(df: pd.DataFrame, *, max_rows: int = 200) -> None:
    if df is None:
        return
    view = df.copy()
    truncated = len(view) > max_rows
    view = view.head(max_rows).fillna("")
    header_html = "".join(f"<th>{html.escape(str(col))}</th>" for col in view.columns)
    row_html = []
    for _, row in view.iterrows():
        cells = "".join(
            f"<td>{html.escape(_normalize_str(value))}</td>" for value in row.tolist()
        )
        row_html.append(f"<tr>{cells}</tr>")
    st.markdown(
        f"""
<div class="gh-table-wrap">
  <table class="gh-table">
    <thead><tr>{header_html}</tr></thead>
    <tbody>{''.join(row_html)}</tbody>
  </table>
</div>
        """,
        unsafe_allow_html=True,
    )
    if truncated:
        st.caption(f"Showing first {max_rows} rows.")


def _render_columns_table(
    df: pd.DataFrame,
    asset_fqn: str,
    role: str,
    *,
    max_rows: int = 200,
) -> None:
    if df is None:
        return
    view = df.copy()
    truncated = len(view) > max_rows
    view = view.head(max_rows).fillna("")
    headers = ["Ordinal Position", "Column Name", "Data Type", "Comment"]
    header_html = "".join(f"<th>{html.escape(col)}</th>" for col in headers)
    rows_html: List[str] = []
    can_propose = role in {"reader", "writer", "admin"}
    for _, row in view.iterrows():
        column_name = _normalize_str(row.get("column_name"))
        raw_comment = _normalize_str(row.get("comment"))
        if can_propose and column_name:
            action_label = raw_comment or (
                "Add comment" if role in {"writer", "admin"} else "Suggest comment"
            )
            href = _asset_query_href(
                asset_fqn,
                section="Schema",
                column_edit=column_name,
            )
            comment_html = (
                f"<a {_route_link_attrs(href, 'gh-action-badge primary')}>"
                f"{html.escape(shorten(action_label, width=90, placeholder='...'))}"
                "</a>"
            )
        else:
            comment_html = html.escape(raw_comment)
        rows_html.append(
            "<tr>"
            f"<td>{html.escape(_normalize_str(row.get('ordinal_position')))}</td>"
            f"<td>{html.escape(column_name)}</td>"
            f"<td>{html.escape(_normalize_str(row.get('data_type')))}</td>"
            f"<td>{comment_html}</td>"
            "</tr>"
        )
    st.markdown(
        f"""
<div class="gh-table-wrap">
  <table class="gh-table">
    <thead><tr>{header_html}</tr></thead>
    <tbody>{''.join(rows_html)}</tbody>
  </table>
</div>
        """,
        unsafe_allow_html=True,
    )
    if truncated:
        st.caption(f"Showing first {max_rows} rows.")


def _tag_suggestion_map(inventory: pd.DataFrame) -> Dict[str, List[str]]:
    suggestions: Dict[str, set[str]] = {}
    if inventory is None or inventory.empty:
        return {}
    for tags in inventory.get("tags", pd.Series(dtype=object)).tolist():
        if not isinstance(tags, dict):
            continue
        for key, value in tags.items():
            tag_key = _normalize_str(key)
            tag_value = _normalize_str(value)
            if not tag_key or tag_key in _STANDARD_TAG_KEYS:
                continue
            suggestions.setdefault(tag_key, set())
            if tag_value:
                suggestions[tag_key].add(tag_value)
    return {
        key: sorted(values)
        for key, values in sorted(suggestions.items(), key=lambda item: item[0])
    }


def _principal_option_map(principals_df: pd.DataFrame) -> Dict[str, str]:
    if principals_df is None or principals_df.empty:
        return {}
    labels: Dict[str, str] = {}
    for row in principals_df.to_dict("records"):
        email = _normalize_str(row.get("email"))
        display_name = _normalize_str(row.get("display_name")) or email
        if not email:
            continue
        labels[email] = f"{display_name} ({email})"
    return labels


def _render_styles() -> None:
    st.markdown(
        """
<style>
  :root {
    --gh-bg: #edf2fb;
    --gh-surface: rgba(255, 255, 255, 0.9);
    --gh-surface-alt: rgba(240, 245, 255, 0.92);
    --gh-border: #d4dff0;
    --gh-input-bg: rgba(242, 247, 255, 0.92);
    --gh-input-border: #c8d7ee;
    --gh-focus-ring: rgba(70, 108, 237, 0.16);
    --gh-primary: #315fd8;
    --gh-primary-strong: #2246a8;
    --gh-secondary: #6d8dff;
    --gh-accent: #9472ff;
    --gh-accent-soft: #efe7ff;
    --gh-peach: #ff936e;
    --gh-peach-soft: rgba(255, 147, 110, 0.14);
    --gh-peach-border: rgba(255, 147, 110, 0.28);
    --gh-text: #162033;
    --gh-muted: #5e6c84;
    --gh-good: #127863;
    --gh-warn: #9a6b00;
    --gh-danger: #b13a4b;
    --gh-shadow: 0 16px 40px rgba(18, 32, 63, 0.08);
  }

  .stApp {
    overflow-x: hidden;
    background:
      linear-gradient(62deg, transparent 0 16%, rgba(81, 112, 212, 0.08) 16.2% 16.35%, transparent 16.55% 100%),
      linear-gradient(118deg, transparent 0 23%, rgba(129, 105, 235, 0.07) 23.2% 23.38%, transparent 23.58% 100%),
      linear-gradient(146deg, transparent 0 41%, rgba(90, 173, 245, 0.07) 41.2% 41.38%, transparent 41.58% 100%),
      linear-gradient(171deg, transparent 0 66%, rgba(108, 79, 207, 0.06) 66.15% 66.3%, transparent 66.52% 100%),
      radial-gradient(circle at 12% 18%, rgba(66, 103, 232, 0.14) 0 3px, transparent 4px),
      radial-gradient(circle at 30% 30%, rgba(144, 112, 255, 0.12) 0 4px, transparent 5px),
      radial-gradient(circle at 82% 22%, rgba(93, 181, 255, 0.13) 0 3px, transparent 4px),
      radial-gradient(circle at 74% 72%, rgba(140, 110, 250, 0.11) 0 4px, transparent 5px),
      radial-gradient(circle at 18% 82%, rgba(84, 190, 255, 0.1) 0 3px, transparent 4px),
      radial-gradient(circle at 0% 0%, rgba(43, 84, 208, 0.22), transparent 28%),
      radial-gradient(circle at 100% 0%, rgba(149, 111, 255, 0.18), transparent 26%),
      radial-gradient(circle at 18% 84%, rgba(103, 196, 255, 0.16), transparent 22%),
      radial-gradient(circle at 86% 78%, rgba(79, 54, 170, 0.16), transparent 24%),
      linear-gradient(135deg, #edf6ff 0%, #eef2ff 34%, #f4eeff 68%, #eef2ff 100%),
      var(--gh-bg);
    color: var(--gh-text);
  }

  .block-container {
    max-width: min(1760px, calc(100vw - 2rem));
    padding-top: 0.9rem;
    padding-bottom: 2rem;
    padding-left: 1.35rem;
    padding-right: 1.35rem;
  }

  [data-testid="stSidebar"],
  [data-testid="collapsedControl"],
  [data-testid="stHeader"],
  [data-testid="stDecoration"],
  [data-testid="stStatusWidget"],
  [data-testid="stToolbar"] {
    display: none;
  }

  .gh-loading-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.15rem;
    margin-bottom: 1rem;
    border-radius: 22px;
    border: 1px solid var(--gh-border);
    background:
      linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.96),
        rgba(237, 244, 255, 0.92) 46%,
        rgba(245, 238, 255, 0.9) 100%
      );
    box-shadow: var(--gh-shadow);
  }

  .gh-loading-spinner {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 3px solid rgba(34, 87, 216, 0.16);
    border-top-color: var(--gh-primary);
    animation: gh-spin 0.85s linear infinite;
    flex: 0 0 auto;
  }

  .gh-loading-title {
    font-size: 0.96rem;
    font-weight: 800;
    color: var(--gh-text);
  }

  .gh-loading-copy {
    color: var(--gh-muted);
    font-size: 0.9rem;
    margin-top: 0.15rem;
  }

  h1, h2, h3, h4 {
    color: var(--gh-text);
    letter-spacing: -0.02em;
  }

  .gh-shell {
    padding: 1.5rem 1.7rem;
    border-radius: 28px;
    background:
      linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.96),
        rgba(239, 245, 255, 0.92) 42%,
        rgba(244, 238, 255, 0.9) 100%
      ),
      var(--gh-surface);
    border: 1px solid var(--gh-border);
    box-shadow: var(--gh-shadow);
    margin-bottom: 1rem;
    position: relative;
    overflow: hidden;
  }

  .gh-shell::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 18% 22%, rgba(90, 161, 255, 0.12), transparent 22%),
      radial-gradient(circle at 82% 18%, rgba(147, 114, 255, 0.12), transparent 24%);
  }

  .gh-shell-top {
    display: grid;
    grid-template-columns: minmax(0, 1.02fr) minmax(560px, 0.98fr);
    gap: 1.35rem;
    align-items: stretch;
    position: relative;
    z-index: 1;
  }

  .gh-shell-intro {
    min-width: 0;
  }

  .gh-shell-side {
    display: grid;
    min-width: 0;
    height: 100%;
  }

  .gh-estate-overview {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-radius: 22px;
    padding: 1.1rem 1.16rem 1.2rem;
    border: 1px solid rgba(198, 212, 237, 0.94);
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.92),
        rgba(241, 246, 255, 0.9) 56%,
        rgba(246, 239, 255, 0.86) 100%
      );
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
    backdrop-filter: blur(12px);
  }

  .gh-estate-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .gh-estate-title {
    margin-bottom: 0;
    font-size: 0.92rem;
    font-weight: 880;
    letter-spacing: 0.15em;
    color: #526682;
  }

  .gh-estate-chip-row {
    justify-content: flex-end;
    gap: 0.55rem;
  }

  .gh-estate-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.7rem;
    margin-top: 0.8rem;
  }

  .gh-estate-stat {
    border-radius: 16px;
    padding: 0.78rem 0.82rem;
    border: 1px solid rgba(206, 218, 239, 0.88);
    background: rgba(250, 252, 255, 0.92);
  }

  .gh-estate-stat-label {
    font-size: 0.67rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #617390;
    margin-bottom: 0.24rem;
  }

  .gh-estate-stat-value {
    font-size: 1.18rem;
    font-weight: 840;
    color: var(--gh-text);
    letter-spacing: -0.03em;
  }

  .gh-brand {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .gh-brand-mark {
    width: 64px;
    height: 64px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(145deg, #173a8c 0%, #4477ff 55%, #8d6df8 100%);
    box-shadow: 0 16px 30px rgba(61, 91, 214, 0.24);
    color: #ffffff;
    font-size: 1.15rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .gh-wordmark {
    margin: 0;
    font-size: 3rem;
    line-height: 1;
    font-weight: 900;
    letter-spacing: -0.04em;
    color: #13203a;
  }

  .gh-wordmark span {
    background: linear-gradient(90deg, #2a58dd 0%, #5d85ff 48%, #8c6cf6 100%);
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
  }

  .gh-wordmark-rule {
    width: 160px;
    height: 6px;
    border-radius: 999px;
    margin-top: 0.8rem;
    background: linear-gradient(90deg, #2149a8, #67a2ff 52%, #9073ff 100%);
  }

  .gh-eyebrow {
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    color: var(--gh-primary);
    font-weight: 700;
    margin-bottom: 0.65rem;
  }

  .gh-shell h1 {
    margin: 0;
    font-size: 3rem;
    line-height: 1;
  }

  .gh-shell-copy {
    max-width: 820px;
    margin-top: 0.7rem;
    color: var(--gh-muted);
    font-size: 1.02rem;
    line-height: 1.6;
  }

  .gh-shell-subcopy {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-top: 0.8rem;
  }

  .gh-shell-flag {
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    padding: 0.42rem 0.72rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.74);
    border: 1px solid rgba(196, 211, 237, 0.9);
    color: #33435f;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .gh-chip-row {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .gh-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.55rem 0.85rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid var(--gh-border);
    color: var(--gh-text);
    font-size: 0.86rem;
    font-weight: 600;
  }

  .gh-chip.good {
    color: var(--gh-good);
    border-color: rgba(18, 120, 99, 0.24);
    background: rgba(18, 120, 99, 0.08);
  }

  .gh-panel {
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.94),
        rgba(241, 246, 255, 0.9) 56%,
        rgba(245, 240, 255, 0.88) 100%
      );
    border: 1px solid var(--gh-border);
    border-radius: 22px;
    padding: 1.1rem 1.2rem;
    box-shadow: 0 12px 28px rgba(18, 32, 63, 0.05);
    margin-bottom: 1rem;
  }

  .gh-panel h3, .gh-panel h4 {
    margin-top: 0;
  }

  .gh-panel-label {
    font-size: 0.82rem;
    color: var(--gh-muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 700;
    margin-bottom: 0.45rem;
  }

  .gh-section-title {
    margin: 0 0 0.3rem 0;
    font-size: 1.6rem;
  }

  .gh-section-copy {
    margin: 0;
    color: var(--gh-muted);
  }

  .gh-asset-card {
    padding: 1rem 1rem 0.9rem;
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(247, 243, 255, 0.84));
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
    margin-bottom: 0.6rem;
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;
  }

  .gh-asset-main-link,
  .gh-asset-footer-link {
    display: block;
    color: inherit !important;
    text-decoration: none !important;
    cursor: pointer;
  }

  .gh-asset-main-link:hover,
  .gh-asset-footer-link:hover {
    color: inherit !important;
    text-decoration: none !important;
  }

  .gh-asset-card:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 133, 96, 0.36);
    box-shadow:
      0 0 0 2px rgba(255, 146, 110, 0.24),
      0 18px 32px rgba(22, 40, 81, 0.1),
      0 0 24px rgba(255, 146, 110, 0.12);
  }

  .gh-asset-card.active {
    border-color: rgba(34, 87, 216, 0.34);
    box-shadow: 0 18px 32px rgba(34, 87, 216, 0.12);
    background:
      linear-gradient(
        135deg,
        rgba(242, 247, 255, 0.95),
        rgba(248, 241, 255, 0.9) 68%,
        rgba(255, 255, 255, 0.98)
      );
  }

  .gh-asset-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.45rem;
  }

  .gh-asset-name {
    font-size: 1.56rem;
    font-weight: 820;
    color: var(--gh-text);
    line-height: 1.22;
  }

  .gh-asset-fqn {
    font-size: 0.82rem;
    color: var(--gh-muted);
    margin-top: 0.15rem;
  }

  .gh-asset-context {
    font-size: 0.8rem;
    color: #627390;
    margin-top: 0.18rem;
    font-weight: 600;
  }

  .gh-score {
    min-width: 4.6rem;
    padding: 0.42rem 0.58rem;
    border-radius: 14px;
    background: linear-gradient(
      145deg,
      rgba(49, 95, 216, 0.12),
      rgba(149, 114, 255, 0.14)
    );
    border: 1px solid rgba(74, 111, 223, 0.18);
    text-align: center;
  }

  .gh-score-label {
    display: block;
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #5771a5;
    margin-bottom: 0.08rem;
  }

  .gh-score-value {
    display: block;
    color: var(--gh-primary);
    font-weight: 850;
    font-size: 1rem;
    letter-spacing: -0.03em;
  }

  .gh-asset-copy {
    color: var(--gh-muted);
    font-size: 0.92rem;
    line-height: 1.55;
    min-height: 2.85rem;
  }

  .gh-signal-row {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    margin-top: 0.78rem;
  }

  .gh-action-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: 999px;
    padding: 0.32rem 0.62rem;
    font-size: 0.74rem;
    font-weight: 800;
    text-decoration: none !important;
    border: 1px solid transparent;
    transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  }

  .gh-action-badge:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 20px rgba(21, 36, 72, 0.08);
    text-decoration: none !important;
  }

  .gh-action-badge.warn {
    background: rgba(255, 242, 218, 0.9);
    color: #9a6b00 !important;
    border-color: rgba(154, 107, 0, 0.16);
  }

  .gh-action-badge.danger {
    background: rgba(255, 236, 240, 0.92);
    color: #b13a4b !important;
    border-color: rgba(177, 58, 75, 0.16);
  }

  .gh-action-badge.primary {
    background: rgba(234, 242, 255, 0.94);
    color: #2457d8 !important;
    border-color: rgba(36, 87, 216, 0.18);
  }

  .gh-badge-row {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
  }

  .gh-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.3rem 0.58rem;
    font-size: 0.74rem;
    font-weight: 700;
    background: rgba(21, 52, 108, 0.06);
    color: var(--gh-text);
  }

  .gh-badge-primary {
    background: rgba(34, 87, 216, 0.12);
    color: var(--gh-primary);
  }

  .gh-badge-good {
    background: rgba(18, 120, 99, 0.12);
    color: var(--gh-good);
  }

  .gh-badge-warn {
    background: rgba(154, 107, 0, 0.12);
    color: var(--gh-warn);
  }

  .gh-badge-danger {
    background: rgba(177, 58, 75, 0.12);
    color: var(--gh-danger);
  }

  .gh-meta-row {
    display: flex;
    gap: 0.9rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
    color: var(--gh-muted);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .gh-profile-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }

  .gh-profile-title {
    font-size: 1.8rem;
    font-weight: 800;
    margin: 0;
  }

  .gh-profile-fqn {
    color: var(--gh-muted);
    margin-top: 0.3rem;
    font-size: 0.92rem;
  }

  .gh-profile-copy {
    color: var(--gh-muted);
    line-height: 1.65;
    font-size: 0.96rem;
    margin-top: 0.8rem;
  }

  .gh-context-panel {
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(244, 248, 255, 0.88));
    padding: 1rem 1.05rem;
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
    margin-bottom: 1rem;
  }

  .gh-context-description {
    color: var(--gh-text);
    line-height: 1.65;
    font-size: 0.96rem;
    margin: 0 0 0.85rem 0;
  }

  .gh-context-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.6rem 0.85rem;
  }

  .gh-subnav-shell {
    margin-top: 0.25rem;
  }

  .gh-subnav-label {
    font-size: 0.88rem;
    font-weight: 880;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #657794;
    margin-bottom: 0.6rem;
  }

  .gh-subnav {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.46rem;
    padding: 0.38rem;
    border-radius: 999px;
    border: 1px solid rgba(198, 212, 237, 0.94);
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
  }

  .gh-subnav-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.9rem;
    padding: 0.7rem 1.28rem;
    border-radius: 999px;
    border: 1px solid transparent;
    color: #50627f !important;
    text-decoration: none !important;
    font-size: 1.02rem;
    font-weight: 790;
    letter-spacing: -0.01em;
    transition:
      background 0.18s ease,
      color 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }

  .gh-subnav-link:hover {
    background:
      linear-gradient(
        145deg,
        rgba(250, 252, 255, 0.98),
        rgba(244, 247, 255, 0.96) 58%,
        rgba(246, 241, 255, 0.94) 100%
      ) padding-box,
      linear-gradient(
        135deg,
        rgba(72, 106, 222, 0.7),
        rgba(144, 117, 255, 0.68)
      ) border-box;
    color: #4258bf !important;
    text-decoration: none !important;
    transform: none;
    box-shadow:
      0 0 0 1px rgba(105, 125, 226, 0.08),
      0 10px 18px rgba(87, 105, 210, 0.08);
  }

  .gh-subnav-link.active {
    background: linear-gradient(
      135deg,
      rgba(49, 95, 216, 0.12),
      rgba(109, 141, 255, 0.12) 52%,
      rgba(148, 114, 255, 0.14) 100%
    );
    color: var(--gh-primary) !important;
    box-shadow: inset 0 0 0 1px rgba(49, 95, 216, 0.12);
  }

  .gh-module-shell {
    margin-bottom: 1rem;
    padding: 1.05rem 1.1rem 1.12rem;
    border-radius: 24px;
    border: 1px solid rgba(196, 211, 237, 0.96);
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.96),
        rgba(240, 246, 255, 0.92) 54%,
        rgba(246, 239, 255, 0.88) 100%
      );
    box-shadow: 0 12px 28px rgba(18, 32, 63, 0.05);
  }

  .gh-module-shell-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.82rem;
  }

  .gh-module-shell-title {
    font-size: 1.14rem;
    font-weight: 920;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #41597e;
  }

  .gh-module-nav {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.7rem;
  }

  .gh-module-link,
  .gh-module-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 3.35rem;
    border-radius: 18px;
    border: 1px solid rgba(194, 209, 236, 0.96);
    background: rgba(255, 255, 255, 0.92);
    color: #1f2e48 !important;
    text-decoration: none !important;
    font-size: 1.08rem;
    font-weight: 800;
    box-shadow: 0 10px 22px rgba(18, 32, 63, 0.03);
    transition:
      transform 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      background 0.18s ease,
      color 0.18s ease;
  }

  .gh-module-link:hover,
  .gh-module-help:hover {
    background: rgba(255, 241, 236, 0.94);
    color: #9e4f2f !important;
    border-color: var(--gh-peach-border);
    box-shadow:
      0 0 0 2px rgba(255, 146, 110, 0.16),
      0 16px 30px rgba(22, 40, 81, 0.09);
    transform: translateY(-1px);
    text-decoration: none !important;
  }

  .gh-module-link.active,
  .gh-module-help.active {
    border-color: rgba(49, 95, 216, 0.22);
    background: linear-gradient(
      135deg,
      #315fd8 0%,
      #5c87ff 56%,
      #8f71ff 100%
    );
    color: #ffffff !important;
    box-shadow: 0 18px 34px rgba(47, 86, 204, 0.2);
  }

  .gh-module-help {
    width: 3.2rem;
    flex-shrink: 0;
    font-size: 1.15rem;
    font-weight: 860;
  }

  .gh-context-fact {
    border-radius: 14px;
    padding: 0.72rem 0.82rem;
    background: rgba(247, 250, 255, 0.9);
    border: 1px solid rgba(206, 218, 239, 0.8);
  }

  .gh-context-fact-label {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #657794;
    margin-bottom: 0.22rem;
  }

  .gh-context-fact-value {
    color: var(--gh-text);
    font-weight: 700;
    line-height: 1.4;
  }

  .gh-lineage-node {
    padding: 0.9rem 1rem;
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(245, 240, 255, 0.82));
    margin-bottom: 0.7rem;
  }

  .gh-lineage-link {
    display: block;
    text-decoration: none !important;
    color: inherit !important;
    cursor: pointer;
  }

  .gh-lineage-link:hover {
    text-decoration: none !important;
    color: inherit !important;
  }

  .gh-lineage-link .gh-lineage-node {
    transition:
      transform 0.16s ease,
      box-shadow 0.16s ease,
      border-color 0.16s ease;
  }

  .gh-lineage-link:hover .gh-lineage-node {
    transform: translateY(-1px);
    border-color: rgba(255, 133, 96, 0.34);
    box-shadow:
      0 0 0 2px rgba(255, 146, 110, 0.2),
      0 16px 28px rgba(22, 40, 81, 0.1),
      0 0 22px rgba(255, 146, 110, 0.1);
  }

  .gh-lineage-node.focus {
    border-color: rgba(34, 87, 216, 0.3);
    padding: 1.18rem 1.15rem;
    background:
      linear-gradient(
        135deg,
        rgba(237, 244, 255, 0.95),
        rgba(244, 239, 255, 0.9) 72%,
        rgba(255, 255, 255, 0.98)
      );
    box-shadow:
      0 0 0 2px rgba(76, 118, 236, 0.14),
      0 18px 34px rgba(34, 87, 216, 0.12);
  }

  .gh-lineage-label {
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--gh-muted);
    margin-bottom: 0.35rem;
  }

  .gh-lineage-node .gh-asset-name {
    font-size: 1.18rem;
    font-weight: 820;
    line-height: 1.2;
  }

  .gh-lineage-node.focus .gh-asset-name {
    font-size: 1.52rem;
    line-height: 1.16;
  }

  .gh-lineage-node.focus .gh-asset-context {
    font-size: 0.92rem;
    margin-top: 0.26rem;
  }

  .gh-lineage-summary {
    padding: 0.95rem 1rem;
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(244, 239, 255, 0.84));
  }

  .gh-lineage-summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem 0.9rem;
    margin-top: 0.4rem;
  }

  .gh-lineage-summary-item {
    border-radius: 14px;
    padding: 0.7rem 0.78rem;
    background: rgba(247, 250, 255, 0.92);
    border: 1px solid rgba(204, 216, 238, 0.82);
  }

  .gh-lineage-summary-item-label {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #657794;
    margin-bottom: 0.22rem;
  }

  .gh-lineage-summary-item-value {
    color: var(--gh-text);
    font-weight: 700;
    line-height: 1.45;
  }

  .gh-lineage-summary-note {
    margin-top: 0.75rem;
    color: var(--gh-muted);
    line-height: 1.55;
  }

  .gh-profile-panel {
    padding: 1.22rem 1.25rem 1.12rem;
  }

  .gh-profile-shell {
    display: grid;
    grid-template-columns: minmax(0, 0.95fr) minmax(760px, 1.18fr);
    gap: 1rem 1.2rem;
    align-items: stretch;
  }

  .gh-profile-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 9.3rem;
  }

  .gh-profile-title {
    font-size: 2.55rem;
    font-weight: 860;
    margin: 0;
    line-height: 1.08;
    letter-spacing: -0.04em;
  }

  .gh-profile-stats {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.82rem;
    align-content: stretch;
  }

  .gh-profile-stat {
    min-width: 0;
    border-radius: 18px;
    min-height: 4.95rem;
    padding: 0.96rem 0.92rem;
    border: 1px solid rgba(205, 217, 239, 0.88);
    background: rgba(250, 252, 255, 0.92);
    box-shadow: 0 10px 22px rgba(18, 32, 63, 0.03);
  }

  .gh-profile-stat-label {
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #617390;
    margin-bottom: 0.24rem;
  }

  .gh-profile-stat-value {
    color: var(--gh-text);
    font-size: 1.72rem;
    font-weight: 840;
    line-height: 1.12;
    letter-spacing: -0.04em;
    word-break: break-word;
  }

  .gh-operational-section {
    margin-top: 1rem;
    margin-bottom: 0.5rem;
  }

  .gh-operational-grid {
    display: grid;
    gap: 0.75rem;
  }

  .gh-operational-card {
    padding: 0;
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.95),
        rgba(241, 246, 255, 0.9) 58%,
        rgba(246, 239, 255, 0.86) 100%
      );
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
    overflow: hidden;
  }

  .gh-operational-summary {
    list-style: none;
    cursor: pointer;
    padding: 0.98rem 1rem 0.95rem;
  }

  .gh-operational-summary::-webkit-details-marker {
    display: none;
  }

  .gh-operational-summary::marker {
    content: "";
  }

  .gh-operational-card.expandable .gh-operational-summary {
    transition:
      background 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;
  }

  .gh-operational-card.expandable .gh-operational-summary:hover {
    background: linear-gradient(
      145deg,
      rgba(255, 248, 244, 0.96),
      rgba(247, 239, 255, 0.88)
    );
    box-shadow: inset 0 0 0 1px rgba(255, 147, 110, 0.16);
  }

  .gh-operational-card[open] .gh-operational-summary {
    border-bottom: 1px solid rgba(202, 214, 237, 0.86);
    background: linear-gradient(
      145deg,
      rgba(248, 251, 255, 0.97),
      rgba(246, 241, 255, 0.9)
    );
  }

  .gh-operational-head {
    display: flex;
    justify-content: space-between;
    gap: 0.85rem;
    align-items: flex-start;
    margin-bottom: 0.45rem;
  }

  .gh-operational-head-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .gh-operational-type {
    display: block;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #657794;
    margin-bottom: 0.2rem;
  }

  .gh-operational-title {
    display: block;
    color: var(--gh-text);
    font-size: 1.16rem;
    font-weight: 810;
    line-height: 1.35;
  }

  .gh-operational-subtitle {
    display: block;
    color: var(--gh-muted);
    font-size: 0.82rem;
    line-height: 1.45;
    margin-top: 0.22rem;
  }

  .gh-operational-count {
    flex-shrink: 0;
    border-radius: 999px;
    padding: 0.34rem 0.62rem;
    background: rgba(34, 87, 216, 0.1);
    color: var(--gh-primary);
    font-size: 0.74rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .gh-operational-note {
    display: block;
    color: var(--gh-muted);
    font-size: 0.88rem;
    line-height: 1.55;
    margin-bottom: 0.4rem;
  }

  .gh-operational-pill-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .gh-operational-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.28rem 0.52rem;
    border-radius: 999px;
    background: rgba(246, 248, 253, 0.94);
    border: 1px solid rgba(207, 219, 240, 0.85);
    color: #546684;
    font-size: 0.74rem;
    font-weight: 700;
  }

  .gh-operational-pill-link {
    text-decoration: none !important;
    transition:
      background 0.16s ease,
      border-color 0.16s ease,
      color 0.16s ease,
      box-shadow 0.16s ease;
  }

  .gh-operational-pill-link:hover {
    background: rgba(235, 240, 255, 0.98);
    border-color: rgba(100, 120, 221, 0.34);
    color: #3650ba;
    box-shadow: 0 0 0 2px rgba(115, 132, 228, 0.08);
  }

  .gh-operational-detail-body {
    padding: 0.95rem 1rem 1rem;
  }

  .gh-operational-related {
    margin-bottom: 0.8rem;
  }

  .gh-operational-detail-grid {
    display: grid;
    gap: 0.68rem;
  }

  .gh-operational-detail-item {
    border-radius: 14px;
    padding: 0.78rem 0.84rem;
    border: 1px solid rgba(205, 217, 239, 0.86);
    background: rgba(250, 252, 255, 0.92);
  }

  .gh-operational-detail-label {
    font-size: 0.7rem;
    font-weight: 820;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #607290;
    margin-bottom: 0.18rem;
  }

  .gh-operational-detail-value {
    color: var(--gh-text);
    font-size: 0.9rem;
    line-height: 1.5;
    word-break: break-word;
  }

  div[data-testid="stMetric"] {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid var(--gh-border);
    border-radius: 18px;
    padding: 0.9rem 1rem;
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
  }

  div[data-testid="stMetricLabel"] {
    color: #50627f;
    font-weight: 700;
  }

  div[data-testid="stMetricValue"] {
    color: var(--gh-text);
  }

  div[data-testid="stWidgetLabel"] p,
  div[data-testid="stWidgetLabel"] span,
  .stCaption,
  label,
  .stMarkdown p {
    color: var(--gh-text) !important;
    opacity: 1 !important;
  }

  div[data-baseweb="notification"] {
    background: #dcebfa !important;
    border: 1px solid #bdd3ee !important;
    border-radius: 16px !important;
    box-shadow: none !important;
  }

  div[data-baseweb="notification"] * {
    color: #17314f !important;
    opacity: 1 !important;
  }

  .stButton > button,
  div[data-testid="stButton"] > button,
  button[kind="secondary"],
  button[kind="primary"] {
    border-radius: 14px;
    border: 1px solid var(--gh-border) !important;
    background: rgba(255, 255, 255, 0.95) !important;
    background-color: rgba(255, 255, 255, 0.95) !important;
    background-image: none !important;
    color: var(--gh-text) !important;
    font-weight: 700;
    min-height: 2.8rem;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }

  .stButton:hover > button,
  .stButton > button:hover,
  div[data-testid="stButton"]:hover > button,
  div[data-testid="stButton"] > button:hover,
  div[data-testid="stFormSubmitButton"]:hover > button,
  div[data-testid="stFormSubmitButton"] > button:hover {
    background: linear-gradient(
      145deg,
      rgba(255, 248, 244, 0.98),
      rgba(255, 241, 235, 0.96) 56%,
      rgba(249, 238, 255, 0.94) 100%
    ) !important;
    background-color: rgba(255, 246, 241, 0.97) !important;
    border-color: rgba(255, 118, 82, 0.48) !important;
    box-shadow:
      0 0 0 2px rgba(255, 142, 104, 0.26),
      0 14px 28px rgba(255, 118, 82, 0.16),
      0 0 18px rgba(255, 142, 104, 0.14) !important;
    transform: translateY(-1px);
  }

  .stButton > button:focus-visible,
  div[data-testid="stButton"] > button:focus-visible,
  div[data-testid="stFormSubmitButton"] > button:focus-visible {
    outline: none !important;
    box-shadow: 0 0 0 3px var(--gh-focus-ring) !important;
  }

  .stButton > button[kind="secondary"],
  div[data-testid="stButton"] > button[kind="secondary"],
  button[kind="secondary"] {
    background: rgba(255, 255, 255, 0.95) !important;
    background-color: rgba(255, 255, 255, 0.95) !important;
    background-image: none !important;
    color: var(--gh-text) !important;
    border: 1px solid var(--gh-border) !important;
  }

  .stButton > button[kind="primary"],
  div[data-testid="stButton"] > button[kind="primary"],
  button[kind="primary"] {
    background: linear-gradient(
      135deg,
      var(--gh-primary) 0%,
      var(--gh-secondary) 52%,
      var(--gh-accent) 100%
    ) !important;
    background-color: var(--gh-primary) !important;
    background-image: linear-gradient(
      135deg,
      var(--gh-primary) 0%,
      var(--gh-secondary) 52%,
      var(--gh-accent) 100%
    ) !important;
    color: white !important;
    border: none !important;
  }

  .stButton:hover > button[kind="primary"],
  .stButton > button[kind="primary"]:hover,
  div[data-testid="stButton"]:hover > button[kind="primary"],
  div[data-testid="stButton"] > button[kind="primary"]:hover,
  div[data-testid="stFormSubmitButton"]:hover > button,
  div[data-testid="stFormSubmitButton"] > button:hover {
    background: linear-gradient(
      135deg,
      var(--gh-primary-strong) 0%,
      #567eff 52%,
      #8c6cf6 100%
    ) !important;
    background-color: var(--gh-primary-strong) !important;
    color: #ffffff !important;
    box-shadow:
      0 0 0 2px rgba(255, 145, 108, 0.34),
      0 14px 28px rgba(42, 86, 219, 0.18),
      0 0 20px rgba(255, 145, 108, 0.18),
      0 0 0 1px rgba(255, 124, 92, 0.18) inset !important;
  }

  .stTextInput input, .stTextArea textarea,
  div[data-baseweb="input"] input,
  div[data-baseweb="base-input"] input {
    border-radius: 14px !important;
    background: transparent !important;
    color: #1d2940 !important;
    -webkit-text-fill-color: #1d2940 !important;
    caret-color: var(--gh-primary) !important;
    font-weight: 500;
  }

  .stTextInput > div > div,
  .stTextArea > div > div,
  div[data-baseweb="input"],
  div[data-baseweb="base-input"],
  div[data-testid="stFormSubmitButton"] > button {
    background: var(--gh-input-bg) !important;
    border: 1px solid var(--gh-input-border) !important;
    color: #1d2940 !important;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease !important;
  }

  .stTextInput > div > div:hover,
  .stTextArea > div > div:hover,
  div[data-baseweb="input"]:hover,
  div[data-baseweb="base-input"]:hover,
  [data-baseweb="select"] > div:hover {
    background: rgba(255, 255, 255, 0.95) !important;
    border-color: #b8c8de !important;
  }

  .stTextInput > div > div:focus-within,
  .stTextArea > div > div:focus-within,
  div[data-baseweb="input"]:focus-within,
  div[data-baseweb="base-input"]:focus-within,
  [data-baseweb="select"] > div:focus-within {
    background: #ffffff !important;
    border-color: rgba(34, 87, 216, 0.44) !important;
    box-shadow: 0 0 0 3px var(--gh-focus-ring) !important;
  }

  [data-baseweb="select"] > div {
    border-radius: 14px !important;
    background: var(--gh-input-bg) !important;
    border: 1px solid var(--gh-input-border) !important;
    color: #1d2940 !important;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease !important;
  }

  [data-baseweb="select"] * {
    color: #1d2940 !important;
    fill: #1d2940 !important;
  }

  .stTextInput input::placeholder,
  .stTextArea textarea::placeholder,
  div[data-baseweb="input"] input::placeholder,
  div[data-baseweb="base-input"] input::placeholder {
    color: #7686a0 !important;
    opacity: 1 !important;
  }

  div[data-testid="stFormSubmitButton"] > button {
    min-height: 2.8rem;
    font-weight: 700;
    background: linear-gradient(
      135deg,
      var(--gh-primary) 0%,
      var(--gh-secondary) 52%,
      var(--gh-accent) 100%
    ) !important;
    color: #ffffff !important;
    border: none !important;
    box-shadow: 0 14px 28px rgba(34, 87, 216, 0.18) !important;
  }

  div[data-testid="stFormSubmitButton"] > button[kind="primary"] {
    background: linear-gradient(
      135deg,
      var(--gh-primary) 0%,
      var(--gh-secondary) 52%,
      var(--gh-accent) 100%
    ) !important;
    color: #ffffff !important;
    border: none !important;
  }

  div[data-testid="stForm"]:has(button.gh-button-filter) {
    border-radius: 24px !important;
    border: 1px solid rgba(198, 212, 237, 0.94) !important;
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.95),
        rgba(240, 246, 255, 0.92) 56%,
        rgba(246, 239, 255, 0.88) 100%
      ) !important;
    box-shadow: 0 12px 28px rgba(18, 32, 63, 0.05) !important;
    padding: 1.15rem 1.15rem 1rem !important;
  }

  div[data-testid="stForm"]:has(button.gh-button-filter) div[data-testid="stMarkdownContainer"] h4 {
    font-size: 1.48rem !important;
    font-weight: 860 !important;
    letter-spacing: -0.03em !important;
    color: var(--gh-text) !important;
    margin-bottom: 0.34rem !important;
  }

  div[data-testid="stForm"]:has(button.gh-button-filter) [data-testid="stCaptionContainer"] p {
    color: #5d6d86 !important;
    line-height: 1.55 !important;
    margin-bottom: 0.42rem !important;
  }

  div[data-testid="stForm"]:has(button.gh-button-filter) > div {
    gap: 0.52rem !important;
  }

  div[data-testid="stMultiSelect"] [data-baseweb="tag"],
  [data-baseweb="select"] [data-baseweb="tag"] {
    border-radius: 999px !important;
    background: linear-gradient(
      145deg,
      rgba(238, 243, 255, 0.98),
      rgba(233, 239, 255, 0.96) 58%,
      rgba(240, 236, 255, 0.96) 100%
    ) !important;
    background-color: rgba(236, 241, 255, 0.97) !important;
    border: 1px solid rgba(133, 152, 234, 0.34) !important;
    color: #4b61c6 !important;
    fill: #4b61c6 !important;
    box-shadow: inset 0 0 0 1px rgba(120, 142, 229, 0.06);
  }

  div[data-testid="stMultiSelect"] [data-baseweb="tag"] > *,
  [data-baseweb="select"] [data-baseweb="tag"] > * {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  div[data-testid="stMultiSelect"] [data-baseweb="tag"] *,
  [data-baseweb="select"] [data-baseweb="tag"] * {
    color: #4b61c6 !important;
    fill: #4b61c6 !important;
    font-weight: 700 !important;
  }

  div[data-testid="stFormSubmitButton"] > button.gh-button-filter {
    background:
      linear-gradient(
        145deg,
        rgba(230, 238, 255, 0.98),
        rgba(220, 230, 255, 0.98) 100%
      ) padding-box,
      linear-gradient(
        135deg,
        rgba(124, 145, 232, 0.58),
        rgba(146, 124, 239, 0.54)
      ) border-box !important;
    color: #3d55c0 !important;
    border: 1px solid transparent !important;
    box-shadow: 0 10px 22px rgba(91, 110, 213, 0.1) !important;
  }

  div[data-testid="stFormSubmitButton"] > button.gh-button-filter:hover {
    background:
      linear-gradient(
        145deg,
        rgba(234, 241, 255, 0.99),
        rgba(225, 233, 255, 0.99) 100%
      ) padding-box,
      linear-gradient(
        135deg,
        rgba(58, 95, 221, 0.86),
        rgba(141, 114, 255, 0.84)
      ) border-box !important;
    color: #3049b4 !important;
    box-shadow:
      0 0 0 1px rgba(97, 118, 222, 0.08),
      0 12px 20px rgba(86, 104, 208, 0.1) !important;
    transform: none !important;
  }

  [data-gh-tooltip] {
    position: relative;
  }

  [data-gh-tooltip]::after {
    content: attr(data-gh-tooltip);
    position: absolute;
    left: 50%;
    bottom: calc(100% + 0.55rem);
    transform: translate(-50%, 8px);
    min-width: 180px;
    max-width: 280px;
    padding: 0.46rem 0.58rem;
    border-radius: 10px;
    background: rgba(28, 38, 60, 0.96);
    color: #f7fbff;
    font-size: 0.78rem;
    line-height: 1.4;
    font-weight: 600;
    text-align: left;
    box-shadow: 0 16px 28px rgba(18, 32, 63, 0.24);
    opacity: 0;
    pointer-events: none;
    z-index: 40;
    transition: opacity 0.1s ease, transform 0.1s ease;
    transition-delay: 0s;
  }

  [data-gh-tooltip]:hover::after,
  [data-gh-tooltip]:focus-visible::after {
    opacity: 1;
    transform: translate(-50%, 0);
    transition-delay: 0.32s;
  }

  div[data-testid="stSpinner"] {
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background: rgba(255, 255, 255, 0.94);
    padding: 0.85rem 1rem;
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.05);
  }

  div[data-testid="stSpinner"] * {
    color: var(--gh-text) !important;
  }

  .stTabs [data-baseweb="tab-list"] {
    gap: 0.55rem;
  }

  .stTabs [data-baseweb="tab-highlight"],
  .stTabs [data-baseweb="tab-border"] {
    display: none !important;
  }

  .stTabs [data-baseweb="tab"] {
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.84);
    border: 1px solid var(--gh-border);
    padding: 0.5rem 0.9rem;
    font-weight: 700;
    color: var(--gh-text) !important;
    opacity: 1 !important;
  }

  .stTabs [aria-selected="true"] {
    background: rgba(34, 87, 216, 0.1);
    border-color: rgba(34, 87, 216, 0.2);
    color: var(--gh-primary);
  }

  .stRadio > div {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid var(--gh-border);
    border-radius: 18px;
    padding: 0.35rem 0.45rem;
  }

  .stRadio [role="radiogroup"] {
    gap: 0.35rem;
  }

  .gh-nav-spacer {
    margin-top: 0.55rem;
    margin-bottom: 0.15rem;
  }

  .gh-mini-panel {
    padding: 1rem 1.1rem;
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.95),
        rgba(242, 247, 255, 0.9) 54%,
        rgba(245, 239, 255, 0.86) 100%
      );
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
    margin-bottom: 1rem;
  }

  .gh-mini-copy {
    margin-top: 0.55rem;
    color: var(--gh-muted);
    line-height: 1.5;
  }

  .gh-action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.8rem;
    margin-bottom: 1rem;
  }

  .gh-action-card {
    position: relative;
    border-radius: 18px;
    padding: 0.92rem 1rem;
    border: 1px solid var(--gh-border);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(245, 241, 255, 0.86));
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.04);
    overflow: hidden;
  }

  .gh-action-card::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: rgba(34, 87, 216, 0.28);
  }

  .gh-action-card.danger {
    border-color: rgba(177, 58, 75, 0.18);
    background: linear-gradient(145deg, rgba(255, 247, 249, 0.96), rgba(255, 242, 245, 0.9));
  }

  .gh-action-card.danger::before {
    background: rgba(177, 58, 75, 0.48);
  }

  .gh-action-card.warn {
    border-color: rgba(154, 107, 0, 0.18);
    background: linear-gradient(145deg, rgba(255, 251, 244, 0.96), rgba(255, 247, 234, 0.9));
  }

  .gh-action-card.warn::before {
    background: rgba(154, 107, 0, 0.46);
  }

  .gh-action-card.primary {
    border-color: rgba(49, 95, 216, 0.18);
    background: linear-gradient(145deg, rgba(242, 247, 255, 0.97), rgba(242, 239, 255, 0.92));
  }

  .gh-action-card.primary::before {
    background: rgba(49, 95, 216, 0.44);
  }

  .gh-action-title {
    font-size: 0.88rem;
    font-weight: 800;
    color: var(--gh-text);
    margin-bottom: 0.2rem;
  }

  .gh-action-copy {
    color: var(--gh-muted);
    font-size: 0.84rem;
    line-height: 1.45;
  }

  .gh-subsection-title {
    margin: 0.2rem 0 0.45rem 0;
    font-size: 1.48rem;
    font-weight: 800;
    color: var(--gh-text);
    letter-spacing: -0.02em;
  }

  .gh-subsection-copy {
    margin: 0 0 0.55rem 0;
    color: var(--gh-muted);
    font-size: 0.88rem;
  }

  .gh-subsection-break {
    height: 0.4rem;
  }

  .gh-help-rail {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin: 0;
  }

  .gh-help-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.45rem;
    height: 2.45rem;
    border-radius: 14px;
    border: 1px solid var(--gh-border);
    background: rgba(255, 255, 255, 0.95);
    color: var(--gh-text) !important;
    font-weight: 800;
    text-decoration: none !important;
    box-shadow: 0 8px 20px rgba(18, 32, 63, 0.06);
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease,
      background 0.18s ease;
  }

  .gh-help-link:hover {
    border-color: rgba(34, 87, 216, 0.28);
    box-shadow: 0 14px 28px rgba(34, 87, 216, 0.16);
    transform: translateY(-1px);
    text-decoration: none !important;
  }

  .gh-help-link.active {
    background: linear-gradient(
      135deg,
      rgba(49, 95, 216, 0.14) 0%,
      rgba(109, 141, 255, 0.14) 52%,
      rgba(148, 114, 255, 0.16) 100%
    );
    border-color: rgba(49, 95, 216, 0.22);
    color: var(--gh-primary) !important;
  }

  .gh-tags-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 84px;
    gap: 0.85rem;
    margin-bottom: 0.45rem;
    color: #617390;
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .stButton button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none !important;
  }

  .gh-kicker {
    font-size: 0.76rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #617390;
    font-weight: 800;
    margin-bottom: 0.4rem;
  }

  .gh-table-wrap {
    overflow-x: auto;
    border-radius: 16px;
    border: 1px solid #d2dced;
    background: linear-gradient(180deg, #f7f9fd, #f4f6fd);
    box-shadow: 0 10px 24px rgba(18, 32, 63, 0.03);
  }

  .gh-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
    color: #22304a;
  }

  .gh-table thead {
    background: linear-gradient(180deg, #edf3fe, #e8effb);
  }

  .gh-table th {
    text-align: left;
    padding: 0.8rem 0.85rem;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #5c6d89;
    border-bottom: 1px solid #d2dced;
  }

  .gh-table td {
    padding: 0.8rem 0.85rem;
    border-top: 1px solid #e1e8f3;
    vertical-align: top;
    color: #22304a;
    background: rgba(255, 255, 255, 0.88);
  }

  .gh-table tbody tr:nth-child(even) td {
    background: #f3f6fe;
  }

  div[data-testid="stFormSubmitButton"] > button {
    min-height: 3rem;
    padding-inline: 1.15rem;
    border-radius: 12px !important;
    background: linear-gradient(135deg, #173f97 0%, #2f63e4 52%, #896df8 100%) !important;
    border: 1px solid rgba(17, 54, 136, 0.28) !important;
    box-shadow: 0 18px 34px rgba(34, 87, 216, 0.22) !important;
  }

  div[data-testid="stToggle"] label {
    padding: 0.2rem 0;
  }

  div[data-testid="stToggle"] [data-baseweb="checkbox"] {
    gap: 0.72rem !important;
  }

  div[data-testid="stToggle"] [data-baseweb="checkbox"] > div {
    width: 44px !important;
    min-width: 44px !important;
    height: 24px !important;
    border-radius: 999px !important;
    background: rgba(120, 132, 154, 0.52) !important;
    border: 1px solid rgba(96, 111, 139, 0.58) !important;
    position: relative !important;
    box-shadow: inset 0 1px 3px rgba(16, 26, 48, 0.16) !important;
  }

  div[data-testid="stToggle"] [data-baseweb="checkbox"] > div::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #f8fbff;
    border: 1px solid rgba(161, 176, 205, 0.4);
    box-shadow: 0 3px 8px rgba(19, 32, 58, 0.18);
    transition: transform 0.18s ease;
  }

  div[data-testid="stToggle"] input:checked + div {
    background: linear-gradient(135deg, #315fd8 0%, #678eff 50%, #8e71ff 100%) !important;
    border-color: transparent !important;
  }

  div[data-testid="stToggle"] input:checked + div::before {
    transform: translateX(20px);
  }

  details[data-testid="stExpander"] {
    border: 1px solid rgba(201, 214, 236, 0.9) !important;
    border-radius: 16px !important;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(244, 239, 255, 0.84)) !important;
    overflow: hidden;
  }

  details[data-testid="stExpander"] summary {
    color: var(--gh-text) !important;
    font-weight: 700 !important;
  }

  .stMarkdown code,
  div[data-testid="stSpinner"] code,
  p code,
  li code {
    background: rgba(98, 118, 172, 0.12) !important;
    color: #1e3f91 !important;
    border: 1px solid rgba(163, 181, 219, 0.32) !important;
    border-radius: 8px !important;
    padding: 0.12rem 0.42rem !important;
    font-size: 0.88em !important;
    box-shadow: none !important;
  }

  div[data-baseweb="popover"] > div {
    background:
      linear-gradient(
        160deg,
        rgba(255, 255, 255, 0.98),
        rgba(240, 246, 255, 0.96) 44%,
        rgba(246, 240, 255, 0.94) 100%
      ) !important;
    border: 1px solid rgba(198, 212, 237, 0.96) !important;
    border-radius: 18px !important;
    box-shadow: 0 22px 48px rgba(28, 46, 92, 0.18) !important;
    overflow: hidden !important;
  }

  div[data-baseweb="popover"] [role="listbox"],
  div[data-baseweb="popover"] ul {
    background: transparent !important;
    padding: 0.35rem !important;
  }

  div[data-baseweb="popover"] [role="option"],
  div[data-baseweb="popover"] li {
    background: transparent !important;
    color: #1a2740 !important;
    border-radius: 12px !important;
    margin: 0.08rem 0 !important;
    transition: background 0.16s ease, color 0.16s ease;
  }

  div[data-baseweb="popover"] [role="option"]:hover,
  div[data-baseweb="popover"] li:hover,
  div[data-baseweb="popover"] [aria-selected="true"] {
    background: rgba(52, 97, 220, 0.1) !important;
    color: #173277 !important;
  }

  div[data-baseweb="popover"] input {
    background: rgba(255, 255, 255, 0.94) !important;
    color: #1d2940 !important;
    -webkit-text-fill-color: #1d2940 !important;
    border-radius: 12px !important;
  }

  div[data-baseweb="popover"] input::placeholder {
    color: #7083a4 !important;
  }

  @keyframes gh-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 900px) {
    .gh-wordmark {
      font-size: 2.3rem;
    }

    .gh-shell-top {
      grid-template-columns: 1fr;
    }

    .gh-chip-row {
      justify-content: flex-start;
    }

    .gh-estate-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .gh-estate-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .gh-module-nav {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .gh-profile-shell {
      grid-template-columns: 1fr;
    }

    .gh-profile-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    [data-gh-tooltip]::after {
      left: 0;
      right: auto;
      transform: translate(0, 8px);
      min-width: 160px;
      max-width: 220px;
    }

    [data-gh-tooltip]:hover::after,
    [data-gh-tooltip]:focus-visible::after {
      transform: translate(0, 0);
    }

    .block-container {
      max-width: calc(100vw - 1.2rem);
      padding-left: 0.35rem;
      padding-right: 0.35rem;
    }
  }
</style>
        """,
        unsafe_allow_html=True,
    )


def _loading_card_html(title: str, copy: str) -> str:
    return f"""
<div class="gh-loading-card">
  <div class="gh-loading-spinner"></div>
  <div>
    <div class="gh-loading-title">{html.escape(title)}</div>
    <div class="gh-loading-copy">{html.escape(copy)}</div>
  </div>
</div>
    """


def _install_client_bootstrap() -> None:
    components.html(
        """
<script>
(function() {
  try {
    const rootWindow =
      window.parent && window.parent.document ? window.parent : window;
    const storage = rootWindow.sessionStorage;
    const key = "gh-scroll-y";
    const doc = rootWindow.document || window.document;
    const nodes = [
      doc.querySelector('[data-testid="stAppViewContainer"]'),
      doc.querySelector('section.main'),
      doc.scrollingElement,
      doc.documentElement,
      doc.body
    ].filter(Boolean);

    const restore = () => {
      const saved = storage.getItem(key);
      if (saved === null) {
        return;
      }
      const y = parseInt(saved, 10) || 0;
      setTimeout(() => {
        nodes.forEach((node) => {
          try {
            if (typeof node.scrollTo === "function") {
              node.scrollTo(0, y);
            } else {
              node.scrollTop = y;
            }
          } catch (error) {}
        });
      }, 40);
    };

    if (!rootWindow.__ghScrollInstalled) {
      const capture = () => {
        const node = nodes.find((item) => item && item.scrollTop > 0) || nodes[0];
        if (node) {
          storage.setItem(key, String(node.scrollTop || rootWindow.pageYOffset || 0));
        }
      };
      rootWindow.__ghSaveScroll = capture;
      rootWindow.addEventListener("scroll", capture, { passive: true });
      doc.addEventListener("click", capture, true);
      doc.addEventListener("input", capture, true);
      rootWindow.__ghScrollInstalled = true;
    }

    restore();
  } catch (error) {}
})();
</script>
        """,
        height=0,
        width=0,
    )


def _render_shell(
    role: str,
    user_email: str,
    inventory: pd.DataFrame,
) -> None:
    shell_stats = "".join(
        [
            _shell_stat_html("Assets", f"{len(inventory):,}"),
            _shell_stat_html(
                "Needs Attention",
                f"{_inventory_metric(inventory, _attention_mask(inventory)):,}",
            ),
            _shell_stat_html(
                "Certified",
                f"{_inventory_metric(inventory, inventory['certification'].ne('')):,}",
            ),
            _shell_stat_html(
                "With Stewards",
                f"{_inventory_metric(inventory, inventory['steward'].ne('')):,}",
            ),
            _shell_stat_html(
                "Sensitive Assets",
                f"{_inventory_metric(inventory, inventory['sensitivity'].ne('')):,}",
            ),
            _shell_stat_html(
                "Open Requests",
                f"{_inventory_metric(inventory, inventory['pending_requests'].gt(0)):,}",
            ),
        ]
    )
    st.markdown(
        f"""
<div class="gh-shell">
  <div class="gh-shell-top">
    <div class="gh-shell-intro">
      <div class="gh-eyebrow">Enterprise Metadata For Databricks</div>
      <div class="gh-brand">
        <div class="gh-brand-mark">GH</div>
        <div>
          <div class="gh-wordmark">Governance <span>Hub</span></div>
          <div class="gh-wordmark-rule"></div>
        </div>
      </div>
      <div class="gh-shell-copy">
        Search assets, inspect lineage, and keep ownership, documentation, and governance
        context current across Unity Catalog.
      </div>
    </div>
    <div class="gh-shell-side">
      <div class="gh-estate-overview">
        <div class="gh-estate-head">
          <div class="gh-panel-label gh-estate-title">Governance Estate Overview</div>
          <div class="gh-chip-row gh-estate-chip-row">
            <span class="gh-chip">{html.escape(role.title())}</span>
            <span class="gh-chip">{html.escape(user_email)}</span>
          </div>
        </div>
        <div class="gh-estate-grid">{shell_stats}</div>
      </div>
    </div>
  </div>
</div>
        """,
        unsafe_allow_html=True,
    )


def _empty_inventory() -> pd.DataFrame:
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


@st.cache_data(ttl=_META_TTL, show_spinner=False)
def _cached_asset_inventory(_uc: UCSQLClient, _store: GovernanceStore) -> pd.DataFrame:
    catalogs = _cached_bootstrap_catalogs(_uc)
    inventory_frames: List[pd.DataFrame] = []
    tag_maps: Dict[str, Dict[str, str]] = {}

    for catalog in catalogs:
        inv = _cached_catalog_inventory(_uc, catalog)
        if not inv.empty:
            inv = inv.copy()
            inv["comment"] = inv["comment"].map(_normalize_str)
            inv["fqn"] = (
                inv["table_catalog"].astype(str)
                + "."
                + inv["table_schema"].astype(str)
                + "."
                + inv["table_name"].astype(str)
            )
            inventory_frames.append(inv)

        tags_df = _cached_catalog_table_tags(_uc, catalog)
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
                _normalize_str(row.tag_name): _normalize_str(row.tag_value)
                for row in group.itertuples()
                if _normalize_str(row.tag_name)
            }

    if not inventory_frames:
        return _empty_inventory()

    inventory = pd.concat(inventory_frames, ignore_index=True)
    inventory = _filter_asset_rows(inventory, ["table_name", "fqn"])
    if inventory.empty:
        return _empty_inventory()
    inventory["tags"] = inventory["fqn"].map(
        lambda fqn: tag_maps.get(str(fqn), {}) if pd.notna(fqn) else {}
    )
    inventory["domain"] = inventory["tags"].map(
        lambda tags: _tag_value(tags if isinstance(tags, dict) else {}, "domain")
    )
    inventory["tier"] = inventory["tags"].map(
        lambda tags: _tag_value(tags if isinstance(tags, dict) else {}, "tier")
    )
    inventory["certification"] = inventory["tags"].map(
        lambda tags: _tag_value(tags if isinstance(tags, dict) else {}, "certification")
    )
    inventory["sensitivity"] = inventory["tags"].map(
        lambda tags: _tag_value(tags if isinstance(tags, dict) else {}, "sensitivity")
    )
    inventory["criticality"] = inventory["tags"].map(
        lambda tags: _tag_value(tags if isinstance(tags, dict) else {}, "criticality")
    )
    inventory["glossary_term"] = inventory["tags"].map(
        lambda tags: _tag_value(tags if isinstance(tags, dict) else {}, "glossary_term")
    )
    inventory["data_product"] = inventory["tags"].map(
        lambda tags: _tag_value(tags if isinstance(tags, dict) else {}, "data_product")
    )

    owners_df = _store.list_owner_assignments()
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
                                _normalize_str(email)
                                for email in group["owner_email"].tolist()
                                if _normalize_str(email)
                            }
                        )[:3]
                    ),
                    "business_owner": ", ".join(
                        sorted(
                            {
                                _normalize_str(email)
                                for email in group.loc[
                                    group["owner_type"] == "business", "owner_email"
                                ].tolist()
                                if _normalize_str(email)
                            }
                        )
                    ),
                    "technical_owner": ", ".join(
                        sorted(
                            {
                                _normalize_str(email)
                                for email in group.loc[
                                    group["owner_type"] == "technical", "owner_email"
                                ].tolist()
                                if _normalize_str(email)
                            }
                        )
                    ),
                    "steward": ", ".join(
                        sorted(
                            {
                                _normalize_str(email)
                                for email in group.loc[
                                    group["owner_type"] == "steward", "owner_email"
                                ].tolist()
                                if _normalize_str(email)
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

    links_df = _store.list_asset_links()
    if not links_df.empty:
        links_df = links_df.rename(
            columns={"uc_full_name": "fqn", "om_table_fqn": "om_table_fqn"}
        )
        inventory = inventory.merge(
            links_df[["fqn", "om_table_fqn"]], on="fqn", how="left"
        )
    else:
        inventory["om_table_fqn"] = ""

    requests_df = _store.list_change_requests(limit=500)
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
        inventory[col] = inventory[col].map(_normalize_str)

    inventory["governance_score"] = (
        35 * inventory["comment"].ne("").astype(int)
        + 20 * inventory["owner_count"].gt(0).astype(int)
        + 15 * inventory["domain"].ne("").astype(int)
        + 15 * inventory["certification"].ne("").astype(int)
        + 15 * inventory["glossary_term"].ne("").astype(int)
    )
    inventory["governance_status"] = "Needs Work"
    inventory.loc[inventory["governance_score"] >= 55, "governance_status"] = (
        "Operational"
    )
    inventory.loc[inventory["governance_score"] >= 80, "governance_status"] = (
        "Enterprise Ready"
    )

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


def _inventory_metric(inventory: pd.DataFrame, expr: pd.Series) -> int:
    if inventory.empty:
        return 0
    return int(expr.sum())


def _asset_query_href(
    asset_fqn: str,
    *,
    section: str = "Overview",
    focus: str = "",
    column_edit: str = "",
) -> str:
    params = {"page": "Discovery", "asset": asset_fqn}
    if section:
        params["asset_section"] = section
    if focus:
        params["asset_focus"] = focus
    if column_edit:
        params["column_edit"] = column_edit
    return "?" + urlencode(params)


def _lineage_query_href(asset_fqn: str, *, context: str = "") -> str:
    params = {"page": "Lineage", "lineage_asset": asset_fqn}
    if context:
        params["lineage_context"] = context
    return "?" + urlencode(params)


def _help_query_href(section: str = "") -> str:
    params = {"page": "Help"}
    if section:
        params["help_section"] = section
    return "?" + urlencode(params)


def _lineage_href_if_known(
    asset_fqn: str,
    visible_assets: set[str],
    *,
    context: str = "",
) -> str:
    normalized = _normalize_str(asset_fqn)
    if not normalized:
        return ""
    return _lineage_query_href(normalized, context=context)


def _split_request_tags(tags: Optional[Dict[str, str]]) -> Tuple[Dict[str, str], Dict[str, str]]:
    raw = dict(tags or {})
    special_keys = {
        _REQUEST_OWNER_EMAIL_KEY,
        _REQUEST_OWNER_TYPE_KEY,
        _REQUEST_COLUMN_NAME_KEY,
        _REQUEST_COLUMN_COMMENT_KEY,
    }
    special = {key: raw.get(key, "") for key in special_keys if _normalize_str(raw.get(key))}
    regular = {key: value for key, value in raw.items() if key not in special_keys}
    return regular, special


def _attention_mask(inventory: pd.DataFrame) -> pd.Series:
    if inventory.empty:
        return pd.Series(dtype=bool)
    return (
        inventory["owner_count"].eq(0)
        | inventory["comment"].eq("")
        | inventory["pending_requests"].gt(0)
    )


def _discovery_focus_mask(
    inventory: pd.DataFrame,
    focus_modes: List[str],
) -> pd.Series:
    if inventory.empty:
        return pd.Series(dtype=bool)
    active_modes = [mode for mode in focus_modes if _normalize_str(mode)]
    if not active_modes or "All Assets" in active_modes:
        return pd.Series(True, index=inventory.index)
    mask = pd.Series(False, index=inventory.index)
    for focus_mode in active_modes:
        if focus_mode == "Ownership Gaps":
            mask |= inventory["owner_count"].eq(0)
        elif focus_mode == "Needs Documentation":
            mask |= inventory["comment"].eq("")
        elif focus_mode == "Open Requests":
            mask |= inventory["pending_requests"].gt(0)
        elif focus_mode == "Sensitive / Uncertified":
            mask |= inventory["sensitivity"].ne("") & inventory["certification"].eq("")
    return mask


def _asset_signal_action_badges(asset: pd.Series) -> str:
    actions: List[str] = []
    if int(asset.get("owner_count", 0)) == 0:
        href = _asset_query_href(asset["fqn"], section="Governance", focus="owner")
        actions.append(
            f"<a {_route_link_attrs(href, 'gh-action-badge danger')}>Needs Owner</a>"
        )
    if not _normalize_str(asset.get("comment")):
        href = _asset_query_href(asset["fqn"], section="Governance", focus="description")
        actions.append(
            f"<a {_route_link_attrs(href, 'gh-action-badge warn')}>Needs Description</a>"
        )
    if not _normalize_str(_structured_tags(asset.get("tags") if isinstance(asset.get("tags"), dict) else {}).get("certification")):
        href = _asset_query_href(asset["fqn"], section="Governance", focus="certification")
        actions.append(
            f"<a {_route_link_attrs(href, 'gh-action-badge primary')}>Needs Certification</a>"
        )
    return "".join(actions)


def _format_count(value: Any) -> str:
    try:
        return f"{int(float(value)):,}"
    except Exception:
        return _normalize_str(value) or "—"


def _format_bytes(value: Any) -> str:
    try:
        size = float(value)
    except Exception:
        return "—"
    if size <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024
        idx += 1
    if idx == 0:
        return f"{int(size)} {units[idx]}"
    return f"{size:.1f} {units[idx]}"


def _resolved_row_count(
    uc: UCSQLClient,
    catalog: str,
    schema: str,
    table: str,
    detail_df: pd.DataFrame,
) -> Any:
    if detail_df is not None and not detail_df.empty:
        raw_value = detail_df.iloc[0].get("numRows")
        if _normalize_str(raw_value):
            return raw_value
    return _cached_table_row_count(uc, catalog, schema, table)


def _table_properties_map(props_df: pd.DataFrame) -> Dict[str, str]:
    if props_df is None or props_df.empty:
        return {}
    key_col = "key" if "key" in props_df.columns else props_df.columns[0]
    value_col = "value" if "value" in props_df.columns else props_df.columns[-1]
    return {
        _normalize_str(row.get(key_col)): _normalize_str(row.get(value_col))
        for _, row in props_df.iterrows()
        if _normalize_str(row.get(key_col))
    }


def _resolved_runtime_fact_values(
    asset: pd.Series,
    detail_df: pd.DataFrame,
    props_df: pd.DataFrame,
    *,
    row_count: Any = None,
) -> List[Tuple[str, str]]:
    detail = detail_df.iloc[0] if detail_df is not None and not detail_df.empty else {}
    props = _table_properties_map(props_df)
    table_type = _normalize_str(asset.get("table_type")).upper().replace(" ", "_")
    is_view_like = table_type in {"VIEW", "MATERIALIZED_VIEW", "TEMPORARY_VIEW"}

    format_value = _normalize_str(detail.get("format"))
    if not format_value:
        format_value = _normalize_str(props.get("provider"))
    if not format_value and any(key.startswith("delta.") for key in props):
        format_value = "delta"
    if not format_value:
        if table_type == "MATERIALIZED_VIEW":
            format_value = "Managed refresh"
        elif table_type == "VIEW":
            format_value = "Logical view"
        elif table_type == "STREAMING_TABLE":
            format_value = "streaming"
        else:
            format_value = "Unavailable"

    raw_size = detail.get("sizeInBytes")
    size_value = (
        _format_bytes(raw_size)
        if _normalize_str(raw_size)
        else ("Not exposed" if is_view_like else "Unavailable")
    )

    raw_files = detail.get("numFiles")
    files_value = (
        _format_count(raw_files)
        if _normalize_str(raw_files)
        else ("Not exposed" if is_view_like else "Unavailable")
    )

    rows_value = _format_count(
        row_count if row_count is not None else detail.get("numRows")
    )

    return [
        ("Rows", rows_value),
        ("Format", format_value),
        ("Size", size_value),
        ("Files", files_value),
        (
            "Object Type",
            _format_object_type(_normalize_str(asset.get("table_type"))) or "Unavailable",
        ),
    ]


def _schema_scope_options(
    lineage_up: pd.DataFrame,
    lineage_down: pd.DataFrame,
    col_up: pd.DataFrame,
    col_down: pd.DataFrame,
) -> List[str]:
    values: set[str] = set()
    for df, column in [
        (lineage_up, "source_table_full_name"),
        (lineage_down, "target_table_full_name"),
        (col_up, "source_table_full_name"),
        (col_down, "target_table_full_name"),
    ]:
        if df is None or df.empty or column not in df.columns:
            continue
        for raw in df[column].tolist():
            context = _catalog_schema_context(_normalize_str(raw))
            if context:
                values.add(context)
    return ["All Schemas"] + sorted(values)


def _catalog_scope_options(
    lineage_up: pd.DataFrame,
    lineage_down: pd.DataFrame,
    col_up: pd.DataFrame,
    col_down: pd.DataFrame,
    op_up: Optional[pd.DataFrame] = None,
    op_down: Optional[pd.DataFrame] = None,
    current_fqn: str = "",
) -> List[str]:
    values: set[str] = set()
    for df, column in [
        (lineage_up, "source_table_full_name"),
        (lineage_down, "target_table_full_name"),
        (col_up, "source_table_full_name"),
        (col_down, "target_table_full_name"),
        (op_up, "related_table_full_name"),
        (op_down, "related_table_full_name"),
    ]:
        if df is None or df.empty or column not in df.columns:
            continue
        for raw in df[column].tolist():
            try:
                catalog, _, _ = _split_uc_name(_normalize_str(raw))
            except ValueError:
                continue
            if catalog:
                values.add(catalog)
    current_fqn = _normalize_str(current_fqn)
    if current_fqn:
        try:
            current_catalog, _, _ = _split_uc_name(current_fqn)
        except ValueError:
            current_catalog = ""
        if current_catalog:
            values.add(current_catalog)
    return sorted(values)


def _schema_name_scope_options(
    lineage_up: pd.DataFrame,
    lineage_down: pd.DataFrame,
    col_up: pd.DataFrame,
    col_down: pd.DataFrame,
    catalog_scopes: List[str],
    op_up: Optional[pd.DataFrame] = None,
    op_down: Optional[pd.DataFrame] = None,
    current_fqn: str = "",
) -> List[str]:
    values: set[str] = set()
    for df, column in [
        (lineage_up, "source_table_full_name"),
        (lineage_down, "target_table_full_name"),
        (col_up, "source_table_full_name"),
        (col_down, "target_table_full_name"),
        (op_up, "related_table_full_name"),
        (op_down, "related_table_full_name"),
    ]:
        if df is None or df.empty or column not in df.columns:
            continue
        for raw in df[column].tolist():
            try:
                catalog, schema, _ = _split_uc_name(_normalize_str(raw))
            except ValueError:
                continue
            if catalog_scopes and catalog not in catalog_scopes:
                continue
            if schema:
                values.add(schema)
    current_fqn = _normalize_str(current_fqn)
    if current_fqn:
        try:
            current_catalog, current_schema, _ = _split_uc_name(current_fqn)
        except ValueError:
            current_catalog, current_schema = "", ""
        if current_schema and (
            not catalog_scopes or current_catalog in catalog_scopes
        ):
            values.add(current_schema)
    return sorted(values)


def _apply_catalog_scope(df: pd.DataFrame, column: str, scopes: List[str]) -> pd.DataFrame:
    if df is None or df.empty or not scopes or column not in df.columns:
        return df
    mask = df[column].map(
        lambda value: _split_uc_name(_normalize_str(value))[0]
        if _normalize_str(value).count(".") == 2
        else ""
    ).isin(scopes)
    return df.loc[mask].reset_index(drop=True)


def _apply_schema_name_scope(df: pd.DataFrame, column: str, scopes: List[str]) -> pd.DataFrame:
    if df is None or df.empty or not scopes or column not in df.columns:
        return df
    mask = df[column].map(
        lambda value: _split_uc_name(_normalize_str(value))[1]
        if _normalize_str(value).count(".") == 2
        else ""
    ).isin(scopes)
    return df.loc[mask].reset_index(drop=True)


def _operational_type_options(
    upstream_df: pd.DataFrame,
    downstream_df: pd.DataFrame,
) -> List[str]:
    values: set[str] = set()
    for df in [upstream_df, downstream_df]:
        if df is None or df.empty or "entity_type" not in df.columns:
            continue
        for raw in df["entity_type"].tolist():
            label = _format_entity_type(raw)
            if label:
                values.add(label)
    return sorted(values)


def _apply_operational_type_scope(
    df: pd.DataFrame,
    selected_types: List[str],
) -> pd.DataFrame:
    if df is None or df.empty or not selected_types or "entity_type" not in df.columns:
        return df
    mask = df["entity_type"].map(_format_entity_type).isin(selected_types)
    return df.loc[mask].reset_index(drop=True)


def _constraint_summary_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    rows: List[Dict[str, str]] = []
    for name, group in df.fillna("").groupby("constraint_name", dropna=False):
        columns = [c for c in group["column_name"].tolist() if _normalize_str(c)]
        related = next(
            (
                _normalize_str(val)
                for val in group["unique_constraint_name"].tolist()
                if _normalize_str(val)
            ),
            "",
        )
        update_rule = next(
            (_normalize_str(val) for val in group["update_rule"].tolist() if _normalize_str(val)),
            "",
        )
        delete_rule = next(
            (_normalize_str(val) for val in group["delete_rule"].tolist() if _normalize_str(val)),
            "",
        )
        rows.append(
            {
                "Constraint Name": _normalize_str(name),
                "Constraint Type": _normalize_str(group["constraint_type"].iloc[0]).title(),
                "Columns": ", ".join(columns) or "—",
                "Related Constraint": related or "—",
                "Update Rule": update_rule or "—",
                "Delete Rule": delete_rule or "—",
            }
        )
    view = pd.DataFrame(rows)
    optional_cols = ["Related Constraint", "Update Rule", "Delete Rule"]
    drop_cols = [
        col
        for col in optional_cols
        if col in view.columns and view[col].fillna("—").eq("—").all()
    ]
    if drop_cols:
        view = view.drop(columns=drop_cols)
    return view


def _shell_stat_html(label: str, value: str) -> str:
    return f"""
<div class="gh-estate-stat">
  <div class="gh-estate-stat-label">{html.escape(label)}</div>
  <div class="gh-estate-stat-value">{html.escape(value)}</div>
</div>
    """


def _safe_df_call(fetcher, *args) -> Tuple[pd.DataFrame, Optional[str]]:
    try:
        return fetcher(*args), None
    except Exception as exc:
        return pd.DataFrame(), str(exc)


def _asset_card_html(asset: pd.Series, active: bool) -> str:
    description = shorten(
        asset.get("comment") or "No business description has been added yet.",
        width=140,
        placeholder="...",
    )
    catalog, schema, _ = _split_uc_name(_normalize_str(asset.get("fqn")))
    asset_href = _asset_query_href(asset["fqn"])
    badges = [
        _safe_badge(_format_object_type(_normalize_str(asset.get("table_type"))), "primary"),
        _safe_badge(asset.get("tier", ""), "primary"),
        _safe_badge(asset.get("certification", ""), "good"),
        _safe_badge(asset.get("sensitivity", ""), "warn"),
        _safe_badge(asset.get("domain", ""), "neutral"),
    ]
    badges = "".join(badge for badge in badges if badge)
    signal_actions = _asset_signal_action_badges(asset)
    signals_html = f"<div class='gh-signal-row'>{signal_actions}</div>" if signal_actions else ""
    active_class = "active" if active else ""
    return f"""
<div class="gh-asset-card {active_class}">
  <a {_route_link_attrs(asset_href, "gh-route-link gh-asset-main-link")}>
    <div class="gh-asset-head">
      <div>
        <div class="gh-asset-name">{html.escape(_normalize_str(asset.get("table_name")))}</div>
        <div class="gh-asset-context">{html.escape(" / ".join(part for part in [catalog, schema] if part))}</div>
      </div>
      <div class="gh-score">
        <span class="gh-score-label">Coverage Score</span>
        <span class="gh-score-value">{int(asset.get("governance_score", 0))}</span>
      </div>
    </div>
    <div class="gh-asset-copy">{html.escape(description)}</div>
  </a>
  {signals_html}
  <div class="gh-badge-row">{badges}</div>
  <a {_route_link_attrs(asset_href, "gh-route-link gh-asset-footer-link")}>
    <div class="gh-meta-row">
      <span>{int(asset.get("owner_count", 0))} Owners</span>
      <span>{int(asset.get("pending_requests", 0))} Open Requests</span>
      <span>{html.escape(_normalize_str(asset.get("governance_status")))}</span>
    </div>
  </a>
</div>
    """


def _profile_header_html(asset: pd.Series) -> str:
    tags = asset.get("tags") if isinstance(asset.get("tags"), dict) else {}
    structured = _structured_tags(tags or {})
    catalog, schema, _ = _split_uc_name(_normalize_str(asset.get("fqn")))
    badges = [
        _safe_badge(_format_object_type(_normalize_str(asset.get("table_type"))), "primary"),
        _safe_badge(catalog, "neutral"),
        _safe_badge(schema, "neutral"),
        _safe_badge(structured.get("tier", ""), "primary"),
        _safe_badge(structured.get("certification", ""), "good"),
        _safe_badge(structured.get("sensitivity", ""), "warn"),
        _safe_badge(structured.get("criticality", ""), "danger"),
    ]
    stats_html = "".join(
        [
            _profile_stat_html("Coverage Score", _format_count(asset.get("governance_score", 0))),
            _profile_stat_html("Open Requests", _format_count(asset.get("pending_requests", 0))),
            _profile_stat_html("Owners", _format_count(asset.get("owner_count", 0))),
            _profile_stat_html("Domain", structured["domain"] or "—"),
            _profile_stat_html("Tier", structured["tier"] or "—"),
        ]
    )
    return f"""
<div class="gh-panel gh-profile-panel">
  <div class="gh-profile-shell">
    <div class="gh-profile-main">
      <div class="gh-kicker">Asset Profile</div>
      <div class="gh-profile-title">{html.escape(_normalize_str(asset.get("table_name")))}</div>
      <div class="gh-badge-row">{"".join(badge for badge in badges if badge)}</div>
    </div>
    <div class="gh-profile-stats">{stats_html}</div>
  </div>
</div>
    """


def _overview_context_html(
    asset: pd.Series,
    detail_df: pd.DataFrame,
    props_df: pd.DataFrame,
    *,
    row_count: Any = None,
) -> str:
    description = _normalize_str(asset.get("comment")) or (
        "No business description has been added yet. Use the governance editor to document what this asset contains and how it should be used."
    )
    facts = _resolved_runtime_fact_values(
        asset,
        detail_df,
        props_df,
        row_count=row_count,
    )

    facts_html = "".join(
        f"""
<div class="gh-context-fact">
  <div class="gh-context-fact-label">{html.escape(label)}</div>
  <div class="gh-context-fact-value">{html.escape(value)}</div>
</div>
        """
        for label, value in facts
    )
    return f"""
<div class="gh-context-panel">
  <div class="gh-context-description">{html.escape(description)}</div>
  <div class="gh-context-facts">{facts_html}</div>
</div>
    """


def _lineage_node_html(
    label: str,
    fqn: str,
    tone: str = "neutral",
    focus: bool = False,
    object_type: str = "",
    href: str = "",
) -> str:
    tone_class = {
        "source": "warn",
        "target": "good",
        "focus": "primary",
    }.get(tone, "neutral")
    focus_class = "focus" if focus else ""
    table_name = fqn.split(".")[-1] if fqn else "No asset"
    context = _catalog_schema_context(fqn) or "External lineage asset"
    node_html = f"""
<div class="gh-lineage-node {focus_class}">
  <div class="gh-lineage-label">{html.escape(label)}</div>
  <div class="gh-asset-name">{html.escape(table_name)}</div>
  <div class="gh-asset-context">{html.escape(context)}</div>
  <div class="gh-badge-row">
    {_safe_badge(tone.title(), tone_class)}
    {_safe_badge(_format_object_type(object_type), "neutral")}
  </div>
</div>
    """
    if href:
        return (
            f"<a {_route_link_attrs(href, 'gh-route-link gh-lineage-link')}>"
            f"{node_html}</a>"
        )
    return node_html


def _lineage_focus_summary_html(
    asset: pd.Series,
    lineage_up: pd.DataFrame,
    lineage_down: pd.DataFrame,
    col_up: pd.DataFrame,
    col_down: pd.DataFrame,
) -> str:
    description = _normalize_str(asset.get("comment"))
    owner_count = int(asset.get("owner_count", 0) or 0)
    certification = _normalize_str(asset.get("certification"))
    priority_actions: List[str] = []
    if not description:
        priority_actions.append("adding a business description")
    if owner_count == 0:
        priority_actions.append("assigning an owner")
    if not certification:
        priority_actions.append("setting certification")

    if priority_actions:
        review_note = "Start by " + ", then ".join(priority_actions[:2]) + "."
    elif len(lineage_down) or len(col_down):
        review_note = "Review downstream consumers before making schema or semantic changes."
    else:
        review_note = "Use the lineage detail below to inspect upstream sources and downstream consumers."

    summary_items = [
        ("Documentation", "Documented" if description else "Missing description"),
        ("Ownership", f"{owner_count} owner{'s' if owner_count != 1 else ''}" if owner_count else "No owners assigned"),
        ("Upstream Exposure", f"{len(lineage_up)} assets · {len(col_up)} columns"),
        ("Downstream Exposure", f"{len(lineage_down)} assets · {len(col_down)} columns"),
    ]
    items_html = "".join(
        f"""
<div class="gh-lineage-summary-item">
  <div class="gh-lineage-summary-item-label">{html.escape(label)}</div>
  <div class="gh-lineage-summary-item-value">{html.escape(value)}</div>
</div>
        """
        for label, value in summary_items
    )
    return f"""
<div class="gh-lineage-summary">
  <div class="gh-panel-label">Summary</div>
  <div class="gh-lineage-summary-grid">{items_html}</div>
  <div class="gh-lineage-summary-note">{html.escape(review_note)}</div>
</div>
    """


def _render_section_intro(title: str, copy: str) -> None:
    return None


def _render_column_lineage(df: pd.DataFrame, key: str) -> None:
    src_col = "source_column_name"
    tgt_col = "target_column_name"
    direct_mask = df[src_col].str.lower() == df[tgt_col].str.lower()
    control_col, info_col = st.columns([0.76, 0.24], vertical_alignment="center")
    with control_col:
        show_all = st.toggle(
            "Include indirect lineage",
            value=False,
            key=f"column_lineage_scope_{key}",
            help=(
                "Turn this on to include broader dependencies from joins, expressions, "
                "and multi-column logic instead of showing only same-name lineage."
            ),
        )
    with info_col:
        with st.expander("ⓘ UC lineage"):
            st.write(
                "Unity Catalog records which source columns were read by a transformation. "
                "Some rows are direct source-to-target lineage matches, while others are "
                "broader dependencies created by joins, expressions, or multi-column logic."
            )
            st.write(
                "Leave indirect lineage off for a narrow review. Turn it on when you need "
                "the full dependency trail behind a target column."
            )

    c1, c2, c3 = st.columns(3)
    c1.metric("Total lineage", len(df))
    c2.metric("Direct lineage", int(direct_mask.sum()))
    c3.metric("Indirect lineage", int((~direct_mask).sum()))

    view_df = df if show_all else df[direct_mask]
    if view_df.empty:
        if show_all:
            st.info("No column lineage is available for this asset.")
        else:
            st.info("No direct column lineage is available for this asset.")
    else:
        _render_data_table(view_df)


def _apply_table_tags(
    uc: UCSQLClient,
    catalog: str,
    schema: str,
    table: str,
    existing_df: pd.DataFrame,
    desired_tags: Dict[str, str],
) -> None:
    existing_tags = _df_to_tags_map(existing_df)
    desired_tags = {
        key: value for key, value in desired_tags.items() if _normalize_str(key)
    }
    to_unset = [key for key in existing_tags if key not in desired_tags]
    to_set = {
        key: value
        for key, value in desired_tags.items()
        if existing_tags.get(key) != value
    }
    if to_unset:
        uc.unset_table_tags(catalog, schema, table, to_unset)
    if to_set:
        uc.set_table_tags(catalog, schema, table, to_set)


def _apply_column_tags(
    uc: UCSQLClient,
    catalog: str,
    schema: str,
    table: str,
    column: str,
    existing_df: pd.DataFrame,
    desired_tags: Dict[str, str],
) -> None:
    existing_tags = _df_to_tags_map(existing_df)
    desired_tags = {
        key: value for key, value in desired_tags.items() if _normalize_str(key)
    }
    to_unset = [key for key in existing_tags if key not in desired_tags]
    to_set = {
        key: value
        for key, value in desired_tags.items()
        if existing_tags.get(key) != value
    }
    if to_unset:
        uc.unset_column_tags(catalog, schema, table, column, to_unset)
    if to_set:
        uc.set_column_tags(catalog, schema, table, column, to_set)


def _selected_asset(inventory: pd.DataFrame) -> Optional[pd.Series]:
    if inventory.empty:
        return None
    selected_fqn = st.session_state.get("selected_asset_fqn")
    if selected_fqn and selected_fqn in inventory["fqn"].values:
        row = inventory[inventory["fqn"] == selected_fqn]
        if not row.empty:
            return row.iloc[0]
    st.session_state["selected_asset_fqn"] = inventory.iloc[0]["fqn"]
    return inventory.iloc[0]


def _clean_multiselect_state(state_key: str, options: List[str]) -> List[str]:
    current = st.session_state.get(state_key, [])
    if not isinstance(current, list):
        current = [current] if _normalize_str(current) else []
    option_set = set(options)
    cleaned = [value for value in current if value in option_set]
    st.session_state[state_key] = cleaned
    return cleaned


def _sync_asset_query_state(inventory: pd.DataFrame) -> None:
    query_keys = ["asset", "asset_section", "asset_focus", "column_edit"]
    try:
        query_sig = tuple(_normalize_str(st.query_params.get(key)) for key in query_keys)
    except Exception:
        query_sig = ("", "", "", "")
    if not any(query_sig):
        return
    consumed_sig = st.session_state.get("_consumed_asset_query_sig")
    if consumed_sig == query_sig and st.session_state.get("discovery_asset_opened"):
        _clear_asset_query_state()
        return
    if inventory.empty:
        st.session_state["_consumed_asset_query_sig"] = query_sig
        _clear_asset_query_state()
        return
    asset_fqn = query_sig[0]
    if not asset_fqn or asset_fqn not in inventory["fqn"].values:
        st.session_state["_consumed_asset_query_sig"] = query_sig
        _clear_asset_query_state()
        return

    st.session_state["app_page"] = "Discovery"
    st.session_state["selected_asset_fqn"] = asset_fqn
    st.session_state["discovery_asset_opened"] = True

    section = query_sig[1] or "Overview"
    st.session_state[f"asset_profile_section_{asset_fqn}"] = section

    focus = query_sig[2]
    if focus:
        st.session_state[f"asset_governance_focus_{asset_fqn}"] = focus

    column_edit = query_sig[3]
    if column_edit:
        st.session_state[f"schema_comment_target_{asset_fqn}"] = column_edit
    st.session_state["_consumed_asset_query_sig"] = query_sig
    _clear_asset_query_state()


def _sync_page_query_state() -> None:
    try:
        page = _normalize_str(st.query_params.get("page"))
    except Exception:
        page = ""
    if page in {"Discovery", "Lineage", "Governance", "Stewardship", "Admin", "Help"}:
        st.session_state["app_page"] = page
    try:
        if "page" in st.query_params:
            del st.query_params["page"]
    except Exception:
        pass


def _sync_lineage_query_state(inventory: pd.DataFrame) -> None:
    try:
        lineage_asset = _normalize_str(st.query_params.get("lineage_asset"))
    except Exception:
        lineage_asset = ""
    try:
        lineage_context = _normalize_str(st.query_params.get("lineage_context"))
    except Exception:
        lineage_context = ""
    if not lineage_asset:
        return
    st.session_state["app_page"] = "Lineage"
    st.session_state["selected_asset_fqn"] = lineage_asset
    st.session_state["lineage_selector"] = lineage_asset
    if lineage_context in {"Data Lineage", "Operational Context"}:
        st.session_state["lineage_workspace_context"] = lineage_context
    _clear_lineage_query_state()


def _sync_help_query_state() -> None:
    try:
        open_help = _normalize_str(st.query_params.get("help"))
    except Exception:
        open_help = ""
    try:
        help_section = _normalize_str(st.query_params.get("help_section"))
    except Exception:
        help_section = ""
    if not open_help and not help_section:
        return
    st.session_state["app_page"] = "Help"
    if help_section in {"Using the App", "Coverage Score", "Object Types & Lineage"}:
        st.session_state["help_section"] = help_section
    _clear_help_query_state()


def _clear_asset_query_state() -> None:
    for key in ["asset", "asset_section", "asset_focus", "column_edit", "page"]:
        try:
            if key in st.query_params:
                del st.query_params[key]
        except Exception:
            pass


def _clear_lineage_query_state() -> None:
    for key in ["lineage_asset", "lineage_context", "page"]:
        try:
            if key in st.query_params:
                del st.query_params[key]
        except Exception:
            pass


def _clear_help_query_state() -> None:
    for key in ["help", "help_section"]:
        try:
            if key in st.query_params:
                del st.query_params[key]
        except Exception:
            pass


def _asset_selector(
    inventory: pd.DataFrame,
    key: str,
    label: str,
    *,
    allow_external_current: bool = False,
) -> Optional[str]:
    options = inventory["fqn"].tolist() if not inventory.empty else []
    current_value = _normalize_str(
        st.session_state.get(key) or st.session_state.get("selected_asset_fqn", "")
    )
    if allow_external_current and current_value and current_value not in options:
        options = [current_value] + options
    if not options:
        return None
    if current_value not in options:
        current_value = options[0]
    if st.session_state.get(key) != current_value:
        st.session_state[key] = current_value
    selected = st.selectbox(
        label,
        options,
        format_func=lambda fqn: _lineage_asset_option_label(inventory, fqn),
        key=key,
    )
    if selected:
        st.session_state["selected_asset_fqn"] = selected
    return selected


def _render_filter_multiselect(
    container,
    label: str,
    options: List[str],
    *,
    key: str,
    placeholder: str,
    empty_label: str,
) -> List[str]:
    if options:
        return container.multiselect(
            label,
            options,
            key=key,
            placeholder=placeholder,
        )
    st.session_state[key] = []
    container.text_input(
        label,
        value=empty_label,
        key=f"{key}_empty",
        disabled=True,
    )
    return []


def _filtered_inventory(
    inventory: pd.DataFrame,
    *,
    show_controls: bool = True,
    available_catalogs: Optional[List[str]] = None,
) -> pd.DataFrame:
    if inventory.empty:
        return inventory

    catalogs = _catalog_filter_options(
        inventory,
        available_catalogs=available_catalogs,
        observed_catalogs=st.session_state.get("observed_catalog_scopes", []),
    )
    domains = sorted([v for v in inventory["domain"].unique().tolist() if v])
    tiers = sorted([v for v in inventory["tier"].unique().tolist() if v])
    certifications = sorted(
        [v for v in inventory["certification"].unique().tolist() if v]
    )
    sensitivities = sorted(
        [v for v in inventory["sensitivity"].unique().tolist() if v]
    )
    focus_options = [
        "All Assets",
        "Ownership Gaps",
        "Needs Documentation",
        "Open Requests",
        "Sensitive / Uncertified",
    ]

    st.session_state.setdefault("asset_search", "")
    st.session_state.setdefault("asset_sort_mode", "Best Match")
    st.session_state.setdefault("asset_view_filters", [])
    st.session_state.setdefault("asset_catalog_filters", [])
    st.session_state.setdefault("asset_domain_filters", [])
    st.session_state.setdefault("asset_tier_filters", [])
    st.session_state.setdefault("asset_certification_filters", [])
    st.session_state.setdefault("asset_sensitivity_filters", [])

    valid_sort_modes = {
        "Best Match",
        "Coverage Score",
        "Open Requests",
        "Alphabetical",
    }
    if st.session_state.get("asset_sort_mode") not in valid_sort_modes:
        st.session_state["asset_sort_mode"] = "Best Match"
    _clean_multiselect_state("asset_view_filters", focus_options)
    _clean_multiselect_state("asset_catalog_filters", catalogs)
    _clean_multiselect_state("asset_domain_filters", domains)
    _clean_multiselect_state("asset_tier_filters", tiers)
    _clean_multiselect_state("asset_certification_filters", certifications)
    _clean_multiselect_state("asset_sensitivity_filters", sensitivities)

    if show_controls:
        with st.form("discovery_filters", border=True):
            st.markdown("#### Discovery Filters")
            st.caption(
                "Combine search, view, and metadata filters in one pane before scanning the matching assets."
            )
            query_col, sort_col = st.columns([2, 1])
            with query_col:
                query = st.text_input(
                    "Search Assets",
                    placeholder="customer, finance, PII, steward email, certified",
                    key="asset_search",
                )
            with sort_col:
                sort_mode = st.selectbox(
                    "Sort By",
                    [
                        "Best Match",
                        "Coverage Score",
                        "Open Requests",
                        "Alphabetical",
                    ],
                    key="asset_sort_mode",
                )

            filter_row_one = st.columns(3)
            selected_views = _render_filter_multiselect(
                filter_row_one[0],
                "Asset View",
                focus_options,
                key="asset_view_filters",
                placeholder="All asset views",
                empty_label="No asset views available",
            )
            selected_catalogs = _render_filter_multiselect(
                filter_row_one[1],
                "Catalogs",
                catalogs,
                key="asset_catalog_filters",
                placeholder="All catalogs",
                empty_label="No catalogs available",
            )
            selected_domains = _render_filter_multiselect(
                filter_row_one[2],
                "Domains",
                domains,
                key="asset_domain_filters",
                placeholder="All domains",
                empty_label="No domains available yet",
            )

            filter_row_two = st.columns(3)
            selected_tiers = _render_filter_multiselect(
                filter_row_two[0],
                "Tiers",
                tiers,
                key="asset_tier_filters",
                placeholder="All tiers",
                empty_label="No tiers available yet",
            )
            selected_certs = _render_filter_multiselect(
                filter_row_two[1],
                "Certifications",
                certifications,
                key="asset_certification_filters",
                placeholder="All certifications",
                empty_label="No certifications available yet",
            )
            selected_sensitivities = _render_filter_multiselect(
                filter_row_two[2],
                "Sensitivities",
                sensitivities,
                key="asset_sensitivity_filters",
                placeholder="All sensitivities",
                empty_label="No sensitivities available yet",
            )
            st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)
            action_col, _ = st.columns([0.19, 0.81])
            with action_col:
                submitted = st.form_submit_button(
                    "Apply discovery filters",
                    type="primary",
                )
            if submitted:
                st.session_state["discovery_filters_applied"] = True
        _decorate_buttons(
            {
                "Apply discovery filters": {
                    "tooltip": "Apply the current discovery filter set.",
                    "classes": "gh-button-filter",
                }
            }
        )
    else:
        query = st.session_state.get("asset_search", "")
        sort_mode = st.session_state.get("asset_sort_mode", "Best Match")
        selected_views = st.session_state.get("asset_view_filters", [])
        selected_catalogs = st.session_state.get("asset_catalog_filters", [])
        selected_domains = st.session_state.get("asset_domain_filters", [])
        selected_tiers = st.session_state.get("asset_tier_filters", [])
        selected_certs = st.session_state.get("asset_certification_filters", [])
        selected_sensitivities = st.session_state.get("asset_sensitivity_filters", [])

    filtered = inventory.copy()
    if query:
        q = query.lower()
        filtered["match_score"] = (
            filtered["table_name"]
            .str.lower()
            .str.contains(q, regex=False, na=False)
            .astype(int)
            * 4
            + filtered["table_schema"]
            .str.lower()
            .str.contains(q, regex=False, na=False)
            .astype(int)
            * 2
            + filtered["comment"]
            .str.lower()
            .str.contains(q, regex=False, na=False)
            .astype(int)
            * 2
            + filtered["search_text"].str.contains(q, regex=False, na=False).astype(int)
        )
        filtered = filtered[
            filtered["search_text"].str.contains(q, regex=False, na=False)
        ]
    else:
        filtered["match_score"] = 0

    if selected_catalogs:
        filtered = filtered[filtered["table_catalog"].isin(selected_catalogs)]
    if selected_domains:
        filtered = filtered[filtered["domain"].isin(selected_domains)]
    if selected_tiers:
        filtered = filtered[filtered["tier"].isin(selected_tiers)]
    if selected_certs:
        filtered = filtered[filtered["certification"].isin(selected_certs)]
    if selected_sensitivities:
        filtered = filtered[filtered["sensitivity"].isin(selected_sensitivities)]

    focus_mask = _discovery_focus_mask(filtered, selected_views)
    if not focus_mask.empty:
        filtered = filtered[focus_mask]

    if sort_mode == "Coverage Score":
        filtered = filtered.sort_values(
            ["governance_score", "pending_requests", "fqn"],
            ascending=[False, False, True],
        )
    elif sort_mode == "Open Requests":
        filtered = filtered.sort_values(
            ["pending_requests", "governance_score", "fqn"],
            ascending=[False, False, True],
        )
    elif sort_mode == "Alphabetical":
        filtered = filtered.sort_values("fqn")
    else:
        filtered = filtered.sort_values(
            ["match_score", "governance_score", "pending_requests", "fqn"],
            ascending=[False, False, False, True],
        )

    if show_controls and st.session_state.pop("discovery_filters_applied", False):
        st.success(f"Filters applied. {len(filtered)} assets currently match.")

    return filtered.reset_index(drop=True)


def _render_asset_profile(
    asset: pd.Series,
    inventory: pd.DataFrame,
    uc: UCSQLClient,
    store: GovernanceStore,
    role: str,
    user_email: str,
) -> None:
    catalog, schema, table = _split_uc_name(asset["fqn"])
    asset_tags = asset.get("tags") if isinstance(asset.get("tags"), dict) else {}
    structured = _structured_tags(asset_tags or {})
    comment = _normalize_str(asset.get("comment"))
    tag_suggestions = _tag_suggestion_map(inventory)

    st.markdown(_profile_header_html(asset), unsafe_allow_html=True)

    section_key = f"asset_profile_section_{asset['fqn']}"
    section = _normalize_str(st.session_state.get(section_key)) or "Overview"
    if section not in {"Overview", "Schema", "Preview", "Lineage", "Governance"}:
        section = "Overview"
    st.session_state[section_key] = section
    st.markdown(
        _route_subnav_html(
            [
                (name, _asset_query_href(asset["fqn"], section=name))
                for name in ["Overview", "Schema", "Preview", "Lineage", "Governance"]
            ],
            section,
            label="Asset View",
            help_text={
                "Overview": "Review business context, runtime facts, ownership, and governance summary.",
                "Schema": "Inspect live columns, constraints, table properties, and documentation entry points.",
                "Preview": "Load a small cached sample to verify data shape and semantics.",
                "Lineage": "Inspect upstream and downstream table dependencies for this asset.",
                "Governance": "Edit or request metadata, owners, tags, certification, and governance context.",
            },
        ),
        unsafe_allow_html=True,
    )
    st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)

    if section == "Overview":
        owners_df = store.get_owners(asset["fqn"])
        tags_df = _tags_map_to_df(asset_tags if isinstance(asset_tags, dict) else {})
        detail_df = _cached_table_detail(uc, catalog, schema, table)
        props_df = _cached_table_properties(uc, catalog, schema, table)
        row_count = _resolved_row_count(uc, catalog, schema, table, detail_df)
        left, right = st.columns([1.25, 1])
        with left:
            st.markdown("#### Table Information")
            st.markdown(
                _overview_context_html(
                    asset,
                    detail_df,
                    props_df,
                    row_count=row_count,
                ),
                unsafe_allow_html=True,
            )
            st.markdown("#### Ownership")
            if owners_df.empty:
                st.info("No business, technical, or steward owners have been assigned.")
            else:
                _render_data_table(owners_df)

        with right:
            summary_rows = pd.DataFrame(
                [
                    {"Field": "Domain", "Value": structured["domain"] or "Unassigned"},
                    {"Field": "Tier", "Value": structured["tier"] or "Unassigned"},
                    {
                        "Field": "Certification",
                        "Value": structured["certification"] or "Unassigned",
                    },
                    {
                        "Field": "Sensitivity",
                        "Value": structured["sensitivity"] or "Unassigned",
                    },
                    {
                        "Field": "Criticality",
                        "Value": structured["criticality"] or "Unassigned",
                    },
                    {
                        "Field": "Glossary term",
                        "Value": structured["glossary_term"] or "Unassigned",
                    },
                    {
                        "Field": "Data product",
                        "Value": structured["data_product"] or "Unassigned",
                    },
                    {
                        "Field": "OpenMetadata link",
                        "Value": _normalize_str(asset.get("om_table_fqn"))
                        or "Not linked",
                    },
                ]
            )
            st.markdown("#### Governance summary")
            _render_data_table(summary_rows)
            if not tags_df.empty:
                st.markdown("#### Active tags")
                _render_data_table(tags_df)

    elif section == "Schema":
        with st.spinner("Loading schema details..."):
            cols_df = _cached_columns(uc, catalog, schema, table)
            detail_df = _cached_table_detail(uc, catalog, schema, table)
            props_df = _cached_table_properties(uc, catalog, schema, table)
            constraints_df = _cached_table_constraints(uc, catalog, schema, table)
        row_count = _resolved_row_count(uc, catalog, schema, table, detail_df)

        st.markdown("<div class='gh-subsection-title'>Table Metadata</div>", unsafe_allow_html=True)
        st.markdown(
            "<div class='gh-subsection-copy'>Review live Unity Catalog details, physical properties, and enforced constraints for this asset.</div>",
            unsafe_allow_html=True,
        )

        if not detail_df.empty:
            detail = detail_df.iloc[0]
            detail_rows = pd.DataFrame(
                [
                    {
                        "Field": "Object Type",
                        "Value": _format_object_type(
                            _normalize_str(asset.get("table_type"))
                        )
                        or "Unavailable",
                    },
                    {
                        "Field": "Partition Columns",
                        "Value": _normalize_str(detail.get("partitionColumns")) or "None",
                    },
                    {
                        "Field": "Clustering Columns",
                        "Value": _normalize_str(detail.get("clusteringColumns")) or "None",
                    },
                    {
                        "Field": "Table Features",
                        "Value": _normalize_str(detail.get("tableFeatures")) or "None",
                    },
                    {
                        "Field": "Location",
                        "Value": _normalize_str(detail.get("location")) or "Unavailable",
                    },
                    {
                        "Field": "Created",
                        "Value": _normalize_str(detail.get("createdAt")) or "Unavailable",
                    },
                    {
                        "Field": "Last Modified",
                        "Value": _normalize_str(detail.get("lastModified")) or "Unavailable",
                    },
                    {
                        "Field": "Row Count",
                        "Value": _format_count(row_count),
                    },
                ]
            )
            with st.expander("Table Details", expanded=False):
                _render_data_table(detail_rows)

        constraint_view = _constraint_summary_df(constraints_df)
        if not constraint_view.empty:
            with st.expander(f"Constraints ({len(constraint_view)})", expanded=False):
                if "Related Constraint" in constraint_view.columns:
                    st.caption(
                        "Related Constraint is primarily populated for foreign key relationships."
                    )
                _render_data_table(constraint_view)

        if not props_df.empty:
            with st.expander(f"Delta / Table Properties ({len(props_df)})", expanded=False):
                _render_data_table(props_df)

        st.markdown("<div class='gh-subsection-break'></div>", unsafe_allow_html=True)
        st.markdown("<div class='gh-subsection-title'>Columns</div>", unsafe_allow_html=True)
        st.markdown(
            "<div class='gh-subsection-copy'>Use the comment cell to add or update documentation for a specific column.</div>",
            unsafe_allow_html=True,
        )
        _render_columns_table(cols_df, asset["fqn"], role)

        selected_col = _normalize_str(
            st.session_state.get(f"schema_comment_target_{asset['fqn']}", "")
        )
        if not selected_col and not cols_df.empty:
            selected_col = _normalize_str(cols_df.iloc[0].get("column_name"))

        if selected_col and not cols_df.empty:
            current_match = cols_df[cols_df["column_name"] == selected_col]
            if not current_match.empty:
                st.divider()
                current_col = current_match.iloc[0]
                current_comment = _normalize_str(current_col.get("comment"))
                st.markdown(f"#### Column Comment: `{selected_col}`")
                new_comment = st.text_area(
                    "Column description",
                    value=current_comment,
                    height=100,
                    key=f"column_comment_{asset['fqn']}_{selected_col}",
                )
                if role in {"writer", "admin"}:
                    if st.button(
                        "Save column description",
                        type="primary",
                        use_container_width=True,
                        key=f"save_column_comment_{asset['fqn']}_{selected_col}",
                    ):
                        uc.set_column_comment(
                            catalog, schema, table, selected_col, new_comment
                        )
                        st.success(f"Updated description for `{selected_col}`.")
                        st.cache_data.clear()
                        st.rerun()

                    existing_col_tags = uc.get_column_tags(
                        catalog, schema, table, selected_col
                    )
                    edited_col_tags = _tags_editor(
                        existing_col_tags,
                        key=f"column_tags_editor_{asset['fqn']}_{selected_col}",
                        suggestions=tag_suggestions,
                    )
                    if st.button(
                        "Save column tags",
                        use_container_width=True,
                        key=f"save_column_tags_{asset['fqn']}_{selected_col}",
                    ):
                        _apply_column_tags(
                            uc,
                            catalog,
                            schema,
                            table,
                            selected_col,
                            existing_col_tags,
                            _df_to_tags_map(edited_col_tags),
                        )
                        st.success(f"Updated tags for `{selected_col}`.")
                        st.cache_data.clear()
                        st.rerun()
                else:
                    if st.button(
                        "Submit column comment request",
                        type="primary",
                        use_container_width=True,
                        key=f"submit_column_comment_{asset['fqn']}_{selected_col}",
                    ):
                        request_id = store.create_change_request(
                            created_by=user_email,
                            uc_full_name=asset["fqn"],
                            new_uc_tags={
                                _REQUEST_COLUMN_NAME_KEY: selected_col,
                                _REQUEST_COLUMN_COMMENT_KEY: new_comment,
                            },
                        )
                        st.success(f"Change request `{request_id}` submitted.")
                        st.cache_data.clear()

    elif section == "Preview":
        st.caption(
            "Sample data preview is intentionally small and cached to stay responsive."
        )
        if st.button(
            "Load sample rows",
            type="primary",
            key=f"sample_button_{asset['fqn']}",
            use_container_width=True,
        ):
            st.session_state[f"sample_loaded_{asset['fqn']}"] = True
        if st.session_state.get(f"sample_loaded_{asset['fqn']}"):
            try:
                with st.spinner("Loading sample rows..."):
                    _render_data_table(_cached_sample_rows(uc, catalog, schema, table))
            except Exception as exc:
                st.error(f"Could not load sample data: {exc}")
        else:
            st.info("Load sample rows when you need a quick shape check for the asset.")

    elif section == "Lineage":
        with st.spinner("Loading lineage..."):
            lineage_up, lineage_up_error = _safe_df_call(
                _cached_lineage_up, uc, catalog, schema, table
            )
            lineage_down, lineage_down_error = _safe_df_call(
                _cached_lineage_down, uc, catalog, schema, table
            )
        lineage_up = _filter_asset_rows(
            lineage_up,
            ["source_table_full_name"],
            exclude_fqn=asset["fqn"],
        )
        lineage_down = _filter_asset_rows(
            lineage_down,
            ["target_table_full_name"],
            exclude_fqn=asset["fqn"],
        )
        lcol1, lcol2 = st.columns(2)
        with lcol1:
            st.markdown("#### Upstream Assets")
            if lineage_up_error:
                st.warning(f"Could not query upstream lineage: {lineage_up_error}")
            elif lineage_up.empty:
                st.info("No upstream lineage found.")
            else:
                _render_data_table(lineage_up)
        with lcol2:
            st.markdown("#### Downstream Assets")
            if lineage_down_error:
                st.warning(f"Could not query downstream lineage: {lineage_down_error}")
            elif lineage_down.empty:
                st.info("No downstream lineage found.")
            else:
                _render_data_table(lineage_down)
        st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)
        if st.button(
            "Open Full Lineage Workspace",
            use_container_width=True,
            key=f"open_lineage_{asset['fqn']}",
        ):
            st.session_state["app_page"] = "Lineage"
            st.session_state["lineage_workspace_context"] = "Data Lineage"
            st.rerun()
        _decorate_buttons(
            {
                "Open Full Lineage Workspace": {
                    "tooltip": "Open the dedicated lineage workspace for interactive upstream and downstream review.",
                }
            }
        )

    else:
        tags_df = _tags_map_to_df(asset_tags if isinstance(asset_tags, dict) else {})
        owners_df = store.get_owners(asset["fqn"])
        principals_df = _cached_workspace_principals(uc)
        if not principals_df.empty and "principal_type" in principals_df.columns:
            principals_df = principals_df[
                principals_df["principal_type"].fillna("").astype(str).str.lower() == "user"
            ].reset_index(drop=True)
        principal_labels = _principal_option_map(principals_df)
        principal_options = list(principal_labels.keys())
        is_writer = role in {"writer", "admin"}
        existing_tags = _df_to_tags_map(tags_df)
        existing_structured = _structured_tags(existing_tags)
        existing_custom = {
            key: value
            for key, value in existing_tags.items()
            if key not in _STANDARD_TAG_KEYS
        }
        focus_hint = st.session_state.pop(
            f"asset_governance_focus_{asset['fqn']}", ""
        )

        if is_writer:
            if focus_hint == "description":
                st.info("Update the business description below and save to improve the coverage score.")
            elif focus_hint == "owner":
                st.info("Assign an owner below to move this asset out of the ownership gap queue.")
            elif focus_hint == "certification":
                st.info("Set a certification below to mark the asset's current governance state.")
            st.markdown("#### Structured governance metadata")
            gov_left, gov_right = st.columns(2)
            with gov_left:
                new_comment = st.text_area(
                    "Business description",
                    value=comment,
                    height=140,
                    key=f"table_comment_{asset['fqn']}",
                )
                domain = st.text_input(
                    "Domain",
                    value=existing_structured["domain"],
                    key=f"domain_{asset['fqn']}",
                )
                data_product = st.text_input(
                    "Data product",
                    value=existing_structured["data_product"],
                    key=f"product_{asset['fqn']}",
                )
                glossary_term = st.text_input(
                    "Glossary term",
                    value=existing_structured["glossary_term"],
                    key=f"glossary_{asset['fqn']}",
                )
            with gov_right:
                tier = st.selectbox(
                    "Tier",
                    _TIER_OPTIONS,
                    index=_select_index(_TIER_OPTIONS, existing_structured["tier"]),
                    key=f"tier_{asset['fqn']}",
                )
                certification = st.selectbox(
                    "Certification",
                    _CERTIFICATION_OPTIONS,
                    index=_select_index(
                        _CERTIFICATION_OPTIONS, existing_structured["certification"]
                    ),
                    key=f"certification_{asset['fqn']}",
                )
                sensitivity = st.selectbox(
                    "Sensitivity",
                    _SENSITIVITY_OPTIONS,
                    index=_select_index(
                        _SENSITIVITY_OPTIONS, existing_structured["sensitivity"]
                    ),
                    key=f"sensitivity_{asset['fqn']}",
                )
                criticality = st.selectbox(
                    "Criticality",
                    _CRITICALITY_OPTIONS,
                    index=_select_index(
                        _CRITICALITY_OPTIONS, existing_structured["criticality"]
                    ),
                    key=f"criticality_{asset['fqn']}",
                )

            if st.button(
                "Save structured metadata",
                type="primary",
                use_container_width=True,
                key=f"save_structured_{asset['fqn']}",
            ):
                desired_standard = {
                    "domain": domain,
                    "data_product": data_product,
                    "glossary_term": glossary_term,
                    "tier": tier,
                    "certification": certification,
                    "sensitivity": sensitivity,
                    "criticality": criticality,
                }
                desired_tags = {
                    **existing_custom,
                    **{key: value for key, value in desired_standard.items() if value},
                }
                uc.set_table_comment(catalog, schema, table, new_comment)
                _apply_table_tags(uc, catalog, schema, table, tags_df, desired_tags)
                st.success("Governance metadata updated.")
                st.cache_data.clear()
                st.rerun()

            st.divider()
            st.markdown("#### Custom tags")
            edited_custom_tags = _tags_editor(
                _custom_tags_df(tags_df),
                key=f"custom_tags_{asset['fqn']}",
                suggestions=tag_suggestions,
            )
            if st.button(
                "Save custom tags",
                use_container_width=True,
                key=f"save_custom_tags_{asset['fqn']}",
            ):
                desired_tags = {
                    **{
                        key: value
                        for key, value in existing_structured.items()
                        if value
                    },
                    **_df_to_tags_map(edited_custom_tags),
                }
                _apply_table_tags(uc, catalog, schema, table, tags_df, desired_tags)
                st.success("Custom tags updated.")
                st.cache_data.clear()
                st.rerun()

            st.divider()
            st.markdown("#### Owners")
            if owners_df.empty:
                st.info("No owners have been assigned yet.")
            else:
                _render_data_table(owners_df)
            with st.form(f"owners_{asset['fqn']}"):
                selected_principal = ""
                owner_email = ""
                if principal_options:
                    selected_principal = st.selectbox(
                        "Workspace user",
                        principal_options,
                        format_func=lambda value: principal_labels.get(value, value),
                        key=f"owner_principal_{asset['fqn']}",
                    )
                else:
                    owner_email = st.text_input(
                        "Owner email",
                        placeholder="name@company.com",
                        key=f"owner_email_{asset['fqn']}",
                    )
                owner_type = st.selectbox(
                    "Owner type", ["technical", "business", "steward"]
                )
                if st.form_submit_button("Add or update owner", type="primary"):
                    resolved_owner_email = selected_principal or owner_email
                    if not _normalize_str(resolved_owner_email):
                        st.error("Select a workspace user or enter an owner email.")
                    else:
                        store.upsert_owner(
                            asset["fqn"], resolved_owner_email, owner_type, user_email
                        )
                        st.success("Owner assignment saved.")
                        st.cache_data.clear()
                        st.rerun()
        else:
            if focus_hint == "description":
                st.info("Propose a business description below for writer or admin review.")
            elif focus_hint == "owner":
                st.info("Propose an owner below to route the ownership update for review.")
            elif focus_hint == "certification":
                st.info("Propose a certification below to send it for review.")
            st.info(
                "Readers can propose metadata improvements here. Writers and admins apply them."
            )
            proposed_comment = st.text_area(
                "Proposed business description",
                value=comment,
                height=140,
                key=f"proposed_comment_{asset['fqn']}",
            )
            proposal_cols = st.columns(2)
            proposed_domain = proposal_cols[0].text_input(
                "Proposed domain",
                value=existing_structured["domain"],
                key=f"proposal_domain_{asset['fqn']}",
            )
            proposed_tier = proposal_cols[1].selectbox(
                "Proposed tier",
                _TIER_OPTIONS,
                index=_select_index(_TIER_OPTIONS, existing_structured["tier"]),
                key=f"proposal_tier_{asset['fqn']}",
            )
            proposed_certification = proposal_cols[0].selectbox(
                "Proposed certification",
                _CERTIFICATION_OPTIONS,
                index=_select_index(
                    _CERTIFICATION_OPTIONS, existing_structured["certification"]
                ),
                key=f"proposal_certification_{asset['fqn']}",
            )
            proposed_sensitivity = proposal_cols[1].selectbox(
                "Proposed sensitivity",
                _SENSITIVITY_OPTIONS,
                index=_select_index(
                    _SENSITIVITY_OPTIONS, existing_structured["sensitivity"]
                ),
                key=f"proposal_sensitivity_{asset['fqn']}",
            )
            proposed_owner_principal = ""
            proposed_owner_email = ""
            if principal_options:
                proposed_owner_principal = proposal_cols[0].selectbox(
                    "Proposed workspace user",
                    principal_options,
                    format_func=lambda value: principal_labels.get(value, value),
                    key=f"proposal_owner_principal_{asset['fqn']}",
                )
            else:
                proposed_owner_email = proposal_cols[0].text_input(
                    "Proposed owner email",
                    key=f"proposal_owner_email_{asset['fqn']}",
                )
            proposed_owner_type = proposal_cols[1].selectbox(
                "Proposed owner type",
                ["", "technical", "business", "steward"],
                key=f"proposal_owner_type_{asset['fqn']}",
            )
            proposed_custom_tags = _tags_editor(
                _custom_tags_df(tags_df),
                key=f"proposal_tags_{asset['fqn']}",
                suggestions=tag_suggestions,
            )
            if st.button(
                "Submit metadata change request",
                type="primary",
                use_container_width=True,
                key=f"submit_request_{asset['fqn']}",
            ):
                resolved_proposed_owner = proposed_owner_principal or proposed_owner_email
                desired_tags = {
                    **existing_custom,
                    **{
                        key: value
                        for key, value in existing_structured.items()
                        if value
                    },
                    **_df_to_tags_map(proposed_custom_tags),
                    **{
                        key: value
                        for key, value in {
                            "domain": proposed_domain,
                            "tier": proposed_tier,
                            "certification": proposed_certification,
                            "sensitivity": proposed_sensitivity,
                            _REQUEST_OWNER_EMAIL_KEY: resolved_proposed_owner,
                            _REQUEST_OWNER_TYPE_KEY: proposed_owner_type,
                        }.items()
                        if value
                    },
                }
                request_id = store.create_change_request(
                    created_by=user_email,
                    uc_full_name=asset["fqn"],
                    new_comment=proposed_comment,
                    new_uc_tags=desired_tags,
                )
                st.success(f"Change request `{request_id}` submitted.")
                st.cache_data.clear()


def page_discovery(
    uc: UCSQLClient,
    store: GovernanceStore,
    inventory: pd.DataFrame,
    role: str,
    user_email: str,
) -> None:
    _render_section_intro(
        "Discovery",
        "Search the catalog, narrow the results with filters, and open an asset to review metadata, ownership, sample data, and lineage.",
    )

    selected = _selected_asset(inventory)
    has_selected_asset = bool(st.session_state.get("discovery_asset_opened")) and selected is not None

    if not has_selected_asset:
        filtered = _filtered_inventory(
            inventory,
            show_controls=True,
            available_catalogs=_cached_catalogs(uc),
        )

        if filtered.empty:
            st.warning("No assets match the current search and filter set.")
            return

        selected_views = st.session_state.get("asset_view_filters", [])
        if selected_views and "All Assets" not in selected_views:
            st.caption(
                f"{len(filtered)} assets match the current filters across {', '.join(selected_views)}."
            )
        else:
            st.caption(f"{len(filtered)} assets match the current discovery filters.")
        st.markdown("#### Search Results")
        if len(filtered) > 12:
            st.caption(
                "Showing the first 12 results. Narrow the search or open an asset to continue."
            )
        result_cols = st.columns(2)
        for idx, (_, asset_series) in enumerate(filtered.head(12).iterrows()):
            with result_cols[idx % 2]:
                st.markdown(_asset_card_html(asset_series, False), unsafe_allow_html=True)
    else:
        back_col, _ = st.columns([0.22, 0.78])
        with back_col:
            if st.button(
                "← Back to Search",
                key="discovery_back_to_search",
                use_container_width=True,
            ):
                st.session_state["discovery_asset_opened"] = False
                _clear_asset_query_state()
                st.rerun()
        _render_asset_profile(selected, inventory, uc, store, role, user_email)


def page_lineage(
    uc: UCSQLClient,
    inventory: pd.DataFrame,
) -> None:
    _render_section_intro(
        "Lineage",
        "Review upstream producers, downstream consumers, and column lineage for the selected asset before making a schema or pipeline change.",
    )
    selected_fqn = _asset_selector(
        inventory,
        "lineage_selector",
        "Asset",
        allow_external_current=True,
    )
    if not selected_fqn:
        st.info("Select an asset to explore lineage.")
        return

    asset = _lineage_asset_stub(inventory, selected_fqn)
    visible_assets = set(inventory["fqn"].tolist())
    catalog, schema, table = _split_uc_name(selected_fqn)
    current_context = _normalize_str(
        st.session_state.get("lineage_workspace_context")
    ) or "Data Lineage"
    if current_context not in {"Data Lineage", "Operational Context"}:
        current_context = "Data Lineage"
    st.session_state["lineage_workspace_context"] = current_context

    lineage_up = pd.DataFrame()
    lineage_down = pd.DataFrame()
    col_up = pd.DataFrame()
    col_down = pd.DataFrame()
    op_up = pd.DataFrame()
    op_down = pd.DataFrame()
    lineage_up_error = None
    lineage_down_error = None
    col_up_error = None
    col_down_error = None
    op_up_error = None
    op_down_error = None

    with st.spinner("Loading lineage..."):
        if current_context == "Operational Context":
            op_up, op_up_error = _safe_df_call(
                _cached_operational_context_up, uc, catalog, schema, table
            )
            op_down, op_down_error = _safe_df_call(
                _cached_operational_context_down, uc, catalog, schema, table
            )
        else:
            lineage_up, lineage_up_error = _safe_df_call(
                _cached_lineage_up, uc, catalog, schema, table
            )
            lineage_down, lineage_down_error = _safe_df_call(
                _cached_lineage_down, uc, catalog, schema, table
            )
            col_up, col_up_error = _safe_df_call(
                _cached_col_lineage_up, uc, catalog, schema, table
            )
            col_down, col_down_error = _safe_df_call(
                _cached_col_lineage_down, uc, catalog, schema, table
            )
    if current_context == "Operational Context":
        op_up = _enrich_operational_context_names(uc, op_up)
        op_down = _enrich_operational_context_names(uc, op_down)

    lineage_up = _filter_asset_rows(
        lineage_up,
        ["source_table_full_name"],
        exclude_fqn=selected_fqn,
    )
    lineage_down = _filter_asset_rows(
        lineage_down,
        ["target_table_full_name"],
        exclude_fqn=selected_fqn,
    )
    col_up = _filter_asset_rows(
        col_up,
        ["source_table_full_name"],
        exclude_fqn=selected_fqn,
    )
    col_down = _filter_asset_rows(
        col_down,
        ["target_table_full_name"],
        exclude_fqn=selected_fqn,
    )
    op_up = _filter_asset_rows(
        op_up,
        ["related_table_full_name"],
        exclude_fqn=selected_fqn,
    )
    op_down = _filter_asset_rows(
        op_down,
        ["related_table_full_name"],
        exclude_fqn=selected_fqn,
    )

    st.markdown(
        _route_subnav_html(
            [
                (
                    name,
                    _lineage_query_href(selected_fqn, context=name),
                )
                for name in ["Data Lineage", "Operational Context"]
            ],
            current_context,
            label="Workspace View",
            help_text={
                "Data Lineage": "Trace upstream tables, downstream consumers, and column-level dependencies.",
                "Operational Context": "Inspect jobs, pipelines, notebooks, and queries that produce or consume this asset.",
            },
        ),
        unsafe_allow_html=True,
    )
    st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)

    lineage_up_view = lineage_up
    lineage_down_view = lineage_down
    col_up_view = col_up
    col_down_view = col_down
    op_up_view = op_up
    op_down_view = op_down

    if current_context == "Data Lineage":
        filter_cols = st.columns(2)
        catalog_key = f"lineage_catalog_scopes_{selected_fqn}"
        schema_key = f"lineage_schema_scopes_{selected_fqn}"
        lineage_catalogs = _catalog_scope_options(
            lineage_up,
            lineage_down,
            col_up,
            col_down,
            current_fqn=selected_fqn,
        )
        observed_catalogs = _remember_observed_catalogs(lineage_catalogs)
        catalog_options = _catalog_filter_options(
            inventory,
            available_catalogs=_cached_catalogs(uc),
            observed_catalogs=observed_catalogs,
        )
        current_catalog = ""
        try:
            current_catalog, _, _ = _split_uc_name(selected_fqn)
        except ValueError:
            current_catalog = ""
        if current_catalog and current_catalog not in catalog_options:
            catalog_options = sorted(catalog_options + [current_catalog])
        selected_catalogs = _clean_multiselect_state(catalog_key, catalog_options)
        with filter_cols[0]:
            selected_catalogs = _render_filter_multiselect(
                filter_cols[0],
                "Catalog Scope",
                catalog_options,
                key=catalog_key,
                placeholder="All catalogs",
                empty_label="No lineage catalogs available",
            )

        schema_options = _schema_name_scope_options(
            lineage_up,
            lineage_down,
            col_up,
            col_down,
            selected_catalogs,
            op_up,
            op_down,
            current_fqn=selected_fqn,
        )
        selected_schemas = _clean_multiselect_state(schema_key, schema_options)
        with filter_cols[1]:
            selected_schemas = _render_filter_multiselect(
                filter_cols[1],
                "Schema Scope",
                schema_options,
                key=schema_key,
                placeholder="All schemas",
                empty_label="No lineage schemas available",
            )

        lineage_up_view = _apply_catalog_scope(
            lineage_up, "source_table_full_name", selected_catalogs
        )
        lineage_down_view = _apply_catalog_scope(
            lineage_down, "target_table_full_name", selected_catalogs
        )
        col_up_view = _apply_catalog_scope(
            col_up, "source_table_full_name", selected_catalogs
        )
        col_down_view = _apply_catalog_scope(
            col_down, "target_table_full_name", selected_catalogs
        )
        lineage_up_view = _apply_schema_name_scope(
            lineage_up_view, "source_table_full_name", selected_schemas
        )
        lineage_down_view = _apply_schema_name_scope(
            lineage_down_view, "target_table_full_name", selected_schemas
        )
        col_up_view = _apply_schema_name_scope(
            col_up_view, "source_table_full_name", selected_schemas
        )
        col_down_view = _apply_schema_name_scope(
            col_down_view, "target_table_full_name", selected_schemas
        )
    else:
        _remember_observed_catalogs(
            _catalog_scope_options(
                pd.DataFrame(),
                pd.DataFrame(),
                pd.DataFrame(),
                pd.DataFrame(),
                op_up,
                op_down,
                current_fqn=selected_fqn,
            )
        )
        type_key = f"lineage_operational_types_{selected_fqn}"
        type_options = _operational_type_options(op_up, op_down)
        _clean_multiselect_state(type_key, type_options)
        selected_types = _render_filter_multiselect(
            st,
            "Asset Types",
            type_options,
            key=type_key,
            placeholder="All workload types",
            empty_label="No workload types available",
        )
        op_up_view = _apply_operational_type_scope(op_up, selected_types)
        op_down_view = _apply_operational_type_scope(op_down, selected_types)

    focus_asset_name = _normalize_str(asset.get("table_name")) or selected_fqn.split(".")[-1]
    op_up_cards = _summarize_operational_context(
        op_up_view,
        direction="upstream",
        focus_asset_name=focus_asset_name,
    )
    op_down_cards = _summarize_operational_context(
        op_down_view,
        direction="downstream",
        focus_asset_name=focus_asset_name,
    )

    if current_context == "Data Lineage":
        l1, l2, l3 = st.columns([1.15, 0.9, 1.15])
        with l1:
            st.markdown("#### Upstream")
            if lineage_up_error:
                st.warning(f"Could not query upstream lineage: {lineage_up_error}")
            elif lineage_up_view.empty:
                st.info("No upstream dependencies found.")
            else:
                for row in lineage_up_view.head(8).itertuples(index=False):
                    st.markdown(
                        _lineage_node_html(
                            "Source",
                            _normalize_str(row.source_table_full_name),
                            "source",
                            object_type=_normalize_str(getattr(row, "source_type", "")),
                            href=_lineage_href_if_known(
                                _normalize_str(row.source_table_full_name),
                                visible_assets,
                                context=current_context,
                            ),
                        ),
                        unsafe_allow_html=True,
                    )

        with l2:
            st.markdown("#### Selected Asset")
            st.markdown(
                _lineage_node_html(
                    "Focus",
                    selected_fqn,
                    "focus",
                    focus=True,
                    object_type=_normalize_str(asset.get("table_type")),
                ),
                unsafe_allow_html=True,
            )
            st.markdown(
                _lineage_focus_summary_html(
                    asset,
                    lineage_up_view,
                    lineage_down_view,
                    col_up_view,
                    col_down_view,
                ),
                unsafe_allow_html=True,
            )

        with l3:
            st.markdown("#### Downstream")
            if lineage_down_error:
                st.warning(f"Could not query downstream lineage: {lineage_down_error}")
            elif lineage_down_view.empty:
                st.info("No downstream consumers found.")
            else:
                for row in lineage_down_view.head(8).itertuples(index=False):
                    st.markdown(
                        _lineage_node_html(
                            "Target",
                            _normalize_str(row.target_table_full_name),
                            "target",
                            object_type=_normalize_str(getattr(row, "target_type", "")),
                            href=_lineage_href_if_known(
                                _normalize_str(row.target_table_full_name),
                                visible_assets,
                                context=current_context,
                            ),
                        ),
                        unsafe_allow_html=True,
                    )

        st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)
        table_lineage_tab, column_lineage_tab = st.tabs(
            ["Table Lineage", "Column Lineage"]
        )

        with table_lineage_tab:
            col1, col2 = st.columns(2)
            with col1:
                st.markdown("#### Upstream Table Details")
                if lineage_up_error:
                    st.warning(f"Could not query upstream lineage: {lineage_up_error}")
                elif lineage_up_view.empty:
                    st.info("No upstream table lineage available.")
                else:
                    _render_data_table(lineage_up_view)
            with col2:
                st.markdown("#### Downstream Table Details")
                if lineage_down_error:
                    st.warning(f"Could not query downstream lineage: {lineage_down_error}")
                elif lineage_down_view.empty:
                    st.info("No downstream table lineage available.")
                else:
                    _render_data_table(lineage_down_view)

        with column_lineage_tab:
            upstream_column_tab, downstream_column_tab = st.tabs(
                ["Upstream Lineage", "Downstream Lineage"]
            )

            with upstream_column_tab:
                if col_up_error:
                    st.warning(
                        f"Could not query upstream column lineage: {col_up_error}"
                    )
                elif col_up_view.empty:
                    st.info("No upstream column lineage is available.")
                else:
                    _render_column_lineage(col_up_view, key=f"col_up_{selected_fqn}")

            with downstream_column_tab:
                if col_down_error:
                    st.warning(
                        f"Could not query downstream column lineage: {col_down_error}"
                    )
                elif col_down_view.empty:
                    st.info("No downstream column lineage is available.")
                else:
                    _render_column_lineage(col_down_view, key=f"col_down_{selected_fqn}")
    else:
        l1, l2, l3 = st.columns([1.02, 1.18, 1.12])
        with l1:
            st.markdown("#### Upstream Workloads")
            if op_up_error:
                st.warning(f"Could not query upstream workload context: {op_up_error}")
            elif not op_up_cards:
                st.info("No upstream workload context is available for this asset.")
            else:
                st.markdown(
                    f"<div class='gh-operational-grid'>{''.join(_operational_context_card_html(item) for item in op_up_cards)}</div>",
                    unsafe_allow_html=True,
                )

        with l2:
            st.markdown("#### Selected Asset")
            st.markdown(
                _lineage_node_html(
                    "Focus",
                    selected_fqn,
                    "focus",
                    focus=True,
                    object_type=_normalize_str(asset.get("table_type")),
                ),
                unsafe_allow_html=True,
            )
            st.markdown(
                _operational_focus_summary_html(
                    asset,
                    op_up_cards,
                    op_down_cards,
                    op_up_view,
                    op_down_view,
                ),
                unsafe_allow_html=True,
            )

        with l3:
            st.markdown("#### Downstream Consumers")
            if op_down_error:
                st.warning(
                    f"Could not query downstream workload context: {op_down_error}"
                )
            elif not op_down_cards:
                st.info("No downstream workload context is available for this asset.")
            else:
                st.markdown(
                    f"<div class='gh-operational-grid'>{''.join(_operational_context_card_html(item) for item in op_down_cards)}</div>",
                    unsafe_allow_html=True,
                )


def page_governance(
    uc: UCSQLClient,
    store: GovernanceStore,
    om: Optional[OpenMetadataClient],
    inventory: pd.DataFrame,
    role: str,
    user_email: str,
) -> None:
    _render_section_intro(
        "Governance",
        "Manage glossary terms, certification coverage, policy gaps, and external metadata links for the current catalog inventory.",
    )

    metrics = st.columns(4)
    metrics[0].metric("Glossary Terms", len(store.list_glossary_terms(limit=500)))
    metrics[1].metric("Certified Assets", int(inventory["certification"].ne("").sum()))
    metrics[2].metric("Sensitive Assets", int(inventory["sensitivity"].ne("").sum()))
    metrics[3].metric("Unowned Assets", int(inventory["owner_count"].eq(0).sum()))

    section = _button_nav(
        ["Glossary", "Coverage & Policy", "Integrations"],
        "governance_section",
        help_map={
            "Glossary": "Define business terms and review which assets are linked to them.",
            "Coverage & Policy": "Inspect governance gaps, policy issues, and coverage backlogs across the catalog.",
            "Integrations": "Review and manage external metadata links such as OpenMetadata connections.",
        },
    )
    st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)

    if section == "Glossary":
        search = st.text_input(
            "Search glossary terms",
            placeholder="revenue, customer, finance",
            key="glossary_search",
        )
        terms = (
            store.search_glossary(search)
            if search
            else store.list_glossary_terms(limit=500)
        )
        left, right = st.columns([0.9, 1.1])
        with left:
            st.markdown(
                "<div class='gh-kicker'>Glossary Directory</div>",
                unsafe_allow_html=True,
            )
            if terms.empty:
                st.info("No glossary terms match the current search.")
            else:
                _render_data_table(
                    terms[["term_id", "name", "domain", "status"]],
                )

        with right:
            st.markdown(
                "<div class='gh-kicker'>Term Detail</div>",
                unsafe_allow_html=True,
            )
            if not terms.empty:
                term_id = st.selectbox(
                    "Glossary term",
                    terms["term_id"].tolist(),
                    format_func=lambda value: value,
                    key="selected_glossary_term",
                )
                if term_id is not None:
                    term = store.get_glossary_term(term_id)
                else:
                    term = None
                if term is not None:
                    linked_assets = inventory[inventory["glossary_term"] == term_id][
                        [
                            "fqn",
                            "domain",
                            "tier",
                            "certification",
                            "governance_score",
                        ]
                    ]
                    header_cols = st.columns(2)
                    header_cols[0].metric("Linked assets", len(linked_assets))
                    header_cols[1].metric(
                        "Approved terms",
                        int((terms["status"] == "approved").sum()),
                    )
                    detail_df = pd.DataFrame(
                        [
                            {
                                "Field": "Name",
                                "Value": _normalize_str(term.get("name")),
                            },
                            {
                                "Field": "Definition",
                                "Value": _normalize_str(term.get("definition")),
                            },
                            {
                                "Field": "Domain",
                                "Value": _normalize_str(term.get("domain")),
                            },
                            {
                                "Field": "Owner",
                                "Value": _normalize_str(term.get("owner_email")),
                            },
                            {
                                "Field": "Status",
                                "Value": _normalize_str(term.get("status")),
                            },
                        ]
                    )
                    _render_data_table(detail_df)
                    st.markdown("#### Linked assets")
                    if linked_assets.empty:
                        st.info("No assets are linked to this term yet.")
                    else:
                        _render_data_table(linked_assets)
            else:
                st.info("Select or create a glossary term to start building business context.")

        if role in {"writer", "admin"}:
            st.divider()
            st.markdown(
                "<div class='gh-kicker'>Create or Update Term</div>",
                unsafe_allow_html=True,
            )
            with st.form("upsert_term"):
                term_id = st.text_input("Term ID")
                name = st.text_input("Display name")
                definition = st.text_area("Definition", height=120)
                domain = st.text_input("Domain")
                owner = st.text_input("Owner email")
                status = st.selectbox("Status", ["draft", "approved", "deprecated"])
                if st.form_submit_button("Save term", type="primary"):
                    if not term_id or not name:
                        st.error("Term ID and display name are required.")
                    else:
                        store.upsert_glossary_term(
                            term_id=term_id,
                            name=name,
                            definition=definition or None,
                            domain=domain or None,
                            owner_email=owner or None,
                            status=status,
                            updated_by=user_email,
                        )
                        st.success(f"Saved glossary term `{term_id}`.")
                        st.cache_data.clear()
                        st.rerun()

    elif section == "Coverage & Policy":
        backlog = inventory.copy()
        backlog["missing_description"] = backlog["comment"].eq("")
        backlog["missing_owner"] = backlog["owner_count"].eq(0)
        backlog["missing_certification"] = backlog["certification"].eq("")
        backlog["missing_domain"] = backlog["domain"].eq("")
        backlog["gaps"] = backlog[
            [
                "missing_description",
                "missing_owner",
                "missing_certification",
                "missing_domain",
            ]
        ].sum(axis=1)
        coverage = backlog[
            [
                "fqn",
                "domain",
                "tier",
                "certification",
                "sensitivity",
                "owners_summary",
                "glossary_term",
                "owner_count",
                "pending_requests",
                "governance_score",
                "gaps",
            ]
        ].sort_values(
            ["gaps", "pending_requests", "governance_score"],
            ascending=[False, False, True],
        )

        coverage["search_blob"] = (
            coverage[
                [
                    "fqn",
                    "domain",
                    "tier",
                    "certification",
                    "sensitivity",
                    "owners_summary",
                    "glossary_term",
                ]
            ]
            .fillna("")
            .astype(str)
            .agg(" ".join, axis=1)
            .str.lower()
        )

        search = st.text_input(
            "Search Coverage & Policy",
            placeholder="customer, finance, glossary term, steward, tier 1",
            key="coverage_search",
        )
        filters = st.columns(4)
        focus = filters[0].selectbox(
            "Focus",
            [
                "All",
                "Missing Description",
                "Missing Owner",
                "Missing Certification",
                "Open Requests",
            ],
            key="coverage_focus",
        )
        domain_filter = filters[1].selectbox(
            "Domain",
            ["All"]
            + sorted([v for v in backlog["domain"].unique().tolist() if v]),
            key="coverage_domain",
        )
        cert_filter = filters[2].selectbox(
            "Certification",
            ["All"]
            + sorted([v for v in backlog["certification"].unique().tolist() if v]),
            key="coverage_cert",
        )
        tier_filter = filters[3].selectbox(
            "Tier",
            ["All"] + sorted([v for v in backlog["tier"].unique().tolist() if v]),
            key="coverage_tier",
        )

        if search:
            coverage = coverage[
                coverage["search_blob"].str.contains(search.lower(), regex=False, na=False)
            ]
        if focus == "Missing Description":
            coverage = coverage[backlog.loc[coverage.index, "missing_description"]]
        elif focus == "Missing Owner":
            coverage = coverage[backlog.loc[coverage.index, "missing_owner"]]
        elif focus == "Missing Certification":
            coverage = coverage[backlog.loc[coverage.index, "missing_certification"]]
        elif focus == "Open Requests":
            coverage = coverage[coverage["pending_requests"] > 0]
        if domain_filter != "All":
            coverage = coverage[coverage["domain"] == domain_filter]
        if cert_filter != "All":
            coverage = coverage[coverage["certification"] == cert_filter]
        if tier_filter != "All":
            coverage = coverage[coverage["tier"] == tier_filter]

        gap_metrics = st.columns(4)
        gap_metrics[0].metric("Missing Descriptions", int(backlog["missing_description"].sum()))
        gap_metrics[1].metric("Missing Owners", int(backlog["missing_owner"].sum()))
        gap_metrics[2].metric(
            "Missing Certifications", int(backlog["missing_certification"].sum())
        )
        gap_metrics[3].metric("Open Policy Issues", int((backlog["pending_requests"] > 0).sum()))

        _render_data_table(coverage.drop(columns=["search_blob"]))

    else:
        if om is None:
            st.info(
                "OpenMetadata is not configured. The app is running in Databricks-native mode."
            )
        else:
            st.success("OpenMetadata connector is active.")
            query = st.text_input(
                "Search OpenMetadata tables", value="*", key="om_query"
            )
            if st.button("Search OpenMetadata", key="om_search_button", type="primary"):
                try:
                    st.session_state["om_results"] = om.search(
                        query, index="table_search_index", size=15
                    )
                except OpenMetadataError as exc:
                    st.error(str(exc))

            results = st.session_state.get("om_results", [])
            if results:
                _render_data_table(pd.DataFrame([row.__dict__ for row in results]))

        if role in {"writer", "admin"}:
            st.divider()
            st.markdown("#### Link Databricks asset to OpenMetadata")
            selected_fqn = _asset_selector(
                inventory, "om_link_asset", "Databricks asset"
            )
            om_fqn = st.text_input("OpenMetadata table FQN", key="om_link_fqn")
            if st.button("Save integration link", use_container_width=True):
                if not selected_fqn or not om_fqn:
                    st.error(
                        "Provide both the Databricks asset and the OpenMetadata table FQN."
                    )
                else:
                    store.upsert_asset_link(selected_fqn, om_fqn, user_email)
                    st.success("Integration link saved.")
                    st.cache_data.clear()
                    st.rerun()

        st.divider()
        st.markdown("#### Current links")
        _render_data_table(store.list_asset_links())


def page_help() -> None:
    _render_section_intro(
        "Help",
        "Understand the main workflows, how coverage is calculated, and what the key object and lineage terms mean.",
    )

    help_sections = [
        "Using the App",
        "Coverage Score",
        "Object Types & Lineage",
    ]
    section = _normalize_str(st.session_state.get("help_section")) or help_sections[0]
    if section not in help_sections:
        section = help_sections[0]
    st.session_state["help_section"] = section
    st.markdown(
        _route_subnav_html(
            [(name, _help_query_href(name)) for name in help_sections],
            section,
            help_text={
                "Using the App": "Review the main workflow across Discovery, asset profiles, governance, and lineage.",
                "Coverage Score": "See which metadata inputs contribute to the governance coverage score and status thresholds.",
                "Object Types & Lineage": "Understand the core Unity Catalog object types and lineage terminology used across the app.",
            },
        ),
        unsafe_allow_html=True,
    )
    st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)

    if section == "Using the App":
        left, right = st.columns([1.15, 0.85])
        with left:
            st.markdown("#### Core workflow")
            _render_data_table(
                pd.DataFrame(
                    [
                        {
                            "Step": "Discovery",
                            "Purpose": "Search the catalog, filter assets, and identify gaps in ownership or documentation.",
                        },
                        {
                            "Step": "Asset Profile",
                            "Purpose": "Review metadata, schema, sample data, lineage, and governance context in one place.",
                        },
                        {
                            "Step": "Governance",
                            "Purpose": "Add descriptions, assign owners, set certifications, manage glossary links, and submit changes.",
                        },
                        {
                            "Step": "Lineage",
                            "Purpose": "Inspect upstream and downstream dependencies before changing models, jobs, or downstream consumers.",
                        },
                    ]
                ),
                max_rows=20,
            )
        with right:
            st.markdown("#### Status meanings")
            _render_data_table(
                pd.DataFrame(
                    [
                        {"Status": "Needs Work", "Meaning": "Important governance context is still missing."},
                        {"Status": "Operational", "Meaning": "Core governance fields are in place for normal use."},
                        {"Status": "Enterprise Ready", "Meaning": "The asset has strong coverage across the tracked governance fields."},
                    ]
                ),
                max_rows=20,
            )

    elif section == "Coverage Score":
        st.markdown("#### Coverage Score inputs")
        _render_data_table(
            pd.DataFrame(
                [
                    {"Component": "Business Description", "Weight": 35, "Description": "The table has a documented comment or description."},
                    {"Component": "Owner Assigned", "Weight": 20, "Description": "At least one business, technical, or steward owner is assigned."},
                    {"Component": "Domain", "Weight": 15, "Description": "A governance domain tag is set."},
                    {"Component": "Certification", "Weight": 15, "Description": "The asset has a certification state."},
                    {"Component": "Glossary Term", "Weight": 15, "Description": "The asset is linked to a glossary term."},
                ]
            ),
            max_rows=20,
        )
        st.markdown("#### Score thresholds")
        _render_data_table(
            pd.DataFrame(
                [
                    {"Coverage Score": "0 - 54", "Result": "Needs Work"},
                    {"Coverage Score": "55 - 79", "Result": "Operational"},
                    {"Coverage Score": "80 - 100", "Result": "Enterprise Ready"},
                ]
            ),
            max_rows=20,
        )

    else:
        left, right = st.columns(2)
        with left:
            st.markdown("#### Object types")
            _render_data_table(
                pd.DataFrame(
                    [
                        {"Label": "Managed Table", "Meaning": "A Unity Catalog managed table."},
                        {"Label": "Streaming Table", "Meaning": "A streaming table maintained by pipelines or streaming workloads."},
                        {"Label": "Materialized View", "Meaning": "A derived view stored and maintained by the platform."},
                        {"Label": "View", "Meaning": "A logical view defined over other objects."},
                    ]
                ),
                max_rows=20,
            )
        with right:
            st.markdown("#### Lineage terms")
            _render_data_table(
                pd.DataFrame(
                    [
                        {"Term": "Table Lineage", "Meaning": "Relationships between whole upstream and downstream objects."},
                        {"Term": "Column Lineage", "Meaning": "Relationships between specific source and target columns."},
                        {"Term": "Direct Lineage", "Meaning": "Same-name source-to-target lineage."},
                        {"Term": "Indirect Lineage", "Meaning": "Broader dependencies created by joins, expressions, or multi-column logic."},
                    ]
                ),
                max_rows=20,
            )


def page_stewardship(
    uc: UCSQLClient,
    store: GovernanceStore,
    inventory: pd.DataFrame,
    role: str,
    user_email: str,
) -> None:
    _render_section_intro(
        "Stewardship",
        "Review open metadata requests and work through the backlog for assets that still need descriptions, ownership, or certification.",
    )

    requests = store.list_change_requests(limit=300)
    metrics = st.columns(4)
    metrics[0].metric(
        "Pending Requests",
        int((requests["status"] == "pending").sum()) if not requests.empty else 0,
    )
    metrics[1].metric(
        "Approved Requests",
        int((requests["status"] == "approved").sum()) if not requests.empty else 0,
    )
    metrics[2].metric(
        "Rejected Requests",
        int((requests["status"] == "rejected").sum()) if not requests.empty else 0,
    )
    metrics[3].metric(
        "Assets Needing Stewardship",
        int(((inventory["comment"] == "") | (inventory["owner_count"] == 0)).sum()),
    )

    queue_tab, backlog_tab = st.tabs(["Request Queue", "Stewardship Backlog"])

    with queue_tab:
        if requests.empty:
            st.info("There are no metadata change requests yet.")
        else:
            status_filter = st.selectbox(
                "Status",
                ["all", "pending", "approved", "rejected"],
                key="request_status_filter",
            )
            filtered = requests.copy()
            if status_filter != "all":
                filtered = filtered[filtered["status"] == status_filter]
            _render_data_table(filtered)

            if role in {"writer", "admin"} and not filtered.empty:
                pending_ids = filtered["request_id"].tolist()
                request_id = st.selectbox(
                    "Review request", pending_ids, key="request_picker"
                )
                if request_id is not None:
                    request = store.get_change_request(request_id)
                else:
                    request = None
                if request:
                    request_tag_payload, request_special = _split_request_tags(
                        request.new_uc_tags
                    )
                    st.markdown("#### Review")
                    detail_rows_list = [
                        {"Field": "Status", "Value": request.status},
                        {"Field": "Created by", "Value": request.created_by},
                        {"Field": "Asset", "Value": request.uc_full_name or "—"},
                        {"Field": "Comment", "Value": request.new_comment or "—"},
                    ]
                    if request_special.get(_REQUEST_OWNER_EMAIL_KEY):
                        detail_rows_list.append(
                            {
                                "Field": "Proposed owner",
                                "Value": f"{request_special.get(_REQUEST_OWNER_EMAIL_KEY)} ({request_special.get(_REQUEST_OWNER_TYPE_KEY) or 'unspecified'})",
                            }
                        )
                    if request_special.get(_REQUEST_COLUMN_NAME_KEY):
                        detail_rows_list.append(
                            {
                                "Field": "Column update",
                                "Value": f"{request_special.get(_REQUEST_COLUMN_NAME_KEY)} -> {request_special.get(_REQUEST_COLUMN_COMMENT_KEY) or 'Clear comment'}",
                            }
                        )
                    if request_tag_payload:
                        detail_rows_list.append(
                            {
                                "Field": "Proposed tags",
                                "Value": json.dumps(request_tag_payload, indent=2),
                            }
                        )
                    detail_rows = pd.DataFrame(detail_rows_list)
                    _render_data_table(detail_rows)
                    if request.status == "pending" and request_id is not None:
                        action = st.radio(
                            "Decision",
                            ["approve", "reject"],
                            horizontal=True,
                            key="review_action",
                        )
                        note = st.text_input("Review note", key="review_note")
                        if st.button(
                            "Apply decision", type="primary", use_container_width=True
                        ):
                            if action == "reject":
                                store.set_request_status(
                                    request_id, "rejected", user_email, note or None
                                )
                                st.success("Request rejected.")
                                st.cache_data.clear()
                                st.rerun()

                            try:
                                if request.uc_full_name:
                                    catalog, schema, table = _split_uc_name(
                                        request.uc_full_name
                                    )
                                    request_tags, request_special = _split_request_tags(
                                        request.new_uc_tags
                                    )
                                    if request.new_comment is not None:
                                        uc.set_table_comment(
                                            catalog, schema, table, request.new_comment
                                        )
                                    if request_special.get(_REQUEST_OWNER_EMAIL_KEY):
                                        store.upsert_owner(
                                            request.uc_full_name,
                                            request_special[_REQUEST_OWNER_EMAIL_KEY],
                                            request_special.get(_REQUEST_OWNER_TYPE_KEY)
                                            or "technical",
                                            user_email,
                                        )
                                    if request_special.get(_REQUEST_COLUMN_NAME_KEY):
                                        uc.set_column_comment(
                                            catalog,
                                            schema,
                                            table,
                                            request_special[_REQUEST_COLUMN_NAME_KEY],
                                            request_special.get(_REQUEST_COLUMN_COMMENT_KEY, ""),
                                        )
                                    if request_tags:
                                        existing_tags = _cached_table_tags(
                                            uc, catalog, schema, table
                                        )
                                        _apply_table_tags(
                                            uc,
                                            catalog,
                                            schema,
                                            table,
                                            existing_tags,
                                            request_tags,
                                        )
                                store.set_request_status(
                                    request_id, "approved", user_email, note or None
                                )
                                st.success("Request approved and applied.")
                                st.cache_data.clear()
                                st.rerun()
                            except Exception as exc:
                                store.set_request_status(
                                    request_id, "rejected", user_email, str(exc)
                                )
                                st.error(f"Could not apply request: {exc}")

    with backlog_tab:
        backlog = inventory.copy()
        backlog["needs_description"] = backlog["comment"].eq("")
        backlog["needs_owner"] = backlog["owner_count"].eq(0)
        backlog["needs_certification"] = backlog["certification"].eq("")
        backlog["priority"] = (
            backlog["needs_description"].astype(int)
            + backlog["needs_owner"].astype(int)
            + backlog["needs_certification"].astype(int)
            + backlog["pending_requests"].gt(0).astype(int)
        )
        backlog = backlog[
            [
                "fqn",
                "domain",
                "tier",
                "owner_count",
                "pending_requests",
                "governance_score",
                "priority",
            ]
        ].sort_values(
            ["priority", "pending_requests", "governance_score"],
            ascending=[False, False, True],
        )
        _render_data_table(backlog)


def page_admin(store: GovernanceStore, role: str, user_email: str) -> None:
    _render_section_intro(
        "Admin",
        "Manage access to this app by assigning reader, writer, and admin roles.",
    )
    if role != "admin":
        st.info("This workspace is restricted to admins.")
        return

    roles_df = store.list_roles()
    metrics = st.columns(3)
    metrics[0].metric(
        "Admins", int((roles_df["role"] == "admin").sum()) if not roles_df.empty else 0
    )
    metrics[1].metric(
        "Writers",
        int((roles_df["role"] == "writer").sum()) if not roles_df.empty else 0,
    )
    metrics[2].metric(
        "Readers",
        int((roles_df["role"] == "reader").sum()) if not roles_df.empty else 0,
    )

    _render_data_table(roles_df)
    with st.form("role_editor"):
        email = st.text_input("User email")
        new_role = st.selectbox("Role", ["reader", "writer", "admin"])
        if st.form_submit_button("Save role", type="primary"):
            store.upsert_role(email, new_role, user_email)
            st.success("Role updated.")
            st.cache_data.clear()
            st.rerun()


def main() -> None:
    st.set_page_config(
        page_title="Governance Hub",
        page_icon="🏛️",
        layout="wide",
        initial_sidebar_state="collapsed",
    )
    _render_styles()
    _install_client_bootstrap()

    boot_placeholder = st.empty()
    boot_placeholder.markdown(
        _loading_card_html(
            "Loading workspace",
            "The first load can take a few seconds while Unity Catalog metadata and governance state are cached.",
        ),
        unsafe_allow_html=True,
    )

    try:
        cfg = _get_config()
        uc = _get_uc_client(cfg)
        store = _get_store(cfg, uc)
        om = _get_om_client(cfg)
    except Exception as exc:
        boot_placeholder.empty()
        st.error(f"Configuration error: {exc}")
        st.stop()

    user_email = get_current_user_email() or "unknown"
    role = store.get_role(user_email, admin_emails=cfg.admin_emails)
    inventory = _cached_asset_inventory(uc, store)
    boot_placeholder.empty()

    _render_shell(role, user_email, inventory)
    if inventory.empty:
        st.warning(
            "No Unity Catalog assets are visible to this app. Check warehouse access and catalog permissions."
        )
        return

    if "selected_asset_fqn" not in st.session_state:
        st.session_state["selected_asset_fqn"] = inventory.iloc[0]["fqn"]
    if "app_page" not in st.session_state:
        st.session_state["app_page"] = "Discovery"
    if "discovery_asset_opened" not in st.session_state:
        st.session_state["discovery_asset_opened"] = False
    st.session_state.pop("module_nav_page", None)
    st.session_state.pop("_last_module_nav_page", None)
    _sync_asset_query_state(inventory)
    _sync_page_query_state()
    _sync_lineage_query_state(inventory)
    _sync_help_query_state()

    module_help = {
        "Discovery": "Search the catalog, filter results, and open asset pages.",
        "Lineage": "Review upstream and downstream dependencies before making changes.",
        "Governance": "Manage glossary terms, metadata quality gaps, owners, and policy context.",
        "Stewardship": "Review requests and work governance backlogs.",
        "Admin": "Manage app access and roles.",
    }
    page = st.session_state.get("app_page", "Discovery")
    st.markdown(
        _module_switcher_html(page, {**module_help, "?": "Open Help"}),
        unsafe_allow_html=True,
    )

    st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)

    if page == "Discovery":
        page_discovery(uc, store, inventory, role, user_email)
    elif page == "Lineage":
        page_lineage(uc, inventory)
    elif page == "Governance":
        page_governance(uc, store, om, inventory, role, user_email)
    elif page == "Stewardship":
        page_stewardship(uc, store, inventory, role, user_email)
    elif page == "Admin":
        page_admin(store, role, user_email)
    elif page == "Help":
        page_help()


if __name__ == "__main__":
    main()
