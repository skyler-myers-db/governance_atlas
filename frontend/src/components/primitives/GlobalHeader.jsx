import { PRODUCT } from "../../config/product";
import { isNonAuthoritativeMockEvidence } from "../../lib/nonAuthoritativeEvidence";

const BellIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

const SparkIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4.5" cy="7" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="6.6" cy="16.2" r="1.05" fill="currentColor" stroke="none" opacity="0.82" />
    <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    <path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />
  </svg>
);

const WorkspaceIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h6v6H4z" />
    <path d="M14 4h6v6h-6z" />
    <path d="M4 14h6v6H4z" />
    <path d="M14 14h6v6h-6z" />
  </svg>
);

const HelpIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.7 2.7 0 0 1 5 1.4c0 1.8-2.5 2.1-2.5 4" />
    <path d="M12 17.5h.01" />
  </svg>
);

function resolveProductName(shell) {
  const shellProductName = shell?.product?.productName;
  return typeof shellProductName === "string" && shellProductName.trim()
    ? shellProductName.trim()
    : PRODUCT.productName;
}

function resolveEnvironmentLabel(shell) {
  const environment = shell?.environment || {};
  const displayLabel = environment.displayLabel || environment.label || shell?.environmentLabel;
  if (typeof displayLabel === "string" && displayLabel.trim()) return displayLabel.trim();
  const target = environment.target || "";
  const catalog = environment.catalog || "";
  const schema = environment.schema || "";
  const namespace = [catalog, schema].filter(Boolean).join(".");
  if (target && namespace) return `${target} · ${namespace}`;
  if (namespace) return namespace;
  return "Workspace";
}

function resolveEnvironmentTitle(shell) {
  const environment = shell?.environment || {};
  const parts = [
    environment.label ? `Target: ${environment.label}` : "",
    environment.catalog || environment.schema
      ? `Namespace: ${[environment.catalog, environment.schema].filter(Boolean).join(".")}`
      : "",
    environment.warehouseId ? `Warehouse: ${environment.warehouseId}` : "",
    environment.workspaceHost ? `Workspace: ${environment.workspaceHost}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "Workspace environment";
}

function resolveUcStatusLabel(environmentTone = "", coverageScore = null, statusState = "") {
  const state = String(statusState || "").toLowerCase();
  if (state === "loading") return "UC status loading";
  const numericCoverage = Number(coverageScore);
  if (isNonAuthoritativeMockEvidence(state)) return "UC unavailable";
  if (state === "degraded") return "UC status degraded";
  if (state === "unavailable" || state === "error" || state === "failed") return "UC unavailable";
  if (environmentTone === "good" && Number.isFinite(numericCoverage)) {
    return `UC connected · ${numericCoverage.toFixed(1).replace(/\.0$/, "")}% coverage`;
  }
  if (environmentTone === "good" || environmentTone === "warn") {
    return environmentTone === "warn" ? "UC connected · coverage unavailable" : "UC connected";
  }
  if (environmentTone === "bad") return "UC unavailable";
  return "UC status unknown";
}

function resolveWorkspaceLabel(shell) {
  const environment = shell?.environment || {};
  const explicit =
    shell?.workspaceLabel ||
    shell?.workspaceName ||
    shell?.workspace?.name ||
    environment.workspaceLabel ||
    environment.workspaceName ||
    environment.target ||
    environment.label;
  return typeof explicit === "string" && explicit.trim() ? explicit.trim() : "Workspace";
}

export function GlobalHeader({
  shell,
  shellDisabled,
  shellDisabledReason,
  onOpenHome,
  showInbox,
  inboxOpen,
  inboxUnreadCount,
  inboxState = "",
  inboxMessage = "",
  onToggleInbox,
  onOpenCapabilities,
  onOpenAiCopilot,
  onOpenHelp,
  aiCopilotAvailable = true,
  environmentTone = "",
  ucCoverageScore = null,
  ucStatusState = "",
  topbarSearchSlot,
}) {
  const productName = resolveProductName(shell);
  const environmentTitle = resolveEnvironmentTitle(shell);
  const workspaceLabel = resolveWorkspaceLabel(shell);
  const aiProviderMessage = typeof shell?.ai?.message === "string" ? shell.ai.message.trim() : "";
  const environmentLabel = resolveUcStatusLabel(environmentTone, ucCoverageScore, ucStatusState);
  const inboxUnavailable = ["unavailable", "degraded", "error"].includes(String(inboxState || "").trim().toLowerCase());
  const notificationsLabel = inboxUnreadCount > 0
    ? `Notifications (${inboxUnreadCount} unread)`
    : inboxUnavailable
      ? "Notifications unavailable"
      : "Notifications";
  const notificationsTitle = inboxUnavailable
    ? (inboxMessage || "Notification delivery health is unavailable. Open inbox for details.")
    : "Notifications";

  return (
    <div className="gh-shell-topbar ga-topbar">
      <button
        aria-label={`Open ${productName} Command Center`}
        className="ga-workspace-breadcrumb"
        disabled={shellDisabled}
        onClick={onOpenHome}
        title={shellDisabledReason || "Open Command Center"}
        type="button"
      >
        <WorkspaceIcon />
        <span>Workspace</span>
        <span aria-hidden="true" className="ga-workspace-breadcrumb-separator">›</span>
        <strong>{workspaceLabel}</strong>
      </button>
      <div className="ga-topbar-search-slot">
        {topbarSearchSlot}
      </div>
      <div className="ga-topbar-actions">
        <span
          className={`ga-env-chip ${environmentTone ? `tone-${environmentTone}` : ""}`.trim()}
          title={environmentTitle}
        >
          {environmentTone ? <span className="ga-status-dot" aria-hidden="true" /> : null}
          <span>{environmentLabel}</span>
        </span>
        {showInbox ? (
          <button
            aria-label={notificationsLabel}
            aria-pressed={inboxOpen}
            className={`ga-icon-button ga-notifications-button ${inboxUnavailable ? "is-unavailable" : ""}`.trim()}
            onClick={onToggleInbox || (() => {})}
            type="button"
            title={notificationsTitle}
          >
            <BellIcon />
            {inboxUnreadCount > 0 ? (
              <span aria-hidden="true" className="ga-notification-count">
                {inboxUnreadCount > 9 ? "9+" : inboxUnreadCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <button
          aria-label="Help"
          className="ga-icon-button ga-help-button"
          onClick={onOpenHelp || onOpenCapabilities || (() => {})}
          title="Help"
          type="button"
        >
          <HelpIcon />
        </button>
        <button
          aria-disabled={!aiCopilotAvailable}
          className="ga-ai-chip is-primary"
          disabled={!aiCopilotAvailable}
          onClick={aiCopilotAvailable ? onOpenAiCopilot : undefined}
          title={
            aiCopilotAvailable
              ? "Open Atlas AI"
              : aiProviderMessage || "Atlas AI requires an evidence-backed endpoint before activation."
          }
          type="button"
        >
          <SparkIcon />
          <span>{PRODUCT.aiName}</span>
        </button>
      </div>
    </div>
  );
}

export default GlobalHeader;
