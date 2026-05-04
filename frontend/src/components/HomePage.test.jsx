import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./HomePage";

const commandCenter = {
  estate: {
    visibleAssetCount: 1247,
    catalogCount: 3,
    openRequests: 5,
    coverageScore: 87.4,
  },
  kpis: [
    {
      key: "governedAssets",
      label: "Governed Assets",
      value: 1247,
      format: "number",
      deltaText: "+82 this quarter",
      sparkline: [800, 860, 900, 980, 1100, 1247],
    },
    {
      key: "certifiedCriticalAssets",
      label: "Certified Critical Assets",
      value: 612,
      format: "number",
      deltaText: "+37 this week",
      sparkline: [410, 440, 488, 530, 575, 612],
    },
    {
      key: "metadataCoverage",
      label: "Metadata Coverage",
      value: 87.4,
      format: "percent",
      deltaText: "+2.1 pts vs last week",
      sparkline: [62, 68, 72, 77, 82, 87.4],
    },
    {
      key: "openStewardship",
      label: "Open Stewardship Actions",
      value: 5,
      format: "number",
      deltaText: "-11 this week",
      sparkline: [16, 14, 12, 10, 7, 5],
    },
    {
      key: "policyExceptions",
      label: "Policy Exceptions",
      value: 4,
      format: "number",
      deltaText: "+2 new this week",
      sparkline: [2, 2, 3, 3, 4, 4],
    },
  ],
  posture: {
    overall: 87.4,
    trend: [
      { label: "W14", overall: 73 },
      { label: "W16", overall: 79 },
      { label: "W18", overall: 83 },
      { label: "W20", overall: 85 },
      { label: "W22", overall: 86 },
      { label: "W24", overall: 87.4 },
    ],
    byDomain: [
      { domain: "Revenue & Sales", score: 92, count: 138 },
      { domain: "Customer", score: 84, count: 174 },
      { domain: "Marketing", score: 88, count: 89 },
    ],
  },
  topDomains: [
    { domain: "Revenue & Sales", score: 92, count: 138 },
    { domain: "Customer", score: 84, count: 174 },
    { domain: "Marketing", score: 88, count: 89 },
  ],
  riskBreakdown: {
    cleanScore: 92,
    high: 7,
    medium: 28,
    informational: 64,
  },
  recentAssets: [
    {
      fqn: "finance_prod.curated.revenue_daily",
      catalog: "finance_prod",
      metadataCoverage: 94,
      classification: "Restricted",
      risk: "Low",
    },
    {
      fqn: "sales_prod.silver.orders",
      catalog: "sales_prod",
      metadataCoverage: 91,
      classification: "Internal",
      risk: "Low",
    },
    {
      fqn: "customer_360.gold.customer_profile",
      catalog: "customer_360",
      metadataCoverage: 82,
      classification: "Confidential",
      risk: "Medium",
    },
  ],
  recentEvents: [
    {
      id: "evt-1",
      title: "certified finance_prod.curated.revenue_daily",
      actor: "Marisol Reyes",
      createdAt: "2026-04-27T08:00:00Z",
      tone: "good",
    },
  ],
  meta: {
    generatedAt: "2026-04-27T08:00:00Z",
    workspace: "entrada-prod",
  },
};

describe("HomePage", () => {
  it("renders the prototype command center hero and posture summary while loading", () => {
    render(<HomePage state="loading" commandCenter={commandCenter} />);

    expect(screen.getByText("Executive Command Center")).not.toBeNull();
    expect(screen.getByText("Governance posture, at a glance")).not.toBeNull();
    expect(screen.getByText("Loading command center.")).not.toBeNull();
    expect(screen.getByLabelText("Current governance posture")).not.toBeNull();
    expect(screen.getByText(/governed assets are in scope/i)).not.toBeNull();
  });

  it("renders the four prototype KPI cards", () => {
    render(<HomePage commandCenter={commandCenter} />);

    const kpiRow = screen.getByLabelText("Governance summary metrics");
    [
      "Governance coverage",
      "Certified assets",
      "Open stewardship items",
      "High-risk exposures",
    ].forEach((label) => {
      expect(within(kpiRow).getByText(label)).not.toBeNull();
    });
    expect(within(kpiRow).getByText("+2.1 pts vs last week")).not.toBeNull();
    expect(within(kpiRow).getByText("+37 this week")).not.toBeNull();
  });

  it("renders the main prototype panel set from backed data", () => {
    render(<HomePage commandCenter={commandCenter} />);

    expect(screen.getByText("Coverage trend · last 12 weeks")).not.toBeNull();
    expect(screen.getByText("Posture by domain")).not.toBeNull();
    expect(screen.getByText("Risk breakdown")).not.toBeNull();
    expect(screen.getByText("Top catalogs · health snapshot")).not.toBeNull();
    expect(screen.getByText("Critical data elements")).not.toBeNull();
    expect(screen.getByText("Activity stream")).not.toBeNull();
    expect(screen.getByText("finance_prod")).not.toBeNull();
    expect(screen.getByText("Marisol Reyes")).not.toBeNull();
  });

  it("preserves prototype panels with truthful unavailable states", () => {
    render(
      <HomePage
        commandCenter={{
          ...commandCenter,
          posture: { overall: null, trend: [], byDomain: [] },
          topDomains: [],
          recentAssets: [],
          recentEvents: [],
          kpis: [],
        }}
      />,
    );

    expect(screen.getByText("Trend history unavailable")).not.toBeNull();
    expect(screen.getByText("Projection unavailable")).not.toBeNull();
    expect(screen.getByText("Domain coverage signals unavailable.")).not.toBeNull();
    expect(screen.getByText("Catalog health rows unavailable until visible asset inventory hydrates.")).not.toBeNull();
    expect(screen.getByText("Critical data element registry signals are unavailable in this command-center snapshot.")).not.toBeNull();
    expect(screen.getByText("No recent governance activity available.")).not.toBeNull();
  });

  it("renders degraded and error notices without dropping the page structure", () => {
    const { rerender } = render(
      <HomePage
        commandCenter={commandCenter}
        state="degraded"
        warnings={["Showing app-principal view."]}
      />,
    );

    expect(screen.getByText("Showing app-principal view.")).not.toBeNull();
    expect(screen.getByText("Coverage trend · last 12 weeks")).not.toBeNull();

    rerender(<HomePage state="error" message="Command center unavailable." commandCenter={commandCenter} />);
    expect(screen.getByText("Command center unavailable.")).not.toBeNull();
    expect(screen.getByText("Top catalogs · health snapshot")).not.toBeNull();
  });

  it("keeps prototype-mock provenance out of the command-center layout banner", () => {
    render(
      <HomePage
        commandCenter={commandCenter}
        state="degraded"
        warnings={["Prototype mock data, not live Databricks evidence."]}
      />,
    );

    expect(screen.queryByText("Data availability is limited")).toBeNull();
    expect(screen.queryByText("Prototype mock data, not live Databricks evidence.")).toBeNull();
    expect(screen.getByLabelText("Current metadata coverage")).not.toBeNull();
  });

  it("rejects non-authoritative command-center payload values before rendering metrics", () => {
    render(
      <HomePage
        commandCenter={{
          ...commandCenter,
          meta: {
            source: "prototype-mock",
            warnings: ["not live Databricks evidence"],
          },
        }}
      />,
    );

    expect(screen.getByText(/Non-authoritative command-center evidence/i)).not.toBeNull();
    expect(screen.queryByText("Marisol Reyes")).toBeNull();
    expect(screen.getByText("Audit events unavailable until live evidence is returned")).not.toBeNull();
    expect(screen.getByText("No recent governance activity available.")).not.toBeNull();
  });

  it("still shows non-prototype degraded warnings in the command-center layout", () => {
    render(
      <HomePage
        commandCenter={commandCenter}
        state="degraded"
        warnings={["Lineage coverage is temporarily unavailable."]}
      />,
    );

    expect(screen.getByText("Data availability is limited")).not.toBeNull();
    expect(screen.getByText("Lineage coverage is temporarily unavailable.")).not.toBeNull();
  });

  it("routes CDE view-all to the CDE surface", () => {
    const onNavigate = vi.fn();
    render(<HomePage commandCenter={commandCenter} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(onNavigate).toHaveBeenCalledWith("cde");
  });

  it("exports a backed command-center brief and toggles present mode", async () => {
    const createObjectURL = vi.fn(() => "blob:command-center");
    const revokeObjectURL = vi.fn();
    const blobCalls = [];
    const OriginalBlob = globalThis.Blob;
    class TestBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
        blobCalls.push({ parts, options });
      }
    }
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("Blob", TestBlob);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    try {
      render(<HomePage commandCenter={commandCenter} />);

      fireEvent.click(screen.getByRole("button", { name: "Export brief" }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Command Center brief export started.")).not.toBeNull();
      expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(TestBlob);
      const payload = JSON.parse(blobCalls[0].parts[0]);
      expect(payload.posture.value).toBe(87.4);
      expect(payload.workspace.label).toBe("entrada-prod");
      expect(payload.workspace.databricksBackedMetadata).toBe(true);
      expect(payload.workspace.evidenceBoundary).toBe("local-runtime");
      expect(payload.workspace.liveDatabricksEvidence).toBe(false);
      expect(payload.workspace.warning).toMatch(/local runtime boundary/i);
      expect(payload.provenance.evidenceKind).toBe("live");
      expect(payload.provenance.liveDatabricksEvidence).toBe(false);
      expect(payload.kpis.find((kpi) => kpi.key === "governedAssets").delta).toBe("+82 this quarter");
      expect(payload.topCatalogs[0].catalog).toBe("finance_prod");

      const presentButton = screen.getByRole("button", { name: "Present mode" });
      expect(presentButton.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(presentButton);
      const exitButton = screen.getByRole("button", { name: "Exit present mode" });
      expect(exitButton.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("Local presentation view - no metadata changes.")).not.toBeNull();
    } finally {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
      vi.stubGlobal("Blob", OriginalBlob);
      clickSpy.mockRestore();
    }
  });

  it("shows a visible export unavailable state when download URLs are unsupported", () => {
    const originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: undefined });

    try {
      render(<HomePage commandCenter={commandCenter} />);
      fireEvent.click(screen.getByRole("button", { name: "Export brief" }));
      expect(screen.getByText("Command Center export is unavailable because this browser cannot create download URLs.")).not.toBeNull();
    } finally {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    }
  });

  it("switches trend ranges and routes catalog and activity rows", () => {
    const onNavigate = vi.fn();
    const longTrend = Array.from({ length: 30 }, (_, index) => ({
      label: `W${index + 1}`,
      overall: 50 + index,
    }));
    render(
      <HomePage
        commandCenter={{
          ...commandCenter,
          posture: { ...commandCenter.posture, trend: longTrend },
        }}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole("button", { name: "26w" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("W5")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "12w" }));
    expect(screen.getByRole("button", { name: "12w" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("W5")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Open discovery filtered to Revenue & Sales domain/i }));
    expect(onNavigate).toHaveBeenCalledWith("discovery");
    fireEvent.click(screen.getByRole("button", { name: /Open stewardship for high-risk exposures/i }));
    expect(onNavigate).toHaveBeenCalledWith("stewardship");
    fireEvent.click(screen.getByRole("button", { name: /Open audit evidence for medium-risk findings/i }));
    expect(onNavigate).toHaveBeenCalledWith("audit");

    fireEvent.click(screen.getByText("finance_prod"));
    expect(onNavigate).toHaveBeenCalledWith("discovery");
    fireEvent.click(screen.getByText(/certified finance_prod\.curated\.revenue_daily/i));
    expect(onNavigate).toHaveBeenCalledWith("audit");
  });

  it("treats prototype-marked evidence as non-authoritative in page copy and exported briefs", () => {
    const createObjectURL = vi.fn(() => "blob:prototype-command-center");
    const revokeObjectURL = vi.fn();
    const blobCalls = [];
    const OriginalBlob = globalThis.Blob;
    class TestBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
        blobCalls.push({ parts, options });
      }
    }
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("Blob", TestBlob);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    try {
      render(
        <HomePage
          commandCenter={{
            ...commandCenter,
            meta: { ...commandCenter.meta, state: "prototype_mock" },
          }}
          state="degraded"
          warnings={["Prototype mock data, not live Databricks evidence."]}
        />,
      );

      expect(screen.getByText(/Non-authoritative command-center evidence/i)).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Export brief" }));
      const payload = JSON.parse(blobCalls[0].parts[0]);
      expect(payload.workspace.evidenceKind).toBe("non_authoritative");
      expect(payload.workspace.liveDatabricksEvidence).toBe(false);
      expect(payload.workspace.warning).toMatch(/local runtime boundary/i);
      expect(payload.provenance.evidenceKind).toBe("non_authoritative");
      expect(payload.provenance.liveDatabricksEvidence).toBe(false);
      expect(payload.provenance.warnings).toContain("Prototype mock data, not live Databricks evidence.");
    } finally {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
      vi.stubGlobal("Blob", OriginalBlob);
      clickSpy.mockRestore();
    }
  });

  it("does not classify non-authoritative command-center payloads as live evidence", () => {
    const createObjectURL = vi.fn(() => "blob:non-authoritative-command-center");
    const revokeObjectURL = vi.fn();
    const blobCalls = [];
    const OriginalBlob = globalThis.Blob;
    class TestBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
        blobCalls.push({ parts, options });
      }
    }
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("Blob", TestBlob);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    try {
      render(
        <HomePage
          commandCenter={{
            ...commandCenter,
            authoritative: false,
            meta: {
              ...commandCenter.meta,
              workspace: "entrada-prod",
            },
          }}
        />,
      );

      expect(screen.getByText("Not live verified")).not.toBeNull();
      expect(screen.getByText(/Non-authoritative command-center evidence/i)).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Export brief" }));
      const payload = JSON.parse(blobCalls[0].parts[0]);
      expect(payload.workspace.label).toBe("entrada-prod");
      expect(payload.workspace.evidenceKind).toBe("non_authoritative");
      expect(payload.workspace.liveDatabricksEvidence).toBe(false);
      expect(payload.workspace.warning).toMatch(/local runtime boundary/i);
      expect(payload.workspaceLabel).toBe("entrada-prod");
      expect(payload.provenance.evidenceKind).toBe("non_authoritative");
      expect(payload.provenance.liveDatabricksEvidence).toBe(false);
      expect(payload.provenance.summary).toMatch(/Non-authoritative command-center evidence/i);
    } finally {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
      vi.stubGlobal("Blob", OriginalBlob);
      clickSpy.mockRestore();
    }
  });

  it("does not relabel generic policy exceptions as high-risk severity", () => {
    const { riskBreakdown, ...policyOnlyCommandCenter } = commandCenter;
    render(<HomePage commandCenter={policyOnlyCommandCenter} />);

    expect(screen.getAllByText("Policy exception signals").length).toBeGreaterThan(0);
    expect(screen.getByText("Policy exception count is backed; severity split is unavailable for this workspace.")).not.toBeNull();
    expect(screen.queryByText("High-risk exposures")).toBeNull();
  });

  it("does not render stale Home mockup controls from the superseded design", () => {
    render(<HomePage commandCenter={commandCenter} />);

    expect(screen.queryByText("Enterprise Governance Command Center")).toBeNull();
    expect(screen.queryByText("Quick Actions")).toBeNull();
    expect(screen.queryByText("Ask Atlas AI")).toBeNull();
    expect(screen.queryByRole("button", { name: "Last 6 Months" })).toBeNull();
  });
});
