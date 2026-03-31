import LineageStage from "./LineageStage";
import { useEffect, useState } from "react";
import {
  canOpenLinkedAssetRecord,
  prefetchAssetAvailability,
  prefetchAssetDetail,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useLineage } from "../hooks/useLineage";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { assetPathLabel } from "../lib/assetPresentation";
import { consumeWorkspaceIntent, peekWorkspaceIntent, setWorkspaceIntent } from "../lib/workspaceIntent";

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
  contextSeedAssets = [],
  onNavigationStateChange,
  onSurfaceReady,
  sharedVisibleAssetSet,
  onRouteAssetChange,
  onOpenGovernance,
  onOpenAsset,
}) {
  const [focusAssetFqn, setFocusAssetFqn] = useState(initialAssetFqn || "");
  const [localContext, setLocalContext] = useState(() =>
    readLineageContext(
      initialAssetFqn || "",
      peekWorkspaceIntent("lineageContext", initialAssetFqn || "", "Data Lineage"),
    )
  );
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [linkFeedback, setLinkFeedback] = useState("");
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const seeded = useSeededAssetContext(focusAssetFqn, bootstrap, seedAssets, {
    allowFallback: false,
  });
  const visibleAssetSet =
    sharedVisibleAssetSet?.size
      ? new Set(sharedVisibleAssetSet)
      : new Set(seedAssets.map((asset) => asset?.fqn).filter(Boolean));
  const assetDetail = useAssetDetail(focusAssetFqn || "", { sections: ["header"] });
  const lineage = useLineage(focusAssetFqn || "", seeded.seededGraph);
  const asset = assetDetail.detail || seeded.summary;
  const assetSearch = useAssetSearch(
    assetSearchQuery,
    assetSearchQuery.trim().length >= 2,
    seedAssets,
  );
  const searchReady =
    !assetSearch.loading && assetSearch.resolvedQuery === assetSearchQuery.trim();
  const hasGraph = Boolean(lineage.graph?.nodes?.length);

  useEffect(() => {
    setAssetSearchQuery("");
  }, [focusAssetFqn]);

  useEffect(() => {
    setLinkFeedback("");
  }, [focusAssetFqn, localContext]);

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

  useEffect(() => {
    if (!focusAssetFqn) {
      onSurfaceReady?.();
      return;
    }
    if (!lineage.loading && (!assetDetail.loading || assetDetail.detail?.fqn === focusAssetFqn)) {
      onSurfaceReady?.();
    }
  }, [
    assetDetail.detail?.fqn,
    assetDetail.loading,
    focusAssetFqn,
    lineage.loading,
    onSurfaceReady,
  ]);

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
              onNavigationStateChange?.(true, "Loading lineage asset…");
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
                  onNavigationStateChange?.(true, "Loading lineage asset…");
                  setFocusAssetFqn(candidate.fqn);
                  onRouteAssetChange?.(candidate.fqn, localContext);
                }}
                type="button"
              >
                <span>{candidate.name}</span>
                <span>{assetPathLabel(candidate)}</span>
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
              onRouteAssetChange?.("", localContext);
            }}
            type="button"
          >
            Clear focus
          </button>
        </div>
      ) : null}
    </div>
  );

  const openLineageAsset = async (assetFqn, nextTab = "Overview") => {
    if (!assetFqn) return;
    onNavigationStateChange?.(true, "Opening metadata record…");
    try {
      const availabilityPromise = prefetchAssetAvailability([assetFqn], { force: true });
      const detailPromise = prefetchAssetDetail(assetFqn, { force: true, sections: ["header", "activity"] });
      const availability = (await availabilityPromise)?.[assetFqn] || null;
      const detail = await detailPromise;
      if (!canOpenLinkedAssetRecord(detail, availability)) {
        onNavigationStateChange?.(false, "");
        setLinkFeedback(
          "That linked asset is visible in lineage, but the live record is not openable with the current permissions.",
        );
        return;
      }
      setLinkFeedback("");
      setWorkspaceIntent("lineageContext", assetFqn, localContext);
      onOpenAsset?.(assetFqn, nextTab);
    } catch {
      onNavigationStateChange?.(false, "");
      setLinkFeedback("The linked asset could not be opened right now. Refresh the workspace and try again.");
    }
  };

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
        lineagePayload={lineage.payload}
        loading={lineage.loading}
        notice={linkFeedback}
        overlay={!focusAssetFqn && !hasGraph ? searchOverlay : null}
        onAssetSearchQueryChange={setAssetSearchQuery}
        onContextChange={(nextContext) => {
          setLocalContext(nextContext);
        }}
        onOpenGovernance={onOpenGovernance}
        onOpenAsset={openLineageAsset}
        onSelectAsset={(assetFqn) => {
          onNavigationStateChange?.(true, "Refocusing lineage…");
          void Promise.all([
            prefetchAssetAvailability([assetFqn], { force: true }),
            prefetchAssetDetail(assetFqn, { force: true, sections: ["header", "activity"] }),
          ])
            .then(([availabilityMap, detail]) => {
              const availability = availabilityMap?.[assetFqn] || null;
              if (!canOpenLinkedAssetRecord(detail, availability)) {
                onNavigationStateChange?.(false, "");
                setLinkFeedback(
                  "That linked asset is available in lineage context only. Open it from the graph only after the live record becomes visible.",
                );
                return;
              }
              setLinkFeedback("");
              setFocusAssetFqn(assetFqn);
              onRouteAssetChange?.(assetFqn, localContext);
            })
            .catch(() => {
              onNavigationStateChange?.(false, "");
              setLinkFeedback("The graph could not refocus on that linked asset right now. Try again after the lineage refresh settles.");
            });
        }}
      />
    </section>
  );
}
