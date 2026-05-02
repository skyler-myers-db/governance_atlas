import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import GovernanceWorkspace from "./GovernanceWorkspace";

const useAssetDetailMock = vi.fn();
const useGovernanceGlossaryTermMock = vi.fn();
const useGovernanceAuditTimelineMock = vi.fn();
const useAssetSearchMock = vi.fn();
const useSeededAssetContextMock = vi.fn();

const apiMocks = vi.hoisted(() => ({
  createGovernanceRequest: vi.fn(),
  fetchGovernanceRequestDetail: vi.fn(),
  fetchGovernanceWorkbench: vi.fn(),
  normalizeGovernancePayload: vi.fn((payload) => payload),
  updateGovernanceGlossaryTerm: vi.fn(),
  updateGovernanceRequest: vi.fn(),
  upsertGovernanceGlossaryTerm: vi.fn(),
  upsertGovernanceOwner: vi.fn(),
}));

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

vi.mock("../hooks/useClassificationRecommendations", () => ({
  useClassificationRecommendations: () => ({
    loading: false,
    refreshing: false,
    error: "",
    data: { recommendations: [], count: 0, pendingCount: 0 },
    empty: { recommendations: [], count: 0, pendingCount: 0 },
    refresh: vi.fn(),
  }),
  useClassificationRecommendation: () => ({
    loading: false,
    refreshing: false,
    error: "",
    data: null,
    refresh: vi.fn(),
  }),
  useClassificationReview: () => ({
    review: vi.fn().mockResolvedValue({}),
    submitting: false,
    error: "",
    lastRecord: null,
    reset: vi.fn(),
  }),
}));

vi.mock("../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  ...apiMocks,
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

const workbenchDetail = {
  requestId: "SI-2491",
  title: "Owner missing",
  rawTitle: "Owner missing",
  kind: "Owner missing",
  type: "owner",
  status: "Pending",
  priority: "P1 critical",
  requester: "svc-governance-sweeper",
  createdAt: "2026-04-17T12:00:00Z",
  dueAt: "2026-04-24T12:00:00Z",
  assetFqn: "experimental.sandbox.pricing_experiment_2025q4",
  assetName: "pricing_experiment_2025q4",
  domain: "Revenue & Sales",
  assigned: "Revenue Stewards",
  sla: "4d overdue",
  slaState: "crit",
  age: "11d",
  detail: "Auto-flag: no owner set; queries detected from 3 users.",
  evidence: "Auto-flag: no owner set; queries detected from 3 users.",
  implementation:
    "Items materialize from policy violations and auto-detection jobs into governance_state.stewardship_items.",
  suggestedActions: [
    {
      icon: "user-plus",
      label: "Assign owner from suggested teams",
      detail: "Sales Engineering: 92% match (queries, tags)",
    },
    {
      icon: "archive",
      label: "Archive sandbox cleanup",
      detail: "No queries in 30+ days",
    },
  ],
};

const workbenchPayload = {
  summary: {
    openWorkItems: 2,
    slaBreaches: 1,
  },
  requests: [
    workbenchDetail,
    {
      ...workbenchDetail,
      requestId: "SI-2487",
      title: "Description missing",
      rawTitle: "Description missing",
      kind: "Description missing",
      type: "description",
      priority: "P2",
      assetFqn: "product_events.bronze.clickstream_events",
      assetName: "clickstream_events",
      domain: "Customer",
      assigned: "Customer Stewards",
      sla: "2d left",
      slaState: "warn",
      age: "5d",
      detail: "No steward-approved description is recorded for this customer-facing event table.",
      evidence: "No steward-approved description is recorded for this customer-facing event table.",
      suggestedActions: [
        {
          icon: "sparkles",
          label: "Draft description with Atlas AI",
          detail: "Grounded by upstream lineage and column metadata.",
        },
      ],
    },
  ],
  selectedRequest: workbenchDetail,
};

function renderGovernance(overrides = {}) {
  const props = {
    bootstrap: {
      assets: [],
      shell: {
        role: "Steward",
        diagnosticsEnabled: true,
      },
    },
    contextSeedAssets: [],
    governance: governancePayload,
    initialAssetFqn: "",
    onGovernanceChange: vi.fn(),
    onNavigationStateChange: vi.fn(),
    onOpenAsset: vi.fn(),
    onOpenLineage: vi.fn(),
    onRouteAssetChange: vi.fn(),
    onSurfaceReady: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(<GovernanceWorkspace {...props} />),
  };
}

function requestRowButton(label) {
  const button = screen
    .getAllByText(label)
    .map((element) => element.closest("button"))
    .find(Boolean);
  if (!button) {
    throw new Error(`Unable to find request row button for ${label}`);
  }
  return button;
}

function expectVisibleText(label) {
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
}

describe("GovernanceWorkspace", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useGovernanceGlossaryTermMock.mockReset();
    useGovernanceAuditTimelineMock.mockReset();
    useAssetSearchMock.mockReset();
    useSeededAssetContextMock.mockReset();

    apiMocks.createGovernanceRequest.mockReset();
    apiMocks.fetchGovernanceRequestDetail.mockReset();
    apiMocks.fetchGovernanceWorkbench.mockReset();
    apiMocks.normalizeGovernancePayload.mockClear();
    apiMocks.updateGovernanceGlossaryTerm.mockReset();
    apiMocks.updateGovernanceRequest.mockReset();
    apiMocks.upsertGovernanceGlossaryTerm.mockReset();
    apiMocks.upsertGovernanceOwner.mockReset();

    apiMocks.fetchGovernanceWorkbench.mockResolvedValue(workbenchPayload);
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValue(workbenchDetail);
    apiMocks.updateGovernanceRequest.mockResolvedValue({ governance: governancePayload });

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

  it("renders the North Star Stewardship Workbench from the live workbench API", async () => {
    renderGovernance();

    expect(screen.queryByRole("button", { name: "Diagnostics" })).toBeNull();
    expect(screen.getByText("Stewardship Workbench")).not.toBeNull();

    await waitFor(() => {
      expect(apiMocks.fetchGovernanceWorkbench).toHaveBeenCalledWith(
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "2 open work items · 1 SLA breaches" })).not.toBeNull();
      expectVisibleText("Owner missing");
    });
    expect(screen.getByRole("button", { name: "Filter" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Bulk assign" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "New work item" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "All 2" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "P1 critical 1" })).not.toBeNull();
    expect(screen.getByRole("table", { name: "Work queue table" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "SI-2491" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Why this is open" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Suggested actions" })).not.toBeNull();
    expect(screen.getByText("Auto-flag: no owner set; queries detected from 3 users.")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Open Governance Requests" })).toBeNull();
  });

  it("does not infer missing priority, domain, comments, or evidence", async () => {
    const unbackedDetail = {
      ...workbenchDetail,
      priority: "",
      domain: "",
      assigned: "",
      detail: "",
      evidence: "",
      businessContext: "",
      suggestedActions: [],
    };
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      ...workbenchPayload,
      summary: {
        openWorkItems: 1,
        slaBreaches: 1,
      },
      requests: [unbackedDetail],
      selectedRequest: unbackedDetail,
    });
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValueOnce(unbackedDetail);

    renderGovernance();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "SI-2491" })).not.toBeNull();
    });
    expect(screen.queryByRole("heading", { name: "Review customer payment ownership" })).toBeNull();

    expect(screen.getAllByText((_, node) => node?.textContent?.includes("Priority unassigned")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Customer")).toBeNull();
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    expect(screen.queryByText("Domain Approver")).toBeNull();
    expect(screen.getByText("No opening evidence was recorded for this work item.")).not.toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("keeps filter, queue pill, and action controls functional while hiding single-page pagination", async () => {
    renderGovernance();

    await waitFor(() => {
      expectVisibleText("Owner missing");
      expectVisibleText("Description missing");
    });

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByText("Filter work queue")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "P1 critical (1)" }));
    expect(screen.getByRole("button", { name: "P1 critical 1" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "P1 critical 1" }));
    expect(screen.getByRole("heading", { name: "SI-2491" })).not.toBeNull();
    expect(screen.queryByText("Description missing")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Overdue 1" }));
    expect(screen.getByRole("heading", { name: "SI-2491" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Bulk assign" }));
    expect(screen.getByRole("heading", { name: "Bulk assignment requires a backed workflow" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Submit assignment unavailable" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "New work item" }));
    expect(screen.getByRole("heading", { name: "New work item creation is unavailable" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create work item unavailable" }).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("bases assigned-to-me counts on the signed-in user identity", async () => {
    const assignedToCurrentUser = {
      ...workbenchDetail,
      requestId: "SI-2501",
      title: "Finance owner review",
      rawTitle: "Finance owner review",
      kind: "Finance owner review",
      assigned: "Skyler Myers",
    };
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      ...workbenchPayload,
      summary: {
        openWorkItems: 2,
        slaBreaches: 1,
      },
      requests: [workbenchDetail, assignedToCurrentUser],
      selectedRequest: workbenchDetail,
    });

    renderGovernance({ currentUser: { name: "Skyler Myers", email: "skyler.myers@entrada.ai" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Assigned to me 1" })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Assigned to me 1" }));
    expectVisibleText("Finance owner review");
    expect(screen.queryByText("Owner missing")).toBeNull();
  });

  it("filters validation seed rows from the live stewardship queue", async () => {
    const validationSeed = {
      ...workbenchDetail,
      requestId: "ga-home-seed-request-9",
      id: "ga-home-seed-request-9",
      title: "Validation sample owner check",
      rawTitle: "Validation sample owner check",
      kind: "Validation sample owner check",
      source: "validation_seed",
      validationSample: true,
    };
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      ...workbenchPayload,
      summary: {
        openWorkItems: 2,
        slaBreaches: 2,
      },
      requests: [validationSeed, workbenchDetail],
      selectedRequest: workbenchDetail,
    });

    renderGovernance();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "1 open work items · 1 SLA breaches" })).not.toBeNull();
    });
    expectVisibleText("Owner missing");
    expect(screen.queryByText("Validation sample owner check")).toBeNull();
    expect(screen.queryByText("VAL-9")).toBeNull();
    expect(screen.getByRole("button", { name: "All 1" })).not.toBeNull();
  });

  it("shows prototype stewardship rows as non-authoritative and disables mutations", async () => {
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      ...workbenchPayload,
      meta: {
        state: "prototype_mock",
        source: "prototype_mock",
      },
      requests: [workbenchDetail],
      selectedRequest: workbenchDetail,
    });
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValueOnce(workbenchDetail);

    renderGovernance();

    await waitFor(() => {
      expect(screen.getByText(/Prototype stewardship rows preserve the target queue/)).not.toBeNull();
    });

    const commentButton = screen.getByRole("button", { name: "Comment" });
    const resolveButton = screen.getByRole("button", { name: "Resolve" });
    expect(commentButton.disabled).toBe(true);
    expect(resolveButton.disabled).toBe(true);
    expect(commentButton.getAttribute("title")).toContain("Prototype work items");
    fireEvent.click(commentButton);
    fireEvent.click(resolveButton);
    expect(apiMocks.updateGovernanceRequest).not.toHaveBeenCalled();
  });

  it("switches selected requests without losing the real request id", async () => {
    renderGovernance();

    await waitFor(() => {
      expect(apiMocks.fetchGovernanceRequestDetail).toHaveBeenCalledWith(
        "SI-2491",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    apiMocks.fetchGovernanceRequestDetail.mockResolvedValueOnce(workbenchPayload.requests[1]);
    fireEvent.click(requestRowButton("Description missing"));

    await waitFor(() => {
      expect(apiMocks.fetchGovernanceRequestDetail).toHaveBeenCalledWith(
        "SI-2487",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "SI-2487" })).not.toBeNull();
    });
    expectVisibleText("Description missing");
    expect(screen.getByText("No steward-approved description is recorded for this customer-facing event table.")).not.toBeNull();
    expect(screen.getByText("Draft description with Atlas AI")).not.toBeNull();
  });

  it("executes request actions through the governance update API", async () => {
    renderGovernance();

    await waitFor(() => {
      expectVisibleText("Owner missing");
    });

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(apiMocks.updateGovernanceRequest).toHaveBeenCalledWith("SI-2491", {
        status: "Pending",
        reviewNote: "Comment recorded from Stewardship Workbench.",
      });
    });
    expect(screen.getByText("Comment recorded.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => {
      expect(apiMocks.updateGovernanceRequest).toHaveBeenLastCalledWith("SI-2491", {
        status: "resolved",
        reviewNote: "Resolved from Stewardship Workbench.",
      });
    });
    expect(screen.getByText("Work item resolved.")).not.toBeNull();
  });

  it("wires affected asset route handoff without exposing non-prototype close or lineage chrome", async () => {
    const onOpenLineage = vi.fn();
    const onOpenAsset = vi.fn();
    renderGovernance({ onOpenAsset, onOpenLineage });

    await waitFor(() => {
      expectVisibleText("Owner missing");
    });

    fireEvent.click(screen.getByRole("button", { name: /experimental\.sandbox\.pricing_experiment_2025q4/ }));
    await waitFor(() => {
      expect(openAssetRecordSafely).toHaveBeenCalledWith(
        "experimental.sandbox.pricing_experiment_2025q4",
        expect.objectContaining({
          loadingLabel: "Opening metadata record…",
          onOpen: expect.any(Function),
        }),
      );
    });
    openAssetRecordSafely.mock.calls.at(-1)[1].onOpen();
    expect(onOpenAsset).toHaveBeenCalledWith("experimental.sandbox.pricing_experiment_2025q4");

    expect(screen.queryByRole("button", { name: "Open lineage context ->" })).toBeNull();
    expect(screen.getByText("Implementation")).not.toBeNull();
    expect(onOpenLineage).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Close request detail" })).toBeNull();
  });

  it("records suggested-action clicks without mutating governance state", async () => {
    renderGovernance();

    await waitFor(() => {
      expectVisibleText("Assign owner from suggested teams");
    });

    fireEvent.click(screen.getByRole("button", { name: /Assign owner from suggested teams/ }));
    expect(screen.getByRole("heading", { name: "Assign owner from suggested teams" })).not.toBeNull();
    expect(screen.getByText("Suggested action review")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Run suggested action unavailable" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    fireEvent.click(screen.getByRole("button", { name: /Archive sandbox cleanup/ }));
    expect(screen.getByRole("heading", { name: "Archive sandbox cleanup" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Run suggested action unavailable" }).disabled).toBe(true);
    expect(apiMocks.updateGovernanceRequest).not.toHaveBeenCalled();
  });

  it("renders an honest degraded state when the workbench API is unavailable", async () => {
    apiMocks.fetchGovernanceWorkbench.mockRejectedValueOnce(new Error("Governance store unavailable"));

    renderGovernance({
      governance: {
        ...governancePayload,
        backlog: [
          {
            requestId: "fallback-1",
            title: "Fallback ownership review",
            kind: "Fallback ownership review",
            asset: "main.sales.orders",
            assetFqn: "main.sales.orders",
            status: "Pending",
            note: "Live governance request from bootstrap payload.",
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Governance workbench degraded")).not.toBeNull();
    });

    expect(screen.getByText("Governance store unavailable")).not.toBeNull();
    expectVisibleText("Fallback ownership review");
  });

  it("keeps scoped empty states truthful instead of inventing requests", async () => {
    renderGovernance({ initialAssetFqn: "datapact.governance_atlas_demo.unrelated_asset" });

    await waitFor(() => {
      expect(screen.getByText("No actor-visible work items")).not.toBeNull();
    });
    expect(screen.getByText("Queue shape retained; no synthetic `SI-*` request row is created.")).not.toBeNull();
    expect(screen.getByText((content) => content.includes("SLA evidence unavailable"))).not.toBeNull();

    const detailRail = screen.getByRole("complementary", { name: "Selected governance request" });
    await waitFor(() => {
      expect(
        within(detailRail).getByText(/Select a work item to review evidence/),
      ).not.toBeNull();
    });
  });
});
