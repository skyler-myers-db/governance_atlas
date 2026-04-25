"""Composite Governance Atlas view-model APIs."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from atlas.api.identity import _request_auth_mode
from atlas.api.response import _error_response, _with_meta
from atlas.services import atlas_metrics
from atlas.services import capabilities as capability_service
from atlas.services.assets import normalize_str as _normalize_str


class AtlasAiQuestion(BaseModel):
    question: str = Field(default="", max_length=2000)


def _obo_fallback_payload(uc_client) -> tuple[bool, str]:
    runtime_context_fn = getattr(uc_client, "runtime_context", None)
    if not callable(runtime_context_fn):
        return False, ""
    try:
        ctx = runtime_context_fn() or {}
    except Exception:
        return False, ""
    if not ctx.get("obo_scope_fallback"):
        return False, ""
    return (
        True,
        "The forwarded user token is missing the `sql` scope; this response is computed from the app-principal view of the catalog. Re-authenticate, then retry to restore actor-scoped visibility.",
    )


def _wrap(
    payload: dict,
    request: Request,
    *,
    source: str,
    state: str = "available",
    authoritative: bool = True,
    entity_fqn: str | None = None,
    entity_id: str | None = None,
    warnings: list[str] | None = None,
    capabilities: dict | None = None,
) -> JSONResponse:
    envelope = _with_meta(
        payload,
        request,
        source=source,
        state=state,
        authoritative=authoritative,
        entity_fqn=entity_fqn,
        entity_id=entity_id,
        warnings=warnings,
        capabilities=capabilities,
    )
    return JSONResponse(envelope)


def _hidden_asset_error(asset_fqn: str, request: Request, visibility: dict, *, source: str) -> JSONResponse:
    if visibility.get("visibilityState") == "hidden":
        return _error_response(
            request,
            status_code=404,
            source=source,
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
            source=source,
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
        source=source,
        detail="Asset not found.",
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        capabilities={"visibilityState": visibility.get("visibilityState") or "missing"},
    )


def api_command_center(
    request: Request,
    refresh: Optional[str] = Query(default=None),
) -> JSONResponse:
    from runtime_app import (
        _ensure_live_runtime,
        _request_cache_scope,
        _store_for_read,
        _uc_for_request,
        _visible_assets,
    )
    from atlas.api.cache import _ttl_cache_pop

    _ensure_live_runtime()
    refresh_flag = _normalize_str(refresh).lower() in {"1", "true", "yes"}
    if refresh_flag:
        _ttl_cache_pop(f"runtime_inventory:{_normalize_str(_request_cache_scope(request)) or 'shared'}")
    uc_client = _uc_for_request(request)
    try:
        payload = atlas_metrics.command_center_payload(
            visible_assets=_visible_assets(request),
            store=_store_for_read(),
        )
    except Exception as exc:
        return _error_response(
            request,
            status_code=503,
            source="unity-catalog-inventory+governance-store",
            detail=_normalize_str(exc) or "Command center metrics are unavailable.",
            state="unavailable",
        )

    fallback, reason = _obo_fallback_payload(uc_client)
    payload_meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    payload_warnings = [
        _normalize_str(warning)
        for warning in (payload_meta.get("warnings") or [])
        if _normalize_str(warning)
    ]
    warnings = [*payload_warnings, *([reason] if reason else [])]
    degraded = bool(fallback or payload_warnings)
    response = _with_meta(
        payload,
        request,
        source="unity-catalog-inventory+governance-store",
        state="degraded" if degraded else "available",
        authoritative=not degraded,
        warnings=warnings or None,
        capabilities={"refresh": True},
    )
    response.setdefault("meta", {})
    response["meta"]["oboScopeFallback"] = bool(fallback)
    if reason:
        response["meta"]["oboFallbackReason"] = reason
    return JSONResponse(response)


def api_asset_360(asset_fqn: str, request: Request) -> JSONResponse:
    from runtime_app import (
        _asset_detail_payload,
        _asset_visibility_record,
        _ensure_live_runtime,
    )

    _ensure_live_runtime()
    visibility = _asset_visibility_record(asset_fqn, request)
    if not visibility.get("openable"):
        return _hidden_asset_error(
            asset_fqn,
            request,
            visibility,
            source="unity-catalog-detail+governance-store+quality-runner+lineage",
        )

    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    sections = ["header", "activity", "schema", "properties", "profiler"]
    if actor_scoped:
        sections.append("operational")
    detail = _asset_detail_payload(asset_fqn, request=request, sections=sections)
    payload = atlas_metrics.asset_360_payload(detail=detail)
    warnings = []
    if not actor_scoped:
        warnings.append(
            "Operational usage and protected lineage context are degraded until Databricks per-user authorization / OBO is available for actor-scoped reads."
        )
    return _wrap(
        payload,
        request,
        source="unity-catalog-detail+governance-store+quality-runner+lineage",
        state="available" if actor_scoped else "degraded",
        authoritative=actor_scoped,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        warnings=warnings or None,
        capabilities={
            "visibilityState": visibility.get("visibilityState"),
            "requestedSections": sections,
        },
    )


def api_governance_workbench(request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read

    _ensure_live_runtime()
    payload = atlas_metrics.governance_workbench_payload(store=_store_for_read())
    return _wrap(
        payload,
        request,
        source="governance-store",
        state="available",
        authoritative=True,
    )


def api_governance_request_detail(request_id: str, request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read

    _ensure_live_runtime()
    payload = atlas_metrics.governance_request_detail_payload(
        store=_store_for_read(),
        request_id=request_id,
    )
    if payload is None:
        return _error_response(
            request,
            status_code=404,
            source="governance-store",
            detail="Governance request not found.",
            entity_id=request_id,
        )
    return _wrap(
        payload,
        request,
        source="governance-store",
        state="available",
        authoritative=True,
        entity_id=request_id,
    )


def api_insights_dashboard(request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read, _visible_assets

    _ensure_live_runtime()
    payload = atlas_metrics.insights_dashboard_payload(
        visible_assets=_visible_assets(request),
        store=_store_for_read(),
    )
    state = "degraded" if not payload.get("signalAvailability", {}).get("quality") else "available"
    warnings = []
    if state == "degraded":
        warnings.append("Quality-runner signal is unavailable; maturity score excludes quality health.")
    return _wrap(
        payload,
        request,
        source="unity-catalog-inventory+quality-runner",
        state=state,
        authoritative=True,
        warnings=warnings or None,
        capabilities=payload.get("signalAvailability") or {},
    )


def api_taxonomy_overview(request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read

    _ensure_live_runtime()
    payload = atlas_metrics.taxonomy_overview_payload(store=_store_for_read())
    return _wrap(
        payload,
        request,
        source="governance-store+unity-catalog-inventory",
        state="available",
        authoritative=True,
    )


def api_cde_dashboard(request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _visible_assets

    _ensure_live_runtime()
    payload = atlas_metrics.cde_dashboard_payload(visible_assets=_visible_assets(request))
    warnings = [
        "Dedicated CDE control coverage is unavailable; controls are marked unavailable rather than inferred."
    ]
    return _wrap(
        payload,
        request,
        source="unity-catalog-inventory+governance-store+quality-runner",
        state="degraded",
        authoritative=True,
        warnings=warnings,
        capabilities={"controlCoverage": False},
    )


def api_cde_detail(cde_id: str, request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _visible_assets

    _ensure_live_runtime()
    payload = atlas_metrics.cde_detail_payload(
        visible_assets=_visible_assets(request),
        cde_id=cde_id,
    )
    if payload is None:
        return _error_response(
            request,
            status_code=404,
            source="unity-catalog-inventory+governance-store+quality-runner",
            detail="Critical data element not found in visible metadata.",
            entity_id=cde_id,
        )
    return _wrap(
        payload,
        request,
        source="unity-catalog-inventory+governance-store+quality-runner",
        state="degraded",
        authoritative=True,
        entity_id=cde_id,
        warnings=[
            "Dedicated CDE control coverage is unavailable; controls are marked unavailable rather than inferred."
        ],
        capabilities={"controlCoverage": False},
    )


def api_audit_evidence(
    request: Request,
    audit_id: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read

    _ensure_live_runtime()
    payload = atlas_metrics.audit_evidence_payload(
        store=_store_for_read(),
        audit_id=audit_id,
        limit=limit,
    )
    return _wrap(
        payload,
        request,
        source="governance-store+metadata-audit-log+change-events",
        state="available",
        authoritative=True,
        entity_id=audit_id,
    )


def api_admin_control_center(request: Request) -> JSONResponse:
    from runtime_app import (
        _ensure_live_runtime,
        _store_for_read,
        _uc_runtime_status_fast,
        _visible_assets,
    )

    _ensure_live_runtime()
    payload = atlas_metrics.admin_control_center_payload(
        visible_assets=_visible_assets(request),
        store=_store_for_read(),
        runtime=_uc_runtime_status_fast(background=False),
    )
    return _wrap(
        payload,
        request,
        source="runtime-diagnostics+governance-store+background-runner",
        state="available",
        authoritative=True,
    )


def api_atlas_ai_recommendations(
    request: Request,
    body: AtlasAiQuestion | None = Body(default=None),
) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read, _visible_assets

    _ensure_live_runtime()
    question = _normalize_str(body.question if body else "")
    payload = atlas_metrics.build_ai_recommendations(
        visible_assets=_visible_assets(request),
        store=_store_for_read(),
        question=question,
    )
    if not payload.get("evidence"):
        payload["confidence"] = "low"
    payload_warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
    return _wrap(
        payload,
        request,
        source="unity-catalog-inventory+governance-store",
        state="available" if payload.get("evidence") else "degraded",
        authoritative=True,
        capabilities={"sampleValuesIncluded": False, "piiValuesIncluded": False},
        warnings=payload_warnings
        or (
            None
            if payload.get("evidence")
            else ["No evidence-backed recommendation is available for the current visible metadata."]
        ),
    )


def api_atlas_ai_chat(
    request: Request,
    body: AtlasAiQuestion,
) -> JSONResponse:
    question = _normalize_str(body.question)
    if not question:
        raise HTTPException(status_code=422, detail="Question is required.")
    return api_atlas_ai_recommendations(request, AtlasAiQuestion(question=question))


def build_atlas_router() -> APIRouter:
    router = APIRouter(prefix="/api/atlas", tags=["atlas"])
    router.add_api_route("/command-center", api_command_center, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/assets/{asset_fqn:path}/360", api_asset_360, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/governance/workbench", api_governance_workbench, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/governance/requests/{request_id}", api_governance_request_detail, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/insights", api_insights_dashboard, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/taxonomy/overview", api_taxonomy_overview, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/cde", api_cde_dashboard, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/cde/{cde_id:path}", api_cde_detail, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/audit/evidence", api_audit_evidence, methods=["GET"], response_class=JSONResponse)
    router.add_api_route("/admin/control-center", api_admin_control_center, methods=["GET"], response_class=JSONResponse)
    return router


def build_atlas_ai_router() -> APIRouter:
    router = APIRouter(prefix="/api/atlas-ai", tags=["atlas-ai"])
    router.add_api_route("/recommendations", api_atlas_ai_recommendations, methods=["POST"], response_class=JSONResponse)
    router.add_api_route("/chat", api_atlas_ai_chat, methods=["POST"], response_class=JSONResponse)
    return router


__all__ = [
    "build_atlas_router",
    "build_atlas_ai_router",
    "api_command_center",
    "api_asset_360",
    "api_governance_workbench",
    "api_governance_request_detail",
    "api_insights_dashboard",
    "api_taxonomy_overview",
    "api_cde_dashboard",
    "api_cde_detail",
    "api_audit_evidence",
    "api_admin_control_center",
    "api_atlas_ai_recommendations",
    "api_atlas_ai_chat",
]
