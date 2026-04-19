import {
  setupStatusLabel,
  setupStatusTone,
  statusLabel,
  statusTone,
} from "./shellStatusLabels";
import { UserChip } from "./UserChip";

const MODULES = [
  { key: "discovery", label: "Discovery" },
  { key: "lineage", label: "Lineage" },
  { key: "governance", label: "Governance" },
  { key: "taxonomy", label: "Taxonomy" },
  { key: "audit", label: "Audit" },
];

const ClockIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const BoltIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m13 3-8 11h6l-1 7 8-11h-6l1-7Z" />
  </svg>
);

export function GlobalHeader({
  shell,
  shellDisabled,
  shellDisabledReason,
  activeModule,
  onOpenDiscovery,
  onModuleChange,
  showRuntimeStatus,
  bootState,
  bootMessage,
  showSetupStatus,
  setupStatusState,
  setupStatusNextStep,
  diagnosticsAvailable,
  diagnosticsOpen,
  onToggleDiagnostics,
  showInbox,
  inboxOpen,
  inboxUnreadCount,
  onToggleInbox,
  onOpenCommandPalette,
  topbarSearchSlot,
}) {
  const setupStatusToneValue = setupStatusTone(setupStatusState);

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
            <div className="gh-shell-brand-mark" aria-hidden="true">
              <span className="gh-shell-brand-glyph">GH</span>
            </div>
            <div className="gh-shell-brand-copy">
              <div className="gh-shell-brand-title">Governance Hub</div>
              <div className="gh-shell-brand-subtitle">Metadata Workspace</div>
            </div>
          </button>
          {topbarSearchSlot ? (
            <div className="gh-shell-brand-search-slot">{topbarSearchSlot}</div>
          ) : null}
          <div className="gh-shell-brand-tail">
            <div className="gh-shell-header-actions">
              <button
                className="gh-secondary-button gh-header-action-button gh-header-action-button-ghost"
                onClick={onToggleInbox || onToggleDiagnostics}
                title="Open the activity / task tray"
                type="button"
                disabled={shellDisabled && !onToggleDiagnostics}
              >
                <ClockIcon />
                <span>Take a ban</span>
              </button>
              <button
                className="gh-primary-button gh-header-action-button gh-header-action-button-primary"
                onClick={onOpenCommandPalette}
                title="Quick action (⌘K)"
                type="button"
              >
                <BoltIcon />
                <span>Quick action</span>
              </button>
            </div>
            <UserChip
              userEmail={shell?.userEmail || ""}
              role={shell?.role || ""}
              roleProvisional={Boolean(shell?.roleProvisional)}
              inboxUnreadCount={inboxUnreadCount}
              inboxOpen={inboxOpen}
              onToggleInbox={onToggleInbox}
              showInbox={showInbox}
            />
          </div>
        </div>

        {(showRuntimeStatus || showSetupStatus || diagnosticsAvailable) ? (
          <div className="gh-shell-status-band">
            {showRuntimeStatus ? (
              <div className="gh-shell-context-state">
                <span className={`gh-chip gh-chip-status tone-${statusTone(bootState)}`}>
                  {statusLabel(bootState)}
                </span>
                {bootMessage ? (
                  <div className={`gh-shell-status-note tone-${statusTone(bootState)}`}>{bootMessage}</div>
                ) : null}
              </div>
            ) : null}
            {showSetupStatus ? (
              <div className="gh-shell-setup-status">
                <span className={`gh-chip gh-chip-status tone-${setupStatusToneValue}`}>
                  {setupStatusLabel(setupStatusState)}
                </span>
                <div className={`gh-shell-status-note tone-${setupStatusToneValue}`}>
                  {setupStatusNextStep}
                </div>
              </div>
            ) : null}
            {diagnosticsAvailable ? (
              <button
                aria-pressed={diagnosticsOpen}
                className="gh-tertiary-button gh-inline-link-button"
                onClick={onToggleDiagnostics}
                type="button"
              >
                {diagnosticsOpen ? "Hide workspace setup" : "Workspace setup"}
              </button>
            ) : null}
          </div>
        ) : null}
        {/* Secondary module tabs kept mostly as an accessibility alias for the
            left icon rail; visually hidden by default (see shell-rail.css).
            The rail is the primary modal navigation in this layout. */}
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
