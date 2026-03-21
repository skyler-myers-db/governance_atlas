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

function QuickPreview({
  asset,
  detail,
  loading,
  onOpenAsset,
  onOpenGovernance,
  onOpenLineage,
  onSelectAsset,
}) {
  if (!asset) {
    return (
      <aside className="gh-panel gh-inspector">
        <div className="gh-panel-title">Inspector</div>
        <div className="gh-empty-state">
          Select a result to inspect its metadata, lineage, and governance context.
        </div>
      </aside>
    );
  }

  const entity = detail || asset;

  return (
    <aside className="gh-panel gh-inspector">
      <div className="gh-panel-title">Selected asset</div>
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

      <div className="gh-chip-stack">
        <span className="gh-chip">{asset.objectType}</span>
        <span className="gh-chip">{asset.domain}</span>
        <span className="gh-chip">{asset.tier}</span>
      </div>

      <div className="gh-quick-preview-copy">{entity.description || asset.description}</div>

      <div className="gh-stat-grid gh-stat-grid-tight">
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
        <div className="gh-stat-card">
          <span className="gh-stat-label">Owners</span>
          <span className="gh-stat-value">{asset.owners?.length || 0}</span>
        </div>
      </div>

      <section className="gh-detail-section">
        <div className="gh-panel-title">Field focus</div>
        {loading ? (
          <div className="gh-empty-state">Loading asset metadata…</div>
        ) : entity.columns?.length ? (
          <div className="gh-chip-stack">
            {entity.columns.slice(0, 6).map((column) => (
              <span className="gh-chip gh-chip-soft" key={column.name}>
                {column.name}
              </span>
            ))}
          </div>
        ) : (
          <div className="gh-empty-state">No schema metadata is available for this asset.</div>
        )}
      </section>

      {entity.relatedAssets?.length ? (
        <section className="gh-detail-section">
          <div className="gh-panel-title">Related assets</div>
          <div className="gh-chip-stack">
            {entity.relatedAssets.slice(0, 5).map((item) => (
              <button
                className="gh-filter-chip gh-chip-soft"
                key={item}
                onClick={() => onSelectAsset(item)}
                type="button"
              >
                {item.split(".").slice(-2).join(" / ")}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="gh-action-grid">
        <button className="gh-primary-button" onClick={() => onOpenAsset(asset.fqn)} type="button">
          Open asset
        </button>
        <button className="gh-secondary-button" onClick={() => onOpenLineage(asset.fqn)} type="button">
          Open lineage
        </button>
        <button className="gh-secondary-button" onClick={() => onOpenGovernance(asset.fqn)} type="button">
          Open governance
        </button>
      </div>
    </aside>
  );
}

function ResultRow({ asset, isActive, onInspect, onOpenAsset }) {
  return (
    <article className={`gh-result-row ${isActive ? "is-active" : ""}`}>
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

        <div className="gh-result-row-footer">
          <div className="gh-chip-stack">
            {(asset.tags || []).slice(0, 4).map((tag) => (
              <span className="gh-chip gh-chip-soft" key={`${asset.fqn}-${tag}`}>
                {tag}
              </span>
            ))}
          </div>
          <div className="gh-result-metadata">
            <span>{asset.owners?.length || 0} owners</span>
            <span>{asset.openRequests} requests</span>
            <span>Coverage {asset.coverageScore}</span>
          </div>
        </div>
      </button>
      <div className="gh-result-row-side">
        <div className="gh-result-row-score">
          <span className="gh-score-box-label">Coverage</span>
          <span className="gh-score-box-value">{asset.coverageScore}</span>
        </div>
        <button className="gh-secondary-button gh-inline-action" onClick={() => onInspect(asset.fqn)} type="button">
          Preview
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
  selectedAssetSummary,
  selectedAssetLoading,
  onSelectAsset,
  onOpenAsset,
  onOpenGovernance,
  onOpenLineage,
}) {
  const filters = discoveryState;
  const selectedAsset = selectedAssetDetail || selectedAssetSummary || null;
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
              <h2 className="gh-workspace-title">Search and browse assets</h2>
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
                  isActive={selectedAssetFqn === asset.fqn}
                  key={asset.fqn}
                  onInspect={onSelectAsset}
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

        <QuickPreview
          asset={selectedAsset}
          detail={selectedAssetDetail}
          loading={selectedAssetLoading}
          onOpenAsset={onOpenAsset}
          onOpenLineage={onOpenLineage}
          onOpenGovernance={onOpenGovernance}
          onSelectAsset={onSelectAsset}
        />
      </div>
    </section>
  );
}
