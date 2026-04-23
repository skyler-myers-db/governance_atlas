"""Regression tests locking the full OBO auth-mode pipeline.

Operator 2026-04-19 round 3 flagged a suspected OBO regression
("I can only see the service principal catalogs again, and not
landing"). Investigation confirmed OBO was actually live on the
deployed app — the user was on a stale client that hadn't refreshed
— but the operator explicitly asked for "many tests around this to
ensure this regression does not keep popping up."

This suite pins the load-bearing invariants of the OBO flow end-to-
end at the module / function level so a future refactor can't
silently demote every user to app-principal without a test failing:

- ``_request_obo_token`` still reads the ``x-forwarded-access-token``
  header (the only header Databricks Apps forwards the user token on).
- ``_uc_for_request`` with a token returns a ``_UCWithFallback``
  whose *primary* slot is the actor-scoped client.
- ``_uc_for_request`` without a token returns the raw app-principal
  client — no wrapper (so no accidental silent fallback when the
  request is genuinely unauthenticated).
- ``runtime_auth_mode`` returns ``OBO_AVAILABLE_MODE`` when both
  ``authenticated`` and ``per_user_authorization`` are true, and
  ``APP_PRINCIPAL_ONLY_MODE`` when only ``authenticated`` is.
- ``runtime_visibility_scope`` mapping stays wired: OBO → actor-scoped,
  app-principal → workspace-app-principal, anonymous → anonymous.
- The ``_UCWithFallback.runtime_context()`` exposes an
  ``obo_scope_fallback: True`` flag AFTER a latch event, so diagnostics
  can tell whether a given request was silently demoted.
- Capability payloads for discovery / governance surfaces flip
  ``actorScoped`` from False → True the moment an OBO token arrives.

If any of these checks fail, a pre-existing silent regression has been
re-introduced — investigate before "fixing" the test.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import importlib

from govhub.services import capabilities as capability_service


def _load_runtime_app():
    """Importlib indirection so we can reload the runtime_app module in
    isolation when the test cares about module-level state. Most tests
    just need the imported module."""
    return importlib.import_module("runtime_app")


class RequestObOTokenExtractionTests(unittest.TestCase):
    def test_header_read_is_x_forwarded_access_token(self) -> None:
        runtime_app = _load_runtime_app()
        request = SimpleNamespace(headers={"x-forwarded-access-token": "  tok-42  "})
        self.assertEqual(runtime_app._request_obo_token(request), "tok-42")

    def test_missing_header_yields_empty_string(self) -> None:
        runtime_app = _load_runtime_app()
        request = SimpleNamespace(headers={})
        self.assertEqual(runtime_app._request_obo_token(request), "")

    def test_none_request_yields_empty_string(self) -> None:
        runtime_app = _load_runtime_app()
        self.assertEqual(runtime_app._request_obo_token(None), "")

    def test_rejects_alternative_header_names(self) -> None:
        runtime_app = _load_runtime_app()
        # Databricks Apps only forwards the user token on
        # x-forwarded-access-token. If a future refactor starts
        # honoring other headers, that's a footgun for header spoofing
        # and should fail loudly here.
        for header_name in (
            "authorization",
            "x-databricks-user-token",
            "x-user-access-token",
            "x-access-token",
        ):
            request = SimpleNamespace(headers={header_name: "should-not-be-read"})
            self.assertEqual(
                runtime_app._request_obo_token(request),
                "",
                f"token must not be read from {header_name}",
            )


class UcForRequestRoutingTests(unittest.TestCase):
    def test_returns_fallback_wrapper_when_token_present(self) -> None:
        runtime_app = _load_runtime_app()
        actor_client = object()
        app_principal_client = object()

        request = SimpleNamespace(headers={"x-forwarded-access-token": "tok"})
        with patch.multiple(
            runtime_app,
            _uc=lambda: app_principal_client,
            _uc_for_token=lambda _tok: actor_client,
        ):
            result = runtime_app._uc_for_request(request)

        self.assertIsInstance(result, runtime_app._UCWithFallback)
        self.assertIs(result._primary, actor_client)
        self.assertIs(result._fallback, app_principal_client)
        self.assertFalse(
            result._latched,
            "a fresh wrapper must not be latched yet — latching only happens "
            "after the first sql-scope failure",
        )

    def test_returns_raw_app_principal_when_no_token(self) -> None:
        runtime_app = _load_runtime_app()
        app_principal_client = object()

        with patch.multiple(runtime_app, _uc=lambda: app_principal_client):
            result = runtime_app._uc_for_request(None)

        self.assertIs(result, app_principal_client)

    def test_actor_client_build_failure_falls_back_to_app_principal(self) -> None:
        runtime_app = _load_runtime_app()
        app_principal_client = object()

        def _raise(_tok: str) -> object:
            raise RuntimeError("simulated per-user client construction failure")

        request = SimpleNamespace(headers={"x-forwarded-access-token": "tok"})
        with patch.multiple(
            runtime_app,
            _uc=lambda: app_principal_client,
            _uc_for_token=_raise,
        ):
            result = runtime_app._uc_for_request(request)

        # Graceful fallback so the app stays readable even when OBO
        # client construction fails — but callers downstream should see
        # the raw app-principal so the auth-mode gate stays honest.
        self.assertIs(result, app_principal_client)


class AuthModeMappingTests(unittest.TestCase):
    """Lock the three-way auth-mode decision so a silent regression in
    one arm doesn't flip every user into the wrong visibility scope."""

    def test_obo_available_requires_both_authenticated_and_per_user_authz(self) -> None:
        self.assertEqual(
            capability_service.runtime_auth_mode(
                authenticated=True, per_user_authorization=True,
            ),
            capability_service.OBO_AVAILABLE_MODE,
        )

    def test_authenticated_without_per_user_authz_is_app_principal_only(self) -> None:
        self.assertEqual(
            capability_service.runtime_auth_mode(
                authenticated=True, per_user_authorization=False,
            ),
            capability_service.APP_PRINCIPAL_ONLY_MODE,
        )

    def test_unauthenticated_is_no_identity_mode(self) -> None:
        self.assertEqual(
            capability_service.runtime_auth_mode(
                authenticated=False, per_user_authorization=False,
            ),
            capability_service.NO_IDENTITY_MODE,
        )

    def test_unauthenticated_ignores_per_user_authz_true(self) -> None:
        # Defensive: a broken upstream that somehow reports "not
        # authenticated but has OBO" should still map to no-identity.
        self.assertEqual(
            capability_service.runtime_auth_mode(
                authenticated=False, per_user_authorization=True,
            ),
            capability_service.NO_IDENTITY_MODE,
        )


class VisibilityScopeMappingTests(unittest.TestCase):
    def test_obo_maps_to_actor_scoped(self) -> None:
        self.assertEqual(
            capability_service.runtime_visibility_scope(
                capability_service.OBO_AVAILABLE_MODE,
            ),
            capability_service.ACTOR_SCOPED_VISIBILITY,
        )

    def test_app_principal_maps_to_workspace_visibility(self) -> None:
        self.assertEqual(
            capability_service.runtime_visibility_scope(
                capability_service.APP_PRINCIPAL_ONLY_MODE,
            ),
            capability_service.WORKSPACE_APP_PRINCIPAL_VISIBILITY,
        )

    def test_no_identity_maps_to_anonymous_visibility(self) -> None:
        self.assertEqual(
            capability_service.runtime_visibility_scope(
                capability_service.NO_IDENTITY_MODE,
            ),
            capability_service.ANONYMOUS_APP_PRINCIPAL_VISIBILITY,
        )


class UcWithFallbackContextTests(unittest.TestCase):
    def test_runtime_context_exposes_obo_scope_fallback_after_latch(self) -> None:
        runtime_app = _load_runtime_app()

        class _Stub:
            def runtime_context(self) -> dict:
                return {"authType": "oauth-m2m", "hostPresent": True}

        primary = _Stub()
        fallback = _Stub()
        wrapper = runtime_app._UCWithFallback(primary, fallback)
        wrapper._latched = True

        ctx = wrapper.runtime_context()
        self.assertTrue(
            ctx.get("obo_scope_fallback"),
            "after a latch, diagnostics MUST surface obo_scope_fallback so "
            "the UI / server logs can tell OBO silently demoted to app-"
            "principal. Otherwise users see stale workspace data without a "
            "warning (exactly the 2026-04-19 round-3 operator complaint).",
        )

    def test_runtime_context_is_clean_when_not_latched(self) -> None:
        runtime_app = _load_runtime_app()

        class _Stub:
            def runtime_context(self) -> dict:
                return {"authType": "oauth-m2m"}

        primary = _Stub()
        fallback = _Stub()
        wrapper = runtime_app._UCWithFallback(primary, fallback)
        self.assertFalse(wrapper._latched)

        ctx = wrapper.runtime_context()
        self.assertNotIn(
            "obo_scope_fallback",
            ctx,
            "fresh wrapper must NOT claim a fallback has occurred",
        )


class CapabilityActorScopedFlipTests(unittest.TestCase):
    """Spot-check that capability payloads actually flip actor-scoped
    when auth mode promotes to OBO. A silent reversion here is exactly
    what would make the operator see workspace-principal catalogs
    (landing missing) while the runtime thinks OBO is live."""

    def _bootstrap_caps(self, *, per_user_authorization: bool) -> dict:
        return capability_service.bootstrap_capabilities(
            actor_role="Reader",
            authenticated=True,
            runtime_state="live",
            visible_asset_count=100,
            available_catalog_count=4,
            observed_catalog_count=4,
            per_user_authorization=per_user_authorization,
            claim_actor_scoped_reads=per_user_authorization,
        )

    def test_inventory_read_is_actor_scoped_under_obo(self) -> None:
        caps = self._bootstrap_caps(per_user_authorization=True)
        inventory = caps.get("systemInventoryRead") or {}
        self.assertTrue(
            inventory.get("actorScoped"),
            "systemInventoryRead under OBO must be actor-scoped so the user "
            "sees only the catalogs/schemas/tables their Databricks UC "
            "permissions allow (exactly the 2026-04-19 round-3 operator ask: "
            "'I should be able to see landing catalog').",
        )
        self.assertEqual(
            inventory.get("visibilityScope"),
            capability_service.ACTOR_SCOPED_VISIBILITY,
        )
        self.assertEqual(
            inventory.get("productMode"),
            capability_service.OBO_AVAILABLE_MODE,
        )

    def test_inventory_read_falls_back_to_workspace_scope_without_obo(self) -> None:
        caps = self._bootstrap_caps(per_user_authorization=False)
        inventory = caps.get("systemInventoryRead") or {}
        self.assertFalse(
            inventory.get("actorScoped"),
            "no OBO => systemInventoryRead must be workspace-scoped",
        )
        self.assertEqual(
            inventory.get("visibilityScope"),
            capability_service.WORKSPACE_APP_PRINCIPAL_VISIBILITY,
        )


if __name__ == "__main__":
    unittest.main()
