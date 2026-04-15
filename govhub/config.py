from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List


def _split_csv(value: str) -> List[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class AppConfig:
    # Databricks / Unity Catalog
    warehouse_id: str
    gov_catalog: str
    gov_schema: str

    # Bootstrap admins (optional)
    admin_emails: List[str] = field(default_factory=list)
    build_id: str = ""
    diagnostics_enabled: bool = True
    slow_request_ms: int = 1500

    @staticmethod
    def from_env() -> "AppConfig":
        warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID", "").strip()
        gov_catalog = os.getenv("GOVHUB_CATALOG", "").strip()
        gov_schema = os.getenv("GOVHUB_SCHEMA", "").strip()
        if not warehouse_id:
            raise ValueError(
                "Missing required env var DATABRICKS_WAREHOUSE_ID. "
                "Set this in app.yaml to your SQL Warehouse ID."
            )
        if not gov_catalog:
            raise ValueError(
                "Missing required env var GOVHUB_CATALOG. "
                "Inject the governance catalog explicitly per deployment target."
            )
        if not gov_schema:
            raise ValueError(
                "Missing required env var GOVHUB_SCHEMA. "
                "Inject the governance schema explicitly per deployment target."
            )
        return AppConfig(
            warehouse_id=warehouse_id,
            gov_catalog=gov_catalog,
            gov_schema=gov_schema,
            admin_emails=_split_csv(os.getenv("GOVHUB_ADMIN_EMAILS", "")),
            build_id=os.getenv("GOVHUB_BUILD_ID", "").strip(),
            diagnostics_enabled=_env_bool("GOVHUB_DIAGNOSTICS_ENABLED", True),
            slow_request_ms=_env_int("GOVHUB_SLOW_REQUEST_MS", 1500),
        )
