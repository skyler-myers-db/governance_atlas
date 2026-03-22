import { useEffect, useState } from "react";
import { useAssetSearch } from "../hooks/useAssetSearch";

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

export default function AppFrame({
  shell,
  activeModule,
  onModuleChange,
  bootState,
  bootMessage,
  onSearchBrowse,
  onSearchResultSelect,
  children,
}) {
  const modules = ["discovery", "lineage", "governance"];
  const [searchQuery, setSearchQuery] = useState("");
  const shellDisabled = bootState === "unavailable" || bootState === "error";

  const searchPanelOpen = !shellDisabled && searchQuery.trim().length >= 2;
  const shellSearch = useAssetSearch(searchQuery, searchPanelOpen);
  const topResult = shellSearch.assets?.[0] || null;

  useEffect(() => {
    setSearchQuery("");
  }, [activeModule]);

  const browseCatalog = () => {
    if (shellDisabled) return;
    const query = searchQuery.trim();
    if (!query) return;
    setSearchQuery("");
    onSearchBrowse?.(query);
  };

  return (
    <div className="gh-app">
      <header className="gh-shell-header">
        <div className="gh-shell-topbar">
          <div className="gh-shell-brand">
            <div className="gh-brand-mark">GH</div>
            <div className="gh-brand-copy">
              <div className="gh-eyebrow">Metadata workspace</div>
              <h1>Governance Hub</h1>
            </div>
          </div>

          <form
            className="gh-global-search"
            onSubmit={(event) => {
              event.preventDefault();
              if (shellDisabled) return;
              if (!topResult) return;
              setSearchQuery("");
              onSearchResultSelect?.(topResult.fqn);
            }}
          >
            <div className="gh-global-search-field">
              <input
                className="gh-input gh-global-search-input"
                disabled={shellDisabled}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search assets, glossary terms, or workflow context"
                value={searchQuery}
              />
              {searchPanelOpen ? (
                <div className="gh-search-dropdown">
                  <div className="gh-search-dropdown-head">
                    <span className="gh-panel-title">Global search</span>
                    {shellSearch.loading ? <span className="gh-search-dropdown-status">Searching…</span> : null}
                  </div>
                  {shellSearch.error ? (
                    <div className="gh-search-empty">{shellSearch.error}</div>
                  ) : shellSearch.assets?.length ? (
                    <>
                      <div className="gh-search-results">
                        {shellSearch.assets.map((asset) => (
                          <button
                            className="gh-search-result-row"
                            disabled={shellDisabled}
                            key={asset.fqn}
                            onClick={() => {
                              setSearchQuery("");
                              onSearchResultSelect?.(asset.fqn);
                            }}
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
                      <div className="gh-search-dropdown-actions">
                        <span className="gh-search-dropdown-note">Enter opens the top result.</span>
                        <button className="gh-secondary-button" onClick={browseCatalog} type="button">
                          Browse in catalog
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="gh-search-empty">No direct matches yet.</div>
                      <div className="gh-search-dropdown-actions">
                        <span className="gh-search-dropdown-note">
                          Open the full catalog to work from the broader result set.
                        </span>
                        <button className="gh-secondary-button" onClick={browseCatalog} type="button">
                          Browse all in catalog
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </form>

          <div className="gh-shell-utility">
            <span className="gh-shell-identity">
              <span className="gh-shell-role">{shell?.role || "Reader"}</span>
              <span className="gh-shell-user">{shell?.userEmail || "unknown"}</span>
            </span>
            {bootState && bootState !== "live" ? (
              <span className={`gh-chip gh-chip-status tone-${statusTone(bootState)}`}>
                {statusLabel(bootState)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="gh-shell-nav-row">
          <nav className="gh-shell-nav" aria-label="Primary modules">
            {modules.map((module) => (
              <button
                className={`gh-product-tab ${activeModule === module ? "is-active" : ""}`}
                disabled={shellDisabled}
                key={module}
                onClick={() => onModuleChange(module)}
                type="button"
              >
                {module[0].toUpperCase() + module.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {bootState && bootState !== "live" ? (
        <div className={`gh-shell-banner tone-${statusTone(bootState)}`}>
          <div className="gh-shell-inline-status-title">
            {bootState === "degraded"
              ? "Read-only metadata mode"
              : bootState === "error"
                ? "Workspace failed to load"
                : "Workspace unavailable"}
          </div>
          <p>{bootMessage}</p>
        </div>
      ) : null}

      <main className="gh-main">{children}</main>
    </div>
  );
}
