import entradaWordmarkUrl from "../../assets/brand/entrada-wordmark.svg";
import { PRODUCT } from "../../config/product";

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
  home: <Icon><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" /></Icon>,
  discovery: <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>,
  asset360: <Icon><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 17 8 4 8-4" /></Icon>,
  lineage: <Icon><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 7.5 11 15" /><path d="m16 7.5-3 7.5" /></Icon>,
  governance: <Icon><path d="M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></Icon>,
  insights: <Icon><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 16v-5" /><path d="M12 16V8" /><path d="M16 16v-7" /></Icon>,
  taxonomy: <Icon><path d="M4 5h6v6H4z" /><path d="M14 5h6v6h-6z" /><path d="M9 11v3h6v-3" /><path d="M9 19h6" /><path d="M12 14v5" /></Icon>,
  cde: <Icon><path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Z" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></Icon>,
  audit: <Icon><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v5h5" /><path d="M10 13h6" /><path d="M10 17h5" /></Icon>,
  admin: <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Icon>,
};

export const NAV_ITEMS = [
  { key: "home", label: "Home", moduleKey: "home", icon: "home" },
  { key: "discovery", label: "Discovery", moduleKey: "discovery", icon: "discovery" },
  { key: "asset360", label: "Asset 360", moduleKey: "entity", icon: "asset360", requiresAsset: true },
  { key: "lineage", label: "Lineage", moduleKey: "lineage", icon: "lineage" },
  { key: "governance", label: "Governance", moduleKey: "governance", icon: "governance" },
  { key: "insights", label: "Insights", moduleKey: "insights", icon: "insights" },
  { key: "taxonomy", label: "Taxonomy", moduleKey: "taxonomy", icon: "taxonomy" },
  { key: "cde", label: "CDEs", moduleKey: "cde", icon: "cde" },
  { key: "audit", label: "Audit", moduleKey: "audit", icon: "audit" },
  { key: "admin", label: "Admin", moduleKey: "admin", icon: "admin" },
];

export function SideIconRail({
  activeModule,
  currentAssetFqn = "",
  collapsed = false,
  onModuleChange,
  onOpenAsset360,
  onToggleCollapse,
  shellDisabled = false,
  shellDisabledReason,
}) {
  return (
    <aside className={`gh-side-rail ga-side-nav ${collapsed ? "is-collapsed" : ""}`.trim()} aria-label="Governance Atlas navigation">
      <div className="ga-side-nav-logo">
        <img src={entradaWordmarkUrl} alt="Entrada" />
      </div>
      <nav className="ga-side-nav-items" aria-label="Primary modules">
        {NAV_ITEMS.map((entry) => {
          const active = activeModule === entry.moduleKey;
          const assetUnavailable = entry.requiresAsset && !currentAssetFqn;
          const disabled = shellDisabled;
          const title = shellDisabled && shellDisabledReason
            ? shellDisabledReason
            : assetUnavailable
              ? "Open Discovery to select an asset for Asset 360."
              : entry.label;
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
            </button>
          );
        })}
      </nav>
      <button
        aria-expanded={!collapsed}
        className="ga-side-nav-collapse"
        type="button"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        onClick={onToggleCollapse}
      >
        <span aria-hidden="true">{collapsed ? ">" : "<"}</span>
        <span>{collapsed ? "Expand" : "Collapse"}</span>
      </button>
      <div className="ga-side-nav-footer">{PRODUCT.copyright}</div>
    </aside>
  );
}

export default SideIconRail;
