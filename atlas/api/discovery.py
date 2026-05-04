from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional, Sequence

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from atlas.api.identity import _request_auth_mode
from atlas.api.response import _error_response, _with_meta
from atlas.services import assets as asset_service
from atlas.services import capabilities as capability_service
from atlas.services.assets import normalize_str as _normalize_str


DISCOVERY_STATE_LIVE = "live"
DISCOVERY_STATE_LOADING = "loading"
DISCOVERY_STATE_UNAVAILABLE = "unavailable"
DISCOVERY_STATE_NO_VISIBLE_ASSETS = "no_visible_assets"
DISCOVERY_STATE_NO_RESULTS = "no_results"
DISCOVERY_STATE_FILTERS_EXCLUDE_ALL = "filters_exclude_all"
_DISCOVERY_INVENTORY_WARMING: set[str] = set()
_DISCOVERY_INVENTORY_WARMING_LOCK = threading.Lock()


def _coerce_filter_list(value: Any) -> List[str]:
    """Normalize a filter argument into a plain list of strings.

    When the endpoint is invoked via FastAPI routing, `Query(default=None)`
    arguments arrive as either `None` or `list[str]`. When tests invoke the
    function directly, the default Query sentinel object can leak through.
    Normalizing here keeps `_any_filter_applied` trivially iterable.
    """

    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    try:
        return [str(item) for item in value]
    except TypeError:
        return []


def _any_filter_applied(
    query: str,
    views: Optional[Sequence[str]],
    types: Optional[Sequence[str]],
    catalogs: Optional[Sequence[str]],
    domains: Optional[Sequence[str]],
    tiers: Optional[Sequence[str]],
    certifications: Optional[Sequence[str]],
    sensitivities: Optional[Sequence[str]],
) -> bool:
    """Return True when at least one narrowing signal was sent by the caller.

    This is what lets the envelope distinguish `no_visible_assets` (the
    operator sees nothing at the default scope) from `filters_exclude_all`
    (the operator asked for a narrow slice that happens to be empty).
    """

    if _normalize_str(query):
        return True
    for group in (views, types, catalogs, domains, tiers, certifications, sensitivities):
        for value in _coerce_filter_list(group):
            if _normalize_str(value):
                return True
    return False


def resolve_discovery_state(
    *,
    runtime_state: str,
    result_count: int,
    visible_assets_count: int,
    filters_applied: bool,
) -> Dict[str, str]:
    """Return (state, reason) for the discovery envelope.

    Purely functional so it is trivially testable without spinning a
    request up. Reasons are short, operator-facing strings intended for
    diagnostics surfaces / screenshots — not for end users.
    """

    normalized_runtime = _normalize_str(runtime_state).lower() or "unavailable"
    if normalized_runtime != "live":
        return {
            "discoveryState": DISCOVERY_STATE_UNAVAILABLE,
            "discoveryStateReason": (
                f"Runtime is {normalized_runtime}; discovery cannot enumerate assets."
            ),
        }

    if int(result_count or 0) > 0:
        return {
            "discoveryState": DISCOVERY_STATE_LIVE,
            "discoveryStateReason": "",
        }

    if filters_applied:
        return {
            # Audit vocabulary keeps both names: `filters_exclude_all` is
            # the canonical form, `no_results` is the alias consumers can
            # match against.
            "discoveryState": DISCOVERY_STATE_FILTERS_EXCLUDE_ALL,
            "discoveryStateReason": (
                "Filters/query returned zero matches against the actor-visible inventory."
            ),
            "discoveryStateAlias": DISCOVERY_STATE_NO_RESULTS,
        }

    if int(visible_assets_count or 0) == 0:
        return {
            "discoveryState": DISCOVERY_STATE_NO_VISIBLE_ASSETS,
            "discoveryStateReason": (
                "Runtime is live but the actor-scoped inventory returned zero visible assets."
            ),
        }

    # Fallback: the inventory claims visibility but the default-scope
    # search still returned nothing. Surface that as filters_exclude_all
    # so the UI can suggest relaxing scope.
    return {
        "discoveryState": DISCOVERY_STATE_FILTERS_EXCLUDE_ALL,
        "discoveryStateReason": (
            "Default-scope search returned zero matches despite a non-empty inventory."
        ),
        "discoveryStateAlias": DISCOVERY_STATE_NO_RESULTS,
    }


def _visible_assets_count_safe(request: Optional[Request]) -> int:
    """Best-effort visible-asset count for envelope reasoning.

    The inventory DataFrame is already cached per-actor, so this call is
    cheap on warm paths. On cold paths / runtime blips we fall back to 0
    so the envelope state machine can still classify the response.
    """

    try:
        from runtime_app import _visible_assets  # local import — same as discovery_search_payload

        frame = _visible_assets(request)
    except Exception:
        return 0
    try:
        return int(len(frame.index))
    except Exception:
        try:
            return int(len(frame))
        except Exception:
            return 0


def _warm_actor_discovery_inventory(request: Request, cache_scope: str) -> None:
    normalized_scope = _normalize_str(cache_scope) or "shared"
    with _DISCOVERY_INVENTORY_WARMING_LOCK:
        if normalized_scope in _DISCOVERY_INVENTORY_WARMING:
            return
        _DISCOVERY_INVENTORY_WARMING.add(normalized_scope)

    def run() -> None:
        try:
            try:
                from runtime_app import _visible_assets

                _visible_assets(request)
            except Exception:
                pass
        finally:
            with _DISCOVERY_INVENTORY_WARMING_LOCK:
                _DISCOVERY_INVENTORY_WARMING.discard(normalized_scope)

    threading.Thread(
        target=run,
        name=f"atlas-discovery-inventory-warm-{normalized_scope}",
        daemon=True,
    ).start()


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
    business_criticalities: Optional[List[str]] = Query(
        default=None, alias="businessCriticalities"
    ),
    cde_only: bool = Query(default=False, alias="cdeOnly"),
    sort_by: str = Query(default="Best match", alias="sortBy"),
    limit: int = 60,
    offset: int = 0,
    refresh: Optional[str] = Query(default=None),
) -> JSONResponse:
    from runtime_app import (
        _cached_visible_assets,
        _discovery_search_payload,
        _ensure_live_runtime,
        _fast_bootstrap_inventory_summary,
        _request_cache_scope,
        _uc_runtime_status,
    )

    _ensure_live_runtime()

    # Round 19 OBO hardening: when the caller adds `?refresh=1` (the
    # Discovery "Retry with actor scope" button), drop the per-actor
    # inventory cache before the search so the next request re-attempts
    # OBO from scratch. Guarded so tests that mock `_discovery_search_payload`
    # don't need to also mock the scope helper.
    if _normalize_str(refresh).lower() in {"1", "true", "yes"}:
        try:
            from runtime_app import _request_cache_scope
            from atlas.api.cache import _ttl_cache_pop

            scope = _request_cache_scope(request)
            normalized_scope = _normalize_str(scope) or "shared"
            _ttl_cache_pop(f"runtime_inventory:{normalized_scope}")
        except Exception:
            # The refresh hop is best-effort — if the runtime isn't ready,
            # the outer `_ensure_live_runtime()` has already raised.
            pass

    # Cold Databricks inventory hydration must not freeze the Discovery page.
    # If the actor-scoped inventory is not cached yet, kick the real live
    # metadata load in the background and return a truthful loading envelope.
    # The frontend treats this as an unfinished state and refetches until the
    # runtime cache contains real Unity Catalog rows.
    cache_scope = _request_cache_scope(request)
    if _cached_visible_assets(request) is None and not _normalize_str(refresh):
        _warm_actor_discovery_inventory(request, cache_scope)
        summary = _fast_bootstrap_inventory_summary(cache_scope, start_background=True)
        query_state = {
            "state": DISCOVERY_STATE_LOADING,
            "message": (
                "Live Unity Catalog inventory is hydrating for this actor. "
                "Search results will refresh automatically."
            ),
            "syntaxHint": asset_service.DISCOVERY_QUERY_SYNTAX_HINT,
            "supportedFields": list(asset_service.DISCOVERY_QUERY_SUPPORTED_FIELDS),
            "clauseChips": [],
        }
        payload = {
            "assets": [],
            "count": 0,
            "facets": {
                "views": [],
                "assetTypes": [],
                "catalogs": [],
                "domains": [],
                "tiers": [],
                "certifications": [],
                "sensitivities": [],
                "owners": [],
            },
            "queryState": query_state,
            "selection": {"primaryAssetFqn": "", "reason": "inventory_loading"},
        }
        envelope = _with_meta(
            payload,
            request,
            source="unity-catalog-inventory",
            state=DISCOVERY_STATE_LOADING,
            authoritative=False,
            capabilities={
                "workspaceScopedInventory": _request_auth_mode(request)
                != capability_service.OBO_AVAILABLE_MODE,
                "inventoryHydrating": True,
                "visibleAssetsPreloaded": int(summary.get("visibleAssets") or 0),
            },
            warnings=[query_state["message"]],
        )
        meta = envelope.setdefault("meta", {})
        meta["discoveryState"] = DISCOVERY_STATE_LOADING
        meta["discoveryStateReason"] = query_state["message"]
        meta["visibleAssetCount"] = int(summary.get("visibleAssets") or 0)
        meta["inventoryHydrating"] = True
        meta["oboScopeFallback"] = False
        return JSONResponse(envelope)

    # Snapshot the per-request UC client BEFORE the payload build so we
    # can read its `obo_scope_fallback` flag afterwards without racing
    # another fallback-latching client constructed inside the payload
    # path. Guarded for the same test-isolation reason as above.
    uc_client = None
    try:
        from runtime_app import _uc_for_request

        uc_client = _uc_for_request(request)
    except Exception:
        uc_client = None
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
            business_criticalities=business_criticalities,
            cde_only=cde_only,
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

    # A1.2: surface fine-grained discovery vocabulary alongside the
    # existing `state` field so the frontend can render truthful empty
    # states without overclaiming inventory coverage.
    try:
        runtime_state = _normalize_str(_uc_runtime_status().get("state")) or "unavailable"
    except Exception:
        runtime_state = "unavailable"
    result_count = int(payload.get("count") or 0) if isinstance(payload, dict) else 0
    visible_count = _visible_assets_count_safe(request)
    filters_applied = _any_filter_applied(
        query=query,
        views=views,
        types=types,
        catalogs=catalogs,
        domains=domains,
        tiers=tiers,
        certifications=certifications,
        sensitivities=sensitivities,
    )
    discovery_state_fields: Dict[str, Any] = resolve_discovery_state(
        runtime_state=runtime_state,
        result_count=result_count,
        visible_assets_count=visible_count,
        filters_applied=filters_applied,
    )

    # Round 19 OBO hardening: read the fallback flag off the UC client AFTER
    # the payload build. If the request's OBO client silently degraded to
    # the app-principal during the inventory read, surface that plainly so
    # the Discovery frontend can render a "Showing app-principal view —
    # Retry with actor scope" banner instead of letting the user stare at
    # a narrower catalog set with no explanation.
    obo_fallback_triggered = False
    runtime_context_fn = getattr(uc_client, "runtime_context", None)
    if callable(runtime_context_fn):
        try:
            ctx = runtime_context_fn() or {}
            obo_fallback_triggered = bool(ctx.get("obo_scope_fallback"))
        except Exception:
            obo_fallback_triggered = False
    fallback_reason = (
        "The forwarded user token is missing the `sql` scope; Discovery is "
        "showing the app-principal view of the catalog. Re-auth then retry "
        "to restore the actor-scoped view."
    )
    warnings = [fallback_reason] if obo_fallback_triggered else []

    state = "available"
    if obo_fallback_triggered or not actor_scoped:
        state = "degraded"

    envelope = _with_meta(
        payload,
        request,
        source="unity-catalog-inventory",
        state=state,
        authoritative=actor_scoped and not obo_fallback_triggered,
        capabilities={
            "workspaceScopedInventory": (not actor_scoped) or obo_fallback_triggered,
        },
        warnings=warnings,
    )
    meta = envelope.get("meta")
    if isinstance(meta, dict):
        # Additive: do not replace the existing `state` contract. Consumers
        # that still read `meta.state` keep working; new consumers read
        # `meta.discoveryState` + `meta.discoveryStateReason`.
        meta["discoveryState"] = discovery_state_fields["discoveryState"]
        meta["discoveryStateReason"] = discovery_state_fields.get(
            "discoveryStateReason", ""
        )
        if "discoveryStateAlias" in discovery_state_fields:
            meta["discoveryStateAlias"] = discovery_state_fields["discoveryStateAlias"]
        meta["visibleAssetCount"] = int(visible_count)
        meta["oboScopeFallback"] = bool(obo_fallback_triggered)
        if obo_fallback_triggered:
            meta["oboFallbackReason"] = fallback_reason
    return JSONResponse(envelope)


def build_discovery_router() -> APIRouter:
    router = APIRouter(tags=["discovery"])
    router.add_api_route(
        "/api/discovery/search",
        api_discovery_search,
        methods=["GET"],
        response_class=JSONResponse,
        name="api_discovery_search",
    )
    return router
