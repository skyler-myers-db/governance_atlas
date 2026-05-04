import { useEffect, useMemo, useState } from "react";
import { LineageCanvasV2 } from "./lineage-v2/LineageCanvasV2";
import { useLineageGraphV2 } from "./lineage-v2/useLineageGraphV2";
import { useLineageNodeHeaders } from "./lineage-v2/useLineageNodeHeaders";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
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
import { consumeWorkspaceIntent, peekWorkspaceIntent, setWorkspaceIntent } from "../lib/workspaceIntent";

/**
 * LineageWorkspace — full-page lineage surface.
 *
 * Hosts the rebuilt LineageCanvasV2 plus a slim chrome layer:
 *   - Page hero (Lineage Atlas eyebrow, focus FQN, evidence chips)
 *   - Empty-state hero (centered search + node-type legend) when no
 *     asset is selected
 *   - Right-side LINEAGE DETAILS rail showing focus metadata, sources,
 *     consumers, recent activity (when an asset is selected)
 *   - Asset search overlay for re-anchoring focus
 *
 * Replaces the legacy NorthStarLineageExplorer / LineageStage. The
 * canvas itself is built on React Flow with BFS-from-focus column
 * layout, docked controls, separated zoom/pan, hover-trace dimming,
 * and full-metadata node cards.
 */

function LineageHeroEmpty({ onSearch, query, onQueryChange, results, loading }) {
  return (
    <section className="ga-lineage-explorer ga-lineage-explorer-empty" data-testid="lineage-northstar-explorer">
      <div className="ga-lineage-empty-hero">
        <div className="ga-lineage-empty-card">
          <span className="ga-lineage-eyebrow">Lineage Atlas</span>
          <h1>Trace the path of any governed asset</h1>
          <p>
            Search for a Unity Catalog asset to open its lineage graph. Atlas
            walks <code>system.access.table_lineage</code> outward from the focus
            node and renders every actor-visible upstream and downstream hop.
          </p>
          <div className="ga-lineage-empty-search">
            <input
              autoFocus
              className="gh-input"
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results?.[0]) {
                  event.preventDefault();
                  onSearch(results[0].fqn);
                }
              }}
              placeholder="Search for an asset"
              value={query}
            />
            <div className="ga-lineage-empty-search-list">
              {loading ? (
                <div className="ga-lineage-empty-search-status">Searching assets…</div>
              ) : results?.length ? (
                results.slice(0, 8).map((candidate) => (
                  <button
                    className="gh-lineage-search-row"
                    key={candidate.fqn}
                    onClick={() => onSearch(candidate.fqn)}
                    type="button"
                  >
                    <span>{candidate.name}</span>
                    <span>{assetPathLabel(candidate)}</span>
                  </button>
                ))
              ) : query ? (
                <div className="ga-lineage-empty-search-status">No matching assets.</div>
              ) : (
                <div className="ga-lineage-empty-search-status">Start typing to load a graph.</div>
              )}
            </div>
          </div>
          <div className="ga-lineage-empty-legend" aria-label="Node types">
            <strong>Node types</strong>
            {[
              ["table", "Table"],
              ["pipeline", "Pipeline"],
              ["job", "Job"],
              ["notebook", "Notebook"],
              ["saved-query", "Saved query"],
              ["dashboard", "Dashboard"],
              ["model", "Model"],
              ["udf", "UDF"],
              ["volume", "Volume"],
              ["restricted", "Restricted"],
            ].map(([type, label]) => (
              <span data-node-type={type} key={type}>{label}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FocusChip({ tone, children, title }) {
  return (
    <span className={`ga-lineage-v2-chip tone-${tone || "neutral"}`} title={title || undefined}>
      {children}
    </span>
  );
}

function LineageHero({ asset, focusFqn, focus, hydrating, edgeCount, onClear }) {
  // Source the chips from the asset detail when available — the
  // lineage payload's `focus` node is a thin stub from
  // system.access.table_lineage and doesn't carry freshness / owner /
  // certification by itself. The asset detail (already fetched by the
  // workspace via useAssetDetail) is the authoritative source for
  // these fields, matching what the rail and the focus card show.
  const certified =
    asset?.certification === "Certified" ||
    asset?.isCertified ||
    focus?.isCertified;
  const classification = asset?.sensitivity || focus?.classification || "";
  const ownerEntry =
    (Array.isArray(asset?.owners) && asset.owners[0]) ||
    (Array.isArray(focus?.owners) && focus.owners[0]) ||
    null;
  const owner =
    ownerEntry?.displayName ||
    ownerEntry?.email ||
    ownerEntry?.name ||
    "";
  // Freshness derived from updatedAt the same way the rail does, so
  // hero and rail stay consistent.
  const updatedAtIso =
    asset?.updatedAt ||
    asset?.lastRefresh ||
    asset?.refreshedAt ||
    "";
  const freshness = (() => {
    if (!updatedAtIso) return asset?.freshness || focus?.freshness || "";
    const ts = Date.parse(updatedAtIso);
    if (!Number.isFinite(ts)) return asset?.freshness || focus?.freshness || "";
    const deltaMs = Date.now() - ts;
    if (deltaMs < 0) return "future";
    const minutes = Math.round(deltaMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.round(days / 365);
    return `${years}y ago`;
  })();
  return (
    <header className="ga-lineage-v2-hero">
      <div>
        <span className="ga-lineage-eyebrow">Lineage Atlas</span>
        <h1>{focusFqn}</h1>
        <p>Permission-aware lineage from actor-visible upstream assets through to permitted downstream consumers.</p>
        <div className="ga-lineage-v2-hero-chips">
          <FocusChip tone={certified ? "good" : "neutral"}>
            {certified ? "Certified" : "Certification unavailable"}
          </FocusChip>
          <FocusChip tone={freshness ? "info" : "neutral"}>
            {freshness ? `Freshness · ${freshness}` : "Freshness unavailable"}
          </FocusChip>
          <FocusChip tone={classification ? "warn" : "neutral"} title={classification}>
            {classification || "Sensitivity unavailable"}
          </FocusChip>
          <FocusChip tone={owner ? "info" : "neutral"} title={owner}>
            {owner ? `Owner · ${owner}` : "Owner unavailable"}
          </FocusChip>
          {edgeCount !== null ? (
            <FocusChip tone="info">
              {edgeCount} {edgeCount === 1 ? "edge" : "edges"}
            </FocusChip>
          ) : null}
          {hydrating ? <FocusChip tone="info">Hydrating…</FocusChip> : null}
        </div>
      </div>
      {focusFqn ? (
        <button className="gh-tertiary-button" onClick={onClear} type="button">
          ← Clear lineage focus
        </button>
      ) : null}
    </header>
  );
}

function LineageDetailRail({
  graph,
  focus,
  asset,
  selectedNode,
  onOpenAsset,
  onSelectAsset,
  onReAnchor,
  isFocusSelected,
}) {
  // The "subject" of the rail is whatever node the user has currently
  // clicked on the canvas (selectedNode). When the URL focus node IS the
  // selected node we have richer asset-detail data available (from the
  // workspace-level useAssetDetail call); otherwise we fall back to what
  // the lineage payload itself surfaced about the selected node, plus
  // anything the per-node header batch fetch retrieved.
  const subject = selectedNode || focus;
  const subjectId = subject?.id;
  const sources = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.target === subjectId)
        .map((edge) => graph.nodes.find((node) => node.id === edge.source))
        .filter(Boolean),
    [graph.edges, graph.nodes, subjectId],
  );
  const consumers = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.source === subjectId)
        .map((edge) => graph.nodes.find((node) => node.id === edge.target))
        .filter(Boolean),
    [graph.edges, graph.nodes, subjectId],
  );
  // Only use the workspace-level asset detail when the user has the URL
  // focus selected. For OTHER nodes, we don't have the rich asset detail
  // loaded, so the rail shows what's available from the lineage payload
  // and per-node header batch (which the canvas card already renders).
  const focusedAsset = isFocusSelected ? asset : null;
  // The lineage payload doesn't carry per-node rows/freshness/owners — those
  // live on the asset detail endpoint (already fetched by the workspace via
  // useAssetDetail). Pull them off the focus asset so the rail surfaces real
  // data instead of "Unavailable" for all three stats. Falls through to the
  // pre-formatted lineage-payload values when asset detail hasn't loaded yet.
  // The asset header endpoint exposes a raw `updatedAt` ISO timestamp; we
  // turn that into a relative "Xh ago" label to match UC's lineage panel.
  const updatedAtIso =
    focusedAsset?.updatedAt ||
    focusedAsset?.lastRefresh ||
    focusedAsset?.refreshedAt ||
    focusedAsset?.detail?.updatedAt ||
    "";
  const updatedAtRelative = (() => {
    if (!updatedAtIso) return "";
    const ts = Date.parse(updatedAtIso);
    if (!Number.isFinite(ts)) return "";
    const deltaMs = Date.now() - ts;
    if (deltaMs < 0) return "future";
    const minutes = Math.round(deltaMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.round(days / 365);
    return `${years}y ago`;
  })();
  const detailFreshness =
    updatedAtRelative ||
    focusedAsset?.lastRefreshDisplay ||
    focusedAsset?.freshness ||
    focusedAsset?.lastRefresh ||
    focusedAsset?.refreshedAt ||
    focusedAsset?.detail?.freshness ||
    "";
  const detailRowCount =
    focusedAsset?.rowCountDisplay ||
    focusedAsset?.rowCount ||
    focusedAsset?.rows;
  const detailOwner =
    focusedAsset?.ownerDisplayName ||
    focusedAsset?.owner ||
    focusedAsset?.steward ||
    (Array.isArray(focusedAsset?.owners)
      ? focusedAsset.owners[0]?.displayName ||
        focusedAsset.owners[0]?.email ||
        focusedAsset.owners[0]?.name
      : "");
  // Backend returns "—" / "Unassigned" / "N/A" / etc. for genuinely
  // unknown values (e.g. managementType is "—" for views, since UC's
  // MANAGED/EXTERNAL distinction only applies to tables). The rail
  // displays these only when meaningful; otherwise we drop the field
  // entirely to avoid the literal "— · View" rendering bug the user
  // flagged on finance_portfolio_exposure.
  const RAIL_PLACEHOLDERS = new Set([
    "—",
    "-",
    "–",
    "n/a",
    "na",
    "unknown",
    "unassigned",
    "unavailable",
    "none",
    "null",
  ]);
  const railMeaningful = (value) => {
    if (value == null) return "";
    const trimmed = String(value).trim();
    if (!trimmed) return "";
    if (RAIL_PLACEHOLDERS.has(trimmed.toLowerCase())) return "";
    return trimmed;
  };
  const detailSize = railMeaningful(focusedAsset?.size);
  const detailFiles = railMeaningful(focusedAsset?.files);
  const detailManagement = railMeaningful(focusedAsset?.managementType);
  const detailObjectType = railMeaningful(focusedAsset?.objectType);
  const detailType =
    [detailManagement, detailObjectType].filter(Boolean).join(" · ") || "";
  const detailActivity = Array.isArray(focusedAsset?.recentActivity)
    ? focusedAsset.recentActivity
    : Array.isArray(focusedAsset?.activity)
    ? focusedAsset.activity
    : [];
  const recentActivity = detailActivity.length ? detailActivity : subject?.recentActivity || [];
  const recentActivityCount = recentActivity.length || subject?.recentActivityCount || 0;
  const columnLineageCount = Array.isArray(graph.columnEdges) ? graph.columnEdges.length : 0;

  return (
    <aside className="ga-lineage-v2-rail">
      <div className="ga-lineage-v2-rail-head">
        <span className="ga-lineage-eyebrow">
          {isFocusSelected ? "Lineage Details" : "Selected Node"}
        </span>
        <h2>{subject?.label || "Lineage Details"}</h2>
        {subject?.subtitle ? <small>{subject.subtitle}</small> : null}
        {!isFocusSelected && subject?.fqn ? (
          <button
            className="ga-lineage-v2-rail-reanchor"
            onClick={() => onReAnchor?.(subject.fqn)}
            type="button"
            title="Re-anchor the canvas on this node (refetches lineage)"
          >
            ↻ Re-anchor lineage on this node
          </button>
        ) : null}
      </div>

      {subject ? (
        <div className="ga-lineage-v2-rail-stats">
          <div>
            <span>Last refresh</span>
            <strong>{detailFreshness || subject.freshness || "Unavailable"}</strong>
          </div>
          <div>
            <span>Rows</span>
            <strong>
              {(() => {
                if (detailRowCount != null && detailRowCount !== "") {
                  const num = Number(detailRowCount);
                  if (Number.isFinite(num)) return num.toLocaleString();
                  // Non-numeric (e.g. already-formatted "1.2M") — render as-is
                  return String(detailRowCount);
                }
                return subject.rowCount || "Unavailable";
              })()}
            </strong>
          </div>
          <div>
            <span>Owner</span>
            <strong>
              {detailOwner ||
                subject.owners?.[0]?.displayName ||
                subject.owners?.[0]?.email ||
                "Unavailable"}
            </strong>
          </div>
          {detailType ? (
            <div>
              <span>Type</span>
              <strong>{detailType}</strong>
            </div>
          ) : null}
          {detailSize ? (
            <div>
              <span>Size</span>
              <strong>
                {detailSize}
                {detailFiles ? ` · ${detailFiles} files` : ""}
              </strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {columnLineageCount > 0 ? (
        <div className="ga-lineage-v2-rail-section">
          <header>
            <span>Column lineage</span>
            <span className="ga-lineage-v2-rail-count">{columnLineageCount}</span>
          </header>
          <p className="ga-lineage-v2-rail-empty">
            {columnLineageCount} column-level link{columnLineageCount === 1 ? "" : "s"}{" "}
            traced through this asset (upstream + downstream).
          </p>
        </div>
      ) : null}

      <div className="ga-lineage-v2-rail-section">
        <header>
          <span>Sources</span>
          <span className="ga-lineage-v2-rail-count">{sources.length}</span>
        </header>
        {sources.length ? (
          <ul>
            {sources.map((node) => (
              <li key={node.id}>
                <button
                  className="ga-lineage-v2-rail-row"
                  disabled={node.isOpenable === false}
                  onClick={() => node.isOpenable !== false && onSelectAsset(node.fqn)}
                  type="button"
                >
                  <strong>{node.label}</strong>
                  <span>{node.subtitle}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ga-lineage-v2-rail-empty">No source-system details returned.</p>
        )}
      </div>

      <div className="ga-lineage-v2-rail-section">
        <header>
          <span>Consumers</span>
          <span className="ga-lineage-v2-rail-count">{consumers.length}</span>
        </header>
        {consumers.length ? (
          <ul>
            {consumers.map((node) => (
              <li key={node.id}>
                <button
                  className="ga-lineage-v2-rail-row"
                  disabled={node.isOpenable === false}
                  onClick={() => node.isOpenable !== false && onSelectAsset(node.fqn)}
                  type="button"
                >
                  <strong>{node.label}</strong>
                  <span>{node.subtitle}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ga-lineage-v2-rail-empty">No downstream consumer details returned.</p>
        )}
      </div>

      <div className="ga-lineage-v2-rail-section">
        <header>
          <span>Recent activity</span>
          <span className="ga-lineage-v2-rail-count">{recentActivityCount}</span>
        </header>
        {recentActivity.length ? (
          <ul>
            {recentActivity.slice(0, 5).map((event, index) => (
              <li key={`${event.id || event.kind || "event"}-${index}`}>
                <strong>{event.kind || event.title || event.action || "Activity"}</strong>
                <span>{event.timestamp || event.observedAt || event.at || ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ga-lineage-v2-rail-empty">No recent lineage activity returned.</p>
        )}
      </div>

      {focus?.fqn ? (
        <div className="ga-lineage-v2-rail-actions">
          <button
            className="gh-tertiary-button"
            onClick={() => onOpenAsset?.(focus.fqn, "Overview")}
            type="button"
          >
            Open asset record
          </button>
        </div>
      ) : null}
    </aside>
  );
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
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  // selectedNodeFqn is CLIENT-SIDE state — it tracks which node the user
  // last clicked on the canvas. It is NOT the URL focus. The URL focus
  // (focusAssetFqn) drives the lineage HTTP query; selectedNodeFqn drives
  // ONLY the rail's "subject" and a visual highlight on the card.
  // Decoupling these two means clicking a node no longer triggers a
  // refetch — the user perceives an instant highlight + rail update
  // instead of a full graph reload. To genuinely re-anchor the lineage
  // (refetch the canvas centered on a different node), the user must
  // explicitly click the "Re-anchor lineage on this node" button in the
  // rail, which calls handleReAnchor below and DOES change the URL.
  const [selectedNodeFqn, setSelectedNodeFqn] = useState(focusAssetFqn);
  // Once we've successfully rendered a canvas with at least one node, keep
  // the workspace in canvas mode for the rest of the session. Without this,
  // a focus-switch click triggers a brief moment where the new asset's
  // payload hasn't returned yet AND bootstrap.capabilities.tableLineage is
  // marked unavailable — the workspace would flip to the "Lineage
  // unavailable" error UI mid-transition, unmount the canvas, then remount
  // when nodes arrive. The user perceives this as a full reload. We pin
  // the canvas open so the only thing that swaps is the graph data inside.
  const [canvasEverRendered, setCanvasEverRendered] = useState(false);

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
  // Always try to fetch when we have a focused asset — bootstrap can
  // under-report capability (e.g. when its workspace-wide check hasn't
  // hydrated) even though /api/lineage will return real edges. The API
  // itself is the authoritative source of "is this asset openable"; we
  // gate the canvas on bootstrap only as a fallback when we have nothing.
  const lineageEnabled = Boolean(focusAssetFqn);

  const graph = useLineageGraphV2(focusAssetFqn || "", { enabled: lineageEnabled });
  // Batch-fetch the asset header for every visible node so each card can
  // render UC-grade per-node detail (size, freshness, type, owner). The
  // lineage payload itself doesn't carry these fields — they live on
  // /api/assets/<fqn>?sections=header — so without this hook every card
  // would only show the bare "Table" footer the lineage API returned,
  // which is exactly the gap the user flagged vs Databricks UC's native
  // lineage UX. The hook caches results module-wide and caps parallel
  // fetches at 8, so we don't fan out 20 warehouse calls per click.
  const lineageNodeFqns = useMemo(
    () => (graph.nodes || []).map((node) => node.fqn).filter(Boolean),
    [graph.nodes],
  );
  const { headers: nodeHeaders } = useLineageNodeHeaders(lineageNodeFqns);
  const asset =
    assetDetail.detail ||
    (focusAssetFqn && assetDetail.loading ? seeded.summary : null);
  const assetSearch = useAssetSearch(
    assetSearchQuery,
    assetSearchQuery.trim().length >= 2,
    seedAssets,
  );

  // Persist + restore the user's "lineage context" (Data Lineage / Operational
  // Context) across navigations using the workspaceIntent helper, matching
  // the legacy LineageWorkspace contract that other surfaces relied on.
  useEffect(() => {
    setAssetSearchQuery("");
    // When the URL focus changes (e.g. user re-anchored or navigated in),
    // reset the locally selected node back to the URL focus so the rail
    // and highlight start aligned with the new graph.
    setSelectedNodeFqn(focusAssetFqn);
  }, [focusAssetFqn]);

  useEffect(() => {
    if (initialAssetFqn) {
      const ctx = peekWorkspaceIntent("lineageContext", initialAssetFqn, "Data Lineage");
      consumeWorkspaceIntent("lineageContext", initialAssetFqn, "Data Lineage");
      // Echo the consumed intent back into session storage so a refresh
      // restores the same context.
      setWorkspaceIntent("lineageContext", initialAssetFqn, ctx);
    }
  }, [initialAssetFqn]);

  useEffect(() => {
    if (!focusAssetFqn) {
      onSurfaceReady?.();
      return;
    }
    if (!workspaceAccessResolved) return;
    if (!graph.loading && (!assetDetail.loading || assetDetail.detail?.fqn === focusAssetFqn)) {
      onSurfaceReady?.();
    }
  }, [
    assetDetail.detail?.fqn,
    assetDetail.loading,
    focusAssetFqn,
    graph.loading,
    onSurfaceReady,
    workspaceAccessResolved,
  ]);

  // Click handler for in-canvas node selection. The user wants UC-style
  // seamless navigation: clicking a node should INSTANTLY shift the
  // visual focus + rail subject (no waiting), AND fetch that node's
  // lineage in the background to ADD any new neighbors to the canvas.
  // The canvas's accumulatedGraph state merges incoming payloads with
  // the existing visible set instead of replacing — so the graph
  // extends outward as the user explores rather than blanking and
  // rebuilding on every click.
  //
  // Both effects fire together:
  //   1. setSelectedNodeFqn — instant visual focus shift + rail update
  //   2. onRouteAssetChange — URL change → useLineage refetches the
  //      new fqn → canvas merges new nodes/edges into accumulatedGraph
  const handleNodeSelect = (nextNodeFqn) => {
    if (!nextNodeFqn) return;
    setSelectedNodeFqn(nextNodeFqn);
    if (nextNodeFqn !== focusAssetFqn) {
      onRouteAssetChange?.(nextNodeFqn, "Data Lineage");
    }
  };

  // Kept for the rail's explicit "Re-anchor lineage on this node"
  // button as a backup affordance when the user wants to force a
  // fresh fetch (e.g. cache-bust). Identical to handleNodeSelect now
  // that click does both selection + URL change.
  const handleReAnchor = (nextNodeFqn) => {
    if (!nextNodeFqn) return;
    setSelectedNodeFqn(nextNodeFqn);
    onRouteAssetChange?.(nextNodeFqn, "Data Lineage");
  };

  // Used by the empty-state hero search — first-time anchor, no
  // current focus to be smooth about.
  const handleSelectAsset = (nextAssetFqn) => {
    onRouteAssetChange?.(nextAssetFqn, "Data Lineage");
  };

  const handleClearFocus = () => {
    setAssetSearchQuery("");
    onRouteAssetChange?.("", "Data Lineage");
  };

  // Track whether we've ever shown a populated canvas this session. Once
  // true, never fall back to the error UI — the canvas's own sticky-graph
  // logic carries us across the transition. This kills the "click =
  // full reload" perception the user reported.
  // CRITICAL: this hook MUST run on every render including the no-focus
  // empty state below — putting it after an early return causes React
  // error #310 ("Rendered fewer hooks than expected") whenever the user
  // navigates from the empty state to a focused asset, because the hook
  // count would change between renders.
  useEffect(() => {
    if (graph.nodes.length > 0 && !canvasEverRendered) {
      setCanvasEverRendered(true);
    }
  }, [graph.nodes.length, canvasEverRendered]);

  if (!focusAssetFqn) {
    return (
      <section className="gh-lineage-shell">
        <LineageHeroEmpty
          loading={assetSearch.loading}
          onQueryChange={setAssetSearchQuery}
          onSearch={handleSelectAsset}
          query={assetSearchQuery}
          results={assetSearch.assets}
        />
      </section>
    );
  }

  // Bootstrap can report lineage "unavailable" (e.g. "No lineage-observed
  // catalogs are detected yet") for an asset that the live /api/lineage
  // endpoint *does* return real edges for — the capability check uses a
  // narrower workspace-wide signal than the per-asset query. So if we
  // actually have nodes back from the API, render the canvas regardless
  // of bootstrap pessimism. Only block when both capability is off AND
  // the API returned nothing AND we've never rendered the canvas before.
  if (!lineageSurfaceAvailable && !graph.nodes.length && !canvasEverRendered) {
    return (
      <section className="gh-lineage-shell">
        <LineageHero
          asset={asset}
          edgeCount={null}
          focus={null}
          focusFqn={focusAssetFqn}
          hydrating={false}
          onClear={handleClearFocus}
        />
        <div className="ga-lineage-v2-canvas-state ga-lineage-v2-canvas-state-error">
          <strong>Lineage unavailable</strong>
          <span>{lineageSurfaceUnavailableReason}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="gh-lineage-shell" data-testid="lineage-northstar-explorer">
      <LineageHero
        asset={asset}
        edgeCount={graph.edges.length}
        focus={graph.focus}
        focusFqn={focusAssetFqn}
        hydrating={graph.hydrating}
        onClear={handleClearFocus}
      />
      <div className="ga-lineage-v2-workbench">
        <div className="ga-lineage-v2-workbench-canvas">
          <LineageCanvasV2
            error={graph.error}
            focusId={focusAssetFqn}
            graph={graph}
            hydrating={graph.hydrating}
            nodeHeaders={nodeHeaders}
            onFocusChange={handleNodeSelect}
            selectedNodeFqn={selectedNodeFqn}
          />
        </div>
        <LineageDetailRail
          asset={asset}
          graph={graph}
          focus={graph.focus}
          isFocusSelected={!selectedNodeFqn || selectedNodeFqn === focusAssetFqn}
          selectedNode={
            selectedNodeFqn
              ? graph.nodes.find((n) => n.fqn === selectedNodeFqn) || null
              : null
          }
          onOpenAsset={onOpenAsset}
          onReAnchor={handleReAnchor}
          onSelectAsset={handleNodeSelect}
        />
      </div>
    </section>
  );
}
