import { assetPathLabel, displayObjectType } from "../lib/assetPresentation";
import LineageGraph from "./LineageGraph";

function selectGraph(graphBundle, context) {
  if (!graphBundle) return null;
  return context === "Operational Context" ? graphBundle.operational : graphBundle.data;
}

export default function LineageStage({
  asset,
  graphBundle,
  lineagePayload = null,
  loading,
  error,
  overlay = null,
  context,
  onContextChange,
  onOpenGovernance,
  onSelectAsset,
  onOpenAsset,
  assetSearchQuery,
  onAssetSearchQueryChange,
  assetSearchResults,
  assetSearchResolvedQuery,
  assetSearchLoading,
  onOpenFullGraph,
  embedded = false,
  allowRefocus = true,
}) {
  const graph = selectGraph(graphBundle, context);
  const stats = lineagePayload?.stats || {};
  const hasGraph = Boolean(graph?.nodes?.length);
  const hasEdges = Boolean(graph?.edges?.length);
  const showTopbar = Boolean(asset);
  const emptyGraph = { nodes: [], edges: [] };

  return (
    <section className={`gh-lineage-stage-shell ${embedded ? "is-embedded" : "is-full"}`}>
      <section className="gh-lineage-graph-panel gh-lineage-graph-stage">
        {showTopbar ? (
          <div className="gh-lineage-stage-topbar">
            <div className="gh-lineage-stage-topbar-main">
              <div className="gh-panel-title">{context}</div>
              <div className="gh-lineage-headbar-title">{asset.name}</div>
              <div className="gh-lineage-headbar-meta">
                <span>{assetPathLabel(asset)}</span>
                {displayObjectType(asset) ? <span>{displayObjectType(asset)}</span> : null}
                {context === "Data Lineage" ? (
                  <>
                    <span>{stats.upstreamCount || 0} upstream</span>
                    <span>{stats.downstreamCount || 0} downstream</span>
                  </>
                ) : (
                  <>
                    <span>{stats.operationalProducerCount || 0} producers</span>
                    <span>{stats.operationalConsumerCount || 0} consumers</span>
                  </>
                )}
              </div>
            </div>
            <div className="gh-lineage-stage-topbar-actions">
              <div className="gh-segment-row gh-lineage-context-switch">
                {["Data Lineage", "Operational Context"].map((option) => (
                  <button
                    className={`gh-segment-button ${context === option ? "is-active" : ""}`}
                    key={option}
                    onClick={() => onContextChange?.(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              {embedded && onOpenFullGraph ? (
                <button className="gh-secondary-button" onClick={() => onOpenFullGraph(context)} type="button">
                  Open full graph
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="gh-lineage-stage-canvas">
          {loading ? (
            <div className="gh-empty-state">Loading lineage graph…</div>
          ) : error ? (
            <div className="gh-empty-state">{error}</div>
          ) : hasGraph || overlay ? (
            <LineageGraph
              asset={asset}
              assetSearchLoading={assetSearchLoading}
              assetSearchQuery={assetSearchQuery}
              assetSearchResults={assetSearchResults}
              assetSearchResolvedQuery={assetSearchResolvedQuery}
              allowRefocus={allowRefocus}
              context={context}
              lineagePayload={lineagePayload}
              graph={graph || emptyGraph}
              hasEdges={hasEdges}
              onAssetSearchQueryChange={onAssetSearchQueryChange}
              onContextChange={onContextChange}
              onOpenAsset={onOpenAsset}
              onOpenGovernance={onOpenGovernance}
              overlay={overlay}
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
