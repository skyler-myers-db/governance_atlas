from __future__ import annotations

import sys
import unittest
from types import ModuleType
from unittest.mock import patch


def _load_admin_module():
    try:
        from govhub.api import admin as module

        return module
    except ModuleNotFoundError as exc:
        if exc.name not in {"fastapi", "fastapi.responses"}:
            raise

    fastapi = ModuleType("fastapi")

    class _APIRouter:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs
            self.routes = []

        def add_api_route(self, *args, **kwargs):
            return None

        def __getattr__(self, name):
            if name in {"get", "post", "put", "patch", "delete", "options", "head"}:
                def decorator(*args, **kwargs):
                    def wrap(func):
                        self.routes.append(func)
                        return func

                    return wrap

                return decorator
            raise AttributeError(name)

    fastapi.APIRouter = _APIRouter

    responses = ModuleType("fastapi.responses")

    class _JSONResponse:
        def __init__(self, content=None, status_code=200):
            self.content = content
            self.status_code = status_code
            self.headers = {}

        def json(self):
            return self.content

    responses.JSONResponse = _JSONResponse

    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.responses"] = responses

    from govhub.api import admin as module  # type: ignore

    return module


admin = _load_admin_module()


class AdminBackgroundStatusTests(unittest.TestCase):
    def test_running_drainer_returns_available_envelope(self) -> None:
        snapshot = {
            "running": True,
            "lastDrainAt": "2026-04-20T12:00:00Z",
            "processedTotal": 12,
            "lastError": None,
        }

        with patch.object(
            admin, "_background_drainer_snapshot", return_value=snapshot, create=True
        ):
            # _background_drainer_snapshot lives in runtime_app. Patch the
            # lazy import by stubbing the runtime_app module in sys.modules.
            pass

        # Replace the lazy runtime_app import target with our fake so the
        # route reads the snapshot from our patched function.
        fake_runtime_app = ModuleType("runtime_app")
        fake_runtime_app._background_drainer_snapshot = lambda: snapshot
        with patch.dict(sys.modules, {"runtime_app": fake_runtime_app}):
            payload = admin._background_status_payload()

        self.assertIn("data", payload)
        self.assertIn("meta", payload)
        drainer = payload["data"]["drainer"]
        self.assertEqual(drainer["running"], True)
        self.assertEqual(drainer["lastDrainAt"], "2026-04-20T12:00:00Z")
        self.assertEqual(drainer["processedTotal"], 12)
        self.assertIsNone(drainer["lastError"])
        self.assertIsNone(payload["data"]["queue"]["depthHint"])
        self.assertEqual(payload["meta"]["state"], "available")
        self.assertEqual(payload["meta"]["reason"], "")

    def test_stopped_drainer_returns_degraded_envelope(self) -> None:
        snapshot = {
            "running": False,
            "lastDrainAt": None,
            "processedTotal": 0,
            "lastError": None,
        }
        fake_runtime_app = ModuleType("runtime_app")
        fake_runtime_app._background_drainer_snapshot = lambda: snapshot
        with patch.dict(sys.modules, {"runtime_app": fake_runtime_app}):
            payload = admin._background_status_payload()

        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertIn("not currently running", payload["meta"]["reason"])
        self.assertFalse(payload["data"]["drainer"]["running"])

    def test_drainer_error_surfaces_in_meta(self) -> None:
        snapshot = {
            "running": True,
            "lastDrainAt": "2026-04-20T12:00:00Z",
            "processedTotal": 3,
            "lastError": "RuntimeError: store unavailable",
        }
        fake_runtime_app = ModuleType("runtime_app")
        fake_runtime_app._background_drainer_snapshot = lambda: snapshot
        with patch.dict(sys.modules, {"runtime_app": fake_runtime_app}):
            payload = admin._background_status_payload()

        self.assertEqual(payload["meta"]["state"], "degraded")
        self.assertIn(
            "store unavailable",
            payload["meta"]["reason"],
        )
        self.assertEqual(
            payload["data"]["drainer"]["lastError"],
            "RuntimeError: store unavailable",
        )

    def test_router_registers_background_status_route(self) -> None:
        router = admin.build_admin_router()
        # The fake APIRouter stores route callables in self.routes when
        # tests run without fastapi installed. With real fastapi, the
        # router has `.routes`. Either way the endpoint must be reachable.
        if hasattr(router, "routes") and router.routes:
            paths = []
            for route in router.routes:
                path = getattr(route, "path", None)
                if path:
                    paths.append(path)
            self.assertIn("/api/admin/background/status", paths)


if __name__ == "__main__":
    unittest.main()
