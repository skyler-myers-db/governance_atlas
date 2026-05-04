from __future__ import annotations

import json
import unittest
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from atlas.services import assets

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
    def test_visible_assets_excludes_run_scoped_synthetic_validation_assets(self) -> None:
        inventory = pd.DataFrame(
            [
                {
                    "fqn": "datapact.enterprise_metadata_ops.customer_profile_coverage",
                    "table_catalog": "datapact",
                    "table_schema": "enterprise_metadata_ops",
                    "table_name": "customer_profile_coverage",
                    "tags": {},
                },
                {
                    "fqn": "datapact.atlas_ga_stress_20260502120000_deadbee.workflow_entities",
                    "table_catalog": "datapact",
                    "table_schema": "atlas_ga_stress_20260502120000_deadbee",
                    "table_name": "workflow_entities",
                    "tags": {},
                },
                {
                    "fqn": "datapact.ops.validation_events",
                    "table_catalog": "datapact",
                    "table_schema": "ops",
                    "table_name": "validation_events",
                    "tags": {
                        "governance_atlas.exclude_from_organic_evidence": "true",
                    },
                },
            ]
        )

        visible = assets.visible_assets(inventory)

        self.assertEqual(
            visible["fqn"].tolist(),
            ["datapact.enterprise_metadata_ops.customer_profile_coverage"],
        )

    def test_visible_assets_excludes_control_plane_schemas(self) -> None:
        inventory = pd.DataFrame(
            [
                {
                    "fqn": "datapact.enterprise_metadata_ops.customer_profile_coverage",
                    "table_catalog": "datapact",
                    "table_schema": "enterprise_metadata_ops",
                    "table_name": "customer_profile_coverage",
                    "tags": {},
                },
                {
                    "fqn": "datapact.governance_atlas_demo.customer_profile_coverage",
                    "table_catalog": "datapact",
                    "table_schema": "governance_atlas_demo",
                    "table_name": "customer_profile_coverage",
                    "tags": {},
                },
                {
                    "fqn": "datapact.atlas.change_requests",
                    "table_catalog": "datapact",
                    "table_schema": "atlas",
                    "table_name": "change_requests",
                    "tags": {},
                },
                {
                    "fqn": "datapact.governance_hub.metadata_audit",
                    "table_catalog": "datapact",
                    "table_schema": "governance_hub",
                    "table_name": "metadata_audit",
                    "tags": {},
                },
                {
                    "fqn": "datapact.atlas_ai.atlas_ai_assets_current",
                    "table_catalog": "datapact",
                    "table_schema": "atlas_ai",
                    "table_name": "atlas_ai_assets_current",
                    "tags": {},
                },
            ]
        )

        with patch.dict("os.environ", {"GOVAT_CATALOG": "datapact", "GOVAT_SCHEMA": "atlas"}):
            visible = assets.visible_assets(inventory)

        self.assertEqual(
            visible["fqn"].tolist(),
            ["datapact.enterprise_metadata_ops.customer_profile_coverage"],
        )

    def test_asset_payload_hides_internal_governance_tags(self) -> None:
        payload = assets.base_asset_payload(
            pd.Series(
                {
                    "fqn": "datapact.governance_atlas_demo.customer_profile_coverage",
                    "table_catalog": "datapact",
                    "table_schema": "governance_atlas_demo",
                    "table_name": "customer_profile_coverage",
                    "tags": {
                        "domain": "Customer",
                        "governance_atlas_evidence_source": "home-northstar",
                        "governance_atlas.exclude_from_organic_evidence": "false",
                    },
                    "domain": "Customer",
                }
            )
        )

        self.assertEqual(payload["tags"], {"domain": "Customer"})
        self.assertNotIn("governance_atlas_evidence_source=home-northstar", payload["tagLabels"])

    def test_hidden_schema_deep_links_are_marked_hidden_before_exact_identity(self) -> None:
        with patch.dict("os.environ", {"GOVAT_CATALOG": "datapact", "GOVAT_SCHEMA": "atlas"}):
            self.assertTrue(assets.asset_fqn_is_hidden("datapact.atlas.change_requests"))
            self.assertTrue(assets.asset_fqn_is_hidden("datapact.atlas_ai.atlas_ai_assets_current"))
            self.assertTrue(
                assets.asset_fqn_is_hidden("datapact.governance_atlas_demo.customer_profile_coverage")
            )
            self.assertFalse(
                assets.asset_fqn_is_hidden("datapact.enterprise_metadata_ops.customer_profile_coverage")
            )

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
