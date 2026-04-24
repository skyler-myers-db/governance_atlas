import { useState } from "react";

const RAIL_ICONS = {
  collapse: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 7 5 5-5 5" />
      <path d="m13 7 5 5-5 5" />
    </svg>
  ),
  expand: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 7-5 5 5 5" />
      <path d="m11 7-5 5 5 5" />
    </svg>
  ),
  catalog: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="6" height="6" rx="1" />
      <rect x="14" y="5" width="6" height="6" rx="1" />
      <rect x="4" y="15" width="6" height="4" rx="1" />
      <rect x="14" y="15" width="6" height="4" rx="1" />
    </svg>
  ),
  lineage: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
      <path d="M8 7h8" />
      <path d="m7.3 8.7 3.4 6.6" />
      <path d="m16.7 8.7-3.4 6.6" />
    </svg>
  ),
  governance: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z" />
      <path d="m9.5 12 1.7 1.7 3.8-4" />
    </svg>
  ),
  quality: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4.5 6.8v5.1c0 4.1 3 7.2 7.5 9.1 4.5-1.9 7.5-5 7.5-9.1V6.8L12 3Z" />
      <path d="M9 12.2h6" />
      <path d="M12 9.2v6" />
    </svg>
  ),
  glossary: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
      <path d="M8 8h7" />
      <path d="M8 11h5" />
      <path d="M7.5 19.5A2.5 2.5 0 0 1 5 17" />
    </svg>
  ),
  reporting: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4.5h9l3 3v12H6v-15Z" />
      <path d="M15 4.5v3h3" />
      <path d="M9 16v-4" />
      <path d="M12 16V9" />
      <path d="M15 16v-2" />
    </svg>
  ),
  notification: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  ),
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
  help: (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.8-2.5 2.2-2.5 4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  ),
};

const RAIL_ENTRIES = [
  { key: "catalog", label: "Catalog", tooltip: "Catalog", moduleKey: "discovery", icon: "catalog" },
  { key: "lineage", label: "Lineage", tooltip: "Lineage", moduleKey: "lineage", icon: "lineage" },
  { key: "governance", label: "Governance", tooltip: "Governance", moduleKey: "governance", icon: "governance" },
  { key: "quality", label: "Quality", tooltip: "Quality", moduleKey: "insights", icon: "quality" },
  { key: "glossary", label: "Glossary", tooltip: "Glossary", moduleKey: "taxonomy", icon: "glossary" },
  { key: "reporting", label: "Reporting", tooltip: "Reporting", moduleKey: "audit", icon: "reporting" },
];

const FOOTER_ENTRIES = [
  { key: "notifications", label: "Notifications", tooltip: "Notifications", icon: "notification" },
  { key: "logout", label: "Sign out", tooltip: "Sign out", icon: "logout" },
];

export function SideIconRail({
  activeModule,
  onModuleChange,
  onSignOut,
  shellDisabled = false,
  shellDisabledReason,
}) {
  const [railCollapsed, setRailCollapsed] = useState(false);

  const handleSignOut = () => {
    if (onSignOut) return onSignOut();
    // Databricks Apps don't expose a first-class client-side logout: the
    // session is owned by the workspace, not the app process. A previous
    // `/_logout` GET produced a plaintext 404 page, which read as a broken
    // button. Explain the handoff instead of redirecting blindly, and open
    // the Databricks workspace sign-out page in a new tab when the user
    // confirms so their app session + workspace session both terminate.
    if (typeof window === "undefined") return;
    const proceed = typeof window.confirm === "function"
      ? window.confirm(
          "Sign out?\n\nGovernance Hub uses your Databricks workspace login. Continuing opens the Databricks sign-out page in a new tab.",
        )
      : true;
    if (!proceed) return;
    const { protocol, hostname } = window.location;
    // governance-hub-<id>.<region>.azure.databricksapps.com →
    //   https://<region>.azure.databricks.net/login.html?action=logOut
    const workspaceHost = hostname.replace(/^[^.]+\./, "").replace(/databricksapps\.com$/, "databricks.net");
    const signOutUrl = `${protocol}//${workspaceHost}/login.html?action=logOut`;
    window.open(signOutUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <aside
      aria-label="Module rail"
      className={`gh-side-rail ${railCollapsed ? "is-collapsed" : ""}`.trim()}
    >
      <button
        aria-expanded={!railCollapsed}
        aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
        className="gh-side-rail-collapse"
        disabled={shellDisabled}
        onClick={() => {
          if (shellDisabled) return;
          setRailCollapsed((current) => !current);
        }}
        title={
          shellDisabled && shellDisabledReason
            ? shellDisabledReason
            : railCollapsed
              ? "Expand navigation"
              : "Collapse navigation"
        }
        type="button"
      >
        <span className="gh-side-rail-icon">{RAIL_ICONS[railCollapsed ? "expand" : "collapse"]}</span>
      </button>
      <nav className="gh-side-rail-nav" aria-label="Primary modules">
        {RAIL_ENTRIES.map((entry) => {
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
              <span className="gh-side-rail-label"> {entry.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="gh-side-rail-spacer" />
      <div className="gh-side-rail-footer">
        {FOOTER_ENTRIES.map((entry) => {
          const helpActive = entry.key === "notifications" && activeModule === "inbox";
          return (
            <button
              aria-current={helpActive ? "page" : undefined}
              aria-label={entry.label}
              className={`gh-side-rail-button ${helpActive ? "is-active" : ""}`.trim()}
              key={entry.key}
              onClick={() => {
                if (entry.key === "notifications") onModuleChange?.("inbox");
                else if (entry.key === "logout") handleSignOut();
              }}
              title={entry.tooltip}
              type="button"
            >
              <span className="gh-side-rail-icon">{RAIL_ICONS[entry.icon]}</span>
              <span className="gh-side-rail-label-sr">{entry.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default SideIconRail;
