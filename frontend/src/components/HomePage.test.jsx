import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./HomePage";

const commandCenter = {
  estate: {
    visibleAssetCount: 5,
    catalogCount: 1,
    openRequests: 2,
    coverageScore: 70,
  },
  kpis: [
    { key: "governedAssets", label: "Governed Assets", value: 5, format: "number" },
    { key: "certifiedCriticalAssets", label: "Certified Critical Assets", value: null, state: "unavailable" },
    { key: "metadataCoverage", label: "Metadata Coverage", value: 70, format: "percent", progress: 70 },
    { key: "openStewardship", label: "Open Stewardship Actions", value: 2, format: "number" },
    { key: "policyExceptions", label: "Policy Exceptions", value: 0, format: "number" },
    { key: "auditReadiness", label: "Audit Readiness", value: null, state: "unavailable", format: "percent" },
  ],
  posture: {
    overall: 70,
    trend: [],
    byDomain: [{ domain: "Customer", score: 86 }],
    heatmap: [
      { row: "Customer", column: "Ownership", value: 80 },
      { row: "Customer", column: "Classification", value: 60 },
    ],
  },
  topDomains: [{ domain: "Customer", score: 86 }],
  recentEvents: [
    {
      id: "evt-1",
      title: "Metadata updated",
      detail: "customer.email sensitivity changed",
      createdAt: "2026-04-24T08:00:00Z",
      tone: "info",
    },
  ],
  aiPrompts: ["Which domains need stewardship attention?"],
};

describe("HomePage", () => {
  it("renders the North Star command center structure while loading", () => {
    render(<HomePage state="loading" commandCenter={commandCenter} />);

    expect(screen.getByText("Enterprise Governance Command Center")).not.toBeNull();
    expect(screen.getByText("Unified visibility. Trusted data. Confident decisions.")).not.toBeNull();
    expect(screen.getByText("Loading command center.")).not.toBeNull();
    expect(screen.getByText("Governance Posture Over Time")).not.toBeNull();
    expect(screen.getByText("Ask Atlas AI")).not.toBeNull();
  });

  it("renders all six executive KPI categories", () => {
    render(<HomePage commandCenter={commandCenter} />);

    [
      "Governed Assets",
      "Certified Critical Assets",
      "Metadata Coverage",
      "Open Stewardship Actions",
      "Policy Exceptions",
      "Audit Readiness",
    ].forEach((label) => {
      expect(screen.getByText(label)).not.toBeNull();
    });
  });

  it("preserves target panels when signals are unavailable", () => {
    render(<HomePage commandCenter={{ ...commandCenter, posture: { overall: null, trend: [], byDomain: [], heatmap: [] }, recentEvents: [] }} />);

    expect(screen.getByText("Trend history unavailable")).not.toBeNull();
    expect(screen.getByText("Domain signals unavailable")).not.toBeNull();
    expect(screen.getByText("No high-priority events available")).not.toBeNull();
    expect(screen.getAllByText("Signal unavailable").length).toBeGreaterThan(0);
  });

  it("renders degraded warnings with a retry action", () => {
    const onRetry = vi.fn();
    render(
      <HomePage
        commandCenter={commandCenter}
        state="degraded"
        warnings={["Showing app-principal view."]}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Showing app-principal view.")).not.toBeNull();
  });

  it("renders error state without hiding the dashboard contract", () => {
    render(<HomePage state="error" message="Command center unavailable." commandCenter={commandCenter} />);

    expect(screen.getByText("Command center unavailable.")).not.toBeNull();
    expect(screen.getByText("Top Domains")).not.toBeNull();
    expect(screen.getByText("Quick Actions")).not.toBeNull();
  });

  it("routes quick actions to their target surfaces", () => {
    const onNavigate = vi.fn();
    render(<HomePage commandCenter={commandCenter} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: /browse discovery/i }));
    fireEvent.click(screen.getByRole("button", { name: /audit trail/i }));

    expect(onNavigate).toHaveBeenCalledWith("discovery");
    expect(onNavigate).toHaveBeenCalledWith("audit");
  });

  it("routes View all controls and renders the Atlas AI accuracy copy", () => {
    const onNavigate = vi.fn();
    render(<HomePage commandCenter={commandCenter} onNavigate={onNavigate} userName="skyler@entrada.ai" />);

    fireEvent.click(screen.getAllByRole("button", { name: "View all" })[0]);
    expect(onNavigate).toHaveBeenCalledWith("insights");
    expect(screen.getByText("Hi, Skyler. I'm Atlas AI.")).not.toBeNull();
    expect(screen.getByText("Atlas AI uses AI. Review for accuracy.")).not.toBeNull();
  });

  it("does not expose opaque numeric user identifiers in the Atlas AI greeting", () => {
    render(<HomePage commandCenter={commandCenter} userName="5882225431657870" />);

    expect(screen.getByText("Hi, there. I'm Atlas AI.")).not.toBeNull();
    expect(screen.queryByText(/5882225431657870/)).toBeNull();
  });

  it("calls the evidence-backed Atlas AI endpoint from prompt buttons", async () => {
    const atlasAiRequest = vi.fn().mockResolvedValue({
      answer: "Customer coverage is 86% across 5 visible assets.",
      evidence: [{ type: "domain", id: "Customer" }],
    });
    render(
      <HomePage
        atlasAiRequest={atlasAiRequest}
        commandCenter={commandCenter}
        userName="skyler@entrada.ai"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Which domains need stewardship attention/i }));

    expect(atlasAiRequest).toHaveBeenCalledWith("Which domains need stewardship attention?");
    await waitFor(() => {
      expect(screen.getByText("Customer coverage is 86% across 5 visible assets.")).not.toBeNull();
    });
    expect(screen.getByText("1 evidence record returned.")).not.toBeNull();
  });

  it("does not render a dead time range button", () => {
    render(<HomePage commandCenter={commandCenter} />);

    expect(screen.getByText("Last 6 Months")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Last 6 Months" })).toBeNull();
  });
});
