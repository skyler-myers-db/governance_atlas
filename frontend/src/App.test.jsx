import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appFrameMock = vi.fn();
const useAppRouteStateMock = vi.fn();
const useBootstrapMock = vi.fn();
const useRuntimeStatusMock = vi.fn();
const updateGovernanceNotificationMock = vi.fn();
const discoveryWorkspaceMock = vi.fn(() => <div data-testid="discovery-workspace" />);
const entityWorkspaceMock = vi.fn(() => <div data-testid="entity-workspace" />);
const lineageWorkspaceMock = vi.fn(() => <div data-testid="lineage-workspace" />);
const governanceWorkspaceMock = vi.fn(() => <div data-testid="governance-workspace" />);

vi.mock("./hooks/useAppRouteState", () => ({
  useAppRouteState: (...args) => useAppRouteStateMock(...args),
}));

vi.mock("./hooks/useBootstrap", () => ({
  useBootstrap: (...args) => useBootstrapMock(...args),
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
    useRuntimeStatusMock.mockReset();
    updateGovernanceNotificationMock.mockReset();
    appFrameMock.mockReset();
    discoveryWorkspaceMock.mockClear();
    entityWorkspaceMock.mockClear();
    lineageWorkspaceMock.mockClear();
    governanceWorkspaceMock.mockClear();

    useAppRouteStateMock.mockReturnValue({
      surface: "discovery",
      setSurface: vi.fn(),
      routeAssetFqn: "",
      discoveryRouteState: {
        query: "",
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRouteQuery: vi.fn(),
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

  it("passes setup readiness into AppFrame and runtime feature flags into DiscoveryWorkspace", () => {
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
    const discoveryProps = discoveryWorkspaceMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.diagnosticsStatus).toEqual({
      state: "attention_required",
      nextStep: "per_user_authorization",
    });
    expect(discoveryProps?.runtimeFeatureFlags).toEqual(runtimeFeatureFlags);
    expect(discoveryProps?.workspaceAccess).toEqual(
      expect.objectContaining({
        canUseLineage: true,
        canUseQueryHistory: false,
      }),
    );
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

    expect(screen.getByTestId("inbox-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Toggle inbox" }));
    expect(screen.getByTestId("inbox-open")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mark first inbox item read" }));
    await waitFor(() => {
      expect(updateGovernanceNotificationMock).toHaveBeenCalledWith("notification-1", { action: "read" });
    });
    expect(screen.getByTestId("inbox-count").textContent).toBe("1");

    const appFrameProps = appFrameMock.mock.calls.at(-1)?.[0];
    expect(appFrameProps?.governanceInbox?.items?.[0]?.inboxState).toBe("read");
  });

  it("passes runtime feature flags into EntityWorkspace on the entity route", () => {
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
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRouteQuery: vi.fn(),
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

    const entityProps = entityWorkspaceMock.mock.calls.at(-1)?.[0];
    expect(entityProps?.runtimeFeatureFlags).toEqual(runtimeFeatureFlags);
    expect(entityProps?.workspaceAccess).toEqual(
      expect.objectContaining({
        canUseLineage: true,
        canUseQueryHistory: false,
      }),
    );
  });

  it("passes runtime feature flags into LineageWorkspace on the lineage route", () => {
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
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRouteQuery: vi.fn(),
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

    const lineageProps = lineageWorkspaceMock.mock.calls.at(-1)?.[0];
    expect(lineageProps?.runtimeFeatureFlags).toEqual(runtimeFeatureFlags);
    expect(lineageProps?.workspaceAccess).toEqual(
      expect.objectContaining({
        canUseLineage: true,
        canUseQueryHistory: false,
      }),
    );
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
        fresh: false,
        requestKey: "seed",
      },
      setDiscoveryRouteQuery: vi.fn(),
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

  it("shows shell-owned diagnostics without mounting GovernanceWorkspace", async () => {
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

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle workspace setup" }));

    await waitFor(() => {
      expect(screen.getByText("Workspace diagnostics")).not.toBeNull();
    });
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
