from __future__ import annotations

import ast
import unittest
from unittest.mock import patch
from pathlib import Path

import pandas as pd

from govhub.services import lineage as lineage_service


class FakeUC:
    def __init__(self, warehouse_id: str = "warehouse-1") -> None:
        self.warehouse_id = warehouse_id


class LineageCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        lineage_service._TTL_CACHE.clear()

    def test_lineage_payload_cache_keys_include_request_scope(self) -> None:
        uc = FakeUC()
        store = object()
        load_calls: list[str] = []

        def fake_build(_uc, _store, asset_fqn: str, **_kwargs):
            load_calls.append(asset_fqn)
            return {
                "fqn": asset_fqn,
                "sequence": len(load_calls),
            }

        with patch("govhub.services.lineage._build_lineage_payload", side_effect=fake_build):
            alice_first = lineage_service.lineage_payload(
                uc,
                store,
                "main.sales.orders",
                cache_scope="alice@example.com",
            )
            alice_second = lineage_service.lineage_payload(
                uc,
                store,
                "main.sales.orders",
                cache_scope="alice@example.com",
            )
            bob_first = lineage_service.lineage_payload(
                uc,
                store,
                "main.sales.orders",
                cache_scope="bob@example.com",
            )

        self.assertEqual(alice_first["sequence"], 1)
        self.assertEqual(alice_second["sequence"], 1)
        self.assertEqual(bob_first["sequence"], 2)
        self.assertEqual(len(load_calls), 2)
        # Cache keys now include a `:tier=full` (or `:tier=1h`) suffix so
        # first-hop and full payloads coexist for the same user + asset.
        self.assertIn(
            "lineage:warehouse-1:alice@example.com:main.sales.orders:tier=full",
            lineage_service._TTL_CACHE,
        )
        self.assertIn(
            "lineage:warehouse-1:bob@example.com:main.sales.orders:tier=full",
            lineage_service._TTL_CACHE,
        )

    def test_invalidate_lineage_caches_clears_all_scoped_variants_for_asset(self) -> None:
        uc = FakeUC()
        store = object()
        load_calls: list[str] = []

        def fake_build(_uc, _store, asset_fqn: str, **_kwargs):
            load_calls.append(asset_fqn)
            return {
                "fqn": asset_fqn,
                "sequence": len(load_calls),
            }

        with patch("govhub.services.lineage._build_lineage_payload", side_effect=fake_build):
            lineage_service.lineage_payload(
                uc,
                store,
                "main.sales.orders",
                cache_scope="alice@example.com",
            )
            lineage_service.lineage_payload(
                uc,
                store,
                "main.sales.orders",
                cache_scope="bob@example.com",
            )

            self.assertEqual(len(load_calls), 2)
            self.assertEqual(len(lineage_service._TTL_CACHE), 2)

            lineage_service.invalidate_lineage_caches("main.sales.orders")

        self.assertEqual(lineage_service._TTL_CACHE, {})

        with patch("govhub.services.lineage._build_lineage_payload", side_effect=fake_build):
            lineage_service.lineage_payload(
                uc,
                store,
                "main.sales.orders",
                cache_scope="alice@example.com",
            )

        self.assertEqual(len(load_calls), 3)

    def test_runtime_app_lineage_helper_threads_request_cache_scope(self) -> None:
        source = Path("runtime_app.py").read_text(encoding="utf-8")
        tree = ast.parse(source, filename="runtime_app.py")
        helper = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "_lineage_payload"
        )

        self.assertEqual(
            [arg.arg for arg in helper.args.args],
            ["asset_fqn", "request"],
        )
        self.assertIsNotNone(helper.args.defaults)
        self.assertEqual(len(helper.args.defaults), 1)
        self.assertIsInstance(helper.args.defaults[0], ast.Constant)
        self.assertIsNone(helper.args.defaults[0].value)

        lineage_calls = [
            node
            for node in ast.walk(helper)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "lineage_service"
            and node.func.attr == "lineage_payload"
        ]
        self.assertEqual(len(lineage_calls), 1)

        keywords = {keyword.arg: keyword.value for keyword in lineage_calls[0].keywords}
        self.assertIn("cache_scope", keywords)
        self.assertIsInstance(keywords["cache_scope"], ast.Call)
        self.assertIsInstance(keywords["cache_scope"].func, ast.Name)
        self.assertEqual(keywords["cache_scope"].func.id, "_request_cache_scope")
        self.assertEqual(
            [arg.id for arg in keywords["cache_scope"].args if isinstance(arg, ast.Name)],
            ["request"],
        )

    def test_graph_node_uses_visible_inventory_for_openability(self) -> None:
        row = pd.Series(
            {
                "fqn": "main.sales.hidden_orders",
                "table_catalog": "main",
                "table_schema": "sales",
                "table_name": "hidden_orders",
                "table_type": "TABLE",
                "data_source_format": "DELTA",
                "comment": "Sensitive table",
            }
        )
        visible_inventory = pd.DataFrame(columns=["fqn"])

        with patch("govhub.services.lineage.asset_service.inventory_row", return_value=row):
            node = lineage_service.graph_node_for_asset(
                FakeUC(),
                object(),
                "main.sales.hidden_orders",
                "source",
                0,
                0,
                kicker="Upstream",
                visible_inventory=visible_inventory,
            )

        self.assertFalse(node["details"]["isOpenable"])
        self.assertEqual(node["details"]["resolutionState"], "lineage-only")
        self.assertIn("Metadata record unavailable", node["foot"])


if __name__ == "__main__":
    unittest.main()
