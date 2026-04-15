import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EntityWorkspace from "./EntityWorkspace";

const useAssetDetailMock = vi.fn();
const useAssetAvailabilityMock = vi.fn();
const useLineageMock = vi.fn();
const useSeededAssetContextMock = vi.fn();
const useAssetMetadataEditorMock = vi.fn();
const peekWorkspaceIntentMock = vi.fn();
const consumeWorkspaceIntentMock = vi.fn();
const setWorkspaceIntentMock = vi.fn();

vi.mock("../lib/api", () => ({
  updateAssetColumnDescription: vi.fn(),
  updateAssetColumnMetadata: vi.fn(),
  updateAssetColumnTags: vi.fn(),
}));

vi.mock("../hooks/useAssetMetadataEditor", () => ({
  useAssetMetadataEditor: (...args) => useAssetMetadataEditorMock(...args),
}));

vi.mock("../hooks/useAssetDetail", () => ({
  canOpenLinkedAssetRecord: vi.fn(() => true),
  invalidateAssetDetail: vi.fn(),
  isUsableAssetDetail: (detail) => Boolean(detail?.fqn),
  prefetchAssetAvailability: vi.fn(),
  prefetchAssetDetail: vi.fn(),
  primeAssetDetail: vi.fn(),
  useAssetAvailability: (...args) => useAssetAvailabilityMock(...args),
  useAssetDetail: (...args) => useAssetDetailMock(...args),
}));

vi.mock("../hooks/useAssetSearch", () => ({
  clearAssetSearchCache: vi.fn(),
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
  description: "Orders fact table",
  coverageScore: 91,
  openRequests: 0,
  owners: [],
  ownerAssignments: [],
  columns: [],
  preview: [],
  relatedAssets: [],
  activity: [],
  metadataAudit: [],
  tagEntries: [],
  operationalContext: {
    producers: [],
    consumers: [],
  },
  profiler: {
    summary: {
      producerCount: 0,
      consumerCount: 0,
    },
    cards: [],
  },
  usage: {
    producerCount: 0,
    consumerCount: 0,
  },
  loadedSections: ["header"],
};

const lineageUnavailableReason = "Lineage is disabled in this workspace.";
const workloadUnavailableReason = "Operational query and workload visibility is not available in this workspace right now.";

function bootstrapPayload() {
  return {
    assets: [asset],
    capabilities: {
      tableLineage: {
        available: false,
        state: "unavailable",
        reason: lineageUnavailableReason,
      },
      workloadVisibility: {
        available: false,
        state: "unknown",
        reason: workloadUnavailableReason,
      },
    },
  };
}

describe("EntityWorkspace", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useAssetAvailabilityMock.mockReset();
    useLineageMock.mockReset();
    useSeededAssetContextMock.mockReset();
    useAssetMetadataEditorMock.mockReset();
    peekWorkspaceIntentMock.mockReset();
    consumeWorkspaceIntentMock.mockReset();
    setWorkspaceIntentMock.mockReset();

    useAssetDetailMock.mockReturnValue({
      detail: asset,
      loading: false,
      error: "",
    });
    useAssetAvailabilityMock.mockReturnValue({});
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
    useAssetMetadataEditorMock.mockReturnValue({
      available: false,
      loading: false,
      error: "",
      submitError: "",
      submitSuccess: "",
      submitting: false,
      config: {
        fields: [],
        message: "Metadata editing is read only for this test.",
      },
      hasContract: false,
      save: vi.fn(),
    });
    peekWorkspaceIntentMock.mockReturnValue("Lineage");
    consumeWorkspaceIntentMock.mockReturnValue("Lineage");
  });

  it("falls back to overview and hides the lineage tab when table lineage is unavailable", async () => {
    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={bootstrapPayload()}
        contextSeedAssets={[asset]}
        onBack={() => {}}
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onSelectAsset={() => {}}
        onSurfaceReady={() => {}}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.getByRole("button", { name: "Lineage unavailable" }).disabled).toBe(true);
    expect(screen.getAllByText(lineageUnavailableReason)[0]).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });

  it("hides lineage and workload tabs when rollout flags are disabled", async () => {
    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
            workloadVisibility: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        onBack={() => {}}
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onSelectAsset={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: false,
            state: "unavailable",
            unavailableReason: "Table lineage rollout is disabled in this workspace.",
          },
          {
            key: "query_history_surface",
            enabled: false,
            state: "unavailable",
            unavailableReason: "Query history rollout is disabled in this workspace.",
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usage & Workloads" })).toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });

  it("fails closed when rollout flags are missing", async () => {
    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
            workloadVisibility: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        onBack={() => {}}
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onSelectAsset={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usage & Workloads" })).toBeNull();
    expect(
      screen.getAllByText("Table lineage rollout is not available in this workspace right now.").length,
    ).toBeGreaterThan(0);
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });

  it("hides usage and workload claims when workload visibility is unavailable", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Profiler");
    consumeWorkspaceIntentMock.mockReturnValue("Profiler");

    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={bootstrapPayload()}
        contextSeedAssets={[asset]}
        onBack={() => {}}
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onSelectAsset={() => {}}
        onSurfaceReady={() => {}}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Profiler & Data Quality").length).toBeGreaterThan(0);
    });

    expect(screen.queryByRole("button", { name: "Usage & Workloads" })).toBeNull();
    const profilerCall = [...useAssetDetailMock.mock.calls].find(([, options]) =>
      Array.isArray(options?.sections) && options.sections.includes("profiler"),
    );
    expect(profilerCall?.[1].sections).toEqual([
      "header",
      "activity",
      "schema",
      "preview",
      "profiler",
    ]);
    const workloadCard = screen.getByText("Workloads").closest(".gh-entity-metric-card");
    expect(workloadCard).not.toBeNull();
    expect(within(workloadCard).getByText("Unavailable")).not.toBeNull();
  });

  it("fails closed when workspace access blocks lineage despite available capability and rollout", async () => {
    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={{
          assets: [asset],
          capabilities: {
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
            workloadVisibility: {
              available: true,
              state: "available",
              reason: "",
            },
          },
        }}
        contextSeedAssets={[asset]}
        onBack={() => {}}
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onSelectAsset={() => {}}
        onSurfaceReady={() => {}}
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
          {
            key: "query_history_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
        workspaceAccess={{
          canUseLineage: false,
          canUseQueryHistory: false,
          gates: [
            {
              key: "lineage_access",
              reason: "Lineage is blocked by workspace access.",
            },
            {
              key: "workload_visibility",
              reason: "Query and workload visibility is blocked by workspace access.",
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.getByRole("button", { name: "Lineage unavailable" }).disabled).toBe(true);
    expect(screen.getAllByText("Lineage is blocked by workspace access.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });
});
