import { useEffect, useState } from "react";
import LineageGraph from "./LineageGraph";

function selectGraph(graphBundle, context) {
  if (!graphBundle) return null;
  return context === "Operational Context" ? graphBundle.operational : graphBundle.data;
}

export default function LineageWorkspace({
  asset,
  graphBundle,
  loading,
  error,
  context,
  onContextChange,
  onSelectAsset,
  onOpenAsset,
  assetSearchQuery,
  onAssetSearchQueryChange,
  assetSearchResults,
  assetSearchLoading,
}) {
  const graph = selectGraph(graphBundle, context);
  const [selectedNodeId, setSelectedNodeId] = useState("focus");
  const nodes = graph?.nodes || [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;

  useEffect(() => {
    setSelectedNodeId("focus");
  }, [asset?.fqn, context, graph?.nodes?.length, graph?.edges?.length]);

  return (
    <section className="gh-lineage-workspace">
      <div className="gh-lineage-toolbar gh-panel">
        <div className="gh-lineage-toolbar-copy">
          <div className="gh-panel-title">Lineage Workspace</div>
          <div className="gh-support-copy">
            Trace dependencies around the selected asset without leaving the graph workflow.
          </div>
        </div>
        <div className="gh-lineage-toolbar-controls">
          <div className="gh-lineage-asset-picker">
            <label className="gh-filter-title" htmlFor="gh-lineage-asset-search">
              Focus Asset
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
          <div className="gh-panel-title">Selected Node</div>
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
                    Open asset page
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="gh-empty-state">Select a node to inspect its metadata.</div>
          )}

          <div className="gh-detail-section">
            <div className="gh-panel-title">Focus Asset</div>
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
