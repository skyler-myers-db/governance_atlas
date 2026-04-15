from __future__ import annotations

import ast
import unittest
from pathlib import Path

from govhub.services import capabilities as capability_service


class CapabilityPayloadTests(unittest.TestCase):
    def test_live_writer_capabilities_are_truthful(self) -> None:
        payload = capability_service.bootstrap_capabilities(
            actor_role="writer",
            authenticated=True,
            runtime_state="live",
            store_state="live",
            visible_asset_count=12,
            available_catalog_count=4,
            observed_catalog_count=2,
        )

        self.assertEqual(payload["governanceWrite"]["state"], "available")
        self.assertTrue(payload["governanceWrite"]["available"])
        self.assertEqual(payload["governanceApproval"]["state"], "unavailable")
        self.assertFalse(payload["governanceApproval"]["available"])
        self.assertEqual(payload["systemInventoryRead"]["state"], "available")
        self.assertTrue(payload["systemInventoryRead"]["available"])
        self.assertEqual(payload["tableLineage"]["state"], "available")
        self.assertEqual(payload["columnLineage"]["state"], "available")
        self.assertEqual(payload["qualityRunEligibility"]["state"], "unavailable")
        self.assertEqual(payload["exportAllowed"]["state"], "unavailable")
        self.assertEqual(payload["manualLineageOverrides"]["state"], "unavailable")

    def test_degraded_store_and_empty_inventory_surface_degraded_states(self) -> None:
        payload = capability_service.bootstrap_capabilities(
            actor_role="reader",
            authenticated=False,
            runtime_state="live",
            store_state="degraded",
            store_message="Governance store unavailable.",
            visible_asset_count=0,
            available_catalog_count=3,
            observed_catalog_count=0,
            boot_message="Workspace connected, but no visible assets were returned yet.",
        )

        self.assertEqual(payload["governanceWrite"]["state"], "degraded")
        self.assertEqual(payload["governanceApproval"]["state"], "degraded")
        self.assertEqual(payload["systemInventoryRead"]["state"], "degraded")
        self.assertTrue(payload["systemInventoryRead"]["available"])
        self.assertEqual(payload["tableLineage"]["state"], "unknown")
        self.assertEqual(payload["columnLineage"]["state"], "unknown")
        self.assertEqual(payload["workloadVisibility"]["state"], "unknown")

    def test_runtime_unavailable_marks_runtime_scoped_capabilities_unavailable(self) -> None:
        payload = capability_service.bootstrap_capabilities(
            actor_role="admin",
            authenticated=True,
            runtime_state="unavailable",
            runtime_message="Warehouse is down.",
            store_state="skipped",
        )

        for key in [
            "governanceWrite",
            "governanceApproval",
            "systemInventoryRead",
            "tableLineage",
            "columnLineage",
            "workloadVisibility",
            "qualityRunEligibility",
            "exportAllowed",
            "manualLineageOverrides",
        ]:
            self.assertEqual(payload[key]["state"], "unavailable", key)
            self.assertFalse(payload[key]["available"], key)


class RuntimeCapabilityWiringTests(unittest.TestCase):
    def test_runtime_surfaces_thread_capability_payload_helper(self) -> None:
        source = Path("runtime_app.py").read_text(encoding="utf-8")
        tree = ast.parse(source, filename="runtime_app.py")

        for function_name in [
            "_compose_bootstrap_payload",
            "_bootstrap_unavailable_payload",
            "api_runtime_status",
        ]:
            node = next(
                item
                for item in tree.body
                if isinstance(item, ast.FunctionDef) and item.name == function_name
            )
            segment = ast.get_source_segment(source, node) or ""
            self.assertIn('"capabilities"', segment, function_name)
            self.assertIn("_capabilities_payload(", segment, function_name)


if __name__ == "__main__":
    unittest.main()
