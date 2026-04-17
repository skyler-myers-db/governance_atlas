from __future__ import annotations

from typing import Any, Dict


MUTATION_ROLES = {"writer", "steward", "admin"}
APPROVAL_ROLES = {"steward", "admin"}
OBO_AVAILABLE_MODE = "obo-available"
APP_PRINCIPAL_ONLY_MODE = "app-principal-only"
NO_IDENTITY_MODE = "no-identity"
ACTOR_SCOPED_VISIBILITY = "actor-scoped"
WORKSPACE_APP_PRINCIPAL_VISIBILITY = "workspace-app-principal"
ANONYMOUS_APP_PRINCIPAL_VISIBILITY = "anonymous-app-principal"
CONTROL_PLANE_VISIBILITY = "forwarded-actor-control-plane"


def _normalize_role(value: str) -> str:
    return (value or "reader").strip().lower() or "reader"


def runtime_auth_mode(
    *,
    authenticated: bool,
    per_user_authorization: bool = False,
) -> str:
    if authenticated and per_user_authorization:
        return OBO_AVAILABLE_MODE
    if authenticated:
        return APP_PRINCIPAL_ONLY_MODE
    return NO_IDENTITY_MODE


def runtime_visibility_scope(mode: str) -> str:
    normalized = str(mode or "").strip().lower()
    if normalized == OBO_AVAILABLE_MODE:
        return ACTOR_SCOPED_VISIBILITY
    if normalized == APP_PRINCIPAL_ONLY_MODE:
        return WORKSPACE_APP_PRINCIPAL_VISIBILITY
    return ANONYMOUS_APP_PRINCIPAL_VISIBILITY


def _flag(
    *,
    available: bool,
    state: str,
    reason: str = "",
    actor_scoped: bool = True,
    workspace_scoped: bool = True,
    visibility_scope: str = "",
    source: str = "",
    protected_read: bool = False,
    product_mode: str = "",
) -> Dict[str, Any]:
    return {
        "available": bool(available),
        "state": state,
        "reason": reason,
        "actorScoped": bool(actor_scoped),
        "workspaceScoped": bool(workspace_scoped),
        "visibilityScope": str(visibility_scope or "").strip(),
        "source": str(source or "").strip(),
        "protectedRead": bool(protected_read),
        "productMode": str(product_mode or "").strip(),
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
    per_user_authorization: bool = False,
    claim_actor_scoped_reads: bool = False,
) -> Dict[str, Dict[str, Any]]:
    role = _normalize_role(actor_role)
    auth_mode = runtime_auth_mode(
        authenticated=authenticated, per_user_authorization=per_user_authorization
    )
    # Reads and writes can be scoped independently: in OBO mode, writes execute under
    # the forwarded user token while reads can remain on the app principal when the
    # catalog view is intentionally workspace-wide. Callers flip
    # ``claim_actor_scoped_reads`` only when the read path itself uses the forwarded
    # token, so the capability payload cannot overclaim actor scoping.
    actor_scoped_reads = bool(
        claim_actor_scoped_reads and auth_mode == OBO_AVAILABLE_MODE
    )
    read_visibility_scope = (
        runtime_visibility_scope(auth_mode)
        if actor_scoped_reads
        else runtime_visibility_scope(
            APP_PRINCIPAL_ONLY_MODE if authenticated else NO_IDENTITY_MODE
        )
    )
    runtime_live = runtime_state == "live"
    store_live = store_state == "live"
    mutation_allowed = (
        authenticated and runtime_live and store_live and role in MUTATION_ROLES
    )
    approval_allowed = (
        authenticated and runtime_live and store_live and role in APPROVAL_ROLES
    )
    metadata_source = (
        "unity-catalog-actor" if actor_scoped_reads else "unity-catalog-app-principal"
    )

    if not runtime_live:
        unavailable_reason = (
            runtime_message or "The live metadata runtime is unavailable."
        )
        inventory = _flag(
            available=False,
            state="unavailable",
            reason=unavailable_reason,
            actor_scoped=actor_scoped_reads,
            workspace_scoped=not actor_scoped_reads,
            visibility_scope=read_visibility_scope,
            source=metadata_source,
            product_mode=auth_mode,
        )
        table_lineage = _flag(
            available=False,
            state="unavailable",
            reason=unavailable_reason,
            actor_scoped=actor_scoped_reads,
            workspace_scoped=not actor_scoped_reads,
            visibility_scope=read_visibility_scope,
            source=metadata_source,
            product_mode=auth_mode,
        )
        column_lineage = _flag(
            available=False,
            state="unavailable",
            reason=unavailable_reason,
            actor_scoped=actor_scoped_reads,
            workspace_scoped=not actor_scoped_reads,
            visibility_scope=read_visibility_scope,
            source=metadata_source,
            protected_read=True,
            product_mode=auth_mode,
        )
        workload_visibility = _flag(
            available=False,
            state="unavailable",
            reason=unavailable_reason,
            actor_scoped=actor_scoped_reads,
            workspace_scoped=not actor_scoped_reads,
            visibility_scope=read_visibility_scope,
            source=metadata_source,
            protected_read=True,
            product_mode=auth_mode,
        )
    else:
        if int(visible_asset_count or 0) > 0:
            inventory = _flag(
                available=True,
                state="available",
                actor_scoped=actor_scoped_reads,
                workspace_scoped=not actor_scoped_reads,
                visibility_scope=read_visibility_scope,
                source=metadata_source,
                product_mode=auth_mode,
            )
        else:
            degraded_reason = boot_message or (
                f"The runtime is live, but no visible assets were returned yet across "
                f"{int(available_catalog_count or 0)} catalog(s)."
            )
            inventory = _flag(
                available=True,
                state="degraded",
                reason=degraded_reason,
                actor_scoped=actor_scoped_reads,
                workspace_scoped=not actor_scoped_reads,
                visibility_scope=read_visibility_scope,
                source=metadata_source,
                product_mode=auth_mode,
            )

        # Lineage reads query `system.access.table_lineage` / `system.access.column_lineage`.
        # Those reads execute through the same UC SQL client used for inventory, so they are
        # available whenever the runtime is live and the SP can observe lineage catalogs.
        # OBO (per-user authorization) narrows lineage to actor-scoped visibility, but its
        # absence does not render the lineage surface unavailable.
        lineage_workspace_note = (
            ""
            if actor_scoped_reads
            else (
                "Lineage is scoped to the workspace app-principal until per-user "
                "authorization / OBO is enabled."
            )
        )
        if int(observed_catalog_count or 0) > 0:
            table_lineage = _flag(
                available=True,
                state="available",
                reason=lineage_workspace_note,
                actor_scoped=actor_scoped_reads,
                workspace_scoped=not actor_scoped_reads,
                visibility_scope=read_visibility_scope,
                source=metadata_source,
                protected_read=True,
                product_mode=auth_mode,
            )
            column_lineage = _flag(
                available=True,
                state="available",
                reason=lineage_workspace_note,
                actor_scoped=actor_scoped_reads,
                workspace_scoped=not actor_scoped_reads,
                visibility_scope=read_visibility_scope,
                source=metadata_source,
                protected_read=True,
                product_mode=auth_mode,
            )
        else:
            table_lineage = _flag(
                available=True,
                state="unknown",
                reason=(
                    "No lineage-observed catalogs are detected yet; lineage surfaces will hydrate "
                    "once system lineage tables report activity for the visible catalogs."
                ),
                actor_scoped=actor_scoped_reads,
                workspace_scoped=not actor_scoped_reads,
                visibility_scope=read_visibility_scope,
                source=metadata_source,
                protected_read=True,
                product_mode=auth_mode,
            )
            column_lineage = _flag(
                available=True,
                state="unknown",
                reason=(
                    "Column lineage uses the same system lineage plane and still requires per-asset verification."
                ),
                actor_scoped=actor_scoped_reads,
                workspace_scoped=not actor_scoped_reads,
                visibility_scope=read_visibility_scope,
                source=metadata_source,
                protected_read=True,
                product_mode=auth_mode,
            )

        workload_visibility = _flag(
            available=False,
            state="unknown",
            reason=(
                "Operational query and workload visibility is preview/admin-governed and must be rechecked per request."
            ),
            actor_scoped=actor_scoped_reads,
            workspace_scoped=not actor_scoped_reads,
            visibility_scope=read_visibility_scope,
            source=metadata_source,
            protected_read=True,
            product_mode=auth_mode,
        )

    if not runtime_live:
        governance_write = _flag(
            available=False,
            state="unavailable",
            reason=runtime_message or "The live metadata runtime is unavailable.",
            actor_scoped=authenticated,
            workspace_scoped=False,
            visibility_scope=CONTROL_PLANE_VISIBILITY if authenticated else "",
            source="governance-control-plane",
            product_mode=auth_mode,
        )
        governance_approval = _flag(
            available=False,
            state="unavailable",
            reason=runtime_message or "The live metadata runtime is unavailable.",
            actor_scoped=authenticated,
            workspace_scoped=False,
            visibility_scope=CONTROL_PLANE_VISIBILITY if authenticated else "",
            source="governance-control-plane",
            product_mode=auth_mode,
        )
    elif not store_live:
        degraded_reason = store_message or "The governance control plane is degraded."
        governance_write = _flag(
            available=False,
            state="degraded",
            reason=degraded_reason,
            actor_scoped=authenticated,
            workspace_scoped=False,
            visibility_scope=CONTROL_PLANE_VISIBILITY if authenticated else "",
            source="governance-control-plane",
            product_mode=auth_mode,
        )
        governance_approval = _flag(
            available=False,
            state="degraded",
            reason=degraded_reason,
            actor_scoped=authenticated,
            workspace_scoped=False,
            visibility_scope=CONTROL_PLANE_VISIBILITY if authenticated else "",
            source="governance-control-plane",
            product_mode=auth_mode,
        )
    elif not authenticated:
        auth_reason = (
            "A forwarded Databricks user identity is required for governance mutations."
        )
        governance_write = _flag(
            available=False,
            state="unavailable",
            reason=auth_reason,
            actor_scoped=False,
            workspace_scoped=False,
            source="governance-control-plane",
            product_mode=auth_mode,
        )
        governance_approval = _flag(
            available=False,
            state="unavailable",
            reason=auth_reason,
            actor_scoped=False,
            workspace_scoped=False,
            source="governance-control-plane",
            product_mode=auth_mode,
        )
    else:
        governance_write = (
            _flag(
                available=True,
                state="available",
                actor_scoped=True,
                workspace_scoped=False,
                visibility_scope=CONTROL_PLANE_VISIBILITY,
                source="governance-control-plane",
                product_mode=auth_mode,
            )
            if mutation_allowed
            else _flag(
                available=False,
                state="unavailable",
                reason="This action requires writer, steward, or admin permissions.",
                actor_scoped=True,
                workspace_scoped=False,
                visibility_scope=CONTROL_PLANE_VISIBILITY,
                source="governance-control-plane",
                product_mode=auth_mode,
            )
        )
        governance_approval = (
            _flag(
                available=True,
                state="available",
                actor_scoped=True,
                workspace_scoped=False,
                visibility_scope=CONTROL_PLANE_VISIBILITY,
                source="governance-control-plane",
                product_mode=auth_mode,
            )
            if approval_allowed
            else _flag(
                available=False,
                state="unavailable",
                reason="This action requires steward or admin permissions.",
                actor_scoped=True,
                workspace_scoped=False,
                visibility_scope=CONTROL_PLANE_VISIBILITY,
                source="governance-control-plane",
                product_mode=auth_mode,
            )
        )

    if runtime_live and store_live:
        quality_run = _flag(
            available=False,
            state="unavailable",
            reason="Persisted quality run execution is not implemented in the live runtime yet.",
            actor_scoped=True,
            workspace_scoped=False,
            visibility_scope=ACTOR_SCOPED_VISIBILITY,
            source="quality-control-plane",
            protected_read=True,
            product_mode=auth_mode,
        )
        export_allowed = _flag(
            available=False,
            state="unavailable",
            reason="Authenticated export endpoints are not implemented in the live runtime yet.",
            actor_scoped=actor_scoped_reads,
            workspace_scoped=not actor_scoped_reads,
            visibility_scope=read_visibility_scope,
            source=metadata_source,
            protected_read=True,
            product_mode=auth_mode,
        )
        manual_lineage_overrides = _flag(
            available=False,
            state="unavailable",
            reason="Governed lineage overrides are not implemented in the live runtime yet.",
            actor_scoped=True,
            workspace_scoped=False,
            visibility_scope=CONTROL_PLANE_VISIBILITY if authenticated else "",
            source="governance-control-plane",
            product_mode=auth_mode,
        )
    else:
        base_reason = (
            runtime_message
            or store_message
            or "The required runtime capability is unavailable."
        )
        quality_run = _flag(
            available=False,
            state="unavailable",
            reason=base_reason,
            actor_scoped=True,
            workspace_scoped=False,
            visibility_scope=ACTOR_SCOPED_VISIBILITY if authenticated else "",
            source="quality-control-plane",
            protected_read=True,
            product_mode=auth_mode,
        )
        export_allowed = _flag(
            available=False,
            state="unavailable",
            reason=base_reason,
            actor_scoped=actor_scoped_reads,
            workspace_scoped=not actor_scoped_reads,
            visibility_scope=read_visibility_scope,
            source=metadata_source,
            protected_read=True,
            product_mode=auth_mode,
        )
        manual_lineage_overrides = _flag(
            available=False,
            state="unavailable",
            reason=base_reason,
            actor_scoped=authenticated,
            workspace_scoped=False,
            visibility_scope=CONTROL_PLANE_VISIBILITY if authenticated else "",
            source="governance-control-plane",
            product_mode=auth_mode,
        )

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
