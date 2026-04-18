/**
 * AuditTimelineDrawer — reverse-chronological audit log for a single asset.
 *
 * Renders a compact timeline of metadata_audit_log entries with actor,
 * action, timestamp, status tone, and a collapsible before/after JSON
 * diff. Fills the #1 Governance demo-day vulnerability flagged by the
 * Phase 2 design audit (compliance audit trail absent).
 */

import { useState } from "react";
import { SurfaceDrawer, SurfaceDrawerSection } from "../ShellLayoutPrimitives";
import { LoadingState } from "../ShellStatePrimitives";

function humanizeAction(action) {
  const normalized = String(action || "").trim();
  if (!normalized) return "Updated";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusTone(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "failed" || normalized === "rejected") return "bad";
  if (normalized === "pending" || normalized === "partial") return "warn";
  if (normalized === "success" || normalized === "applied") return "good";
  return "neutral";
}

function formatTimestamp(raw) {
  const value = String(raw || "").trim();
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatActor(entry) {
  const email = String(entry?.actorEmail || "").trim();
  const role = String(entry?.actorRole || "").trim();
  if (!email) return "Unknown actor";
  if (!role) return email;
  return `${email} · ${role}`;
}

function jsonPreview(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function TimelineEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const before = jsonPreview(entry.beforeJson);
  const after = jsonPreview(entry.afterJson);
  const hasDiff = Boolean(before || after);
  const tone = statusTone(entry.status);

  return (
    <article className="gh-audit-entry">
      <div className="gh-audit-entry-head">
        <span className={`gh-chip gh-chip-status tone-${tone}`}>
          {humanizeAction(entry.action)}
        </span>
        <span className="gh-audit-entry-time">{formatTimestamp(entry.createdAt)}</span>
      </div>
      <div className="gh-audit-entry-actor">{formatActor(entry)}</div>
      {entry.columnName ? (
        <div className="gh-audit-entry-meta">Column: <code>{entry.columnName}</code></div>
      ) : null}
      {entry.detail ? <div className="gh-support-copy">{entry.detail}</div> : null}
      {hasDiff ? (
        <button
          className="gh-tertiary-button gh-inline-link-button gh-audit-entry-toggle"
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          {expanded ? "Hide change" : "View change"}
        </button>
      ) : null}
      {expanded && hasDiff ? (
        <div className="gh-audit-entry-diff">
          {before ? (
            <div>
              <div className="gh-panel-title">Before</div>
              <pre className="gh-audit-entry-pre">{before}</pre>
            </div>
          ) : null}
          {after ? (
            <div>
              <div className="gh-panel-title">After</div>
              <pre className="gh-audit-entry-pre">{after}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function AuditTimelineDrawer({
  assetFqn,
  entries,
  loading,
  refreshing,
  error,
  total,
  isOpen,
  onClose,
  onRefresh,
}) {
  const hasEntries = Array.isArray(entries) && entries.length > 0;

  return (
    <SurfaceDrawer
      actions={
        <>
          {onRefresh ? (
            <button
              className="gh-tertiary-button gh-inline-link-button"
              disabled={refreshing}
              onClick={() => onRefresh()}
              type="button"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
          <button className="gh-secondary-button" onClick={() => onClose?.()} type="button">
            Close drawer
          </button>
        </>
      }
      className="gh-audit-timeline-drawer"
      eyebrow="Audit timeline"
      isOpen={isOpen}
      onClose={onClose}
      title={assetFqn || "Select an asset"}
    >
      <SurfaceDrawerSection>
        {loading ? (
          <LoadingState message="Loading audit history…" />
        ) : error ? (
          <div className="gh-support-copy">{error}</div>
        ) : !hasEntries ? (
          <div className="gh-support-copy">
            No audit entries recorded yet for this asset. Metadata writes — description
            edits, tag updates, owner changes, governance workflow transitions — will
            appear here as they happen.
          </div>
        ) : (
          <>
            <div className="gh-audit-entry-count">
              {total === 1 ? "1 audit entry" : `${total} audit entries`}
            </div>
            <div className="gh-audit-entry-list">
              {entries.map((entry) => (
                <TimelineEntry key={entry.auditId || `${entry.createdAt}-${entry.action}`} entry={entry} />
              ))}
            </div>
          </>
        )}
      </SurfaceDrawerSection>
    </SurfaceDrawer>
  );
}
