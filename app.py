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


def page_home(cfg: AppConfig, uc: UCSQLClient, om: Optional[OpenMetadataClient]):
    st.title("Governance Hub")
    st.markdown(
        "A lightweight governance portal combining **Unity Catalog** "
        "(enforcement + metadata) with an optional **OpenMetadata** connector "
        "(cross-platform lineage, glossary, enrichment)."
    )
    st.markdown("### Quick health")
    col1, col2, col3 = st.columns(3)
    with col1:
        try:
            cats = uc.list_catalogs()
            st.metric("UC catalogs visible", len(cats))
        except Exception as e:
            st.error(f"UC query failed: {e}")
    with col2:
        st.metric("Governance catalog", cfg.gov_catalog)
    with col3:
        if om is None:
            st.warning("OpenMetadata: not configured (UC-only mode)")
        else:
            st.success("OpenMetadata: connected")


def page_uc_browser(
    cfg: AppConfig, uc: UCSQLClient, store: GovernanceStore, role: str, user_email: str
):
    st.header("Unity Catalog Browser")

    catalogs = uc.list_catalogs()
    if catalogs.empty:
        st.warning("No catalogs visible.")
        return
    catalog = st.selectbox("Catalog", catalogs.iloc[:, 0].tolist())

    schemas = uc.list_schemas(catalog)
    schema = st.selectbox("Schema", schemas.iloc[:, 0].tolist())

    tables = uc.list_tables(catalog, schema)
    if tables.empty:
        st.info("No tables in this schema.")
        return
    tcol = "tableName" if "tableName" in tables.columns else tables.columns[-1]
    table = st.selectbox("Table", tables[tcol].tolist())

    uc_full = f"{catalog}.{schema}.{table}"
    st.caption(f"Selected: `{uc_full}`")

    # Details
    cols_df = uc.get_table_columns(catalog, schema, table)
    comment = uc.get_table_comment(catalog, schema, table)
    tags_df = uc.get_table_tags(catalog, schema, table)

    with st.expander("Table details", expanded=True):
        st.markdown("**Comment**")
        st.code(comment or "(none)")
        st.markdown("**Columns**")
        st.dataframe(cols_df, use_container_width=True, hide_index=True)
        st.markdown("**UC Tags**")
        st.dataframe(tags_df, use_container_width=True, hide_index=True)

    # Owners
    with st.expander("Data owners"):
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
        st.markdown("##### Update UC comment")
        new_comment = st.text_area(
            "New comment", value=comment or "", height=100, key=f"cmt_{uc_full}"
        )
        if st.button("Save comment", key=f"sv_cmt_{uc_full}"):
            try:
                uc.set_table_comment(catalog, schema, table, new_comment)
                st.success("Comment updated.")
            except Exception as e:
                st.error(str(e))

        st.markdown("##### Update UC tags")
        edited = _tags_editor(tags_df)
        if st.button("Save tags", key=f"sv_tags_{uc_full}"):
            try:
                uc.set_table_tags(catalog, schema, table, _df_to_tags_map(edited))
                st.success("Tags updated.")
            except Exception as e:
                st.error(str(e))
    else:
        st.info("Reader: submit a change request for updates.")
        with st.expander("Submit change request"):
            req_comment = st.text_area(
                "Proposed comment", value=comment or "", height=100, key=f"rc_{uc_full}"
            )
            req_tags_df = _tags_editor(tags_df)
            if st.button("Submit", key=f"sub_{uc_full}"):
                rid = store.create_change_request(
                    created_by=user_email,
                    uc_full_name=uc_full,
                    new_comment=req_comment,
                    new_uc_tags=_df_to_tags_map(req_tags_df),
                )
                st.success(f"Submitted request `{rid}`")


def page_lineage(uc: UCSQLClient):
    st.header("Table Lineage (Unity Catalog)")
    st.caption(
        "Lineage is read from `system.access.table_lineage` and "
        "`system.access.column_lineage` (available on Unity Catalog-enabled "
        "workspaces with system tables access)."
    )

    uc_name = st.text_input("Enter table name (catalog.schema.table)")
    if not uc_name or uc_name.count(".") != 2:
        st.info("Enter a fully qualified table name to view lineage.")
        return

    catalog, schema, table = _split_uc_name(uc_name)

    tab_up, tab_down, tab_col = st.tabs(["Upstream", "Downstream", "Column lineage"])

    with tab_up:
        df = uc.get_table_lineage_upstream(catalog, schema, table)
        if df.empty:
            st.info(
                "No upstream lineage found (table may not have lineage recorded yet)."
            )
        else:
            st.dataframe(df, use_container_width=True, hide_index=True)

    with tab_down:
        df = uc.get_table_lineage_downstream(catalog, schema, table)
        if df.empty:
            st.info("No downstream lineage found.")
        else:
            st.dataframe(df, use_container_width=True, hide_index=True)

    with tab_col:
        df = uc.get_column_lineage(catalog, schema, table)
        if df.empty:
            st.info("No column lineage found.")
        else:
            st.dataframe(df, use_container_width=True, hide_index=True)


def page_glossary(store: GovernanceStore, role: str, user_email: str):
    st.header("Business Glossary")
    st.caption("Glossary terms stored in Unity Catalog — no external server required.")

    # Search
    q = st.text_input("Search (by name or definition)")
    if q:
        df = store.search_glossary(q)
    else:
        df = store.list_glossary_terms()

    if not df.empty:
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.info("No glossary terms found.")

    if role not in {"writer", "admin"}:
        st.info("Only writers / admins can create or edit glossary terms.")
        return

    st.divider()
    st.subheader("Create / update term")
    with st.form("upsert_term"):
        tid = st.text_input("Term ID (unique slug, e.g. `customer_lifetime_value`)")
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


def page_change_requests(
    cfg: AppConfig,
    uc: UCSQLClient,
    store: GovernanceStore,
    om: Optional[OpenMetadataClient],
    role: str,
    user_email: str,
):
    st.header("Change Requests")
    df = store.list_change_requests(limit=200)
    if df.empty:
        st.info("No change requests yet.")
        return

    st.dataframe(df, use_container_width=True, hide_index=True)

    if role not in {"writer", "admin"}:
        st.info("Writers / admins can review requests.")
        return

    st.divider()
    request_id = st.text_input("Request ID to review")
    if not request_id:
        return

    req = store.get_change_request(request_id)
    if not req:
        st.warning("Not found.")
        return

    st.json(req.__dict__)
    action = st.radio("Action", ["approve", "reject"], horizontal=True)
    note = st.text_input("Review note (optional)")
    if st.button("Apply decision"):
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
            st.success("Approved and applied.")
            st.rerun()


def page_openmetadata(
    om: Optional[OpenMetadataClient], store: GovernanceStore, role: str, user_email: str
):
    st.header("OpenMetadata Connector (Optional)")
    if om is None:
        st.info(
            "OpenMetadata is **not configured**. The app is running in UC-only mode.\n\n"
            "To connect a self-hosted OpenMetadata instance, set "
            "`OPENMETADATA_SERVER_URL` and `OPENMETADATA_JWT_TOKEN` in `app.yaml` "
            "and redeploy."
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


def page_admin(store: GovernanceStore, role: str, user_email: str):
    st.header("Admin")
    if role != "admin":
        st.info("Admin only.")
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
    st.set_page_config(page_title="Governance Hub", layout="wide")

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
    st.sidebar.title("Governance Hub")
    st.sidebar.caption(f"Signed in as: `{user_email}`")
    st.sidebar.markdown(_role_badge(role))

    pages = [
        "Home",
        "UC Browser",
        "Lineage",
        "Glossary",
        "Change Requests",
        "OpenMetadata Connector",
        "Admin",
    ]
    page = st.sidebar.radio("Navigate", pages, index=0)

    if page == "Home":
        page_home(cfg, uc, om)
    elif page == "UC Browser":
        page_uc_browser(cfg, uc, store, role, user_email)
    elif page == "Lineage":
        page_lineage(uc)
    elif page == "Glossary":
        page_glossary(store, role, user_email)
    elif page == "Change Requests":
        page_change_requests(cfg, uc, store, om, role, user_email)
    elif page == "OpenMetadata Connector":
        page_openmetadata(om, store, role, user_email)
    elif page == "Admin":
        page_admin(store, role, user_email)


if __name__ == "__main__":
    main()
