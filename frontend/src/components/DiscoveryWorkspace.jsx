import { useState } from "react";

function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function facetValues(facets, key, fallbackOptions = []) {
  const entries = facets?.[key];
  if (!entries?.length) return fallbackOptions;
  return entries.map((entry) => entry.value);
}

function facetCountMap(facets, key) {
  const entries = facets?.[key] || [];
  return entries.reduce((acc, entry) => {
    acc[entry.value] = entry.count;
    return acc;
  }, {});
}

function toggleMulti(filters, key, value, allLabel, onDiscoveryStateChange) {
  const current = filters[key] || [allLabel];
  if (value === allLabel) {
    onDiscoveryStateChange({ ...filters, [key]: [allLabel] });
    return;
  }
  const next = new Set(current.filter((item) => item !== allLabel));
  if (next.has(value)) next.delete(value);
  else next.add(value);
  onDiscoveryStateChange({
    ...filters,
    [key]: next.size ? [...next] : [allLabel],
  });
}

function activeFilters(filters) {
  const chips = [];
  if (filters.query) chips.push({ label: `Search: ${filters.query}`, key: "query" });
  if (filters.view && filters.view !== "All assets") chips.push({ label: filters.view, key: "view" });
  if (filters.type && filters.type !== "All types") chips.push({ label: filters.type, key: "type" });
  ["catalogs", "domains", "tiers", "certifications", "sensitivities"].forEach((key) => {
    (filters[key] || [])
      .filter((value) => !value.startsWith("All "))
      .forEach((value) => chips.push({ label: value, key }));
  });
  return chips;
}

function objectTypeIcon(type) {
  if (type === "View" || type === "Materialized View") return "◫";
  if (type === "Dashboard") return "▦";
  if (type === "Notebook") return "✦";
  if (type === "Pipeline") return "⇢";
  return "▣";
}

function FilterSection({ label, options, selected, allLabel, onToggle }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">{label}</div>
      <div className="gh-filter-chip-row">
        {options.map((option) => (
          <button
            className={`gh-filter-chip ${selected.includes(option) ? "is-active" : ""}`}
            key={option}
            onClick={() => onToggle(option, allLabel)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}

function CategoryRail({ assetTypes, counts, selectedType, onSelectType }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">Asset types</div>
      <div className="gh-category-list">
        {assetTypes.map((type) => {
          const active = selectedType === type;
          const count = counts[type] ?? 0;
          return (
            <button
              className={`gh-category-row ${active ? "is-active" : ""}`}
              key={type}
              onClick={() => onSelectType(type)}
              type="button"
            >
              <span>{type}</span>
              <span className="gh-category-count">{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SavedViews({ views, activeView, onSelectView }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">Views</div>
      <div className="gh-saved-view-list">
        {views.map((view) => (
          <button
            className={`gh-saved-view ${activeView === view ? "is-active" : ""}`}
            key={view}
            onClick={() => onSelectView(view)}
            type="button"
          >
            {view}
          </button>
        ))}
      </div>
    </section>
  );
}

function ResultRow({ asset, onOpenAsset }) {
  return (
    <article className="gh-result-row">
      <button className="gh-result-row-main" onClick={() => onOpenAsset(asset.fqn)} type="button">
        <div className="gh-result-row-head">
          <div className="gh-result-row-identity">
            <span className="gh-result-icon" aria-hidden="true">
              {objectTypeIcon(asset.objectType)}
            </span>
            <div>
              <div className="gh-result-row-title">{asset.name}</div>
              <div className="gh-result-row-context">
                {asset.catalog} / {asset.schema}
              </div>
            </div>
          </div>
          <div className="gh-chip-row">
            <span className="gh-chip gh-chip-soft">{asset.objectType}</span>
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus || "Needs Work"}
            </span>
          </div>
        </div>

        <div className="gh-result-row-description">{asset.description}</div>

        <div className="gh-result-metadata">
          <span>Coverage {asset.coverageScore}</span>
          <span>{asset.owners?.length || 0} owners</span>
          <span>{asset.openRequests} requests</span>
          <span>{asset.domain || "Unassigned"}</span>
        </div>
      </button>
    </article>
  );
}

export default function DiscoveryWorkspace({
  bootstrap,
  discoveryState,
  onDiscoveryStateChange,
  results,
  resultsCount,
  resultsLoading,
  resultsError,
  resultsFacets,
  onOpenAsset,
}) {
  const filters = discoveryState;
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const assetTypeOptions = facetValues(resultsFacets, "assetTypes", bootstrap.discovery.assetTypes || ["All types"]);
  const typeCounts = facetCountMap(resultsFacets, "assetTypes");
  const filtersApplied = activeFilters(filters);

  return (
    <section className="gh-workspace gh-discovery-shell">
      <div className="gh-discovery-layout">
        <aside className="gh-panel gh-discovery-sidebar">
          <div className="gh-sidebar-head">
            <div>
              <div className="gh-panel-title">Browse</div>
              <div className="gh-support-copy">{resultsCount} visible assets</div>
            </div>
          </div>

          <CategoryRail
            assetTypes={assetTypeOptions}
            counts={typeCounts}
            onSelectType={(type) => onDiscoveryStateChange({ ...filters, type })}
            selectedType={filters.type}
          />

          <SavedViews
            activeView={filters.view}
            onSelectView={(view) => onDiscoveryStateChange({ ...filters, view })}
            views={bootstrap.discovery.views}
          />
          <section className="gh-filter-section">
            <button
              className="gh-rail-toggle"
              onClick={() => setShowAdvancedFilters((current) => !current)}
              type="button"
            >
              <span className="gh-filter-title">More filters</span>
              <span className="gh-chip gh-chip-soft">{showAdvancedFilters ? "Hide" : "Show"}</span>
            </button>
          </section>

          {showAdvancedFilters ? (
            <>
              <FilterSection
                allLabel="All catalogs"
                label="Catalogs"
                onToggle={(value, allLabel) =>
                  toggleMulti(filters, "catalogs", value, allLabel, onDiscoveryStateChange)
                }
                options={facetValues(resultsFacets, "catalogs", bootstrap.discovery.catalogs)}
                selected={filters.catalogs}
              />
              <FilterSection
                allLabel="All domains"
                label="Domains"
                onToggle={(value, allLabel) =>
                  toggleMulti(filters, "domains", value, allLabel, onDiscoveryStateChange)
                }
                options={facetValues(resultsFacets, "domains", bootstrap.discovery.domains)}
                selected={filters.domains}
              />
              <FilterSection
                allLabel="All tiers"
                label="Tiers"
                onToggle={(value, allLabel) =>
                  toggleMulti(filters, "tiers", value, allLabel, onDiscoveryStateChange)
                }
                options={facetValues(resultsFacets, "tiers", bootstrap.discovery.tiers)}
                selected={filters.tiers}
              />
              <FilterSection
                allLabel="All certifications"
                label="Certifications"
                onToggle={(value, allLabel) =>
                  toggleMulti(filters, "certifications", value, allLabel, onDiscoveryStateChange)
                }
                options={facetValues(resultsFacets, "certifications", bootstrap.discovery.certifications)}
                selected={filters.certifications}
              />
              <FilterSection
                allLabel="All sensitivities"
                label="Sensitivities"
                onToggle={(value, allLabel) =>
                  toggleMulti(filters, "sensitivities", value, allLabel, onDiscoveryStateChange)
                }
                options={facetValues(resultsFacets, "sensitivities", bootstrap.discovery.sensitivities)}
                selected={filters.sensitivities}
              />
            </>
          ) : null}
        </aside>

        <section className="gh-discovery-main">
          <section className="gh-panel gh-results-column">
            <div className="gh-results-head">
              <div>
                <div className="gh-panel-title">Catalog</div>
                <h2 className="gh-workspace-title">
                  {filters.query?.trim() ? `Search: ${filters.query}` : "Catalog results"}
                </h2>
                <div className="gh-support-copy">
                  {resultsLoading ? "Refreshing live results…" : `${resultsCount} assets in the current scope.`}
                </div>
              </div>
              <div className="gh-results-head-actions">
                <select
                  className="gh-select"
                  onChange={(event) =>
                    onDiscoveryStateChange({ ...filters, sortBy: event.target.value })
                  }
                  value={filters.sortBy}
                >
                  {bootstrap.discovery.sortOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filtersApplied.length ? (
              <div className="gh-active-filter-row">
                {filtersApplied.map((chip) => (
                  <span className="gh-chip gh-chip-soft" key={`${chip.key}-${chip.label}`}>
                    {chip.label}
                  </span>
                ))}
              </div>
            ) : null}

            {resultsError ? (
              <div className="gh-empty-state">{resultsError}</div>
            ) : results.length ? (
              <div className="gh-result-list">
                {results.map((asset) => (
                  <ResultRow
                    asset={asset}
                    key={asset.fqn}
                    onOpenAsset={onOpenAsset}
                  />
                ))}
              </div>
            ) : (
              <div className="gh-empty-state">
                No assets match the current filters. Relax the scope or clear the search.
              </div>
            )}
          </section>
        </section>
      </div>
    </section>
  );
}
