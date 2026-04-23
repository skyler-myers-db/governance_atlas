import { GlobalSearchDropdown } from "./GlobalSearchDropdown";

export function GlobalSearch({
  searchRootRef,
  searchQuery,
  onSearchQueryChange,
  searchPanelOpen,
  onSearchPanelOpenChange,
  onSubmit,
  searchScopeSubject,
  searchScopeHint,
  searchScopeLabel,
  shellDisabled,
  shellDisabledReason,
  searchEnabled,
  searchAssets,
  searchError,
  searchLoading,
  searchNotice,
  onSearchNoticeReset,
  onSelectAsset,
  topDirectResult,
  navigationState,
}) {
  return (
    <div className="gh-shell-commandbar">
      <div className="gh-shell-commandbar-copy">
        <div className="gh-shell-module-label">Command bar</div>
        <div className="gh-shell-commandbar-title">
          {`Search ${searchScopeSubject}, then open the broader discovery surface.`}
        </div>
        {searchScopeHint ? (
          <div className="gh-shell-commandbar-subtitle">{searchScopeHint}</div>
        ) : null}
        <div className="gh-shell-commandbar-scope">{searchScopeLabel}</div>
      </div>
      {navigationState?.pending ? (
        <div className="gh-shell-progress" role="status" aria-live="polite">
          <span className="gh-shell-progress-bar" aria-hidden="true" />
          <span className="gh-shell-progress-copy">
            {navigationState.label || "Opening workspace…"}
          </span>
        </div>
      ) : null}
      <form
        className="gh-global-search gh-global-search-shell"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className={`gh-global-search-field ${searchPanelOpen ? "is-open" : ""}`} ref={searchRootRef}>
          <div className="gh-global-search-frame">
            <div className="gh-global-search-copy">
              <label className="gh-global-search-label" htmlFor="gh-global-search-input">
                Search
              </label>
            </div>
            <div className="gh-global-search-input-wrap">
              <input
                aria-describedby={shellDisabled ? "gh-global-search-disabled-note" : undefined}
                className="gh-input gh-global-search-input"
                disabled={shellDisabled}
                id="gh-global-search-input"
                title={shellDisabledReason}
                onBlur={() => {
                  if (typeof window === "undefined") return;
                  window.requestAnimationFrame(() => {
                    if (!searchRootRef.current?.contains(document.activeElement)) {
                      onSearchPanelOpenChange(false);
                    }
                  });
                }}
                onChange={(event) => {
                  const next = event.target.value;
                  onSearchQueryChange(next);
                  onSearchNoticeReset();
                  onSearchPanelOpenChange(next.trim().length >= 2);
                }}
                onFocus={() => {
                  if (!shellDisabled && searchQuery.trim().length >= 2) {
                    onSearchPanelOpenChange(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") onSearchPanelOpenChange(false);
                }}
                placeholder={`Search ${searchScopeSubject} by name, schema, domain, or tag`}
                value={searchQuery}
              />
            </div>
            <button
              className="gh-secondary-button gh-search-submit"
              disabled={shellDisabled}
              title={shellDisabledReason}
              type="submit"
            >
              {topDirectResult ? "Open" : "Browse"}
            </button>
            {shellDisabledReason ? (
              <span
                id="gh-global-search-disabled-note"
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0,0,0,0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              >
                {shellDisabledReason}
              </span>
            ) : null}
          </div>

          {searchEnabled ? (
            <GlobalSearchDropdown
              assets={searchAssets}
              error={searchError}
              loading={searchLoading}
              scopeLabel={searchScopeSubject}
              notice={searchNotice}
              onBrowseCatalog={() => onSubmit()}
              onSelectAsset={onSelectAsset}
              query={searchQuery}
              topDirectResult={topDirectResult}
            />
          ) : null}
        </div>
      </form>
    </div>
  );
}
