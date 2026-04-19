import { GlobalSearchDropdown } from "./GlobalSearchDropdown";

const SearchIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export function TopbarSearch({
  searchRootRef,
  searchQuery,
  onSearchQueryChange,
  searchPanelOpen,
  onSearchPanelOpenChange,
  onSubmit,
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
  placeholder = "Search across Databricks Unity Catalog, tables, views, and metrics…",
}) {
  return (
    <form
      className="gh-topbar-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div
        className={`gh-topbar-search-field ${searchPanelOpen ? "is-open" : ""}`.trim()}
        ref={searchRootRef}
      >
        <span aria-hidden="true" className="gh-topbar-search-icon">
          <SearchIcon />
        </span>
        <input
          aria-label="Search Databricks Unity Catalog, tables, views, and metrics"
          className="gh-topbar-search-input"
          disabled={shellDisabled}
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
          placeholder={placeholder}
          title={shellDisabledReason}
          type="search"
          value={searchQuery}
        />
        {searchEnabled ? (
          <GlobalSearchDropdown
            assets={searchAssets}
            error={searchError}
            loading={searchLoading}
            scopeLabel={placeholder}
            notice={searchNotice}
            onBrowseCatalog={() => onSubmit()}
            onSelectAsset={onSelectAsset}
            query={searchQuery}
            topDirectResult={topDirectResult}
          />
        ) : null}
      </div>
    </form>
  );
}

export default TopbarSearch;
