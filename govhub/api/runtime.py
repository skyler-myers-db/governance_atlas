from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse


def build_runtime_router(
    *,
    bootstrap_response: Callable[[Request], JSONResponse],
    runtime_status_response: Callable[[Request], JSONResponse],
) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["runtime"])

    @router.get("/bootstrap")
    def api_bootstrap(request: Request) -> JSONResponse:
        return bootstrap_response(request)

    @router.get("/runtime/status")
    def api_runtime_status(request: Request) -> JSONResponse:
        return runtime_status_response(request)

    return router
