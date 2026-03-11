from __future__ import annotations

import time
from typing import Any, Dict, List

import pandas as pd
from databricks.sdk import WorkspaceClient

from .util import quote_ident, quote_uc_3part, sql_literal


def _get(obj: Any, *path: str) -> Any:
    """Navigate nested SDK typed objects or dicts by attribute/key path."""
    cur = obj
    for p in path:
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            cur = getattr(cur, p, None)
    return cur


def _state_str(raw: Any) -> str:
    """Convert a StatementState enum (or plain string) to an uppercase string.

    The Databricks SDK returns ``StatementState`` enum members from
    ``resp.status.state``.  Enum members are truthy, don't have ``.upper()``,
    and ``str()`` gives ``'StatementState.SUCCEEDED'``.  Using ``.value``
    gives the raw ``'SUCCEEDED'`` string.
    """
    if raw is None:
        return ""
    if hasattr(raw, "value"):  # SDK enum
        return str(raw.value).upper()
    return str(raw).upper()


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

        statement_id = _get(resp, "statement_id")
        state = _state_str(_get(resp, "status", "state"))

        # Server-side wait_timeout usually returns SUCCEEDED already, but
        # poll as a safety net for long-running DDL statements.
        poll_deadline = time.time() + timeout_s
        while (
            state in {"PENDING", "RUNNING"}
            and statement_id
            and time.time() < poll_deadline
        ):
            time.sleep(0.5)
            resp = self.w.statement_execution.get_statement(statement_id)
            state = _state_str(_get(resp, "status", "state"))

        if state == "FAILED":
            raise RuntimeError(
                _get(resp, "status", "error", "message") or "Statement failed"
            )
        if state in {"CANCELED", "CLOSED"}:
            raise RuntimeError(f"Statement was {state.lower()}")

        # Extract column metadata + row data from the typed SDK response.
        manifest = _get(resp, "manifest")
        result = _get(resp, "result")
        data_array = _get(result, "data_array")
        columns = _get(manifest, "schema", "columns")

        # If the result wasn't inlined (rare for small payloads), re-fetch.
        if data_array is None and statement_id:
            try:
                resp = self.w.statement_execution.get_statement(statement_id)
                data_array = _get(resp, "result", "data_array")
                if columns is None:
                    columns = _get(resp, "manifest", "schema", "columns")
            except Exception:
                data_array = None

        if not columns or data_array is None:
            return pd.DataFrame()

        col_names = [_get(c, "name") or f"col_{i}" for i, c in enumerate(columns)]
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

    def get_catalog_table_inventory(self, catalog: str) -> pd.DataFrame:
        q = f"""SELECT
    table_schema,
    table_name,
    table_type,
    comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema <> 'information_schema'
ORDER BY table_schema, table_name"""
        df = self.query_df(q)
        if df.empty:
            return pd.DataFrame(
                columns=["table_catalog", "table_schema", "table_name", "table_type", "comment"]
            )
        df = df.copy()
        df.insert(0, "table_catalog", catalog)
        return df

    def get_catalog_table_tags(self, catalog: str) -> pd.DataFrame:
        q = f"""SELECT
    table_schema,
    table_name,
    tag_name,
    tag_value
FROM {quote_ident(catalog)}.information_schema.table_tags
ORDER BY table_schema, table_name, tag_name"""
        try:
            df = self.query_df(q)
        except Exception:
            return pd.DataFrame(
                columns=["table_catalog", "table_schema", "table_name", "tag_name", "tag_value"]
            )
        if df.empty:
            return pd.DataFrame(
                columns=["table_catalog", "table_schema", "table_name", "tag_name", "tag_value"]
            )
        df = df.copy()
        df.insert(0, "table_catalog", catalog)
        return df

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
    source_table_full_name,
    source_table_catalog,
    source_table_schema,
    source_table_name,
    source_type
FROM system.access.table_lineage
WHERE target_table_catalog = {sql_literal(catalog)}
  AND target_table_schema  = {sql_literal(schema)}
  AND target_table_name    = {sql_literal(table)}
  AND source_table_name IS NOT NULL
GROUP BY ALL
ORDER BY source_table_full_name
LIMIT {int(limit)}
"""
        return self.query_df(q)

    def get_table_lineage_downstream(
        self, catalog: str, schema: str, table: str, limit: int = 50
    ) -> pd.DataFrame:
        """Downstream lineage: what tables does this table feed."""
        q = f"""
SELECT
    target_table_full_name,
    target_table_catalog,
    target_table_schema,
    target_table_name,
    target_type
FROM system.access.table_lineage
WHERE source_table_catalog = {sql_literal(catalog)}
  AND source_table_schema  = {sql_literal(schema)}
  AND source_table_name    = {sql_literal(table)}
  AND target_table_name IS NOT NULL
GROUP BY ALL
ORDER BY target_table_full_name
LIMIT {int(limit)}
"""
        return self.query_df(q)

    def get_column_lineage_upstream(
        self, catalog: str, schema: str, table: str, limit: int = 500
    ) -> pd.DataFrame:
        """Column-level upstream: which source columns feed into this table's columns."""
        q = f"""
SELECT
    source_table_full_name,
    source_column_name,
    target_column_name
FROM system.access.column_lineage
WHERE target_table_catalog = {sql_literal(catalog)}
  AND target_table_schema  = {sql_literal(schema)}
  AND target_table_name    = {sql_literal(table)}
  AND source_table_full_name IS NOT NULL
  AND source_column_name IS NOT NULL
  AND target_column_name IS NOT NULL
  AND LEFT(source_column_name, 1) <> '_'
  AND LEFT(target_column_name, 1) <> '_'
GROUP BY ALL
ORDER BY target_column_name, source_table_full_name, source_column_name
LIMIT {int(limit)}
"""
        return self.query_df(q)

    def get_column_lineage_downstream(
        self, catalog: str, schema: str, table: str, limit: int = 500
    ) -> pd.DataFrame:
        """Column-level downstream: which target columns are fed by this table's columns."""
        q = f"""
SELECT
    source_column_name,
    target_table_full_name,
    target_column_name
FROM system.access.column_lineage
WHERE source_table_catalog = {sql_literal(catalog)}
  AND source_table_schema  = {sql_literal(schema)}
  AND source_table_name    = {sql_literal(table)}
  AND target_table_full_name IS NOT NULL
  AND source_column_name IS NOT NULL
  AND target_column_name IS NOT NULL
  AND LEFT(source_column_name, 1) <> '_'
  AND LEFT(target_column_name, 1) <> '_'
GROUP BY ALL
ORDER BY source_column_name, target_table_full_name, target_column_name
LIMIT {int(limit)}
"""
        return self.query_df(q)

    # ── Column-level metadata ───────────────────────────────

    def set_column_comment(
        self, catalog: str, schema: str, table: str, column: str, comment: str
    ) -> None:
        full = quote_uc_3part(catalog, schema, table)
        self.execute(
            f"ALTER TABLE {full} ALTER COLUMN {quote_ident(column)} "
            f"COMMENT {sql_literal(comment)}"
        )

    def get_column_tags(
        self, catalog: str, schema: str, table: str, column: str
    ) -> pd.DataFrame:
        q = f"""SELECT tag_name, tag_value
FROM {quote_ident(catalog)}.information_schema.column_tags
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
  AND column_name  = {sql_literal(column)}
ORDER BY tag_name"""
        try:
            return self.query_df(q)
        except Exception:
            return pd.DataFrame(columns=["tag_name", "tag_value"])

    def set_column_tags(
        self, catalog: str, schema: str, table: str, column: str,
        tags: Dict[str, str],
    ) -> None:
        if not tags:
            return
        full = quote_uc_3part(catalog, schema, table)
        parts = ", ".join(
            f"{quote_ident(k)} = {sql_literal(v)}" for k, v in tags.items()
        )
        self.execute(
            f"ALTER TABLE {full} ALTER COLUMN {quote_ident(column)} "
            f"SET TAGS ({parts})"
        )

    def unset_column_tags(
        self, catalog: str, schema: str, table: str, column: str,
        tag_keys: List[str],
    ) -> None:
        if not tag_keys:
            return
        full = quote_uc_3part(catalog, schema, table)
        parts = ", ".join(quote_ident(k) for k in tag_keys)
        self.execute(
            f"ALTER TABLE {full} ALTER COLUMN {quote_ident(column)} "
            f"UNSET TAGS ({parts})"
        )

    def get_table_sample(
        self, catalog: str, schema: str, table: str, limit: int = 20
    ) -> pd.DataFrame:
        full = quote_uc_3part(catalog, schema, table)
        return self.query_df(f"SELECT * FROM {full} LIMIT {int(limit)}")
