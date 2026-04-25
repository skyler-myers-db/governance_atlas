import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InsightsWorkspace from "./InsightsWorkspace";

function renderWorkspace(overrides = {}) {
  const baseOverride = {
    data: {
      kpis: [
        { key: "maturity", label: "Governance Maturity Score", value: 82.4, format: "score" },
        { key: "policyCompliance", label: "Policy Compliance", value: null, format: "percent", state: "unavailable" },
        { key: "certifiedAssets", label: "Certified Assets", value: 3 },
      ],
      metadataCoverageHeatmap: [
        { row: "Sales", column: "description", value: 90 },
        { row: "Sales", column: "owners", value: 70 },
      ],
      domainLeaderboard: [{ domain: "Sales", score: 80, assetCount: 4 }],
      recommendations: [
        {
          key: "metadataCoverage",
          title: "Improve Finance metadata coverage",
          detail: "Finance has 55% average metadata coverage across 2 assets.",
          evidence: [{ type: "domain", id: "Finance", metric: "metadataCoverage", value: 55 }],
        },
      ],
      scoring: {
        maturityFormula: [
          { signal: "metadataCoverage", weight: 0.3 },
          { signal: "qualityHealth", weight: 0.1 },
        ],
        availableSignals: ["metadataCoverage"],
      },
      signalAvailability: { quality: false, audit: true },
      meta: { state: "available", warnings: [] },
    },
    state: "ready",
    loading: false,
    refreshing: false,
    error: "",
    refreshError: "",
    warnings: [],
    refresh: vi.fn(),
    ...overrides,
  };
  return render(
    <InsightsWorkspace
      insightsOverride={baseOverride}
      onNavigate={() => {}}
      onSurfaceReady={() => {}}
    />,
  );
}

describe("InsightsWorkspace", () => {
  it("renders composite API KPI values without replacing unavailable metrics", () => {
    renderWorkspace();

    expect(screen.getByText("Governance Maturity Score")).toBeDefined();
    expect(screen.getByText("82")).toBeDefined();
    expect(screen.getByText("Policy Compliance")).toBeDefined();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Certified Assets")).toBeDefined();
  });

  it("renders evidence-backed recommendations from the composite payload", () => {
    renderWorkspace();

    expect(screen.getByText("Evidence-backed recommendations")).toBeDefined();
    expect(screen.getByText("Improve Finance metadata coverage")).toBeDefined();
    expect(screen.getByText("domain:Finance")).toBeDefined();
  });

  it("does not fabricate recommendation rows when none are returned", () => {
    renderWorkspace({
      data: {
        kpis: [],
        metadataCoverageHeatmap: [],
        domainLeaderboard: [],
        recommendations: [],
        scoring: { maturityFormula: [], availableSignals: [] },
        meta: { state: "available", warnings: [] },
      },
    });

    expect(screen.getByText("No evidence-backed recommendations are available from the current live signals.")).toBeDefined();
    expect(screen.queryByText(/Assign owner/)).toBeNull();
  });

  it("shows degraded warnings from the live response metadata", () => {
    renderWorkspace({
      degraded: true,
      data: {
        kpis: [],
        metadataCoverageHeatmap: [],
        domainLeaderboard: [],
        recommendations: [],
        scoring: { maturityFormula: [], availableSignals: [] },
        meta: { state: "degraded", warnings: ["Quality-runner signal is unavailable."] },
      },
    });

    expect(screen.getByText("Insights data is partially available")).toBeDefined();
    expect(screen.getByText("Quality-runner signal is unavailable.")).toBeDefined();
  });

  it("surfaces errors with retry without hiding the page shell", () => {
    const refresh = vi.fn();
    renderWorkspace({ error: "boom", refresh });

    expect(screen.getByText("Insights unavailable.")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Gap analysis across your estate")).toBeDefined();
  });

  it("calls onSurfaceReady once the hook is settled", () => {
    const ready = vi.fn();
    render(
      <InsightsWorkspace
        insightsOverride={{
          data: {
            kpis: [],
            metadataCoverageHeatmap: [],
            domainLeaderboard: [],
            recommendations: [],
            scoring: { maturityFormula: [], availableSignals: [] },
            meta: { state: "available", warnings: [] },
          },
          loading: false,
          error: "",
        }}
        onSurfaceReady={ready}
      />,
    );
    expect(ready).toHaveBeenCalled();
  });
});
