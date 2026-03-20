import { useState } from "react";
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
}) {
  const graph = selectGraph(graphBundle, context);
  const [selectedNodeId, setSelectedNodeId] = useState("focus");
  const nodes = graph?.nodes || [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;

  return (
    <section className="gh-lineage-workspace">
      <div className="gh-lineage-toolbar gh-panel">
        <div>
          <div className="gh-panel-title">Lineage Workspace</div>
          <div className="gh-support-copy">
            Trace upstream and downstream dependencies around the selected asset.
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
                <button
                  className="gh-primary-button"
                  onClick={() => onSelectAsset(selectedNode.assetFqn)}
                  type="button"
                >
                  Open Related Asset
                </button>
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
