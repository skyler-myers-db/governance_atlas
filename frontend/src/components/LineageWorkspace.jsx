import LineageStage from "./LineageStage";
import { useEffect, useState } from "react";
import {
  canOpenLinkedAssetRecord,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useLineage } from "../hooks/useLineage";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { assetPathLabel } from "../lib/assetPresentation";
import {
  runtimeFeatureFlagAvailable,
  runtimeFeatureFlagReason,
  tableLineageAvailable,
  tableLineageReason,
  workspaceAccessAvailable,
  workspaceAccessReason,
} from "../lib/capabilities";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { consumeWorkspaceIntent, peekWorkspaceIntent, setWorkspaceIntent } from "../lib/workspaceIntent";

const LINEAGE_CONTEXT_SESSION_KEY = "gh.lineage.context.v1";
const LINEAGE_TRANSIENT_REASON_PATTERN = /(warming|hydrate|hydrating|cold start|serverless|warehouse|starting|loading)/i;

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

function lineageCapabilityCanHydrate(reason = "") {
  return LINEAGE_TRANSIENT_REASON_PATTERN.test(String(reason || ""));
}

export default function LineageWorkspace({
  initialAssetFqn,
  bootstrap,
  contextSeedAssets = [],
  onNavigationStateChange,
  onSurfaceReady,
  onRouteAssetChange,
  onOpenGovernance,
  onOpenAsset,
  runtimeFeatureFlags = [],
  workspaceAccess = null,
  userEmail = "",
}) {
  const focusAssetFqn = initialAssetFqn || "";
  const [linkedRecordUnavailableOverrides, setLinkedRecordUnavailableOverrides] = useState({});
  const [localContext, setLocalContext] = useState(() =>
    readLineageContext(
      initialAssetFqn || "",
      peekWorkspaceIntent("lineageContext", initialAssetFqn || "", "Data Lineage"),
    )
  );
  // Data / Operational remain independent controls, but the default full
  // workspace should show backed job/pipeline context whenever Databricks
  // returns it. Hiding operational context by default made a populated graph
  // look falsely empty.
  const [modeFlags, setModeFlags] = useState({ data: true, operational: true });
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [linkFeedback, setLinkFeedback] = useState("");
  const [lineageEmptyStatus, setLineageEmptyStatus] = useState("");
  // Lineage-wide filter knobs — separate upstream/downstream caps, a
  // max-depth clamp, a per-layer node budget, and the include-columns
  // toggle. Today the backend returns a fully-materialised graph so we
  // clamp client-side; when/if the service starts honoring these caps
  // server-side, the same state drives the request without UI churn.
  const [upstreamLevels, setUpstreamLevels] = useState(2);
  const [downstreamLevels, setDownstreamLevels] = useState(2);
  const [maxDepth, setMaxDepth] = useState(2);
  const [nodesPerLayer, setNodesPerLayer] = useState(10);
  const [includeColumns, setIncludeColumns] = useState(false);
  const lineageAvailable = tableLineageAvailable(bootstrap);
  const lineageUnavailableReason = tableLineageReason(bootstrap);
  const workspaceLineageAvailable = workspaceAccessAvailable(workspaceAccess, "canUseLineage", false);
  const lineageRolloutAvailable = runtimeFeatureFlagAvailable(
    runtimeFeatureFlags,
    "table_lineage_surface",
  );
  const workspaceAccessResolved = Boolean(
    workspaceAccess &&
      (
        workspaceAccess.mode ||
        workspaceAccess.observedAt ||
        Array.isArray(workspaceAccess.gates) ||
        typeof workspaceAccess.canUseLineage === "boolean"
      ),
  );
  const lineageAccessPending = false;
  const lineageSurfaceAvailable =
    lineageAvailable &&
    lineageRolloutAvailable &&
    (!workspaceAccessResolved || workspaceLineageAvailable);
  const lineageRolloutUnavailableReason =
    "Table lineage rollout is not available in this workspace right now.";
  const lineageSurfaceUnavailableReason = workspaceAccessResolved && !workspaceLineageAvailable
    ? workspaceAccessReason(workspaceAccess, "table_lineage", lineageUnavailableReason)
    : lineageAvailable
    ? lineageRolloutAvailable
      ? lineageUnavailableReason
      : runtimeFeatureFlagReason(
          runtimeFeatureFlags,
          "table_lineage_surface",
          lineageRolloutUnavailableReason,
        )
    : lineageUnavailableReason;
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const seeded = useSeededAssetContext(focusAssetFqn, bootstrap, seedAssets, {
    allowFallback: false,
  });
  const assetDetail = useAssetDetail(focusAssetFqn || "", { sections: ["header"] });
  const lineageHydrationAvailable =
    Boolean(focusAssetFqn) &&
    lineageCapabilityCanHydrate(lineageUnavailableReason) &&
    (!workspaceAccessResolved || workspaceLineageAvailable);
  const lineageFetchEnabled = lineageSurfaceAvailable || lineageHydrationAvailable;
  const lineage = useLineage(focusAssetFqn || "", lineageFetchEnabled, {
    fullProfile: true,
  });
  const asset =
    assetDetail.detail ||
    (focusAssetFqn && assetDetail.loading ? seeded.summary : null);
  const assetSearch = useAssetSearch(
    assetSearchQuery,
    assetSearchQuery.trim().length >= 2,
    seedAssets,
  );
  const searchReady =
    !assetSearch.loading && assetSearch.resolvedQuery === assetSearchQuery.trim();
  // hasGraph now reflects the modeFlags union: a graph is present if any
  // enabled lineage mode carries at least one node.
  const dataNodes = lineage.graph?.data?.nodes?.length || 0;
  const operationalNodes = lineage.graph?.operational?.nodes?.length || 0;
  const hasGraph =
    (modeFlags.data && dataNodes > 0) || (modeFlags.operational && operationalNodes > 0);

  useEffect(() => {
    setAssetSearchQuery("");
  }, [focusAssetFqn]);

  useEffect(() => {
    setLinkFeedback("");
    setLineageEmptyStatus("");
    setLinkedRecordUnavailableOverrides({});
  }, [focusAssetFqn, localContext]);

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
    if (!workspaceAccessResolved) return;
    if (!lineage.loading && (!assetDetail.loading || assetDetail.detail?.fqn === focusAssetFqn)) {
      onSurfaceReady?.();
    }
  }, [
    assetDetail.detail?.fqn,
    assetDetail.loading,
    focusAssetFqn,
    lineage.loading,
    onSurfaceReady,
    workspaceAccessResolved,
  ]);

  const clearLineageFocus = () => {
    setAssetSearchQuery("");
    setLineageEmptyStatus("");
    onRouteAssetChange?.("", localContext);
  };

  const searchOverlay = (
    <div className="gh-lineage-overlay-card">
      <div className="gh-panel-title">{localContext}</div>
      <div className="gh-support-copy">
        {focusAssetFqn
          ? assetDetail.error ||
            "No live lineage graph is available for this asset right now. Search for another asset to continue."
          : "Search for an asset and open the graph directly from there."}
      </div>
      {lineageEmptyStatus ? <div className="gh-support-copy">{lineageEmptyStatus}</div> : null}
      <div className="gh-lineage-launch-search">
        <input
          className="gh-input"
          onChange={(event) => setAssetSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && searchReady && assetSearch.assets[0]) {
              event.preventDefault();
              onNavigationStateChange?.(true, "Loading lineage asset…");
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
            onClick={async () => {
              setLineageEmptyStatus("Refreshing lineage from live Databricks evidence...");
              try {
                const refreshed = await lineage.refresh?.();
                setLineageEmptyStatus(refreshed
                  ? "Lineage view reset from live Databricks evidence."
                  : "Lineage view reset; no live graph is available for this asset.");
              } catch (caught) {
                const message = caught?.message || "No live lineage graph is available for this asset.";
                setLineageEmptyStatus(`Lineage view reset failed: ${message}`);
              }
            }}
            type="button"
          >
            Retry
          </button>
          <button
            className="gh-secondary-button"
            disabled={!asset}
            onClick={() => {
              onNavigationStateChange?.(true, "Opening metadata record...");
              onOpenAsset?.(focusAssetFqn, "Overview");
            }}
            title={!asset ? "This asset metadata record is not openable with the current permissions." : undefined}
            type="button"
          >
            Open asset
          </button>
          <button
            className="gh-secondary-button"
            onClick={clearLineageFocus}
            type="button"
          >
            Clear focus
          </button>
        </div>
      ) : null}
    </div>
  );

  const openLineageAsset = (assetFqn, nextTab = "Overview") => {
    if (!assetFqn) return;
    setLinkFeedback("");
    void openAssetRecordSafely(assetFqn, {
      loadingLabel: "Opening metadata record…",
      canOpen: canOpenLinkedAssetRecord,
      onNavigationStateChange,
      beforeOpen: () => {
        setWorkspaceIntent("lineageContext", assetFqn, localContext);
      },
      onOpen: () => {
        setLinkedRecordUnavailableOverrides((current) => {
          if (!current[assetFqn]) return current;
          const next = { ...current };
          delete next[assetFqn];
          return next;
        });
        onOpenAsset?.(assetFqn, nextTab);
      },
      onUnavailable: ({ availability = null, detail = null, error = null } = {}) => {
        const explicitUnavailable =
          !error &&
          (
            availability?.openable === false ||
            availability?.visible === false ||
            availability?.exists === false ||
            Boolean(detail?.fqn)
          );
        if (explicitUnavailable) {
          setLinkedRecordUnavailableOverrides((current) =>
            current[assetFqn] ? current : { ...current, [assetFqn]: true });
        }
        setLinkFeedback(
          "That lineage-linked asset is visible in the graph, but its metadata record is not openable with the current permissions.",
        );
      },
    });
  };

  // Defect 1 — the node drawer footer's "View in Databricks Catalog" button
  // deep-links to the Unity Catalog explorer page. We plumb the workspace
  // host down through LineageStage → LineageGraph so the button can build
  // `https://<host>/explore/data/<catalog>/<schema>/<table>`. Prefer the
  // runtime-reported host (matches the Databricks workspace the app is
  // bound to); fall back to `window.location.host` when the bootstrap
  // payload hasn't populated it yet. Both are safer than deriving from the
  // request URL because the app is served from `databricksapps.com` while
  // the Unity Catalog explorer lives on `databricks.net`.
  const runtimeHost = bootstrap?.runtime?.client?.host || bootstrap?.runtime?.client?.workspaceHost || "";
  const browserHost = typeof window !== "undefined" ? window.location.host : "";
  const workspaceHost =
    String(runtimeHost || "").trim() ||
    (browserHost
      ? browserHost.replace(/^[^.]+\./, "").replace(/databricksapps\.com$/, "databricks.net")
      : "");

  if (!focusAssetFqn) {
    return (
      <section className="gh-lineage-shell">
        <LineageStage
          asset={null}
          assetSearchLoading={assetSearch.loading}
          assetSearchQuery={assetSearchQuery}
          assetSearchResults={assetSearch.assets}
          assetSearchResolvedQuery={assetSearch.resolvedQuery}
          context={localContext}
          modeFlags={modeFlags}
          onModeChange={setModeFlags}
          embedded={false}
          workspaceHost={workspaceHost}
          error=""
          graphBundle={null}
          lineagePayload={null}
          loading={false}
          linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
          notice={linkFeedback}
          authoritative={false}
          provisional={false}
          overlay={searchOverlay}
          upstreamLevels={upstreamLevels}
          downstreamLevels={downstreamLevels}
          maxDepth={maxDepth}
          nodesPerLayer={nodesPerLayer}
          includeColumns={includeColumns}
          onUpstreamLevelsChange={setUpstreamLevels}
          onDownstreamLevelsChange={setDownstreamLevels}
          onMaxDepthChange={setMaxDepth}
          onNodesPerLayerChange={setNodesPerLayer}
          onIncludeColumnsChange={setIncludeColumns}
          onAssetSearchQueryChange={setAssetSearchQuery}
          onContextChange={setLocalContext}
          onOpenGovernance={onOpenGovernance}
          onOpenAsset={openLineageAsset}
          onRefreshLineage={lineage.refresh}
          onSelectAsset={(assetFqn) => {
            onNavigationStateChange?.(true, "Refocusing lineage…");
            setLinkFeedback("");
            onRouteAssetChange?.(assetFqn, localContext);
          }}
          userEmail={userEmail}
        />
      </section>
    );
  }

  const lineagePayloadAvailable = Boolean(
    lineage.payload ||
      lineage.graph?.data?.nodes?.length ||
      lineage.graph?.operational?.nodes?.length,
  );
  const lineageStageAvailable =
    lineageSurfaceAvailable || lineageHydrationAvailable || lineagePayloadAvailable;
  const lineageUnavailableOverlay = !lineageStageAvailable || lineageAccessPending ? (
    <div className="gh-lineage-overlay-card">
      <div className="gh-panel-title">{lineageAccessPending ? "Lineage Access" : "Lineage Unavailable"}</div>
      <div className="gh-support-copy">
        {lineageAccessPending
          ? "Checking actor-scoped lineage access for this route."
          : lineageSurfaceUnavailableReason}
      </div>
      {asset || focusAssetFqn ? (
        <div className="gh-support-copy">{asset ? assetPathLabel(asset) : focusAssetFqn}</div>
      ) : null}
      {focusAssetFqn ? (
        <div className="gh-empty-state-actions">
          <button
            className="gh-secondary-button"
            onClick={() => {
              onNavigationStateChange?.(true, "Opening metadata record…");
              onOpenAsset?.(focusAssetFqn, "Overview");
            }}
            type="button"
          >
            Open metadata record
          </button>
          <button
            className="gh-secondary-button"
            onClick={() => {
              onNavigationStateChange?.(true, "Opening governance…");
              onOpenGovernance?.(focusAssetFqn);
            }}
            type="button"
          >
            Open governance
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="gh-lineage-shell">
      <LineageStage
        asset={asset}
        assetSearchLoading={assetSearch.loading}
        assetSearchQuery={assetSearchQuery}
        assetSearchResults={assetSearch.assets}
        assetSearchResolvedQuery={assetSearch.resolvedQuery}
        context={localContext}
        modeFlags={modeFlags}
        onModeChange={setModeFlags}
        embedded={false}
        workspaceHost={workspaceHost}
        error={!lineageStageAvailable ? lineageSurfaceUnavailableReason : lineage.error}
        graphBundle={lineage.graph}
        lineagePayload={lineage.payload}
        loading={lineageAccessPending || lineage.loading}
        linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
        notice={linkFeedback}
        authoritative={lineage.authoritative}
        provisional={lineage.provisional}
        overlay={lineageUnavailableOverlay || (!hasGraph ? searchOverlay : null)}
        upstreamLevels={upstreamLevels}
        downstreamLevels={downstreamLevels}
        maxDepth={maxDepth}
        nodesPerLayer={nodesPerLayer}
        includeColumns={includeColumns}
        onUpstreamLevelsChange={setUpstreamLevels}
        onDownstreamLevelsChange={setDownstreamLevels}
        onMaxDepthChange={setMaxDepth}
        onNodesPerLayerChange={setNodesPerLayer}
        onIncludeColumnsChange={setIncludeColumns}
        onAssetSearchQueryChange={setAssetSearchQuery}
        onContextChange={(nextContext) => {
          setLocalContext(nextContext);
        }}
        onOpenGovernance={onOpenGovernance}
        onOpenAsset={openLineageAsset}
        onRefreshLineage={lineage.refresh}
        onSelectAsset={(assetFqn) => {
          onNavigationStateChange?.(true, "Refocusing lineage…");
          setLinkFeedback("");
          onRouteAssetChange?.(assetFqn, localContext);
        }}
        userEmail={userEmail}
      />
    </section>
  );
}
