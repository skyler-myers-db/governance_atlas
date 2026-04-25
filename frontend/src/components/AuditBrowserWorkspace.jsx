import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditEvents, fetchAuditEvidence } from "../lib/api";
import { EmptyStateBlock, LoadingState } from "./ShellStatePrimitives";
import {
  DataTable,
  EmptyState,
  MetricCard,
  PageHero,
  RightInspector,
  SectionCard,
  StatusPill,
} from "./northstar";
import "../styles/operations-pages.css";

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function eventId(event, index = 0) {
  return event?.audit_id || event?.auditId || event?.id || `${event?.created_at || "event"}-${index}`;
}

/**
 * Phase 13 — cross-entity audit browser.
 *
 * Steward/admin-only surface that filters the metadata_audit_log table
 * by actor, entity, action, and time. Complements the per-asset audit
 * timeline drawer with a site-wide view.
 */
export default function AuditBrowserWorkspace({ shell }) {
  const [actorEmail, setActorEmail] = useState("");
  const [entityFqn, setEntityFqn] = useState("");
  const [action, setAction] = useState("");
  const [since, setSince] = useState("");
  const [limit, setLimit] = useState(100);
  const [selectedAuditId, setSelectedAuditId] = useState("");

  const filters = useMemo(() => ({ actorEmail, entityFqn, action, since, limit }), [
    actorEmail,
    entityFqn,
    action,
    since,
    limit,
  ]);

  const query = useQuery({
    queryKey: ["auditEvents", filters],
    queryFn: ({ signal }) => fetchAuditEvents(filters, { signal }),
    retry: false,
  });
  const evidenceQuery = useQuery({
    queryKey: ["atlas", "audit-evidence", selectedAuditId || "latest", limit],
    queryFn: ({ signal }) => fetchAuditEvidence({ auditId: selectedAuditId, limit, signal }),
    retry: false,
  });

  const evidencePayload = envelopeData(evidenceQuery.data) || {};
  const compositeEvents = Array.isArray(evidencePayload.events) ? evidencePayload.events : [];
  const hasLegacyFilters = Boolean(actorEmail.trim() || entityFqn.trim() || action.trim() || since.trim());
  const filteredEvents = Array.isArray(query.data) ? query.data : [];
  const events = hasLegacyFilters ? filteredEvents : (compositeEvents.length ? compositeEvents : filteredEvents);
  const selectedEvent = evidencePayload.selectedEvent || events.find((event) => eventId(event) === selectedAuditId) || events[0] || null;
  const summary = evidencePayload.summary || {};
  // Errors thrown by the api request helper attach a `status` field.
  const isForbidden = Number((query.error && /** @type {any} */ (query.error).status) || 0) === 403;

  return (
    <section className="ga-page ga-operations-page ga-audit-page">
      <PageHero
        eyebrow="Audit"
        title="Audit Evidence Browser"
        subtitle="Cross-entity governance changes from the metadata audit log with evidence loaded from the composite audit API."
      />
      <div className="ga-kpi-grid four">
        <MetricCard label="Total Changes" value={(summary.totalChanges ?? events.length).toLocaleString()} />
        <MetricCard label="Policy Changes" value={(summary.policyChanges ?? "Unavailable").toLocaleString?.() || String(summary.policyChanges ?? "Unavailable")} />
        <MetricCard label="Approvals" value={(summary.approvals ?? "Unavailable").toLocaleString?.() || String(summary.approvals ?? "Unavailable")} />
        <MetricCard label="Failed Actions" value={(summary.failedActions ?? "Unavailable").toLocaleString?.() || String(summary.failedActions ?? "Unavailable")} />
      </div>
      <div className="ga-operations-two-column">
        <SectionCard title="Audit events" eyebrow="Live governance log">
          <div className="ga-filter-grid">
          <label className="ga-filter">
            <span className="gh-filter-label">Actor email</span>
            <input
              aria-label="Filter by actor email"
              className="gh-input"
              onChange={(event) => setActorEmail(event.target.value)}
              placeholder="alice@example.com"
              type="email"
              value={actorEmail}
            />
          </label>
          <label className="ga-filter">
            <span className="gh-filter-label">Entity FQN</span>
            <input
              aria-label="Filter by entity FQN"
              className="gh-input"
              onChange={(event) => setEntityFqn(event.target.value)}
              placeholder="main.gov.orders"
              type="text"
              value={entityFqn}
            />
          </label>
          <label className="ga-filter">
            <span className="gh-filter-label">Action</span>
            <input
              aria-label="Filter by action"
              className="gh-input"
              onChange={(event) => setAction(event.target.value)}
              placeholder="e.g. description.updated"
              type="text"
              value={action}
            />
          </label>
          <label className="ga-filter">
            <span className="gh-filter-label">Since</span>
            <input
              aria-label="Filter by since timestamp"
              className="gh-input"
              onChange={(event) => setSince(event.target.value)}
              placeholder="2026-04-01"
              type="text"
              value={since}
            />
          </label>
          <label className="ga-filter">
            <span className="gh-filter-label">Limit</span>
            <select
              aria-label="Result limit"
              className="gh-input"
              onChange={(event) => setLimit(Number(event.target.value))}
              value={String(limit)}
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </label>
        </div>

        {isForbidden ? (
          <EmptyStateBlock
            title="Audit browser is steward/admin only"
            message="Ask a workspace steward or admin to grant you audit visibility."
          />
        ) : query.isLoading ? (
          <LoadingState message="Loading audit events…" />
        ) : evidenceQuery.error ? (
          <EmptyState
            title="Audit evidence unavailable"
            message={evidenceQuery.error?.message || "Composite audit evidence could not be loaded."}
            tone="bad"
          />
        ) : query.error ? (
          <EmptyStateBlock
            title="Failed to load audit events"
            message={query.error?.message || "An unexpected error occurred."}
          />
        ) : events.length === 0 ? (
          <EmptyStateBlock
            title="No events match the current filters"
            message="Try relaxing a filter or expanding the time window."
          />
        ) : (
          <DataTable
            columns={[
              { key: "created_at", header: "Time", render: (event) => event.created_at || event.createdAt || "Unavailable" },
              { key: "actor_email", header: "Actor", render: (event) => event.actor_email || event.actorEmail || "Unavailable" },
              {
                key: "entity_fqn",
                header: "Entity",
                render: (event) => (
                  <button className="ga-link-button" type="button" onClick={() => setSelectedAuditId(eventId(event))}>
                    {event.entity_fqn || event.entity_id || "Unavailable"}
                  </button>
                ),
              },
              { key: "action", header: "Action", render: (event) => <StatusPill tone="info">{event.action || "Unavailable"}</StatusPill> },
              { key: "detail", header: "Detail", render: (event) => event.detail || "" },
            ]}
            rows={events.map((event, index) => ({ ...event, __rowKey: eventId(event, index) }))}
            rowKey="__rowKey"
          />
        )}
        </SectionCard>
        <RightInspector
          title="Evidence"
          subtitle={selectedEvent ? eventId(selectedEvent) : "No audit event selected"}
        >
          {selectedEvent ? (
            <div className="ga-inspector-stack">
              <dl className="ga-detail-list">
                <div><dt>Action</dt><dd>{selectedEvent.action || "Unavailable"}</dd></div>
                <div><dt>Actor</dt><dd>{selectedEvent.actor_email || selectedEvent.actorEmail || "Unavailable"}</dd></div>
                <div><dt>Entity</dt><dd>{selectedEvent.entity_fqn || selectedEvent.entity_id || "Unavailable"}</dd></div>
                <div><dt>Status</dt><dd>{selectedEvent.status || "Unavailable"}</dd></div>
                <div><dt>Linked Request</dt><dd>{evidencePayload.evidence?.linkedRequest || "Unavailable"}</dd></div>
              </dl>
              <div className="ga-evidence-block">
                <h3>Before</h3>
                <pre>{evidencePayload.evidence?.before || "Unavailable"}</pre>
              </div>
              <div className="ga-evidence-block">
                <h3>After</h3>
                <pre>{evidencePayload.evidence?.after || "Unavailable"}</pre>
              </div>
            </div>
          ) : (
            <EmptyState title="No evidence selected" message="Select an audit event to inspect stored before/after evidence." />
          )}
        </RightInspector>
      </div>
    </section>
  );
}
