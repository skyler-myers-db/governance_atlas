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
import { WorkspaceStateCard } from "./ShellStatePrimitives";

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
  onRouteAssetChange,
  onOpenGovernance,
  onOpenAsset,
  runtimeFeatureFlags = [],
  workspaceAccess = null,
}) {
  const focusAssetFqn = initialAssetFqn || "";
  const [linkedRecordUnavailableOverrides, setLinkedRecordUnavailableOverrides] = useState({});
  const [localContext, setLocalContext] = useState(() =>
    readLineageContext(
      initialAssetFqn || "",
      peekWorkspaceIntent("lineageContext", initialAssetFqn || "", "Data Lineage"),
    )
  );
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [linkFeedback, setLinkFeedback] = useState("");
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
  const lineageAccessPending =
    !workspaceAccessResolved && lineageAvailable && lineageRolloutAvailable;
  const lineageSurfaceAvailable = lineageAvailable && lineageRolloutAvailable && workspaceLineageAvailable;
  const lineageRolloutUnavailableReason =
    "Table lineage rollout is not available in this workspace right now.";
  const lineageSurfaceUnavailableReason = !workspaceLineageAvailable
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
  const lineage = useLineage(focusAssetFqn || "", lineageSurfaceAvailable);
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
  const activeGraph =
    localContext === "Operational Context"
      ? lineage.graph?.operational
      : lineage.graph?.data;
  const hasGraph = Boolean(activeGraph?.nodes?.length);

  useEffect(() => {
    setAssetSearchQuery("");
  }, [focusAssetFqn]);

  useEffect(() => {
    setLinkFeedback("");
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

  const searchOverlay = (
    <div className="gh-lineage-overlay-card">
      <div className="gh-panel-title">{localContext}</div>
      <div className="gh-support-copy">
        {focusAssetFqn
          ? assetDetail.error ||
            "No live lineage graph is available for this asset right now. Search for another asset to continue."
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
            onClick={() => {
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

  if (lineageAccessPending) {
    return (
      <section className="gh-workspace gh-lineage-shell">
        <WorkspaceStateCard
          eyebrow="Lineage Access"
          message="Checking actor-scoped lineage access for this route."
          title="Resolving live lineage access..."
          tone="neutral"
        >
          {asset || focusAssetFqn ? (
            <div className="gh-support-copy">{asset ? assetPathLabel(asset) : focusAssetFqn}</div>
          ) : null}
        </WorkspaceStateCard>
      </section>
    );
  }

  if (!lineageSurfaceAvailable) {
    return (
      <section className="gh-workspace gh-lineage-shell">
        <WorkspaceStateCard
          eyebrow="Lineage Unavailable"
          message={lineageSurfaceUnavailableReason}
          title="Live table lineage is not available in this workspace."
          tone="bad"
        >
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
        </WorkspaceStateCard>
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
        assetSearchResolvedQuery={assetSearch.resolvedQuery}
        context={localContext}
        embedded={false}
        error={lineage.error}
        graphBundle={lineage.graph}
        lineagePayload={lineage.payload}
        loading={lineage.loading}
        linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
        notice={linkFeedback}
        authoritative={lineage.authoritative}
        provisional={lineage.provisional}
        overlay={!hasGraph ? searchOverlay : null}
        onAssetSearchQueryChange={setAssetSearchQuery}
        onContextChange={(nextContext) => {
          setLocalContext(nextContext);
        }}
        onOpenFullGraph={() => {}}
        onOpenGovernance={onOpenGovernance}
        onOpenAsset={openLineageAsset}
        onSelectAsset={(assetFqn) => {
          onNavigationStateChange?.(true, "Refocusing lineage…");
          setLinkFeedback("");
          onRouteAssetChange?.(assetFqn, localContext);
        }}
      />
    </section>
  );
}
