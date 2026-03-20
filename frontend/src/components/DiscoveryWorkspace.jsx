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
    <section className="gh-category-rail">
      <div className="gh-panel-title">Browse</div>
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
      <div className="gh-filter-title">Saved Views</div>
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

function QuickPreview({ asset, detail, loading, onOpenAsset, onOpenLineage }) {
  if (!asset) {
    return (
      <aside className="gh-panel gh-inspector">
        <div className="gh-panel-title">Preview</div>
        <div className="gh-empty-state">
          Select a result to inspect its metadata, lineage, and governance context.
        </div>
      </aside>
    );
  }

  const entity = detail || asset;

  return (
    <aside className="gh-panel gh-inspector">
      <div className="gh-panel-title">Preview</div>
      <div className="gh-entity-head">
        <div>
          <h2>{asset.name}</h2>
          <div className="gh-entity-context">
            {asset.catalog} / {asset.schema}
          </div>
        </div>
        <div className={`gh-status-chip tone-${statusTone(asset)}`}>
          {asset.governanceStatus || "Needs Work"}
        </div>
      </div>

      <div className="gh-quick-preview-copy">{entity.description || asset.description}</div>

      <div className="gh-stat-grid">
        <div className="gh-stat-card">
          <span className="gh-stat-label">Type</span>
          <span className="gh-stat-value">{asset.objectType}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Coverage</span>
          <span className="gh-stat-value">{asset.coverageScore}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Rows</span>
          <span className="gh-stat-value">{entity.rows || asset.rows}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Open requests</span>
          <span className="gh-stat-value">{asset.openRequests}</span>
        </div>
      </div>

      {loading ? (
        <div className="gh-empty-state">Loading asset metadata…</div>
      ) : entity.columns?.length ? (
        <section className="gh-detail-section">
          <div className="gh-panel-title">Schema Preview</div>
          <table className="gh-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {entity.columns.slice(0, 6).map((column) => (
                <tr key={column.name}>
                  <td>{column.name}</td>
                  <td>{column.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <div className="gh-inspector-actions gh-action-row">
        <button className="gh-secondary-button" onClick={() => onOpenAsset(asset.fqn)} type="button">
          Open asset workspace
        </button>
        <button className="gh-primary-button" onClick={() => onOpenLineage(asset.fqn)} type="button">
          Open lineage workspace
        </button>
      </div>
    </aside>
  );
}

function ResultRow({ asset, isActive, onOpenAsset, onOpenPreview }) {
  return (
    <article className={`gh-result-row ${isActive ? "is-active" : ""}`}>
      <button className="gh-result-row-main" onClick={() => onOpenPreview(asset.fqn)} type="button">
        <div className="gh-result-row-top">
          <span className="gh-result-type">{asset.objectType}</span>
          <span className={`gh-status-chip tone-${statusTone(asset)}`}>
            {asset.governanceStatus || "Needs Work"}
          </span>
        </div>
        <div className="gh-result-row-title">{asset.name}</div>
        <div className="gh-result-row-context">
          {asset.catalog} / {asset.schema}
        </div>
        <div className="gh-result-row-description">{asset.description}</div>
        <div className="gh-result-row-tags">
          {(asset.tags || []).slice(0, 4).map((tag) => (
            <span className="gh-chip gh-chip-soft" key={`${asset.fqn}-${tag}`}>
              {tag}
            </span>
          ))}
        </div>
      </button>
      <div className="gh-result-row-side">
        <div className="gh-score-box">
          <span className="gh-score-box-label">Coverage</span>
          <span className="gh-score-box-value">{asset.coverageScore}</span>
        </div>
        <div className="gh-result-meta">
          <span>{asset.openRequests} open requests</span>
          <span>{asset.owners?.length || 0} owners</span>
        </div>
        <button className="gh-secondary-button gh-inline-action" onClick={() => onOpenAsset(asset.fqn)} type="button">
          Inspect asset
        </button>
      </div>
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
  selectedAssetFqn,
  selectedAssetDetail,
  selectedAssetLoading,
  onSelectAsset,
  onOpenAsset,
  onOpenLineage,
}) {
  const filters = discoveryState;
  const selectedAsset = results.find((asset) => asset.fqn === selectedAssetFqn) || null;
  const assetTypeOptions = facetValues(resultsFacets, "assetTypes", bootstrap.discovery.assetTypes || ["All types"]);
  const typeCounts = facetCountMap(resultsFacets, "assetTypes");

  return (
    <section className="gh-workspace gh-discovery-workspace">
      <section className="gh-discovery-toolbar gh-panel">
        <div>
          <div className="gh-panel-title">Discovery</div>
          <div className="gh-support-copy">
            Search live metadata, narrow the scope, and move directly from results into asset and lineage workflows.
          </div>
        </div>
        <div className="gh-discovery-toolbar-controls">
          <input
            className="gh-input gh-search-input"
            onChange={(event) =>
              onDiscoveryStateChange({ ...filters, query: event.target.value })
            }
            placeholder="Search for tables, views, dashboards, domains, or glossary context"
            value={filters.query}
          />
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
      </section>

      <section className="gh-discovery-layout">
        <aside className="gh-panel gh-discovery-sidebar">
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
        </aside>

        <section className="gh-panel gh-results-column">
          <div className="gh-results-head">
            <div>
              <div className="gh-panel-title">Results</div>
              <div className="gh-support-copy">
                {resultsLoading ? "Refreshing discovery results…" : `${resultsCount} assets match the current scope.`}
              </div>
            </div>
          </div>

          {resultsError ? (
            <div className="gh-empty-state">{resultsError}</div>
          ) : results.length ? (
            <div className="gh-result-list">
              {results.map((asset) => (
                <ResultRow
                  asset={asset}
                  isActive={selectedAsset?.fqn === asset.fqn}
                  key={asset.fqn}
                  onOpenAsset={onOpenAsset}
                  onOpenPreview={onSelectAsset}
                />
              ))}
            </div>
          ) : (
            <div className="gh-empty-state">
              No assets match the current filters. Relax the scope or clear the search.
            </div>
          )}
        </section>

        <QuickPreview
          asset={selectedAsset}
          detail={selectedAssetDetail}
          loading={selectedAssetLoading}
          onOpenAsset={onOpenAsset}
          onOpenLineage={onOpenLineage}
        />
      </section>
    </section>
  );
}
