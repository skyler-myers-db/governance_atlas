function statusTone(bootState) {
  if (bootState === "degraded") return "warn";
  if (bootState === "unavailable" || bootState === "error") return "bad";
  return "neutral";
}

export default function AppFrame({
  shell,
  activeModule,
  onModuleChange,
  bootState,
  bootMessage,
  children,
}) {
  const modules = ["discovery", "lineage", "governance"];
  const metrics = shell?.metrics || [];

  return (
    <div className="gh-app">
      <header className="gh-topbar">
        <div className="gh-brandlock">
          <div className="gh-brand-mark">GH</div>
          <div className="gh-brand-copy">
            <div className="gh-eyebrow">Enterprise metadata for Databricks</div>
            <h1>Governance Hub</h1>
            <p>Search trusted assets, inspect lineage, and keep governance context in one workspace.</p>
          </div>
        </div>
        <div className="gh-topbar-side">
          <div className="gh-chip-row">
            <span className="gh-chip">{shell?.role || "Reader"}</span>
            <span className="gh-chip">{shell?.userEmail || "unknown"}</span>
          </div>
          <div className="gh-top-metric-row">
            {metrics.slice(0, 4).map((metric) => (
              <div className="gh-top-metric" key={metric.label}>
                <span className="gh-top-metric-label">{metric.label}</span>
                <span className="gh-top-metric-value">{metric.value}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <nav className="gh-product-nav" aria-label="Primary modules">
        {modules.map((module) => (
          <button
            className={`gh-product-tab ${activeModule === module ? "is-active" : ""}`}
            key={module}
            onClick={() => onModuleChange(module)}
            type="button"
          >
            {module[0].toUpperCase() + module.slice(1)}
          </button>
        ))}
      </nav>

      {bootState && bootState !== "live" ? (
        <section className={`gh-shell-banner tone-${statusTone(bootState)}`}>
          <div className="gh-eyebrow">
            {bootState === "degraded"
              ? "Read-only mode"
              : bootState === "error"
                ? "Workspace failed to load"
                : "Workspace unavailable"}
          </div>
          <p>{bootMessage}</p>
        </section>
      ) : null}

      <main className="gh-main">{children}</main>
    </div>
  );
}
