import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GovernanceWorkspace from "./GovernanceWorkspace";

const useAssetDetailMock = vi.fn();
const useGovernanceGlossaryTermMock = vi.fn();
const useGovernanceAuditTimelineMock = vi.fn();
const useAssetSearchMock = vi.fn();
const useSeededAssetContextMock = vi.fn();

vi.mock("../hooks/useAssetDetail", () => ({
  canOpenAssetRecord: vi.fn(() => true),
  invalidateAssetDetail: vi.fn(),
  prefetchAssetDetail: vi.fn(),
  primeAssetDetail: vi.fn(),
  useAssetDetail: (...args) => useAssetDetailMock(...args),
}));

vi.mock("../hooks/useGovernanceGlossaryTerm", () => ({
  useGovernanceGlossaryTerm: (...args) => useGovernanceGlossaryTermMock(...args),
}));

vi.mock("../hooks/useGovernanceAuditTimeline", () => ({
  useGovernanceAuditTimeline: (...args) => useGovernanceAuditTimelineMock(...args),
}));

vi.mock("../hooks/useAssetSearch", () => ({
  clearAssetSearchCache: vi.fn(),
  useAssetSearch: (...args) => useAssetSearchMock(...args),
}));

vi.mock("../hooks/useSeededAssetContext", () => ({
  useSeededAssetContext: (...args) => useSeededAssetContextMock(...args),
}));

vi.mock("../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  createGovernanceRequest: vi.fn(),
  normalizeGovernancePayload: (payload) => payload,
  updateGovernanceGlossaryTerm: vi.fn(),
  updateGovernanceRequest: vi.fn(),
  upsertGovernanceGlossaryTerm: vi.fn(),
  upsertGovernanceOwner: vi.fn(),
  getRuntimeDiagnostics: () => ({
    initialNavigation: {
      durationMs: 123,
    },
    lastRequest: {
      httpRequestId: "req-123",
      clientDurationMs: 45.6,
    },
    requests: [],
  }),
}));

const governancePayload = {
  authoritative: true,
  provenance: {
    warnings: [],
  },
  metrics: [],
  backlog: [],
  glossary: [],
};

describe("GovernanceWorkspace", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useGovernanceGlossaryTermMock.mockReset();
    useGovernanceAuditTimelineMock.mockReset();
    useAssetSearchMock.mockReset();
    useSeededAssetContextMock.mockReset();

    useAssetDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      error: "",
    });
    useGovernanceGlossaryTermMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      refresh: vi.fn(),
      term: null,
    });
    useGovernanceAuditTimelineMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      entries: [],
      total: 0,
      refresh: vi.fn(),
    });
    useAssetSearchMock.mockReturnValue({
      loading: false,
      assets: [],
      resolvedQuery: "",
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({
      summary: null,
    });
  });

  it("keeps governance focused on stewardship and glossary even for admin roles", async () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Admin",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={governancePayload}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stewardship" })).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Diagnostics" })).toBeNull();
  });

  it("does not surface a diagnostics mode for non-admin roles", () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Reader",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={governancePayload}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Diagnostics" })).toBeNull();
  });

  it("uses the shared shell header and switches titles across governance modes", async () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={governancePayload}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    expect(screen.getByText("Stewardship workbench")).not.toBeNull();
    expect(screen.getByText("Open work view")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));

    await waitFor(() => {
      expect(screen.getByText("Glossary workbench")).not.toBeNull();
    });
  });

  it("uses authoritative queue lane counts in the open work view", async () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          queue: {
            source: "projection",
            laneCounts: {
              "open-work": 8,
              ownership: 5,
              classification: 1,
              trust: 0,
            },
          },
          backlog: [
            {
              requestId: "req-1",
              title: "Assign owner",
              asset: "main.sales.orders",
              assetFqn: "main.sales.orders",
              status: "Pending",
              note: "Backlog sample item",
            },
          ],
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Authoritative queue")).not.toBeNull();
    });

    expect(screen.getByRole("button", { name: /Open work/i }).textContent).toContain("8");
    expect(screen.getByRole("button", { name: /Ownership work/i }).textContent).toContain("5");
  });

  it("uses the shared workbench wrapper across stewardship and glossary layouts", async () => {
    const { container } = render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          glossary: [
            {
              termId: "term-1",
              term: "Customer Identifier",
              definition: "Customer key used across reporting.",
              domain: "Sales",
              ownerEmail: "owner@example.com",
              status: "Approved",
              reviewers: [],
              reviewerRoster: [],
              termHistory: [],
              assetCount: 1,
              assets: ["main.sales.orders"],
            },
          ],
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    expect(container.querySelector(".gh-surface-workbench")).not.toBeNull();
    expect(container.querySelector(".gh-surface-workbench-main")).not.toBeNull();
    expect(container.querySelector(".gh-surface-workbench-side")).not.toBeNull();
    expect(container.querySelector(".gh-governance-flow-grid")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));

    await waitFor(() => {
      expect(container.querySelector(".gh-surface-workbench-glossary")).not.toBeNull();
    });
  });

  it("shows the normalized degraded governance banner when the control plane is limited", () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          authoritative: false,
          provenance: {
            warnings: ["Governance control plane is temporarily unavailable."],
          },
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    expect(screen.getByText("Governance plane degraded")).not.toBeNull();
    expect(screen.getByText("Governance control plane is temporarily unavailable.")).not.toBeNull();
  });

  it("renders the focused stewardship rail on the shared governance workbench shell", async () => {
    useAssetDetailMock.mockReturnValue({
      detail: {
        fqn: "main.sales.orders",
        name: "orders",
        catalog: "main",
        schema: "sales",
        domain: "Sales",
        tier: "Gold",
        certification: "Certified",
        sensitivity: "Internal",
        coverageScore: 92,
        openRequests: 2,
      },
      loading: false,
      error: "",
    });

    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          backlog: [
            {
              requestId: "req-1",
              title: "Review ownership",
              asset: "orders",
              assetFqn: "main.sales.orders",
              status: "open",
              note: "Owner metadata is missing.",
            },
          ],
          glossary: [
            {
              termId: "term-1",
              term: "Customer Identifier",
              definition: "Customer key used across reporting.",
              domain: "Sales",
              ownerEmail: "owner@example.com",
              status: "Approved",
              reviewers: [],
              reviewerRoster: [],
              termHistory: [],
              assetCount: 1,
              assets: ["main.sales.orders"],
            },
          ],
        }}
        initialAssetFqn="main.sales.orders"
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Focused stewardship")).not.toBeNull();
    });

    expect(screen.getByText("Stewardship posture")).not.toBeNull();
    expect(screen.getByText("Linked glossary")).not.toBeNull();
  });

  it("preserves the selected work item across governance mode switches", async () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          backlog: [
            {
              requestId: "req-1",
              title: "Review ownership",
              asset: "orders",
              assetFqn: "main.sales.orders",
              status: "open",
              note: "Owner metadata is missing.",
            },
          ],
          glossary: [
            {
              termId: "term-1",
              term: "Customer Identifier",
              definition: "Customer key used across reporting.",
              domain: "Sales",
              ownerEmail: "owner@example.com",
              status: "Approved",
              reviewers: [],
              reviewerRoster: [],
              termHistory: [],
              assetCount: 1,
              assets: ["main.sales.orders"],
            },
          ],
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Review ownership/i }));

    await waitFor(() => {
      expect(screen.getByText("Selected work")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));
    fireEvent.click(screen.getByRole("button", { name: "Stewardship" }));

    expect(screen.getByText("Selected work")).not.toBeNull();
    expect(screen.getAllByText("Review ownership").length).toBeGreaterThan(0);
  });

  it("hydrates selected glossary terms through the dedicated term detail hook", async () => {
    const curatedTerm = {
      termId: "term-1",
      term: "Customer Identifier",
      definition: "Curated glossary detail",
      reviewerRoster: [{ id: "rev-1", email: "reviewer@example.com", role: "Reviewer" }],
    };
    const idleResult = {
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      refresh: vi.fn(),
      term: null,
    };
    const activeResult = {
      ...idleResult,
      term: curatedTerm,
    };
    useGovernanceGlossaryTermMock.mockImplementation((termId) =>
      termId === "term-1" ? activeResult : idleResult,
    );

    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          glossary: [
            {
              termId: "term-1",
              term: "Customer Identifier",
              definition: "Seed definition",
              domain: "Sales",
              ownerEmail: "owner@example.com",
              status: "Approved",
              reviewerRoster: [],
              reviewers: [],
              termHistory: [],
              assetCount: 0,
              assets: [],
            },
          ],
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));
    fireEvent.click(screen.getByRole("button", { name: /Customer Identifier/i }));

    await waitFor(() => {
      expect(useGovernanceGlossaryTermMock).toHaveBeenCalledWith(
        "term-1",
        expect.objectContaining({
          enabled: true,
          seedTerm: expect.objectContaining({
            termId: "term-1",
          }),
        }),
      );
    });

    expect(screen.getAllByText("Curated glossary detail").length).toBeGreaterThan(0);
    expect(screen.getAllByText("reviewer@example.com").length).toBeGreaterThan(0);
  });

  it("renders the glossary detail rail after switching modes and selecting a term", async () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          glossary: [
            {
              termId: "term-1",
              term: "Customer Identifier",
              definition: "Customer key used across reporting.",
              domain: "Sales",
              ownerEmail: "owner@example.com",
              status: "Approved",
              reviewers: [],
              reviewerRoster: [],
              termHistory: [],
              assetCount: 2,
              assets: ["main.sales.orders"],
            },
          ],
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));
    fireEvent.click(screen.getByRole("button", { name: /Customer Identifier/i }));

    await waitFor(() => {
      expect(screen.getByText("Term detail")).not.toBeNull();
    });

    expect(screen.getByText("Selected term")).not.toBeNull();
    expect(screen.getByText("Linked assets")).not.toBeNull();
  });

  it("preserves the selected glossary term across mode switches", async () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          backlog: [
            {
              requestId: "req-1",
              title: "Review ownership",
              asset: "orders",
              assetFqn: "main.sales.orders",
              status: "open",
              note: "Owner metadata is missing.",
            },
          ],
          glossary: [
            {
              termId: "term-1",
              term: "Customer Identifier",
              definition: "Customer key used across reporting.",
              domain: "Sales",
              ownerEmail: "owner@example.com",
              status: "Approved",
              reviewers: [],
              reviewerRoster: [],
              termHistory: [],
              assetCount: 2,
              assets: ["main.sales.orders"],
            },
          ],
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));
    fireEvent.click(screen.getByRole("button", { name: /Customer Identifier/i }));

    await waitFor(() => {
      expect(screen.getByText("Term detail")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Stewardship" }));
    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));

    expect(screen.getByText("Term detail")).not.toBeNull();
    expect(screen.getByText("Selected term")).not.toBeNull();
  });
});
