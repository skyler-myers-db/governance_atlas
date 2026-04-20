"""Regression test locking the OBO → app-principal fallback for the Databricks
``sql`` scope error.

The failure mode this test pins was reported by the operator on 2026-04-19:
stewards intermittently saw a "Discovery search is unavailable" banner with
a raw SDK envelope containing ``403 Forbidden — Invalid scope, required
scopes: sql``. It happens when a user signed into the app before the
``sql`` OBO scope was granted — their token lacks the scope, the warehouse
rejects it, and the SDK surfaces the rejection as an opaque parse error.

The app-principal client (M2M OAuth with ``sql`` scope) can serve the same
read, so :class:`runtime_app._UCWithFallback` transparently retries on the
app principal when it recognizes the scope error. This test exercises that
retry loop directly so a well-meaning refactor can't strip it out.
"""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from govhub import uc as uc_module

# Import lazily inside tests to avoid pulling in the entire FastAPI app
# at module-import time (runtime_app imports lots of side-effecting
# runtime wiring we don't need here).


class MissingSqlScopeDetectorTests(unittest.TestCase):
    def test_detects_canonical_scope_error_text(self) -> None:
        err = RuntimeError(
            "POST /api/2.0/sql/statements — 403 Forbidden — "
            "Invalid scope, required scopes: sql"
        )
        self.assertTrue(uc_module.is_missing_sql_scope_error(err))

    def test_detects_alternative_phrasing(self) -> None:
        err = RuntimeError("403: required scopes: sql (user token)")
        self.assertTrue(uc_module.is_missing_sql_scope_error(err))

    def test_ignores_unrelated_errors(self) -> None:
        self.assertFalse(
            uc_module.is_missing_sql_scope_error(RuntimeError("TABLE_OR_VIEW_NOT_FOUND"))
        )
        self.assertFalse(
            uc_module.is_missing_sql_scope_error(RuntimeError("Insufficient permissions"))
        )
        self.assertFalse(uc_module.is_missing_sql_scope_error(None))


class UCWithFallbackRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        # Import here so monkeypatching in the test module doesn't leak.
        from runtime_app import _UCWithFallback  # noqa: WPS433

        self.wrapper_cls = _UCWithFallback

    def test_latches_to_fallback_after_scope_error(self) -> None:
        scope_error = RuntimeError(
            "POST /api/2.0/sql/statements — 403 Forbidden — "
            "Invalid scope, required scopes: sql"
        )
        primary = MagicMock(name="obo-client")
        primary.list_tables.side_effect = scope_error
        primary.runtime_context.return_value = {"authMode": "obo-forwarded-token"}

        fallback = MagicMock(name="app-principal-client")
        fallback.list_tables.side_effect = [["cat.schema.t1", "cat.schema.t2"], ["cat.schema.t1", "cat.schema.t2"]]
        fallback.runtime_context.return_value = {"authMode": "oauth-m2m-env"}

        wrapper = self.wrapper_cls(primary, fallback)

        # First call: primary raises the scope error → wrapper retries on fallback.
        result = wrapper.list_tables("cat")
        self.assertEqual(result, ["cat.schema.t1", "cat.schema.t2"])
        primary.list_tables.assert_called_once_with("cat")
        fallback.list_tables.assert_called_once_with("cat")

        # Second call: wrapper is latched → primary never touched again.
        wrapper.list_tables("cat")
        self.assertEqual(primary.list_tables.call_count, 1)
        self.assertEqual(fallback.list_tables.call_count, 2)

        # Runtime context reflects the fallback with a scope_fallback marker.
        context = wrapper.runtime_context()
        self.assertTrue(context.get("obo_scope_fallback"))
        self.assertEqual(context.get("authMode"), "oauth-m2m-env")

    def test_unrelated_errors_propagate_without_latching(self) -> None:
        primary = MagicMock(name="obo-client")
        primary.list_tables.side_effect = RuntimeError("TABLE_OR_VIEW_NOT_FOUND: foo")
        primary.runtime_context.return_value = {"authMode": "obo-forwarded-token"}
        fallback = MagicMock(name="app-principal-client")
        fallback.runtime_context.return_value = {"authMode": "oauth-m2m-env"}

        wrapper = self.wrapper_cls(primary, fallback)

        with self.assertRaisesRegex(RuntimeError, "TABLE_OR_VIEW_NOT_FOUND"):
            wrapper.list_tables("cat")

        # Fallback was never consulted — the wrapper should only intercept
        # the sql-scope shape, not mask unrelated UC errors.
        fallback.list_tables.assert_not_called()
        # And the wrapper did not latch.
        context = wrapper.runtime_context()
        self.assertFalse(context.get("obo_scope_fallback"))


if __name__ == "__main__":
    unittest.main()
