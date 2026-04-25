"""Operator-facing admin endpoints.

Currently exposes a minimal snapshot of the background drainer state
so the /capabilities dashboard can render a truthful "background work
health" row without synthesizing metrics. Additional admin endpoints
can land here as long as they remain read-only and do not duplicate
capability derivation already performed by /api/runtime/status.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter
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


def build_admin_router() -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin"])

    @router.get("/background/status")
    def api_background_status() -> JSONResponse:
        return JSONResponse(_background_status_payload())

    return router
