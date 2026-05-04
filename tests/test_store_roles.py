from __future__ import annotations

import pytest

from atlas.store import GovernanceStore


class _QueryForbiddenUc:
    def query_df(self, *_args, **_kwargs):
        raise AssertionError("configured admins should not require a role-table query")


def test_configured_admin_role_does_not_block_on_role_table_query() -> None:
    store = GovernanceStore(
        uc=_QueryForbiddenUc(),
        catalog="main",
        schema="atlas",
    )

    assert store.get_role("skyler@entrada.ai", admin_emails=["skyler@entrada.ai"]) == "admin"


def test_reader_role_uses_role_table_when_not_configured_admin() -> None:
    store = GovernanceStore(
        uc=_QueryForbiddenUc(),
        catalog="main",
        schema="atlas",
    )

    with pytest.raises(AssertionError):
        store.get_role("reader@entrada.ai", admin_emails=["skyler@entrada.ai"])
