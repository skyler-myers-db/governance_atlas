import { PRODUCT } from "../../config/product";
import { UserChip } from "./UserChip";

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

function resolveProductName(shell) {
  const shellProductName = shell?.product?.productName;
  return typeof shellProductName === "string" && shellProductName.trim()
    ? shellProductName.trim()
    : PRODUCT.productName;
}

function resolveEnvironmentLabel(shell) {
  const label = shell?.environment?.label || shell?.environmentLabel;
  return typeof label === "string" && label.trim() ? label.trim() : "Live workspace";
}

export function GlobalHeader({
  shell,
  shellDisabled,
  shellDisabledReason,
  onOpenHome,
  showInbox,
  inboxOpen,
  inboxUnreadCount,
  onToggleInbox,
  onOpenSettings,
  onOpenCapabilities,
  onSignOut,
  onOpenAiCopilot,
  aiCopilotAvailable = true,
  topbarSearchSlot,
}) {
  const productName = resolveProductName(shell);
  const environmentLabel = resolveEnvironmentLabel(shell);

  return (
    <div className="gh-shell-topbar ga-topbar">
      <button
        aria-label={productName}
        className="ga-product-lockup"
        disabled={shellDisabled}
        onClick={onOpenHome}
        title={shellDisabledReason || productName}
        type="button"
      >
        <span className="ga-product-company">{PRODUCT.companyName}</span>
        <span className="ga-product-name">{productName}</span>
      </button>
      <div className="ga-topbar-search-slot">
        {topbarSearchSlot}
      </div>
      <div className="ga-topbar-actions">
        <span className="ga-env-chip" title="Workspace environment">
          <span className="ga-status-dot" aria-hidden="true" />
          <span>{environmentLabel}</span>
        </span>
        <button
          aria-disabled={!aiCopilotAvailable}
          className="ga-ai-chip"
          disabled={!aiCopilotAvailable}
          onClick={aiCopilotAvailable ? onOpenAiCopilot : undefined}
          title={
            aiCopilotAvailable
              ? "Open AI Copilot"
              : "AI Copilot requires an evidence-backed Atlas AI endpoint before activation."
          }
          type="button"
        >
          <SparkIcon />
          <span>AI Copilot</span>
        </button>
        {showInbox ? (
          <button
            aria-label={
              inboxUnreadCount > 0
                ? `Notifications (${inboxUnreadCount} unread)`
                : "Notifications"
            }
            aria-pressed={inboxOpen}
            className="ga-icon-button ga-notifications-button"
            onClick={onToggleInbox || (() => {})}
            type="button"
            title="Notifications"
          >
            <BellIcon />
            {inboxUnreadCount > 0 ? (
              <span aria-hidden="true" className="ga-notification-count">
                {inboxUnreadCount > 9 ? "9+" : inboxUnreadCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <UserChip
          userEmail={shell?.userEmail || ""}
          userName={shell?.userName || shell?.displayName || ""}
          role={shell?.role || ""}
          roleProvisional={Boolean(shell?.roleProvisional)}
          inboxUnreadCount={inboxUnreadCount}
          inboxOpen={inboxOpen}
          onToggleInbox={onToggleInbox}
          onOpenSettings={onOpenSettings}
          onOpenCapabilities={onOpenCapabilities}
          onSignOut={onSignOut}
        />
      </div>
    </div>
  );
}

export default GlobalHeader;
