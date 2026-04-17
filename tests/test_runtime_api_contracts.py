from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "generate_runtime_api_openapi_snapshot.py"
SNAPSHOT_PATH = ROOT / "docs" / "runtime_api_openapi_snapshot.json"


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

from fastapi.responses import JSONResponse  # noqa: E402
from govhub.api.runtime import build_runtime_router  # noqa: E402


def _response_json(response) -> dict[str, object]:
    if hasattr(response, "body"):
        return json.loads(response.body.decode("utf-8"))
    return response.content


class RuntimeApiContractsTests(unittest.TestCase):
    def test_shell_payload_pins_minimal_shell_contract(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = SimpleNamespace(headers={})

        with patch.multiple(
            runtime_app,
            _route_context=lambda _request: {
                "surface": "entity",
                "asset": "main.sales.orders",
                "query": "",
            },
            _build_id=lambda: "build-123",
            _config=lambda: SimpleNamespace(diagnostics_enabled=True, admin_emails=[]),
        ):
            payload = runtime_app._shell_payload(
                request,
                mode="inline-shell",
                state="loading",
                message="Preparing the workspace shell.",
            )

        self.assertEqual(payload["bootstrapContract"]["version"], "bootstrap-v3")
        self.assertEqual(payload["bootstrapContract"]["class"], "shell-capability")
        self.assertEqual(payload["bootstrapContract"]["mode"], "inline-shell")
        self.assertNotIn("assets", payload)
        self.assertNotIn("assetIndex", payload)
        self.assertNotIn("diagnostics", payload)
        self.assertNotIn("summary", payload["discovery"])
        self.assertEqual(payload["routeHints"]["surface"], "entity")
        self.assertEqual(payload["routeHints"]["asset"], "main.sales.orders")
        self.assertEqual(payload["apiContract"]["bootstrap"], "/api/bootstrap")
        self.assertEqual(payload["shell"]["buildId"], "build-123")
        flag_keys = {item["key"] for item in payload["featureFlags"]}
        self.assertIn("workspace_setup_diagnostics", flag_keys)
        self.assertIn("table_lineage_surface", flag_keys)
        self.assertIn("query_history_surface", flag_keys)

    def test_api_bootstrap_response_returns_route_bootstrap_shell_only(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = SimpleNamespace(headers={})

        with patch.multiple(
            runtime_app,
            _uc_runtime_status=lambda: {"state": "live", "message": ""},
            _route_context=lambda _request: {"surface": "discovery", "asset": "", "query": ""},
            _build_id=lambda: "build-123",
            _config=lambda: SimpleNamespace(diagnostics_enabled=True, admin_emails=[]),
        ):
            response = runtime_app._api_bootstrap_response(request)

        payload = _response_json(response)
        self.assertEqual(payload["bootstrapContract"]["mode"], "route-bootstrap")
        self.assertEqual(payload["bootState"], "live")
        self.assertNotIn("assets", payload)
        self.assertNotIn("assetIndex", payload)
        self.assertNotIn("diagnostics", payload)
        self.assertEqual(payload["apiContract"]["runtimeStatus"], "/api/runtime/status")

    def test_unavailable_bootstrap_payload_preserves_minimal_contract(self) -> None:
        runtime_app = snapshot_script.runtime_app

        with patch.multiple(
            runtime_app,
            _build_id=lambda: "build-123",
            _config=lambda: SimpleNamespace(diagnostics_enabled=False, admin_emails=[]),
        ):
            payload = runtime_app._bootstrap_unavailable_payload(None, "Warehouse unavailable.")

        self.assertEqual(payload["bootstrapContract"]["version"], "bootstrap-v3")
        self.assertEqual(payload["bootstrapContract"]["mode"], "bootstrap-unavailable")
        self.assertEqual(payload["bootState"], "unavailable")
        self.assertEqual(payload["bootMessage"], "Warehouse unavailable.")
        self.assertNotIn("assets", payload)
        self.assertNotIn("assetIndex", payload)
        self.assertNotIn("diagnostics", payload)
        self.assertNotIn("summary", payload["discovery"])
        self.assertEqual(payload["apiContract"]["bootstrap"], "/api/bootstrap")

    def test_runtime_router_invokes_injected_handlers(self) -> None:
        calls: list[tuple[str, object]] = []

        def bootstrap_response(request):
            calls.append(("bootstrap", request))
            return JSONResponse({"surface": "bootstrap"})

        def runtime_status_response(request):
            calls.append(("runtime_status", request))
            return JSONResponse({"surface": "runtime_status"})

        router = build_runtime_router(
            bootstrap_response=bootstrap_response,
            runtime_status_response=runtime_status_response,
        )
        routes = {route.path: route for route in router.routes}
        request = object()

        bootstrap_result = routes["/api/bootstrap"].endpoint(request)
        runtime_status_result = routes["/api/runtime/status"].endpoint(request)

        self.assertEqual(
            calls,
            [
                ("bootstrap", request),
                ("runtime_status", request),
            ],
        )
        self.assertEqual(bootstrap_result.status_code, 200)
        self.assertEqual(runtime_status_result.status_code, 200)
        self.assertEqual(_response_json(bootstrap_result), {"surface": "bootstrap"})
        self.assertEqual(_response_json(runtime_status_result), {"surface": "runtime_status"})

    def test_runtime_app_routes_delegate_to_runtime_helpers(self) -> None:
        runtime_app = snapshot_script.runtime_app
        routes = {
            route.path: route for route in runtime_app.app.routes if route.path in snapshot_script.RUNTIME_PATHS
        }
        request = object()

        with patch.object(
            runtime_app,
            "_api_bootstrap_response",
            return_value=JSONResponse({"ok": "bootstrap"}),
        ) as bootstrap_patch:
            response = routes["/api/bootstrap"].endpoint(request)
        bootstrap_patch.assert_called_once_with(request)
        self.assertEqual(_response_json(response), {"ok": "bootstrap"})

        with patch.object(
            runtime_app,
            "_api_runtime_status_response",
            return_value=JSONResponse({"ok": "runtime_status"}),
        ) as runtime_status_patch:
            response = routes["/api/runtime/status"].endpoint(request)
        runtime_status_patch.assert_called_once_with(request)
        self.assertEqual(_response_json(response), {"ok": "runtime_status"})

    def test_runtime_api_openapi_snapshot_matches_committed_contract(self) -> None:
        expected = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        observed = snapshot_script.build_runtime_api_snapshot()

        self.assertEqual(expected, observed)
        self.assertEqual(set(observed["paths"]), set(snapshot_script.RUNTIME_PATHS))

    def test_asset_availability_meta_degrades_without_obo(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = SimpleNamespace(headers={})

        with patch.multiple(
            runtime_app,
            _request_auth_mode=lambda _request: "app-principal-only",
            _asset_visibility_record=lambda *_args, **_kwargs: {
                "visible": True,
                "exists": True,
                "openable": True,
                "visibilityState": "visible",
            },
        ):
            payload = runtime_app._asset_availability_payload(["main.sales.orders"], request)

        self.assertFalse(payload["meta"]["authoritative"])
        self.assertTrue(payload["meta"]["degraded"])
        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertEqual(payload["meta"]["visibilityScope"], "workspace-app-principal")
        self.assertFalse(payload["meta"]["capabilities"]["separatesExistsFromVisible"])

    def test_asset_detail_unknown_visibility_returns_canonical_error_payload(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = SimpleNamespace(headers={})

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _asset_visibility_record=lambda *_args, **_kwargs: {
                "visible": False,
                "exists": False,
                "openable": False,
                "visibilityState": "unknown",
                "reason": "Visibility verification failed.",
            },
        ):
            response = runtime_app.api_asset_detail("main.sales.orders", request, sections=[])

        payload = _response_json(response)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(payload["detail"], "Visibility verification failed.")
        self.assertEqual(payload["meta"]["capabilities"]["visibilityState"], "unknown")
        self.assertEqual(payload["meta"]["state"], "unknown")
        self.assertEqual(payload["errors"][0]["message"], "Visibility verification failed.")

    def test_asset_availability_fails_closed_without_actor_scoped_visibility_proof(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = SimpleNamespace(headers={})

        with patch.multiple(
            runtime_app,
            _request_auth_mode=lambda _request: "app-principal-only",
            _asset_is_visible=lambda *_args, **_kwargs: False,
            _asset_exists=lambda *_args, **_kwargs: True,
        ):
            payload = runtime_app._asset_availability_payload(["main.sales.hidden_orders"], request)

        record = payload["assets"]["main.sales.hidden_orders"]
        self.assertFalse(record["exists"])
        self.assertFalse(record["visible"])
        self.assertFalse(record["openable"])
        self.assertEqual(record["visibilityState"], "missing")
        self.assertEqual(payload["meta"]["state"], "degraded")

    def test_invalid_discovery_query_preserves_invalid_query_payload_and_meta(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = SimpleNamespace(headers={})
        invalid_query = {
            "state": "invalid",
            "message": "Expected a search term after OR.",
            "syntaxHint": "Finish the grouped expression before submitting the query.",
            "supportedFields": ["name", "domain"],
        }

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _discovery_search_payload=lambda **_kwargs: (_ for _ in ()).throw(
                runtime_app.asset_service.DiscoveryQuerySyntaxError("Expected a search term after OR.")
            ),
        ), patch.object(
            runtime_app.asset_service,
            "discovery_invalid_query_payload",
            return_value=invalid_query,
        ):
            response = runtime_app.api_discovery_search(request)

        payload = _response_json(response)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(payload["invalidQuery"], invalid_query)
        self.assertEqual(payload["detail"], "Expected a search term after OR.")
        self.assertIn("meta", payload)

    def test_governance_request_patch_rejects_hidden_asset_requests(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = SimpleNamespace(headers={})
        mutated = {"called": False}

        class Store:
            def get_change_request(self, request_id):
                return SimpleNamespace(uc_full_name="main.sales.hidden_orders")

            def set_request_status(self, **_kwargs):
                mutated["called"] = True
                return None

        with patch.multiple(
            runtime_app,
            _ensure_live_runtime=lambda: None,
            _ensure_can_mutate=lambda _request: "writer@example.com",
            _user_role_slug=lambda _request: "admin",
            _store=lambda: Store(),
            _governance_summary=lambda _request: {"backlog": []},
            _invalidate_asset_caches=lambda _asset_fqn: None,
            _asset_visibility_record=lambda *_args, **_kwargs: {
                "openable": False,
                "visible": False,
                "exists": False,
                "visibilityState": "missing",
            },
        ), patch.object(
            runtime_app,
            "_asset_detail_payload",
            side_effect=AssertionError("hidden asset detail should not be loaded"),
        ):
            with self.assertRaises(runtime_app.HTTPException) as exc:
                runtime_app.api_governance_patch_request(
                    "req-1",
                    runtime_app.GovernanceRequestStatusPatch(status="approved"),
                    request,
                )

        self.assertEqual(exc.exception.status_code, 404)
        self.assertFalse(mutated["called"])


if __name__ == "__main__":
    unittest.main()
