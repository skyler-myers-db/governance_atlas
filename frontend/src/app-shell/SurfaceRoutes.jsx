/*
 * app-shell/SurfaceRoutes.jsx — the real react-router <Routes> tree (Wave B1),
 * generated against nav/routes.js ROUTES. The 13-branch if/else surface
 * switch in App.jsx is dead; each canonical route mounts a thin wrapper that
 * maps URL state + ShellContext + legacyAdapters onto exactly the props its
 * LEGACY surface genuinely consumes (dead props dropped — inventory in the
 * Wave B1 report). Alias resolution/redirects happen upstream in AppShell's
 * canonical gate (resolveUrl), so only canonical paths appear here.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

import { WorkspaceStateCard } from "../components/ShellStatePrimitives";
import { useGovernanceSummary } from "../hooks/useGovernanceSummary";
import { normalizeGovernancePayload } from "../lib/api";
import { setWorkspaceIntent } from "../lib/workspaceIntent";
import { useShellContext } from "./ShellContext.jsx";
import { useLegacyNavAdapters, compactDiscoveryFilterGroups } from "./legacyAdapters.js";

const DiscoveryWorkspace = lazy(() => import("../components/DiscoveryWorkspace"));
const AssetHubPage = lazy(() => import("../surfaces/asset/AssetHubPage.jsx"));
const LineageWorkspace = lazy(() => import("../components/LineageWorkspace"));
const GovernanceWorkspace = lazy(() => import("../components/GovernanceWorkspace"));
const AuditBrowserWorkspace = lazy(() => import("../components/AuditBrowserWorkspace"));
const TaxonomyWorkspace = lazy(() => import("../components/TaxonomyWorkspace"));
const HomePage = lazy(() => import("../surfaces/home/HomePage.jsx"));
const AdminWorkspace = lazy(() => import("../components/AdminWorkspace"));
const CapabilityDashboard = lazy(() => import("../components/CapabilityDashboard"));
const HelpPage = lazy(() => import("../components/HelpPage"));

function RouteFallback({ eyebrow, message }) {
  return (
    <section className="ga-shell-route-state">
      <WorkspaceStateCard eyebrow={eyebrow} loading message={message} title="Preparing the workspace surface." />
    </section>
  );
}

function safeDecode(segment = "") {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Terminal greedy path param (":fqn" patterns) via the RR splat. */
function useSplatParam() {
  const params = useParams();
  return safeDecode(String(params["*"] || ""));
}

/* ------------------------------------------------------------------ */
/* Home (Command Center)                                                */
/* ------------------------------------------------------------------ */

function HomeRoute() {
  // Wave-C2 flipped: the rebuilt Command Center is router-self-sufficient —
  // it calls useCommandCenter/useInsightsDashboard itself and renders real
  // anchors through the system refs contract, so no legacy adapter props or
  // bootstrap seed synthesis are threaded. (/insights is an alias of /home
  // in nav/routes.js; AppShell's canonical gate 301s it before this tree.)
  return (
    <Suspense fallback={<RouteFallback eyebrow="Loading home" message="Preparing your governance overview." />}>
      <HomePage />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* Discovery — URL state stays on /discovery only (legacy grammar:      */
/* ?q ?sort ?preview ?views(repeat) ?filters(JSON) + shortcut params)   */
/* ------------------------------------------------------------------ */

const DISCOVERY_SHORTCUT_TO_GROUP = {
  type: "types",
  types: "types",
  catalog: "catalogs",
  catalogs: "catalogs",
  domain: "domains",
  domains: "domains",
  tier: "tiers",
  tiers: "tiers",
  certification: "certifications",
  certifications: "certifications",
  sensitivity: "sensitivities",
  sensitivities: "sensitivities",
};

function parseDiscoverySearch(search) {
  const params = new URLSearchParams(search || "");
  let filterGroups = {};
  try {
    const parsed = JSON.parse(params.get("filters") || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) filterGroups = parsed;
  } catch {
    filterGroups = {};
  }
  // Shortcut params (?domain=Customer) merge into the grouped filters so
  // chip deep links from other surfaces auto-apply (legacy parseRouteState).
  const groups = { ...filterGroups };
  for (const [param, groupKey] of Object.entries(DISCOVERY_SHORTCUT_TO_GROUP)) {
    const values = params.getAll(param).filter(Boolean);
    if (!values.length) continue;
    groups[groupKey] = [...new Set([...(groups[groupKey] || []), ...values])];
  }
  return {
    query: params.get("q") || "",
    sort: params.get("sort") || "",
    preview: params.get("preview") || "",
    views: [...new Set([...params.getAll("views"), ...(params.get("view") ? [params.get("view")] : [])].filter(Boolean))],
    filterGroups: groups,
  };
}

function buildDiscoverySearch({ query, sort, preview, views, filterGroups }) {
  const params = new URLSearchParams();
  if (String(query || "").trim()) params.set("q", String(query).trim());
  if (String(sort || "").trim()) params.set("sort", String(sort).trim());
  if (String(preview || "").trim()) params.set("preview", String(preview).trim());
  for (const view of Array.isArray(views) ? views : []) {
    if (view) params.append("views", view);
  }
  const compact = compactDiscoveryFilterGroups(filterGroups);
  if (compact) params.set("filters", JSON.stringify(compact));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function DiscoveryRoute() {
  const shellCtx = useShellContext();
  const adapters = useLegacyNavAdapters();
  const location = useLocation();
  const routerNavigate = useNavigate();

  const routeState = useMemo(() => parseDiscoverySearch(location.search), [location.search]);

  // Route write-back: the workspace refines state in place → replace by
  // default; explicit fresh opens push (legacy push/replace discipline).
  const writeRoute = (patch, options = {}) => {
    const next = buildDiscoverySearch({ ...routeState, ...patch });
    const current = `${location.pathname}${location.search}`;
    const nextUrl = `/discovery${next}`;
    if (nextUrl === current && !options.fresh) return;
    routerNavigate(nextUrl, {
      replace: options.replace ?? true,
      state: { fresh: Boolean(options.fresh) },
    });
  };

  return (
    <Suspense
      fallback={
        <RouteFallback
          eyebrow="Loading discovery"
          message="Restoring the catalog, selected asset preview, and stacked filters."
        />
      }
    >
      <DiscoveryWorkspace
        bootstrap={shellCtx.bootstrap}
        effectiveBootMessage={shellCtx.effectiveBootMessage}
        effectiveBootState={shellCtx.effectiveBootState}
        effectiveVisibleCount={null}
        initialFilterGroups={routeState.filterGroups}
        initialQuery={routeState.query}
        initialSelectedAssetFqn={routeState.preview}
        initialSort={routeState.sort}
        initialViews={routeState.views}
        onRouteFilterGroupsChange={(groups, options) => writeRoute({ filterGroups: groups }, options)}
        onRoutePreviewChange={(preview, options) => writeRoute({ preview }, options)}
        onRouteQueryChange={(query, options) => writeRoute({ query }, options)}
        onRouteSortChange={(sort, options) => writeRoute({ sort }, options)}
        onRouteViewsChange={(views, options) => writeRoute({ views }, options)}
        onOpenAsset={adapters.onOpenAsset}
        onOpenGovernance={adapters.onOpenGovernance}
        onOpenLineage={adapters.onOpenLineage}
        querySeedFresh={Boolean(location.state && location.state.fresh === true)}
        querySeedKey={location.key || `${location.pathname}${location.search}`}
        sharedVisibleAssetSet={shellCtx.visibleAssetSet}
        runtimeFeatureFlags={shellCtx.runtimeFeatureFlags}
        workspaceAccess={shellCtx.surfaceWorkspaceAccess}
        atlasAiAvailable={shellCtx.atlasAiAvailable}
        atlasAiUnavailableReason={shellCtx.atlasAiUnavailableReason}
      />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* Asset 360 hub (/assets/:fqn)                                         */
/* ------------------------------------------------------------------ */

// ?tab= vocabulary → legacy EntityWorkspace tab labels. Lowercase names are
// the Wave B2 contract; capitalized legacy names pass through for old links.
const ASSET_TAB_LABELS = {
  overview: "Overview",
  schema: "Schema",
  columns: "Schema",
  preview: "Preview",
  sample: "Preview",
  lineage: "Lineage",
  queries: "Queries",
  usage: "Queries",
};

function AssetHubRoute() {
  const shellCtx = useShellContext();
  const adapters = useLegacyNavAdapters();
  const location = useLocation();
  const fqn = useSplatParam();

  const requestedTab = useMemo(() => {
    const raw = String(new URLSearchParams(location.search).get("tab") || "").trim();
    if (!raw) return "";
    return ASSET_TAB_LABELS[raw.toLowerCase()] || raw;
  }, [location.search]);

  // Stage ?tab= through the legacy workspaceIntent channel BEFORE the
  // workspace's first render (it peeks sessionStorage in a useState
  // initializer). Dies in Wave B2 when the rebuilt hub reads ?tab= itself.
  const [stagedFor, setStagedFor] = useState("");
  const stageKey = `${fqn}:${requestedTab}`;
  if (requestedTab && fqn && stagedFor !== stageKey) {
    setWorkspaceIntent("entityTab", fqn, requestedTab);
    setStagedFor(stageKey);
  }

  return (
    <Suspense
      fallback={
        <RouteFallback
          eyebrow="Loading metadata record"
          message="Hydrating the selected asset, schema, sample data, and lineage context."
        />
      }
    >
      {/* Wave-B2 flipped: the rebuilt hub is router-self-sufficient — it
          reads :fqn via useParams and ?tab=/?col= via useSurfaceParams, so
          no legacy adapter props are threaded. */}
      <AssetHubPage />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* Stewardship (absorbs /inbox as ?assignee=me)                         */
/* ------------------------------------------------------------------ */

function degradedGovernanceState(message) {
  return normalizeGovernancePayload({
    authoritative: false,
    provenance: { warnings: message ? [message] : [] },
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
      message: message || inbox?.message || "Governance summary is stale right now.",
      unreadCount: Number.isFinite(Number(inbox?.unreadCount))
        ? Math.max(0, Math.trunc(Number(inbox.unreadCount)))
        : 0,
      items: Array.isArray(inbox?.items) ? inbox.items : [],
    },
  });
}

function StewardshipRoute() {
  const shellCtx = useShellContext();
  const adapters = useLegacyNavAdapters();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const initialAssetFqn = new URLSearchParams(location.search).get("asset") || "";

  // Same query key/sections as the shell's bell → one shared cache entry.
  const governanceSummary = useGovernanceSummary({
    enabled: shellCtx.summariesEnabled,
    sections: ["inbox"],
  });
  // Surface-local live-governance overlay (was App's lifted bus): keeps
  // optimistic workbench mutations visible without wiping the summary seed.
  const [liveGovernance, setLiveGovernance] = useState(null);
  const governanceBase = liveGovernance || governanceSummary.data || null;
  const governance = governanceSummary.refreshError && governanceBase
    ? overlayGovernanceDegradedState(governanceBase, governanceSummary.refreshError)
    : governanceBase;
  const governanceRouteFallback =
    governance || degradedGovernanceState(governanceSummary.error || governanceSummary.refreshError);

  return (
    <Suspense
      fallback={
        <RouteFallback
          eyebrow="Loading governance"
          message="Preparing the stewardship work queue and request evidence."
        />
      }
    >
      <GovernanceWorkspace
        bootstrap={shellCtx.bootstrap}
        contextSeedAssets={shellCtx.contextSeedAssets}
        currentUser={{
          email: shellCtx.shell.userEmail || "",
          name: shellCtx.shell.userName || "",
          role: shellCtx.shell.role || "",
        }}
        initialAssetFqn={initialAssetFqn}
        governance={governanceRouteFallback}
        onGovernanceChange={(next) => {
          if (!next) return;
          setLiveGovernance((current) =>
            normalizeGovernancePayload({
              ...next,
              inbox: next.inbox || current?.inbox || governanceSummary.data?.inbox || null,
            }),
          );
        }}
        onRouteAssetChange={(assetFqn) => {
          const params = new URLSearchParams(location.search);
          if (assetFqn) params.set("asset", assetFqn);
          else params.delete("asset");
          const qs = params.toString();
          routerNavigate(`/stewardship${qs ? `?${qs}` : ""}`, { replace: false });
        }}
        onOpenAsset={(assetFqn) => adapters.onOpenAsset(assetFqn, "Overview")}
        onOpenLineage={adapters.onOpenLineage}
        runtimeFeatureFlags={shellCtx.runtimeFeatureFlags}
      />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* Glossary & CDEs                                                      */
/* ------------------------------------------------------------------ */

function GlossaryRoute() {
  const adapters = useLegacyNavAdapters();
  const termId = useSplatParam();

  // Re-stage the durable /glossary/:termId address through the LEGACY
  // pending-term handoff (sessionStorage + window event) that
  // TaxonomyWorkspace still consumes. app-shell is the sanctioned event
  // dispatcher; both markers die in Wave C4 when the surface reads the path.
  useEffect(() => {
    if (!termId || typeof window === "undefined") return;
    try {
      window.sessionStorage?.setItem("ga-pending-glossary-term", termId);
    } catch {
      /* The event below still covers the mounted case. */
    }
    window.dispatchEvent(new CustomEvent("ga:select-glossary-term", { detail: { term: termId } }));
  }, [termId]);

  return (
    <Suspense
      fallback={
        <RouteFallback
          eyebrow="Loading taxonomy"
          message="Preparing classifications, domains, data products, and column groups."
        />
      }
    >
      <TaxonomyWorkspace
        onOpenAsset={(assetFqn, nextTab = "Overview") => adapters.onOpenAsset(assetFqn, nextTab)}
        onOpenLineage={adapters.onOpenLineage}
      />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* Lineage Atlas                                                        */
/* ------------------------------------------------------------------ */

function LineageRoute() {
  const shellCtx = useShellContext();
  const adapters = useLegacyNavAdapters();
  const location = useLocation();
  const fqn = useSplatParam();

  // ?context= (Data Lineage vs Operational Context) → legacy workspaceIntent
  // channel; dies in Wave C7 when LineageWorkspace reads the param.
  const requestedContext = useMemo(
    () => String(new URLSearchParams(location.search).get("context") || "").trim(),
    [location.search],
  );
  const [stagedFor, setStagedFor] = useState("");
  const stageKey = `${fqn}:${requestedContext}`;
  if (requestedContext && fqn && stagedFor !== stageKey) {
    setWorkspaceIntent("lineageContext", fqn, requestedContext);
    setStagedFor(stageKey);
  }

  return (
    <Suspense
      fallback={
        <RouteFallback
          eyebrow="Loading lineage"
          message="Preparing the connected graph workspace and focus asset context."
        />
      }
    >
      <LineageWorkspace
        bootstrap={shellCtx.bootstrap}
        contextSeedAssets={shellCtx.contextSeedAssets}
        initialAssetFqn={fqn}
        onRouteAssetChange={(assetFqn, nextContext = "Data Lineage") =>
          adapters.onOpenLineage(assetFqn, nextContext)}
        onOpenGovernance={adapters.onOpenGovernance}
        onOpenAsset={adapters.onOpenAsset}
        runtimeFeatureFlags={shellCtx.runtimeFeatureFlags}
        sharedVisibleAssetSet={shellCtx.visibleAssetSet}
        workspaceAccess={shellCtx.surfaceWorkspaceAccess}
        userEmail={shellCtx.shell.userEmail || ""}
      />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence / Admin / Help                                              */
/* ------------------------------------------------------------------ */

function EvidenceRoute() {
  const shellCtx = useShellContext();
  const adapters = useLegacyNavAdapters();
  return (
    <Suspense
      fallback={
        <RouteFallback eyebrow="Loading audit browser" message="Preparing cross-entity audit events and filters." />
      }
    >
      <AuditBrowserWorkspace onOpenAsset={adapters.onOpenAsset} shell={shellCtx.shell} />
    </Suspense>
  );
}

function AdminRoute() {
  const shellCtx = useShellContext();
  const adapters = useLegacyNavAdapters();
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get("tab") || "";

  // /capabilities was folded into Control Center as ?tab=diagnostics. The
  // legacy AdminWorkspace has no diagnostics tab until Wave C6, so the
  // capability dashboard renders here for those deep links — nothing lost.
  if (tab === "diagnostics") {
    return (
      <Suspense
        fallback={
          <RouteFallback eyebrow="Loading capabilities" message="Preparing the operator capability snapshot." />
        }
      >
        <CapabilityDashboard onBack={() => adapters.navigate({ surface: "admin" })} />
      </Suspense>
    );
  }
  return (
    <Suspense
      fallback={
        <RouteFallback
          eyebrow="Loading admin control center"
          message="Preparing runtime, integration, and governance-store diagnostics."
        />
      }
    >
      {/* Legacy App passed onNavigate here too — AdminWorkspace never read
          it (dead prop, dropped). */}
      <AdminWorkspace shell={shellCtx.shell} />
    </Suspense>
  );
}

function HelpRoute() {
  const shellCtx = useShellContext();
  const adapters = useLegacyNavAdapters();
  return (
    <Suspense
      fallback={<RouteFallback eyebrow="Loading help" message="Preparing the in-app help and documentation page." />}
    >
      <HelpPage
        bootState={shellCtx.effectiveBootState}
        onBack={() => adapters.openDiscovery({}, { fresh: false })}
      />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/* The tree                                                             */
/* ------------------------------------------------------------------ */

// Canonical paths only — AppShell's canonical gate (resolveUrl) has already
// 301'd every alias in nav/routes.js before this tree renders. Terminal
// `:fqn`/`:termId` params are greedy in the route table, so they mount as RR
// splats and the wrappers decode them (FQNs may carry "/" segments).
export function SurfaceRoutes() {
  return (
    <Routes>
      <Route element={<HomeRoute />} path="/home" />
      <Route element={<DiscoveryRoute />} path="/discovery" />
      <Route element={<AssetHubRoute />} path="/assets/*" />
      <Route element={<StewardshipRoute />} path="/stewardship" />
      <Route element={<GlossaryRoute />} path="/glossary/*" />
      <Route element={<GlossaryRoute />} path="/glossary" />
      <Route element={<LineageRoute />} path="/lineage/*" />
      <Route element={<LineageRoute />} path="/lineage" />
      <Route element={<EvidenceRoute />} path="/evidence" />
      <Route element={<AdminRoute />} path="/admin" />
      <Route element={<HelpRoute />} path="/help" />
      {/* resolveUrl redirects unknown paths too, but keep a terminal safety
          net so the router can never render a blank screen. */}
      <Route element={<Navigate replace to="/home" />} path="*" />
    </Routes>
  );
}

export default SurfaceRoutes;
