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

export default function LineageStage({
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
  onOpenFullGraph,
  embedded = false,
  allowRefocus = true,
}) {
  const graph = selectGraph(graphBundle, context);
  const summary = useMemo(() => graphSummary(graph), [graph]);
  const [selectedNodeId, setSelectedNodeId] = useState("focus");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refocusOpen, setRefocusOpen] = useState(false);
  const nodes = graph?.nodes || [];
  const focusNode = nodes.find((node) => node.role === "focus") || nodes[0] || null;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || focusNode || null;
  const selectedEdge =
    (graph?.edges || []).find(
      (edge, index) => `${edge.source}-${edge.target}-${index}` === selectedEdgeId
    ) || null;

  useEffect(() => {
    setSelectedNodeId("focus");
    setSelectedEdgeId("");
    setDrawerOpen(false);
    setRefocusOpen(false);
    onAssetSearchQueryChange?.("");
  }, [asset?.fqn, context, graph?.nodes?.length, graph?.edges?.length]);

  return (
    <section className={`gh-lineage-stage-shell ${embedded ? "is-embedded" : "is-full"}`}>
      <div className="gh-lineage-toolbar">
        <div className="gh-lineage-toolbar-main">
          <div className="gh-panel-title">{embedded ? "Lineage" : "Graph"}</div>
          <div className="gh-lineage-toolbar-title-row">
            <div className="gh-lineage-toolbar-identity">
              <h3 className="gh-section-title">{asset.name}</h3>
              <div className="gh-lineage-toolbar-meta">
                <span>
                  {asset.catalog} / {asset.schema}
                </span>
                <span>{summary.upstream} upstream</span>
                <span>{summary.downstream} downstream</span>
                <span>{summary.edges} edges</span>
              </div>
            </div>
          </div>
        </div>

        <div className="gh-lineage-toolbar-actions">
          <div className="gh-lineage-toolbar-row">
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
            {allowRefocus ? (
              <div className="gh-lineage-command">
                <button
                  className={`gh-secondary-button ${refocusOpen ? "is-active" : ""}`}
                  onClick={() => {
                    setRefocusOpen((open) => {
                      if (open) {
                        onAssetSearchQueryChange?.("");
                      }
                      return !open;
                    });
                  }}
                  type="button"
                >
                  Refocus
                </button>
                {refocusOpen ? (
                  <div className="gh-lineage-command-popover">
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
                            onClick={() => {
                              setRefocusOpen(false);
                              onAssetSearchQueryChange?.("");
                              onSelectAsset(candidate.fqn);
                            }}
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
                ) : null}
              </div>
            ) : null}
            {embedded && onOpenFullGraph ? (
              <button className="gh-secondary-button" onClick={() => onOpenFullGraph(context)} type="button">
                Expand
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <section className="gh-panel gh-lineage-graph-panel gh-lineage-graph-stage">
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
                  setDrawerOpen(true);
                }
              }}
              onSelectNode={(nodeId) => {
                setSelectedEdgeId("");
                setSelectedNodeId(nodeId);
                setDrawerOpen(true);
              }}
              onPaneClear={() => {
                setSelectedEdgeId("");
                setSelectedNodeId("focus");
                setDrawerOpen(false);
              }}
              selectedEdgeId={selectedEdgeId}
              selectedNodeId={selectedNode?.id || ""}
            />
          ) : (
            <div className="gh-empty-state">No lineage is available for this asset yet.</div>
          )}

          <aside className={`gh-lineage-drawer ${drawerOpen ? "is-open" : ""}`}>
            <div className="gh-lineage-drawer-head">
              <div className="gh-panel-title">{selectedEdge ? "Relationship" : "Selected node"}</div>
              <button className="gh-secondary-button" onClick={() => setDrawerOpen(false)} type="button">
                Close
              </button>
            </div>

            {selectedEdge ? (
              <>
                <h2>
                  {selectedEdge.source} → {selectedEdge.target}
                </h2>
                <div className="gh-chip-stack">
                  <span className="gh-chip">Lineage edge</span>
                  <span className="gh-chip gh-chip-soft">Depth {selectedEdge.depth || 1}</span>
                </div>
                <div className="gh-support-copy">
                  This connection shows how the selected upstream node flows into the downstream node in the current graph.
                </div>
              </>
            ) : selectedNode ? (
              <>
                <h2>{selectedNode.label}</h2>
                <div className="gh-support-copy">{selectedNode.subtitle}</div>
                <div className="gh-chip-stack">
                  <span className="gh-chip">{selectedNode.kind}</span>
                  <span className="gh-chip gh-chip-soft">{selectedNode.kicker || selectedNode.role}</span>
                </div>
                <div className="gh-detail-section">
                  <div className="gh-support-copy">
                    {selectedNode.role === "focus"
                      ? "This is the asset anchoring the current graph."
                      : selectedNode.role === "source"
                        ? "This node contributes data or execution context into the focused asset."
                        : "This node consumes or depends on the focused asset."}
                  </div>
                </div>
                {selectedNode.assetFqn ? (
                  <div className="gh-action-grid">
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
              <div className="gh-empty-state">Select a node or edge to inspect the graph.</div>
            )}
          </aside>
        </div>
      </section>
    </section>
  );
}
