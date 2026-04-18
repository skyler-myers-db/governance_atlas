from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from govhub.api.identity import _request_auth_mode
from govhub.api.response import _error_response, _with_meta
from govhub.services import capabilities as capability_service
from govhub.services import lineage as lineage_service


def api_lineage(asset_fqn: str, request: Request) -> JSONResponse:
    from runtime_app import (
        _asset_visibility_record,
        _ensure_live_runtime,
        _lineage_payload,
        _safe_int,
    )

    _ensure_live_runtime()
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    if not actor_scoped:
        return JSONResponse(
            _with_meta(
                {
                    "fqn": asset_fqn,
                    "graphs": {
                        "data": {"nodes": [], "edges": [], "meta": {}},
                        "operational": {"nodes": [], "edges": [], "meta": {}},
                    },
                    "columnLineage": {"upstream": [], "downstream": [], "meta": {}},
                    "lineageDepth": {
                        "oneHop": {"upstream": [], "downstream": []},
                        "twoHop": {"upstream": {}, "downstream": {}},
                    },
                    "edgeDetails": {},
                    "stats": {},
                    "unavailableReason": "Lineage is not available for actor-scoped reads in the current runtime mode.",
                },
                request,
                source="unity-catalog-lineage",
                state="degraded",
                authoritative=False,
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                warnings=[
                    "Lineage stays degraded until Databricks per-user authorization / OBO is available for actor-scoped reads.",
                ],
                unavailable_reason="Lineage is not available for actor-scoped reads in the current runtime mode.",
            )
        )
    payload = _lineage_payload(asset_fqn, request=request)
    stats = payload.get("stats") or {}
    column_lineage = payload.get("columnLineage") or {}
    has_lineage_context = any(
        _safe_int(stats.get(key)) > 0
        for key in [
            "upstreamCount",
            "downstreamCount",
            "operationalProducerCount",
            "operationalConsumerCount",
        ]
    ) or bool(column_lineage.get("upstream") or column_lineage.get("downstream"))
    visibility = _asset_visibility_record(asset_fqn, request)
    if not visibility.get("openable") and not has_lineage_context:
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
    return JSONResponse(
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
            },
            warnings=[],
        )
    )


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
    from runtime_app import _ensure_live_runtime, _uc

    _ensure_live_runtime()
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    if not actor_scoped:
        raise HTTPException(
            status_code=403,
            detail="Column lineage requires per-user authorization (OBO).",
        )
    try:
        system_uc = _uc()
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
    # Register the more-specific column trace route FIRST so the generic
    # catch-all below doesn't swallow /api/lineage/columns/... paths.
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
