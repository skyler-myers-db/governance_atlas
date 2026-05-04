from __future__ import annotations

import unittest

import pandas as pd

from atlas.services import assets as asset_service


class AssetDetailSectionTests(unittest.TestCase):
    def test_explicit_empty_sections_do_not_expand_to_full_payload(self) -> None:
        self.assertEqual(
            asset_service.normalize_asset_detail_sections([]),
            ("header",),
        )

    def test_profiler_sections_do_not_auto_include_preview_or_operational(self) -> None:
        self.assertEqual(
            asset_service.normalize_asset_detail_sections(["profiler"]),
            ("header", "activity", "schema", "profiler"),
        )

    def test_profiler_payload_omits_blocked_preview_and_operational_cards(self) -> None:
        payload = asset_service.profiler_payload(
            {"governanceStatus": "Needs Work"},
            [],
            [{"order_id": "1"}],
            ["main.sales.customers"],
            [],
            {
                "producers": [{"key": "job-1"}],
                "consumers": [{"key": "dashboard-1"}],
            },
            include_preview=False,
            include_operational=False,
        )

        titles = [card["title"] for card in payload["cards"]]
        self.assertNotIn("Sample Data", titles)
        self.assertNotIn("Operational Usage", titles)
        self.assertIn("Lineage Context", titles)

    def test_fast_header_payload_uses_visible_inventory_without_detail_sections(self) -> None:
        payload = asset_service.asset_header_payload_from_inventory(
            pd.DataFrame(
                [
                    {
                        "fqn": "main.sales.orders",
                        "table_catalog": "main",
                        "table_schema": "sales",
                        "table_name": "orders",
                        "table_type": "MANAGED",
                        "data_source_format": "DELTA",
                        "comment": "Backed order table",
                        "domain": "Sales",
                        "certification": "Certified",
                        "sensitivity": "Internal",
                        "criticality": "High",
                        "business_owner": "sales-owner@example.com",
                    }
                ]
            ),
            "main.sales.orders",
        )

        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["fqn"], "main.sales.orders")
        self.assertEqual(payload["loadedSections"], ["header"])
        self.assertIn("schema", payload["deferredSections"])
        self.assertEqual(payload["headerSource"], "visible-unity-catalog-inventory")
        self.assertEqual(payload["columns"], [])

    def test_fast_header_payload_fails_closed_when_asset_not_visible(self) -> None:
        payload = asset_service.asset_header_payload_from_inventory(
            pd.DataFrame(
                [
                    {
                        "fqn": "main.sales.orders",
                        "table_catalog": "main",
                        "table_schema": "sales",
                        "table_name": "orders",
                    }
                ]
            ),
            "main.sales.hidden_orders",
        )

        self.assertIsNone(payload)


if __name__ == "__main__":
    unittest.main()
