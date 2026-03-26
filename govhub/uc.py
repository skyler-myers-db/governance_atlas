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


def _is_skippable_metadata_error(exc: Exception) -> bool:
    message = str(exc or "").upper()
    if not message:
        return False
    markers = {
        "TABLE_OR_VIEW_NOT_FOUND",
        "SCHEMA_NOT_FOUND",
        "CATALOG_NOT_FOUND",
        "INSUFFICIENT_PERMISSIONS",
        "USE CATALOG",
        "PERMISSION_DENIED",
        "INSUFFICIENT_PRIVILEGES",
        "UNAUTHORIZED",
        "ACCESS_DENIED",
        "OBJECT_NOT_FOUND",
    }
    return any(marker in message for marker in markers)


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

    def list_lineage_catalogs(self) -> pd.DataFrame:
        query = """
SELECT DISTINCT catalog
FROM (
    SELECT CAST(source_table_catalog AS STRING) AS catalog
    FROM system.access.table_lineage
    WHERE source_table_catalog IS NOT NULL
    UNION ALL
    SELECT CAST(target_table_catalog AS STRING) AS catalog
    FROM system.access.table_lineage
    WHERE target_table_catalog IS NOT NULL
)
WHERE catalog IS NOT NULL
ORDER BY catalog
"""
        return self.query_df(query)

    def list_schemas(self, catalog: str) -> pd.DataFrame:
        return self.query_df(f"SHOW SCHEMAS IN {quote_ident(catalog)}")

    def list_tables(self, catalog: str, schema: str) -> pd.DataFrame:
        return self.query_df(
            f"SHOW TABLES IN {quote_ident(catalog)}.{quote_ident(schema)}"
        )

    def get_catalog_table_inventory(self, catalog: str) -> pd.DataFrame:
        q_with_format = f"""SELECT
    table_schema,
    table_name,
    table_type,
    data_source_format,
    comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema <> 'information_schema'
ORDER BY table_schema, table_name"""
        q = f"""SELECT
    table_schema,
    table_name,
    table_type,
    comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema <> 'information_schema'
ORDER BY table_schema, table_name"""
        try:
            try:
                df = self.query_df(q_with_format)
            except Exception:
                df = self.query_df(q)
        except Exception as exc:
            if not _is_skippable_metadata_error(exc):
                raise
            return pd.DataFrame(
                columns=[
                    "table_catalog",
                    "table_schema",
                    "table_name",
                    "table_type",
                    "data_source_format",
                    "comment",
                ]
            )
        if df.empty:
            return pd.DataFrame(
                columns=[
                    "table_catalog",
                    "table_schema",
                    "table_name",
                    "table_type",
                    "data_source_format",
                    "comment",
                ]
            )
        df = df.copy()
        if "data_source_format" not in df.columns:
            df["data_source_format"] = ""
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

    def get_table_identity(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        q_with_format = f"""SELECT
    table_catalog,
    table_schema,
    table_name,
    table_type,
    data_source_format,
    comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
LIMIT 1"""
        q = f"""SELECT
    table_catalog,
    table_schema,
    table_name,
    table_type,
    comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
LIMIT 1"""
        try:
            try:
                df = self.query_df(q_with_format)
            except Exception:
                df = self.query_df(q)
        except Exception:
            return pd.DataFrame(
                columns=[
                    "table_catalog",
                    "table_schema",
                    "table_name",
                    "table_type",
                    "data_source_format",
                    "comment",
                ]
            )
        if df.empty:
            return pd.DataFrame(
                columns=[
                    "table_catalog",
                    "table_schema",
                    "table_name",
                    "table_type",
                    "data_source_format",
                    "comment",
                ]
            )
        df = df.copy()
        if "table_catalog" not in df.columns:
            df.insert(0, "table_catalog", catalog)
        if "data_source_format" not in df.columns:
            df["data_source_format"] = ""
        return df.head(1)

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

    def get_table_detail(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        full = quote_uc_3part(catalog, schema, table)
        try:
            return self.query_df(f"DESCRIBE DETAIL {full}")
        except Exception:
            return pd.DataFrame()

    def get_table_row_count(self, catalog: str, schema: str, table: str) -> Any:
        full = quote_uc_3part(catalog, schema, table)
        try:
            df = self.query_df(f"SELECT COUNT(*) AS row_count FROM {full}")
        except Exception:
            return None
        if df.empty or "row_count" not in df.columns:
            return None
        return df.iloc[0]["row_count"]

    def get_table_properties(
        self, catalog: str, schema: str, table: str
    ) -> pd.DataFrame:
        full = quote_uc_3part(catalog, schema, table)
        try:
            return self.query_df(f"SHOW TBLPROPERTIES {full}")
        except Exception:
            return pd.DataFrame(columns=["key", "value"])

    def get_table_constraints(
        self, catalog: str, schema: str, table: str
    ) -> pd.DataFrame:
        q = f"""SELECT
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    rc.unique_constraint_name,
    rc.match_option,
    rc.update_rule,
    rc.delete_rule
FROM {quote_ident(catalog)}.information_schema.table_constraints tc
LEFT JOIN {quote_ident(catalog)}.information_schema.key_column_usage kcu
  ON tc.constraint_catalog = kcu.constraint_catalog
 AND tc.constraint_schema  = kcu.constraint_schema
 AND tc.constraint_name    = kcu.constraint_name
 AND tc.table_catalog      = kcu.table_catalog
 AND tc.table_schema       = kcu.table_schema
 AND tc.table_name         = kcu.table_name
LEFT JOIN {quote_ident(catalog)}.information_schema.referential_constraints rc
  ON tc.constraint_catalog = rc.constraint_catalog
 AND tc.constraint_schema  = rc.constraint_schema
 AND tc.constraint_name    = rc.constraint_name
WHERE tc.table_schema = {sql_literal(schema)}
  AND tc.table_name   = {sql_literal(table)}
ORDER BY tc.constraint_name, kcu.ordinal_position"""
        try:
            return self.query_df(q)
        except Exception:
            return pd.DataFrame(
                columns=[
                    "constraint_name",
                    "constraint_type",
                    "column_name",
                    "unique_constraint_name",
                    "match_option",
                    "update_rule",
                    "delete_rule",
                ]
            )

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

    def list_workspace_principals(self) -> pd.DataFrame:
        rows: List[Dict[str, str]] = []
        try:
            for user in self.w.users.list():
                email = _get(user, "user_name") or _get(user, "emails", "value")
                display = _get(user, "display_name") or email
                if email:
                    rows.append(
                        {
                            "email": str(email),
                            "display_name": str(display or email),
                            "principal_type": "user",
                        }
                    )
        except Exception:
            pass
        try:
            for sp in self.w.service_principals.list():
                app_id = _get(sp, "application_id") or _get(sp, "id")
                display = _get(sp, "display_name") or app_id
                if app_id:
                    rows.append(
                        {
                            "email": str(app_id),
                            "display_name": str(display or app_id),
                            "principal_type": "service_principal",
                        }
                    )
        except Exception:
            pass
        if not rows:
            return pd.DataFrame(
                columns=["email", "display_name", "principal_type"]
            )
        return (
            pd.DataFrame(rows)
            .drop_duplicates(subset=["email"])
            .sort_values(["display_name", "email"])
            .reset_index(drop=True)
        )

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

    def _empty_operational_context_df(self) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "related_table_full_name",
                "related_table_catalog",
                "related_table_schema",
                "related_table_name",
                "related_type",
                "entity_type",
                "entity_id",
                "entity_run_id",
                "statement_id",
                "entity_metadata",
            ]
        )

    def get_operational_context_upstream(
        self, catalog: str, schema: str, table: str, limit: int = 200
    ) -> pd.DataFrame:
        """Operational context for workloads that produced this table.

        This stays live-first and queries the same Unity Catalog lineage plane the app
        already uses for table and column lineage. When richer workload fields are not
        available in a workspace, return an empty frame instead of failing the page.
        """
        queries = [
            f"""
SELECT
    source_table_full_name AS related_table_full_name,
    source_table_catalog   AS related_table_catalog,
    source_table_schema    AS related_table_schema,
    source_table_name      AS related_table_name,
    source_type            AS related_type,
    CAST(entity_type AS STRING)      AS entity_type,
    CAST(entity_id AS STRING)        AS entity_id,
    CAST(entity_run_id AS STRING)    AS entity_run_id,
    CAST(statement_id AS STRING)     AS statement_id,
    CAST(entity_metadata AS STRING)  AS entity_metadata
FROM system.access.table_lineage
WHERE target_table_catalog = {sql_literal(catalog)}
  AND target_table_schema  = {sql_literal(schema)}
  AND target_table_name    = {sql_literal(table)}
  AND source_table_name IS NOT NULL
  AND entity_type IS NOT NULL
GROUP BY ALL
ORDER BY entity_type, statement_id, entity_id, entity_run_id, related_table_full_name
LIMIT {int(limit)}
""",
            f"""
SELECT
    source_table_full_name AS related_table_full_name,
    source_table_catalog   AS related_table_catalog,
    source_table_schema    AS related_table_schema,
    source_table_name      AS related_table_name,
    source_type            AS related_type,
    CAST(entity_type AS STRING)      AS entity_type,
    CAST(entity_id AS STRING)        AS entity_id,
    CAST(entity_run_id AS STRING)    AS entity_run_id,
    CAST(statement_id AS STRING)     AS statement_id,
    '' AS entity_metadata
FROM system.access.table_lineage
WHERE target_table_catalog = {sql_literal(catalog)}
  AND target_table_schema  = {sql_literal(schema)}
  AND target_table_name    = {sql_literal(table)}
  AND source_table_name IS NOT NULL
  AND entity_type IS NOT NULL
GROUP BY ALL
ORDER BY entity_type, statement_id, entity_id, entity_run_id, related_table_full_name
LIMIT {int(limit)}
""",
        ]
        for query in queries:
            try:
                return self.query_df(query)
            except Exception:
                continue
        return self._empty_operational_context_df()

    def get_operational_context_downstream(
        self, catalog: str, schema: str, table: str, limit: int = 200
    ) -> pd.DataFrame:
        """Operational context for workloads that consume this table downstream."""
        queries = [
            f"""
SELECT
    target_table_full_name AS related_table_full_name,
    target_table_catalog   AS related_table_catalog,
    target_table_schema    AS related_table_schema,
    target_table_name      AS related_table_name,
    target_type            AS related_type,
    CAST(entity_type AS STRING)      AS entity_type,
    CAST(entity_id AS STRING)        AS entity_id,
    CAST(entity_run_id AS STRING)    AS entity_run_id,
    CAST(statement_id AS STRING)     AS statement_id,
    CAST(entity_metadata AS STRING)  AS entity_metadata
FROM system.access.table_lineage
WHERE source_table_catalog = {sql_literal(catalog)}
  AND source_table_schema  = {sql_literal(schema)}
  AND source_table_name    = {sql_literal(table)}
  AND target_table_name IS NOT NULL
  AND entity_type IS NOT NULL
GROUP BY ALL
ORDER BY entity_type, statement_id, entity_id, entity_run_id, related_table_full_name
LIMIT {int(limit)}
""",
            f"""
SELECT
    target_table_full_name AS related_table_full_name,
    target_table_catalog   AS related_table_catalog,
    target_table_schema    AS related_table_schema,
    target_table_name      AS related_table_name,
    target_type            AS related_type,
    CAST(entity_type AS STRING)      AS entity_type,
    CAST(entity_id AS STRING)        AS entity_id,
    CAST(entity_run_id AS STRING)    AS entity_run_id,
    CAST(statement_id AS STRING)     AS statement_id,
    '' AS entity_metadata
FROM system.access.table_lineage
WHERE source_table_catalog = {sql_literal(catalog)}
  AND source_table_schema  = {sql_literal(schema)}
  AND source_table_name    = {sql_literal(table)}
  AND target_table_name IS NOT NULL
  AND entity_type IS NOT NULL
GROUP BY ALL
ORDER BY entity_type, statement_id, entity_id, entity_run_id, related_table_full_name
LIMIT {int(limit)}
""",
        ]
        for query in queries:
            try:
                return self.query_df(query)
            except Exception:
                continue
        return self._empty_operational_context_df()

    def resolve_operational_entity_name(self, entity_type: str, entity_id: str) -> str:
        entity_type_n = (
            str(entity_type or "").strip().upper().replace(" ", "_").replace("-", "_")
        )
        entity_id_n = str(entity_id or "").strip()
        if not entity_type_n or not entity_id_n:
            return ""

        try:
            if entity_type_n in {"JOB", "WORKFLOW"}:
                job_ref = int(entity_id_n) if entity_id_n.isdigit() else entity_id_n
                response = self.w.jobs.get(job_ref)
                return str(
                    _get(response, "settings", "name")
                    or _get(response, "settings", "job_name")
                    or ""
                ).strip()

            if entity_type_n in {"PIPELINE", "DLT_PIPELINE", "LAKEFLOW_PIPELINE"}:
                response = self.w.pipelines.get(entity_id_n)
                return str(
                    _get(response, "name")
                    or _get(response, "spec", "name")
                    or ""
                ).strip()

            if entity_type_n in {
                "SQL",
                "DBSQL_QUERY",
                "SQL_QUERY",
                "QUERY",
            }:
                response = self.w.queries.get(entity_id_n)
                return str(
                    _get(response, "display_name")
                    or _get(response, "name")
                    or ""
                ).strip()

            if entity_type_n in {"DASHBOARD", "DBSQL_DASHBOARD"}:
                response = self.w.dashboards.get(entity_id_n)
                return str(
                    _get(response, "display_name")
                    or _get(response, "name")
                    or _get(response, "title")
                    or ""
                ).strip()
        except Exception:
            return ""

        return ""

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
