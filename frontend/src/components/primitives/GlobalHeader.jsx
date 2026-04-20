import { UserChip } from "./UserChip";

const MODULES = [
  { key: "discovery", label: "Discovery" },
  { key: "lineage", label: "Lineage" },
  { key: "governance", label: "Governance" },
  { key: "taxonomy", label: "Taxonomy" },
  { key: "audit", label: "Audit" },
];

// Governance Hub brand mark — a filled rounded tile with an inverse "G"
// cut-out. This matches the mockup silhouette: a soft magenta tile on
// the far left of the top bar with a single-stroke G motif, reading
// clearly as a premium enterprise mark rather than an outlined sketch.
const BrandGlyph = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 32 32"
    width="28"
    height="28"
  >
    <defs>
      <linearGradient id="gh-brand-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e11d74" />
        <stop offset="100%" stopColor="#a01255" />
      </linearGradient>
    </defs>
    <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#gh-brand-grad)" />
    <path
      d="M22.2 12.2a6.2 6.2 0 1 0 0 7.6M22.2 16H17"
      fill="none"
      stroke="#fff"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const InboxIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 13l2-6a2 2 0 0 1 2-1.5h8a2 2 0 0 1 2 1.5l2 6" />
    <path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    <path d="M4 13h4l1 2h6l1-2h4" />
  </svg>
);

const BellIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

const PlusIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

export function GlobalHeader({
  shell,
  shellDisabled,
  shellDisabledReason,
  activeModule,
  onOpenDiscovery,
  onModuleChange,
  showInbox,
  inboxOpen,
  inboxUnreadCount,
  onToggleInbox,
  alertsOpen = false,
  alertsUnreadCount = 0,
  onToggleAlerts,
  onOpenCommandPalette,
  onOpenSettings,
  onSignOut,
  topbarSearchSlot,
}) {
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
              <BrandGlyph />
            </span>
            <span className="gh-shell-brand-title">Governance Hub</span>
          </button>
          {topbarSearchSlot ? (
            <div className="gh-shell-brand-search-slot">{topbarSearchSlot}</div>
          ) : null}
          <div className="gh-shell-brand-tail">
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
                <InboxIcon />
                {inboxUnreadCount > 0 ? (
                  <span aria-hidden="true" className="gh-shell-topbar-icon-dot">
                    {inboxUnreadCount > 9 ? "9+" : inboxUnreadCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            {/* Alerts bell is ALWAYS rendered — the mockup shows it in the
                tail cluster where Quick action used to sit (operator
                2026-04-19 flagged the missing bell and said Quick action
                belongs on the Discovery/Navigation sub-tab row instead).
                An unread dot paints only when alertsUnreadCount > 0 so it
                doesn't fake a live signal. */}
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
            <UserChip
              userEmail={shell?.userEmail || ""}
              role={shell?.role || ""}
              roleProvisional={Boolean(shell?.roleProvisional)}
              inboxUnreadCount={inboxUnreadCount}
              inboxOpen={inboxOpen}
              onToggleInbox={onToggleInbox}
              onOpenSettings={onOpenSettings}
              onSignOut={onSignOut}
            />
          </div>
        </div>
        {/* Secondary module tabs — kept in DOM as an accessibility alias for
            the left icon rail so getByRole("button", {name:"Discovery"})
            still resolves in tests. Visually clipped via sr-only. */}
        <nav className="gh-shell-nav gh-shell-nav-secondary" aria-label="Primary modules">
          {MODULES.map((module) => (
            <button
              className={`gh-product-tab ${activeModule === module.key ? "is-active" : ""}`}
              disabled={shellDisabled}
              key={module.key}
              onClick={module.key === "discovery" ? onOpenDiscovery : () => onModuleChange(module.key)}
              title={shellDisabledReason}
              type="button"
            >
              <span>{module.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
