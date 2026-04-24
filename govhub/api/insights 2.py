"""A9.5 — UC/Delta governance insights API.

Thin FastAPI router that exposes the cross-inventory gap analysis
produced by `govhub.services.insights.compute_gap_analysis` under
`GET /api/insights/gap-analysis?limit=200`.

The envelope wraps the gap payload in the standard response meta block
so consumers can read `meta.state`, `meta.degraded`, and
`meta.visibilityScope` the same way they do on Discovery / Governance
responses.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from govhub.api.response import _error_response, _with_meta
from govhub.services import insights as insights_service
from govhub.services.assets import normalize_str as _normalize_str


INSIGHTS_SOURCE = "unity-catalog-inventory+quality-runner"

# Cap the limit so a misbehaving client can't ask for 100k rows per lane.
# 500 is generous — we default to 200 to stay aligned with the spec.
_MAX_LIMIT = 500


def _load_quality_frame(store) -> Any:
    """Read the recent quality_run_result ledger for incident scoring.

    The store is typed loosely because runtime swaps a real GovernanceStore
    for the null store while the warehouse is still warming; both support
    `list_quality_run_results`. Any exception is downgraded to an empty
    frame so the insights tile still renders (with zero incidents) even
    when the ledger is temporarily unavailable.
    """

    try:
        return store.list_quality_run_results(limit=2000)
    except Exception:
        return None


def api_insights_gap_analysis(
    request: Request,
    limit: int = Query(default=200, ge=1, le=_MAX_LIMIT),
    refresh: Optional[str] = Query(default=None),
) -> JSONResponse:
    """Return the four-lane gap envelope + tile totals.

    OBO-scope truthfulness (round 17): if the request's UC client latches
    to the app-principal fallback during the inventory load (e.g. the
    forwarded user token is missing the `sql` scope), the returned tiles
    reflect the SP-visible estate — NOT the actor's view. We surface that
    state in ``meta.state`` + ``meta.degraded`` + ``meta.obo_scope_fallback``
    so the frontend can render a "Showing app-principal view" banner
    instead of silently displaying narrower counts.

    ``?refresh=1`` evicts the per-actor inventory cache entry before the
    load so the next OBO request re-attempts the actor-scoped path. This
    is the escape hatch when a cached SP snapshot is stale.
    """

    from runtime_app import (
        _ensure_live_runtime,
        _request_cache_scope,
        _store_for_read,
        _uc_for_request,
        _visible_assets,
    )
    from govhub.api.cache import _ttl_cache_pop

    _ensure_live_runtime()

    # Honor ?refresh=1 — this bypasses the inventory cache for one hop so
    # the OBO path can retry after a recovered scope-miss.
    refresh_flag = _normalize_str(refresh).lower() in {"1", "true", "yes"}
    if refresh_flag:
        scope = _request_cache_scope(request)
        normalized_scope = _normalize_str(scope) or "shared"
        _ttl_cache_pop(f"runtime_inventory:{normalized_scope}")

    # Build the UC client BEFORE the visible_assets call so we can inspect
    # whether it latched fallback during the load.
    uc_client = _uc_for_request(request)

    try:
        inv = _visible_assets(request)
    except Exception as exc:
        return _error_response(
            request,
            status_code=503,
            source=INSIGHTS_SOURCE,
            detail=(
                _normalize_str(str(exc))
                or "Visible-assets inventory is unavailable right now."
            ),
            state="unavailable",
        )

    obo_fallback_triggered = False
    runtime_context_fn = getattr(uc_client, "runtime_context", None)
    if callable(runtime_context_fn):
        try:
            ctx = runtime_context_fn() or {}
            obo_fallback_triggered = bool(ctx.get("obo_scope_fallback"))
        except Exception:
            obo_fallback_triggered = False

    quality_df = _load_quality_frame(_store_for_read())

    try:
        analysis = insights_service.compute_gap_analysis(
            inv,
            quality_df,
            limit=int(limit),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to compute governance insights: "
                + (_normalize_str(str(exc)) or "unexpected error")
            ),
        ) from exc

    quality_available = quality_df is not None
    # When OBO fallback fired, the inventory is SP-scoped and the envelope
    # must advertise that plainly so the UI can render a degraded banner.
    fallback_reason = (
        "The forwarded user token is missing the `sql` scope; insights "
        "are computed from the app-principal view of the catalog. Re-auth "
        "then retry to restore the actor-scoped view."
    )
    warnings = []
    if obo_fallback_triggered:
        warnings.append(fallback_reason)

    state = "degraded" if (obo_fallback_triggered or not quality_available) else "available"
    envelope = _with_meta(
        {
            "tiles": analysis["tiles"],
            "lanes": analysis["lanes"],
            "lanesOrder": list(insights_service.LANES),
            "qualitySignalAvailable": bool(quality_available),
            "windowDays": insights_service.QUALITY_INCIDENT_WINDOW_DAYS,
        },
        request,
        source=INSIGHTS_SOURCE,
        state=state,
        authoritative=not obo_fallback_triggered,
        capabilities={
            "qualityLedger": bool(quality_available),
        },
        warnings=warnings or None,
    )
    envelope.setdefault("meta", {})
    envelope["meta"]["oboScopeFallback"] = bool(obo_fallback_triggered)
    if obo_fallback_triggered:
        envelope["meta"]["oboFallbackReason"] = fallback_reason
    return JSONResponse(envelope)


def build_insights_router() -> APIRouter:
    router = APIRouter(tags=["insights"])
    router.add_api_route(
        "/api/insights/gap-analysis",
        api_insights_gap_analysis,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_insights_gap_analysis",
    )
    return router


__all__ = ["api_insights_gap_analysis", "build_insights_router"]
