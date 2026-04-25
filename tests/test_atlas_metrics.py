from __future__ import annotations

import unittest
from dataclasses import dataclass

import pandas as pd

from atlas.services import atlas_metrics


def _assets_df() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "fqn": "main.customer.customer_dim",
                "table_catalog": "main",
                "table_schema": "customer",
                "table_name": "customer_dim",
                "comment": "Customer dimension",
                "domain": "Customer",
                "tier": "Tier 1",
                "certification": "Certified",
                "sensitivity": "Confidential",
                "criticality": "Critical",
                "data_product": "Customer 360",
                "business_owner": "skyler@entrada.ai",
            },
            {
                "fqn": "main.finance.revenue",
                "table_catalog": "main",
                "table_schema": "finance",
                "table_name": "revenue",
                "comment": "",
                "domain": "Finance",
                "tier": "",
                "certification": "Draft",
                "sensitivity": "",
                "criticality": "Medium",
                "data_product": "",
                "business_owner": "",
            },
        ]
    )


class FakeStore:
    def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
        rows = pd.DataFrame(
            [
                {
                    "request_id": "REQ-1",
                    "created_at": "2026-04-24 01:00:00",
                    "created_by": "skyler@entrada.ai",
                    "status": "pending",
                    "uc_full_name": "main.customer.customer_dim",
                    "new_comment": "Policy exception review",
                }
            ]
        )
        if status:
            return rows[rows["status"].eq(status)].copy()
        return rows

    def list_metadata_audit(self, **_: object) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "audit_id": "AUD-1",
                    "entity_fqn": "main.customer.customer_dim",
                    "action": "metadata updated",
                    "status": "success",
                    "detail": "Owner changed",
                    "created_at": "2026-04-24 01:05:00",
                    "actor_email": "skyler@entrada.ai",
                }
            ]
        )

    def list_glossary_terms(self, limit: int = 200) -> pd.DataFrame:
        return pd.DataFrame(
            [{"term_id": "term-1", "name": "Customer ID", "definition": "Customer key"}]
        )

    def list_classifications(self) -> pd.DataFrame:
        return pd.DataFrame([{"classification_id": "class-1", "display_name": "PII"}])

    def list_domains(self) -> pd.DataFrame:
        return pd.DataFrame([{"domain_id": "customer", "display_name": "Customer"}])

    def list_data_products(self) -> pd.DataFrame:
        return pd.DataFrame([{"data_product_id": "customer-360", "display_name": "Customer 360"}])


@dataclass(frozen=True)
class ChangeRequest:
    request_id: str
    created_at: str
    created_by: str
    status: str
    uc_full_name: str
    new_comment: str
    new_uc_tags: dict[str, str]
    reviewed_at: str | None = None
    reviewed_by: str | None = None
    review_note: str | None = None


class DetailStore(FakeStore):
    def get_change_request(self, request_id: str) -> ChangeRequest | None:
        if request_id != "REQ-1":
            return None
        return ChangeRequest(
            request_id="REQ-1",
            created_at="2026-04-24 01:00:00",
            created_by="skyler@entrada.ai",
            status="pending",
            uc_full_name="main.customer.customer_dim",
            new_comment="description: Curated customer dimension",
            new_uc_tags={"domain": "Customer", "certification": "Certified"},
        )


class AtlasMetricsTests(unittest.TestCase):
    def test_command_center_payload_counts_visible_assets_without_fake_deltas(self) -> None:
        payload = atlas_metrics.command_center_payload(
            visible_assets=_assets_df(),
            store=FakeStore(),
        )

        self.assertEqual(payload["estate"]["visibleAssetCount"], 2)
        self.assertEqual(payload["estate"]["catalogCount"], 1)
        self.assertEqual(payload["kpis"][0]["key"], "governedAssets")
        self.assertEqual(payload["kpis"][0]["value"], 2)
        self.assertEqual(payload["kpis"][1]["value"], 1)
        self.assertNotIn("delta", payload["kpis"][0])
        self.assertEqual(payload["governance"]["openRequests"], 1)
        self.assertEqual(payload["governance"]["policyExceptions"], 1)
        self.assertIsNone(payload["posture"]["overall"])
        self.assertEqual(payload["posture"]["state"], "unavailable")
        self.assertEqual(payload["topDomains"][0]["domain"], "Customer")

    def test_command_center_marks_audit_readiness_unavailable_without_audit(self) -> None:
        class NoAuditStore(FakeStore):
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame()

        payload = atlas_metrics.command_center_payload(
            visible_assets=_assets_df(),
            store=NoAuditStore(),
        )

        audit_kpi = next(item for item in payload["kpis"] if item["key"] == "auditReadiness")
        self.assertIsNone(audit_kpi["value"])
        self.assertEqual(audit_kpi["state"], "unavailable")

    def test_command_center_marks_unsupported_zero_signals_unavailable(self) -> None:
        class NoPolicySignalStore(FakeStore):
            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                return pd.DataFrame()

            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame()

        payload = atlas_metrics.command_center_payload(
            visible_assets=pd.DataFrame(),
            store=NoPolicySignalStore(),
        )

        coverage_kpi = next(item for item in payload["kpis"] if item["key"] == "metadataCoverage")
        certified_critical_kpi = next(item for item in payload["kpis"] if item["key"] == "certifiedCriticalAssets")
        policy_kpi = next(item for item in payload["kpis"] if item["key"] == "policyExceptions")
        self.assertIsNone(coverage_kpi["value"])
        self.assertEqual(coverage_kpi["state"], "unavailable")
        self.assertIsNone(certified_critical_kpi["value"])
        self.assertEqual(certified_critical_kpi["state"], "unavailable")
        self.assertIsNone(policy_kpi["value"])
        self.assertEqual(policy_kpi["state"], "unavailable")

    def test_certified_critical_assets_zero_requires_source_signals(self) -> None:
        payload = atlas_metrics.command_center_payload(
            visible_assets=pd.DataFrame(
                [
                    {
                        "fqn": "main.raw.events",
                        "table_catalog": "main",
                        "table_schema": "raw",
                        "table_name": "events",
                    }
                ]
            ),
            store=FakeStore(),
        )

        kpi = next(item for item in payload["kpis"] if item["key"] == "certifiedCriticalAssets")
        self.assertIsNone(kpi["value"])
        self.assertEqual(kpi["state"], "unavailable")

    def test_open_stewardship_unavailable_when_store_read_fails(self) -> None:
        class FailingRequestStore(FakeStore):
            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                raise RuntimeError("store offline")

        payload = atlas_metrics.command_center_payload(
            visible_assets=_assets_df(),
            store=FailingRequestStore(),
        )

        kpi = next(item for item in payload["kpis"] if item["key"] == "openStewardship")
        self.assertIsNone(kpi["value"])
        self.assertEqual(kpi["state"], "unavailable")
        self.assertIsNone(payload["governance"]["openRequests"])
        self.assertTrue(payload["meta"]["warnings"])

    def test_governance_request_detail_builds_diff_from_real_request(self) -> None:
        payload = atlas_metrics.governance_request_detail_payload(
            store=DetailStore(),
            request_id="REQ-1",
        )

        self.assertIsNotNone(payload)
        self.assertEqual(payload["requestId"], "REQ-1")
        self.assertEqual(payload["assetFqn"], "main.customer.customer_dim")
        fields = {row["field"] for row in payload["diff"]["rows"]}
        self.assertIn("domain", fields)
        self.assertIn("certification", fields)

    def test_cde_payload_uses_visible_metadata_and_marks_controls_unavailable(self) -> None:
        payload = atlas_metrics.cde_dashboard_payload(visible_assets=_assets_df())

        self.assertEqual(payload["summary"]["totalCdes"], 1)
        self.assertEqual(payload["groups"][0]["domain"], "Customer")
        self.assertIsNone(payload["groups"][0]["items"][0]["controlCoverage"])
        self.assertEqual(payload["groups"][0]["items"][0]["controlState"], "unavailable")

    def test_insights_formula_weights_sum_to_one(self) -> None:
        payload = atlas_metrics.insights_dashboard_payload(
            visible_assets=_assets_df(),
            store=FakeStore(),
        )

        weights = [item["weight"] for item in payload["scoring"]["maturityFormula"]]
        self.assertAlmostEqual(sum(weights), 1.0)
        self.assertIn("metadataCoverage", payload["scoring"]["availableSignals"])

    def test_ai_recommendations_route_certification_questions_to_certification_evidence(self) -> None:
        assets = _assets_df().copy()
        assets.loc[1, "criticality"] = "Critical"

        payload = atlas_metrics.build_ai_recommendations(
            visible_assets=assets,
            store=FakeStore(),
            question="Which critical assets are not certified?",
        )

        self.assertEqual(payload["intent"], "certification")
        self.assertEqual(payload["evidence"][0]["metric"], "criticalCertification")
        self.assertIn("main.finance.revenue", payload["answer"])

    def test_ai_recommendations_route_recent_change_questions_to_audit_evidence(self) -> None:
        payload = atlas_metrics.build_ai_recommendations(
            visible_assets=_assets_df(),
            store=FakeStore(),
            question="What changed in governance metadata recently?",
        )

        self.assertEqual(payload["intent"], "changes")
        self.assertEqual(payload["evidence"][0]["type"], "audit")
        self.assertIn("metadata updated", payload["answer"])

    def test_ai_recommendations_reject_unsupported_freeform_questions(self) -> None:
        payload = atlas_metrics.build_ai_recommendations(
            visible_assets=_assets_df(),
            store=FakeStore(),
            question="Draft a launch announcement",
        )

        self.assertEqual(payload["intent"], "unsupported")
        self.assertEqual(payload["confidence"], "low")
        self.assertEqual(payload["evidence"], [])
        self.assertIn("currently supports", payload["answer"])


if __name__ == "__main__":
    unittest.main()
