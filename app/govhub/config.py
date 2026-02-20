from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List

def _split_csv(value: str) -> List[str]:
    return [v.strip() for v in value.split(",") if v.strip()]

@dataclass(frozen=True)
class AppConfig:
    # Databricks / Unity Catalog
    warehouse_id: str
    gov_catalog: str
    gov_schema: str

    # DataHub
    datahub_gms_url: str
    datahub_token: str

    # Bootstrap admins (optional)
    admin_emails: List[str]

    @staticmethod
    def from_env() -> "AppConfig":
        warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID", "").strip()
        if not warehouse_id:
            raise ValueError("Missing required env var DATABRICKS_WAREHOUSE_ID (bind a SQL warehouse resource)")
        gov_catalog = os.getenv("GOVHUB_CATALOG", "main").strip()
        gov_schema = os.getenv("GOVHUB_SCHEMA", "governance_hub").strip()

        datahub_gms_url = os.getenv("DATAHUB_GMS_URL", "").strip()
        datahub_token = os.getenv("DATAHUB_TOKEN", "").strip()

        admin_emails = _split_csv(os.getenv("GOVHUB_ADMIN_EMAILS", ""))
        return AppConfig(
            warehouse_id=warehouse_id,
            gov_catalog=gov_catalog,
            gov_schema=gov_schema,
            datahub_gms_url=datahub_gms_url,
            datahub_token=datahub_token,
            admin_emails=admin_emails,
        )
