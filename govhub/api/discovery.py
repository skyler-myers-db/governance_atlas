from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from govhub.api.identity import _request_auth_mode
from govhub.api.response import _error_response, _with_meta
from govhub.services import assets as asset_service
from govhub.services import capabilities as capability_service
from govhub.services.assets import normalize_str as _normalize_str


def api_discovery_search(
    request: Request,
    query: str = "",
    query_mode: str = Query(default="plain", alias="queryMode"),
    view: str = "All assets",
    asset_type: str = Query(default="All types", alias="type"),
    views: Optional[List[str]] = Query(default=None),
    types: Optional[List[str]] = Query(default=None),
    catalogs: Optional[List[str]] = Query(default=None),
    domains: Optional[List[str]] = Query(default=None),
    tiers: Optional[List[str]] = Query(default=None),
    certifications: Optional[List[str]] = Query(default=None),
    sensitivities: Optional[List[str]] = Query(default=None),
    sort_by: str = Query(default="Best match", alias="sortBy"),
    limit: int = 60,
    offset: int = 0,
) -> JSONResponse:
    from runtime_app import _discovery_search_payload, _ensure_live_runtime

    _ensure_live_runtime()
    try:
        payload = _discovery_search_payload(
            request=request,
            query=query,
            query_mode=query_mode,
            views=views
            or ([view] if _normalize_str(view) and view != "All assets" else []),
            asset_types=types
            or (
                [asset_type]
                if _normalize_str(asset_type) and asset_type != "All types"
                else []
            ),
            catalogs=catalogs,
            domains=domains,
            tiers=tiers,
            certifications=certifications,
            sensitivities=sensitivities,
            sort_by=sort_by,
            limit=limit,
            offset=offset,
        )
    except asset_service.DiscoveryQuerySyntaxError as exc:
        detail = _normalize_str(exc.message) or "Invalid discovery query."
        return _error_response(
            request,
            status_code=400,
            source="unity-catalog-inventory",
            detail=detail,
            state="degraded",
            extra={
                "invalidQuery": asset_service.discovery_invalid_query_payload(
                    exc.message
                ),
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Discovery search is unavailable right now. "
                f"{_normalize_str(exc) or 'Unexpected metadata runtime error.'}"
            ),
        ) from exc
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    return JSONResponse(
        _with_meta(
            payload,
            request,
            source="unity-catalog-inventory",
            state="available" if actor_scoped else "degraded",
            authoritative=actor_scoped,
            capabilities={
                "workspaceScopedInventory": not actor_scoped,
            },
            warnings=[],
        )
    )


def build_discovery_router() -> APIRouter:
    router = APIRouter(tags=["discovery"])
    router.add_api_route(
        "/api/discovery/search",
        api_discovery_search,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_discovery_search",
    )
    return router
