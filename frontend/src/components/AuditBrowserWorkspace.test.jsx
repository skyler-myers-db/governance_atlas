import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAuditEvidence } from "../lib/api";
import AuditBrowserWorkspace from "./AuditBrowserWorkspace";

vi.mock("../lib/api", () => ({
  fetchAuditEvidence: vi.fn(),
}));

const auditEvents = [
  {
    audit_id: "AUD-1",
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
        accessReviewsOpen: 3,
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
  });

  it("renders the prototype audit evidence surface", async () => {
    renderAudit();

    expect(await screen.findByText("Immutable governance event log")).toBeDefined();
    expect(screen.getByText("Audit Evidence")).toBeDefined();
    expect(screen.getByText(/Events are searchable, time-ordered, and exportable/i)).toBeDefined();
    expect(screen.queryByText(/cryptographically ordered/i)).toBeNull();
    expect(await screen.findByText("Events · 24h")).toBeDefined();
    expect(screen.getByText("Policy violations · 7d")).toBeDefined();
    expect(screen.getByText("Access reviews · open")).toBeDefined();
    expect(screen.getByText("Retention")).toBeDefined();
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
    expect(fetchAuditEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateRange: "24h", limit: 200 }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Date range$/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /7d/i }));

    expect(await screen.findByText("Audit date range set to 7d.")).toBeDefined();
    expect(fetchAuditEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateRange: "7d", limit: 200 }),
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
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/Retention policy not reported/)).toBeDefined();
  });
});
