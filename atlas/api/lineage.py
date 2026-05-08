from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from atlas.api.identity import _request_auth_mode
from atlas.api.response import (
    _cacheable_json_response,
    _error_response,
    _with_meta,
)
from atlas.services import capabilities as capability_service
from atlas.services import lineage as lineage_service

_LINEAGE_FULL_WARMING: set[str] = set()
_LINEAGE_FULL_WARMING_LOCK = threading.Lock()
_LINEAGE_RECOMMENDATIONS_WARMING: set[str] = set()
_LINEAGE_RECOMMENDATIONS_WARMING_LOCK = threading.Lock()

# Surface failures from the background lineage-warming thread. Previously
# the warmer caught and dropped every exception silently, which meant a
# slow/flaky system.access.table_lineage warehouse query would never
# populate the cache, and the next user request would see "0 edges"
# without any signal of why. We now log warm-thread exceptions at
# WARNING so they show up in app logs and can be correlated with
# warehouse incidents.
_LINEAGE_LOGGER = logging.getLogger("atlas.lineage")


def api_lineage(asset_fqn: str, request: Request) -> JSONResponse:
    from runtime_app import (
        _asset_visibility_record,
        _ensure_live_runtime,
        _lineage_payload,
        _request_cache_scope,
        _store_for_read,
        _uc,
        _uc_for_request,
    )

    _ensure_live_runtime()
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    try:
        requested_profile = str(request.query_params.get("profile") or "full")
    except Exception:
        requested_profile = "full"
    try:
        refresh_requested = str(request.query_params.get("refresh") or "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
    except Exception:
        refresh_requested = False
    profile_name = lineage_service._lineage_profile(requested_profile)
    if refresh_requested:
        lineage_service.invalidate_lineage_caches(asset_fqn)
    if profile_name == lineage_service.LINEAGE_PROFILE_INITIAL:
        payload = _lineage_payload(asset_fqn, request=request)
        return _cacheable_json_response(
            _with_meta(
                payload,
                request,
                source="unity-catalog-lineage",
                state="loading",
                authoritative=False,
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                capabilities={
                    "visibilityState": "unverified",
                    "visibilityScope": "initial-route-shell",
                    "lineageProfile": payload.get("profile") or "initial",
                    "progressive": (payload.get("stats") or {}).get("progressive") or {},
                },
                warnings=[
                    "Initial lineage shell does not verify asset visibility; backed detail and full lineage requests remain permission-gated."
                ],
            ),
            request,
            max_age=30,
            stale_while_revalidate=120,
        )
    visibility = _asset_visibility_record(asset_fqn, request)
    if not visibility.get("openable") and visibility.get("visibilityState") != "loading":
        if visibility.get("visibilityState") == "hidden":
            return _error_response(
                request,
                status_code=404,
                source="unity-catalog-lineage",
                detail="Asset exists but is not visible in the current workspace scope.",
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                capabilities={"visibilityState": "hidden"},
            )
        if visibility.get("visibilityState") == "unknown":
            detail = (
                visibility.get("reason")
                or "Asset visibility could not be verified in the current workspace scope."
            )
            return _error_response(
                request,
                status_code=503,
                source="unity-catalog-lineage",
                detail=detail,
                state="unknown",
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                capabilities={"visibilityState": "unknown"},
                warnings=[detail],
            )
        return _error_response(
            request,
            status_code=404,
            source="unity-catalog-lineage",
            detail="Asset not found.",
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            capabilities={
                "visibilityState": visibility.get("visibilityState") or "missing"
            },
        )
    request_uc = _uc_for_request(request)
    cache_scope = _request_cache_scope(request)
    system_uc = request_uc if actor_scoped else _uc()

    def loading_lineage_response(reason: str) -> JSONResponse:
        initial_payload = lineage_service.lineage_payload(
            request_uc,
            None,
            asset_fqn,
            cache_scope=cache_scope,
            system_uc=system_uc,
            profile=lineage_service.LINEAGE_PROFILE_INITIAL,
        )
        return _cacheable_json_response(
            _with_meta(
                initial_payload,
                request,
                source="unity-catalog-lineage",
                state="loading",
                authoritative=False,
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                capabilities={
                    "visibilityState": visibility.get("visibilityState") or "loading",
                    "visibilityScope": "full-lineage-hydrating",
                    "lineageProfile": initial_payload.get("profile") or "initial",
                    "requestedLineageProfile": "full",
                    "hydrating": True,
                    "progressive": (initial_payload.get("stats") or {}).get("progressive") or {},
                },
                warnings=[reason],
            ),
            request,
            max_age=5,
            stale_while_revalidate=30,
        )

    cached_full = lineage_service.cached_lineage_payload(
        request_uc,
        asset_fqn,
        cache_scope=cache_scope,
        profile=lineage_service.LINEAGE_PROFILE_FULL,
    )
    if cached_full is None:
        warm_key = lineage_service.lineage_cache_key(
            request_uc,
            asset_fqn,
            cache_scope=cache_scope,
            profile=lineage_service.LINEAGE_PROFILE_FULL,
        )
        with _LINEAGE_FULL_WARMING_LOCK:
            should_warm = warm_key not in _LINEAGE_FULL_WARMING
            if should_warm:
                _LINEAGE_FULL_WARMING.add(warm_key)

        if should_warm:
            store = _store_for_read()

            def warm_full_lineage() -> None:
                try:
                    try:
                        lineage_service.lineage_payload(
                            request_uc,
                            store,
                            asset_fqn,
                            cache_scope=cache_scope,
                            system_uc=system_uc,
                            profile=lineage_service.LINEAGE_PROFILE_FULL,
                        )
                    except Exception:
                        # Log instead of swallowing — silent failures
                        # here were the root cause of "0 edges" for
                        # assets the user could see populated in UC.
                        _LINEAGE_LOGGER.warning(
                            "lineage warmer failed for %s",
                            asset_fqn,
                            exc_info=True,
                        )
                finally:
                    with _LINEAGE_FULL_WARMING_LOCK:
                        _LINEAGE_FULL_WARMING.discard(warm_key)

            threading.Thread(
                target=warm_full_lineage,
                name=f"atlas-lineage-full-warm-{asset_fqn}",
                daemon=True,
            ).start()

        if visibility.get("visibilityState") == "loading":
            return loading_lineage_response(
                visibility.get("reason")
                or "Lineage is hydrating after actor-visible inventory starts."
            )
        if visibility.get("openable"):
            return loading_lineage_response(
                "Full lineage topology is hydrating from Unity Catalog system lineage tables."
            )

    if not visibility.get("openable"):
        if visibility.get("visibilityState") == "loading":
            if cached_full is not None and (
                len(((cached_full.get("graphs") or {}).get("data") or {}).get("nodes") or [])
                > 1
                or len(((cached_full.get("graphs") or {}).get("operational") or {}).get("nodes") or [])
                > 1
            ):
                payload = cached_full
                return _cacheable_json_response(
                    _with_meta(
                        payload,
                        request,
                        source="unity-catalog-lineage",
                        state="degraded",
                        authoritative=False,
                        entity_fqn=asset_fqn,
                        entity_id=asset_fqn,
                        capabilities={
                            "visibilityState": "loading",
                            "includesOperationalContext": bool(
                                (payload.get("graphs") or {}).get("operational")
                            ),
                            "visibilityScope": "workspace-app-principal-cached-topology",
                            "lineageProfile": payload.get("profile") or "full",
                            "progressive": (payload.get("stats") or {}).get("progressive") or {},
                        },
                        warnings=[
                            visibility.get("reason")
                            or "Actor-visible inventory is still hydrating; showing cached workspace-scoped lineage topology.",
                            "Lineage is shown from workspace-scoped app-principal reads; per-user authorization is not available.",
                        ],
                    ),
                    request,
                    max_age=30,
                    stale_while_revalidate=120,
                )
            return loading_lineage_response(
                visibility.get("reason")
                or "Lineage is hydrating while actor-visible inventory catches up."
            )
        if visibility.get("visibilityState") == "hidden":
            return _error_response(
                request,
                status_code=404,
                source="unity-catalog-lineage",
                detail="Asset exists but is not visible in the current workspace scope.",
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                capabilities={"visibilityState": "hidden"},
            )
        if visibility.get("visibilityState") == "unknown":
            detail = (
                visibility.get("reason")
                or "Asset visibility could not be verified in the current workspace scope."
            )
            return _error_response(
                request,
                status_code=503,
                source="unity-catalog-lineage",
                detail=detail,
                state="unknown",
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                capabilities={"visibilityState": "unknown"},
                warnings=[detail],
            )
        return _error_response(
            request,
            status_code=404,
            source="unity-catalog-lineage",
            detail="Asset not found.",
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            capabilities={
                "visibilityState": visibility.get("visibilityState") or "missing"
            },
        )
    payload = cached_full or _lineage_payload(asset_fqn, request=request)
    return _cacheable_json_response(
        _with_meta(
            payload,
            request,
            source="unity-catalog-lineage",
            state="available" if actor_scoped else "degraded",
            authoritative=actor_scoped,
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            capabilities={
                "visibilityState": visibility.get("visibilityState"),
                "includesOperationalContext": bool(
                    (payload.get("graphs") or {}).get("operational")
                ),
                "visibilityScope": (
                    capability_service.ACTOR_SCOPED_VISIBILITY
                    if actor_scoped
                    else capability_service.WORKSPACE_APP_PRINCIPAL_VISIBILITY
                ),
                "lineageProfile": payload.get("profile") or "full",
                "progressive": (payload.get("stats") or {}).get("progressive") or {},
            },
            warnings=[]
            if actor_scoped
            else [
                "Lineage is shown from workspace-scoped app-principal reads; per-user authorization is not available."
            ],
        ),
        request,
        max_age=60,
        stale_while_revalidate=240,
    )


def api_lineage_recommendations(
    request: Request,
    limit: int = 8,
) -> JSONResponse:
    from runtime_app import (
        _ensure_live_runtime,
        _request_cache_scope,
        _store_for_read,
        _uc,
        _uc_for_request,
    )

    _ensure_live_runtime()
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    request_uc = _uc_for_request(request)
    system_uc = request_uc if actor_scoped else _uc()
    cache_scope = _request_cache_scope(request)
    resolved_limit = max(1, min(int(limit or 8), 25))
    cache_key = (
        "lineage_recommendations:"
        f"{lineage_service._warehouse_key(request_uc)}:"
        f"{lineage_service._cache_scope_key(cache_scope)}:"
        f"{lineage_service._warehouse_key(system_uc)}:"
        f"{resolved_limit}"
    )

    cached = lineage_service._TTL_CACHE.get(cache_key)
    payload = cached[1] if cached and time.time() - cached[0] < 180 else None
    if payload is None:
        with _LINEAGE_RECOMMENDATIONS_WARMING_LOCK:
            should_warm = cache_key not in _LINEAGE_RECOMMENDATIONS_WARMING
            if should_warm:
                _LINEAGE_RECOMMENDATIONS_WARMING.add(cache_key)

        if should_warm:
            store = _store_for_read()

            def warm_recommendations() -> None:
                try:
                    try:
                        warmed_payload = lineage_service.lineage_recommendations_payload(
                            request_uc,
                            store,
                            system_uc=system_uc,
                            limit=resolved_limit,
                        )
                        lineage_service._TTL_CACHE[cache_key] = (time.time(), warmed_payload)
                    except Exception:
                        _LINEAGE_LOGGER.warning(
                            "lineage recommendations warmer failed",
                            exc_info=True,
                        )
                finally:
                    with _LINEAGE_RECOMMENDATIONS_WARMING_LOCK:
                        _LINEAGE_RECOMMENDATIONS_WARMING.discard(cache_key)

            threading.Thread(
                target=warm_recommendations,
                name="atlas-lineage-recommendations-warm",
                daemon=True,
            ).start()

        service_meta = {
            "source": "system.access.table_lineage",
            "rankingSource": "visible-inventory-batched-lineage",
            "visibleAssetCount": None,
            "scannedAssetCount": 0,
            "candidateLimit": lineage_service.LINEAGE_RECOMMENDATION_CANDIDATE_LIMIT,
            "edgeSampleLimit": lineage_service.LINEAGE_RECOMMENDATION_PER_SEED_LIMIT,
            "recommendationLimit": resolved_limit,
            "hydrating": True,
            "unavailableReason": "Lineage recommendations are warming from actor-visible Unity Catalog inventory.",
        }
        response_payload = {"items": [], "recommendationMeta": service_meta}
        return _cacheable_json_response(
            _with_meta(
                response_payload,
                request,
                source="unity-catalog-lineage",
                state="loading",
                authoritative=False,
                capabilities={
                    "visibilityScope": (
                        capability_service.ACTOR_SCOPED_VISIBILITY
                        if actor_scoped
                        else capability_service.WORKSPACE_APP_PRINCIPAL_VISIBILITY
                    ),
                    "recommendationLimit": resolved_limit,
                    "evidenceSource": service_meta["source"],
                    "lineageRecommendation": service_meta,
                    "hydrating": True,
                },
                warnings=[
                    "Lineage recommendations are warming from Unity Catalog system lineage tables; no recommendations are shown until backed evidence is returned."
                ],
            ),
            request,
            max_age=5,
            stale_while_revalidate=30,
        )

    service_meta = dict(payload.get("meta") or {})
    response_payload = dict(payload)
    response_payload.pop("meta", None)
    if service_meta:
        response_payload["recommendationMeta"] = service_meta
    ranking_source = str(service_meta.get("rankingSource") or "")
    aggregate_fallback = ranking_source == "system.access.table_lineage.aggregate-fallback"
    recommendations_authoritative = actor_scoped and not aggregate_fallback
    recommendation_warnings = []
    if aggregate_fallback:
        recommendation_warnings.append(
            "Lineage recommendations used the aggregate fallback: candidate assets were verified openable, but edge counts may include relationships whose opposite endpoint is not actor-openable."
        )
    if not actor_scoped:
        recommendation_warnings.append(
            "Lineage recommendations are ranked from workspace-scoped app-principal reads; per-user authorization is not available."
        )

    return _cacheable_json_response(
        _with_meta(
            response_payload,
            request,
            source="unity-catalog-lineage",
            state="available" if recommendations_authoritative else "degraded",
            authoritative=recommendations_authoritative,
            capabilities={
                "visibilityScope": (
                    capability_service.ACTOR_SCOPED_VISIBILITY
                    if actor_scoped
                    else capability_service.WORKSPACE_APP_PRINCIPAL_VISIBILITY
                ),
                "relationshipVisibilityScope": (
                    "actor-openable-candidate-aggregate"
                    if aggregate_fallback
                    else (
                        capability_service.ACTOR_SCOPED_VISIBILITY
                        if actor_scoped
                        else capability_service.WORKSPACE_APP_PRINCIPAL_VISIBILITY
                    )
                ),
                "recommendationLimit": resolved_limit,
                "evidenceSource": service_meta.get("source") or "system.access.table_lineage",
                "lineageRecommendation": service_meta,
            },
            warnings=recommendation_warnings,
        ),
        request,
        max_age=120,
        stale_while_revalidate=300,
    )


def api_column_lineage_trace_query(
    request: Request,
    asset_fqn: str = "",
    column_name: str = "",
    direction: str = "upstream",
    depth: int = 2,
) -> JSONResponse:
    """Query-param variant so asset_fqn (which contains dots) doesn't
    have to collide with FastAPI's dot-unfriendly path parameter."""
    if not asset_fqn or not column_name:
        raise HTTPException(
            status_code=400,
            detail="asset_fqn and column_name query parameters are required.",
        )
    return api_column_lineage_trace(asset_fqn, column_name, request, direction, depth)


def api_column_lineage_trace(
    asset_fqn: str,
    column_name: str,
    request: Request,
    direction: str = "upstream",
    depth: int = 2,
) -> JSONResponse:
    """Phase 9 — multi-hop column lineage. Walks system.access.column_lineage
    recursively, bounded by depth/node/fanout caps to fail closed against
    runaway fan-out."""
    from runtime_app import _ensure_live_runtime, _uc_for_request

    _ensure_live_runtime()
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    if not actor_scoped:
        raise HTTPException(
            status_code=403,
            detail="Column lineage requires per-user authorization (OBO).",
        )
    try:
        system_uc = _uc_for_request(request)
    except Exception:
        system_uc = None
    if system_uc is None:
        raise HTTPException(
            status_code=503,
            detail="System lineage tables are not reachable in the current runtime mode.",
        )
    direction_norm = (direction or "upstream").strip().lower()
    if direction_norm == "upstream":
        fetcher = lineage_service.build_upstream_column_fetcher(system_uc)
    elif direction_norm == "downstream":
        fetcher = lineage_service.build_downstream_column_fetcher(system_uc)
    else:
        raise HTTPException(status_code=400, detail="direction must be 'upstream' or 'downstream'")
    try:
        payload = lineage_service.trace_multi_hop_column_lineage(
            asset_fqn=asset_fqn,
            column_name=column_name,
            direction=direction_norm,
            depth=depth,
            fetch_neighbors=fetcher,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return JSONResponse(
        status_code=200,
        content={
            "data": payload,
            "meta": {
                "authoritative": True,
                "source": "system.access.column_lineage",
                "observedAt": datetime.now(timezone.utc).isoformat(),
            },
            "errors": [],
        },
    )


def build_lineage_router() -> APIRouter:
    router = APIRouter(tags=["lineage"])
    # Register specific lineage subroutes before the generic catch-all below.
    router.add_api_route(
        "/api/lineage/recommendations",
        api_lineage_recommendations,
        methods=["GET"],
        name="api_lineage_recommendations",
    )
    router.add_api_route(
        "/api/lineage/column-trace",
        api_column_lineage_trace_query,
        methods=["GET"],
        name="api_column_lineage_trace_query",
    )
    # Back-compat alias — path style for asset_fqns without dots.
    router.add_api_route(
        "/api/lineage/columns/{asset_fqn}/{column_name}/trace",
        api_column_lineage_trace,
        methods=["GET"],
        name="api_column_lineage_trace",
    )
    router.add_api_route(
        "/api/lineage/{asset_fqn:path}",
        api_lineage,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_lineage",
    )
    return router
