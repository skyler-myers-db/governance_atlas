import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InsightsWorkspace from "./InsightsWorkspace";

function renderWorkspace(overrides = {}, props = {}) {
  const onNavigate = props.onNavigate || vi.fn();
  const baseOverride = {
    data: {
      kpis: [
        { key: "maturity", label: "Governance Maturity Score", value: 82.4, format: "score" },
        { key: "policyCompliance", label: "Policy Compliance", value: null, format: "percent", state: "unavailable" },
        { key: "resolutionDays", label: "Time to Resolution (P1)", value: null, state: "unavailable" },
        { key: "certifiedAssets", label: "Certified Assets", value: 3 },
        { key: "criticalExceptions", label: "Critical Policy Exceptions", value: 1, state: "degraded" },
        { key: "metadataCoverage", label: "Metadata Coverage", value: 78, format: "percent" },
      ],
      policyComplianceTrend: [],
      resolutionTrend: [],
      metadataCoverageHeatmap: [
        { row: "Sales", column: "Discoverability", value: 90 },
        { row: "Sales", column: "Ownership", value: 70 },
      ],
      certificationCoverageByTier: [{ label: "Tier 1 - Business Critical", value: 75, total: 4, certified: 3 }],
      riskHeatmap: [{ row: "Very High", column: "High", value: 2 }],
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
      onNavigate={onNavigate}
      onSurfaceReady={() => {}}
    />,
  );
}

describe("InsightsWorkspace", () => {
  it("renders composite API KPI values without replacing unavailable metrics", () => {
    renderWorkspace();

    expect(screen.getByText("Governance Insights")).toBeDefined();
    expect(screen.getByText("Governance Maturity Score")).toBeDefined();
    expect(screen.getByText("82")).toBeDefined();
    expect(screen.getByText("Policy Compliance")).toBeDefined();
    expect(screen.getAllByText("Signal unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Certified Assets")).toBeDefined();
    expect(screen.getByText("Metadata Coverage")).toBeDefined();
  });

  it("renders evidence-backed recommendations from the composite payload", () => {
    const onNavigate = vi.fn();
    renderWorkspace({}, { onNavigate });

    expect(screen.getByText("Strategic Recommendations")).toBeDefined();
    expect(screen.getByText("Improve Finance metadata coverage")).toBeDefined();
    expect(document.querySelectorAll(".gh-insights-rec-card")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Improve Finance metadata coverage/i }));
    expect(onNavigate).toHaveBeenCalledWith("governance");
  });

  it("does not fabricate recommendation rows when none are returned", () => {
    renderWorkspace({
      data: {
        kpis: [],
        metadataCoverageHeatmap: [],
        certificationCoverageByTier: [],
        riskHeatmap: [],
        domainLeaderboard: [],
        recommendations: [],
        scoring: { maturityFormula: [], availableSignals: [] },
        meta: { state: "available", warnings: [] },
      },
    });

    expect(screen.getAllByText("No evidence-backed recommendation available")).toHaveLength(4);
    expect(document.querySelectorAll(".gh-insights-rec-card")).toHaveLength(4);
    expect(screen.queryByText(/Assign owner/)).toBeNull();
  });

  it("shows degraded warnings from the live response metadata", () => {
    renderWorkspace({
      degraded: true,
      data: {
        kpis: [],
        metadataCoverageHeatmap: [],
        certificationCoverageByTier: [],
        riskHeatmap: [],
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
    expect(screen.getByText("Governance Insights")).toBeDefined();
  });

  it("responds to range, filter, and view-all controls without changing data truth", () => {
    const onNavigate = vi.fn();
    renderWorkspace({}, { onNavigate });

    fireEvent.click(screen.getByRole("button", { name: /Global date range: Last 6 Months/i }));
    fireEvent.click(screen.getByRole("button", { name: /Last 30 Days/i }));
    expect(screen.getByRole("button", { name: /Global date range: Last 30 Days/i })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Policy Compliance Trend date range: Last 30 Days/i }));
    fireEvent.click(screen.getByRole("button", { name: /Last 90 Days/i }));
    expect(screen.getByRole("button", { name: /Time to Resolution Trend date range: Last 90 Days/i })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
    expect(screen.getByText("Live visibility scope")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Close/i }));
    expect(screen.queryByText("Live visibility scope")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /View all tiers/i }));
    expect(screen.getByRole("button", { name: /Show fewer tiers/i })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /View all domains/i }));
    expect(screen.getByRole("button", { name: /Show fewer domains/i })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /View all recommendations/i }));
    expect(onNavigate).toHaveBeenCalledWith("governance");
  });

  it("calls onSurfaceReady once the hook is settled", () => {
    const ready = vi.fn();
    render(
      <InsightsWorkspace
        insightsOverride={{
          data: {
            kpis: [],
            metadataCoverageHeatmap: [],
            certificationCoverageByTier: [],
            riskHeatmap: [],
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
