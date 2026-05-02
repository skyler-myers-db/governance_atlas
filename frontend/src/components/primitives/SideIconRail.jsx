import entradaLogoUrl from "../../assets/brand/entrada-logo.png";
import { UserChip } from "./UserChip";

const Icon = ({ children }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="19"
    height="19"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const RAIL_ICONS = {
  gauge: <Icon><path d="M5 16a7 7 0 1 1 14 0" /><path d="M12 16l4-5" /><path d="M9 19h6" /></Icon>,
  discovery: <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>,
  asset360: <Icon><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 17 8 4 8-4" /></Icon>,
  lineage: <Icon><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 7.5 11 15" /><path d="m16 7.5-3 7.5" /></Icon>,
  listChecks: <Icon><path d="m4 7 1.5 1.5L8.5 5" /><path d="M11 7h9" /><path d="m4 13 1.5 1.5 3-3.5" /><path d="M11 13h9" /><path d="m4 19 1.5 1.5 3-3.5" /><path d="M11 19h9" /></Icon>,
  insights: <Icon><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 16v-5" /><path d="M12 16V8" /><path d="M16 16v-7" /></Icon>,
  book: <Icon><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3-3Z" /><path d="M5 4v13" /><path d="M9 8h6" /><path d="M9 12h6" /></Icon>,
  cde: <Icon><path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Z" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></Icon>,
  shieldCheck: <Icon><path d="M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></Icon>,
  sliders: <Icon><path d="M4 6h10" /><path d="M18 6h2" /><path d="M4 12h2" /><path d="M10 12h10" /><path d="M4 18h8" /><path d="M16 18h4" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></Icon>,
};

export const NAV_ITEMS = [
  { key: "home", label: "Command Center", moduleKey: "home", icon: "gauge", section: "Govern" },
  { key: "discovery", label: "Discover", moduleKey: "discovery", icon: "discovery", section: "Govern" },
  { key: "governance", label: "Stewardship", moduleKey: "governance", icon: "listChecks", section: "Govern", badgeKey: "stewardship" },
  { key: "taxonomy", label: "Glossary & CDEs", moduleKey: "taxonomy", icon: "book", section: "Knowledge" },
  { key: "lineage", label: "Lineage Atlas", moduleKey: "lineage", icon: "lineage", section: "Knowledge" },
  { key: "audit", label: "Audit Evidence", moduleKey: "audit", icon: "shieldCheck", section: "Trust" },
  { key: "admin", label: "Control Center", moduleKey: "admin", icon: "sliders", section: "Trust" },
];

export const ASSET_360_NAV_ITEM = {
  key: "asset360",
  label: "Asset 360",
  moduleKey: "entity",
  icon: "asset360",
  requiresAsset: true,
};

const NAV_SECTIONS = NAV_ITEMS.reduce((sections, item) => {
  const section = item.section || "Govern";
  if (!sections.some((entry) => entry.title === section)) {
    sections.push({ title: section, items: [] });
  }
  sections.find((entry) => entry.title === section).items.push(item);
  return sections;
}, []);

export function SideIconRail({
  activeModule,
  currentAssetFqn = "",
  collapsed = false,
  stewardshipCount = null,
  userName = "",
  userEmail = "",
  userRole = "",
  roleProvisional = false,
  onOpenSettings,
  onOpenCapabilities,
  onSignOut,
  onModuleChange,
  onOpenAsset360,
  shellDisabled = false,
  shellDisabledReason,
}) {
  return (
    <aside className={`gh-side-rail ga-side-nav ${collapsed ? "is-collapsed" : ""}`.trim()} aria-label="Governance Atlas navigation">
      <div className="ga-side-nav-logo">
        <img src={entradaLogoUrl} alt="Entrada" />
        <span>
          <strong>Governance Atlas</strong>
          <em>By Entrada</em>
        </span>
      </div>
      <nav className="ga-side-nav-items" aria-label="Primary modules">
        {NAV_SECTIONS.map((section) => (
          <div className="ga-side-nav-section" key={section.title}>
            <div className="ga-side-nav-section-title">{section.title}</div>
            {section.items.map((entry) => {
              const active = activeModule === entry.moduleKey;
              const assetUnavailable = entry.requiresAsset && !currentAssetFqn;
              const disabled = shellDisabled;
              const title = shellDisabled && shellDisabledReason
                ? shellDisabledReason
                : assetUnavailable
                  ? "Open Discover to select an asset for Asset 360."
                  : entry.label;
              const badgeValue =
                entry.badgeKey === "stewardship" && Number.isFinite(Number(stewardshipCount))
                  ? Math.max(0, Math.trunc(Number(stewardshipCount)))
                  : null;
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={`ga-side-nav-item ${active ? "is-active" : ""}`.trim()}
                  disabled={disabled}
                  key={entry.key}
                  onClick={() => {
                    if (disabled) return;
                    if (entry.moduleKey === "entity") {
                      if (currentAssetFqn) onOpenAsset360?.();
                      else onModuleChange?.("discovery");
                      return;
                    }
                    onModuleChange?.(entry.moduleKey);
                  }}
                  title={title}
                  type="button"
                >
                  <span className="ga-side-nav-icon">{RAIL_ICONS[entry.icon]}</span>
                  <span>{entry.label}</span>
                  {badgeValue > 0 ? <span className="ga-side-nav-badge">{badgeValue > 999 ? "999+" : badgeValue}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="ga-side-nav-user">
        <UserChip
          userEmail={userEmail}
          userName={userName}
          role={userRole}
          roleProvisional={roleProvisional}
          onOpenSettings={onOpenSettings}
          onOpenCapabilities={onOpenCapabilities}
          onSignOut={onSignOut}
          variant="sidebar"
        />
      </div>
    </aside>
  );
}

export default SideIconRail;
