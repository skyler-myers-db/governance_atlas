import { assetPathLabel, displayObjectType } from "../lib/assetPresentation";
import { SurfaceHeader, SurfaceTabs } from "./ShellLayoutPrimitives";
import LineageGraph from "./LineageGraph";
import { EmptyStateBlock, InlineStatusBanner } from "./ShellStatePrimitives";

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
  authoritative = true,
  provisional = false,
  context,
  linkedRecordUnavailableOverrides = {},
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
          <SurfaceHeader
            className="gh-lineage-stage-topbar"
            eyebrow={context}
            identity={assetPathLabel(asset)}
            meta={[
              displayObjectType(asset) || null,
              context === "Data Lineage"
                ? `${stats.upstreamCount || 0} upstream`
                : `${stats.operationalProducerCount || 0} producers`,
              context === "Data Lineage"
                ? `${stats.downstreamCount || 0} downstream`
                : `${stats.operationalConsumerCount || 0} consumers`,
              stats.generatedAt || null,
              context === "Data Lineage" && (truncated.upstream || truncated.downstream || truncated.columnLineage)
                ? `Limited to ${limits.tableLineage || "?"} table edges. Column lineage may be partial or unavailable in this workspace.`
                : null,
              context === "Operational Context" && (truncated.operationalProducers || truncated.operationalConsumers)
                ? `Limited to ${limits.operationalContext || "?"} operational records per direction`
                : null,
            ]}
            title={asset.name}
            actions={(
              <div className="gh-lineage-stage-topbar-actions">
                <SurfaceTabs
                  activeKey={context}
                  ariaLabel="Lineage context"
                  className="gh-lineage-context-switch"
                  items={["Data Lineage", "Operational Context"].map((option) => ({
                    key: option,
                    label: option,
                  }))}
                  onChange={(nextContext) => onContextChange?.(nextContext)}
                  variant="segment"
                />
                {embedded && onOpenFullGraph ? (
                  <button className="gh-secondary-button" onClick={() => onOpenFullGraph(context)} type="button">
                    Open Full Graph
                  </button>
                ) : null}
              </div>
            )}
          />
        ) : null}
        {notice ? <InlineStatusBanner message={notice} title="Navigation limited" /> : null}
        {provisional ? (
          <InlineStatusBanner
            className="gh-lineage-inline-warning"
            message={
              authoritative
                ? "Showing cached live lineage while the graph refresh completes."
                : "Showing provisional lineage context until the authoritative graph resolves."
            }
            title="Live lineage still loading"
          />
        ) : null}
        <div className="gh-lineage-stage-canvas">
          {loading && !hasGraph ? (
            <EmptyStateBlock message="Loading lineage graph…" title="Refreshing graph" />
          ) : hasGraph || overlay ? (
            <>
              {error ? (
                <InlineStatusBanner className="gh-lineage-inline-warning" message={error} title="Lineage refresh degraded" />
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
                linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
                onAssetSearchQueryChange={onAssetSearchQueryChange}
                onContextChange={onContextChange}
                onOpenAsset={onOpenAsset}
                onOpenGovernance={onOpenGovernance}
                overlay={overlay}
                onSelectAsset={onSelectAsset}
              />
            </>
          ) : error ? (
            <EmptyStateBlock message={error} title="Lineage unavailable" />
          ) : (
            <EmptyStateBlock
              message={
                context === "Operational Context"
                  ? "No operational entities are currently connected to this asset."
                  : "No connected lineage edges are available for this asset yet."
              }
              title={context === "Operational Context" ? "No operational context" : "No connected lineage"}
            />
          )}
        </div>
      </section>
    </section>
  );
}
