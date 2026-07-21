import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAuditEvents, fetchAuditEvidence } from "../lib/api";
import AuditBrowserWorkspace from "./AuditBrowserWorkspace";

vi.mock("../lib/api", () => ({
  fetchAuditEvents: vi.fn(),
  fetchAuditEvidence: vi.fn(),
}));

const auditEvents = [
  {
    audit_id: "AUD-1",
    displayAuditId: "AUD-1",
    auditEventId: "9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f",
    entity_fqn: "finance_prod.curated.revenue_daily",
    entity_type: "table",
    action: "Certification",
    status: "success",
    source: "owner, description, lineage coverage, freshness SLA",
    detail: "Re-certified for Q2 2026.",
    created_at: "2026-04-27T09:14:22Z",
    actor_email: "marisol.reyes@entrada.ai",
    actor_role: "Finance Steward",
    request_id: "SI-2482",
    domain: "Finance",
  },
  {
    audit_id: "AUD-2",
    displayAuditId: "AUD-2",
    auditEventId: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
    entity_fqn: "experimental.sandbox.pricing_experiment_2025q4",
    entity_type: "table",
    action: "Policy violation",
    status: "failed",
    source: "Owner grant check",
    detail: "Owner-required policy failed.",
    created_at: "2026-04-27T07:58:01Z",
    actor_email: "svc-policy-engine",
    actor_role: "Service",
    request_id: "SI-2491",
    domain: "Revenue & Sales",
  },
];

function auditEnvelope() {
  return {
    data: {
      summary: {
        events24h: 2184,
        policyViolations: 6,
        // Renamed contract: governanceRequests replaced the accessReviews*
        // keys — both counts come from the change-request ledger and the
        // label ships in the payload.
        governanceRequests: {
          label: "Governance requests",
          open: 3,
          resolved: 5,
          source: "governance change requests",
        },
        retentionYears: 7,
      },
      events: auditEvents,
      selectedEvent: auditEvents[0],
    },
    meta: {
      source: "governance-store+metadata-audit-log",
      state: "available",
      authoritative: true,
    },
  };
}

function renderAudit(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditBrowserWorkspace {...props} />
    </QueryClientProvider>,
  );
}

describe("AuditBrowserWorkspace", () => {
  beforeEach(() => {
    fetchAuditEvidence.mockReset();
    fetchAuditEvidence.mockResolvedValue(auditEnvelope());
    fetchAuditEvents.mockReset();
    fetchAuditEvents.mockResolvedValue([]);
  });

  it("renders the prototype audit evidence surface", async () => {
    renderAudit();

    expect(await screen.findByText("Immutable governance event log")).toBeDefined();
    expect(screen.getByText("Audit Evidence")).toBeDefined();
    expect(screen.getByText(/records backed metadata workflow events/i)).toBeDefined();
    expect(screen.queryByText(/cryptographically ordered/i)).toBeNull();
    expect(await screen.findByText("Events · 24h")).toBeDefined();
    expect(screen.getByText("Policy violations")).toBeDefined();
    // Renamed tile: label comes from summary.governanceRequests.label.
    expect(screen.getByText("Governance requests · open")).toBeDefined();
    expect(screen.getByText("5 resolved · governance change requests")).toBeDefined();
    expect(screen.getByRole("button", { name: /Generate report/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Export CSV/i })).toBeDefined();

    const table = screen.getByLabelText("Audit events");
    expect(within(table).getByText("Time (UTC)")).toBeDefined();
    expect(within(table).getByText("Actor")).toBeDefined();
    expect(within(table).getByText("Event")).toBeDefined();
    expect(within(table).getByText("Target")).toBeDefined();
    expect(within(table).getByText("Evidence")).toBeDefined();
    expect(await within(table).findByText("Certification")).toBeDefined();
    expect(within(table).getByText("Policy violation")).toBeDefined();
    expect(screen.queryByText("Audit Trail & Change Evidence")).toBeNull();
  });

  it("does not call the steward/admin audit endpoint for a reader shell", () => {
    renderAudit({ shell: { role: "Reader", userEmail: "reader@example.com" } });

    expect(fetchAuditEvidence).not.toHaveBeenCalled();
    expect(screen.getByText("Audit trail is steward/admin only")).toBeDefined();
    expect(screen.getByText("Ask a workspace steward or admin to grant audit visibility.")).toBeDefined();
  });

  it("filters rows by users, services, and violations", async () => {
    renderAudit();

    const table = screen.getByLabelText("Audit events");
    await within(table).findByText("Certification");
    fireEvent.click(screen.getByRole("button", { name: /By services/i }));
    expect(within(table).getByText("Policy violation")).toBeDefined();
    expect(within(table).queryByText("Certification")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Violations/i }));
    expect(within(table).getByText("Policy violation")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /All events/i }));
    expect(within(table).getByText("Certification")).toBeDefined();
  });

  it("keeps audit actions interactive and routes evidence targets", async () => {
    const onOpenAsset = vi.fn();
    renderAudit({ onOpenAsset });

    await within(screen.getByLabelText("Audit events")).findByText("Certification");
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(screen.getByText(/CSV export prepared/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Generate report/i }));
    expect(screen.getByText(/Audit report generated/)).toBeDefined();

    const openButtons = screen.getAllByRole("button", { name: /Open evidence target/i });
    expect(openButtons[0].getAttribute("title")).toBe("Open evidence target asset");
    fireEvent.click(openButtons[0]);
    expect(onOpenAsset).toHaveBeenCalledWith("finance_prod.curated.revenue_daily");
  });

  it("opens a date-range menu and threads scope through the audit query", async () => {
    renderAudit();

    await within(screen.getByLabelText("Audit events")).findByText("Certification");
    // Fetch limit matches the backend max (500); 200 provably dropped
    // in-range 90d events from the view and its exports.
    expect(fetchAuditEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateRange: "24h", limit: 500 }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Date range/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /7d/i }));

    expect(await screen.findByText("Audit date range set to 7d.")).toBeDefined();
    expect(fetchAuditEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateRange: "7d", limit: 500 }),
    );
  });

  it("opens selected-row evidence details without faking unavailable diffs", async () => {
    const onOpenAsset = vi.fn();
    renderAudit({ onOpenAsset });

    const table = screen.getByLabelText("Audit events");
    fireEvent.click(await within(table).findByText("Certification"));

    const detail = screen.getByLabelText("Selected audit event detail");
    expect(within(detail).getByText("Selected evidence")).toBeDefined();
    expect(within(detail).getByText("SI-2482")).toBeDefined();
    expect(within(detail).getByText("No before/after metadata diff was reported for this event.")).toBeDefined();

    fireEvent.click(within(detail).getByRole("button", { name: /Open asset/i }));
    expect(onOpenAsset).toHaveBeenCalledWith("finance_prod.curated.revenue_daily");
  });

  it("preserves the prototype shell while unavailable", async () => {
    fetchAuditEvidence.mockRejectedValue(new Error("Audit endpoint failed"));
    renderAudit();

    expect(await screen.findByText("Audit trail unavailable")).toBeDefined();
    expect(screen.getByText("Immutable governance event log")).toBeDefined();
    expect(screen.getByLabelText("Audit filters")).toBeDefined();
    expect(screen.getByLabelText("Audit events")).toBeDefined();
  });

  it("preserves unavailable metric shape for degraded audit payloads", async () => {
    fetchAuditEvidence.mockResolvedValue({
      data: {
        summary: {
          eventsSupport: "No scoped event summary reported by audit API",
          retentionNote: "Retention policy not reported",
        },
        events: [],
      },
      meta: {
        source: "governance-store+metadata-audit-log",
        state: "degraded",
        authoritative: false,
        degraded: true,
      },
    });
    renderAudit();

    expect(await screen.findByText("No scoped event summary reported by audit API")).toBeDefined();
    expect(screen.getByText("No audit events match the current filters.")).toBeDefined();
    expect(screen.getByText("Events · 24h")).toBeDefined();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(3);
  });

  it("renders an explicit truncation caption and no longer hides marker-text rows client-side", async () => {
    fetchAuditEvidence.mockResolvedValue({
      data: {
        summary: {
          events24h: 500,
          windowTruncated: true,
          fetchedRows: 500,
          fetchLimit: 500,
          nonAuthoritativeRowsExcluded: 4,
        },
        events: [
          auditEvents[0],
          {
            ...auditEvents[1],
            audit_id: "AUD-3",
            displayAuditId: "AUD-3",
            action: "Comment added",
            // An actor writing "mock" in a comment must NOT hide the event:
            // suppression is server-side and counted, never a client regex.
            detail: "Please mock up the new tag layout before approving.",
          },
        ],
      },
      meta: {
        source: "governance-store+metadata-audit-log",
        state: "available",
        authoritative: true,
      },
    });
    renderAudit();

    const table = screen.getByLabelText("Audit events");
    expect(await within(table).findByText("Comment added")).toBeDefined();
    expect(within(table).getByText("Please mock up the new tag layout before approving.")).toBeDefined();
    expect(
      screen.getByText("Results truncated at 500 events — narrow the range for complete evidence."),
    ).toBeDefined();
    expect(screen.getByText(/4 non-authoritative rows excluded server-side/)).toBeDefined();
  });

  it("wires the structured filter bar through /api/audit/events", async () => {
    fetchAuditEvents.mockResolvedValue([
      {
        audit_id: "AUD-9",
        displayAuditId: "AUD-9",
        auditEventId: "abcdefabcdefabcdefabcdefabcdef12",
        entity_fqn: "finance_prod.curated.revenue_daily",
        action: "Description updated",
        status: "success",
        detail: "Filtered row from the audit events API.",
        created_at: "2026-07-20T10:00:00Z",
        actor_email: "marisol.reyes@entrada.ai",
      },
    ]);
    renderAudit();
    await within(screen.getByLabelText("Audit events")).findByText("Certification");

    fireEvent.change(screen.getByLabelText("Filter by actor email"), {
      target: { value: "marisol.reyes@entrada.ai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(fetchAuditEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          actorEmail: "marisol.reyes@entrada.ai",
          limit: 500,
          since: expect.any(String),
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    const table = screen.getByLabelText("Audit events");
    expect(await within(table).findByText("Description updated")).toBeDefined();
    expect(screen.getByText(/Server-side filter active · 1 matching event/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await within(table).findByText("Certification")).toBeDefined();
  });

  it("handles a 403 from the filtered audit events endpoint gracefully", async () => {
    const forbidden = Object.assign(new Error("Steward or admin role required."), { status: 403 });
    fetchAuditEvents.mockRejectedValue(forbidden);
    renderAudit();
    await within(screen.getByLabelText("Audit events")).findByText("Certification");

    fireEvent.change(screen.getByLabelText("Filter by actor email"), {
      target: { value: "someone@entrada.ai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(
      await screen.findByText(/Audit event filters require steward or admin permissions/),
    ).toBeDefined();
  });

  it("classifies real service principals in the By services chip", async () => {
    fetchAuditEvidence.mockResolvedValue({
      data: {
        summary: { events24h: 3 },
        events: [
          ...auditEvents,
          {
            audit_id: "AUD-4",
            displayAuditId: "AUD-4",
            entity_fqn: "finance_prod.curated.revenue_daily",
            action: "Quality run recorded",
            status: "success",
            detail: "Scheduled quality sweep.",
            created_at: "2026-04-27T06:00:00Z",
            actor_email: "metadata.quality@entrada.ai",
          },
        ],
      },
      meta: { source: "governance-store+metadata-audit-log", state: "available", authoritative: true },
    });
    renderAudit();

    const table = screen.getByLabelText("Audit events");
    await within(table).findByText("Certification");
    // svc-policy-engine + metadata.quality@ are services; marisol is not.
    expect(screen.getByRole("button", { name: "By services, 2 events" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /By services/i }));
    expect(within(table).getByText("Quality run recorded")).toBeDefined();
    expect(within(table).queryByText("Certification")).toBeNull();
  });

  it("rejects non-authoritative audit payload values before rendering source rows", async () => {
    fetchAuditEvidence.mockResolvedValue({
      data: {
        summary: {
          events24h: 999,
          sourceTable: "system.fake.audit",
        },
        events: auditEvents,
      },
      meta: {
        source: "prototype-mock",
        warnings: ["not live Databricks evidence"],
      },
    });
    renderAudit();

    expect(await screen.findByText("Audit evidence source unavailable · 24h scope")).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("Loading audit trail")).toBeNull();
    });
    expect(screen.queryByText("Certification")).toBeNull();
    expect(screen.queryByText("system.fake.audit")).toBeNull();
    expect(screen.getByText("No audit events match the current filters.")).toBeDefined();
  });
});
