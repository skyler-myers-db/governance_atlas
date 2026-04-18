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


def _live_runtime_available() -> bool:
    return _uc_runtime_status()["state"] == "live"


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


def _inventory(request: Optional[Request] = None) -> pd.DataFrame:
    return asset_service.inventory(
        _uc_for_request(request),
        _store_for_read(),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _visible_assets(
    request: Optional[Request] = None,
    *,
    cache_scope: str = "",
) -> pd.DataFrame:
    scope = cache_scope or _request_cache_scope(request)
    normalized_scope = _normalize_str(scope) or "shared"
    return _ttl_value(
        f"runtime_inventory:{normalized_scope}",
        300,
        lambda: asset_service.visible_assets(
            _uc_for_request(request),
            _store_for_read(),
            hidden_catalogs=HIDDEN_CATALOGS,
        ),
    )


def _inventory_catalogs(request: Optional[Request] = None) -> List[str]:
    return asset_service.inventory_catalogs(
        _uc_for_request(request),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _lineage_observed_catalogs(request: Optional[Request] = None) -> List[str]:
    return asset_service.lineage_observed_catalogs(
        _uc_for_request(request),
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _inventory_row(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> pd.Series:
    return asset_service.inventory_row(
        _uc_for_request(request),
        _store_for_read(),
        asset_fqn,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _asset_exists(asset_fqn: str, request: Optional[Request] = None) -> bool:
    return asset_service.asset_exists(
        _uc_for_request(request),
        _store_for_read(),
        asset_fqn,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _asset_is_visible(asset_fqn: str, request: Optional[Request] = None) -> bool:
    if request is not None:
        inventory = _visible_assets(request)
        return asset_service.asset_is_visible(inventory, asset_fqn)
    return asset_service.asset_is_visible(
        _uc_for_request(request),
        _store_for_read(),
        asset_fqn,
        hidden_catalogs=HIDDEN_CATALOGS,
    )


def _asset_is_openable(asset_fqn: str, request: Optional[Request] = None) -> bool:
    return _asset_is_visible(asset_fqn, request)


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


def _friendly_table_type(raw: Any, data_source_format: Any = None) -> str:
    return asset_service.friendly_table_type(raw, data_source_format)


def _coalesce(*values: Any) -> str:
    for value in values:
        normalized = _normalize_str(value)
        if normalized:
            return normalized
    return ""


def _safe_int(value: Any) -> int:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return 0
        return int(float(str(value).replace(",", "")))
    except Exception:
        return 0


def _human_bytes(value: Any) -> str:
    try:
        size = float(value)
    except Exception:
        return "—"
    if size <= 0:
        return "—"
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024
        idx += 1
    if idx == 0:
        return f"{int(size)} {units[idx]}"
    return f"{size:.1f} {units[idx]}"


def _detail_map(detail_df: pd.DataFrame) -> Dict[str, Any]:
    if detail_df is None or detail_df.empty:
        return {}
    row = detail_df.iloc[0].to_dict()
    return {str(key).lower(): value for key, value in row.items()}


def _owner_entries(row: pd.Series) -> List[Dict[str, str]]:
    owners: List[Dict[str, str]] = []
    owner_fields = [
        ("business_owner", "Business Owner"),
        ("technical_owner", "Technical Owner"),
        ("steward", "Steward"),
    ]
    seen: set[Tuple[str, str]] = set()
    for field_name, title in owner_fields:
        raw = _normalize_str(row.get(field_name))
        if not raw:
            continue
        for item in [part.strip() for part in raw.split(",") if part.strip()]:
            key = (item.lower(), title)
            if key in seen:
                continue
            seen.add(key)
            owners.append({"name": item, "title": title})
    return owners


def _asset_badges(row: pd.Series) -> List[str]:
    structured_keys = {
        "domain",
        "tier",
        "certification",
        "sensitivity",
        "criticality",
        "glossary_term",
        "data_product",
    }
    badges = [
        _normalize_str(row.get("domain")),
        _normalize_str(row.get("tier")),
        _normalize_str(row.get("certification")),
        _normalize_str(row.get("sensitivity")),
        _normalize_str(row.get("criticality")),
    ]
    if isinstance(row.get("tags"), dict):
        for key, value in row.get("tags", {}).items():
            if key.startswith("__"):
                continue
            normalized_key = _normalize_str(key)
            normalized_value = _normalize_str(value)
            if normalized_key.lower() in structured_keys:
                continue
            label = (
                f"{normalized_key}={normalized_value}"
                if normalized_key and normalized_value
                else normalized_key or normalized_value
            )
            if label and label not in badges:
                badges.append(label)
    return [badge for badge in badges if badge]


def _base_asset_payload(row: pd.Series) -> Dict[str, Any]:
    return asset_service.base_asset_payload(row)


def _discovery_result_haystack(asset: Dict[str, Any]) -> str:
    raw_tags = asset.get("tags")
    if isinstance(raw_tags, dict):
        tag_terms: List[str] = []
        for key, value in raw_tags.items():
            normalized_key = _normalize_str(key)
            normalized_value = _normalize_str(value)
            if normalized_key:
                tag_terms.append(normalized_key)
            if normalized_value:
                tag_terms.extend(
                    [normalized_value, f"{normalized_key} {normalized_value}".strip()]
                )
    else:
        tag_terms = [
            _normalize_str(tag) for tag in asset.get("tags", []) if _normalize_str(tag)
        ]
    return " ".join(
        [
            _normalize_str(asset.get("name")),
            _normalize_str(asset.get("description")),
            _normalize_str(asset.get("catalog")),
            _normalize_str(asset.get("schema")),
            _normalize_str(asset.get("domain")),
            _normalize_str(asset.get("tier")),
            _normalize_str(asset.get("certification")),
            _normalize_str(asset.get("sensitivity")),
            _normalize_str(asset.get("objectType")),
            " ".join(tag_terms),
        ]
    ).lower()


def _discovery_match_score(asset: Dict[str, Any], query: str) -> int:
    q = _normalize_str(query).lower()
    if not q:
        return 0
    score = 0
    if q in _normalize_str(asset.get("name")).lower():
        score += 4
    if q in _normalize_str(asset.get("schema")).lower():
        score += 2
    if q in _normalize_str(asset.get("catalog")).lower():
        score += 2
    if q in _normalize_str(asset.get("description")).lower():
        score += 2
    if q in _discovery_result_haystack(asset):
        score += 1
    return score


def _view_matches(asset: Dict[str, Any], view: str) -> bool:
    normalized = _normalize_str(view)
    if not normalized or normalized == "All assets":
        return True
    if normalized == "Needs owner":
        return len(asset.get("owners", [])) == 0
    if normalized == "Needs certification":
        return _normalize_str(asset.get("certification")) == "Unassigned"
    if normalized == "Certified":
        return _normalize_str(asset.get("certification")) != "Unassigned"
    if normalized == "High coverage":
        return _safe_int(asset.get("coverageScore")) >= 75
    return True


def _normalize_filter_values(values: Optional[List[str]], all_label: str) -> List[str]:
    if not values:
        return []
    normalized = [
        _normalize_str(value)
        for value in values
        if _normalize_str(value) and _normalize_str(value) != all_label
    ]
    return normalized


def _facet_payload(
    assets: List[Dict[str, Any]],
    field: str,
    *,
    all_label: str,
) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {}
    for asset in assets:
        value = _normalize_str(asset.get(field))
        if not value or value == "Unassigned":
            continue
        counts[value] = counts.get(value, 0) + 1
    items = [{"value": all_label, "count": len(assets)}]
    items.extend({"value": value, "count": counts[value]} for value in sorted(counts))
    return items


def _inventory_option_counts(
    inventory: pd.DataFrame,
    extractor: Callable[[pd.Series], str],
) -> Dict[str, int]:
    if inventory is None or inventory.empty:
        return {}
    counts: Dict[str, int] = {}
    for _, row in inventory.iterrows():
        value = _normalize_str(extractor(row))
        if not value or value == "Unassigned":
            continue
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def _sort_discovery_assets(
    assets: List[Dict[str, Any]],
    *,
    sort_by: str,
    query: str,
) -> List[Dict[str, Any]]:
    normalized_sort = _normalize_str(sort_by)

    def _best_match_key(asset: Dict[str, Any]) -> Tuple[int, int, int, str]:
        return (
            _discovery_match_score(asset, query),
            _safe_int(asset.get("coverageScore")),
            _safe_int(asset.get("openRequests")),
            _normalize_str(asset.get("fqn")),
        )

    if normalized_sort == "Coverage score":
        return sorted(
            assets,
            key=lambda asset: (
                _safe_int(asset.get("coverageScore")),
                _safe_int(asset.get("openRequests")),
                _normalize_str(asset.get("fqn")),
            ),
            reverse=True,
        )
    if normalized_sort == "Open requests":
        return sorted(
            assets,
            key=lambda asset: (
                _safe_int(asset.get("openRequests")),
                _safe_int(asset.get("coverageScore")),
                _normalize_str(asset.get("fqn")),
            ),
            reverse=True,
        )
    if normalized_sort == "Recently updated":
        return sorted(
            assets, key=lambda asset: _normalize_str(asset.get("name")).lower()
        )
    return sorted(assets, key=_best_match_key, reverse=True)


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


def _related_assets(
    catalog: str,
    schema: str,
    table: str,
    focus_fqn: str,
    request: Optional[Request] = None,
) -> List[str]:
    return asset_service.related_assets(
        _uc_for_request(request), catalog, schema, table, focus_fqn
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


def _metadata_audit_asset_snapshot(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    try:
        payload = _asset_detail_payload(asset_fqn, request=request, sections=["header"])
    except Exception:
        return {"fqn": asset_fqn}
    return {
        "fqn": payload.get("fqn") or asset_fqn,
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


def _metadata_audit_column_snapshot(
    asset_fqn: str,
    column_name: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    try:
        payload = _asset_detail_payload(asset_fqn, request=request, sections=["schema"])
    except Exception:
        return {"assetFqn": asset_fqn, "columnName": column_name}
    column_records = payload.get("columns") or []
    column = next(
        (
            record
            for record in column_records
            if _normalize_str(record.get("name")).lower()
            == _normalize_str(column_name).lower()
        ),
        None,
    )
    if not column:
        return {"assetFqn": asset_fqn, "columnName": column_name}
    return {
        "assetFqn": asset_fqn,
        "columnName": column_name,
        "description": column.get("description"),
        "dataType": column.get("type"),
        "tags": column.get("tags") or [],
        "glossaryTerm": column.get("glossaryTerm"),
    }


def _record_metadata_audit(
    *,
    entity_type: str,
    action: str,
    actor_email: str,
    actor_role: str,
    entity_fqn: str | None = None,
    entity_id: str | None = None,
    column_name: str | None = None,
    request_id: str | None = None,
    before: Any = None,
    after: Any = None,
    source: str = "api",
    detail: str | None = None,
) -> None:
    try:
        store = _store()
        if hasattr(store, "append_metadata_audit_log"):
            store.append_metadata_audit_log(
                entity_type=entity_type,
                action=action,
                actor_email=actor_email,
                actor_role=actor_role,
                entity_fqn=entity_fqn,
                entity_id=entity_id,
                column_name=column_name,
                request_id=request_id,
                before_json=before,
                after_json=after,
                source=source,
                detail=detail,
            )
        else:
            store.append_metadata_audit(
                entity_type=entity_type,
                action=action,
                actor_email=actor_email,
                actor_role=actor_role,
                entity_fqn=entity_fqn,
                entity_id=entity_id,
                column_name=column_name,
                request_id=request_id,
                before=before,
                after=after,
                source=source,
                detail=detail,
            )
    except Exception:
        return


def _preview_records(sample_df: pd.DataFrame) -> List[Dict[str, str]]:
    if sample_df is None or sample_df.empty:
        return []
    view = sample_df.head(8).copy()
    limited_cols = list(view.columns[:8])
    view = view[limited_cols]
    rows: List[Dict[str, str]] = []
    for _, row in view.iterrows():
        rows.append({str(col): _normalize_str(row.get(col)) for col in limited_cols})
    return rows


def _column_records(columns_df: pd.DataFrame) -> List[Dict[str, str]]:
    if columns_df is None or columns_df.empty:
        return []
    rows: List[Dict[str, str]] = []
    for _, row in columns_df.head(50).iterrows():
        rows.append(
            {
                "name": _normalize_str(row.get("column_name")),
                "type": _normalize_str(row.get("data_type")),
                "description": _normalize_str(row.get("comment")) or "No description",
            }
        )
    return rows


def _graph_node_for_asset(
    asset_fqn: str,
    role: str,
    x: int,
    y: int,
    *,
    kicker: str,
    kind: str = "",
    foot: Optional[List[str]] = None,
    depth: int = 1,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    row = _inventory_row(asset_fqn, request)
    label = _normalize_str(row.get("table_name")) or asset_fqn.split(".")[-1]
    subtitle = " / ".join(
        part
        for part in [
            _normalize_str(row.get("table_catalog")),
            _normalize_str(row.get("table_schema")),
        ]
        if part
    )
    item_kind = kind or _friendly_table_type(
        row.get("table_type"), row.get("data_source_format")
    )
    footer = foot or [item_kind]
    return {
        "id": f"{role}-{asset_fqn}",
        "assetFqn": asset_fqn,
        "label": label,
        "subtitle": subtitle,
        "kicker": kicker,
        "kind": item_kind,
        "role": role,
        "depth": depth,
        "x": x,
        "y": y,
        "foot": footer,
    }


def _stack_positions(
    count: int, *, x: int, top: int = 22, bottom: int = 78
) -> List[Tuple[int, int]]:
    if count <= 0:
        return []
    if count == 1:
        return [(x, 50)]
    span = max(bottom - top, 10)
    step = span / (count - 1)
    return [(x, round(top + idx * step)) for idx in range(count)]


def _build_data_graph(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    # `system.access.table_lineage` / `column_lineage` apply row-level filtering
    # to match the querying principal's SELECT grants on the source and target
    # tables. When the actor has OBO but lacks SELECT on some upstream tier
    # (e.g., bronze / raw), those edges are filtered out and the UI shows an
    # empty graph even though lineage exists. Route `system.access.*` reads
    # through the app-principal client (broader SELECT granted at install time)
    # so the lineage topology reflects the actual crawler view. OBO continues
    # to gate the API endpoint and to drive asset metadata / visibility reads.
    return lineage_service.build_data_graph(
        _uc_for_request(request), _store_for_read(), asset_fqn, system_uc=_uc()
    )


def _build_operational_graph(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    return lineage_service.build_operational_graph(
        _uc_for_request(request),
        _store_for_read(),
        asset_fqn,
        system_uc=_uc(),
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


def _degraded_governance_payload(message: str) -> Dict[str, Any]:
    return {
        "metrics": [],
        "backlog": [],
        "glossary": [],
        "inbox": {
            "state": "degraded",
            "message": _normalize_str(message)
            or "Governance inbox is unavailable while the control plane is degraded.",
            "unreadCount": 0,
            "items": [],
        },
        "authoritative": False,
        "provenance": {
            "source": "delta_control_plane",
            "authoritative": False,
            "state": "degraded",
            "warnings": [message] if _normalize_str(message) else [],
        },
    }


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


def _bootstrap_inventory_summary(cache_scope: str) -> Dict[str, Any]:
    normalized_scope = _normalize_str(cache_scope) or "shared"

    def load() -> Dict[str, Any]:
        inventory = _visible_assets(normalized_scope)
        available_catalogs = _inventory_catalogs()
        observed_catalogs = _lineage_observed_catalogs()
        visible_catalogs = _inventory_option_values(
            inventory,
            lambda row: row.get("table_catalog"),
        )
        asset_types = _inventory_option_values(
            inventory,
            lambda row: asset_service.friendly_table_type(
                row.get("table_type"),
                row.get("data_source_format"),
            ),
        )
        asset_type_counts = _inventory_option_counts(
            inventory,
            lambda row: asset_service.friendly_table_type(
                row.get("table_type"),
                row.get("data_source_format"),
            ),
        )
        catalog_counts = _inventory_option_counts(
            inventory,
            lambda row: row.get("table_catalog"),
        )
        domains = _inventory_option_values(inventory, lambda row: row.get("domain"))
        tiers = _inventory_option_values(inventory, lambda row: row.get("tier"))
        certifications = _inventory_option_values(
            inventory, lambda row: row.get("certification")
        )
        sensitivities = _inventory_option_values(
            inventory, lambda row: row.get("sensitivity")
        )
        governance_gaps = sum(
            1
            for _, row in inventory.iterrows()
            if _normalize_str(row.get("governance_status")) == "Needs Work"
        )
        certified_assets = sum(
            1
            for _, row in inventory.iterrows()
            if _normalize_str(row.get("certification"))
            and _normalize_str(row.get("certification")) != "Unassigned"
        )
        owned_assets = sum(
            1 for _, row in inventory.iterrows() if asset_service.owner_entries(row)
        )
        return {
            "catalogs": visible_catalogs,
            "assetTypes": asset_types,
            "domains": domains,
            "tiers": tiers,
            "certifications": certifications,
            "sensitivities": sensitivities,
            "visibleAssets": len(inventory.index) if inventory is not None else 0,
            "catalogCount": len(visible_catalogs),
            "availableCatalogCount": len(available_catalogs),
            "observedCatalogCount": len(observed_catalogs),
            "governanceGaps": governance_gaps,
            "certifiedAssets": certified_assets,
            "ownedAssets": owned_assets,
            "assetTypeCounts": asset_type_counts,
            "catalogCounts": catalog_counts,
            "catalogSnapshot": visible_catalogs[:8],
        }

    return _ttl_value(
        f"runtime_bootstrap_inventory_summary:{normalized_scope}",
        60,
        load,
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


def _inventory_option_values(
    inventory: pd.DataFrame,
    extractor: Callable[[pd.Series], str],
) -> List[str]:
    if inventory is None or inventory.empty:
        return []
    values: set[str] = set()
    for _, row in inventory.iterrows():
        value = _normalize_str(extractor(row))
        if value and value != "Unassigned":
            values.add(value)
    return sorted(values)


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


def _render_unavailable_index(message: str) -> str:
    return _render_index(_bootstrap_unavailable_payload(None, message))


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


def _api_bootstrap_response(request: Request) -> JSONResponse:
    try:
        # Use the non-blocking fast path so the shell never waits on a cold
        # warehouse probe. The real probe still runs via /api/runtime/status.
        runtime_status = _uc_runtime_status_fast()
        state = (
            "live"
            if runtime_status.get("state") == "live"
            else str(runtime_status.get("state") or "degraded")
        )
        message = (
            ""
            if state == "live"
            else runtime_status.get("message")
            or "Live Databricks metadata runtime is unavailable. Fix the warehouse access or runtime configuration, then retry."
        )
        return JSONResponse(
            _shell_payload(
                request,
                mode="route-bootstrap",
                state=state,
                message=message,
                runtime_status=runtime_status,
            )
        )
    except Exception as exc:
        return JSONResponse(
            _bootstrap_unavailable_payload(
                request,
                f"Workspace bootstrap failed: {_normalize_str(exc) or 'unknown error'}.",
                state="error",
            )
        )


def _api_runtime_status_response(request: Request) -> JSONResponse:
    # Non-blocking probe: on cold-start the serverless warehouse takes 60-120s
    # to return live, during which the UI used to show *no* diagnostics banner
    # at all. The auth-mode / workspaceAccess / identity payload is derived from
    # request headers and is available instantly, so returning "loading" runtime
    # state immediately lets the OBO / degraded banner surface within seconds.
    # The warehouse probe continues in the background; clients poll this
    # endpoint until state transitions away from "loading".
    runtime_status = _uc_runtime_status_fast()
    store_status = (
        _store_status()
        if runtime_status.get("state") == "live"
        else {
            "state": "skipped",
            "message": "Governance store check skipped until the SQL runtime recovers.",
        }
    )
    summary = (
        _bootstrap_inventory_summary(_request_cache_scope(request))
        if runtime_status.get("state") == "live"
        else {"visibleAssets": 0, "availableCatalogCount": 0, "observedCatalogCount": 0}
    )
    boot_message = ""
    if runtime_status.get("state") == "live":
        if store_status.get("state") != "live":
            boot_message = _normalize_str(store_status.get("message"))
        elif int(summary.get("visibleAssets") or 0) <= 0:
            boot_message = _empty_inventory_boot_message(summary)
    capabilities = _capabilities_payload(
        request,
        runtime_status=runtime_status,
        store_status=store_status,
        summary=summary,
        boot_message=boot_message,
    )
    payload = {
        "runtime": runtime_status,
        "store": store_status,
        "capabilities": capabilities,
        "config": {
            "warehouseId": _normalize_str(os.getenv("DATABRICKS_WAREHOUSE_ID")),
            "govCatalog": _normalize_str(os.getenv("GOVHUB_CATALOG")),
            "govSchema": _normalize_str(os.getenv("GOVHUB_SCHEMA")),
            "adminEmailsConfigured": bool(_config().admin_emails),
        },
        "identity": {
            "actorEmail": _user_email(request),
            "actorRole": _user_role(request),
            "actorRoleProvisional": False,
            "authenticatedUserPresent": _user_email(request) != "unknown",
            "authMode": _request_auth_mode(request),
            "visibilityScope": _request_read_visibility_scope(request),
            "source": IDENTITY_SOURCE,
        },
        "diagnostics": _runtime_diagnostics_payload(
            request,
            runtime_status=runtime_status,
            store_status=store_status,
            summary=summary,
            capabilities=capabilities,
            boot_message=boot_message,
        ),
    }
    return JSONResponse(payload)


app.include_router(
    build_runtime_router(
        bootstrap_response=lambda request: _api_bootstrap_response(request),
        runtime_status_response=lambda request: _api_runtime_status_response(request),
    )
)


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


def api_discovery_search(
    request: Request,
    query: str = "",
    query_mode: str = Query(default="plain", alias="queryMode"),
    view: str = "All assets",
    asset_type: str = Query(default="All types", alias="type"),
    views: Optional[List[str]] = Query(default=None),
    types: Optional[List[str]] = Query(default=None),
    catalogs: Optional[List[str]] = Query(default=None),
    domains: Optional[List[str]] = Query(default=None),
    tiers: Optional[List[str]] = Query(default=None),
    certifications: Optional[List[str]] = Query(default=None),
    sensitivities: Optional[List[str]] = Query(default=None),
    sort_by: str = Query(default="Best match", alias="sortBy"),
    limit: int = 60,
    offset: int = 0,
) -> JSONResponse:
    _ensure_live_runtime()
    try:
        payload = _discovery_search_payload(
            request=request,
            query=query,
            query_mode=query_mode,
            views=views
            or ([view] if _normalize_str(view) and view != "All assets" else []),
            asset_types=types
            or (
                [asset_type]
                if _normalize_str(asset_type) and asset_type != "All types"
                else []
            ),
            catalogs=catalogs,
            domains=domains,
            tiers=tiers,
            certifications=certifications,
            sensitivities=sensitivities,
            sort_by=sort_by,
            limit=limit,
            offset=offset,
        )
    except asset_service.DiscoveryQuerySyntaxError as exc:
        detail = _normalize_str(exc.message) or "Invalid discovery query."
        return _error_response(
            request,
            status_code=400,
            source="unity-catalog-inventory",
            detail=detail,
            state="degraded",
            extra={
                "invalidQuery": asset_service.discovery_invalid_query_payload(
                    exc.message
                ),
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Discovery search is unavailable right now. "
                f"{_normalize_str(exc) or 'Unexpected metadata runtime error.'}"
            ),
        ) from exc
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    return JSONResponse(
        _with_meta(
            payload,
            request,
            source="unity-catalog-inventory",
            state="available" if actor_scoped else "degraded",
            authoritative=actor_scoped,
            capabilities={
                "workspaceScopedInventory": not actor_scoped,
            },
            warnings=[],
        )
    )


def api_asset_availability(
    payload: AssetAvailabilityRequest,
    request: Request,
) -> JSONResponse:
    _ensure_live_runtime()
    return JSONResponse(_asset_availability_payload(payload.assets, request))


def api_asset_detail(
    asset_fqn: str,
    request: Request,
    sections: List[str] = Query(default=[]),
) -> JSONResponse:
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
    return JSONResponse(
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
        )
    )


def api_patch_column_description(
    asset_fqn: str,
    column_name: str,
    payload: ColumnDescriptionPatch,
    request: Request,
) -> JSONResponse:
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


def api_lineage(asset_fqn: str, request: Request) -> JSONResponse:
    _ensure_live_runtime()
    actor_scoped = _request_auth_mode(request) == capability_service.OBO_AVAILABLE_MODE
    if not actor_scoped:
        return JSONResponse(
            _with_meta(
                {
                    "fqn": asset_fqn,
                    "graphs": {
                        "data": {"nodes": [], "edges": [], "meta": {}},
                        "operational": {"nodes": [], "edges": [], "meta": {}},
                    },
                    "columnLineage": {"upstream": [], "downstream": [], "meta": {}},
                    "lineageDepth": {
                        "oneHop": {"upstream": [], "downstream": []},
                        "twoHop": {"upstream": {}, "downstream": {}},
                    },
                    "edgeDetails": {},
                    "stats": {},
                    "unavailableReason": "Lineage is not available for actor-scoped reads in the current runtime mode.",
                },
                request,
                source="unity-catalog-lineage",
                state="degraded",
                authoritative=False,
                entity_fqn=asset_fqn,
                entity_id=asset_fqn,
                warnings=[
                    "Lineage stays degraded until Databricks per-user authorization / OBO is available for actor-scoped reads.",
                ],
                unavailable_reason="Lineage is not available for actor-scoped reads in the current runtime mode.",
            )
        )
    payload = _lineage_payload(asset_fqn, request=request)
    stats = payload.get("stats") or {}
    column_lineage = payload.get("columnLineage") or {}
    has_lineage_context = any(
        _safe_int(stats.get(key)) > 0
        for key in [
            "upstreamCount",
            "downstreamCount",
            "operationalProducerCount",
            "operationalConsumerCount",
        ]
    ) or bool(column_lineage.get("upstream") or column_lineage.get("downstream"))
    visibility = _asset_visibility_record(asset_fqn, request)
    if not visibility.get("openable") and not has_lineage_context:
        if visibility.get("visibilityState") == "hidden":
            return _error_response(
                request,
                status_code=404,
                source="unity-catalog-lineage",
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
                source="unity-catalog-lineage",
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
            source="unity-catalog-lineage",
            detail="Asset not found.",
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            capabilities={
                "visibilityState": visibility.get("visibilityState") or "missing"
            },
        )
    return JSONResponse(
        _with_meta(
            payload,
            request,
            source="unity-catalog-lineage",
            state="available" if actor_scoped else "degraded",
            authoritative=actor_scoped,
            entity_fqn=asset_fqn,
            entity_id=asset_fqn,
            capabilities={
                "visibilityState": visibility.get("visibilityState"),
                "includesOperationalContext": bool(
                    (payload.get("graphs") or {}).get("operational")
                ),
            },
            warnings=[],
        )
    )


def api_governance_summary(request: Request) -> JSONResponse:
    _ensure_live_runtime()
    _ensure_governance_store()
    return JSONResponse(_governance_summary(request))


def api_governance_glossary(request: Request) -> JSONResponse:
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


app.include_router(
    build_discovery_router(
        search_endpoint=api_discovery_search,
    )
)
app.include_router(
    build_assets_router(
        availability_endpoint=api_asset_availability,
        detail_endpoint=api_asset_detail,
        patch_column_description_endpoint=api_patch_column_description,
        patch_column_tags_endpoint=api_patch_column_tags,
        patch_column_metadata_endpoint=api_patch_column_metadata,
        patch_asset_description_endpoint=api_patch_asset_description,
        patch_asset_metadata_endpoint=api_patch_asset_metadata,
        patch_asset_owners_endpoint=api_patch_asset_owners,
        patch_asset_tags_endpoint=api_patch_asset_tags,
    )
)
app.include_router(
    build_lineage_router(
        lineage_endpoint=api_lineage,
    )
)
app.include_router(
    build_governance_router(
        summary_endpoint=api_governance_summary,
        glossary_list_endpoint=api_governance_glossary,
        glossary_term_endpoint=api_governance_glossary_term,
        create_request_endpoint=api_governance_create_request,
        patch_request_endpoint=api_governance_patch_request,
        patch_notification_endpoint=api_governance_patch_notification,
        upsert_owner_endpoint=api_governance_upsert_owner,
        upsert_glossary_endpoint=api_governance_upsert_glossary,
        patch_glossary_endpoint=api_governance_patch_glossary,
    )
)


@app.get("/{client_path:path}", response_class=HTMLResponse, include_in_schema=False)
def client_route_shell(client_path: str, request: Request) -> HTMLResponse:
    normalized = _normalize_str(client_path)
    if not normalized:
        return _spa_shell_response(request)
    root = normalized.split("/", 1)[0].lower()
    if root in CLIENT_ROUTE_PREFIXES:
        return _spa_shell_response(request)
    raise HTTPException(status_code=404, detail="Not found.")
