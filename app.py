"""Governance Hub — Databricks App (Streamlit).

UC-native governance portal with optional OpenMetadata OSS integration.
"""

from __future__ import annotations

import json
from typing import Dict, List, Optional, Tuple

import pandas as pd
import streamlit as st

from govhub.auth import get_current_user_email
from govhub.config import AppConfig
from govhub.openmetadata import OpenMetadataClient, OpenMetadataError
from govhub.store import GovernanceStore
from govhub.uc import UCSQLClient

# Catalogs that should never appear in the governance browser or lineage picker.
# hive_metastore is the legacy non-UC metastore, samples/system are managed by
# Databricks and not user-governed.
_HIDDEN_CATALOGS = {"hive_metastore", "samples", "system", "__databricks_internal"}


# ── Cached singletons ──────────────────────────────────────


@st.cache_resource
def _get_config() -> AppConfig:
    return AppConfig.from_env()


@st.cache_resource
def _get_uc_client(_cfg: AppConfig) -> UCSQLClient:
    return UCSQLClient(warehouse_id=_cfg.warehouse_id)


@st.cache_resource
def _get_store(_cfg: AppConfig, _uc: UCSQLClient) -> GovernanceStore:
    store = GovernanceStore(uc=_uc, catalog=_cfg.gov_catalog, schema=_cfg.gov_schema)
    store.ensure_tables()
    return store


@st.cache_resource
def _get_om_client(_cfg: AppConfig) -> Optional[OpenMetadataClient]:
    if not _cfg.openmetadata_enabled:
        return None
    return OpenMetadataClient(
        server_url=_cfg.om_server_url,
        jwt_token=_cfg.om_jwt_token,
    )


# ── Helpers ─────────────────────────────────────────────────


def _role_badge(role: str) -> str:
    return {"admin": "🛡️ admin", "writer": "✍️ writer"}.get(role, "👀 reader")


def _split_uc_name(name: str) -> Tuple[str, str, str]:
    parts = [p.strip() for p in name.split(".") if p.strip()]
    if len(parts) != 3:
        raise ValueError("Expected catalog.schema.table")
    return parts[0], parts[1], parts[2]


def _user_catalogs(uc: UCSQLClient) -> List[str]:
    """Return catalog names with non-UC / internal catalogs filtered out."""
    df = uc.list_catalogs()
    if df.empty:
        return []
    names = df.iloc[:, 0].tolist()
    return [c for c in names if c.lower() not in _HIDDEN_CATALOGS]


def _table_picker(
    uc: UCSQLClient,
    key_prefix: str = "tp",
    label_catalog: str = "Catalog",
    label_schema: str = "Schema",
    label_table: str = "Table",
) -> Optional[Tuple[str, str, str]]:
    """Render three cascading selectboxes for catalog → schema → table.

    Returns ``(catalog, schema, table)`` when a table is selected, else ``None``.
    """
    catalogs = _user_catalogs(uc)
    if not catalogs:
        st.warning("No Unity Catalog catalogs visible to this service principal.")
        return None

    catalog = st.selectbox(label_catalog, catalogs, key=f"{key_prefix}_cat")

    schemas = uc.list_schemas(catalog)
    if schemas.empty:
        st.info("No schemas in this catalog.")
        return None
    schema = st.selectbox(
        label_schema, schemas.iloc[:, 0].tolist(), key=f"{key_prefix}_sch"
    )

    tables = uc.list_tables(catalog, schema)
    if tables.empty:
        st.info("No tables in this schema.")
        return None
    tcol = "tableName" if "tableName" in tables.columns else tables.columns[-1]
    table = st.selectbox(label_table, tables[tcol].tolist(), key=f"{key_prefix}_tbl")

    return catalog, schema, table


def _tags_editor(existing: pd.DataFrame) -> pd.DataFrame:
    if existing is None or existing.empty:
        df = pd.DataFrame([{"tag_name": "", "tag_value": ""}])
    else:
        df = existing[["tag_name", "tag_value"]].copy()
        df.loc[len(df)] = {"tag_name": "", "tag_value": ""}
    return st.data_editor(
        df,
        use_container_width=True,
        num_rows="dynamic",
        column_config={
            "tag_name": st.column_config.TextColumn("Tag key"),
            "tag_value": st.column_config.TextColumn("Tag value"),
        },
        hide_index=True,
    )


def _df_to_tags_map(df: pd.DataFrame) -> Dict[str, str]:
    tags: Dict[str, str] = {}
    for _, row in df.iterrows():
        k = str(row.get("tag_name") or "").strip()
        v = str(row.get("tag_value") or "").strip()
        if k:
            tags[k] = v
    return tags


# ── Pages ───────────────────────────────────────────────────


def page_home(
    cfg: AppConfig,
    uc: UCSQLClient,
    om: Optional[OpenMetadataClient],
    role: str,
    user_email: str,
):
    # ── Hero ────────────────────────────────────────────
    st.title("🏛️ Governance Hub")
    st.markdown(
        "> A self-service **data governance portal** built on top of "
        "**Unity Catalog** — running as a native **Databricks App**."
    )

    # ── Health cards ────────────────────────────────────
    st.markdown("---")
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        try:
            cats = _user_catalogs(uc)
            st.metric("UC Catalogs", len(cats))
        except Exception as e:
            st.error(f"UC: {e}")
    with col2:
        st.metric("Gov. Catalog", cfg.gov_catalog)
    with col3:
        st.metric("Your Role", role)
    with col4:
        if om is None:
            st.metric("OpenMetadata", "off")
        else:
            st.metric("OpenMetadata", "connected ✅")

    # ── What is Governance Hub? ─────────────────────────
    st.markdown("---")
    st.header("📖 What is Governance Hub?")
    st.markdown(
        """
Governance Hub is a **lightweight, self-service governance portal** that runs
entirely inside your Databricks workspace.  It extends Unity Catalog with
features that UC alone doesn't provide out-of-the-box:

| Capability | How it works |
|---|---|
| **Browse & inspect** any catalog / schema / table | Reads UC `information_schema` via SQL Warehouse |
| **Table & column lineage** | Queries `system.access.table_lineage` and `column_lineage` |
| **Business glossary** | Stored in a UC Delta table — create, search, and manage terms |
| **Data ownership tracking** | Associates one or more owners (technical / business / steward) per table |
| **UC tag & comment editing** | Direct DDL through the SQL Warehouse |
| **Change-request workflow** | Readers propose changes; writers / admins review and apply |
| **OpenMetadata connector** *(optional)* | Bridges to a self-hosted OpenMetadata instance for cross-platform governance |

No external servers, no Docker, no Kafka — just a SQL Warehouse and this app.
"""
    )

    # ── Role guide ──────────────────────────────────────
    st.header("👥 Roles & Permissions")
    r1, r2, r3 = st.columns(3)
    with r1:
        st.markdown(
            """
#### 👀 Reader
- Browse catalogs, schemas, tables
- View lineage, glossary, owners
- **Submit** change requests
- Cannot directly edit metadata
"""
        )
    with r2:
        st.markdown(
            """
#### ✍️ Writer
- Everything a Reader can do
- Edit UC comments & tags directly
- Manage glossary terms
- Review & approve change requests
"""
        )
    with r3:
        st.markdown(
            """
#### 🛡️ Admin
- Everything a Writer can do
- Manage user roles (promote / demote)
- Full access to Admin page
- Bootstrap via `GOVHUB_ADMIN_EMAILS`
"""
        )

    # ── Quick-start guide ───────────────────────────────
    st.header("🚀 Quick-Start Guide")
    st.markdown(
        """
1. **UC Browser** — Select a catalog → schema → table to inspect columns,
   comments, tags, and owners.  Writers can edit directly; readers can submit
   a change request.
2. **Lineage** — Pick a table from the dropdowns to view upstream / downstream
   table lineage and column-level lineage from UC system tables.
3. **Glossary** — Search existing business terms or create new ones.  Terms
   live in a Delta table inside your governance schema.
4. **Change Requests** — Readers submit proposed metadata changes here.
   Writers / admins review the queue, approve (auto-applies), or reject with
   a note.
5. **OpenMetadata Connector** — If you've deployed OpenMetadata OSS, link UC
   tables to OM entities, search OM, and pull cross-platform lineage.
6. **Admin** — Manage who has reader / writer / admin access.
"""
    )

    # ── Architecture ────────────────────────────────────
    with st.expander("🏗️ Architecture overview"):
        st.code(
            """
┌─────────────────────────────────────────────────────┐
│              Databricks App  (Streamlit)             │
│  app.py  →  govhub/                                 │
│     │           ├─ auth.py          (SSO identity)   │
│     │           ├─ config.py        (env vars)       │
│     │           ├─ uc.py            (SQL Warehouse)  │
│     │           ├─ store.py         (gov Delta tbls) │
│     │           ├─ openmetadata.py  (optional)       │
│     │           └─ util.py                           │
└────┬───────────────────┬────────────────────────────┘
     │                   │
     ▼                   ▼ (optional)
 Unity Catalog      OpenMetadata OSS
  • metadata          • cross-platform
  • lineage             lineage &
  • gov tables          enrichment
""",
            language=None,
        )

    # ── Footer ──────────────────────────────────────────
    st.markdown("---")
    st.caption(
        f"Signed in as **{user_email}** · Role: **{role}** · "
        f"Governance schema: `{cfg.gov_catalog}.{cfg.gov_schema}`"
    )


# ─────────────────────────────────────────────────────────────
# UC Browser
# ─────────────────────────────────────────────────────────────


def page_uc_browser(
    cfg: AppConfig,
    uc: UCSQLClient,
    store: GovernanceStore,
    role: str,
    user_email: str,
):
    st.header("Unity Catalog Browser")
    st.caption(
        "Browse UC-managed catalogs, schemas, and tables.  "
        "Non-UC catalogs (hive_metastore, samples, system) are excluded."
    )

    picked = _table_picker(uc, key_prefix="ucb")
    if picked is None:
        return
    catalog, schema, table = picked
    uc_full = f"{catalog}.{schema}.{table}"
    st.caption(f"Selected: `{uc_full}`")

    # Details
    cols_df = uc.get_table_columns(catalog, schema, table)
    comment = uc.get_table_comment(catalog, schema, table)
    tags_df = uc.get_table_tags(catalog, schema, table)

    with st.expander("📋 Table details", expanded=True):
        st.markdown("**Table comment**")
        st.code(comment or "(none)")
        st.markdown("**Columns**")
        st.dataframe(cols_df, use_container_width=True, hide_index=True)
        st.markdown("**UC Tags**")
        st.dataframe(tags_df, use_container_width=True, hide_index=True)

    # Owners
    with st.expander("👤 Data owners"):
        owners = store.get_owners(uc_full)
        st.dataframe(owners, use_container_width=True, hide_index=True)
        if role in {"writer", "admin"}:
            with st.form(f"owner_{uc_full}"):
                oe = st.text_input("Owner email")
                ot = st.selectbox("Type", ["technical", "business", "steward"])
                if st.form_submit_button("Add / update owner"):
                    store.upsert_owner(uc_full, oe, ot, user_email)
                    st.success("Updated.")
                    st.rerun()

    # Governance actions
    is_writer = role in {"writer", "admin"}
    st.divider()
    st.subheader("Governance actions")

    if is_writer:
        # ── Table comment ──────────────────────────────────
        st.markdown("##### Update table comment")
        new_comment = st.text_area(
            "New comment", value=comment or "", height=100, key=f"cmt_{uc_full}"
        )
        if st.button("Save table comment", key=f"sv_cmt_{uc_full}"):
            try:
                uc.set_table_comment(catalog, schema, table, new_comment)
                st.success("Table comment updated.")
            except Exception as e:
                st.error(str(e))

        # ── Table tags ─────────────────────────────────────
        st.markdown("##### Update table tags")
        edited = _tags_editor(tags_df)
        if st.button("Save table tags", key=f"sv_tags_{uc_full}"):
            try:
                uc.set_table_tags(catalog, schema, table, _df_to_tags_map(edited))
                st.success("Table tags updated.")
            except Exception as e:
                st.error(str(e))

        # ── Column comments ────────────────────────────────
        st.markdown("##### Edit column comments")
        st.caption(
            "Select a column and update its description.  "
            "These are stored as column-level comments in Unity Catalog."
        )
        if not cols_df.empty:
            col_name_list = cols_df["column_name"].tolist()
            sel_col = st.selectbox(
                "Column", col_name_list, key=f"col_sel_{uc_full}"
            )
            current_col_cmt = ""
            if sel_col and not cols_df.empty:
                row = cols_df[cols_df["column_name"] == sel_col]
                if not row.empty:
                    current_col_cmt = str(row.iloc[0].get("comment") or "")
                    if current_col_cmt.lower() == "none":
                        current_col_cmt = ""
            new_col_cmt = st.text_area(
                "Column comment",
                value=current_col_cmt,
                height=80,
                key=f"col_cmt_{uc_full}_{sel_col}",
            )
            if st.button("Save column comment", key=f"sv_ccmt_{uc_full}_{sel_col}"):
                try:
                    uc.set_column_comment(
                        catalog, schema, table, sel_col, new_col_cmt
                    )
                    st.success(f"Comment updated for column `{sel_col}`.")
                except Exception as e:
                    st.error(str(e))

            # ── Column tags ────────────────────────────────
            st.markdown("##### Edit column tags")
            col_tags_df = uc.get_column_tags(catalog, schema, table, sel_col)
            edited_col_tags = _tags_editor(col_tags_df)
            if st.button("Save column tags", key=f"sv_ctags_{uc_full}_{sel_col}"):
                try:
                    uc.set_column_tags(
                        catalog, schema, table, sel_col,
                        _df_to_tags_map(edited_col_tags),
                    )
                    st.success(f"Tags updated for column `{sel_col}`.")
                except Exception as e:
                    st.error(str(e))
        else:
            st.info("No columns found for this table.")

    else:
        st.info(
            "📝 **Readers** can propose changes via a **Change Request**.  "
            "A writer or admin will review and apply them."
        )
        with st.expander("Submit a change request for this table"):
            req_comment = st.text_area(
                "Proposed comment", value=comment or "", height=100, key=f"rc_{uc_full}"
            )
            req_tags_df = _tags_editor(tags_df)
            if st.button("Submit change request", key=f"sub_{uc_full}"):
                rid = store.create_change_request(
                    created_by=user_email,
                    uc_full_name=uc_full,
                    new_comment=req_comment,
                    new_uc_tags=_df_to_tags_map(req_tags_df),
                )
                st.success(
                    f"✅ Submitted request `{rid}`.  "
                    "Go to **Change Requests** to track its status."
                )


# ─────────────────────────────────────────────────────────────
# Lineage
# ─────────────────────────────────────────────────────────────


def page_lineage(uc: UCSQLClient):
    st.header("Table Lineage (Unity Catalog)")
    st.caption(
        "Lineage is read from `system.access.table_lineage` and "
        "`system.access.column_lineage`.  Select a table below to explore "
        "its upstream and downstream dependencies."
    )

    picked = _table_picker(uc, key_prefix="lin")
    if picked is None:
        return
    catalog, schema, table = picked
    st.caption(f"Showing lineage for `{catalog}.{schema}.{table}`")

    tab_up, tab_down, tab_col = st.tabs(
        ["⬆️ Upstream", "⬇️ Downstream", "🔗 Column lineage"]
    )

    with tab_up:
        try:
            df = uc.get_table_lineage_upstream(catalog, schema, table)
            if df.empty:
                st.info(
                    "No upstream lineage found.  This table may not have any "
                    "recorded reads from other tables."
                )
            else:
                st.dataframe(df, use_container_width=True, hide_index=True)
        except Exception as e:
            st.error(
                f"**Error querying `system.access.table_lineage`:**\n\n`{e}`\n\n"
                "This usually means the app's service principal has not been "
                "granted `SELECT` on `system.access.table_lineage`. Run:\n\n"
                "```sql\nGRANT SELECT ON TABLE system.access.table_lineage "
                "TO `<service-principal-app-id>`;\n```"
            )

    with tab_down:
        try:
            df = uc.get_table_lineage_downstream(catalog, schema, table)
            if df.empty:
                st.info("No downstream consumers found for this table.")
            else:
                st.dataframe(df, use_container_width=True, hide_index=True)
        except Exception as e:
            st.error(f"**Error querying downstream lineage:**\n\n`{e}`")

    with tab_col:
        try:
            df = uc.get_column_lineage(catalog, schema, table)
            if df.empty:
                st.info("No column-level lineage found.")
            else:
                st.dataframe(df, use_container_width=True, hide_index=True)
        except Exception as e:
            st.error(
                f"**Error querying `system.access.column_lineage`:**\n\n`{e}`\n\n"
                "Grant `SELECT` on `system.access.column_lineage` "
                "to the app's service principal."
            )


# ─────────────────────────────────────────────────────────────
# Glossary
# ─────────────────────────────────────────────────────────────


def page_glossary(uc: UCSQLClient, store: GovernanceStore, role: str, user_email: str):
    st.header("Business Glossary")
    st.caption(
        "Business glossary terms stored in Unity Catalog — no external "
        "server required.  Writers / admins can create and manage terms."
    )

    # ── Browse / search ─────────────────────────────────
    q = st.text_input("🔍 Search terms (by name or definition)")
    if q:
        df = store.search_glossary(q)
    else:
        df = store.list_glossary_terms()

    if not df.empty:
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.info("No glossary terms found.  Create one below to get started.")

    if role not in {"writer", "admin"}:
        st.info("Only **writers / admins** can create or edit glossary terms.")
        return

    # ── Create / update ─────────────────────────────────
    st.divider()
    st.subheader("Create / update a term")
    with st.form("upsert_term"):
        tid = st.text_input(
            "Term ID",
            help="A unique slug, e.g. `customer_lifetime_value`.",
        )
        name = st.text_input("Display name")
        definition = st.text_area("Definition", height=100)
        domain = st.text_input("Domain (optional, e.g. Finance, Marketing)")
        owner = st.text_input("Owner email (optional)")
        status = st.selectbox("Status", ["draft", "approved", "deprecated"])
        if st.form_submit_button("Save term"):
            if not tid or not name:
                st.error("Term ID and name are required.")
            else:
                store.upsert_glossary_term(
                    term_id=tid,
                    name=name,
                    definition=definition or None,
                    domain=domain or None,
                    owner_email=owner or None,
                    status=status,
                    updated_by=user_email,
                )
                st.success(f"Saved term `{tid}`.")
                st.rerun()

    # ── Link term to a UC table or column ─────────────
    st.divider()
    st.subheader("Link a glossary term to a UC table or column")
    st.caption(
        "Associating a term adds a UC tag `glossary_term = <term_id>` on the "
        "table or column, persisting the relationship in Unity Catalog."
    )
    with st.form("link_term"):
        link_tid = st.text_input("Term ID to link")
        st.markdown("**Select the target table:**")
        link_cats = _user_catalogs(uc)
        link_cat = st.selectbox("Catalog", link_cats, key="gl_lnk_cat")
        link_schemas = uc.list_schemas(link_cat) if link_cat else pd.DataFrame()
        link_sch = st.selectbox(
            "Schema",
            link_schemas.iloc[:, 0].tolist() if not link_schemas.empty else [],
            key="gl_lnk_sch",
        )
        link_tables = (
            uc.list_tables(link_cat, link_sch)
            if link_cat and link_sch
            else pd.DataFrame()
        )
        link_tcol = (
            "tableName"
            if "tableName" in link_tables.columns
            else (link_tables.columns[-1] if not link_tables.empty else "")
        )
        link_tbl = st.selectbox(
            "Table",
            link_tables[link_tcol].tolist()
            if link_tcol and not link_tables.empty
            else [],
            key="gl_lnk_tbl",
        )

        # Optional: link to a specific column
        link_columns: List[str] = []
        if link_cat and link_sch and link_tbl:
            try:
                cols_df = uc.get_table_columns(link_cat, link_sch, link_tbl)
                if not cols_df.empty:
                    link_columns = cols_df["column_name"].tolist()
            except Exception:
                pass
        link_col = st.selectbox(
            "Column (optional — leave as '(table-level)' to tag the table)",
            ["(table-level)"] + link_columns,
            key="gl_lnk_col",
        )

        if st.form_submit_button("Link term"):
            if not link_tid or not link_tbl:
                st.error("Provide both a term ID and a target table.")
            else:
                try:
                    if link_col and link_col != "(table-level)":
                        uc.set_column_tags(
                            link_cat,
                            link_sch,
                            link_tbl,
                            link_col,
                            {"glossary_term": link_tid},
                        )
                        st.success(
                            f"Tagged column `{link_cat}.{link_sch}.{link_tbl}.{link_col}` "
                            f"with `glossary_term = {link_tid}`."
                        )
                    else:
                        uc.set_table_tags(
                            link_cat, link_sch, link_tbl, {"glossary_term": link_tid}
                        )
                        st.success(
                            f"Tagged `{link_cat}.{link_sch}.{link_tbl}` with "
                            f"`glossary_term = {link_tid}`."
                        )
                except Exception as e:
                    st.error(str(e))


# ─────────────────────────────────────────────────────────────
# Change Requests
# ─────────────────────────────────────────────────────────────


def page_change_requests(
    cfg: AppConfig,
    uc: UCSQLClient,
    store: GovernanceStore,
    om: Optional[OpenMetadataClient],
    role: str,
    user_email: str,
):
    st.header("Change Requests")

    # ── Explainer ───────────────────────────────────────
    with st.expander("ℹ️ How do change requests work?", expanded=False):
        st.markdown(
            """
**Change requests** provide a lightweight approval workflow for metadata
modifications:

1. **A reader** navigates to the **UC Browser**, selects a table, and clicks
   *"Submit a change request"*.  They can propose a new **comment** and/or
   new **UC tags**.
2. The request is saved with status **pending** in the governance Delta table.
3. **A writer or admin** opens this **Change Requests** page, reviews the
   proposal, and either:
   - **Approves** — the proposed comment / tags are automatically applied to
     the table in Unity Catalog.
   - **Rejects** — with an optional note explaining why.
4. The request's status is updated and visible to everyone.

This ensures that metadata changes go through a review process even when
readers cannot edit Unity Catalog directly.
"""
        )

    # ── Status filter ───────────────────────────────────
    filter_col1, filter_col2 = st.columns([1, 3])
    with filter_col1:
        status_filter = st.selectbox(
            "Filter by status",
            ["all", "pending", "approved", "rejected"],
            index=0,
        )

    status_arg = None if status_filter == "all" else status_filter
    df = store.list_change_requests(status=status_arg, limit=200)

    if df.empty:
        st.info(
            "No change requests"
            + (f" with status '{status_filter}'." if status_arg else " yet.")
        )
        if role not in {"writer", "admin"}:
            st.markdown(
                "💡 **Tip:** Go to **UC Browser**, select a table, and use "
                '*"Submit a change request"* to propose metadata changes.'
            )
        return

    st.dataframe(df, use_container_width=True, hide_index=True)

    # ── Review section (writers / admins only) ──────────
    if role not in {"writer", "admin"}:
        st.info(
            "💡 You can submit change requests from the **UC Browser** page.  "
            "Writers / admins can review and approve them here."
        )
        return

    st.divider()
    st.subheader("Review a request")
    request_id = st.text_input("Paste a Request ID from the table above")
    if not request_id:
        return

    req = store.get_change_request(request_id)
    if not req:
        st.warning("Request not found — double-check the ID.")
        return

    # Show request details nicely
    det_col1, det_col2 = st.columns(2)
    with det_col1:
        st.markdown(f"**Status:** `{req.status}`")
        st.markdown(f"**Created by:** {req.created_by}")
        st.markdown(f"**Created at:** {req.created_at}")
    with det_col2:
        st.markdown(f"**UC table:** `{req.uc_full_name or '—'}`")
        st.markdown(f"**Proposed comment:** {req.new_comment or '—'}")
        if req.new_uc_tags:
            st.markdown(f"**Proposed tags:** `{json.dumps(req.new_uc_tags)}`")

    if req.status != "pending":
        st.info(f"This request has already been **{req.status}**.")
        if req.reviewed_by:
            st.caption(f"Reviewed by {req.reviewed_by} at {req.reviewed_at}")
        if req.review_note:
            st.caption(f"Note: {req.review_note}")
        return

    action = st.radio("Action", ["approve", "reject"], horizontal=True)
    note = st.text_input("Review note (optional)")
    if st.button("Apply decision", type="primary"):
        if action == "reject":
            store.set_request_status(request_id, "rejected", user_email, note or None)
            st.success("Rejected.")
            st.rerun()

        errors: List[str] = []
        try:
            if req.uc_full_name:
                c, s, t = _split_uc_name(req.uc_full_name)
                if req.new_comment is not None:
                    uc.set_table_comment(c, s, t, req.new_comment)
                if req.new_uc_tags:
                    uc.set_table_tags(c, s, t, req.new_uc_tags)
        except Exception as e:
            errors.append(f"UC: {e}")

        if om and req.om_table_fqn:
            try:
                if req.add_om_tags:
                    for tag in req.add_om_tags:
                        om.add_tag_to_table(req.om_table_fqn, tag)
            except Exception as e:
                errors.append(f"OpenMetadata: {e}")

        if errors:
            store.set_request_status(
                request_id, "rejected", user_email, "; ".join(errors)
            )
            st.error(f"Could not apply: {errors}")
        else:
            store.set_request_status(request_id, "approved", user_email, note or None)
            st.success("✅ Approved and applied to Unity Catalog.")
            st.rerun()


# ─────────────────────────────────────────────────────────────
# OpenMetadata Connector
# ─────────────────────────────────────────────────────────────


def page_openmetadata(
    om: Optional[OpenMetadataClient], store: GovernanceStore, role: str, user_email: str
):
    st.header("OpenMetadata Connector (Optional)")
    if om is None:
        st.info(
            "OpenMetadata is **not configured**.  The app is running in "
            "**UC-only mode** — all core features work without it.\n\n"
            "To connect a self-hosted OpenMetadata instance, set "
            "`OPENMETADATA_SERVER_URL` and `OPENMETADATA_JWT_TOKEN` in "
            "`app.yaml` and redeploy."
        )
        return

    st.success("Connected to OpenMetadata")

    # ── Search ──────────────────────────────────────────
    st.subheader("Search tables")
    q = st.text_input("Query", value="*")
    if st.button("Search"):
        try:
            results = om.search(q, index="table_search_index", size=15)
            st.session_state["om_results"] = results
        except OpenMetadataError as e:
            st.error(str(e))

    results = st.session_state.get("om_results", [])
    if results:
        st.dataframe(
            pd.DataFrame([r.__dict__ for r in results]),
            use_container_width=True,
            hide_index=True,
        )

    # ── Table detail ────────────────────────────────────
    st.divider()
    st.subheader("Table detail")
    fqn = st.text_input("OpenMetadata table FQN (e.g. `service.db.schema.table`)")
    if fqn and st.button("Fetch detail", key="om_detail"):
        try:
            tbl = om.get_table_by_fqn(fqn)
            st.json(tbl)
        except OpenMetadataError as e:
            st.error(str(e))

    # ── Glossary terms ──────────────────────────────────
    st.divider()
    st.subheader("OpenMetadata glossary terms")
    if st.button("List glossaries"):
        try:
            glossaries = om.list_glossaries()
            st.json(glossaries)
        except OpenMetadataError as e:
            st.error(str(e))

    # ── Lineage ─────────────────────────────────────────
    st.divider()
    st.subheader("OpenMetadata lineage")
    lin_fqn = st.text_input("Table FQN for lineage", key="om_lin_fqn")
    if lin_fqn and st.button("Get lineage", key="om_lin"):
        try:
            lineage = om.get_table_lineage(lin_fqn)
            st.json(lineage)
        except OpenMetadataError as e:
            st.error(str(e))

    # ── Link UC → OM ────────────────────────────────────
    st.divider()
    st.subheader("Link UC table → OpenMetadata table")
    if role not in {"writer", "admin"}:
        st.info("Only writers / admins can create links.")
        return
    with st.form("link"):
        uc_name = st.text_input("UC table (catalog.schema.table)")
        om_fqn = st.text_input("OpenMetadata table FQN")
        if st.form_submit_button("Save link"):
            store.upsert_asset_link(uc_name, om_fqn, user_email)
            st.success("Linked.")

    st.divider()
    st.subheader("All links")
    st.dataframe(store.list_asset_links(), use_container_width=True, hide_index=True)


# ─────────────────────────────────────────────────────────────
# Admin
# ─────────────────────────────────────────────────────────────


def page_admin(store: GovernanceStore, role: str, user_email: str):
    st.header("Admin")
    if role != "admin":
        st.info("🔒 This page is restricted to **admins** only.")
        return

    st.subheader("User roles")
    st.dataframe(store.list_roles(), use_container_width=True, hide_index=True)
    with st.form("role"):
        email = st.text_input("User email")
        r = st.selectbox("Role", ["reader", "writer", "admin"])
        if st.form_submit_button("Upsert"):
            store.upsert_role(email, r, user_email)
            st.success("Updated.")
            st.rerun()


# ── Main ────────────────────────────────────────────────────


def main():
    st.set_page_config(
        page_title="Governance Hub",
        page_icon="🏛️",
        layout="wide",
    )

    try:
        cfg = _get_config()
        uc = _get_uc_client(cfg)
        store = _get_store(cfg, uc)
        om = _get_om_client(cfg)
    except Exception as e:
        st.error(f"Configuration error: {e}")
        st.stop()

    user_email = get_current_user_email() or "unknown"
    role = store.get_role(user_email, admin_emails=cfg.admin_emails)

    # Sidebar
    st.sidebar.title("🏛️ Governance Hub")
    st.sidebar.caption(f"Signed in as: **{user_email}**")
    st.sidebar.markdown(_role_badge(role))
    st.sidebar.divider()

    pages = [
        "🏠 Home",
        "🗂️ UC Browser",
        "🔀 Lineage",
        "📘 Glossary",
        "📋 Change Requests",
        "🔌 OpenMetadata",
        "⚙️ Admin",
    ]
    page = st.sidebar.radio("Navigate", pages, index=0, label_visibility="collapsed")

    if page == "🏠 Home":
        page_home(cfg, uc, om, role, user_email)
    elif page == "🗂️ UC Browser":
        page_uc_browser(cfg, uc, store, role, user_email)
    elif page == "🔀 Lineage":
        page_lineage(uc)
    elif page == "📘 Glossary":
        page_glossary(uc, store, role, user_email)
    elif page == "📋 Change Requests":
        page_change_requests(cfg, uc, store, om, role, user_email)
    elif page == "🔌 OpenMetadata":
        page_openmetadata(om, store, role, user_email)
    elif page == "⚙️ Admin":
        page_admin(store, role, user_email)


if __name__ == "__main__":
    main()
