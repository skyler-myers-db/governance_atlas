from __future__ import annotations

import re
import unittest

from govhub import migrations


class FakeColumn:
    def __init__(self, values):
        self._values = list(values)

    def tolist(self):
        return list(self._values)


class FakeFrame:
    def __init__(self, values):
        self._values = list(values)
        self.empty = not self._values

    def __getitem__(self, key):
        if key != "version":
            raise KeyError(key)
        return FakeColumn(self._values)


class FakeUC:
    def __init__(self) -> None:
        self.executed: list[str] = []
        self._applied_versions: set[int] = set()

    def execute(self, sql: str) -> None:
        self.executed.append(sql)
        if "INSERT INTO `main`.`governance_hub`.`schema_migrations`" not in sql:
            return
        match = re.search(r"VALUES \(\s*(\d+),", sql)
        if match:
            self._applied_versions.add(int(match.group(1)))

    def query_df(self, sql: str):
        if "schema_migrations" not in sql:
            return FakeFrame([])
        return FakeFrame(sorted(self._applied_versions))


class MigrationTests(unittest.TestCase):
    def test_apply_migrations_creates_schema_migration_table_and_marks_baseline(self) -> None:
        uc = FakeUC()

        applied = migrations.apply_migrations(uc, "main", "governance_hub")

        self.assertEqual(applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`schema_migrations`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("metadata_audit_log" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("glossary_term_links" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("identity_directory_entries" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("entity_registry" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("entity_aliases" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`threads`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`thread_posts`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`tasks`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`activity_events`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`notifications`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`notification_receipts`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`notification_preferences`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`governance_queue_projection`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`glossary_summary_projection`" in sql for sql in uc.executed)
        )
        # Phase 5 Tranche A tables landed in migration v8.
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`change_events`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`entity_versions`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`entity_relationships`" in sql for sql in uc.executed)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`identity_directory_memberships`" in sql for sql in uc.executed)
        )
        # Phase 4 Tranche 2 / Phase 12 — export_jobs landed in migration v9.
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`export_jobs`" in sql for sql in uc.executed)
        )
        # Phase 12 — background_work queue + dead letters landed in migration v10.
        for table in (
            "background_work_items",
            "background_work_runs",
            "background_dead_letters",
        ):
            self.assertTrue(
                any(f"CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`{table}`" in sql for sql in uc.executed),
                f"expected {table} create statement",
            )
        # Phase 8 — custom properties + profile tables landed in migration v11.
        for table in (
            "custom_property_definitions",
            "custom_property_definition_versions",
            "custom_property_assignments",
            "profile_runs",
            "profile_table_metrics",
            "profile_column_metrics",
        ):
            self.assertTrue(
                any(f"CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`{table}`" in sql for sql in uc.executed),
                f"expected {table} create statement",
            )
        # Phase 10 — quality core tables landed in migration v12.
        for table in (
            "quality_test_definitions",
            "quality_test_definition_versions",
            "quality_suites",
            "quality_test_cases",
            "quality_runs",
            "quality_run_results",
            "quality_alerts",
        ):
            self.assertTrue(
                any(f"CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`{table}`" in sql for sql in uc.executed),
                f"expected {table} create statement",
            )
        # Phase 11 — breadth + scale tables landed in migration v13.
        for table in (
            "classifications",
            "classification_terms",
            "domains",
            "data_products",
            "data_product_members",
            "logical_column_groups",
            "logical_column_group_members",
            "metrics",
            "contracts",
        ):
            self.assertTrue(
                any(f"CREATE TABLE IF NOT EXISTS `main`.`governance_hub`.`{table}`" in sql for sql in uc.executed),
                f"expected {table} create statement",
            )
        self.assertEqual(uc._applied_versions, {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14})

    def test_apply_migrations_is_idempotent(self) -> None:
        uc = FakeUC()
        migrations.apply_migrations(uc, "main", "governance_hub")
        executed_after_first_run = len(uc.executed)

        applied = migrations.apply_migrations(uc, "main", "governance_hub")

        self.assertEqual(applied, [])
        # Idempotent replay re-runs `ensure_schema_migrations_table`
        # (CREATE SCHEMA + CREATE TABLE) twice (from apply_migrations +
        # applied_versions), which is the only execute() traffic.
        self.assertEqual(executed_after_first_run + 4, len(uc.executed))


if __name__ == "__main__":
    unittest.main()
