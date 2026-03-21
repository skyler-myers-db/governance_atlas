import { useEffect, useMemo, useState } from "react";
import LineageGraph from "./LineageGraph";

function selectGraph(graphBundle, context) {
  if (!graphBundle) return null;
  return context === "Operational Context" ? graphBundle.operational : graphBundle.data;
}

function graphSummary(graph) {
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

export default function LineageWorkspace({
  asset,
  graphBundle,
  loading,
  error,
  context,
  onContextChange,
  onOpenGovernance,
  onSelectAsset,
  onOpenAsset,
  assetSearchQuery,
  onAssetSearchQueryChange,
  assetSearchResults,
  assetSearchLoading,
}) {
  const graph = selectGraph(graphBundle, context);
  const summary = useMemo(() => graphSummary(graph), [graph]);
  const [selectedNodeId, setSelectedNodeId] = useState("focus");
  const nodes = graph?.nodes || [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;

  useEffect(() => {
    setSelectedNodeId("focus");
  }, [asset?.fqn, context, graph?.nodes?.length, graph?.edges?.length]);

  return (
    <section className="gh-lineage-shell">
      <header className="gh-panel gh-lineage-header">
        <div className="gh-lineage-header-main">
          <div className="gh-panel-title">Lineage</div>
          <h2 className="gh-workspace-title">{asset.name}</h2>
          <div className="gh-entity-context">
            {asset.catalog} / {asset.schema}
          </div>
        </div>

        <div className="gh-lineage-header-controls">
          <div className="gh-lineage-asset-picker">
            <label className="gh-filter-title" htmlFor="gh-lineage-asset-search">
              Focus asset
            </label>
            <input
              className="gh-input"
              id="gh-lineage-asset-search"
              onChange={(event) => onAssetSearchQueryChange(event.target.value)}
              placeholder={asset?.name ? `Search around ${asset.name}` : "Search for an asset"}
              value={assetSearchQuery}
            />
            <div className="gh-lineage-search-list">
              {assetSearchLoading ? (
                <div className="gh-lineage-search-empty">Searching assets…</div>
              ) : assetSearchResults.length ? (
                assetSearchResults.map((candidate) => (
                  <button
                    className={`gh-lineage-search-row ${candidate.fqn === asset?.fqn ? "is-active" : ""}`}
                    key={candidate.fqn}
                    onClick={() => onSelectAsset(candidate.fqn)}
                    type="button"
                  >
                    <span>{candidate.name}</span>
                    <span>
                      {candidate.catalog} / {candidate.schema}
                    </span>
                  </button>
                ))
              ) : (
                <div className="gh-lineage-search-empty">No matching assets.</div>
              )}
            </div>
          </div>

          <div className="gh-lineage-header-actions">
            <div className="gh-segment-row">
              {["Data Lineage", "Operational Context"].map((option) => (
                <button
                  className={`gh-segment-button ${context === option ? "is-active" : ""}`}
                  key={option}
                  onClick={() => onContextChange(option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
            <button className="gh-secondary-button" onClick={() => onOpenAsset(asset.fqn)} type="button">
              Open asset
            </button>
          </div>
        </div>
      </header>

      <div className="gh-summary-grid gh-lineage-summary-grid">
        <div className="gh-stat-card">
          <span className="gh-stat-label">Upstream</span>
          <span className="gh-stat-value">{loading ? "…" : summary.upstream}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Downstream</span>
          <span className="gh-stat-value">{loading ? "…" : summary.downstream}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Nodes</span>
          <span className="gh-stat-value">{loading ? "…" : summary.nodes}</span>
        </div>
        <div className="gh-stat-card">
          <span className="gh-stat-label">Edges</span>
          <span className="gh-stat-value">{loading ? "…" : summary.edges}</span>
        </div>
      </div>

      <div className="gh-lineage-layout">
        <section className="gh-panel gh-lineage-graph-panel">
          {loading ? (
            <div className="gh-empty-state">Loading lineage graph…</div>
          ) : error ? (
            <div className="gh-empty-state">{error}</div>
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
                    Refocus graph
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenAsset(selectedNode.assetFqn)}
                    type="button"
                  >
                    Open asset
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenGovernance(selectedNode.assetFqn)}
                    type="button"
                  >
                    Open governance
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="gh-empty-state">Select a node to inspect its metadata.</div>
          )}

          <div className="gh-detail-section">
            <div className="gh-panel-title">Focus asset</div>
            <h3>{asset.name}</h3>
            <div className="gh-support-copy">
              {asset.catalog} / {asset.schema}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
