"""Response envelope helpers for the Governance Hub API.

Builds the `meta` block that every read endpoint attaches to its payload, along
with `_error_response` for failure shapes. Pure formatting — depends only on
identity helpers and capability metadata.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Request
from fastapi.responses import JSONResponse

from govhub.api.identity import _request_auth_mode
from govhub.services import capabilities as capability_service
from govhub.services.assets import normalize_str as _normalize_str


def _utc_iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _now_iso() -> str:
    return _utc_iso(datetime.now(timezone.utc))


def _future_iso(seconds: int) -> str:
    return _utc_iso(datetime.now(timezone.utc) + timedelta(seconds=seconds))


def _request_scope_warning(request: Optional[Request], source: str) -> str:
    auth_mode = _request_auth_mode(request)
    normalized_source = _normalize_str(source).lower()
    if auth_mode == capability_service.OBO_AVAILABLE_MODE:
        return ""
    if normalized_source.startswith("unity-catalog"):
        return (
            "This response is sourced from workspace-scoped app-principal metadata. "
            "Do not treat it as actor-scoped proof until Databricks per-user authorization / OBO is available."
        )
    return ""


def _response_meta(
    request: Optional[Request],
    *,
    source: str,
    state: str = "available",
    authoritative: bool = True,
    entity_fqn: str | None = None,
    entity_id: str | None = None,
    capabilities: Dict[str, Any] | None = None,
    allowed_actions: Dict[str, Any] | None = None,
    warnings: List[str] | None = None,
    unavailable_reason: str = "",
) -> Dict[str, Any]:
    scope_warning = _request_scope_warning(request, source)
    warning_list = [*(warnings or [])]
    if scope_warning and scope_warning not in warning_list:
        warning_list.append(scope_warning)
    auth_mode = _request_auth_mode(request)
    read_scope = capability_service.runtime_visibility_scope(auth_mode)
    normalized_state = _normalize_str(state) or "unknown"
    resolved_authoritative = bool(authoritative) and not bool(scope_warning)
    if not resolved_authoritative and normalized_state == "available":
        normalized_state = "degraded"
    return {
        "state": normalized_state,
        "entityId": entity_id,
        "entityFqn": entity_fqn,
        "source": source,
        "authoritative": resolved_authoritative,
        "observedAt": _now_iso(),
        "staleAfter": _future_iso(60),
        "capabilities": capabilities or {},
        "allowedActions": allowed_actions or {},
        "warnings": warning_list,
        "degraded": normalized_state in {"degraded", "unknown"} or bool(warning_list),
        "visibilityScope": read_scope,
        "readScope": read_scope,
        "authMode": auth_mode,
        "productMode": auth_mode,
        "unavailableReason": _normalize_str(unavailable_reason),
    }


def _with_meta(
    payload: Dict[str, Any],
    request: Optional[Request],
    *,
    source: str,
    state: str = "available",
    authoritative: bool = True,
    entity_fqn: str | None = None,
    entity_id: str | None = None,
    capabilities: Dict[str, Any] | None = None,
    allowed_actions: Dict[str, Any] | None = None,
    warnings: List[str] | None = None,
    unavailable_reason: str = "",
) -> Dict[str, Any]:
    next_payload = dict(payload or {})
    resolved_meta = _response_meta(
        request,
        source=source,
        state=state,
        authoritative=authoritative,
        entity_fqn=entity_fqn,
        entity_id=entity_id,
        capabilities=capabilities,
        allowed_actions=allowed_actions,
        warnings=warnings,
        unavailable_reason=unavailable_reason,
    )
    next_payload["authoritative"] = bool(resolved_meta.get("authoritative"))
    next_payload["meta"] = resolved_meta
    next_payload["errors"] = list(next_payload.get("errors") or [])
    return next_payload


def _error_response(
    request: Optional[Request],
    *,
    status_code: int,
    source: str,
    detail: str,
    state: str = "unavailable",
    entity_fqn: str | None = None,
    entity_id: str | None = None,
    capabilities: Dict[str, Any] | None = None,
    warnings: List[str] | None = None,
    extra: Dict[str, Any] | None = None,
) -> JSONResponse:
    payload = dict(extra or {})
    payload["detail"] = detail
    payload["errors"] = list(payload.get("errors") or [{"message": detail}])
    payload["meta"] = _response_meta(
        request,
        source=source,
        state=state,
        authoritative=False,
        entity_fqn=entity_fqn,
        entity_id=entity_id,
        capabilities=capabilities,
        warnings=warnings,
        unavailable_reason=detail,
    )
    payload["authoritative"] = False
    return JSONResponse(status_code=status_code, content=payload)
