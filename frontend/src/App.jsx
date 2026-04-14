import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import AppFrame from "./components/AppFrame";
import DiscoveryWorkspace from "./components/DiscoveryWorkspace";
import EntityWorkspace from "./components/EntityWorkspace";
import LineageWorkspace from "./components/LineageWorkspace";
import { useAppRouteState } from "./hooks/useAppRouteState";
import { useBootstrap } from "./hooks/useBootstrap";

const GovernanceWorkspace = lazy(() => import("./components/GovernanceWorkspace"));

function visibleAssetSetFromGroups(...groups) {
  const visible = new Set();
  groups.flat().forEach((asset) => {
    if (asset?.fqn) visible.add(asset.fqn);
  });
  return visible;
}

function mergeAssetGroups(...groups) {
  const merged = [];
  const seen = new Set();
  groups.flat().forEach((asset) => {
    if (!asset?.fqn || seen.has(asset.fqn)) return;
    seen.add(asset.fqn);
    merged.push(asset);
  });
  return merged;
}

function bootShell(kicker, title, body) {
  return (
    <div className="gh-launch-screen">
      <div className="gh-launch-shell">
        <div className="gh-launch-header">
          <div className="gh-launch-brand">
            <div className="gh-launch-brand-mark">GH</div>
            <div className="gh-launch-brand-copy">
              <strong>Governance Hub</strong>
              <span>Metadata Workspace</span>
            </div>
          </div>
          <div className="gh-launch-modules">
            <span className="gh-launch-pill is-active">Discovery</span>
            <span className="gh-launch-pill">Lineage</span>
            <span className="gh-launch-pill">Governance</span>
          </div>
          <div className="gh-launch-identity">Preparing workspace</div>
        </div>

        <div className="gh-launch-search">
          <div className="gh-launch-search-label">Global Search</div>
          <div className="gh-launch-search-input">Search visible assets by name, schema, domain, or tag</div>
          <div className="gh-launch-search-button">Browse</div>
        </div>

        <div className="gh-launch-grid">
          <aside className="gh-launch-panel">
            <div className="gh-launch-kicker">Discovery Scope</div>
            <strong>Preparing filters</strong>
            <p>Loading asset types, saved views, and catalog scope.</p>
            <div className="gh-launch-skeleton-list">
              <span />
              <span />
              <span />
              <span />
            </div>
          </aside>

          <main className="gh-launch-panel">
            <div className="gh-launch-kicker">{kicker}</div>
            <strong>{title}</strong>
            <p>{body}</p>
            <div className="gh-launch-skeleton-cards">
              <span />
              <span />
              <span />
            </div>
          </main>

          <aside className="gh-launch-panel">
            <div className="gh-launch-kicker">Selected Asset</div>
            <strong>Preparing preview context</strong>
            <p>Loading schema, sample data, and lineage context for the first asset.</p>
            <div className="gh-launch-skeleton-list">
              <span />
              <span />
              <span />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function unavailableWorkspace(message) {
  return (
    <section className="gh-workspace gh-unavailable-workspace">
      <div className="gh-panel gh-unavailable-panel">
        <div className="gh-panel-title">Workspace Unavailable</div>
        <h2>The live metadata workspace could not initialize.</h2>
        <p>
          {message ||
            "Verify warehouse access, Unity Catalog permissions, and governance configuration, then retry."}
        </p>
      </div>
    </section>
  );
}

function workspaceLoading(title, body) {
  return (
    <section className="gh-workspace gh-unavailable-workspace">
      <div className="gh-panel gh-unavailable-panel">
        <div className="gh-panel-title">{title}</div>
        <h2>Preparing the workspace surface.</h2>
        <p>{body}</p>
      </div>
    </section>
  );
}

export default function App() {
  const { loading, error, refreshError, data } = useBootstrap();
  const [navigationState, setNavigationState] = useState({
    pending: false,
    label: "",
  });
  const [liveDiscoveryState, setLiveDiscoveryState] = useState({
    assets: [],
    count: null,
    baselineAssets: [],
    baselineCount: null,
    settled: false,
    error: "",
    baselineScope: false,
    authoritative: false,
  });
  const [liveGovernanceState, setLiveGovernanceState] = useState(null);
  const {
    surface,
    setSurface,
    routeAssetFqn,
    discoveryRouteState,
    setDiscoveryRouteQuery,
    openDiscoveryWorkspace,
    openEntityWorkspace,
    openLineageWorkspace,
    openGovernanceWorkspace,
    onModuleChange,
  } = useAppRouteState();
  const handleLiveCatalogStateChange = useCallback((nextState) => {
    setLiveDiscoveryState((current) => {
      const nextAuthoritative = nextState.authoritative === true;
      const nextBaselineAssets =
        nextAuthoritative &&
        nextState.settled &&
        !nextState.error &&
        nextState.baselineScope &&
        Array.isArray(nextState.assets)
          ? nextState.assets
          : current.baselineAssets;
      const nextBaselineCount =
        nextAuthoritative &&
        nextState.settled &&
        !nextState.error &&
        nextState.baselineScope &&
        typeof nextState.count === "number"
          ? nextState.count
          : current.baselineCount;
      return {
        assets:
          nextAuthoritative && Array.isArray(nextState.assets) ? nextState.assets : current.assets,
        count:
          nextAuthoritative && typeof nextState.count === "number"
            ? nextState.count
            : current.count,
        baselineAssets: nextBaselineAssets,
        baselineCount: nextBaselineCount,
        settled: Boolean(nextState.settled),
        error: nextState.error || "",
        baselineScope: Boolean(nextState.baselineScope),
        authoritative: nextAuthoritative,
      };
    });
  }, []);
  const handleGovernanceChange = useCallback((nextGovernance) => {
    if (!nextGovernance) return;
    setLiveGovernanceState(nextGovernance);
  }, []);
  const handleNavigationStateChange = useCallback((pending, label = "") => {
    setNavigationState({
      pending: Boolean(pending),
      label: pending ? label || "Opening workspace…" : "",
    });
  }, []);
  const handleSurfaceReady = useCallback(() => {
    setNavigationState((current) =>
      current.pending ? { pending: false, label: "" } : current,
    );
  }, []);
  const handleModuleSurfaceChange = useCallback((nextModule) => {
    const labels = {
      discovery: "Opening discovery…",
      lineage: "Opening lineage…",
      governance: "Opening governance…",
    };
    handleNavigationStateChange(true, labels[nextModule] || "Opening workspace…");
    onModuleChange(nextModule);
  }, [handleNavigationStateChange, onModuleChange]);
  const handleBrowseCatalog = useCallback((query) => {
    handleNavigationStateChange(true, query ? "Opening discovery results…" : "Opening discovery…");
    openDiscoveryWorkspace(query, { fresh: true });
  }, [handleNavigationStateChange, openDiscoveryWorkspace]);

  useEffect(() => {
    if (data?.governance) {
      setLiveGovernanceState(data.governance);
    }
  }, [data]);

  useEffect(() => {
    if (!navigationState.pending) return undefined;
    const progressTimeout = window.setTimeout(() => {
      setNavigationState((current) =>
        current.pending
          ? {
              pending: true,
              label: "Still loading live metadata…",
            }
          : current,
      );
    }, 8000);
    const timeout = window.setTimeout(() => {
      setNavigationState((current) =>
        current.pending ? { pending: false, label: "" } : current,
      );
    }, 24000);
    return () => {
      window.clearTimeout(progressTimeout);
      window.clearTimeout(timeout);
    };
  }, [navigationState.pending]);

  if (loading) {
    return bootShell(
      "Loading",
      "Preparing the metadata workspace.",
      "Connecting the discovery plane, lineage graph, and governance workbench.",
    );
  }

  if (error || !data) {
    return bootShell(
      "Workspace Unavailable",
      "The workspace could not load.",
      error || "Bootstrap payload was unavailable.",
    );
  }

  const bootstrapAssets = data.assets || [];
  const bootstrapVisibleCount = data.discovery?.summary?.visibleAssets ?? bootstrapAssets.length ?? 0;
  const bootstrapRefreshFailed = Boolean(refreshError);
  const hasCurrentDiscoveryTruth =
    liveDiscoveryState.authoritative &&
    liveDiscoveryState.settled &&
    !liveDiscoveryState.error &&
    Array.isArray(liveDiscoveryState.assets);
  const hasBaselineDiscoveryTruth =
    liveDiscoveryState.authoritative &&
    liveDiscoveryState.settled &&
    liveDiscoveryState.baselineScope &&
    !liveDiscoveryState.error &&
    Array.isArray(liveDiscoveryState.baselineAssets);
  const currentDiscoveryAssets = hasCurrentDiscoveryTruth ? liveDiscoveryState.assets : [];
  const baselineDiscoveryAssets = hasBaselineDiscoveryTruth ? liveDiscoveryState.baselineAssets : [];
  const bootstrapHasVisibleAssets = Number(bootstrapVisibleCount || 0) > 0;
  const searchSeedAssets = baselineDiscoveryAssets.length
    ? baselineDiscoveryAssets
    : currentDiscoveryAssets.length
      ? currentDiscoveryAssets
      : bootstrapAssets;
  const contextSeedAssets = mergeAssetGroups(
    currentDiscoveryAssets,
    baselineDiscoveryAssets,
    bootstrapAssets,
  );
  const visibleAssetSet = visibleAssetSetFromGroups(contextSeedAssets);

  const shell = data.shell || {};
  const governance = liveGovernanceState || data.governance || { metrics: [], backlog: [], glossary: [] };
  const bootState = data.bootState || "live";
  const bootMessage = data.bootMessage || "";
  const effectiveVisibleCount =
    hasCurrentDiscoveryTruth && typeof liveDiscoveryState.count === "number"
      ? liveDiscoveryState.count
      : bootstrapVisibleCount;
  const hasRenderableCatalogSeed =
    currentDiscoveryAssets.length > 0 ||
    baselineDiscoveryAssets.length > 0 ||
    searchSeedAssets.length > 0 ||
    (hasBaselineDiscoveryTruth && Number(liveDiscoveryState.baselineCount || 0) > 0);
  const effectiveBootState =
    bootState === "unavailable" || bootState === "error"
      ? bootState
      : bootstrapRefreshFailed || bootState === "degraded"
        ? "degraded"
        : "live";
  const effectiveBootMessage =
    effectiveBootState === "live" && hasRenderableCatalogSeed ? "" : refreshError || bootMessage;
  let content = unavailableWorkspace(effectiveBootMessage);

  if (effectiveBootState !== "unavailable" && effectiveBootState !== "error") {
    if (surface === "discovery") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading discovery",
            "Restoring the catalog, selected asset preview, and stacked filters.",
          )}
        >
          <DiscoveryWorkspace
            bootstrap={data}
            effectiveBootMessage={effectiveBootMessage}
            effectiveBootState={effectiveBootState}
            effectiveVisibleCount={effectiveVisibleCount}
            initialQuery={discoveryRouteState.query}
            onNavigationStateChange={handleNavigationStateChange}
            onSurfaceReady={handleSurfaceReady}
            onRouteQueryChange={setDiscoveryRouteQuery}
            onOpenAsset={openEntityWorkspace}
            onOpenGovernance={openGovernanceWorkspace}
            onOpenLineage={openLineageWorkspace}
            allowSeededDiscovery={bootstrapAssets.length > 0}
            querySeedFresh={discoveryRouteState.fresh}
            querySeedKey={discoveryRouteState.requestKey}
            onLiveCatalogStateChange={handleLiveCatalogStateChange}
            sharedVisibleAssetSet={visibleAssetSet}
          />
        </Suspense>
      );
    } else if (surface === "entity") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading metadata record",
            "Hydrating the selected asset, schema, sample data, and lineage context.",
          )}
        >
          <EntityWorkspace
            assetFqn={surface === "entity" ? routeAssetFqn : ""}
            bootstrap={data}
            contextSeedAssets={contextSeedAssets}
            onNavigationStateChange={handleNavigationStateChange}
            onSurfaceReady={handleSurfaceReady}
            sharedVisibleAssetSet={visibleAssetSet}
            onGovernanceChange={handleGovernanceChange}
            onBack={() => {
              openDiscoveryWorkspace(discoveryRouteState.query, { fresh: false });
            }}
            onOpenGovernance={openGovernanceWorkspace}
            onOpenLineage={(assetFqn, nextContext = "Data Lineage") =>
              openLineageWorkspace(assetFqn || routeAssetFqn, nextContext)
            }
            onSelectAsset={(assetFqn, nextTab = "Overview") => openEntityWorkspace(assetFqn, nextTab)}
          />
        </Suspense>
      );
    } else if (surface === "lineage") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading lineage",
            "Preparing the connected graph workspace and focus asset context.",
          )}
        >
          <LineageWorkspace
            bootstrap={data}
            contextSeedAssets={contextSeedAssets}
            initialAssetFqn={surface === "lineage" ? routeAssetFqn : ""}
            onNavigationStateChange={handleNavigationStateChange}
            onSurfaceReady={handleSurfaceReady}
            sharedVisibleAssetSet={visibleAssetSet}
            onRouteAssetChange={(assetFqn, nextContext = "Data Lineage") =>
              openLineageWorkspace(assetFqn, nextContext)
            }
            onOpenGovernance={openGovernanceWorkspace}
            onOpenAsset={(assetFqn, nextTab = "Overview") => openEntityWorkspace(assetFqn, nextTab)}
          />
        </Suspense>
      );
    } else {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading governance",
            "Preparing stewardship lanes, ownership gaps, and glossary context.",
          )}
        >
          <GovernanceWorkspace
            bootstrap={data}
            contextSeedAssets={contextSeedAssets}
            initialAssetFqn={surface === "governance" ? routeAssetFqn : ""}
            governance={governance}
            onNavigationStateChange={handleNavigationStateChange}
            onSurfaceReady={handleSurfaceReady}
            onGovernanceChange={handleGovernanceChange}
            onRouteAssetChange={(assetFqn) => openGovernanceWorkspace(assetFqn || "")}
            onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
            onOpenLineage={openLineageWorkspace}
          />
        </Suspense>
      );
    }
  }

  return (
    <AppFrame
      activeModule={
        surface === "entity"
          ? "discovery"
          : ["discovery", "lineage", "governance"].includes(surface)
            ? surface
            : ""
      }
      bootMessage={effectiveBootMessage}
      bootState={effectiveBootState}
      liveCatalogVisibleCount={effectiveVisibleCount}
      navigationState={navigationState}
      onBrowseCatalog={handleBrowseCatalog}
      onModuleChange={handleModuleSurfaceChange}
      onNavigationStateChange={handleNavigationStateChange}
      onSearchResultSelect={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
      searchSeedAssets={searchSeedAssets}
      shell={shell}
      visibleAssetSet={visibleAssetSet}
    >
      {content}
    </AppFrame>
  );
}
