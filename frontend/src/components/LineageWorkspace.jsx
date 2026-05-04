import { useEffect, useMemo, useState } from "react";
import { LineageCanvasV2 } from "./lineage-v2/LineageCanvasV2";
import { useLineageGraphV2 } from "./lineage-v2/useLineageGraphV2";
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
  const certified = focus?.isCertified;
  const classification = focus?.classification;
  const owner = focus?.owners?.[0]?.displayName || focus?.owners?.[0]?.email;
  const upstream = (focus && asset)
    ? Number(asset?.lineage?.upstreamCount ?? 0)
    : null;
  const downstream = (focus && asset)
    ? Number(asset?.lineage?.downstreamCount ?? 0)
    : null;
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
          <FocusChip tone={focus?.freshness ? "info" : "neutral"}>
            {focus?.freshness ? `Freshness · ${focus.freshness}` : "Freshness unavailable"}
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

function LineageDetailRail({ graph, focus, onOpenAsset, onSelectAsset }) {
  const focusId = focus?.id;
  const sources = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.target === focusId)
        .map((edge) => graph.nodes.find((node) => node.id === edge.source))
        .filter(Boolean),
    [graph.edges, graph.nodes, focusId],
  );
  const consumers = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.source === focusId)
        .map((edge) => graph.nodes.find((node) => node.id === edge.target))
        .filter(Boolean),
    [graph.edges, graph.nodes, focusId],
  );

  return (
    <aside className="ga-lineage-v2-rail">
      <div className="ga-lineage-v2-rail-head">
        <span className="ga-lineage-eyebrow">Lineage Details</span>
        <h2>{focus?.label || "Lineage Details"}</h2>
        {focus?.subtitle ? <small>{focus.subtitle}</small> : null}
      </div>

      {focus ? (
        <div className="ga-lineage-v2-rail-stats">
          <div>
            <span>Last refresh</span>
            <strong>{focus.freshness || "Unavailable"}</strong>
          </div>
          <div>
            <span>Rows</span>
            <strong>{focus.rowCount || "Unavailable"}</strong>
          </div>
          <div>
            <span>Owner</span>
            <strong>
              {focus.owners?.[0]?.displayName || focus.owners?.[0]?.email || "Unavailable"}
            </strong>
          </div>
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
          <span className="ga-lineage-v2-rail-count">{focus?.recentActivityCount || 0}</span>
        </header>
        {focus?.recentActivity?.length ? (
          <ul>
            {focus.recentActivity.map((event, index) => (
              <li key={`${event.id || event.kind || "event"}-${index}`}>
                <strong>{event.kind || event.title || "Lineage event"}</strong>
                <span>{event.timestamp || event.observedAt || ""}</span>
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

  const handleSelectAsset = (nextAssetFqn) => {
    onNavigationStateChange?.(true, "Refocusing lineage…");
    onRouteAssetChange?.(nextAssetFqn, "Data Lineage");
  };

  const handleClearFocus = () => {
    setAssetSearchQuery("");
    onRouteAssetChange?.("", "Data Lineage");
  };

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

  // Track whether we've ever shown a populated canvas this session. Once
  // true, never fall back to the error UI — the canvas's own sticky-graph
  // logic carries us across the transition. This kills the "click =
  // full reload" perception the user reported.
  useEffect(() => {
    if (graph.nodes.length > 0 && !canvasEverRendered) {
      setCanvasEverRendered(true);
    }
  }, [graph.nodes.length, canvasEverRendered]);

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
            onFocusChange={handleSelectAsset}
          />
        </div>
        <LineageDetailRail
          graph={graph}
          focus={graph.focus}
          onOpenAsset={onOpenAsset}
          onSelectAsset={handleSelectAsset}
        />
      </div>
    </section>
  );
}
