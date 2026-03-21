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
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [drawerView, setDrawerView] = useState("node");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const nodes = graph?.nodes || [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;
  const selectedEdge = (graph?.edges || []).find(
    (edge, index) => `${edge.source}-${edge.target}-${index}` === selectedEdgeId
  ) || null;

  useEffect(() => {
    setSelectedNodeId("focus");
    setSelectedEdgeId("");
    setDrawerView("node");
    setDrawerOpen(true);
  }, [asset?.fqn, context, graph?.nodes?.length, graph?.edges?.length]);

  return (
    <section className="gh-lineage-shell">
      <header className="gh-panel gh-lineage-header gh-lineage-topbar">
        <div className="gh-lineage-header-main">
          <div className="gh-panel-title">Lineage</div>
          <h2 className="gh-workspace-title">{asset.name}</h2>
          <div className="gh-entity-context">
            {asset.catalog} / {asset.schema}
          </div>
        </div>

        <div className="gh-lineage-header-actions">
          <span className="gh-chip gh-chip-soft">
            {summary.nodes || 0} nodes / {summary.edges || 0} edges
          </span>
          <button className="gh-secondary-button" onClick={() => onOpenAsset(asset.fqn)} type="button">
            Open asset
          </button>
        </div>
      </header>

      <section className="gh-panel gh-lineage-graph-panel gh-lineage-graph-stage">
        <div className="gh-lineage-stage-topbar">
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
          <div className="gh-lineage-graph-badges">
            <button
              className="gh-secondary-button"
              onClick={() => {
                setDrawerView("refocus");
                setDrawerOpen(true);
              }}
              type="button"
            >
              Refocus
            </button>
            <button
              className="gh-secondary-button"
              onClick={() => setDrawerOpen((open) => !open)}
              type="button"
            >
              {drawerOpen ? "Hide drawer" : "Show drawer"}
            </button>
            <span className="gh-chip gh-chip-soft">Upstream {loading ? "…" : summary.upstream}</span>
            <span className="gh-chip gh-chip-soft">Downstream {loading ? "…" : summary.downstream}</span>
          </div>
        </div>
        <div className="gh-lineage-lane-labels" aria-hidden="true">
          <span>Upstream</span>
          <span>Focus</span>
          <span>Downstream</span>
        </div>
        <div className="gh-lineage-stage-canvas">
          {loading ? (
            <div className="gh-empty-state">Loading lineage graph…</div>
          ) : error ? (
            <div className="gh-empty-state">{error}</div>
          ) : graph ? (
            <LineageGraph
              graph={graph}
              onSelectEdge={(edgeId) => {
                setSelectedEdgeId(edgeId);
                if (edgeId) {
                  setDrawerView("node");
                  setDrawerOpen(true);
                }
              }}
              onSelectNode={(nodeId) => {
                setSelectedEdgeId("");
                setSelectedNodeId(nodeId);
                setDrawerView("node");
                setDrawerOpen(true);
              }}
              selectedEdgeId={selectedEdgeId}
              selectedNodeId={selectedNode?.id || ""}
            />
          ) : (
            <div className="gh-empty-state">No lineage is available for this asset yet.</div>
          )}
          <aside className={`gh-lineage-drawer ${drawerOpen ? "is-open" : ""}`}>
            <div className="gh-lineage-drawer-head">
              <div className="gh-panel-title">Graph drawer</div>
              <div className="gh-segment-row">
                <button
                  className={`gh-segment-button ${drawerView === "node" ? "is-active" : ""}`}
                  onClick={() => setDrawerView("node")}
                  type="button"
                >
                  Selected node
                </button>
                <button
                  className={`gh-segment-button ${drawerView === "refocus" ? "is-active" : ""}`}
                  onClick={() => setDrawerView("refocus")}
                  type="button"
                >
                  Refocus
                </button>
              </div>
            </div>

            {drawerView === "refocus" ? (
              <div className="gh-detail-section">
                <div className="gh-filter-title">Refocus graph</div>
                <input
                  className="gh-input"
                  onChange={(event) => onAssetSearchQueryChange(event.target.value)}
                  placeholder={asset?.name ? `Search from ${asset.name}` : "Search for an asset"}
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
                    <div className="gh-lineage-search-empty">
                      {assetSearchQuery ? "No matching assets." : "Start typing to refocus the graph."}
                    </div>
                  )}
                </div>
              </div>
            ) : selectedEdge ? (
              <>
                <h2>Relationship</h2>
                <div className="gh-support-copy">
                  {selectedEdge.source} → {selectedEdge.target}
                </div>
                <div className="gh-chip-stack">
                  <span className="gh-chip">Lineage edge</span>
                  <span className="gh-chip gh-chip-soft">Depth {selectedEdge.depth || 1}</span>
                </div>
                <div className="gh-detail-section">
                  <div className="gh-support-copy">
                    This connection shows how the selected upstream node flows into the downstream node in the current graph.
                  </div>
                </div>
              </>
            ) : selectedNode ? (
              <>
                <h2>{selectedNode.label}</h2>
                <div className="gh-support-copy">{selectedNode.subtitle}</div>
                <div className="gh-chip-stack">
                  <span className="gh-chip">{selectedNode.kind}</span>
                  <span className="gh-chip">{selectedNode.kicker || selectedNode.role}</span>
                </div>
                <div className="gh-detail-section">
                  <div className="gh-support-copy">
                    {selectedNode.role === "focus"
                      ? "This node is the active asset anchoring the graph."
                      : selectedNode.role === "source"
                        ? "This node contributes data or execution context into the focus asset."
                        : "This node consumes or depends on the focus asset."}
                  </div>
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
    </section>
  );
}
