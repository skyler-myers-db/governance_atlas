import { assetPathLabel, displayObjectType } from "../../lib/assetPresentation";

export function GlobalSearchDropdown({
  assets,
  error,
  loading,
  scopeLabel = "visible assets",
  notice,
  onBrowseCatalog,
  onSelectAsset,
  query,
  topDirectResult,
}) {
  const trimmedQuery = query.trim();
  const searchStatus = loading
    ? `Searching ${scopeLabel}...`
    : trimmedQuery
      ? `Direct matches across ${scopeLabel}`
      : `Start typing to search ${scopeLabel}`;
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
          <div className="gh-eyebrow">Search results</div>
          <div className="gh-search-dropdown-status">{searchStatus}</div>
        </div>
        {searchCount ? <div className="gh-search-dropdown-status">{searchCount}</div> : null}
      </div>

      {error ? <div className="gh-search-empty">{error}</div> : null}
      {!error && notice ? <div className="gh-search-empty">{notice}</div> : null}

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
