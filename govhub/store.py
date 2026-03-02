from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd

from .uc import UCSQLClient
from .util import quote_ident, sql_literal


def _utc_now_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


@dataclass(frozen=True)
class ChangeRequest:
    request_id: str
    created_at: str
    created_by: str
    status: str
    uc_full_name: str | None = None
    new_comment: str | None = None
    new_uc_tags: Dict[str, str] | None = None
    om_table_fqn: str | None = None
    add_om_tags: List[str] | None = None
    add_om_glossary_terms: List[str] | None = None
    reviewed_at: str | None = None
    reviewed_by: str | None = None
    review_note: str | None = None


class GovernanceStore:
    """Stores all governance state in Unity Catalog Delta tables."""

    def __init__(self, uc: UCSQLClient, catalog: str, schema: str):
        self.uc = uc
        self.catalog = catalog
        self.schema = schema

    @property
    def fq_schema(self) -> str:
        return f"{quote_ident(self.catalog)}.{quote_ident(self.schema)}"

    def _fq(self, table: str) -> str:
        return f"{self.fq_schema}.{quote_ident(table)}"

    # ── Bootstrap DDL ───────────────────────────────────────

    def ensure_tables(self) -> None:
        self.uc.execute(f"CREATE SCHEMA IF NOT EXISTS {self.fq_schema}")

        self.uc.execute(f"""CREATE TABLE IF NOT EXISTS {self._fq("user_roles")} (
            email      STRING NOT NULL,
            role       STRING NOT NULL COMMENT 'reader | writer | admin',
            updated_at TIMESTAMP,
            updated_by STRING
        ) USING DELTA""")

        self.uc.execute(f"""CREATE TABLE IF NOT EXISTS {self._fq("glossary_terms")} (
            term_id     STRING NOT NULL,
            name        STRING NOT NULL,
            definition  STRING,
            domain      STRING,
            owner_email STRING,
            status      STRING COMMENT 'draft | approved | deprecated',
            created_at  TIMESTAMP,
            created_by  STRING,
            updated_at  TIMESTAMP,
            updated_by  STRING
        ) USING DELTA""")

        self.uc.execute(f"""CREATE TABLE IF NOT EXISTS {self._fq("data_owners")} (
            uc_full_name STRING NOT NULL COMMENT 'catalog.schema.table',
            owner_email  STRING NOT NULL,
            owner_type   STRING COMMENT 'technical | business | steward',
            updated_at   TIMESTAMP,
            updated_by   STRING
        ) USING DELTA""")

        self.uc.execute(f"""CREATE TABLE IF NOT EXISTS {self._fq("asset_links")} (
            uc_full_name  STRING NOT NULL COMMENT 'catalog.schema.table',
            om_table_fqn  STRING NOT NULL COMMENT 'OpenMetadata fully-qualified table name',
            updated_at    TIMESTAMP,
            updated_by    STRING
        ) USING DELTA""")

        self.uc.execute(f"""CREATE TABLE IF NOT EXISTS {self._fq("change_requests")} (
            request_id  STRING NOT NULL,
            created_at  TIMESTAMP,
            created_by  STRING,
            status      STRING COMMENT 'pending | approved | rejected',
            uc_full_name STRING,
            new_comment  STRING,
            new_uc_tags_json STRING,
            om_table_fqn STRING,
            add_om_tags_json  STRING,
            add_om_glossary_terms_json STRING,
            reviewed_at TIMESTAMP,
            reviewed_by STRING,
            review_note STRING
        ) USING DELTA""")

    # ── Roles ───────────────────────────────────────────────

    def get_role(self, email: str, admin_emails: List[str] | None = None) -> str:
        admin_emails = admin_emails or []
        e = email.strip().lower()
        df = self.uc.query_df(
            f"SELECT role FROM {self._fq('user_roles')} "
            f"WHERE lower(email) = {sql_literal(e)} LIMIT 1"
        )
        if not df.empty and df.iloc[0].get("role"):
            return str(df.iloc[0]["role"]).lower()

        if e and any(e == a.strip().lower() for a in admin_emails):
            self.upsert_role(email=e, role="admin", updated_by=e)
            return "admin"
        return "reader"

    def list_roles(self) -> pd.DataFrame:
        return self.uc.query_df(
            f"SELECT email, role, updated_at, updated_by "
            f"FROM {self._fq('user_roles')} ORDER BY lower(email)"
        )

    def upsert_role(self, email: str, role: str, updated_by: str) -> None:
        e, r, u, ts = (
            email.strip().lower(),
            role.strip().lower(),
            updated_by.strip().lower(),
            _utc_now_ts(),
        )
        self.uc.execute(f"""MERGE INTO {self._fq("user_roles")} t
USING (SELECT {sql_literal(e)} AS email, {sql_literal(r)} AS role,
              timestamp({sql_literal(ts)}) AS updated_at,
              {sql_literal(u)} AS updated_by) s
ON lower(t.email) = lower(s.email)
WHEN MATCHED THEN UPDATE SET role=s.role, updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT * """)

    # ── Glossary (UC-native) ────────────────────────────────

    def list_glossary_terms(
        self, status: str | None = None, limit: int = 200
    ) -> pd.DataFrame:
        where = f"WHERE status = {sql_literal(status)}" if status else ""
        return self.uc.query_df(
            f"SELECT * FROM {self._fq('glossary_terms')} {where} "
            f"ORDER BY lower(name) LIMIT {int(limit)}"
        )

    def get_glossary_term(self, term_id: str) -> Optional[pd.Series]:
        df = self.uc.query_df(
            f"SELECT * FROM {self._fq('glossary_terms')} "
            f"WHERE term_id = {sql_literal(term_id)} LIMIT 1"
        )
        return df.iloc[0] if not df.empty else None

    def upsert_glossary_term(
        self,
        term_id: str,
        name: str,
        definition: str | None = None,
        domain: str | None = None,
        owner_email: str | None = None,
        status: str = "draft",
        updated_by: str = "",
    ) -> None:
        ts = _utc_now_ts()
        self.uc.execute(f"""MERGE INTO {self._fq("glossary_terms")} t
USING (SELECT {sql_literal(term_id)} AS term_id,
              {sql_literal(name)} AS name,
              {sql_literal(definition)} AS definition,
              {sql_literal(domain)} AS domain,
              {sql_literal(owner_email)} AS owner_email,
              {sql_literal(status)} AS status,
              timestamp({sql_literal(ts)}) AS updated_at,
              {sql_literal(updated_by)} AS updated_by) s
ON t.term_id = s.term_id
WHEN MATCHED THEN UPDATE SET
    name=s.name, definition=s.definition, domain=s.domain,
    owner_email=s.owner_email, status=s.status,
    updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT (
    term_id, name, definition, domain, owner_email, status,
    created_at, created_by, updated_at, updated_by
) VALUES (
    s.term_id, s.name, s.definition, s.domain, s.owner_email, s.status,
    s.updated_at, s.updated_by, s.updated_at, s.updated_by
)""")

    def search_glossary(self, query: str, limit: int = 25) -> pd.DataFrame:
        q = query.strip().lower()
        return self.uc.query_df(
            f"SELECT * FROM {self._fq('glossary_terms')} "
            f"WHERE lower(name) LIKE {sql_literal(f'%{q}%')} "
            f"   OR lower(definition) LIKE {sql_literal(f'%{q}%')} "
            f"ORDER BY lower(name) LIMIT {int(limit)}"
        )

    # ── Data owners ─────────────────────────────────────────

    def get_owners(self, uc_full_name: str) -> pd.DataFrame:
        return self.uc.query_df(
            f"SELECT owner_email, owner_type, updated_at, updated_by "
            f"FROM {self._fq('data_owners')} "
            f"WHERE uc_full_name = {sql_literal(uc_full_name)} "
            f"ORDER BY owner_type"
        )

    def upsert_owner(
        self, uc_full_name: str, owner_email: str, owner_type: str, updated_by: str
    ) -> None:
        ts = _utc_now_ts()
        self.uc.execute(f"""MERGE INTO {self._fq("data_owners")} t
USING (SELECT {sql_literal(uc_full_name)} AS uc_full_name,
              {sql_literal(owner_email)} AS owner_email,
              {sql_literal(owner_type)} AS owner_type,
              timestamp({sql_literal(ts)}) AS updated_at,
              {sql_literal(updated_by)} AS updated_by) s
ON t.uc_full_name = s.uc_full_name AND lower(t.owner_email) = lower(s.owner_email)
WHEN MATCHED THEN UPDATE SET owner_type=s.owner_type, updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT * """)

    def remove_owner(self, uc_full_name: str, owner_email: str) -> None:
        self.uc.execute(
            f"DELETE FROM {self._fq('data_owners')} "
            f"WHERE uc_full_name = {sql_literal(uc_full_name)} "
            f"AND lower(owner_email) = {sql_literal(owner_email.strip().lower())}"
        )

    # ── Asset links (optional OpenMetadata) ──────────────────

    def get_om_fqn_for_uc(self, uc_full_name: str) -> Optional[str]:
        df = self.uc.query_df(
            f"SELECT om_table_fqn FROM {self._fq('asset_links')} "
            f"WHERE uc_full_name = {sql_literal(uc_full_name)} LIMIT 1"
        )
        return str(df.iloc[0]["om_table_fqn"]) if not df.empty else None

    def upsert_asset_link(
        self, uc_full_name: str, om_table_fqn: str, updated_by: str
    ) -> None:
        ts = _utc_now_ts()
        self.uc.execute(f"""MERGE INTO {self._fq("asset_links")} t
USING (SELECT {sql_literal(uc_full_name)} AS uc_full_name,
              {sql_literal(om_table_fqn)} AS om_table_fqn,
              timestamp({sql_literal(ts)}) AS updated_at,
              {sql_literal(updated_by)} AS updated_by) s
ON t.uc_full_name = s.uc_full_name
WHEN MATCHED THEN UPDATE SET om_table_fqn=s.om_table_fqn, updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT * """)

    def list_asset_links(self) -> pd.DataFrame:
        return self.uc.query_df(
            f"SELECT * FROM {self._fq('asset_links')} ORDER BY uc_full_name"
        )

    # ── Change requests ─────────────────────────────────────

    def create_change_request(
        self,
        created_by: str,
        uc_full_name: str | None = None,
        new_comment: str | None = None,
        new_uc_tags: Dict[str, str] | None = None,
        om_table_fqn: str | None = None,
        add_om_tags: List[str] | None = None,
        add_om_glossary_terms: List[str] | None = None,
    ) -> str:
        rid = uuid.uuid4().hex
        ts = _utc_now_ts()
        self.uc.execute(f"""INSERT INTO {self._fq("change_requests")} (
  request_id, created_at, created_by, status,
  uc_full_name, new_comment, new_uc_tags_json,
  om_table_fqn, add_om_tags_json, add_om_glossary_terms_json,
  reviewed_at, reviewed_by, review_note
) VALUES (
  {sql_literal(rid)}, timestamp({sql_literal(ts)}), {sql_literal(created_by)}, 'pending',
  {sql_literal(uc_full_name)},
  {sql_literal(new_comment)},
  {sql_literal(json.dumps(new_uc_tags)) if new_uc_tags else "NULL"},
  {sql_literal(om_table_fqn)},
  {sql_literal(json.dumps(add_om_tags)) if add_om_tags else "NULL"},
  {sql_literal(json.dumps(add_om_glossary_terms)) if add_om_glossary_terms else "NULL"},
  NULL, NULL, NULL
)""")
        return rid

    def list_change_requests(
        self, status: str | None = None, limit: int = 200
    ) -> pd.DataFrame:
        where = f"WHERE status = {sql_literal(status)}" if status else ""
        return self.uc.query_df(
            f"SELECT * FROM {self._fq('change_requests')} {where} "
            f"ORDER BY created_at DESC LIMIT {int(limit)}"
        )

    def get_change_request(self, request_id: str) -> Optional[ChangeRequest]:
        df = self.uc.query_df(
            f"SELECT * FROM {self._fq('change_requests')} "
            f"WHERE request_id = {sql_literal(request_id)} LIMIT 1"
        )
        if df.empty:
            return None
        row = df.iloc[0].to_dict()

        def _jl(v: Any) -> Any:
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return None
            try:
                return json.loads(v)
            except Exception:
                return None

        return ChangeRequest(
            request_id=row.get("request_id"),
            created_at=str(row.get("created_at")),
            created_by=str(row.get("created_by")),
            status=str(row.get("status")),
            uc_full_name=row.get("uc_full_name"),
            new_comment=row.get("new_comment"),
            new_uc_tags=_jl(row.get("new_uc_tags_json")),
            om_table_fqn=row.get("om_table_fqn"),
            add_om_tags=_jl(row.get("add_om_tags_json")),
            add_om_glossary_terms=_jl(row.get("add_om_glossary_terms_json")),
            reviewed_at=str(row.get("reviewed_at")) if row.get("reviewed_at") else None,
            reviewed_by=row.get("reviewed_by"),
            review_note=row.get("review_note"),
        )

    def set_request_status(
        self,
        request_id: str,
        status: str,
        reviewed_by: str,
        review_note: str | None = None,
    ) -> None:
        ts = _utc_now_ts()
        self.uc.execute(f"""UPDATE {self._fq("change_requests")}
SET status      = {sql_literal(status)},
    reviewed_at = timestamp({sql_literal(ts)}),
    reviewed_by = {sql_literal(reviewed_by)},
    review_note = {sql_literal(review_note) if review_note else "NULL"}
WHERE request_id = {sql_literal(request_id)}""")
