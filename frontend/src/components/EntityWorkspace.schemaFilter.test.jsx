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

vi.mock("../hooks/useAsset360", () => ({
  useAsset360: () => ({
    data: null,
    loading: false,
    refreshing: false,
    error: "",
    meta: null,
    refetch: vi.fn(),
  }),
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

const baseAsset = {
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
  operationalContext: { producers: [], consumers: [] },
  profiler: { summary: { producerCount: 0, consumerCount: 0 }, cards: [] },
  usage: { producerCount: 0, consumerCount: 0 },
  loadedSections: ["header"],
};

const availableSystemInventoryCapability = {
  available: true,
  state: "available",
  reason: "",
};

function enabledBootstrapPayload() {
  return {
    assets: [baseAsset],
    capabilities: {
      systemInventoryRead: availableSystemInventoryCapability,
      tableLineage: { available: true, state: "available", reason: "" },
      workloadVisibility: { available: true, state: "available", reason: "" },
    },
  };
}

function schemaAsset() {
  return {
    ...baseAsset,
    loadedSections: ["header", "schema"],
    columns: [
      {
        name: "customer_id",
        type: "STRING",
        description: "Surrogate key for the customer",
        tagLabels: [],
        glossaryTerms: [],
        nullable: false,
        defaultValue: "",
        constraints: [
          { name: "pk_orders", type: "PRIMARY KEY" },
          { name: "orders_customer_unique", type: "UNIQUE" },
        ],
      },
      {
        name: "order_total",
        type: "DECIMAL(12,2)",
        description: "Final order total in USD",
        tagLabels: [],
        glossaryTerms: [],
        nullable: true,
        defaultValue: "0.00",
        constraints: [],
      },
      {
        name: "region",
        type: "STRING",
        description: "Region code for the billing address",
        tagLabels: [],
        glossaryTerms: [],
        nullable: null,
        defaultValue: "",
        constraints: [],
      },
    ],
  };
}

function renderWorkspace(detail) {
  peekWorkspaceIntentMock.mockReturnValue("Schema");
  consumeWorkspaceIntentMock.mockReturnValue("Schema");
  useAssetDetailMock.mockReturnValue({
    detail,
    loading: false,
    error: "",
  });
  useSeededAssetContextMock.mockReturnValue({ summary: detail });
  useLineageMock.mockReturnValue({
    authoritative: true,
    provisional: false,
    loading: false,
    error: "",
    graph: null,
    payload: null,
  });
  useAssetAvailabilityMock.mockReturnValue({});
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

  return render(
    <EntityWorkspace
      assetFqn={detail.fqn}
      bootstrap={enabledBootstrapPayload()}
      contextSeedAssets={[detail]}
      onBack={() => {}}
      onGovernanceChange={() => {}}
      onNavigationStateChange={() => {}}
      onOpenGovernance={() => {}}
      onOpenLineage={() => {}}
      onSelectAsset={() => {}}
      onSurfaceReady={() => {}}
      runtimeFeatureFlags={[
        { key: "table_lineage_surface", enabled: true, state: "available" },
        { key: "query_history_surface", enabled: true, state: "available" },
      ]}
      sharedVisibleAssetSet={new Set([detail.fqn])}
      workspaceAccess={{
        canUseLineage: true,
        canUseQueryHistory: true,
        gates: [],
      }}
    />,
  );
}

describe("EntityWorkspace schema tab — column filter + extended metadata", () => {
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
    openAssetRecordSafelyMock.mockResolvedValue(true);
  });

  it("filters schema rows by name or description substring and restores the list when cleared", async () => {
    const detail = schemaAsset();
    const { container } = renderWorkspace(detail);

    await waitFor(() => {
      expect(container.querySelector(".gh-schema-table")).not.toBeNull();
    });

    const schemaTable = container.querySelector(".gh-schema-table");
    expect(schemaTable).not.toBeNull();

    // All three columns rendered initially.
    expect(within(schemaTable).getByText("customer_id")).not.toBeNull();
    expect(within(schemaTable).getByText("order_total")).not.toBeNull();
    expect(within(schemaTable).getByText("region")).not.toBeNull();

    const filterInput = screen.getByLabelText("Filter columns");

    // Name match.
    fireEvent.change(filterInput, { target: { value: "customer" } });
    expect(within(schemaTable).getByText("customer_id")).not.toBeNull();
    expect(within(schemaTable).queryByText("order_total")).toBeNull();
    expect(within(schemaTable).queryByText("region")).toBeNull();

    // Description match (case insensitive).
    fireEvent.change(filterInput, { target: { value: "USD" } });
    expect(within(schemaTable).getByText("order_total")).not.toBeNull();
    expect(within(schemaTable).queryByText("customer_id")).toBeNull();
    expect(within(schemaTable).queryByText("region")).toBeNull();

    // Zero-match stub row.
    fireEvent.change(filterInput, { target: { value: "nonexistent" } });
    expect(
      within(schemaTable).getByText(/No columns match/),
    ).not.toBeNull();

    // Clearing restores the full list.
    fireEvent.change(filterInput, { target: { value: "" } });
    expect(within(schemaTable).getByText("customer_id")).not.toBeNull();
    expect(within(schemaTable).getByText("order_total")).not.toBeNull();
    expect(within(schemaTable).getByText("region")).not.toBeNull();
  });

  it("renders Nullable / Default / Constraints columns with appropriate placeholders", async () => {
    const detail = schemaAsset();
    const { container } = renderWorkspace(detail);

    await waitFor(() => {
      expect(container.querySelector(".gh-schema-table")).not.toBeNull();
    });

    const schemaTable = container.querySelector(".gh-schema-table");
    expect(schemaTable).not.toBeNull();

    // Header columns are present.
    expect(within(schemaTable).getByText("Nullable")).not.toBeNull();
    expect(within(schemaTable).getByText("Default")).not.toBeNull();
    expect(within(schemaTable).getByText("Constraints")).not.toBeNull();

    // customer_id: NOT NULL + PK + UNIQUE chips.
    const customerRow = within(schemaTable).getByText("customer_id").closest("tr");
    expect(within(customerRow).getByText("No")).not.toBeNull();
    expect(within(customerRow).getByText("PRIMARY KEY")).not.toBeNull();
    expect(within(customerRow).getByText("UNIQUE")).not.toBeNull();

    // order_total: nullable + default value rendered as code.
    const orderRow = within(schemaTable).getByText("order_total").closest("tr");
    expect(within(orderRow).getByText("Yes")).not.toBeNull();
    expect(within(orderRow).getByText("0.00")).not.toBeNull();

    // region: unknown nullability renders placeholder rather than a chip.
    const regionRow = within(schemaTable).getByText("region").closest("tr");
    const placeholders = within(regionRow).getAllByText("—");
    // At least Nullable, Default, Constraints columns use the placeholder.
    expect(placeholders.length).toBeGreaterThanOrEqual(3);
  });
});
