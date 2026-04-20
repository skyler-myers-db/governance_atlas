import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import AppFrame from "./components/AppFrame";
import { SurfaceHeader } from "./components/ShellLayoutPrimitives";
import { WorkspaceStateCard } from "./components/ShellStatePrimitives";
import WorkspaceDiagnosticsSurface from "./components/WorkspaceDiagnosticsSurface";
import WorkspaceSetupWizard from "./components/WorkspaceSetupWizard";
import { useAppRouteState } from "./hooks/useAppRouteState";
import { useBootstrap } from "./hooks/useBootstrap";
import { useGovernanceSummary } from "./hooks/useGovernanceSummary";
import { useRuntimeStatus } from "./hooks/useRuntimeStatus";
import { normalizeGovernancePayload, updateGovernanceNotification } from "./lib/api";
import { diagnosticsRecoveryAvailable, diagnosticsSurfaceAvailable } from "./lib/capabilities";

const GovernanceWorkspace = lazy(() => import("./components/GovernanceWorkspace"));
const DiscoveryWorkspace = lazy(() => import("./components/DiscoveryWorkspace"));
const EntityWorkspace = lazy(() => import("./components/EntityWorkspace"));
const LineageWorkspace = lazy(() => import("./components/LineageWorkspace"));
const AuditBrowserWorkspace = lazy(() => import("./components/AuditBrowserWorkspace"));
const TaxonomyWorkspace = lazy(() => import("./components/TaxonomyWorkspace"));
const HelpPage = lazy(() => import("./components/HelpPage"));
const InboxPage = lazy(() => import("./components/InboxPage"));

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

function normalizeInboxState(value) {
  return String(value || "").trim().toLowerCase();
}

function isUnreadInboxState(value) {
  const normalized = normalizeInboxState(value);
  return normalized === "new" || normalized === "seen" || normalized === "unread";
}

function updateGovernanceInbox(governance, notificationId, action) {
  const normalizedGovernance = normalizeGovernancePayload(governance || {});
  const inbox = normalizedGovernance?.inbox;
  if (!inbox?.items?.length || !notificationId) return normalizedGovernance;

  const nextInboxState = action === "dismiss" ? "dismissed" : "read";
  let changed = false;
  const items = inbox.items.map((item) => {
    if (String(item.notificationId || "") !== String(notificationId || "")) return item;
    if (normalizeInboxState(item.inboxState) === nextInboxState) return item;
    changed = true;
    return {
      ...item,
      inboxState: nextInboxState,
    };
  });

  if (!changed) return normalizedGovernance;

  const unreadCount = items.reduce(
    (count, item) => count + (isUnreadInboxState(item.inboxState) ? 1 : 0),
    0,
  );

  return normalizeGovernancePayload({
    ...normalizedGovernance,
    inbox: {
      ...inbox,
      items,
      unreadCount,
    },
  });
}

function unavailableWorkspace(message, diagnostics = null) {
  return (
    <section className="gh-workspace gh-unavailable-workspace">
      <WorkspaceStateCard
        eyebrow="Workspace Unavailable"
        message={
          message ||
          "Verify warehouse access, Unity Catalog permissions, and governance configuration, then retry."
        }
        title="The live metadata workspace could not initialize."
        tone="bad"
      />
      {diagnostics}
    </section>
  );
}

function workspaceLoading(title, body) {
  return (
    <section className="gh-workspace gh-unavailable-workspace">
      <WorkspaceStateCard
        eyebrow={title}
        loading
        message={body}
        title="Preparing the workspace surface."
      />
    </section>
  );
}

function renderWorkspaceDiagnostics(onClose, diagnostics) {
  return (
    <section className="gh-workspace gh-diagnostics-workspace">
      <SurfaceHeader
        actions={(
          <button className="gh-tertiary-button gh-inline-link-button" onClick={onClose} type="button">
            Close workspace setup
          </button>
        )}
        className="gh-diagnostics-surface-header"
        eyebrow="Workspace setup"
        title="Workspace readiness guide"
      >
        <div className="gh-support-copy">
          Operator-only setup truth. Read-only runtime guidance kept in the shell instead of a second
          readiness store.
        </div>
      </SurfaceHeader>
      {diagnostics}
    </section>
  );
}

function emptyGovernanceState() {
  return {
    metrics: [],
    backlog: [],
    glossary: [],
    inbox: null,
  };
}

function degradedGovernanceState(message) {
  return normalizeGovernancePayload({
    authoritative: false,
    provenance: {
      warnings: message ? [message] : [],
    },
    metrics: [],
    backlog: [],
    glossary: [],
    inbox: {
      state: "unavailable",
      message: message || "Governance summary is unavailable right now.",
      unreadCount: 0,
      items: [],
    },
  });
}

function overlayGovernanceDegradedState(governance, message) {
  const normalizedGovernance = normalizeGovernancePayload(governance || {});
  const provenanceWarnings = [
    ...(normalizedGovernance?.provenance?.warnings || []),
    message,
  ].filter(Boolean);
  const inbox = normalizedGovernance?.inbox;

  return normalizeGovernancePayload({
    ...normalizedGovernance,
    authoritative: false,
    provenance: {
      ...(normalizedGovernance?.provenance || {}),
      warnings: [...new Set(provenanceWarnings)],
    },
    inbox: {
      ...(inbox || {}),
      state: "degraded",
      message:
        message ||
        inbox?.message ||
        "Governance summary is stale right now.",
      unreadCount: Number.isFinite(Number(inbox?.unreadCount))
        ? Math.max(0, Math.trunc(Number(inbox.unreadCount)))
        : 0,
      items: Array.isArray(inbox?.items) ? inbox.items : [],
    },
  });
}

export default function App() {
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
  const [shellInboxOpen, setShellInboxOpen] = useState(false);
  const {
    surface,
    routeAssetFqn,
    discoveryRouteState,
    setDiscoveryRouteFilterGroups,
    setDiscoveryRoutePreview,
    setDiscoveryRouteQuery,
    setDiscoveryRouteSort,
    setDiscoveryRouteViews,
    openDiscoveryWorkspace,
    openEntityWorkspace,
    openLineageWorkspace,
    openGovernanceWorkspace,
    onModuleChange,
  } = useAppRouteState();
  const [shellDiagnosticsOpen, setShellDiagnosticsOpen] = useState(false);
  const {
    loading,
    shellOnly,
    error,
    refreshError,
    data,
    refresh: refreshBootstrap,
  } = useBootstrap({
    surface,
    asset: routeAssetFqn,
  });
  const runtimeStatus = useRuntimeStatus({
    enabled: Boolean(error) || Boolean(refreshError) || (Boolean(data) && !shellOnly),
    // Poll while the warehouse is still warming. Runtime status returns immediately
    // with "loading" on a cold serverless warehouse; we need to refetch until the
    // real probe resolves so capability / summary data hydrates without forcing
    // the user to refresh the tab. Stops polling once state is not "loading".
    refetchInterval: (query) =>
      query?.state?.data?.runtime?.state === "loading" ? 15000 : false,
  });
  const runtimeStatusRefresh = runtimeStatus.refresh;
  const resolvedIdentity = runtimeStatus.data?.identity || data?.identity || {};
  const runtimeCapabilitiesLive =
    runtimeStatus.data?.runtime?.state && runtimeStatus.data.runtime.state !== "loading"
      ? runtimeStatus.data?.capabilities || null
      : null;
  const runtimeFeatureFlagsLive =
    runtimeStatus.data?.runtime?.state && runtimeStatus.data.runtime.state !== "loading"
      ? runtimeStatus.data?.featureFlags ||
        runtimeStatus.data?.diagnostics?.featureFlags ||
        null
      : null;
  const mergedBootstrap = useMemo(() => {
    if (!data) return data;
    if (!runtimeCapabilitiesLive && !runtimeFeatureFlagsLive) return data;
    return {
      ...data,
      capabilities: runtimeCapabilitiesLive
        ? { ...(data.capabilities || {}), ...runtimeCapabilitiesLive }
        : data.capabilities,
      featureFlags: runtimeFeatureFlagsLive || data.featureFlags,
    };
  }, [data, runtimeCapabilitiesLive, runtimeFeatureFlagsLive]);
  const shell = useMemo(() => {
    const seededShell = data?.shell || {};
    return {
      ...seededShell,
      role: resolvedIdentity.actorRole || seededShell.role || "",
      roleProvisional:
        typeof resolvedIdentity.actorRoleProvisional === "boolean"
          ? resolvedIdentity.actorRoleProvisional
          : Boolean(seededShell.roleProvisional),
      userEmail:
        resolvedIdentity.actorEmail ||
        seededShell.userEmail ||
        data?.identity?.actorEmail ||
        "",
    };
  }, [data?.identity?.actorEmail, data?.shell, resolvedIdentity.actorEmail, resolvedIdentity.actorRole, resolvedIdentity.actorRoleProvisional]);
  const diagnosticsSource =
    runtimeStatus.data?.diagnostics
      ? {
          ...(data || {}),
          shell,
          diagnostics: runtimeStatus.data.diagnostics,
          identity: resolvedIdentity,
        }
      : data
        ? {
            ...data,
            shell,
            identity: resolvedIdentity,
          }
        : data;
  const governanceSummary = useGovernanceSummary({
    enabled: !loading && !error && !shellOnly && Boolean(data) && surface === "governance",
  });
  const runtimeRolloutFlags =
    runtimeStatus.data?.diagnostics?.featureFlags ||
    diagnosticsSource?.featureFlags ||
    diagnosticsSource?.diagnostics?.featureFlags ||
    [];
  const workspaceAccess = diagnosticsSource?.diagnostics?.workspaceAccess || null;
  const diagnosticsAvailable = diagnosticsSurfaceAvailable(diagnosticsSource);
  const diagnosticsRecovery = diagnosticsRecoveryAvailable(runtimeStatus.data || diagnosticsSource);
  const setupReadiness =
    diagnosticsSource?.diagnostics?.setupReadiness ||
    diagnosticsSource?.diagnostics?.readiness ||
    null;
  const handleDiagnosticsRefresh = useCallback(async () => {
    await Promise.allSettled([
      refreshBootstrap?.(),
      runtimeStatusRefresh?.(),
    ]);
  }, [refreshBootstrap, runtimeStatusRefresh]);
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
    setLiveGovernanceState((current) =>
      normalizeGovernancePayload({
        ...nextGovernance,
        inbox: nextGovernance.inbox || current?.inbox || governanceSummary.data?.inbox || null,
      }),
    );
  }, [governanceSummary.data?.inbox]);
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
    setShellDiagnosticsOpen(false);
    setShellInboxOpen(false);
    const labels = {
      discovery: "Opening discovery…",
      lineage: "Opening lineage…",
      governance: "Opening governance…",
      audit: "Opening audit browser…",
      taxonomy: "Opening taxonomy…",
      help: "Opening help…",
      inbox: "Opening inbox…",
    };
    handleNavigationStateChange(true, labels[nextModule] || "Opening workspace…");
    onModuleChange(nextModule);
  }, [handleNavigationStateChange, onModuleChange]);
  const handleBrowseCatalog = useCallback((query) => {
    setShellDiagnosticsOpen(false);
    setShellInboxOpen(false);
    handleNavigationStateChange(true, query ? "Opening discovery results…" : "Opening discovery…");
    openDiscoveryWorkspace(query, { fresh: true });
  }, [handleNavigationStateChange, openDiscoveryWorkspace]);

  useEffect(() => {
    if (!governanceSummary.data) return;
    setLiveGovernanceState((current) =>
      normalizeGovernancePayload({
        ...governanceSummary.data,
        inbox: governanceSummary.data.inbox || current?.inbox || null,
      }),
    );
  }, [governanceSummary.data]);

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

  const governanceBase = liveGovernanceState || governanceSummary.data || null;
  const governance = governanceSummary.refreshError && governanceBase
    ? overlayGovernanceDegradedState(governanceBase, governanceSummary.refreshError)
    : governanceBase;
  const governanceInbox = governance?.inbox || null;
  const governanceSummaryLoading = governanceSummary.loading && !liveGovernanceState && !governanceSummary.data;
  const governanceRouteFallback =
    governance || degradedGovernanceState(governanceSummary.error || governanceSummary.refreshError);
  const shellGovernance = governance || emptyGovernanceState();

  useEffect(() => {
    if (!diagnosticsAvailable) {
      setShellDiagnosticsOpen(false);
    }
  }, [diagnosticsAvailable]);

  // Previously we force-closed the inbox whenever the governance payload
  // was absent, which meant clicking the bell on first paint (before the
  // summary arrived) felt like a dead button. The InboxPanel already has
  // a graceful empty state — let it render.

  const bootstrapAssets = useMemo(() => data?.assets || [], [data?.assets]);
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
  const currentDiscoveryAssets = useMemo(
    () => (hasCurrentDiscoveryTruth ? liveDiscoveryState.assets : []),
    [hasCurrentDiscoveryTruth, liveDiscoveryState.assets],
  );
  const baselineDiscoveryAssets = useMemo(
    () => (hasBaselineDiscoveryTruth ? liveDiscoveryState.baselineAssets : []),
    [hasBaselineDiscoveryTruth, liveDiscoveryState.baselineAssets],
  );
  const searchSeedAssets = useMemo(() => {
    if (baselineDiscoveryAssets.length) return baselineDiscoveryAssets;
    if (currentDiscoveryAssets.length) return currentDiscoveryAssets;
    return bootstrapAssets;
  }, [baselineDiscoveryAssets, bootstrapAssets, currentDiscoveryAssets]);
  const contextSeedAssets = useMemo(
    () => mergeAssetGroups(currentDiscoveryAssets, baselineDiscoveryAssets, bootstrapAssets),
    [baselineDiscoveryAssets, bootstrapAssets, currentDiscoveryAssets],
  );
  const visibleAssetSet = useMemo(
    () => visibleAssetSetFromGroups(contextSeedAssets),
    [contextSeedAssets],
  );

  const handleToggleInbox = useCallback(() => {
    // Clicking the header inbox icon now navigates to the dedicated
    // /inbox surface rather than toggling a transient panel. Operator
    // 2026-04-19 round 3 flagged the panel toggle as "doesn't actually
    // take you to your inbox." The InboxPage mounts the same
    // InboxPanel content + an in-shell header so the button feels
    // like every other top-level destination.
    setShellDiagnosticsOpen(false);
    setShellInboxOpen(false);
    onModuleChange("inbox");
  }, [onModuleChange]);

  const handleToggleDiagnostics = useCallback(() => {
    setShellInboxOpen(false);
    setShellDiagnosticsOpen((current) => !current);
  }, []);

  const handleInboxItemAction = useCallback(async (notificationId, action) => {
    const previousGovernance = liveGovernanceState || governanceSummary.data || null;
    if (!previousGovernance) return null;
    const optimisticGovernance = updateGovernanceInbox(previousGovernance, notificationId, action);
    setLiveGovernanceState(optimisticGovernance);
    try {
      const next = await updateGovernanceNotification(notificationId, { action });
      const nextGovernance = normalizeGovernancePayload(next?.governance || next);
      setLiveGovernanceState(nextGovernance);
      return nextGovernance;
    } catch (error) {
      setLiveGovernanceState(normalizeGovernancePayload(previousGovernance));
      throw error;
    }
  }, [governanceSummary.data, liveGovernanceState]);

  const bootstrapReady = Boolean(data) && !shellOnly;
  const bootstrapPending = loading || (shellOnly && !refreshError);
  const bootState = bootstrapReady ? data.bootState || "live" : bootstrapPending ? "loading" : "error";
  const bootMessage = bootstrapReady ? data.bootMessage || "" : refreshError || error || "";
  const liveCatalogVisibleCount =
    hasCurrentDiscoveryTruth && typeof liveDiscoveryState.count === "number"
      ? liveDiscoveryState.count
      : null;
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

  const diagnosticsPanel = shellDiagnosticsOpen
    ? renderWorkspaceDiagnostics(
        () => setShellDiagnosticsOpen(false),
        <WorkspaceSetupWizard
          error={runtimeStatus.error}
          loading={runtimeStatus.loading}
          refreshError={runtimeStatus.refreshError}
          refreshing={runtimeStatus.refreshing}
          onRefresh={handleDiagnosticsRefresh}
          status={runtimeStatus.data}
          title="Workspace setup"
        />,
      )
    : null;
  let content = workspaceLoading(
    "Preparing workspace shell",
    "Confirming route handoff, identity headers, and shell capabilities before live surface hydration.",
  );

  if (!bootstrapPending && (!bootstrapReady || error)) {
    content = unavailableWorkspace(
      refreshError || error || "Bootstrap payload was unavailable.",
      diagnosticsRecovery ? (
        <WorkspaceDiagnosticsSurface
          error={runtimeStatus.error}
          loading={runtimeStatus.loading}
          refreshError={runtimeStatus.refreshError}
          refreshing={runtimeStatus.refreshing}
          onRefresh={handleDiagnosticsRefresh}
          status={runtimeStatus.data}
          title="Setup Diagnostics"
        />
      ) : null,
    );
  } else if (bootstrapReady && effectiveBootState !== "unavailable" && effectiveBootState !== "error") {
    if (shellDiagnosticsOpen && diagnosticsPanel) {
      content = diagnosticsPanel;
    } else if (surface === "discovery") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading discovery",
            "Restoring the catalog, selected asset preview, and stacked filters.",
          )}
        >
          <DiscoveryWorkspace
            bootstrap={mergedBootstrap}
            effectiveBootMessage={effectiveBootMessage}
            effectiveBootState={effectiveBootState}
            effectiveVisibleCount={liveCatalogVisibleCount}
            initialFilterGroups={discoveryRouteState.filterGroups}
            initialQuery={discoveryRouteState.query}
            initialSelectedAssetFqn={discoveryRouteState.previewAssetFqn}
            initialSort={discoveryRouteState.sortBy}
            initialViews={discoveryRouteState.views}
            onNavigationStateChange={handleNavigationStateChange}
            onRouteFilterGroupsChange={setDiscoveryRouteFilterGroups}
            onRoutePreviewChange={setDiscoveryRoutePreview}
            onSurfaceReady={handleSurfaceReady}
            onRouteQueryChange={setDiscoveryRouteQuery}
            onRouteSortChange={setDiscoveryRouteSort}
            onRouteViewsChange={setDiscoveryRouteViews}
            onOpenAsset={openEntityWorkspace}
            onOpenGovernance={openGovernanceWorkspace}
            onOpenLineage={openLineageWorkspace}
            querySeedFresh={discoveryRouteState.fresh}
            querySeedKey={discoveryRouteState.requestKey}
            onLiveCatalogStateChange={handleLiveCatalogStateChange}
            sharedVisibleAssetSet={visibleAssetSet}
            runtimeFeatureFlags={runtimeRolloutFlags}
            workspaceAccess={workspaceAccess}
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
            bootstrap={mergedBootstrap}
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
            runtimeFeatureFlags={runtimeRolloutFlags}
            workspaceAccess={workspaceAccess}
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
            bootstrap={mergedBootstrap}
            contextSeedAssets={contextSeedAssets}
            initialAssetFqn={surface === "lineage" ? routeAssetFqn : ""}
            onNavigationStateChange={handleNavigationStateChange}
            onSurfaceReady={handleSurfaceReady}
            onRouteAssetChange={(assetFqn, nextContext = "Data Lineage") =>
              openLineageWorkspace(assetFqn, nextContext)
            }
            onOpenGovernance={openGovernanceWorkspace}
            onOpenAsset={(assetFqn, nextTab = "Overview") => openEntityWorkspace(assetFqn, nextTab)}
            runtimeFeatureFlags={runtimeRolloutFlags}
            workspaceAccess={workspaceAccess}
            userEmail={shell?.userEmail || ""}
          />
        </Suspense>
      );
    } else if (surface === "audit") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading audit browser",
            "Preparing cross-entity audit events and filters.",
          )}
        >
          <AuditBrowserWorkspace shell={shell} />
        </Suspense>
      );
    } else if (surface === "taxonomy") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading taxonomy",
            "Preparing classifications, domains, data products, and column groups.",
          )}
        >
          <TaxonomyWorkspace />
        </Suspense>
      );
    } else if (surface === "help") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading help",
            "Preparing the in-app help and documentation page.",
          )}
        >
          <HelpPage
            onBack={() => openDiscoveryWorkspace("", { fresh: false })}
          />
        </Suspense>
      );
    } else if (surface === "inbox") {
      content = (
        <Suspense
          fallback={workspaceLoading(
            "Loading inbox",
            "Preparing governance notifications and stewardship requests.",
          )}
        >
          <InboxPage
            governanceInbox={shellGovernance.inbox}
            onInboxItemAction={handleInboxItemAction}
            onBack={() => openDiscoveryWorkspace("", { fresh: false })}
          />
        </Suspense>
      );
    } else {
      content = governanceSummaryLoading ? (
        workspaceLoading(
          "Loading governance",
          "Preparing live stewardship lanes, glossary context, and inbox state.",
        )
      ) : (
        <Suspense
          fallback={workspaceLoading(
            "Loading governance",
            "Preparing stewardship lanes, ownership gaps, and glossary context.",
          )}
        >
          <GovernanceWorkspace
            bootstrap={mergedBootstrap}
            contextSeedAssets={contextSeedAssets}
            initialAssetFqn={surface === "governance" ? routeAssetFqn : ""}
            governance={governanceRouteFallback}
            onNavigationStateChange={handleNavigationStateChange}
            onSurfaceReady={handleSurfaceReady}
            onGovernanceChange={handleGovernanceChange}
            onRouteAssetChange={(assetFqn) => openGovernanceWorkspace(assetFqn || "")}
            onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
            onOpenLineage={openLineageWorkspace}
            runtimeFeatureFlags={runtimeRolloutFlags}
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
          : ["discovery", "lineage", "governance", "audit", "taxonomy", "help", "inbox"].includes(surface)
            ? surface
            : ""
      }
      bootMessage={effectiveBootMessage}
      bootState={effectiveBootState}
      governanceInbox={shellGovernance.inbox}
      inboxOpen={shellInboxOpen}
      liveCatalogVisibleCount={liveCatalogVisibleCount}
      navigationState={navigationState}
      onBrowseCatalog={handleBrowseCatalog}
      onModuleChange={handleModuleSurfaceChange}
      onNavigationStateChange={handleNavigationStateChange}
      onSearchResultSelect={(assetFqn) => {
        setShellDiagnosticsOpen(false);
        setShellInboxOpen(false);
        openEntityWorkspace(assetFqn, "Overview");
      }}
      diagnosticsAvailable={diagnosticsAvailable}
      diagnosticsStatus={setupReadiness}
      diagnosticsOpen={shellDiagnosticsOpen}
      onToggleDiagnostics={handleToggleDiagnostics}
      onToggleInbox={handleToggleInbox}
      onInboxItemAction={handleInboxItemAction}
      searchSeedAssets={searchSeedAssets}
      shell={shell}
      visibleAssetSet={visibleAssetSet}
      workspaceAccess={workspaceAccess}
    >
      {content}
    </AppFrame>
  );
}
