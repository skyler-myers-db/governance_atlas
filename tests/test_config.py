from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from govhub.config import AppConfig


class AppConfigTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "DATABRICKS_WAREHOUSE_ID": "warehouse-1",
            "GOVHUB_CATALOG": "main",
            "GOVHUB_SCHEMA": "governance_hub",
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
            "GOVHUB_CATALOG": "main",
            "GOVHUB_SCHEMA": "governance_hub",
            "GOVHUB_BUILD_ID": "build-123",
            "GOVHUB_DIAGNOSTICS_ENABLED": "false",
            "GOVHUB_SLOW_REQUEST_MS": "2400",
        },
        clear=True,
    )
    def test_from_env_reads_optional_diagnostics_settings(self) -> None:
        config = AppConfig.from_env()

        self.assertEqual(config.build_id, "build-123")
        self.assertFalse(config.diagnostics_enabled)
        self.assertEqual(config.slow_request_ms, 2400)


if __name__ == "__main__":
    unittest.main()
