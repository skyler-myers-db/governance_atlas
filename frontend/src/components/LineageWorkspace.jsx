import LineageStage from "./LineageStage";
import { useEffect, useState } from "react";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useLineage } from "../hooks/useLineage";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";

export default function LineageWorkspace({
  initialAssetFqn,
  initialContext,
  bootstrap,
  discoveryAssets,
  onRouteStateChange,
  onOpenGovernance,
  onOpenAsset,
}) {
  const [focusAssetFqn, setFocusAssetFqn] = useState(initialAssetFqn || "");
  const [localContext, setLocalContext] = useState(initialContext || "Data Lineage");
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const seeded = useSeededAssetContext(focusAssetFqn, bootstrap, discoveryAssets);
  const assetDetail = useAssetDetail(focusAssetFqn || "");
  const lineage = useLineage(focusAssetFqn || "", seeded.seededGraph);
  const asset = assetDetail.detail || seeded.summary;
  const assetSearch = useAssetSearch(assetSearchQuery, true);

  useEffect(() => {
    setAssetSearchQuery("");
  }, [focusAssetFqn]);

  useEffect(() => {
    setFocusAssetFqn(initialAssetFqn || "");
  }, [initialAssetFqn]);

  useEffect(() => {
    setLocalContext(initialContext || "Data Lineage");
  }, [initialContext]);

  if (!focusAssetFqn) {
    return (
      <section className="gh-lineage-shell">
        <section className="gh-panel gh-unavailable-panel gh-lineage-empty-shell">
          <div className="gh-panel-title">Lineage workspace</div>
          <h2>Choose an asset to explore its graph.</h2>
          <div className="gh-support-copy">
            Search for an asset to open a dedicated lineage canvas with data and operational context.
          </div>
          <div className="gh-lineage-empty-search">
            <input
              className="gh-input"
              onChange={(event) => setAssetSearchQuery(event.target.value)}
              placeholder="Search for an asset"
              value={assetSearchQuery}
            />
            <div className="gh-lineage-search-list">
              {assetSearch.loading ? (
                <div className="gh-lineage-search-empty">Searching assets…</div>
              ) : assetSearch.assets.length ? (
                assetSearch.assets.map((candidate) => (
                  <button
                    className="gh-lineage-search-row"
                    key={candidate.fqn}
                    onClick={() => {
                      setFocusAssetFqn(candidate.fqn);
                      onRouteStateChange?.({
                        assetFqn: candidate.fqn,
                        context: localContext,
                      });
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
                  {assetSearchQuery ? "No matching assets." : "Start typing to load a graph."}
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="gh-lineage-shell">
      <LineageStage
        asset={asset}
        assetSearchLoading={assetSearch.loading}
        assetSearchQuery={assetSearchQuery}
        assetSearchResults={assetSearch.assets}
        context={localContext}
        embedded={false}
        error={lineage.error}
        graphBundle={lineage.graph}
        loading={lineage.loading}
        onAssetSearchQueryChange={setAssetSearchQuery}
        onContextChange={(nextContext) => {
          setLocalContext(nextContext);
          onRouteStateChange?.({
            assetFqn: focusAssetFqn,
            context: nextContext,
          });
        }}
        onOpenAsset={onOpenAsset}
        onOpenGovernance={onOpenGovernance}
        onSelectAsset={(assetFqn) => {
          setFocusAssetFqn(assetFqn);
          onRouteStateChange?.({
            assetFqn,
            context: localContext,
          });
        }}
      />
    </section>
  );
}
