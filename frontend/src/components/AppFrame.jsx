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
  onBrowseCatalog,
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

  return (
    <div className="gh-app">
      <header className="gh-shell-header">
        <div className="gh-shell-workbar">
          <div className="gh-shell-brand">
            <div className="gh-shell-brand-mark" aria-hidden="true">
              GH
            </div>
            <div className="gh-brand-copy">
              <h1>Governance Hub</h1>
              <div className="gh-brand-subtitle">Metadata workspace</div>
            </div>
          </div>

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
                placeholder="Search assets or glossary"
              value={searchQuery}
            />
            {searchPanelOpen ? (
              <div className="gh-search-dropdown">
                {shellSearch.loading ? <div className="gh-search-empty">Searching…</div> : null}
                {shellSearch.error ? (
                  <div className="gh-search-empty">{shellSearch.error}</div>
                ) : shellSearch.assets?.length ? (
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
                ) : (
                  <div className="gh-search-empty">No direct asset matches.</div>
                )}
                <div className="gh-search-dropdown-foot">
                  <button
                    className="gh-secondary-button"
                    disabled={shellDisabled}
                    onClick={() => {
                      const query = searchQuery.trim();
                      if (!query) return;
                      setSearchQuery("");
                      onBrowseCatalog?.(query);
                    }}
                    type="button"
                  >
                    Browse in catalog
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </form>

          <div className="gh-shell-utility">
            <span className="gh-shell-user">{shell?.userEmail || "unknown"}</span>
            {bootState && bootState !== "live" ? (
              <span className={`gh-chip gh-chip-status tone-${statusTone(bootState)}`}>
                {statusLabel(bootState)}
              </span>
            ) : null}
          </div>
        </div>
        {bootState && bootState !== "live" && bootMessage ? (
          <div className="gh-shell-status-note">{bootMessage}</div>
        ) : null}
      </header>

      <main className="gh-main">{children}</main>
    </div>
  );
}
