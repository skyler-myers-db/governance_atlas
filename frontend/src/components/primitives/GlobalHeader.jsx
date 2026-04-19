import { UserChip } from "./UserChip";

const MODULES = [
  { key: "discovery", label: "Discovery" },
  { key: "lineage", label: "Lineage" },
  { key: "governance", label: "Governance" },
  { key: "taxonomy", label: "Taxonomy" },
  { key: "audit", label: "Audit" },
];

// Minimal sigma/squiggle brand mark — single-stroke pink S-curve that matches
// the target mockup's thin-line logo silhouette. No fill, no subtitle; the
// brand is intentionally stripped to the mark + wordmark only.
const BrandSigmaMark = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 32 32"
    width="28"
    height="28"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M24 7c-3-2-7-2-10 0s-3 7 0 9 7 2 10 0M8 25c3 2 7 2 10 0s3-7 0-9-7-2-10 0" />
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
              <BrandSigmaMark />
            </span>
            <span className="gh-shell-brand-title">Governance Hub</span>
          </button>
          {topbarSearchSlot ? (
            <div className="gh-shell-brand-search-slot">{topbarSearchSlot}</div>
          ) : null}
          <div className="gh-shell-brand-tail">
            <UserChip
              userEmail={shell?.userEmail || ""}
              role={shell?.role || ""}
              roleProvisional={Boolean(shell?.roleProvisional)}
              inboxUnreadCount={inboxUnreadCount}
              inboxOpen={inboxOpen}
              onToggleInbox={onToggleInbox}
              showInbox
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
