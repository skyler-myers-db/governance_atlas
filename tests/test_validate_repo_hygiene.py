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
    },
    "dependencies": {
        "@tanstack/react-query": "^5.0.0",
        "react-router-dom": "^6.0.0",
    },
    "devDependencies": {
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


class RepoHygieneValidationTests(unittest.TestCase):
    def _write_base_tree(self, root: Path) -> None:
        (root / "frontend/src/components").mkdir(parents=True, exist_ok=True)
        (root / "frontend/package.json").write_text(json.dumps(PACKAGE_JSON), encoding="utf-8")
        (root / "frontend/eslint.config.js").write_text(ESLINT_CONFIG, encoding="utf-8")
        (root / "frontend/src/components/EntityWorkspace.jsx").write_text(ENTITY_WORKSPACE, encoding="utf-8")
        (root / "runtime_app.py").write_text("print('runtime')\n", encoding="utf-8")

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


if __name__ == "__main__":
    unittest.main()
