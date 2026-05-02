"""Composite Governance Atlas view-model APIs."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from atlas.api.identity import _request_auth_mode, _user_email
from atlas.api.response import _error_response, _with_meta
from atlas.services import atlas_metrics
from atlas.services import capabilities as capability_service
from atlas.services import genie as genie_service
from atlas.services import governance as governance_service
from atlas.services import input_safety
from atlas.services.assets import normalize_str as _normalize_str


class AtlasAiQuestion(BaseModel):
    question: str = Field(default="", max_length=2000)

    @field_validator("question", mode="before")
    @classmethod
    def _sanitize_question(cls, value):
        return input_safety.sanitize_plain_text(
            value,
            field="question",
            max_length=2000,
            allow_empty=True,
        )


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


def _steward_or_admin(request: Request) -> str:
    from runtime_app import _user_role_slug

    role = _user_role_slug(request)
    if role not in ("admin", "steward"):
        raise HTTPException(status_code=403, detail="Steward or admin role required.")
    return role


def _admin_required(request: Request) -> str:
    from runtime_app import _user_role_slug

    role = _user_role_slug(request)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    return role


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


def _extract_visible_asset_fqns(frame) -> list[str]:
    try:
        if frame is None or frame.empty or "fqn" not in frame.columns:
            return []
        return [
            _normalize_str(value)
            for value in frame["fqn"].dropna().astype(str).tolist()
            if _normalize_str(value)
        ]
    except Exception:
        return []


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
    capabilities = payload.get("signalAvailability") or {}
    warnings = []
    if not capabilities.get("quality"):
        warnings.append("Quality health score is unavailable; maturity score excludes quality health.")
    if not capabilities.get("policyCompliance"):
        warnings.append("Policy compliance is unavailable until an authoritative policy evaluation source is configured.")
    if not capabilities.get("auditReadiness"):
        warnings.append("Audit readiness is unavailable until a readiness formula/source is configured.")
    if capabilities.get("policyExceptions") == "degraded":
        warnings.append("Critical policy exceptions are text-derived from governance requests and audit records.")
    state = "degraded" if warnings else "available"
    return _wrap(
        payload,
        request,
        source="unity-catalog-inventory+quality-runner",
        state=state,
        authoritative=not warnings,
        warnings=warnings or None,
        capabilities=capabilities,
    )


def api_taxonomy_overview(request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read, _uc_for_request

    _ensure_live_runtime()
    store = _store_for_read()
    warnings = []
    enriched_glossary = None
    try:
        enriched_glossary = governance_service.glossary_terms(
            _uc_for_request(request),
            store,
            actor_email=_user_email(request),
            limit=500,
        )
    except Exception as exc:
        warnings.append(
            _normalize_str(exc)
            or "Glossary enrichment is unavailable; taxonomy overview is using raw glossary rows."
        )
    payload = atlas_metrics.taxonomy_overview_payload(
        store=store,
        glossary_terms=enriched_glossary,
    )
    return _wrap(
        payload,
        request,
        source="governance-store+unity-catalog-inventory",
        state="degraded" if warnings else "available",
        authoritative=not warnings,
        warnings=warnings or None,
        capabilities={
            "glossaryEnriched": enriched_glossary is not None,
            "classificationTree": bool(payload.get("classifications")),
            "domainTree": bool(payload.get("domains")),
            "dataProducts": bool(payload.get("dataProducts")),
            "columnGroups": bool(payload.get("columnGroups")),
        },
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
        source="unity-catalog-inventory+governance-store",
        state="degraded",
        authoritative=False,
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
            source="unity-catalog-inventory+governance-store",
            detail="Critical data element not found in visible metadata.",
            entity_id=cde_id,
        )
    return _wrap(
        payload,
        request,
        source="unity-catalog-inventory+governance-store",
        state="degraded",
        authoritative=False,
        entity_id=cde_id,
        warnings=[
            "Dedicated CDE control coverage is unavailable; controls are marked unavailable rather than inferred."
        ],
        capabilities={"controlCoverage": False},
    )


def api_audit_evidence(
    request: Request,
    audit_id: Optional[str] = Query(default=None),
    date_range: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read, _visible_assets

    _ensure_live_runtime()
    actor_role = _steward_or_admin(request)
    audit_id_value = audit_id if isinstance(audit_id, str) else None
    date_range_value = date_range if isinstance(date_range, str) else None
    limit_value = int(limit) if isinstance(limit, int) else 200
    try:
        visible_asset_fqns = _extract_visible_asset_fqns(_visible_assets(request))
    except Exception as exc:
        detail = (
            _normalize_str(exc)
            or "Audit visibility scope could not be verified."
        )
        return _error_response(
            request,
            status_code=503,
            source="governance-store+metadata-audit-log",
            detail=(
                "Audit visibility scope could not be verified; audit evidence is unavailable "
                "rather than exposing unscoped actor identities."
            ),
            state="unavailable",
            entity_id=audit_id_value,
            capabilities={
                "requiredRole": "steward-or-admin",
                "actorRole": actor_role,
                "rowLevelSecurity": "fail-closed-visible-assets",
                "actorIdentityExposure": "steward-admin-gated",
            },
            warnings=[detail],
        )
    payload = atlas_metrics.audit_evidence_payload(
        store=_store_for_read(),
        audit_id=audit_id_value,
        date_range=date_range_value,
        limit=limit_value,
        visible_asset_fqns=visible_asset_fqns,
    )
    has_events = bool(payload.get("events"))
    return _wrap(
        payload,
        request,
        source="governance-store+metadata-audit-log",
        state="available" if has_events else "degraded",
        authoritative=has_events,
        entity_id=audit_id_value,
        warnings=None if has_events else ["No metadata audit rows were returned; audit evidence is unavailable rather than inferred."],
        capabilities={
            "requiredRole": "steward-or-admin",
            "actorRole": actor_role,
            "rowLevelSecurity": "visible-assets-only",
            "actorIdentityExposure": "steward-admin-gated",
            "visibleAssetCount": len(visible_asset_fqns),
        },
    )


def api_admin_control_center(request: Request) -> JSONResponse:
    from runtime_app import (
        _config,
        _ensure_live_runtime,
        _store_for_read,
        _uc_runtime_status_fast,
        _visible_assets,
    )

    _ensure_live_runtime()
    role = _admin_required(request)
    cfg = _config()
    target_label = _normalize_str(cfg.deploy_target) or (
        _normalize_str(cfg.environment_label).split("-", 1)[0].strip()
        if _normalize_str(cfg.environment_label)
        else ""
    )
    namespace = ".".join(part for part in [cfg.gov_catalog, cfg.gov_schema] if _normalize_str(part))
    environment_display = (
        f"{target_label} · {namespace}"
        if target_label and namespace
        else namespace
        or _normalize_str(cfg.environment_label)
        or "Workspace"
    )
    try:
        ai_status = genie_service.provider_status(cfg)
    except Exception as exc:
        ai_status = {
            "state": "unavailable",
            "provider": "genie",
            "message": f"{exc.__class__.__name__}: {exc}",
        }
    payload = atlas_metrics.admin_control_center_payload(
        visible_assets=_visible_assets(request),
        store=_store_for_read(),
        runtime=_uc_runtime_status_fast(background=False),
        environment={
            "label": cfg.environment_label or environment_display,
            "displayLabel": environment_display,
            "target": target_label,
            "catalog": cfg.gov_catalog,
            "schema": cfg.gov_schema,
            "warehouseId": cfg.warehouse_id,
            "workspaceHost": cfg.workspace_host,
        },
        actor_role=role,
        ai_status=ai_status,
    )
    return _wrap(
        payload,
        request,
        source="runtime-diagnostics+governance-store",
        state="available",
        authoritative=True,
    )


def api_atlas_ai_recommendations(
    request: Request,
    body: AtlasAiQuestion | None = Body(default=None),
) -> JSONResponse:
    from runtime_app import _config, _ensure_live_runtime, _request_obo_token, _store_for_read, _visible_assets

    _ensure_live_runtime()
    question = _normalize_str(body.question if body else "")
    genie_warning = ""
    genie_status: dict = {"state": "degraded", "provider": "local"}
    try:
        cfg = _config()
        genie_status = genie_service.provider_status(cfg)
        if genie_status.get("provider") == "genie" and genie_status.get("state") == "available":
            forwarded_token = _request_obo_token(request)
            if not forwarded_token:
                genie_warning = (
                    "Genie-backed Atlas AI requires the forwarded Databricks user token; "
                    "the local evidence engine was used instead."
                )
            else:
                payload = genie_service.ask_genie(
                    config=cfg,
                    question=question,
                    user_access_token=forwarded_token,
                )
                if not payload.get("recommendations") and any(
                    token in question.lower()
                    for token in ("recommend", "priority", "priorities")
                ):
                    structured = atlas_metrics.build_ai_recommendations(
                        visible_assets=_visible_assets(request),
                        store=_store_for_read(),
                        question=question,
                    )
                    recommendations = structured.get("recommendations") or []
                    if recommendations:
                        structured_evidence = structured.get("evidence") or []
                        payload = {
                            **payload,
                            "recommendations": recommendations,
                            "evidence": payload.get("evidence") or structured_evidence,
                            "suggestedActions": structured.get("suggestedActions", []),
                            "structuredRecommendationsSource": "unity-catalog-inventory+governance-store",
                            "recommendationsProvider": "genie+evidence",
                        }
                payload_warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
                has_evidence = bool(payload.get("evidence"))
                return _wrap(
                    payload,
                    request,
                    source="databricks-genie",
                    state="available" if has_evidence else "degraded",
                    authoritative=has_evidence,
                    capabilities={
                        "provider": "genie",
                        "spaceId": genie_status.get("spaceId", ""),
                        "benchmarkState": genie_status.get("benchmarkState", ""),
                        "sampleValuesIncluded": False,
                        "piiValuesIncluded": False,
                    },
                    warnings=payload_warnings or None,
                )
        elif genie_status.get("provider") == "genie":
            genie_warning = _normalize_str(genie_status.get("message"))
    except Exception as exc:
        genie_warning = f"Genie-backed Atlas AI unavailable: {exc.__class__.__name__}: {exc}"

    payload = atlas_metrics.build_ai_recommendations(
        visible_assets=_visible_assets(request),
        store=_store_for_read(),
        question=question,
    )
    payload["provider"] = "local-evidence"
    payload["providerState"] = genie_status
    if not payload.get("evidence"):
        payload["confidence"] = "low"
    payload_warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
    warnings = list(payload_warnings)
    if genie_warning:
        warnings.insert(0, genie_warning)
    if not payload.get("evidence") and not warnings:
        warnings.append("No evidence-backed recommendation is available for the current visible metadata.")
    return _wrap(
        payload,
        request,
        source="unity-catalog-inventory+governance-store+local-evidence",
        state="available" if payload.get("evidence") else "degraded",
        authoritative=False,
        capabilities={
            "provider": "local-evidence",
            "genie": genie_status,
            "evidenceBacked": bool(payload.get("evidence")),
            "sampleValuesIncluded": False,
            "piiValuesIncluded": False,
        },
        warnings=warnings or None,
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
