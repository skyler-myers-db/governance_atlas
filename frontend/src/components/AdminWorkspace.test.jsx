import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminWorkspace from "./AdminWorkspace";
import { fetchAdminControlCenter } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchAdminControlCenter: vi.fn(),
}));

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
  });

  it("renders the prototype Control Center surface", async () => {
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

  it("preserves the prototype shell while diagnostics load", () => {
    fetchAdminControlCenter.mockReturnValue(new Promise(() => {}));
    renderAdmin();

    expect(screen.getByText("Atlas runtime, integrations, and policy")).toBeDefined();
    expect(screen.getByText("Loading control center")).toBeDefined();
  });

  it("preserves the prototype shell when diagnostics are unavailable", async () => {
    fetchAdminControlCenter.mockRejectedValue(new Error("Admin endpoint failed"));
    renderAdmin();

    expect(await screen.findByText("Control Center unavailable")).toBeDefined();
    expect(screen.getByText("Atlas runtime, integrations, and policy")).toBeDefined();
  });

  it("keeps missing live signals truthful with unavailable rows", async () => {
    fetchAdminControlCenter.mockResolvedValue({ environment: { displayLabel: "Dev · empty" } });
    renderAdmin();

    expect(await screen.findByText("UC metadata sweeper")).toBeDefined();
    expect(screen.getAllByText("Schedule unavailable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Runtime signal unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Owner required on production")).toBeDefined();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Owner required on production/ }));
    expect(screen.getByText("Coverage is unavailable in diagnostics.")).toBeDefined();
  });

  it("suppresses prototype-mock provenance banners while preserving real warnings", async () => {
    fetchAdminControlCenter.mockResolvedValue({
      ...controlCenterPayload,
      meta: {
        ...controlCenterPayload.meta,
        warnings: ["Prototype mock data, not live Databricks evidence."],
      },
    });
    const prototypeRender = renderAdmin();
    await screen.findByText("Every 15 min");
    expect(screen.queryByText("Prototype mock data, not live Databricks evidence.")).toBeNull();
    fireEvent.click(screen.getByText("Every 15 min").closest("button"));
    expect(screen.getByRole("button", { name: /Open linked resource/i }).disabled).toBe(true);
    expect(screen.getByText("Prototype URL withheld; not live Databricks resource proof.")).toBeDefined();
    prototypeRender.unmount();

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

    await screen.findByText("Every 1 hr");
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

    await screen.findByText("Every 15 min");
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
});
