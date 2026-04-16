from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import run_app


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "generate_runtime_api_openapi_snapshot.py"
APP_YAML_PATH = ROOT / "app.yaml"


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


class RuntimeRouteServingTests(unittest.TestCase):
    def test_app_yaml_launches_run_app(self) -> None:
        content = APP_YAML_PATH.read_text(encoding="utf-8")

        self.assertIn("- run_app.py", content)

    def test_run_app_points_to_runtime_app(self) -> None:
        self.assertEqual(run_app.APP_ENTRYPOINT, "runtime_app:app")
        self.assertEqual(run_app.APP_MODULE, "runtime_app")
        self.assertTrue(run_app.FRONTEND_DIST.as_posix().endswith("frontend/dist/index.html"))

    def test_runtime_app_exposes_shell_and_runtime_routes(self) -> None:
        runtime_app = snapshot_script.runtime_app
        paths = {route.path for route in runtime_app.app.routes}

        self.assertIn("/", paths)
        self.assertIn("/api/bootstrap", paths)
        self.assertIn("/api/runtime/status", paths)


if __name__ == "__main__":
    unittest.main()
