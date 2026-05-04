import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminWorkspace from "./AdminWorkspace";
import { fetchAdminControlCenter, fetchAdminTruthCheck } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchAdminControlCenter: vi.fn(),
  fetchAdminTruthCheck: vi.fn(),
}));

const truthCheckPayload = {
  meta: { source: "system.information_schema", state: "available" },
  data: {
    discoveryCatalogs: ["datapact", "finance_prod"],
    hiddenCatalogs: ["system", "samples"],
    metastore: {
      catalogTotal: 12,
      schemaTotalForDiscovery: 8,
      tableTotalForDiscovery: 240,
      perCatalog: [
        {
          catalog: "datapact",
          configured: true,
          metastore: { schemaCount: 5, tableCount: 200 },
          ui: { inventoryAssetCount: 198, visibleAssetCount: 195 },
          drift: { inventoryDelta: 2, hiddenByVisibility: 3 },
        },
        {
          catalog: "finance_prod",
          configured: true,
          metastore: { schemaCount: 3, tableCount: 40 },
          ui: { inventoryAssetCount: 40, visibleAssetCount: 40 },
          drift: { inventoryDelta: 0, hiddenByVisibility: 0 },
        },
      ],
    },
    ui: { inventoryTotal: 238, visibleTotal: 235 },
    drift: { inventoryDelta: 2, hiddenByVisibility: 3, warnings: [] },
    queries: [
      { label: "system.information_schema.catalogs", sql: "SELECT 1", rowCount: 12, elapsedMs: 312, error: null },
    ],
    observedAt: "2026-05-04T07:50:00Z",
  },
};

const controlCenterPayload = {
  meta: {
    source: "runtime-diagnostics+governance-store",
    state: "available",
    authoritative: true,
  },
  environment: {
    displayLabel: "Dev · datapact.atlas",
  },
  scheduledJobs: [
    {
      id: "job-1",
      name: "UC metadata sweeper",
      schedule: "Every 15 min",
      lastRun: "4 min ago",
      status: "healthy",
      runUrl: "https://example.cloud.databricks.com/jobs/123/runs/456",
    },
    { id: "job-2", name: "Lineage collector", schedule: "Every 1 hr", lastRun: "21 min ago", status: "healthy" },
    { id: "job-3", name: "Trust score recompute", schedule: "Daily 03:00 UTC", lastRun: "7 hr ago", status: "slow" },
  ],
  integrations: [
    { key: "unityCatalog", label: "Unity Catalog", subtitle: "Connected live", state: "ok" },
    { key: "warehouse", label: "Databricks SQL Warehouse", subtitle: "gov atlas wh M", state: "ok" },
    { key: "jobs", label: "Lakeflow Jobs", subtitle: "6 jobs scheduled", state: "ok" },
  ],
  policyCoverage: {
    rules: [
      { key: "owner", label: "Owner required on production", value: 96, state: "healthy" },
      { key: "cde", label: "CDEs must have description", value: 100, state: "healthy" },
      { key: "pii", label: "PII columns require tag", value: 92, state: "healthy" },
    ],
  },
};

function renderAdmin(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminWorkspace {...props} />
    </QueryClientProvider>,
  );
}

describe("AdminWorkspace", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    fetchAdminControlCenter.mockReset();
    fetchAdminControlCenter.mockResolvedValue(controlCenterPayload);
    fetchAdminTruthCheck.mockReset();
    fetchAdminTruthCheck.mockResolvedValue(truthCheckPayload);
  });

  it("renders the Control Center surface", async () => {
    renderAdmin();

    expect(await screen.findByText("Control Center")).toBeDefined();
    expect(screen.getByText("Atlas runtime, integrations, and policy")).toBeDefined();
    expect(screen.getByText(/Review runtime diagnostics for jobs/)).toBeDefined();
    expect(await screen.findByText("UC metadata sweeper")).toBeDefined();
    expect(screen.queryByText("Dev · datapact.atlas")).toBeNull();
    expect(screen.getByText("Scheduled jobs")).toBeDefined();
    expect(screen.getByText("Integrations")).toBeDefined();
    expect(screen.getByText("Policy coverage")).toBeDefined();
    expect(screen.getByText("Unity Catalog")).toBeDefined();
    expect(screen.getByText("Owner required on production")).toBeDefined();
  });

  it("does not call the admin endpoint for a reader shell", () => {
    renderAdmin({ shell: { role: "Reader", userEmail: "reader@example.com" } });

    expect(fetchAdminControlCenter).not.toHaveBeenCalled();
    expect(screen.getByText("Control Center is admin-only")).toBeDefined();
    expect(screen.getByText("Ask a workspace admin to grant administration access.")).toBeDefined();
  });

  it("preserves the Control Center shell while diagnostics load", () => {
    fetchAdminControlCenter.mockReturnValue(new Promise(() => {}));
    renderAdmin();

    expect(screen.getByText("Atlas runtime, integrations, and policy")).toBeDefined();
    expect(screen.getByText("Loading control center")).toBeDefined();
  });

  it("preserves the Control Center shell when diagnostics are unavailable", async () => {
    fetchAdminControlCenter.mockRejectedValue(new Error("Admin endpoint failed"));
    renderAdmin();

    expect(await screen.findByText("Control Center unavailable")).toBeDefined();
    expect(screen.getByText("Atlas runtime, integrations, and policy")).toBeDefined();
  });

  it("keeps missing live signals truthful with unavailable rows", async () => {
    fetchAdminControlCenter.mockResolvedValue({ environment: { displayLabel: "Dev · empty" } });
    renderAdmin();

    expect(await screen.findByText("No backed scheduled-job inventory is available yet.")).toBeDefined();
    expect(screen.getAllByText("Runtime signal unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("No backed policy-coverage rows are available yet.")).toBeDefined();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Unavailable policy signal/ })).toBeNull();
  });

  it("suppresses non-authoritative provenance banners while preserving real warnings", async () => {
    fetchAdminControlCenter.mockResolvedValue({
      ...controlCenterPayload,
      meta: {
        ...controlCenterPayload.meta,
        warnings: ["Prototype mock data, not live Databricks evidence."],
      },
    });
    const nonAuthoritativeRender = renderAdmin();
    await screen.findByText("Non-authoritative Control Center diagnostics were rejected. Live diagnostics are required for populated runtime, integration, and policy rows.");
    expect(screen.queryByText("Prototype mock data, not live Databricks evidence.")).toBeNull();
    expect(screen.queryByText("Connected live")).toBeNull();
    expect(screen.getByText("No backed scheduled-job inventory is available yet.")).toBeDefined();
    expect(screen.getAllByText("Runtime signal unavailable").length).toBeGreaterThan(0);
    nonAuthoritativeRender.unmount();

    fetchAdminControlCenter.mockResolvedValue({
      ...controlCenterPayload,
      meta: {
        ...controlCenterPayload.meta,
        warnings: ["Policy diagnostics are partially unavailable."],
      },
    });
    renderAdmin();
    expect(await screen.findByText("Policy diagnostics are partially unavailable.")).toBeDefined();
  });

  it("reports local row selections without route mutation", async () => {
    renderAdmin();

    await screen.findByText("21 min ago");
    const lineageCollector = screen.getByText("Every 1 hr").closest("button");
    fireEvent.click(lineageCollector);
    expect(screen.getByText("Lineage collector diagnostics selected.")).toBeDefined();
    expect(lineageCollector.getAttribute("aria-current")).toBe("true");
    expect(screen.getByLabelText("Selected control detail")).toBeDefined();
    expect(screen.getByText("Runtime job diagnostics")).toBeDefined();
    expect(screen.getByRole("button", { name: /Open linked resource/i }).disabled).toBe(true);

    const unityCatalog = screen.getByRole("button", { name: /Unity Catalog/ });
    fireEvent.click(unityCatalog);
    expect(screen.getByText("Unity Catalog integration diagnostics selected.")).toBeDefined();
    expect(unityCatalog.getAttribute("aria-current")).toBe("true");
    expect(screen.getAllByText("Connected live").length).toBeGreaterThan(0);
  });

  it("opens reported Databricks job URLs from the selected job detail", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderAdmin();

    await screen.findByText("4 min ago");
    fireEvent.click(screen.getByText("Every 15 min").closest("button"));
    const openLinked = screen.getByRole("button", { name: /Open linked resource/i });
    expect(openLinked.disabled).toBe(false);
    fireEvent.click(openLinked);

    expect(openSpy).toHaveBeenCalledWith(
      "https://example.cloud.databricks.com/jobs/123/runs/456",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.getByText("UC metadata sweeper linked resource opened.")).toBeDefined();
    openSpy.mockRestore();
  });

  it("opens policy diagnostics for available and unavailable policy rows", async () => {
    renderAdmin();

    await screen.findByText("96%");
    fireEvent.click(screen.getByText("96%").closest("button"));
    expect(screen.getByText("96% coverage from diagnostics.")).toBeDefined();
  });

  it("rejects diagnostics flagged by evidenceKind before rendering runtime rows", async () => {
    fetchAdminControlCenter.mockResolvedValue({
      ...controlCenterPayload,
      meta: {
        ...controlCenterPayload.meta,
        evidenceKind: "non_authoritative_mock_capture",
      },
    });
    renderAdmin();

    expect(await screen.findByText("Non-authoritative Control Center diagnostics were rejected. Live diagnostics are required for populated runtime, integration, and policy rows.")).toBeDefined();
    expect(screen.queryByText("Connected live")).toBeNull();
    expect(screen.getByText("No backed scheduled-job inventory is available yet.")).toBeDefined();
    expect(screen.getAllByText("Runtime signal unavailable").length).toBeGreaterThan(0);
  });

  it("renders the Metastore truth check tab when selected", async () => {
    renderAdmin();
    // Wait for the Operations tab to mount, then switch tabs.
    await screen.findByText("Atlas runtime, integrations, and policy");
    fireEvent.click(screen.getByTestId("admin-tab-truth-check"));
    expect(await screen.findByText("Unity Catalog ground truth vs. surfaced inventory")).toBeDefined();
    expect(screen.getByText("Re-run truth check")).toBeDefined();
    expect(screen.getAllByText("datapact").length).toBeGreaterThan(0);
    expect(screen.getByText("system.information_schema.catalogs")).toBeDefined();
    // Drift cells render the +/- formatted delta.
    expect(screen.getAllByText("+2").length).toBeGreaterThan(0);
    expect(fetchAdminTruthCheck).toHaveBeenCalled();
  });

  it("does NOT call /admin/truth-check until the truth-check tab is opened", async () => {
    renderAdmin();
    await screen.findByText("Atlas runtime, integrations, and policy");
    expect(fetchAdminTruthCheck).not.toHaveBeenCalled();
  });

  it("blocks the Metastore truth check tab for non-admin shells", async () => {
    renderAdmin({ shell: { role: "Reader", userEmail: "reader@example.com" } });
    fireEvent.click(screen.getByTestId("admin-tab-truth-check"));
    expect(await screen.findByText("Metastore truth check is admin-only")).toBeDefined();
    expect(fetchAdminTruthCheck).not.toHaveBeenCalled();
  });
});
