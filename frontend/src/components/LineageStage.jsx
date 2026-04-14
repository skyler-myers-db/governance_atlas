import { assetPathLabel, displayObjectType } from "../lib/assetPresentation";
import LineageGraph from "./LineageGraph";

function selectGraph(graphBundle, context) {
  if (!graphBundle) return null;
  return context === "Operational Context" ? graphBundle.operational : graphBundle.data;
}

function fallbackStats(graphBundle, context) {
  const graph = selectGraph(graphBundle, context);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const focusId =
    nodes.find((node) => node?.role === "focus")?.id ||
    nodes.find((node) => node?.assetFqn)?.id ||
    "";

  if (!focusId) {
    return {
      upstreamCount: 0,
      downstreamCount: 0,
      operationalProducerCount: 0,
      operationalConsumerCount: 0,
    };
  }

  if (context === "Operational Context") {
    return {
      upstreamCount: 0,
      downstreamCount: 0,
      operationalProducerCount: edges.filter((edge) => edge.target === focusId).length,
      operationalConsumerCount: edges.filter((edge) => edge.source === focusId).length,
    };
  }

  return {
    upstreamCount: edges.filter((edge) => edge.target === focusId).length,
    downstreamCount: edges.filter((edge) => edge.source === focusId).length,
    operationalProducerCount: 0,
    operationalConsumerCount: 0,
  };
}

export default function LineageStage({
  asset,
  graphBundle,
  lineagePayload = null,
  loading,
  error,
  notice = "",
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
  const stats = {
    ...fallbackStats(graphBundle, context),
    ...(lineagePayload?.stats || {}),
  };
  const limits = stats?.limits || {};
  const truncated = stats?.truncated || {};
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
                {stats.generatedAt ? <span>{stats.generatedAt}</span> : null}
                {context === "Data Lineage" && (truncated.upstream || truncated.downstream || truncated.columnLineage) ? (
                  <span>
                    Limited to {limits.tableLineage || "?"} table edges and {limits.columnLineage || "?"} column mappings
                  </span>
                ) : null}
                {context === "Operational Context" && (truncated.operationalProducers || truncated.operationalConsumers) ? (
                  <span>Limited to {limits.operationalContext || "?"} operational records per direction</span>
                ) : null}
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
                  Open Full Graph
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {notice ? (
          <div className="gh-inline-alert tone-warn">
            <div>{notice}</div>
          </div>
        ) : null}
        <div className="gh-lineage-stage-canvas">
        {loading && !hasGraph ? (
          <div className="gh-empty-state">Loading lineage graph…</div>
          ) : hasGraph || overlay ? (
            <>
              {error ? (
                <div className="gh-inline-alert tone-warn gh-lineage-inline-warning">
                  <div className="gh-inline-alert-title">Lineage refresh degraded</div>
                  <div>{error}</div>
                </div>
              ) : null}
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
            </>
          ) : error ? (
            <div className="gh-empty-state">{error}</div>
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
