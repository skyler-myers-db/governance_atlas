import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useCapabilityDashboardMock = vi.fn();

vi.mock("../hooks/useCapabilityDashboard", () => ({
  useCapabilityDashboard: (...args) => useCapabilityDashboardMock(...args),
}));

import CapabilityDashboard from "./CapabilityDashboard";

function baseIdentity(overrides = {}) {
  return {
    actorEmail: "skyler@entrada.ai",
    authMode: "obo-available",
    visibilityScope: "actor-scoped",
    authenticatedUserPresent: true,
    ...overrides,
  };
}

function baseCapabilities(overrides = {}) {
  const mkFlag = (extra = {}) => ({
    available: true,
    state: "available",
    reason: "",
    visibilityScope: "actor-scoped",
    source: "unity-catalog-actor",
    protectedRead: false,
    ...extra,
  });
  return {
    governanceWrite: mkFlag({ source: "governance-control-plane", visibilityScope: "forwarded-actor-control-plane" }),
    governanceApproval: mkFlag({ source: "governance-control-plane", visibilityScope: "forwarded-actor-control-plane" }),
    systemInventoryRead: mkFlag(),
    tableLineage: mkFlag({ protectedRead: true }),
    columnLineage: mkFlag({ protectedRead: true }),
    workloadVisibility: mkFlag({
      available: false,
      state: "unavailable",
      reason: "Query history is not shared.",
      protectedRead: true,
    }),
    qualityRunEligibility: mkFlag({ available: false, state: "unavailable", reason: "Not implemented." }),
    exportAllowed: mkFlag({ available: false, state: "unavailable", reason: "Not implemented." }),
    manualLineageOverrides: mkFlag({ available: false, state: "unavailable", reason: "Not implemented." }),
    ...overrides,
  };
}

function baseDashboard(overrides = {}) {
  return {
    loading: false,
    refreshing: false,
    runtimeError: "",
    backgroundError: "",
    identity: baseIdentity(),
    runtime: {
      state: "live",
      message: "",
      client: { host: "https://example.cloud.databricks.com", warehouseId: "wh-123", authMode: "oauth-m2m" },
    },
    store: { state: "live", message: "" },
    config: { warehouseId: "wh-123", govCatalog: "main", govSchema: "gov" },
    capabilities: baseCapabilities(),
    background: {
      drainer: {
        running: true,
        lastDrainAt: "2026-04-20T12:00:00Z",
        processedTotal: 7,
        lastError: null,
      },
      queue: { depthHint: null },
      state: "available",
      reason: "",
    },
    lastRefreshedAt: "",
    refetch: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("CapabilityDashboard", () => {
  beforeEach(() => {
    useCapabilityDashboardMock.mockReset();
  });

  it("renders each of the six sections with live data", () => {
    useCapabilityDashboardMock.mockReturnValue(baseDashboard());

    render(<CapabilityDashboard />);

    expect(screen.getByRole("heading", { level: 2, name: /Identity and auth/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Runtime and store/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Capability flags/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /Background work health/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /System-table health/i })).toBeTruthy();
    // Refresh control lives in the header, not its own section heading.
    expect(screen.getByRole("button", { name: /Refresh capability snapshot/i })).toBeTruthy();
  });

  it("renders every capability flag as a row with its reason", () => {
    useCapabilityDashboardMock.mockReturnValue(baseDashboard());

    render(<CapabilityDashboard />);

    const flagRows = document.querySelectorAll("tr[data-row-key]");
    const keys = Array.from(flagRows).map((row) => row.getAttribute("data-row-key"));
    expect(keys).toEqual([
      "governanceWrite",
      "governanceApproval",
      "systemInventoryRead",
      "tableLineage",
      "columnLineage",
      "workloadVisibility",
      "qualityRunEligibility",
      "exportAllowed",
      "manualLineageOverrides",
    ]);

    const workloadRow = document.querySelector('tr[data-row-key="workloadVisibility"]');
    expect(workloadRow).toBeTruthy();
    expect(within(workloadRow).getByText(/Query history is not shared/i)).toBeTruthy();
  });

  it("surfaces the degraded tone on unavailable capabilities", () => {
    useCapabilityDashboardMock.mockReturnValue(
      baseDashboard({
        capabilities: baseCapabilities({
          workloadVisibility: {
            available: false,
            state: "degraded",
            reason: "Query history degraded.",
            visibilityScope: "workspace-app-principal",
            source: "unity-catalog-app-principal",
            protectedRead: true,
          },
        }),
      }),
    );

    render(<CapabilityDashboard />);

    const workloadRow = document.querySelector('tr[data-row-key="workloadVisibility"]');
    expect(workloadRow).toBeTruthy();
    const chips = workloadRow.querySelectorAll(".gh-status-chip");
    const labels = Array.from(chips).map((chip) => chip.textContent);
    // Availability column shows "Degraded" rather than "No" when state is degraded.
    expect(labels).toContain("Degraded");
  });

  it("renders the not-yet-observed placeholder when no drainer signal is present", () => {
    useCapabilityDashboardMock.mockReturnValue(
      baseDashboard({
        background: null,
      }),
    );

    render(<CapabilityDashboard />);

    expect(screen.getByText(/Not yet observed/i)).toBeTruthy();
  });

  it("triggers refetch when the Refresh button is clicked", () => {
    const refetch = vi.fn().mockResolvedValue([]);
    useCapabilityDashboardMock.mockReturnValue(baseDashboard({ refetch }));

    render(<CapabilityDashboard />);

    fireEvent.click(
      screen.getByRole("button", { name: /Refresh capability snapshot/i }),
    );

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the OBO fallback hint when the inventory source is the app principal", () => {
    useCapabilityDashboardMock.mockReturnValue(
      baseDashboard({
        identity: baseIdentity({ authMode: "obo-available" }),
        capabilities: baseCapabilities({
          systemInventoryRead: {
            available: true,
            state: "available",
            reason: "",
            visibilityScope: "workspace-app-principal",
            source: "unity-catalog-app-principal",
            protectedRead: false,
          },
        }),
      }),
    );

    render(<CapabilityDashboard />);

    expect(screen.getByText(/The forwarded user token lacks the sql scope/i)).toBeTruthy();
  });
});
