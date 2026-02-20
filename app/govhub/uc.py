from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from databricks.sdk import WorkspaceClient

from .util import quote_ident, quote_uc_3part, sql_literal


def _get(obj: Any, *path: str) -> Any:
    """Best-effort getter for databricks-sdk response objects or dicts."""
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
    """Run SQL against a Databricks SQL Warehouse using the Statement Execution API."""

    def __init__(self, warehouse_id: str):
        self.warehouse_id = warehouse_id
        self.w = WorkspaceClient()

    def execute(self, statement: str, catalog: str | None = None, schema: str | None = None, timeout_s: int = 30) -> None:
        # For DDL/DML statements where we don't need results.
        _ = self.query_df(statement, catalog=catalog, schema=schema, timeout_s=timeout_s)

    def query_df(self, statement: str, catalog: str | None = None, schema: str | None = None, timeout_s: int = 30) -> pd.DataFrame:
        resp = self.w.statement_execution.execute_statement(
            warehouse_id=self.warehouse_id,
            statement=statement,
            catalog=catalog,
            schema=schema,
            wait_timeout=f"{timeout_s}s",
        )

        statement_id = _get(resp, "statement_id") or _get(resp, "statementId")
        state = (_get(resp, "status", "state") or "").upper()

        # If results aren't ready yet, poll briefly.
        poll_deadline = time.time() + timeout_s
        while state in {"PENDING", "RUNNING"} and statement_id and time.time() < poll_deadline:
            time.sleep(0.5)
            resp = self.w.statement_execution.get_statement(statement_id)
            state = (_get(resp, "status", "state") or "").upper()

        if state == "FAILED":
            message = _get(resp, "status", "error", "message") or "Statement failed"
            raise RuntimeError(message)

        if state == "CANCELED":
            raise RuntimeError("Statement was canceled")

        # Fetch result (may be inline or via get_statement_result)
        manifest = _get(resp, "manifest")
        result = _get(resp, "result")

        data_array = _get(result, "data_array") or _get(result, "dataArray")
        columns = _get(manifest, "schema", "columns")

        # If no inline data but statement succeeded, try fetching result explicitly.
        if data_array is None and statement_id:
            try:
                result_resp = self.w.statement_execution.get_statement_result(statement_id)
                data_array = _get(result_resp, "result", "data_array") or _get(result_resp, "result", "dataArray")
                if columns is None:
                    manifest2 = _get(result_resp, "manifest")
                    columns = _get(manifest2, "schema", "columns")
            except Exception:
                # Could be a statement with no result set (DDL)
                data_array = None

        if not columns or data_array is None:
            return pd.DataFrame()

        col_names = []
        for c in columns:
            name = _get(c, "name")
            if name is None:
                name = str(c)
            col_names.append(name)

        return pd.DataFrame(data_array, columns=col_names)

    # ---------- Convenience UC metadata helpers ----------

    def list_catalogs(self) -> pd.DataFrame:
        return self.query_df("SHOW CATALOGS")

    def list_schemas(self, catalog: str) -> pd.DataFrame:
        return self.query_df(f"SHOW SCHEMAS IN {quote_ident(catalog)}")

    def list_tables(self, catalog: str, schema: str) -> pd.DataFrame:
        return self.query_df(f"SHOW TABLES IN {quote_ident(catalog)}.{quote_ident(schema)}")

    def get_table_comment(self, catalog: str, schema: str, table: str) -> str:
        q = f"""SELECT comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema = {sql_literal(schema)} AND table_name = {sql_literal(table)}
LIMIT 1"""
        df = self.query_df(q)
        if df.empty:
            return ""
        return str(df.iloc[0]["comment"] or "")

    def get_table_columns(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        q = f"""SELECT ordinal_position, column_name, data_type, comment
FROM {quote_ident(catalog)}.information_schema.columns
WHERE table_schema = {sql_literal(schema)} AND table_name = {sql_literal(table)}
ORDER BY ordinal_position"""
        return self.query_df(q)

    def get_table_tags(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        # Not all workspaces expose information_schema.table_tags; handle gracefully.
        q = f"""SELECT tag_name, tag_value
FROM {quote_ident(catalog)}.information_schema.table_tags
WHERE table_schema = {sql_literal(schema)} AND table_name = {sql_literal(table)}
ORDER BY tag_name"""
        try:
            return self.query_df(q)
        except Exception:
            return pd.DataFrame(columns=["tag_name", "tag_value"])

    def set_table_comment(self, catalog: str, schema: str, table: str, comment: str) -> None:
        full = quote_uc_3part(catalog, schema, table)
        stmt = f"COMMENT ON TABLE {full} IS {sql_literal(comment)}"
        self.execute(stmt)

    def set_table_tags(self, catalog: str, schema: str, table: str, tags: Dict[str, str]) -> None:
        if not tags:
            return
        full = quote_uc_3part(catalog, schema, table)
        parts = ", ".join([f"{quote_ident(k)} = {sql_literal(v)}" for k, v in tags.items()])
        stmt = f"ALTER TABLE {full} SET TAGS ({parts})"
        self.execute(stmt)

    def unset_table_tags(self, catalog: str, schema: str, table: str, tag_keys: List[str]) -> None:
        if not tag_keys:
            return
        full = quote_uc_3part(catalog, schema, table)
        parts = ", ".join([quote_ident(k) for k in tag_keys])
        stmt = f"ALTER TABLE {full} UNSET TAGS ({parts})"
        self.execute(stmt)
