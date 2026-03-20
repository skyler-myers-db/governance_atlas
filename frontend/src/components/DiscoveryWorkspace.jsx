function statusTone(asset) {
  if (asset.governanceStatus === "Enterprise Ready") return "good";
  if (asset.governanceStatus === "Operational") return "warn";
  return "bad";
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
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

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
    return right.coverageScore - left.coverageScore;
  });
}

function FilterSection({ label, options, selected, allLabel, onToggle }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">{label}</div>
      <div className="gh-filter-chip-row">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              className={`gh-filter-chip ${active ? "is-active" : ""}`}
              key={option}
              onClick={() => onToggle(option, allLabel)}
              type="button"
            >
              {option}
            </button>
          );
        })}
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

function AssetPreview({ asset, detail, loading, previewTab, onPreviewTabChange, onOpenLineage }) {
  const entity = detail || asset;
  const columns = entity?.columns || [];
  const preview = entity?.preview || [];

  return (
    <aside className="gh-inspector">
      <div className="gh-panel-title">Asset Preview</div>
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
              <span className="gh-stat-label">Coverage Score</span>
              <span className="gh-stat-value">{asset.coverageScore}</span>
            </div>
            <div className="gh-stat-card">
              <span className="gh-stat-label">Rows</span>
              <span className="gh-stat-value">{entity?.rows || asset.rows}</span>
            </div>
            <div className="gh-stat-card">
              <span className="gh-stat-label">Format</span>
              <span className="gh-stat-value">{entity?.format || asset.format}</span>
            </div>
            <div className="gh-stat-card">
              <span className="gh-stat-label">Open Requests</span>
              <span className="gh-stat-value">{asset.openRequests}</span>
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
    filtered.find((asset) => asset.fqn === selectedAssetFqn) || filtered[0] || null;

  if (!selectedAsset) {
    return (
      <section className="gh-workspace">
        <div className="gh-empty-state gh-panel">
          No visible assets are available in the discovery workspace.
        </div>
      </section>
    );
  }

  const toggleFilter = (key, value, allLabel) => {
    const current = filters[key];
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
  };

  return (
    <section className="gh-workspace gh-discovery-workspace">
      <aside className="gh-panel gh-facet-rail">
        <div className="gh-panel-title">Discovery</div>
        <div className="gh-filter-section">
          <div className="gh-filter-title">Search Assets</div>
          <input
            className="gh-input"
            onChange={(event) =>
              onDiscoveryStateChange({ ...filters, query: event.target.value })
            }
            placeholder="customer, finance, PII, certified"
            value={filters.query}
          />
        </div>
        <div className="gh-filter-section">
          <div className="gh-filter-title">Sort By</div>
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
        <FilterSection
          allLabel="All assets"
          label="Asset View"
          onToggle={(value, allLabel) => toggleFilter("views", value, allLabel)}
          options={bootstrap.discovery.views}
          selected={filters.views}
        />
        <FilterSection
          allLabel="All catalogs"
          label="Catalogs"
          onToggle={(value, allLabel) => toggleFilter("catalogs", value, allLabel)}
          options={bootstrap.discovery.catalogs}
          selected={filters.catalogs}
        />
        <FilterSection
          allLabel="All domains"
          label="Domains"
          onToggle={(value, allLabel) => toggleFilter("domains", value, allLabel)}
          options={bootstrap.discovery.domains}
          selected={filters.domains}
        />
        <FilterSection
          allLabel="All tiers"
          label="Tiers"
          onToggle={(value, allLabel) => toggleFilter("tiers", value, allLabel)}
          options={bootstrap.discovery.tiers}
          selected={filters.tiers}
        />
        <FilterSection
          allLabel="All certifications"
          label="Certifications"
          onToggle={(value, allLabel) => toggleFilter("certifications", value, allLabel)}
          options={bootstrap.discovery.certifications}
          selected={filters.certifications}
        />
        <FilterSection
          allLabel="All sensitivities"
          label="Sensitivities"
          onToggle={(value, allLabel) => toggleFilter("sensitivities", value, allLabel)}
          options={bootstrap.discovery.sensitivities}
          selected={filters.sensitivities}
        />
      </aside>

      <section className="gh-panel gh-results-column">
        <div className="gh-results-head">
          <div>
            <div className="gh-panel-title">Search Results</div>
            <div className="gh-support-copy">
              {filtered.length} assets match the current discovery filters.
            </div>
          </div>
        </div>
        <div className="gh-asset-list">
          {filtered.map((asset) => (
            <button
              className={`gh-asset-row ${selectedAsset.fqn === asset.fqn ? "is-active" : ""}`}
              key={asset.fqn}
              onClick={() => onSelectAsset(asset.fqn)}
              type="button"
            >
              <div className="gh-asset-row-main">
                <div className="gh-asset-row-title">{asset.name}</div>
                <div className="gh-asset-row-context">
                  {asset.catalog} / {asset.schema}
                </div>
                <div className="gh-asset-row-description">{asset.description}</div>
              </div>
              <div className="gh-asset-row-meta">
                <div className="gh-score-box">
                  <span className="gh-score-box-label">Coverage</span>
                  <span className="gh-score-box-value">{asset.coverageScore}</span>
                </div>
                <div className={`gh-status-chip tone-${statusTone(asset)}`}>
                  {asset.governanceStatus || "Needs Work"}
                </div>
              </div>
            </button>
          ))}
        </div>
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
  );
}
