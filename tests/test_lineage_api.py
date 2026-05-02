from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import runtime_app
from atlas.api import lineage as lineage_api


def _response_json(response) -> dict[str, object]:
    return json.loads(response.body.decode("utf-8"))


class LineageApiTests(unittest.TestCase):
    def test_app_principal_lineage_fails_closed_for_hidden_focus_asset(self) -> None:
        request = SimpleNamespace(headers={"x-forwarded-email": "analyst@example.com"})
        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _lineage_payload=lambda asset_fqn, request=None: (_ for _ in ()).throw(
                AssertionError("hidden focus asset must not hydrate lineage payload")
            ),
            _asset_visibility_record=lambda asset_fqn, request=None: {
                "openable": False,
                "visibilityState": "hidden",
            },
        ):
            response = lineage_api.api_lineage("main.sales.orders", request)

        payload = _response_json(response)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(payload["meta"]["capabilities"]["visibilityState"], "hidden")

    def test_app_principal_lineage_for_open_asset_uses_degraded_envelope(self) -> None:
        request = SimpleNamespace(headers={"x-forwarded-email": "analyst@example.com"})
        lineage_payload = {
            "fqn": "main.sales.orders",
            "graphs": {
                "data": {
                    "nodes": [
                        {"id": "source", "assetFqn": "main.sales.customers"},
                        {"id": "focus", "assetFqn": "main.sales.orders"},
                    ],
                    "edges": [{"id": "source-focus", "source": "source", "target": "focus"}],
                    "meta": {},
                },
                "operational": {"nodes": [], "edges": [], "meta": {}},
            },
            "columnLineage": {"upstream": [], "downstream": [], "meta": {}},
            "stats": {"upstreamCount": 1, "downstreamCount": 0},
        }

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _lineage_payload=lambda asset_fqn, request=None: lineage_payload,
            _asset_visibility_record=lambda asset_fqn, request=None: {
                "openable": True,
                "visibilityState": "visible",
            },
        ):
            response = lineage_api.api_lineage("main.sales.orders", request)

        payload = _response_json(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["graphs"]["data"]["nodes"][0]["assetFqn"], "main.sales.customers")
        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertFalse(payload["meta"]["authoritative"])
        self.assertEqual(payload["meta"]["visibilityScope"], "workspace-app-principal")
        self.assertTrue(
            any("workspace-scoped app-principal" in item for item in payload["meta"]["warnings"])
        )

    def test_visible_inventory_lineage_capability_opens_even_without_observed_edges(self) -> None:
        from atlas.services import capabilities as capability_service

        payload = capability_service.bootstrap_capabilities(
            actor_role="reader",
            authenticated=True,
            runtime_state="live",
            store_state="live",
            visible_asset_count=12,
            available_catalog_count=2,
            observed_catalog_count=0,
        )

        self.assertEqual(payload["tableLineage"]["state"], "available")
        self.assertTrue(payload["tableLineage"]["available"])
        self.assertIn("empty graph", payload["tableLineage"]["reason"])
        self.assertEqual(payload["columnLineage"]["state"], "available")
        self.assertTrue(payload["columnLineage"]["available"])


if __name__ == "__main__":
    unittest.main()
