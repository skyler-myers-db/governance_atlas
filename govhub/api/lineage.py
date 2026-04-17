from __future__ import annotations

from typing import Callable

from fastapi import APIRouter
from fastapi.responses import JSONResponse


def build_lineage_router(
    *,
    lineage_endpoint: Callable[..., JSONResponse],
) -> APIRouter:
    router = APIRouter(tags=["lineage"])
    router.add_api_route(
        "/api/lineage/{asset_fqn:path}",
        lineage_endpoint,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_lineage",
    )
    return router
