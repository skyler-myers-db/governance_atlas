function statusTone(bootState) {
  if (bootState === "degraded") return "warn";
  if (bootState === "unavailable" || bootState === "error") return "bad";
  return "neutral";
}

function statusLabel(bootState) {
  if (bootState === "degraded") return "Read only";
  if (bootState === "unavailable" || bootState === "error") return "Unavailable";
  return "Live";
}

function surfaceLabel(surface) {
  if (surface === "entity") return "Asset";
  if (surface === "lineage") return "Lineage";
  if (surface === "governance") return "Governance";
  return "Discovery";
}

export default function AppFrame({
  shell,
  activeModule,
  surface,
  onModuleChange,
  bootState,
  bootMessage,
  searchQuery,
  searchResults,
  searchLoading,
  searchError,
  searchPanelOpen,
  onSearchQueryChange,
  onSearchSubmit,
  onSearchResultSelect,
  shellContext,
  onOpenFocusedAsset,
  children,
}) {
  const modules = ["discovery", "lineage", "governance"];
  const contextActionable = Boolean(shellContext?.assetFqn && onOpenFocusedAsset);

  return (
    <div className="gh-app">
      <header className="gh-shell-header">
        <div className="gh-shell-topbar">
          <div className="gh-shell-brand">
            <div className="gh-brand-mark">GH</div>
            <div className="gh-brand-copy">
              <div className="gh-eyebrow">{surfaceLabel(surface)}</div>
              <h1>Governance Hub</h1>
            </div>
          </div>

          <form
            className="gh-global-search"
            onSubmit={(event) => {
              event.preventDefault();
              onSearchSubmit?.();
            }}
          >
            <div className="gh-global-search-field">
              <input
                className="gh-input gh-global-search-input"
                onChange={(event) => onSearchQueryChange?.(event.target.value)}
                placeholder="Search assets, lineage context, glossary terms, or governance gaps"
                value={searchQuery}
              />
              {searchPanelOpen ? (
                <div className="gh-search-dropdown">
                  <div className="gh-search-dropdown-head">
                    <span className="gh-panel-title">Global search</span>
                    {searchLoading ? <span className="gh-search-dropdown-status">Searching…</span> : null}
                  </div>
                  {searchError ? (
                    <div className="gh-search-empty">{searchError}</div>
                  ) : searchResults?.length ? (
                    <div className="gh-search-results">
                      {searchResults.map((asset) => (
                        <button
                          className="gh-search-result-row"
                          key={asset.fqn}
                          onClick={() => onSearchResultSelect?.(asset.fqn)}
                          type="button"
                        >
                          <span className="gh-search-result-main">
                            <span className="gh-search-result-title">{asset.name}</span>
                            <span className="gh-search-result-subtitle">
                              {asset.catalog} / {asset.schema}
                            </span>
                          </span>
                          <span className="gh-chip gh-chip-soft">{asset.objectType}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="gh-search-empty">
                      Search the catalog or press enter to browse the full result set.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <button className="gh-primary-button gh-search-submit" type="submit">
              Search
            </button>
          </form>

          <div className="gh-shell-utility">
            <span className={`gh-chip gh-chip-status tone-${statusTone(bootState)}`}>
              {statusLabel(bootState)}
            </span>
            <span className="gh-chip">{shell?.role || "Reader"}</span>
            <span className="gh-chip">{shell?.userEmail || "unknown"}</span>
          </div>
        </div>

        <div className="gh-shell-nav-row">
          <nav className="gh-shell-nav" aria-label="Primary modules">
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
          {shellContext ? (
            <div className="gh-shell-context-wrap">
              <div className="gh-shell-context">
                <div className="gh-shell-context-main">
                  <div className="gh-panel-title">{shellContext.label}</div>
                  <div className="gh-shell-context-title">{shellContext.title}</div>
                  {shellContext.subtitle ? (
                    <div className="gh-shell-context-subtitle">{shellContext.subtitle}</div>
                  ) : null}
                </div>
                {contextActionable ? (
                  <button
                    className="gh-secondary-button gh-shell-context-action"
                    onClick={() => onOpenFocusedAsset?.(shellContext.assetFqn)}
                    type="button"
                  >
                    Open asset
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="gh-shell-context-wrap gh-shell-context-wrap-empty" />
          )}
        </div>
      </header>

      {bootState && bootState !== "live" ? (
        <section className={`gh-shell-banner tone-${statusTone(bootState)}`}>
          <div className="gh-eyebrow">
            {bootState === "degraded"
              ? "Workspace running in degraded mode"
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
