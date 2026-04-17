import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LineageWorkspace from "./LineageWorkspace";

const useAssetDetailMock = vi.fn();
const useAssetSearchMock = vi.fn();
const useLineageMock = vi.fn();
const useSeededAssetContextMock = vi.fn();
const openAssetRecordSafelyMock = vi.fn();
const peekWorkspaceIntentMock = vi.fn();
const consumeWorkspaceIntentMock = vi.fn();
const setWorkspaceIntentMock = vi.fn();

vi.mock("../hooks/useAssetDetail", () => ({
  canOpenLinkedAssetRecord: vi.fn(() => true),
  useAssetDetail: (...args) => useAssetDetailMock(...args),
}));

vi.mock("../hooks/useAssetSearch", () => ({
  useAssetSearch: (...args) => useAssetSearchMock(...args),
}));

vi.mock("../hooks/useLineage", () => ({
  useLineage: (...args) => useLineageMock(...args),
}));

vi.mock("../hooks/useSeededAssetContext", () => ({
  useSeededAssetContext: (...args) => useSeededAssetContextMock(...args),
}));

vi.mock("./LineageStage", () => ({
  default: ({
    linkedRecordUnavailableOverrides = {},
    notice = "",
    onOpenAsset = () => {},
  }) => (
    <div data-testid="lineage-stage">
      {notice ? (
        <div data-testid="lineage-notice">
          <div>Navigation limited</div>
          <div>{notice}</div>
        </div>
      ) : (
        <div data-testid="lineage-notice" />
      )}
      <div data-testid="lineage-overrides">
        {Object.keys(linkedRecordUnavailableOverrides).sort().join(",")}
      </div>
      <button onClick={() => onOpenAsset("main.sales.customers")} type="button">
        Open linked asset
      </button>
    </div>
  ),
}));

vi.mock("../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: (...args) => openAssetRecordSafelyMock(...args),
}));

vi.mock("../lib/workspaceIntent", () => ({
  consumeWorkspaceIntent: (...args) => consumeWorkspaceIntentMock(...args),
  peekWorkspaceIntent: (...args) => peekWorkspaceIntentMock(...args),
  setWorkspaceIntent: (...args) => setWorkspaceIntentMock(...args),
}));

const asset = {
  fqn: "main.sales.orders",
  name: "orders",
  catalog: "main",
  schema: "sales",
};

const secondAsset = {
  ...asset,
  fqn: "main.sales.returns",
  name: "returns",
};

const lineageUnavailableReason = "Lineage is disabled in this workspace.";
const fullWorkspaceAccess = {
  mode: "obo-available",
  observedAt: "2026-04-16T00:00:00Z",
  canUseLineage: true,
  gates: [],
};

function bootstrapPayload() {
  return {
    assets: [asset],
    capabilities: {
      tableLineage: {
        available: false,
        state: "unavailable",
        reason: lineageUnavailableReason,
      },
    },
  };
}

describe("LineageWorkspace", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useAssetSearchMock.mockReset();
    useLineageMock.mockReset();
    useSeededAssetContextMock.mockReset();
    peekWorkspaceIntentMock.mockReset();
    consumeWorkspaceIntentMock.mockReset();
    setWorkspaceIntentMock.mockReset();

    useAssetDetailMock.mockReturnValue({
      detail: asset,
      loading: false,
      error: "",
    });
    useAssetSearchMock.mockReturnValue({
      assets: [],
      loading: false,
      resolvedQuery: "",
    });
    useLineageMock.mockReturnValue({
      authoritative: false,
      provisional: false,
      loading: false,
      error: "",
      graph: null,
      payload: null,
    });
    useSeededAssetContextMock.mockReturnValue({
      summary: asset,
    });
    peekWorkspaceIntentMock.mockReturnValue("Data Lineage");
    consumeWorkspaceIntentMock.mockReturnValue("Data Lineage");
  });

  it("shows a truthful unavailable panel when table lineage is unavailable", () => {
    render(
      <LineageWorkspace
        bootstrap={bootstrapPayload()}
        contextSeedAssets={[asset]}
        initialAssetFqn={asset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    expect(screen.getByText("Lineage Unavailable")).not.toBeNull();
    expect(screen.getByText(lineageUnavailableReason)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open metadata record" })).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("shows a truthful unavailable panel when the lineage rollout is disabled", () => {
    render(
      <LineageWorkspace
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        initialAssetFqn={asset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: false,
            state: "unavailable",
            unavailableReason: "Table lineage rollout is disabled in this workspace.",
          },
        ]}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    expect(screen.getByText("Lineage Unavailable")).not.toBeNull();
    expect(screen.getByText("Table lineage rollout is disabled in this workspace.")).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("shows a pending access state before workspace lineage access resolves", () => {
    render(
      <LineageWorkspace
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        initialAssetFqn={asset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
      />,
    );

    expect(screen.getByText("Resolving live lineage access...")).not.toBeNull();
    expect(screen.getByText("Checking actor-scoped lineage access for this route.")).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("fails closed when the lineage rollout flag is missing", () => {
    render(
      <LineageWorkspace
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        initialAssetFqn={asset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[]}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    expect(screen.getByText("Lineage Unavailable")).not.toBeNull();
    expect(
      screen.getByText("Table lineage rollout is not available in this workspace right now."),
    ).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("fails closed when workspace access blocks lineage despite available capability and rollout", () => {
    render(
      <LineageWorkspace
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        initialAssetFqn={asset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        workspaceAccess={{
          ...fullWorkspaceAccess,
          canUseLineage: false,
          gates: [
            {
              key: "table_lineage",
              reason: "Lineage is blocked by workspace access.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Lineage Unavailable")).not.toBeNull();
    expect(screen.getByText("Lineage is blocked by workspace access.")).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("opens live lineage without passing the seeded bootstrap graph into useLineage", () => {
    render(
      <LineageWorkspace
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        initialAssetFqn={asset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        workspaceAccess={{
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    expect(useSeededAssetContextMock).toHaveBeenCalledWith(
      asset.fqn,
      expect.any(Object),
      [asset],
      { allowFallback: false },
    );
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, true);
  });

  it("remembers a denied lineage open until the focused asset changes", async () => {
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === "main.sales.customers") {
        options.onUnavailable?.({
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {});
      return Promise.resolve(true);
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assetFqn === secondAsset.fqn ? secondAsset : asset,
      loading: false,
      error: "",
    }));
    useSeededAssetContextMock.mockImplementation((assetFqn) => ({
      summary: assetFqn === secondAsset.fqn ? secondAsset : asset,
    }));
    useLineageMock.mockReturnValue({
      authoritative: true,
      provisional: false,
      loading: false,
      error: "",
      graph: {
        data: {
          nodes: [
            {
              id: "focus",
              assetFqn: asset.fqn,
              kind: "Table",
              label: "orders",
              role: "focus",
              subtitle: asset.fqn,
            },
            {
              id: "customer",
              assetFqn: "main.sales.customers",
              kind: "Table",
              label: "customers",
              role: "source",
              subtitle: "main.sales.customers",
            },
          ],
          edges: [
            {
              id: "customer-focus",
              source: "customer",
              target: "focus",
              data: {
                kind: "Lineage",
              },
            },
          ],
        },
        operational: {
          nodes: [],
          edges: [],
        },
      },
      payload: null,
    });

    const { rerender } = render(
      <LineageWorkspace
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        initialAssetFqn={asset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        workspaceAccess={{
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open linked asset" }));

    await waitFor(() => {
      expect(screen.getByText("Navigation limited")).not.toBeNull();
      expect(
        screen.getByText(
          "That lineage-linked asset is visible in the graph, but its metadata record is not openable with the current permissions.",
        ),
      ).not.toBeNull();
      expect(screen.getByTestId("lineage-overrides").textContent).toContain("main.sales.customers");
    });

    rerender(
      <LineageWorkspace
        bootstrap={{
          assets: [secondAsset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[secondAsset]}
        initialAssetFqn={secondAsset.fqn}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        workspaceAccess={{
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("lineage-notice").textContent).toBe("");
      expect(screen.getByTestId("lineage-overrides").textContent).toBe("");
    });
  });
});
