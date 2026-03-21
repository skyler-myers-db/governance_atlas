import { useEffect, useState } from "react";
import LineageGraph from "./LineageGraph";

function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function graphForContext(lineageBundle, context) {
  if (!lineageBundle) return null;
  return context === "Operational Context" ? lineageBundle.operational : lineageBundle.data;
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

function EntityLineageTab({
  asset,
  lineageBundle,
  lineageContext,
  lineageLoading,
  onLineageContextChange,
  onOpenLineage,
  onSelectAsset,
}) {
  const graph = graphForContext(lineageBundle, lineageContext);
  const counts = lineageCounts(graph);
  const [selectedNodeId, setSelectedNodeId] = useState("focus");
  const selectedNode = (graph?.nodes || []).find((node) => node.id === selectedNodeId) || graph?.nodes?.[0] || null;

  useEffect(() => {
    setSelectedNodeId("focus");
  }, [asset?.fqn, graph?.edges?.length, graph?.nodes?.length, lineageContext]);

  return (
    <section className="gh-entity-lineage-shell">
      <div className="gh-entity-lineage-head">
        <div>
          <div className="gh-panel-title">Lineage</div>
          <h3 className="gh-section-title">Trace upstream and downstream impact</h3>
          <div className="gh-support-copy">
            Explore the active graph inside the asset workspace, then open the full graph canvas when needed.
          </div>
        </div>
        <div className="gh-entity-lineage-actions">
          <div className="gh-segment-row">
            {["Data Lineage", "Operational Context"].map((option) => (
              <button
                className={`gh-segment-button ${lineageContext === option ? "is-active" : ""}`}
                key={option}
                onClick={() => onLineageContextChange(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
          <button className="gh-primary-button" onClick={() => onOpenLineage(lineageContext)} type="button">
            Open full graph
          </button>
        </div>
      </div>

      <div className="gh-summary-grid gh-lineage-summary-grid">
        <div className="gh-stat-card">
          <span className="gh-stat-label">Upstream</span>
          <span className="gh-stat-value">{lineageLoading ? "…" : counts.upstream}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Downstream</span>
          <span className="gh-stat-value">{lineageLoading ? "…" : counts.downstream}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Nodes</span>
          <span className="gh-stat-value">{lineageLoading ? "…" : counts.nodes}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Edges</span>
          <span className="gh-stat-value">{lineageLoading ? "…" : counts.edges}</span>
        </div>
      </div>

      <div className="gh-lineage-layout gh-entity-lineage-layout">
        <section className="gh-panel gh-lineage-graph-panel">
          {lineageLoading ? (
            <div className="gh-empty-state">Loading graph…</div>
          ) : graph ? (
            <LineageGraph
              graph={graph}
              onSelectNode={setSelectedNodeId}
              selectedNodeId={selectedNode?.id || ""}
            />
          ) : (
            <div className="gh-empty-state">No lineage is available for this asset yet.</div>
          )}
        </section>

        <aside className="gh-panel gh-lineage-detail">
          <div className="gh-panel-title">Selection</div>
          {selectedNode ? (
            <>
              <h2>{selectedNode.label}</h2>
              <div className="gh-support-copy">{selectedNode.subtitle}</div>
              <div className="gh-chip-stack">
                <span className="gh-chip">{selectedNode.kind}</span>
                <span className="gh-chip">{selectedNode.kicker || selectedNode.role}</span>
              </div>
              {selectedNode.assetFqn ? (
                <div className="gh-action-row">
                  <button
                    className="gh-primary-button"
                    onClick={() => onSelectAsset(selectedNode.assetFqn)}
                    type="button"
                  >
                    Open asset
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenLineage(lineageContext)}
                    type="button"
                  >
                    Open in graph workspace
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="gh-empty-state">Select a node to inspect its metadata.</div>
          )}
        </aside>
      </div>
    </section>
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

  return (
    <section className="gh-workspace gh-entity-workspace">
      <div className="gh-entity-toolbar">
        <button className="gh-secondary-button" onClick={onBack} type="button">
          Back to results
        </button>
        <div className="gh-chip-row">
          <button className="gh-secondary-button" onClick={() => onOpenLineage("Data Lineage")} type="button">
            Open lineage
          </button>
          <button className="gh-secondary-button" onClick={onOpenGovernance} type="button">
            Open governance
          </button>
        </div>
      </div>

      <section className="gh-panel gh-entity-shell">
        <div className="gh-entity-header">
          <div className="gh-entity-header-main">
            <div className="gh-panel-title">Asset</div>
            <h2>{asset.name}</h2>
            <div className="gh-entity-context">
              {asset.catalog} / {asset.schema}
            </div>
            <p>{entity.description || asset.description || "No description is available for this asset yet."}</p>
          </div>

          <div className="gh-entity-header-side">
            <div className="gh-chip-stack">
              <span className={`gh-status-chip tone-${statusTone(asset)}`}>
                {asset.governanceStatus || "Needs Work"}
              </span>
              <span className="gh-chip">{asset.objectType}</span>
              <span className="gh-chip">{asset.domain}</span>
              <span className="gh-chip">{asset.tier}</span>
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
              <div className="gh-score-box">
                <span className="gh-score-box-label">Rows</span>
                <span className="gh-score-box-value">{entity.rows || asset.rows}</span>
              </div>
            </div>
          </div>
        </div>

        <EntityTabs activeTab={activeTab} onTabChange={onTabChange} />

        {activeTab === "Overview" && (
          <div className="gh-entity-layout">
            <section className="gh-panel gh-entity-main">
              <div className="gh-panel-title">Operational profile</div>
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
              <div className="gh-panel-title">Stewardship</div>
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

              <div className="gh-detail-section">
                <div className="gh-panel-title">Exposure</div>
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
              <div className="gh-panel-title">Policy posture</div>
              <div className="gh-summary-grid">
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Governance status</span>
                  <span className="gh-stat-value">{asset.governanceStatus || "Needs Work"}</span>
                </div>
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Owners</span>
                  <span className="gh-stat-value">{asset.owners?.length || 0}</span>
                </div>
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Open requests</span>
                  <span className="gh-stat-value">{asset.openRequests}</span>
                </div>
                <div className="gh-stat-card">
                  <span className="gh-stat-label">Criticality</span>
                  <span className="gh-stat-value">{asset.criticality || "Unassigned"}</span>
                </div>
              </div>

              <div className="gh-action-row">
                <button className="gh-primary-button" onClick={onOpenGovernance} type="button">
                  Open governance workspace
                </button>
              </div>
            </section>

            <aside className="gh-panel gh-entity-side">
              <div className="gh-panel-title">Classification</div>
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
          </section>
        )}

        {activeTab === "Lineage" && (
          <EntityLineageTab
            asset={asset}
            lineageContext={lineageContext}
            lineageBundle={lineageBundle}
            lineageLoading={lineageLoading}
            onLineageContextChange={onLineageContextChange}
            onOpenLineage={onOpenLineage}
            onSelectAsset={onSelectAsset}
          />
        )}
      </section>
    </section>
  );
}
