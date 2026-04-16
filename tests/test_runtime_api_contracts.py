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
    def test_compose_bootstrap_payload_pins_shell_contract_and_seed_adapter_debt(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = object()
        base_payload = {
            "_assetPool": [{"fqn": "main.sales.orders", "name": "orders"}],
            "payload": {
                "version": "test-bootstrap",
                "bootState": "live",
                "bootMessage": "",
                "apiBase": "/api",
                "discovery": {},
            },
        }

        with patch.multiple(
            runtime_app,
            _route_context=lambda _request: {"surface": "discovery", "asset": "", "query": ""},
            _bootstrap_seed_assets=lambda asset_pool, selected_fqn="": list(asset_pool),
            _uc_runtime_status=lambda: {"state": "live", "message": ""},
            _store_status=lambda: {"state": "live", "message": ""},
            _capabilities_payload=lambda *args, **kwargs: {"systemInventoryRead": {"state": "available"}},
            _runtime_diagnostics_payload=lambda *args, **kwargs: {"observedAt": "2026-04-15T00:00:00Z"},
            _user_role=lambda _request: "Admin",
            _user_email=lambda _request: "admin@example.com",
            _build_id=lambda: "build-123",
            _config=lambda: SimpleNamespace(diagnostics_enabled=True),
        ):
            payload = runtime_app._compose_bootstrap_payload(request, base_payload)

        self.assertEqual(payload["bootstrapContract"]["version"], "bootstrap-v2")
        self.assertEqual(payload["bootstrapContract"]["class"], "shell-capability")
        self.assertNotIn("governance", payload)
        self.assertNotIn("graphs", payload)
        self.assertNotIn("governanceSummary", payload["apiContract"])
        self.assertNotIn("discoverySummary", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("governanceSummary", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("lineageGraphs", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("summary", payload["discovery"])
        self.assertEqual(
            payload["bootstrapContract"]["seedAdapters"]["seededAssets"]["surfaces"],
            ["discovery", "entity", "lineage"],
        )

    def test_compose_bootstrap_payload_strips_legacy_graph_field_for_entity_routes(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = object()
        base_payload = {
            "_assetPool": [{"fqn": "main.sales.orders", "name": "orders"}],
            "payload": {
                "version": "test-bootstrap",
                "bootState": "live",
                "bootMessage": "",
                "apiBase": "/api",
                "graphs": {"main.sales.orders": {"data": {"nodes": [], "edges": []}}},
                "discovery": {},
            },
        }

        with patch.multiple(
            runtime_app,
            _route_context=lambda _request: {"surface": "entity", "asset": "main.sales.orders", "query": ""},
            _bootstrap_seed_assets=lambda asset_pool, selected_fqn="": list(asset_pool),
            _uc_runtime_status=lambda: {"state": "live", "message": ""},
            _store_status=lambda: {"state": "live", "message": ""},
            _capabilities_payload=lambda *args, **kwargs: {"systemInventoryRead": {"state": "available"}},
            _runtime_diagnostics_payload=lambda *args, **kwargs: {"observedAt": "2026-04-16T00:00:00Z"},
            _user_role=lambda _request: "Admin",
            _user_email=lambda _request: "admin@example.com",
            _build_id=lambda: "build-123",
            _config=lambda: SimpleNamespace(diagnostics_enabled=True),
        ):
            payload = runtime_app._compose_bootstrap_payload(request, base_payload)

        self.assertNotIn("graphs", payload)

    def test_bootstrap_payload_omits_governance_summary_after_live_extraction(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = object()

        with patch.multiple(
            runtime_app,
            _request_cache_scope=lambda _request: "scope-1",
            _ttl_value=lambda _key, _ttl, loader: loader(),
            _store_status=lambda: {"state": "live", "message": ""},
            _bootstrap_inventory_summary=lambda _scope: {
                "visibleAssets": 1,
                "catalogCount": 1,
                "availableCatalogCount": 1,
                "observedCatalogCount": 1,
                "catalogs": ["main"],
                "domains": [],
                "tiers": [],
                "certifications": [],
                "sensitivities": [],
                "assetTypes": ["Table"],
                "assetTypeCounts": {"Table": 1},
                "catalogCounts": {"main": 1},
                "catalogSnapshot": ["main"],
            },
            _bootstrap_seed_asset_pool=lambda _scope: [{"fqn": "main.sales.orders", "name": "orders"}],
            _route_context=lambda _request: {"surface": "discovery", "asset": "", "query": ""},
            _bootstrap_seed_assets=lambda asset_pool, selected_fqn="": list(asset_pool),
            _uc_runtime_status=lambda: {"state": "live", "message": ""},
            _capabilities_payload=lambda *args, **kwargs: {"systemInventoryRead": {"state": "available"}},
            _runtime_diagnostics_payload=lambda *args, **kwargs: {"observedAt": "2026-04-15T00:00:00Z"},
            _user_role=lambda _request: "Admin",
            _user_email=lambda _request: "admin@example.com",
            _build_id=lambda: "build-123",
            _config=lambda: SimpleNamespace(diagnostics_enabled=True),
        ):
            payload = runtime_app._bootstrap_payload(request)

        self.assertNotIn("governance", payload)
        self.assertNotIn("graphs", payload)
        self.assertNotIn("summary", payload["discovery"])
        self.assertNotIn("governanceSummary", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("discoverySummary", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("lineageGraphs", payload["bootstrapContract"]["seedAdapters"])
        self.assertEqual(payload["shell"]["metrics"], [])

    def test_cold_route_seed_payload_omits_governance_summary_after_live_extraction(self) -> None:
        runtime_app = snapshot_script.runtime_app
        request = object()
        captured = {}

        def fake_compose(_request, base_payload, **kwargs):
            captured["payload"] = base_payload["payload"]
            return base_payload["payload"]

        with patch.multiple(
            runtime_app,
            _route_context=lambda _request: {"surface": "entity", "asset": "main.sales.orders", "query": ""},
            _bootstrap_selected_asset_seed=lambda _request, _asset: {
                "fqn": "main.sales.orders",
                "catalog": "main",
                "schema": "sales",
                "objectType": "Table",
            },
            _store_status=lambda: {"state": "live", "message": ""},
            _compose_bootstrap_payload=fake_compose,
        ):
            payload = runtime_app._cold_route_seed_payload(request)

        self.assertEqual(payload["version"], "governance-hub-route-seed-1")
        self.assertNotIn("governance", captured["payload"])
        self.assertNotIn("graphs", captured["payload"])

    def test_unavailable_bootstrap_payload_preserves_contract_and_omits_governance_summary_hint(self) -> None:
        runtime_app = snapshot_script.runtime_app

        with patch.multiple(
            runtime_app,
            _capabilities_payload=lambda *args, **kwargs: {"systemInventoryRead": {"state": "unavailable"}},
            _runtime_diagnostics_payload=lambda *args, **kwargs: {"observedAt": "2026-04-15T00:00:00Z"},
            _user_role=lambda _request: "Reader",
            _user_email=lambda _request: "reader@example.com",
            _build_id=lambda: "build-123",
            _config=lambda: SimpleNamespace(diagnostics_enabled=False),
        ):
            payload = runtime_app._bootstrap_unavailable_payload(None, "Warehouse unavailable.")

        self.assertEqual(payload["bootstrapContract"]["version"], "bootstrap-v2")
        self.assertEqual(payload["bootstrapContract"]["class"], "shell-capability")
        self.assertNotIn("governance", payload)
        self.assertNotIn("graphs", payload)
        self.assertNotIn("governanceSummary", payload["apiContract"])
        self.assertNotIn("discoverySummary", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("governanceSummary", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("lineageGraphs", payload["bootstrapContract"]["seedAdapters"])
        self.assertNotIn("summary", payload["discovery"])

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


if __name__ == "__main__":
    unittest.main()
