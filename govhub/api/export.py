"""Phase 4 Tranche 2 / Phase 12 — export router.

Sync CSV export for actor-scoped, visible assets. The safety contract
lives in govhub/services/export.py (evaluate_export_request); this
router handles wiring + capability gating + response shaping only.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from govhub.api.identity import _request_auth_mode, _user_email
from govhub.services import capabilities as capability_service
from govhub.services import export as export_service
from govhub.services.assets import normalize_str as _normalize_str


class ExportAssetsRequest(BaseModel):
    assetFqns: List[str] = Field(default_factory=list)
    format: str = "csv"


def _actor_role_slug(request: Request) -> str:
    from runtime_app import _user_role_slug

    try:
        return _user_role_slug(request)
    except Exception:
        return "reader"


def _build_rows(asset_fqns: List[str], request: Request) -> list[dict]:
    """Assemble the per-asset row payload. Uses the existing
    _asset_detail_payload helper so the export surface inherits all of
    the normal visibility + redaction rules — an export can never show
    a field that the asset-detail API would hide."""
    from runtime_app import _asset_detail_payload, _asset_is_openable

    rows: list[dict] = []
    for fqn in asset_fqns:
        fqn_normalized = _normalize_str(fqn)
        if not fqn_normalized:
            continue
        if not _asset_is_openable(fqn_normalized, request):
            # Fail closed — invisible assets can't leak through export.
            continue
        try:
            payload = _asset_detail_payload(
                fqn_normalized,
                request=request,
                sections=["header"],
            )
        except Exception:
            continue
        rows.append(
            {
                "fqn": payload.get("fqn") or fqn_normalized,
                "name": payload.get("name"),
                "catalog": payload.get("catalog"),
                "schema": payload.get("schema"),
                "description": payload.get("description"),
                "domain": payload.get("domain"),
                "tier": payload.get("tier"),
                "certification": payload.get("certification"),
                "sensitivity": payload.get("sensitivity"),
                "criticality": payload.get("criticality"),
                "dataProduct": payload.get("dataProduct") or payload.get("data_product"),
                "governanceStatus": payload.get("governanceStatus"),
                "owners": payload.get("owners") or [],
                "tagEntries": payload.get("tagEntries") or [],
            }
        )
    return rows


def _persist_export_job(
    *,
    request: Request,
    job_id: str,
    asset_fqns: List[str],
    actor_email: str,
    actor_role: str,
    filter_snapshot: str,
    status: str,
    requested_at: datetime,
    token_captured_at: Optional[datetime],
    row_count: int = 0,
    byte_count: int = 0,
    error_detail: Optional[str] = None,
) -> None:
    from runtime_app import _ensure_governance_store, _store
    from govhub.util import sql_literal

    try:
        _ensure_governance_store()
        store = _store()
        expires_at = export_service.expiry_for(requested_at)
        ts = requested_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        token_ts = (
            token_captured_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            if token_captured_at
            else None
        )
        store.uc.execute(
            f"""INSERT INTO {store._fq("export_jobs")} (
    job_id, actor_email, actor_role, asset_fqns, filter_snapshot_json,
    format, mode, status, requested_at, token_captured_at, materialized_at,
    expires_at, download_url, row_count, byte_count, checksum, error_detail,
    created_at, created_by, updated_at, updated_by
) VALUES (
    {sql_literal(job_id)},
    {sql_literal(actor_email)},
    {sql_literal(actor_role)},
    array({", ".join(sql_literal(fqn) for fqn in asset_fqns) or "CAST(NULL AS STRING)"}),
    {sql_literal(filter_snapshot)},
    {sql_literal("csv")},
    {sql_literal("sync")},
    {sql_literal(status)},
    timestamp({sql_literal(ts)}),
    {"NULL" if token_ts is None else f"timestamp({sql_literal(token_ts)})"},
    {f"timestamp({sql_literal(ts)})" if status == "ready" else "NULL"},
    timestamp({sql_literal(expires_at.strftime("%Y-%m-%d %H:%M:%S"))}),
    NULL,
    {int(row_count)},
    {int(byte_count)},
    NULL,
    {sql_literal(error_detail)},
    timestamp({sql_literal(ts)}),
    {sql_literal(actor_email)},
    timestamp({sql_literal(ts)}),
    {sql_literal(actor_email)}
)"""
        )
    except Exception:
        # Export job logging is best-effort. A logging failure must not
        # block a legitimate export from succeeding.
        return


def api_export_assets(
    payload: ExportAssetsRequest,
    request: Request,
) -> JSONResponse:
    from runtime_app import _ensure_live_runtime

    _ensure_live_runtime()

    auth_mode = _request_auth_mode(request)
    actor_scoped = auth_mode == capability_service.OBO_AVAILABLE_MODE
    actor_email = _user_email(request) or "unknown"
    actor_role = _actor_role_slug(request)
    requested_at = datetime.now(timezone.utc)
    # Capture time == request time. We don't have visibility into when
    # the browser actually received the OBO header from Databricks, but
    # this is a fail-closed upper bound.
    token_captured_at = requested_at if actor_scoped else None

    asset_fqns = [_normalize_str(fqn) for fqn in (payload.assetFqns or [])]
    asset_fqns = [fqn for fqn in asset_fqns if fqn]

    decision = export_service.evaluate_export_request(
        actor_scoped=actor_scoped,
        token_captured_at=token_captured_at,
        asset_count=len(asset_fqns),
        sync=True,
        now=requested_at,
    )
    if not decision.allowed:
        return JSONResponse(
            status_code=403 if decision.status == "stale_auth" else 400,
            content={
                "error": {
                    "code": decision.status,
                    "message": decision.reason,
                }
            },
        )

    rows = _build_rows(asset_fqns, request)
    csv_text = export_service.build_csv(rows, EXPORT_CSV_COLUMNS)
    byte_count = len(csv_text.encode("utf-8"))

    job_id = export_service.new_job_id()
    filter_snapshot = export_service.build_filter_snapshot(
        asset_fqns=asset_fqns,
        actor_email=actor_email,
        visibility_scope=capability_service.runtime_visibility_scope(auth_mode),
        format="csv",
        requested_at=requested_at,
    )
    _persist_export_job(
        request=request,
        job_id=job_id,
        asset_fqns=asset_fqns,
        actor_email=actor_email,
        actor_role=actor_role,
        filter_snapshot=filter_snapshot,
        status="ready" if rows else "failed",
        requested_at=requested_at,
        token_captured_at=token_captured_at,
        row_count=len(rows),
        byte_count=byte_count,
        error_detail=None if rows else "No visible assets matched the export request.",
    )

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=(
                "No visible assets matched the export request. Confirm the "
                "asset FQNs exist in your workspace scope."
            ),
        )

    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="governance-hub-export-{job_id}.csv"',
            "X-GovHub-Export-Job-Id": job_id,
            "X-GovHub-Export-Row-Count": str(len(rows)),
        },
    )


EXPORT_CSV_COLUMNS = [
    "fqn",
    "name",
    "catalog",
    "schema",
    "description",
    "domain",
    "tier",
    "certification",
    "sensitivity",
    "criticality",
    "dataProduct",
    "governanceStatus",
    "owners",
    "tagEntries",
]


def _serialize_job_row(row: dict) -> dict:
    def _ts(value):
        if value is None:
            return None
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)

    return {
        "jobId": row.get("job_id"),
        "actorEmail": row.get("actor_email"),
        "actorRole": row.get("actor_role"),
        "status": row.get("status"),
        "mode": row.get("mode"),
        "format": row.get("format"),
        "requestedAt": _ts(row.get("requested_at")),
        "materializedAt": _ts(row.get("materialized_at")),
        "expiresAt": _ts(row.get("expires_at")),
        "tokenCapturedAt": _ts(row.get("token_captured_at")),
        "rowCount": int(row.get("row_count") or 0) if row.get("row_count") is not None else 0,
        "byteCount": int(row.get("byte_count") or 0) if row.get("byte_count") is not None else 0,
        "errorDetail": row.get("error_detail"),
    }


def _job_asset_fqns(row: dict) -> List[str]:
    raw = row.get("asset_fqns")
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw if item]
    if hasattr(raw, "tolist"):
        return [str(item) for item in raw.tolist() if item]
    snapshot = row.get("filter_snapshot_json")
    if isinstance(snapshot, str) and snapshot.strip():
        try:
            payload = json.loads(snapshot)
        except Exception:
            return []
        fqns = payload.get("assetFqns")
        if isinstance(fqns, list):
            return [str(item) for item in fqns if item]
    return []


def api_export_job_download(
    job_id: str,
    request: Request,
) -> PlainTextResponse:
    """Re-download a previously materialized export. Enforces:
    - actor-scoped auth
    - requester identity match
    - status == ready
    - not expired
    - token capture time not stale (>55 min)
    Re-materializes CSV on demand — artifact is not persisted, preserving
    the no-raw-artifact rule and ensuring any intervening visibility
    changes apply."""
    from runtime_app import _ensure_governance_store, _ensure_live_runtime, _store

    _ensure_live_runtime()
    try:
        _ensure_governance_store()
        store = _store()
        job_row = store.get_export_job(job_id)
    except Exception:
        job_row = None
    if not job_row:
        raise HTTPException(status_code=404, detail="Export job not found.")

    auth_mode = _request_auth_mode(request)
    actor_scoped = auth_mode == capability_service.OBO_AVAILABLE_MODE
    actor_email = _user_email(request) or "unknown"

    decision = export_service.evaluate_download_request(
        actor_scoped=actor_scoped,
        actor_email=actor_email,
        requester_email=job_row.get("actor_email"),
        status=job_row.get("status"),
        expires_at=job_row.get("expires_at"),
        token_captured_at=job_row.get("token_captured_at"),
    )
    if not decision.allowed:
        status_code = {
            "forbidden": 403,
            "stale_auth": 403,
            "expired": 410,
        }.get(decision.status, 400)
        return JSONResponse(
            status_code=status_code,
            content={"error": {"code": decision.status, "message": decision.reason}},
        )

    asset_fqns = _job_asset_fqns(job_row)
    rows = _build_rows(asset_fqns, request)
    if not rows:
        raise HTTPException(
            status_code=410,
            detail=(
                "Exported assets are no longer visible to this actor. "
                "Re-run the export from Discovery."
            ),
        )
    csv_text = export_service.build_csv(rows, EXPORT_CSV_COLUMNS)
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="governance-hub-export-{job_id}.csv"',
            "X-GovHub-Export-Job-Id": job_id,
            "X-GovHub-Export-Row-Count": str(len(rows)),
            "X-GovHub-Export-Redownload": "true",
        },
    )


def api_admin_export_jobs(
    request: Request,
    actor_email: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
) -> JSONResponse:
    """Admin-only list of recent export jobs for the diagnostics surface.
    Used by Phase 4 Tranche 2 admin dashboard."""
    from runtime_app import _ensure_governance_store, _ensure_live_runtime, _store, _user_role_slug

    _ensure_live_runtime()
    role = _user_role_slug(request)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    try:
        _ensure_governance_store()
        store = _store()
        frame = store.list_export_jobs(
            actor_email=actor_email,
            status=status,
            limit=max(1, min(int(limit), 500)),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read export jobs: {exc}")

    jobs: List[dict] = []
    if frame is not None and not frame.empty:
        for _, row in frame.iterrows():
            jobs.append(_serialize_job_row(row.to_dict()))
    return JSONResponse(
        status_code=200,
        content={
            "data": jobs,
            "meta": {
                "authoritative": True,
                "source": "control_plane",
                "observedAt": datetime.now(timezone.utc).isoformat(),
            },
        },
    )


def build_export_router() -> APIRouter:
    router = APIRouter(tags=["export"])
    router.add_api_route(
        "/api/export/assets",
        api_export_assets,
        methods=["POST"],
        name="api_export_assets",
    )
    router.add_api_route(
        "/api/export/{job_id}/download",
        api_export_job_download,
        methods=["GET"],
        name="api_export_job_download",
    )
    router.add_api_route(
        "/api/admin/export-jobs",
        api_admin_export_jobs,
        methods=["GET"],
        name="api_admin_export_jobs",
    )
    return router
