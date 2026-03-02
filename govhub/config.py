from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List


def _split_csv(value: str) -> List[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class AppConfig:
    # Databricks / Unity Catalog
    warehouse_id: str
    gov_catalog: str
    gov_schema: str

    # Optional: OpenMetadata (self-hosted)
    om_server_url: str
    om_jwt_token: str

    # Bootstrap admins (optional)
    admin_emails: List[str] = field(default_factory=list)

    @property
    def openmetadata_enabled(self) -> bool:
        return bool(self.om_server_url and self.om_jwt_token)

    @staticmethod
    def from_env() -> "AppConfig":
        warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID", "").strip()
        if not warehouse_id:
            raise ValueError(
                "Missing required env var DATABRICKS_WAREHOUSE_ID. "
                "Set this in app.yaml to your SQL Warehouse ID."
            )
        return AppConfig(
            warehouse_id=warehouse_id,
            gov_catalog=os.getenv("GOVHUB_CATALOG", "main").strip(),
            gov_schema=os.getenv("GOVHUB_SCHEMA", "governance_hub").strip(),
            om_server_url=os.getenv("OPENMETADATA_SERVER_URL", "").strip(),
            om_jwt_token=os.getenv("OPENMETADATA_JWT_TOKEN", "").strip(),
            admin_emails=_split_csv(os.getenv("GOVHUB_ADMIN_EMAILS", "")),
        )
