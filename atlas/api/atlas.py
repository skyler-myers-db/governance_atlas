"""Composite Governance Atlas view-model APIs."""

from __future__ import annotations

import hashlib
import datetime as dt
import threading
from typing import Any, Mapping, Optional, Sequence

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
import pandas as pd

from atlas.api.cache import _ttl_cache_pop, _ttl_fresh_value, _ttl_value
from atlas.api.identity import _request_auth_mode, _user_email
from atlas.api.response import _error_response, _with_meta
from atlas.services import atlas_metrics
from atlas.services import assets as asset_service
from atlas.services import capabilities as capability_service
from atlas.services import genie as genie_service
from atlas.services import governance as governance_service
from atlas.services import input_safety
from atlas.services.assets import normalize_str as _normalize_str

_ASSET_360_WARMING: set[str] = set()
_ASSET_360_WARMING_LOCK = threading.Lock()
_TAXONOMY_OVERVIEW_WARMING: set[str] = set()
_TAXONOMY_OVERVIEW_WARMING_LOCK = threading.Lock()
_ADMIN_CONTROL_WARMING: set[str] = set()
_ADMIN_CONTROL_WARMING_LOCK = threading.Lock()
_CDE_DASHBOARD_WARMING: set[str] = set()
_CDE_DASHBOARD_WARMING_LOCK = threading.Lock()
_COMMAND_CENTER_WARMING: set[str] = set()
_COMMAND_CENTER_WARMING_LOCK = threading.Lock()
_AUDIT_EVIDENCE_WARMING: set[str] = set()
_AUDIT_EVIDENCE_WARMING_LOCK = threading.Lock()


def _sdk_get(obj: Any, *path: str) -> Any:
    cur = obj
    for part in path:
        if cur is None:
            return None
        if isinstance(cur, Mapping):
            cur = cur.get(part)
        else:
            cur = getattr(cur, part, None)
    return cur


def _enum_text(value: Any) -> str:
    if value is None:
        return ""
    raw = getattr(value, "value", value)
    return _normalize_str(raw).replace("_", " ")


def _job_timestamp_label(value: Any) -> str:
    try:
        if value is None or value == "":
            return "No run recorded"
        numeric = float(value)
        if numeric > 10_000_000_000:
            numeric = numeric / 1000.0
        return dt.datetime.fromtimestamp(numeric, tz=dt.timezone.utc).strftime("%b %-d, %H:%M UTC")
    except Exception:
        return _normalize_str(value) or "No run recorded"


def _job_schedule_label(settings: Any) -> str:
    schedule = _sdk_get(settings, "schedule")
    if not schedule:
        return "Manual"
    cron = _normalize_str(_sdk_get(schedule, "quartz_cron_expression"))
    timezone = _normalize_str(_sdk_get(schedule, "timezone_id"))
    pause_status = _normalize_str(_sdk_get(schedule, "pause_status")).upper()
    label = cron or "Scheduled"
    if timezone:
        label = f"{label} · {timezone}"
    if pause_status == "PAUSED":
        label = f"Paused · {label}"
    return label


def _job_status_label(job: Any, latest_run: Any | None = None) -> str:
    state = _sdk_get(latest_run, "state")
    result = _enum_text(_sdk_get(state, "result_state"))
    lifecycle = _enum_text(_sdk_get(state, "life_cycle_state"))
    if result:
        return result.title()
    if lifecycle:
        return lifecycle.title()
    pause_status = _normalize_str(_sdk_get(_sdk_get(job, "settings"), "schedule", "pause_status")).upper()
    if pause_status == "PAUSED":
        return "Paused"
    return "Scheduled"


def _databricks_job_inventory(
    uc_client: Any,
    *,
    limit: int = 6,
    include_latest_runs: bool = False,
    workspace_host: str = "",
) -> list[dict[str, Any]]:
    jobs_api = getattr(getattr(uc_client, "w", None), "jobs", None)
    list_jobs = getattr(jobs_api, "list", None)
    if not callable(list_jobs):
        return []
    try:
        job_iter = list_jobs(limit=max(limit, 12))
    except TypeError:
        job_iter = list_jobs()
    except Exception:
        return []

    rows: list[dict[str, Any]] = []
    list_runs = getattr(jobs_api, "list_runs", None) if include_latest_runs else None
    host = _normalize_str(workspace_host) or _normalize_str(
        _sdk_get(uc_client, "_client_context", "host")
    )
    host = host.rstrip("/")
    for job in job_iter:
        job_id = _sdk_get(job, "job_id") or _sdk_get(job, "job_id".upper())
        settings = _sdk_get(job, "settings") or {}
        name = _normalize_str(_sdk_get(settings, "name") or _sdk_get(settings, "job_name"))
        if not job_id or not name:
            continue
        latest_run = None
        if callable(list_runs):
            try:
                run_iter = list_runs(job_id=job_id, limit=1)
                latest_run = next(iter(run_iter), None)
            except Exception:
                latest_run = None
        rows.append(
            {
                "id": str(job_id),
                "name": name,
                "schedule": _job_schedule_label(settings),
                "lastRun": _job_timestamp_label(
                    _sdk_get(latest_run, "start_time")
                    or _sdk_get(latest_run, "end_time")
                    or _sdk_get(job, "created_time")
                ),
                "status": _job_status_label(job, latest_run),
                "url": f"{host}/jobs/{job_id}" if host else "",
                "source": "databricks-jobs-api",
            }
        )
        if len(rows) >= limit:
            break
    return rows


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


def _route_cache_key(prefix: str, *parts: Any) -> str:
    raw = "\0".join(_normalize_str(part) for part in parts)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}:{digest}"


def _request_scope_key(request: Request) -> str:
    try:
        from runtime_app import _request_cache_scope

        return _normalize_str(_request_cache_scope(request)) or "shared"
    except Exception:
        auth_mode = _normalize_str(_request_auth_mode(request)) or "unknown-auth"
        actor = _normalize_str(_user_email(request)) or "unknown-actor"
        return f"{auth_mode}:{actor}"


def _genie_row_value(row: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        text = _normalize_str(value)
        if text:
            return text
    return ""


def _recommendations_from_genie_evidence(evidence: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Derive clickable recommendation cards from Genie-returned SQL rows.

    This is not a local fallback: the only source is Databricks Genie query
    evidence already returned for this actor and question.
    """

    recommendations: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in evidence or []:
        rows = item.get("resultRows") if isinstance(item.get("resultRows"), list) else []
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            asset_fqn = _genie_row_value(
                row,
                "asset_fqn",
                "assetFqn",
                "fqn",
                "entity_fqn",
                "table_full_name",
            )
            if not asset_fqn or asset_fqn in seen:
                continue
            seen.add(asset_fqn)
            domain = _genie_row_value(row, "domain", "governance_domain")
            data_product = _genie_row_value(row, "data_product", "dataProduct")
            owner_count = _genie_row_value(row, "owner_count", "owners", "ownerCount")
            open_work_count = _genie_row_value(row, "open_work_count", "openWorkCount", "request_count")
            criticality = _genie_row_value(row, "criticality", "tier")
            certification = _genie_row_value(row, "certification", "certification_status")
            signals = [
                f"domain {domain}" if domain else "",
                f"product {data_product}" if data_product else "",
                f"{owner_count} owners" if owner_count else "",
                f"{open_work_count} open work items" if open_work_count else "",
                f"criticality {criticality}" if criticality else "",
                f"certification {certification}" if certification else "",
            ]
            detail = "; ".join(part for part in signals if part)
            recommendations.append(
                {
                    "title": f"Review {asset_fqn.rsplit('.', 1)[-1]}",
                    "detail": detail or "Genie returned this actor-visible asset as governed priority evidence.",
                    "provider": "databricks-genie",
                    "evidence": [
                        {
                            "type": "asset",
                            "id": asset_fqn,
                            "metric": "genieQueryEvidence",
                            "statementId": _normalize_str(item.get("statementId")),
                        }
                    ],
                    "suggestedActions": [
                        {"label": "Open Discovery", "surface": "discovery"},
                        {"label": "Review Governance", "surface": "governance"},
                    ],
                }
            )
            if len(recommendations) >= 3:
                return recommendations
    return recommendations


def _row_text(row: Mapping[str, Any], key: str) -> str:
    try:
        return _normalize_str(row.get(key))
    except Exception:
        return ""


def _live_metadata_atlas_ai_payload(
    question: str,
    request: Request,
    *,
    genie_status: Mapping[str, Any],
    warnings: Sequence[str],
) -> dict[str, Any] | None:
    """Answer with backed workspace metadata when Genie cannot run for this actor.

    This is deliberately not a local recommendation substitute for an empty Genie
    result. It only runs before Genie when no forwarded OBO token is available,
    and every returned row is sourced from the live Unity Catalog inventory plus
    Governance Atlas control-plane metadata.
    """

    from runtime_app import _visible_assets

    try:
        visible_assets = _visible_assets(request)
    except Exception:
        return None
    if visible_assets is None or getattr(visible_assets, "empty", True):
        return None

    rows: list[dict[str, str]] = []
    iterrows = getattr(visible_assets, "iterrows", None)
    if not callable(iterrows):
        return None
    for _, row in iterrows():
        fqn = _row_text(row, "fqn")
        if not fqn:
            continue
        certification = _row_text(row, "certification") or "Uncertified"
        criticality = _row_text(row, "criticality") or _row_text(row, "tier") or "Unspecified"
        governance_status = _row_text(row, "governance_status")
        rows.append(
            {
                "asset_fqn": fqn,
                "asset_name": fqn.rsplit(".", 1)[-1],
                "domain": _row_text(row, "domain") or "Unassigned",
                "certification": certification,
                "criticality": criticality,
                "tier": _row_text(row, "tier") or "Unassigned",
                "owner": _row_text(row, "owners_summary")
                or _row_text(row, "business_owner")
                or _row_text(row, "technical_owner")
                or "Unassigned",
                "governance_status": governance_status or "Unspecified",
            }
        )

    if not rows:
        return None

    question_text = _normalize_str(question).lower()
    if "certif" in question_text:
        selected = [
            row
            for row in rows
            if row["certification"].lower() != "certified"
            and (
                "critical" in row["criticality"].lower()
                or "tier 1" in row["tier"].lower()
            )
        ]
        subject = "critical assets that are not Certified"
    elif "owner" in question_text or "steward" in question_text:
        selected = [row for row in rows if row["owner"].lower() == "unassigned"]
        subject = "assets missing owner evidence"
    else:
        selected = [
            row
            for row in rows
            if row["governance_status"].lower() != "enterprise ready"
            or row["certification"].lower() not in {"certified", "trusted"}
        ]
        subject = "priority governed metadata assets"
    if not selected:
        selected = rows[:3]
        subject = "priority governed metadata assets"
    selected = selected[:4]

    evidence = [
        {
            "type": "asset",
            "id": row["asset_fqn"],
            "assetFqn": row["asset_fqn"],
            "label": row["asset_fqn"],
            "metric": "workspaceScopedLiveMetadata",
            "domain": row["domain"],
            "certification": row["certification"],
            "criticality": row["criticality"],
            "owner": row["owner"],
            "source": "unity-catalog-inventory+governance-store",
        }
        for row in selected
    ]
    recommendations = [
        {
            "title": f"Review {row['asset_name']}",
            "detail": (
                f"{row['domain']} domain; {row['certification']} certification; "
                f"{row['criticality']} criticality; owner {row['owner']}."
            ),
            "provider": "governance-atlas-live-metadata",
            "evidence": [evidence[index]],
            "suggestedActions": [
                {"label": "Open asset", "surface": "entity", "assetFqn": row["asset_fqn"]},
                {"label": "Review governance", "surface": "governance"},
            ],
        }
        for index, row in enumerate(selected)
    ]
    bullets = "\n".join(
        f"- `{row['asset_fqn']}` - {row['domain']} / {row['certification']} / {row['owner']}"
        for row in selected
    )
    answer = (
        f"**Workspace-scoped governed evidence** found {len(selected)} {subject}.\n\n"
        f"{bullets}\n\n"
        "Genie cannot run for this actor until Databricks OBO is available, so this answer uses only live Unity Catalog "
        "inventory and Governance Atlas control-plane metadata."
    )
    return {
        "question": question,
        "intent": "live_metadata",
        "answer": answer,
        "recommendations": recommendations,
        "evidence": evidence,
        "suggestedActions": [
            action
            for recommendation in recommendations
            for action in recommendation.get("suggestedActions", [])
        ][:4],
        "confidence": "workspace-scoped-live-metadata",
        "provider": "governance-atlas-live-metadata",
        "providerState": dict(genie_status or {}),
        "warnings": list(warnings or []),
    }


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
        _fast_bootstrap_inventory_summary,
        _request_cache_scope,
        _store_for_read,
        _uc_runtime_status_fast,
        _uc_for_request,
        _visible_assets,
    )
    from atlas.api.cache import _ttl_cache_pop

    runtime_status = _uc_runtime_status_fast()
    if runtime_status.get("state") != "live":
        message = (
            _normalize_str(runtime_status.get("message"))
            or "Command-center metrics are waiting on the live Databricks runtime."
        )
        return _wrap(
            atlas_metrics.empty_command_center_payload(),
            request,
            source="unity-catalog-inventory+governance-store",
            state="loading",
            authoritative=False,
            warnings=[message],
            capabilities={"runtimeState": runtime_status.get("state") or "loading"},
        )
    refresh_flag = _normalize_str(refresh).lower() in {"1", "true", "yes"}
    cache_scope = _normalize_str(_request_cache_scope(request)) or _request_scope_key(request)
    runtime_inventory_cache_key = f"runtime_inventory:{cache_scope}"
    if refresh_flag:
        _ttl_cache_pop(runtime_inventory_cache_key)
    cached_inventory = _ttl_fresh_value(runtime_inventory_cache_key, 300)
    summary = _fast_bootstrap_inventory_summary(cache_scope, start_background=True)
    if cached_inventory is None and summary.get("summaryState") == "loading":
        loading_payload = atlas_metrics.empty_command_center_payload()
        loading_payload["meta"] = {
            "warnings": [
                "Command-center metrics are hydrating from live Databricks metadata."
            ]
        }
        return _wrap(
            loading_payload,
            request,
            source="unity-catalog-inventory+governance-store",
            state="loading",
            authoritative=False,
            warnings=loading_payload["meta"]["warnings"],
            capabilities={"refresh": True},
        )
    uc_client = _uc_for_request(request)
    payload_cache_key = _route_cache_key("atlas_command_center_payload", cache_scope)
    if refresh_flag:
        _ttl_cache_pop(payload_cache_key)

    def load_command_center_payload() -> dict[str, Any]:
        visible_assets = cached_inventory if cached_inventory is not None else _visible_assets(request)
        return atlas_metrics.command_center_payload(
            visible_assets=visible_assets,
            store=_store_for_read(),
        )

    if not refresh_flag and _ttl_fresh_value(payload_cache_key, 45) is None:
        with _COMMAND_CENTER_WARMING_LOCK:
            should_warm = payload_cache_key not in _COMMAND_CENTER_WARMING
            if should_warm:
                _COMMAND_CENTER_WARMING.add(payload_cache_key)

        if should_warm:
            def warm_command_center_payload() -> None:
                try:
                    try:
                        _ttl_value(payload_cache_key, 45, load_command_center_payload)
                    except Exception:
                        pass
                finally:
                    with _COMMAND_CENTER_WARMING_LOCK:
                        _COMMAND_CENTER_WARMING.discard(payload_cache_key)

            threading.Thread(
                target=warm_command_center_payload,
                name="atlas-command-center-warm",
                daemon=True,
            ).start()

        loading_payload = atlas_metrics.empty_command_center_payload()
        loading_payload["meta"] = {
            "warnings": [
                "Command-center metrics are hydrating from live Databricks metadata."
            ]
        }
        return _wrap(
            loading_payload,
            request,
            source="unity-catalog-inventory+governance-store",
            state="loading",
            authoritative=False,
            warnings=loading_payload["meta"]["warnings"],
            capabilities={"refresh": True, "hydrating": True},
        )

    try:
        payload = _ttl_value(payload_cache_key, 45, load_command_center_payload)
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
        HIDDEN_CATALOGS,
        _asset_detail_payload,
        _asset_visibility_record,
        _direct_uc_metadata_writes_enabled,
        _ensure_live_runtime,
        _request_cache_scope,
        _store_for_read,
        _uc_for_request,
    )

    _ensure_live_runtime()
    visibility = _asset_visibility_record(asset_fqn, request)
    if visibility.get("visibilityState") == "loading":
        detail = asset_service.asset_loading_payload(asset_fqn)
        payload = atlas_metrics.asset_360_payload(detail=detail)
        reason = (
            visibility.get("reason")
            or "Asset 360 is hydrating from live Unity Catalog inventory."
        )
        return _wrap(
            payload,
            request,
            source="unity-catalog-detail+governance-store+quality-runner+lineage",
            state="loading",
            authoritative=False,
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            warnings=[reason],
            capabilities={
                "visibilityState": "loading",
                "requestedSections": [],
                "loadedSections": [],
                "deferredSections": detail.get("deferredSections") or [],
                "hydrating": True,
            },
        )
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
    uc_client = _uc_for_request(request)
    store = _store_for_read()
    cache_scope = _request_cache_scope(request)
    allow_direct_metadata_write = _direct_uc_metadata_writes_enabled(request)
    full_detail = asset_service.cached_asset_detail_payload(
        uc_client,
        asset_fqn,
        cache_scope=cache_scope,
        sections=sections,
    )
    hydrating = full_detail is None

    if hydrating:
        warm_key = f"{cache_scope}:{asset_fqn}:{','.join(sections)}"
        with _ASSET_360_WARMING_LOCK:
            should_warm = warm_key not in _ASSET_360_WARMING
            if should_warm:
                _ASSET_360_WARMING.add(warm_key)

        if should_warm:
            def warm_asset_360() -> None:
                try:
                    try:
                        asset_service.asset_detail_payload(
                            uc_client,
                            store,
                            asset_fqn,
                            cache_scope=cache_scope,
                            hidden_catalogs=HIDDEN_CATALOGS,
                            sections=sections,
                            allow_direct_metadata_write=allow_direct_metadata_write,
                        )
                    except Exception:
                        pass
                finally:
                    with _ASSET_360_WARMING_LOCK:
                        _ASSET_360_WARMING.discard(warm_key)

            threading.Thread(
                target=warm_asset_360,
                name=f"atlas-asset360-warm-{asset_fqn}",
                daemon=True,
            ).start()

        cached_header = asset_service.cached_asset_detail_payload(
            uc_client,
            asset_fqn,
            cache_scope=cache_scope,
            sections=["header", "activity"],
        )
        detail = cached_header or asset_service.asset_loading_payload(asset_fqn)
    else:
        detail = full_detail
    payload = atlas_metrics.asset_360_payload(detail=detail)
    warnings = []
    if not actor_scoped:
        warnings.append(
            "Operational usage and protected lineage context are degraded until Databricks per-user authorization / OBO is available for actor-scoped reads."
        )
    if hydrating:
        warnings.append(
            "Asset 360 is hydrating schema, properties, profiler, and operational context from live Databricks metadata."
        )
    return _wrap(
        payload,
        request,
        source="unity-catalog-detail+governance-store+quality-runner+lineage",
        state="loading" if hydrating else ("available" if actor_scoped else "degraded"),
        authoritative=actor_scoped and not hydrating,
        entity_fqn=asset_fqn,
        entity_id=asset_fqn,
        warnings=warnings or None,
        capabilities={
            "visibilityState": visibility.get("visibilityState"),
            "requestedSections": sections,
            "loadedSections": detail.get("loadedSections") or [],
            "deferredSections": detail.get("deferredSections") or [],
            "hydrating": hydrating,
        },
    )


def api_governance_workbench(request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read

    _ensure_live_runtime()
    cache_key = _route_cache_key("atlas_governance_workbench_payload", _request_scope_key(request))
    payload = _ttl_value(
        cache_key,
        30,
        lambda: atlas_metrics.governance_workbench_payload(store=_store_for_read()),
    )
    payload_meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    source_available = payload_meta.get("sourceAvailable") is not False
    source_reason = _normalize_str(payload_meta.get("sourceReason")) or "Governance store requests are unavailable."
    return _wrap(
        payload,
        request,
        source="governance-store",
        state="available" if source_available else "unavailable",
        authoritative=source_available,
        warnings=None if source_available else [source_reason],
    )


def api_governance_request_detail(request_id: str, request: Request) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read

    _ensure_live_runtime()
    cache_key = _route_cache_key(
        "atlas_governance_request_detail_payload",
        _request_scope_key(request),
        request_id,
    )
    payload = _ttl_value(
        cache_key,
        30,
        lambda: atlas_metrics.governance_request_detail_payload(
            store=_store_for_read(),
            request_id=request_id,
        ),
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
    cache_key = _route_cache_key("atlas_insights_dashboard_payload", _request_scope_key(request))
    payload = _ttl_value(
        cache_key,
        45,
        lambda: atlas_metrics.insights_dashboard_payload(
            visible_assets=_visible_assets(request),
            store=_store_for_read(),
        ),
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


def api_taxonomy_overview(
    request: Request,
    refresh: Optional[str] = Query(default=None),
) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read, _uc_for_request

    _ensure_live_runtime()
    refresh_flag = _normalize_str(refresh).lower() in {"1", "true", "yes"}
    cache_key = _route_cache_key(
        "atlas_taxonomy_overview",
        _request_auth_mode(request),
        _user_email(request),
    )
    if refresh_flag:
        _ttl_cache_pop(cache_key)

    def load_taxonomy_overview() -> dict[str, Any]:
        store = _store_for_read()
        warnings: list[str] = []
        enriched_glossary = None
        try:
            enriched_glossary = governance_service.glossary_terms(
                _uc_for_request(request),
                store,
                actor_email=_user_email(request),
                limit=120,
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
        return {
            "payload": payload,
            "warnings": warnings,
            "capabilities": {
                "glossaryEnriched": enriched_glossary is not None,
                "classificationTree": bool(payload.get("classifications")),
                "domainTree": bool(payload.get("domains")),
                "dataProducts": bool(payload.get("dataProducts")),
                "columnGroups": bool(payload.get("columnGroups")),
            },
        }

    cached_entry = _ttl_fresh_value(cache_key, 90)
    if not refresh_flag and cached_entry is None:
        with _TAXONOMY_OVERVIEW_WARMING_LOCK:
            should_warm = cache_key not in _TAXONOMY_OVERVIEW_WARMING
            if should_warm:
                _TAXONOMY_OVERVIEW_WARMING.add(cache_key)

        if should_warm:
            def warm_taxonomy_overview() -> None:
                try:
                    try:
                        _ttl_value(cache_key, 90, load_taxonomy_overview)
                    except Exception:
                        pass
                finally:
                    with _TAXONOMY_OVERVIEW_WARMING_LOCK:
                        _TAXONOMY_OVERVIEW_WARMING.discard(cache_key)

            threading.Thread(
                target=warm_taxonomy_overview,
                name="atlas-taxonomy-overview-warm",
                daemon=True,
            ).start()

        payload = atlas_metrics.taxonomy_overview_payload(store=None, glossary_terms=[])
        return _wrap(
            payload,
            request,
            source="governance-store+unity-catalog-inventory",
            state="loading",
            authoritative=False,
            warnings=["Taxonomy overview is hydrating from the governance store and Unity Catalog metadata."],
            capabilities={
                "glossaryEnriched": False,
                "classificationTree": False,
                "domainTree": False,
                "dataProducts": False,
                "columnGroups": False,
                "hydrating": True,
            },
        )

    cached = _ttl_value(cache_key, 90, load_taxonomy_overview)
    payload = cached.get("payload") if isinstance(cached, dict) else {}
    warnings = cached.get("warnings") if isinstance(cached, dict) else []
    capabilities = cached.get("capabilities") if isinstance(cached, dict) else {}
    return _wrap(
        payload,
        request,
        source="governance-store+unity-catalog-inventory",
        state="degraded" if warnings else "available",
        authoritative=not warnings,
        warnings=warnings or None,
        capabilities=capabilities,
    )


def api_cde_dashboard(
    request: Request,
    refresh: Optional[str] = Query(default=None),
) -> JSONResponse:
    from runtime_app import (
        _cached_visible_assets,
        _ensure_live_runtime,
        _fast_bootstrap_inventory_summary,
        _request_cache_scope,
        _visible_assets,
    )

    _ensure_live_runtime()
    cache_key = _route_cache_key("atlas_cde_dashboard_payload", _request_scope_key(request))
    refresh_flag = _normalize_str(refresh).lower() in {"1", "true", "yes"}
    if refresh_flag:
        _ttl_cache_pop(cache_key)
    cached_entry = _ttl_fresh_value(cache_key, 60)
    if cached_entry is None and _cached_visible_assets(request) is None and not refresh_flag:
        _fast_bootstrap_inventory_summary(_request_cache_scope(request), start_background=True)
        with _CDE_DASHBOARD_WARMING_LOCK:
            should_warm = cache_key not in _CDE_DASHBOARD_WARMING
            if should_warm:
                _CDE_DASHBOARD_WARMING.add(cache_key)

        if should_warm:
            def warm_cde_dashboard() -> None:
                try:
                    try:
                        _ttl_value(
                            cache_key,
                            60,
                            lambda: atlas_metrics.cde_dashboard_payload(
                                visible_assets=_visible_assets(request)
                            ),
                        )
                    except Exception:
                        pass
                finally:
                    with _CDE_DASHBOARD_WARMING_LOCK:
                        _CDE_DASHBOARD_WARMING.discard(cache_key)

            threading.Thread(
                target=warm_cde_dashboard,
                name="atlas-cde-dashboard-warm",
                daemon=True,
            ).start()

        payload = atlas_metrics.cde_dashboard_payload(visible_assets=pd.DataFrame())
        return _wrap(
            payload,
            request,
            source="unity-catalog-inventory+governance-store",
            state="loading",
            authoritative=False,
            warnings=[
                "CDE dashboard is hydrating from actor-visible Unity Catalog inventory."
            ],
            capabilities={"controlCoverage": False, "hydrating": True},
        )
    payload = _ttl_value(
        cache_key,
        60,
        lambda: atlas_metrics.cde_dashboard_payload(visible_assets=_visible_assets(request)),
    )
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
    cache_key = _route_cache_key("atlas_cde_detail_payload", _request_scope_key(request), cde_id)
    payload = _ttl_value(
        cache_key,
        60,
        lambda: atlas_metrics.cde_detail_payload(
            visible_assets=_visible_assets(request),
            cde_id=cde_id,
        ),
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
    refresh: Optional[str] = Query(default=None),
) -> JSONResponse:
    from runtime_app import _ensure_live_runtime, _store_for_read, _visible_assets

    _ensure_live_runtime()
    actor_role = _steward_or_admin(request)
    audit_id_value = audit_id if isinstance(audit_id, str) else None
    date_range_value = date_range if isinstance(date_range, str) else None
    limit_value = int(limit) if isinstance(limit, int) else 200
    refresh_flag = _normalize_str(refresh).lower() in {"1", "true", "yes"}

    def load_audit_payload() -> dict[str, Any]:
        try:
            visible_asset_fqns = _extract_visible_asset_fqns(_visible_assets(request))
        except Exception as exc:
            detail = (
                _normalize_str(exc)
                or "Audit visibility scope could not be verified."
            )
            return {
                "visibilityError": detail,
                "visibleAssetFqns": [],
                "payload": {},
            }
        return {
            "visibleAssetFqns": visible_asset_fqns,
            "payload": atlas_metrics.audit_evidence_payload(
                store=_store_for_read(),
                audit_id=audit_id_value,
                date_range=date_range_value,
                limit=limit_value,
                visible_asset_fqns=visible_asset_fqns,
            ),
        }

    cache_key = _route_cache_key(
        "atlas_audit_evidence_payload",
        _request_scope_key(request),
        audit_id_value,
        date_range_value,
        limit_value,
    )
    if refresh_flag:
        _ttl_cache_pop(cache_key)
    if not refresh_flag and _ttl_fresh_value(cache_key, 30) is None and audit_id_value is None:
        with _AUDIT_EVIDENCE_WARMING_LOCK:
            should_warm = cache_key not in _AUDIT_EVIDENCE_WARMING
            if should_warm:
                _AUDIT_EVIDENCE_WARMING.add(cache_key)

        if should_warm:
            def warm_audit_payload() -> None:
                try:
                    try:
                        _ttl_value(cache_key, 30, load_audit_payload)
                    except Exception:
                        pass
                finally:
                    with _AUDIT_EVIDENCE_WARMING_LOCK:
                        _AUDIT_EVIDENCE_WARMING.discard(cache_key)

            threading.Thread(
                target=warm_audit_payload,
                name="atlas-audit-evidence-warm",
                daemon=True,
            ).start()

        payload = atlas_metrics.audit_evidence_payload(
            store=None,
            audit_id=audit_id_value,
            date_range=date_range_value,
            limit=limit_value,
            visible_asset_fqns=[],
        )
        return _wrap(
            payload,
            request,
            source="governance-store+metadata-audit-log",
            state="loading",
            authoritative=False,
            entity_id=audit_id_value,
            warnings=["Audit evidence is hydrating from visible assets and the metadata audit log."],
            capabilities={
                "requiredRole": "steward-or-admin",
                "actorRole": actor_role,
                "rowLevelSecurity": "visible-assets-only",
                "actorIdentityExposure": "steward-admin-gated",
                "visibleAssetCount": 0,
                "hydrating": True,
            },
        )
    audit_payload = _ttl_value(cache_key, 30, load_audit_payload)
    detail = (
        _normalize_str(audit_payload.get("visibilityError"))
        if isinstance(audit_payload, dict)
        else ""
    )
    if detail:
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
    visible_asset_fqns = (
        audit_payload.get("visibleAssetFqns")
        if isinstance(audit_payload, dict) and isinstance(audit_payload.get("visibleAssetFqns"), list)
        else []
    )
    payload = (
        audit_payload.get("payload")
        if isinstance(audit_payload, dict) and isinstance(audit_payload.get("payload"), dict)
        else {}
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


def api_admin_control_center(
    request: Request,
    refresh: Optional[str] = Query(default=None),
) -> JSONResponse:
    from runtime_app import (
        _config,
        _ensure_live_runtime,
        _fast_bootstrap_inventory_summary,
        _request_cache_scope,
        _store_for_read,
        _uc_runtime_status_fast,
        _uc_for_request,
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
    cache_key = _route_cache_key(
        "atlas_admin_control_center_payload",
        _request_scope_key(request),
        cfg.environment_label,
        cfg.gov_catalog,
        cfg.gov_schema,
    )
    refresh_flag = _normalize_str(refresh).lower() in {"1", "true", "yes"}
    if refresh_flag:
        _ttl_cache_pop(cache_key)
    def load_admin_payload() -> dict[str, Any]:
        try:
            ai_status = genie_service.provider_status(cfg)
        except Exception as exc:
            ai_status = {
                "state": "unavailable",
                "provider": "genie",
                "message": f"{exc.__class__.__name__}: {exc}",
            }
        return atlas_metrics.admin_control_center_payload(
            visible_assets=_visible_assets(request),
            store=_store_for_read(),
            runtime=_uc_runtime_status_fast(background=True),
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
            jobs=_databricks_job_inventory(
                _uc_for_request(request),
                workspace_host=cfg.workspace_host,
            ),
        )

    cached_entry = _ttl_fresh_value(cache_key, 45)
    if cached_entry is None and not refresh_flag:
        _fast_bootstrap_inventory_summary(_request_cache_scope(request), start_background=True)
        with _ADMIN_CONTROL_WARMING_LOCK:
            should_warm = cache_key not in _ADMIN_CONTROL_WARMING
            if should_warm:
                _ADMIN_CONTROL_WARMING.add(cache_key)

        if should_warm:
            def warm_admin_payload() -> None:
                try:
                    try:
                        _ttl_value(cache_key, 45, load_admin_payload)
                    except Exception:
                        pass
                finally:
                    with _ADMIN_CONTROL_WARMING_LOCK:
                        _ADMIN_CONTROL_WARMING.discard(cache_key)

            threading.Thread(
                target=warm_admin_payload,
                name="atlas-admin-control-warm",
                daemon=True,
            ).start()

        try:
            ai_status = genie_service.provider_status(cfg)
        except Exception as exc:
            ai_status = {
                "state": "unavailable",
                "provider": "genie",
                "message": f"{exc.__class__.__name__}: {exc}",
            }
        payload = atlas_metrics.admin_control_center_payload(
            visible_assets=pd.DataFrame(),
            store=None,
            runtime=_uc_runtime_status_fast(background=True),
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
            jobs=[],
        )
        return _wrap(
            payload,
            request,
            source="runtime-diagnostics+governance-store",
            state="loading",
            authoritative=False,
            warnings=["Control Center is hydrating visible assets, governance store, and Databricks job inventory."],
            capabilities={"hydrating": True},
        )

    payload = _ttl_value(cache_key, 45, load_admin_payload)
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
                    "recommendations are unavailable for this actor until OBO is available."
                )
                metadata_payload = _live_metadata_atlas_ai_payload(
                    question,
                    request,
                    genie_status=genie_status,
                    warnings=[
                        genie_warning,
                        (
                            "Atlas AI response is backed by workspace-scoped Unity Catalog and Governance Atlas "
                            "metadata only; it is not a Databricks Genie/OBO answer."
                        ),
                    ],
                )
                if metadata_payload:
                    return _wrap(
                        metadata_payload,
                        request,
                        source="unity-catalog-inventory+governance-store+databricks-genie-status",
                        state="degraded",
                        authoritative=False,
                        capabilities={
                            "provider": "governance-atlas-live-metadata",
                            "genie": genie_status,
                            "evidenceBacked": True,
                            "sampleValuesIncluded": False,
                            "piiValuesIncluded": False,
                        },
                        warnings=metadata_payload.get("warnings") or None,
                    )
            else:
                token_fragment = hashlib.sha256(forwarded_token.encode("utf-8")).hexdigest()[:12]
                genie_cache_key = _route_cache_key(
                    "atlas_ai_recommendations",
                    genie_status.get("spaceId", ""),
                    token_fragment,
                    question or "__default__",
                )
                cached_payload = _ttl_value(
                    genie_cache_key,
                    120,
                    lambda: genie_service.ask_genie(
                        config=cfg,
                        question=question,
                        user_access_token=forwarded_token,
                    ),
                )
                payload = dict(cached_payload or {})
                payload_warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
                has_evidence = bool(payload.get("evidence"))
                if not payload.get("recommendations") and has_evidence:
                    recommendations = _recommendations_from_genie_evidence(payload.get("evidence") or [])
                    if recommendations:
                        payload = {
                            **payload,
                            "recommendations": recommendations,
                            "suggestedActions": [
                                action
                                for recommendation in recommendations
                                for action in recommendation.get("suggestedActions", [])
                            ][:4],
                        }
                if not payload.get("recommendations"):
                    payload_warnings = [
                        *payload_warnings,
                        "Genie returned no evidence-backed recommendations; local governance-store recommendations were not substituted.",
                    ]
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

    warnings = []
    if genie_warning:
        warnings.append(genie_warning)
    if genie_status.get("provider") != "genie":
        warnings.append("Atlas AI recommendations require a configured Databricks Genie space.")
    if not warnings:
        warnings.append("Atlas AI recommendations are unavailable until Databricks Genie returns evidence.")
    payload = {
        "question": question,
        "intent": "unavailable",
        "answer": "",
        "recommendations": [],
        "evidence": [],
        "suggestedActions": [],
        "confidence": "unavailable",
        "provider": "unavailable",
        "providerState": genie_status,
        "warnings": warnings,
    }
    return _wrap(
        payload,
        request,
        source="runtime-configuration+databricks-genie",
        state="unavailable",
        authoritative=False,
        capabilities={
            "provider": "genie",
            "genie": genie_status,
            "evidenceBacked": False,
            "sampleValuesIncluded": False,
            "piiValuesIncluded": False,
        },
        warnings=warnings,
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
