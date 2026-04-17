from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse


def build_discovery_router(
    *,
    search_endpoint: Callable[..., JSONResponse],
) -> APIRouter:
    router = APIRouter(tags=["discovery"])
    router.add_api_route(
        "/api/discovery/search",
        search_endpoint,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_discovery_search",
    )
    return router
