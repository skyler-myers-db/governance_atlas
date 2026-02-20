from __future__ import annotations

import json
from typing import Dict, List, Optional, Tuple

import pandas as pd
import streamlit as st

from govhub.auth import get_current_user_email
from govhub.config import AppConfig
from govhub.datahub import DataHubError, DataHubGraphQLClient
from govhub.store import GovernanceStore
from govhub.uc import UCSQLClient
from govhub.util import quote_uc_3part


@st.cache_resource
def _get_config() -> AppConfig:
    return AppConfig.from_env()


@st.cache_resource
def _get_uc_client(cfg: AppConfig) -> UCSQLClient:
    return UCSQLClient(warehouse_id=cfg.warehouse_id)


@st.cache_resource
def _get_store(cfg: AppConfig, uc: UCSQLClient) -> GovernanceStore:
    store = GovernanceStore(uc=uc, catalog=cfg.gov_catalog, schema=cfg.gov_schema)
    store.ensure_tables()
    return store


@st.cache_resource
def _get_datahub_client(cfg: AppConfig) -> Optional[DataHubGraphQLClient]:
    # Allow UC-only mode if DataHub isn't configured yet.
    if not cfg.datahub_gms_url or not cfg.datahub_token:
        return None
    return DataHubGraphQLClient(gms_url=cfg.datahub_gms_url, token=cfg.datahub_token)


def _role_badge(role: str) -> str:
    role = role.lower()
    if role == "admin":
        return "🛡️ admin"
    if role == "writer":
        return "✍️ writer"
    return "👀 reader"


def _tags_editor(existing: pd.DataFrame) -> pd.DataFrame:
    if existing is None or existing.empty:
        df = pd.DataFrame([{"tag_name": "", "tag_value": ""}])
    else:
        df = existing[["tag_name", "tag_value"]].copy()
        df.loc[len(df)] = {"tag_name": "", "tag_value": ""}  # add empty row
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


def _split_uc_name(uc_full_name: str) -> Tuple[str, str, str]:
    parts = [p.strip() for p in uc_full_name.split(".") if p.strip()]
    if len(parts) != 3:
        raise ValueError("Expected UC name in format catalog.schema.table")
    return parts[0], parts[1], parts[2]


def _render_uc_browser(cfg: AppConfig, uc: UCSQLClient, store: GovernanceStore, dh: Optional[DataHubGraphQLClient], role: str, user_email: str):
    st.subheader("Unity Catalog browser")

    catalogs = uc.list_catalogs()
    if catalogs.empty:
        st.warning("No catalogs visible (or warehouse permissions missing).")
        return
    catalog_col = catalogs.columns[0]
    catalog = st.selectbox("Catalog", catalogs[catalog_col].tolist(), index=0)

    schemas = uc.list_schemas(catalog)
    schema_col = schemas.columns[0]
    schema = st.selectbox("Schema", schemas[schema_col].tolist(), index=0)

    tables = uc.list_tables(catalog, schema)
    if tables.empty:
        st.info("No tables found in this schema (or permissions).") 
        return
    # SHOW TABLES returns a tableName column in most cases
    table_col = "tableName" if "tableName" in tables.columns else tables.columns[-1]
    table = st.selectbox("Table", tables[table_col].tolist(), index=0)

    uc_full = f"{catalog}.{schema}.{table}"
    st.caption(f"Selected: `{uc_full}`")

    # UC details
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

    is_writer = role in {"writer", "admin"}

    # Link to DataHub if configured
    datahub_urn = store.get_datahub_urn_for_uc(uc_full)
    st.divider()
    st.subheader("DataHub linkage (optional)")
    if dh is None:
        st.info("DataHub is not configured (set DATAHUB_GMS_URL and DATAHUB_TOKEN as app secrets). UC-only mode is active.")
    else:
        if datahub_urn:
            st.success(f"Linked DataHub dataset URN: `{datahub_urn}`")
        else:
            st.warning("No DataHub dataset linked yet.")

        with st.expander("Link / update link", expanded=not bool(datahub_urn)):
            default_query = uc_full
            q = st.text_input("Search DataHub datasets", value=default_query)
            if st.button("Search", key=f"dh_search_{uc_full}"):
                try:
                    results = dh.search(entity_type="DATASET", query_text=q, start=0, count=10)
                    st.session_state["dh_search_results"] = results
                except Exception as e:
                    st.error(f"DataHub search failed: {e}")

            results = st.session_state.get("dh_search_results", [])
            if results:
                options = [f"{r.name}  |  {r.platform or ''}  |  {r.urn}" for r in results]
                sel = st.selectbox("Choose dataset", options, index=0)
                selected_urn = sel.split("|")[-1].strip()
                if st.button("Save link", disabled=not is_writer):
                    store.upsert_asset_link(uc_full_name=uc_full, datahub_urn=selected_urn, updated_by=user_email)
                    st.success("Saved link. Reload the page to see DataHub metadata.")
                    st.rerun()

        # Show DataHub metadata if linked
        if datahub_urn:
            st.markdown("#### DataHub metadata")
            try:
                dh_tags = dh.get_dataset_tags(datahub_urn)
                dh_terms = dh.get_dataset_terms(datahub_urn)
            except DataHubError as e:
                st.error(f"Failed to fetch DataHub metadata: {e}")
                dh_tags, dh_terms = [], []

            col1, col2 = st.columns(2)
            with col1:
                st.markdown("**Tags**")
                st.dataframe(pd.DataFrame(dh_tags), use_container_width=True, hide_index=True)
            with col2:
                st.markdown("**Glossary terms**")
                st.dataframe(pd.DataFrame(dh_terms), use_container_width=True, hide_index=True)

            if is_writer:
                with st.expander("Add DataHub tags / terms", expanded=False):
                    st.markdown("Add existing Tag URNs / Term URNs to this dataset.")
                    tag_urns_text = st.text_area("Tag URNs (one per line)", value="")
                    term_urns_text = st.text_area("Glossary Term URNs (one per line)", value="")
                    if st.button("Apply to DataHub", key=f"apply_dh_{uc_full}"):
                        tag_urns = [t.strip() for t in tag_urns_text.splitlines() if t.strip()]
                        term_urns = [t.strip() for t in term_urns_text.splitlines() if t.strip()]
                        try:
                            if tag_urns:
                                dh.add_tags(resource_urn=datahub_urn, tag_urns=tag_urns)
                            if term_urns:
                                dh.add_terms(resource_urn=datahub_urn, term_urns=term_urns)
                            st.success("Updated DataHub metadata.")
                        except Exception as e:
                            st.error(f"Failed to update DataHub: {e}")
            else:
                st.info("You are a reader. To change DataHub metadata, submit a change request.")

    # Governance actions (UC comment/tags)
    st.divider()
    st.subheader("Governance actions")
    if is_writer:
        st.markdown("##### Update UC comment")
        new_comment = st.text_area("New comment", value=comment or "", height=120, key=f"comment_{uc_full}")
        if st.button("Save comment", key=f"save_comment_{uc_full}"):
            try:
                uc.set_table_comment(catalog, schema, table, new_comment)
                st.success("Updated table comment.")
            except Exception as e:
                st.error(f"Failed to update comment: {e}")

        st.markdown("##### Update UC tags")
        edited = _tags_editor(tags_df)
        tags_map = _df_to_tags_map(edited)
        if st.button("Save tags", key=f"save_tags_{uc_full}"):
            try:
                uc.set_table_tags(catalog, schema, table, tags_map)
                st.success("Updated tags.")
            except Exception as e:
                st.error(f"Failed to update tags: {e}")
    else:
        st.info("Reader mode: submit a change request for updates.")
        with st.expander("Submit change request", expanded=False):
            req_comment = st.text_area("Proposed comment", value=comment or "", height=120, key=f"req_comment_{uc_full}")
            req_tags_df = _tags_editor(tags_df)
            req_tags = _df_to_tags_map(req_tags_df)

            dh_dataset_urn = store.get_datahub_urn_for_uc(uc_full)
            st.caption(f"DataHub dataset linked: `{dh_dataset_urn}`" if dh_dataset_urn else "No DataHub link found.")

            add_tag_urns = st.text_area("Add DataHub Tag URNs (optional, one per line)", value="")
            add_term_urns = st.text_area("Add DataHub Glossary Term URNs (optional, one per line)", value="")
            if st.button("Submit request", key=f"submit_req_{uc_full}"):
                tag_urns = [t.strip() for t in add_tag_urns.splitlines() if t.strip()]
                term_urns = [t.strip() for t in add_term_urns.splitlines() if t.strip()]
                rid = store.create_change_request(
                    created_by=user_email,
                    uc_full_name=uc_full,
                    new_comment=req_comment,
                    new_uc_tags=req_tags,
                    datahub_dataset_urn=dh_dataset_urn,
                    add_datahub_tag_urns=tag_urns or None,
                    add_datahub_term_urns=term_urns or None,
                )
                st.success(f"Submitted request `{rid}`")


def _render_glossary(dh: Optional[DataHubGraphQLClient], role: str):
    st.subheader("Business glossary (DataHub)")
    if dh is None:
        st.info("DataHub is not configured.")
        return

    st.markdown("Search for glossary terms (in DataHub)")
    q = st.text_input("Search terms", value="")
    if st.button("Search terms"):
        try:
            res = dh.search(entity_type="GLOSSARY_TERM", query_text=q or "*", start=0, count=25)
            st.session_state["term_search_results"] = res
        except Exception as e:
            st.error(f"Search failed: {e}")

    res = st.session_state.get("term_search_results", [])
    if res:
        st.dataframe(pd.DataFrame([r.__dict__ for r in res]), use_container_width=True, hide_index=True)

    is_writer = role in {"writer", "admin"}
    st.divider()
    st.markdown("#### Create a new term")
    if not is_writer:
        st.info("Only writers/admins can create glossary terms.")
        return

    with st.form("create_term"):
        name = st.text_input("Name")
        term_id = st.text_input("ID (unique slug)")
        desc = st.text_area("Description", height=120)
        submitted = st.form_submit_button("Create term")
        if submitted:
            try:
                urn = dh.create_glossary_term(name=name, term_id=term_id, description=desc)
                st.success(f"Created term: `{urn}`")
            except Exception as e:
                st.error(f"Failed to create term: {e}")


def _render_requests(cfg: AppConfig, uc: UCSQLClient, store: GovernanceStore, dh: Optional[DataHubGraphQLClient], role: str, user_email: str):
    st.subheader("Change requests")
    df = store.list_change_requests(status=None, limit=200)
    if df.empty:
        st.info("No requests yet.")
        return

    st.dataframe(df, use_container_width=True, hide_index=True)

    is_writer = role in {"writer", "admin"}
    if not is_writer:
        st.info("Readers can view requests they submitted. Writers/admins can approve/reject and apply changes.")
        return

    st.divider()
    request_id = st.text_input("Request ID to review")
    if not request_id:
        return

    req = store.get_change_request(request_id)
    if not req:
        st.warning("Request not found.")
        return

    st.markdown("#### Request details")
    st.json(req.__dict__)

    action = st.radio("Action", ["approve", "reject"], horizontal=True)
    note = st.text_input("Review note (optional)", value="")
    if st.button("Apply decision"):
        if action == "reject":
            store.set_request_status(request_id=request_id, status="rejected", reviewed_by=user_email, review_note=note or None)
            st.success("Rejected request.")
            st.rerun()

        # Approve: apply changes (best-effort)
        errors: List[str] = []
        try:
            if req.uc_full_name:
                c, s, t = _split_uc_name(req.uc_full_name)
                if req.new_comment is not None:
                    uc.set_table_comment(c, s, t, req.new_comment)
                if req.new_uc_tags:
                    uc.set_table_tags(c, s, t, req.new_uc_tags)
        except Exception as e:
            errors.append(f"UC update failed: {e}")

        if dh is not None and req.datahub_dataset_urn:
            try:
                if req.add_datahub_tag_urns:
                    dh.add_tags(resource_urn=req.datahub_dataset_urn, tag_urns=req.add_datahub_tag_urns)
                if req.add_datahub_term_urns:
                    dh.add_terms(resource_urn=req.datahub_dataset_urn, term_urns=req.add_datahub_term_urns)
            except Exception as e:
                errors.append(f"DataHub update failed: {e}")

        if errors:
            store.set_request_status(request_id=request_id, status="rejected", reviewed_by=user_email, review_note="; ".join(errors))
            st.error("Approved changes could not be fully applied. Marked as rejected with errors:")
            st.write(errors)
        else:
            store.set_request_status(request_id=request_id, status="approved", reviewed_by=user_email, review_note=note or None)
            st.success("Approved and applied request.")
            st.rerun()


def _render_admin(store: GovernanceStore, role: str, user_email: str):
    st.subheader("Admin")
    if role != "admin":
        st.info("Admin only.")
        return

    st.markdown("#### User roles")
    roles_df = store.list_roles()
    st.dataframe(roles_df, use_container_width=True, hide_index=True)

    with st.form("upsert_role"):
        email = st.text_input("User email")
        role_sel = st.selectbox("Role", ["reader", "writer", "admin"], index=0)
        submitted = st.form_submit_button("Upsert role")
        if submitted:
            store.upsert_role(email=email, role=role_sel, updated_by=user_email)
            st.success("Updated.")
            st.rerun()

    st.divider()
    st.markdown("#### Asset links (UC ↔ DataHub)")
    links_df = store.list_asset_links()
    st.dataframe(links_df, use_container_width=True, hide_index=True)


def main():
    st.set_page_config(page_title="Governance Hub", layout="wide")

    try:
        cfg = _get_config()
        uc = _get_uc_client(cfg)
        store = _get_store(cfg, uc)
        dh = _get_datahub_client(cfg)
    except Exception as e:
        st.error(f"App is not configured correctly: {e}")
        st.stop()

    user_email = get_current_user_email() or "unknown"
    role = store.get_role(user_email, admin_emails=cfg.admin_emails)

    st.sidebar.title("Governance Hub")
    st.sidebar.caption(f"Signed in as: `{user_email}`")
    st.sidebar.markdown(_role_badge(role))

    page = st.sidebar.radio(
        "Navigate",
        ["Home", "Unity Catalog", "Glossary", "Change Requests", "Admin"],
        index=0,
    )

    if page == "Home":
        st.title("Governance Hub")
        st.markdown(
            """This app is a lightweight governance portal that combines:

- **Unity Catalog** (enforcement + technical metadata)
- **DataHub** (open-source governance metadata: tags, glossary terms, domains)

Use the left navigation to browse and govern data assets.
"""
        )
        st.markdown("#### Quick health checks")
        try:
            catalogs = uc.list_catalogs()
            st.metric("Visible catalogs", int(len(catalogs)))
        except Exception as e:
            st.error(f"Unity Catalog query failed: {e}")
        if dh is None:
            st.warning("DataHub not configured. Configure DATAHUB_GMS_URL and DATAHUB_TOKEN secrets to enable glossary + tagging.")
        else:
            st.success("DataHub configured.")

    elif page == "Unity Catalog":
        _render_uc_browser(cfg, uc, store, dh, role, user_email)

    elif page == "Glossary":
        _render_glossary(dh, role)

    elif page == "Change Requests":
        _render_requests(cfg, uc, store, dh, role, user_email)

    elif page == "Admin":
        _render_admin(store, role, user_email)


if __name__ == "__main__":
    main()
