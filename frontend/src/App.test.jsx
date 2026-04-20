import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appFrameMock = vi.fn();
const useAppRouteStateMock = vi.fn();
const useBootstrapMock = vi.fn();
const useGovernanceSummaryMock = vi.fn();
const useRuntimeStatusMock = vi.fn();
const updateGovernanceNotificationMock = vi.fn();
const discoveryWorkspaceMock = vi.fn(() => <div data-testid="discovery-workspace" />);
const entityWorkspaceMock = vi.fn(() => <div data-testid="entity-workspace" />);
const lineageWorkspaceMock = vi.fn(() => <div data-testid="lineage-workspace" />);
const governanceWorkspaceMock = vi.fn(() => <div data-testid="governance-workspace" />);
const workspaceSetupWizardMock = vi.fn(() => <div data-testid="workspace-setup-wizard" />);

vi.mock("./hooks/useAppRouteState", () => ({
  useAppRouteState: (...args) => useAppRouteStateMock(...args),
}));

vi.mock("./hooks/useBootstrap", () => ({
  useBootstrap: (...args) => useBootstrapMock(...args),
}));

vi.mock("./hooks/useGovernanceSummary", () => ({
  useGovernanceSummary: (...args) => useGovernanceSummaryMock(...args),
}));

vi.mock("./hooks/useRuntimeStatus", () => ({
  useRuntimeStatus: (...args) => useRuntimeStatusMock(...args),
}));

vi.mock("./components/AppFrame", () => ({
  default: (props) => {
    appFrameMock(props);
    return (
      <div data-testid="app-frame">
        {props.governanceInbox ? (
          <div data-testid="inbox-shell">
            <span data-testid="inbox-count">{String(props.governanceInbox.unreadCount || 0)}</span>
            <button onClick={props.onToggleInbox} type="button">
              Toggle inbox
            </button>
            {props.inboxOpen ? <div data-testid="inbox-open">open</div> : null}
            {props.governanceInbox.items?.length ? (
              <button
                onClick={() => props.onInboxItemAction(props.governanceInbox.items[0].notificationId, "read")}
                type="button"
              >
                Mark first inbox item read
              </button>
            ) : null}
          </div>
        ) : null}
        {props.diagnosticsAvailable ? (
          <button onClick={props.onToggleDiagnostics} type="button">
            Toggle workspace setup
          </button>
        ) : null}
        {props.children}
      </div>
    );
  },
}));

vi.mock("./components/DiscoveryWorkspace", () => ({
  default: (...args) => discoveryWorkspaceMock(...args),
}));

vi.mock("./components/EntityWorkspace", () => ({
  default: (...args) => entityWorkspaceMock(...args),
}));

vi.mock("./components/LineageWorkspace", () => ({
  default: (...args) => lineageWorkspaceMock(...args),
}));

vi.mock("./components/GovernanceWorkspace", () => ({
  default: (...args) => governanceWorkspaceMock(...args),
}));

vi.mock("./components/WorkspaceSetupWizard", () => ({
  default: (...args) => workspaceSetupWizardMock(...args),
}));

vi.mock("./lib/api", () => ({
  normalizeGovernancePayload: (payload) => payload,
  updateGovernanceNotification: (...args) => updateGovernanceNotificationMock(...args),
  getRuntimeDiagnostics: () => ({
    initialNavigation: {
      durationMs: 123,
    },
    lastRequest: {
      httpRequestId: "req-boot",
      clientDurationMs: 18.5,
    },
  }),
}));

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    useAppRouteStateMock.mockReset();
    useBootstrapMock.mockReset();
    useGovernanceSummaryMock.mockReset();
    useRuntimeStatusMock.mockReset();
    updateGovernanceNotificationMock.mockReset();
    appFrameMock.mockReset();
    discoveryWorkspaceMock.mockClear();
    entityWorkspaceMock.mockClear();
    lineageWorkspaceMock.mockClear();
    governanceWorkspaceMock.mockClear();
    workspaceSetupWizardMock.mockClear();

    useAppRouteStateMock.mockReturnValue({
      surface: "discovery",
      setSurface: vi.fn(),
      routeAssetFqn: "",
      discoveryRouteState: {
        filterGroups: {
          types: [],
          catalogs: [],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        },
        query: "",
        previewAssetFqn: "",
        sortBy: "",
        views: [],
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRouteFilterGroups: vi.fn(),
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      setDiscoveryRouteViews: vi.fn(),
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    updateGovernanceNotificationMock.mockResolvedValue({
      governance: {
        inbox: {
          unreadCount: 0,
          items: [],
        },
      },
    });
    useGovernanceSummaryMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        metrics: [],
        backlog: [],
        glossary: [],
        inbox: null,
      },
      refresh: vi.fn(),
    });
  });

  it("shows a workspace-area loading shell during bootstrap without mounting workspaces", () => {
    useBootstrapMock.mockReturnValue({
      loading: true,
      error: "",
      refreshError: "",
      data: null,
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
      refresh: vi.fn(),
    });

    render(<App />);

    expect(screen.getByText("Preparing the workspace surface.")).not.toBeNull();
    expect(
      screen.getByText(
        "Confirming route handoff, identity headers, and shell capabilities before live surface hydration.",
      ),
    ).not.toBeNull();
    expect(discoveryWorkspaceMock).not.toHaveBeenCalled();
    expect(entityWorkspaceMock).not.toHaveBeenCalled();
    expect(lineageWorkspaceMock).not.toHaveBeenCalled();
    expect(governanceWorkspaceMock).not.toHaveBeenCalled();
  });

  it("shows setup diagnostics on bootstrap failure for operator roles without mounting heavy workspaces", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "Bootstrap payload was unavailable.",
      refreshError: "",
      data: null,
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "unavailable",
          message: "Warehouse is down.",
        },
        store: {
          state: "unknown",
          message: "Store probe skipped.",
        },
        capabilities: {},
        config: {
          warehouseId: "",
          govCatalog: "",
          govSchema: "",
        },
        identity: {
          actorEmail: "admin@example.com",
          actorRole: "Admin",
          source: "x-forwarded-email",
        },
        diagnostics: {
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          auth: {
            mode: "read-only-no-identity",
            perUserAuthorization: {
              state: "unavailable",
              reason: "OBO is not implemented.",
            },
          },
          setupSummary: {
            availableCount: 0,
            degradedCount: 1,
            unavailableCount: 4,
            unknownCount: 1,
          },
          setupChecks: [],
          featureFlags: [
            {
              key: "workspace_setup_diagnostics",
              enabled: true,
              state: "available",
            },
          ],
        },
      },
    });

    render(<App />);

    expect(useRuntimeStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
      }),
    );
    expect(screen.getByText("Workspace Unavailable")).not.toBeNull();
    expect(screen.getByText("Setup Diagnostics")).not.toBeNull();
    expect(screen.getByText("Warehouse runtime")).not.toBeNull();
    expect(useRuntimeStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
      }),
    );
    expect(discoveryWorkspaceMock).not.toHaveBeenCalled();
    expect(entityWorkspaceMock).not.toHaveBeenCalled();
    expect(lineageWorkspaceMock).not.toHaveBeenCalled();
    expect(governanceWorkspaceMock).not.toHaveBeenCalled();
  });

  it("keeps bootstrap-failure recovery available for operators when rollout inventory is missing", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "Bootstrap payload was unavailable.",
      refreshError: "",
      data: null,
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "unavailable",
          message: "Warehouse is down.",
        },
        store: {
          state: "unknown",
          message: "Store probe skipped.",
        },
        capabilities: {},
        config: {
          warehouseId: "",
          govCatalog: "",
          govSchema: "",
        },
        identity: {
          actorEmail: "admin@example.com",
          actorRole: "Admin",
          source: "x-forwarded-email",
        },
        diagnostics: {
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          auth: {
            mode: "read-only-no-identity",
            perUserAuthorization: {
              state: "unavailable",
              reason: "OBO is not implemented.",
            },
          },
          setupSummary: {
            availableCount: 0,
            degradedCount: 1,
            unavailableCount: 4,
            unknownCount: 1,
          },
          setupChecks: [],
          featureFlags: [
            {
              key: "table_lineage_surface",
              enabled: true,
              state: "available",
            },
          ],
        },
      },
    });

    render(<App />);

    expect(screen.getByText("Workspace Unavailable")).not.toBeNull();
    expect(screen.getByText("Setup Diagnostics")).not.toBeNull();
    expect(screen.getByText("Warehouse runtime")).not.toBeNull();
    expect(discoveryWorkspaceMock).not.toHaveBeenCalled();
    expect(entityWorkspaceMock).not.toHaveBeenCalled();
    expect(lineageWorkspaceMock).not.toHaveBeenCalled();
    expect(governanceWorkspaceMock).not.toHaveBeenCalled();
  });

  it("keeps setup diagnostics hidden on bootstrap failure for non-operator roles", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "Bootstrap payload was unavailable.",
      refreshError: "",
      data: null,
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "unavailable",
          message: "Warehouse is down.",
        },
        store: {
          state: "unknown",
          message: "Store probe skipped.",
        },
        capabilities: {},
        config: {
          warehouseId: "",
          govCatalog: "",
          govSchema: "",
        },
        identity: {
          actorEmail: "reader@example.com",
          actorRole: "Reader",
          source: "x-forwarded-email",
        },
        diagnostics: {
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          auth: {
            mode: "read-only-no-identity",
            perUserAuthorization: {
              state: "unavailable",
              reason: "OBO is not implemented.",
            },
          },
          setupSummary: {
            availableCount: 0,
            degradedCount: 1,
            unavailableCount: 4,
            unknownCount: 1,
          },
          setupChecks: [],
          featureFlags: [
            {
              key: "workspace_setup_diagnostics",
              enabled: true,
              state: "available",
            },
          ],
        },
      },
    });

    render(<App />);

    expect(screen.getByText("Workspace Unavailable")).not.toBeNull();
    expect(screen.queryByText("Setup Diagnostics")).toBeNull();
    expect(screen.queryByText("Warehouse runtime")).toBeNull();
    expect(discoveryWorkspaceMock).not.toHaveBeenCalled();
    expect(entityWorkspaceMock).not.toHaveBeenCalled();
    expect(lineageWorkspaceMock).not.toHaveBeenCalled();
    expect(governanceWorkspaceMock).not.toHaveBeenCalled();
  });

  it("passes shell diagnostics availability through AppFrame only for operator roles", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        diagnostics: {
          featureFlags: [
            {
              key: "workspace_setup_diagnostics",
              enabled: true,
              state: "available",
            },
          ],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.diagnosticsAvailable).toBe(true);
  });

  it("promotes the shell role from runtime identity once diagnostics resolve", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Reader",
          roleProvisional: true,
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        identity: {
          actorEmail: "admin@example.com",
          actorRole: "Admin",
          actorRoleProvisional: false,
          source: "x-forwarded-email",
        },
        diagnostics: {
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          setupChecks: [],
          featureFlags: [
            {
              key: "workspace_setup_diagnostics",
              enabled: true,
              state: "available",
            },
          ],
        },
      },
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.diagnosticsAvailable).toBe(true);
    expect(appFrameProps?.shell).toEqual(
      expect.objectContaining({
        role: "Admin",
        roleProvisional: false,
        userEmail: "admin@example.com",
      }),
    );
  });

  it("passes setup readiness into AppFrame and runtime feature flags into DiscoveryWorkspace", async () => {
    const runtimeFeatureFlags = [
      {
        key: "workspace_setup_diagnostics",
        enabled: true,
        state: "available",
      },
      {
        key: "table_lineage_surface",
        enabled: true,
        state: "available",
      },
    ];
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        capabilities: {},
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
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          auth: {
            mode: "forwarded-user-header",
            perUserAuthorization: {
              state: "unavailable",
              reason: "OBO is not implemented.",
            },
          },
          setupReadiness: {
            state: "attention_required",
            nextStep: "per_user_authorization",
          },
          setupSummary: {
            availableCount: 5,
            degradedCount: 1,
            unavailableCount: 0,
            unknownCount: 0,
          },
          setupChecks: [],
          workspaceAccess: {
            canUseLineage: true,
            canUseQueryHistory: false,
            canExport: false,
            canRunBackgroundWork: false,
            canUseClassificationRecommendations: false,
            gates: [],
            blockedSurfaces: ["Queries, usage, and workloads"],
          },
          featureFlags: runtimeFeatureFlags,
        },
      },
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.diagnosticsStatus).toEqual({
      state: "attention_required",
      nextStep: "per_user_authorization",
    });
    await waitFor(() => {
      const discoveryProps = discoveryWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(discoveryProps?.runtimeFeatureFlags).toEqual(runtimeFeatureFlags);
      expect(discoveryProps?.workspaceAccess).toEqual(
        expect.objectContaining({
          canUseLineage: true,
          canUseQueryHistory: false,
        }),
      );
    });
  });

  it("passes discovery route query, sort, and saved view seeds into DiscoveryWorkspace", async () => {
    const setDiscoveryRouteFilterGroups = vi.fn();
    const setDiscoveryRoutePreview = vi.fn();
    const setDiscoveryRouteQuery = vi.fn();
    const setDiscoveryRouteSort = vi.fn();
    const setDiscoveryRouteViews = vi.fn();
    useAppRouteStateMock.mockReturnValue({
      surface: "discovery",
      setSurface: vi.fn(),
      routeAssetFqn: "",
      discoveryRouteState: {
        filterGroups: {
          types: ["Table"],
          catalogs: ["main"],
          domains: ["Finance"],
          tiers: [],
          certifications: [],
          sensitivities: [],
        },
        query: "finance",
        previewAssetFqn: "main.sales.returns",
        sortBy: "Recently updated",
        views: ["Needs review"],
        fresh: true,
        requestKey: "seed-sort",
      },
      setDiscoveryRouteFilterGroups,
      setDiscoveryRoutePreview,
      setDiscoveryRouteQuery,
      setDiscoveryRouteSort,
      setDiscoveryRouteViews,
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          sortOptions: ["Best match", "Recently updated"],
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    render(<App />);

    await waitFor(() => {
      const discoveryProps = discoveryWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(discoveryProps?.initialFilterGroups).toEqual({
        types: ["Table"],
        catalogs: ["main"],
        domains: ["Finance"],
        tiers: [],
        certifications: [],
        sensitivities: [],
      });
      expect(discoveryProps?.initialQuery).toBe("finance");
      expect(discoveryProps?.initialSelectedAssetFqn).toBe("main.sales.returns");
      expect(discoveryProps?.initialSort).toBe("Recently updated");
      expect(discoveryProps?.initialViews).toEqual(["Needs review"]);
      expect(discoveryProps?.querySeedFresh).toBe(true);
      expect(discoveryProps?.querySeedKey).toBe("seed-sort");
      expect(discoveryProps?.onRouteFilterGroupsChange).toBe(setDiscoveryRouteFilterGroups);
      expect(discoveryProps?.onRoutePreviewChange).toBe(setDiscoveryRoutePreview);
      expect(discoveryProps?.onRouteQueryChange).toBe(setDiscoveryRouteQuery);
      expect(discoveryProps?.onRouteSortChange).toBe(setDiscoveryRouteSort);
      expect(discoveryProps?.onRouteViewsChange).toBe(setDiscoveryRouteViews);
    });
  });

  it("passes a blank route sort into DiscoveryWorkspace without synthesizing a seeded sort", async () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          sortOptions: ["Best match", "Recently updated"],
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    render(<App />);

    await waitFor(() => {
      const discoveryProps = discoveryWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(discoveryProps?.initialFilterGroups).toEqual({
        types: [],
        catalogs: [],
        domains: [],
        tiers: [],
        certifications: [],
        sensitivities: [],
      });
      expect(discoveryProps?.initialSort).toBe("");
      expect(discoveryProps?.initialViews).toEqual([]);
      expect(discoveryProps?.querySeedKey).toBe("seed");
      expect(discoveryProps?.querySeedFresh).toBe(false);
    });
  });

  it("uses a fresh discovery open when the shell browse action is triggered", async () => {
    const openDiscoveryWorkspace = vi.fn();
    useAppRouteStateMock.mockReturnValue({
      surface: "entity",
      setSurface: vi.fn(),
      routeAssetFqn: "main.sales.orders",
      discoveryRouteState: {
        filterGroups: {
          types: [],
          catalogs: [],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        },
        query: "finance",
        previewAssetFqn: "main.sales.returns",
        sortBy: "Recently updated",
        views: ["Needs review"],
        fresh: false,
        requestKey: "seed-browse",
      },
      setDiscoveryRouteFilterGroups: vi.fn(),
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      setDiscoveryRouteViews: vi.fn(),
      openDiscoveryWorkspace,
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          sortOptions: ["Best match", "Recently updated"],
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    appFrameProps?.onBrowseCatalog?.("customers");

    expect(openDiscoveryWorkspace).toHaveBeenCalledWith("customers", { fresh: true });
  });

  it("keeps bootstrap discovery visible totals out of the shell until live discovery truth arrives", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 17,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    const discoveryProps = discoveryWorkspaceMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.liveCatalogVisibleCount).toBeNull();
    expect(discoveryProps?.effectiveVisibleCount).toBeNull();
  });

  it("passes the additive governance inbox through AppFrame and updates unread state on shell actions", async () => {
    updateGovernanceNotificationMock.mockResolvedValueOnce({
      governance: {
        inbox: {
          state: "ready",
          message: "Notifications from workflow activity.",
          unreadCount: 1,
          items: [
            {
              notificationId: "notification-1",
              title: "Review requested",
              detail: "Ownership change needs approval.",
              assetFqn: "main.sales.orders",
              createdAt: "2026-04-14T22:00:00Z",
              createdBy: "admin@example.com",
              status: "open",
              inboxState: "read",
            },
            {
              notificationId: "notification-2",
              title: "Task acknowledged",
              detail: "A steward acknowledged the request.",
              assetFqn: "main.sales.customers",
              createdAt: "2026-04-14T22:05:00Z",
              createdBy: "writer@example.com",
              status: "open",
              inboxState: "new",
            },
          ],
        },
      },
    });
    useGovernanceSummaryMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        metrics: [],
        backlog: [],
        glossary: [],
        inbox: {
          state: "ready",
          message: "Notifications from workflow activity.",
          unreadCount: 2,
          items: [
            {
              notificationId: "notification-1",
              title: "Review requested",
              detail: "Ownership change needs approval.",
              assetFqn: "main.sales.orders",
              createdAt: "2026-04-14T22:00:00Z",
              createdBy: "admin@example.com",
              status: "open",
              inboxState: "new",
            },
            {
              notificationId: "notification-2",
              title: "Task acknowledged",
              detail: "A steward acknowledged the request.",
              assetFqn: "main.sales.customers",
              createdAt: "2026-04-14T22:05:00Z",
              createdBy: "writer@example.com",
              status: "open",
              inboxState: "new",
            },
          ],
        },
      },
      refresh: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    // Operator 2026-04-19 round 3 asked the header inbox icon to
    // *navigate* to /inbox instead of toggling a transient panel.
    // Wire a named onModuleChange mock so we can assert the route
    // change (was previously asserting the `inboxOpen` prop flipped,
    // which no longer happens).
    const moduleChange = vi.fn();
    useAppRouteStateMock.mockReturnValue({
      surface: "discovery",
      setSurface: vi.fn(),
      routeAssetFqn: "",
      discoveryRouteState: {
        filterGroups: { types: [], catalogs: [], domains: [], tiers: [], certifications: [], sensitivities: [] },
        query: "",
        previewAssetFqn: "",
        sortBy: "",
        views: [],
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRouteFilterGroups: vi.fn(),
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      setDiscoveryRouteViews: vi.fn(),
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: moduleChange,
    });

    render(<App />);

    expect(screen.getByTestId("inbox-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));
    expect(moduleChange).toHaveBeenCalledWith("inbox");

    fireEvent.click(screen.getByRole("button", { name: "Mark first inbox item read" }));
    await waitFor(() => {
      expect(updateGovernanceNotificationMock).toHaveBeenCalledWith("notification-1", { action: "read" });
    });
    expect(screen.getByTestId("inbox-count").textContent).toBe("1");

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.governanceInbox?.items?.[0]?.inboxState).toBe("read");
  });

  it("hydrates governance workspace state from the live governance summary instead of bootstrap", async () => {
    useAppRouteStateMock.mockReturnValue({
      surface: "governance",
      routeAssetFqn: "main.sales.orders",
      discoveryRouteState: {
        query: "",
        previewAssetFqn: "",
        sortBy: "",
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useGovernanceSummaryMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        metrics: [{ label: "Open requests", value: "3" }],
        backlog: [{ requestId: "req-1", title: "Review ownership", assetFqn: "main.sales.orders", asset: "orders", status: "open" }],
        glossary: [],
        inbox: {
          state: "ready",
          message: "Notifications from workflow activity.",
          unreadCount: 1,
          items: [],
        },
      },
      refresh: vi.fn(),
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    render(<App />);

    await waitFor(() => {
      const governanceProps = governanceWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(governanceProps?.governance?.backlog?.[0]?.requestId).toBe("req-1");
    });
    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.governanceInbox?.unreadCount).toBe(1);
  });

  it("degrades retained governance state when a live refresh fails", async () => {
    useAppRouteStateMock.mockReturnValue({
      surface: "governance",
      routeAssetFqn: "main.sales.orders",
      discoveryRouteState: {
        query: "",
        previewAssetFqn: "",
        sortBy: "",
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useGovernanceSummaryMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "Governance summary could not be refreshed.",
      data: {
        authoritative: true,
        provenance: {
          warnings: [],
        },
        metrics: [{ label: "Open requests", value: "3" }],
        backlog: [
          {
            requestId: "req-1",
            title: "Review ownership",
            assetFqn: "main.sales.orders",
            asset: "orders",
            status: "open",
          },
        ],
        glossary: [],
        inbox: {
          state: "ready",
          message: "Notifications from workflow activity.",
          unreadCount: 2,
          items: [
            {
              notificationId: "notification-1",
              title: "Review requested",
              detail: "Ownership change needs approval.",
              assetFqn: "main.sales.orders",
              createdAt: "2026-04-14T22:00:00Z",
              createdBy: "admin@example.com",
              status: "open",
              inboxState: "new",
            },
          ],
        },
      },
      refresh: vi.fn(),
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
      refresh: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      const governanceProps = governanceWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(governanceProps?.governance?.authoritative).toBe(false);
      expect(governanceProps?.governance?.provenance?.warnings).toContain(
        "Governance summary could not be refreshed.",
      );
      expect(governanceProps?.governance?.inbox?.state).toBe("degraded");
      expect(governanceProps?.governance?.backlog?.[0]?.requestId).toBe("req-1");
    });

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.governanceInbox?.state).toBe("degraded");
    expect(appFrameProps?.governanceInbox?.unreadCount).toBe(2);
  });

  it("passes runtime feature flags into EntityWorkspace on the entity route", async () => {
    const runtimeFeatureFlags = [
      {
        key: "workspace_setup_diagnostics",
        enabled: true,
        state: "available",
      },
      {
        key: "query_history_surface",
        enabled: false,
        state: "unavailable",
      },
    ];
    useAppRouteStateMock.mockReturnValue({
      surface: "entity",
      routeAssetFqn: "main.sales.orders",
      discoveryRouteState: {
        query: "",
        previewAssetFqn: "",
        sortBy: "",
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        capabilities: {},
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
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          setupSummary: {
            availableCount: 5,
            degradedCount: 0,
            unavailableCount: 0,
            unknownCount: 0,
          },
          setupChecks: [],
          workspaceAccess: {
            canUseLineage: true,
            canUseQueryHistory: false,
            canExport: false,
            canRunBackgroundWork: false,
            canUseClassificationRecommendations: false,
            gates: [],
            blockedSurfaces: ["Queries, usage, and workloads"],
          },
          featureFlags: runtimeFeatureFlags,
        },
      },
    });

    render(<App />);

    await waitFor(() => {
      const entityProps = entityWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(entityProps?.runtimeFeatureFlags).toEqual(runtimeFeatureFlags);
      expect(entityProps?.workspaceAccess).toEqual(
        expect.objectContaining({
          canUseLineage: true,
          canUseQueryHistory: false,
        }),
      );
    });
  });

  it("passes runtime feature flags into LineageWorkspace on the lineage route", async () => {
    const runtimeFeatureFlags = [
      {
        key: "workspace_setup_diagnostics",
        enabled: true,
        state: "available",
      },
      {
        key: "table_lineage_surface",
        enabled: false,
        state: "unavailable",
      },
    ];
    useAppRouteStateMock.mockReturnValue({
      surface: "lineage",
      routeAssetFqn: "main.sales.orders",
      discoveryRouteState: {
        query: "",
        previewAssetFqn: "",
        sortBy: "",
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        capabilities: {},
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
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          setupSummary: {
            availableCount: 5,
            degradedCount: 0,
            unavailableCount: 0,
            unknownCount: 0,
          },
          setupChecks: [],
          workspaceAccess: {
            canUseLineage: true,
            canUseQueryHistory: false,
            canExport: false,
            canRunBackgroundWork: false,
            canUseClassificationRecommendations: false,
            gates: [],
            blockedSurfaces: ["Queries, usage, and workloads"],
          },
          featureFlags: runtimeFeatureFlags,
        },
      },
    });

    render(<App />);

    await waitFor(() => {
      const lineageProps = lineageWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(lineageProps?.runtimeFeatureFlags).toEqual(runtimeFeatureFlags);
      expect(lineageProps?.workspaceAccess).toEqual(
        expect.objectContaining({
          canUseLineage: true,
          canUseQueryHistory: false,
        }),
      );
    });
  });

  it("passes runtime feature flags into GovernanceWorkspace on the governance route", async () => {
    const runtimeFeatureFlags = [
      {
        key: "workspace_setup_diagnostics",
        enabled: true,
        state: "available",
      },
      {
        key: "classification_recommendations",
        enabled: false,
        state: "unavailable",
      },
    ];
    useAppRouteStateMock.mockReturnValue({
      surface: "governance",
      routeAssetFqn: "main.sales.orders",
      discoveryRouteState: {
        query: "",
        previewAssetFqn: "",
        sortBy: "",
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRoutePreview: vi.fn(),
      setDiscoveryRouteQuery: vi.fn(),
      setDiscoveryRouteSort: vi.fn(),
      openDiscoveryWorkspace: vi.fn(),
      openEntityWorkspace: vi.fn(),
      openLineageWorkspace: vi.fn(),
      openGovernanceWorkspace: vi.fn(),
      onModuleChange: vi.fn(),
    });
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        capabilities: {},
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
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          setupSummary: {
            availableCount: 5,
            degradedCount: 0,
            unavailableCount: 0,
            unknownCount: 0,
          },
          setupChecks: [],
          featureFlags: runtimeFeatureFlags,
        },
      },
    });

    render(<App />);

    await waitFor(() => {
      const governanceProps = governanceWorkspaceMock.mock.calls.at(-1)?.[0];
      expect(governanceProps?.runtimeFeatureFlags).toEqual(runtimeFeatureFlags);
    });
  });

  it("fails closed when the workspace setup rollout flag is missing", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        diagnostics: {
          setupReadiness: {
            state: "attention_required",
            nextStep: "per_user_authorization",
          },
          featureFlags: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: null,
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.diagnosticsAvailable).toBe(false);
    expect(appFrameProps?.diagnosticsStatus).toEqual({
      state: "attention_required",
      nextStep: "per_user_authorization",
    });
    expect(screen.queryByRole("button", { name: "Toggle workspace setup" })).toBeNull();
  });

  it("shows shell-owned workspace setup without mounting GovernanceWorkspace", async () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        capabilities: {},
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
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          auth: {
            mode: "forwarded-user-header",
            perUserAuthorization: {
              state: "unavailable",
              reason: "OBO is not implemented.",
            },
          },
          setupSummary: {
            availableCount: 5,
            degradedCount: 1,
            unavailableCount: 2,
            unknownCount: 0,
          },
          setupChecks: [],
          featureFlags: [
            {
              key: "workspace_setup_diagnostics",
              enabled: true,
              state: "available",
            },
          ],
        },
      },
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle workspace setup" }));

    await waitFor(() => {
      expect(screen.getByTestId("workspace-setup-wizard")).not.toBeNull();
    });
    expect(container.querySelector(".gh-diagnostics-surface-header")).not.toBeNull();
    expect(screen.getByText("Workspace readiness guide")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close workspace setup" })).not.toBeNull();
    expect(workspaceSetupWizardMock).toHaveBeenCalled();
    expect(governanceWorkspaceMock).not.toHaveBeenCalled();
  });

  it("hides shell diagnostics when the workspace setup rollout is disabled", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Admin",
          userEmail: "admin@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        capabilities: {},
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
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          auth: {
            mode: "forwarded-user-header",
            perUserAuthorization: {
              state: "available",
              reason: "",
            },
          },
          setupSummary: {
            availableCount: 5,
            degradedCount: 1,
            unavailableCount: 0,
            unknownCount: 0,
          },
          setupReadiness: {
            state: "attention_required",
            nextStep: "per_user_authorization",
          },
          setupChecks: [],
          featureFlags: [
            {
              key: "workspace_setup_diagnostics",
              enabled: false,
              state: "unavailable",
              rationale: "Workspace setup diagnostics are rolled out off.",
            },
          ],
        },
      },
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.diagnosticsAvailable).toBe(false);
    expect(appFrameProps?.diagnosticsStatus).toEqual({
      state: "attention_required",
      nextStep: "per_user_authorization",
    });
    expect(screen.queryByRole("button", { name: "Toggle workspace setup" })).toBeNull();
  });

  it("keeps shell diagnostics unavailable for non-operator roles", () => {
    useBootstrapMock.mockReturnValue({
      loading: false,
      error: "",
      refreshError: "",
      data: {
        bootState: "live",
        shell: {
          role: "Reader",
          userEmail: "reader@example.com",
          diagnosticsEnabled: true,
        },
        discovery: {
          summary: {
            visibleAssets: 1,
          },
        },
        governance: {
          metrics: [],
          backlog: [],
          glossary: [],
        },
        assets: [{ fqn: "main.sales.orders", name: "orders" }],
      },
    });
    useRuntimeStatusMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      data: {
        runtime: {
          state: "live",
          message: "",
        },
        store: {
          state: "live",
          message: "",
        },
        capabilities: {},
        config: {
          warehouseId: "warehouse-1",
          govCatalog: "main",
          govSchema: "gov",
        },
        identity: {
          actorEmail: "reader@example.com",
          actorRole: "Reader",
          source: "x-forwarded-email",
        },
        diagnostics: {
          diagnosticsEnabled: true,
          observedAt: "2026-04-14T22:00:00Z",
          setupReadiness: {
            state: "attention_required",
            nextStep: "per_user_authorization",
          },
          setupSummary: {
            availableCount: 5,
            degradedCount: 1,
            unavailableCount: 0,
            unknownCount: 0,
          },
          setupChecks: [],
          featureFlags: [
            {
              key: "workspace_setup_diagnostics",
              enabled: true,
              state: "available",
            },
          ],
        },
      },
    });

    render(<App />);

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.diagnosticsAvailable).toBe(false);
    expect(appFrameProps?.diagnosticsStatus).toEqual({
      state: "attention_required",
      nextStep: "per_user_authorization",
    });
    expect(screen.queryByRole("button", { name: "Toggle workspace setup" })).toBeNull();
  });
});
