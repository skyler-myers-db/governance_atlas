import { Badge } from "../components/system";

/*
 * app-shell/readinessPrimitives.jsx — shared building blocks for the two
 * pre-boot readiness surfaces (WorkspaceSetupWizard + Workspace-
 * DiagnosticsSurface), rebuilt on the system kit in cohesion follow-up 3.
 * These render BEFORE bootstrap can succeed, so they live in app-shell/
 * (dependency law: app-shell may import the system kit, never surfaces/).
 */

export function toneForState(state = "") {
  const normalized = String(state || "").trim().toLowerCase();
  if (["live", "available", "ready", "success"].includes(normalized)) return "good";
  if (["degraded", "unknown", "warning", "attention_required"].includes(normalized)) return "warn";
  return "bad";
}

export function labelForState(state = "") {
  const normalized = String(state || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function availabilityLabel(value) {
  if (typeof value !== "boolean") return "Unknown";
  return value ? "Available" : "Blocked";
}

/** State chip on the shared status vocabulary (Badge is the one pill). */
export function StateBadge({ state = "" }) {
  return <Badge tone={toneForState(state)}>{labelForState(state)}</Badge>;
}

/** Compact readiness KPI (replaces the legacy task-card SummaryCard). */
export function SummaryTile({ label, value, state, note }) {
  return (
    <div className="ga-shell-readiness-tile">
      <div className="ga-shell-readiness-tile-head">
        <StateBadge state={state} />
        <span className="ga-shell-readiness-tile-value">{value}</span>
      </div>
      <div className="ga-shell-readiness-tile-label">{label}</div>
      {note ? <p className="ga-shell-readiness-note">{note}</p> : null}
    </div>
  );
}

/** Label/value rows (replaces the legacy attribute-list markup). */
export function AttributeList({ items = [] }) {
  return (
    <dl className="ga-shell-attr-list">
      {items.map((item) => (
        <div className="ga-shell-attr-row" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChipRow({ children }) {
  return <div className="ga-shell-chip-row">{children}</div>;
}

/**
 * One list renderer for readiness steps, setup checks, access gates,
 * capability rows, claim narrowing, and feature flags (union of the legacy
 * DiagnosticsList + SetupList fields — every backed field still renders;
 * absent fields render nothing, never a fabricated value).
 */
export function ReadinessList({ items = [] }) {
  return (
    <div className="ga-shell-readiness-list">
      {items.map((item, index) => (
        <article
          className="ga-shell-readiness-item"
          key={`${item.key || item.name || item.label || item.surface || "item"}:${index}`}
        >
          <div className="ga-shell-readiness-item-topline">
            <div className="ga-shell-readiness-item-copy">
              <div className="ga-shell-readiness-item-title">
                {item.label || item.name || item.surface || "Step"}
              </div>
              <div className="ga-shell-readiness-item-meta">
                {item.summary || item.reason || item.rollout || item.source || ""}
              </div>
            </div>
            <div className="ga-shell-chip-row">
              {typeof item.enabled === "boolean" ? (
                <Badge tone="muted">{item.enabled ? "Enabled" : "Disabled"}</Badge>
              ) : null}
              <StateBadge state={item.state} />
            </div>
          </div>
          {item.detail || item.description || item.effect ? (
            <p className="ga-shell-readiness-note">{item.detail || item.description || item.effect}</p>
          ) : null}
          {item.rationale ? (
            <p className="ga-shell-readiness-note">
              <strong>Rationale:</strong> {item.rationale}
            </p>
          ) : null}
          {item.proofSource ? (
            <p className="ga-shell-readiness-note">
              <strong>Proof source:</strong> {item.proofSource}
            </p>
          ) : null}
          {item.evidence ? (
            <p className="ga-shell-readiness-note">
              <strong>Evidence:</strong> {item.evidence}
            </p>
          ) : null}
          {item.remediation ? (
            <p className="ga-shell-readiness-note">
              <strong>Remediation:</strong> {item.remediation}
            </p>
          ) : null}
          {item.blockedSurfaces?.length ? (
            <ChipRow>
              {item.blockedSurfaces.map((surface) => (
                <Badge key={`${item.key || item.label}:${surface}`} tone="muted">
                  {surface}
                </Badge>
              ))}
            </ChipRow>
          ) : null}
          {item.observedAt || item.owner || item.staleAfter ? (
            <ChipRow>
              {item.owner ? <Badge tone="muted">{item.owner}</Badge> : null}
              {item.kind ? <Badge tone="muted">{item.kind}</Badge> : null}
              {item.defaultState ? <Badge tone="muted">Default {item.defaultState}</Badge> : null}
              {item.rolloutPolicy ? <Badge tone="muted">{item.rolloutPolicy}</Badge> : null}
              {item.rollout ? <Badge tone="muted">{item.rollout}</Badge> : null}
              {item.truthSource ? <Badge tone="muted">{item.truthSource}</Badge> : null}
              {item.observedAt ? <Badge tone="muted">Observed {item.observedAt}</Badge> : null}
              {item.staleAfter ? <Badge tone="muted">Stale after {item.staleAfter}</Badge> : null}
            </ChipRow>
          ) : null}
          {item.scope || item.expiresAfter || item.removalTicket || item.rollback ? (
            <ChipRow>
              {item.scope ? <Badge tone="muted">{item.scope}</Badge> : null}
              {item.expiresAfter ? <Badge tone="muted">{item.expiresAfter}</Badge> : null}
              {item.removalTicket ? <Badge tone="muted">{item.removalTicket}</Badge> : null}
              {item.rollback ? <Badge tone="muted">{item.rollback}</Badge> : null}
            </ChipRow>
          ) : null}
        </article>
      ))}
    </div>
  );
}
