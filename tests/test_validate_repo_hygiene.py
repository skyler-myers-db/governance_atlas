from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts import validate_repo_hygiene


PACKAGE_JSON = {
    "scripts": {
        "lint": "eslint src vite.config.js",
        "test": "vitest run",
        "typecheck": "tsc --noEmit -p tsconfig.json",
        "build": "vite build",
    },
    "dependencies": {
        "@tanstack/react-query": "^5.0.0",
        "react-router-dom": "^6.0.0",
    },
    "devDependencies": {
        "typescript": "^5.0.0",
        "vite": "^5.0.0",
        "vitest": "^3.0.0",
        "eslint-plugin-react-hooks": "^5.0.0",
        "eslint-plugin-unused-imports": "^4.0.0",
    },
}

ESLINT_CONFIG = """
export default [{
  rules: {
    "no-undef": "error",
    "unused-imports/no-unused-imports": "error",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
  },
}];
""".strip()

ENTITY_WORKSPACE = """
import { canOpenLinkedAssetRecord, prefetchAssetAvailability } from "../hooks/useAssetDetail";

function verify(detail) {
  prefetchAssetAvailability([detail]);
  return canOpenLinkedAssetRecord(detail);
}
""".strip()

APP_YAML = """
command:
  - python
  - run_app.py
""".strip()

RUN_APP = """
from pathlib import Path
from typing import Final

APP_ENTRYPOINT: Final[str] = "runtime_app:app"
APP_MODULE: Final[str] = "runtime_app"
FRONTEND_DIST: Final[Path] = Path(__file__).resolve().parent / "frontend" / "dist" / "index.html"
""".strip()

PREPARE_BUNDLE = """
REQUIRED_FRONTEND_FILES = ["frontend/dist/index.html"]
IGNORED = {".git", ".github", "node_modules"}
""".strip()

DEPLOY_WORKFLOW = """
jobs:
  validate:
    steps:
      - run: npm run build
      - run: python3 scripts/prepare_bundle.py --output /tmp/out
      - run: databricks bundle validate -t dev
      - run: databricks bundle summary -t dev
""".strip()

GITIGNORE = """
frontend/dist/
frontend/node_modules/
""".strip()


class RepoHygieneValidationTests(unittest.TestCase):
    def _write_base_tree(self, root: Path) -> None:
        (root / ".github/workflows").mkdir(parents=True, exist_ok=True)
        (root / "frontend/src/components").mkdir(parents=True, exist_ok=True)
        (root / "scripts").mkdir(parents=True, exist_ok=True)
        (root / "frontend/package.json").write_text(json.dumps(PACKAGE_JSON), encoding="utf-8")
        (root / "frontend/eslint.config.js").write_text(ESLINT_CONFIG, encoding="utf-8")
        (root / "frontend/src/components/EntityWorkspace.jsx").write_text(ENTITY_WORKSPACE, encoding="utf-8")
        (root / ".gitignore").write_text(GITIGNORE, encoding="utf-8")
        (root / ".github/workflows/deploy.yml").write_text(DEPLOY_WORKFLOW, encoding="utf-8")
        (root / "app.yaml").write_text(APP_YAML, encoding="utf-8")
        (root / "run_app.py").write_text(RUN_APP, encoding="utf-8")
        (root / "runtime_app.py").write_text("print('runtime')\n", encoding="utf-8")
        (root / "scripts/prepare_bundle.py").write_text(PREPARE_BUNDLE, encoding="utf-8")

    def test_validate_accepts_current_branch_state_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write_base_tree(root)

            failures = validate_repo_hygiene.validate(root=root, tracked_files=[])

        self.assertEqual(failures, [])

    def test_validate_reports_missing_entity_workspace_hotfix_proof(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write_base_tree(root)
            (root / "frontend/src/components/EntityWorkspace.jsx").write_text(
                'export default function EntityWorkspace() { return null; }\n',
                encoding="utf-8",
            )

            failures = validate_repo_hygiene.validate(root=root, tracked_files=[])

        self.assertTrue(
            any("EntityWorkspace branch-state hotfix proof is missing" in failure for failure in failures)
        )

    def test_validate_reports_missing_frontend_foundation_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write_base_tree(root)
            broken_package = dict(PACKAGE_JSON)
            broken_package["dependencies"] = {"react-router-dom": "^6.0.0"}
            broken_package["scripts"] = {"lint": "eslint src"}
            broken_package["devDependencies"] = {}
            (root / "frontend/package.json").write_text(json.dumps(broken_package), encoding="utf-8")

            failures = validate_repo_hygiene.validate(root=root, tracked_files=[])

        self.assertTrue(
            any("required `test` script contract" in failure for failure in failures)
        )
        self.assertTrue(
            any("required dependency `@tanstack/react-query`" in failure for failure in failures)
        )
        self.assertTrue(
            any("required devDependency `eslint-plugin-react-hooks`" in failure for failure in failures)
        )

    def test_validate_reports_missing_runtime_chain_and_bundle_proof_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self._write_base_tree(root)
            (root / "app.yaml").write_text("command:\n  - python\n", encoding="utf-8")
            (root / "run_app.py").write_text("APP_ENTRYPOINT = 'legacy:app'\n", encoding="utf-8")
            (root / ".github/workflows/deploy.yml").write_text(
                "jobs:\n  validate:\n    steps:\n      - run: databricks bundle validate -t dev\n",
                encoding="utf-8",
            )
            (root / "scripts/prepare_bundle.py").write_text("IGNORED = {'.git'}\n", encoding="utf-8")
            (root / ".gitignore").write_text("frontend/node_modules/\n", encoding="utf-8")

            failures = validate_repo_hygiene.validate(root=root, tracked_files=[])

        self.assertTrue(any("app.yaml is missing" in failure for failure in failures))
        self.assertTrue(any("run_app.py is missing required runtime-chain token" in failure for failure in failures))
        self.assertTrue(any("deploy-proof token `databricks bundle summary`" in failure for failure in failures))
        self.assertTrue(any("packaged-artifact inventory token `REQUIRED_FRONTEND_FILES`" in failure for failure in failures))
        self.assertTrue(any(".gitignore is missing required ignore entry `frontend/dist/`" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()
