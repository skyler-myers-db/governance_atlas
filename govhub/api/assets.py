from __future__ import annotations

from typing import Callable

from fastapi import APIRouter
from fastapi.responses import JSONResponse


def build_assets_router(
    *,
    availability_endpoint: Callable[..., JSONResponse],
    detail_endpoint: Callable[..., JSONResponse],
    patch_column_description_endpoint: Callable[..., JSONResponse],
    patch_column_tags_endpoint: Callable[..., JSONResponse],
    patch_column_metadata_endpoint: Callable[..., JSONResponse],
    patch_asset_description_endpoint: Callable[..., JSONResponse],
    patch_asset_metadata_endpoint: Callable[..., JSONResponse],
    patch_asset_owners_endpoint: Callable[..., JSONResponse],
    patch_asset_tags_endpoint: Callable[..., JSONResponse],
) -> APIRouter:
    router = APIRouter(tags=["assets"])
    router.add_api_route(
        "/api/assets/availability",
        availability_endpoint,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_asset_availability",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}",
        detail_endpoint,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_asset_detail",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/columns/{column_name}/description",
        patch_column_description_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_column_description",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/columns/{column_name}/tags",
        patch_column_tags_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_column_tags",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/columns/{column_name}/metadata",
        patch_column_metadata_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_column_metadata",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/description",
        patch_asset_description_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_description",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/metadata",
        patch_asset_metadata_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_metadata",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/owners",
        patch_asset_owners_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_owners",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/tags",
        patch_asset_tags_endpoint,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_tags",
    )
    return router
