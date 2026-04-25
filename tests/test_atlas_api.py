from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from atlas.api import atlas as atlas_api


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


class FailingRequestStore(FakeStore):
    def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
        raise RuntimeError("request table unavailable")


class FallbackUc:
    def runtime_context(self) -> dict[str, bool]:
        return {"obo_scope_fallback": True}


class AtlasApiTests(unittest.TestCase):
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
            _ensure_live_runtime=lambda: None,
            _uc_for_request=lambda request: FallbackUc(),
            _visible_assets=lambda request: _visible_assets(),
            _store_for_read=lambda: FakeStore(),
            _request_cache_scope=lambda request: "test-actor",
        ):
            response = atlas_api.api_command_center(_request())

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
            _ensure_live_runtime=lambda: None,
            _uc_for_request=lambda request: SimpleNamespace(runtime_context=lambda: {}),
            _visible_assets=lambda request: _visible_assets(),
            _store_for_read=lambda: FailingRequestStore(),
            _request_cache_scope=lambda request: "test-actor",
        ):
            response = atlas_api.api_command_center(_request())

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
        ):
            response = atlas_api.api_asset_360("main.customer.customer_dim", _request())

        self.assertEqual(response.status_code, 200)
        payload = _response_json(response)
        self.assertNotIn("operational", detail_sections[0])
        self.assertEqual(payload["meta"]["state"], "degraded")
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

    def test_atlas_ai_unsupported_question_is_degraded_not_mismatched_recommendation(self) -> None:
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
        self.assertEqual(payload["intent"], "unsupported")
        self.assertEqual(payload["evidence"], [])
        self.assertEqual(payload["confidence"], "low")
        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertTrue(
            any("Unsupported Home Atlas AI question type" in warning for warning in payload["meta"]["warnings"])
        )


if __name__ == "__main__":
    unittest.main()
