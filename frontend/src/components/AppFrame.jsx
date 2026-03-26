import { useEffect, useRef, useState } from "react";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { assetPathLabel, displayObjectType } from "../lib/assetPresentation";

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

const MODULES = [
  {
    key: "discovery",
    label: "Discovery",
  },
  {
    key: "lineage",
    label: "Lineage",
  },
  {
    key: "governance",
    label: "Governance",
  },
];

function SearchDropdown({
  assets,
  error,
  loading,
  onBrowseCatalog,
  onSelectAsset,
  query,
  topDirectResult,
}) {
  const trimmedQuery = query.trim();
  const searchStatus = loading
    ? "Searching visible assets..."
    : trimmedQuery
      ? "Direct matches across visible assets"
      : "Start typing to search visible assets";
  const searchCount = loading
    ? ""
    : assets.length
      ? `${assets.length} matches`
      : trimmedQuery
        ? "No direct matches"
        : "Type to search";

  return (
    <div className="gh-search-dropdown">
      <div className="gh-search-dropdown-head">
        <div>
          <div className="gh-eyebrow">Global Search</div>
          <div className="gh-search-dropdown-status">{searchStatus}</div>
        </div>
        {searchCount ? <div className="gh-search-dropdown-status">{searchCount}</div> : null}
      </div>

      {error ? <div className="gh-search-empty">{error}</div> : null}

      {!error && assets.length ? (
        <div className="gh-search-results">
          {assets.map((asset) => (
            <button
              className="gh-search-result-row"
              key={asset.fqn}
              onClick={() => onSelectAsset(asset.fqn)}
              type="button"
            >
              <span className="gh-search-result-main">
                <span className="gh-search-result-title">{asset.name}</span>
                <span className="gh-search-result-subtitle">{assetPathLabel(asset)}</span>
              </span>
              <span className="gh-search-result-meta">
                {displayObjectType(asset) ? (
                  <span className="gh-chip gh-chip-soft">{displayObjectType(asset)}</span>
                ) : null}
                {asset.domain && asset.domain !== "Unassigned" ? (
                  <span className="gh-chip gh-chip-soft">{asset.domain}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {!error && !loading && trimmedQuery && !assets.length ? (
        <div className="gh-search-empty">
          No direct asset matches yet. Press Enter to open the full discovery workspace.
        </div>
      ) : null}

      <div className="gh-search-dropdown-foot">
        {topDirectResult ? (
          <button
            className="gh-tertiary-button gh-inline-link-button"
            onClick={() => onSelectAsset(topDirectResult.fqn)}
            type="button"
          >
            Open top result
          </button>
        ) : null}
        <button className="gh-tertiary-button gh-inline-link-button" onClick={onBrowseCatalog} type="button">
          Browse full results
        </button>
      </div>
    </div>
  );
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const searchRootRef = useRef(null);
  const shellDisabled = bootState === "unavailable" || bootState === "error";
  const showRuntimeStatus = bootState === "degraded" || bootState === "unavailable" || bootState === "error";
  const searchEnabled = !shellDisabled && searchPanelOpen && searchQuery.trim().length >= 2;
  const shellSearch = useAssetSearch(searchQuery, searchEnabled);

  const topDirectResult =
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
      if (event.key === "Escape") setSearchPanelOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [searchPanelOpen]);

  const submitSearch = () => {
    if (shellDisabled) return;
    const query = searchQuery.trim();
    if (!query) return;
    if (topDirectResult) {
      setSearchPanelOpen(false);
      onSearchResultSelect?.(topDirectResult.fqn);
      return;
    }
    setSearchPanelOpen(false);
    onBrowseCatalog?.(query);
  };

  return (
    <div className="gh-app">
      <header className="gh-shell-header">
        <div className="gh-shell-topbar">
          <div className="gh-shell-spine">
            <div className="gh-shell-brand-band">
              <button
                className="gh-shell-brand"
                disabled={shellDisabled}
                onClick={() => onModuleChange("discovery")}
                type="button"
              >
                <div className="gh-shell-brand-mark" aria-hidden="true">
                  <span>GH</span>
                </div>
                <div className="gh-shell-brand-copy">
                  <div className="gh-shell-brand-title">Governance Hub</div>
                  <div className="gh-shell-brand-subtitle">Metadata Workspace</div>
                </div>
              </button>
            </div>

            <div className="gh-shell-nav-band">
              <div className="gh-shell-module-label">Modules</div>
              <nav className="gh-shell-nav" aria-label="Primary modules">
                {MODULES.map((module) => (
                  <button
                    className={`gh-product-tab ${activeModule === module.key ? "is-active" : ""}`}
                    disabled={shellDisabled}
                    key={module.key}
                    onClick={() => onModuleChange(module.key)}
                    type="button"
                  >
                    <span>{module.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>

          <div className="gh-shell-topbar-utility">
            <div className="gh-shell-identity-block">
              {showRuntimeStatus ? (
                <span className={`gh-chip gh-chip-status tone-${statusTone(bootState)}`}>
                  {statusLabel(bootState)}
                </span>
              ) : null}
              <div className="gh-shell-identity">{shell?.role || "workspace user"}</div>
              <div className="gh-shell-user">{shell?.userEmail || "unknown"}</div>
              {showRuntimeStatus && bootMessage ? (
                <div className={`gh-shell-status-note tone-${statusTone(bootState)}`}>{bootMessage}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="gh-shell-commandbar">
          <form
            className="gh-global-search gh-global-search-shell"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className="gh-global-search-field" ref={searchRootRef}>
              <div className="gh-global-search-frame">
                <div className="gh-global-search-copy">
                  <label className="gh-global-search-label" htmlFor="gh-global-search-input">
                    Global Search
                  </label>
                </div>
                <div className="gh-global-search-input-wrap">
                  <input
                    className="gh-input gh-global-search-input"
                    disabled={shellDisabled}
                    id="gh-global-search-input"
                    onBlur={() => {
                      if (typeof window === "undefined") return;
                      window.requestAnimationFrame(() => {
                        if (!searchRootRef.current?.contains(document.activeElement)) {
                          setSearchPanelOpen(false);
                        }
                      });
                    }}
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
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setSearchPanelOpen(false);
                    }}
                    placeholder="Search visible assets by name, schema, domain, or tag"
                    value={searchQuery}
                  />
                </div>
                <button className="gh-secondary-button gh-search-submit" disabled={shellDisabled} type="submit">
                  {topDirectResult ? "Open" : "Browse"}
                </button>
              </div>

              {searchEnabled ? (
                <SearchDropdown
                  assets={shellSearch.assets || []}
                  error={shellSearch.error}
                  loading={shellSearch.loading}
                  onBrowseCatalog={() => submitSearch()}
                  onSelectAsset={(assetFqn) => {
                    setSearchPanelOpen(false);
                    onSearchResultSelect?.(assetFqn);
                  }}
                  query={searchQuery}
                  topDirectResult={topDirectResult}
                />
              ) : null}
            </div>
          </form>
        </div>
      </header>

      <main className="gh-main">{children}</main>
    </div>
  );
}
