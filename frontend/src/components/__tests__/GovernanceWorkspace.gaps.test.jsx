import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GovernanceWorkspace from "../GovernanceWorkspace";

const useAssetDetailMock = vi.fn();
const useSeededAssetContextMock = vi.fn();

const apiMocks = vi.hoisted(() => ({
  createGovernanceRequest: vi.fn(),
  fetchGovernanceRequestDetail: vi.fn(),
  fetchGovernanceWorkbench: vi.fn(),
  normalizeGovernancePayload: vi.fn((payload) => payload),
  updateGovernanceRequest: vi.fn(),
}));

vi.mock("../../hooks/useAssetDetail", () => ({
  canOpenAssetRecord: vi.fn(() => true),
  invalidateAssetDetail: vi.fn(),
  prefetchAssetDetail: vi.fn(() => Promise.resolve(null)),
  primeAssetDetail: vi.fn(),
  useAssetDetail: (...args) => useAssetDetailMock(...args),
}));

vi.mock("../../hooks/useAssetSearch", () => ({
  clearAssetSearchCache: vi.fn(),
}));

vi.mock("../../hooks/useSeededAssetContext", () => ({
  useSeededAssetContext: (...args) => useSeededAssetContextMock(...args),
}));

vi.mock("../../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: vi.fn(),
}));

vi.mock("../../lib/api", () => ({ ...apiMocks }));

const governancePayload = {
  authoritative: true,
  provenance: { warnings: [] },
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
  suggestedActions: [],
};

const workbenchPayload = {
  requests: [workbenchDetail],
  selectedRequest: workbenchDetail,
};

function renderGovernance(overrides = {}) {
  const props = {
    bootstrap: {
      assets: [],
      shell: { role: "Steward" },
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
  return { props, ...render(<GovernanceWorkspace {...props} />) };
}

describe("GovernanceWorkspace gap fixes", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useSeededAssetContextMock.mockReset();
    apiMocks.createGovernanceRequest.mockReset();
    apiMocks.fetchGovernanceRequestDetail.mockReset();
    apiMocks.fetchGovernanceWorkbench.mockReset();
    apiMocks.normalizeGovernancePayload.mockClear();
    apiMocks.updateGovernanceRequest.mockReset();

    apiMocks.fetchGovernanceWorkbench.mockResolvedValue(workbenchPayload);
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValue(workbenchDetail);
    apiMocks.updateGovernanceRequest.mockResolvedValue({ governance: governancePayload });
    apiMocks.createGovernanceRequest.mockResolvedValue({ ok: true, requestId: "REQ-NEW-42" });

    useAssetDetailMock.mockReturnValue({ detail: null, loading: false, error: "" });
    useSeededAssetContextMock.mockReturnValue({ summary: null });
  });

  it("removes the dead Bulk assign control", async () => {
    renderGovernance();
    await waitFor(() => {
      expect(screen.getAllByText("Owner missing").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: "Bulk assign" })).toBeNull();
  });

  it("files a real governance request from the New work item panel", async () => {
    renderGovernance();
    await waitFor(() => {
      expect(screen.getAllByText("Owner missing").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "New work item" }));
    expect(screen.getByRole("heading", { name: "File a governance work item" })).not.toBeNull();

    fireEvent.change(screen.getByLabelText("New work item asset FQN"), {
      target: { value: "main.sales.orders" },
    });
    fireEvent.change(screen.getByLabelText("New work item title"), {
      target: { value: "Add a steward-approved description" },
    });
    fireEvent.change(screen.getByLabelText("New work item note"), {
      target: { value: "Flagged during discovery review." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create work item" }));

    await waitFor(() => {
      expect(apiMocks.createGovernanceRequest).toHaveBeenCalledWith(
        {
          assetFqn: "main.sales.orders",
          title: "Add a steward-approved description",
          note: "Flagged during discovery review.",
        },
        { fast: true },
      );
    });
    // Success toast + queue refresh (initial load + refresh = 2 calls).
    expect(await screen.findByText(/Work item created/)).not.toBeNull();
    await waitFor(() => {
      expect(apiMocks.fetchGovernanceWorkbench).toHaveBeenCalledTimes(2);
    });
  });

  it("disables New work item creation for readers with the role reason", async () => {
    renderGovernance({
      bootstrap: { assets: [], shell: { role: "Reader" } },
      currentUser: { email: "reader@example.com", name: "Reader", role: "Reader" },
    });
    await waitFor(() => {
      expect(screen.getAllByText("Owner missing").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "New work item" }));
    fireEvent.change(screen.getByLabelText("New work item asset FQN"), {
      target: { value: "main.sales.orders" },
    });
    fireEvent.change(screen.getByLabelText("New work item title"), {
      target: { value: "Anything" },
    });
    const submit = screen.getByRole("button", { name: "Create work item" });
    expect(submit.disabled).toBe(true);
    expect(submit.title).toMatch(/requires Writer, Steward, or Admin role/);
    fireEvent.click(submit);
    expect(apiMocks.createGovernanceRequest).not.toHaveBeenCalled();
  });

  it("shows Unassigned instead of falling back to the requester", async () => {
    const unassigned = {
      ...workbenchDetail,
      requestId: "SI-9001",
      title: "Requester-only item",
      rawTitle: "Requester-only item",
      kind: "Requester-only item",
      assigned: "",
      assignee: "",
      assignedTo: "",
      team: "",
      ownerTeam: "",
      requester: "Skyler Myers",
    };
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      requests: [unassigned],
      selectedRequest: unassigned,
    });
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValue(unassigned);

    renderGovernance({ currentUser: { name: "Skyler Myers", email: "skyler@entrada.ai" } });

    await waitFor(() => {
      expect(screen.getAllByText("Requester-only item").length).toBeGreaterThan(0);
    });
    // The requester must not be presented as the assignee...
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    // ...so "Assigned to me" stays honest at zero.
    expect(screen.getByRole("button", { name: "Assigned to me 0" })).not.toBeNull();
  });

  it("compresses long request ids to GOV-XXXXXXXX and keeps the full id on the tooltip", async () => {
    const longId = "9f8e7d6c-5b4a-3921-8076-54efab321098";
    const longIdItem = {
      ...workbenchDetail,
      requestId: longId,
      id: longId,
      title: "Tag change: orders",
      rawTitle: "Tag change: orders",
      kind: "Tag change: orders",
    };
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      requests: [longIdItem],
      selectedRequest: longIdItem,
    });
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValue(longIdItem);

    renderGovernance();

    await waitFor(() => {
      expect(screen.getAllByText("GOV-9F8E7D6C").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("heading", { name: "GOV-9F8E7D6C" }).getAttribute("title")).toBe(longId);
    expect(screen.getByRole("button", { name: "Copy ID" })).not.toBeNull();
  });

  it("renders the request diff as opening evidence instead of claiming none was recorded", async () => {
    const diffItem = {
      ...workbenchDetail,
      requestId: "SI-3001",
      title: "Tag change: orders",
      rawTitle: "Tag change: orders",
      kind: "Tag change: orders",
      detail: "",
      evidence: "",
      businessContext: "",
    };
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      requests: [diffItem],
      selectedRequest: diffItem,
    });
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValue({
      ...diffItem,
      diff: {
        before: {},
        after: { domain: "Finance" },
        rows: [{ field: "domain", label: "Domain", before: "", after: "Finance" }],
      },
    });

    renderGovernance();

    await waitFor(() => {
      expect(screen.getByText("This request proposes the metadata changes listed below.")).not.toBeNull();
    });
    expect(screen.queryByText("No opening evidence was recorded for this work item.")).toBeNull();
    const grid = document.querySelector('[aria-label="Requested metadata changes"]');
    expect(grid).not.toBeNull();
    expect(within(grid).getByText("Domain")).not.toBeNull();
    expect(within(grid).getByText("Finance")).not.toBeNull();
  });

  it("renders the backed comment timeline and re-fetches it after commenting", async () => {
    const commented = {
      ...workbenchDetail,
      comments: [
        {
          id: "review-note-SI-2491",
          author: "steward@entrada.ai",
          at: "2026-04-20T10:00:00Z",
          text: "Looks good, expanding scope.",
          kind: "review-note",
        },
      ],
      commentsState: "available",
    };
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValue(commented);

    renderGovernance();

    await waitFor(() => {
      expect(screen.getByText("Looks good, expanding scope.")).not.toBeNull();
    });
    const detailFetchesBefore = apiMocks.fetchGovernanceRequestDetail.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => {
      expect(apiMocks.updateGovernanceRequest).toHaveBeenCalledWith("SI-2491", {
        status: "Pending",
        reviewNote: "Comment recorded from Stewardship Workbench.",
      }, { fast: true });
    });
    await waitFor(() => {
      expect(apiMocks.fetchGovernanceRequestDetail.mock.calls.length).toBeGreaterThan(detailFetchesBefore);
    });
  });

  it("does not claim SLA evidence unavailable when requests carry created_at", async () => {
    const createdOnly = {
      ...workbenchDetail,
      sla: "",
      slaState: "",
      dueAt: "",
      createdAt: "2026-04-17T12:00:00Z",
    };
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      requests: [createdOnly],
      selectedRequest: createdOnly,
    });
    apiMocks.fetchGovernanceRequestDetail.mockResolvedValue(createdOnly);

    renderGovernance();

    await waitFor(() => {
      expect(screen.getAllByText("Owner missing").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/SLA evidence unavailable/)).toBeNull();
  });

  it("keeps the SLA-evidence-unavailable heading for an empty queue", async () => {
    apiMocks.fetchGovernanceWorkbench.mockResolvedValueOnce({
      requests: [],
      selectedRequest: null,
    });
    renderGovernance();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "0 open work items · SLA evidence unavailable" }),
      ).not.toBeNull();
    });
  });
});
