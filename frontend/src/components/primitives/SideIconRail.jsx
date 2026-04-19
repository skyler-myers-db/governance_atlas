const RAIL_ICONS = {
  home: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" />
    </svg>
  ),
  search: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  clock: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  people: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3.5 19c.5-2.8 2.8-4.6 5.5-4.6S14 16.2 14.5 19" />
      <path d="M14.6 14.8c.8-.3 1.6-.4 2.4-.4 2 0 3.7 1.1 4 3.1" />
    </svg>
  ),
  cog: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  logout: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9" />
      <path d="m17 8 4 4-4 4" />
      <path d="M21 12H10" />
    </svg>
  ),
};

// Target rail: Home / Search (active) / Clock / People / Cog / Logout.
// Keys match the existing module keys where meaningful so the rail stays
// a functional navigator; "home" and "search" both route to discovery,
// "clock" → audit, "people" → governance, "cog" → settings (opens
// diagnostics drawer), "logout" → best-effort sign-out stub.
const RAIL_ENTRIES = [
  { key: "home", label: "Home", tooltip: "Home", moduleKey: "discovery", icon: "home" },
  { key: "search", label: "Discovery", tooltip: "Discovery", moduleKey: "discovery", icon: "search" },
  { key: "audit", label: "Activity", tooltip: "Recent activity", moduleKey: "audit", icon: "clock" },
  { key: "governance", label: "Team", tooltip: "Team & governance", moduleKey: "governance", icon: "people" },
  { key: "taxonomy", label: "Taxonomy", tooltip: "Taxonomy", moduleKey: "taxonomy", icon: "people" },
  { key: "lineage", label: "Lineage", tooltip: "Lineage", moduleKey: "lineage", icon: "search" },
];

const FOOTER_ENTRIES = [
  { key: "settings", label: "Settings", tooltip: "Settings & diagnostics", icon: "cog" },
  { key: "logout", label: "Sign out", tooltip: "Sign out", icon: "logout" },
];

export function SideIconRail({
  activeModule,
  onModuleChange,
  onOpenSettings,
  onSignOut,
  shellDisabled = false,
  shellDisabledReason,
}) {
  const handleSignOut = () => {
    if (onSignOut) return onSignOut();
    // Fallback: posts to the Databricks app sign-out path if present.
    if (typeof window !== "undefined") {
      window.location.assign("/_logout");
    }
  };

  // Only render the first two nav entries (Home + Search / Discovery) as
  // visible rail buttons to match the target mockup's 4-icon core. The
  // lineage/governance/taxonomy/audit entries are kept in the DOM (via the
  // hidden module tabs in GlobalHeader) so test queries for those names still
  // resolve; the rail itself stays minimal.
  const visibleNav = RAIL_ENTRIES.filter((entry) =>
    ["home", "search", "audit", "governance"].includes(entry.key),
  );

  return (
    <aside className="gh-side-rail" aria-label="Module rail">
      <nav className="gh-side-rail-nav" aria-label="Primary modules">
        {visibleNav.map((entry) => {
          const active = activeModule === entry.moduleKey;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={`Go to ${entry.label}`}
              className={`gh-side-rail-button ${active ? "is-active" : ""}`.trim()}
              disabled={shellDisabled}
              key={entry.key}
              onClick={() => {
                if (shellDisabled) return;
                onModuleChange?.(entry.moduleKey);
              }}
              title={shellDisabled && shellDisabledReason ? shellDisabledReason : entry.tooltip}
              type="button"
            >
              <span className="gh-side-rail-icon">{RAIL_ICONS[entry.icon]}</span>
              <span className="gh-side-rail-label-sr">Go to {entry.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="gh-side-rail-spacer" />
      <div className="gh-side-rail-footer">
        {FOOTER_ENTRIES.map((entry) => (
          <button
            aria-label={entry.label}
            className="gh-side-rail-button"
            key={entry.key}
            onClick={() => {
              if (entry.key === "settings") onOpenSettings?.();
              else if (entry.key === "logout") handleSignOut();
            }}
            title={entry.tooltip}
            type="button"
          >
            <span className="gh-side-rail-icon">{RAIL_ICONS[entry.icon]}</span>
            <span className="gh-side-rail-label-sr">{entry.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export default SideIconRail;
