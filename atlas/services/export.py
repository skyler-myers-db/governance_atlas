"""Phase 4 Tranche 2 / Phase 12 — governed-metadata export.

Ships the minimum needed to offer a sync CSV export for actor-scoped,
visible assets. Async/large exports are deferred to a future slice; this
module captures the OBO-freshness contract + stale-auth boundary so
adding async later doesn't require schema or API changes.

Key invariants:
- No raw OBO/user tokens are persisted. ExportJob records the
  token_captured_at timestamp only.
- token_captured_at > 55 minutes fails with STALE_AUTH (Databricks OBO
  tokens typically expire at 1 hour server-side; 5-minute safety).
- filter_snapshot_json captures the asset list + visibility scope at
  request time so the materialization can't silently widen.
- Asset list is capped at SYNC_EXPORT_MAX_ROWS for sync exports.
"""

from __future__ import annotations

import csv
import io
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, List

STALE_AUTH_MINUTES = 55
SYNC_EXPORT_MAX_ROWS = 500
EXPORT_TTL_HOURS = 24


@dataclass(frozen=True)
class ExportDecision:
    """Outcome of the pre-materialization capability + freshness check."""

    allowed: bool
    reason: str = ""
    status: str = "queued"


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    # Normalize "Z" and strip fractional/tz cruft that datetime.fromisoformat
    # can't parse on older Python versions.
    text = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def evaluate_export_request(
    *,
    actor_scoped: bool,
    token_captured_at: Any,
    asset_count: int,
    sync: bool,
    now: datetime | None = None,
) -> ExportDecision:
    """Decide whether a pending export should materialize or fail closed.

    Pure function — no I/O. Tests hit this directly.
    """
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if not actor_scoped:
        return ExportDecision(
            allowed=False,
            status="failed",
            reason=(
                "Export is actor-scoped only. Connect as a user with Databricks "
                "per-user authorization (OBO) to run an export."
            ),
        )
    if asset_count <= 0:
        return ExportDecision(
            allowed=False,
            status="failed",
            reason="Select at least one asset to export.",
        )
    if sync and asset_count > SYNC_EXPORT_MAX_ROWS:
        return ExportDecision(
            allowed=False,
            status="failed",
            reason=(
                f"Sync exports are capped at {SYNC_EXPORT_MAX_ROWS} assets. "
                "Split the request or queue an async export."
            ),
        )
    captured = _parse_ts(token_captured_at)
    if captured is None:
        # If the caller couldn't record token capture time, treat as fresh;
        # the request-time OBO token itself is still enforced by Databricks.
        return ExportDecision(allowed=True, status="materializing")
    age = current - captured
    if age.total_seconds() > STALE_AUTH_MINUTES * 60:
        return ExportDecision(
            allowed=False,
            status="stale_auth",
            reason=(
                "Authorization expired. Re-run the export from a fresh page "
                "load to capture current credentials."
            ),
        )
    return ExportDecision(allowed=True, status="materializing")


def build_csv(rows: Iterable[dict[str, Any]], columns: List[str]) -> str:
    """Render the rows as CSV. Escaping happens via csv.writer; missing
    keys are written as empty strings so missing fields never leak raw
    None into the artifact."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns)
    for row in rows:
        writer.writerow([_coerce_cell(row.get(column)) for column in columns])
    return buffer.getvalue()


def _coerce_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, set)):
        return ", ".join(str(item) for item in value)
    if isinstance(value, dict):
        try:
            return json.dumps(value, sort_keys=True, default=str)
        except Exception:
            return str(value)
    return str(value)


def build_filter_snapshot(
    *,
    asset_fqns: List[str],
    actor_email: str,
    visibility_scope: str,
    format: str,
    requested_at: datetime,
) -> str:
    payload = {
        "assetFqns": list(asset_fqns),
        "actorEmail": actor_email,
        "visibilityScope": visibility_scope,
        "format": format,
        "requestedAt": requested_at.astimezone(timezone.utc).isoformat(),
    }
    return json.dumps(payload, sort_keys=True)


def new_job_id() -> str:
    return uuid.uuid4().hex


def expiry_for(requested_at: datetime, hours: int = EXPORT_TTL_HOURS) -> datetime:
    return requested_at + timedelta(hours=hours)


def evaluate_download_request(
    *,
    actor_scoped: bool,
    actor_email: str,
    requester_email: str | None,
    status: str | None,
    expires_at: Any,
    token_captured_at: Any,
    now: datetime | None = None,
) -> ExportDecision:
    """Gate a re-download attempt against the original requester, current
    status, expiry, and stale-auth clock. Pure function — no I/O."""
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if not actor_scoped:
        return ExportDecision(
            allowed=False,
            status="failed",
            reason=(
                "Downloads require per-user authorization (OBO). Open "
                "Governance Atlas in a user-authorized session."
            ),
        )
    if not requester_email or (actor_email or "").lower() != requester_email.lower():
        return ExportDecision(
            allowed=False,
            status="forbidden",
            reason="Only the original requester can re-download this export.",
        )
    state = (status or "").lower()
    if state != "ready":
        return ExportDecision(
            allowed=False,
            status=state or "failed",
            reason=(
                "Export is not ready for download."
                if state in {"", "queued", "materializing"}
                else "This export is no longer available."
            ),
        )
    expiry = _parse_ts(expires_at)
    if expiry is not None and expiry <= current:
        return ExportDecision(
            allowed=False,
            status="expired",
            reason="Export artifact has expired; re-run the export.",
        )
    captured = _parse_ts(token_captured_at)
    if captured is not None:
        age = current - captured
        if age.total_seconds() > STALE_AUTH_MINUTES * 60:
            return ExportDecision(
                allowed=False,
                status="stale_auth",
                reason=(
                    "Authorization captured with this export has expired. "
                    "Re-run the export from a fresh session."
                ),
            )
    return ExportDecision(allowed=True, status="ready")
