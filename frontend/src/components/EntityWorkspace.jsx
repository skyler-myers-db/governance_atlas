import LineageStage from "./LineageStage";

function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function lineageCounts(graph) {
  if (!graph?.nodes?.length) {
    return { upstream: 0, downstream: 0, nodes: 0, edges: 0 };
  }
  return {
    upstream: graph.nodes.filter((node) => node.role === "source").length,
    downstream: graph.nodes.filter((node) => node.role === "target").length,
    nodes: graph.nodes.length,
    edges: graph.edges?.length || 0,
  };
}

function governanceTasks(asset) {
  return [
    {
      label: "Ownership",
      action: "Assign accountable owners",
      complete: Boolean(asset.owners?.length),
      value: asset.owners?.length ? `${asset.owners.length} assigned` : "Unassigned",
    },
    {
      label: "Domain",
      action: "Map the asset to a business domain",
      complete: Boolean(asset.domain && asset.domain !== "Unassigned"),
      value: asset.domain || "Unassigned",
    },
    {
      label: "Tier",
      action: "Set a support tier for downstream use",
      complete: Boolean(asset.tier && asset.tier !== "Unassigned"),
      value: asset.tier || "Unassigned",
    },
    {
      label: "Certification",
      action: "Confirm if the asset is approved for trusted use",
      complete: Boolean(asset.certification && asset.certification !== "Unassigned"),
      value: asset.certification || "Unassigned",
    },
    {
      label: "Sensitivity",
      action: "Review privacy and classification posture",
      complete: Boolean(asset.sensitivity && asset.sensitivity !== "Unassigned"),
      value: asset.sensitivity || "Unassigned",
    },
  ];
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
  lineageContext,
  onTabChange,
  onBack,
  onLineageContextChange,
  onOpenGovernance,
  onOpenLineage,
  lineageBundle,
  lineageLoading,
  onSelectAsset,
}) {
  if (!asset) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <div className="gh-panel gh-unavailable-panel">
          <div className="gh-panel-title">Asset</div>
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
  const relatedAssets = entity.relatedAssets || [];
  const tasks = governanceTasks(asset);

  return (
    <section className="gh-workspace gh-entity-workspace">
      <section className="gh-panel gh-entity-shell">
        <div className="gh-entity-header">
          <div className="gh-entity-header-main">
            <div className="gh-chip-row">
              <button className="gh-secondary-button" onClick={onBack} type="button">
                Back to results
              </button>
              <span className="gh-chip gh-chip-soft">{asset.objectType}</span>
              <span className={`gh-status-chip tone-${statusTone(asset)}`}>
                {asset.governanceStatus || "Needs Work"}
              </span>
            </div>
            <div className="gh-panel-title">Asset</div>
            <h2>{asset.name}</h2>
            <div className="gh-entity-context">
              {asset.catalog} / {asset.schema}
            </div>
            <p>{entity.description || asset.description || "No description is available for this asset yet."}</p>
          </div>

          <div className="gh-entity-header-side">
            <div className="gh-chip-stack">
              <span className="gh-chip">{asset.domain}</span>
              <span className="gh-chip">{asset.tier}</span>
              <span className="gh-chip">{asset.certification}</span>
              <span className="gh-chip">{asset.sensitivity}</span>
            </div>

            <div className="gh-entity-metrics">
              <div className="gh-score-box">
                <span className="gh-score-box-label">Coverage</span>
                <span className="gh-score-box-value">{asset.coverageScore}</span>
              </div>
              <div className="gh-score-box">
                <span className="gh-score-box-label">Owners</span>
                <span className="gh-score-box-value">{asset.owners?.length || 0}</span>
              </div>
              <div className="gh-score-box">
                <span className="gh-score-box-label">Requests</span>
                <span className="gh-score-box-value">{asset.openRequests}</span>
              </div>
            </div>

            <div className="gh-action-grid">
              <button className="gh-primary-button" onClick={() => onOpenLineage("Data Lineage")} type="button">
                Open lineage
              </button>
              <button className="gh-secondary-button" onClick={() => onOpenGovernance(asset.fqn)} type="button">
                Open governance
              </button>
            </div>
          </div>
        </div>

        <EntityTabs activeTab={activeTab} onTabChange={onTabChange} />

        {activeTab === "Overview" && (
          <div className="gh-entity-layout">
            <section className="gh-panel gh-entity-main">
              <div className="gh-panel-title">Asset record</div>
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

              <div className="gh-detail-section">
                <div className="gh-panel-title">Schema highlight</div>
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
                      {columns.slice(0, 8).map((column) => (
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
              </div>
            </section>

            <aside className="gh-panel gh-entity-side">
              <div className="gh-panel-title">Action track</div>
              <div className="gh-task-list">
                {tasks.map((task) => (
                  <div className={`gh-task-card ${task.complete ? "is-complete" : ""}`} key={task.label}>
                    <div className="gh-task-card-head">
                      <span className={`gh-status-chip tone-${task.complete ? "good" : "bad"}`}>
                        {task.complete ? "Ready" : "Needs work"}
                      </span>
                      <span className="gh-task-value">{task.value}</span>
                    </div>
                    <div className="gh-task-title">{task.label}</div>
                    <div className="gh-support-copy">{task.action}</div>
                  </div>
                ))}
              </div>

              <div className="gh-detail-section">
                <div className="gh-panel-title">Impact</div>
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
              </div>

              {relatedAssets.length ? (
                <div className="gh-detail-section">
                  <div className="gh-panel-title">Related assets</div>
                  <div className="gh-chip-stack">
                    {relatedAssets.slice(0, 8).map((item) => (
                      <button
                        className="gh-filter-chip"
                        key={item}
                        onClick={() => onSelectAsset(item)}
                        type="button"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
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
          <section className="gh-entity-layout">
            <section className="gh-panel gh-entity-main">
              <div className="gh-panel-title">Priority actions</div>
              <div className="gh-task-list">
                {tasks.map((task) => (
                  <div className={`gh-task-card ${task.complete ? "is-complete" : ""}`} key={task.label}>
                    <div className="gh-task-card-head">
                      <span className={`gh-status-chip tone-${task.complete ? "good" : "bad"}`}>
                        {task.complete ? "Ready" : "Needs work"}
                      </span>
                      <span className="gh-task-value">{task.value}</span>
                    </div>
                    <div className="gh-task-title">{task.label}</div>
                    <div className="gh-support-copy">{task.action}</div>
                  </div>
                ))}
              </div>

              <div className="gh-action-grid">
                <button className="gh-primary-button" onClick={() => onOpenGovernance(asset.fqn)} type="button">
                  Open workbench
                </button>
                <button className="gh-secondary-button" onClick={() => onOpenLineage("Operational Context")} type="button">
                  Inspect operational context
                </button>
              </div>
            </section>

            <aside className="gh-panel gh-entity-side">
              <div className="gh-panel-title">Current posture</div>
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
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Criticality</span>
                  <span className="gh-stat-value">{asset.criticality || "Unassigned"}</span>
                </div>
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Open requests</span>
                  <span className="gh-stat-value">{asset.openRequests}</span>
                </div>
              </div>
            </aside>
          </section>
        )}

        {activeTab === "Lineage" && (
          <LineageStage
            asset={asset}
            allowRefocus={false}
            assetSearchLoading={false}
            assetSearchQuery=""
            assetSearchResults={[]}
            context={lineageContext}
            embedded
            error=""
            graphBundle={lineageBundle}
            loading={lineageLoading}
            onAssetSearchQueryChange={() => {}}
            onContextChange={onLineageContextChange}
            onOpenAsset={(assetFqn) => onSelectAsset(assetFqn)}
            onOpenFullGraph={onOpenLineage}
            onOpenGovernance={onOpenGovernance}
            onSelectAsset={onSelectAsset}
          />
        )}
      </section>
    </section>
  );
}
