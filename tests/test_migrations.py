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

        self.assertEqual(applied, [1, 2, 3, 4, 5, 6, 7])
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
        self.assertEqual(uc._applied_versions, {1, 2, 3, 4, 5, 6, 7})

    def test_apply_migrations_is_idempotent(self) -> None:
        uc = FakeUC()
        migrations.apply_migrations(uc, "main", "governance_hub")
        executed_after_first_run = len(uc.executed)

        applied = migrations.apply_migrations(uc, "main", "governance_hub")

        self.assertEqual(applied, [])
        self.assertEqual(executed_after_first_run + 4, len(uc.executed))


if __name__ == "__main__":
    unittest.main()
