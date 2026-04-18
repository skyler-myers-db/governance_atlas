from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

import pandas as pd
from fastapi import Request

from govhub.api.cache import _ttl_value
from govhub.services import assets as asset_service
from govhub.services.assets import normalize_str as _normalize_str


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
    hidden_catalogs, request_cache_scope, store_for_read, uc_for_request = (
        _runtime_deps()
    )
    scope = cache_scope or request_cache_scope(request)
    normalized_scope = _normalize_str(scope) or "shared"
    return _ttl_value(
        f"runtime_inventory:{normalized_scope}",
        300,
        lambda: asset_service.visible_assets(
            uc_for_request(request),
            store_for_read(),
            hidden_catalogs=hidden_catalogs,
        ),
    )


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
        # NOTE: preserves an existing (buggy but load-bearing) behavior where
        # the string scope is passed positionally as `request` — the resulting
        # cache key always degrades to "unknown|app-principal-only". Fixing it
        # here would silently change cache semantics, so the bug is preserved
        # verbatim and should be addressed in its own behavior-changing patch.
        inv = visible_assets(normalized_scope)
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
        }

    return _ttl_value(
        f"runtime_bootstrap_inventory_summary:{normalized_scope}",
        60,
        load,
    )
