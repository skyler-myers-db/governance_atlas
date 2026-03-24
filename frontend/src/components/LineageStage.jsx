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
  assetSearchResolvedQuery,
  assetSearchLoading,
  onOpenFullGraph,
  embedded = false,
  allowRefocus = true,
}) {
  const graph = selectGraph(graphBundle, context);
  const hasGraph = Boolean(graph?.nodes?.length);
  const hasEdges = Boolean(graph?.edges?.length);
  const showTopbar = embedded;

  return (
    <section className={`gh-lineage-stage-shell ${embedded ? "is-embedded" : "is-full"}`}>
      <section className="gh-lineage-graph-panel gh-lineage-graph-stage">
        {showTopbar ? (
          <div className="gh-lineage-stage-topbar">
            <div className="gh-lineage-stage-topbar-main">
              <div className="gh-lineage-headbar-title">{asset.name}</div>
              <div className="gh-lineage-headbar-meta">
                <span>{asset.catalog} / {asset.schema}</span>
                <span>{context}</span>
              </div>
            </div>
            <div className="gh-lineage-stage-topbar-actions">
              {onOpenFullGraph ? (
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
          ) : hasGraph ? (
            <LineageGraph
              asset={asset}
              assetSearchLoading={assetSearchLoading}
              assetSearchQuery={assetSearchQuery}
              assetSearchResults={assetSearchResults}
              assetSearchResolvedQuery={assetSearchResolvedQuery}
              allowRefocus={allowRefocus}
              context={context}
              graph={graph}
              hasEdges={hasEdges}
              onAssetSearchQueryChange={onAssetSearchQueryChange}
              onContextChange={onContextChange}
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
