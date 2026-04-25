from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from atlas.api.identity import _request_auth_mode
from atlas.api.response import (
    _cacheable_json_response,
    _error_response,
    _with_meta,
)
from atlas.services import capabilities as capability_service
from atlas.services import governance as governance_service
from atlas.services.assets import normalize_str as _normalize_str


class AssetDescriptionPatch(BaseModel):
    description: str = ""


class OwnerAssignment(BaseModel):
    ownerEmail: str
    ownerType: str = "steward"


class AssetOwnersPatch(BaseModel):
    owners: List[OwnerAssignment] = Field(default_factory=list)


class AssetMetadataPatch(BaseModel):
    description: str = ""
    domain: Optional[str] = None
    tier: Optional[str] = None
    certification: Optional[str] = None
    sensitivity: Optional[str] = None
    criticality: Optional[str] = None
    dataProduct: Optional[str] = None
    freeformTags: Optional[Dict[str, str]] = None


class AssetTagsPatch(BaseModel):
    tags: Dict[str, str] = Field(default_factory=dict)


class AssetAvailabilityRequest(BaseModel):
    assets: List[str] = Field(default_factory=list)


class ColumnDescriptionPatch(BaseModel):
    description: str = ""


class ColumnTagsPatch(BaseModel):
    tags: Dict[str, str] = Field(default_factory=dict)


class ColumnMetadataPatch(BaseModel):
    description: str = ""
    tags: Dict[str, str] = Field(default_factory=dict)


def api_asset_availability(
    payload: AssetAvailabilityRequest,
    request: Request,
) -> JSONResponse:
    from runtime_app import _asset_availability_payload, _ensure_live_runtime

    _ensure_live_runtime()
    return JSONResponse(_asset_availability_payload(payload.assets, request))


def api_asset_detail(
    asset_fqn: str,
    request: Request,
    sections: List[str] = Query(default=[]),
) -> JSONResponse:
    from runtime_app import (
        _asset_detail_payload,
        _asset_visibility_record,
        _ensure_live_runtime,
    )

    _ensure_live_runtime()
    visibility = _asset_visibility_record(asset_fqn, request)
    if not visibility.get("openable"):
        if visibility.get("visibilityState") == "hidden":
            return _error_response(
                request,
                status_code=404,
                source="unity-catalog-detail",
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
                source="unity-catalog-detail",
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
            source="unity-catalog-detail",
            detail="Asset not found.",
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            capabilities={
                "visibilityState": visibility.get("visibilityState") or "missing"
            },
        )
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    protected_sections = {"preview", "operational"}
    requested_sections = list(sections or [])
    resolved_sections = requested_sections
    warnings: List[str] = []
    if not actor_scoped:
        resolved_sections = [
            section
            for section in requested_sections
            if section not in protected_sections
        ]
        if not requested_sections:
            resolved_sections = ["header", "activity", "schema", "properties"]
        elif not resolved_sections:
            resolved_sections = ["header"]
        if set(requested_sections) - set(resolved_sections):
            warnings.append(
                "Protected preview and operational sections were removed because Databricks per-user authorization / OBO is not available."
            )
    payload = _asset_detail_payload(
        asset_fqn, request=request, sections=resolved_sections
    )
    if warnings:
        payload["restrictedSections"] = sorted(
            set(requested_sections) - set(resolved_sections)
        )
    return _cacheable_json_response(
        _with_meta(
            payload,
            request,
            source="unity-catalog-detail",
            state="available" if actor_scoped else "degraded",
            authoritative=actor_scoped,
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            capabilities={
                "requestedSections": requested_sections,
                "resolvedSections": resolved_sections,
                "visibilityState": visibility.get("visibilityState"),
            },
            warnings=warnings,
        ),
        request,
        max_age=30,
        stale_while_revalidate=180,
    )


def api_patch_column_description(
    asset_fqn: str,
    column_name: str,
    payload: ColumnDescriptionPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _asset_detail_payload,
        _asset_is_openable,
        _ensure_asset_column_exists,
        _ensure_can_mutate_uc_metadata,
        _ensure_live_runtime,
        _metadata_audit_column_snapshot,
        _record_metadata_audit,
        _uc_for_request,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate_uc_metadata(request)
    actor_role = _user_role_slug(request)
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    _ensure_asset_column_exists(asset_fqn, column_name, request)
    before = _metadata_audit_column_snapshot(asset_fqn, column_name, request)
    governance_service.patch_column_description(
        _uc_for_request(request),
        asset_fqn=asset_fqn,
        column_name=column_name,
        description=payload.description or "",
    )
    after = _metadata_audit_column_snapshot(asset_fqn, column_name, request)
    _record_metadata_audit(
        entity_type="column",
        action="column-description-updated",
        actor_email=actor_email,
        actor_role=actor_role,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        column_name=column_name,
        before=before,
        after=after,
        detail=payload.description or "",
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "column": column_name,
            "description": payload.description or "",
            "asset": _asset_detail_payload(
                asset_fqn, request=request, sections=["header", "schema"]
            ),
        }
    )


def api_patch_column_tags(
    asset_fqn: str,
    column_name: str,
    payload: ColumnTagsPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _apply_column_tags,
        _asset_detail_payload,
        _asset_is_openable,
        _asset_table_type,
        _ensure_asset_column_exists,
        _ensure_can_mutate_uc_metadata,
        _ensure_live_runtime,
        _invalidate_asset_caches,
        _metadata_audit_column_snapshot,
        _record_metadata_audit,
        _tag_write_warning,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate_uc_metadata(request)
    actor_role = _user_role_slug(request)
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    _ensure_asset_column_exists(asset_fqn, column_name, request)
    before = _metadata_audit_column_snapshot(asset_fqn, column_name, request)
    requested = {
        _normalize_str(key): _normalize_str(value)
        for key, value in (payload.tags or {}).items()
        if _normalize_str(key) and _normalize_str(value)
    }
    applied = _apply_column_tags(
        asset_fqn,
        column_name,
        payload.tags,
        table_type=_asset_table_type(asset_fqn, request=request),
        updated_by=actor_email,
        request=request,
    )
    _invalidate_asset_caches(asset_fqn)
    after = _metadata_audit_column_snapshot(asset_fqn, column_name, request)
    _record_metadata_audit(
        entity_type="column",
        action="column-tags-updated",
        actor_email=actor_email,
        actor_role=actor_role,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        column_name=column_name,
        before=before,
        after=after,
        detail=", ".join(f"{key}={value}" for key, value in requested.items()),
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "column": column_name,
            "tags": applied,
            "asset": _asset_detail_payload(
                asset_fqn, request=request, sections=["header", "schema"]
            ),
            "warning": _tag_write_warning(requested, applied, scope_label="Column"),
        }
    )


def api_patch_column_metadata(
    asset_fqn: str,
    column_name: str,
    payload: ColumnMetadataPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _asset_detail_payload,
        _asset_is_openable,
        _ensure_asset_column_exists,
        _ensure_can_mutate_uc_metadata,
        _ensure_live_runtime,
        _metadata_audit_column_snapshot,
        _record_metadata_audit,
        _uc_for_request,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate_uc_metadata(request)
    actor_role = _user_role_slug(request)
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    _ensure_asset_column_exists(asset_fqn, column_name, request)
    before = _metadata_audit_column_snapshot(asset_fqn, column_name, request)
    applied = governance_service.patch_column_metadata(
        _uc_for_request(request),
        asset_fqn=asset_fqn,
        column_name=column_name,
        description=payload.description or "",
        tags=payload.tags,
    )
    after = _metadata_audit_column_snapshot(asset_fqn, column_name, request)
    _record_metadata_audit(
        entity_type="column",
        action="column-metadata-updated",
        actor_email=actor_email,
        actor_role=actor_role,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        column_name=column_name,
        before=before,
        after=after,
        detail=payload.description or "",
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "column": column_name,
            "description": applied["description"],
            "tags": applied["tags"],
            "asset": _asset_detail_payload(
                asset_fqn, request=request, sections=["header", "schema"]
            ),
            "warning": applied.get("warning") or "",
        }
    )


def api_patch_asset_description(
    asset_fqn: str,
    payload: AssetDescriptionPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _asset_detail_payload,
        _asset_is_openable,
        _ensure_can_mutate_uc_metadata,
        _ensure_live_runtime,
        _governance_summary,
        _metadata_audit_asset_snapshot,
        _record_metadata_audit,
        _uc_for_request,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate_uc_metadata(request)
    actor_role = _user_role_slug(request)
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    before = _metadata_audit_asset_snapshot(asset_fqn, request)
    governance_service.patch_asset_description(
        _uc_for_request(request),
        asset_fqn=asset_fqn,
        description=payload.description or "",
    )
    after = _metadata_audit_asset_snapshot(asset_fqn, request)
    _record_metadata_audit(
        entity_type="asset",
        action="asset-description-updated",
        actor_email=actor_email,
        actor_role=actor_role,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        before=before,
        after=after,
        detail=payload.description or "",
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "description": payload.description or "",
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(request),
        }
    )


def api_patch_asset_metadata(
    asset_fqn: str,
    payload: AssetMetadataPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _apply_asset_metadata,
        _asset_is_openable,
        _ensure_can_mutate_uc_metadata,
        _ensure_live_runtime,
        _governance_summary,
        _metadata_audit_asset_snapshot,
        _record_metadata_audit,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate_uc_metadata(request)
    actor_role = _user_role_slug(request)
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    before = _metadata_audit_asset_snapshot(asset_fqn, request)
    asset, warning = _apply_asset_metadata(asset_fqn, payload, request=request)
    after = _metadata_audit_asset_snapshot(asset_fqn, request)
    _record_metadata_audit(
        entity_type="asset",
        action="asset-metadata-updated",
        actor_email=actor_email,
        actor_role=actor_role,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        before=before,
        after=after,
        detail=payload.description or "",
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "asset": asset,
            "governance": _governance_summary(request),
            "warning": warning,
        }
    )


def api_patch_asset_owners(
    asset_fqn: str,
    payload: AssetOwnersPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _asset_detail_payload,
        _asset_is_openable,
        _ensure_can_mutate,
        _ensure_live_runtime,
        _governance_summary,
        _store,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate(request)
    actor_role = _user_role_slug(request)
    store = _store()
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    governance_service.patch_asset_owners(
        store,
        asset_fqn=asset_fqn,
        owner_assignments=[owner.model_dump() for owner in payload.owners],
        updated_by=actor_email,
        replace=True,
        actor_role=actor_role,
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(request),
        }
    )


def api_patch_asset_tags(
    asset_fqn: str,
    payload: AssetTagsPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _apply_table_tags,
        _asset_detail_payload,
        _asset_is_openable,
        _asset_table_type,
        _ensure_can_mutate_uc_metadata,
        _ensure_live_runtime,
        _invalidate_asset_caches,
        _metadata_audit_asset_snapshot,
        _record_metadata_audit,
        _tag_write_warning,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate_uc_metadata(request)
    actor_role = _user_role_slug(request)
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    before = _metadata_audit_asset_snapshot(asset_fqn, request)
    requested = {
        _normalize_str(key): _normalize_str(value)
        for key, value in (payload.tags or {}).items()
        if _normalize_str(key) and _normalize_str(value)
    }
    applied = _apply_table_tags(
        asset_fqn,
        payload.tags,
        table_type=_asset_table_type(asset_fqn, request=request),
        request=request,
    )
    _invalidate_asset_caches(asset_fqn)
    after = _metadata_audit_asset_snapshot(asset_fqn, request)
    _record_metadata_audit(
        entity_type="asset",
        action="asset-tags-updated",
        actor_email=actor_email,
        actor_role=actor_role,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        before=before,
        after=after,
        detail=", ".join(f"{key}={value}" for key, value in requested.items()),
    )
    return JSONResponse(
        {
            "ok": True,
            "fqn": asset_fqn,
            "tags": applied,
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "warning": _tag_write_warning(requested, applied, scope_label="Asset"),
        }
    )


def build_assets_router() -> APIRouter:
    router = APIRouter(tags=["assets"])
    router.add_api_route(
        "/api/assets/availability",
        api_asset_availability,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_asset_availability",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}",
        api_asset_detail,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_asset_detail",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/columns/{column_name}/description",
        api_patch_column_description,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_column_description",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/columns/{column_name}/tags",
        api_patch_column_tags,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_column_tags",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/columns/{column_name}/metadata",
        api_patch_column_metadata,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_column_metadata",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/description",
        api_patch_asset_description,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_description",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/metadata",
        api_patch_asset_metadata,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_metadata",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/owners",
        api_patch_asset_owners,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_owners",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn:path}/tags",
        api_patch_asset_tags,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_patch_asset_tags",
    )
    return router
