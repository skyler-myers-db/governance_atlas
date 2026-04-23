import { useEffect, useState } from "react";
import { displayObjectType } from "../lib/assetPresentation";
import { Breadcrumbs } from "./primitives/Breadcrumbs";
import LineageGraph from "./LineageGraph";
import { EmptyStateBlock, InlineStatusBanner } from "./ShellStatePrimitives";

// The full lineage pull hits `system.access.table_lineage` + column
// lineage — a serverless warehouse query path that can take 30–60s
// cold. A generic spinner makes that feel broken; an honest skeleton
// with escalating messaging makes it feel like progress.
function LineageLoadingSkeleton({ asset }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 4000);
    const t2 = setTimeout(() => setPhase(2), 12000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [asset?.fqn]);

  const messages = [
    {
      title: "Assembling the lineage graph",
      message:
        "Querying system.access.table_lineage for upstream + downstream producers.",
    },
    {
      title: "Warehouse warming up",
      message:
        "Serverless SQL warehouses take 30–90 seconds to start from idle. Hang on — the graph will fill in as soon as the warehouse responds.",
    },
    {
      title: "Still fetching",
      message:
        "Large dependency graphs (2-hop, 50-edge cap) take longer to materialize. Column-level lineage is being pulled in parallel.",
    },
  ];
  const state = messages[Math.min(phase, messages.length - 1)];

  return (
    <div className="gh-lineage-skeleton" aria-busy="true" aria-live="polite">
      <div className="gh-lineage-skeleton-copy">
        <div className="gh-eyebrow">Lineage</div>
        <h3>{state.title}</h3>
        <p>{state.message}</p>
      </div>
      <div className="gh-lineage-skeleton-graph" aria-hidden="true">
        <span className="gh-lineage-skeleton-node is-upstream" />
        <span className="gh-lineage-skeleton-node is-upstream" />
        <span className="gh-lineage-skeleton-node is-focus" />
        <span className="gh-lineage-skeleton-node is-downstream" />
        <span className="gh-lineage-skeleton-node is-downstream" />
        <span className="gh-lineage-skeleton-node is-downstream" />
      </div>
    </div>
  );
}

function selectGraph(graphBundle, context, modeFlags) {
  if (!graphBundle) return null;
  // Round 18 defect #7: Data + Operational are independent on/off flags
  // (the operator needs to toggle each on the same screen). When both
  // are active we merge the two graphs, de-duping nodes by id so the
  // focus node never double-renders; edges are preserved with their
  // original kinds so edge detail rows still label correctly.
  const dataOn = modeFlags?.data !== false;
  const operationalOn = Boolean(modeFlags?.operational);

  // Fallback to the legacy `context` string when explicit flags aren't
  // passed yet (older callers, older test fixtures).
  const legacyOperational = context === "Operational Context";

  if (!modeFlags) {
    return legacyOperational ? graphBundle.operational : graphBundle.data;
  }

  if (dataOn && operationalOn) {
    const base = graphBundle.data || { nodes: [], edges: [] };
    const extra = graphBundle.operational || { nodes: [], edges: [] };
    const seenNodes = new Set();
    const nodes = [];
    for (const node of [...(base.nodes || []), ...(extra.nodes || [])]) {
      const id = node?.id;
      if (!id || seenNodes.has(id)) continue;
      seenNodes.add(id);
      nodes.push(node);
    }
    const seenEdges = new Set();
    const edges = [];
    for (const edge of [...(base.edges || []), ...(extra.edges || [])]) {
      const id = edge?.id || `${edge?.source}->${edge?.target}`;
      if (seenEdges.has(id)) continue;
      seenEdges.add(id);
      edges.push(edge);
    }
    return { ...base, nodes, edges };
  }
  if (operationalOn) return graphBundle.operational;
  if (dataOn) return graphBundle.data;
  return { nodes: [], edges: [] };
}

function fallbackStats(graphBundle, context) {
  const graph = selectGraph(graphBundle, context);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const focusId =
    nodes.find((node) => node?.role === "focus")?.id ||
    nodes.find((node) => node?.assetFqn)?.id ||
    "";

  if (!focusId) {
    return {
      upstreamCount: 0,
      downstreamCount: 0,
      operationalProducerCount: 0,
      operationalConsumerCount: 0,
    };
  }

  if (context === "Operational Context") {
    return {
      upstreamCount: 0,
      downstreamCount: 0,
      operationalProducerCount: edges.filter((edge) => edge.target === focusId).length,
      operationalConsumerCount: edges.filter((edge) => edge.source === focusId).length,
    };
  }

  return {
    upstreamCount: edges.filter((edge) => edge.target === focusId).length,
    downstreamCount: edges.filter((edge) => edge.source === focusId).length,
    operationalProducerCount: 0,
    operationalConsumerCount: 0,
  };
}

// T10.A — humanize a raw timestamp so the header chip reads "2 hrs ago"
// instead of a raw ISO string. Today the lineage payload rarely exposes a
// `generatedAt` — so we fall through to the asset's `updatedAt` field when
// it's present, and render nothing if neither is available (hiding the chip
// rather than writing "Unassigned" is the round-13 rule).
function humanizeTimestamp(value) {
  if (!value) return "";
  try {
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return "";
    const deltaMs = Date.now() - when.getTime();
    const minutes = Math.round(deltaMs / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    return when.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function Stepper({ label, value, min = 0, max = 99, onChange, "data-testid": testId = "" }) {
  const dec = () => {
    if (value > min) onChange(value - 1);
  };
  const inc = () => {
    if (value < max) onChange(value + 1);
  };

  return (
    <label className="gh-lineage-stepper" data-testid={testId || undefined}>
      <span className="gh-lineage-stepper-label">{label}</span>
      <button
        aria-label={`Decrease ${label}`}
        className="gh-lineage-stepper-button"
        disabled={value <= min}
        onClick={dec}
        type="button"
      >
        −
      </button>
      <span className="gh-lineage-stepper-value" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </span>
      <button
        aria-label={`Increase ${label}`}
        className="gh-lineage-stepper-button"
        disabled={value >= max}
        onClick={inc}
        type="button"
      >
        +
      </button>
    </label>
  );
}

/** Round 19 defect #7: slider-style toggle replaces the tiny browser
 *  checkbox. Visually consistent across Data / Operational / Include
 *  Columns so the control bar reads like a row of pill switches. */
function SliderToggle({ checked, onChange, label, testId }) {
  const toggle = () => onChange?.(!checked);
  return (
    <label className={`gh-lineage-slider-toggle ${checked ? "is-on" : ""}`.trim()}>
      <input
        checked={Boolean(checked)}
        data-testid={testId}
        onChange={toggle}
        type="checkbox"
        className="gh-lineage-slider-toggle-input"
      />
      <span aria-hidden="true" className="gh-lineage-slider-toggle-track">
        <span className="gh-lineage-slider-toggle-thumb" />
      </span>
      <span className="gh-lineage-slider-toggle-label">{label}</span>
    </label>
  );
}

function IncludeColumnsToggle({ value, onChange }) {
  return (
    <SliderToggle
      checked={Boolean(value)}
      onChange={onChange}
      label="Include Columns"
      testId="lineage-workspace-include-columns"
    />
  );
}

function ContextSegmented({ activeKey, onChange }) {
  // Backward-compatible segmented pill — kept as a fallback for callers
  // that still wire through the legacy `context` string (notably the
  // EntityWorkspace Lineage sub-tab). New callers use `LineageModeChecks`
  // with the `modeFlags` prop instead.
  const items = [
    { key: "Data Lineage", label: "Data Lineage" },
    { key: "Operational Context", label: "Operational Lineage" },
  ];

  return (
    <div
      aria-label="Lineage mode"
      className="gh-segment-row gh-lineage-mode-segment"
      role="tablist"
    >
      {items.map((item) => (
        <button
          aria-pressed={activeKey === item.key}
          className={`gh-segment-button gh-lineage-mode-segment-button ${activeKey === item.key ? "is-active" : ""}`}
          data-testid={`lineage-mode-${item.key === "Data Lineage" ? "data" : "operational"}`}
          key={item.key}
          onClick={() => onChange?.(item.key)}
          role="tab"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Round 18 defect #7: independent on/off checkboxes for Data + Operational
 *  lineage. Both default to available; the operator can view either in
 *  isolation or both overlaid on the same canvas. */
function LineageModeChecks({ modeFlags, onModeChange }) {
  const flags = modeFlags || { data: true, operational: false };
  const toggle = (key) => () => {
    const next = { ...flags, [key]: !flags[key] };
    // Refuse to turn BOTH off — the user would see an empty canvas with
    // no way to recover from a click. Re-enable the other half instead.
    if (!next.data && !next.operational) {
      next[key === "data" ? "operational" : "data"] = true;
    }
    onModeChange?.(next);
  };
  return (
    <div aria-label="Lineage mode" className="gh-lineage-mode-checks" role="group">
      <SliderToggle
        checked={Boolean(flags.data)}
        onChange={toggle("data")}
        label="Data Lineage"
        testId="lineage-mode-data"
      />
      <SliderToggle
        checked={Boolean(flags.operational)}
        onChange={toggle("operational")}
        label="Operational Lineage"
        testId="lineage-mode-operational"
      />
    </div>
  );
}

function LineageHeader({ asset, generatedAt }) {
  if (!asset) return null;
  const catalog = (asset.catalog || "").trim();
  const schema = (asset.schema || "").trim();
  const name = asset.name || asset.label || "";
  // Round 18 defect #3: breadcrumb starts at the catalog, NOT "Unity Catalog".
  // The "Unity Catalog" prefix added noise without adding signal — the
  // workspace name sits in the topbar already.
  const breadcrumbItems = [
    catalog ? { key: "catalog", label: catalog } : null,
    schema ? { key: "schema", label: schema } : null,
    name ? { key: "name", label: name } : null,
  ].filter(Boolean);

  const objectType = displayObjectType(asset);
  // Round 18 defect #9: "Last Updated" was showing the graph-generation
  // timestamp (almost always "just now"), which misled operators into
  // thinking the source table had just been modified. Only surface a
  // Last Updated chip when the asset payload carries a real UC modification
  // timestamp (updatedAt / lastUpdatedAt); fall back silently otherwise
  // instead of shouting "just now" every render.
  const lastUpdated = humanizeTimestamp(asset.updatedAt || asset.lastUpdatedAt);

  const chips = [];
  if (schema) chips.push({ key: "schema", label: "Schema", value: schema });
  // Round 19 fix #9: label reads "Asset Type" not "Source" — "Source"
  // was ambiguous with the upstream-source meaning in lineage parlance.
  if (objectType) chips.push({ key: "source", label: "Asset Type", value: objectType });
  if (lastUpdated) chips.push({ key: "updated", label: "Last Updated", value: lastUpdated });
  // The Databricks connection indicator is always valid when lineage is
  // available — the page itself cannot load without a connected workspace.
  chips.push({ key: "databricks", label: "", value: "Databricks connection", dot: true });

  return (
    <header className="gh-lineage-header" data-testid="lineage-header">
      <h1 className="gh-lineage-header-title" data-testid="lineage-header-title">
        Lineage: <span className="gh-lineage-header-asset-name">{name}</span>
      </h1>
      <Breadcrumbs
        ariaLabel="Lineage breadcrumb"
        className="gh-lineage-header-breadcrumbs"
        items={breadcrumbItems}
        separator="›"
      />
      {chips.length ? (
        <div className="gh-lineage-header-chips" role="list">
          {chips.map((chip) => (
            <span
              className={`gh-lineage-header-chip ${chip.dot ? "is-connection" : ""}`}
              data-testid={`lineage-chip-${chip.key}`}
              key={chip.key}
              role="listitem"
            >
              {chip.dot ? <span aria-hidden="true" className="gh-lineage-header-chip-dot" /> : null}
              {chip.label ? <span className="gh-lineage-header-chip-label">{chip.label}:</span> : null}
              <span className="gh-lineage-header-chip-value">{chip.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function LineageControlBar({
  context,
  onContextChange,
  modeFlags,
  onModeChange,
  upstreamLevels,
  downstreamLevels,
  maxDepth,
  nodesPerLayer,
  includeColumns,
  onUpstreamLevelsChange,
  onDownstreamLevelsChange,
  onMaxDepthChange,
  onNodesPerLayerChange,
  onIncludeColumnsChange,
  onFocusView,
  onResetZoom,
}) {
  return (
    <div className="gh-lineage-controls" data-testid="lineage-controls">
      <div className="gh-lineage-controls-left">
        <Stepper
          data-testid="lineage-upstream-stepper"
          label="Upstream levels"
          max={6}
          min={0}
          onChange={onUpstreamLevelsChange}
          value={upstreamLevels}
        />
        <Stepper
          data-testid="lineage-downstream-stepper"
          label="Downstream levels"
          max={6}
          min={0}
          onChange={onDownstreamLevelsChange}
          value={downstreamLevels}
        />
        <Stepper
          data-testid="lineage-depth-stepper"
          label="Depth"
          max={4}
          min={1}
          onChange={onMaxDepthChange}
          value={maxDepth}
        />
        <Stepper
          data-testid="lineage-per-layer-stepper"
          label="Nodes per Layer"
          max={25}
          min={5}
          onChange={onNodesPerLayerChange}
          value={nodesPerLayer}
        />
        <IncludeColumnsToggle onChange={onIncludeColumnsChange} value={includeColumns} />
        {/* Round 18 defect #7: show the independent dual-check row when
            the parent supplies `modeFlags`; fall back to the legacy
            segmented pill (and `context` string) for embedded callers
            that haven't migrated. */}
        {onModeChange && modeFlags ? (
          <LineageModeChecks modeFlags={modeFlags} onModeChange={onModeChange} />
        ) : (
          <ContextSegmented activeKey={context} onChange={onContextChange} />
        )}
      </div>
      <div className="gh-lineage-controls-right">
        <button
          className="gh-tertiary-button gh-lineage-controls-action"
          data-testid="lineage-focus-view"
          onClick={() => onFocusView?.()}
          type="button"
        >
          Focus View
        </button>
        <button
          className="gh-tertiary-button gh-lineage-controls-action"
          data-testid="lineage-reset-zoom"
          onClick={() => onResetZoom?.()}
          type="button"
        >
          Reset Zoom
        </button>
      </div>
    </div>
  );
}

export default function LineageStage({
  asset,
  graphBundle,
  lineagePayload = null,
  loading,
  error,
  notice = "",
  overlay = null,
  authoritative = true,
  provisional = false,
  context,
  modeFlags = null,
  onModeChange,
  linkedRecordUnavailableOverrides = {},
  upstreamLevels = 2,
  downstreamLevels = 2,
  maxDepth = 2,
  nodesPerLayer = 10,
  includeColumns = false,
  onUpstreamLevelsChange,
  onDownstreamLevelsChange,
  onMaxDepthChange,
  onNodesPerLayerChange,
  onIncludeColumnsChange,
  onContextChange,
  onOpenGovernance,
  onSelectAsset,
  onOpenAsset,
  assetSearchQuery,
  onAssetSearchQueryChange,
  assetSearchResults,
  assetSearchResolvedQuery,
  assetSearchLoading,
  embedded = false,
  allowRefocus = true,
  userEmail = "",
  workspaceHost = "",
}) {
  const graph = selectGraph(graphBundle, context, modeFlags);
  const stats = {
    ...fallbackStats(graphBundle, context),
    ...(lineagePayload?.stats || {}),
  };
  const limits = stats?.limits || {};
  const truncated = stats?.truncated || {};
  const hasGraph = Boolean(graph?.nodes?.length);
  const hasEdges = Boolean(graph?.edges?.length);
  const emptyGraph = { nodes: [], edges: [] };

  // Ref-style callbacks for the graph canvas — LineageGraph owns the
  // React Flow instance, so we hand it two callback slots that the top
  // control bar's "Focus View" and "Reset Zoom" buttons can invoke.
  // These are set by LineageGraph via the onRegisterGraphActions prop.
  let graphActionsRef = { focusView: null, resetZoom: null };
  const registerGraphActions = (actions) => {
    graphActionsRef = actions || { focusView: null, resetZoom: null };
  };
  const handleFocusView = () => graphActionsRef.focusView?.();
  const handleResetZoom = () => graphActionsRef.resetZoom?.();

  const truncationNotice =
    context === "Data Lineage" && (truncated.upstream || truncated.downstream || truncated.columnLineage)
      ? `Limited to ${limits.tableLineage || "?"} table edges. Column lineage may be partial or unavailable in this workspace.`
      : context === "Operational Context" && (truncated.operationalProducers || truncated.operationalConsumers)
        ? `Limited to ${limits.operationalContext || "?"} operational records per direction`
        : "";

  // Embedded mode (EntityWorkspace's Lineage sub-tab) reuses only the
  // graph canvas — it has its own outer EntityHero + record layout, so
  // we skip the lineage-workspace header and the stepper control bar.
  // In full-surface mode we render both.
  const showWorkspaceChrome = !embedded;

  return (
    <section className={`gh-lineage-stage-shell ${embedded ? "is-embedded" : "is-full"}`}>
      {showWorkspaceChrome && asset ? <LineageHeader asset={asset} generatedAt={stats.generatedAt} /> : null}
      {showWorkspaceChrome && asset ? (
        <LineageControlBar
          context={context}
          modeFlags={modeFlags}
          onModeChange={onModeChange}
          downstreamLevels={downstreamLevels}
          includeColumns={includeColumns}
          maxDepth={maxDepth}
          nodesPerLayer={nodesPerLayer}
          onContextChange={onContextChange}
          onDownstreamLevelsChange={onDownstreamLevelsChange}
          onFocusView={handleFocusView}
          onIncludeColumnsChange={onIncludeColumnsChange}
          onMaxDepthChange={onMaxDepthChange}
          onNodesPerLayerChange={onNodesPerLayerChange}
          onResetZoom={handleResetZoom}
          onUpstreamLevelsChange={onUpstreamLevelsChange}
          upstreamLevels={upstreamLevels}
        />
      ) : null}
      <section className="gh-lineage-graph-panel gh-lineage-graph-stage">
        {embedded && asset ? (
          <div className="gh-lineage-stage-topbar gh-lineage-stage-topbar-embedded">
            <ContextSegmented activeKey={context} onChange={onContextChange} />
          </div>
        ) : null}
        {notice ? <InlineStatusBanner message={notice} title="Navigation limited" /> : null}
        {provisional ? (
          <InlineStatusBanner
            className="gh-lineage-inline-warning"
            message={
              authoritative
                ? "Showing cached live lineage while the graph refresh completes."
                : "Showing provisional lineage context until the authoritative graph resolves."
            }
            title="Live lineage still loading"
          />
        ) : null}
        {truncationNotice ? (
          <InlineStatusBanner
            className="gh-lineage-inline-warning"
            message={truncationNotice}
            title="Partial lineage"
          />
        ) : null}
        <div className="gh-lineage-stage-canvas">
          {loading && !hasGraph ? (
            <LineageLoadingSkeleton asset={asset} />
          ) : hasGraph || overlay ? (
            <>
              {error ? (
                <InlineStatusBanner className="gh-lineage-inline-warning" message={error} title="Lineage refresh degraded" />
              ) : null}
              <LineageGraph
                asset={asset}
                assetSearchLoading={assetSearchLoading}
                assetSearchQuery={assetSearchQuery}
                assetSearchResults={assetSearchResults}
                assetSearchResolvedQuery={assetSearchResolvedQuery}
                allowRefocus={allowRefocus}
                context={context}
                downstreamLevels={downstreamLevels}
                graph={graph || emptyGraph}
                hasEdges={hasEdges}
                includeColumns={includeColumns}
                lineagePayload={lineagePayload}
                linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
                maxDepth={maxDepth}
                nodesPerLayer={nodesPerLayer}
                onAssetSearchQueryChange={onAssetSearchQueryChange}
                onContextChange={onContextChange}
                onOpenAsset={onOpenAsset}
                onOpenGovernance={onOpenGovernance}
                onRegisterGraphActions={registerGraphActions}
                onSelectAsset={onSelectAsset}
                overlay={overlay}
                upstreamLevels={upstreamLevels}
                userEmail={userEmail}
                workspaceHost={workspaceHost}
              />
            </>
          ) : error ? (
            <EmptyStateBlock message={error} title="Lineage unavailable" />
          ) : (
            <EmptyStateBlock
              message={
                context === "Operational Context"
                  ? "No operational entities are currently connected to this asset."
                  : "No connected lineage edges are available for this asset yet."
              }
              title={context === "Operational Context" ? "No operational context" : "No connected lineage"}
            />
          )}
        </div>
      </section>
    </section>
  );
}
