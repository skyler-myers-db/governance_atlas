import { useEffect, useMemo } from "react";

/** Quick-start cards. Each maps to an in-app surface the user can open
 *  via onNavigate. Ordered so the most common first-hit action
 *  (discovery) is top-left and governance work sits top-right. */
const QUICK_CARDS = [
  {
    key: "discovery",
    eyebrow: "Browse the estate",
    title: "Discover assets",
    body:
      "Search across every Unity Catalog table, view, and column. Facet by domain, owner, sensitivity, or glossary term — filters are instant and the results page follows your permissions.",
    cta: "Open Discovery",
    tone: "accent",
  },
  {
    key: "governance",
    eyebrow: "Work the queue",
    title: "Stewardship workbench",
    body:
      "Triage governance requests, review glossary term drafts, and close ownership gaps. Every change persists in the governance schema you configured during setup.",
    cta: "Open Governance",
    tone: "indigo",
  },
  {
    key: "lineage",
    eyebrow: "See the graph",
    title: "Lineage explorer",
    body:
      "Column- and table-level lineage, impact mode, and a scoped lineage context per asset. Arrow keys navigate nodes; ⌘F searches within the active view.",
    cta: "Open Lineage",
    tone: "teal",
  },
  {
    key: "taxonomy",
    eyebrow: "Classify the catalog",
    title: "Taxonomy",
    body:
      "Classifications, domains, data products, and column groups — your governance hierarchy, editable inline, with live counts from the estate.",
    cta: "Open Taxonomy",
    tone: "magenta",
  },
  {
    key: "insights",
    eyebrow: "Close the gaps",
    title: "Governance insights",
    body:
      "Cross-estate gap analysis in one pane — ownership, policy, freshness, and data-quality incidents — each row deep-links to the Governance workbench for remediation.",
    cta: "See all insights",
    tone: "amber",
  },
];

function formatCount(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Math.max(0, Math.trunc(Number(value))).toLocaleString();
}

function BrandGlyph({ size = 64 }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      width={size}
      height={size}
    >
      <defs>
        <linearGradient id="gh-home-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e11d74" />
          <stop offset="100%" stopColor="#3d2bc4" />
        </linearGradient>
        <linearGradient id="gh-home-brand-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f1e8cf" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="18" fill="url(#gh-home-brand)" />
      <path
        d="M44 24.6a12.4 12.4 0 1 0 0 14.8M44 32h-10"
        fill="none"
        stroke="url(#gh-home-brand-g)"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroArt() {
  // Abstract lineage-graph visual: three linked nodes with animated
  // pulse dots on the connecting edges. SVG so it scales and stays
  // crisp; `preserveAspectRatio` keeps the composition tight. Colors
  // borrow from the app palette (magenta, indigo, warm beige) so the
  // hero reads as branded, not generic.
  return (
    <svg
      aria-hidden="true"
      className="gh-home-hero-art"
      viewBox="0 0 420 300"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="gh-home-edge-a" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e11d74" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#3d2bc4" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="gh-home-edge-b" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3d2bc4" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0ea5a0" stopOpacity="0.95" />
        </linearGradient>
        <radialGradient id="gh-home-node-a" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor="#fbf1dd" />
        </radialGradient>
      </defs>
      {/* Soft halo background */}
      <circle cx="80" cy="150" r="120" fill="#fbf1dd" opacity="0.45" />
      <circle cx="350" cy="90" r="90" fill="#e6e3ff" opacity="0.55" />
      {/* Connecting edges */}
      <path d="M95 150 Q 180 110 230 120" stroke="url(#gh-home-edge-a)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M230 120 Q 310 140 360 90" stroke="url(#gh-home-edge-b)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M230 120 Q 260 200 300 220" stroke="url(#gh-home-edge-b)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      {/* Animated pulses along the edges */}
      <circle r="5" fill="#e11d74">
        <animateMotion dur="3.4s" repeatCount="indefinite" path="M95 150 Q 180 110 230 120" />
      </circle>
      <circle r="5" fill="#3d2bc4">
        <animateMotion dur="2.8s" repeatCount="indefinite" path="M230 120 Q 310 140 360 90" begin="0.4s" />
      </circle>
      <circle r="5" fill="#0ea5a0">
        <animateMotion dur="3.1s" repeatCount="indefinite" path="M230 120 Q 260 200 300 220" begin="0.9s" />
      </circle>
      {/* Node A */}
      <g>
        <circle cx="95" cy="150" r="36" fill="url(#gh-home-node-a)" stroke="#a99a70" strokeWidth="1.5" />
        <rect x="72" y="134" width="46" height="7" rx="2" fill="#3d2bc4" opacity="0.85" />
        <rect x="72" y="146" width="34" height="5" rx="2" fill="#a99a70" opacity="0.7" />
        <rect x="72" y="156" width="28" height="5" rx="2" fill="#a99a70" opacity="0.55" />
      </g>
      {/* Node B (center) */}
      <g>
        <circle cx="230" cy="120" r="40" fill="#fff" stroke="#3d2bc4" strokeWidth="2" />
        <rect x="206" y="102" width="48" height="8" rx="2" fill="#e11d74" />
        <rect x="206" y="115" width="36" height="5" rx="2" fill="#525e74" opacity="0.75" />
        <rect x="206" y="125" width="42" height="5" rx="2" fill="#525e74" opacity="0.55" />
        <rect x="206" y="135" width="30" height="5" rx="2" fill="#525e74" opacity="0.4" />
      </g>
      {/* Node C */}
      <g>
        <circle cx="360" cy="90" r="32" fill="url(#gh-home-node-a)" stroke="#a99a70" strokeWidth="1.5" />
        <rect x="340" y="78" width="40" height="7" rx="2" fill="#0ea5a0" opacity="0.95" />
        <rect x="340" y="89" width="30" height="5" rx="2" fill="#a99a70" opacity="0.7" />
      </g>
      {/* Node D */}
      <g>
        <circle cx="300" cy="220" r="30" fill="url(#gh-home-node-a)" stroke="#a99a70" strokeWidth="1.5" />
        <rect x="282" y="208" width="36" height="7" rx="2" fill="#3d2bc4" opacity="0.8" />
        <rect x="282" y="219" width="28" height="5" rx="2" fill="#a99a70" opacity="0.6" />
      </g>
    </svg>
  );
}

export function HomePage({
  userName = "",
  estate = {},
  recentAssets = [],
  onNavigate,
  onOpenAsset,
}) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = "Home — Governance Hub";
    return () => {
      document.title = previous;
    };
  }, []);

  const stats = useMemo(
    () => [
      {
        label: "Governed assets",
        value: formatCount(estate.visibleAssetCount),
        hint: "Tables, views, columns visible under your permissions",
      },
      {
        label: "Catalogs in scope",
        value: formatCount(estate.catalogCount),
        hint: "Unity Catalog catalogs your OBO token can read",
      },
      {
        label: "Open governance",
        value: formatCount(estate.openRequests),
        hint: "Requests in review or awaiting steward action",
      },
      {
        label: "Coverage score",
        value: Number.isFinite(Number(estate.coverageScore))
          ? `${Math.round(Number(estate.coverageScore))}%`
          : "—",
        hint: "Weighted metadata-coverage signal across visible assets",
      },
    ],
    [estate.catalogCount, estate.coverageScore, estate.openRequests, estate.visibleAssetCount],
  );

  const greetingName = useMemo(() => {
    const value = String(userName || "").trim();
    if (!value) return "there";
    // "Skyler Myers" → "Skyler"; "skyler.myers@tristategt.org" →
    // "Skyler"; single-word names are preserved and title-cased.
    const localPart = value.includes("@") ? value.split("@")[0] : value;
    const first = localPart.split(/[\s._+-]+/).filter(Boolean)[0] || localPart;
    return first ? first[0].toUpperCase() + first.slice(1) : "there";
  }, [userName]);

  return (
    <section className="gh-home-page" aria-label="Governance Hub home">
      <section className="gh-home-hero" aria-label="Welcome">
        <div className="gh-home-hero-copy">
          <div className="gh-home-hero-brand">
            <BrandGlyph size={60} />
            <div>
              <div className="gh-home-hero-eyebrow">Governance Hub</div>
              <div className="gh-home-hero-mark">Databricks-native metadata</div>
            </div>
          </div>
          <h1 className="gh-home-hero-title">
            Welcome back, {greetingName}.
          </h1>
          <p className="gh-home-hero-lede">
            A command center for your Unity Catalog estate — discover every
            asset, review governance work, trace lineage, and curate the
            taxonomy. All of it respects your Databricks permissions, so you
            only ever see what you're entitled to.
          </p>
          <div className="gh-home-hero-cta-row">
            <button
              className="gh-home-hero-cta-primary"
              onClick={() => onNavigate?.("discovery")}
              type="button"
            >
              Browse Discovery →
            </button>
            <button
              className="gh-home-hero-cta-secondary"
              onClick={() => onNavigate?.("governance")}
              type="button"
            >
              Stewardship workbench
            </button>
          </div>
        </div>
        <div className="gh-home-hero-visual" aria-hidden="true">
          <HeroArt />
        </div>
      </section>

      <section className="gh-home-stats" aria-label="Estate snapshot">
        {stats.map((stat, index) => (
          <article className={`gh-home-stat gh-home-stat-${index + 1}`} key={stat.label}>
            <div className="gh-home-stat-value">{stat.value}</div>
            <div className="gh-home-stat-label">{stat.label}</div>
            <div className="gh-home-stat-hint">{stat.hint}</div>
          </article>
        ))}
      </section>

      <section className="gh-home-quick" aria-label="Quick actions">
        <div className="gh-home-quick-head">
          <h2 className="gh-home-section-title">Jump in</h2>
          <p className="gh-home-section-hint">
            The four surfaces where most of your governance work happens.
          </p>
        </div>
        <div className="gh-home-quick-grid">
          {QUICK_CARDS.map((card) => (
            <button
              className={`gh-home-quick-card gh-home-quick-card-${card.tone}`}
              key={card.key}
              onClick={() => onNavigate?.(card.key)}
              type="button"
            >
              <div className="gh-home-quick-card-eyebrow">{card.eyebrow}</div>
              <h3 className="gh-home-quick-card-title">{card.title}</h3>
              <p className="gh-home-quick-card-body">{card.body}</p>
              <span className="gh-home-quick-card-cta">{card.cta} →</span>
            </button>
          ))}
        </div>
      </section>

      {recentAssets.length ? (
        <section className="gh-home-recent" aria-label="Recently viewed assets">
          <div className="gh-home-quick-head">
            <h2 className="gh-home-section-title">Pick up where you left off</h2>
            <p className="gh-home-section-hint">
              The last assets you opened. Click to jump back to the metadata record.
            </p>
          </div>
          <ul className="gh-home-recent-list">
            {recentAssets.slice(0, 6).map((asset) => (
              <li key={asset.fqn}>
                <button
                  className="gh-home-recent-item"
                  onClick={() => onOpenAsset?.(asset.fqn)}
                  type="button"
                >
                  <span className="gh-home-recent-item-name">
                    {asset.name || String(asset.fqn || "").split(".").pop()}
                  </span>
                  <span className="gh-home-recent-item-fqn">{asset.fqn}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

export default HomePage;
