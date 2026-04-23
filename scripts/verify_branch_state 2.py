#!/usr/bin/env python3
"""Branch-state verifier (thin wrapper around validate_repo_hygiene.py).

The audit from 2026-04-20 asked for a standalone ``scripts/verify_branch_state.py``
covering source-tree integrity, forbidden tracked artifacts, legacy file removal,
and frontend package-script/dependency presence. Those checks already live in
``scripts/validate_repo_hygiene.py`` (single source of truth). To honor the audit
request without duplicating logic, this wrapper:

1. Invokes validate_repo_hygiene.py
2. Layers on the handful of package.json-level checks the audit called out
   explicitly (lint/test/typecheck/build scripts, react-router-dom and
   @tanstack/react-query deps)
3. Spot-checks critical tokens inside EntityWorkspace.jsx that the audit named

Running it:

    python scripts/verify_branch_state.py

Exit code 0 = pass. Any failure prints each finding on its own line and exits 1.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FRONTEND_SCRIPTS = ("lint", "test", "typecheck", "build")
REQUIRED_FRONTEND_DEPS = ("react-router-dom", "@tanstack/react-query")
ENTITY_REQUIRED_TOKENS = ("prefetchAssetAvailability", "canOpenLinkedAssetRecord")


def _run_repo_hygiene() -> list[str]:
    """Run validate_repo_hygiene.py and capture its failures (if any)."""
    script = ROOT / "scripts" / "validate_repo_hygiene.py"
    if not script.exists():
        return [f"Missing: {script.relative_to(ROOT)}"]
    result = subprocess.run(
        [sys.executable, str(script)], cwd=ROOT, text=True, capture_output=True
    )
    if result.returncode != 0:
        out = (result.stdout or "").strip()
        err = (result.stderr or "").strip()
        return [
            "validate_repo_hygiene.py reported failures:",
            *[f"  {line}" for line in out.splitlines() if line.strip()],
            *([f"  stderr: {err}"] if err else []),
        ]
    return []


def _check_frontend_package_json() -> list[str]:
    pkg_path = ROOT / "frontend" / "package.json"
    if not pkg_path.exists():
        return [f"Missing required file: {pkg_path.relative_to(ROOT)}"]
    try:
        pkg = json.loads(pkg_path.read_text())
    except json.JSONDecodeError as exc:
        return [f"frontend/package.json is not valid JSON: {exc}"]

    failures: list[str] = []
    scripts = pkg.get("scripts") or {}
    for name in REQUIRED_FRONTEND_SCRIPTS:
        if name not in scripts:
            failures.append(f"frontend/package.json missing script: {name}")

    deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
    for name in REQUIRED_FRONTEND_DEPS:
        if name not in deps:
            failures.append(f"frontend/package.json missing dependency: {name}")
    return failures


def _check_entity_workspace_tokens() -> list[str]:
    entity = ROOT / "frontend" / "src" / "components" / "EntityWorkspace.jsx"
    if not entity.exists():
        return [f"Missing: {entity.relative_to(ROOT)}"]
    text = entity.read_text()
    return [
        f"EntityWorkspace.jsx missing token: {token}"
        for token in ENTITY_REQUIRED_TOKENS
        if token not in text
    ]


def main() -> None:
    failures: list[str] = []
    failures.extend(_run_repo_hygiene())
    failures.extend(_check_frontend_package_json())
    failures.extend(_check_entity_workspace_tokens())

    if failures:
        print("Branch-state verification failed:")
        for failure in failures:
            print(f" - {failure}")
        raise SystemExit(1)

    print("Branch-state verification passed.")


if __name__ == "__main__":
    main()
