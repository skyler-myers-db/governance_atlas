const TONE_BY_STATUS = {
  approved: "good",
  certified: "good",
  complete: "good",
  compliant: "good",
  ready: "good",
  pending: "info",
  draft: "muted",
  proposed: "warn",
  warning: "warn",
  overdue: "bad",
  failed: "bad",
  critical: "bad",
};

export function StatusPill({ children = null, tone = "", status = "", className = "" }) {
  const resolvedTone = tone || TONE_BY_STATUS[String(status || children || "").trim().toLowerCase()] || "info";
  return (
    <span className={`ga-status-pill tone-${resolvedTone} ${className}`.trim()}>
      {children || status}
    </span>
  );
}

export default StatusPill;
