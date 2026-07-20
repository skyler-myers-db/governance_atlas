/**
 * Regression tests for the Control Center "incomplete product" gap fixes:
 * backend-truth integrations, jobsReason empty states, metadata-coverage
 * re-scope, operations summary strip, rendered activity feed, hydration
 * skeletons, and truth-check formatting fixes.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminWorkspace from "../AdminWorkspace";
import { fetchAdminControlCenter, fetchAdminTruthCheck } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  fetchAdminControlCenter: vi.fn(),
  fetchAdminTruthCheck: vi.fn(),
}));

const richControlCenterPayload = {
  meta: { source: "runtime-diagnostics+governance-store", state: "available", authoritative: true },
  environment: { catalog: "datapact", schema: "atlas", target: "dev", warehouseId: "wh-123" },
  role: { value: "admin", label: "Platform Admin", state: "available" },
  coverage: { metadataCoverage: 95.5 },
  runtimeSummary: {
    state: "live",
    catalogCount: 7,
    warehouseId: "wh-123",
    host: "https://dbc.example.com",
    authMode: "oauth-m2m-env",
  },
  access: {
    users: { value: 12, state: "available" },
    roles: { value: 3, state: "available" },
  },
  jobs: [
    { id: "11", name: "UC metadata sweeper", schedule: "0 0 3 * * ? · UTC", lastRun: "Jul 19, 03:00 UTC", status: "Success" },
  ],
  jobsState: "available",
  jobsReason: "",
  integrations: [
    { key: "unityCatalog", label: "Unity Catalog", subtitle: "Workspace inventory", state: "connected" },
    {
      key: "lineageService",
      label: "Lineage Service",
      subtitle: "Unity Catalog lineage",
      state: "unavailable",
      reason: "Dedicated lineage service health is not exposed by the current Admin payload.",
    },
    { key: "aiCopilot", label: "AI Copilot", subtitle: "Atlas AI Genie", state: "connected" },
    { key: "sqlWarehouse", label: "Databricks SQL Warehouse", subtitle: "Warehouse wh-123", state: "connected" },
    { key: "lakeflowJobs", label: "Lakeflow Jobs", subtitle: "12 jobs in workspace inventory", state: "connected" },
  ],
  policyRequirements: {
    byDomain: [
      {
        domain: "Customer",
        coverage: 100,
        coverageKind: "metadata",
        metadataCoverage: 100,
        state: "available",
        reason: "Metadata coverage from visible-asset diagnostics; policy-enforcement coverage is not yet backed.",
      },
      {
        domain: "Finance",
        coverage: 97.8,
        coverageKind: "metadata",
        metadataCoverage: 97.8,
        state: "available",
        reason: "Metadata coverage from visible-asset diagnostics; policy-enforcement coverage is not yet backed.",
      },
    ],
  },
  recentAdminActivity: [
    {
      id: "AUD-REAL-1",
      title: "Asset Metadata Updated",
      detail: "main.customer.customer_dim",
      createdAt: "2026-07-18T09:00:00Z",
      actorEmail: "skyler@entrada.ai",
      status: "success",
    },
  ],
};

const truthCheckPayload = {
  meta: { source: "system.information_schema", state: "available" },
  data: {
    discoveryCatalogs: ["datapact", "ghost"],
    hiddenCatalogs: ["system"],
    metastore: {
      catalogTotal: 7,
      schemaTotalForDiscovery: 2,
      tableTotalForDiscovery: 5,
      perCatalog: [
        {
          catalog: "datapact",
          configured: true,
          state: "populated",
          stateReason: "",
          metastore: { schemaCount: 2, tableCount: 5 },
          ui: { inventoryAssetCount: 5, visibleAssetCount: 5 },
          drift: { inventoryDelta: 0, hiddenByVisibility: 0 },
        },
        {
          catalog: "ghost",
          configured: true,
          state: "empty-or-unauthorized",
          stateReason:
            "No schemas or tables are visible to the app principal in this catalog — it is either empty or the principal lacks information_schema grants.",
          metastore: { schemaCount: 0, tableCount: 0 },
          ui: { inventoryAssetCount: 0, visibleAssetCount: 0 },
          drift: { inventoryDelta: 0, hiddenByVisibility: 0 },
        },
      ],
    },
    ui: { inventoryTotal: 5, visibleTotal: 5 },
    drift: {
      inventoryDelta: 3,
      hiddenByVisibility: 0,
      warnings: ["3 metastore table(s) are not in the surfaced inventory — likely a stale inventory cache or hidden-schema rules."],
    },
    queries: [
      { label: "system.information_schema.catalogs", sql: "SELECT 1", rowCount: 7, elapsedMs: 0, error: null },
    ],
    observedAt: "2026-07-19T22:04:11Z",
  },
};

function renderAdmin(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminWorkspace {...props} />
    </QueryClientProvider>,
  );
}

describe("AdminWorkspace gap fixes", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    fetchAdminControlCenter.mockReset();
    fetchAdminControlCenter.mockResolvedValue(richControlCenterPayload);
    fetchAdminTruthCheck.mockReset();
    fetchAdminTruthCheck.mockResolvedValue(truthCheckPayload);
  });

  it("renders backend integration rows verbatim and drops aspirational slots", async () => {
    renderAdmin();

    expect(await screen.findByText("AI Copilot")).toBeDefined();
    expect(screen.getByText("Lineage Service")).toBeDefined();
    expect(screen.getByText("Databricks SQL Warehouse")).toBeDefined();
    expect(screen.getByText("Lakeflow Jobs")).toBeDefined();
    // Aspirational products with no runtime probe must not render fake rows.
    expect(screen.queryByText("Model Serving")).toBeNull();
    expect(screen.queryByText("Incident management")).toBeNull();
    // Backend-truth rendering: no fabricated "Runtime signal unavailable"
    // placeholders when real rows exist.
    expect(screen.queryByText("Runtime signal unavailable")).toBeNull();
  });

  it("explains a genuinely empty jobs table with the backend jobsReason", async () => {
    fetchAdminControlCenter.mockResolvedValue({
      ...richControlCenterPayload,
      jobs: [],
      jobsState: "unavailable",
      jobsReason: "No Databricks Jobs API rows were returned for this runtime.",
    });
    renderAdmin();

    expect(await screen.findByText("No Databricks Jobs API rows were returned for this runtime.")).toBeDefined();
  });

  it("re-scopes the policy panel to metadata coverage with enabled rows", async () => {
    renderAdmin();

    expect(await screen.findByText("Metadata coverage by domain")).toBeDefined();
    expect(screen.getByText("Metadata completeness per domain — not policy-enforcement coverage")).toBeDefined();
    const customerRow = screen.getByText("100%").closest("button");
    expect(customerRow.disabled).toBe(false);
    fireEvent.click(customerRow);
    expect(screen.getByText("Customer: 100% metadata coverage from policy diagnostics.")).toBeDefined();
  });

  it("renders the operations summary strip from payload data", async () => {
    renderAdmin();

    // Await data-dependent text: headers render before the fetch resolves.
    expect(await screen.findByText("Live")).toBeDefined();
    expect(screen.getByText("Runtime summary")).toBeDefined();
    expect(screen.getByText("12 users")).toBeDefined();
    expect(screen.getByText("3 roles")).toBeDefined();
    expect(screen.getByText("96%")).toBeDefined();
    expect(screen.getByText("datapact.atlas")).toBeDefined();
    expect(screen.getByText("Platform Admin")).toBeDefined();
  });

  it("renders the recent admin activity feed", async () => {
    renderAdmin();

    expect(await screen.findByText("Asset Metadata Updated")).toBeDefined();
    expect(screen.getByText("Recent admin activity")).toBeDefined();
    expect(screen.getByText("main.customer.customer_dim")).toBeDefined();
  });

  it("renders skeletons — never Unavailable rows — while the payload hydrates", async () => {
    fetchAdminControlCenter.mockResolvedValue({
      meta: { state: "loading", capabilities: { hydrating: true } },
      jobs: [],
      integrations: [],
    });
    renderAdmin();

    await screen.findByText("Scheduled jobs");
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.queryByText("No backed scheduled-job inventory is available yet.")).toBeNull();
    expect(screen.queryByText("Runtime signal unavailable")).toBeNull();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("formats truth-check output and badges zero-visibility catalogs", async () => {
    renderAdmin();
    await screen.findByText("Atlas runtime, integrations, and policy");
    fireEvent.click(screen.getByTestId("admin-tab-truth-check"));

    expect(await screen.findByText("Unity Catalog ground truth vs. surfaced inventory")).toBeDefined();
    // Zero-wall rows get an explanatory badge instead of bare zeros.
    expect(screen.getByText("No objects visible to app principal")).toBeDefined();
    // Drift explanation from the backend surfaces as a warning banner.
    expect(
      screen.getByText(
        "3 metastore table(s) are not in the surfaced inventory — likely a stale inventory cache or hidden-schema rules.",
      ),
    ).toBeDefined();
    // Observed timestamp is humanized, not raw ISO.
    expect(screen.queryByText("2026-07-19T22:04:11Z")).toBeNull();
    // A legit 0 ms probe renders "0 ms", not "elapsed unavailable".
    fireEvent.click(screen.getByText(/SQL probes/));
    expect(screen.getByText(/0 ms/)).toBeDefined();
    expect(screen.queryByText(/elapsed unavailable/)).toBeNull();
  });
});
