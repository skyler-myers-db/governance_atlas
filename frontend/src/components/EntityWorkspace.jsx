function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function lineageCounts(graph) {
  if (!graph?.nodes?.length) {
    return { upstream: 0, downstream: 0 };
  }
  return {
    upstream: graph.nodes.filter((node) => node.role === "source").length,
    downstream: graph.nodes.filter((node) => node.role === "target").length,
  };
}

function EntityTabs({ activeTab, onTabChange }) {
  const tabs = ["Overview", "Schema", "Preview", "Governance", "Lineage"];
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

export default function EntityWorkspace({
  asset,
  detail,
  loading,
  activeTab,
  onTabChange,
  onBack,
  onOpenLineage,
  lineageBundle,
  lineageLoading,
}) {
  if (!asset) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <div className="gh-panel gh-unavailable-panel">
          <div className="gh-panel-title">Asset Workspace</div>
          <div className="gh-empty-state">Select an asset from discovery to inspect its metadata.</div>
        </div>
      </section>
    );
  }

  const entity = detail || asset;
  const columns = entity.columns || [];
  const preview = entity.preview || [];
  const dataCounts = lineageCounts(lineageBundle?.data);
  const operationalCounts = lineageCounts(lineageBundle?.operational);

  return (
    <section className="gh-workspace gh-entity-workspace">
      <div className="gh-entity-toolbar">
        <button className="gh-secondary-button" onClick={onBack} type="button">
          Back to results
        </button>
        <button className="gh-primary-button" onClick={() => onOpenLineage("Data Lineage")} type="button">
          Open lineage workspace
        </button>
      </div>

      <section className="gh-panel gh-entity-shell">
        <div className="gh-entity-hero">
          <div className="gh-entity-hero-main">
            <div className="gh-panel-title">Asset Workspace</div>
            <h2>{asset.name}</h2>
            <div className="gh-entity-context">
              {asset.catalog} / {asset.schema}
            </div>
            <p>{entity.description || asset.description}</p>
            <div className="gh-chip-stack">
              <span className={`gh-status-chip tone-${statusTone(asset)}`}>
                {asset.governanceStatus || "Needs Work"}
              </span>
              <span className="gh-chip">{asset.objectType}</span>
              {(asset.tags || []).slice(0, 4).map((tag) => (
                <span className="gh-chip gh-chip-soft" key={`${asset.fqn}-${tag}`}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="gh-entity-hero-metrics">
            <div className="gh-score-box">
              <span className="gh-score-box-label">Coverage</span>
              <span className="gh-score-box-value">{asset.coverageScore}</span>
            </div>
            <div className="gh-score-box">
              <span className="gh-score-box-label">Owners</span>
              <span className="gh-score-box-value">{asset.owners?.length || 0}</span>
            </div>
            <div className="gh-score-box">
              <span className="gh-score-box-label">Open requests</span>
              <span className="gh-score-box-value">{asset.openRequests}</span>
            </div>
            <div className="gh-score-box">
              <span className="gh-score-box-label">Rows</span>
              <span className="gh-score-box-value">{entity.rows || asset.rows}</span>
            </div>
          </div>
        </div>

        <EntityTabs activeTab={activeTab} onTabChange={onTabChange} />

        {activeTab === "Overview" && (
          <div className="gh-entity-layout">
            <section className="gh-panel gh-entity-main">
              <div className="gh-panel-title">Operational Summary</div>
              <div className="gh-stat-grid">
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Format</span>
                  <span className="gh-stat-value">{entity.format || "—"}</span>
                </div>
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Files</span>
                  <span className="gh-stat-value">{entity.files || "—"}</span>
                </div>
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Size</span>
                  <span className="gh-stat-value">{entity.size || "—"}</span>
                </div>
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Type</span>
                  <span className="gh-stat-value">{entity.objectType || asset.objectType}</span>
                </div>
              </div>
            </section>

            <aside className="gh-panel gh-entity-side">
              <div className="gh-panel-title">Governance Summary</div>
              <div className="gh-summary-grid">
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
            </aside>
          </div>
        )}

        {activeTab === "Schema" && (
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

        {activeTab === "Preview" && (
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

        {activeTab === "Governance" && (
          <section className="gh-detail-section">
            <div className="gh-summary-grid">
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

        {activeTab === "Lineage" && (
          <section className="gh-entity-lineage-bridge">
            <div className="gh-lineage-bridge-head">
              <div>
                <div className="gh-panel-title">Graph Access</div>
                <div className="gh-support-copy">
                  Launch the graph workspace directly from the selected entity context.
                </div>
              </div>
              <button className="gh-primary-button" onClick={() => onOpenLineage("Data Lineage")} type="button">
                Open graph workspace
              </button>
            </div>
            <div className="gh-summary-grid">
              <div className="gh-stat-card">
                <span className="gh-stat-label">Data upstream</span>
                <span className="gh-stat-value">{lineageLoading ? "…" : dataCounts.upstream}</span>
              </div>
              <div className="gh-stat-card">
                <span className="gh-stat-label">Data downstream</span>
                <span className="gh-stat-value">{lineageLoading ? "…" : dataCounts.downstream}</span>
              </div>
              <div className="gh-stat-card">
                <span className="gh-stat-label">Operational upstream</span>
                <span className="gh-stat-value">{lineageLoading ? "…" : operationalCounts.upstream}</span>
              </div>
              <div className="gh-stat-card">
                <span className="gh-stat-label">Operational downstream</span>
                <span className="gh-stat-value">{lineageLoading ? "…" : operationalCounts.downstream}</span>
              </div>
            </div>
            <div className="gh-chip-row">
              <button
                className="gh-secondary-button"
                onClick={() => onOpenLineage("Data Lineage")}
                type="button"
              >
                Open data lineage
              </button>
              <button
                className="gh-secondary-button"
                onClick={() => onOpenLineage("Operational Context")}
                type="button"
              >
                Open operational context
              </button>
            </div>
          </section>
        )}
      </section>
    </section>
  );
}
