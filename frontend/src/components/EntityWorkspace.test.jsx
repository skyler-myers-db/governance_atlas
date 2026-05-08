import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EntityWorkspace from "./EntityWorkspace";

const useAssetDetailMock = vi.fn();
const useAssetAvailabilityMock = vi.fn();
const useAsset360Mock = vi.fn();
const useLineageMock = vi.fn();
const useSeededAssetContextMock = vi.fn();
const useAssetMetadataEditorMock = vi.fn();
const peekWorkspaceIntentMock = vi.fn();
const consumeWorkspaceIntentMock = vi.fn();
const setWorkspaceIntentMock = vi.fn();
const openAssetRecordSafelyMock = vi.fn();
const prefetchAssetAvailabilityMock = vi.fn();
const prefetchAssetDetailMock = vi.fn();

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
  prefetchAssetAvailability: (...args) => prefetchAssetAvailabilityMock(...args),
  prefetchAssetDetail: (...args) => prefetchAssetDetailMock(...args),
  primeAssetDetail: vi.fn(),
  useAssetAvailability: (...args) => useAssetAvailabilityMock(...args),
  useAssetDetail: (...args) => useAssetDetailMock(...args),
}));

vi.mock("../hooks/useAsset360", () => ({
  useAsset360: (...args) => useAsset360Mock(...args),
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

vi.mock("../hooks/useAccessExplain", () => ({
  useAccessExplain: () => ({ loading: false, error: "", data: null }),
}));

vi.mock("../hooks/useAssetCustomProperties", () => ({
  useAssetCustomProperties: () => ({
    loading: false,
    refreshing: false,
    error: "",
    assignments: [],
  }),
}));

vi.mock("../hooks/useAssetProfile", () => ({
  useAssetProfile: () => ({
    loading: false,
    error: "",
    run: null,
    tableMetric: null,
    columnMetrics: [],
  }),
}));

vi.mock("../hooks/useAssetQuality", () => ({
  useAssetQuality: () => ({
    loading: false,
    error: "",
    runs: [],
    results: [],
    summary: { passed: 0, failed: 0, errored: 0, skipped: 0 },
  }),
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

const secondAsset = {
  ...asset,
  fqn: "main.sales.returns",
  name: "returns",
  description: "Returns fact table",
};

const lineageUnavailableReason = "Lineage is disabled in this workspace.";
const workloadUnavailableReason = "Operational query and workload visibility is not available in this workspace right now.";
const availableSystemInventoryCapability = {
  available: true,
  state: "available",
  reason: "",
};
const fullWorkspaceAccess = {
  mode: "obo-available",
  observedAt: "2026-04-16T00:00:00Z",
  canUseAssetPreview: true,
  canUseLineage: true,
  canUseQueryHistory: true,
  gates: [],
};

function bootstrapPayload() {
  return {
    assets: [asset],
    capabilities: {
      systemInventoryRead: availableSystemInventoryCapability,
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

function enabledBootstrapPayload() {
  return {
    assets: [asset],
    capabilities: {
      systemInventoryRead: availableSystemInventoryCapability,
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
  };
}

describe.skip("EntityWorkspace legacy metadata-record contract", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useAssetAvailabilityMock.mockReset();
    useAsset360Mock.mockReset();
    useLineageMock.mockReset();
    useSeededAssetContextMock.mockReset();
    useAssetMetadataEditorMock.mockReset();
    peekWorkspaceIntentMock.mockReset();
    consumeWorkspaceIntentMock.mockReset();
    setWorkspaceIntentMock.mockReset();
    openAssetRecordSafelyMock.mockReset();
    prefetchAssetAvailabilityMock.mockReset();
    prefetchAssetDetailMock.mockReset();

    useAssetDetailMock.mockReturnValue({
      detail: asset,
      loading: false,
      error: "",
    });
    useAssetAvailabilityMock.mockReturnValue({});
    useAsset360Mock.mockReturnValue({
      data: null,
      loading: false,
      refreshing: false,
      error: "",
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
    openAssetRecordSafelyMock.mockResolvedValue(true);
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
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sample Data" })).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.getByRole("button", { name: "Lineage unavailable" }).disabled).toBe(true);
    expect(screen.getAllByText(lineageUnavailableReason)[0]).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("renders same-FQN Asset 360 composite context without replacing it with seeded data", () => {
    useAsset360Mock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      data: {
        sameAsset: true,
        asset: {
          ...asset,
          fqn: asset.fqn,
          name: "orders",
          usage: { queryCount: 9 },
        },
        schema: [{ name: "order_id", type: "BIGINT" }],
        badges: ["Certified"],
        usage: {
          queryCount: 9,
          downstreamConsumerCount: 2,
        },
        governance: {
          openActivity: [{ id: "req-1", title: "Review owner" }],
        },
        quality: {
          state: "unavailable",
          runs: [],
          message: "Quality runs are not included in this composite payload yet.",
        },
        freshness: {
          state: "unavailable",
          message: "Freshness is unavailable for this asset until a live freshness signal is present.",
        },
        activity: [{ id: "audit-1", title: "Metadata changed" }],
        relatedAssets: [],
        downstreamDashboards: [],
        loadedSections: ["header", "schema"],
      },
    });

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
        runtimeFeatureFlags={[]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    const section = screen.getByText("Asset 360").closest(".gh-entity-record-section");
    expect(section).not.toBeNull();
    expect(within(section).getByText("Certified")).not.toBeNull();
    expect(within(section).getByText("9 queries · 2 consumers")).not.toBeNull();
    expect(within(section).getByText("header, schema")).not.toBeNull();
  });

  it("hides lineage and workload tabs when rollout flags are disabled", async () => {
    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={{
          assets: [asset],
          capabilities: {
            systemInventoryRead: availableSystemInventoryCapability,
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
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sample Data" })).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usage & Workloads" })).toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("demotes a pending linked entity row after a confirmed failed open", async () => {
    const linkedAssetFqn = "main.sales.customers";
    const entityWithLinkedAsset = {
      ...asset,
      relatedAssets: [linkedAssetFqn],
    };
    peekWorkspaceIntentMock.mockReturnValue("Overview");
    consumeWorkspaceIntentMock.mockReturnValue("Overview");
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assetFqn === entityWithLinkedAsset.fqn ? entityWithLinkedAsset : entityWithLinkedAsset,
      loading: false,
      error: "",
    }));
    useSeededAssetContextMock.mockReturnValue({
      summary: entityWithLinkedAsset,
    });
    useAssetAvailabilityMock.mockImplementation((assetFqns = []) =>
      Object.fromEntries(assetFqns.map((assetFqn) => [assetFqn, null])),
    );
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === linkedAssetFqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: { fqn: assetFqn },
      });
      return Promise.resolve(true);
    });

    render(
      <EntityWorkspace
        assetFqn={entityWithLinkedAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[entityWithLinkedAsset]}
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
        sharedVisibleAssetSet={new Set([entityWithLinkedAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Lineage Context")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${linkedAssetFqn} `) }));

    await waitFor(() => {
      expect(screen.getByText("Metadata record unavailable")).not.toBeNull();
    });
    expect(
      screen.getByText(
        "That linked asset is surfaced by live lineage, but its metadata record is not openable with the current permissions.",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`^${linkedAssetFqn} `) })).toBeNull();
  });

  it("clears linked-row unavailable overrides when the entity context changes", async () => {
    const linkedAssetFqn = "main.sales.customers";
    const firstAsset = {
      ...asset,
      relatedAssets: [linkedAssetFqn],
    };
    const nextAsset = {
      ...secondAsset,
      relatedAssets: [linkedAssetFqn],
    };
    peekWorkspaceIntentMock.mockReturnValue("Overview");
    consumeWorkspaceIntentMock.mockReturnValue("Overview");
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail:
        assetFqn === nextAsset.fqn
          ? nextAsset
          : firstAsset,
      loading: false,
      error: "",
    }));
    useSeededAssetContextMock.mockImplementation((assetFqn) => ({
      summary: assetFqn === nextAsset.fqn ? nextAsset : firstAsset,
    }));
    useAssetAvailabilityMock.mockImplementation((assetFqns = []) =>
      Object.fromEntries(assetFqns.map((assetFqn) => [assetFqn, null])),
    );
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === linkedAssetFqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: { fqn: assetFqn },
      });
      return Promise.resolve(true);
    });

    const { rerender } = render(
      <EntityWorkspace
        assetFqn={firstAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[firstAsset, nextAsset]}
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
        sharedVisibleAssetSet={new Set([firstAsset.fqn, nextAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Lineage Context")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${linkedAssetFqn} `) }));
    await waitFor(() => {
      expect(screen.getByText("Metadata record unavailable")).not.toBeNull();
    });

    rerender(
      <EntityWorkspace
        assetFqn={nextAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[firstAsset, nextAsset]}
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
        sharedVisibleAssetSet={new Set([firstAsset.fqn, nextAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("returns")).not.toBeNull();
    });
    expect(screen.getByRole("button", { name: new RegExp(`^${linkedAssetFqn} `) })).not.toBeNull();
    expect(screen.getAllByText("Checking access...").length).toBeGreaterThan(0);
  });

  it("demotes a selected-column lineage row after a confirmed failed open", async () => {
    const linkedAssetFqn = "main.sales.customers";
    const schemaAsset = {
      ...asset,
      loadedSections: ["header", "schema"],
      columns: [
        {
          name: "customer_id",
          type: "STRING",
          description: "",
          tagLabels: [],
          glossaryTerms: [],
        },
      ],
    };
    peekWorkspaceIntentMock.mockReturnValue("Schema");
    consumeWorkspaceIntentMock.mockReturnValue("Schema");
    useAssetDetailMock.mockReturnValue({
      detail: schemaAsset,
      loading: false,
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({
      summary: schemaAsset,
    });
    useLineageMock.mockReturnValue({
      authoritative: true,
      provisional: false,
      loading: false,
      error: "",
      graph: null,
      payload: {
        columnLineage: {
          upstream: [
            {
              column: "customer_id",
              sources: [{ assetFqn: linkedAssetFqn, column: "customer_id" }],
            },
          ],
          downstream: [],
        },
      },
    });
    useAssetAvailabilityMock.mockReturnValue({
      [linkedAssetFqn]: null,
    });
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === linkedAssetFqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: { fqn: assetFqn },
      });
      return Promise.resolve(true);
    });

    const { container } = render(
      <EntityWorkspace
        assetFqn={schemaAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[schemaAsset]}
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
        sharedVisibleAssetSet={new Set([schemaAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Schema").length).toBeGreaterThan(1);
    });

    const selectedSection = container.querySelector(".gh-entity-record-selected-column-section");
    expect(selectedSection).not.toBeNull();

    const linkedRowButton = await within(selectedSection).findByRole("button", {
      name: new RegExp(linkedAssetFqn, "i"),
    });
    expect(within(selectedSection).getByText("Checking access...")).not.toBeNull();

    fireEvent.click(linkedRowButton);

    await waitFor(() => {
      expect(within(selectedSection).getByText("Metadata record unavailable")).not.toBeNull();
    });
    expect(
      screen.getByText(
        "That linked asset is surfaced by live lineage, but its metadata record is not openable with the current permissions.",
      ),
    ).not.toBeNull();
    expect(
      within(selectedSection).queryByRole("button", {
        name: new RegExp(linkedAssetFqn, "i"),
      }),
    ).toBeNull();
  });

  it("warms selected-column lineage links on hover before open", async () => {
    const linkedAssetFqn = "main.sales.customers";
    const schemaAsset = {
      ...asset,
      loadedSections: ["header", "schema"],
      columns: [
        {
          name: "customer_id",
          type: "STRING",
          description: "",
          tagLabels: [],
          glossaryTerms: [],
        },
      ],
    };
    peekWorkspaceIntentMock.mockReturnValue("Schema");
    consumeWorkspaceIntentMock.mockReturnValue("Schema");
    useAssetDetailMock.mockReturnValue({
      detail: schemaAsset,
      loading: false,
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({
      summary: schemaAsset,
    });
    useLineageMock.mockReturnValue({
      authoritative: true,
      provisional: false,
      loading: false,
      error: "",
      graph: null,
      payload: {
        columnLineage: {
          upstream: [
            {
              column: "customer_id",
              sources: [{ assetFqn: linkedAssetFqn, column: "customer_id" }],
            },
          ],
          downstream: [],
        },
      },
    });
    useAssetAvailabilityMock.mockReturnValue({
      [linkedAssetFqn]: null,
    });

    const { container } = render(
      <EntityWorkspace
        assetFqn={schemaAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[schemaAsset]}
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
        sharedVisibleAssetSet={new Set([schemaAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Schema").length).toBeGreaterThan(1);
    });

    const selectedSection = container.querySelector(".gh-entity-record-selected-column-section");
    expect(selectedSection).not.toBeNull();

    const linkedRowButton = await within(selectedSection).findByRole("button", {
      name: new RegExp(linkedAssetFqn, "i"),
    });

    fireEvent.mouseEnter(linkedRowButton);

    expect(prefetchAssetAvailabilityMock).toHaveBeenCalledWith([linkedAssetFqn]);
    expect(prefetchAssetDetailMock).toHaveBeenCalledWith(linkedAssetFqn, { sections: ["header"] });
  });

  it("clears selected-column lineage unavailable overrides when the entity context changes", async () => {
    const linkedAssetFqn = "main.sales.customers";
    const firstAsset = {
      ...asset,
      loadedSections: ["header", "schema"],
      columns: [
        {
          name: "customer_id",
          type: "STRING",
          description: "",
          tagLabels: [],
          glossaryTerms: [],
        },
      ],
    };
    const nextAsset = {
      ...secondAsset,
      loadedSections: ["header", "schema"],
      columns: [
        {
          name: "customer_id",
          type: "STRING",
          description: "",
          tagLabels: [],
          glossaryTerms: [],
        },
      ],
    };
    peekWorkspaceIntentMock.mockReturnValue("Schema");
    consumeWorkspaceIntentMock.mockReturnValue("Schema");
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assetFqn === nextAsset.fqn ? nextAsset : firstAsset,
      loading: false,
      error: "",
    }));
    useSeededAssetContextMock.mockImplementation((assetFqn) => ({
      summary: assetFqn === nextAsset.fqn ? nextAsset : firstAsset,
    }));
    useLineageMock.mockReturnValue({
      authoritative: true,
      provisional: false,
      loading: false,
      error: "",
      graph: null,
      payload: {
        columnLineage: {
          upstream: [
            {
              column: "customer_id",
              sources: [{ assetFqn: linkedAssetFqn, column: "customer_id" }],
            },
          ],
          downstream: [],
        },
      },
    });
    useAssetAvailabilityMock.mockReturnValue({
      [linkedAssetFqn]: null,
    });
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === linkedAssetFqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: { fqn: assetFqn },
      });
      return Promise.resolve(true);
    });

    const { container, rerender } = render(
      <EntityWorkspace
        assetFqn={firstAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[firstAsset, nextAsset]}
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
        sharedVisibleAssetSet={new Set([firstAsset.fqn, nextAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Schema").length).toBeGreaterThan(1);
    });

    const firstSelectedSection = container.querySelector(".gh-entity-record-selected-column-section");
    expect(firstSelectedSection).not.toBeNull();

    fireEvent.click(
      await within(firstSelectedSection).findByRole("button", {
        name: new RegExp(linkedAssetFqn, "i"),
      }),
    );

    await waitFor(() => {
      expect(within(firstSelectedSection).getByText("Metadata record unavailable")).not.toBeNull();
    });

    rerender(
      <EntityWorkspace
        assetFqn={nextAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[firstAsset, nextAsset]}
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
        sharedVisibleAssetSet={new Set([firstAsset.fqn, nextAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("returns")).not.toBeNull();
    });

    const nextSelectedSection = container.querySelector(".gh-entity-record-selected-column-section");
    expect(nextSelectedSection).not.toBeNull();
    expect(
      within(nextSelectedSection).getByRole("button", {
        name: new RegExp(linkedAssetFqn, "i"),
      }),
    ).not.toBeNull();
    expect(within(nextSelectedSection).getByText("Checking access...")).not.toBeNull();
  });

  it("fails closed when rollout flags are missing", async () => {
    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={{
          assets: [asset],
          capabilities: {
            systemInventoryRead: availableSystemInventoryCapability,
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
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sample Data" })).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usage & Workloads" })).toBeNull();
    expect(
      screen.getAllByText("Table lineage rollout is not available in this workspace right now.").length,
    ).toBeGreaterThan(0);
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("hides usage and workload claims when workload visibility is unavailable", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Profiler");
    consumeWorkspaceIntentMock.mockReturnValue("Profiler");

    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={{
          assets: [asset],
          capabilities: {
            systemInventoryRead: availableSystemInventoryCapability,
            tableLineage: {
              available: true,
              state: "available",
              reason: "",
            },
            workloadVisibility: {
              available: false,
              state: "unknown",
              reason: workloadUnavailableReason,
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
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Profiler & Evidence").length).toBeGreaterThan(0);
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
    expect(screen.queryByText("Operational Usage")).toBeNull();
    expect(screen.queryByText("0 producers")).toBeNull();
    expect(screen.queryByText("0 consumers")).toBeNull();
  });

  it("fails closed on lineage while preserving preview when workspace access blocks lineage", async () => {
    peekWorkspaceIntentMock.mockReturnValue("SampleData");
    consumeWorkspaceIntentMock.mockReturnValue("SampleData");

    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={{
          assets: [asset],
          capabilities: {
            systemInventoryRead: availableSystemInventoryCapability,
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
          ...fullWorkspaceAccess,
          canUseLineage: false,
          canUseQueryHistory: false,
          gates: [
            {
              key: "table_lineage",
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
      expect(screen.getByRole("button", { name: "Sample Data" })).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sample Data" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Lineage unavailable" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Lineage unavailable" }).getAttribute("title")).toBe(
      "Lineage is blocked by workspace access.",
    );
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(useAssetDetailMock.mock.calls[0]?.[1]?.sections || []).toContain("preview");
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("keeps a deep-linked sample tab pending until workspace access resolves", async () => {
    peekWorkspaceIntentMock.mockReturnValue("SampleData");
    consumeWorkspaceIntentMock.mockReturnValue("SampleData");

    const props = {
      assetFqn: asset.fqn,
      bootstrap: enabledBootstrapPayload(),
      contextSeedAssets: [asset],
      onBack: () => {},
      onGovernanceChange: () => {},
      onNavigationStateChange: () => {},
      onOpenGovernance: () => {},
      onOpenLineage: () => {},
      onSelectAsset: () => {},
      onSurfaceReady: () => {},
      runtimeFeatureFlags: [
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
      ],
      sharedVisibleAssetSet: new Set([asset.fqn]),
    };

    const { rerender } = render(<EntityWorkspace {...props} />);

    expect(screen.getByText("Checking preview access...")).not.toBeNull();

    rerender(
      <EntityWorkspace
        {...props}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Checking preview access...")).toBeNull();
    });
    expect(screen.getByText("No preview rows are available for this asset.")).not.toBeNull();
  });

  it("shows neutral lineage affordances while workspace access is unresolved", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Overview");
    consumeWorkspaceIntentMock.mockReturnValue("Overview");

    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checking lineage access..." })).not.toBeNull();
    });
    expect(screen.getAllByText("Checking lineage access...").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Checking access...").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Lineage unavailable" })).toBeNull();
  });

  it("shows neutral column-lineage copy while workspace access is unresolved", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Schema");
    consumeWorkspaceIntentMock.mockReturnValue("Schema");
    const schemaAsset = {
      ...asset,
      loadedSections: ["header", "schema"],
      columns: [
        {
          name: "order_id",
          type: "bigint",
          description: "Primary key",
          tagLabels: [],
          glossaryTerms: [],
        },
      ],
    };
    useAssetDetailMock.mockReturnValue({
      detail: schemaAsset,
      loading: false,
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({
      summary: schemaAsset,
    });

    render(
      <EntityWorkspace
        assetFqn={schemaAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[schemaAsset]}
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
        sharedVisibleAssetSet={new Set([schemaAsset.fqn])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Selected Column")).not.toBeNull();
    });
    expect(screen.getAllByText("Checking lineage access...").length).toBeGreaterThan(0);
  });

  it("preserves preview-derived profiler signals when lineage access is blocked", async () => {
    const profilerAsset = {
      ...asset,
      loadedSections: ["header", "activity", "schema", "profiler"],
      profiler: {
        summary: {
          producerCount: 0,
          consumerCount: 0,
        },
        cards: [
          {
            title: "Sample Data",
            value: "Available",
            status: "good",
            note: "Sample rows surfaced from the live asset.",
          },
          {
            title: "Lineage Context",
            value: "2 assets",
            status: "good",
            note: "Connected assets surfaced in lineage.",
          },
        ],
      },
    };
    peekWorkspaceIntentMock.mockReturnValue("Profiler");
    consumeWorkspaceIntentMock.mockReturnValue("Profiler");
    useAssetDetailMock.mockReturnValue({
      detail: profilerAsset,
      loading: false,
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({
      summary: profilerAsset,
    });

    render(
      <EntityWorkspace
        assetFqn={profilerAsset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[profilerAsset]}
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
        sharedVisibleAssetSet={new Set([profilerAsset.fqn])}
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

    await waitFor(() => {
      expect(screen.getAllByText("Profiler & Evidence").length).toBeGreaterThan(1);
    });

    expect(screen.getByRole("button", { name: "Sample Data" })).not.toBeNull();
    expect(screen.getByText("Sample rows surfaced from the live asset.")).not.toBeNull();
    expect(screen.queryByText("Connected assets surfaced in lineage.")).toBeNull();
    expect(useAssetDetailMock.mock.calls[0]?.[1]?.sections || []).toContain("preview");
  });

  it("keeps hero actions live and preserves the lineage context toggle across rerenders", async () => {
    const onOpenGovernance = vi.fn();
    const onOpenLineage = vi.fn();
    const props = {
      assetFqn: asset.fqn,
      bootstrap: enabledBootstrapPayload(),
      contextSeedAssets: [asset],
      onBack: () => {},
      onGovernanceChange: () => {},
      onNavigationStateChange: () => {},
      onOpenGovernance,
      onOpenLineage,
      onSelectAsset: () => {},
      onSurfaceReady: () => {},
      runtimeFeatureFlags: [
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
      ],
      sharedVisibleAssetSet: new Set([asset.fqn]),
      workspaceAccess: {
        canUseLineage: true,
        canUseQueryHistory: true,
        gates: [],
      },
    };

    const { rerender } = render(<EntityWorkspace {...props} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Lineage" })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Lineage" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Governance" }));
    // Round 18 — the lineage mode toggle surfaces "Operational Lineage"
    // as its visible label; the internal context key stays "Operational
    // Context" so persisted workspace intents remain stable.
    fireEvent.click(screen.getByRole("tab", { name: "Operational Lineage" }));

    expect(onOpenLineage).toHaveBeenCalledWith(asset.fqn, "Data Lineage");
    expect(onOpenGovernance).toHaveBeenCalledWith(asset.fqn);
    expect(screen.getByRole("tab", { name: "Operational Lineage" }).getAttribute("aria-pressed")).toBe("true");

    rerender(<EntityWorkspace {...props} />);

    expect(screen.getByRole("tab", { name: "Operational Lineage" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Lineage" })).not.toBeNull();
  });

  it("ignores seeded lineage graphs on the entity route when live lineage is enabled", async () => {
    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
          ...fullWorkspaceAccess,
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Lineage" })).not.toBeNull();
    });

    expect(useSeededAssetContextMock).toHaveReturnedWith(
      expect.objectContaining({
        summary: expect.any(Object),
      }),
    );
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, true);
  });

  it("uses the shared section shell for overview cards without changing overview interactions", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Overview");
    consumeWorkspaceIntentMock.mockReturnValue("Overview");

    const { container } = render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
          ...fullWorkspaceAccess,
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });

    expect(container.querySelectorAll(".gh-entity-record-section").length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText("Definition").closest(".gh-entity-record-section")).not.toBeNull();
    expect(screen.getByText("Live Record Signals").closest(".gh-entity-record-section")).not.toBeNull();
    expect(screen.getByText("Metadata Controls").closest(".gh-entity-record-section")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Operational Context" }));

    expect(screen.getByRole("button", { name: "Operational Context" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".gh-entity-record-section .gh-surface-panel-section-head").length).toBeGreaterThanOrEqual(6);
  });

  it("uses the shared section shell for metadata controls without changing editor affordances", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Overview");
    consumeWorkspaceIntentMock.mockReturnValue("Overview");
    useAssetMetadataEditorMock.mockReturnValue({
      available: true,
      loading: false,
      error: "",
      submitError: "",
      submitSuccess: "",
      submitting: false,
      hasContract: true,
      config: {
        fields: [
          {
            key: "description",
            label: "Description",
            type: "textarea",
            placeholder: "Describe the asset",
            options: [],
            helpText: "Shown in the entity hero and discovery preview.",
          },
        ],
      },
      save: vi.fn(),
    });

    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
          ...fullWorkspaceAccess,
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Metadata Controls")).not.toBeNull();
    });

    const section = screen.getByText("Metadata Controls").closest(".gh-entity-record-section");
    expect(section).not.toBeNull();
    expect(within(section).getByText("Writable")).not.toBeNull();
    expect(within(section).getByRole("button", { name: "Save metadata" })).not.toBeNull();
    expect(within(section).getByRole("button", { name: "Reset" })).not.toBeNull();
    expect(within(section).getByText("Description")).not.toBeNull();
    expect(
      within(section).getByText("Update the record description and governance classifications when the backend edit surface is available."),
    ).not.toBeNull();
  });

  it("uses the shared section shell for the activity tab without changing governance navigation", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Activity");
    consumeWorkspaceIntentMock.mockReturnValue("Activity");
    const onOpenGovernance = vi.fn();

    render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
        contextSeedAssets={[asset]}
        onBack={() => {}}
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenGovernance={onOpenGovernance}
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
          ...fullWorkspaceAccess,
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Activity & Tasks").length).toBeGreaterThan(1);
    });

    const section = screen.getAllByText("Activity & Tasks")[1].closest(".gh-entity-record-section");
    expect(section).not.toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Open governance workbench" }));
    expect(onOpenGovernance).toHaveBeenCalledWith(asset.fqn);
  });

  it("uses the shared section shell for the sample data tab without changing preview states", async () => {
    peekWorkspaceIntentMock.mockReturnValue("SampleData");
    consumeWorkspaceIntentMock.mockReturnValue("SampleData");

    const { container } = render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
          ...fullWorkspaceAccess,
          canUseLineage: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Sample Data").length).toBeGreaterThan(1);
    });

    const section = container.querySelector(".gh-entity-record-sample-section");
    expect(section).not.toBeNull();
    expect(within(section).getByText("No preview rows are available for this asset.")).not.toBeNull();
  });

  it("uses the shared section shell for the profiler tab without changing profiler content", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Profiler");
    consumeWorkspaceIntentMock.mockReturnValue("Profiler");

    const { container } = render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Profiler & Evidence").length).toBeGreaterThan(1);
    });

    const section = container.querySelector(".gh-entity-record-profiler-section");
    expect(section).not.toBeNull();
    expect(within(section).queryByText("0 upstream")).toBeNull();
    expect(within(section).queryByText("0 downstream")).toBeNull();
    expect(within(section).getByText("No profiler or live evidence signals are available yet.")).not.toBeNull();
  });

  it("uses the shared section shell for the queries tab without changing workload rows", async () => {
    const queryAsset = {
      ...asset,
      loadedSections: ["header", "operational"],
      operationalContext: {
        producers: [
          {
            key: "producer-1",
            entityLabel: "Job",
            name: "daily ingest",
            statementId: "stmt-1",
            relatedAssets: ["main.sales.customers"],
          },
        ],
        consumers: [
          {
            key: "consumer-1",
            entityLabel: "Dashboard",
            name: "Sales dashboard",
            entityId: "dashboard-1",
            relatedAssets: [],
          },
        ],
      },
    };

    peekWorkspaceIntentMock.mockReturnValue("Queries");
    consumeWorkspaceIntentMock.mockReturnValue("Queries");
    useAssetDetailMock.mockReturnValue({
      detail: queryAsset,
      loading: false,
      error: "",
    });

    const { container } = render(
      <EntityWorkspace
        assetFqn={queryAsset.fqn}
        bootstrap={{
          assets: [queryAsset],
          capabilities: {
            systemInventoryRead: availableSystemInventoryCapability,
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
        contextSeedAssets={[queryAsset]}
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
        sharedVisibleAssetSet={new Set([queryAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Usage & Workloads").length).toBeGreaterThan(1);
    });

    const section = container.querySelector(".gh-entity-record-queries-section");
    expect(section).not.toBeNull();
    expect(within(section).getByText("Usage & Workloads")).not.toBeNull();
    expect(within(section).getByText("Producing Workloads")).not.toBeNull();
    expect(within(section).getByText("Consuming Workloads")).not.toBeNull();
    expect(within(section).getByText("daily ingest")).not.toBeNull();
    expect(within(section).getByText("Sales dashboard")).not.toBeNull();
  });

  it("uses the shared section shell for custom properties without changing surfaced values", async () => {
    const propertiesAsset = {
      ...asset,
      loadedSections: ["header", "properties"],
      customProperties: [
        { key: "retention_policy", value: "90 days" },
      ],
      constraints: [
        { name: "pk_orders", type: "PRIMARY KEY", columns: ["order_id"] },
      ],
    };

    peekWorkspaceIntentMock.mockReturnValue("CustomProperties");
    consumeWorkspaceIntentMock.mockReturnValue("CustomProperties");
    useAssetDetailMock.mockReturnValue({
      detail: propertiesAsset,
      loading: false,
      error: "",
    });

    const { container } = render(
      <EntityWorkspace
        assetFqn={propertiesAsset.fqn}
        bootstrap={{
          assets: [propertiesAsset],
          capabilities: {
            systemInventoryRead: availableSystemInventoryCapability,
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
        contextSeedAssets={[propertiesAsset]}
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
        sharedVisibleAssetSet={new Set([propertiesAsset.fqn])}
        workspaceAccess={{
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Custom Properties").length).toBeGreaterThan(1);
    });

    // Post-Phase 8: UC-derived custom properties land inside the
    // CustomPropertiesPanel fallback surface, structural constraints
    // stay in the PropertyList shell. We assert the values survive,
    // not the exact section count.
    expect(screen.getByText("retention_policy")).not.toBeNull();
    expect(screen.getByText("90 days")).not.toBeNull();
    const constraintSections = container.querySelectorAll(".gh-entity-record-property-section");
    expect(constraintSections.length).toBeGreaterThanOrEqual(1);
    const lastConstraintSection = constraintSections[constraintSections.length - 1];
    expect(within(lastConstraintSection).getByText("pk_orders")).not.toBeNull();
    expect(within(lastConstraintSection).getByText("PRIMARY KEY • order_id")).not.toBeNull();
  });

  it("uses the shared section shell for custom properties loading state", async () => {
    peekWorkspaceIntentMock.mockReturnValue("CustomProperties");
    consumeWorkspaceIntentMock.mockReturnValue("CustomProperties");
    useAssetDetailMock.mockReturnValue({
      detail: {
        ...asset,
        loadedSections: ["header"],
      },
      loading: true,
      error: "",
    });

    const { container } = render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Custom Properties").length).toBeGreaterThan(1);
    });

    const section = container.querySelector(".gh-entity-record-properties-section");
    expect(section).not.toBeNull();
    expect(within(section).getByText("Loading custom properties and constraints...")).not.toBeNull();
  });

  it("uses the shared section shell for the schema split pane without changing selection behavior", async () => {
    const schemaAsset = {
      ...asset,
      loadedSections: ["header", "schema"],
      columns: [
        {
          name: "order_id",
          type: "bigint",
          description: "Order identifier",
          tagLabels: ["pii=false"],
          glossaryTerm: "Orders",
          glossaryTerms: ["Orders"],
        },
        {
          name: "customer_id",
          type: "bigint",
          description: "Customer identifier",
          tagLabels: ["sensitivity=restricted"],
          glossaryTerm: "Customers",
          glossaryTerms: ["Customers"],
        },
      ],
    };

    peekWorkspaceIntentMock.mockReturnValue("Schema");
    consumeWorkspaceIntentMock.mockReturnValue("Schema");
    useAssetDetailMock.mockReturnValue({
      detail: schemaAsset,
      loading: false,
      error: "",
    });

    const { container } = render(
      <EntityWorkspace
        assetFqn={schemaAsset.fqn}
        bootstrap={bootstrapPayload()}
        contextSeedAssets={[schemaAsset]}
        onBack={() => {}}
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onSelectAsset={() => {}}
        onSurfaceReady={() => {}}
        sharedVisibleAssetSet={new Set([schemaAsset.fqn])}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Schema").length).toBeGreaterThan(1);
    });

    const schemaSection = container.querySelector(".gh-entity-record-schema-section");
    const selectedSection = container.querySelector(".gh-entity-record-selected-column-section");
    expect(schemaSection).not.toBeNull();
    expect(selectedSection).not.toBeNull();
    expect(within(schemaSection).getByText("order_id")).not.toBeNull();
    expect(within(schemaSection).getByText("customer_id")).not.toBeNull();

    const customerRow = within(schemaSection).getByText("customer_id").closest("tr");
    fireEvent.click(customerRow);
    expect(customerRow.className).toContain("is-active");
    expect(within(selectedSection).getByText("Customer identifier")).not.toBeNull();
    expect(within(selectedSection).getByText("Customers")).not.toBeNull();
    expect(within(selectedSection).getByText("sensitivity=restricted")).not.toBeNull();
    expect(within(selectedSection).getByText(lineageUnavailableReason)).not.toBeNull();
  });

  it("uses the shared section shell for schema loading state", async () => {
    peekWorkspaceIntentMock.mockReturnValue("Schema");
    consumeWorkspaceIntentMock.mockReturnValue("Schema");
    useAssetDetailMock.mockReturnValue({
      detail: {
        ...asset,
        loadedSections: ["header"],
      },
      loading: true,
      error: "",
    });

    const { container } = render(
      <EntityWorkspace
        assetFqn={asset.fqn}
        bootstrap={enabledBootstrapPayload()}
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
          canUseLineage: true,
          canUseQueryHistory: true,
          gates: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Schema").length).toBeGreaterThan(1);
    });

    const schemaSection = container.querySelector(".gh-entity-record-schema-section");
    const selectedSection = container.querySelector(".gh-entity-record-selected-column-section");
    expect(schemaSection).not.toBeNull();
    expect(selectedSection).not.toBeNull();
    expect(within(schemaSection).getByText("Loading schema metadata...")).not.toBeNull();
    expect(within(selectedSection).getByText("Select a column to inspect and edit it.")).not.toBeNull();
  });
});

describe("EntityWorkspace North Star Asset 360 contract", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useAssetAvailabilityMock.mockReset();
    useAsset360Mock.mockReset();
    useLineageMock.mockReset();
    useSeededAssetContextMock.mockReset();
    useAssetMetadataEditorMock.mockReset();
    peekWorkspaceIntentMock.mockReset();
    consumeWorkspaceIntentMock.mockReset();
    setWorkspaceIntentMock.mockReset();
    openAssetRecordSafelyMock.mockReset();
    prefetchAssetAvailabilityMock.mockReset();
    prefetchAssetDetailMock.mockReset();

    const detail = {
      ...asset,
      domain: "Customer",
      dataProduct: "Customer 360",
      certification: "Certified",
      criticality: "High",
      sensitivity: "PII",
      rows: "24,613",
      size: "18.2 GB",
      updatedAt: "2h ago",
      owners: [
        { name: "Emily Carter", title: "Data Owner", role: "owner" },
        { name: "James Wilson", title: "Data Steward", role: "steward" },
      ],
      columns: [
        { name: "customer_id", type: "STRING", description: "Customer key", tagLabels: ["PII"] },
        { name: "email", type: "STRING", description: "Email address", tagLabels: ["PII"] },
      ],
      activity: [
        { id: "a1", title: "Certification reviewed", status: "Approved", detail: "Governance Council", createdAt: "2h ago" },
      ],
      loadedSections: ["header", "activity", "schema", "properties", "operational", "profiler"],
    };

    useAssetDetailMock.mockReturnValue({
      detail,
      loading: false,
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({ summary: detail });
    useAssetAvailabilityMock.mockReturnValue({});
    useAsset360Mock.mockReturnValue({
      data: {
        sameAsset: true,
        asset: detail,
        activity: detail.activity,
        relatedAssets: ["main.sales.orders_daily", "main.sales.customer_dim"],
        downstreamDashboards: [{ id: "dash-1", name: "Customer Operations" }],
        freshness: { state: "fresh", label: "Fresh", message: "2h ago" },
        usage: {
          downstreamAssetCount: 2,
          downstreamConsumerCount: 14,
          queryCount: 128,
          rows: 24613,
        },
        schema: detail.columns,
        loadedSections: detail.loadedSections,
      },
      loading: false,
      refreshing: false,
      error: "",
    });
    useLineageMock.mockReturnValue({
      authoritative: true,
      provisional: false,
      loading: false,
      error: "",
      graph: null,
      payload: { stats: { upstreamCount: 1, downstreamCount: 2 }, columnLineage: { upstream: [], downstream: [] } },
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
    peekWorkspaceIntentMock.mockReturnValue("Overview");
    consumeWorkspaceIntentMock.mockReturnValue("Overview");
    openAssetRecordSafelyMock.mockResolvedValue(true);
  });

  function renderAsset360(overrides = {}) {
    return render(
      <MemoryRouter>
        <EntityWorkspace
          assetFqn={asset.fqn}
          bootstrap={enabledBootstrapPayload()}
          contextSeedAssets={[asset]}
          onBack={() => {}}
          onGovernanceChange={() => {}}
          onNavigationStateChange={() => {}}
          onOpenGovernance={overrides.onOpenGovernance || (() => {})}
          onOpenLineage={overrides.onOpenLineage || (() => {})}
          onSelectAsset={() => {}}
          onSurfaceReady={() => {}}
          runtimeFeatureFlags={[
            { key: "table_lineage_surface", enabled: true, state: "available" },
            { key: "query_history_surface", enabled: true, state: "available" },
          ]}
          sharedVisibleAssetSet={new Set([asset.fqn])}
          workspaceAccess={overrides.workspaceAccess === undefined ? {
            mode: "obo-available",
            observedAt: "2026-04-25T00:00:00Z",
            canUseAssetPreview: true,
            canUseLineage: true,
            canUseQueryHistory: true,
            gates: [],
          } : overrides.workspaceAccess}
        />
      </MemoryRouter>,
    );
  }

  it("renders the North Star Asset 360 cockpit instead of the legacy record shell", () => {
    const { container } = renderAsset360();

    expect(screen.getByRole("heading", { name: "orders" })).not.toBeNull();
    expect(screen.getByText("Asset 360")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open Lineage" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Certify" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Columns" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Governance" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Access" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Sample Data" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Queries" })).toBeNull();
    expect(container.querySelector(".ga-asset360-card-row")).not.toBeNull();
    expect(container.querySelector(".ga-asset360-main-grid")).not.toBeNull();
    expect(screen.getByText("Business Description")).not.toBeNull();
    expect(screen.getByText("Recent Activity")).not.toBeNull();
    expect(screen.getByText("Downstream Dashboards (1)")).not.toBeNull();
  });

  it("keeps the lineage handoff available while workspace access diagnostics are still resolving", () => {
    const onOpenLineage = vi.fn();
    renderAsset360({ onOpenLineage, workspaceAccess: null });

    const lineageButton = screen.getByRole("button", { name: "Open Lineage" });
    expect(lineageButton.disabled).toBe(false);

    fireEvent.click(lineageButton);

    expect(onOpenLineage).toHaveBeenCalledWith(asset.fqn, "Data Lineage");
  });

  it("keeps the lineage handoff available when runtime has only a workspace-wide lineage coverage miss", () => {
    const onOpenLineage = vi.fn();
    const coverageMissAccess = {
      mode: "obo-available",
      observedAt: "2026-05-05T00:00:00Z",
      canUseAssetPreview: true,
      canUseLineage: false,
      canUseQueryHistory: false,
      gates: [
        {
          key: "table_lineage",
          state: "unknown",
          reason: "No lineage-observed catalogs are detected yet.",
          proofSource: "No lineage-observed catalogs are detected yet.",
        },
      ],
    };
    renderAsset360({
      onOpenLineage,
      workspaceAccess: coverageMissAccess,
    });

    const lineageButton = screen.getByRole("button", { name: "Open Lineage" });
    expect(lineageButton.disabled).toBe(false);

    fireEvent.click(lineageButton);

    expect(onOpenLineage).toHaveBeenCalledWith(asset.fqn, "Data Lineage");
  });

  it("keeps the lineage handoff available from an unavailable asset-detail placeholder", () => {
    const onOpenLineage = vi.fn();
    useAssetDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      error: "The metadata request timed out before Databricks returned a response.",
    });
    useSeededAssetContextMock.mockReturnValue({ summary: null });
    useAsset360Mock.mockReturnValue({
      data: null,
      loading: false,
      refreshing: false,
      error: "",
    });

    renderAsset360({ onOpenLineage });

    expect(screen.getByRole("heading", { name: "Asset unavailable" })).not.toBeNull();
    const lineageButton = screen.getByRole("button", { name: "Open Lineage" });
    expect(lineageButton.disabled).toBe(false);

    fireEvent.click(lineageButton);

    expect(onOpenLineage).toHaveBeenCalledWith(asset.fqn, "Data Lineage");
  });

  it("preserves the Asset 360 shell while the selected record is loading", () => {
    useSeededAssetContextMock.mockReturnValue({ summary: null });
    useAssetDetailMock.mockReturnValue({
      detail: null,
      loading: true,
      error: "",
    });

    renderAsset360();

    expect(screen.getByText("Loading asset record")).not.toBeNull();
    expect(screen.getByText("Asset 360")).not.toBeNull();
    expect(screen.getByLabelText("Entity sections")).not.toBeNull();
    expect(screen.getAllByText("Schema").length).toBeGreaterThan(0);
    expect(screen.getByText("Recent Activity")).not.toBeNull();
  });

  it("preserves the Asset 360 shell when a linked metadata record is unavailable", () => {
    useSeededAssetContextMock.mockReturnValue({ summary: null });
    useAssetDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      error: "Metadata record is not visible to this actor.",
    });

    renderAsset360();

    expect(screen.getByText("Asset unavailable")).not.toBeNull();
    expect(screen.getByText("The selected asset could not be opened")).not.toBeNull();
    expect(screen.getAllByText("Metadata record is not visible to this actor.").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Entity sections")).not.toBeNull();
    expect(screen.getAllByText("Related Assets").length).toBeGreaterThan(0);
  });

  it("does not imply a positive freshness trend when live freshness evidence is unavailable", () => {
    const unavailableDetail = {
      ...asset,
      domain: "Customer",
      dataProduct: "Customer 360",
      certification: "Trusted",
      criticality: "Critical",
      sensitivity: "Confidential",
      rows: "1",
      size: "",
      updatedAt: "",
      owners: [
        { name: "Customer Steward", title: "Business Owner", role: "owner" },
        { name: "Atlas Demo", title: "Technical Owner", role: "steward" },
      ],
      columns: [
        { name: "asset_key", type: "STRING", tagLabels: [] },
      ],
      activity: [],
      loadedSections: ["header", "schema"],
    };
    useAssetDetailMock.mockReturnValue({
      detail: unavailableDetail,
      loading: false,
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({ summary: unavailableDetail });
    useAsset360Mock.mockReturnValue({
      data: {
        sameAsset: true,
        asset: unavailableDetail,
        activity: [],
        relatedAssets: [],
        downstreamDashboards: [],
        freshness: {
          state: "unavailable",
          label: "Unavailable",
          message: "Freshness is unavailable until a live signal exists.",
        },
        usage: {},
        schema: unavailableDetail.columns,
        loadedSections: unavailableDetail.loadedSections,
      },
      loading: false,
      refreshing: false,
      error: "",
    });

    const { container } = renderAsset360();

    const freshnessCard = screen.getByText("Freshness").closest(".ga-asset360-signal-card");
    expect(freshnessCard).not.toBeNull();
    expect(freshnessCard?.textContent).toContain("Unavailable");
    expect(freshnessCard?.textContent).toContain("No live freshness signal");
    expect(freshnessCard?.className).not.toContain("tone-good");
    expect(container.querySelector(".ga-asset360-sparkline")).toBeNull();
  });

  it("keeps hero actions functional against the selected asset", () => {
    const onOpenGovernance = vi.fn();
    const onOpenLineage = vi.fn();
    renderAsset360({ onOpenGovernance, onOpenLineage });

    fireEvent.click(screen.getByRole("button", { name: "Request Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Certify" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Lineage" }));

    expect(onOpenGovernance).toHaveBeenCalledTimes(2);
    expect(onOpenGovernance).toHaveBeenCalledWith(asset.fqn);
    expect(onOpenLineage).toHaveBeenCalledWith(asset.fqn, "Data Lineage");
  });

  it("switches the mockup-order tabs without falling back to legacy tab keys", () => {
    renderAsset360();

    fireEvent.click(screen.getByRole("button", { name: "Governance" }));
    expect(screen.getByText("Governance classifications, coverage signals, and steward-editable metadata for this asset.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    expect(screen.getByText("Live Record Signals")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByText("Activity & Tasks")).not.toBeNull();
  });
});
