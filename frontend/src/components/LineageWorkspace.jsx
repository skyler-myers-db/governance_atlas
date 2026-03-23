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
  onRouteStateChange,
  onOpenGovernance,
  onOpenAsset,
}) {
  const [focusAssetFqn, setFocusAssetFqn] = useState(initialAssetFqn || "");
  const [localContext, setLocalContext] = useState(initialContext || "Data Lineage");
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const seeded = useSeededAssetContext(focusAssetFqn, bootstrap, bootstrap?.assets || []);
  const assetDetail = useAssetDetail(focusAssetFqn || "");
  const lineage = useLineage(focusAssetFqn || "", seeded.seededGraph);
  const asset = assetDetail.detail || seeded.summary;
  const assetSearch = useAssetSearch(assetSearchQuery, true);
  const launchAssets = (bootstrap?.assets || []).slice(0, 6);

  useEffect(() => {
    setAssetSearchQuery("");
  }, [focusAssetFqn]);

  useEffect(() => {
    if (initialAssetFqn && initialAssetFqn !== focusAssetFqn) {
      setFocusAssetFqn(initialAssetFqn);
    }
  }, [initialAssetFqn]);

  useEffect(() => {
    if (initialContext && initialContext !== localContext) {
      setLocalContext(initialContext);
    }
  }, [initialContext]);

  if (!focusAssetFqn) {
    return (
      <section className="gh-lineage-shell">
        <section className="gh-lineage-graph-panel gh-lineage-graph-stage gh-lineage-empty-stage">
          <div className="gh-lineage-stage-overlay gh-lineage-stage-overlay-main">
            <div className="gh-chip-row">
              <span className="gh-chip gh-chip-soft">{localContext}</span>
            </div>
            <div className="gh-lineage-headbar-title">Choose an asset to explore its graph.</div>
          </div>
          <div className="gh-lineage-stage-canvas">
            <div className="gh-lineage-empty-search">
              <input
                className="gh-input"
                onChange={(event) => setAssetSearchQuery(event.target.value)}
                placeholder="Search for an asset"
                value={assetSearchQuery}
              />
              {launchAssets.length ? (
                <div className="gh-chip-stack">
                  {launchAssets.map((candidate) => (
                    <button
                      className="gh-filter-chip gh-chip-soft"
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
                      {candidate.name}
                    </button>
                  ))}
                </div>
              ) : null}
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
