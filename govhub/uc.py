from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import pandas as pd
from databricks.sdk import WorkspaceClient

from .util import quote_ident, quote_uc_3part, sql_literal


def _get(obj: Any, *path: str) -> Any:
    cur = obj
    for p in path:
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            cur = getattr(cur, p, None)
    return cur


class UCSQLClient:
    """Run SQL via Statement Execution API against a Databricks SQL Warehouse."""

    def __init__(self, warehouse_id: str):
        self.warehouse_id = warehouse_id
        self.w = WorkspaceClient()

    # ── low-level execution ─────────────────────────────────

    def execute(
        self,
        statement: str,
        catalog: str | None = None,
        schema: str | None = None,
        timeout_s: int = 30,
    ) -> None:
        _ = self.query_df(
            statement, catalog=catalog, schema=schema, timeout_s=timeout_s
        )

    def query_df(
        self,
        statement: str,
        catalog: str | None = None,
        schema: str | None = None,
        timeout_s: int = 30,
    ) -> pd.DataFrame:
        resp = self.w.statement_execution.execute_statement(
            warehouse_id=self.warehouse_id,
            statement=statement,
            catalog=catalog,
            schema=schema,
            wait_timeout=f"{timeout_s}s",
        )

        statement_id = _get(resp, "statement_id") or _get(resp, "statementId")
        state = (_get(resp, "status", "state") or "").upper()

        poll_deadline = time.time() + timeout_s
        while (
            state in {"PENDING", "RUNNING"}
            and statement_id
            and time.time() < poll_deadline
        ):
            time.sleep(0.5)
            resp = self.w.statement_execution.get_statement(statement_id)
            state = (_get(resp, "status", "state") or "").upper()

        if state == "FAILED":
            raise RuntimeError(
                _get(resp, "status", "error", "message") or "Statement failed"
            )
        if state == "CANCELED":
            raise RuntimeError("Statement was canceled")

        manifest = _get(resp, "manifest")
        result = _get(resp, "result")
        data_array = _get(result, "data_array") or _get(result, "dataArray")
        columns = _get(manifest, "schema", "columns")

        if data_array is None and statement_id:
            try:
                result_resp = self.w.statement_execution.get_statement_result(
                    statement_id
                )
                data_array = _get(result_resp, "result", "data_array") or _get(
                    result_resp, "result", "dataArray"
                )
                if columns is None:
                    columns = _get(_get(result_resp, "manifest"), "schema", "columns")
            except Exception:
                data_array = None

        if not columns or data_array is None:
            return pd.DataFrame()

        col_names = [_get(c, "name") or str(c) for c in columns]
        return pd.DataFrame(data_array, columns=col_names)

    # ── UC metadata helpers ─────────────────────────────────

    def list_catalogs(self) -> pd.DataFrame:
        return self.query_df("SHOW CATALOGS")

    def list_schemas(self, catalog: str) -> pd.DataFrame:
        return self.query_df(f"SHOW SCHEMAS IN {quote_ident(catalog)}")

    def list_tables(self, catalog: str, schema: str) -> pd.DataFrame:
        return self.query_df(
            f"SHOW TABLES IN {quote_ident(catalog)}.{quote_ident(schema)}"
        )

    def get_table_comment(self, catalog: str, schema: str, table: str) -> str:
        q = f"""SELECT comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
LIMIT 1"""
        df = self.query_df(q)
        if df.empty:
            return ""
        return str(df.iloc[0]["comment"] or "")

    def get_table_columns(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        q = f"""SELECT ordinal_position, column_name, data_type, comment
FROM {quote_ident(catalog)}.information_schema.columns
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
ORDER BY ordinal_position"""
        return self.query_df(q)

    def get_table_tags(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        q = f"""SELECT tag_name, tag_value
FROM {quote_ident(catalog)}.information_schema.table_tags
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
ORDER BY tag_name"""
        try:
            return self.query_df(q)
        except Exception:
            return pd.DataFrame(columns=["tag_name", "tag_value"])

    def set_table_comment(
        self, catalog: str, schema: str, table: str, comment: str
    ) -> None:
        full = quote_uc_3part(catalog, schema, table)
        self.execute(f"COMMENT ON TABLE {full} IS {sql_literal(comment)}")

    def set_table_tags(
        self, catalog: str, schema: str, table: str, tags: Dict[str, str]
    ) -> None:
        if not tags:
            return
        full = quote_uc_3part(catalog, schema, table)
        parts = ", ".join(
            f"{quote_ident(k)} = {sql_literal(v)}" for k, v in tags.items()
        )
        self.execute(f"ALTER TABLE {full} SET TAGS ({parts})")

    def unset_table_tags(
        self, catalog: str, schema: str, table: str, tag_keys: List[str]
    ) -> None:
        if not tag_keys:
            return
        full = quote_uc_3part(catalog, schema, table)
        parts = ", ".join(quote_ident(k) for k in tag_keys)
        self.execute(f"ALTER TABLE {full} UNSET TAGS ({parts})")

    # ── Lineage from UC system tables ───────────────────────

    def get_table_lineage_upstream(
        self, catalog: str, schema: str, table: str, limit: int = 50
    ) -> pd.DataFrame:
        """Upstream lineage: what tables feed INTO this table."""
        q = f"""
SELECT
    source_table_catalog,
    source_table_schema,
    source_table_name,
    source_type,
    event_time
FROM system.access.table_lineage
WHERE target_table_catalog = {sql_literal(catalog)}
  AND target_table_schema  = {sql_literal(schema)}
  AND target_table_name    = {sql_literal(table)}
ORDER BY event_time DESC
LIMIT {int(limit)}
"""
        try:
            return self.query_df(q)
        except Exception:
            return pd.DataFrame(
                columns=[
                    "source_table_catalog",
                    "source_table_schema",
                    "source_table_name",
                    "source_type",
                    "event_time",
                ]
            )

    def get_table_lineage_downstream(
        self, catalog: str, schema: str, table: str, limit: int = 50
    ) -> pd.DataFrame:
        """Downstream lineage: what tables does this table feed."""
        q = f"""
SELECT
    target_table_catalog,
    target_table_schema,
    target_table_name,
    target_type,
    event_time
FROM system.access.table_lineage
WHERE source_table_catalog = {sql_literal(catalog)}
  AND source_table_schema  = {sql_literal(schema)}
  AND source_table_name    = {sql_literal(table)}
ORDER BY event_time DESC
LIMIT {int(limit)}
"""
        try:
            return self.query_df(q)
        except Exception:
            return pd.DataFrame(
                columns=[
                    "target_table_catalog",
                    "target_table_schema",
                    "target_table_name",
                    "target_type",
                    "event_time",
                ]
            )

    def get_column_lineage(
        self, catalog: str, schema: str, table: str, limit: int = 100
    ) -> pd.DataFrame:
        """Column-level lineage for a table (both directions)."""
        q = f"""
SELECT
    source_table_catalog, source_table_schema, source_table_name,
    source_column_name,
    target_table_catalog, target_table_schema, target_table_name,
    target_column_name,
    event_time
FROM system.access.column_lineage
WHERE (
        target_table_catalog = {sql_literal(catalog)}
    AND target_table_schema  = {sql_literal(schema)}
    AND target_table_name    = {sql_literal(table)}
  ) OR (
        source_table_catalog = {sql_literal(catalog)}
    AND source_table_schema  = {sql_literal(schema)}
    AND source_table_name    = {sql_literal(table)}
  )
ORDER BY event_time DESC
LIMIT {int(limit)}
"""
        try:
            return self.query_df(q)
        except Exception:
            return pd.DataFrame(
                columns=[
                    "source_table_catalog",
                    "source_table_schema",
                    "source_table_name",
                    "source_column_name",
                    "target_table_catalog",
                    "target_table_schema",
                    "target_table_name",
                    "target_column_name",
                    "event_time",
                ]
            )
