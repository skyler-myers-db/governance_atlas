from __future__ import annotations

import json
import unittest
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from govhub.services import assets

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "generate_runtime_api_openapi_snapshot.py"


def _load_snapshot_script():
    spec = importlib.util.spec_from_file_location(
        "generate_runtime_api_openapi_snapshot",
        SCRIPT_PATH,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load runtime API snapshot script.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


snapshot_script = _load_snapshot_script()
runtime_app = snapshot_script.runtime_app


def _inventory_df() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "fqn": "main.finance.orders",
                "table_name": "orders",
                "table_catalog": "main",
                "table_schema": "finance",
                "table_type": "MANAGED",
                "data_source_format": "delta",
                "comment": "Orders fact table",
                "governance_score": 91,
                "domain": "Finance",
                "tier": "Gold",
                "certification": "Certified",
                "sensitivity": "Internal",
                "criticality": "Tier 1",
                "data_product": "Revenue 360",
                "pending_requests": 1,
                "business_owner": "Mia Chen",
                "tags": {"quality": "trusted"},
                "glossaryTerms": ["Order"],
            },
            {
                "fqn": "main.finance.invoices",
                "table_name": "invoices",
                "table_catalog": "main",
                "table_schema": "finance",
                "table_type": "MANAGED",
                "data_source_format": "delta",
                "comment": "Invoice fact table",
                "governance_score": 88,
                "domain": "Finance",
                "tier": "Silver",
                "certification": "Certified",
                "sensitivity": "Internal",
                "criticality": "Tier 2",
                "data_product": "Revenue 360",
                "pending_requests": 0,
                "business_owner": "Mia Chen",
                "tags": {"quality": "trusted"},
                "glossaryTerms": ["Invoice"],
            },
            {
                "fqn": "main.support.tickets",
                "table_name": "tickets",
                "table_catalog": "main",
                "table_schema": "support",
                "table_type": "MANAGED",
                "data_source_format": "delta",
                "comment": "Support ticket backlog",
                "governance_score": 63,
                "domain": "Support",
                "tier": "Bronze",
                "certification": "Unassigned",
                "sensitivity": "Restricted",
                "criticality": "Tier 3",
                "data_product": "Service Ops",
                "pending_requests": 3,
                "business_owner": "Lina Park",
                "tags": {"quality": "observed"},
                "glossaryTerms": ["Ticket"],
            },
        ]
    )


class StructuredDiscoverySearchTests(unittest.TestCase):
    def test_structured_query_supports_grouped_boolean_field_terms(self) -> None:
        payload = assets.discovery_search_payload(
            _inventory_df(),
            query='domain:Finance AND (name:orders OR name:invoices)',
            query_mode="structured",
            sort_by="Best match",
        )

        self.assertEqual(payload["queryState"]["state"], "valid")
        self.assertEqual(payload["count"], 2)
        self.assertEqual(
            [asset["fqn"] for asset in payload["assets"]],
            ["main.finance.orders", "main.finance.invoices"],
        )

    def test_structured_query_supports_grouped_field_selectors_and_phrases(self) -> None:
        payload = assets.discovery_search_payload(
            _inventory_df(),
            query='domain:(Finance OR Support) AND description:"Orders fact table"',
            query_mode="structured",
            sort_by="Best match",
        )

        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["assets"][0]["fqn"], "main.finance.orders")

    def test_structured_query_exposes_removable_clause_chips_for_top_level_and_queries(self) -> None:
        payload = assets.discovery_search_payload(
            _inventory_df(),
            query='owner:"Mia Chen" AND domain:(Finance OR Support)',
            query_mode="structured",
            sort_by="Best match",
        )

        self.assertEqual(
            payload["queryState"]["clauseChips"],
            [
                {
                    "label": 'owner:"Mia Chen"',
                    "expression": 'owner:"Mia Chen"',
                    "nextQuery": "domain:(Finance OR Support)",
                    "removable": True,
                },
                {
                    "label": "domain:(Finance OR Support)",
                    "expression": "domain:(Finance OR Support)",
                    "nextQuery": 'owner:"Mia Chen"',
                    "removable": True,
                },
            ],
        )

    def test_structured_query_rejects_unknown_fields_without_widening_scope(self) -> None:
        with self.assertRaises(assets.DiscoveryQuerySyntaxError) as captured:
            assets.discovery_search_payload(
                _inventory_df(),
                query="workspace:main OR orders",
                query_mode="structured",
            )

        self.assertIn("Unknown discovery field `workspace`.", str(captured.exception))

    def test_structured_query_rejects_unbalanced_parentheses(self) -> None:
        with self.assertRaises(assets.DiscoveryQuerySyntaxError) as captured:
            assets.discovery_search_payload(
                _inventory_df(),
                query="domain:Finance AND (orders OR invoices",
                query_mode="structured",
            )

        self.assertIn("Missing closing parenthesis", str(captured.exception))

    def test_plain_query_mode_keeps_free_text_semantics(self) -> None:
        payload = assets.discovery_search_payload(
            _inventory_df(),
            query="Orders fact",
            query_mode="plain",
        )

        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["assets"][0]["fqn"], "main.finance.orders")


class DiscoverySearchEndpointTests(unittest.TestCase):
    def test_api_discovery_search_returns_invalid_query_payload_for_structured_errors(self) -> None:
        with patch.object(runtime_app, "_ensure_live_runtime", return_value=None), patch.object(
            runtime_app,
            "_discovery_search_payload",
            side_effect=assets.DiscoveryQuerySyntaxError("Unknown discovery field `workspace`."),
        ):
            response = runtime_app.api_discovery_search(
                request=SimpleNamespace(headers={}),
                query="workspace:main",
                query_mode="structured",
            )

        self.assertEqual(response.status_code, 400)
        if hasattr(response, "body"):
            payload = json.loads(response.body.decode("utf-8"))
        else:
            payload = response.content
        self.assertEqual(payload["detail"], "Unknown discovery field `workspace`.")
        self.assertEqual(payload["invalidQuery"]["state"], "invalid")
        self.assertIn("supportedFields", payload["invalidQuery"])


if __name__ == "__main__":
    unittest.main()
