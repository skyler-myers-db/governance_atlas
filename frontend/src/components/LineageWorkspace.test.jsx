import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LineageWorkspace from "./LineageWorkspace";

const useAssetDetailMock = vi.fn();
const useAssetSearchMock = vi.fn();
const useLineageMock = vi.fn();
const useSeededAssetContextMock = vi.fn();
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

vi.mock("../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: vi.fn(),
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

const lineageUnavailableReason = "Lineage is disabled in this workspace.";

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
      seededGraph: {
        data: { nodes: [], edges: [] },
        operational: { nodes: [], edges: [] },
      },
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
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
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
      />,
    );

    expect(screen.getByText("Lineage Unavailable")).not.toBeNull();
    expect(screen.getByText("Table lineage rollout is disabled in this workspace.")).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
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
      />,
    );

    expect(screen.getByText("Lineage Unavailable")).not.toBeNull();
    expect(
      screen.getByText("Table lineage rollout is not available in this workspace right now."),
    ).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
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
          canUseLineage: false,
          gates: [
            {
              key: "lineage_access",
              reason: "Lineage is blocked by workspace access.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Lineage Unavailable")).not.toBeNull();
    expect(screen.getByText("Lineage is blocked by workspace access.")).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });
});
