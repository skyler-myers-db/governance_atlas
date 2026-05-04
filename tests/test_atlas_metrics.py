from __future__ import annotations

import json
import os
import unittest
from dataclasses import dataclass
from unittest.mock import patch

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

    def list_roles(self) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {"email": "skyler@entrada.ai", "role": "admin"},
                {"email": "steward@entrada.ai", "role": "steward"},
            ]
        )

    def list_identity_directory_entries(
        self,
        principal_type: str | None = None,
        *,
        active_only: bool = False,
    ) -> pd.DataFrame:
        rows = pd.DataFrame(
            [
                {"entry_id": "u1", "principal_type": "user", "email": "skyler@entrada.ai", "is_active": True},
                {"entry_id": "u2", "principal_type": "user", "email": "steward@entrada.ai", "is_active": True},
                {"entry_id": "g1", "principal_type": "group", "email": "", "is_active": True},
                {"entry_id": "sp1", "principal_type": "service_principal", "email": "", "is_active": True},
            ]
        )
        if principal_type:
            rows = rows[rows["principal_type"].eq(principal_type)].copy()
        if active_only:
            rows = rows[rows["is_active"].eq(True)].copy()
        return rows


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
        open_kpi = next(item for item in payload["kpis"] if item["key"] == "openStewardship")
        self.assertIn("delta", open_kpi)
        self.assertGreaterEqual(len(open_kpi["sparkline"]), 2)
        policy_kpi = next(item for item in payload["kpis"] if item["key"] == "policyExceptions")
        self.assertIn("delta", policy_kpi)
        self.assertGreaterEqual(len(policy_kpi["sparkline"]), 2)
        self.assertEqual(payload["governance"]["openRequests"], 1)
        self.assertEqual(payload["governance"]["policyExceptions"], 1)
        self.assertIsNone(payload["posture"]["overall"])
        self.assertEqual(payload["posture"]["state"], "unavailable")
        self.assertEqual(payload["topDomains"][0]["domain"], "Customer")
        self.assertEqual(payload["catalogHealth"][0]["catalog"], "main")
        self.assertEqual(payload["catalogHealth"][0]["assetCount"], 2)
        self.assertEqual(payload["meta"]["primaryCatalog"], "main")
        self.assertEqual(payload["recentEvents"][0]["priority"], "")

    @patch.dict(os.environ, {"GOVAT_CATALOG": "datapact"})
    def test_command_center_catalog_health_uses_full_inventory_not_recent_slice(self) -> None:
        visible_assets = pd.DataFrame(
            [
                {
                    "fqn": "datapact.enterprise_metadata_ops.customer_profile_coverage",
                    "table_catalog": "datapact",
                    "domain": "Customer",
                    "certification": "Certified",
                    "sensitivity": "Confidential",
                    "criticality": "Critical",
                    "business_owner": "customer-steward@entrada.ai",
                },
                {
                    "fqn": "customer_360.gold.customer_profile",
                    "table_catalog": "customer_360",
                    "domain": "Customer",
                    "certification": "Certified",
                    "sensitivity": "Confidential",
                    "criticality": "Critical",
                    "business_owner": "customer-steward@entrada.ai",
                },
                *[
                    {
                        "fqn": f"finance_prod.gold.revenue_{idx}",
                        "table_catalog": "finance_prod",
                        "domain": "Finance",
                        "certification": "Certified",
                        "sensitivity": "Confidential",
                        "criticality": "Critical",
                        "business_owner": "finance-steward@entrada.ai",
                    }
                    for idx in range(3)
                ],
            ]
        )

        payload = atlas_metrics.command_center_payload(
            visible_assets=visible_assets,
            store=FakeStore(),
        )

        self.assertEqual(payload["catalogHealth"][0]["catalog"], "finance_prod")
        self.assertEqual(payload["catalogHealth"][0]["assetCount"], 3)
        self.assertEqual(payload["meta"]["primaryCatalog"], "finance_prod")
        self.assertEqual(
            [row["catalog"] for row in payload["catalogHealth"]],
            ["finance_prod", "customer_360", "datapact"],
        )

    def test_recent_events_derive_high_priority_from_audit_evidence(self) -> None:
        class PriorityStore(FakeStore):
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame(
                    [
                        {
                            "audit_id": "AUD-CRIT",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "policy-exception-detected",
                            "status": "failed",
                            "detail": "Critical policy exception detected from governed audit evidence.",
                            "created_at": "2026-04-24 01:05:00",
                            "actor_email": "skyler@entrada.ai",
                        }
                    ]
                )

        payload = atlas_metrics.command_center_payload(
            visible_assets=_assets_df(),
            store=PriorityStore(),
        )

        self.assertEqual(payload["recentEvents"][0]["priority"], "high")
        self.assertEqual(payload["recentEvents"][0]["severity"], "high")
        self.assertEqual(payload["recentEvents"][0]["tone"], "bad")
        self.assertEqual(payload["recentEvents"][0]["title"], "Policy Exception Detected")

    def test_command_center_payload_rejects_internal_seed_rows(self) -> None:
        class SeededStore(FakeStore):
            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                rows = pd.DataFrame(
                    [
                        {
                            "request_id": "GOV-HOME-EVIDENCE-request-01",
                            "created_at": "2026-04-24 01:00:00",
                            "created_by": "skyler@entrada.ai",
                            "status": "pending",
                            "uc_full_name": "main.customer.customer_dim",
                            "new_comment": "Policy exception review: Review ga-taxonomy-term-customer-segment.",
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
                            "audit_id": "GOV-HOME-EVIDENCE-audit-01",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "policy-exception-detected",
                            "source": "home-evidence-plane",
                            "status": "failed",
                            "detail": "Review GOV-HOME-EVIDENCE-request-01 for ga-taxonomy-term-customer-segment.",
                            "request_id": "GOV-HOME-EVIDENCE-request-01",
                            "created_at": "2026-04-24 01:05:00",
                            "actor_email": "skyler@entrada.ai",
                        }
                    ]
                )

        payload = atlas_metrics.command_center_payload(
            visible_assets=_assets_df(),
            store=SeededStore(),
        )
        serialized = json.dumps(payload)

        self.assertEqual(payload["governance"]["pendingRequests"], [])
        self.assertEqual(payload["recentEvents"], [])
        self.assertEqual(payload["dataQuality"]["nonAuthoritativeRowsExcluded"], 2)
        self.assertNotIn("GOV-HOME-EVIDENCE", serialized)
        self.assertNotIn("ga-taxonomy-term", serialized)
        self.assertNotIn("home-evidence-plane", serialized)

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

    def test_command_center_payload_replaces_nan_with_json_safe_nulls(self) -> None:
        payload = atlas_metrics.command_center_payload(
            visible_assets=pd.DataFrame(
                [
                    {
                        "fqn": "main.nan.asset",
                        "table_catalog": "main",
                        "table_schema": "nan",
                        "table_name": "asset",
                        "comment": float("nan"),
                        "domain": float("nan"),
                        "tier": float("nan"),
                        "certification": float("nan"),
                        "sensitivity": float("nan"),
                        "criticality": float("nan"),
                        "data_product": float("nan"),
                    }
                ]
            ),
            store=FakeStore(),
        )

        encoded = json.dumps(payload, allow_nan=False)
        self.assertNotIn("NaN", encoded)
        self.assertEqual(payload["topDomains"][0]["domain"], "Unassigned")

    def test_command_center_payload_replaces_timestamps_with_json_safe_strings(self) -> None:
        class TimestampStore(FakeStore):
            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                rows = pd.DataFrame(
                    [
                        {
                            "request_id": "REQ-TS",
                            "created_at": pd.Timestamp("2026-04-24T01:00:00Z"),
                            "created_by": "skyler@entrada.ai",
                            "status": "pending",
                            "uc_full_name": "main.customer.customer_dim",
                            "new_comment": "Timestamp-backed request",
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
                            "audit_id": "AUD-TS",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "metadata updated",
                            "status": "success",
                            "detail": "Timestamp-backed audit row",
                            "created_at": pd.Timestamp("2026-04-24T01:05:00Z"),
                            "actor_email": "skyler@entrada.ai",
                        }
                    ]
                )

        payload = atlas_metrics.command_center_payload(
            visible_assets=_assets_df(),
            store=TimestampStore(),
        )

        encoded = json.dumps(payload, allow_nan=False)
        self.assertIn("2026-04-24T01:00:00+00:00", encoded)
        self.assertEqual(
            payload["governance"]["pendingRequests"][0]["created_at"],
            "2026-04-24T01:00:00+00:00",
        )

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

    def test_audit_evidence_payload_preserves_backed_events_without_fake_artifacts(self) -> None:
        class AuditStore(FakeStore):
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame(
                    [
                        {
                            "audit_id": "AUD-1",
                            "entity_fqn": "main.customer.customer_dim",
                            "entity_type": "table",
                            "action": "metadata updated",
                            "status": "success",
                            "detail": "Owner changed",
                            "created_at": "2026-04-24 01:05:00",
                            "actor_email": "skyler@entrada.ai",
                            "request_id": "REQ-1",
                            "before_json": "{\"owner\":\"old.owner@entrada.ai\"}",
                            "after_json": "{\"owner\":\"skyler@entrada.ai\"}",
                        },
                        {
                            "audit_id": "AUD-2",
                            "entity_fqn": "main.risk.policy_exception",
                            "entity_type": "policy",
                            "action": "policy exception failed",
                            "status": "failed",
                            "detail": "Policy exception failed.",
                            "created_at": "2026-04-24 02:05:00",
                            "actor_email": "steward@entrada.ai",
                        },
                    ]
                )

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), audit_id="AUD-2", limit=25)

        self.assertEqual(payload["summary"]["totalChanges"], 2)
        self.assertEqual(payload["summary"]["policyChanges"], 1)
        self.assertEqual(payload["summary"]["failedActions"], 1)
        self.assertEqual(payload["summary"]["approvals"], 0)
        self.assertEqual(payload["summary"]["rowScope"], "governance audit log")
        self.assertEqual(payload["summary"]["hiddenRowsExcluded"], 0)
        self.assertEqual(payload["selectedEvent"]["audit_id"], "AUD-2")
        self.assertEqual(len(payload["events"]), 2)
        self.assertEqual(payload["evidence"]["approvalChain"], [])
        self.assertEqual(payload["evidence"]["artifacts"], [])
        self.assertIn("before", payload["evidence"])

        scoped = atlas_metrics.audit_evidence_payload(
            store=AuditStore(),
            audit_id="AUD-2",
            limit=25,
            visible_asset_fqns=["main.customer.customer_dim"],
        )

        self.assertEqual(scoped["summary"]["totalChanges"], 1)
        self.assertEqual(scoped["summary"]["rowScope"], "visible-assets")
        self.assertEqual(scoped["summary"]["hiddenRowsExcluded"], 1)
        self.assertIsNone(scoped["selectedEvent"])
        self.assertIn("after", payload["evidence"])

    def test_audit_evidence_payload_rejects_internal_seed_and_identity_rows(self) -> None:
        class AuditStore(FakeStore):
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame(
                    [
                        {
                            "audit_id": "INTERNAL-1",
                            "entity_type": "identity_directory_entry",
                            "entity_id": "skyler@entrada.ai",
                            "action": "identity-directory-upserted",
                            "source": "store",
                            "status": "success",
                            "after_json": "{\"entryId\":\"abc\"}",
                            "created_at": "2026-04-24 01:00:00",
                            "actor_email": "skyler@entrada.ai",
                        },
                        {
                            "audit_id": "GOV-HOME-EVIDENCE-audit-01",
                            "entity_fqn": "main.customer.customer_dim",
                            "entity_type": "asset",
                            "action": "policy-exception-detected",
                            "source": "home-evidence-plane",
                            "status": "failed",
                            "detail": "Review GOV-HOME-EVIDENCE-request-01",
                            "request_id": "GOV-HOME-EVIDENCE-request-01",
                            "before_json": "{\"request_id\":\"GOV-HOME-EVIDENCE-request-01\"}",
                            "after_json": "{\"audit_id\":\"GOV-HOME-EVIDENCE-audit-01\"}",
                            "created_at": "2026-04-24 01:05:00",
                            "actor_email": "skyler@entrada.ai",
                        },
                    ]
                )

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), limit=25)
        serialized = json.dumps(payload)

        self.assertEqual(payload["summary"]["totalChanges"], 0)
        self.assertEqual(payload["summary"]["hiddenRowsExcluded"], 2)
        self.assertEqual(payload["events"], [])
        self.assertIsNone(payload["selectedEvent"])
        self.assertNotIn("GOV-HOME-EVIDENCE", serialized)
        self.assertNotIn("identity-directory-upserted", serialized)
        self.assertIsNone(payload["evidence"])

    def test_admin_control_center_preserves_unbacked_admin_values_as_unavailable(self) -> None:
        payload = atlas_metrics.admin_control_center_payload(
            visible_assets=_assets_df(),
            store=FakeStore(),
            runtime={
                "state": "live",
                "catalogCount": 2,
                "client": {
                    "authMode": "oauth-m2m-env",
                    "clientSecretPresent": True,
                    "warehouseId": "wh-1",
                },
            },
            environment={"displayLabel": "Dev · datapact.atlas"},
            actor_role="admin",
            ai_status={"state": "available", "provider": "genie", "spaceId": "space-1"},
        )

        self.assertEqual(payload["environment"]["displayLabel"], "Dev · datapact.atlas")
        self.assertEqual(payload["role"]["label"], "Platform Admin")
        self.assertEqual(payload["policyRequirements"]["cards"][0]["key"], "totalPolicies")
        self.assertIsNone(payload["policyRequirements"]["cards"][0]["value"])
        self.assertEqual(payload["policyRequirements"]["cards"][0]["state"], "unavailable")
        self.assertFalse(payload["policyRequirements"]["capabilities"]["policyLibrary"])
        self.assertEqual(payload["bulkImport"]["state"], "unavailable")
        self.assertFalse(payload["bulkImport"]["reportAvailable"])
        self.assertEqual(payload["access"]["users"]["value"], 2)
        self.assertEqual(payload["access"]["roles"]["value"], 2)
        self.assertEqual(payload["access"]["groups"]["value"], 1)
        self.assertIsNone(payload["access"]["sso"]["value"])
        self.assertEqual(payload["access"]["sso"]["state"], "unavailable")
        self.assertEqual(payload["runtimeSummary"]["authMode"], "oauth-m2m-env")
        self.assertNotIn("clientSecretPresent", payload["system"])
        self.assertEqual(payload["integrations"][2]["key"], "aiCopilot")
        self.assertEqual(payload["integrations"][2]["state"], "connected")
        self.assertEqual(payload["integrations"][3]["key"], "notifications")
        self.assertEqual(payload["integrations"][3]["state"], "unavailable")
        self.assertIn("Notification delivery health", payload["integrations"][3]["reason"])

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
        self.assertEqual(payload["comments"], [])
        self.assertEqual(payload["commentsState"], "unavailable")
        self.assertEqual(payload["evidence"], [])
        self.assertEqual(payload["evidenceState"], "unavailable")

    def test_governance_workbench_exposes_open_requests_only(self) -> None:
        class MixedStatusStore(FakeStore):
            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                rows = pd.DataFrame(
                    [
                        {
                            "request_id": "REQ-CLOSED",
                            "created_at": "2026-04-24 03:00:00",
                            "created_by": "skyler@entrada.ai",
                            "status": "approved",
                            "uc_full_name": "main.customer.customer_dim",
                            "new_comment": "Resolve policy exception: already approved",
                        },
                        {
                            "request_id": "REQ-OPEN",
                            "created_at": "2026-04-24 02:00:00",
                            "created_by": "skyler@entrada.ai",
                            "status": "pending",
                            "uc_full_name": "main.customer.customer_dim",
                            "new_comment": "Assign owner: needs review",
                        },
                    ]
                )
                if status:
                    return rows[rows["status"].eq(status)].copy()
                return rows

        payload = atlas_metrics.governance_workbench_payload(store=MixedStatusStore())

        self.assertEqual([row["requestId"] for row in payload["requests"]], ["REQ-OPEN"])
        self.assertEqual(payload["selectedRequest"]["requestId"], "REQ-OPEN")
        self.assertEqual(payload["requests"][0]["type"], "")
        pending_kpi = next(item for item in payload["metrics"] if item["key"] == "pendingApprovals")
        policy_kpi = next(item for item in payload["metrics"] if item["key"] == "policyExceptions")
        self.assertEqual(pending_kpi["value"], 1)
        self.assertEqual(policy_kpi["value"], 0)

    def test_governance_workbench_rejects_seed_and_prototype_request_rows(self) -> None:
        class SeededRequestStore(FakeStore):
            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                rows = pd.DataFrame(
                    [
                        {
                            "request_id": "ga-home-seed-request-1",
                            "created_at": "2026-04-24 01:00:00",
                            "created_by": "skyler@entrada.ai",
                            "status": "pending",
                            "uc_full_name": "main.customer.customer_dim",
                            "source": "home-evidence-plane",
                            "new_comment": "Validation sample owner check",
                        },
                        {
                            "request_id": "REQ-LIVE",
                            "created_at": "2026-04-24 02:00:00",
                            "created_by": "skyler@entrada.ai",
                            "status": "pending",
                            "uc_full_name": "main.customer.customer_dim",
                            "source": "governance-store",
                            "new_comment": "Assign owner: needs review",
                        },
                    ]
                )
                if status:
                    return rows[rows["status"].eq(status)].copy()
                return rows

        payload = atlas_metrics.governance_workbench_payload(store=SeededRequestStore())
        serialized = json.dumps(payload)

        self.assertEqual([row["requestId"] for row in payload["requests"]], ["REQ-LIVE"])
        self.assertEqual(payload["meta"]["nonAuthoritativeRowsExcluded"], 1)
        self.assertNotIn("ga-home-seed", serialized)
        self.assertNotIn("home-evidence-plane", serialized)

    def test_governance_request_detail_rejects_customer_safe_seed_request(self) -> None:
        class SeededDetailStore(FakeStore):
            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                rows = pd.DataFrame(
                    [
                        {
                            "request_id": "GOV-HOME-EVIDENCE-request-01",
                            "created_at": "2026-04-24 01:00:00",
                            "created_by": "skyler@entrada.ai",
                            "status": "pending",
                            "uc_full_name": "main.customer.customer_dim",
                            "new_comment": "Assign owner: needs review",
                        }
                    ]
                )
                if status:
                    return rows[rows["status"].eq(status)].copy()
                return rows

            def get_change_request(self, request_id: str) -> ChangeRequest | None:
                if request_id != "GOV-HOME-EVIDENCE-request-01":
                    return None
                return ChangeRequest(
                    request_id="GOV-HOME-EVIDENCE-request-01",
                    created_at="2026-04-24 01:00:00",
                    created_by="skyler@entrada.ai",
                    status="pending",
                    uc_full_name="main.customer.customer_dim",
                    new_comment="Assign owner: needs review",
                    new_uc_tags={"domain": "Customer"},
                )

        payload = atlas_metrics.governance_request_detail_payload(
            store=SeededDetailStore(),
            request_id="GOV-01",
        )
        serialized = json.dumps(payload)

        self.assertIsNone(payload)
        self.assertEqual(serialized, "null")

    def test_cde_payload_uses_visible_metadata_and_marks_controls_unavailable(self) -> None:
        payload = atlas_metrics.cde_dashboard_payload(visible_assets=_assets_df())

        self.assertEqual(payload["summary"]["totalCdes"], 1)
        self.assertIsNone(payload["summary"]["protectedCdes"])
        self.assertEqual(payload["summary"]["sensitiveCandidates"], 1)
        self.assertEqual(payload["groups"][0]["domain"], "Customer")
        self.assertIsNone(payload["groups"][0]["items"][0]["controlCoverage"])
        self.assertEqual(payload["groups"][0]["items"][0]["controlState"], "unavailable")
        self.assertEqual(payload["groups"][0]["items"][0]["status"], "Control evidence unavailable")
        self.assertIsNone(payload["groups"][0]["items"][0]["linkedPolicies"])
        self.assertEqual(payload["groups"][0]["items"][0]["linkedPolicyState"], "unavailable")

    def test_cde_detail_preserves_unavailable_control_and_lineage_contract(self) -> None:
        payload = atlas_metrics.cde_detail_payload(
            visible_assets=_assets_df(),
            cde_id="main.customer.customer_dim",
        )

        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["assetFqn"], "main.customer.customer_dim")
        self.assertEqual(payload["lineageSnapshot"]["state"], "unavailable")
        self.assertGreaterEqual(len(payload["controls"]), 5)
        self.assertTrue(all(control["state"] == "unavailable" for control in payload["controls"]))
        self.assertTrue(all(control["coverage"] is None for control in payload["controls"]))
        self.assertEqual(payload["linkedAssets"][0]["assetFqn"], "main.customer.customer_dim")
        self.assertEqual(payload["activity"], [])

    def test_taxonomy_overview_prefers_enriched_glossary_terms(self) -> None:
        enriched = [
            {
                "termId": "customer-id",
                "term": "Customer Identifier",
                "definition": "Business-approved identifier.",
                "ownerEmail": "customer.owner@entrada.ai",
                "reviewers": ["customer.steward@entrada.ai"],
                "assetCount": 1,
            }
        ]

        payload = atlas_metrics.taxonomy_overview_payload(
            store=FakeStore(),
            glossary_terms=enriched,
        )

        self.assertEqual(payload["summary"]["termCount"], 1)
        self.assertEqual(payload["glossaryTerms"][0]["termId"], "customer-id")
        self.assertEqual(payload["glossaryTerms"][0]["assetCount"], 1)
        self.assertEqual(payload["classifications"][0]["classification_id"], "class-1")

    def test_insights_formula_weights_sum_to_one(self) -> None:
        payload = atlas_metrics.insights_dashboard_payload(
            visible_assets=_assets_df(),
            store=FakeStore(),
        )

        weights = [item["weight"] for item in payload["scoring"]["maturityFormula"]]
        self.assertAlmostEqual(sum(weights), 1.0)
        self.assertIn("metadataCoverage", payload["scoring"]["availableSignals"])
        self.assertNotIn("policyCompliance", payload["scoring"]["availableSignals"])
        self.assertNotIn("auditReadiness", payload["scoring"]["availableSignals"])
        policy_kpi = next(item for item in payload["kpis"] if item["key"] == "policyCompliance")
        self.assertIsNone(policy_kpi["value"])
        self.assertEqual(policy_kpi["state"], "unavailable")
        exception_kpi = next(item for item in payload["kpis"] if item["key"] == "criticalExceptions")
        self.assertEqual(exception_kpi["value"], 1)
        self.assertEqual(exception_kpi["state"], "degraded")
        self.assertFalse(payload["signalAvailability"]["quality"])
        self.assertFalse(payload["signalAvailability"]["auditReadiness"])
        self.assertFalse(payload["signalAvailability"]["policyCompliance"])
        self.assertGreaterEqual(len(payload["metadataCoverageHeatmap"]), 1)
        self.assertGreaterEqual(len(payload["certificationCoverageByTier"]), 1)
        self.assertGreaterEqual(len(payload["riskHeatmap"]), 1)
        self.assertTrue(
            any(row["label"] == "Tier 1 - Business Critical" for row in payload["certificationCoverageByTier"])
        )

    def test_insights_quality_availability_tracks_score_not_raw_rows(self) -> None:
        class QualityRowsOnlyStore(FakeStore):
            def list_quality_run_results(self, limit: int = 1000) -> pd.DataFrame:
                return pd.DataFrame([{"asset_fqn": "main.customer.customer_dim", "outcome": "passed"}])

        payload = atlas_metrics.insights_dashboard_payload(
            visible_assets=_assets_df(),
            store=QualityRowsOnlyStore(),
        )

        self.assertFalse(payload["signalAvailability"]["quality"])
        self.assertTrue(payload["signalAvailability"]["qualityRowsAvailable"])
        self.assertNotIn("qualityHealth", payload["scoring"]["availableSignals"])

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
        self.assertIn("Metadata updated", payload["answer"])

    def test_ai_recommendations_priority_combines_multiple_evidence_backed_signals(self) -> None:
        assets = _assets_df().copy()
        assets.loc[1, "criticality"] = "Critical"

        payload = atlas_metrics.build_ai_recommendations(
            visible_assets=assets,
            store=FakeStore(),
            question="Recommend the next governed assets and governance priorities for Discovery.",
        )

        self.assertEqual(payload["intent"], "priority")
        self.assertGreaterEqual(len(payload["recommendations"]), 3)
        metrics = {evidence["metric"] for evidence in payload["evidence"]}
        self.assertIn("metadataCoverage", metrics)
        self.assertIn("criticalCertification", metrics)
        self.assertIn("assetsWithoutOwner", metrics)

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
