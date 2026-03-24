import { useEffect, useRef, useState } from "react";
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
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const searchRootRef = useRef(null);
  const shellDisabled = bootState === "unavailable" || bootState === "error";

  const searchEnabled = !shellDisabled && searchPanelOpen && searchQuery.trim().length >= 2;
  const shellSearch = useAssetSearch(searchQuery, searchEnabled);
  const topResult =
    !shellSearch.loading && shellSearch.resolvedQuery === searchQuery.trim()
      ? shellSearch.assets?.[0] || null
      : null;

  useEffect(() => {
    setSearchPanelOpen(false);
  }, [activeModule]);

  useEffect(() => {
    if (!searchPanelOpen) return undefined;
    const onPointerDown = (event) => {
      if (!searchRootRef.current?.contains(event.target)) {
        setSearchPanelOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setSearchPanelOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [searchPanelOpen]);

  return (
    <div className="gh-app">
      <header className="gh-shell-header">
        <div className="gh-shell-workbar">
          <div className="gh-shell-brand">
            <div className="gh-shell-brand-mark" aria-hidden="true">
              GH
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
              const query = searchQuery.trim();
              if (!query) return;
              setSearchQuery("");
              setSearchPanelOpen(false);
              if (topResult) {
                onSearchResultSelect?.(topResult.fqn);
                return;
              }
              onBrowseCatalog?.(query);
            }}
          >
            <div className="gh-global-search-field" ref={searchRootRef}>
              <input
                className="gh-input gh-global-search-input"
                disabled={shellDisabled}
                onChange={(event) => {
                  const next = event.target.value;
                  setSearchQuery(next);
                  setSearchPanelOpen(next.trim().length >= 2);
                }}
                onFocus={() => {
                  if (!shellDisabled && searchQuery.trim().length >= 2) {
                    setSearchPanelOpen(true);
                  }
                }}
                onBlur={() => {
                  if (typeof window === "undefined") return;
                  window.requestAnimationFrame(() => {
                    if (!searchRootRef.current?.contains(document.activeElement)) {
                      setSearchPanelOpen(false);
                    }
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchPanelOpen(false);
                  }
                }}
                placeholder="Search assets or glossary"
                value={searchQuery}
              />
            {searchEnabled ? (
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
                          setSearchPanelOpen(false);
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
                  <div className="gh-search-empty">No direct asset matches. Press Enter to browse the catalog.</div>
                )}
                <div className="gh-search-dropdown-foot">
                  <button
                    className="gh-secondary-button"
                    disabled={shellDisabled}
                    onClick={() => {
                      const query = searchQuery.trim();
                      if (!query) return;
                      setSearchQuery("");
                      setSearchPanelOpen(false);
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
            {bootState && bootState !== "live" ? (
              <span className={`gh-chip gh-chip-status tone-${statusTone(bootState)}`}>
                {statusLabel(bootState)}
              </span>
            ) : null}
            <span className="gh-shell-user">{shell?.userEmail || "unknown"}</span>
          </div>
        </div>
        {bootState && bootState !== "live" && bootMessage ? (
          <div className={`gh-inline-alert tone-${statusTone(bootState)}`}>
            <div className="gh-inline-alert-title">Workspace status</div>
            <div>{bootMessage}</div>
          </div>
        ) : null}
      </header>

      <main className="gh-main">{children}</main>
    </div>
  );
}
