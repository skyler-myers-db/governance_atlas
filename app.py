"""Governance Hub — Databricks App (Streamlit).

Enterprise discovery, lineage, and governance shell on top of Unity Catalog.
"""

from __future__ import annotations

import html
import json
from textwrap import shorten
from typing import Any, Dict, List, Optional, Tuple

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
_EXCLUDED_ASSET_MARKERS = ("__materialization_mat_",)

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
def _cached_catalogs(_uc: UCSQLClient) -> List[str]:
    df = _uc.list_catalogs()
    if df.empty:
        return []
    names = df.iloc[:, 0].tolist()
    return [c for c in names if str(c).lower() not in _HIDDEN_CATALOGS]


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
def _cached_sample_rows(
    _uc: UCSQLClient, catalog: str, schema: str, table: str
) -> pd.DataFrame:
    return _uc.get_table_sample(catalog, schema, table, limit=15)


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


def _tags_editor(existing: pd.DataFrame, key: str) -> pd.DataFrame:
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


def _button_nav(
    options: List[str],
    state_key: str,
    *,
    disabled_options: Optional[List[str]] = None,
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
    return st.session_state.get(state_key, current)


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
  }

  .gh-shell-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.85rem;
    margin-top: 1rem;
  }

  .gh-shell-stat {
    border-radius: 18px;
    padding: 0.95rem 1rem;
    border: 1px solid rgba(197, 212, 236, 0.95);
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.94),
        rgba(241, 246, 255, 0.9) 58%,
        rgba(246, 239, 255, 0.88) 100%
      );
    box-shadow: 0 12px 26px rgba(18, 32, 63, 0.05);
  }

  .gh-shell-stat-label {
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #617390;
    margin-bottom: 0.38rem;
  }

  .gh-shell-stat-value {
    font-size: 1.45rem;
    font-weight: 800;
    color: var(--gh-text);
    letter-spacing: -0.03em;
  }

  .gh-shell-stat-copy {
    margin-top: 0.28rem;
    color: var(--gh-muted);
    font-size: 0.86rem;
    line-height: 1.45;
  }

  .gh-shell-top {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    flex-wrap: wrap;
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
    font-size: 1rem;
    font-weight: 700;
    color: var(--gh-text);
  }

  .gh-asset-fqn {
    font-size: 0.82rem;
    color: var(--gh-muted);
    margin-top: 0.15rem;
  }

  .gh-score {
    min-width: 3rem;
    text-align: center;
    padding: 0.35rem 0.55rem;
    border-radius: 12px;
    background: rgba(34, 87, 216, 0.1);
    color: var(--gh-primary);
    font-weight: 800;
    font-size: 0.9rem;
  }

  .gh-asset-copy {
    color: var(--gh-muted);
    font-size: 0.92rem;
    line-height: 1.55;
    min-height: 2.85rem;
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

  .gh-lineage-node {
    padding: 0.9rem 1rem;
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(245, 240, 255, 0.82));
    margin-bottom: 0.7rem;
  }

  .gh-lineage-node.focus {
    border-color: rgba(34, 87, 216, 0.3);
    background:
      linear-gradient(
        135deg,
        rgba(237, 244, 255, 0.95),
        rgba(244, 239, 255, 0.9) 72%,
        rgba(255, 255, 255, 0.98)
      );
  }

  .gh-lineage-label {
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--gh-muted);
    margin-bottom: 0.35rem;
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

  .stButton > button {
    border-radius: 14px;
    border: 1px solid var(--gh-border);
    background: rgba(255, 255, 255, 0.95);
    color: var(--gh-text);
    font-weight: 700;
    min-height: 2.8rem;
    transition:
      background 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }

  .stButton > button:hover,
  div[data-testid="stFormSubmitButton"] > button:hover {
    border-color: rgba(34, 87, 216, 0.28);
    box-shadow: 0 14px 28px rgba(34, 87, 216, 0.16);
    transform: translateY(-1px);
  }

  .stButton > button:focus-visible,
  div[data-testid="stFormSubmitButton"] > button:focus-visible {
    outline: none !important;
    box-shadow: 0 0 0 3px var(--gh-focus-ring) !important;
  }

  .stButton > button[kind="primary"] {
    background: linear-gradient(
      135deg,
      var(--gh-primary) 0%,
      var(--gh-secondary) 52%,
      var(--gh-accent) 100%
    );
    color: white;
    border: none;
  }

  .stButton > button[kind="primary"]:hover,
  div[data-testid="stFormSubmitButton"] > button:hover {
    background: linear-gradient(
      135deg,
      var(--gh-primary-strong) 0%,
      #567eff 52%,
      #8c6cf6 100%
    ) !important;
    color: #ffffff !important;
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
    margin-top: 0.35rem;
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

  .gh-guidance-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .gh-guidance-list {
    margin: 0.6rem 0 0 0;
    padding-left: 1rem;
    color: var(--gh-muted);
  }

  .gh-guidance-list li {
    margin-bottom: 0.42rem;
    line-height: 1.55;
  }

  .gh-focus-card {
    min-height: 138px;
    padding: 1rem 1rem 0.95rem;
    border-radius: 18px;
    border: 1px solid var(--gh-border);
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.94),
        rgba(241, 246, 255, 0.9) 56%,
        rgba(245, 239, 255, 0.88) 100%
      );
    box-shadow: 0 10px 22px rgba(18, 32, 63, 0.04);
    margin-bottom: 0.55rem;
  }

  .gh-focus-card.active {
    border-color: rgba(49, 95, 216, 0.32);
    box-shadow: 0 16px 28px rgba(49, 95, 216, 0.11);
    background:
      linear-gradient(
        135deg,
        rgba(238, 244, 255, 0.96),
        rgba(246, 239, 255, 0.92) 70%,
        rgba(255, 255, 255, 0.98)
      );
  }

  .gh-focus-label {
    font-size: 0.8rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #617390;
    margin-bottom: 0.45rem;
  }

  .gh-focus-value {
    font-size: 1.85rem;
    font-weight: 850;
    color: var(--gh-text);
    letter-spacing: -0.04em;
  }

  .gh-focus-copy {
    margin-top: 0.28rem;
    color: var(--gh-muted);
    font-size: 0.88rem;
    line-height: 1.5;
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

    .gh-shell-metrics,
    .gh-guidance-grid {
      grid-template-columns: 1fr;
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
    const rootWindow = window.parent || window;
    const storage = rootWindow.sessionStorage;
    const key = "gh-scroll-y";
    const doc = rootWindow.document;
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
    cfg: AppConfig,
    role: str,
    user_email: str,
    om: Optional[OpenMetadataClient],
    inventory: pd.DataFrame,
) -> None:
    om_class = "good" if om else ""
    om_label = "OpenMetadata linked" if om else "Unity Catalog only"
    needs_action = _inventory_metric(inventory, _attention_mask(inventory))
    open_requests = _inventory_metric(inventory, inventory["pending_requests"].gt(0))
    shell_stats = "".join(
        [
            _shell_stat_html(
                "Inventoried assets",
                f"{len(inventory):,}",
                "Live Unity Catalog assets enriched with governance context.",
            ),
            _shell_stat_html(
                "Needs action",
                f"{needs_action:,}",
                "Missing owners, documentation, or pending governance follow-up.",
            ),
            _shell_stat_html(
                "Open requests",
                f"{open_requests:,}",
                "Metadata changes currently waiting on review or resolution.",
            ),
            _shell_stat_html(
                "Runtime model",
                "Live-first",
                "Direct Unity Catalog reads plus a small Delta-backed governance control plane.",
            ),
        ]
    )
    st.markdown(
        f"""
<div class="gh-shell">
  <div class="gh-shell-top">
    <div>
      <div class="gh-eyebrow">Enterprise Metadata For Databricks</div>
      <div class="gh-brand">
        <div class="gh-brand-mark">GH</div>
        <div>
          <div class="gh-wordmark">Governance <span>Hub</span></div>
          <div class="gh-wordmark-rule"></div>
        </div>
      </div>
      <div class="gh-shell-copy">
        Use this workspace to find assets, review lineage, manage glossary terms,
        and maintain metadata and ownership in Unity Catalog.
      </div>
    </div>
    <div class="gh-chip-row">
      <span class="gh-chip">{html.escape(cfg.gov_catalog)}.{html.escape(cfg.gov_schema)}</span>
      <span class="gh-chip">{html.escape(role.title())}</span>
      <span class="gh-chip">{html.escape(user_email)}</span>
      <span class="gh-chip {om_class}">{html.escape(om_label)}</span>
    </div>
  </div>
  <div class="gh-shell-metrics">{shell_stats}</div>
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
    catalogs = _cached_catalogs(_uc)
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


def _attention_mask(inventory: pd.DataFrame) -> pd.Series:
    if inventory.empty:
        return pd.Series(dtype=bool)
    return (
        inventory["owner_count"].eq(0)
        | inventory["comment"].eq("")
        | inventory["pending_requests"].gt(0)
    )


def _discovery_focus_mask(inventory: pd.DataFrame, focus_mode: str) -> pd.Series:
    if inventory.empty:
        return pd.Series(dtype=bool)
    if focus_mode == "Ownership gaps":
        return inventory["owner_count"].eq(0)
    if focus_mode == "Needs documentation":
        return inventory["comment"].eq("")
    if focus_mode == "Open requests":
        return inventory["pending_requests"].gt(0)
    if focus_mode == "Sensitive / uncertified":
        return inventory["sensitivity"].ne("") & inventory["certification"].eq("")
    return pd.Series(True, index=inventory.index)


def _shell_stat_html(label: str, value: str, copy: str) -> str:
    return f"""
<div class="gh-shell-stat">
  <div class="gh-shell-stat-label">{html.escape(label)}</div>
  <div class="gh-shell-stat-value">{html.escape(value)}</div>
  <div class="gh-shell-stat-copy">{html.escape(copy)}</div>
</div>
    """


def _discovery_focus_card_html(
    title: str,
    count: int,
    copy: str,
    *,
    active: bool = False,
) -> str:
    active_class = "active" if active else ""
    return f"""
<div class="gh-focus-card {active_class}">
  <div class="gh-focus-label">{html.escape(title)}</div>
  <div class="gh-focus-value">{count:,}</div>
  <div class="gh-focus-copy">{html.escape(copy)}</div>
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
    badges = [
        _safe_badge(asset.get("table_type", "Table"), "primary"),
        _safe_badge(asset.get("tier", ""), "primary"),
        _safe_badge(asset.get("certification", ""), "good"),
        _safe_badge(asset.get("sensitivity", ""), "warn"),
        _safe_badge(asset.get("domain", ""), "neutral"),
    ]
    badges = "".join(badge for badge in badges if badge)
    active_class = "active" if active else ""
    return f"""
<div class="gh-asset-card {active_class}">
  <div class="gh-asset-head">
    <div>
      <div class="gh-asset-name">{html.escape(_normalize_str(asset.get("table_name")))}</div>
      <div class="gh-asset-fqn">{html.escape(_normalize_str(asset.get("fqn")))}</div>
    </div>
    <div class="gh-score">{int(asset.get("governance_score", 0))}</div>
  </div>
  <div class="gh-asset-copy">{html.escape(description)}</div>
  <div class="gh-badge-row">{badges}</div>
  <div class="gh-meta-row">
    <span>{int(asset.get("owner_count", 0))} owners</span>
    <span>{int(asset.get("pending_requests", 0))} open requests</span>
    <span>{html.escape(_normalize_str(asset.get("governance_status")))}</span>
  </div>
</div>
    """


def _profile_header_html(asset: pd.Series) -> str:
    tags = asset.get("tags") if isinstance(asset.get("tags"), dict) else {}
    structured = _structured_tags(tags or {})
    badges = [
        _safe_badge(asset.get("table_type", "Table"), "primary"),
        _safe_badge(structured.get("domain", ""), "neutral"),
        _safe_badge(structured.get("tier", ""), "primary"),
        _safe_badge(structured.get("certification", ""), "good"),
        _safe_badge(structured.get("sensitivity", ""), "warn"),
        _safe_badge(structured.get("criticality", ""), "danger"),
    ]
    description = _normalize_str(asset.get("comment")) or (
        "This asset has not been documented yet. Add a description and governance "
        "fields so other teams can understand how to use it."
    )
    return f"""
<div class="gh-panel">
  <div class="gh-kicker">Asset Profile</div>
  <div class="gh-profile-title">{html.escape(_normalize_str(asset.get("table_name")))}</div>
  <div class="gh-profile-fqn">{html.escape(_normalize_str(asset.get("fqn")))}</div>
  <div class="gh-chip-row gh-nav-spacer">
    <span class="gh-chip">Coverage {int(asset.get("governance_score", 0))}</span>
    <span class="gh-chip">{html.escape(_normalize_str(asset.get("governance_status")))}</span>
  </div>
  <div class="gh-badge-row">{"".join(badge for badge in badges if badge)}</div>
  <div class="gh-profile-copy">{html.escape(description)}</div>
</div>
    """


def _lineage_node_html(
    label: str, fqn: str, tone: str = "neutral", focus: bool = False
) -> str:
    tone_class = {
        "source": "warn",
        "target": "good",
        "focus": "primary",
    }.get(tone, "neutral")
    focus_class = "focus" if focus else ""
    table_name = fqn.split(".")[-1] if fqn else "No asset"
    return f"""
<div class="gh-lineage-node {focus_class}">
  <div class="gh-lineage-label">{html.escape(label)}</div>
  <div class="gh-asset-name">{html.escape(table_name)}</div>
  <div class="gh-asset-fqn">{html.escape(fqn)}</div>
  <div class="gh-badge-row">{_safe_badge(tone.title(), tone_class)}</div>
</div>
    """


def _render_section_intro(title: str, copy: str) -> None:
    st.markdown(
        f"""
<div class="gh-panel">
  <div class="gh-panel-label">Workspace Module</div>
  <div class="gh-section-title">{html.escape(title)}</div>
  <div class="gh-section-copy">{html.escape(copy)}</div>
</div>
        """,
        unsafe_allow_html=True,
    )


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


def _asset_selector(inventory: pd.DataFrame, key: str, label: str) -> Optional[str]:
    if inventory.empty:
        return None
    options = inventory["fqn"].tolist()
    selected = st.selectbox(
        label,
        options,
        index=_select_index(options, st.session_state.get("selected_asset_fqn", "")),
        format_func=lambda fqn: fqn,
        key=key,
    )
    if selected:
        st.session_state["selected_asset_fqn"] = selected
    return selected


def _filtered_inventory(inventory: pd.DataFrame, *, show_controls: bool = True) -> pd.DataFrame:
    if inventory.empty:
        return inventory

    catalogs = ["All"] + sorted(
        inventory["table_catalog"].dropna().astype(str).unique().tolist()
    )
    domains = ["All"] + sorted([v for v in inventory["domain"].unique().tolist() if v])
    tiers = ["All"] + sorted([v for v in inventory["tier"].unique().tolist() if v])
    certifications = ["All"] + sorted(
        [v for v in inventory["certification"].unique().tolist() if v]
    )
    sensitivities = ["All"] + sorted(
        [v for v in inventory["sensitivity"].unique().tolist() if v]
    )

    st.session_state.setdefault("asset_search", "")
    st.session_state.setdefault("asset_sort_mode", "Best match")
    st.session_state.setdefault("asset_catalog", "All")
    st.session_state.setdefault("asset_domain", "All")
    st.session_state.setdefault("asset_tier", "All")
    st.session_state.setdefault("asset_certification", "All")
    st.session_state.setdefault("asset_sensitivity", "All")
    st.session_state.setdefault("asset_focus_mode", "All assets")

    valid_sort_modes = {
        "Best match",
        "Governance coverage",
        "Open requests",
        "Alphabetical",
    }
    valid_focus_modes = {
        "All assets",
        "Ownership gaps",
        "Needs documentation",
        "Open requests",
        "Sensitive / uncertified",
    }
    if st.session_state.get("asset_sort_mode") not in valid_sort_modes:
        st.session_state["asset_sort_mode"] = "Best match"
    if st.session_state.get("asset_focus_mode") not in valid_focus_modes:
        st.session_state["asset_focus_mode"] = "All assets"
    if st.session_state.get("asset_catalog") not in catalogs:
        st.session_state["asset_catalog"] = "All"
    if st.session_state.get("asset_domain") not in domains:
        st.session_state["asset_domain"] = "All"
    if st.session_state.get("asset_tier") not in tiers:
        st.session_state["asset_tier"] = "All"
    if st.session_state.get("asset_certification") not in certifications:
        st.session_state["asset_certification"] = "All"
    if st.session_state.get("asset_sensitivity") not in sensitivities:
        st.session_state["asset_sensitivity"] = "All"

    if show_controls:
        with st.form("discovery_filters", border=False):
            query_col, sort_col = st.columns([2.3, 1])
            with query_col:
                query = st.text_input(
                    "Search assets",
                    placeholder="customer, finance, PII, steward email, certified",
                    key="asset_search",
                )
            with sort_col:
                sort_mode = st.selectbox(
                    "Sort by",
                    [
                        "Best match",
                        "Governance coverage",
                        "Open requests",
                        "Alphabetical",
                    ],
                    key="asset_sort_mode",
                )

            filter_cols = st.columns(5)
            selected_catalog = filter_cols[0].selectbox(
                "Catalog", catalogs, key="asset_catalog"
            )
            selected_domain = filter_cols[1].selectbox(
                "Domain", domains, key="asset_domain"
            )
            selected_tier = filter_cols[2].selectbox("Tier", tiers, key="asset_tier")
            selected_cert = filter_cols[3].selectbox(
                "Certification", certifications, key="asset_certification"
            )
            selected_sensitivity = filter_cols[4].selectbox(
                "Sensitivity", sensitivities, key="asset_sensitivity"
            )
            submitted = st.form_submit_button("Apply discovery filters", type="primary")
            if submitted:
                st.session_state["discovery_filters_applied"] = True
    else:
        query = st.session_state.get("asset_search", "")
        sort_mode = st.session_state.get("asset_sort_mode", "Best match")
        selected_catalog = st.session_state.get("asset_catalog", "All")
        selected_domain = st.session_state.get("asset_domain", "All")
        selected_tier = st.session_state.get("asset_tier", "All")
        selected_cert = st.session_state.get("asset_certification", "All")
        selected_sensitivity = st.session_state.get("asset_sensitivity", "All")

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

    if selected_catalog != "All":
        filtered = filtered[filtered["table_catalog"] == selected_catalog]
    if selected_domain != "All":
        filtered = filtered[filtered["domain"] == selected_domain]
    if selected_tier != "All":
        filtered = filtered[filtered["tier"] == selected_tier]
    if selected_cert != "All":
        filtered = filtered[filtered["certification"] == selected_cert]
    if selected_sensitivity != "All":
        filtered = filtered[filtered["sensitivity"] == selected_sensitivity]

    focus_mode = st.session_state.get("asset_focus_mode", "All assets")
    focus_mask = _discovery_focus_mask(filtered, focus_mode)
    if not focus_mask.empty:
        filtered = filtered[focus_mask]

    if sort_mode == "Governance coverage":
        filtered = filtered.sort_values(
            ["governance_score", "pending_requests", "fqn"],
            ascending=[False, False, True],
        )
    elif sort_mode == "Open requests":
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

    st.markdown(_profile_header_html(asset), unsafe_allow_html=True)

    metrics = st.columns(5)
    metrics[0].metric("Coverage", int(asset.get("governance_score", 0)))
    metrics[1].metric("Open requests", int(asset.get("pending_requests", 0)))
    metrics[2].metric("Owners", int(asset.get("owner_count", 0)))
    metrics[3].metric("Domain", structured["domain"] or "—")
    metrics[4].metric("Tier", structured["tier"] or "—")

    section = _button_nav(
        ["Overview", "Schema", "Preview", "Lineage", "Governance"],
        f"asset_profile_section_{asset['fqn']}",
    )
    st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)

    if section == "Overview":
        owners_df = store.get_owners(asset["fqn"])
        tags_df = _tags_map_to_df(asset_tags if isinstance(asset_tags, dict) else {})
        left, right = st.columns([1.25, 1])
        with left:
            st.markdown("#### Context")
            st.write(
                comment
                or "No description has been added. Use the governance editor to document this asset."
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
        _render_data_table(cols_df)
        if role in {"writer", "admin"} and not cols_df.empty:
            st.divider()
            st.markdown("#### Column metadata editor")
            selected_col = st.selectbox(
                "Column",
                cols_df["column_name"].tolist(),
                key=f"column_picker_{asset['fqn']}",
            )
            if selected_col is None:
                st.warning("No columns available for editing.")
            else:
                current_col = cols_df[cols_df["column_name"] == selected_col].iloc[0]
                current_comment = _normalize_str(current_col.get("comment"))
                new_comment = st.text_area(
                    "Column description",
                    value=current_comment,
                    height=100,
                    key=f"column_comment_{asset['fqn']}_{selected_col}",
                )
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
            st.markdown("#### Upstream assets")
            if lineage_up_error:
                st.warning(f"Could not query upstream lineage: {lineage_up_error}")
            elif lineage_up.empty:
                st.info("No upstream lineage found.")
            else:
                _render_data_table(lineage_up)
        with lcol2:
            st.markdown("#### Downstream assets")
            if lineage_down_error:
                st.warning(f"Could not query downstream lineage: {lineage_down_error}")
            elif lineage_down.empty:
                st.info("No downstream lineage found.")
            else:
                _render_data_table(lineage_down)
        if st.button(
            "Open full lineage workspace",
            use_container_width=True,
            key=f"open_lineage_{asset['fqn']}",
        ):
            st.session_state["app_page"] = "Lineage"
            st.rerun()

    else:
        tags_df = _tags_map_to_df(asset_tags if isinstance(asset_tags, dict) else {})
        owners_df = store.get_owners(asset["fqn"])
        is_writer = role in {"writer", "admin"}
        existing_tags = _df_to_tags_map(tags_df)
        existing_structured = _structured_tags(existing_tags)
        existing_custom = {
            key: value
            for key, value in existing_tags.items()
            if key not in _STANDARD_TAG_KEYS
        }

        if is_writer:
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
                _custom_tags_df(tags_df), key=f"custom_tags_{asset['fqn']}"
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
            _render_data_table(owners_df)
            with st.form(f"owners_{asset['fqn']}"):
                owner_email = st.text_input("Owner email")
                owner_type = st.selectbox(
                    "Owner type", ["technical", "business", "steward"]
                )
                if st.form_submit_button("Add or update owner", type="primary"):
                    store.upsert_owner(
                        asset["fqn"], owner_email, owner_type, user_email
                    )
                    st.success("Owner assignment saved.")
                    st.cache_data.clear()
                    st.rerun()
        else:
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
            proposed_custom_tags = _tags_editor(
                _custom_tags_df(tags_df), key=f"proposal_tags_{asset['fqn']}"
            )
            if st.button(
                "Submit metadata change request",
                type="primary",
                use_container_width=True,
                key=f"submit_request_{asset['fqn']}",
            ):
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
        "Search the catalog, start with a focused live view, and open an asset to review metadata, ownership, sample data, and lineage in one place.",
    )

    has_selected_asset = bool(st.session_state.get("discovery_asset_opened"))
    discovery_view = _button_nav(
        ["Search", "Selected asset"],
        "discovery_view_mode",
        disabled_options=[] if has_selected_asset else ["Selected asset"],
    )
    st.markdown("<div class='gh-nav-spacer'></div>", unsafe_allow_html=True)
    if not has_selected_asset:
        st.caption("Open an asset from Search to unlock the selected-asset workspace.")

    if discovery_view == "Search":
        metrics = st.columns(4)
        metrics[0].metric("Inventoried assets", len(inventory))
        metrics[1].metric(
            "Certified assets",
            _inventory_metric(inventory, inventory["certification"].ne("")),
        )
        metrics[2].metric(
            "Assets with stewards",
            _inventory_metric(inventory, inventory["steward"].ne("")),
        )
        metrics[3].metric(
            "Open requests",
            _inventory_metric(inventory, inventory["pending_requests"]),
        )
        active_focus = st.session_state.get("asset_focus_mode", "All assets")
        walkthrough_copy = """
<div class="gh-mini-panel">
  <div class="gh-kicker">Suggested walkthrough</div>
  <div class="gh-section-copy">Use this page as the fast operating view for both real work and executive demos. Start with a focus view, open an asset, then pivot into lineage or governance.</div>
  <ol class="gh-guidance-list">
    <li>Start with <strong>Ownership gaps</strong> or <strong>Open requests</strong> to surface immediate governance work.</li>
    <li>Open an asset to move from the result set into the entity page.</li>
    <li>Use lineage and governance tabs to show impact, ownership, and remediation context without leaving the product.</li>
  </ol>
</div>
        """
        if active_focus == "All assets":
            focus_summary = """
<div class="gh-mini-panel">
  <div class="gh-kicker">Live operating view</div>
  <div class="gh-section-copy">This workspace stays live-first on purpose. It reads Unity Catalog directly and layers governance state on top without requiring snapshot jobs, background services, or extra deployment overhead.</div>
</div>
            """
        else:
            focus_summary = f"""
<div class="gh-mini-panel">
  <div class="gh-kicker">Active focus</div>
  <div class="gh-asset-name">{html.escape(active_focus)}</div>
  <div class="gh-section-copy">Stay in this view when you want a tighter story for triage or demos. Switch back to <strong>All assets</strong> whenever you need the full catalog again.</div>
</div>
            """
        st.markdown(
            f"""
<div class="gh-guidance-grid">
  {walkthrough_copy}
  {focus_summary}
</div>
            """,
            unsafe_allow_html=True,
        )

        focus_cards = [
            (
                "Ownership gaps",
                int(_discovery_focus_mask(inventory, "Ownership gaps").sum()),
                "Assets without assigned owners or stewards.",
            ),
            (
                "Needs documentation",
                int(_discovery_focus_mask(inventory, "Needs documentation").sum()),
                "Assets still missing a business-facing description.",
            ),
            (
                "Open requests",
                int(_discovery_focus_mask(inventory, "Open requests").sum()),
                "Assets with metadata work waiting on review.",
            ),
            (
                "Sensitive / uncertified",
                int(_discovery_focus_mask(inventory, "Sensitive / uncertified").sum()),
                "Sensitive assets that still lack certification context.",
            ),
        ]
        st.markdown("#### Focus views")
        focus_cols = st.columns(4)
        for col, (label, count, copy) in zip(focus_cols, focus_cards):
            with col:
                st.markdown(
                    _discovery_focus_card_html(
                        label,
                        count,
                        copy,
                        active=active_focus == label,
                    ),
                    unsafe_allow_html=True,
                )
                if st.button(
                    "Viewing" if active_focus == label else "Use view",
                    key=f"focus_{label}",
                    type="primary" if active_focus == label else "secondary",
                    use_container_width=True,
                ):
                    if active_focus != label:
                        st.session_state["asset_focus_mode"] = label
                        st.rerun()

        if active_focus != "All assets":
            if st.button(
                "Show all assets",
                key="focus_reset",
                use_container_width=False,
            ):
                st.session_state["asset_focus_mode"] = "All assets"
                st.rerun()

        filtered = _filtered_inventory(inventory, show_controls=True)

        if filtered.empty:
            st.warning("No assets match the current search and filter set.")
            return

        if active_focus == "All assets":
            st.caption(f"{len(filtered)} assets match the current discovery filters.")
        else:
            st.caption(
                f"{len(filtered)} assets match the current filters inside the {active_focus.lower()} view."
            )
        st.markdown("#### Search results")
        if len(filtered) > 12:
            st.caption(
                "Showing the first 12 results. Narrow the search or open an asset to continue."
            )
        result_cols = st.columns(2)
        for idx, (_, asset_series) in enumerate(filtered.head(12).iterrows()):
            with result_cols[idx % 2]:
                st.markdown(_asset_card_html(asset_series, False), unsafe_allow_html=True)
                if st.button(
                    "Open asset",
                    key=f"open_asset_{asset_series['fqn']}",
                    type="secondary",
                    use_container_width=True,
                ):
                    st.session_state["selected_asset_fqn"] = asset_series["fqn"]
                    st.session_state["discovery_asset_opened"] = True
                    st.session_state["discovery_view_mode"] = "Selected asset"
                    st.session_state[f"asset_profile_section_{asset_series['fqn']}"] = (
                        "Overview"
                    )
                    st.rerun()
    else:
        filtered = _filtered_inventory(inventory, show_controls=False)
        selected = _selected_asset(inventory)
        if selected is None:
            st.info("Select an asset from the results list.")
            return

        context_copy = "Return to Search when you want to change filters or pick a different asset."

        st.markdown(
            f"""
<div class="gh-mini-panel">
  <div class="gh-kicker">Selected Asset</div>
  <div class="gh-asset-name">{html.escape(_normalize_str(selected.get("table_name")))}</div>
  <div class="gh-asset-fqn">{html.escape(_normalize_str(selected.get("fqn")))}</div>
  <div class="gh-section-copy">{html.escape(context_copy)}</div>
</div>
            """,
            unsafe_allow_html=True,
        )
        _render_asset_profile(selected, inventory, uc, store, role, user_email)


def page_lineage(
    uc: UCSQLClient,
    inventory: pd.DataFrame,
) -> None:
    _render_section_intro(
        "Lineage",
        "Review upstream producers, downstream consumers, and column lineage for the selected asset before making a schema or pipeline change.",
    )
    selected_fqn = _asset_selector(inventory, "lineage_selector", "Asset")
    if not selected_fqn:
        st.info("Select an asset to explore lineage.")
        return

    asset = inventory[inventory["fqn"] == selected_fqn].iloc[0]
    catalog, schema, table = _split_uc_name(selected_fqn)
    with st.spinner("Loading lineage..."):
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

    metrics = st.columns(4)
    metrics[0].metric("Upstream assets", len(lineage_up))
    metrics[1].metric("Downstream assets", len(lineage_down))
    metrics[2].metric("Upstream columns", len(col_up))
    metrics[3].metric("Downstream columns", len(col_down))

    l1, l2, l3 = st.columns([1.15, 0.9, 1.15])
    with l1:
        st.markdown("#### Upstream")
        if lineage_up_error:
            st.warning(f"Could not query upstream lineage: {lineage_up_error}")
        elif lineage_up.empty:
            st.info("No upstream dependencies found.")
        else:
            for row in lineage_up.head(8).itertuples(index=False):
                st.markdown(
                    _lineage_node_html(
                        "Source", _normalize_str(row.source_table_full_name), "source"
                    ),
                    unsafe_allow_html=True,
                )

    with l2:
        st.markdown("#### Selected asset")
        st.markdown(
            _lineage_node_html(
                "Focus",
                selected_fqn,
                "focus",
                focus=True,
            ),
            unsafe_allow_html=True,
        )
        st.markdown(
            f"""
<div class="gh-panel">
  <div class="gh-panel-label">Impact Summary</div>
  <div class="gh-section-copy">
    {html.escape(_normalize_str(asset.get("comment")) or "This asset does not have a description yet.")}
  </div>
  <div class="gh-badge-row">
    {_safe_badge(asset.get("tier", ""), "primary")}
    {_safe_badge(asset.get("certification", ""), "good")}
    {_safe_badge(asset.get("sensitivity", ""), "warn")}
  </div>
</div>
            """,
            unsafe_allow_html=True,
        )

    with l3:
        st.markdown("#### Downstream")
        if lineage_down_error:
            st.warning(f"Could not query downstream lineage: {lineage_down_error}")
        elif lineage_down.empty:
            st.info("No downstream consumers found.")
        else:
            for row in lineage_down.head(8).itertuples(index=False):
                st.markdown(
                    _lineage_node_html(
                        "Target", _normalize_str(row.target_table_full_name), "target"
                    ),
                    unsafe_allow_html=True,
                )

    table_lineage_tab, column_lineage_tab = st.tabs(
        ["Table lineage", "Column lineage"]
    )

    with table_lineage_tab:
        col1, col2 = st.columns(2)
        with col1:
            st.markdown("#### Upstream table detail")
            if lineage_up_error:
                st.warning(f"Could not query upstream lineage: {lineage_up_error}")
            elif lineage_up.empty:
                st.info("No upstream table lineage available.")
            else:
                _render_data_table(lineage_up)
        with col2:
            st.markdown("#### Downstream table detail")
            if lineage_down_error:
                st.warning(f"Could not query downstream lineage: {lineage_down_error}")
            elif lineage_down.empty:
                st.info("No downstream table lineage available.")
            else:
                _render_data_table(lineage_down)

    with column_lineage_tab:
        upstream_column_tab, downstream_column_tab = st.tabs(
            ["Upstream lineage", "Downstream lineage"]
        )

        with upstream_column_tab:
            if col_up_error:
                st.warning(f"Could not query upstream column lineage: {col_up_error}")
            elif col_up.empty:
                st.info("No upstream column lineage is available.")
            else:
                _render_column_lineage(col_up, key=f"col_up_{selected_fqn}")

        with downstream_column_tab:
            if col_down_error:
                st.warning(
                    f"Could not query downstream column lineage: {col_down_error}"
                )
            elif col_down.empty:
                st.info("No downstream column lineage is available.")
            else:
                _render_column_lineage(col_down, key=f"col_down_{selected_fqn}")


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
    metrics[0].metric("Glossary terms", len(store.list_glossary_terms(limit=500)))
    metrics[1].metric("Certified assets", int(inventory["certification"].ne("").sum()))
    metrics[2].metric("Sensitive assets", int(inventory["sensitivity"].ne("").sum()))
    metrics[3].metric("Unowned assets", int(inventory["owner_count"].eq(0).sum()))

    section = _button_nav(
        ["Glossary", "Coverage & policy", "Integrations"],
        "governance_section",
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

    elif section == "Coverage & policy":
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
            "Search coverage & policy",
            placeholder="customer, finance, glossary term, steward, tier 1",
            key="coverage_search",
        )
        filters = st.columns(4)
        focus = filters[0].selectbox(
            "Focus",
            [
                "All",
                "Missing description",
                "Missing owner",
                "Missing certification",
                "Open requests",
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
        if focus == "Missing description":
            coverage = coverage[backlog.loc[coverage.index, "missing_description"]]
        elif focus == "Missing owner":
            coverage = coverage[backlog.loc[coverage.index, "missing_owner"]]
        elif focus == "Missing certification":
            coverage = coverage[backlog.loc[coverage.index, "missing_certification"]]
        elif focus == "Open requests":
            coverage = coverage[coverage["pending_requests"] > 0]
        if domain_filter != "All":
            coverage = coverage[coverage["domain"] == domain_filter]
        if cert_filter != "All":
            coverage = coverage[coverage["certification"] == cert_filter]
        if tier_filter != "All":
            coverage = coverage[coverage["tier"] == tier_filter]

        gap_metrics = st.columns(4)
        gap_metrics[0].metric("Missing descriptions", int(backlog["missing_description"].sum()))
        gap_metrics[1].metric("Missing owners", int(backlog["missing_owner"].sum()))
        gap_metrics[2].metric(
            "Missing certifications", int(backlog["missing_certification"].sum())
        )
        gap_metrics[3].metric("Open policy issues", int((backlog["pending_requests"] > 0).sum()))

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
        "Pending requests",
        int((requests["status"] == "pending").sum()) if not requests.empty else 0,
    )
    metrics[1].metric(
        "Approved requests",
        int((requests["status"] == "approved").sum()) if not requests.empty else 0,
    )
    metrics[2].metric(
        "Rejected requests",
        int((requests["status"] == "rejected").sum()) if not requests.empty else 0,
    )
    metrics[3].metric(
        "Assets needing stewardship",
        int(((inventory["comment"] == "") | (inventory["owner_count"] == 0)).sum()),
    )

    queue_tab, backlog_tab = st.tabs(["Request queue", "Stewardship backlog"])

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
                    st.markdown("#### Review")
                    detail_rows = pd.DataFrame(
                        [
                            {"Field": "Status", "Value": request.status},
                            {"Field": "Created by", "Value": request.created_by},
                            {"Field": "Asset", "Value": request.uc_full_name or "—"},
                            {"Field": "Comment", "Value": request.new_comment or "—"},
                            {
                                "Field": "Proposed tags",
                                "Value": json.dumps(
                                    request.new_uc_tags or {}, indent=2
                                ),
                            },
                        ]
                    )
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
                                    if request.new_comment is not None:
                                        uc.set_table_comment(
                                            catalog, schema, table, request.new_comment
                                        )
                                    if request.new_uc_tags:
                                        existing_tags = _cached_table_tags(
                                            uc, catalog, schema, table
                                        )
                                        _apply_table_tags(
                                            uc,
                                            catalog,
                                            schema,
                                            table,
                                            existing_tags,
                                            request.new_uc_tags,
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

    _render_shell(cfg, role, user_email, om, inventory)
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

    page = _button_nav(
        ["Discovery", "Lineage", "Governance", "Stewardship", "Admin"],
        "app_page",
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


if __name__ == "__main__":
    main()
