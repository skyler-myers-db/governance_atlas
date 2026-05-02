import { useEffect } from "react";

const SECTIONS = [
  {
    id: "getting-started",
    title: "Getting started",
    entries: [
      {
        heading: "What is Governance Atlas?",
        body:
          "Governance Atlas is a Databricks-native metadata command center. It discovers Unity Catalog tables, views, columns, and notebook usage in your workspace and surfaces governance context (domain, owner, sensitivity, glossary term, workflow state, lineage) in one place.",
      },
      {
        heading: "How do I find an asset?",
        body:
          "Use the global search bar at the top of the shell, the Discovery tab for faceted browsing across the catalog, or the Navigation tab for breadth-first catalog-tree browsing. Filters on the left rail narrow by catalog, schema, asset type, domain, owner, sensitivity, glossary term, and workflow state.",
      },
      {
        heading: "What do the coverage badges mean?",
        body:
          "The coverage score on each asset card reflects how complete the asset's governance record is (description, owner, domain, glossary term, quality rules). High Coverage is at least 75%. Mid Coverage is 50-74%. Low Coverage is below 50%. The chip is hidden when the governance backfill has not run for that asset.",
      },
    ],
  },
  {
    id: "authentication",
    title: "Who sees what",
    entries: [
      {
        heading: "On-behalf-of access",
        body:
          "When your workspace grants the app the OBO (on-behalf-of) scope, Governance Atlas scopes every Unity Catalog read to your identity — you see only the catalogs, schemas, and tables your Databricks permissions allow. When OBO is unavailable, the app falls back to a workspace-wide view using the service principal, and a banner surfaces the degraded scope.",
      },
      {
        heading: "Why can't I see a catalog I have access to?",
        body:
          "If a catalog you own in Unity Catalog isn't appearing, verify: (1) your workspace grants the app the \"sql\" OBO scope, (2) the Databricks App has been re-authorized since the scope was granted, and (3) you have USE CATALOG on the catalog. The Settings → Diagnostics panel shows your current auth mode and visibility scope.",
      },
      {
        heading: "Signing out",
        body:
          "Open the profile menu in the top-right corner and choose Sign out to open your Databricks workspace sign-out page in a new tab. Governance Atlas inherits your workspace session; signing out of Databricks also ends your app session.",
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    entries: [
      {
        heading: "Quick action palette",
        body: "⌘K or Ctrl+K opens the command palette from any surface. / also opens the palette when no input is focused.",
      },
      {
        heading: "Discovery",
        body: "Click an asset card to open the preview rail. Press Enter on a focused card to open the full metadata record.",
      },
      {
        heading: "Lineage",
        body: "Arrow keys move between nodes in the lineage graph. ⌘F or Cmd+K searches within the active lineage view.",
      },
    ],
  },
  {
    id: "support",
    title: "Getting help",
    entries: [
      {
        heading: "Who owns this app in my organization?",
        body:
          "Governance Atlas is deployed from your Databricks workspace. The workspace admin who deployed the app is the first contact for access issues, permission changes, and scope grants.",
      },
      {
        heading: "Report a bug or request a feature",
        body:
          "Use the GitHub issue tracker at github.com/entrada-ai/atlas/issues. Include: your workspace region, the surface you were on, the asset FQN (if applicable), and a screenshot. The app version is visible in Settings -> Diagnostics.",
      },
      {
        heading: "Security & compliance",
        body:
          "Governance Atlas runs inside your Databricks workspace. No data leaves the workspace. All Unity Catalog reads respect your identity's permissions when OBO is enabled. Governance events (ownership changes, glossary edits, stewardship actions) are persisted in the governance schema you configured during setup.",
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy",
    entries: [
      {
        heading: "Data boundary",
        body:
          "Governance Atlas runs inside your Databricks workspace. Metadata reads are scoped by the runtime authorization mode, and sample row values are not required for the Home command center.",
      },
      {
        heading: "Identity",
        body:
          "The app uses your Databricks identity for actor-scoped reads when on-behalf-of access is available. If the workspace falls back to app-principal reads, the shell surfaces that degraded visibility state.",
      },
    ],
  },
  {
    id: "terms",
    title: "Terms",
    entries: [
      {
        heading: "Operational use",
        body:
          "Use Governance Atlas as an internal metadata and governance workspace. Review generated or AI-assisted recommendations before taking action.",
      },
      {
        heading: "Source of truth",
        body:
          "Unity Catalog, the configured governance schema, quality signals, lineage metadata, and audit events remain the authoritative sources for product surfaces.",
      },
    ],
  },
];

export function HelpPage({ bootState = "live", onBack }) {
  const prototypeEvidence = String(bootState || "").toLowerCase() === "prototype_mock";
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = "Help — Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <section className="gh-help-page" aria-label="Help and documentation">
      <header className="gh-help-page-head">
        <div>
          <div className="gh-eyebrow">Help &amp; docs</div>
          <h1 className="gh-help-page-title">How Governance Atlas works</h1>
          <p className="gh-help-page-lede">
            {prototypeEvidence
              ? "Prototype QA captures describe intended live Databricks behavior, but this current page evidence is local prototype mock data only."
              : "A short, task-oriented guide to discovery, governance, and access. For a deeper reference and the full change log, visit the GitHub README."}
          </p>
        </div>
        {onBack ? (
          <button
            className="gh-tertiary-button gh-help-page-back"
            onClick={onBack}
            type="button"
          >
            ← Back to Discovery
          </button>
        ) : null}
      </header>

      <nav className="gh-help-page-toc" aria-label="Help sections">
        {SECTIONS.map((section) => (
          <a
            className="gh-help-page-toc-link"
            href={`#${section.id}`}
            key={section.id}
          >
            {section.title}
          </a>
        ))}
      </nav>

      <div className="gh-help-page-body">
        {SECTIONS.map((section) => (
          <section
            aria-labelledby={`gh-help-${section.id}`}
            className="gh-help-page-section"
            id={section.id}
            key={section.id}
          >
            <h2 className="gh-help-page-section-title" id={`gh-help-${section.id}`}>
              {section.title}
            </h2>
            <div className="gh-help-page-entries">
              {section.entries.map((entry, index) => (
                <article
                  className="gh-help-page-entry"
                  key={`${section.id}-${index}`}
                >
                  <h3 className="gh-help-page-entry-heading">{entry.heading}</h3>
                  <p className="gh-help-page-entry-body">{entry.body}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

export default HelpPage;
