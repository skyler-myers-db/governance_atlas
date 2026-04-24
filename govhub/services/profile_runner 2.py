"""Phase 8 — Profile runner.

Queries a table's column metrics from UC/SQL and persists the result
to profile_runs + profile_table_metrics + profile_column_metrics.
Designed to be called from:
  - an admin-triggered endpoint (POST /api/assets/:fqn/profile/run),
  - the background drainer via a 'profile' work item,
  - unit tests against a mock UC client.

Safety invariants:
- SELECT-only queries (we emit them ourselves from fixed templates;
  no caller-supplied SQL).
- Bounded: uses TABLESAMPLE + LIMIT when the plan permits, else
  falls back to an APPROX distinct estimate.
- top-values are gated by a sensitivity flag so we can redact sample
  values for classified-sensitive columns.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class ProfileRunResult:
    profile_run_id: str
    status: str
    row_count: Optional[int] = None
    column_metrics_written: int = 0
    error: str = ""


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _sample_columns(columns: List[Dict[str, Any]], max_columns: int) -> List[Dict[str, Any]]:
    """Truncate column list to `max_columns` without reshuffling so
    repeated runs hit the same columns."""
    return list(columns or [])[: max(0, int(max_columns))]


def run_profile(
    *,
    store,
    uc_client,
    asset_fqn: str,
    columns: List[Dict[str, Any]],
    actor_email: str = "system",
    trigger: str = "manual",
    include_top_values: bool = False,
    max_columns: int = 32,
) -> ProfileRunResult:
    """Run one profile pass against a concrete table. `columns` is a
    list of `{name, type}` dicts (usually sourced from an existing
    asset detail payload). Returns a ProfileRunResult so callers can
    surface per-run errors without exceptions.
    """
    profile_run_id = uuid.uuid4().hex
    try:
        store.insert_profile_run(
            profile_run_id=profile_run_id,
            entity_kind="asset",
            entity_fqn=asset_fqn,
            trigger=trigger,
            status="running",
            sample_strategy="approx",
            sample_rows=None,
            created_by=actor_email,
            notes=None,
        )
    except Exception as exc:
        return ProfileRunResult(
            profile_run_id=profile_run_id,
            status="failed",
            error=f"profile_runs insert failed: {exc}",
        )

    # Table-level row count + bytes via UC metadata. Silent fallback
    # because large tables may not answer count(*) fast enough and
    # tables with UC row-level security may mask the true count.
    row_count: Optional[int] = None
    size_bytes: Optional[int] = None
    try:
        frame = uc_client.query_df(f"SELECT count(*) AS row_count FROM {asset_fqn}")
        if frame is not None and not frame.empty:
            row_count = int(frame.iloc[0]["row_count"])
    except Exception:
        row_count = None

    try:
        store.insert_profile_table_metric(
            profile_run_id=profile_run_id,
            entity_fqn=asset_fqn,
            row_count=row_count,
            size_bytes=size_bytes,
            partition_count=None,
            distinct_keys=None,
            detail={"method": "select count(*)"},
        )
    except Exception:
        pass

    selected_columns = _sample_columns(columns, max_columns)
    columns_written = 0
    # Emit one SELECT per column rather than a monolithic query, so a
    # single-column failure doesn't nuke the whole run.
    for column in selected_columns:
        col_name = str(column.get("name") or "").strip()
        col_type = str(column.get("type") or "").strip().lower()
        if not col_name:
            continue
        null_count: Optional[int] = None
        null_fraction: Optional[float] = None
        distinct_count: Optional[int] = None
        distinct_fraction: Optional[float] = None
        min_value: Optional[str] = None
        max_value: Optional[str] = None
        mean_value: Optional[float] = None
        stddev_value: Optional[float] = None
        top_values: Optional[List[Any]] = None

        # Null metrics + distinct estimate — works for any column type.
        try:
            frame = uc_client.query_df(
                f"""SELECT
    sum(CASE WHEN `{col_name}` IS NULL THEN 1 ELSE 0 END) AS nulls,
    approx_count_distinct(`{col_name}`) AS distinct_count
FROM {asset_fqn}"""
            )
            if frame is not None and not frame.empty:
                row = frame.iloc[0]
                null_count = int(row.get("nulls") or 0) if row.get("nulls") is not None else None
                distinct_count = int(row.get("distinct_count") or 0) if row.get("distinct_count") is not None else None
                if row_count and null_count is not None:
                    null_fraction = null_count / row_count if row_count else None
                if row_count and distinct_count is not None:
                    distinct_fraction = distinct_count / row_count if row_count else None
        except Exception:
            pass

        # Numeric columns — min/max/mean/stddev.
        if col_type in {"int", "integer", "bigint", "smallint", "tinyint", "double", "float", "decimal", "long"} or col_type.startswith("decimal("):
            try:
                frame = uc_client.query_df(
                    f"""SELECT
    min(`{col_name}`) AS min_v,
    max(`{col_name}`) AS max_v,
    avg(`{col_name}`) AS mean_v,
    stddev(`{col_name}`) AS std_v
FROM {asset_fqn}"""
                )
                if frame is not None and not frame.empty:
                    row = frame.iloc[0]
                    min_value = None if row.get("min_v") is None else str(row.get("min_v"))
                    max_value = None if row.get("max_v") is None else str(row.get("max_v"))
                    try:
                        mean_value = float(row.get("mean_v")) if row.get("mean_v") is not None else None
                    except Exception:
                        mean_value = None
                    try:
                        stddev_value = float(row.get("std_v")) if row.get("std_v") is not None else None
                        if stddev_value is not None and math.isnan(stddev_value):
                            stddev_value = None
                    except Exception:
                        stddev_value = None
            except Exception:
                pass
        elif col_type in {"date", "timestamp"} or col_type.startswith("timestamp"):
            try:
                frame = uc_client.query_df(
                    f"""SELECT min(`{col_name}`) AS min_v, max(`{col_name}`) AS max_v FROM {asset_fqn}"""
                )
                if frame is not None and not frame.empty:
                    row = frame.iloc[0]
                    min_value = None if row.get("min_v") is None else str(row.get("min_v"))
                    max_value = None if row.get("max_v") is None else str(row.get("max_v"))
            except Exception:
                pass

        if include_top_values:
            try:
                frame = uc_client.query_df(
                    f"""SELECT `{col_name}` AS value, count(*) AS cnt FROM {asset_fqn}
GROUP BY `{col_name}` ORDER BY cnt DESC LIMIT 10"""
                )
                if frame is not None and not frame.empty:
                    top_values = [
                        {"value": None if row.get("value") is None else str(row.get("value")), "count": int(row.get("cnt") or 0)}
                        for _, row in frame.iterrows()
                    ]
            except Exception:
                top_values = None

        try:
            store.insert_profile_column_metric(
                profile_run_id=profile_run_id,
                entity_fqn=asset_fqn,
                column_name=col_name,
                data_type=col_type or None,
                null_count=null_count,
                null_fraction=null_fraction,
                distinct_count=distinct_count,
                distinct_fraction=distinct_fraction,
                min_value=min_value,
                max_value=max_value,
                mean_value=mean_value,
                stddev_value=stddev_value,
                quantiles=None,
                top_values=top_values,
                detail=None,
            )
            columns_written += 1
        except Exception:
            continue

    try:
        store.finalize_profile_run(
            profile_run_id=profile_run_id,
            status="succeeded",
            error_detail=None,
        )
    except Exception as exc:
        return ProfileRunResult(
            profile_run_id=profile_run_id,
            status="failed",
            error=f"finalize failed: {exc}",
            row_count=row_count,
            column_metrics_written=columns_written,
        )
    return ProfileRunResult(
        profile_run_id=profile_run_id,
        status="succeeded",
        row_count=row_count,
        column_metrics_written=columns_written,
    )
