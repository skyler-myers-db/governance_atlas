import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceDiagnosticsSurface from "./WorkspaceDiagnosticsSurface";

vi.mock("../lib/api", () => ({
  getRuntimeDiagnostics: () => ({
    initialNavigation: {
      durationMs: 210,
    },
    lastRequest: {
      httpRequestId: "req-321",
      clientDurationMs: 34.2,
    },
  }),
}));

describe("WorkspaceDiagnosticsSurface", () => {
  it("renders readiness sequence, evidence, and rollout metadata", () => {
    const onRefresh = vi.fn();
    render(
      <WorkspaceDiagnosticsSurface
        onRefresh={onRefresh}
        refreshing={false}
        status={{
          runtime: {
            state: "live",
            message: "",
          },
          store: {
            state: "degraded",
            message: "The governance store is degraded.",
          },
          capabilities: {
            systemInventoryRead: {
              state: "available",
              reason: "Inventory reads are available.",
            },
          },
          config: {
            warehouseId: "warehouse-1",
            govCatalog: "main",
            govSchema: "gov",
          },
          identity: {
            actorEmail: "admin@example.com",
            actorRole: "Admin",
            source: "x-forwarded-email",
          },
          diagnostics: {
            observedAt: "2026-04-14T22:00:00Z",
            diagnosticsEnabled: true,
            workspaceAccess: {
              mode: "forwarded-user-header",
              canWriteGovernance: true,
              canUseLineage: false,
              canUseQueryHistory: false,
              canExport: false,
              canRunBackgroundWork: false,
              canUseClassificationRecommendations: false,
              blockedSurfaces: [
                "Lineage graph",
                "Queries tab",
                "Discovery export",
              ],
              gates: [
                {
                  key: "governance_write_access",
                  label: "Governance writes",
                  state: "available",
                  reason: "The current actor can perform governed writes.",
                  proofSource: "governance config + store probe + app-principal check + forwarded user identity",
                  blockedSurfaces: [],
                },
                {
                  key: "lineage_access",
                  label: "Lineage access",
                  state: "unavailable",
                  reason: "Unity Catalog lineage is not available in this workspace.",
                  proofSource: "Unity Catalog lineage probe",
                  remediation: "Verify Unity Catalog lineage permissions and rerun the runtime probe.",
                  blockedSurfaces: ["Lineage graph", "Lineage preview", "Lineage drawer"],
                },
              ],
            },
            setupReadiness: {
              state: "attention_required",
              nextStep: "per_user_authorization",
              claimNarrowing: [
                {
                  key: "workload_visibility",
                  surface: "Queries, usage, and workloads",
                  state: "unavailable",
                  reason: "Operational query and workload visibility is not available for the current actor.",
                  effect: "Operational tabs stay hidden or explicitly unavailable instead of showing empty history.",
                },
              ],
            },
            setupSequence: [
              {
                key: "environment_config",
                label: "Environment configuration",
                state: "available",
                summary: "Required deployment settings are present.",
                detail: "This step can be re-run safely because it only inspects injected config.",
                evidence: "warehouse=warehouse-1, catalog=main, schema=gov",
                observedAt: "2026-04-14T22:00:00Z",
                staleAfter: "2026-04-14T22:01:00Z",
              },
            ],
            auth: {
              mode: "forwarded-user-header",
              perUserAuthorization: {
                state: "unavailable",
                reason: "OBO is not implemented yet.",
              },
            },
            setupSummary: {
              availableCount: 5,
              degradedCount: 1,
              unavailableCount: 2,
              unknownCount: 0,
            },
            setupChecks: [
              {
                key: "per_user_authorization",
                label: "Per-user authorization",
                state: "unavailable",
                summary: "Per-user Databricks authorization / OBO is not implemented in the live runtime yet.",
                detail: "Actor-scoped reads remain conservative and capability-gated until a per-user enforcement plane is added.",
                evidence: "The current runtime authenticates with forwarded identity headers only.",
                remediation: "Add and verify Databricks Apps per-user authorization before enabling actor-scoped protected reads.",
                observedAt: "2026-04-14T22:00:00Z",
                staleAfter: "2026-04-14T22:01:00Z",
              },
            ],
            featureFlags: [
              {
                key: "query_history_surface",
                label: "Query history",
                state: "available",
                enabled: true,
                owner: "phase-10-entity",
                kind: "surface",
                rationale: "Enable query-backed operational views where safe.",
                rollout: "workspace-capability-gated",
                scope: "queries, usage, workloads",
              },
              {
                key: "workspace_setup_diagnostics",
                label: "Workspace setup diagnostics",
                state: "available",
                enabled: true,
                owner: "phase-5-foundation",
                kind: "surface",
                rationale: "Expose operator-only setup truth in the shell.",
                rollout: "global",
                rolloutPolicy: "Always available to operators while diagnostics are enabled.",
                truthSource: "runtime configuration",
                defaultState: "enabled",
                scope: "shell diagnostics + bootstrap-unavailable fallback",
                expiresAfter: "Before a dedicated admin diagnostics surface replaces the shell-owned setup view.",
                removalTicket: "phase-5-admin-diagnostics-route",
                rollback: "Hide the diagnostics surface while preserving /api/runtime/status for operator probes.",
              },
            ],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh readiness" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Workspace access")).not.toBeNull();
    expect(screen.getByText("Feature inventory")).not.toBeNull();
    expect(screen.getAllByText("Governance writes").length).toBeGreaterThan(0);
    expect(screen.getByText("Lineage access")).not.toBeNull();
    expect(screen.getAllByText(/Proof source:/).length).toBeGreaterThan(0);
    expect(screen.getByText("Lineage drawer")).not.toBeNull();
    expect(screen.getByText("Readiness sequence")).not.toBeNull();
    expect(screen.getByText("Claim discipline")).not.toBeNull();
    expect(screen.getByText("Queries, usage, and workloads")).not.toBeNull();
    expect(screen.getByText("Per-user authorization")).not.toBeNull();
    expect(screen.getAllByText(/Evidence:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rationale:/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Add and verify Databricks Apps per-user authorization before enabling actor-scoped protected reads.",
      ),
    ).not.toBeNull();
    expect(screen.getAllByText("phase-5-admin-diagnostics-route").length).toBeGreaterThan(0);
    expect(screen.getByText("req-321")).not.toBeNull();
  });

  it("keeps rollout controls unknown when the named diagnostics flag is missing", () => {
    render(
      <WorkspaceDiagnosticsSurface
        status={{
          runtime: {
            state: "live",
            message: "",
          },
          store: {
            state: "live",
            message: "",
          },
          diagnostics: {
            observedAt: "2026-04-14T22:05:00Z",
            diagnosticsEnabled: true,
            setupSummary: {
              availableCount: 1,
              degradedCount: 0,
              unavailableCount: 0,
              unknownCount: 0,
            },
            setupChecks: [],
            featureFlags: [
              {
                key: "table_lineage_surface",
                label: "Table lineage surface",
                state: "available",
                enabled: true,
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("No workspace setup diagnostics rollout flag was returned.")).not.toBeNull();
    expect(screen.getByText("Feature inventory")).not.toBeNull();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });
});
