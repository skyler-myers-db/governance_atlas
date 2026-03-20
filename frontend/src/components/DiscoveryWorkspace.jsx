function statusTone(asset) {
  if (asset.governanceStatus === "Enterprise Ready") return "good";
  if (asset.governanceStatus === "Operational") return "warn";
  return "bad";
}

function applySavedView(asset, view) {
  if (view === "Needs owner") return !asset.owners?.length;
  if (view === "Needs certification") return asset.certification === "Unassigned";
  if (view === "Certified") return asset.certification !== "Unassigned";
  if (view === "High coverage") return asset.coverageScore >= 75;
  return true;
}

function assetMatches(asset, filters) {
  const query = String(filters.query || "").trim().toLowerCase();
  if (query) {
    const haystack = [
      asset.name,
      asset.description,
      asset.catalog,
      asset.schema,
      asset.domain,
      asset.tier,
      asset.certification,
      asset.sensitivity,
      asset.objectType,
      ...(asset.tags || []),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (!applySavedView(asset, filters.view)) return false;
  if (filters.type !== "All types" && asset.objectType !== filters.type) return false;

  const checks = [
    ["catalogs", "catalog", "All catalogs"],
    ["domains", "domain", "All domains"],
    ["tiers", "tier", "All tiers"],
    ["certifications", "certification", "All certifications"],
    ["sensitivities", "sensitivity", "All sensitivities"],
  ];

  for (const [key, field, allLabel] of checks) {
    const selected = filters[key] || [allLabel];
    if (selected.includes(allLabel)) continue;
    if (!selected.includes(asset[field])) return false;
  }

  return true;
}

function sortAssets(assets, sortBy) {
  return [...assets].sort((left, right) => {
    if (sortBy === "Coverage score") return right.coverageScore - left.coverageScore;
    if (sortBy === "Open requests") return right.openRequests - left.openRequests;
    if (sortBy === "Recently updated") return left.name.localeCompare(right.name);
    return right.coverageScore - left.coverageScore;
  });
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

function CategoryRail({ assetTypes, selectedType, assets, onSelectType }) {
  const counts = assets.reduce((acc, asset) => {
    acc[asset.objectType] = (acc[asset.objectType] || 0) + 1;
    return acc;
  }, {});

  return (
    <section className="gh-category-rail">
      <div className="gh-panel-title">Browse</div>
      <div className="gh-category-list">
        {assetTypes.map((type) => {
          const active = selectedType === type;
          const count = type === "All types" ? assets.length : counts[type] || 0;
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

function PreviewTabBar({ activeTab, onTabChange }) {
  const tabs = ["Overview", "Schema", "Preview", "Governance"];
  return (
    <div className="gh-subtabs">
      {tabs.map((tab) => (
        <button
          className={`gh-subtab ${activeTab === tab ? "is-active" : ""}`}
          key={tab}
          onClick={() => onTabChange(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function AssetPreview({
  asset,
  detail,
  loading,
  previewTab,
  onPreviewTabChange,
  onOpenLineage,
}) {
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
  const columns = entity?.columns || [];
  const preview = entity?.preview || [];

  return (
    <aside className="gh-panel gh-inspector">
      <div className="gh-panel-title">Selected Asset</div>
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

      <PreviewTabBar activeTab={previewTab} onTabChange={onPreviewTabChange} />

      {previewTab === "Overview" && (
        <section className="gh-detail-section">
          <p>{entity?.description || asset.description}</p>
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
              <span className="gh-stat-value">{entity?.rows || asset.rows}</span>
            </div>
            <div className="gh-stat-card">
              <span className="gh-stat-label">Format</span>
              <span className="gh-stat-value">{entity?.format || asset.format || "—"}</span>
            </div>
          </div>
        </section>
      )}

      {previewTab === "Schema" && (
        <section className="gh-detail-section">
          {loading ? (
            <div className="gh-empty-state">Loading schema metadata…</div>
          ) : columns.length ? (
            <table className="gh-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((column) => (
                  <tr key={column.name}>
                    <td>{column.name}</td>
                    <td>{column.type}</td>
                    <td>{column.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="gh-empty-state">No schema metadata is available for this asset.</div>
          )}
        </section>
      )}

      {previewTab === "Preview" && (
        <section className="gh-detail-section">
          {loading ? (
            <div className="gh-empty-state">Loading preview rows…</div>
          ) : preview.length ? (
            <table className="gh-table">
              <thead>
                <tr>
                  {Object.keys(preview[0]).map((key) => (
                    <th key={key}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, index) => (
                  <tr key={index}>
                    {Object.keys(preview[0]).map((key) => (
                      <td key={key}>{row[key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="gh-empty-state">No preview rows are available for this asset.</div>
          )}
        </section>
      )}

      {previewTab === "Governance" && (
        <section className="gh-detail-section">
          <div className="gh-stat-grid">
            <div className="gh-stat-card">
              <span className="gh-stat-label">Domain</span>
              <span className="gh-stat-value">{asset.domain}</span>
            </div>
            <div className="gh-stat-card">
              <span className="gh-stat-label">Tier</span>
              <span className="gh-stat-value">{asset.tier}</span>
            </div>
            <div className="gh-stat-card">
              <span className="gh-stat-label">Certification</span>
              <span className="gh-stat-value">{asset.certification}</span>
            </div>
            <div className="gh-stat-card">
              <span className="gh-stat-label">Sensitivity</span>
              <span className="gh-stat-value">{asset.sensitivity}</span>
            </div>
          </div>
        </section>
      )}

      <div className="gh-inspector-actions">
        <button className="gh-primary-button" onClick={() => onOpenLineage(asset.fqn)} type="button">
          Open Lineage Workspace
        </button>
      </div>
    </aside>
  );
}

function ResultRow({ asset, isActive, onSelect }) {
  return (
    <button
      className={`gh-result-row ${isActive ? "is-active" : ""}`}
      onClick={() => onSelect(asset.fqn)}
      type="button"
    >
      <div className="gh-result-row-main">
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
      </div>
      <div className="gh-result-row-side">
        <div className="gh-score-box">
          <span className="gh-score-box-label">Coverage</span>
          <span className="gh-score-box-value">{asset.coverageScore}</span>
        </div>
        <div className="gh-result-meta">
          <span>{asset.openRequests} open requests</span>
          <span>{asset.owners?.length || 0} owners</span>
        </div>
      </div>
    </button>
  );
}

export default function DiscoveryWorkspace({
  bootstrap,
  selectedAssetFqn,
  selectedAssetDetail,
  selectedAssetLoading,
  discoveryState,
  onDiscoveryStateChange,
  onSelectAsset,
  onOpenLineage,
}) {
  const allAssets = bootstrap.assets || [];
  const filters = discoveryState;
  const filtered = sortAssets(
    allAssets.filter((asset) => assetMatches(asset, filters)),
    filters.sortBy
  );
  const selectedAsset =
    filtered.find((asset) => asset.fqn === selectedAssetFqn) || null;

  return (
    <section className="gh-workspace gh-discovery-workspace">
      <section className="gh-discovery-toolbar gh-panel">
        <div>
          <div className="gh-panel-title">Discovery</div>
          <div className="gh-support-copy">
            Search, facet, and inspect metadata assets through a catalog workspace.
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
            assetTypes={bootstrap.discovery.assetTypes || ["All types"]}
            assets={allAssets}
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
            options={bootstrap.discovery.catalogs}
            selected={filters.catalogs}
          />
          <FilterSection
            allLabel="All domains"
            label="Domains"
            onToggle={(value, allLabel) =>
              toggleMulti(filters, "domains", value, allLabel, onDiscoveryStateChange)
            }
            options={bootstrap.discovery.domains}
            selected={filters.domains}
          />
          <FilterSection
            allLabel="All tiers"
            label="Tiers"
            onToggle={(value, allLabel) =>
              toggleMulti(filters, "tiers", value, allLabel, onDiscoveryStateChange)
            }
            options={bootstrap.discovery.tiers}
            selected={filters.tiers}
          />
          <FilterSection
            allLabel="All certifications"
            label="Certifications"
            onToggle={(value, allLabel) =>
              toggleMulti(filters, "certifications", value, allLabel, onDiscoveryStateChange)
            }
            options={bootstrap.discovery.certifications}
            selected={filters.certifications}
          />
          <FilterSection
            allLabel="All sensitivities"
            label="Sensitivities"
            onToggle={(value, allLabel) =>
              toggleMulti(filters, "sensitivities", value, allLabel, onDiscoveryStateChange)
            }
            options={bootstrap.discovery.sensitivities}
            selected={filters.sensitivities}
          />
        </aside>

        <section className="gh-panel gh-results-column">
          <div className="gh-results-head">
            <div>
              <div className="gh-panel-title">Results</div>
              <div className="gh-support-copy">
                {filtered.length} assets match the current discovery scope.
              </div>
            </div>
          </div>

          {filtered.length ? (
            <div className="gh-result-list">
              {filtered.map((asset) => (
                <ResultRow
                  asset={asset}
                  isActive={selectedAsset?.fqn === asset.fqn}
                  key={asset.fqn}
                  onSelect={onSelectAsset}
                />
              ))}
            </div>
          ) : (
            <div className="gh-empty-state">
              No assets match the current filters. Relax the scope or clear the search.
            </div>
          )}
        </section>

        <AssetPreview
          asset={selectedAsset}
          detail={selectedAssetDetail}
          loading={selectedAssetLoading}
          onOpenLineage={onOpenLineage}
          onPreviewTabChange={(previewTab) =>
            onDiscoveryStateChange({ ...filters, previewTab })
          }
          previewTab={filters.previewTab}
        />
      </section>
    </section>
  );
}
