import { useState } from "react";
import LineageGraph from "./LineageGraph";

function selectGraph(graphBundle, context) {
  if (!graphBundle) return null;
  return context === "Operational Context" ? graphBundle.operational : graphBundle.data;
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
  const hasGraph = Boolean(graph?.nodes?.length);
  const hasEdges = Boolean(graph?.edges?.length);
  const [refocusOpen, setRefocusOpen] = useState(false);

  return (
    <section className={`gh-lineage-stage-shell ${embedded ? "is-embedded" : "is-full"}`}>
      <section className="gh-lineage-graph-panel gh-lineage-graph-stage">
        <div className="gh-lineage-stage-overlay gh-lineage-stage-overlay-main">
          <span className="gh-chip gh-chip-soft">{context}</span>
          <div className="gh-lineage-headbar-title">{asset.name}</div>
          <div className="gh-lineage-headbar-meta">
            <span>{asset.catalog} / {asset.schema}</span>
            <span>{asset.objectType}</span>
          </div>
        </div>

        <div className="gh-lineage-stage-overlay gh-lineage-stage-overlay-actions">
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
              Open full graph
            </button>
          ) : null}
        </div>
        <div className="gh-lineage-stage-canvas">
          {loading ? (
            <div className="gh-empty-state">Loading lineage graph…</div>
          ) : error ? (
            <div className="gh-empty-state">{error}</div>
          ) : hasGraph ? (
            <LineageGraph
              asset={asset}
              context={context}
              graph={graph}
              hasEdges={hasEdges}
              onOpenAsset={onOpenAsset}
              onOpenGovernance={onOpenGovernance}
              onSelectAsset={onSelectAsset}
            />
          ) : (
            <div className="gh-empty-state">
              {context === "Operational Context"
                ? "No operational entities are currently connected to this asset."
                : "No connected lineage edges are available for this asset yet."}
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
