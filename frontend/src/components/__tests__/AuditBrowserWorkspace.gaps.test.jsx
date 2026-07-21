import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditBrowserWorkspace from "../AuditBrowserWorkspace";
import { fetchAuditEvidence } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  fetchAuditEvents: vi.fn(() => Promise.resolve([])),
  fetchAuditEvidence: vi.fn(),
}));

const shell = { userEmail: "skyler@entrada.ai", role: "admin" };

function auditEvent(id, overrides = {}) {
  return {
    audit_id: id,
    displayAuditId: id,
    entity_fqn: "main.customer.customer_dim",
    entity_type: "table",
    action: "metadata updated",
    status: "success",
    detail: "Owner changed",
    created_at: "2026-07-19T12:00:00Z",
    actor_email: "skyler@entrada.ai",
    diffState: "unavailable",
    diffReason: "No before/after metadata was recorded for this event.",
    ...overrides,
  };
}

function envelope(events, summaryOverrides = {}, metaOverrides = {}) {
  return {
    data: {
      summary: {
        totalChanges: events.length,
        dateRange: "24h",
        policyChanges: 0,
        policyViolations: 0,
        approvals: 0,
        // Renamed contract: governanceRequests replaced accessReviews* keys.
        governanceRequests: { label: "Governance requests", open: null, resolved: null, source: "" },
        failedActions: 0,
        lastEventAt: "",
        hiddenRowsExcluded: 0,
        sourceTable: "main.governance.metadata_audit_log",
        summarySource: "governance audit log",
        ...summaryOverrides,
      },
      events,
      selectedEvent: events[0] || null,
      evidence: null,
    },
    meta: {
      state: "available",
      authoritative: true,
      source: "governance-store+metadata-audit-log",
      ...metaOverrides,
    },
  };
}

function renderWorkspace(payload) {
  fetchAuditEvidence.mockResolvedValue(payload);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditBrowserWorkspace shell={shell} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditBrowserWorkspace gap fixes", () => {
  it("shows guidance and a 90d switch when the default range is empty", async () => {
    renderWorkspace(envelope([], { lastEventAt: "2026-07-01T08:30:00Z" }));
    await screen.findByText("No governance events in the last 24 hours");
    expect(screen.getByText(/Most recent governance activity was recorded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show last 90 days" }));
    await waitFor(() => {
      expect(fetchAuditEvidence).toHaveBeenCalledWith(expect.objectContaining({ dateRange: "90d" }));
    });
  });

  it("paginates with Load more and reports Showing X of Y plus excluded rows", async () => {
    const events = Array.from({ length: 20 }, (_, index) => auditEvent(`AUD-${String(index + 1).padStart(4, "0")}`));
    const { container } = renderWorkspace(envelope(events, { hiddenRowsExcluded: 3 }));
    await screen.findByText(/Showing 8 of 20 events/);
    expect(container.querySelectorAll(".gh-audit-row")).toHaveLength(8);
    expect(screen.getByText(/3 rows excluded by governance scoping/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText(/Showing 16 of 20 events/);
    expect(container.querySelectorAll(".gh-audit-row")).toHaveLength(16);
  });

  it("reads policyViolations and the renamed governanceRequests tile from the backed summary", async () => {
    renderWorkspace(
      envelope([auditEvent("AUD-0001")], {
        policyViolations: 4,
        failedActions: 9,
        // Renamed contract (wave 1): the tile is "Governance requests" with
        // both counts from the change-request ledger; accessReviews* is gone.
        governanceRequests: {
          label: "Governance requests",
          open: 2,
          resolved: 5,
          source: "governance change requests",
        },
      }),
    );
    // Wait for the payload to land — the KPI labels render during loading too.
    await screen.findByText(/Showing 1 of 1 events/);
    const policyCard = screen.getByText("Policy violations").closest("article");
    expect(policyCard.querySelector("strong").textContent).toBe("4");
    const requestsCard = screen.getByText("Governance requests · open").closest("article");
    expect(requestsCard.querySelector("strong").textContent).toBe("2");
    expect(screen.getByText(/5 resolved · governance change requests/)).toBeTruthy();
    expect(screen.queryByText("Access reviews · open")).toBeNull();
    expect(screen.queryByText("Retention")).toBeNull();
    // The impossible "· 7d" label variant is gone for good.
    expect(screen.queryByText("Policy violations · 7d")).toBeNull();
  });

  it("renders the whitelisted before/after diff and shows the reason when redacted", async () => {
    const available = auditEvent("AUD-0001", {
      request_id: "REQ-1",
      displayRequestId: "REQ-1",
      before_json: JSON.stringify({ owner: "old.owner@entrada.ai" }),
      after_json: JSON.stringify({ owner: "skyler-new@entrada.ai" }),
      diffState: "available",
      diffReason: "",
    });
    renderWorkspace(envelope([available]));
    await screen.findByText("old.owner@entrada.ai");
    expect(screen.getByText("skyler-new@entrada.ai")).toBeTruthy();
    expect(screen.queryByText(/No before\/after metadata diff was reported/)).toBeNull();
  });

  it("shows the redaction reason so an empty diff reads deliberate", async () => {
    const redacted = auditEvent("AUD-0001", {
      request_id: "REQ-1",
      displayRequestId: "REQ-1",
      before_json: "",
      after_json: "",
      diffState: "redacted",
      diffReason: "Only internal store identifiers changed in this event; no customer-safe metadata fields remain after redaction.",
    });
    renderWorkspace(envelope([redacted]));
    await screen.findByText(/Only internal store identifiers changed/);
  });

  it("suppresses the repeated No detail recorded placeholder", async () => {
    renderWorkspace(envelope([
      auditEvent("AUD-0001", { detail: "" }),
      auditEvent("AUD-0002", { detail: "" }),
    ]));
    await screen.findByText(/Showing 2 of 2 events/);
    expect(screen.queryByText("No detail recorded")).toBeNull();
  });

  it("renders a short GOV-<hex8> evidence id with the full id preserved on title", async () => {
    const uuid = "a1b2c3d4-e5f6-4789-8abc-def012345678";
    renderWorkspace(envelope([
      auditEvent("AUD-0001", { request_id: uuid, displayRequestId: uuid }),
    ]));
    const shortIds = await screen.findAllByText(/GOV-a1b2c3d4/);
    expect(shortIds.length).toBeGreaterThan(0);
    // Exact match targets the Evidence ID <dd>; the Evidence summary <dd>
    // embeds the short id inside a longer string.
    const detailValue = screen.getByText("GOV-a1b2c3d4", { selector: "dd" });
    expect(detailValue.getAttribute("title")).toBe(uuid);
  });

  it("renders backlog aging on the governance-requests tile from oldestOpenCreatedAt", async () => {
    renderWorkspace(
      envelope([auditEvent("AUD-0001")], {
        governanceRequests: {
          label: "Governance requests",
          open: 2,
          resolved: 5,
          source: "governance change requests",
          // Backend now ships the created-at of the oldest open request so
          // the tile can show how long the backlog has been sitting.
          oldestOpenCreatedAt: "2026-05-05T02:26:52Z",
        },
      }),
    );
    await screen.findByText(/Showing 1 of 1 events/);
    expect(
      screen.getByText(/5 resolved · oldest open since May 5, 2026 · governance change requests/),
    ).toBeTruthy();
  });

  it("shows an aria-busy skeleton (never the real-empty copy) while the payload loads", async () => {
    // Deferred payload: the query stays pending until we resolve it.
    let resolvePayload;
    fetchAuditEvidence.mockReturnValue(new Promise((resolve) => { resolvePayload = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuditBrowserWorkspace shell={shell} />
      </QueryClientProvider>,
    );

    // Loading phase: skeleton rows, no "no events match" claim, and the
    // governance tile support line reads as loading rather than settled
    // source text.
    expect(screen.getByLabelText("Loading audit events")).toBeTruthy();
    expect(screen.getByLabelText("Loading audit events").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("No audit events match the current filters.")).toBeNull();
    expect(screen.getByText("Reading governance requests")).toBeTruthy();

    resolvePayload(envelope([auditEvent("AUD-0001")]));
    await screen.findByText(/Showing 1 of 1 events/);
    expect(screen.queryByLabelText("Loading audit events")).toBeNull();
  });

  it("treats governanceRequests.state === 'loading' as a hydrating tile (feature-detected)", async () => {
    renderWorkspace(
      envelope([auditEvent("AUD-0001")], {
        governanceRequests: {
          label: "Governance requests",
          state: "loading",
          open: null,
          resolved: null,
          source: "governance change requests",
        },
      }),
    );
    await screen.findByText(/Showing 1 of 1 events/);
    const requestsCard = screen.getByText("Governance requests · open").closest("article");
    expect(requestsCard.querySelector("strong").textContent).toBe("Loading...");
    expect(screen.getByText("Reading governance requests")).toBeTruthy();
    // The settled source/reason text must not render mid-hydration.
    expect(screen.queryByText(/governance change requests/)).toBeNull();
  });

  it("keeps tab counts consistent with the free-text filtered set", async () => {
    renderWorkspace(envelope([
      auditEvent("AUD-0001", { detail: "Bulk import committed" }),
      auditEvent("AUD-0002", { detail: "Owner changed" }),
      auditEvent("AUD-0003", { detail: "Owner changed" }),
    ]));
    await screen.findByText(/Showing 3 of 3 events/);
    expect(screen.getByRole("button", { name: /All events, 3 events/ })).toBeTruthy();

    // Apply a free-text filter that matches only one row: the caption AND the
    // tab counts must agree (the audit caught caption=20 vs tab=24).
    fireEvent.change(screen.getByLabelText("Search audit events"), { target: { value: "bulk" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await screen.findByText(/Showing 1 of 1 events/);
    expect(screen.getByRole("button", { name: /All events, 1 events/ })).toBeTruthy();
  });

  it("keeps the loading skeleton up while the payload is hydrating", async () => {
    renderWorkspace(
      envelope([], { totalChanges: 0 }, {
        state: "loading",
        authoritative: false,
        capabilities: { hydrating: true },
      }),
    );
    await screen.findByText("Loading audit trail");
    // Never final-looking zeros while hydrating.
    expect(screen.queryByText("No governance events in the last 24 hours")).toBeNull();
    expect(screen.getAllByText("Loading...").length).toBeGreaterThan(0);
  });

  it("shows the active date range on the trigger, tab counts, and real source-table provenance", async () => {
    renderWorkspace(envelope([auditEvent("AUD-0001")], { sourceTable: "main.governance.metadata_audit_log" }));
    // Wait for the payload to land first; the header renders during loading too.
    await screen.findByText(/main\.governance\.metadata_audit_log/);
    expect(screen.getByText("Date range · 24h")).toBeTruthy();
    expect(screen.getByRole("button", { name: /All events, 1 events/ })).toBeTruthy();
    // Authoritative payload: the stale "Export and retention controls stay
    // unavailable" placeholder sentence must be gone.
    expect(screen.queryByText(/Export and retention controls stay unavailable/)).toBeNull();
  });
});
