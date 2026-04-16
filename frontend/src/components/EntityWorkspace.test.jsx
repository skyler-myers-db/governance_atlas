import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function enabledBootstrapPayload() {
  return {
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
    openAssetRecordSafelyMock.mockReset();
    prefetchAssetAvailabilityMock.mockReset();
    prefetchAssetDetailMock.mockReset();

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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Lineage" })).toBeNull();
    expect(screen.getByRole("button", { name: "Lineage unavailable" }).disabled).toBe(true);
    expect(screen.getAllByText(lineageUnavailableReason)[0]).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
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
    expect(screen.getByText("Checking access...")).not.toBeNull();
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
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
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
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
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
    fireEvent.click(screen.getByRole("button", { name: "Operational Context" }));

    expect(onOpenLineage).toHaveBeenCalledWith(asset.fqn, "Data Lineage");
    expect(onOpenGovernance).toHaveBeenCalledWith(asset.fqn);
    expect(screen.getByRole("button", { name: "Operational Context" }).getAttribute("aria-pressed")).toBe("true");

    rerender(<EntityWorkspace {...props} />);

    expect(screen.getByRole("button", { name: "Operational Context" }).getAttribute("aria-pressed")).toBe("true");
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
          canUseLineage: true,
          canUseQueryHistory: true,
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
          canUseLineage: true,
          canUseQueryHistory: true,
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
          canUseLineage: true,
          canUseQueryHistory: true,
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
          canUseLineage: true,
          canUseQueryHistory: true,
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
          canUseLineage: true,
          canUseQueryHistory: true,
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
      expect(screen.getAllByText("Profiler & Data Quality").length).toBeGreaterThan(1);
    });

    const section = container.querySelector(".gh-entity-record-profiler-section");
    expect(section).not.toBeNull();
    expect(within(section).getByText("0 upstream")).not.toBeNull();
    expect(within(section).getByText("0 downstream")).not.toBeNull();
    expect(within(section).getByText("No profiler or metadata quality signals are available yet.")).not.toBeNull();
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

    const sections = container.querySelectorAll(".gh-entity-record-property-section");
    expect(sections.length).toBe(2);
    expect(within(sections[0]).getByText("retention_policy")).not.toBeNull();
    expect(within(sections[0]).getByText("90 days")).not.toBeNull();
    expect(within(sections[1]).getByText("pk_orders")).not.toBeNull();
    expect(within(sections[1]).getByText("PRIMARY KEY • order_id")).not.toBeNull();
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
