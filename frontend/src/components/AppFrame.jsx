export default function AppFrame({
  shell,
  activeModule,
  onModuleChange,
  children,
}) {
  const modules = ["discovery", "lineage", "governance"];
  const metrics = shell?.metrics || [];

  return (
    <div className="gh-app">
      <header className="gh-hero">
        <section className="gh-brand-card">
          <div className="gh-brand-mark">GH</div>
          <div className="gh-brand-copy">
            <div className="gh-eyebrow">Enterprise metadata for Databricks</div>
            <h1>Governance Hub</h1>
            <p>
              Search assets, inspect lineage, and keep ownership, documentation,
              and governance context current across Unity Catalog.
            </p>
          </div>
        </section>
        <section className="gh-overview-card">
          <div className="gh-overview-head">
            <div className="gh-eyebrow">Governance Estate Overview</div>
            <div className="gh-chip-row">
              <span className="gh-chip">{shell?.role || "Reader"}</span>
              <span className="gh-chip">{shell?.userEmail || "unknown"}</span>
            </div>
          </div>
          <div className="gh-metric-grid">
            {metrics.map((metric) => (
              <div className="gh-metric-card" key={metric.label}>
                <span className="gh-metric-label">{metric.label}</span>
                <span className="gh-metric-value">{metric.value}</span>
              </div>
            ))}
          </div>
        </section>
      </header>

      <section className="gh-module-shell">
        <div className="gh-module-head">
          <div className="gh-eyebrow">Module Switcher</div>
          <button className="gh-help-button" type="button">
            ?
          </button>
        </div>
        <nav className="gh-module-row" aria-label="Primary modules">
          {modules.map((module) => (
            <button
              className={`gh-module-pill ${activeModule === module ? "is-active" : ""}`}
              key={module}
              onClick={() => onModuleChange(module)}
              type="button"
            >
              {module[0].toUpperCase() + module.slice(1)}
            </button>
          ))}
        </nav>
      </section>

      <main className="gh-main">{children}</main>
    </div>
  );
}
