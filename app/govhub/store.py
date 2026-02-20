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
    # Databricks SQL TIMESTAMP literal can use a string.
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
    datahub_dataset_urn: str | None = None
    add_datahub_tag_urns: List[str] | None = None
    add_datahub_term_urns: List[str] | None = None
    reviewed_at: str | None = None
    reviewed_by: str | None = None
    review_note: str | None = None


class GovernanceStore:
    """Stores app state (roles, links, requests) in Unity Catalog tables."""

    def __init__(self, uc: UCSQLClient, catalog: str, schema: str):
        self.uc = uc
        self.catalog = catalog
        self.schema = schema

    @property
    def fq_schema(self) -> str:
        return f"{quote_ident(self.catalog)}.{quote_ident(self.schema)}"

    def _fq_table(self, table: str) -> str:
        return f"{self.fq_schema}.{quote_ident(table)}"

    def ensure_tables(self) -> None:
        # Create schema
        self.uc.execute(f"CREATE SCHEMA IF NOT EXISTS {self.fq_schema}")
        # user_roles
        self.uc.execute(
            f"""CREATE TABLE IF NOT EXISTS {self._fq_table('user_roles')} (
              email STRING NOT NULL,
              role  STRING NOT NULL COMMENT 'reader | writer | admin',
              updated_at TIMESTAMP,
              updated_by STRING
            ) USING DELTA"""
        )
        # asset_links
        self.uc.execute(
            f"""CREATE TABLE IF NOT EXISTS {self._fq_table('asset_links')} (
              uc_full_name STRING NOT NULL COMMENT 'catalog.schema.table',
              datahub_urn   STRING NOT NULL,
              updated_at    TIMESTAMP,
              updated_by    STRING
            ) USING DELTA"""
        )
        # change_requests
        self.uc.execute(
            f"""CREATE TABLE IF NOT EXISTS {self._fq_table('change_requests')} (
              request_id STRING NOT NULL,
              created_at TIMESTAMP,
              created_by STRING,
              status     STRING COMMENT 'pending | approved | rejected',

              uc_full_name STRING COMMENT 'catalog.schema.table',
              new_comment  STRING,
              new_uc_tags_json STRING COMMENT 'JSON map of {{tag_key: tag_value}}',

              datahub_dataset_urn STRING,
              add_datahub_tag_urns_json  STRING COMMENT 'JSON list of tag URNs',
              add_datahub_term_urns_json STRING COMMENT 'JSON list of glossary term URNs',

              reviewed_at TIMESTAMP,
              reviewed_by STRING,
              review_note STRING
            ) USING DELTA"""
        )

    # ---------------- Roles ----------------

    def get_role(self, email: str, admin_emails: List[str] | None = None) -> str:
        admin_emails = admin_emails or []
        e = email.strip().lower()
        q = f"SELECT role FROM {self._fq_table('user_roles')} WHERE lower(email) = {sql_literal(e)} LIMIT 1"
        df = self.uc.query_df(q)
        if not df.empty and df.iloc[0].get("role"):
            return str(df.iloc[0]["role"]).lower()

        # Bootstrap: if user is listed as admin in env var, upsert them as admin.
        if e and any(e == a.strip().lower() for a in admin_emails):
            self.upsert_role(email=e, role="admin", updated_by=e)
            return "admin"
        return "reader"

    def list_roles(self) -> pd.DataFrame:
        return self.uc.query_df(f"SELECT email, role, updated_at, updated_by FROM {self._fq_table('user_roles')} ORDER BY lower(email)")

    def upsert_role(self, email: str, role: str, updated_by: str) -> None:
        e = email.strip().lower()
        r = role.strip().lower()
        u = updated_by.strip().lower()
        ts = _utc_now_ts()
        # Use MERGE for idempotent upsert.
        stmt = f"""MERGE INTO {self._fq_table('user_roles')} t
USING (SELECT {sql_literal(e)} AS email, {sql_literal(r)} AS role, timestamp({sql_literal(ts)}) AS updated_at, {sql_literal(u)} AS updated_by) s
ON lower(t.email) = lower(s.email)
WHEN MATCHED THEN UPDATE SET role = s.role, updated_at = s.updated_at, updated_by = s.updated_by
WHEN NOT MATCHED THEN INSERT (email, role, updated_at, updated_by) VALUES (s.email, s.role, s.updated_at, s.updated_by)
"""
        self.uc.execute(stmt)

    # ---------------- Asset links ----------------

    def get_datahub_urn_for_uc(self, uc_full_name: str) -> Optional[str]:
        q = f"SELECT datahub_urn FROM {self._fq_table('asset_links')} WHERE uc_full_name = {sql_literal(uc_full_name)} LIMIT 1"
        df = self.uc.query_df(q)
        if df.empty:
            return None
        return str(df.iloc[0]["datahub_urn"])

    def upsert_asset_link(self, uc_full_name: str, datahub_urn: str, updated_by: str) -> None:
        ts = _utc_now_ts()
        stmt = f"""MERGE INTO {self._fq_table('asset_links')} t
USING (SELECT {sql_literal(uc_full_name)} AS uc_full_name, {sql_literal(datahub_urn)} AS datahub_urn, timestamp({sql_literal(ts)}) AS updated_at, {sql_literal(updated_by)} AS updated_by) s
ON t.uc_full_name = s.uc_full_name
WHEN MATCHED THEN UPDATE SET datahub_urn = s.datahub_urn, updated_at = s.updated_at, updated_by = s.updated_by
WHEN NOT MATCHED THEN INSERT (uc_full_name, datahub_urn, updated_at, updated_by) VALUES (s.uc_full_name, s.datahub_urn, s.updated_at, s.updated_by)
"""
        self.uc.execute(stmt)

    def list_asset_links(self) -> pd.DataFrame:
        return self.uc.query_df(f"SELECT uc_full_name, datahub_urn, updated_at, updated_by FROM {self._fq_table('asset_links')} ORDER BY uc_full_name")

    # ---------------- Change Requests ----------------

    def create_change_request(
        self,
        created_by: str,
        uc_full_name: str | None = None,
        new_comment: str | None = None,
        new_uc_tags: Dict[str, str] | None = None,
        datahub_dataset_urn: str | None = None,
        add_datahub_tag_urns: List[str] | None = None,
        add_datahub_term_urns: List[str] | None = None,
    ) -> str:
        request_id = uuid.uuid4().hex
        ts = _utc_now_ts()

        stmt = f"""INSERT INTO {self._fq_table('change_requests')} (
  request_id, created_at, created_by, status,
  uc_full_name, new_comment, new_uc_tags_json,
  datahub_dataset_urn, add_datahub_tag_urns_json, add_datahub_term_urns_json,
  reviewed_at, reviewed_by, review_note
) VALUES (
  {sql_literal(request_id)}, timestamp({sql_literal(ts)}), {sql_literal(created_by)}, 'pending',
  {sql_literal(uc_full_name) if uc_full_name else 'NULL'},
  {sql_literal(new_comment) if new_comment else 'NULL'},
  {sql_literal(json.dumps(new_uc_tags)) if new_uc_tags else 'NULL'},
  {sql_literal(datahub_dataset_urn) if datahub_dataset_urn else 'NULL'},
  {sql_literal(json.dumps(add_datahub_tag_urns)) if add_datahub_tag_urns else 'NULL'},
  {sql_literal(json.dumps(add_datahub_term_urns)) if add_datahub_term_urns else 'NULL'},
  NULL, NULL, NULL
)"""
        self.uc.execute(stmt)
        return request_id

    def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
        where = ""
        if status:
            where = f"WHERE status = {sql_literal(status)}"
        q = f"""SELECT *
FROM {self._fq_table('change_requests')}
{where}
ORDER BY created_at DESC
LIMIT {int(limit)}"""
        return self.uc.query_df(q)

    def get_change_request(self, request_id: str) -> Optional[ChangeRequest]:
        q = f"SELECT * FROM {self._fq_table('change_requests')} WHERE request_id = {sql_literal(request_id)} LIMIT 1"
        df = self.uc.query_df(q)
        if df.empty:
            return None
        row = df.iloc[0].to_dict()
        def _json_load(v):
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
            new_uc_tags=_json_load(row.get("new_uc_tags_json")),
            datahub_dataset_urn=row.get("datahub_dataset_urn"),
            add_datahub_tag_urns=_json_load(row.get("add_datahub_tag_urns_json")),
            add_datahub_term_urns=_json_load(row.get("add_datahub_term_urns_json")),
            reviewed_at=str(row.get("reviewed_at")) if row.get("reviewed_at") else None,
            reviewed_by=row.get("reviewed_by"),
            review_note=row.get("review_note"),
        )

    def set_request_status(self, request_id: str, status: str, reviewed_by: str, review_note: str | None = None) -> None:
        ts = _utc_now_ts()
        stmt = f"""UPDATE {self._fq_table('change_requests')}
SET status = {sql_literal(status)},
    reviewed_at = timestamp({sql_literal(ts)}),
    reviewed_by = {sql_literal(reviewed_by)},
    review_note = {sql_literal(review_note) if review_note else 'NULL'}
WHERE request_id = {sql_literal(request_id)}"""
        self.uc.execute(stmt)
