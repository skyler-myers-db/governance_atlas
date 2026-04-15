from __future__ import annotations

from typing import Any, Dict


MUTATION_ROLES = {"writer", "steward", "admin"}
APPROVAL_ROLES = {"steward", "admin"}


def _normalize_role(value: str) -> str:
    return (value or "reader").strip().lower() or "reader"


def _flag(
    *,
    available: bool,
    state: str,
    reason: str = "",
    actor_scoped: bool = True,
    workspace_scoped: bool = True,
) -> Dict[str, Any]:
    return {
        "available": bool(available),
        "state": state,
        "reason": reason,
        "actorScoped": bool(actor_scoped),
        "workspaceScoped": bool(workspace_scoped),
    }


def bootstrap_capabilities(
    *,
    actor_role: str,
    authenticated: bool,
    runtime_state: str,
    runtime_message: str = "",
    store_state: str = "",
    store_message: str = "",
    visible_asset_count: int = 0,
    available_catalog_count: int = 0,
    observed_catalog_count: int = 0,
    boot_message: str = "",
) -> Dict[str, Dict[str, Any]]:
    role = _normalize_role(actor_role)
    runtime_live = runtime_state == "live"
    store_live = store_state == "live"
    mutation_allowed = authenticated and runtime_live and store_live and role in MUTATION_ROLES
    approval_allowed = authenticated and runtime_live and store_live and role in APPROVAL_ROLES

    if not runtime_live:
        unavailable_reason = runtime_message or "The live metadata runtime is unavailable."
        inventory = _flag(available=False, state="unavailable", reason=unavailable_reason)
        table_lineage = _flag(available=False, state="unavailable", reason=unavailable_reason)
        column_lineage = _flag(available=False, state="unavailable", reason=unavailable_reason)
        workload_visibility = _flag(available=False, state="unavailable", reason=unavailable_reason)
    else:
        if int(visible_asset_count or 0) > 0:
            inventory = _flag(available=True, state="available")
        else:
            degraded_reason = (
                boot_message
                or (
                    f"The runtime is live, but no visible assets were returned yet across "
                    f"{int(available_catalog_count or 0)} catalog(s)."
                )
            )
            inventory = _flag(available=True, state="degraded", reason=degraded_reason)

        if int(observed_catalog_count or 0) > 0:
            table_lineage = _flag(available=True, state="available")
            column_lineage = _flag(available=True, state="available")
        else:
            table_lineage = _flag(
                available=True,
                state="unknown",
                reason=(
                    "No lineage-observed catalogs are detected yet; keep lineage surfaces capability-gated "
                    "and handle masked or empty results truthfully."
                ),
            )
            column_lineage = _flag(
                available=True,
                state="unknown",
                reason=(
                    "Column lineage uses the same system lineage plane and still requires per-asset verification."
                ),
            )

        workload_visibility = _flag(
            available=False,
            state="unknown",
            reason=(
                "Operational query and workload visibility is preview/admin-governed and must be rechecked per request."
            ),
        )

    if not runtime_live:
        governance_write = _flag(
            available=False,
            state="unavailable",
            reason=runtime_message or "The live metadata runtime is unavailable.",
        )
        governance_approval = _flag(
            available=False,
            state="unavailable",
            reason=runtime_message or "The live metadata runtime is unavailable.",
        )
    elif not store_live:
        degraded_reason = store_message or "The governance control plane is degraded."
        governance_write = _flag(available=False, state="degraded", reason=degraded_reason)
        governance_approval = _flag(available=False, state="degraded", reason=degraded_reason)
    elif not authenticated:
        auth_reason = "A forwarded Databricks user identity is required for governance mutations."
        governance_write = _flag(available=False, state="unavailable", reason=auth_reason)
        governance_approval = _flag(available=False, state="unavailable", reason=auth_reason)
    else:
        governance_write = (
            _flag(available=True, state="available")
            if mutation_allowed
            else _flag(
                available=False,
                state="unavailable",
                reason="This action requires writer, steward, or admin permissions.",
            )
        )
        governance_approval = (
            _flag(available=True, state="available")
            if approval_allowed
            else _flag(
                available=False,
                state="unavailable",
                reason="This action requires steward or admin permissions.",
            )
        )

    if runtime_live and store_live:
        quality_run = _flag(
            available=False,
            state="unavailable",
            reason="Persisted quality run execution is not implemented in the live runtime yet.",
        )
        export_allowed = _flag(
            available=False,
            state="unavailable",
            reason="Authenticated export endpoints are not implemented in the live runtime yet.",
        )
        manual_lineage_overrides = _flag(
            available=False,
            state="unavailable",
            reason="Governed lineage overrides are not implemented in the live runtime yet.",
        )
    else:
        base_reason = runtime_message or store_message or "The required runtime capability is unavailable."
        quality_run = _flag(available=False, state="unavailable", reason=base_reason)
        export_allowed = _flag(available=False, state="unavailable", reason=base_reason)
        manual_lineage_overrides = _flag(available=False, state="unavailable", reason=base_reason)

    return {
        "governanceWrite": governance_write,
        "governanceApproval": governance_approval,
        "systemInventoryRead": inventory,
        "tableLineage": table_lineage,
        "columnLineage": column_lineage,
        "workloadVisibility": workload_visibility,
        "qualityRunEligibility": quality_run,
        "exportAllowed": export_allowed,
        "manualLineageOverrides": manual_lineage_overrides,
    }
