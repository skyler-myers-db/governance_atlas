#!/usr/bin/env python3
"""Validate that legacy runtime drift and tracked build artifacts stay out of the repo."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

REMOVED_PATHS = (
    "app.py",
    "modern_app.py",
    "govhub/openmetadata.py",
    "govhub/legacy_auth.py",
    "govhub/legacy_auth 2.py",
    "govhub/services/live_metadata 2.py",
    "frontend/src/components/AppErrorBoundary 2.jsx",
)

TRACKED_ARTIFACT_PREFIXES = (
    "frontend/dist/",
    "frontend/node_modules/",
    ".venv/",
)

DUPLICATE_NAME_MARKER = " 2."

RUNTIME_HYGIENE_TARGETS = (
    "app.yaml",
    "databricks.yml",
    "requirements.txt",
    "run_app.py",
    "runtime_app.py",
    "govhub",
    "sql/bootstrap.sql",
)

BANNED_RUNTIME_TOKENS = (
    "GOVHUB_APP_MODE",
    "OPENMETADATA_SERVER_URL",
    "OPENMETADATA_JWT_TOKEN",
    "om_server_url",
    "om_jwt_token",
    "openmetadata_enabled",
    "asset_links",
    "streamlit>=",
)

REQUIRED_BRANCH_STATE_PATHS = (
    ".gitignore",
    ".github/workflows/deploy.yml",
    "app.yaml",
    "run_app.py",
    "runtime_app.py",
    "frontend/package.json",
    "frontend/eslint.config.js",
    "frontend/src/components/EntityWorkspace.jsx",
    "scripts/prepare_bundle.py",
)

REQUIRED_FRONTEND_SCRIPTS = {
    "lint": "eslint",
    "test": "vitest",
    "typecheck": "tsc",
    "build": "vite build",
}

REQUIRED_FRONTEND_DEPENDENCIES = (
    "@tanstack/react-query",
    "react-router-dom",
)

REQUIRED_FRONTEND_DEV_DEPENDENCIES = (
    "typescript",
    "vite",
    "vitest",
    "eslint-plugin-react-hooks",
    "eslint-plugin-unused-imports",
)

REQUIRED_ESLINT_TOKENS = (
    '"no-undef": "error"',
    '"unused-imports/no-unused-imports": "error"',
    '"react-hooks/rules-of-hooks": "error"',
    '"react-hooks/exhaustive-deps": "warn"',
)

REQUIRED_ENTITY_WORKSPACE_TOKENS = (
    "prefetchAssetAvailability",
    "canOpenLinkedAssetRecord",
)

REQUIRED_GITIGNORE_TOKENS = (
    "frontend/dist/",
    "frontend/node_modules/",
)

REQUIRED_APP_YAML_TOKENS = (
    "run_app.py",
)

REQUIRED_RUN_APP_TOKENS = (
    'APP_ENTRYPOINT: Final[str] = "runtime_app:app"',
    'APP_MODULE: Final[str] = "runtime_app"',
    "FRONTEND_DIST",
)

REQUIRED_PREPARE_BUNDLE_TOKENS = (
    "REQUIRED_FRONTEND_FILES",
    ".git",
    ".github",
    "node_modules",
)

REQUIRED_DEPLOY_WORKFLOW_TOKENS = (
    "databricks bundle validate",
    "databricks bundle summary",
    "python3 scripts/prepare_bundle.py",
    "npm run build",
)


def _tracked_files(root: Path = ROOT) -> list[str]:
    completed = subprocess.run(
        ["git", "ls-files"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in completed.stdout.splitlines() if line]


def _target_files(root: Path = ROOT) -> list[Path]:
    files: list[Path] = []
    for target in RUNTIME_HYGIENE_TARGETS:
        path = root / target
        if path.is_file():
            files.append(path)
            continue
        if path.is_dir():
            files.extend(candidate for candidate in path.rglob("*") if candidate.is_file())
    return files


def _looks_like_removed_legacy_shell(path: Path) -> bool:
    if not path.is_dir():
        return False
    if path.name.startswith(".") or path.name in {"frontend", "govhub", "tests", "scripts", "docs", "sql"}:
        return False
    return (path / "index.html").exists() and (
        (path / "assets").exists() or (path / "data.js").exists()
    )


def _validate_required_branch_state(root: Path, failures: list[str]) -> None:
    missing_paths = [path for path in REQUIRED_BRANCH_STATE_PATHS if not (root / path).exists()]
    for path in missing_paths:
        failures.append(f"Required branch-state path is missing: {path}")

    package_path = root / "frontend/package.json"
    if package_path.exists():
        try:
            package = json.loads(package_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            failures.append(f"frontend/package.json is not valid JSON: {exc}")
        else:
            scripts = package.get("scripts") or {}
            dependencies = package.get("dependencies") or {}
            dev_dependencies = package.get("devDependencies") or {}
            for script_name, token in REQUIRED_FRONTEND_SCRIPTS.items():
                script_value = str(scripts.get(script_name) or "")
                if token not in script_value:
                    failures.append(
                        f"frontend/package.json is missing the required `{script_name}` script contract."
                    )
            for dependency in REQUIRED_FRONTEND_DEPENDENCIES:
                if dependency not in dependencies:
                    failures.append(
                        f"frontend/package.json is missing required dependency `{dependency}`."
                    )
            for dependency in REQUIRED_FRONTEND_DEV_DEPENDENCIES:
                if dependency not in dev_dependencies:
                    failures.append(
                        f"frontend/package.json is missing required devDependency `{dependency}`."
                    )

    eslint_path = root / "frontend/eslint.config.js"
    if eslint_path.exists():
        content = eslint_path.read_text(encoding="utf-8")
        for token in REQUIRED_ESLINT_TOKENS:
            if token not in content:
                failures.append(
                    f"frontend/eslint.config.js is missing required lint rule token `{token}`."
                )

    entity_workspace_path = root / "frontend/src/components/EntityWorkspace.jsx"
    if entity_workspace_path.exists():
        content = entity_workspace_path.read_text(encoding="utf-8")
        for token in REQUIRED_ENTITY_WORKSPACE_TOKENS:
            if token not in content:
                failures.append(
                    "EntityWorkspace branch-state hotfix proof is missing "
                    f"`{token}`."
                )

    gitignore_path = root / ".gitignore"
    if gitignore_path.exists():
        content = gitignore_path.read_text(encoding="utf-8")
        for token in REQUIRED_GITIGNORE_TOKENS:
            if token not in content:
                failures.append(f".gitignore is missing required ignore entry `{token}`.")

    app_yaml_path = root / "app.yaml"
    if app_yaml_path.exists():
        content = app_yaml_path.read_text(encoding="utf-8")
        for token in REQUIRED_APP_YAML_TOKENS:
            if token not in content:
                failures.append(
                    f"app.yaml is missing the required launcher token `{token}`."
                )

    run_app_path = root / "run_app.py"
    if run_app_path.exists():
        content = run_app_path.read_text(encoding="utf-8")
        for token in REQUIRED_RUN_APP_TOKENS:
            if token not in content:
                failures.append(
                    f"run_app.py is missing required runtime-chain token `{token}`."
                )

    prepare_bundle_path = root / "scripts/prepare_bundle.py"
    if prepare_bundle_path.exists():
        content = prepare_bundle_path.read_text(encoding="utf-8")
        for token in REQUIRED_PREPARE_BUNDLE_TOKENS:
            if token not in content:
                failures.append(
                    "scripts/prepare_bundle.py is missing required packaged-artifact "
                    f"inventory token `{token}`."
                )

    deploy_workflow_path = root / ".github/workflows/deploy.yml"
    if deploy_workflow_path.exists():
        content = deploy_workflow_path.read_text(encoding="utf-8")
        for token in REQUIRED_DEPLOY_WORKFLOW_TOKENS:
            if token not in content:
                failures.append(
                    ".github/workflows/deploy.yml is missing required deploy-proof "
                    f"token `{token}`."
                )


def validate(root: Path = ROOT, tracked_files: list[str] | None = None) -> list[str]:
    failures: list[str] = []
    tracked_files = tracked_files if tracked_files is not None else _tracked_files(root)
    tracked_set = set(tracked_files)

    for path in REMOVED_PATHS:
        if (root / path).exists():
            failures.append(f"Removed legacy path still exists: {path}")

    for path in root.iterdir():
        if _looks_like_removed_legacy_shell(path):
            failures.append(f"Removed legacy shell path still exists: {path.name}")

    for path in tracked_files:
        file_path = root / path
        if not file_path.exists():
            continue
        if any(path.startswith(prefix) for prefix in TRACKED_ARTIFACT_PREFIXES) or "__pycache__/" in path:
            failures.append(f"Tracked build/runtime artifact found: {path}")
        if DUPLICATE_NAME_MARKER in file_path.name:
            failures.append(f"Tracked duplicate-suffix file found: {path}")

    for file_path in _target_files(root):
        try:
            content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for token in BANNED_RUNTIME_TOKENS:
            if token in content:
                failures.append(
                    f"Banned runtime token '{token}' found in {file_path.relative_to(root)}"
                )

    _validate_required_branch_state(root, failures)

    # `frontend/dist` is allowed in the working tree after a build, but must not be tracked.
    if "frontend/dist/index.html" in tracked_set and (root / "frontend/dist/index.html").exists():
        failures.append("frontend/dist is still tracked by git.")

    return failures


def main() -> int:
    failures = validate()
    if not failures:
        print("Repo hygiene checks passed.")
        return 0
    for failure in failures:
        print(failure, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
