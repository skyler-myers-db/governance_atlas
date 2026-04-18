"""Governance Hub application runtime."""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import unquote

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from govhub.api import (
    build_assets_router,
    build_discovery_router,
    build_export_router,
    build_governance_router,
    build_lineage_router,
    build_runtime_router,
)
from govhub.api.cache import (
    _CACHE_LOCK,
    _OBO_CLIENT_CACHE,
    _OBO_CLIENT_MAX_ENTRIES,
    _OBO_CLIENT_TTL_SECONDS,
    _TTL_CACHE,
    _invalidate_cache_prefix,
    _obo_token_key,
    _ttl_cache_pop,
    _ttl_value,
)
from govhub.api.identity import (
    _request_auth_mode,
    _request_obo_token,
    _request_read_visibility_scope,
    _user_email,
)
from govhub.api.response import (
    _error_response,
    _future_iso,
    _now_iso,
    _request_scope_warning,
    _response_meta,
    _utc_iso,
    _with_meta,
)
from govhub.config import AppConfig
from govhub.runtime_contract import validate_frontend_bundle
from govhub.services import assets as asset_service
from govhub.services import capabilities as capability_service
from govhub.services import governance as governance_service
from govhub.services import lineage as lineage_service
from govhub.services import runtime_setup as runtime_setup_service
from govhub.store import GovernanceStore
from govhub.uc import UCSQLClient, _is_skippable_metadata_error


ROOT = Path(__file__).resolve().parent
REACT_DIST_DIR = ROOT / "frontend" / "dist"
HIDDEN_CATALOGS = {"hive_metastore", "samples", "system", "__databricks_internal"}
KNOWN_SURFACES = {"discovery", "entity", "lineage", "governance"}
CLIENT_ROUTE_PREFIXES = {"discovery", "entity", "lineage", "governance", "glossary"}
MUTATION_ROLES = {"writer", "steward", "admin"}
APP_VERSION = "governance-hub-runtime-6"
REQUEST_ID_HEADER = "X-Request-ID"
CLIENT_REQUEST_ID_HEADER = "X-GovHub-Client-Request-ID"
BUILD_ID_HEADER = "X-GovHub-Build-ID"
DURATION_HEADER = "X-GovHub-Request-Duration-Ms"

LOGGER = logging.getLogger("govhub.runtime")
if not LOGGER.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(message)s"))
    LOGGER.addHandler(_handler)
LOGGER.setLevel(
    getattr(
        logging, os.getenv("GOVHUB_LOG_LEVEL", "INFO").strip().upper(), logging.INFO
    )
)
LOGGER.propagate = False


@lru_cache(maxsize=1)
def _frontend_bundle_metadata() -> Dict[str, Any]:
    return validate_frontend_bundle(ROOT)


HELP_ITEMS = [
    {
        "title": "Discovery",
        "body": "Search, facet, and open the most relevant asset directly from the result rail.",
    },
    {
        "title": "Lineage",
        "body": "Inspect real upstream and downstream dependencies through a graph workspace instead of static cards.",
    },
    {
        "title": "Governance",
        "body": "Keep ownership, glossary, certification, and request state close to the metadata itself.",
    },
]

DISCOVERY_VIEWS = [
    "All assets",
    "Needs attention",
    "Needs owner",
    "Needs certification",
    "Certified",
    "High coverage",
]
DISCOVERY_SORTS = [
    "Best match",
    "Coverage score",
    "Name (A-Z)",
    "Open requests",
]
IDENTITY_SOURCE = "x-forwarded-email | x-forwarded-preferred-username"
SHELL_API_CONTRACT = {
    "bootstrap": "/api/bootstrap",
    "discoverySearch": "/api/discovery/search",
    "assetDetail": "/api/assets/:fqn",
    "assetAvailability": "/api/assets/availability",
    "assetMetadataUpdate": "/api/assets/:fqn/metadata",
    "assetColumnMetadataUpdate": "/api/assets/:fqn/columns/:column/metadata",
    "lineage": "/api/lineage/:fqn",
    "glossary": "/api/governance/glossary",
    "governanceRequest": "/api/governance/requests/:id",
    "governanceNotification": "/api/governance/notifications/:id",
    "governanceGlossaryTerm": "/api/governance/glossary/:id",
    "runtimeStatus": "/api/runtime/status",
}


app = FastAPI(title="Governance Hub Runtime")
app.mount(
    "/assets",
    StaticFiles(directory=str(REACT_DIST_DIR / "assets"), check_dir=False),
    name="react-assets",
)


@app.middleware("http")
async def request_diagnostics_middleware(request: Request, call_next):
    request_id = (
        request.headers.get(CLIENT_REQUEST_ID_HEADER)
        or request.headers.get(REQUEST_ID_HEADER)
        or uuid.uuid4().hex
    ).strip() or uuid.uuid4().hex
    request.state.http_request_id = request_id
    request.state.request_started_at = time.time()
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        duration_ms = (time.perf_counter() - started_at) * 1000.0
        _log_request_event(
            request,
            status_code=500,
            duration_ms=duration_ms,
            outcome="unhandled_exception",
            error_type=exc.__class__.__name__,
            error_detail=str(exc)[:500],
        )
        raise
    duration_ms = (time.perf_counter() - started_at) * 1000.0
    _set_response_diagnostics_headers(response, request_id, duration_ms)
    _log_request_event(
        request,
        status_code=response.status_code,
        duration_ms=duration_ms,
        outcome=(
            "server_error"
            if response.status_code >= 500
            else "client_error"
            if response.status_code >= 400
            else "success"
        ),
    )
    return response


class _NullGovernanceStore:
    def list_owner_assignments(self) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "uc_full_name",
                "owner_email",
                "owner_type",
                "updated_at",
                "updated_by",
            ]
        )

    def list_change_requests(
        self, status: Optional[str] = None, limit: int = 200
    ) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "request_id",
                "created_at",
                "created_by",
                "status",
                "uc_full_name",
                "new_comment",
                "review_note",
            ]
        )

    def list_glossary_terms(self, limit: int = 200) -> pd.DataFrame:
        return pd.DataFrame(columns=["term_id", "name", "definition"])

    def list_glossary_reviewers(self) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "term_id",
                "reviewer_email",
                "reviewer_role",
                "created_at",
                "created_by",
                "updated_at",
                "updated_by",
            ]
        )

    def list_glossary_versions(self) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "version_id",
                "term_id",
                "version_number",
                "action",
                "change_note",
                "name",
                "definition",
                "domain",
                "owner_email",
                "status",
                "reviewer_snapshot_json",
                "created_at",
                "created_by",
                "updated_at",
                "updated_by",
            ]
        )

    def list_glossary_term_links(self, **_: Any) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "link_id",
                "term_id",
                "term_name",
                "subject_type",
                "subject_fqn",
                "column_name",
                "is_primary",
                "source",
                "source_value",
                "resolution_state",
                "created_at",
                "created_by",
                "updated_at",
                "updated_by",
                "removed_at",
                "removed_by",
            ]
        )

    def list_metadata_audit(self, **_: Any) -> pd.DataFrame:
        return pd.DataFrame(
            columns=[
                "audit_id",
                "entity_type",
                "entity_id",
                "entity_fqn",
                "column_name",
                "action",
                "source",
                "status",
                "before_json",
                "after_json",
                "request_id",
                "actor_email",
                "actor_role",
                "detail",
                "created_at",
                "created_by",
                "updated_at",
                "updated_by",
            ]
        )

    def list_metadata_audit_log(self, **_: Any) -> pd.DataFrame:
        return self.list_metadata_audit(**_)

    def get_role(self, email: str, admin_emails: Optional[List[str]] = None) -> str:
        return "reader"


_normalize_str = asset_service.normalize_str
_split_uc_name = asset_service.split_uc_name
_catalog_filter_options = asset_service.catalog_filter_options


@lru_cache(maxsize=1)
def _config() -> AppConfig:
    return AppConfig.from_env()


@lru_cache(maxsize=1)
def _uc() -> UCSQLClient:
    return UCSQLClient(warehouse_id=_config().warehouse_id)


def _uc_for_token(user_access_token: str) -> UCSQLClient:
    token = (user_access_token or "").strip()
    if not token:
        return _uc()
    key = _obo_token_key(token)
    now = time.time()
    cached = _OBO_CLIENT_CACHE.get(key)
    if cached and now - cached[0] < _OBO_CLIENT_TTL_SECONDS:
        return cached[1]
    client = UCSQLClient(
        warehouse_id=_config().warehouse_id,
        user_access_token=token,
    )
    with _CACHE_LOCK:
        _OBO_CLIENT_CACHE[key] = (now, client)
        if len(_OBO_CLIENT_CACHE) > _OBO_CLIENT_MAX_ENTRIES:
            cutoff = now - _OBO_CLIENT_TTL_SECONDS
            for stale_key in [k for k, v in _OBO_CLIENT_CACHE.items() if v[0] < cutoff]:
                _OBO_CLIENT_CACHE.pop(stale_key, None)
    return client


def _uc_for_request(request: Optional[Request]) -> UCSQLClient:
    token = _request_obo_token(request)
    if token:
        try:
            return _uc_for_token(token)
        except Exception:
            # Per-user client construction failed; fall back to the app-principal
            # client so the read path stays available.
            return _uc()
    return _uc()


@lru_cache(maxsize=1)
def _store() -> GovernanceStore:
    cfg = _config()
    store = GovernanceStore(uc=_uc(), catalog=cfg.gov_catalog, schema=cfg.gov_schema)
    store.ensure_tables()
    return store


def _format_runtime_message(exc: Exception) -> str:
    message = _normalize_str(exc)
    error_type = exc.__class__.__name__
    if not message:
        return error_type
    if message.startswith(f"{error_type}:"):
        return message
    return f"{error_type}: {message}"


def _uc_runtime_status() -> Dict[str, Any]:
    def _loader() -> Dict[str, Any]:
        try:
            uc = _uc()
            catalogs = uc.list_catalogs()
            return {
                "state": "live",
                "message": "",
                "catalogCount": int(len(catalogs.index))
                if isinstance(catalogs, pd.DataFrame)
                else 0,
                "client": uc.runtime_context(),
            }
        except Exception as exc:
            return {
                "state": "unavailable",
                "message": _format_runtime_message(exc)
                or "Live Databricks metadata runtime is unavailable.",
                "errorType": exc.__class__.__name__,
                "client": _uc().runtime_context() if _uc.cache_info().currsize else {},
            }

    return _ttl_value("runtime_uc_status", 300, _loader)


def _uc_runtime_status_fast(background: bool = True) -> Dict[str, Any]:
    """Non-blocking variant for bootstrap: return cached value if fresh, else an
    optimistic "warming" payload and kick the real probe off in the background.

    Serverless SQL warehouses can take 60–120 seconds to cold start. Blocking the
    shell bootstrap on that probe makes the entire UI appear unresponsive for
    minutes on first load. The honest per-surface status is still delivered via
    /api/runtime/status, so we never lie to the user about actual capabilities.
    """
    cached = _TTL_CACHE.get("runtime_uc_status")
    now = time.time()
    if cached and now - cached[0] < 300:
        return cached[1]
    if background:
        thread = threading.Thread(target=_uc_runtime_status, daemon=True)
        thread.daemon = True
        thread.start()
    return {
        "state": "loading",
        "message": (
            "Warming the Databricks SQL warehouse. Serverless warehouses take 30–90 "
            "seconds to start after idle; capabilities will hydrate automatically."
        ),
        "catalogCount": 0,
        "client": _uc().runtime_context() if _uc.cache_info().currsize else {},
    }


def _store_status() -> Dict[str, str]:
    def _loader() -> Dict[str, str]:
        try:
            _store()
            return {"state": "live", "message": ""}
        except Exception as exc:
            return {
                "state": "degraded",
                "message": _normalize_str(exc)
                or "Governance control plane is unavailable; falling back to read-only metadata.",
            }

    return _ttl_value("runtime_store_status", 60, _loader)


def _store_for_read() -> GovernanceStore | _NullGovernanceStore:
    status = _store_status()
    if status["state"] == "live":
        return _store()
    return _NullGovernanceStore()


def _safe_unquote(value: str) -> str:
    try:
        return unquote(value)
    except Exception:
        return value


def _route_context(request: Request) -> Dict[str, str]:
    params = request.query_params
    requested_asset = _normalize_str(params.get("asset"))
    requested_surface = _normalize_str(params.get("surface"))
    requested_module = _normalize_str(params.get("module"))
    discovery_query = _normalize_str(params.get("q"))
    segments = [segment for segment in request.url.path.split("/") if segment]
    if segments:
        root = _normalize_str(segments[0]).lower()
        remainder = _safe_unquote("/".join(segments[1:]))
        if root == "discovery":
            requested_surface = "discovery"
            requested_asset = ""
        elif root == "entity" and remainder:
            requested_surface = "entity"
            requested_asset = remainder
        elif root == "lineage" and remainder:
            requested_surface = "lineage"
            requested_asset = remainder
        elif root in {"governance", "glossary"}:
            requested_surface = "governance"
    if requested_surface not in KNOWN_SURFACES:
        requested_surface = (
            requested_module if requested_module in KNOWN_SURFACES else ""
        )
    if requested_surface == "discovery":
        requested_asset = ""
    return {
        "surface": requested_surface or "discovery",
        "asset": requested_asset,
        "query": discovery_query,
    }


def _user_role_slug(request: Optional[Request]) -> str:
    email = _user_email(request)
    if email == "unknown":
        return "reader"
    store = _store_for_read()
    try:
        role = store.get_role(email, admin_emails=_config().admin_emails)
    except Exception:
        return "reader"
    return (role or "reader").strip().lower() or "reader"


def _user_role(request: Optional[Request]) -> str:
    return _user_role_slug(request).title()


def _lightweight_user_role_slug(request: Optional[Request]) -> str:
    email = _user_email(request)
    if email == "unknown":
        return "reader"
    admin_emails = {item.strip().lower() for item in _config().admin_emails if item}
    if email in admin_emails:
        return "admin"
    return "reader"


def _lightweight_user_role(request: Optional[Request]) -> str:
    return _lightweight_user_role_slug(request).title()


def _http_request_id(request: Optional[Request]) -> str:
    if request is None:
        return ""
    request_id = getattr(getattr(request, "state", None), "http_request_id", "")
    if request_id:
        return str(request_id).strip()
    return (
        request.headers.get(CLIENT_REQUEST_ID_HEADER)
        or request.headers.get(REQUEST_ID_HEADER)
        or ""
    ).strip()


def _build_id() -> str:
    return _config().build_id or str(
        _frontend_bundle_metadata().get("buildId") or APP_VERSION
    )


def _set_response_diagnostics_headers(
    response, request_id: str, duration_ms: float
) -> None:
    response.headers[REQUEST_ID_HEADER] = request_id
    response.headers[BUILD_ID_HEADER] = _build_id()
    response.headers[DURATION_HEADER] = f"{duration_ms:.1f}"
    response.headers["Server-Timing"] = f"app;dur={duration_ms:.1f}"


def _log_request_event(
    request: Request,
    *,
    status_code: int,
    duration_ms: float,
    outcome: str,
    error_type: str = "",
    error_detail: str = "",
) -> None:
    if not _config().diagnostics_enabled:
        return
    path = str(request.url.path)
    if path.startswith("/assets/"):
        return
    route = _route_context(request)
    payload = {
        "event": "http_request",
        "httpRequestId": _http_request_id(request),
        "clientRequestId": (
            request.headers.get(CLIENT_REQUEST_ID_HEADER) or ""
        ).strip(),
        "buildId": _build_id(),
        "method": request.method,
        "path": path,
        "surface": route.get("surface") or "",
        "asset": route.get("asset") or "",
        "actorEmail": _user_email(request),
        "statusCode": int(status_code),
        "durationMs": round(float(duration_ms), 1),
        "outcome": outcome,
        "slow": bool(duration_ms >= max(0, _config().slow_request_ms)),
    }
    if error_type:
        payload["errorType"] = error_type
    if error_detail:
        payload["errorDetail"] = error_detail
    LOGGER.info(json.dumps(payload, sort_keys=True))


def _require_actor_email(request: Request) -> str:
    actor_email = _user_email(request)
    if actor_email == "unknown":
        raise HTTPException(
            status_code=401,
            detail="A forwarded Databricks user identity is required for metadata mutations.",
        )
    return actor_email


def _ensure_can_mutate(request: Request) -> str:
    _ensure_governance_store()
    actor_email = _require_actor_email(request)
    actor_role = _user_role_slug(request)
    if actor_role not in MUTATION_ROLES:
        raise HTTPException(
            status_code=403,
            detail="This action requires writer, steward, or admin permissions.",
        )
    return actor_email


def _direct_uc_metadata_writes_enabled(request: Optional[Request]) -> bool:
    return _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE


def _ensure_can_mutate_uc_metadata(request: Request) -> str:
    actor_email = _ensure_can_mutate(request)
    if not _direct_uc_metadata_writes_enabled(request):
        raise HTTPException(
            status_code=403,
            detail=(
                "Direct Unity Catalog metadata writes stay disabled until Databricks per-user authorization / "
                "OBO is implemented and verified for the current actor."
            ),
        )
    return actor_email


def _request_cache_scope(request: Optional[Request]) -> str:
    email = _normalize_str(_user_email(request))
    base = email if email and email != "unknown" else "anonymous"
    # Separate cache buckets per auth mode so OBO-scoped reads never share storage
    # with app-principal-scoped reads — they return materially different row sets
    # for the same actor, and cross-pollution would silently widen user-visible data.
    mode = (
        _request_auth_mode(request)
        if request is not None
        else capability_service.NO_IDENTITY_MODE
    )
    return f"{base}|{mode}"


def _capabilities_payload(
    request: Optional[Request],
    *,
    runtime_status: Optional[Dict[str, Any]] = None,
    store_status: Optional[Dict[str, Any]] = None,
    summary: Optional[Dict[str, Any]] = None,
    boot_message: str = "",
) -> Dict[str, Dict[str, Any]]:
    resolved_runtime_status = runtime_status or _uc_runtime_status()
    resolved_store_status = store_status or (
        _store_status()
        if resolved_runtime_status.get("state") == "live"
        else {
            "state": "skipped",
            "message": "Governance store check skipped until the SQL runtime recovers.",
        }
    )
    resolved_summary = summary or {}
    return capability_service.bootstrap_capabilities(
        actor_role=_user_role_slug(request) if request is not None else "reader",
        authenticated=_user_email(request) != "unknown"
        if request is not None
        else False,
        runtime_state=_normalize_str(resolved_runtime_status.get("state"))
        or "unavailable",
        runtime_message=_normalize_str(resolved_runtime_status.get("message")),
        store_state=_normalize_str(resolved_store_status.get("state")) or "unknown",
        store_message=_normalize_str(resolved_store_status.get("message")),
        visible_asset_count=int(resolved_summary.get("visibleAssets") or 0),
        available_catalog_count=int(resolved_summary.get("availableCatalogCount") or 0),
        observed_catalog_count=int(resolved_summary.get("observedCatalogCount") or 0),
        boot_message=boot_message,
        per_user_authorization=bool(_request_obo_token(request)),
    )


def _runtime_setup_checks_payload(
    setup: Dict[str, Any],
) -> List[Dict[str, Any]]:
    return list(setup.get("checks") or [])


def _runtime_diagnostics_payload(
    request: Optional[Request],
    *,
    runtime_status: Dict[str, Any],
    store_status: Dict[str, Any],
    summary: Dict[str, Any],
    capabilities: Dict[str, Dict[str, Any]],
    boot_message: str = "",
) -> Dict[str, Any]:
    setup = runtime_setup_service.setup_payload(
        runtime_status=runtime_status,
        store_status=store_status,
        capabilities=capabilities,
        warehouse_id=_config().warehouse_id,
        gov_catalog=_config().gov_catalog,
        gov_schema=_config().gov_schema,
        authenticated=_user_email(request) != "unknown",
        actor_role=_user_role_slug(request),
        diagnostics_enabled=_config().diagnostics_enabled,
        per_user_authorization=bool(_request_obo_token(request)),
    )
    return {
        "buildId": _build_id(),
        "diagnosticsEnabled": _config().diagnostics_enabled,
        "slowRequestMs": _config().slow_request_ms,
        "httpRequestId": _http_request_id(request),
        "headers": {
            "requestId": REQUEST_ID_HEADER,
            "clientRequestId": CLIENT_REQUEST_ID_HEADER,
            "buildId": BUILD_ID_HEADER,
            "durationMs": DURATION_HEADER,
            "serverTiming": "Server-Timing",
        },
        "observedAt": setup.get("observedAt", ""),
        "staleAfter": setup.get("staleAfter", ""),
        "setupSummary": setup.get("summary", {}),
        "setupReadiness": setup.get("readiness", {}),
        "setupSequence": list(setup.get("setupSequence") or []),
        "workspaceAccess": setup.get("workspaceAccess", {}),
        "setupChecks": _runtime_setup_checks_payload(setup),
        "featureFlags": list(setup.get("featureFlags") or []),
        "auth": setup.get("auth", {}),
        "bootMessage": boot_message,
    }


from govhub.services.inventory import (
    asset_exists as _asset_exists,
    asset_is_openable as _asset_is_openable,
    asset_is_visible as _asset_is_visible,
    inventory as _inventory,
    inventory_catalogs as _inventory_catalogs,
    inventory_row as _inventory_row,
    lineage_observed_catalogs as _lineage_observed_catalogs,
    visible_assets as _visible_assets,
)


def _asset_visibility_record(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    try:
        actor_scoped = (
            _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
        )
        visible = _asset_is_visible(asset_fqn, request)
        exists = visible or (actor_scoped and _asset_exists(asset_fqn, request))
        if visible:
            visibility_state = "visible"
        elif exists and actor_scoped:
            visibility_state = "hidden"
        else:
            visibility_state = "missing"
        return {
            "exists": exists,
            "visible": visible,
            "openable": visible,
            "visibilityState": visibility_state,
        }
    except Exception as exc:
        return {
            "exists": False,
            "visible": False,
            "openable": False,
            "visibilityState": "unknown",
            "reason": _normalize_str(exc)
            or "Asset visibility could not be determined.",
        }


def _invalidate_asset_caches(asset_fqn: str) -> None:
    asset_service.invalidate_asset_caches(asset_fqn)
    lineage_service.invalidate_lineage_caches(asset_fqn)
    governance_service.invalidate_governance_caches()
    _ttl_cache_pop(f"runtime_asset:{asset_fqn}")
    _ttl_cache_pop(f"runtime_lineage:{asset_fqn}")
    _invalidate_cache_prefix("runtime_inventory:")
    _invalidate_cache_prefix("runtime_bootstrap_inventory_summary:")
    _ttl_cache_pop("runtime_governance")


def _safe_int(value: Any) -> int:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return 0
        return int(float(str(value).replace(",", "")))
    except Exception:
        return 0


from govhub.services.inventory import (
    inventory_option_counts as _inventory_option_counts,
)


def _discovery_search_payload(
    request: Optional[Request] = None,
    *,
    query: str = "",
    query_mode: str = "plain",
    views: Optional[List[str]] = None,
    asset_types: Optional[List[str]] = None,
    catalogs: Optional[List[str]] = None,
    domains: Optional[List[str]] = None,
    tiers: Optional[List[str]] = None,
    certifications: Optional[List[str]] = None,
    sensitivities: Optional[List[str]] = None,
    sort_by: str = "Best match",
    limit: int = 60,
    offset: int = 0,
) -> Dict[str, Any]:
    return asset_service.discovery_search_payload(
        _visible_assets(request),
        query=query,
        query_mode=query_mode,
        views=views,
        asset_types=asset_types,
        catalogs=catalogs,
        domains=domains,
        tiers=tiers,
        certifications=certifications,
        sensitivities=sensitivities,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _asset_detail_payload(
    asset_fqn: str,
    request: Optional[Request] = None,
    *,
    sections: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return asset_service.asset_detail_payload(
        _uc_for_request(request),
        _store_for_read(),
        asset_fqn,
        cache_scope=_request_cache_scope(request),
        hidden_catalogs=HIDDEN_CATALOGS,
        sections=sections,
        allow_direct_metadata_write=_direct_uc_metadata_writes_enabled(request),
    )


from govhub.services.metadata_audit import (
    audit_asset_snapshot as _metadata_audit_asset_snapshot,
    audit_column_snapshot as _metadata_audit_column_snapshot,
    record_audit_log as _record_metadata_audit,
)


def _lineage_payload(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    return lineage_service.lineage_payload(
        _uc_for_request(request),
        _store_for_read(),
        asset_fqn,
        cache_scope=_request_cache_scope(request),
        system_uc=_uc(),
    )


def _governance_summary(request: Optional[Request] = None) -> Dict[str, Any]:
    payload = governance_service.governance_summary(
        _uc_for_request(request),
        _store(),
        actor_email=_user_email(request),
        hidden_catalogs=HIDDEN_CATALOGS,
    )
    payload["authoritative"] = True
    payload["provenance"] = {
        "source": "delta_control_plane",
        "authoritative": True,
        "state": "live",
        "warnings": [],
    }
    return payload


from govhub.services.inventory import (
    bootstrap_inventory_summary as _bootstrap_inventory_summary,
)


def _empty_inventory_boot_message(summary: Dict[str, Any]) -> str:
    if int(summary.get("visibleAssets") or 0) > 0:
        return ""
    available_catalog_count = int(summary.get("availableCatalogCount") or 0)
    observed_catalog_count = int(summary.get("observedCatalogCount") or 0)
    if available_catalog_count:
        return (
            f"The workspace can enumerate {available_catalog_count} catalog(s), but no visible tables or views "
            "were surfaced after filtering. Confirm the current principal can query Unity Catalog information_schema "
            "inventory for those catalogs."
        )
    if observed_catalog_count:
        return (
            f"Lineage system tables show activity in {observed_catalog_count} catalog(s), but direct catalog "
            "inventory could not be enumerated. Confirm SHOW CATALOGS and information_schema access for the current principal."
        )
    return (
        "The workspace connected successfully, but no visible metadata assets were returned yet. "
        "Confirm the current principal can enumerate Unity Catalog objects in the selected workspace."
    )


from govhub.services.inventory import (
    inventory_option_values as _inventory_option_values,
)


def _ensure_live_runtime() -> None:
    status = _uc_runtime_status()
    if status.get("state") != "live":
        raise HTTPException(
            status_code=503,
            detail=status.get("message") or "Live Databricks runtime is not available.",
        )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if str(request.url.path).startswith("/api/"):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return HTMLResponse(str(exc.detail), status_code=exc.status_code)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, _exc: Exception):
    if str(request.url.path).startswith("/api/"):
        return JSONResponse({"detail": "Internal server error."}, status_code=500)
    return HTMLResponse("Internal server error.", status_code=500)


def _ensure_governance_store() -> GovernanceStore:
    status = _store_status()
    if status["state"] != "live":
        raise HTTPException(
            status_code=503,
            detail=status["message"] or "Governance control plane is unavailable.",
        )
    return _store()


from govhub.api.assets import (
    AssetAvailabilityRequest,
    AssetDescriptionPatch,
    AssetMetadataPatch,
    AssetOwnersPatch,
    AssetTagsPatch,
    ColumnDescriptionPatch,
    ColumnMetadataPatch,
    ColumnTagsPatch,
    OwnerAssignment,
)


from govhub.api.governance import (
    GlossaryTermUpsert,
    GovernanceNotificationPatch,
    GovernanceRequestStatusPatch,
)


def _normalized_tag_map(df: pd.DataFrame) -> Dict[str, str]:
    if df is None or df.empty:
        return {}
    tags: Dict[str, str] = {}
    for _, row in df.iterrows():
        key = _normalize_str(row.get("tag_name"))
        value = _normalize_str(row.get("tag_value"))
        if key:
            tags[key] = value
    return tags


def _asset_table_type(asset_fqn: str, *, request: Optional[Request] = None) -> str:
    catalog, schema, table = _split_uc_name(asset_fqn)
    uc = _uc_for_request(request)
    try:
        identity_df = uc.get_table_identity(catalog, schema, table)
    except Exception:
        return ""
    if identity_df is None or identity_df.empty:
        return ""
    return _normalize_str(identity_df.iloc[0].get("table_type"))


def _apply_table_tags(
    asset_fqn: str,
    tags: Dict[str, str],
    *,
    table_type: str = "",
    request: Optional[Request] = None,
) -> Dict[str, str]:
    catalog, schema, table = _split_uc_name(asset_fqn)
    uc = _uc_for_request(request)
    normalized_tags = {
        _normalize_str(key): _normalize_str(value)
        for key, value in tags.items()
        if _normalize_str(key) and _normalize_str(value)
    }
    current_tags = _normalized_tag_map(uc.get_table_tags(catalog, schema, table))
    to_unset = [key for key in current_tags if key not in normalized_tags]
    to_set = {
        key: value
        for key, value in normalized_tags.items()
        if current_tags.get(key) != value
    }
    if to_unset:
        uc.unset_table_tags(
            catalog,
            schema,
            table,
            to_unset,
            table_type=table_type,
        )
    if to_set:
        uc.set_table_tags(
            catalog,
            schema,
            table,
            to_set,
            table_type=table_type,
        )
    return _normalized_tag_map(uc.get_table_tags(catalog, schema, table))


def _tag_write_warning(
    requested_tags: Dict[str, str],
    applied_tags: Dict[str, str],
    *,
    scope_label: str,
) -> str:
    return governance_service.tag_write_warning(
        requested_tags,
        applied_tags,
        scope_label=scope_label,
    )


def _apply_asset_metadata(
    asset_fqn: str,
    payload: AssetMetadataPatch,
    *,
    request: Optional[Request] = None,
) -> Tuple[Dict[str, Any], str]:
    catalog, schema, table = _split_uc_name(asset_fqn)
    table_type = _asset_table_type(asset_fqn, request=request)
    uc = _uc_for_request(request)
    uc.set_table_comment(
        catalog,
        schema,
        table,
        payload.description or "",
        table_type=table_type,
    )
    current_tags = _normalized_tag_map(uc.get_table_tags(catalog, schema, table))
    next_tags = dict(current_tags)
    structured = {
        "domain": payload.domain,
        "tier": payload.tier,
        "certification": payload.certification,
        "sensitivity": payload.sensitivity,
        "criticality": payload.criticality,
        "data_product": payload.dataProduct,
    }
    for key, raw_value in structured.items():
        if raw_value is None:
            continue
        value = _normalize_str(raw_value)
        if value:
            next_tags[key] = value
        else:
            next_tags.pop(key, None)
    if payload.freeformTags is not None:
        structured_keys = set(structured)
        normalized_freeform_tags = {
            _normalize_str(key): _normalize_str(value)
            for key, value in (payload.freeformTags or {}).items()
            if _normalize_str(key) and _normalize_str(value)
        }
        for key in list(next_tags):
            if key in structured_keys:
                continue
            if key not in normalized_freeform_tags:
                next_tags.pop(key, None)
        for key, value in normalized_freeform_tags.items():
            next_tags[key] = value
    applied_tags = _apply_table_tags(
        asset_fqn, next_tags, table_type=table_type, request=request
    )
    _invalidate_asset_caches(asset_fqn)
    return (
        _asset_detail_payload(asset_fqn, request=request),
        _tag_write_warning(next_tags, applied_tags, scope_label="Classification"),
    )


def _apply_column_tags(
    asset_fqn: str,
    column_name: str,
    tags: Dict[str, str],
    *,
    table_type: str = "",
    updated_by: str = "unknown",
    request: Optional[Request] = None,
) -> Dict[str, str]:
    catalog, schema, table = _split_uc_name(asset_fqn)
    uc = _uc_for_request(request)
    normalized_tags = {
        _normalize_str(key): _normalize_str(value)
        for key, value in tags.items()
        if _normalize_str(key) and _normalize_str(value)
    }
    current_tags = _normalized_tag_map(
        uc.get_column_tags(catalog, schema, table, column_name)
    )
    to_unset = [key for key in current_tags if key not in normalized_tags]
    to_set = {
        key: value
        for key, value in normalized_tags.items()
        if current_tags.get(key) != value
    }
    if to_unset:
        uc.unset_column_tags(
            catalog,
            schema,
            table,
            column_name,
            to_unset,
            table_type=table_type,
        )
    if to_set:
        uc.set_column_tags(
            catalog,
            schema,
            table,
            column_name,
            to_set,
            table_type=table_type,
        )
    applied_tags = _normalized_tag_map(
        uc.get_column_tags(catalog, schema, table, column_name)
    )
    store = _store()
    linked_terms = store.replace_glossary_term_links(
        subject_type="column",
        subject_fqn=asset_fqn,
        column_name=column_name,
        links=[normalized_tags["glossary_term"]]
        if normalized_tags.get("glossary_term")
        else [],
        updated_by=updated_by,
        source="uc_tag",
    )
    if normalized_tags.get("glossary_term") and not any(
        link.get("resolutionState") == "linked" for link in linked_terms
    ):
        applied_tags["glossary_term_resolution"] = "unresolved"
    return applied_tags


def _ensure_asset_column_exists(
    asset_fqn: str,
    column_name: str,
    request: Optional[Request] = None,
) -> None:
    columns_df = asset_service.asset_columns_df(_uc_for_request(request), asset_fqn)
    column_names = set(columns_df["column_name"].dropna().astype(str).tolist())
    if column_name not in column_names:
        raise HTTPException(status_code=404, detail="Column not found.")


def _asset_availability_payload(
    asset_fqns: List[str],
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    unique_assets = [
        asset_fqn
        for asset_fqn in dict.fromkeys(asset_fqns or [])
        if _normalize_str(asset_fqn)
    ]
    availability: Dict[str, Dict[str, Any]] = {}
    warnings: List[str] = []
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    for asset_fqn in unique_assets[:200]:
        record = _asset_visibility_record(asset_fqn, request)
        availability[asset_fqn] = record
        if record.get("visibilityState") == "unknown" and record.get("reason"):
            warnings.append(str(record["reason"]))
    return {
        "assets": availability,
        "meta": _response_meta(
            request,
            source="unity-catalog-inventory",
            state="available" if actor_scoped and not warnings else "degraded",
            authoritative=actor_scoped and not warnings,
            capabilities={
                "separatesExistsFromVisible": actor_scoped,
            },
            allowed_actions={},
            warnings=[*dict.fromkeys(warnings)],
            unavailable_reason=warnings[0] if warnings else "",
        ),
        "errors": [],
    }


def _shell_discovery_payload() -> Dict[str, Any]:
    return {
        "catalogs": ["All catalogs"],
        "domains": ["All domains"],
        "tiers": ["All tiers"],
        "certifications": ["All certifications"],
        "sensitivities": ["All sensitivities"],
        "assetTypes": ["All types"],
        "views": DISCOVERY_VIEWS,
        "sortOptions": DISCOVERY_SORTS,
        "defaultQuery": "",
    }


def _api_contract_payload() -> Dict[str, str]:
    return dict(SHELL_API_CONTRACT)


def _route_hints_payload(request: Optional[Request]) -> Dict[str, str]:
    if request is None:
        return {"surface": "discovery", "asset": "", "query": ""}
    return _route_context(request)


def _bootstrap_contract_payload(mode: str = "route-bootstrap") -> Dict[str, Any]:
    return {
        "version": "bootstrap-v3",
        "class": "shell-capability",
        "mode": mode,
        "warnings": [],
    }


def _shell_feature_flags_payload(
    capabilities: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    diagnostics_enabled = _config().diagnostics_enabled
    table_lineage = capabilities.get("tableLineage") or {}
    workload_visibility = capabilities.get("workloadVisibility") or {}

    def _flag(
        key: str,
        *,
        enabled: bool,
        state: str,
        reason: str = "",
        summary: str = "",
    ) -> Dict[str, Any]:
        payload = {
            "key": key,
            "enabled": bool(enabled),
            "state": state,
        }
        resolved_reason = reason or summary
        if summary:
            payload["summary"] = summary
        if resolved_reason:
            payload["reason"] = resolved_reason
        if not enabled or state == "unavailable":
            payload["disabledReason"] = (
                resolved_reason or "This capability is unavailable."
            )
            payload["unavailableReason"] = (
                resolved_reason or "This capability is unavailable."
            )
        return payload

    diagnostics_reason = (
        "Workspace setup diagnostics are available from the runtime status endpoint."
        if diagnostics_enabled
        else "Workspace setup diagnostics are disabled for this deployment."
    )
    return [
        _flag(
            "workspace_setup_diagnostics",
            enabled=diagnostics_enabled,
            state="available" if diagnostics_enabled else "unavailable",
            reason=diagnostics_reason,
            summary="Operator diagnostics stay off the initial shell payload.",
        ),
        _flag(
            "table_lineage_surface",
            enabled=table_lineage.get("available") is True,
            state=str(table_lineage.get("state") or "unavailable"),
            reason=_normalize_str(table_lineage.get("reason"))
            or "Live table lineage is not available in this workspace right now.",
            summary="Lineage surfaces hydrate after shell render.",
        ),
        _flag(
            "query_history_surface",
            enabled=workload_visibility.get("available") is True,
            state=str(workload_visibility.get("state") or "unavailable"),
            reason=_normalize_str(workload_visibility.get("reason"))
            or "Operational query and workload visibility is not available in this workspace right now.",
            summary="Usage and workload surfaces hydrate after shell render.",
        ),
    ]


def _shell_payload(
    request: Optional[Request],
    *,
    mode: str,
    state: str,
    message: str = "",
    runtime_status: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    resolved_runtime_status = runtime_status or {
        "state": "loading" if state == "loading" else state,
        "message": message,
    }
    capabilities = capability_service.bootstrap_capabilities(
        actor_role=_lightweight_user_role_slug(request),
        authenticated=_user_email(request) != "unknown"
        if request is not None
        else False,
        runtime_state=_normalize_str(resolved_runtime_status.get("state")) or state,
        runtime_message=_normalize_str(resolved_runtime_status.get("message"))
        or message,
        store_state="skipped",
        store_message="Governance control-plane checks load after the shell becomes interactive.",
        visible_asset_count=0,
        available_catalog_count=0,
        observed_catalog_count=0,
        boot_message=message,
        per_user_authorization=bool(_request_obo_token(request)),
    )
    payload = {
        "version": APP_VERSION,
        "bootState": state,
        "bootMessage": message,
        "apiBase": "/api",
        "discovery": _shell_discovery_payload(),
        "capabilities": capabilities,
        "featureFlags": _shell_feature_flags_payload(capabilities),
        "bootstrapContract": _bootstrap_contract_payload(mode),
        "shell": {
            "metrics": [],
            "role": _lightweight_user_role(request),
            "roleProvisional": True,
            "userEmail": _user_email(request),
            "buildId": _build_id(),
            "diagnosticsEnabled": _config().diagnostics_enabled,
        },
        "identity": {
            "actorEmail": _user_email(request),
            "actorRole": _lightweight_user_role(request),
            "actorRoleProvisional": True,
            "authenticatedUserPresent": _user_email(request) != "unknown",
            "authMode": _request_auth_mode(request),
            "visibilityScope": _request_read_visibility_scope(request),
            "source": IDENTITY_SOURCE,
        },
        "routeHints": _route_hints_payload(request),
        "apiContract": _api_contract_payload(),
        "help": [],
    }
    return _with_meta(
        payload,
        request,
        source="runtime-shell",
        state=state,
        authoritative=state == "live",
        capabilities={
            "shellOnly": True,
        },
        warnings=[message] if _normalize_str(message) and state != "live" else [],
        unavailable_reason=message if state in {"unavailable", "error"} else "",
    )


def _bootstrap_unavailable_payload(
    request: Optional[Request], message: str, *, state: str = "unavailable"
) -> Dict[str, Any]:
    return _shell_payload(
        request,
        mode="bootstrap-unavailable",
        state=state,
        message=message,
        runtime_status={"state": state, "message": message},
    )


def _ensure_react_bundle() -> Path:
    _frontend_bundle_metadata()
    index_path = REACT_DIST_DIR / "index.html"
    assets_dir = REACT_DIST_DIR / "assets"
    if index_path.exists() and assets_dir.exists():
        return index_path
    raise RuntimeError(
        "The packaged React workspace bundle is missing. Build the frontend and deploy from a packaged directory."
    )


@lru_cache(maxsize=1)
def _compiled_react_index() -> str:
    return _ensure_react_bundle().read_text(encoding="utf-8")


def _inject_bootstrap(html_text: str, payload: Optional[Dict[str, Any]]) -> str:
    if payload is None:
        return html_text
    bootstrap = json.dumps(payload, default=str).replace("</", "<\\/")
    inline_bootstrap = f"<script>window.__GOVHUB_BOOTSTRAP__ = {bootstrap};</script>"
    return html_text.replace("</head>", f"{inline_bootstrap}\n  </head>")


def _render_index(live_payload: Optional[Dict[str, Any]] = None) -> str:
    return _inject_bootstrap(_compiled_react_index(), live_payload)


def _spa_shell_response(request: Request) -> HTMLResponse:
    return HTMLResponse(
        _render_index(
            _shell_payload(
                request,
                mode="inline-shell",
                state="loading",
                message="Preparing the live metadata workspace.",
            )
        ),
        status_code=200,
    )


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return _spa_shell_response(request)


from govhub.api.runtime import (  # noqa: E402
    _api_bootstrap_response,
    _api_runtime_status_response,
)

app.include_router(build_runtime_router())


@app.on_event("startup")
def _warmup_live_runtime() -> None:
    """Kick off Databricks warehouse + governance-store probes in the background
    the moment the app container starts, so the first user request doesn't have
    to absorb the cold-start latency.
    """

    def _warm() -> None:
        try:
            _uc_runtime_status()
        except Exception:
            pass
        try:
            _store_status()
        except Exception:
            pass
        try:
            _bootstrap_inventory_summary("anonymous")
        except Exception:
            pass

    thread = threading.Thread(target=_warm, name="govhub-warmup", daemon=True)
    thread.start()


from govhub.api.assets import (  # noqa: E402
    api_asset_availability,
    api_asset_detail,
    api_patch_asset_description,
    api_patch_asset_metadata,
    api_patch_asset_owners,
    api_patch_asset_tags,
    api_patch_column_description,
    api_patch_column_metadata,
    api_patch_column_tags,
)
from govhub.api.discovery import api_discovery_search  # noqa: E402


from govhub.api.lineage import api_lineage  # noqa: E402


from govhub.api.governance import (  # noqa: E402
    api_governance_create_request,
    api_governance_glossary,
    api_governance_glossary_term,
    api_governance_patch_glossary,
    api_governance_patch_notification,
    api_governance_patch_request,
    api_governance_summary,
    api_governance_upsert_glossary,
    api_governance_upsert_owner,
)

app.include_router(build_discovery_router())
app.include_router(build_assets_router())
app.include_router(build_lineage_router())
app.include_router(build_governance_router())
app.include_router(build_export_router())


@app.get("/{client_path:path}", response_class=HTMLResponse, include_in_schema=False)
def client_route_shell(client_path: str, request: Request) -> HTMLResponse:
    normalized = _normalize_str(client_path)
    if not normalized:
        return _spa_shell_response(request)
    root = normalized.split("/", 1)[0].lower()
    if root in CLIENT_ROUTE_PREFIXES:
        return _spa_shell_response(request)
    raise HTTPException(status_code=404, detail="Not found.")
