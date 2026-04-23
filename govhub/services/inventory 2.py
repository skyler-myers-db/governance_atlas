from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

import pandas as pd
from fastapi import Request

from govhub.api.cache import _TTL_CACHE, _CACHE_LOCK, _ttl_cache_pop, _ttl_value
from govhub.services import assets as asset_service
from govhub.services.assets import normalize_str as _normalize_str
from govhub.services import insights as insights_service


def _runtime_deps():
    # Lazy bag of runtime_app callables/constants so this module does not pull
    # runtime_app at import time (runtime_app itself imports this module).
    from runtime_app import (
        HIDDEN_CATALOGS,
        _request_cache_scope,
        _store_for_read,
        _uc_for_request,
    )

    return HIDDEN_CATALOGS, _request_cache_scope, _store_for_read, _uc_for_request


def inventory(request: Optional[Request] = None) -> pd.DataFrame:
    hidden_catalogs, _, store_for_read, uc_for_request = _runtime_deps()
    return asset_service.inventory(
        uc_for_request(request),
        store_for_read(),
        hidden_catalogs=hidden_catalogs,
    )


def visible_assets(
    request: Optional[Request] = None,
    *,
    cache_scope: str = "",
) -> pd.DataFrame:
    """Return the visible-assets inventory for this request, memoized for 5 min
    per cache scope ({actor}|{auth-mode}).

    **OBO fallback guard (round 14):** when the request's OBO client silently
    latches to the app-principal fallback (e.g. the user's token is missing
    the `sql` scope), the resulting DataFrame reflects the SP's narrower
    catalog visibility — NOT the user's actor-scoped view. Caching that
    under the OBO scope key would then serve SP-only results to the
    OBO-authenticated user for the full 5-minute TTL, which is exactly
    the regression reported when landing/test catalogs disappeared after
    a deploy cold-start. We now build the UC client BEFORE delegating to
    the cache and, if the client reports `obo_scope_fallback=True` after
    the load, evict the cache entry so the next request attempts OBO
    again instead of serving the degraded result for 5 minutes.
    """
    import time

    hidden_catalogs, request_cache_scope, store_for_read, uc_for_request = (
        _runtime_deps()
    )
    scope = cache_scope or request_cache_scope(request)
    normalized_scope = _normalize_str(scope) or "shared"
    cache_key = f"runtime_inventory:{normalized_scope}"

    now = time.time()
    cached = _TTL_CACHE.get(cache_key)
    if cached and now - cached[0] < 300:
        return cached[1]

    uc_client = uc_for_request(request)
    result = asset_service.visible_assets(
        uc_client,
        store_for_read(),
        hidden_catalogs=hidden_catalogs,
    )

    fallback_triggered = False
    runtime_context_fn = getattr(uc_client, "runtime_context", None)
    if callable(runtime_context_fn):
        try:
            ctx = runtime_context_fn() or {}
            fallback_triggered = bool(ctx.get("obo_scope_fallback"))
        except Exception:
            fallback_triggered = False

    if fallback_triggered:
        # Don't poison the OBO cache key with SP-scoped data. Evict so the
        # next request re-tries OBO; user's landing/test catalogs return as
        # soon as the underlying primary client succeeds.
        _ttl_cache_pop(cache_key)
    else:
        with _CACHE_LOCK:
            _TTL_CACHE[cache_key] = (now, result)

    return result


def inventory_catalogs(request: Optional[Request] = None) -> List[str]:
    hidden_catalogs, _, _, uc_for_request = _runtime_deps()
    return asset_service.inventory_catalogs(
        uc_for_request(request),
        hidden_catalogs=hidden_catalogs,
    )


def lineage_observed_catalogs(request: Optional[Request] = None) -> List[str]:
    hidden_catalogs, _, _, uc_for_request = _runtime_deps()
    return asset_service.lineage_observed_catalogs(
        uc_for_request(request),
        hidden_catalogs=hidden_catalogs,
    )


def inventory_row(
    asset_fqn: str,
    request: Optional[Request] = None,
) -> pd.Series:
    hidden_catalogs, _, store_for_read, uc_for_request = _runtime_deps()
    return asset_service.inventory_row(
        uc_for_request(request),
        store_for_read(),
        asset_fqn,
        hidden_catalogs=hidden_catalogs,
    )


def asset_exists(asset_fqn: str, request: Optional[Request] = None) -> bool:
    hidden_catalogs, _, store_for_read, uc_for_request = _runtime_deps()
    return asset_service.asset_exists(
        uc_for_request(request),
        store_for_read(),
        asset_fqn,
        hidden_catalogs=hidden_catalogs,
    )


def asset_is_visible(asset_fqn: str, request: Optional[Request] = None) -> bool:
    hidden_catalogs, _, store_for_read, uc_for_request = _runtime_deps()
    if request is not None:
        inv = visible_assets(request)
        return asset_service.asset_is_visible(inv, asset_fqn)
    return asset_service.asset_is_visible(
        uc_for_request(request),
        store_for_read(),
        asset_fqn,
        hidden_catalogs=hidden_catalogs,
    )


def asset_is_openable(asset_fqn: str, request: Optional[Request] = None) -> bool:
    return asset_is_visible(asset_fqn, request)


def inventory_option_counts(
    inv: pd.DataFrame,
    extractor: Callable[[pd.Series], str],
) -> Dict[str, int]:
    if inv is None or inv.empty:
        return {}
    counts: Dict[str, int] = {}
    for _, row in inv.iterrows():
        value = _normalize_str(extractor(row))
        if not value or value == "Unassigned":
            continue
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def inventory_option_values(
    inv: pd.DataFrame,
    extractor: Callable[[pd.Series], str],
) -> List[str]:
    if inv is None or inv.empty:
        return []
    values: set[str] = set()
    for _, row in inv.iterrows():
        value = _normalize_str(extractor(row))
        if value and value != "Unassigned":
            values.add(value)
    return sorted(values)


def bootstrap_inventory_summary(cache_scope: str) -> Dict[str, Any]:
    normalized_scope = _normalize_str(cache_scope) or "shared"

    def load() -> Dict[str, Any]:
        # Round 14 OBO fix: bootstrap is called without a FastAPI Request
        # so `visible_assets(None, ...)` would route through the
        # app-principal UC client. Using `cache_scope=normalized_scope`
        # here (the per-actor OBO scope) previously poisoned the shared
        # `runtime_inventory:<scope>` cache key with SP-only rows,
        # causing later OBO-authenticated requests to get SP results
        # for the full 5-minute TTL. Scope this bootstrap-only load
        # under a distinct suffix so the boot-time SP snapshot never
        # collides with the discovery-search cache.
        inv = visible_assets(
            None, cache_scope=f"{normalized_scope}|bootstrap-app-principal"
        )
        available_catalogs = inventory_catalogs()
        observed_catalogs = lineage_observed_catalogs()
        visible_catalogs = inventory_option_values(
            inv,
            lambda row: row.get("table_catalog"),
        )
        asset_types = inventory_option_values(
            inv,
            lambda row: asset_service.friendly_table_type(
                row.get("table_type"),
                row.get("data_source_format"),
            ),
        )
        asset_type_counts = inventory_option_counts(
            inv,
            lambda row: asset_service.friendly_table_type(
                row.get("table_type"),
                row.get("data_source_format"),
            ),
        )
        catalog_counts = inventory_option_counts(
            inv,
            lambda row: row.get("table_catalog"),
        )
        domains = inventory_option_values(inv, lambda row: row.get("domain"))
        tiers = inventory_option_values(inv, lambda row: row.get("tier"))
        certifications = inventory_option_values(
            inv, lambda row: row.get("certification")
        )
        sensitivities = inventory_option_values(
            inv, lambda row: row.get("sensitivity")
        )
        governance_gaps = sum(
            1
            for _, row in inv.iterrows()
            if _normalize_str(row.get("governance_status")) == "Needs Work"
        )
        certified_assets = sum(
            1
            for _, row in inv.iterrows()
            if _normalize_str(row.get("certification"))
            and _normalize_str(row.get("certification")) != "Unassigned"
        )
        owned_assets = sum(
            1 for _, row in inv.iterrows() if asset_service.owner_entries(row)
        )
        # A9.5 Insights tiles — gap-analysis counts over the same
        # visible-assets frame we already have in hand. No new data
        # collection; only what `compute_gap_analysis` derives from the
        # inventory + the quality-runner ledger (ledger intentionally
        # None here — the bootstrap path can't cheaply read the store,
        # and the dedicated /api/insights/gap-analysis endpoint pulls
        # the quality frame itself).
        gap_analysis = insights_service.compute_gap_analysis(
            inv,
            None,
            limit=0,
        )
        gap_tiles = gap_analysis.get("tiles", {}) if isinstance(gap_analysis, dict) else {}
        return {
            "catalogs": visible_catalogs,
            "assetTypes": asset_types,
            "domains": domains,
            "tiers": tiers,
            "certifications": certifications,
            "sensitivities": sensitivities,
            "visibleAssets": len(inv.index) if inv is not None else 0,
            "catalogCount": len(visible_catalogs),
            "availableCatalogCount": len(available_catalogs),
            "observedCatalogCount": len(observed_catalogs),
            "governanceGaps": governance_gaps,
            "certifiedAssets": certified_assets,
            "ownedAssets": owned_assets,
            "assetTypeCounts": asset_type_counts,
            "catalogCounts": catalog_counts,
            "catalogSnapshot": visible_catalogs[:8],
            "ownershipGaps": int(gap_tiles.get("ownershipGaps", 0)),
            "policyGaps": int(gap_tiles.get("policyGaps", 0)),
            "freshnessGaps": int(gap_tiles.get("freshnessGaps", 0)),
            "qualityIncidents": int(gap_tiles.get("qualityIncidents", 0)),
        }

    return _ttl_value(
        f"runtime_bootstrap_inventory_summary:{normalized_scope}",
        60,
        load,
    )
