from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from atlas.api import atlas as atlas_api
from atlas.api.cache import _invalidate_cache_prefix


def _request(headers: dict[str, str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(headers=headers or {}, state=SimpleNamespace())


def _response_json(response) -> dict:
    if hasattr(response, "body"):
        return json.loads(response.body.decode("utf-8"))
    return response.content


def _visible_assets() -> pd.DataFrame:
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
            }
        ]
    )


class FakeStore:
    def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "request_id": "REQ-1",
                    "created_at": "2026-04-24 01:00:00",
                    "created_by": "skyler@entrada.ai",
                    "status": "pending",
                    "uc_full_name": "main.customer.customer_dim",
                    "new_comment": "Assign owner",
                }
            ]
        )

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

    def get_change_request(self, request_id: str):
        if request_id != "REQ-1":
            return None
        return SimpleNamespace(
            request_id="REQ-1",
            created_at="2026-04-24 01:00:00",
            created_by="skyler@entrada.ai",
            status="pending",
            uc_full_name="main.customer.customer_dim",
            new_comment="Assign owner",
            new_uc_tags={"business_owner": "skyler@entrada.ai"},
            reviewed_at=None,
            reviewed_by=None,
            review_note=None,
        )

    def list_classifications(self) -> pd.DataFrame:
        return pd.DataFrame([{"classification_id": "class-1", "display_name": "PII"}])

    def list_domains(self) -> pd.DataFrame:
        return pd.DataFrame([{"domain_id": "customer", "display_name": "Customer"}])

    def list_data_products(self) -> pd.DataFrame:
        return pd.DataFrame([{"data_product_id": "customer-360", "display_name": "Customer 360"}])

    def list_logical_column_groups(self) -> pd.DataFrame:
        return pd.DataFrame([{"group_id": "customer-ids", "display_name": "Customer IDs"}])

    def list_glossary_terms(self, limit: int = 200) -> pd.DataFrame:
        return pd.DataFrame(
            [{"term_id": "raw-term", "name": "Raw Term", "definition": "Raw glossary row"}]
        )

    def list_roles(self) -> pd.DataFrame:
        return pd.DataFrame([{"email": "admin@example.com", "role": "admin"}])

    def list_identity_directory_entries(
        self,
        principal_type: str | None = None,
        *,
        active_only: bool = False,
    ) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {"entry_id": "u1", "principal_type": "user", "email": "admin@example.com", "is_active": True},
                {"entry_id": "g1", "principal_type": "group", "email": "", "is_active": True},
            ]
        )


class FailingRequestStore(FakeStore):
    def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
        raise RuntimeError("request table unavailable")


class FallbackUc:
    def runtime_context(self) -> dict[str, bool]:
        return {"obo_scope_fallback": True}


class AtlasApiTests(unittest.TestCase):
    def setUp(self) -> None:
        _invalidate_cache_prefix("atlas_command_center_payload:")
        _invalidate_cache_prefix("atlas_governance_workbench_payload:")
        _invalidate_cache_prefix("atlas_governance_request_detail_payload:")
        _invalidate_cache_prefix("atlas_insights_dashboard_payload:")
        _invalidate_cache_prefix("atlas_cde_dashboard_payload:")
        _invalidate_cache_prefix("atlas_cde_detail_payload:")
        _invalidate_cache_prefix("atlas_audit_evidence_payload:")
        _invalidate_cache_prefix("atlas_taxonomy_overview:")
        _invalidate_cache_prefix("atlas_ai_recommendations:")

    def test_router_registers_all_phase5_routes(self) -> None:
        router = atlas_api.build_atlas_router()
        paths = {route.path for route in router.routes}
        self.assertIn("/api/atlas/command-center", paths)
        self.assertIn("/api/atlas/assets/{asset_fqn:path}/360", paths)
        self.assertIn("/api/atlas/governance/workbench", paths)
        self.assertIn("/api/atlas/governance/requests/{request_id}", paths)
        self.assertIn("/api/atlas/insights", paths)
        self.assertIn("/api/atlas/taxonomy/overview", paths)
        self.assertIn("/api/atlas/cde", paths)
        self.assertIn("/api/atlas/cde/{cde_id:path}", paths)
        self.assertIn("/api/atlas/audit/evidence", paths)
        self.assertIn("/api/atlas/admin/control-center", paths)

    def test_ai_router_registers_evidence_endpoints(self) -> None:
        router = atlas_api.build_atlas_ai_router()
        paths = {route.path for route in router.routes}
        self.assertEqual(
            {"/api/atlas-ai/recommendations", "/api/atlas-ai/chat"},
            paths,
        )

    def test_command_center_returns_meta_and_fallback_warning(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _uc_runtime_status_fast=lambda background=True: {"state": "live", "message": ""},
            _fast_bootstrap_inventory_summary=lambda _scope, **_kwargs: {"visibleAssets": 1},
            _uc_for_request=lambda request: FallbackUc(),
            _visible_assets=lambda request: _visible_assets(),
            _store_for_read=lambda: FakeStore(),
            _request_cache_scope=lambda request: "test-actor",
        ):
            response = atlas_api.api_command_center(_request(), refresh="1")

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertEqual(payload["estate"]["visibleAssetCount"], 1)
        self.assertEqual(payload["meta"]["source"], "unity-catalog-inventory+governance-store")
        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertIs(payload["meta"]["oboScopeFallback"], True)
        self.assertFalse(payload["authoritative"])

    def test_command_center_preserves_store_source_warnings(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _uc_runtime_status_fast=lambda background=True: {"state": "live", "message": ""},
            _fast_bootstrap_inventory_summary=lambda _scope, **_kwargs: {"visibleAssets": 1},
            _uc_for_request=lambda request: SimpleNamespace(runtime_context=lambda: {}),
            _visible_assets=lambda request: _visible_assets(),
            _store_for_read=lambda: FailingRequestStore(),
            _request_cache_scope=lambda request: "test-actor",
        ):
            response = atlas_api.api_command_center(_request(), refresh="1")

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertIsNone(payload["estate"]["openRequests"])
        self.assertEqual(payload["kpis"][3]["key"], "openStewardship")
        self.assertEqual(payload["kpis"][3]["state"], "unavailable")
        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertFalse(payload["authoritative"])
        self.assertTrue(
            any("list_change_requests failed" in warning for warning in payload["meta"]["warnings"])
        )

    def test_command_center_returns_loading_envelope_while_runtime_warms(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _uc_runtime_status_fast=lambda background=True: {
                "state": "loading",
                "message": "Warehouse is warming.",
            },
        ):
            response = atlas_api.api_command_center(_request())

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertFalse(payload["authoritative"])
        self.assertEqual(payload["meta"]["state"], "loading")
        self.assertEqual(payload["estate"]["visibleAssetCount"], None)
        self.assertIn("Warehouse is warming", payload["meta"]["warnings"][0])

    def test_taxonomy_overview_returns_enriched_wrapped_contract(self) -> None:
        import runtime_app

        enriched_terms = [
            {
                "termId": "customer-id",
                "term": "Customer Identifier",
                "definition": "Business-approved identifier.",
                "ownerEmail": "customer.owner@entrada.ai",
                "assetCount": 1,
            }
        ]

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _uc_for_request=lambda request: SimpleNamespace(runtime_context=lambda: {}),
            _store_for_read=lambda: FakeStore(),
        ), patch.object(
            atlas_api.governance_service,
            "glossary_terms",
            return_value=enriched_terms,
        ):
            response = atlas_api.api_taxonomy_overview(_request(), refresh="1")

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertEqual(payload["meta"]["source"], "governance-store+unity-catalog-inventory")
        self.assertEqual(payload["meta"]["state"], "available")
        self.assertEqual(payload["meta"]["capabilities"]["glossaryEnriched"], True)
        self.assertEqual(payload["summary"]["termCount"], 1)
        self.assertEqual(payload["glossaryTerms"][0]["termId"], "customer-id")
        self.assertEqual(payload["classifications"][0]["classification_id"], "class-1")

    def test_cde_dashboard_and_detail_preserve_truthful_degraded_source(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _cached_visible_assets=lambda request: _visible_assets(),
            _visible_assets=lambda request: _visible_assets(),
            _uc_for_request=lambda request: SimpleNamespace(runtime_context=lambda: {}),
        ):
            dashboard_response = atlas_api.api_cde_dashboard(_request())
            detail_response = atlas_api.api_cde_detail("main.customer.customer_dim", _request())

        self.assertEqual(dashboard_response.status_code, 200)
        dashboard = _response_json(dashboard_response)
        self.assertEqual(dashboard["meta"]["source"], "unity-catalog-inventory+governance-store")
        self.assertNotIn("quality-runner", dashboard["meta"]["source"])
        self.assertEqual(dashboard["meta"]["state"], "degraded")
        self.assertFalse(dashboard["meta"]["capabilities"]["controlCoverage"])
        self.assertIsNone(dashboard["summary"]["protectedCdes"])
        self.assertEqual(dashboard["summary"]["sensitiveCandidates"], 1)

        self.assertEqual(detail_response.status_code, 200)
        detail = _response_json(detail_response)
        self.assertEqual(detail["meta"]["source"], "unity-catalog-inventory+governance-store")
        self.assertNotIn("quality-runner", detail["meta"]["source"])
        self.assertEqual(detail["lineageSnapshot"]["state"], "unavailable")
        self.assertEqual(detail["controls"][0]["state"], "unavailable")
        self.assertIsNone(detail["controls"][0]["coverage"])

    def test_audit_evidence_is_steward_admin_gated(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _user_role_slug=lambda request: "viewer",
            _store_for_read=lambda: FakeStore(),
        ):
            with self.assertRaises(atlas_api.HTTPException) as ctx:
                atlas_api.api_audit_evidence(_request())

        self.assertEqual(ctx.exception.status_code, 403)

    def test_audit_evidence_returns_truthful_source_and_arrays(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _user_role_slug=lambda request: "steward",
            _store_for_read=lambda: FakeStore(),
            _visible_assets=lambda request: _visible_assets(),
        ):
            response = atlas_api.api_audit_evidence(_request(), audit_id="AUD-1", limit=25)

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertEqual(payload["meta"]["source"], "governance-store+metadata-audit-log")
        self.assertNotIn("change-events", payload["meta"]["source"])
        self.assertEqual(payload["meta"]["state"], "available")
        self.assertTrue(payload["authoritative"])
        self.assertEqual(payload["selectedEvent"]["audit_id"], "AUD-1")
        self.assertIsInstance(payload["events"], list)
        self.assertIsInstance(payload["evidence"]["approvalChain"], list)
        self.assertIsInstance(payload["evidence"]["artifacts"], list)
        self.assertEqual(payload["summary"]["rowScope"], "visible-assets")
        self.assertEqual(payload["meta"]["capabilities"]["rowLevelSecurity"], "visible-assets-only")
        self.assertEqual(payload["meta"]["capabilities"]["actorIdentityExposure"], "steward-admin-gated")

    def test_audit_evidence_filters_rows_to_visible_assets(self) -> None:
        import runtime_app

        class MixedAuditStore(FakeStore):
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
                            "actor_email": "visible.steward@entrada.ai",
                        },
                        {
                            "audit_id": "AUD-HIDDEN",
                            "entity_fqn": "restricted.payroll.salary_raw",
                            "action": "grant changed",
                            "status": "success",
                            "detail": "Privilege changed",
                            "created_at": "2026-04-24 01:06:00",
                            "actor_email": "hidden.admin@entrada.ai",
                        },
                    ]
                )

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _user_role_slug=lambda request: "steward",
            _store_for_read=lambda: MixedAuditStore(),
            _visible_assets=lambda request: _visible_assets(),
        ):
            response = atlas_api.api_audit_evidence(_request(), limit=25, refresh="1")

        payload = _response_json(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["audit_id"] for row in payload["events"]], ["AUD-1"])
        self.assertEqual(payload["summary"]["hiddenRowsExcluded"], 1)
        self.assertNotIn("hidden.admin@entrada.ai", json.dumps(payload))

    def test_audit_evidence_fails_closed_when_visibility_scope_unavailable(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _user_role_slug=lambda request: "steward",
            _store_for_read=lambda: FakeStore(),
            _visible_assets=lambda request: (_ for _ in ()).throw(RuntimeError("inventory unavailable")),
        ):
            response = atlas_api.api_audit_evidence(_request(), limit=25, refresh="1")

        payload = _response_json(response)
        self.assertEqual(response.status_code, 503)
        self.assertFalse(payload["authoritative"])
        self.assertEqual(payload["meta"]["capabilities"]["rowLevelSecurity"], "fail-closed-visible-assets")
        self.assertIn("unscoped actor identities", payload["detail"])

    def test_admin_control_center_is_admin_gated(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _user_role_slug=lambda request: "steward",
        ):
            with self.assertRaises(atlas_api.HTTPException) as ctx:
                atlas_api.api_admin_control_center(_request())

        self.assertEqual(ctx.exception.status_code, 403)

    def test_admin_control_center_returns_curated_source_and_sections(self) -> None:
        import runtime_app

        cfg = SimpleNamespace(
            deploy_target="Dev",
            environment_label="",
            gov_catalog="datapact",
            gov_schema="atlas",
            warehouse_id="wh-1",
            workspace_host="dbc.example.cloud.databricks.com",
        )

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _user_role_slug=lambda request: "admin",
            _config=lambda: cfg,
            _visible_assets=lambda request: _visible_assets(),
            _store_for_read=lambda: FakeStore(),
            _uc_runtime_status_fast=lambda background=False: {
                "state": "live",
                "client": {"authMode": "oauth-m2m-env", "clientSecretPresent": True},
            },
        ), patch.object(
            atlas_api.genie_service,
            "provider_status",
            return_value={"state": "available", "provider": "genie", "spaceId": "space-1"},
        ):
            response = atlas_api.api_admin_control_center(_request())

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertEqual(payload["meta"]["source"], "runtime-diagnostics+governance-store")
        self.assertNotIn("background-runner", payload["meta"]["source"])
        self.assertEqual(payload["environment"]["displayLabel"], "Dev · datapact.atlas")
        self.assertEqual(payload["role"]["label"], "Platform Admin")
        self.assertIn("policyRequirements", payload)
        self.assertEqual(payload["bulkImport"]["state"], "unavailable")
        notifications = next(item for item in payload["integrations"] if item["key"] == "notifications")
        self.assertEqual(notifications["state"], "unavailable")
        self.assertIn("Notification delivery health", notifications["reason"])
        self.assertIn("access", payload)
        self.assertNotIn("clientSecretPresent", payload["system"])

    def test_asset_360_checks_visibility_before_detail_payload(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _asset_visibility_record=lambda asset_fqn, request: {
                "exists": True,
                "visible": False,
                "openable": False,
                "visibilityState": "hidden",
            },
        ):
            response = atlas_api.api_asset_360("main.hidden.table", _request())

        self.assertEqual(response.status_code, 404)
        payload = _response_json(response)
        self.assertEqual(payload["meta"]["capabilities"]["visibilityState"], "hidden")

    def test_asset_360_payload_omits_operational_without_obo(self) -> None:
        import runtime_app

        detail_sections: list[list[str]] = []

        def detail_payload(asset_fqn, request=None, sections=None):
            detail_sections.append(list(sections or []))
            return {
                "fqn": asset_fqn,
                "name": "customer_dim",
                "owners": [{"name": "skyler@entrada.ai", "title": "Business Owner"}],
                "columns": [{"name": "customer_id"}],
                "activity": [],
                "metadataAudit": [],
                "relatedAssets": [],
                "operationalContext": {"producers": [], "consumers": []},
                "usage": {},
            }

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _asset_visibility_record=lambda asset_fqn, request: {
                "exists": True,
                "visible": True,
                "openable": True,
                "visibilityState": "visible",
            },
            _asset_detail_payload=detail_payload,
            _uc_for_request=lambda request: SimpleNamespace(warehouse_id="test"),
            _store_for_read=lambda: FakeStore(),
            _request_cache_scope=lambda request: "test-scope",
            _direct_uc_metadata_writes_enabled=lambda request: False,
        ):
            response = atlas_api.api_asset_360("main.customer.customer_dim", _request())

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertEqual(detail_sections, [])
        self.assertNotIn("operational", payload["meta"]["capabilities"]["requestedSections"])
        self.assertEqual(payload["meta"]["state"], "loading")
        self.assertTrue(payload["meta"]["capabilities"]["hydrating"])
        self.assertEqual(payload["asset"]["fqn"], "main.customer.customer_dim")

    def test_governance_request_detail_404_for_missing_request(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _store_for_read=lambda: FakeStore(),
        ):
            response = atlas_api.api_governance_request_detail("REQ-MISSING", _request())

        self.assertEqual(response.status_code, 404)
        payload = _response_json(response)
        self.assertEqual(payload["meta"]["source"], "governance-store")

    def test_atlas_ai_without_genie_fails_closed_instead_of_local_recommendations(self) -> None:
        import runtime_app

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _visible_assets=lambda request: _visible_assets(),
            _store_for_read=lambda: FakeStore(),
        ):
            response = atlas_api.api_atlas_ai_recommendations(
                _request({"x-forwarded-email": "skyler@entrada.ai"}),
                atlas_api.AtlasAiQuestion(question="Draft a launch announcement"),
            )

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertEqual(payload["intent"], "unavailable")
        self.assertEqual(payload["provider"], "unavailable")
        self.assertEqual(payload["evidence"], [])
        self.assertEqual(payload["recommendations"], [])
        self.assertEqual(payload["confidence"], "unavailable")
        self.assertEqual(payload["meta"]["state"], "unavailable")
        self.assertEqual(payload["meta"]["source"], "runtime-configuration+databricks-genie")
        self.assertFalse(payload["authoritative"])
        self.assertNotIn("local-evidence", payload["meta"]["source"])
        self.assertTrue(any("configured Databricks Genie space" in warning for warning in payload["meta"]["warnings"]))

    def test_atlas_ai_without_obo_uses_backed_workspace_metadata_not_mock_values(self) -> None:
        import runtime_app

        config = SimpleNamespace(
            atlas_ai_provider="genie",
            genie_space_id="space-1",
            genie_space_title="Governance Atlas Metadata Room",
            atlas_ai_require_benchmark=True,
            workspace_host="https://example.cloud.databricks.com",
        )
        visible_assets = pd.DataFrame(
            [
                {
                    "fqn": "main.customer.customer_profile",
                    "domain": "Customer",
                    "tier": "Tier 1",
                    "certification": "Trusted",
                    "criticality": "Critical",
                    "owners_summary": "customer-steward@example.com",
                    "governance_status": "Needs Work",
                }
            ]
        )

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _config=lambda: config,
            _visible_assets=lambda request: visible_assets,
        ):
            response = atlas_api.api_atlas_ai_recommendations(
                _request({"x-forwarded-email": "skyler@entrada.ai"}),
                atlas_api.AtlasAiQuestion(question="Which critical assets are not certified?"),
            )

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertEqual(payload["provider"], "governance-atlas-live-metadata")
        self.assertEqual(payload["meta"]["source"], "unity-catalog-inventory+governance-store+databricks-genie-status")
        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertFalse(payload["authoritative"])
        self.assertEqual(payload["evidence"][0]["assetFqn"], "main.customer.customer_profile")
        self.assertEqual(payload["evidence"][0]["source"], "unity-catalog-inventory+governance-store")
        self.assertIn("Workspace-scoped governed evidence", payload["answer"])
        self.assertTrue(payload["meta"]["capabilities"]["evidenceBacked"])
        self.assertTrue(any("not a Databricks Genie/OBO answer" in warning for warning in payload["meta"]["warnings"]))

    def test_atlas_ai_uses_genie_when_configured_with_forwarded_token(self) -> None:
        import runtime_app

        config = SimpleNamespace(
            atlas_ai_provider="genie",
            genie_space_id="space-1",
            genie_space_title="Governance Atlas Metadata Room",
            atlas_ai_require_benchmark=True,
            workspace_host="https://example.cloud.databricks.com",
        )
        genie_payload = {
            "question": "Which assets are missing stewardship?",
            "intent": "genie",
            "answer": "Two assets are missing owners.",
            "recommendations": [],
            "evidence": [
                {
                    "type": "genie_query",
                    "statementId": "stmt-1",
                    "sql": "SELECT asset_fqn FROM datapact.atlas_ai.atlas_ai_assets_current",
                }
            ],
            "confidence": "genie-grounded",
            "provider": "genie",
            "providerState": {
                "provider": "genie",
                "state": "available",
                "spaceId": "space-1",
                "benchmarkState": "required",
            },
            "warnings": [],
        }

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _config=lambda: config,
        ), patch.object(atlas_api.genie_service, "ask_genie", return_value=genie_payload) as ask_genie:
            response = atlas_api.api_atlas_ai_recommendations(
                _request({"x-forwarded-access-token": "obo-token-1"}),
                atlas_api.AtlasAiQuestion(question="Which assets are missing stewardship?"),
            )

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        ask_genie.assert_called_once()
        self.assertEqual(payload["provider"], "genie")
        self.assertEqual(payload["meta"]["source"], "databricks-genie")
        self.assertEqual(payload["meta"]["state"], "available")
        self.assertEqual(payload["meta"]["capabilities"]["spaceId"], "space-1")
        self.assertTrue(payload["authoritative"])

    def test_atlas_ai_derives_actions_from_genie_query_rows(self) -> None:
        import runtime_app

        config = SimpleNamespace(
            atlas_ai_provider="genie",
            genie_space_id="space-1",
            genie_space_title="Governance Atlas Metadata Room",
            atlas_ai_require_benchmark=True,
            workspace_host="https://example.cloud.databricks.com",
        )
        genie_payload = {
            "question": "Recommend priority governance work",
            "intent": "genie",
            "answer": "Genie returned governed priority rows.",
            "recommendations": [],
            "evidence": [
                {
                    "type": "genie_query",
                    "statementId": "stmt-1",
                    "resultRows": [
                        {
                            "asset_fqn": "datapact.enterprise.customer_stewardship_queue",
                            "domain": "Customer",
                            "owner_count": "2",
                            "open_work_count": "1",
                        }
                    ],
                }
            ],
            "confidence": "genie-grounded",
            "provider": "genie",
            "providerState": {
                "provider": "genie",
                "state": "available",
                "spaceId": "space-1",
            },
            "warnings": [],
        }

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _config=lambda: config,
        ), patch.object(atlas_api.genie_service, "ask_genie", return_value=genie_payload):
            response = atlas_api.api_atlas_ai_recommendations(
                _request({"x-forwarded-access-token": "obo-token-1"}),
                atlas_api.AtlasAiQuestion(question="Recommend priority governance work"),
            )

        payload = _response_json(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["provider"], "genie")
        self.assertEqual(payload["recommendations"][0]["title"], "Review customer_stewardship_queue")
        self.assertEqual(payload["recommendations"][0]["evidence"][0]["id"], "datapact.enterprise.customer_stewardship_queue")
        self.assertTrue(payload["authoritative"])
        self.assertFalse(any("not substituted" in warning for warning in payload["meta"]["warnings"]))

    def test_atlas_ai_does_not_substitute_local_recommendations_for_empty_genie_answer(self) -> None:
        import runtime_app

        config = SimpleNamespace(
            atlas_ai_provider="genie",
            genie_space_id="space-1",
            genie_space_title="Governance Atlas Metadata Room",
            atlas_ai_require_benchmark=True,
            workspace_host="https://example.cloud.databricks.com",
        )
        genie_payload = {
            "question": "Recommend priority governance work",
            "intent": "genie",
            "answer": "",
            "recommendations": [],
            "evidence": [],
            "confidence": "unavailable",
            "provider": "genie",
            "providerState": {
                "provider": "genie",
                "state": "available",
                "spaceId": "space-1",
            },
            "warnings": [],
        }

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _config=lambda: config,
        ), patch.object(
            atlas_api.genie_service,
            "ask_genie",
            return_value=genie_payload,
        ), patch.object(
            atlas_api.atlas_metrics,
            "build_ai_recommendations",
            return_value={"recommendations": [{"title": "Local fallback"}]},
        ) as build_local:
            response = atlas_api.api_atlas_ai_recommendations(
                _request({"x-forwarded-access-token": "obo-token-1"}),
                atlas_api.AtlasAiQuestion(question="Recommend priority governance work"),
            )

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        build_local.assert_not_called()
        self.assertEqual(payload["provider"], "genie")
        self.assertEqual(payload["recommendations"], [])
        self.assertEqual(payload["meta"]["source"], "databricks-genie")
        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertFalse(payload["authoritative"])
        self.assertTrue(any("not substituted" in warning for warning in payload["meta"]["warnings"]))


if __name__ == "__main__":
    unittest.main()
