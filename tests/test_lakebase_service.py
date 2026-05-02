from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from atlas.services import lakebase
from atlas.services import lakebase_store


class LakebaseServiceTests(unittest.TestCase):
    def test_status_is_disabled_when_config_has_no_lakebase_fields(self) -> None:
        status = lakebase.status(SimpleNamespace())

        self.assertEqual(status["state"], "disabled")
        self.assertFalse(status["enabled"])

    def test_operational_ddl_covers_classified_lakebase_tables(self) -> None:
        ddl = "\n".join(lakebase._operational_schema_ddl("atlas_app"))

        for table in lakebase.LAKEBASE_OPERATIONAL_TABLES:
            self.assertIn(f'"{table}"', ddl)
        self.assertIn("retired_at TIMESTAMPTZ", ddl)

    def test_table_classification_separates_lakebase_from_delta_uc(self) -> None:
        frame = lakebase.table_classification()
        targets = set(frame["target"].tolist())

        self.assertIn("lakebase", targets)
        self.assertIn("delta_uc", targets)
        self.assertEqual(
            frame[frame["table"].eq("metadata_audit_log")].iloc[0]["target"],
            "delta_uc",
        )
        self.assertEqual(
            frame[frame["table"].eq("tasks")].iloc[0]["target"],
            "lakebase",
        )

    def test_active_dual_write_tables_do_not_include_delta_retained_tables(self) -> None:
        self.assertTrue(set(lakebase_store.ACTIVE_LAKEBASE_MIRROR_TABLES))
        self.assertEqual(
            set(lakebase_store.ACTIVE_LAKEBASE_MIRROR_TABLES),
            set(lakebase_store.LAKEBASE_ACTIVE_TABLE_COLUMNS),
        )
        self.assertFalse(
            set(lakebase_store.ACTIVE_LAKEBASE_MIRROR_TABLES).intersection(
                lakebase.DELTA_RETAINED_TABLES
            )
        )
        self.assertIn("metadata_audit_log", lakebase.DELTA_RETAINED_TABLES)
        self.assertNotIn("metadata_audit_log", lakebase_store.ACTIVE_LAKEBASE_MIRROR_TABLES)
        self.assertIn("export_jobs", lakebase_store.DEFERRED_LAKEBASE_OPERATIONAL_TABLES)
        self.assertIn("glossary_terms", lakebase_store.DEFERRED_LAKEBASE_OPERATIONAL_TABLES)

    def test_dual_write_wrapper_mirrors_owner_after_delta_success(self) -> None:
        class DeltaStore:
            catalog = "main"
            schema = "atlas"

            def __init__(self) -> None:
                self.calls: list[str] = []

            def upsert_owner(self, **kwargs):
                self.calls.append(f"delta:{kwargs['uc_full_name']}")

        class Mirror:
            def __init__(self) -> None:
                self.calls: list[tuple[str, str]] = []

            def status(self):
                return {"state": "active"}

            def mirror_owner(self, uc_full_name: str, owner_email: str) -> None:
                self.calls.append((uc_full_name, owner_email))

        delta = DeltaStore()
        mirror = Mirror()
        wrapped = lakebase_store.DualWriteGovernanceStore(delta, mirror)

        wrapped.upsert_owner(
            uc_full_name="main.sales.orders",
            owner_email="owner@example.com",
            owner_type="business",
            updated_by="admin@example.com",
        )

        self.assertEqual(delta.calls, ["delta:main.sales.orders"])
        self.assertEqual(mirror.calls, [("main.sales.orders", "owner@example.com")])

    def test_dual_write_wrapper_does_not_mirror_when_delta_fails(self) -> None:
        class DeltaStore:
            catalog = "main"
            schema = "atlas"

            def upsert_role(self, **_kwargs):
                raise RuntimeError("delta failed")

        class Mirror:
            def __init__(self) -> None:
                self.called = False

            def status(self):
                return {"state": "active"}

            def mirror_role(self, _email: str) -> None:
                self.called = True

        mirror = Mirror()
        wrapped = lakebase_store.DualWriteGovernanceStore(DeltaStore(), mirror)

        with self.assertRaises(RuntimeError):
            wrapped.upsert_role("a@example.com", "admin", "b@example.com")

        self.assertFalse(mirror.called)

    def test_mirror_upsert_uses_parameterized_sql(self) -> None:
        class Cursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, list[object]]] = []

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return None

            def execute(self, sql: str, params: list[object]) -> None:
                self.calls.append((sql, params))

        class Conn:
            def __init__(self) -> None:
                self.cursor_obj = Cursor()
                self.committed = False

            def cursor(self):
                return self.cursor_obj

            def commit(self):
                self.committed = True

        conn = Conn()
        mirror = lakebase_store.LakebaseOperationalMirror(
            config=SimpleNamespace(lakebase_schema="atlas_app"),
            delta_store=SimpleNamespace(),
        )

        mirror._upsert_rows_in_transaction(
            conn,
            "user_roles",
            [{"email": "a@example.com", "role": "admin", "updated_by": "b@example.com"}],
        )

        self.assertEqual(len(conn.cursor_obj.calls), 1)
        sql, params = conn.cursor_obj.calls[0]
        self.assertIn("ON CONFLICT", sql)
        self.assertNotIn("a@example.com", sql)
        self.assertIn("a@example.com", params)

    def test_active_mirror_projects_known_lakebase_columns(self) -> None:
        class Cursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, list[object]]] = []

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return None

            def execute(self, sql: str, params: list[object]) -> None:
                self.calls.append((sql, params))

        class Conn:
            def __init__(self) -> None:
                self.cursor_obj = Cursor()

            def cursor(self):
                return self.cursor_obj

        conn = Conn()
        mirror = lakebase_store.LakebaseOperationalMirror(
            config=SimpleNamespace(lakebase_schema="atlas_app"),
            delta_store=SimpleNamespace(),
        )

        mirror._upsert_rows_in_transaction(
            conn,
            "custom_property_definitions",
            [
                {
                    "definition_id": "def-1",
                    "entity_kind": "asset",
                    "property_key": "business_purpose",
                    "data_type": "string",
                    "state": "retired",
                    "retired_at": "2026-04-25T00:00:00Z",
                    "delta_only_column": "must-not-write",
                }
            ],
        )

        sql, params = conn.cursor_obj.calls[0]
        self.assertIn('"retired_at"', sql)
        self.assertNotIn("delta_only_column", sql)
        self.assertIn("2026-04-25T00:00:00Z", params)

    def test_jsonb_mirror_coerces_empty_classification_samples_to_array(self) -> None:
        class Cursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, list[object]]] = []

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return None

            def execute(self, sql: str, params: list[object]) -> None:
                self.calls.append((sql, params))

        class Conn:
            def __init__(self) -> None:
                self.cursor_obj = Cursor()

            def cursor(self):
                return self.cursor_obj

        conn = Conn()
        mirror = lakebase_store.LakebaseOperationalMirror(
            config=SimpleNamespace(lakebase_schema="atlas_app"),
            delta_store=SimpleNamespace(),
        )

        mirror._upsert_rows_in_transaction(
            conn,
            "classification_recommendations",
            [
                {
                    "recommendation_id": "rec-1",
                    "asset_fqn": "main.sales.orders",
                    "column_name": "email",
                    "evidence_json": "[]",
                    "sample_redacted": True,
                    "sample_values_json": "",
                    "status": "pending",
                    "remediation_suggestions_json": "[]",
                }
            ],
        )

        _sql, params = conn.cursor_obj.calls[0]
        self.assertNotIn("", params)
        jsonb_params = [param for param in params if param.__class__.__name__ == "Jsonb"]
        self.assertTrue(jsonb_params)
        self.assertTrue(any(getattr(param, "obj", None) == [] for param in jsonb_params))

    def test_delta_retained_tables_never_open_lakebase_connection(self) -> None:
        mirror = lakebase_store.LakebaseOperationalMirror(
            config=SimpleNamespace(lakebase_schema="atlas_app"),
            delta_store=SimpleNamespace(),
        )

        with patch.object(lakebase_store.lakebase, "connect") as connect:
            mirror.mirror_row_by_id("audit", "metadata_audit_log", "audit_id", "audit-1")

        connect.assert_not_called()

    def test_mirror_workflow_reads_delta_snapshots_and_never_audit_tables(self) -> None:
        class UC:
            def __init__(self) -> None:
                self.queries: list[str] = []

            def query_df(self, sql: str) -> pd.DataFrame:
                self.queries.append(sql)
                if "`tasks`" in sql:
                    return pd.DataFrame(
                        [
                            {
                                "task_id": "task-1",
                                "thread_id": "thread-1",
                                "entity_id": "entity-1",
                                "assignee_entry_id": None,
                                "reviewer_entry_id": None,
                            }
                        ]
                    )
                if "`threads`" in sql:
                    return pd.DataFrame(
                        [{"thread_id": "thread-1", "created_by_entry_id": "entry-1"}]
                    )
                if "`thread_posts`" in sql:
                    return pd.DataFrame(columns=["post_id", "created_by_entry_id"])
                if "`activity_events`" in sql:
                    return pd.DataFrame(columns=["event_id", "actor_entry_id"])
                if "`notifications`" in sql:
                    return pd.DataFrame(columns=["notification_id"])
                if "`notification_receipts`" in sql:
                    return pd.DataFrame(columns=["notification_id", "recipient_entry_id"])
                if "`entity_registry`" in sql:
                    return pd.DataFrame([{"entity_id": "entity-1"}])
                if "`entity_aliases`" in sql:
                    return pd.DataFrame(columns=["alias_id"])
                if "`identity_directory_entries`" in sql:
                    return pd.DataFrame([{"entry_id": "entry-1"}])
                return pd.DataFrame()

        class DeltaStore:
            def __init__(self) -> None:
                self.uc = UC()

            def _fq(self, table: str) -> str:
                return f"`main`.`atlas`.`{table}`"

        mirrored: dict[str, pd.DataFrame | None] = {}
        mirror = lakebase_store.LakebaseOperationalMirror(
            config=SimpleNamespace(lakebase_schema="atlas_app"),
            delta_store=DeltaStore(),
        )

        with patch.object(mirror, "_mirror_frames", side_effect=lambda _op, frames: mirrored.update(frames)):
            mirror.mirror_workflow("task-1")

        self.assertIn("tasks", mirrored)
        self.assertIn("threads", mirrored)
        self.assertIn("identity_directory_entries", mirrored)
        self.assertNotIn("metadata_audit_log", "\n".join(mirror.delta_store.uc.queries))

    def test_runtime_store_factory_wraps_store_when_lakebase_enabled(self) -> None:
        import runtime_app

        class FakeStore:
            def __init__(self, uc, catalog: str, schema: str) -> None:
                self.uc = uc
                self.catalog = catalog
                self.schema = schema
                self.ensured = False

            def ensure_tables(self) -> None:
                self.ensured = True

            @property
            def fq_schema(self) -> str:
                return f"`{self.catalog}`.`{self.schema}`"

            def _fq(self, table: str) -> str:
                return f"{self.fq_schema}.`{table}`"

        runtime_app._store.cache_clear()
        try:
            with patch.multiple(
                runtime_app,
                _config=lambda: SimpleNamespace(
                    lakebase_enabled=True,
                    lakebase_schema="atlas_app",
                    gov_catalog="datapact",
                    gov_schema="atlas",
                ),
                _uc=lambda: object(),
                GovernanceStore=FakeStore,
            ), patch.object(runtime_app.lakebase_service, "ensure_schema", return_value={"state": "available"}):
                store = runtime_app._store()

            self.assertTrue(hasattr(store, "lakebase_dual_write_status"))
            self.assertEqual(store.lakebase_dual_write_status()["state"], "active")
        finally:
            runtime_app._store.cache_clear()


if __name__ == "__main__":
    unittest.main()
