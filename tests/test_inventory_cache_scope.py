"""Regression tests for the bootstrap inventory cache scoping fix.

Prior to commit (pending) the inventory bootstrap summary accidentally passed
its normalized_scope string as the `request` argument to visible_assets(),
which sent the string through _request_cache_scope() and collapsed every
caller into the same "unknown|app-principal-only" bucket. OBO- and
app-principal-scoped inventory reads would then silently share a cache.

These tests lock in the fix: calling bootstrap_inventory_summary() with two
distinct cache scopes must produce two distinct inner runtime_inventory
cache keys.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from govhub.api import cache as api_cache
from govhub.services import inventory as inventory_service


class BootstrapInventoryCacheScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        with api_cache._CACHE_LOCK:
            api_cache._TTL_CACHE.clear()

    def _runtime_deps_stub(self):
        hidden = tuple()

        def request_cache_scope(request):
            # The fix shouldn't route the scope through here at all; if it
            # does we return a sentinel so the test can detect the regression.
            return "REGRESSION:request_cache_scope_was_called"

        def store_for_read():
            return object()

        def uc_for_request(_request):
            return object()

        return hidden, request_cache_scope, store_for_read, uc_for_request

    def test_bootstrap_inventory_summary_scopes_inner_cache_per_auth(self) -> None:
        load_calls: list[str] = []
        empty_frame = pd.DataFrame(
            columns=[
                "table_catalog",
                "table_schema",
                "table_name",
                "table_type",
                "data_source_format",
                "governance_status",
                "certification",
                "domain",
                "tier",
                "sensitivity",
            ],
        )

        def fake_visible_assets(_uc, _store, **kwargs):
            load_calls.append("visible_assets")
            return empty_frame

        def fake_inventory_catalogs(_uc, **kwargs):
            return []

        def fake_lineage_observed_catalogs(_uc, **kwargs):
            return []

        with patch.object(inventory_service, "_runtime_deps", self._runtime_deps_stub), \
             patch("govhub.services.assets.visible_assets", side_effect=fake_visible_assets), \
             patch(
                 "govhub.services.assets.inventory_catalogs",
                 side_effect=fake_inventory_catalogs,
             ), \
             patch(
                 "govhub.services.assets.lineage_observed_catalogs",
                 side_effect=fake_lineage_observed_catalogs,
             ):
            inventory_service.bootstrap_inventory_summary("alice@example.com|obo-available")
            inventory_service.bootstrap_inventory_summary("bob@example.com|app-principal-only")

        with api_cache._CACHE_LOCK:
            cache_keys = sorted(api_cache._TTL_CACHE.keys())

        alice_key = "runtime_inventory:alice@example.com|obo-available"
        bob_key = "runtime_inventory:bob@example.com|app-principal-only"
        regression_key = "runtime_inventory:REGRESSION:request_cache_scope_was_called"

        self.assertIn(alice_key, cache_keys)
        self.assertIn(bob_key, cache_keys)
        self.assertNotIn(
            regression_key,
            cache_keys,
            msg=(
                "bootstrap_inventory_summary still routes its scope through "
                "request_cache_scope — OBO and app-principal reads would share a bucket."
            ),
        )


if __name__ == "__main__":
    unittest.main()
