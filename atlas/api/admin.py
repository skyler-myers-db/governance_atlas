"""Operator-facing admin endpoints.

Currently exposes:

- /api/admin/background/status: a minimal snapshot of the background
  drainer state so the /capabilities dashboard can render a truthful
  "background work health" row without synthesizing metrics.
- /api/admin/truth-check: a metastore truth check that runs authoritative
  COUNT(*) queries against system.information_schema and compares the
  result against the inventory + visible-asset counts that drive the
  Governance Atlas UI. Lets admins detect drift between Unity Catalog
  ground truth and what the surfaced product reports.

Additional admin endpoints can land here as long as they remain
read-only and do not duplicate capability derivation already performed
by /api/runtime/status.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse


def _background_status_payload() -> Dict[str, Any]:
    # Lazy import to avoid circular dependency with runtime_app, which
    # mounts this router during its own module-load phase.
    from runtime_app import _background_drainer_snapshot

    snapshot = _background_drainer_snapshot()
    running = bool(snapshot.get("running", False))
    last_error = snapshot.get("lastError") or ""
    last_drain_at = snapshot.get("lastDrainAt")
    state = "available" if running and not last_error else "degraded"
    reason = ""
    if not running:
        reason = "Background drainer thread is not currently running."
    elif last_error:
        reason = f"Background drainer reported an error on its last tick: {last_error}"
    return {
        "data": {
            "drainer": {
                "running": running,
                "lastDrainAt": last_drain_at,
                "processedTotal": int(snapshot.get("processedTotal") or 0),
                "lastError": last_error or None,
            },
            "queue": {
                # Depth hint intentionally null — a follow-up tranche
                # will query the background_queue table. Reporting a
                # hard-coded 0 here would be a lie; null is the
                # honest "not observed" signal.
                "depthHint": None,
            },
        },
        "meta": {
            "state": state,
            "reason": reason,
        },
    }


# ─────────────────────────────────────────────────────────────────────
# Truth check
# ─────────────────────────────────────────────────────────────────────
#
# The truth-check endpoint runs authoritative COUNT(*) queries against
# system.information_schema (catalogs, schemata, tables) and compares
# the result with what asset_service.inventory() / visible_assets() —
# the engines that feed the discovery surface — actually report.
#
# The result is cached in-process for a short window so the Control
# Center "Metastore truth check" tab can be re-opened cheaply, and so
# multiple admins inspecting it don't trigger redundant warehouse work.
#
# All queries here run under the app-principal UC client (system
# information schema reads typically require a metastore-admin grant
# anyway). The endpoint itself is gated to the admin role above.

logger = logging.getLogger(__name__)

_TRUTH_CACHE_TTL_SECONDS = 60.0
_TRUTH_CACHE_LOCK = threading.Lock()
_TRUTH_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sql_literal(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _discovery_catalogs() -> List[str]:
    raw = os.getenv("GOVAT_DISCOVERY_CATALOGS", "") or ""
    return [
        item.strip()
        for item in raw.split(",")
        if item and item.strip()
    ]


def _hidden_catalogs() -> List[str]:
    # Mirrors atlas.services.assets.HIDDEN_CATALOGS so that the truth
    # check applies the same filter the UI applies. Imported lazily to
    # avoid a circular import via runtime_app.
    try:
        from atlas.services.assets import HIDDEN_CATALOGS

        return [str(value) for value in HIDDEN_CATALOGS]
    except Exception:
        return ["system", "samples", "__databricks_internal", "information_schema"]


def _catalog_clause(column: str, catalogs: List[str]) -> str:
    if not catalogs:
        return "1=1"
    in_clause = ", ".join(_sql_literal(c) for c in catalogs)
    return f"LOWER({column}) IN ({in_clause})"


def _safe_query(uc, sql: str, *, timeout_s: int = 30) -> Tuple[pd.DataFrame, str, int]:
    """Run a SQL statement and return (dataframe, error_text, elapsed_ms).

    Errors are caught so a single failing query doesn't kill the entire
    truth-check response. The error text is surfaced in the payload so
    the operator can act on it.
    """
    started = time.time()
    try:
        df = uc.query_df(sql, timeout_s=timeout_s)
        elapsed_ms = int((time.time() - started) * 1000)
        return df, "", elapsed_ms
    except Exception as exc:  # pragma: no cover — network / auth fault paths
        elapsed_ms = int((time.time() - started) * 1000)
        logger.warning("truth-check query failed: %s", exc)
        return pd.DataFrame(), str(exc) or exc.__class__.__name__, elapsed_ms


def _coerce_int(value: Any) -> int:
    try:
        if value is None:
            return 0
        return int(value)
    except (TypeError, ValueError):
        return 0


def _per_catalog_table_counts(uc, catalogs: List[str]) -> Tuple[Dict[str, int], str, int]:
    if not catalogs:
        return {}, "", 0
    where_clause = _catalog_clause("table_catalog", [c.lower() for c in catalogs])
    sql = (
        "SELECT LOWER(table_catalog) AS catalog, COUNT(*) AS table_count "
        "FROM system.information_schema.tables "
        f"WHERE {where_clause} "
        "GROUP BY LOWER(table_catalog)"
    )
    df, err, elapsed_ms = _safe_query(uc, sql)
    counts: Dict[str, int] = {}
    if not df.empty and "catalog" in df.columns and "table_count" in df.columns:
        for _, row in df.iterrows():
            counts[str(row["catalog"]).lower()] = _coerce_int(row["table_count"])
    return counts, err, elapsed_ms


def _per_catalog_schema_counts(uc, catalogs: List[str]) -> Tuple[Dict[str, int], str, int]:
    if not catalogs:
        return {}, "", 0
    where_clause = _catalog_clause("catalog_name", [c.lower() for c in catalogs])
    # information_schema.schemata is the SQL standard spelling; on
    # Databricks Unity Catalog the relation is named "schemata".
    sql = (
        "SELECT LOWER(catalog_name) AS catalog, COUNT(*) AS schema_count "
        "FROM system.information_schema.schemata "
        f"WHERE {where_clause} "
        "GROUP BY LOWER(catalog_name)"
    )
    df, err, elapsed_ms = _safe_query(uc, sql)
    counts: Dict[str, int] = {}
    if not df.empty and "catalog" in df.columns and "schema_count" in df.columns:
        for _, row in df.iterrows():
            counts[str(row["catalog"]).lower()] = _coerce_int(row["schema_count"])
    return counts, err, elapsed_ms


def _ui_inventory_counts() -> Tuple[Dict[str, int], Dict[str, int], int, int, str]:
    """Compute per-catalog inventory + visible-asset counts the UI sees.

    Returns (inventory_per_catalog, visible_per_catalog, inventory_total,
    visible_total, error_text).
    """
    try:
        from runtime_app import _store, _uc
        from atlas.services import assets as asset_service
    except Exception as exc:  # pragma: no cover — import-time fault path
        return {}, {}, 0, 0, str(exc)

    try:
        inventory_df = asset_service.inventory(_uc(), _store())
    except Exception as exc:
        return {}, {}, 0, 0, f"inventory() failed: {exc}"

    inventory_per_catalog: Dict[str, int] = {}
    if (
        inventory_df is not None
        and not inventory_df.empty
        and "table_catalog" in inventory_df.columns
    ):
        for catalog, group in inventory_df.groupby(
            inventory_df["table_catalog"].fillna("").astype(str).str.lower()
        ):
            inventory_per_catalog[catalog] = int(len(group))
    inventory_total = sum(inventory_per_catalog.values())

    try:
        visible_df = asset_service.visible_assets(inventory_df)
    except Exception as exc:
        return inventory_per_catalog, {}, inventory_total, 0, f"visible_assets() failed: {exc}"

    visible_per_catalog: Dict[str, int] = {}
    if (
        visible_df is not None
        and not visible_df.empty
        and "table_catalog" in visible_df.columns
    ):
        for catalog, group in visible_df.groupby(
            visible_df["table_catalog"].fillna("").astype(str).str.lower()
        ):
            visible_per_catalog[catalog] = int(len(group))
    visible_total = sum(visible_per_catalog.values())

    return (
        inventory_per_catalog,
        visible_per_catalog,
        inventory_total,
        visible_total,
        "",
    )


def _build_truth_check_payload() -> Dict[str, Any]:
    from runtime_app import _uc

    uc = _uc()
    discovery_catalogs = _discovery_catalogs()
    hidden_catalogs = _hidden_catalogs()
    queries: List[Dict[str, Any]] = []
    warnings: List[str] = []

    # Total catalogs in the metastore (excluding configured hidden roots).
    if hidden_catalogs:
        catalog_where = (
            "LOWER(catalog_name) NOT IN ("
            + ", ".join(_sql_literal(c.lower()) for c in hidden_catalogs)
            + ")"
        )
    else:
        catalog_where = "1=1"
    catalog_sql = (
        "SELECT COUNT(*) AS catalog_count "
        "FROM system.information_schema.catalogs "
        f"WHERE {catalog_where}"
    )
    catalog_df, catalog_err, catalog_ms = _safe_query(uc, catalog_sql)
    catalog_total = (
        _coerce_int(catalog_df.iloc[0, 0]) if not catalog_df.empty else 0
    )
    if catalog_err:
        warnings.append(f"catalog count query failed: {catalog_err}")
    queries.append(
        {
            "label": "system.information_schema.catalogs",
            "sql": catalog_sql,
            "rowCount": catalog_total,
            "elapsedMs": catalog_ms,
            "error": catalog_err or None,
        }
    )

    # Per-discovery-catalog schema + table counts.
    per_schema_counts, schema_err, schema_ms = _per_catalog_schema_counts(
        uc, discovery_catalogs
    )
    schema_total = sum(per_schema_counts.values())
    if schema_err:
        warnings.append(f"schema count query failed: {schema_err}")
    queries.append(
        {
            "label": "system.information_schema.schemata",
            "sql": (
                "SELECT LOWER(catalog_name) AS catalog, COUNT(*) AS schema_count "
                "FROM system.information_schema.schemata "
                f"WHERE {_catalog_clause('catalog_name', [c.lower() for c in discovery_catalogs])} "
                "GROUP BY LOWER(catalog_name)"
            ),
            "rowCount": schema_total,
            "elapsedMs": schema_ms,
            "error": schema_err or None,
        }
    )

    per_table_counts, table_err, table_ms = _per_catalog_table_counts(
        uc, discovery_catalogs
    )
    table_total = sum(per_table_counts.values())
    if table_err:
        warnings.append(f"table count query failed: {table_err}")
    queries.append(
        {
            "label": "system.information_schema.tables",
            "sql": (
                "SELECT LOWER(table_catalog) AS catalog, COUNT(*) AS table_count "
                "FROM system.information_schema.tables "
                f"WHERE {_catalog_clause('table_catalog', [c.lower() for c in discovery_catalogs])} "
                "GROUP BY LOWER(table_catalog)"
            ),
            "rowCount": table_total,
            "elapsedMs": table_ms,
            "error": table_err or None,
        }
    )

    # UI counts.
    (
        ui_inventory_per_catalog,
        ui_visible_per_catalog,
        ui_inventory_total,
        ui_visible_total,
        ui_err,
    ) = _ui_inventory_counts()
    if ui_err:
        warnings.append(f"ui inventory derivation failed: {ui_err}")

    # Per-catalog breakdown — drift is the difference between metastore
    # truth and what the UI reports as inventory. A negative drift means
    # the UI surfaced more rows than the metastore acknowledges
    # (likely a stale cache); a positive drift means the metastore has
    # tables the UI didn't surface (likely actor-visibility filters or
    # hidden-schema rules).
    per_catalog: List[Dict[str, Any]] = []
    catalog_keys = set()
    catalog_keys.update(per_table_counts.keys())
    catalog_keys.update(per_schema_counts.keys())
    catalog_keys.update(ui_inventory_per_catalog.keys())
    catalog_keys.update(ui_visible_per_catalog.keys())
    catalog_keys.update(c.lower() for c in discovery_catalogs)

    discovery_set = {c.lower() for c in discovery_catalogs}
    for catalog in sorted(catalog_keys):
        metastore_tables = int(per_table_counts.get(catalog, 0))
        metastore_schemas = int(per_schema_counts.get(catalog, 0))
        ui_inventory_tables = int(ui_inventory_per_catalog.get(catalog, 0))
        ui_visible_tables = int(ui_visible_per_catalog.get(catalog, 0))
        per_catalog.append(
            {
                "catalog": catalog,
                "configured": catalog in discovery_set,
                "metastore": {
                    "schemaCount": metastore_schemas,
                    "tableCount": metastore_tables,
                },
                "ui": {
                    "inventoryAssetCount": ui_inventory_tables,
                    "visibleAssetCount": ui_visible_tables,
                },
                "drift": {
                    # Positive = metastore knows about MORE than UI inventory.
                    "inventoryDelta": metastore_tables - ui_inventory_tables,
                    # Positive = inventory has MORE than the visible surface.
                    "hiddenByVisibility": ui_inventory_tables - ui_visible_tables,
                },
            }
        )

    state = "available"
    reason = ""
    if warnings:
        state = "degraded"
        reason = warnings[0]

    return {
        "data": {
            "discoveryCatalogs": discovery_catalogs,
            "hiddenCatalogs": hidden_catalogs,
            "metastore": {
                "catalogTotal": catalog_total,
                "schemaTotalForDiscovery": schema_total,
                "tableTotalForDiscovery": table_total,
                "perCatalog": per_catalog,
            },
            "ui": {
                "inventoryTotal": ui_inventory_total,
                "visibleTotal": ui_visible_total,
            },
            "drift": {
                "inventoryDelta": table_total - ui_inventory_total,
                "hiddenByVisibility": ui_inventory_total - ui_visible_total,
                "warnings": warnings,
            },
            "queries": queries,
            "observedAt": _now_iso(),
        },
        "meta": {
            "state": state,
            "reason": reason,
        },
    }


def _truth_check_payload(force_refresh: bool = False) -> Dict[str, Any]:
    cache_key = "default"
    now = time.time()
    if not force_refresh:
        with _TRUTH_CACHE_LOCK:
            cached = _TRUTH_CACHE.get(cache_key)
            if cached and now - cached[0] < _TRUTH_CACHE_TTL_SECONDS:
                return cached[1]
    payload = _build_truth_check_payload()
    with _TRUTH_CACHE_LOCK:
        _TRUTH_CACHE[cache_key] = (now, payload)
    return payload


def build_admin_router() -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin"])

    @router.get("/background/status")
    def api_background_status() -> JSONResponse:
        return JSONResponse(_background_status_payload())

    @router.get("/truth-check")
    def api_truth_check(request: Request) -> JSONResponse:
        # Lazy import to keep the admin router importable at module load
        # time without dragging the FastAPI runtime app along.
        from runtime_app import _user_role_slug

        role = _user_role_slug(request)
        if role != "admin":
            raise HTTPException(
                status_code=403,
                detail="Admin role required to view metastore truth check.",
            )
        force_refresh = (
            (request.query_params.get("refresh") or "").strip().lower()
            in {"1", "true", "yes"}
        )
        payload = _truth_check_payload(force_refresh=force_refresh)
        return JSONResponse(payload)

    return router
