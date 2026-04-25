from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()
