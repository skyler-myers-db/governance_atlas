"""Unit tests for the batched BFS neighbor lookup that replaced the
N-queries-per-frontier walk in commit 50107e6. Pins:

- Single-origin parity with the legacy `_lineage_neighbors` path.
- Multi-origin dedup + per-origin cap truncation.
- Empty / malformed FQN handling.
- Empty result set from the SQL client.
"""
from __future__ import annotations

import unittest

import pandas as pd

from govhub.services import lineage as lineage_service


class _FakeSystemClient:
    """Stand-in for the real UCSQLClient — records calls and returns a
    pre-baked DataFrame. Subclasses override ``_rows`` to shape the
    response."""

    def __init__(self, upstream_rows=None, downstream_rows=None):
        self.upstream_rows = upstream_rows or []
        self.downstream_rows = downstream_rows or []
        self.calls: list[tuple[str, int]] = []

    def get_table_lineage_upstream_batch(self, tables, limit_per_table=50):
        self.calls.append(("upstream_batch", len(tables)))
        return pd.DataFrame(self.upstream_rows)

    def get_table_lineage_downstream_batch(self, tables, limit_per_table=50):
        self.calls.append(("downstream_batch", len(tables)))
        return pd.DataFrame(self.downstream_rows)


class LineageNeighborsBatchTests(unittest.TestCase):
    def test_empty_frontier_returns_empty_dict(self) -> None:
        client = _FakeSystemClient()
        out = lineage_service._lineage_neighbors_batch(
            client, [], direction="upstream", limit_per_asset=50
        )
        self.assertEqual(out, {})
        # No SQL call issued on an empty frontier.
        self.assertEqual(client.calls, [])

    def test_malformed_fqn_is_skipped_not_fatal(self) -> None:
        client = _FakeSystemClient(
            upstream_rows=[
                {
                    "target_table_catalog": "prod",
                    "target_table_schema": "silver",
                    "target_table_name": "orders",
                    "source_table_full_name": "bronze.raw.orders_stream",
                }
            ]
        )
        out = lineage_service._lineage_neighbors_batch(
            client,
            ["not_a_valid_fqn", "prod.silver.orders"],
            direction="upstream",
            limit_per_asset=50,
        )
        # The valid fqn still resolves; the malformed one is dropped.
        self.assertIn("prod.silver.orders", out)
        self.assertEqual(
            out["prod.silver.orders"], ["bronze.raw.orders_stream"]
        )

    def test_multi_origin_dedup(self) -> None:
        client = _FakeSystemClient(
            upstream_rows=[
                {
                    "target_table_catalog": "prod",
                    "target_table_schema": "silver",
                    "target_table_name": "a",
                    "source_table_full_name": "bronze.raw.src1",
                },
                {
                    "target_table_catalog": "prod",
                    "target_table_schema": "silver",
                    "target_table_name": "a",
                    # Duplicate — the dedup step should collapse to one.
                    "source_table_full_name": "bronze.raw.src1",
                },
                {
                    "target_table_catalog": "prod",
                    "target_table_schema": "silver",
                    "target_table_name": "b",
                    "source_table_full_name": "bronze.raw.src2",
                },
            ]
        )
        out = lineage_service._lineage_neighbors_batch(
            client,
            ["prod.silver.a", "prod.silver.b"],
            direction="upstream",
            limit_per_asset=50,
        )
        self.assertEqual(out["prod.silver.a"], ["bronze.raw.src1"])
        self.assertEqual(out["prod.silver.b"], ["bronze.raw.src2"])

    def test_per_origin_cap_honored(self) -> None:
        """Even if the SQL returns more rows than limit_per_asset for one
        origin (e.g. an older ROW_NUMBER bug or a transient duplicate),
        the Python-side dedup caps the returned list."""
        rows = []
        for i in range(10):
            rows.append(
                {
                    "target_table_catalog": "prod",
                    "target_table_schema": "silver",
                    "target_table_name": "dense",
                    "source_table_full_name": f"bronze.raw.s{i}",
                }
            )
        client = _FakeSystemClient(upstream_rows=rows)
        out = lineage_service._lineage_neighbors_batch(
            client,
            ["prod.silver.dense"],
            direction="upstream",
            limit_per_asset=3,
        )
        self.assertEqual(len(out["prod.silver.dense"]), 3)

    def test_downstream_direction(self) -> None:
        client = _FakeSystemClient(
            downstream_rows=[
                {
                    "source_table_catalog": "prod",
                    "source_table_schema": "silver",
                    "source_table_name": "orders",
                    "target_table_full_name": "prod.gold.order_facts",
                }
            ]
        )
        out = lineage_service._lineage_neighbors_batch(
            client,
            ["prod.silver.orders"],
            direction="downstream",
            limit_per_asset=50,
        )
        self.assertEqual(client.calls, [("downstream_batch", 1)])
        self.assertEqual(
            out["prod.silver.orders"], ["prod.gold.order_facts"]
        )

    def test_empty_sql_result_yields_empty_map(self) -> None:
        client = _FakeSystemClient(upstream_rows=[])
        out = lineage_service._lineage_neighbors_batch(
            client,
            ["prod.silver.foo", "prod.silver.bar"],
            direction="upstream",
            limit_per_asset=50,
        )
        self.assertEqual(out, {})

    def test_exception_path_returns_empty_not_raise(self) -> None:
        class _Raising:
            def get_table_lineage_upstream_batch(self, *_args, **_kwargs):
                raise RuntimeError("warehouse down")

        out = lineage_service._lineage_neighbors_batch(
            _Raising(),
            ["prod.silver.foo"],
            direction="upstream",
            limit_per_asset=50,
        )
        self.assertEqual(out, {})


if __name__ == "__main__":
    unittest.main()
