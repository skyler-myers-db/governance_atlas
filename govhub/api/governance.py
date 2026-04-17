from __future__ import annotations

from typing import Callable

from fastapi import APIRouter
from fastapi.responses import JSONResponse


def build_governance_router(
    *,
    summary_endpoint: Callable[..., JSONResponse],
    glossary_list_endpoint: Callable[..., JSONResponse],
    glossary_term_endpoint: Callable[..., JSONResponse],
    create_request_endpoint: Callable[..., JSONResponse],
    patch_request_endpoint: Callable[..., JSONResponse],
    patch_notification_endpoint: Callable[..., JSONResponse],
    upsert_owner_endpoint: Callable[..., JSONResponse],
    upsert_glossary_endpoint: Callable[..., JSONResponse],
    patch_glossary_endpoint: Callable[..., JSONResponse],
) -> APIRouter:
    router = APIRouter(tags=["governance"])
    router.add_api_route(
        "/api/governance/summary",
        summary_endpoint,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_governance_summary",
    )
    router.add_api_route(
        "/api/governance/glossary",
        glossary_list_endpoint,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_governance_glossary",
    )
    router.add_api_route(
        "/api/governance/glossary/{term_id}",
        glossary_term_endpoint,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_governance_glossary_term",
    )
    router.add_api_route(
        "/api/governance/requests",
        create_request_endpoint,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_governance_create_request",
    )
    router.add_api_route(
        "/api/governance/requests/{request_id}",
        patch_request_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_governance_patch_request",
    )
    router.add_api_route(
        "/api/governance/notifications/{notification_id}",
        patch_notification_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_governance_patch_notification",
    )
    router.add_api_route(
        "/api/governance/owners",
        upsert_owner_endpoint,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_governance_upsert_owner",
    )
    router.add_api_route(
        "/api/governance/glossary",
        upsert_glossary_endpoint,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_governance_upsert_glossary",
    )
    router.add_api_route(
        "/api/governance/glossary/{term_id}",
        patch_glossary_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_governance_patch_glossary",
    )
    return router
