"""Regression tests for the Audit Evidence "incomplete product" gap fixes.

Covers: SQL-side internal-action exclusion (feed starvation), the 90d window,
lastEventAt guidance for empty ranges, backed policy-violation and
access-review summaries, the field-whitelisted before/after diff, synthesized
details, and real source-table provenance.
"""

from __future__ import annotations

import json
import unittest

import pandas as pd

from atlas.services import atlas_metrics
from atlas.store import GovernanceStore


def _ts(days_ago: float) -> str:
    return (pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=days_ago)).isoformat()


def _audit_frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


class RecordingUC:
    """Captures SQL passed to query_df so tests can assert on the WHERE clause."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def query_df(self, sql: str) -> pd.DataFrame:
        self.queries.append(sql)
        return pd.DataFrame()


class StoreSqlExclusionTests(unittest.TestCase):
    def _store(self) -> tuple[GovernanceStore, RecordingUC]:
        uc = RecordingUC()
        return GovernanceStore(uc, "main", "governance"), uc

    def test_exclude_internal_pushes_not_like_clauses_into_sql(self) -> None:
        store, uc = self._store()
        store.list_metadata_audit(exclude_internal=True, limit=25)
        sql = uc.queries[-1]
        self.assertIn("NOT LIKE '%identity%directory%'", sql)
        self.assertIn("NOT LIKE '%entity%registry%'", sql)
        self.assertIn("NOT LIKE '%entity%alias%'", sql)
        self.assertIn("NOT LIKE '%notification%'", sql)
        self.assertIn("NOT LIKE '%projection%'", sql)
        self.assertIn("NOT LIKE '%mirror%'", sql)
        # Both action and entity_type are guarded (identity_directory_entry
        # rows carry the marker in entity_type, not action).
        self.assertIn("LOWER(COALESCE(action, ''))", sql)
        self.assertIn("LOWER(COALESCE(entity_type, ''))", sql)
        self.assertIn("LIMIT 25", sql)

    def test_default_call_keeps_unfiltered_query(self) -> None:
        store, uc = self._store()
        store.list_metadata_audit(limit=10)
        self.assertNotIn("NOT LIKE", uc.queries[-1])

    def test_payload_requests_sql_side_exclusion(self) -> None:
        captured: dict = {}

        class CapturingStore:
            def list_metadata_audit(self, **kwargs: object) -> pd.DataFrame:
                captured.update(kwargs)
                return pd.DataFrame()

        atlas_metrics.audit_evidence_payload(store=CapturingStore(), limit=40)
        self.assertIs(captured.get("exclude_internal"), True)
        self.assertEqual(captured.get("limit"), 40)


class AuditWindowTests(unittest.TestCase):
    def test_90d_range_is_a_real_window(self) -> None:
        self.assertEqual(atlas_metrics._audit_window_start("90d"), pd.Timedelta(days=90))

    def test_90d_range_filters_out_older_rows(self) -> None:
        class AuditStore:
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return _audit_frame(
                    [
                        {
                            "audit_id": "AUD-NEW",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "metadata updated",
                            "status": "success",
                            "detail": "Owner changed",
                            "created_at": _ts(5),
                        },
                        {
                            "audit_id": "AUD-OLD",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "metadata updated",
                            "status": "success",
                            "detail": "Owner changed",
                            "created_at": _ts(200),
                        },
                    ]
                )

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), date_range="90d", limit=25)
        self.assertEqual(payload["summary"]["totalChanges"], 1)


class EmptyRangeGuidanceTests(unittest.TestCase):
    def test_last_event_at_is_reported_even_when_range_is_empty(self) -> None:
        class AuditStore:
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return _audit_frame(
                    [
                        {
                            "audit_id": "AUD-1",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "metadata updated",
                            "status": "success",
                            "detail": "Owner changed",
                            "created_at": _ts(10),
                        }
                    ]
                )

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), date_range="24h", limit=25)
        self.assertEqual(payload["summary"]["totalChanges"], 0)
        self.assertTrue(payload["summary"]["lastEventAt"])
        # Sanity: the timestamp parses back to roughly 10 days ago.
        newest = pd.to_datetime(payload["summary"]["lastEventAt"], utc=True)
        age_days = (pd.Timestamp.now(tz="UTC") - newest).days
        self.assertGreaterEqual(age_days, 9)
        self.assertLessEqual(age_days, 11)


class SummarySemanticsTests(unittest.TestCase):
    def test_policy_violations_counts_exceptions_and_policy_failures(self) -> None:
        class AuditStore:
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return _audit_frame(
                    [
                        {
                            "audit_id": "AUD-1",
                            "entity_fqn": "main.risk.policy",
                            "action": "policy-exception-detected",
                            "status": "success",
                            "created_at": _ts(0.1),
                        },
                        {
                            "audit_id": "AUD-2",
                            "entity_fqn": "main.risk.policy",
                            "action": "policy update",
                            "status": "failed",
                            "created_at": _ts(0.2),
                        },
                        {
                            "audit_id": "AUD-3",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "policy tag applied",
                            "status": "success",
                            "detail": "Routine policy tag refresh",
                            "created_at": _ts(0.3),
                        },
                    ]
                )

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), limit=25)
        # AUD-3 is a benign policy change: counted in policyChanges but not a violation.
        self.assertEqual(payload["summary"]["policyViolations"], 2)
        self.assertEqual(payload["summary"]["policyChanges"], 3)

    def test_access_reviews_backed_by_change_request_state(self) -> None:
        class AuditStore:
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame()

            def list_change_requests(self, status: str | None = None, limit: int = 200) -> pd.DataFrame:
                return pd.DataFrame(
                    [
                        {"request_id": "REQ-1", "status": "pending", "created_at": _ts(1)},
                        {"request_id": "REQ-2", "status": "open", "created_at": _ts(2)},
                        {"request_id": "REQ-3", "status": "approved", "created_at": _ts(3)},
                    ]
                )

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), limit=25)
        self.assertEqual(payload["summary"]["accessReviewsOpen"], 2)
        self.assertEqual(payload["summary"]["reviewsResolved"], 1)
        self.assertEqual(payload["summary"]["accessReviewSource"], "governance change requests")

    def test_access_reviews_stay_unavailable_without_change_request_source(self) -> None:
        class AuditStore:
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame()

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), limit=25)
        self.assertIsNone(payload["summary"]["accessReviewsOpen"])
        self.assertIsNone(payload["summary"]["reviewsResolved"])

    def test_source_table_reports_real_fqn(self) -> None:
        class AuditStore:
            catalog = "main"
            schema = "governance"

            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return pd.DataFrame()

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), limit=25)
        self.assertEqual(payload["summary"]["sourceTable"], "main.governance.metadata_audit_log")

    def test_source_table_empty_without_store_identity(self) -> None:
        payload = atlas_metrics.audit_evidence_payload(store=None, limit=25)
        self.assertEqual(payload["summary"]["sourceTable"], "")


class DiffWhitelistTests(unittest.TestCase):
    def _payload_for(self, before: dict | None, after: dict | None, detail: str = "Owner changed"):
        class AuditStore:
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                row = {
                    "audit_id": "AUD-1",
                    "entity_fqn": "main.customer.customer_dim",
                    "action": "metadata updated",
                    "status": "success",
                    "detail": detail,
                    "created_at": _ts(0.1),
                }
                if before is not None:
                    row["before_json"] = json.dumps(before)
                if after is not None:
                    row["after_json"] = json.dumps(after)
                return _audit_frame([row])

        return atlas_metrics.audit_evidence_payload(store=AuditStore(), limit=25)

    def test_safe_fields_survive_and_internal_keys_are_dropped(self) -> None:
        payload = self._payload_for(
            {"owner": "old.owner@entrada.ai", "actor_entry_id": "entry-123", "row_hash": "abc", "created_at": _ts(4)},
            {"owner": "skyler@entrada.ai", "actor_entry_id": "entry-456", "row_hash": "def", "created_at": _ts(0.1)},
        )
        event = payload["events"][0]
        self.assertEqual(event["diffState"], "available")
        before = json.loads(event["before_json"])
        after = json.loads(event["after_json"])
        self.assertEqual(before["owner"], "old.owner@entrada.ai")
        self.assertEqual(after["owner"], "skyler@entrada.ai")
        for blocked in ("actor_entry_id", "row_hash", "created_at"):
            self.assertNotIn(blocked, before)
            self.assertNotIn(blocked, after)
        # The evidence block mirrors the selected event's whitelisted diff.
        self.assertEqual(payload["evidence"]["before"], event["before_json"])
        self.assertEqual(payload["evidence"]["after"], event["after_json"])

    def test_rows_with_only_internal_keys_stay_redacted(self) -> None:
        payload = self._payload_for(
            {"actor_entry_id": "entry-123"},
            {"actor_entry_id": "entry-456"},
        )
        event = payload["events"][0]
        self.assertEqual(event["diffState"], "redacted")
        self.assertEqual(event["before_json"], "")
        self.assertEqual(event["after_json"], "")
        self.assertTrue(event["diffReason"])

    def test_rows_without_payloads_are_unavailable_not_redacted(self) -> None:
        payload = self._payload_for(None, None)
        event = payload["events"][0]
        self.assertEqual(event["diffState"], "unavailable")
        # Rows that never carried a payload simply omit/blank the field.
        self.assertEqual(event.get("before_json", ""), "")


class DetailSynthesisTests(unittest.TestCase):
    def test_missing_detail_is_synthesized_from_action_and_target(self) -> None:
        class AuditStore:
            def list_metadata_audit(self, **_: object) -> pd.DataFrame:
                return _audit_frame(
                    [
                        {
                            "audit_id": "AUD-1",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "task-created",
                            "status": "success",
                            "detail": None,
                            "created_at": _ts(0.1),
                        },
                        {
                            "audit_id": "AUD-2",
                            "entity_fqn": "main.customer.customer_dim",
                            "action": "metadata updated",
                            "status": "success",
                            "detail": "Owner changed",
                            "created_at": _ts(0.2),
                        },
                    ]
                )

        payload = atlas_metrics.audit_evidence_payload(store=AuditStore(), limit=25)
        by_id = {event["audit_id"]: event for event in payload["events"]}
        self.assertEqual(by_id["AUD-1"]["display_detail"], "Task Created for main.customer.customer_dim")
        # Rows with a real detail keep it; nothing synthesized on top.
        self.assertNotIn("display_detail", by_id["AUD-2"])


if __name__ == "__main__":
    unittest.main()
