import { UserChip } from "./UserChip";

const BrandGlyph = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.7"
  >
    <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
    <path d="m4 12 8 4.5 8-4.5" />
    <path d="m4 16.5 8 4.5 8-4.5" />
  </svg>
);

const BellIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

const HelpIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 1.7-2.3 2.1-2.3 3.7" />
    <path d="M12 17h.01" />
  </svg>
);

const MessagesIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 5.5h12.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-5 3v-12a2 2 0 0 1 2-2Z" />
    <path d="M8.5 10h7" />
    <path d="M8.5 13h4.5" />
  </svg>
);

export function GlobalHeader({
  shell,
  shellDisabled,
  shellDisabledReason,
  onOpenDiscovery,
  onModuleChange,
  showInbox,
  inboxOpen,
  inboxUnreadCount,
  onToggleInbox,
  alertsOpen = false,
  alertsUnreadCount = 0,
  onToggleAlerts,
  onOpenSettings,
  onOpenCapabilities,
  onSignOut,
  branding = null,
  topbarSearchSlot,
}) {
  const logoUrl = typeof branding?.logoUrl === "string" ? branding.logoUrl.trim() : "";
  const brandTitle =
    (typeof branding?.orgDisplayName === "string"
      ? branding.orgDisplayName.trim()
      : "") || "Governance Hub";
  return (
    <div className="gh-shell-topbar">
      <div className="gh-shell-spine">
        <div className="gh-shell-brand-band">
          <button
            className="gh-shell-brand"
            disabled={shellDisabled}
            onClick={onOpenDiscovery}
            title={shellDisabledReason}
            type="button"
          >
            <span className="gh-shell-brand-mark" aria-hidden="true">
              {logoUrl ? (
                <img alt="" className="gh-shell-brand-logo" src={logoUrl} />
              ) : (
                <BrandGlyph />
              )}
            </span>
            <span className="gh-shell-brand-title">{brandTitle}</span>
          </button>
          {topbarSearchSlot ? (
            <div className="gh-shell-brand-search-slot">{topbarSearchSlot}</div>
          ) : null}
          <div className="gh-shell-brand-tail">
            {onToggleAlerts ? (
              <button
                aria-label={
                  alertsUnreadCount > 0 ? `Alerts (${alertsUnreadCount} new)` : "Alerts"
                }
                aria-pressed={alertsOpen}
                className="gh-shell-topbar-icon-button"
                onClick={onToggleAlerts}
                type="button"
                title="Alerts"
              >
                <BellIcon />
                {alertsUnreadCount > 0 ? (
                  <span aria-hidden="true" className="gh-shell-topbar-icon-dot is-alert">
                    {alertsUnreadCount > 9 ? "9+" : alertsUnreadCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              aria-label="Help"
              className="gh-shell-topbar-icon-button"
              onClick={() => onModuleChange?.("help")}
              type="button"
              title="Help"
            >
              <HelpIcon />
            </button>
            {showInbox ? (
              <button
                aria-label={
                  inboxUnreadCount > 0
                    ? `Inbox (${inboxUnreadCount} unread)`
                    : "Inbox"
                }
                aria-pressed={inboxOpen}
                className="gh-shell-topbar-icon-button"
                onClick={onToggleInbox || (() => {})}
                type="button"
                title="Inbox"
              >
                <MessagesIcon />
                {inboxUnreadCount > 0 ? (
                  <span aria-hidden="true" className="gh-shell-topbar-icon-dot">
                    {inboxUnreadCount > 9 ? "9+" : inboxUnreadCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            <UserChip
              userEmail={shell?.userEmail || ""}
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
      </div>
    </div>
  );
}
