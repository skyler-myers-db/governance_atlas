#!/usr/bin/env python3
"""Dual-mode launcher for Governance Hub.

Default mode preserves the existing Streamlit app. Set `GOVHUB_APP_MODE=modern`
to launch the new ASGI frontend once `modern_app:app` is present.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final


LEGACY_MODE: Final[str] = "legacy"
MODERN_MODE: Final[str] = "modern"
MODERN_ENTRYPOINT: Final[str] = "modern_app:app"
MODERN_MODULE: Final[str] = "modern_app"
ROOT: Final[Path] = Path(__file__).resolve().parent
FRONTEND_DIR: Final[Path] = ROOT / "frontend"
FRONTEND_DIST: Final[Path] = FRONTEND_DIR / "dist" / "index.html"


def _normalized_mode() -> str:
    raw = os.getenv("GOVHUB_APP_MODE", LEGACY_MODE).strip().lower()
    aliases = {
        "streamlit": LEGACY_MODE,
        "legacy": LEGACY_MODE,
        "classic": LEGACY_MODE,
        "modern": MODERN_MODE,
        "node": MODERN_MODE,
        "js": MODERN_MODE,
        "asgi": MODERN_MODE,
        "react": MODERN_MODE,
    }
    if raw in aliases:
        return aliases[raw]
    raise SystemExit(
        "Unsupported GOVHUB_APP_MODE value "
        f"{raw!r}. Use {LEGACY_MODE!r} or {MODERN_MODE!r}."
    )


def _port() -> str:
    return (
        os.getenv("DATABRICKS_APP_PORT")
        or os.getenv("PORT")
        or os.getenv("APP_PORT")
        or "8000"
    )


def _exec(cmd: list[str]) -> None:
    os.execvp(cmd[0], cmd)


def _run_legacy() -> None:
    _exec(
        [
            "streamlit",
            "run",
            "app.py",
            "--server.address",
            "0.0.0.0",
            "--server.port",
            _port(),
            "--server.headless",
            "true",
            "--browser.gatherUsageStats",
            "false",
        ]
    )


def _run_modern() -> None:
    if importlib.util.find_spec(MODERN_MODULE) is None:
        raise SystemExit(
            "GOVHUB_APP_MODE=modern is set, but modern_app.py is not present yet."
        )
    if importlib.util.find_spec("uvicorn") is None:
        raise SystemExit(
            "GOVHUB_APP_MODE=modern requires uvicorn to be installed."
        )
    if not FRONTEND_DIST.exists():
        npm = shutil.which("npm")
        if npm and (FRONTEND_DIR / "node_modules").exists():
            subprocess.run([npm, "run", "build"], cwd=str(FRONTEND_DIR), check=True)
        if not FRONTEND_DIST.exists():
            raise SystemExit(
                "GOVHUB_APP_MODE=modern requires a built React frontend. "
                "Build frontend/dist before launching modern mode."
            )
    _exec(
        [
            sys.executable,
            "-m",
            "uvicorn",
            MODERN_ENTRYPOINT,
            "--host",
            "0.0.0.0",
            "--port",
            _port(),
        ]
    )


def main() -> None:
    mode = _normalized_mode()
    if mode == MODERN_MODE:
        _run_modern()
    else:
        _run_legacy()


if __name__ == "__main__":
    main()
