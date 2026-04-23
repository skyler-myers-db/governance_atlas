from __future__ import annotations

import os
import time
from typing import TYPE_CHECKING, Any, Dict, List, Tuple

import pandas as pd

from .util import quote_ident, quote_uc_3part, sql_literal

if TYPE_CHECKING:
    from databricks.sdk import WorkspaceClient
else:
    WorkspaceClient = Any


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


def is_missing_sql_scope_error(exc: Exception | None) -> bool:
    """Return True when the Databricks platform rejected the request because
    the calling token is missing the ``sql`` OBO scope.

    The failure surfaces as ``403 Forbidden — Invalid scope, required scopes: sql``
    coming back through the SDK as a parse error (the SDK can't decode the HTML
    error envelope). We match both the raw scope marker and the SDK's
    surfaced text so the signal is resilient across SDK versions.

    Detection matters because this error is recoverable: the user simply
    hasn't re-authorized the app since the ``sql`` scope was added, so the
    request succeeds if we retry on the app-principal client instead. See
    runtime_app.py :class:`_UCWithFallback` for the retry loop.
    """
    if exc is None:
        return False
    text = str(exc)
    if not text:
        return False
    needles = (
        "required scopes: sql",
        "Invalid scope, required scopes: sql",
        "required scopes:sql",
    )
    return any(needle in text for needle in needles)


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _workspace_client_class():
    try:
        from databricks.sdk import WorkspaceClient as workspace_client
    except ImportError as exc:
        raise RuntimeError(
            "databricks-sdk with WorkspaceClient support is required for live Unity Catalog access."
        ) from exc
    return workspace_client


def _safe_error_text(exc: Exception | None) -> str:
    if exc is None:
        return ""
    message = str(exc or "").strip()
    if not message:
        return exc.__class__.__name__
    if message.startswith(f"{exc.__class__.__name__}:"):
        return message
    return f"{exc.__class__.__name__}: {message}"


def _normalize_relation_type(raw: Any) -> str:
    return str(raw or "").strip().upper().replace("_", " ")


def _relation_ddl_keyword(raw: Any) -> str:
    normalized = _normalize_relation_type(raw)
    if normalized in {"VIEW", "METRIC VIEW"}:
        return "VIEW"
    if normalized == "MATERIALIZED VIEW":
        return "MATERIALIZED VIEW"
    if normalized == "STREAMING TABLE":
        return "STREAMING TABLE"
    return "TABLE"


def _relation_tag_target_keyword(raw: Any) -> str:
    return "VIEW" if _relation_ddl_keyword(raw) == "VIEW" else "TABLE"


def _relation_tag_target_keywords(raw: Any) -> List[str]:
    normalized = _normalize_relation_type(raw)
    if normalized in {"VIEW", "METRIC VIEW"}:
        return ["VIEW", "TABLE"]
    if normalized == "MATERIALIZED VIEW":
        return ["MATERIALIZED VIEW", "VIEW", "TABLE"]
    if normalized == "STREAMING TABLE":
        return ["STREAMING TABLE", "TABLE"]
    return ["TABLE", "VIEW"]


def _normalized_columns_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=list(df.columns) if df is not None else [])
    normalized = df.copy()
    rename_map: Dict[str, str] = {}
    for col in normalized.columns:
        lowered = str(col or "").strip().lower()
        if lowered:
            rename_map[col] = lowered
    if rename_map:
        normalized = normalized.rename(columns=rename_map)
    return normalized


def _comment_ddl_keywords(raw: Any) -> List[str]:
    normalized = _normalize_relation_type(raw)
    if normalized in {"VIEW", "METRIC VIEW"}:
        return ["VIEW", "TABLE"]
    if normalized == "MATERIALIZED VIEW":
        return ["MATERIALIZED VIEW", "VIEW", "TABLE"]
    if normalized == "STREAMING TABLE":
        return ["STREAMING TABLE", "TABLE"]
    return ["TABLE", "VIEW"]


class UCSQLClient:
    """Run SQL via Statement Execution API against a Databricks SQL Warehouse."""

    def __init__(self, warehouse_id: str, *, user_access_token: str | None = None):
        self.warehouse_id = warehouse_id
        self._user_access_token = (user_access_token or "").strip() or None
        self._client_context = self._build_client_context()
        self.w = self._build_workspace_client()

    def _build_client_context(self) -> Dict[str, Any]:
        host = _env("DATABRICKS_HOST")
        client_id = _env("DATABRICKS_CLIENT_ID")
        client_secret = _env("DATABRICKS_CLIENT_SECRET")
        auth_type = _env("DATABRICKS_AUTH_TYPE")
        app_name = _env("DATABRICKS_APP_NAME")
        return {
            "authMode": "default",
            "authType": auth_type or "",
            "appName": app_name or "",
            "host": host or "",
            "hostPresent": bool(host),
            "clientIdPresent": bool(client_id),
            "clientSecretPresent": bool(client_secret),
            "warehouseId": self.warehouse_id,
            "workspaceId": _env("DATABRICKS_WORKSPACE_ID"),
            "userAccessTokenPresent": bool(self._user_access_token),
        }

    def _build_workspace_client(self) -> WorkspaceClient:
        workspace_client = _workspace_client_class()
        host = self._client_context["host"]
        client_id = _env("DATABRICKS_CLIENT_ID")
        client_secret = _env("DATABRICKS_CLIENT_SECRET")
        auth_type = self._client_context["authType"] or "oauth-m2m"
        explicit_error = None
        if self._user_access_token and host:
            try:
                client = workspace_client(
                    host=host,
                    token=self._user_access_token,
                    auth_type="pat",
                    product="governance-hub",
                    product_version="governance-hub-runtime-obo",
                )
                self._client_context["authMode"] = "obo-forwarded-token"
                self._client_context["authType"] = "pat"
                return client
            except Exception as exc:
                explicit_error = exc
                self._client_context["authMode"] = "obo-fallback"
                self._client_context["clientInitError"] = _safe_error_text(exc)
        if host and client_id and client_secret:
            try:
                client = workspace_client(
                    host=host,
                    client_id=client_id,
                    client_secret=client_secret,
                    auth_type=auth_type,
                    product="governance-hub",
                    product_version="governance-hub-runtime",
                )
                self._client_context["authMode"] = "oauth-m2m-env"
                self._client_context["authType"] = auth_type
                return client
            except Exception as exc:
                explicit_error = exc
                self._client_context["authMode"] = "default-fallback"
                self._client_context["clientInitError"] = _safe_error_text(exc)
        try:
            client = workspace_client(
                product="governance-hub",
                product_version="governance-hub-runtime",
            )
            if self._client_context["authMode"] == "default":
                self._client_context["authMode"] = "default"
            return client
        except Exception as exc:
            self._client_context["clientInitError"] = _safe_error_text(
                explicit_error or exc
            )
            raise explicit_error or exc

    def runtime_context(self) -> Dict[str, Any]:
        return dict(self._client_context)

    def _empty_table_tag_df(self) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "table_catalog",
                "table_schema",
                "table_name",
                "tag_name",
                "tag_value",
            ]
        )

    def _empty_column_tag_df(self) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "table_catalog",
                "table_schema",
                "table_name",
                "column_name",
                "tag_name",
                "tag_value",
            ]
        )

    def _relation_type(
        self,
        catalog: str,
        schema: str,
        table: str,
        raw_type: str | None = None,
    ) -> str:
        if _normalize_relation_type(raw_type):
            return _normalize_relation_type(raw_type)
        identity_df = self.get_table_identity(catalog, schema, table)
        if identity_df is None or identity_df.empty:
            return ""
        return _normalize_relation_type(identity_df.iloc[0].get("table_type"))

    def _query_first_non_empty(self, queries: List[str]) -> pd.DataFrame:
        for query in queries:
            try:
                df = self.query_df(query)
            except Exception:
                continue
            if df is None or df.empty:
                continue
            return df
        return pd.DataFrame()

    def _execute_first_success(self, statements: List[str]) -> None:
        last_error: Exception | None = None
        for statement in statements:
            try:
                self.execute(statement)
                return
            except Exception as exc:
                last_error = exc
        if last_error is not None:
            raise last_error

    def _normalize_tag_kv_df(self, df: pd.DataFrame) -> pd.DataFrame:
        normalized = _normalized_columns_df(df)
        if normalized.empty:
            return pd.DataFrame(columns=["tag_name", "tag_value"])
        if "tag_name" not in normalized.columns:
            return pd.DataFrame(columns=["tag_name", "tag_value"])
        if "tag_value" not in normalized.columns:
            normalized["tag_value"] = ""
        normalized["tag_name"] = normalized["tag_name"].map(
            lambda value: str(value or "").strip()
        )
        normalized["tag_value"] = normalized["tag_value"].map(
            lambda value: str(value or "").strip()
        )
        normalized = normalized[normalized["tag_name"].ne("")].copy()
        if normalized.empty:
            return pd.DataFrame(columns=["tag_name", "tag_value"])
        normalized = normalized.drop_duplicates(subset=["tag_name"], keep="last")
        return normalized[["tag_name", "tag_value"]].reset_index(drop=True)

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

        if state in {"PENDING", "RUNNING"}:
            raise TimeoutError(
                f"Statement timed out after {timeout_s}s"
                + (f" (statement_id={statement_id})" if statement_id else "")
            )
        if state == "FAILED":
            raise RuntimeError(
                (_get(resp, "status", "error", "message") or "Statement failed")
                + (f" (statement_id={statement_id})" if statement_id else "")
            )
        if state in {"CANCELED", "CLOSED"}:
            raise RuntimeError(
                f"Statement was {state.lower()}"
                + (f" (statement_id={statement_id})" if statement_id else "")
            )

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
    table_catalog,
    table_schema,
    table_name,
    table_type,
    data_source_format,
    comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema <> 'information_schema'
ORDER BY table_schema, table_name"""
        q = f"""SELECT
    table_catalog,
    table_schema,
    table_name,
    table_type,
    comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema <> 'information_schema'
ORDER BY table_schema, table_name"""
        q_system_with_format = f"""SELECT
    table_catalog,
    table_schema,
    table_name,
    table_type,
    data_source_format,
    comment
FROM system.information_schema.tables
WHERE table_catalog = {sql_literal(catalog)}
  AND table_schema <> 'information_schema'
ORDER BY table_schema, table_name"""
        q_system = f"""SELECT
    table_catalog,
    table_schema,
    table_name,
    table_type,
    comment
FROM system.information_schema.tables
WHERE table_catalog = {sql_literal(catalog)}
  AND table_schema <> 'information_schema'
ORDER BY table_schema, table_name"""
        df = pd.DataFrame()
        had_success = False
        last_error: Exception | None = None
        for query in [q_with_format, q, q_system_with_format, q_system]:
            try:
                candidate = self.query_df(query)
            except Exception as exc:
                last_error = exc
                continue
            had_success = True
            if candidate is None or candidate.empty:
                continue
            df = candidate
            break
        if (
            df.empty
            and not had_success
            and last_error is not None
            and not _is_skippable_metadata_error(last_error)
        ):
            raise last_error
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
        df = _normalized_columns_df(df)
        if "table_catalog" not in df.columns:
            df["table_catalog"] = catalog
        if "data_source_format" not in df.columns:
            df["data_source_format"] = ""
        return df[
            [
                "table_catalog",
                "table_schema",
                "table_name",
                "table_type",
                "data_source_format",
                "comment",
            ]
        ].reset_index(drop=True)

    def get_catalog_table_tags(self, catalog: str) -> pd.DataFrame:
        queries = [
            f"""SELECT
    catalog_name AS table_catalog,
    schema_name AS table_schema,
    table_name,
    tag_name,
    tag_value
FROM {quote_ident(catalog)}.information_schema.table_tags
ORDER BY schema_name, table_name, tag_name""",
            f"""SELECT
    catalog_name AS table_catalog,
    schema_name AS table_schema,
    table_name,
    tag_name,
    tag_value
FROM system.information_schema.table_tags
WHERE catalog_name = {sql_literal(catalog)}
ORDER BY schema_name, table_name, tag_name""",
            f"""SELECT
    {sql_literal(catalog)} AS table_catalog,
    table_schema,
    table_name,
    tag_name,
    tag_value
FROM {quote_ident(catalog)}.information_schema.table_tags
ORDER BY table_schema, table_name, tag_name""",
        ]
        for query in queries:
            try:
                df = self.query_df(query)
            except Exception:
                continue
            if df.empty:
                continue
            normalized = _normalized_columns_df(df)
            if (
                "table_schema" not in normalized.columns
                and "schema_name" in normalized.columns
            ):
                normalized["table_schema"] = normalized["schema_name"]
            if "table_catalog" not in normalized.columns:
                normalized["table_catalog"] = catalog
            return normalized[
                ["table_catalog", "table_schema", "table_name", "tag_name", "tag_value"]
            ]
        return self._empty_table_tag_df()

    def get_table_comment(self, catalog: str, schema: str, table: str) -> str:
        queries = [
            f"""SELECT comment
FROM {quote_ident(catalog)}.information_schema.tables
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
LIMIT 1""",
            f"""SELECT comment
FROM system.information_schema.tables
WHERE table_catalog = {sql_literal(catalog)}
  AND table_schema  = {sql_literal(schema)}
  AND table_name    = {sql_literal(table)}
LIMIT 1""",
        ]
        df = self._query_first_non_empty(queries)
        if df.empty:
            return ""
        normalized = _normalized_columns_df(df)
        if normalized.empty or "comment" not in normalized.columns:
            return ""
        return str(normalized.iloc[0].get("comment") or "")

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
        q_system_with_format = f"""SELECT
    table_catalog,
    table_schema,
    table_name,
    table_type,
    data_source_format,
    comment
FROM system.information_schema.tables
WHERE table_catalog = {sql_literal(catalog)}
  AND table_schema  = {sql_literal(schema)}
  AND table_name    = {sql_literal(table)}
LIMIT 1"""
        q_system = f"""SELECT
    table_catalog,
    table_schema,
    table_name,
    table_type,
    comment
FROM system.information_schema.tables
WHERE table_catalog = {sql_literal(catalog)}
  AND table_schema  = {sql_literal(schema)}
  AND table_name    = {sql_literal(table)}
LIMIT 1"""
        df = self._query_first_non_empty(
            [q_with_format, q, q_system_with_format, q_system]
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
        df = _normalized_columns_df(df)
        if "table_catalog" not in df.columns:
            df["table_catalog"] = catalog
        if "data_source_format" not in df.columns:
            df["data_source_format"] = ""
        return df[
            [
                "table_catalog",
                "table_schema",
                "table_name",
                "table_type",
                "data_source_format",
                "comment",
            ]
        ].head(1)

    def get_table_columns(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        queries = [
            f"""SELECT ordinal_position, column_name, data_type, comment, is_nullable, column_default
FROM {quote_ident(catalog)}.information_schema.columns
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
ORDER BY ordinal_position""",
            f"""SELECT ordinal_position, column_name, data_type, comment, is_nullable, column_default
FROM system.information_schema.columns
WHERE table_catalog = {sql_literal(catalog)}
  AND table_schema  = {sql_literal(schema)}
  AND table_name    = {sql_literal(table)}
ORDER BY ordinal_position""",
        ]
        info_df = self._query_first_non_empty(queries)
        if not info_df.empty:
            normalized_info = _normalized_columns_df(info_df)
            required = ["ordinal_position", "column_name", "data_type", "comment"]
            if all(column in normalized_info.columns for column in required):
                # Optional extended metadata — return if present, fall back to empty strings otherwise.
                for optional_column in ("is_nullable", "column_default"):
                    if optional_column not in normalized_info.columns:
                        normalized_info[optional_column] = ""
                return normalized_info[
                    required + ["is_nullable", "column_default"]
                ].reset_index(drop=True)

        full = quote_uc_3part(catalog, schema, table)
        try:
            describe_df = self.query_df(f"DESCRIBE TABLE {full}")
        except Exception:
            return pd.DataFrame(
                columns=[
                    "ordinal_position",
                    "column_name",
                    "data_type",
                    "comment",
                    "is_nullable",
                    "column_default",
                ]
            )
        if describe_df.empty or "col_name" not in describe_df.columns:
            return pd.DataFrame(
                columns=[
                    "ordinal_position",
                    "column_name",
                    "data_type",
                    "comment",
                    "is_nullable",
                    "column_default",
                ]
            )

        normalized = _normalized_columns_df(describe_df)
        if "data_type" not in normalized.columns:
            normalized["data_type"] = ""
        if "comment" not in normalized.columns:
            normalized["comment"] = ""
        normalized["col_name"] = normalized["col_name"].map(
            lambda value: str(value or "").strip()
        )
        normalized = normalized[normalized["col_name"].ne("")]
        normalized = normalized[
            ~normalized["col_name"].str.startswith("#")
            & normalized["data_type"].notna()
        ].copy()
        normalized = normalized.reset_index(drop=True)
        normalized["ordinal_position"] = range(1, len(normalized) + 1)
        normalized = normalized.rename(columns={"col_name": "column_name"})
        # DESCRIBE TABLE does not expose is_nullable / column_default, so fill blanks.
        if "is_nullable" not in normalized.columns:
            normalized["is_nullable"] = ""
        if "column_default" not in normalized.columns:
            normalized["column_default"] = ""
        return normalized[
            [
                "ordinal_position",
                "column_name",
                "data_type",
                "comment",
                "is_nullable",
                "column_default",
            ]
        ]

    def get_table_tags(self, catalog: str, schema: str, table: str) -> pd.DataFrame:
        queries = [
            f"""SELECT tag_name, tag_value
FROM {quote_ident(catalog)}.information_schema.table_tags
WHERE schema_name = {sql_literal(schema)}
  AND table_name  = {sql_literal(table)}
ORDER BY tag_name""",
            f"""SELECT tag_name, tag_value
FROM system.information_schema.table_tags
WHERE catalog_name = {sql_literal(catalog)}
  AND schema_name  = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
ORDER BY tag_name""",
            f"""SELECT tag_name, tag_value
FROM {quote_ident(catalog)}.information_schema.table_tags
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
ORDER BY tag_name""",
        ]
        for query in queries:
            try:
                df = self.query_df(query)
            except Exception:
                continue
            normalized = self._normalize_tag_kv_df(df)
            if normalized.empty:
                continue
            return normalized
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
        self,
        catalog: str,
        schema: str,
        table: str,
        comment: str,
        *,
        table_type: str | None = None,
    ) -> None:
        full = quote_uc_3part(catalog, schema, table)
        relation_type = self._relation_type(catalog, schema, table, table_type)
        statements: List[str] = []
        for keyword in _comment_ddl_keywords(relation_type):
            statements.append(f"COMMENT ON {keyword} {full} IS {sql_literal(comment)}")
        self._execute_first_success(statements)

    def set_table_tags(
        self,
        catalog: str,
        schema: str,
        table: str,
        tags: Dict[str, str],
        *,
        table_type: str | None = None,
    ) -> None:
        if not tags:
            return
        full = quote_uc_3part(catalog, schema, table)
        relation_type = self._relation_type(catalog, schema, table, table_type)
        ddl_keyword = _relation_ddl_keyword(relation_type)
        parts = ", ".join(
            f"{sql_literal(k)} = {sql_literal(v)}" for k, v in tags.items()
        )
        try:
            self.execute(f"ALTER {ddl_keyword} {full} SET TAGS ({parts})")
            return
        except Exception:
            pass
        last_error: Exception | None = None
        for target_keyword in _relation_tag_target_keywords(relation_type):
            try:
                for key, value in tags.items():
                    self.execute(
                        f"SET TAG ON {target_keyword} {full} "
                        f"{sql_literal(key)} = {sql_literal(value)}"
                    )
                return
            except Exception as exc:
                last_error = exc
                continue
        if last_error is not None:
            raise last_error

    def unset_table_tags(
        self,
        catalog: str,
        schema: str,
        table: str,
        tag_keys: List[str],
        *,
        table_type: str | None = None,
    ) -> None:
        if not tag_keys:
            return
        full = quote_uc_3part(catalog, schema, table)
        relation_type = self._relation_type(catalog, schema, table, table_type)
        ddl_keyword = _relation_ddl_keyword(relation_type)
        parts = ", ".join(sql_literal(k) for k in tag_keys)
        try:
            self.execute(f"ALTER {ddl_keyword} {full} UNSET TAGS ({parts})")
            return
        except Exception:
            pass
        last_error: Exception | None = None
        for target_keyword in _relation_tag_target_keywords(relation_type):
            try:
                for key in tag_keys:
                    self.execute(
                        f"UNSET TAG ON {target_keyword} {full} {sql_literal(key)}"
                    )
                return
            except Exception as exc:
                last_error = exc
                continue
        if last_error is not None:
            raise last_error

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
            return pd.DataFrame(columns=["email", "display_name", "principal_type"])
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

    def get_table_lineage_upstream_batch(
        self,
        tables: "List[Tuple[str, str, str]]",
        limit_per_table: int = 50,
    ) -> pd.DataFrame:
        """Batched upstream lookup — one query for N (catalog, schema, table)
        tuples. Returns rows keyed by target_* so callers can group by the
        origin table.

        Cuts the BFS walk from N roundtrips per level to 1. Each hop of the
        branch walk used to issue one `SELECT ... WHERE target = ?` per
        frontier node; this runs the union of all those predicates in a
        single statement so warehouse-serverless cold-start overhead is
        amortized across the whole level.
        """
        if not tables:
            return pd.DataFrame()
        tuples_sql = ", ".join(
            f"({sql_literal(c)}, {sql_literal(s)}, {sql_literal(t)})"
            for c, s, t in tables
        )
        total_limit = max(int(limit_per_table) * len(tables), int(limit_per_table))
        q = f"""
SELECT
    target_table_catalog,
    target_table_schema,
    target_table_name,
    target_table_full_name,
    source_table_full_name,
    source_table_catalog,
    source_table_schema,
    source_table_name,
    source_type
FROM system.access.table_lineage
WHERE (target_table_catalog, target_table_schema, target_table_name) IN ({tuples_sql})
  AND source_table_name IS NOT NULL
GROUP BY ALL
ORDER BY target_table_full_name, source_table_full_name
LIMIT {int(total_limit)}
"""
        return self.query_df(q)

    def get_table_lineage_downstream_batch(
        self,
        tables: "List[Tuple[str, str, str]]",
        limit_per_table: int = 50,
    ) -> pd.DataFrame:
        """Batched downstream lookup — see get_table_lineage_upstream_batch."""
        if not tables:
            return pd.DataFrame()
        tuples_sql = ", ".join(
            f"({sql_literal(c)}, {sql_literal(s)}, {sql_literal(t)})"
            for c, s, t in tables
        )
        total_limit = max(int(limit_per_table) * len(tables), int(limit_per_table))
        q = f"""
SELECT
    source_table_catalog,
    source_table_schema,
    source_table_name,
    source_table_full_name,
    target_table_full_name,
    target_table_catalog,
    target_table_schema,
    target_table_name,
    target_type
FROM system.access.table_lineage
WHERE (source_table_catalog, source_table_schema, source_table_name) IN ({tuples_sql})
  AND target_table_name IS NOT NULL
GROUP BY ALL
ORDER BY source_table_full_name, target_table_full_name
LIMIT {int(total_limit)}
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
                    _get(response, "name") or _get(response, "spec", "name") or ""
                ).strip()

            if entity_type_n in {
                "SQL",
                "DBSQL_QUERY",
                "SQL_QUERY",
                "QUERY",
            }:
                response = self.w.queries.get(entity_id_n)
                return str(
                    _get(response, "display_name") or _get(response, "name") or ""
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
        self,
        catalog: str,
        schema: str,
        table: str,
        column: str,
        comment: str,
        *,
        table_type: str | None = None,
    ) -> None:
        full = quote_uc_3part(catalog, schema, table)
        relation_type = self._relation_type(catalog, schema, table, table_type)
        ddl_keyword = _relation_ddl_keyword(relation_type)
        if ddl_keyword == "VIEW":
            self._execute_first_success(
                [
                    f"COMMENT ON COLUMN {full}.{quote_ident(column)} IS {sql_literal(comment)}",
                    f"ALTER VIEW {full} ALTER COLUMN {quote_ident(column)} COMMENT {sql_literal(comment)}",
                ]
            )
            return
        self._execute_first_success(
            [
                f"ALTER {ddl_keyword} {full} ALTER COLUMN {quote_ident(column)} "
                f"COMMENT {sql_literal(comment)}",
                f"COMMENT ON COLUMN {full}.{quote_ident(column)} IS {sql_literal(comment)}",
            ]
        )

    def get_column_tags(
        self, catalog: str, schema: str, table: str, column: str
    ) -> pd.DataFrame:
        queries = [
            f"""SELECT tag_name, tag_value
FROM {quote_ident(catalog)}.information_schema.column_tags
WHERE schema_name = {sql_literal(schema)}
  AND table_name  = {sql_literal(table)}
  AND column_name = {sql_literal(column)}
ORDER BY tag_name""",
            f"""SELECT tag_name, tag_value
FROM system.information_schema.column_tags
WHERE catalog_name = {sql_literal(catalog)}
  AND schema_name  = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
  AND column_name  = {sql_literal(column)}
ORDER BY tag_name""",
            f"""SELECT tag_name, tag_value
FROM {quote_ident(catalog)}.information_schema.column_tags
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
  AND column_name  = {sql_literal(column)}
ORDER BY tag_name""",
        ]
        for query in queries:
            try:
                df = self.query_df(query)
            except Exception:
                continue
            normalized = self._normalize_tag_kv_df(df)
            if normalized.empty:
                continue
            return normalized
        return pd.DataFrame(columns=["tag_name", "tag_value"])

    def get_table_column_tags(
        self, catalog: str, schema: str, table: str
    ) -> pd.DataFrame:
        queries = [
            f"""SELECT
    catalog_name AS table_catalog,
    schema_name AS table_schema,
    table_name,
    column_name,
    tag_name,
    tag_value
FROM {quote_ident(catalog)}.information_schema.column_tags
WHERE schema_name = {sql_literal(schema)}
  AND table_name  = {sql_literal(table)}
ORDER BY column_name, tag_name""",
            f"""SELECT
    catalog_name AS table_catalog,
    schema_name AS table_schema,
    table_name,
    column_name,
    tag_name,
    tag_value
FROM system.information_schema.column_tags
WHERE catalog_name = {sql_literal(catalog)}
  AND schema_name  = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
ORDER BY column_name, tag_name""",
            f"""SELECT
    {sql_literal(catalog)} AS table_catalog,
    table_schema,
    table_name,
    column_name,
    tag_name,
    tag_value
FROM {quote_ident(catalog)}.information_schema.column_tags
WHERE table_schema = {sql_literal(schema)}
  AND table_name   = {sql_literal(table)}
ORDER BY column_name, tag_name""",
        ]
        for query in queries:
            try:
                df = self.query_df(query)
            except Exception:
                continue
            if df.empty:
                continue
            normalized = _normalized_columns_df(df)
            if "table_catalog" not in normalized.columns:
                normalized["table_catalog"] = catalog
            if (
                "table_schema" not in normalized.columns
                and "schema_name" in normalized.columns
            ):
                normalized["table_schema"] = normalized["schema_name"]
            return normalized[
                [
                    "table_catalog",
                    "table_schema",
                    "table_name",
                    "column_name",
                    "tag_name",
                    "tag_value",
                ]
            ]
        return self._empty_column_tag_df()

    def set_column_tags(
        self,
        catalog: str,
        schema: str,
        table: str,
        column: str,
        tags: Dict[str, str],
        *,
        table_type: str | None = None,
    ) -> None:
        if not tags:
            return
        full = quote_uc_3part(catalog, schema, table)
        relation_type = self._relation_type(catalog, schema, table, table_type)
        ddl_keyword = _relation_ddl_keyword(relation_type)
        if ddl_keyword == "VIEW":
            for key, value in tags.items():
                self.execute(
                    f"SET TAG ON COLUMN {full}.{quote_ident(column)} "
                    f"{sql_literal(key)} = {sql_literal(value)}"
                )
            return
        parts = ", ".join(
            f"{sql_literal(k)} = {sql_literal(v)}" for k, v in tags.items()
        )
        try:
            self.execute(
                f"ALTER {ddl_keyword} {full} ALTER COLUMN {quote_ident(column)} "
                f"SET TAGS ({parts})"
            )
            return
        except Exception:
            pass
        for key, value in tags.items():
            self.execute(
                f"SET TAG ON COLUMN {full}.{quote_ident(column)} "
                f"{sql_literal(key)} = {sql_literal(value)}"
            )

    def unset_column_tags(
        self,
        catalog: str,
        schema: str,
        table: str,
        column: str,
        tag_keys: List[str],
        *,
        table_type: str | None = None,
    ) -> None:
        if not tag_keys:
            return
        full = quote_uc_3part(catalog, schema, table)
        relation_type = self._relation_type(catalog, schema, table, table_type)
        ddl_keyword = _relation_ddl_keyword(relation_type)
        if ddl_keyword == "VIEW":
            for key in tag_keys:
                self.execute(
                    f"UNSET TAG ON COLUMN {full}.{quote_ident(column)} {sql_literal(key)}"
                )
            return
        parts = ", ".join(sql_literal(k) for k in tag_keys)
        try:
            self.execute(
                f"ALTER {ddl_keyword} {full} ALTER COLUMN {quote_ident(column)} "
                f"UNSET TAGS ({parts})"
            )
            return
        except Exception:
            pass
        for key in tag_keys:
            self.execute(
                f"UNSET TAG ON COLUMN {full}.{quote_ident(column)} {sql_literal(key)}"
            )

    def get_table_sample(
        self, catalog: str, schema: str, table: str, limit: int = 20
    ) -> pd.DataFrame:
        full = quote_uc_3part(catalog, schema, table)
        return self.query_df(f"SELECT * FROM {full} LIMIT {int(limit)}")
