"""Operator-facing admin endpoints.

Exposes:
- `GET  /api/admin/background/status`      (read-only drainer health)
- `POST /api/admin/bulk-import/dry-run`    (steward/admin — validate CSV)
- `POST /api/admin/bulk-import/commit`     (steward/admin — apply CSV)
- `GET  /api/admin/coverage`               (steward/admin — coverage rollup)
- `GET  /api/admin/coverage/drilldown`     (steward/admin — non-compliant list)

Write endpoints gate on steward/admin. The bulk-import commit path
routes each row through `_apply_asset_metadata`, so the approval gate
applies the same rules it applies to single-row edits.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class BrandingPatch(BaseModel):
    primaryColor: str = ""
    accentColor: str = ""
    logoUrl: str = ""
    orgDisplayName: str = ""


def _background_status_payload() -> Dict[str, Any]:
    # Lazy import to avoid circular dependency with runtime_app, which
    # mounts this router during its own module-load phase.
    from runtime_app import _background_drainer_snapshot

    snapshot = _background_drainer_snapshot()
    running = bool(snapshot.get("running", False))
    last_error = snapshot.get("lastError") or ""
    last_drain_at = snapshot.get("lastDrainAt")
    state = "available" if running and not last_error else "degraded"
    reason = ""
    if not running:
        reason = "Background drainer thread is not currently running."
    elif last_error:
        reason = f"Background drainer reported an error on its last tick: {last_error}"
    return {
        "data": {
            "drainer": {
                "running": running,
                "lastDrainAt": last_drain_at,
                "processedTotal": int(snapshot.get("processedTotal") or 0),
                "lastError": last_error or None,
            },
            "queue": {
                # Depth hint intentionally null — a follow-up tranche
                # will query the background_queue table. Reporting a
                # hard-coded 0 here would be a lie; null is the
                # honest "not observed" signal.
                "depthHint": None,
            },
        },
        "meta": {
            "state": state,
            "reason": reason,
        },
    }


def _visible_fqns(request: Request) -> set[str]:
    """Best-effort visible-FQN set for bulk import validation. Returns
    an empty set on any failure so the caller falls back to
    "skip the in-catalog check" rather than hard-failing."""
    try:
        from runtime_app import _visible_assets  # lazy: runtime_app imports us
    except Exception:
        return set()
    try:
        frame = _visible_assets(request)
    except Exception:
        return set()
    if frame is None:
        return set()
    try:
        column = frame.get("fqn")
        if column is None:
            return set()
        return {str(entry).strip() for entry in column if str(entry).strip()}
    except Exception:
        return set()


def build_admin_router() -> APIRouter:
    router = APIRouter(prefix="/api/admin", tags=["admin"])

    @router.get("/background/status")
    def api_background_status() -> JSONResponse:
        return JSONResponse(_background_status_payload())

    @router.post("/bulk-import/dry-run")
    async def api_bulk_import_dry_run(request: Request) -> JSONResponse:
        """Parse a CSV and return per-row validation + proposed patches
        without writing anything. Steward/admin only."""
        from runtime_app import _ensure_can_mutate, _ensure_live_runtime, _user_role_slug
        from govhub.services import approvals as approval_service
        from govhub.services import bulk_import as bulk_import_service

        _ensure_live_runtime()
        _ensure_can_mutate(request)
        if not approval_service.role_can_decide(_user_role_slug(request)):
            raise HTTPException(
                status_code=403,
                detail="Bulk import is restricted to stewards and admins.",
            )
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Body must be valid JSON.")
        csv_text = str(body.get("csvText") or "")
        parsed = bulk_import_service.parse_csv(csv_text)
        if parsed.get("errors") and not parsed.get("rows"):
            return JSONResponse(
                {
                    "ok": False,
                    "headers": parsed.get("headers", []),
                    "rowCount": 0,
                    "results": [],
                    "summary": {"total": 0, "valid": 0, "invalid": 0, "empty": 0},
                    "parseErrors": parsed.get("errors", []),
                }
            )
        visible = _visible_fqns(request)
        validation = bulk_import_service.validate_rows(
            parsed.get("rows", []),
            asset_exists=(lambda fqn: fqn in visible) if visible else None,
        )
        return JSONResponse(
            {
                "ok": True,
                "headers": parsed.get("headers", []),
                "rowCount": len(parsed.get("rows", [])),
                "results": validation["results"],
                "summary": validation["summary"],
                "parseErrors": parsed.get("errors", []),
            }
        )

    @router.post("/bulk-import/commit")
    async def api_bulk_import_commit(request: Request) -> JSONResponse:
        """Commit validated rows. Each row routes through the standard
        asset-metadata apply helper, which honors the approval gate."""
        from runtime_app import (
            _apply_asset_metadata,
            _asset_is_openable,
            _ensure_can_mutate,
            _ensure_live_runtime,
            _metadata_audit_asset_snapshot,
            _record_metadata_audit,
            _user_role_slug,
        )
        from govhub.api.assets import AssetMetadataPatch
        from govhub.services import approvals as approval_service
        from govhub.services import bulk_import as bulk_import_service

        _ensure_live_runtime()
        actor_email = _ensure_can_mutate(request)
        actor_role = _user_role_slug(request)
        if not approval_service.role_can_decide(actor_role):
            raise HTTPException(
                status_code=403,
                detail="Bulk import is restricted to stewards and admins.",
            )
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Body must be valid JSON.")
        incoming_rows = body.get("rows") if isinstance(body.get("rows"), list) else []
        # Re-run validation server-side even if the client already did —
        # never trust client-provided patches.
        normalized_rows: List[Dict[str, Any]] = []
        for entry in incoming_rows:
            if not isinstance(entry, dict):
                continue
            raw = entry.get("raw") if isinstance(entry.get("raw"), dict) else entry
            normalized_rows.append({k: v for k, v in raw.items() if isinstance(k, str)})
        visible = _visible_fqns(request)
        validation = bulk_import_service.validate_rows(
            normalized_rows,
            asset_exists=(lambda fqn: fqn in visible) if visible else None,
        )

        def apply_one(fqn: str, patch: Dict[str, Any]) -> Dict[str, Any]:
            try:
                payload_model = AssetMetadataPatch(**patch)
            except Exception as exc:
                raise ValueError(f"Invalid patch: {exc}") from exc
            if not _asset_is_openable(fqn, request):
                raise RuntimeError("Asset not openable for current actor.")
            before = _metadata_audit_asset_snapshot(fqn, request)
            asset, warning = _apply_asset_metadata(fqn, payload_model, request=request)
            approval = (
                asset.get("approval") if isinstance(asset, dict) else None
            )
            if isinstance(approval, dict) and approval.get("status") == "pending":
                try:
                    _record_metadata_audit(
                        entity_type="change_request",
                        action="asset-metadata-proposed",
                        actor_email=actor_email,
                        actor_role=actor_role,
                        entity_fqn=fqn,
                        entity_id=approval.get("requestId") or fqn,
                        before=before,
                        after={"approval": approval},
                        detail="bulk-import",
                    )
                except Exception:
                    pass
                return {"approval": approval, "warning": warning}
            after = _metadata_audit_asset_snapshot(fqn, request)
            try:
                _record_metadata_audit(
                    entity_type="asset",
                    action="asset-metadata-updated",
                    actor_email=actor_email,
                    actor_role=actor_role,
                    entity_fqn=fqn,
                    entity_id=fqn,
                    before=before,
                    after=after,
                    detail="bulk-import",
                )
            except Exception:
                pass
            return {"asset": asset, "warning": warning}

        commit = bulk_import_service.apply_rows(
            validation["results"], apply_one=apply_one
        )
        return JSONResponse(
            {
                "ok": True,
                "results": commit["outcomes"],
                "summary": commit["summary"],
            }
        )

    @router.get("/coverage")
    def api_admin_coverage(
        request: Request,
        required_fields: Optional[List[str]] = Query(
            default=None, alias="requiredFields"
        ),
    ) -> JSONResponse:
        """Return per-tier / per-domain metadata completeness."""
        from runtime_app import (
            HIDDEN_CATALOGS,
            _ensure_can_mutate,
            _ensure_live_runtime,
            _user_role_slug,
            _visible_assets,
        )
        from govhub.services import approvals as approval_service
        from govhub.services import coverage as coverage_service

        _ensure_live_runtime()
        _ensure_can_mutate(request)
        if not approval_service.role_can_decide(_user_role_slug(request)):
            raise HTTPException(
                status_code=403,
                detail="Coverage dashboard is restricted to stewards and admins.",
            )
        payload = coverage_service.coverage_aggregate(
            _visible_assets(request),
            required_fields=required_fields,
            hidden_catalogs=HIDDEN_CATALOGS,
        )
        return JSONResponse(payload)

    @router.get("/coverage/drilldown")
    def api_admin_coverage_drilldown(
        request: Request,
        required_fields: Optional[List[str]] = Query(
            default=None, alias="requiredFields"
        ),
        tier: Optional[str] = Query(default=None),
        domain: Optional[str] = Query(default=None),
        missing_field: Optional[str] = Query(default=None, alias="missingField"),
        limit: int = Query(default=200),
    ) -> JSONResponse:
        """Return up to `limit` non-compliant assets matching the filter."""
        from runtime_app import (
            HIDDEN_CATALOGS,
            _ensure_can_mutate,
            _ensure_live_runtime,
            _user_role_slug,
            _visible_assets,
        )
        from govhub.services import approvals as approval_service
        from govhub.services import coverage as coverage_service
        from govhub.services.assets import normalize_str

        _ensure_live_runtime()
        _ensure_can_mutate(request)
        if not approval_service.role_can_decide(_user_role_slug(request)):
            raise HTTPException(
                status_code=403,
                detail="Coverage dashboard is restricted to stewards and admins.",
            )
        payload = coverage_service.coverage_drilldown(
            _visible_assets(request),
            required_fields=required_fields,
            tier=normalize_str(tier) or None,
            domain=normalize_str(domain) or None,
            missing_field=normalize_str(missing_field) or None,
            limit=limit,
            hidden_catalogs=HIDDEN_CATALOGS,
        )
        return JSONResponse(payload)

    @router.get("/branding")
    def api_admin_branding_get(request: Request) -> JSONResponse:
        """Admin/steward read of tenant branding. The shell bootstrap
        reads branding via _shell_branding_payload() internally for all
        roles, so gating this HTTP endpoint does not break shell render
        for readers."""
        from runtime_app import (
            _ensure_can_mutate,
            _ensure_governance_store,
            _ensure_live_runtime,
            _store,
            _user_role_slug,
        )
        from govhub.services import branding as branding_service

        _ensure_live_runtime()
        _ensure_can_mutate(request)
        if _user_role_slug(request) not in {"admin", "steward"}:
            raise HTTPException(
                status_code=403,
                detail="Only admins and stewards can read tenant branding via the admin API.",
            )
        _ensure_governance_store()
        return JSONResponse({"branding": branding_service.get_branding(_store())})

    @router.put("/branding")
    def api_admin_branding_put(
        payload: BrandingPatch, request: Request
    ) -> JSONResponse:
        """Admin-only. Validate + persist tenant branding; emit an
        audit row for change tracking."""
        from runtime_app import (
            _ensure_can_mutate,
            _ensure_governance_store,
            _ensure_live_runtime,
            _record_metadata_audit,
            _store,
            _user_role_slug,
        )
        from govhub.services import branding as branding_service

        _ensure_live_runtime()
        actor_email = _ensure_can_mutate(request)
        actor_role = _user_role_slug(request)
        if actor_role != "admin":
            raise HTTPException(
                status_code=403, detail="Only admins can modify tenant branding."
            )
        _ensure_governance_store()
        store = _store()
        before = branding_service.get_branding(store)
        try:
            branding = branding_service.set_branding(
                store,
                primary_color=payload.primaryColor,
                accent_color=payload.accentColor,
                logo_url=payload.logoUrl,
                org_display_name=payload.orgDisplayName,
                updated_by=actor_email,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            _record_metadata_audit(
                entity_type="tenant_branding",
                action="tenant-branding-updated",
                actor_email=actor_email,
                actor_role=actor_role,
                entity_fqn="tenant_branding/default",
                entity_id="default",
                before=before,
                after=branding,
                detail="",
            )
        except Exception:
            pass
        return JSONResponse({"ok": True, "branding": branding})

    return router
