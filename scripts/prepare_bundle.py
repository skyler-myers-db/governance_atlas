#!/usr/bin/env python3
"""Assemble a clean Databricks bundle directory with built frontend assets."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
REQUIRED_FRONTEND_FILES = [
    ROOT / "frontend" / "dist" / "index.html",
    ROOT / "frontend" / "dist" / "assets",
]


def _ignore(_directory: str, names: list[str]) -> set[str]:
    ignored = {
        ".git",
        ".github",
        ".venv",
        ".vscode",
        "__pycache__",
        "__MACOSX",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        ".databricks",
        ".DS_Store",
        "node_modules",
    }
    result: set[str] = set()
    for name in names:
        if name in ignored:
            result.add(name)
    return result


def _validate_frontend_bundle() -> None:
    missing = [path for path in REQUIRED_FRONTEND_FILES if not path.exists()]
    if missing:
        missing_list = ", ".join(str(path.relative_to(ROOT)) for path in missing)
        raise SystemExit(
            f"Missing built frontend bundle artifacts: {missing_list}. "
            "Run the frontend build before packaging the bundle."
        )


def _looks_like_removed_legacy_shell(path: Path) -> bool:
    if not path.is_dir():
        return False
    if path.name.startswith(".") or path.name in {"frontend", "govhub", "tests", "scripts", "docs", "sql"}:
        return False
    return (path / "index.html").exists() and (
        (path / "assets").exists() or (path / "data.js").exists()
    )


def _prune_removed_legacy_shells(output_dir: Path) -> None:
    for child in output_dir.iterdir():
        if _looks_like_removed_legacy_shell(child):
            shutil.rmtree(child)


def build_bundle(output_dir: Path) -> None:
    _validate_frontend_bundle()
    if output_dir.exists():
        shutil.rmtree(output_dir)
    shutil.copytree(ROOT, output_dir, ignore=_ignore)
    _prune_removed_legacy_shells(output_dir)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, help="Output directory for the packaged bundle.")
    args = parser.parse_args()
    build_bundle(Path(args.output).resolve())


if __name__ == "__main__":
    main()
