import LineageStage from "./LineageStage";
import { useEffect, useState } from "react";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useLineage } from "../hooks/useLineage";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { consumeWorkspaceIntent } from "../lib/workspaceIntent";

const LINEAGE_CONTEXT_SESSION_KEY = "gh.lineage.context.v1";

function lineageContextSessionKey(assetFqn) {
  if (typeof window === "undefined") return `${LINEAGE_CONTEXT_SESSION_KEY}:${assetFqn || "none"}`;
  return `${LINEAGE_CONTEXT_SESSION_KEY}:${window.location.pathname}:${assetFqn || "none"}`;
}

function readLineageContext(assetFqn, fallback = "Data Lineage") {
  if (typeof window === "undefined") return fallback;
  try {
    return window.sessionStorage.getItem(lineageContextSessionKey(assetFqn)) || fallback;
  } catch {
    return fallback;
  }
}

export default function LineageWorkspace({
  initialAssetFqn,
  bootstrap,
  onRouteAssetChange,
  onOpenGovernance,
  onOpenAsset,
}) {
  const [focusAssetFqn, setFocusAssetFqn] = useState(initialAssetFqn || "");
  const [localContext, setLocalContext] = useState(() =>
    readLineageContext(
      initialAssetFqn || "",
      consumeWorkspaceIntent("lineageContext", initialAssetFqn || "", "Data Lineage"),
    )
  );
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const seeded = useSeededAssetContext(focusAssetFqn, bootstrap, bootstrap?.assets || []);
  const assetDetail = useAssetDetail(focusAssetFqn || "");
  const lineage = useLineage(focusAssetFqn || "", seeded.seededGraph);
  const asset = assetDetail.detail || seeded.summary;
  const assetSearch = useAssetSearch(assetSearchQuery, assetSearchQuery.trim().length >= 2);
  const searchReady =
    !assetSearch.loading && assetSearch.resolvedQuery === assetSearchQuery.trim();
  const hasGraph = Boolean(lineage.graph?.nodes?.length);

  useEffect(() => {
    setAssetSearchQuery("");
  }, [focusAssetFqn]);

  useEffect(() => {
    const nextAssetFqn = initialAssetFqn || "";
    setFocusAssetFqn(nextAssetFqn);
  }, [initialAssetFqn]);

  useEffect(() => {
    const restoredContext = readLineageContext(
      initialAssetFqn || "",
      consumeWorkspaceIntent("lineageContext", initialAssetFqn || "", "Data Lineage"),
    );
    setLocalContext(restoredContext);
  }, [initialAssetFqn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(lineageContextSessionKey(focusAssetFqn), localContext);
    } catch {
      // best-effort only
    }
  }, [focusAssetFqn, localContext]);

  const searchOverlay = (
    <div className="gh-lineage-overlay-card">
      <div className="gh-panel-title">{localContext}</div>
      <div className="gh-support-copy">
        {focusAssetFqn
          ? assetDetail.error || "The selected asset cannot be inspected with the current permissions."
          : "Search for an asset and open the graph directly from there."}
      </div>
      <div className="gh-lineage-launch-search">
        <input
          className="gh-input"
          onChange={(event) => setAssetSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && searchReady && assetSearch.assets[0]) {
              event.preventDefault();
              setFocusAssetFqn(assetSearch.assets[0].fqn);
              onRouteAssetChange?.(assetSearch.assets[0].fqn, localContext);
            }
          }}
          placeholder={focusAssetFqn ? "Search for another asset" : "Search for an asset"}
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
                  onRouteAssetChange?.(candidate.fqn, localContext);
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
              {assetSearchQuery
                ? "No matching assets."
                : focusAssetFqn
                  ? "Pick another asset to continue."
                  : "Start typing to load a graph."}
            </div>
          )}
        </div>
      </div>
      {focusAssetFqn ? (
        <div className="gh-action-grid">
          <button
            className="gh-secondary-button"
            onClick={() => {
              setFocusAssetFqn("");
              setAssetSearchQuery("");
              onRouteAssetChange?.("");
            }}
            type="button"
          >
            Clear focus
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="gh-lineage-shell">
      <LineageStage
        asset={asset}
        assetSearchLoading={assetSearch.loading}
        assetSearchQuery={assetSearchQuery}
        assetSearchResults={assetSearch.assets}
        assetSearchResolvedQuery={assetSearch.resolvedQuery}
        context={localContext}
        embedded={false}
        error={lineage.error}
        graphBundle={lineage.graph}
        loading={lineage.loading}
        overlay={!focusAssetFqn && !hasGraph ? searchOverlay : null}
        onAssetSearchQueryChange={setAssetSearchQuery}
        onContextChange={(nextContext) => {
          setLocalContext(nextContext);
        }}
        onOpenAsset={onOpenAsset}
        onOpenGovernance={onOpenGovernance}
        onSelectAsset={(assetFqn) => {
          setFocusAssetFqn(assetFqn);
          onRouteAssetChange?.(assetFqn, localContext);
        }}
      />
    </section>
  );
}
