"""Phase 8/10/11/13 — consolidated catalog router.

Groups together:
- custom properties (Phase 8)
- profile (Phase 8)
- quality (Phase 10)
- classifications / domains / data-products / logical column groups (Phase 11)
- audit browser (Phase 13)

Each surface is a thin wrapper around the store; business-logic guards
live in the services modules (custom_properties, quality, export).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from govhub.api.identity import _request_auth_mode, _user_email
from govhub.services import capabilities as capability_service
from govhub.services import custom_properties as cp_service
from govhub.services import quality as quality_service
from govhub.services.assets import normalize_str as _normalize_str
from govhub.services.metadata_audit import record_audit_log


def _ts(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _as_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _df_records(frame: pd.DataFrame) -> List[Dict[str, Any]]:
    if frame is None or getattr(frame, "empty", True):
        return []
    return [row.to_dict() for _, row in frame.iterrows()]


def _envelope(data: Any, *, source: str = "control_plane", extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "authoritative": True,
        "source": source,
        "observedAt": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        meta.update(extra)
    return {"data": data, "meta": meta, "errors": []}


# -----------------------------------------------------------------------------
# Custom properties (Phase 8)
# -----------------------------------------------------------------------------


class CustomPropertyDefinitionPayload(BaseModel):
    entityKind: str
    propertyKey: str
    displayName: str | None = None
    description: str | None = None
    dataType: str
    enumValues: Optional[List[str]] = None
    isRequired: bool = False
    isMulti: bool = False
    scope: Optional[Dict[str, Any]] = None
    changeSummary: str | None = None


class CustomPropertyAssignmentPayload(BaseModel):
    definitionId: str
    value: Any = None
    entityFqn: str | None = None
    columnName: str | None = None


def _admin_required(request: Request) -> str:
    from runtime_app import _user_role_slug
    role = _user_role_slug(request)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    return role


def _steward_or_admin(request: Request) -> str:
    from runtime_app import _user_role_slug
    role = _user_role_slug(request)
    if role not in ("admin", "steward"):
        raise HTTPException(status_code=403, detail="Steward or admin role required.")
    return role


def _store_read():
    from runtime_app import _ensure_governance_store, _ensure_live_runtime, _store

    _ensure_live_runtime()
    _ensure_governance_store()
    return _store()


def api_list_custom_property_definitions(
    request: Request,
    entityKind: Optional[str] = None,
) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.list_custom_property_definitions(entity_kind=entityKind)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list definitions: {exc}")
    rows = _df_records(frame)
    for row in rows:
        for ts_key in ("created_at", "updated_at"):
            row[ts_key] = _ts(row.get(ts_key))
    return JSONResponse(status_code=200, content=_envelope(rows))


def api_create_custom_property_definition(
    payload: CustomPropertyDefinitionPayload,
    request: Request,
) -> JSONResponse:
    _admin_required(request)
    actor = _user_email(request) or "unknown"
    try:
        normalized = cp_service.normalize_definition_payload(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    store = _store_read()
    definition_id = cp_service.new_id()
    try:
        store.insert_custom_property_definition(
            definition_id=definition_id,
            entity_kind=normalized["entityKind"],
            property_key=normalized["propertyKey"],
            display_name=normalized["displayName"],
            description=normalized["description"],
            data_type=normalized["dataType"],
            enum_values=normalized["enumValues"] or None,
            is_required=normalized["isRequired"],
            is_multi=normalized["isMulti"],
            scope=normalized["scope"] or None,
            created_by=actor,
        )
        store.insert_custom_property_definition_version(
            version_id=cp_service.new_id(),
            definition_id=definition_id,
            version_number=1,
            snapshot_json=cp_service.definition_snapshot_json(normalized),
            change_summary=payload.changeSummary,
            recorded_by=actor,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create definition: {exc}")
    record_audit_log(
        entity_type="custom_property_definition",
        action="created",
        actor_email=actor,
        actor_role="admin",
        entity_id=definition_id,
        after=normalized,
    )
    return JSONResponse(
        status_code=201,
        content=_envelope({"definitionId": definition_id, **normalized}),
    )


def api_upsert_custom_property_assignment(
    payload: CustomPropertyAssignmentPayload,
    request: Request,
) -> JSONResponse:
    role = _steward_or_admin(request)
    actor = _user_email(request) or "unknown"
    store = _store_read()
    try:
        defs = store.list_custom_property_definitions(state="active")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to resolve definitions: {exc}")
    match = None
    if defs is not None and not defs.empty:
        for _, row in defs.iterrows():
            if str(row.get("definition_id")) == payload.definitionId:
                match = row.to_dict()
                break
    if not match:
        raise HTTPException(status_code=404, detail="Custom property definition not found.")
    enum_values: Optional[List[str]] = None
    raw_enum = match.get("enum_values_json")
    if raw_enum:
        try:
            import json
            enum_values = json.loads(raw_enum)
        except Exception:
            enum_values = None
    validation = cp_service.validate_value(
        str(match.get("data_type") or ""),
        payload.value,
        enum_values=enum_values,
        is_required=bool(match.get("is_required")),
        is_multi=bool(match.get("is_multi")),
    )
    if not validation.ok:
        raise HTTPException(status_code=400, detail=validation.reason)
    if (match.get("entity_kind") or "").lower() == "column" and not payload.columnName:
        raise HTTPException(status_code=400, detail="columnName is required for column-scoped properties.")
    assignment_id = cp_service.new_id()
    try:
        store.upsert_custom_property_assignment(
            assignment_id=assignment_id,
            definition_id=payload.definitionId,
            definition_version=1,
            entity_kind=str(match.get("entity_kind")),
            entity_fqn=_normalize_str(payload.entityFqn),
            column_name=_normalize_str(payload.columnName),
            value=validation.value,
            actor_email=actor,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to persist assignment: {exc}")
    record_audit_log(
        entity_type="custom_property_assignment",
        action="upserted",
        actor_email=actor,
        actor_role=role,
        entity_fqn=payload.entityFqn,
        column_name=payload.columnName,
        after={
            "definitionId": payload.definitionId,
            "propertyKey": match.get("property_key"),
            "value": validation.value,
        },
    )
    return JSONResponse(
        status_code=200,
        content=_envelope({
            "assignmentId": assignment_id,
            "propertyKey": match.get("property_key"),
            "value": validation.value,
        }),
    )


def api_asset_custom_properties(
    asset_fqn: str,
    request: Request,
) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.list_custom_property_assignments(entity_fqn=asset_fqn)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list assignments: {exc}")
    rows = _df_records(frame)
    import json
    for row in rows:
        for key in ("created_at", "updated_at"):
            row[key] = _ts(row.get(key))
        value_raw = row.pop("value_json", None)
        if value_raw:
            try:
                row["value"] = json.loads(value_raw)
            except Exception:
                row["value"] = value_raw
        else:
            row["value"] = None
    return JSONResponse(status_code=200, content=_envelope(rows))


# -----------------------------------------------------------------------------
# Profile (Phase 8)
# -----------------------------------------------------------------------------


def api_asset_profile(asset_fqn: str, request: Request) -> JSONResponse:
    store = _store_read()
    import json
    try:
        run = store.latest_profile_run_for_entity(asset_fqn)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read profile: {exc}")
    if not run:
        return JSONResponse(
            status_code=200,
            content=_envelope(
                {"run": None, "tableMetrics": None, "columnMetrics": []},
                extra={"degraded": True, "warnings": ["No profile runs recorded for this entity."]},
            ),
        )
    run_id = run.get("profile_run_id")
    try:
        table_frame = store.profile_table_metrics_for_run(run_id)
        column_frame = store.profile_column_metrics_for_run(run_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read profile metrics: {exc}")
    table_rows = _df_records(table_frame)
    column_rows = _df_records(column_frame)
    def _expand(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        for row in rows:
            for key in ("observed_at",):
                row[key] = _ts(row.get(key))
            for json_key in ("detail_json", "quantiles_json", "top_values_json"):
                raw = row.pop(json_key, None)
                if raw:
                    try:
                        row[json_key.replace("_json", "")] = json.loads(raw)
                    except Exception:
                        row[json_key.replace("_json", "")] = None
        return rows
    run_payload = {
        "profileRunId": run_id,
        "entityFqn": run.get("entity_fqn"),
        "trigger": run.get("trigger"),
        "status": run.get("status"),
        "sampleStrategy": run.get("sample_strategy"),
        "sampleRows": _as_int(run.get("sample_rows")),
        "startedAt": _ts(run.get("started_at")),
        "finishedAt": _ts(run.get("finished_at")),
        "notes": run.get("notes"),
    }
    return JSONResponse(
        status_code=200,
        content=_envelope(
            {
                "run": run_payload,
                "tableMetrics": _expand(table_rows)[:1] or None,
                "columnMetrics": _expand(column_rows),
            }
        ),
    )


# -----------------------------------------------------------------------------
# Quality (Phase 10)
# -----------------------------------------------------------------------------


class QualityRunRequest(BaseModel):
    suiteId: str | None = None
    trigger: str = "manual"
    rowBudget: int | None = None
    byteBudget: int | None = None
    timeBudgetMs: int | None = None
    summary: Optional[Dict[str, Any]] = None


def api_list_quality_runs(
    request: Request,
    entityFqn: str | None = None,
    suiteId: str | None = None,
    limit: int = 50,
) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.list_quality_runs(
            entity_fqn=entityFqn,
            suite_id=suiteId,
            limit=max(1, min(int(limit), 200)),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list quality runs: {exc}")
    import json
    rows = _df_records(frame)
    for row in rows:
        row["started_at"] = _ts(row.get("started_at"))
        row["finished_at"] = _ts(row.get("finished_at"))
        raw_summary = row.pop("summary_json", None)
        if raw_summary:
            try:
                row["summary"] = json.loads(raw_summary)
            except Exception:
                row["summary"] = None
        else:
            row["summary"] = None
    return JSONResponse(status_code=200, content=_envelope(rows))


def api_asset_quality(asset_fqn: str, request: Request) -> JSONResponse:
    store = _store_read()
    try:
        results_frame = store.list_quality_run_results(entity_fqn=asset_fqn, limit=200)
        runs_frame = store.list_quality_runs(entity_fqn=asset_fqn, limit=25)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read quality: {exc}")
    import json
    results = _df_records(results_frame)
    for row in results:
        row["executed_at"] = _ts(row.get("executed_at"))
        raw_ev = row.pop("evidence_json", None)
        if raw_ev:
            try:
                row["evidence"] = json.loads(raw_ev)
            except Exception:
                row["evidence"] = None
    runs = _df_records(runs_frame)
    for row in runs:
        row["started_at"] = _ts(row.get("started_at"))
        row["finished_at"] = _ts(row.get("finished_at"))
    summary = quality_service.summarize_run_results(results)
    return JSONResponse(
        status_code=200,
        content=_envelope({"runs": runs, "results": results, "summary": summary}),
    )


class QualityCustomSqlRequest(BaseModel):
    targetEntityFqn: str
    sql: str
    allowedComparisons: Optional[List[str]] = None
    rowBudget: int | None = None
    byteBudget: int | None = None
    timeBudgetMs: int | None = None


def api_quality_validate_custom_sql(
    payload: QualityCustomSqlRequest,
    request: Request,
) -> JSONResponse:
    _steward_or_admin(request)
    validation = quality_service.validate_custom_sql(
        payload.sql,
        target_entity_fqn=payload.targetEntityFqn,
        allowed_comparisons=payload.allowedComparisons or (),
    )
    budget = quality_service.check_budgets(
        row_budget=payload.rowBudget,
        byte_budget=payload.byteBudget,
        time_budget_ms=payload.timeBudgetMs,
    )
    return JSONResponse(
        status_code=200,
        content=_envelope({
            "sql": {
                "ok": validation.ok,
                "reason": validation.reason,
                "normalized": validation.normalized,
            },
            "budget": {
                "ok": budget.ok,
                "reason": budget.reason,
                "rowBudget": budget.row_budget,
                "byteBudget": budget.byte_budget,
                "timeBudgetMs": budget.time_budget_ms,
            },
        }),
    )


# -----------------------------------------------------------------------------
# Classifications / domains / data products / column groups (Phase 11)
# -----------------------------------------------------------------------------


def api_list_classifications(request: Request) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.list_classifications()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list classifications: {exc}")
    rows = _df_records(frame)
    for row in rows:
        row["created_at"] = _ts(row.get("created_at"))
        row["updated_at"] = _ts(row.get("updated_at"))
        row["term_count"] = _as_int(row.get("term_count")) or 0
    return JSONResponse(status_code=200, content=_envelope(rows))


def api_get_classification(classification_id: str, request: Request) -> JSONResponse:
    store = _store_read()
    try:
        classifications_frame = store.list_classifications()
        terms_frame = store.list_classification_terms(classification_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read classification: {exc}")
    classification = None
    if classifications_frame is not None and not classifications_frame.empty:
        for _, row in classifications_frame.iterrows():
            if str(row.get("classification_id")) == classification_id:
                classification = row.to_dict()
                break
    if not classification:
        raise HTTPException(status_code=404, detail="Classification not found.")
    terms = _df_records(terms_frame)
    for term in terms:
        term["created_at"] = _ts(term.get("created_at"))
        term["updated_at"] = _ts(term.get("updated_at"))
    classification["created_at"] = _ts(classification.get("created_at"))
    classification["updated_at"] = _ts(classification.get("updated_at"))
    classification["term_count"] = _as_int(classification.get("term_count")) or len(terms)
    return JSONResponse(
        status_code=200,
        content=_envelope({"classification": classification, "terms": terms}),
    )


def api_list_domains(request: Request) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.list_domains()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list domains: {exc}")
    rows = _df_records(frame)
    for row in rows:
        row["created_at"] = _ts(row.get("created_at"))
        row["updated_at"] = _ts(row.get("updated_at"))
    return JSONResponse(status_code=200, content=_envelope(rows))


def api_list_data_products(request: Request) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.list_data_products()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list data products: {exc}")
    rows = _df_records(frame)
    for row in rows:
        row["created_at"] = _ts(row.get("created_at"))
        row["updated_at"] = _ts(row.get("updated_at"))
        row["member_count"] = _as_int(row.get("member_count")) or 0
    return JSONResponse(status_code=200, content=_envelope(rows))


def api_list_logical_column_groups(request: Request) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.list_logical_column_groups()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list column groups: {exc}")
    import json
    rows = _df_records(frame)
    for row in rows:
        row["last_reviewed_at"] = _ts(row.get("last_reviewed_at"))
        row["member_count"] = _as_int(row.get("member_count")) or 0
        row["confidence"] = _as_float(row.get("confidence"))
        raw_rule = row.pop("match_rule_json", None)
        if raw_rule:
            try:
                row["matchRule"] = json.loads(raw_rule)
            except Exception:
                row["matchRule"] = None
        else:
            row["matchRule"] = None
    return JSONResponse(status_code=200, content=_envelope(rows))


def api_get_logical_column_group(group_id: str, request: Request) -> JSONResponse:
    store = _store_read()
    try:
        frame = store.get_logical_column_group(group_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read column group: {exc}")
    if frame is None or frame.empty:
        raise HTTPException(status_code=404, detail="Column group not found.")
    import json
    rows = _df_records(frame)
    header = {
        "groupId": rows[0].get("group_id"),
        "displayName": rows[0].get("display_name"),
        "description": rows[0].get("description"),
        "confidence": _as_float(rows[0].get("confidence")),
        "state": rows[0].get("state"),
        "lastReviewedAt": _ts(rows[0].get("last_reviewed_at")),
        "lastReviewedBy": rows[0].get("last_reviewed_by"),
    }
    raw_rule = rows[0].get("match_rule_json")
    if raw_rule:
        try:
            header["matchRule"] = json.loads(raw_rule)
        except Exception:
            header["matchRule"] = None
    members: List[Dict[str, Any]] = []
    conflicts: Dict[str, set] = {"descriptions": set(), "tags": set(), "glossaryTermIds": set()}
    for row in rows:
        if not row.get("membership_id"):
            continue
        member = {
            "membershipId": row.get("membership_id"),
            "entityFqn": row.get("entity_fqn"),
            "columnName": row.get("column_name"),
            "dataType": row.get("column_data_type"),
            "currentDescription": row.get("current_description"),
            "currentGlossaryTermId": row.get("current_glossary_term_id"),
            "matchConfidence": _as_float(row.get("match_confidence")),
            "lastSeenAt": _ts(row.get("last_seen_at")),
        }
        raw_tags = row.get("current_tags_json")
        if raw_tags:
            try:
                member["currentTags"] = json.loads(raw_tags)
            except Exception:
                member["currentTags"] = None
        if member.get("currentDescription"):
            conflicts["descriptions"].add(str(member["currentDescription"]))
        if member.get("currentGlossaryTermId"):
            conflicts["glossaryTermIds"].add(str(member["currentGlossaryTermId"]))
        current_tags = member.get("currentTags")
        if isinstance(current_tags, list):
            for tag in current_tags:
                conflicts["tags"].add(str(tag))
        members.append(member)
    header["conflictCounts"] = {key: len(value) for key, value in conflicts.items()}
    return JSONResponse(
        status_code=200,
        content=_envelope({"group": header, "members": members}),
    )


# -----------------------------------------------------------------------------
# Audit browser (Phase 13)
# -----------------------------------------------------------------------------


def api_audit_events(
    request: Request,
    actorEmail: str | None = None,
    entityFqn: str | None = None,
    entityKind: str | None = None,
    action: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 200,
) -> JSONResponse:
    # Gate to admins + stewards. Readers should not see audit trails.
    _steward_or_admin(request)
    store = _store_read()
    try:
        frame = store.list_audit_events(
            actor_email=actorEmail,
            entity_fqn=entityFqn,
            entity_kind=entityKind,
            action=action,
            since=since,
            until=until,
            limit=max(1, min(int(limit), 500)),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read audit events: {exc}")
    import json
    rows = _df_records(frame)
    for row in rows:
        row["created_at"] = _ts(row.get("created_at"))
        for key in ("before_json", "after_json"):
            raw = row.pop(key, None)
            if raw:
                try:
                    row[key.replace("_json", "")] = json.loads(raw)
                except Exception:
                    row[key.replace("_json", "")] = None
    return JSONResponse(status_code=200, content=_envelope(rows))


# -----------------------------------------------------------------------------
# Phase 14 — Databricks differentiation: access explainer
# -----------------------------------------------------------------------------


def api_access_explainer(asset_fqn: str, request: Request) -> JSONResponse:
    """Phase 14 — "Why can't I access this?" explainer.
    Returns the auth mode, the actor's capability bundle, and a concrete
    remediation list. The asset FQN is optional context — this is
    designed to also work for generic auth diagnostics."""
    from runtime_app import _ensure_live_runtime

    _ensure_live_runtime()
    auth_mode = _request_auth_mode(request)
    actor_email = _user_email(request) or "unknown"
    scope = capability_service.runtime_visibility_scope(auth_mode)
    remediation: List[Dict[str, str]] = []
    if auth_mode != capability_service.OBO_AVAILABLE_MODE:
        remediation.append(
            {
                "label": "Enable per-user authorization (OBO)",
                "detail": (
                    "Open Governance Hub from an authenticated Databricks browser "
                    "session so Unity Catalog enforces your own permissions."
                ),
            }
        )
    if not actor_email or actor_email == "unknown":
        remediation.append(
            {
                "label": "Sign in with your Databricks identity",
                "detail": "Your actor identity headers are missing — reload the page from the workspace.",
            }
        )
    catalog_explorer_url = None
    jobs_url = None
    query_history_url = None
    fqn = _normalize_str(asset_fqn)
    if fqn and fqn.count(".") >= 2:
        parts = fqn.split(".")
        catalog_explorer_url = (
            f"/explore/data/{parts[0]}/{parts[1]}/{'/'.join(parts[2:])}"
        )
        jobs_url = "/jobs"
        query_history_url = "/sql/history"
    return JSONResponse(
        status_code=200,
        content=_envelope(
            {
                "assetFqn": fqn or None,
                "authMode": auth_mode,
                "visibilityScope": scope,
                "actorEmail": actor_email,
                "remediation": remediation,
                "deepLinks": {
                    "catalogExplorer": catalog_explorer_url,
                    "jobs": jobs_url,
                    "queryHistory": query_history_url,
                },
            }
        ),
    )


# -----------------------------------------------------------------------------
# Router factory
# -----------------------------------------------------------------------------


def build_catalog_router() -> APIRouter:
    router = APIRouter(tags=["catalog"])

    # Phase 8 — custom properties
    router.add_api_route(
        "/api/custom-properties/definitions",
        api_list_custom_property_definitions,
        methods=["GET"],
        name="api_list_custom_property_definitions",
    )
    router.add_api_route(
        "/api/custom-properties/definitions",
        api_create_custom_property_definition,
        methods=["POST"],
        name="api_create_custom_property_definition",
    )
    router.add_api_route(
        "/api/custom-properties/assignments",
        api_upsert_custom_property_assignment,
        methods=["POST"],
        name="api_upsert_custom_property_assignment",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn}/custom-properties",
        api_asset_custom_properties,
        methods=["GET"],
        name="api_asset_custom_properties",
    )

    # Phase 8 — profile
    router.add_api_route(
        "/api/assets/{asset_fqn}/profile",
        api_asset_profile,
        methods=["GET"],
        name="api_asset_profile",
    )

    # Phase 10 — quality
    router.add_api_route(
        "/api/quality/runs",
        api_list_quality_runs,
        methods=["GET"],
        name="api_list_quality_runs",
    )
    router.add_api_route(
        "/api/assets/{asset_fqn}/quality",
        api_asset_quality,
        methods=["GET"],
        name="api_asset_quality",
    )
    router.add_api_route(
        "/api/quality/custom-sql/validate",
        api_quality_validate_custom_sql,
        methods=["POST"],
        name="api_quality_validate_custom_sql",
    )

    # Phase 11 — classifications / domains / products / column groups
    router.add_api_route(
        "/api/classifications",
        api_list_classifications,
        methods=["GET"],
        name="api_list_classifications",
    )
    router.add_api_route(
        "/api/classifications/{classification_id}",
        api_get_classification,
        methods=["GET"],
        name="api_get_classification",
    )
    router.add_api_route(
        "/api/domains",
        api_list_domains,
        methods=["GET"],
        name="api_list_domains",
    )
    router.add_api_route(
        "/api/data-products",
        api_list_data_products,
        methods=["GET"],
        name="api_list_data_products",
    )
    router.add_api_route(
        "/api/governance/columns",
        api_list_logical_column_groups,
        methods=["GET"],
        name="api_list_logical_column_groups",
    )
    router.add_api_route(
        "/api/governance/columns/{group_id}",
        api_get_logical_column_group,
        methods=["GET"],
        name="api_get_logical_column_group",
    )

    # Phase 13 — audit browser
    router.add_api_route(
        "/api/audit/events",
        api_audit_events,
        methods=["GET"],
        name="api_audit_events",
    )

    # Phase 14 — access explainer
    router.add_api_route(
        "/api/assets/{asset_fqn}/access-explain",
        api_access_explainer,
        methods=["GET"],
        name="api_access_explainer",
    )
    router.add_api_route(
        "/api/access-explain",
        lambda request: api_access_explainer("", request),
        methods=["GET"],
        name="api_access_explainer_generic",
    )

    return router
