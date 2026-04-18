from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from govhub.services import governance as governance_service
from govhub.services.assets import normalize_str as _normalize_str


class GovernanceRequestStatusPatch(BaseModel):
    status: str
    reviewNote: str = ""


class GovernanceNotificationPatch(BaseModel):
    action: str


class GlossaryTermUpsert(BaseModel):
    termId: str = ""
    name: str
    definition: str = ""
    domain: str = ""
    ownerEmail: str = ""
    status: str = "draft"
    reviewers: Optional[List[Dict[str, Any]]] = None
    changeNote: str = ""

    @field_validator("reviewers", mode="before")
    @classmethod
    def _coerce_reviewers(cls, value: Any) -> Any:
        if value is None:
            return None
        if not isinstance(value, list):
            return value
        coerced: List[Dict[str, Any]] = []
        for item in value:
            if isinstance(item, str):
                coerced.append({"reviewerEmail": item})
            elif isinstance(item, dict):
                coerced.append(item)
        return coerced

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str:
        return governance_service.normalize_glossary_term_status(value)


def api_governance_summary(request: Request) -> JSONResponse:
    from runtime_app import (
        _ensure_governance_store,
        _ensure_live_runtime,
        _governance_summary,
    )

    _ensure_live_runtime()
    _ensure_governance_store()
    return JSONResponse(_governance_summary(request))


def api_governance_glossary(request: Request) -> JSONResponse:
    from runtime_app import (
        _ensure_governance_store,
        _ensure_live_runtime,
        _store,
        _uc_for_request,
        _user_email,
    )

    _ensure_live_runtime()
    _ensure_governance_store()
    store = _store()
    actor_email = _user_email(request)
    return JSONResponse(
        {
            "glossary": governance_service.glossary_terms(
                _uc_for_request(request),
                store,
                actor_email=actor_email,
            )
        }
    )


def api_governance_glossary_term(term_id: str, request: Request) -> JSONResponse:
    from runtime_app import (
        _ensure_governance_store,
        _ensure_live_runtime,
        _store,
        _uc_for_request,
        _user_email,
    )

    _ensure_live_runtime()
    _ensure_governance_store()
    store = _store()
    actor_email = _user_email(request)
    term = governance_service.glossary_term_detail(
        _uc_for_request(request),
        store,
        term_id=_normalize_str(term_id),
        actor_email=actor_email,
    )
    if not term:
        raise HTTPException(status_code=404, detail="Glossary term not found.")
    return JSONResponse({"term": term})


async def api_governance_create_request(request: Request) -> JSONResponse:
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
    payload = await request.json()
    asset_fqn = _normalize_str(payload.get("assetFqn"))
    title = _normalize_str(payload.get("title"))
    note = _normalize_str(payload.get("note"))
    if not asset_fqn or not title:
        raise HTTPException(status_code=400, detail="assetFqn and title are required.")
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    request_id = governance_service.create_change_request(
        store,
        created_by=actor_email,
        asset_fqn=asset_fqn,
        title=title,
        note=note,
        actor_role=actor_role,
    )
    return JSONResponse(
        {
            "ok": True,
            "requestId": request_id,
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(request),
        }
    )


def api_governance_patch_request(
    request_id: str,
    payload: GovernanceRequestStatusPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _asset_detail_payload,
        _asset_visibility_record,
        _ensure_can_mutate,
        _ensure_live_runtime,
        _governance_summary,
        _invalidate_asset_caches,
        _store,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate(request)
    actor_role = _user_role_slug(request)
    store = _store()
    change_request = store.get_change_request(request_id)
    if change_request is None:
        raise HTTPException(status_code=404, detail="Request not found.")
    visibility = None
    if change_request.uc_full_name:
        visibility = _asset_visibility_record(change_request.uc_full_name, request)
        if not visibility.get("openable"):
            raise HTTPException(
                status_code=404, detail="Asset not found or not visible."
            )
    status = _normalize_str(payload.status).lower()
    if status not in {"pending", "approved", "rejected"}:
        raise HTTPException(
            status_code=400, detail="status must be pending, approved, or rejected."
        )
    store.set_request_status(
        request_id=request_id,
        status=status,
        reviewed_by=actor_email,
        review_note=_normalize_str(payload.reviewNote) or None,
        actor_role=actor_role,
    )
    if change_request.uc_full_name:
        _invalidate_asset_caches(change_request.uc_full_name)
    else:
        governance_service.invalidate_governance_caches()
    asset_payload = None
    if change_request.uc_full_name and visibility and visibility.get("openable"):
        asset_payload = _asset_detail_payload(
            change_request.uc_full_name, request=request
        )
    return JSONResponse(
        {
            "ok": True,
            "requestId": request_id,
            "asset": asset_payload,
            "governance": _governance_summary(request),
        }
    )


def api_governance_patch_notification(
    notification_id: str,
    payload: GovernanceNotificationPatch,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _ensure_governance_store,
        _ensure_live_runtime,
        _governance_summary,
        _require_actor_email,
        _store,
    )

    _ensure_live_runtime()
    _ensure_governance_store()
    actor_email = _require_actor_email(request)
    action = _normalize_str(payload.action).lower()
    if action not in {"seen", "read", "dismiss"}:
        raise HTTPException(
            status_code=400, detail="action must be seen, read, or dismiss."
        )
    try:
        _store().update_notification_receipt(
            notification_id=notification_id,
            recipient_email=actor_email,
            action=action,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    governance_service.invalidate_governance_caches()
    return JSONResponse(
        {
            "ok": True,
            "notificationId": _normalize_str(notification_id),
            "governance": _governance_summary(request),
        }
    )


async def api_governance_upsert_owner(request: Request) -> JSONResponse:
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
    payload = await request.json()
    asset_fqn = _normalize_str(payload.get("assetFqn"))
    owner_email = _normalize_str(payload.get("ownerEmail")).lower()
    owner_type = (_normalize_str(payload.get("ownerType")) or "steward").lower()
    if not asset_fqn or not owner_email:
        raise HTTPException(
            status_code=400, detail="assetFqn and ownerEmail are required."
        )
    if not _asset_is_openable(asset_fqn, request):
        raise HTTPException(status_code=404, detail="Asset not found or not visible.")
    governance_service.add_owner(
        store,
        asset_fqn=asset_fqn,
        owner_email=owner_email,
        owner_type=owner_type,
        updated_by=actor_email,
        actor_role=actor_role,
    )
    return JSONResponse(
        {
            "ok": True,
            "asset": _asset_detail_payload(asset_fqn, request=request),
            "governance": _governance_summary(request),
        }
    )


def api_governance_upsert_glossary(
    payload: GlossaryTermUpsert,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _ensure_can_mutate,
        _ensure_live_runtime,
        _governance_summary,
        _store,
        _uc_for_request,
        _user_email,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate(request)
    actor_role = _user_role_slug(request)
    store = _store()
    term_id = _normalize_str(payload.termId) or uuid.uuid4().hex[:12]
    name = _normalize_str(payload.name)
    definition = _normalize_str(payload.definition)
    domain = _normalize_str(payload.domain)
    owner_email = _normalize_str(payload.ownerEmail).lower()
    status = governance_service.normalize_glossary_term_status(payload.status)
    if not name:
        raise HTTPException(status_code=400, detail="name is required.")
    version = governance_service.upsert_glossary_term(
        term_id=term_id,
        name=name,
        definition=definition,
        domain=domain,
        owner_email=owner_email,
        status=status,
        store=store,
        updated_by=actor_email,
        reviewers=payload.reviewers,
        change_note=_normalize_str(payload.changeNote) or None,
        actor_role=actor_role,
    )
    return JSONResponse(
        {
            "ok": True,
            "termId": term_id,
            "term": governance_service.glossary_term_detail(
                _uc_for_request(request),
                store,
                term_id=term_id,
                actor_email=_user_email(request),
            ),
            "version": version,
            "governance": _governance_summary(request),
        }
    )


def api_governance_patch_glossary(
    term_id: str,
    payload: GlossaryTermUpsert,
    request: Request,
) -> JSONResponse:
    from runtime_app import (
        _ensure_can_mutate,
        _ensure_live_runtime,
        _governance_summary,
        _store,
        _uc_for_request,
        _user_email,
        _user_role_slug,
    )

    _ensure_live_runtime()
    actor_email = _ensure_can_mutate(request)
    actor_role = _user_role_slug(request)
    store = _store()
    normalized_term_id = _normalize_str(term_id)
    name = _normalize_str(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="name is required.")
    version = governance_service.upsert_glossary_term(
        term_id=normalized_term_id,
        name=name,
        definition=_normalize_str(payload.definition),
        domain=_normalize_str(payload.domain),
        owner_email=_normalize_str(payload.ownerEmail).lower(),
        status=governance_service.normalize_glossary_term_status(payload.status),
        store=store,
        updated_by=actor_email,
        reviewers=payload.reviewers,
        change_note=_normalize_str(payload.changeNote) or None,
        actor_role=actor_role,
    )
    return JSONResponse(
        {
            "ok": True,
            "termId": normalized_term_id,
            "term": governance_service.glossary_term_detail(
                _uc_for_request(request),
                store,
                term_id=normalized_term_id,
                actor_email=_user_email(request),
            ),
            "version": version,
            "governance": _governance_summary(request),
        }
    )


def build_governance_router() -> APIRouter:
    router = APIRouter(tags=["governance"])
    router.add_api_route(
        "/api/governance/summary",
        api_governance_summary,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_governance_summary",
    )
    router.add_api_route(
        "/api/governance/glossary",
        api_governance_glossary,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_governance_glossary",
    )
    router.add_api_route(
        "/api/governance/glossary/{term_id}",
        api_governance_glossary_term,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_governance_glossary_term",
    )
    router.add_api_route(
        "/api/governance/requests",
        api_governance_create_request,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_governance_create_request",
    )
    router.add_api_route(
        "/api/governance/requests/{request_id}",
        api_governance_patch_request,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_governance_patch_request",
    )
    router.add_api_route(
        "/api/governance/notifications/{notification_id}",
        api_governance_patch_notification,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_governance_patch_notification",
    )
    router.add_api_route(
        "/api/governance/owners",
        api_governance_upsert_owner,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_governance_upsert_owner",
    )
    router.add_api_route(
        "/api/governance/glossary",
        api_governance_upsert_glossary,
        methods=["POST"],
        response_class=JSONResponse,
        name="api_governance_upsert_glossary",
    )
    router.add_api_route(
        "/api/governance/glossary/{term_id}",
        api_governance_patch_glossary,
        methods=["PATCH"],
        response_class=JSONResponse,
        name="api_governance_patch_glossary",
    )
    return router
