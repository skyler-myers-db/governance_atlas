const RAIL_ICONS = {
  discovery: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  lineage: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M7 6h4a3 3 0 0 1 3 3v.5a3 3 0 0 0 3 3m-10 5.5h4a3 3 0 0 0 3-3V14a3 3 0 0 1 3-3" />
    </svg>
  ),
  governance: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4 7v6c0 4.5 3.5 7.5 8 8 4.5-.5 8-3.5 8-8V7Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  taxonomy: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
      <circle cx="19" cy="18" r="2" />
    </svg>
  ),
  audit: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  settings: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
};

const RAIL_ENTRIES = [
  { key: "discovery", label: "Go to Discovery", tooltip: "Discovery" },
  { key: "lineage", label: "Go to Lineage", tooltip: "Lineage graph" },
  { key: "governance", label: "Go to Governance", tooltip: "Governance workbench" },
  { key: "taxonomy", label: "Go to Taxonomy", tooltip: "Glossary & taxonomy" },
  { key: "audit", label: "Go to Audit", tooltip: "Audit browser" },
];

export function SideIconRail({
  activeModule,
  onModuleChange,
  onOpenSettings,
  shellDisabled = false,
  shellDisabledReason,
}) {
  return (
    <aside className="gh-side-rail" aria-label="Module rail">
      <div className="gh-side-rail-brand" aria-hidden="true">
        <span className="gh-side-rail-brand-glyph">GH</span>
      </div>
      <nav className="gh-side-rail-nav" aria-label="Primary modules">
        {RAIL_ENTRIES.map((entry) => {
          const active = activeModule === entry.key;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={entry.label}
              className={`gh-side-rail-button ${active ? "is-active" : ""}`.trim()}
              disabled={shellDisabled}
              key={entry.key}
              onClick={() => {
                if (shellDisabled) return;
                onModuleChange?.(entry.key);
              }}
              title={shellDisabled && shellDisabledReason ? shellDisabledReason : entry.tooltip}
              type="button"
            >
              <span className="gh-side-rail-icon">{RAIL_ICONS[entry.key]}</span>
              <span className="gh-side-rail-label-sr">{entry.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="gh-side-rail-spacer" />
      <div className="gh-side-rail-footer">
        <button
          aria-label="Settings"
          className="gh-side-rail-button"
          onClick={() => onOpenSettings?.()}
          title="Settings"
          type="button"
        >
          <span className="gh-side-rail-icon">{RAIL_ICONS.settings}</span>
          <span className="gh-side-rail-label-sr">Settings</span>
        </button>
      </div>
    </aside>
  );
}

export default SideIconRail;
