from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from atlas.config import AppConfig


class AppConfigTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "DATABRICKS_WAREHOUSE_ID": "warehouse-1",
            "GOVAT_CATALOG": "main",
            "GOVAT_SCHEMA": "atlas",
        },
        clear=True,
    )
    def test_from_env_uses_safe_optional_defaults(self) -> None:
        config = AppConfig.from_env()

        self.assertEqual(config.build_id, "")
        self.assertTrue(config.diagnostics_enabled)
        self.assertEqual(config.slow_request_ms, 1500)

    @patch.dict(
        os.environ,
        {
            "DATABRICKS_WAREHOUSE_ID": "warehouse-1",
            "GOVAT_CATALOG": "main",
            "GOVAT_SCHEMA": "atlas",
            "GOVAT_BUILD_ID": "build-123",
            "GOVAT_DIAGNOSTICS_ENABLED": "false",
            "GOVAT_SLOW_REQUEST_MS": "2400",
        },
        clear=True,
    )
    def test_from_env_reads_optional_diagnostics_settings(self) -> None:
        config = AppConfig.from_env()

        self.assertEqual(config.build_id, "build-123")
        self.assertFalse(config.diagnostics_enabled)
        self.assertEqual(config.slow_request_ms, 2400)

    @patch.dict(
        os.environ,
        {
            "DATABRICKS_WAREHOUSE_ID": "warehouse-1",
            "GOVAT_CATALOG": "main",
            "GOVAT_SCHEMA": "atlas",
            "GOVAT_BUILD_ID": "build-456",
            "GOVAT_DIAGNOSTICS_ENABLED": "false",
            "GOVAT_SLOW_REQUEST_MS": "3100",
        },
        clear=True,
    )
    def test_from_env_reads_govat_runtime_settings(self) -> None:
        config = AppConfig.from_env()

        self.assertEqual(config.gov_catalog, "main")
        self.assertEqual(config.gov_schema, "atlas")
        self.assertEqual(config.build_id, "build-456")
        self.assertFalse(config.diagnostics_enabled)
        self.assertEqual(config.slow_request_ms, 3100)

    @patch.dict(
        os.environ,
        {
            "DATABRICKS_WAREHOUSE_ID": "warehouse-1",
            "GOVAT_CATALOG": "preferred",
            "GOVAT_SCHEMA": "atlas",
        },
        clear=True,
    )
    def test_from_env_uses_govat_catalog_and_schema(self) -> None:
        config = AppConfig.from_env()

        self.assertEqual(config.gov_catalog, "preferred")
        self.assertEqual(config.gov_schema, "atlas")


if __name__ == "__main__":
    unittest.main()
