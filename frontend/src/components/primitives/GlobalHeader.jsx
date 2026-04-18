import {
  setupStatusLabel,
  setupStatusTone,
  statusLabel,
  statusTone,
} from "./shellStatusLabels";

const MODULES = [
  { key: "discovery", label: "Discovery" },
  { key: "lineage", label: "Lineage" },
  { key: "governance", label: "Governance" },
];

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
}) {
  const shellRoleLabel = shell?.role
    ? shell?.roleProvisional
      ? `${shell.role} (verifying)`
      : shell.role
    : "workspace user";
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
        </div>

        <div className="gh-shell-nav-band">
          <div className="gh-shell-nav-band-head">
            <div className="gh-shell-module-label">Modules</div>
            <div className="gh-shell-identity-inline">
              <div className="gh-shell-identity-block">
                <div className="gh-shell-identity">{shellRoleLabel}</div>
                <div className="gh-shell-user">{shell?.userEmail || "unknown"}</div>
              </div>
              <div className="gh-shell-context-stack">
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
                <div className="gh-shell-status-actions">
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
                  {showInbox ? (
                    <button
                      aria-pressed={inboxOpen}
                      className="gh-tertiary-button gh-inline-link-button gh-shell-inbox-trigger"
                      onClick={onToggleInbox}
                      type="button"
                    >
                      <span>Inbox</span>
                      {inboxUnreadCount > 0 ? (
                        <span aria-hidden="true" className="gh-shell-inbox-badge">
                          {inboxUnreadCount}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <nav className="gh-shell-nav" aria-label="Primary modules">
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
    </div>
  );
}
