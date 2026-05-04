from __future__ import annotations

import unittest

import pandas as pd

from atlas.services import lineage as lineage_service


class _FakeSystemClient:
    def __init__(self, rows=None, raise_error: bool = False):
        self.rows = rows or []
        self.raise_error = raise_error
        self.calls: list[tuple[tuple[str, ...], tuple[str, ...], int]] = []

    def get_table_lineage_edges_batch(
        self,
        fqns,
        *,
        directions=("upstream", "downstream"),
        per_seed_limit=50,
    ):
        self.calls.append((tuple(fqns), tuple(directions), per_seed_limit))
        if self.raise_error:
            raise RuntimeError("warehouse down")
        return pd.DataFrame(self.rows)


class LineageNeighborRecordsBatchTests(unittest.TestCase):
    def test_empty_frontier_returns_empty_dict(self) -> None:
        client = _FakeSystemClient()
        out = lineage_service._lineage_neighbor_records_batch(
            client, [], direction="upstream", per_seed_limit=50
        )
        self.assertEqual(out, {})
        self.assertEqual(client.calls, [])

    def test_upstream_records_group_by_target_seed(self) -> None:
        client = _FakeSystemClient(
            [
                {
                    "target_table_full_name": "prod.silver.orders",
                    "source_table_full_name": "bronze.raw.orders_stream",
                },
                {
                    "target_table_full_name": "prod.silver.orders",
                    "source_table_full_name": "bronze.raw.orders_stream",
                },
            ]
        )
        out = lineage_service._lineage_neighbor_records_batch(
            client,
            ["prod.silver.orders"],
            direction="upstream",
            per_seed_limit=50,
        )
        self.assertEqual(client.calls, [(("prod.silver.orders",), ("upstream",), 50)])
        self.assertEqual(
            out["prod.silver.orders"],
            [{"assetFqn": "bronze.raw.orders_stream", "provenance": "system.access.table_lineage"}],
        )

    def test_downstream_records_group_by_source_seed(self) -> None:
        client = _FakeSystemClient(
            [
                {
                    "source_table_full_name": "prod.silver.orders",
                    "target_table_full_name": "prod.gold.order_facts",
                }
            ]
        )
        out = lineage_service._lineage_neighbor_records_batch(
            client,
            ["prod.silver.orders"],
            direction="downstream",
            per_seed_limit=25,
        )
        self.assertEqual(client.calls, [(("prod.silver.orders",), ("downstream",), 25)])
        self.assertEqual(
            out["prod.silver.orders"],
            [{"assetFqn": "prod.gold.order_facts", "provenance": "system.access.table_lineage"}],
        )

    def test_empty_sql_result_yields_empty_map(self) -> None:
        client = _FakeSystemClient()
        out = lineage_service._lineage_neighbor_records_batch(
            client,
            ["prod.silver.foo", "prod.silver.bar"],
            direction="upstream",
            per_seed_limit=50,
        )
        self.assertEqual(out, {"prod.silver.foo": [], "prod.silver.bar": []})

    def test_exception_path_returns_empty_not_raise(self) -> None:
        client = _FakeSystemClient(raise_error=True)
        out = lineage_service._lineage_neighbor_records_batch(
            client,
            ["prod.silver.foo"],
            direction="upstream",
            per_seed_limit=50,
        )
        self.assertEqual(out, {"prod.silver.foo": []})


if __name__ == "__main__":
    unittest.main()
