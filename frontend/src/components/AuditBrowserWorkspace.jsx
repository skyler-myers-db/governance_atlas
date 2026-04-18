import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditEvents } from "../lib/api";
import { EmptyStateBlock, LoadingState } from "./ShellStatePrimitives";
import { SurfacePanelSection } from "./ShellLayoutPrimitives";

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

  const events = Array.isArray(query.data) ? query.data : [];
  // Errors thrown by the api request helper attach a `status` field.
  const isForbidden = Number((query.error && /** @type {any} */ (query.error).status) || 0) === 403;

  return (
    <section className="gh-audit-browser">
      <SurfacePanelSection
        title="Audit browser"
        titleMeta={
          <span className="gh-support-copy">
            Cross-entity audit events from the governance audit log. Filter by actor, entity, action, or time window.
          </span>
        }
      >
        <div className="gh-audit-browser-filters">
          <label className="gh-filter">
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
          <label className="gh-filter">
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
          <label className="gh-filter">
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
          <label className="gh-filter">
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
          <label className="gh-filter">
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
          <div className="gh-audit-browser-table">
            <div className="gh-audit-browser-row gh-audit-browser-head">
              <div>Time</div>
              <div>Actor</div>
              <div>Entity</div>
              <div>Action</div>
              <div>Detail</div>
            </div>
            {events.map((event) => (
              <div className="gh-audit-browser-row" key={event.audit_id}>
                <div className="gh-audit-ts">{event.created_at || ""}</div>
                <div>
                  <div className="gh-audit-actor">{event.actor_email || "—"}</div>
                  <div className="gh-support-copy">{event.actor_role || ""}</div>
                </div>
                <div>
                  <div className="gh-audit-entity">{event.entity_fqn || event.entity_id || "—"}</div>
                  <div className="gh-support-copy">
                    {event.entity_type}
                    {event.column_name ? ` / ${event.column_name}` : ""}
                  </div>
                </div>
                <div>
                  <span className="gh-chip gh-chip-soft">{event.action || "—"}</span>
                  <div className="gh-support-copy">{event.source || "api"}</div>
                </div>
                <div className="gh-audit-detail">{event.detail || ""}</div>
              </div>
            ))}
          </div>
        )}
      </SurfacePanelSection>
    </section>
  );
}
