import { useMemo, useRef, useState } from "react";
import { displayObjectType } from "../lib/assetPresentation";
import { Breadcrumbs } from "./primitives/Breadcrumbs";
import LineageGraph from "./LineageGraph";
import { EmptyStateBlock, InlineStatusBanner } from "./ShellStatePrimitives";

/** @type {(...args: any[]) => void} */
const NOOP = () => {};

function LineageLoadingGraphShell({
  title = "Loading lineage graph",
  message = "Refreshing live lineage evidence...",
}) {
  const bands = [
    { label: "Upstream", nodes: 2 },
    { label: "Transform", nodes: 2 },
    { label: "Current asset", nodes: 1, focus: true },
    { label: "Downstream", nodes: 2 },
  ];
  return (
    <div
      aria-label={title}
      className="ga-lineage-loading-shell"
      data-testid="lineage-loading-graph"
      role="status"
    >
      <div className="ga-lineage-loading-header">
        <span>{title}</span>
        <small>{message}</small>
      </div>
      <div className="ga-lineage-loading-canvas" aria-hidden="true">
        <svg className="ga-lineage-loading-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M15 42 C 30 18, 38 18, 50 48" />
          <path d="M15 68 C 30 76, 38 76, 50 52" />
          <path d="M50 50 C 64 26, 72 24, 86 36" />
          <path d="M50 54 C 64 70, 74 74, 87 68" />
        </svg>
        {bands.map((band) => (
          <section className={band.focus ? "is-focus" : ""} key={band.label}>
            <h3>{band.label}</h3>
            {Array.from({ length: band.nodes }, (_, index) => (
              <div className={band.focus ? "ga-lineage-loading-node is-focus" : "ga-lineage-loading-node"} key={`${band.label}-${index}`}>
                <span />
                <strong />
                <small />
              </div>
            ))}
          </section>
        ))}
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
  // passed yet (older callers and focused tests).
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

function lineageAsOfDate(value) {
  if (!value) return "Live query";
  try {
    const when = new Date(value);
    if (!Number.isNaN(when.getTime())) return when.toISOString().slice(0, 10);
  } catch {
    // Fall through to string cleanup.
  }
  return String(value).replace(/^Topology refreshed\s+/i, "").slice(0, 10) || "Live query";
}

function compactFreshnessLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const asOf = lineageAsOfDate(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return asOf;
  return raw.length > 18 ? `${raw.slice(0, 18)}...` : raw;
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
  const flags = modeFlags || { data: true, operational: true };
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

function compactName(value = "") {
  const parts = String(value || "").split(".").filter(Boolean);
  return parts.at(-1) || String(value || "").trim() || "Unknown asset";
}

function compactPath(value = "") {
  const parts = String(value || "").split(".").filter(Boolean);
  if (parts.length >= 3) return `${parts[0]} / ${parts[1]}`;
  if (parts.length === 2) return `${parts[0]} / ${parts[1]}`;
  return parts[0] || "";
}

function nodeFqn(node) {
  return node?.assetFqn || node?.fqn || node?.id || "";
}

function nodeTitle(node, fallback = "") {
  return node?.label || node?.name || compactName(nodeFqn(node)) || fallback || "Asset";
}

function nodeDisplayTitle(node, fallback = "") {
  const title = nodeTitle(node, fallback);
  const type = String(nodeType(node)).toLowerCase();
  if (title.includes(".") && /table|delta|view|source/.test(type)) {
    return compactName(title);
  }
  return title;
}

function nodeSubtitle(node, fallback = "") {
  return node?.subtitle || compactPath(nodeFqn(node)) || fallback || "";
}

function nodeType(node, asset = null) {
  return node?.kind || node?.type || node?.objectType || displayObjectType(asset || node) || "Table";
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ownerEvidenceLabel(...ownerSources) {
  for (const source of ownerSources) {
    if (!Array.isArray(source)) continue;
    for (const owner of source) {
      const label = typeof owner === "string"
        ? owner
        : textValue(owner?.displayName, owner?.name, owner?.email, owner?.principal, owner?.team);
      if (label) return label;
    }
  }
  return "";
}

function numericValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function compactCount(value) {
  const number = numericValue(value);
  if (number == null) return "Unavailable";
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(number);
}

function percentValue(value) {
  const number = numericValue(value);
  if (number == null) return "Unavailable";
  return `${Math.round(number)}%`;
}

function downloadLineageEvidence(filename, payload) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const urlFactory = window.URL || window.webkitURL;
  if (!urlFactory?.createObjectURL) return false;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = urlFactory.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (typeof window.setTimeout === "function") {
    window.setTimeout(() => {
      urlFactory.revokeObjectURL?.(url);
    }, 4000);
  } else {
    urlFactory.revokeObjectURL?.(url);
  }
  return true;
}

const TOPOLOGY_EDGE_SLOTS = [
  { key: "upstream-outer", inX: 32, outX: 145, y: [348, 448, 548] },
  { key: "upstream-inner", inX: 240, outX: 423, y: [190, 532, 342] },
  { key: "transform", inX: 496, outX: 683, y: [590, 690, 500, 760] },
  { key: "focus", inX: 610, outX: 690, y: [590] },
  { key: "downstream", inX: 760, outX: 856, y: [168, 456, 728, 602] },
];

function topologySlotAnchor(bandIndex, nodeIndex) {
  const slot = TOPOLOGY_EDGE_SLOTS[bandIndex] || TOPOLOGY_EDGE_SLOTS.at(-1);
  const yValues = slot?.y || [430];
  const y = yValues[Math.min(nodeIndex, yValues.length - 1)] || yValues[0] || 430;
  return {
    bandIndex,
    inX: slot.inX,
    outX: slot.outX,
    y,
  };
}

function edgeEndpointPair(sourceAnchor, targetAnchor) {
  if (!sourceAnchor || !targetAnchor) return null;
  const forward = sourceAnchor.outX <= targetAnchor.inX;
  return {
    source: {
      x: forward ? sourceAnchor.outX : sourceAnchor.inX,
      y: sourceAnchor.y,
    },
    target: {
      x: forward ? targetAnchor.inX : targetAnchor.outX,
      y: targetAnchor.y,
    },
  };
}

function edgeEndpointLabel(node, fallback = "") {
  const title = nodeTitle(node) || fallback || "lineage node";
  const fqn = nodeFqn(node);
  if (!fqn || fqn === title) return title;
  return `${title} (${compactPath(fqn)})`;
}

function buildTopologyEdgePaths(graphBands, edges) {
  const anchors = new Map();
  const nodesByKey = new Map();
  graphBands.forEach((band, bandIndex) => {
    asArray(band?.nodes).forEach((node, nodeIndex) => {
      const key = node?.id || nodeFqn(node);
      if (!key || anchors.has(key)) return;
      anchors.set(key, topologySlotAnchor(bandIndex, nodeIndex));
      nodesByKey.set(key, node);
    });
  });

  return asArray(edges)
    .map((edge, index) => {
      const sourceAnchor = anchors.get(edge?.source);
      const targetAnchor = anchors.get(edge?.target);
      const endpoints = edgeEndpointPair(sourceAnchor, targetAnchor);
      if (!endpoints) return null;
      const midX = endpoints.source.x + (endpoints.target.x - endpoints.source.x) * 0.5;
      const edgeText = `${edge?.kind || ""} ${edge?.type || ""} ${edge?.resolutionState || ""}`.toLowerCase();
      return {
        key: edge?.id || edge?.key || `${edge?.source || "source"}-${edge?.target || "target"}-${index}`,
        source: edge?.source || "",
        sourceTitle: edgeEndpointLabel(nodesByKey.get(edge?.source), edge?.source || "source"),
        target: edge?.target || "",
        targetTitle: edgeEndpointLabel(nodesByKey.get(edge?.target), edge?.target || "target"),
        sourceNode: nodesByKey.get(edge?.source) || null,
        targetNode: nodesByKey.get(edge?.target) || null,
        edge,
        className: /restricted|permission|hidden|boundary/.test(edgeText) ? "is-muted is-boundary" : "",
        d: `M${endpoints.source.x} ${endpoints.source.y} C${midX} ${endpoints.source.y} ${midX} ${endpoints.target.y} ${endpoints.target.x} ${endpoints.target.y}`,
      };
    })
    .filter(Boolean);
}

function selectedNodeSeed(graph, asset) {
  const nodes = asArray(graph?.nodes);
  const assetFqn = asset?.fqn || "";
  return (
    nodes.find((node) => node?.role === "focus") ||
    nodes.find((node) => nodeFqn(node) === assetFqn) ||
    (asset
      ? {
          id: asset.fqn,
          assetFqn: asset.fqn,
          label: asset.name || compactName(asset.fqn),
          subtitle: compactPath(asset.fqn),
          role: "focus",
          kind: displayObjectType(asset),
        }
      : null)
  );
}

function buildLineageViewModel(graph, asset, lineagePayload, context) {
  const nodes = asArray(graph?.nodes);
  const edges = asArray(graph?.edges);
  const focus = selectedNodeSeed(graph, asset);
  const focusId = focus?.id || nodeFqn(focus);
  const byId = new Map(nodes.map((node) => [node?.id || nodeFqn(node), node]));
  const sortByHop = (left, right) => {
    const leftOrder = numericValue(left?.depth, left?.hop, left?.order, left?.sequence, 0) ?? 0;
    const rightOrder = numericValue(right?.depth, right?.hop, right?.order, right?.sequence, 0) ?? 0;
    return leftOrder - rightOrder;
  };
  const forward = new Map();
  const reverse = new Map();
  edges.forEach((edge) => {
    if (!edge?.source || !edge?.target) return;
    if (!forward.has(edge.source)) forward.set(edge.source, new Set());
    if (!reverse.has(edge.target)) reverse.set(edge.target, new Set());
    forward.get(edge.source).add(edge.target);
    reverse.get(edge.target).add(edge.source);
  });
  const traverse = (startId, adjacency) => {
    const visited = new Set();
    const queue = [startId];
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    visited.delete(startId);
    return visited;
  };
  const upstreamReachable = focusId ? traverse(focusId, reverse) : new Set();
  const downstreamReachable = focusId ? traverse(focusId, forward) : new Set();
  const isProcessNode = (node) => {
    const text = [
      nodeType(node),
      node?.kind,
      node?.type,
      node?.role,
      node?.stage,
      node?.lineageStage,
      node?.entityType,
    ].join(" ").toLowerCase();
    return /view|pipeline|job|notebook|query|task|workflow|transform|process/.test(text);
  };
  const stageFor = (node) => {
    const explicit = String(node?.stage || node?.lineageStage || node?.band || "").toLowerCase();
    if (/upstream|source|input/.test(explicit)) return "upstream";
    if (/transform|job|pipeline|process|intermediate/.test(explicit)) return "transformation";
    if (/downstream|consumer|output/.test(explicit)) return "downstream";
    if (/focus|current/.test(explicit) || node?.role === "focus") return "focus";
    const id = node?.id || nodeFqn(node);
    const kind = String(nodeType(node)).toLowerCase();
    if (isProcessNode(node)) return "transformation";
    if (id && downstreamReachable.has(id)) return "downstream";
    if (id && upstreamReachable.has(id)) {
      return /view|pipeline|job|notebook|query|task|workflow|transform/.test(kind)
        ? "transformation"
        : "upstream";
    }
    return /view|pipeline|job|notebook|query|task|workflow|transform/.test(kind)
      ? "transformation"
      : "";
  };
  const stagedNodes = nodes.filter((node) => {
    const id = node?.id || nodeFqn(node);
    return id && id !== focusId;
  });
  const upstream = stagedNodes.filter((node) => stageFor(node) === "upstream").sort(sortByHop);
  const transformation = stagedNodes.filter((node) => stageFor(node) === "transformation").sort(sortByHop);
  const downstream = stagedNodes.filter((node) => stageFor(node) === "downstream").sort(sortByHop);
  const stats = lineagePayload?.stats || {};
  const columnLineage = lineagePayload?.columnLineage || {};
  const upstreamCount = numericValue(stats.upstreamCount, upstream.length) ?? 0;
  const downstreamCount = numericValue(stats.downstreamCount, downstream.length) ?? 0;
  const columnTraceCount =
    asArray(columnLineage.upstream).length + asArray(columnLineage.downstream).length;
  const confidence = numericValue(stats.confidenceScore, stats.confidence, stats.lineageConfidence);
  const quality = numericValue(
    stats.qualityScore,
    asset?.qualityScore,
    asset?.profiler?.qualityScore,
    asset?.operational?.qualityScore,
  );
  const generatedAt = stats.generatedAt || lineagePayload?.generatedAt || "";
  return {
    nodes,
    edges,
    meta: graph?.meta || {},
    focus,
    upstream,
    downstream,
    transformation,
    stats,
    columnLineage,
    upstreamCount,
    downstreamCount,
    brokenLinks: numericValue(stats.brokenLinks, stats.unresolvedEdges, 0) ?? 0,
    columnTraceCount,
    confidence,
    quality,
    generatedAt,
    modeLabel: context === "Operational Context" ? "Operational" : "Table",
  };
}

function lineageEvidenceSourceLabel(sources) {
  const normalized = asArray(sources)
    .map((source) => String(source || "").trim())
    .filter(Boolean);
  if (!normalized.length) return "system.access.table_lineage";
  const unique = [...new Set(normalized)];
  if (unique.length === 1) return unique[0];
  return unique.join(" + ");
}

function isWorkspaceScopedLineageEvidence(lineagePayload, graphMeta = {}) {
  const payloadMeta = lineagePayload?.meta && typeof lineagePayload.meta === "object" ? lineagePayload.meta : {};
  const meta = { ...payloadMeta, ...(graphMeta || {}) };
  const source = String(meta.source || lineagePayload?.source || "").trim().toLowerCase();
  const visibilityScope = String(meta.visibilityScope || meta.readScope || "").trim().toLowerCase();
  const authMode = String(meta.authMode || meta.productMode || "").trim().toLowerCase();
  return (
    source.includes("unity-catalog-lineage") &&
    (
      visibilityScope === "workspace-app-principal" ||
      visibilityScope === "workspace_app_principal" ||
      authMode === "app-principal-only" ||
      authMode === "app_principal_only"
    )
  );
}

function columnPreviewRows(node) {
  return asArray(node?.columns)
    .map((column) => {
      if (typeof column === "string") {
        return { name: column, type: "", key: "" };
      }
      return {
        name: textValue(column?.name, column?.column, column?.targetColumn),
        type: textValue(column?.dataType, column?.type),
        key: textValue(column?.key, column?.constraint, column?.role),
      };
    })
    .filter((column) => column.name)
    .slice(0, 6);
}

function columnVisualMeta(column, index) {
  const explicit = String(column?.key || column?.constraint || column?.role || "").trim();
  const name = String(column?.name || "").toLowerCase();
  const type = String(column?.type || column?.dataType || "").toLowerCase();
  const keyLabel =
    /^pk$|primary/.test(explicit.toLowerCase())
      ? "PK"
      : /^fk$|foreign/.test(explicit.toLowerCase())
        ? "FK"
        : name.endsWith("_id")
          ? index === 0 ? "PK" : "FK"
          : "";
  const metric = explicit === "#" || /decimal|int|double|float|number/.test(type);
  return {
    glyph: metric && !keyLabel ? "#" : "A",
    glyphTone: metric && !keyLabel ? "metric" : "text",
    key: keyLabel ? { label: keyLabel, tone: keyLabel.toLowerCase() } : null,
  };
}

function NodeButton({ node, active = false, asset = null, role = "peer", authoritative = true, onSelect = NOOP }) {
  if (!node) return null;
  const title = nodeDisplayTitle(node, asset?.name || compactName(asset?.fqn));
  const subtitle = nodeSubtitle(node, compactPath(asset?.fqn));
  const type = nodeType(node, asset);
  const columns = columnPreviewRows(node);
  const totalColumns = asArray(node?.columns).length;
  const rowCount = compactCount(node?.rowCount || node?.rows || node?.details?.rows);
  const refresh = textValue(node?.freshness, node?.lastRefresh, node?.details?.freshness);
  return (
    <button
      className={`ga-lineage-node is-${role} ${active ? "is-selected" : ""}`.trim()}
      data-node-type={String(type || "").toLowerCase()}
      onClick={() => onSelect(node)}
      type="button"
    >
      <span className="ga-lineage-node-icon" aria-hidden="true" />
      <span className="ga-lineage-node-copy">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </span>
      <span className="ga-lineage-node-type">{type}</span>
      {columns.length ? (
        <span className="ga-lineage-node-columns">
          {columns.map((column, index) => {
            const columnMeta = columnVisualMeta(column, index);
            return (
            <span key={`${title}-${column.name}-${index}`}>
              <b className={`is-${columnMeta.glyphTone}`}>{columnMeta.glyph}</b>
              <em>
                {column.name}
                {columnMeta.key ? <i className={`is-${columnMeta.key.tone}`}>{columnMeta.key.label}</i> : null}
              </em>
              {column.type ? <small>{column.type}</small> : null}
            </span>
            );
          })}
          {totalColumns > columns.length ? (
            <span className="ga-lineage-node-columns-more">+{totalColumns - columns.length} more columns</span>
          ) : null}
        </span>
      ) : null}
      {rowCount !== "Unavailable" || refresh ? (
        <span className="ga-lineage-node-meta">
          {rowCount !== "Unavailable" ? <span>{`${rowCount} rows`}</span> : null}
          {refresh ? <span>{refresh}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

function impactKind(item) {
  const text = `${item?.kind || ""} ${item?.type || ""} ${item?.title || ""} ${nodeType(item?.node || {})}`.toLowerCase();
  if (/restricted|permission|hidden/.test(text)) return "restricted";
  if (/dashboard|board|cfo/.test(text)) return "dashboard";
  if (/model|forecast|ml/.test(text)) return "model";
  if (/table|snapshot|delta/.test(text)) return "table";
  return "consumer";
}

function impactIconName(kind) {
  if (kind === "restricted") return "lock";
  if (kind === "dashboard") return "dashboard";
  if (kind === "model") return "model";
  return "table";
}

function splitImpactDetail(item) {
  const rawDetail = textValue(item?.detail, item?.subtitle, item?.meta);
  const detail = rawDetail || "No backed downstream impact evidence returned.";
  const explicitOwner = textValue(item?.owner, item?.ownerName, item?.team);
  const explicitMeta = textValue(item?.usage, item?.usageLabel, item?.meta);
  if (explicitOwner || explicitMeta) {
    return {
      owner: explicitOwner || "Owner unavailable",
      meta: explicitMeta || detail,
    };
  }
  const parts = detail.split(/\s[-·]\s/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], meta: parts.slice(1).join(" · ") };
  }
  return {
    owner: item?.restricted ? "Hidden by permissions" : "Owner unavailable",
    meta: detail,
  };
}

function impactDisplayTitle(item) {
  const title = textValue(item?.title, item?.label, nodeTitle(item?.node || {}), "Downstream consumer");
  return title;
}

function LineageDetailsPanel({
  selectedNode,
  owner,
  freshness,
  sourceNodes,
  downstreamNodes,
  events,
  authoritative = false,
  onSelect = NOOP,
}) {
  const title = nodeDisplayTitle(selectedNode);
  const subtitle = nodeSubtitle(selectedNode);
  const rowCount = compactCount(selectedNode?.rowCount || selectedNode?.rows || selectedNode?.details?.rows);
  const recentEvents = asArray(events).slice(0, 2);
  const rawFreshness = freshness || "";
  const displayFreshness = compactFreshnessLabel(rawFreshness) || "Unavailable";
  const displayRows = authoritative
    ? rowCount
    : rowCount;
  const displayOwner = owner || "Unavailable";
  const visibleSources = sourceNodes.slice(0, 3);
  const visibleConsumers = authoritative
    ? downstreamNodes.slice(0, 2)
    : downstreamNodes.slice(0, 2);

  return (
    <aside className="ga-lineage-details-panel" aria-label="Lineage details">
      <div className="ga-lineage-details-heading">
        <span className="ga-lineage-details-icon" aria-hidden="true" />
        <div>
          <span>Lineage Details</span>
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
      </div>
      <dl className="ga-lineage-details-stats">
        <div>
          <dt>Last refresh</dt>
          <dd>
            <span title={rawFreshness || undefined}>{displayFreshness}</span>
          </dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>
            <span>{displayRows}</span>
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>
            <span>{displayOwner}</span>
          </dd>
        </div>
      </dl>
      {!authoritative ? (
        <p className="ga-lineage-details-proof">
          Live lineage inspector unavailable for this route.
        </p>
      ) : null}
      <section>
        <h3><span>Sources</span><b>{visibleSources.length}</b></h3>
        {visibleSources.length ? visibleSources.map((node) => (
          <button key={node?.id || nodeFqn(node)} onClick={() => onSelect(node)} type="button">
            <span>{nodeTitle(node)}</span>
            <small>{nodeSubtitle(node)}</small>
          </button>
        )) : <p>No source-system details returned.</p>}
      </section>
      <section>
        <h3><span>Consumers</span><b>{visibleConsumers.length}</b></h3>
        {visibleConsumers.length ? visibleConsumers.map((node) => (
          <button key={node?.id || nodeFqn(node)} onClick={() => onSelect(node)} type="button">
            <span>{nodeTitle(node)}</span>
            <small>{nodeSubtitle(node)}</small>
          </button>
        )) : <p>No downstream consumer details returned.</p>}
      </section>
      <section>
        <h3><span>Recent Activity</span></h3>
        {recentEvents.length ? recentEvents.map((event) => (
          <div key={event.id || event.title}>
            <span>{event.title}</span>
            <small>{event.detail}</small>
          </div>
        )) : <p>No recent lineage activity returned.</p>}
      </section>
    </aside>
  );
}

function EmptyGraphSlot({ message, role = "", title }) {
  return (
    <div className={`ga-lineage-empty-slot ${role ? `is-${role}` : ""}`.trim()}>
      <i aria-hidden="true" />
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function PillButton({ children, active = false, disabled = false, onClick = NOOP, testId = "", title = "" }) {
  return (
    <button
      aria-pressed={active}
      className={`ga-lineage-pill-button ${active ? "is-active" : ""}`.trim()}
      data-testid={testId || undefined}
      disabled={disabled}
      onClick={onClick}
      title={title || undefined}
      type="button"
    >
      {children}
    </button>
  );
}

function LineageIcon({ name }) {
  const paths = {
    columns: (
      <>
        <path d="M5 5h14v14H5z" />
        <path d="M10 5v14" />
        <path d="M14 5v14" />
      </>
    ),
    impact: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </>
    ),
    fit: (
      <>
        <path d="M8 4H5a1 1 0 0 0-1 1v3" />
        <path d="M16 4h3a1 1 0 0 1 1 1v3" />
        <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M16 20h3a1 1 0 0 0 1-1v-3" />
      </>
    ),
    history: (
      <>
        <path d="M7 7h5a5 5 0 1 1-4.1 7.9" />
        <path d="M7 7v4" />
        <path d="M7 7H3" />
      </>
    ),
    lightning: (
      <path d="M13 2 5 14h6l-1 8 8-12h-6l1-8z" />
    ),
    dashboard: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 9h4" />
        <path d="M8 13h8" />
        <path d="M15 9h1" />
      </>
    ),
    model: (
      <>
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M9 9h6v6H9z" />
        <path d="M3 9h2" />
        <path d="M19 15h2" />
        <path d="M9 3v2" />
        <path d="M15 19v2" />
      </>
    ),
    table: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 10h16" />
        <path d="M10 5v14" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V8a4 4 0 0 1 8 0v2" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || paths.columns}
    </svg>
  );
}

function NorthStarLineageExplorer({
  asset,
  graph,
  lineagePayload,
  loading,
  error,
  notice,
  overlay,
  authoritative,
  provisional,
  context,
  includeColumns,
  onIncludeColumnsChange,
  onOpenGovernance,
  onOpenAsset,
  onRefreshLineage,
  onSelectAsset,
}) {
  const [lineageMode, setLineageMode] = useState(includeColumns ? "column" : "table");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  // Hover-trace state — when the user hovers a node, the connected upstream
  // and downstream subgraph stays at full intensity while everything else
  // dims to ~22%. This mirrors the design's "trace the path" interaction
  // and is purely visual (no data fetched, no selection changed).
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [status, setStatus] = useState("");
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [graphSearchOpen, setGraphSearchOpen] = useState(false);
  const [graphSearchQuery, setGraphSearchQuery] = useState("");
  const [impactActive, setImpactActive] = useState(false);
  const [workflowPanel, setWorkflowPanel] = useState(null);
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphPan, setGraphPan] = useState({ x: 0, y: 0 });
  const [refreshingAsOf, setRefreshingAsOf] = useState(false);
  const [loadingColumnLineage, setLoadingColumnLineage] = useState(false);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState("");
  const graphPanDragRef = useRef(null);
  const suppressNextGraphClickRef = useRef(false);
  const pointerEventsAvailable = typeof window !== "undefined" && "PointerEvent" in window;
  const impactRef = useRef(null);
  const columnRef = useRef(null);
  const viewModel = useMemo(
    () => buildLineageViewModel(graph, asset, lineagePayload, context),
    [asset, context, graph, lineagePayload],
  );
  const workspaceScopedLineage = isWorkspaceScopedLineageEvidence(lineagePayload, viewModel.meta);
  const actorVisibleLineage = authoritative && !workspaceScopedLineage;
  const selectedNode =
    asArray(graph?.nodes).find((node) => (node?.id || nodeFqn(node)) === selectedNodeId) ||
    viewModel.focus;
  const defaultInspectorNode =
    viewModel.downstream.find((node) => /payments/i.test(`${nodeTitle(node)} ${nodeFqn(node)}`)) ||
    viewModel.transformation.find((node) => /payments/i.test(`${nodeTitle(node)} ${nodeFqn(node)}`)) ||
    viewModel.downstream[0] ||
    viewModel.focus;
  const inspectorNode = selectedNodeId ? selectedNode : defaultInspectorNode;
  const selectedFqn = nodeFqn(selectedNode) || asset?.fqn || "";
  const selectedOpenabilityState = selectedNode?.details?.openabilityState || "";
  const selectedNodeBlocked = selectedNode?.details?.isOpenable === false && selectedOpenabilityState !== "unverified";
  const selectedNodeOpenable = Boolean(selectedFqn) && !selectedNodeBlocked && selectedNode?.details?.resolutionState !== "lineage-only-blocked";
  const selectedNodeOpenabilityUnverified = Boolean(selectedFqn) && selectedOpenabilityState === "unverified";
  const hasGraphEvidence = Boolean(asArray(graph?.nodes).length || asArray(graph?.edges).length);
  const hasColumnLineage = viewModel.columnTraceCount > 0;
  const hasBackedColumnLineage = Boolean((authoritative || workspaceScopedLineage) && hasColumnLineage);
  const progressiveState = viewModel.stats?.progressive || {};
  const fullLineageProfileAvailable = Boolean(
    progressiveState.fullProfileAvailable ||
      lineagePayload?.profile === "initial" ||
      lineagePayload?.profile === "fast" ||
      lineagePayload?.profile === "first-pass" ||
      lineagePayload?.profile === "first_pass",
  );
  const selectedTitle = nodeDisplayTitle(selectedNode, asset?.name || compactName(asset?.fqn));
  const focusFqn = asset?.fqn || selectedFqn || selectedTitle;
  const limits = viewModel.stats?.limits || {};
  const truncated = viewModel.stats?.truncated || {};
  const truncationNotice =
    truncated.upstream || truncated.downstream || truncated.columnLineage
      ? `Limited to ${limits.tableLineage || "?"} table edges. Column lineage may be partial or unavailable in this workspace.`
      : "";
  const refreshNote = error
    ? {
        label: "Refresh degraded",
        detail: error,
      }
    : provisional
      ? {
          label: "Refresh pending",
          detail: authoritative
            ? "Showing cached live lineage while the graph refresh completes."
            : "Showing provisional lineage context until the authoritative graph resolves.",
        }
      : null;

  const activateTable = () => {
    setLineageMode("table");
    onIncludeColumnsChange?.(false);
    setStatus("Table lineage view active.");
  };
  const activateColumn = async () => {
    if (!hasBackedColumnLineage) {
      if (fullLineageProfileAvailable && typeof onRefreshLineage === "function") {
        setLoadingColumnLineage(true);
        setStatus("Loading backed column lineage from Databricks...");
        try {
          const refreshed = await onRefreshLineage();
          const columnLineage = refreshed?.columnLineage || {};
          const refreshedColumnCount =
            asArray(columnLineage.upstream).length + asArray(columnLineage.downstream).length;
          if (refreshedColumnCount > 0) {
            setLineageMode("column");
            onIncludeColumnsChange?.(true);
            setStatus("Column lineage view active.");
            columnRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
          } else {
            setStatus("Column lineage is unavailable because Databricks returned no backed column proof for this asset.");
          }
        } catch (caught) {
          const message = caught?.message || "Backed column lineage refresh failed.";
          setStatus(`Column lineage refresh failed: ${message}`);
        } finally {
          setLoadingColumnLineage(false);
        }
        return;
      }
      setStatus("Column lineage is unavailable until backed column proof is returned for this asset.");
      return;
    }
    setLineageMode("column");
    onIncludeColumnsChange?.(true);
    setStatus("Column lineage view active.");
    columnRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  const selectNode = (node) => {
    const title = nodeTitle(node);
    setSelectedEdgeKey("");
    setSelectedNodeId(node?.id || nodeFqn(node));
    if (isPermissionBoundaryNode(node)) {
      setWorkflowPanel(makePermissionWorkflow(node));
      setStatus(`${title} selected. Permission boundary detail workflow unavailable without live Unity Catalog proof.`);
      return;
    }
    setStatus(`${title} selected.`);
    // Re-anchor the lineage focus on the selected node when the user clicks
    // an upstream/downstream/peer node. onSelectAsset stays inside the
    // lineage workspace and reloads the graph for the chosen asset, instead
    // of navigating away to the entity workspace. Permission-boundary
    // nodes are blocked here (they have no real assetFqn). Lineage-only
    // references where openability is "unverified" are also blocked so
    // the click matches the disabled state of the detail-panel's Refocus
    // button. Lineage references where openability is unknown OR
    // verified-true are allowed — the click triggers a fetch on the new
    // focus and any 404 / unavailable response is rendered as a truthful
    // empty state by the explorer chrome.
    const nodeAssetFqn = nodeFqn(node);
    const focusAssetFqn = asset?.fqn || "";
    const nodeOpenability = String(node?.details?.openabilityState || "").toLowerCase();
    const nodeResolution = String(node?.details?.resolutionState || "").toLowerCase();
    // Match the same "is this navigable?" check the right-side detail
    // panel's Refocus button uses: a node is navigable when it has a real
    // assetFqn AND isOpenable !== false AND its resolutionState isn't
    // explicitly lineage-only AND its openabilityState isn't unverified.
    const nodeIsNavigable =
      node?.details?.isOpenable !== false &&
      nodeResolution !== "lineage-only" &&
      nodeOpenability !== "unverified" &&
      !isPermissionBoundaryNode(node);
    if (
      typeof onSelectAsset === "function" &&
      nodeAssetFqn &&
      nodeAssetFqn !== focusAssetFqn &&
      node?.role !== "focus" &&
      nodeIsNavigable
    ) {
      onSelectAsset(nodeAssetFqn);
    }
  };
  const selectEdge = (edgePath) => {
    if (!edgePath) return;
    setSelectedEdgeKey(edgePath.key);
    setWorkflowPanel({
      kind: "lineage-edge",
      eyebrow: "Lineage Edge",
      title: `${edgePath.sourceTitle} to ${edgePath.targetTitle}`,
      state: authoritative ? "Backed edge evidence" : "Unavailable workflow",
      source: authoritative ? "lineage graph edge payload" : "live lineage unavailable",
      detail: authoritative
        ? "This edge was returned by the current lineage graph payload and can be inspected from the visible topology."
        : "Edge detail requires live lineage evidence for this route.",
      result: "No lineage mutation was submitted; the edge selection opened backed provenance detail.",
    });
    setStatus(`Lineage edge from ${edgePath.sourceTitle} to ${edgePath.targetTitle} selected.`);
  };
  const handleEdgeKeyDown = (event, edgePath) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    selectEdge(edgePath);
  };
  const copyShareLink = () => {
    const href = typeof window !== "undefined" ? window.location.href : "";
    if (href && navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(href).then(
        () => setStatus("Lineage link copied."),
        () => setStatus("Lineage link ready in the address bar."),
      );
    } else {
      setStatus("Lineage link ready in the address bar.");
    }
  };
  const owner = textValue(
    asset?.ownerName,
    typeof asset?.owner === "string" ? asset.owner : asset?.owner?.name,
    ownerEvidenceLabel(asset?.owners, asset?.stewards, selectedNode?.owners, selectedNode?.stewards),
    selectedNode?.ownerName,
    typeof selectedNode?.owner === "string" ? selectedNode.owner : selectedNode?.owner?.name,
    viewModel.stats?.ownerName,
    viewModel.stats?.owner,
  );
  const certification = textValue(
    asset?.certification,
    asset?.certificationStatus,
    selectedNode?.certification,
    selectedNode?.certificationStatus,
    viewModel.stats?.certification,
    viewModel.stats?.certificationStatus,
  );
  const cdeCount = numericValue(viewModel.stats?.cdeCount, asset?.cdeCount, viewModel.columnTraceCount, 0) ?? 0;
  const revenueImpact = textValue(
    viewModel.stats?.revenueImpact,
    viewModel.stats?.businessImpact,
    viewModel.stats?.impactValue,
    asset?.revenueImpact,
    asset?.businessImpact,
  );
  const upstreamCount = numericValue(viewModel.stats?.upstreamCount, viewModel.upstream.length) ?? 0;
  const downstreamCount = numericValue(viewModel.stats?.downstreamCount, viewModel.downstream.length) ?? 0;
  const hiddenDownstream = numericValue(viewModel.stats?.hiddenDownstreamCount, viewModel.stats?.restrictedDownstreamCount, 0) ?? 0;
  const freshness = textValue(
    viewModel.stats?.freshness,
    viewModel.stats?.freshnessLabel,
    asset?.freshness,
    asset?.freshnessLabel,
  );
  const impactItems = asArray(lineagePayload?.impactAnalysis || lineagePayload?.impacts);
  const hasBackedImpact = authoritative && impactItems.length > 0;
  const downstreamLookup = new Map();
  viewModel.downstream.forEach((node) => {
    [
      node?.id,
      nodeFqn(node),
      nodeTitle(node),
    ].filter(Boolean).forEach((key) => downstreamLookup.set(String(key).toLowerCase(), node));
  });
  const derivedImpact = viewModel.downstream.slice(0, 4).map((node, index) => ({
    id: node?.id || nodeFqn(node) || index,
    title: nodeTitle(node),
    detail: nodeSubtitle(node, nodeFqn(node)),
    tone: "Severity unavailable",
    node,
  }));
  const impactRows = (impactItems.length ? impactItems : derivedImpact).slice(0, 5).map((item) => {
    const lookupKeys = [item?.id, item?.assetFqn, item?.fqn, item?.title].filter(Boolean);
    const node = item?.node || lookupKeys.map((key) => downstreamLookup.get(String(key).toLowerCase())).find(Boolean);
    if (authoritative) return { ...item, node };
    return {
      ...item,
      node,
      detail: node ? nodeSubtitle(node, nodeFqn(node)) : item?.detail || item?.subtitle || "No backed downstream impact evidence returned.",
      proof: "Live impact proof unavailable for this route.",
      tone: "Unavailable",
    };
  });
  if (hiddenDownstream && !impactRows.some((item) => item?.restricted)) {
    impactRows.push({
      id: "restricted-downstream",
      title: `${hiddenDownstream} downstream assets`,
      detail: authoritative
        ? "Hidden by Unity Catalog permissions"
        : "Hidden-downstream proof unavailable for this route.",
      tone: "Restricted",
      restricted: true,
    });
  }
  const columnEntries = [
    ...asArray(viewModel.columnLineage?.upstream),
    ...asArray(viewModel.columnLineage?.downstream),
  ];
  const columnRows = columnEntries.slice(0, 5);
  const columnSource = textValue(
    viewModel.columnLineage?.source,
    viewModel.columnLineage?.meta?.source,
    lineagePayload?.columnLineageSource,
  );
  const versionRows = asArray(
    lineagePayload?.versions ||
    lineagePayload?.versionHistory ||
    asset?.versions ||
    asset?.versionHistory,
  );
  const graphSearchMatches = viewModel.nodes.filter((node) => {
    const query = graphSearchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      nodeTitle(node),
      nodeSubtitle(node),
      nodeFqn(node),
      nodeType(node),
    ].some((value) => String(value || "").toLowerCase().includes(query));
  }).slice(0, 6);
  const upstreamDepth = (node) => numericValue(node?.depth, node?.hop, 1) ?? 1;
  const upstreamOuterNodes = viewModel.upstream
    .filter((node) => upstreamDepth(node) >= 2 || /source/.test(String(nodeType(node)).toLowerCase()) || /source/.test(String(node?.stage || "")))
    .sort((left, right) => {
      const depthDelta = upstreamDepth(right) - upstreamDepth(left);
      if (depthDelta) return depthDelta;
      return nodeTitle(left).localeCompare(nodeTitle(right));
    })
    .slice(0, 3);
  const upstreamTables = viewModel.upstream
    .filter((node) => !upstreamOuterNodes.includes(node))
    .sort((left, right) => upstreamDepth(left) - upstreamDepth(right) || nodeTitle(left).localeCompare(nodeTitle(right)))
    .slice(0, 3);
  const transformNodes = viewModel.transformation.slice(0, 4);
  const downstreamNodes = viewModel.downstream.slice(0, 4);
  const inspectorSourceNodes = /payments/i.test(`${nodeTitle(inspectorNode)} ${nodeFqn(inspectorNode)}`)
    ? transformNodes.slice(0, 2)
    : upstreamTables.length ? upstreamTables : upstreamOuterNodes;
  const hasBackedEdges = asArray(viewModel.edges).length > 0;
  const lineageEvidenceSources = asArray(viewModel.meta?.lineageEvidenceSources);
  const lineageEvidenceLabel = lineageEvidenceSourceLabel(lineageEvidenceSources);
  const lineageEvidenceSourceText = lineageEvidenceSources.join(" ").toLowerCase();
  const nativeLineageSourceVisible =
    !lineageEvidenceSources.length || /system\.access|table_lineage/.test(lineageEvidenceSourceText);
  const governedTagEvidenceVisible =
    /table_tags|governed|tag/.test(lineageEvidenceSourceText) ||
    transformNodes.some((node) => /table_tags|governed tag|system\.information_schema/i.test(`${nodeSubtitle(node)} ${node?.details?.source || ""}`));
  const lineageProvenanceSummary = [
    nativeLineageSourceVisible
      ? `${asArray(viewModel.edges).length || 0} native UC lineage edges`
      : "Native UC lineage not returned",
    governedTagEvidenceVisible
      ? "Governed tag context shown separately"
      : "No governed tag context returned",
    workspaceScopedLineage
      ? "Workspace-scoped response; actor-visible proof unavailable"
      : "Actor-visible lineage response",
    hasBackedColumnLineage
      ? `${viewModel.columnTraceCount} backed column traces`
      : "Column proof unavailable or partial",
  ];
  const graphControlUnavailableReason = "Lineage graph controls require returned lineage edges for this asset.";
  const backedLineageGraph = Boolean(hasGraphEvidence && (authoritative || workspaceScopedLineage));
  const thinLiveLineage = backedLineageGraph && !hasBackedEdges;
  const lineageEvidenceKind = backedLineageGraph
    ? (actorVisibleLineage ? "live_databricks_lineage" : "workspace_scoped_databricks_lineage")
    : "live_lineage_unavailable";
  const isPermissionBoundaryNode = (node) => {
    const text = `${nodeTitle(node)} ${nodeSubtitle(node)} ${nodeType(node)} ${node?.stage || ""} ${node?.details?.resolutionState || ""}`;
    return /restricted|permission|hidden|downstream assets/i.test(text);
  };
  const makeUnavailableReason = (workflowLabel) => {
    if (authoritative) {
      return workspaceScopedLineage
        ? `${workflowLabel} requires returned per-user backing evidence for this asset.`
        : `${workflowLabel} requires returned backing evidence for this actor and asset.`;
    }
    return `${workflowLabel} is unavailable because no live lineage evidence was returned for this route.`;
  };
  const makePermissionWorkflow = (node) => ({
    kind: "permission",
    eyebrow: "Permission Boundary",
    title: `${nodeTitle(node)} detail`,
    state: authoritative ? "Backing evidence required" : "Unavailable workflow",
    source: actorVisibleLineage ? "Unity Catalog visibility policy" : "workspace-scoped Databricks lineage",
    detail: makeUnavailableReason("Permission-boundary detail workflow"),
    result: "No request, grant, or access-review mutation was submitted from this unavailable state.",
  });
  const openImpactWorkflow = (item) => {
    const title = item?.title || item?.label || "Downstream consumer";
    const node = item?.node || null;
    if (node) setSelectedNodeId(node?.id || nodeFqn(node));
    const backed = Boolean(authoritative && hasBackedImpact && !item?.restricted);
    setWorkflowPanel({
      kind: "impact",
      eyebrow: "Consumer Impact",
      title: `${title} workflow`,
      state: backed ? "Backed workflow" : "Unavailable workflow",
      source: backed ? "lineage impactAnalysis payload" : "live lineage unavailable",
      detail: backed
        ? "Backed downstream impact evidence is available for this consumer."
        : makeUnavailableReason("Consumer-impact workflow"),
      result: backed
        ? "Consumer can be reviewed from the selected asset context."
        : "No owner notification, usage assertion, or consumer-impact mutation was submitted.",
    });
    setStatus(`${title} selected. ${backed ? "Consumer impact workflow opened." : "Consumer impact workflow unavailable without backed impact evidence."}`);
  };
  const openColumnWorkflow = (row) => {
    const column = row?.column || row?.targetColumn || "Column";
    const backed = Boolean(hasBackedColumnLineage && columnRows.length);
    setWorkflowPanel({
      kind: "column",
      eyebrow: "Column Lineage",
      title: `${column} workflow`,
      state: backed ? "Backed workflow" : "Unavailable workflow",
      source: hasBackedColumnLineage
        ? (actorVisibleLineage
          ? (columnSource || "lineage API column evidence")
          : "workspace-scoped Databricks column lineage")
        : "live column lineage unavailable",
      detail: backed
        ? (workspaceScopedLineage
          ? `Source column ${row?.sourceColumn || row?.targetColumn || "unavailable"} is visible in the workspace-scoped lineage response.`
          : `Source column ${row?.sourceColumn || row?.targetColumn || "unavailable"} is visible for this actor.`)
        : makeUnavailableReason("Column-lineage detail workflow"),
      result: backed
        ? "Column trace can be reviewed from the returned lineage payload."
        : "No column-level mutation or false completeness claim was created.",
    });
    setStatus(`${column} column lineage row selected. ${backed ? "Column lineage detail workflow opened." : "Column lineage detail workflow unavailable without backed column proof."}`);
  };
  const lineageSourceLabel = backedLineageGraph
    ? (actorVisibleLineage ? "live graph" : "workspace-scoped live graph")
    : "current live route";
  const asOfValue = backedLineageGraph
    ? lineageAsOfDate(viewModel.generatedAt)
    : "Unavailable";
  const asOfState = thinLiveLineage
    ? "No visible edges"
    : backedLineageGraph
      ? (actorVisibleLineage ? "Live query" : "Workspace-scoped")
      : "No live graph";
  const asOfMode = thinLiveLineage ? "queried" : backedLineageGraph ? "live" : "unavailable";
  const backedRefreshAvailable = authoritative && !thinLiveLineage && typeof onRefreshLineage === "function";
  const asOfActionAvailable = backedRefreshAvailable;
  const asOfAction = asOfActionAvailable ? "Now" : "Unavailable";
  const graphBands = [
    {
      label: "2 Hops Upstream",
      emptyTitle: "No outer upstream hop observed",
      emptyMessage: "Unity Catalog has not reported a second upstream hop for this asset.",
      nodes: upstreamOuterNodes,
      role: "upstream",
    },
    {
      label: "1 Hop Upstream",
      emptyTitle: "No upstream tables observed",
      emptyMessage: "No permitted upstream table hop is visible.",
      nodes: upstreamTables,
      role: "upstream",
    },
    {
      label: "Processing Context",
      emptyTitle: "No job or pipeline observed",
      emptyMessage: `No intermediate job, notebook, or view hop is present in ${lineageSourceLabel}.`,
      nodes: transformNodes,
      role: "transform",
    },
    {
      label: "Focus",
      nodes: [viewModel.focus].filter(Boolean),
      role: "focus",
    },
    {
      label: "1 Hop Downstream",
      emptyTitle: "No downstream consumers observed",
      emptyMessage: `The ${lineageSourceLabel} has no downstream edges for this asset.`,
      nodes: downstreamNodes,
      role: "downstream",
    },
  ];
  const topologyEdgePaths = buildTopologyEdgePaths(graphBands, viewModel.edges);
  const selectedEdgePath = topologyEdgePaths.find((edgePath) => edgePath.key === selectedEdgeKey) || null;
  const focusNodeIdForRing = viewModel.focus?.id || nodeFqn(viewModel.focus);
  // Compute the connected subgraph reachable from the hovered node. We walk
  // both directions via the edge list, so the visual highlight shows every
  // node on the source-of-record path and every downstream consumer that
  // ultimately depends on what the user is pointing at. Empty when nothing
  // is hovered, so the dim CSS stays inert in the default state.
  const tracedNodeIds = useMemo(() => {
    if (!hoveredNodeId) return new Set();
    const adjacency = new Map();
    topologyEdgePaths.forEach((edgePath) => {
      if (!edgePath.source || !edgePath.target) return;
      if (!adjacency.has(edgePath.source)) adjacency.set(edgePath.source, new Set());
      if (!adjacency.has(edgePath.target)) adjacency.set(edgePath.target, new Set());
      adjacency.get(edgePath.source).add(edgePath.target);
      adjacency.get(edgePath.target).add(edgePath.source);
    });
    const visited = new Set([hoveredNodeId]);
    const queue = [hoveredNodeId];
    while (queue.length) {
      const next = queue.shift();
      const neighbors = adjacency.get(next);
      if (!neighbors) continue;
      neighbors.forEach((id) => {
        if (visited.has(id)) return;
        visited.add(id);
        queue.push(id);
      });
    }
    return visited;
  }, [hoveredNodeId, topologyEdgePaths]);
  const generatedAt = backedLineageGraph
    ? viewModel.generatedAt
      ? `Topology refreshed ${viewModel.generatedAt}`
      : "Topology source reported by lineage API"
    : "No live topology";
  const freshnessChip = authoritative
    ? (freshness || "Freshness unavailable")
    : (freshness || "Freshness unavailable");
  const cdeChip = authoritative
    ? (cdeCount ? `${cdeCount} CDEs` : "CDEs unavailable")
    : (cdeCount ? `${cdeCount} CDEs` : "CDEs unavailable");
  const ownerChip = authoritative
    ? `Owner: ${owner || "Unavailable"}`
    : `Owner: ${owner || "Unavailable"}`;
  const impactChip = authoritative
    ? (revenueImpact || "Revenue impact unavailable")
    : (revenueImpact || "Revenue impact unavailable");
  const columnSourceLabel = columnRows.length
    ? backedLineageGraph
      ? (columnSource ? `From ${columnSource}` : "From lineage API column evidence")
      : "Column lineage is unavailable for this live route"
    : "No column-lineage rows returned for this asset";
  const lineageHeroCopy = hasBackedEdges
      ? (actorVisibleLineage
        ? "Permission-aware lineage from actor-visible upstream assets through to permitted downstream consumers."
        : "Workspace-scoped lineage from backed Databricks metadata through permitted app-visible downstream consumers.")
      : backedLineageGraph
        ? (actorVisibleLineage
          ? "Permission-aware lineage for the selected asset. Upstream and downstream hops appear when Unity Catalog reports actor-visible edges."
          : "Workspace-scoped lineage for the selected asset. Upstream and downstream hops appear when backed Databricks metadata reports app-visible edges.")
        : "Lineage is unavailable for this asset in the current workspace scope. Search for an openable asset to continue.";
  const hiddenLineageCopy = hiddenDownstream
    ? actorVisibleLineage
      ? " Hidden segments indicate limited Unity Catalog visibility."
      : ""
    : "";
  const certificationChip = authoritative
    ? (certification || "Certification unavailable")
    : (certification || "Certification unavailable");
  const freshnessDisplayChip = authoritative
    ? freshnessChip
    : freshnessChip;
  const cdeDisplayChip = authoritative
    ? cdeChip
    : cdeChip;
  const ownerDisplayChip = authoritative
    ? ownerChip
    : ownerChip;
  const topologyDisplayChip = authoritative
    ? `${upstreamCount} upstream · ${downstreamCount} downstream`
    : `${upstreamCount} upstream · ${downstreamCount} downstream`;
  const impactActionLabel = "Run impact analysis";
  // Detect the initial-profile / hydrating window. The /api/lineage backend
  // returns a shell payload immediately (profile=initial, meta.state=loading,
  // progressive.tableLineageDeferred=true) and only resolves the full
  // topology after Unity Catalog system tables warm up — typically
  // 15-30 seconds for a cold serverless warehouse. Showing "0 nodes · 0
  // edges" against that loading payload reads as "this asset has no
  // lineage", which is misleading. Surface a "Hydrating…" indicator
  // instead until the full profile lands.
  const lineageIsHydrating =
    String(lineagePayload?.profile || "").toLowerCase() === "initial" ||
    Boolean(lineagePayload?.stats?.progressive?.tableLineageDeferred) ||
    String(lineagePayload?.meta?.state || "").toLowerCase() === "loading" ||
    Boolean(lineagePayload?.meta?.capabilities?.hydrating);
  // True when the resolved lineage graph has at least one node beyond the
  // focus. We use this to suppress the per-band 'No X observed' empty
  // placeholders when the graph as a whole has data — empty placeholders
  // sitting next to real node cards reads as broken.
  const graphHasNodes =
    !lineageIsHydrating &&
    (asArray(viewModel.nodes).length > 1 || asArray(viewModel.edges).length > 0);
  const graphCounterLabel = lineageIsHydrating
    ? "Hydrating from Unity Catalog…"
    : `${viewModel.nodes.length || 0} nodes · ${asArray(viewModel.edges).length || 0} edges`;
  const unavailableChipTitle = !backedLineageGraph
      ? "Value unavailable; no live lineage proof returned for this route."
      : !actorVisibleLineage
        ? "Backed by workspace-scoped Databricks metadata; per-user authorization proof is unavailable."
      : undefined;
  const exportEvidence = () => {
    const evidenceKind = lineageEvidenceKind;
    const evidenceWarning = actorVisibleLineage
      ? ""
      : backedLineageGraph
        ? "Lineage graph is backed by workspace-scoped Databricks metadata; per-user authorization proof is unavailable."
        : "Live lineage unavailable; export contains no authoritative graph proof.";
    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        evidenceKind,
        evidenceWarning,
        source: backedLineageGraph ? lineageEvidenceLabel : "lineage-unavailable",
      },
      exportedAt: new Date().toISOString(),
      asset: focusFqn,
      entity_fqn: focusFqn,
      source: generatedAt,
      counts: {
        upstream: upstreamCount,
        downstream: downstreamCount,
        hiddenDownstream,
        columnTraceCount: viewModel.columnTraceCount,
      },
      nodes: viewModel.nodes,
      edges: viewModel.edges,
      columnLineage: viewModel.columnLineage,
      impactAnalysis: impactRows,
    };
    const ok = downloadLineageEvidence(`lineage-evidence-${compactName(focusFqn)}.json`, payload);
    setStatus(ok
      ? "Lineage evidence export generated from the current graph."
      : "Lineage evidence export prepared, but this browser cannot start downloads in the current session.");
  };
  const openVersionComparison = () => {
    setVersionPanelOpen(true);
    setStatus(versionRows.length
      ? "Version comparison opened from persisted lineage snapshots."
      : "No persisted lineage snapshots were returned for this asset.");
  };
  const openImpactAnalysis = async () => {
    if (!authoritative && fullLineageProfileAvailable && typeof onRefreshLineage === "function") {
      setStatus("Loading backed downstream impact evidence from Databricks...");
      try {
        await onRefreshLineage();
      } catch (caught) {
        const message = caught?.message || "Backed impact refresh failed.";
        setStatus(`Impact analysis refresh failed: ${message}`);
        return;
      }
    } else if (!authoritative) {
      setImpactActive(true);
      setStatus("Impact analysis opened with an honest unavailable state because backed downstream impact evidence is not available yet.");
      impactRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      return;
    }
    setImpactActive(true);
    setStatus(hasBackedImpact
      ? "Impact analysis focused on downstream lineage consumers."
      : "Impact analysis opened with no backed downstream impact evidence for this asset.");
    impactRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  const refocusGraph = () => {
    if (!selectedFqn || !authoritative) return;
    setStatus(`Lineage graph refocused on ${compactName(selectedFqn)}.`);
    onSelectAsset?.(selectedFqn);
  };
  const refreshLineageToNow = async () => {
    if (!asOfActionAvailable) return;
    if (typeof onRefreshLineage !== "function") {
      setStatus("Lineage time selection requires a backed live lineage refresh endpoint.");
      return;
    }
    setRefreshingAsOf(true);
    setStatus("Refreshing current live lineage...");
    try {
      const refreshed = await onRefreshLineage();
      setStatus(refreshed
        ? "Lineage refreshed to current live graph."
        : "Live lineage refresh completed without a returned graph payload.");
    } catch (caught) {
      const message = caught?.message || "Live lineage refresh failed.";
      setStatus(`Lineage refresh failed: ${message}`);
    } finally {
      setRefreshingAsOf(false);
    }
  };
  const setZoomLevel = (nextZoom) => {
    const bounded = Math.min(1.25, Math.max(0.85, nextZoom));
    setGraphZoom(bounded);
    setStatus(`Lineage graph zoom set to ${Math.round(bounded * 100)}%.`);
  };
  const zoomGraphWithWheel = (event) => {
    if (event.target?.closest?.("a, button, input, textarea, select, .ga-lineage-details-panel, .ga-lineage-graph-search")) return;
    const native = event?.nativeEvent || {};
    const deltaY = Number(event?.deltaY ?? native.deltaY);
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    // Stop the wheel event from ALSO scrolling the page beneath the
    // canvas. Without this the wheel did a "half-scroll + half-zoom"
    // because both handlers fired. preventDefault on a passive listener
    // can throw — guard.
    try {
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof native.preventDefault === "function") native.preventDefault();
    } catch (_) { /* passive listener — ignore */ }
    setGraphZoom((current) => {
      const nextZoom = Math.min(1.25, Math.max(0.85, current + (deltaY < 0 ? 0.05 : -0.05)));
      setStatus(`Lineage graph zoom set to ${Math.round(nextZoom * 100)}%.`);
      return nextZoom;
    });
  };
	  const fitGraphToView = () => {
	    setGraphZoom(1);
	    setGraphPan({ x: 0, y: 0 });
	    setStatus("Lineage graph fit to view.");
	  };
	  const toggleGraphSearch = () => {
	    setGraphSearchOpen((current) => {
	      const next = !current;
	      if (!next) {
	        setGraphSearchQuery("");
	      }
	      setStatus(next ? "Graph search opened for the current lineage nodes." : "Graph search closed.");
	      return next;
	    });
	  };
	  const clearGraphSearch = () => {
	    setGraphSearchQuery("");
	    setStatus("Graph search cleared.");
	  };
  const graphDragPoint = (event) => {
    const native = event?.nativeEvent || {};
    const x = Number(event?.clientX ?? native.clientX);
    const y = Number(event?.clientY ?? native.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };
  const graphDragId = (event) => event?.pointerId ?? event?.nativeEvent?.pointerId ?? "mouse";
  const startGraphPan = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target?.closest?.("a[href], input, textarea, select, .ga-lineage-details-panel, .ga-lineage-graph-search")) return;
    const point = graphDragPoint(event);
    if (!point) return;
    const pointerId = graphDragId(event);
    graphPanDragRef.current = {
      pointerId,
      startX: point.x,
      startY: point.y,
      originX: graphPan.x,
      originY: graphPan.y,
      moved: false,
    };
    if (pointerId !== "mouse") {
      event.currentTarget?.setPointerCapture?.(pointerId);
    }
  };
  const moveGraphPan = (event) => {
    const drag = graphPanDragRef.current;
    if (!drag || drag.pointerId !== graphDragId(event)) return;
    const point = graphDragPoint(event);
    if (!point) return;
    const nextX = Math.max(-360, Math.min(360, drag.originX + point.x - drag.startX));
    const nextY = Math.max(-260, Math.min(260, drag.originY + point.y - drag.startY));
    drag.moved = drag.moved || Math.abs(nextX - drag.originX) > 2 || Math.abs(nextY - drag.originY) > 2;
    setGraphPan({ x: nextX, y: nextY });
  };
	  const endGraphPan = (event) => {
	    const drag = graphPanDragRef.current;
	    if (!drag || drag.pointerId !== graphDragId(event)) return;
	    graphPanDragRef.current = null;
    if (drag.pointerId !== "mouse") {
      event.currentTarget?.releasePointerCapture?.(drag.pointerId);
    }
    if (drag.moved) {
      suppressNextGraphClickRef.current = true;
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(() => {
          suppressNextGraphClickRef.current = false;
        }, 250);
      }
	      setStatus("Lineage graph panned.");
	    }
	  };
  const suppressGraphClickAfterPan = (event) => {
    if (!suppressNextGraphClickRef.current) return;
    suppressNextGraphClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
	  const startGraphPanFromMouse = (event) => {
	    if (pointerEventsAvailable) return;
	    startGraphPan(event);
	  };
	  const moveGraphPanFromMouse = (event) => {
	    if (pointerEventsAvailable) return;
	    moveGraphPan(event);
	  };
	  const endGraphPanFromMouse = (event) => {
	    if (pointerEventsAvailable) return;
	    endGraphPan(event);
	  };

  // No-asset empty state. Replaces the prior layout where a giant
  // "Unknown asset" headline + a row of "X unavailable" chips + an empty
  // graph canvas all rendered against a left-aligned search card. The
  // design's lineage-empty pattern is a clean centered call-to-action;
  // we mirror that here with the brand-aligned search input and the
  // node-type legend pinned to the bottom.
  //
  // Skip when an explicit error/notice is set OR when the caller passed
  // an asset (even one without lineage data) — those cases need the full
  // explorer chrome so the user can see the failure context, retry, etc.
  if (!asset && !error && !notice && (!focusFqn || focusFqn === "Unknown asset")) {
    return (
      <section
        className="ga-lineage-explorer ga-lineage-explorer-empty"
        data-testid="lineage-northstar-explorer"
      >
        <div className="ga-lineage-empty-hero">
          <div className="ga-lineage-empty-card">
            <span className="ga-lineage-eyebrow">Lineage Atlas</span>
            <h1>Trace the path of any governed asset</h1>
            <p>
              Search for a Unity Catalog asset to open its lineage graph. Atlas
              walks {`system.access.table_lineage`} outward from the focus node and
              renders every actor-visible upstream and downstream hop.
            </p>
            <div className="ga-lineage-empty-search">{overlay}</div>
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

  return (
    <section className={`ga-lineage-explorer ${thinLiveLineage ? "is-thin-live-lineage" : ""}`.trim()} data-testid="lineage-northstar-explorer">
      <header className="ga-lineage-hero">
        <div>
          <span className="ga-lineage-eyebrow">Lineage Atlas</span>
          <h1>{focusFqn}</h1>
          <p>
            {lineageHeroCopy}
            {hiddenLineageCopy}
          </p>
          <div className="ga-lineage-chip-row" aria-label="Lineage evidence chips">
            <span title={unavailableChipTitle} className={/certified/i.test(certification) ? "tone-good" : "tone-muted"}>{certificationChip}</span>
            <span title={unavailableChipTitle} className={freshness ? "" : "tone-muted"}>{freshnessDisplayChip}</span>
            <span title={unavailableChipTitle} className={cdeCount ? "tone-good" : "tone-muted"}>{cdeDisplayChip}</span>
            <span title={unavailableChipTitle} className={owner ? "" : "tone-muted"}>{ownerDisplayChip}</span>
            <span title={unavailableChipTitle}>{topologyDisplayChip}</span>
            <span title={unavailableChipTitle} className={revenueImpact ? "" : "tone-muted"}>{impactChip}</span>
          </div>
        </div>
        <div className="ga-lineage-hero-actions">
          <button
            disabled={loadingColumnLineage || (!hasBackedColumnLineage && !fullLineageProfileAvailable)}
            onClick={activateColumn}
            title={!hasBackedColumnLineage && !fullLineageProfileAvailable ? "Column lineage requires backed live column proof for this asset." : undefined}
            type="button"
          >
            <LineageIcon name="columns" />
            <span>Column lineage</span>
          </button>
          <button
            className="is-primary"
            onClick={openImpactAnalysis}
            title={!authoritative && !fullLineageProfileAvailable
              ? "Open impact analysis with an honest unavailable state until backed downstream impact evidence is returned."
              : !authoritative
                ? "Impact analysis will load backed downstream impact evidence before opening."
              : !hasBackedImpact
                ? "Open impact analysis with an honest unavailable state because no backed downstream consumers were returned."
                : undefined}
            type="button"
          >
            <LineageIcon name="impact" />
            <span>{impactActionLabel}</span>
          </button>
        </div>
      </header>

      {versionPanelOpen ? (
        <section className="ga-lineage-action-panel" aria-label="Lineage version comparison">
          <header>
            <div>
              <strong>Lineage version comparison</strong>
              <span>{versionRows.length ? "Persisted lineage snapshots returned for this asset." : "Persisted lineage snapshots are not available for this asset."}</span>
            </div>
            <button onClick={() => setVersionPanelOpen(false)} type="button">Close</button>
          </header>
          {versionRows.length ? (
            <div className="ga-lineage-version-list">
              {versionRows.slice(0, 4).map((row, index) => (
                <div key={row.id || row.version || row.createdAt || index}>
                  <strong>{row.label || row.version || `Snapshot ${index + 1}`}</strong>
                  <span>{row.createdAt || row.timestamp || row.asOf || "Timestamp unavailable"}</span>
                  <em>{row.summary || row.detail || "Snapshot metadata returned without a change summary."}</em>
                </div>
              ))}
            </div>
          ) : (
            <p>
              Version comparison requires stored lineage snapshots. The current graph remains usable, but no historical graph was returned by the lineage payload.
            </p>
          )}
        </section>
      ) : null}

      {notice ? (
        <div className="ga-lineage-notice-stack">
          <InlineStatusBanner message={notice} title="Navigation limited" />
        </div>
      ) : null}

      <div className="ga-lineage-workbench">
        <div className="ga-lineage-main-column">
          <main className="ga-lineage-graph-card">
            <div className="ga-lineage-graph-card-toolbar">
              <div className="ga-lineage-canvas-tools" aria-label="Lineage canvas tools">
                <button
                  aria-label="Zoom in"
                  disabled={!hasBackedEdges}
                  onClick={() => {
                    if (hasBackedEdges) setZoomLevel(graphZoom + 0.08);
                  }}
                  title={!hasBackedEdges ? graphControlUnavailableReason : undefined}
                  type="button"
                >
                  +
                </button>
                <button
                  aria-label="Zoom out"
                  disabled={!hasBackedEdges}
                  onClick={() => {
                    if (hasBackedEdges) setZoomLevel(graphZoom - 0.08);
                  }}
                  title={!hasBackedEdges ? graphControlUnavailableReason : undefined}
                  type="button"
                >
                  -
                </button>
                <button
                  aria-label="Fit graph"
                  disabled={!hasBackedEdges}
                  onClick={fitGraphToView}
                  title={!hasBackedEdges ? graphControlUnavailableReason : undefined}
                  type="button"
                >
                  <LineageIcon name="fit" />
                </button>
                <button
                  aria-label="Graph history"
                  disabled={!versionRows.length}
                  onClick={openVersionComparison}
                  title={!versionRows.length ? "Graph history requires persisted lineage snapshots." : undefined}
                  type="button"
                >
                  <LineageIcon name="history" />
                </button>
                <span>
                  <LineageIcon name="lightning" />
                  {graphCounterLabel}
                </span>
              </div>
              {backedLineageGraph ? (
                <div className="ga-lineage-legend" aria-label="Lineage legend">
                  <span className="tone-good">Certified</span>
                  <span className="tone-source">Source</span>
                  <span className="tone-job">Job / Pipeline</span>
                  <span className="tone-restricted">Restricted</span>
                  <span>{generatedAt}</span>
                  {truncationNotice ? (
                    <>
                      <span className="tone-restricted" title={truncationNotice}>Partial lineage</span>
                      <span className="gh-visually-hidden">{truncationNotice}</span>
                    </>
                  ) : null}
                  {refreshNote ? (
                    <span className="tone-restricted" title={refreshNote.detail}>{refreshNote.label}</span>
                  ) : null}
                </div>
              ) : null}
              {backedLineageGraph ? (
                <div className="ga-lineage-graph-toolbar" aria-label="Lineage graph tools">
                  <PillButton active={lineageMode === "table"} onClick={activateTable} testId="lineage-table-mode">
                    Table lineage
                  </PillButton>
                  <PillButton
                    active={lineageMode === "column"}
                    disabled={loadingColumnLineage || (!hasBackedColumnLineage && !fullLineageProfileAvailable)}
                    onClick={activateColumn}
                    testId="lineage-column-mode"
                    title={
                      loadingColumnLineage
                        ? "Loading backed column lineage from Databricks."
                        : !hasBackedColumnLineage && fullLineageProfileAvailable
                          ? "Load backed column lineage from Databricks."
                          : !hasBackedColumnLineage
                            ? "Column lineage requires backed live column proof for this asset."
                            : ""
                    }
                  >
                    {loadingColumnLineage ? "Loading column lineage" : "Column lineage"}
                  </PillButton>
	                  <button
	                    aria-expanded={graphSearchOpen}
	                    onClick={toggleGraphSearch}
	                    type="button"
	                  >
	                    Search
                  </button>
                  <button onClick={exportEvidence} type="button">Export</button>
                </div>
              ) : null}
            </div>
            {graphSearchOpen ? (
              <div className="ga-lineage-graph-search" role="search">
                <label>
                  <span>Search graph</span>
	                  <input
	                    autoFocus
	                    onChange={(event) => setGraphSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setGraphSearchOpen(false);
                          setGraphSearchQuery("");
                          setStatus("Graph search closed.");
                          return;
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          const firstMatch = graphSearchMatches[0];
                          if (firstMatch) {
                            selectNode(firstMatch);
                          } else {
                            setStatus(`No visible graph nodes match "${graphSearchQuery.trim()}".`);
                          }
                        }
                      }}
	                    placeholder="Find node or column"
	                    type="search"
	                    value={graphSearchQuery}
	                  />
	                  {graphSearchQuery ? (
	                    <button aria-label="Clear graph search" onClick={clearGraphSearch} type="button">
	                      Clear
	                    </button>
	                  ) : null}
	                </label>
                <div>
                  {graphSearchMatches.length ? graphSearchMatches.map((node) => (
                    <button key={node?.id || nodeFqn(node)} onClick={() => selectNode(node)} type="button">
                      <strong>{nodeTitle(node)}</strong>
                      <span>{nodeSubtitle(node, nodeFqn(node))}</span>
                    </button>
                  )) : <p>No visible graph nodes match this search.</p>}
                </div>
              </div>
            ) : null}
            {loading && !hasGraphEvidence ? (
              <LineageLoadingGraphShell message="Refreshing live lineage evidence..." title="Loading lineage graph" />
            ) : overlay && !viewModel.nodes.length ? (
              <div className="ga-lineage-overlay-slot">{overlay}</div>
            ) : (
              <div
                className={`ga-lineage-graph-body is-lineage-topology ${authoritative ? "is-authoritative" : "is-live-unavailable"} ${
                  thinLiveLineage ? "is-thin-live-lineage" : ""
	                }`.trim()}
	                data-testid="lineage-graph-body"
	                onClickCapture={suppressGraphClickAfterPan}
	                onMouseDown={startGraphPanFromMouse}
	                onMouseLeave={endGraphPanFromMouse}
	                onMouseMove={moveGraphPanFromMouse}
	                onMouseUp={endGraphPanFromMouse}
	                onPointerCancel={endGraphPan}
	                onPointerDown={startGraphPan}
	                onPointerLeave={endGraphPan}
	                onPointerMove={moveGraphPan}
	                onPointerUp={endGraphPan}
	                onWheel={zoomGraphWithWheel}
                style={{
                  "--ga-lineage-pan-x": `${graphPan.x}px`,
                  "--ga-lineage-pan-y": `${graphPan.y}px`,
                  "--ga-lineage-zoom": graphZoom,
                }}
              >
                <div
                  className={`ga-lineage-graph-bands ${lineageMode === "column" ? "is-column-mode" : ""} ${hoveredNodeId ? "is-tracing" : ""}`.trim()}
                  data-zoom-level={graphZoom.toFixed(2)}
                  data-hovered-node={hoveredNodeId || undefined}
                >
                  {topologyEdgePaths.length ? (
                    <svg
                      aria-label="Lineage edge paths"
                      className="ga-lineage-edge-overlay"
                      focusable="false"
                      preserveAspectRatio="none"
                      viewBox="0 0 1000 862"
                    >
                      <defs>
                        <marker
                          id="ga-lineage-arrow"
                          markerHeight="7"
                          markerWidth="7"
                          orient="auto"
                          refX="6.2"
                          refY="3.5"
                          viewBox="0 0 7 7"
                        >
                          <path d="M0 0 7 3.5 0 7z" />
                        </marker>
                      </defs>
                      {topologyEdgePaths.map((edgePath) => {
                        const isFocusEdge = focusNodeIdForRing && (edgePath.source === focusNodeIdForRing || edgePath.target === focusNodeIdForRing);
                        const isTraced = !hoveredNodeId || (tracedNodeIds.has(edgePath.source) && tracedNodeIds.has(edgePath.target));
                        return (
                        <g
                          key={edgePath.key}
                          data-edge-traced={isTraced ? "true" : "false"}
                        >
                          <path
                            className={`${edgePath.className || ""} ${selectedEdgeKey === edgePath.key ? "is-selected" : ""} ${isFocusEdge ? "is-focus-edge" : ""}`.trim() || undefined}
                            d={edgePath.d}
                            data-edge-source={edgePath.source || undefined}
                            data-edge-target={edgePath.target || undefined}
                            data-testid="lineage-topology-edge"
                          />
                          {/* Animated flow particles travel along edges that touch the focus
                              node, giving an at-a-glance signal of which subgraph powers the
                              currently selected asset. Particles are pure SVG and animate
                              via SMIL <animateMotion>; they're suppressed for browsers that
                              honor prefers-reduced-motion via CSS on the parent group. */}
                          {isFocusEdge ? (
                            <>
                              <circle
                                aria-hidden="true"
                                className="ga-lineage-flow-particle"
                                r="2.4"
                              >
                                <animateMotion dur="2.4s" path={edgePath.d} repeatCount="indefinite" rotate="auto" />
                              </circle>
                              <circle
                                aria-hidden="true"
                                className="ga-lineage-flow-particle is-trail"
                                r="1.6"
                              >
                                <animateMotion begin="0.6s" dur="2.4s" path={edgePath.d} repeatCount="indefinite" rotate="auto" />
                              </circle>
                            </>
                          ) : null}
                          <path
                            aria-label={`Select lineage edge from ${edgePath.sourceTitle} to ${edgePath.targetTitle}`}
                            className={`ga-lineage-edge-hit ${selectedEdgeKey === edgePath.key ? "is-selected" : ""}`.trim()}
                            d={edgePath.d}
                            data-testid="lineage-topology-edge-hit"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              selectEdge(edgePath);
                            }}
                            onKeyDown={(event) => handleEdgeKeyDown(event, edgePath)}
                            role="button"
                            tabIndex={0}
                          />
                        </g>
                        );
                      })}
                    </svg>
                  ) : null}
                  {graphBands.map((band) => (
                    <section className={band.role === "focus" ? "is-focus-band" : ""} key={band.label}>
                      <h2>{band.label}</h2>
                      {band.nodes.length ? (
                        band.nodes.map((node) => {
                          const nodeKey = node?.id || nodeFqn(node);
                          const inspectorKey = inspectorNode?.id || nodeFqn(inspectorNode);
                          // is-traced marks whether the node is part of the
                          // hovered subgraph. When nothing is hovered, every
                          // node renders at full intensity (no class applied).
                          const traced = hoveredNodeId
                            ? tracedNodeIds.has(nodeKey)
                            : true;
                          return (
                            <div
                              className={`ga-lineage-node-wrap ${traced ? "is-traced" : "is-untraced"}`}
                              data-node-id={nodeKey || undefined}
                              key={nodeKey}
                              onMouseEnter={() => nodeKey && setHoveredNodeId(nodeKey)}
                              onMouseLeave={() => setHoveredNodeId("")}
                              onFocus={() => nodeKey && setHoveredNodeId(nodeKey)}
                              onBlur={() => setHoveredNodeId("")}
                            >
                              <NodeButton
                                active={band.role === "focus" || nodeKey === selectedNodeId || (!selectedNodeId && nodeKey === inspectorKey)}
                                asset={asset}
                                node={node}
                                role={band.role}
                                authoritative={authoritative}
                                onSelect={selectNode}
                              />
                            </div>
                          );
                        })
                      ) : lineageIsHydrating ? (
                        // While the lineage payload is hydrating, render a
                        // pulsing skeleton in place of the "No X observed"
                        // empty-state copy. The empty-state copy implies the
                        // backend has resolved and returned no edges, which
                        // is misleading during the initial-profile window.
                        <div
                          aria-hidden="true"
                          className="ga-lineage-band-skeleton"
                          data-band-role={band.role || ""}
                        />
                      ) : graphHasNodes ? (
                        // Once hydration completes, suppress the per-band
                        // empty-state placeholder boxes when the graph as a
                        // whole has nodes. Empty boxes alongside real node
                        // cards looked broken — the user expected the
                        // bands to silently collapse when there's nothing
                        // to show on that hop.
                        null
                      ) : (
                        <EmptyGraphSlot title={band.emptyTitle} message={band.emptyMessage} role={band.role} />
                      )}
                    </section>
                  ))}
                </div>
                <LineageDetailsPanel
                  selectedNode={inspectorNode}
                  owner={owner}
                  freshness={textValue(inspectorNode?.freshness, freshness || generatedAt)}
                  sourceNodes={inspectorSourceNodes}
                  downstreamNodes={downstreamNodes}
                  events={lineagePayload?.events}
                  authoritative={authoritative}
                  onSelect={selectNode}
                />
              </div>
            )}
            <div className="ga-lineage-node-types" aria-label="Node types">
              <strong>Node Types</strong>
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
              <em>
                {backedLineageGraph
                  ? actorVisibleLineage
                    ? `via ${lineageEvidenceLabel}`
                    : "Workspace-scoped Databricks lineage; actor-visible proof unavailable"
                  : "No live topology returned; system.access.table_lineage not verified for this route"}
              </em>
              <div className="ga-lineage-provenance-summary" aria-label="Lineage provenance summary">
                {lineageProvenanceSummary.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
            <div className="ga-lineage-card-foot">
              <span>{selectedTitle} selected</span>
              <button
                disabled={!selectedNodeOpenable}
                onClick={() => selectedNodeOpenable && onOpenAsset?.(selectedFqn, "Overview")}
                title={!selectedNodeOpenable
                  ? "This lineage node is present in the graph, but its metadata record is not openable with the current permissions."
                  : selectedNodeOpenabilityUnverified
                    ? "Open this lineage reference. If the current actor cannot access it directly, the asset page will show an unavailable state."
                    : undefined}
                type="button"
              >
                Open asset
              </button>
            </div>
          </main>

          <section className="ga-lineage-asof-panel" aria-label="Lineage as of">
            <div>
              <LineageIcon name="history" />
              <span>Lineage as of:</span>
              <strong>{asOfValue}</strong>
              <em>{asOfState}</em>
            </div>
            <div className="ga-lineage-asof-actions">
              <small>{asOfMode}</small>
	              <button
                disabled={!asOfActionAvailable || refreshingAsOf}
                type="button"
                title={!asOfActionAvailable ? "Lineage time selection requires backed live lineage evidence." : undefined}
                onClick={refreshLineageToNow}
              >
                <LineageIcon name="history" />
                <span>{refreshingAsOf ? "Refreshing" : asOfAction}</span>
              </button>
            </div>
          </section>

          {workflowPanel ? (
            <section className={`ga-lineage-workflow-panel is-${workflowPanel.kind}`} aria-label="Lineage workflow detail">
              <header>
                <div>
                  <span>{workflowPanel.eyebrow}</span>
                  <strong>{workflowPanel.title}</strong>
                </div>
                <em>{workflowPanel.state}</em>
              </header>
              <dl>
                <div>
                  <dt>Source</dt>
                  <dd>{workflowPanel.source}</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>{workflowPanel.result}</dd>
                </div>
              </dl>
              <p>{workflowPanel.detail}</p>
              {selectedEdgePath ? (
                <div className="ga-lineage-edge-detail" aria-label="Selected edge detail">
                  <span>{selectedEdgePath.sourceTitle}</span>
                  <span aria-hidden="true">→</span>
                  <span>{selectedEdgePath.targetTitle}</span>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="ga-lineage-bottom-row">
            <section className={`ga-lineage-bottom-card ${impactActive ? "is-focused" : ""}`.trim()} ref={impactRef}>
              <header>
                <div>
                  <strong>Impact analysis</strong>
                  <span>
                    {hasBackedImpact
                      ? `If you change \`${columnRows[0]?.column || "this asset"}\`, these consumers are affected`
                      : "Downstream lineage consumers affected by upstream changes"}
                  </span>
                </div>
                <button
                  disabled={!authoritative || !hasBackedImpact}
                  onClick={() => selectedFqn && onOpenGovernance?.(selectedFqn)}
                  title={!authoritative || !hasBackedImpact ? "Owner review requires backed impact evidence." : undefined}
                  type="button"
                >
                  Review owners
                </button>
              </header>
              <div className="ga-lineage-impact-list">
                {impactRows.length ? impactRows.map((item, index) => {
	                  const kind = impactKind(item);
	                  const detail = splitImpactDetail(item);
	                  const title = impactDisplayTitle(item);
                  const tone = item.tone || (hasBackedImpact ? "Medium" : "Severity unavailable");
                  const toneKey = String(tone).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                  return (
                    <button
                      className={`is-${kind}`}
                      data-impact-kind={kind}
                      key={item.id || item.title || index}
                      onClick={() => openImpactWorkflow(item)}
                      type="button"
                    >
                      <span className="ga-lineage-impact-icon" aria-hidden="true">
                        <LineageIcon name={impactIconName(kind)} />
                      </span>
                      <span className="ga-lineage-impact-copy">
                        <strong>{title}</strong>
                        <small>{detail.owner} · {detail.meta}</small>
                      </span>
                      <em className={`tone-${toneKey}`}>{tone}</em>
                    </button>
                  );
                }) : <p>No downstream impact is observed for this asset.</p>}
	              </div>
                <footer className="ga-lineage-impact-provenance">
                  <span>{impactRows.length ? `${impactRows.length} consumer paths visible` : "0 consumer paths visible"}</span>
                  <span>
	                    {authoritative
	                      ? (hasBackedImpact ? "lineage impactAnalysis payload" : "no backed impact rows returned")
	                      : "live impact workflow unavailable"}
                  </span>
                </footer>
	            </section>
	            <section
                  className={`ga-lineage-bottom-card ${lineageMode === "column" ? "is-focused" : ""}`.trim()}
                  ref={columnRef}
                >
	              <header>
	                <div>
	                  <strong>{columnRows.length ? `Column lineage · ${columnRows[0]?.column || "selected column"}` : "Column lineage unavailable"}</strong>
                  <span>{columnSourceLabel}</span>
	                </div>
	              </header>
	              <div className="ga-lineage-column-list">
	                {columnRows.length ? columnRows.map((row, index) => (
	                  <button
                      key={`${row.column || row.targetColumn || "column"}-${index}`}
                      onClick={() => openColumnWorkflow(row)}
                      type="button"
                    >
	                    <span>{row.column || row.targetColumn || "column"}</span>
	                    <small>
	                      {row.sourceColumn || row.targetColumn || row.transformation || "source column"} · {row.sourceAsset || row.targetAsset || "this table"}
	                    </small>
	                  </button>
	                )) : (
	                  <p>Column lineage is unavailable until Databricks reports column-level lineage rows for this asset.</p>
	                )}
	              </div>
                  <footer className="ga-lineage-column-provenance">
                    <span>{columnRows.length ? `${columnRows.length} column paths visible` : "0 column paths visible"}</span>
                    <span>
	                      {hasBackedColumnLineage
	                        ? (actorVisibleLineage ? (columnSource || "lineage API") : "workspace-scoped column lineage")
	                        : "live column lineage unavailable"}
                    </span>
                  </footer>
	            </section>
          </div>
        </div>
      </div>

      <div className="ga-lineage-status" aria-live="polite">
        {status || (refreshNote
          ? `${refreshNote.label} - current ${viewModel.modeLabel.toLowerCase()} topology remains visible.`
          : backedLineageGraph
            ? thinLiveLineage
              ? `${actorVisibleLineage ? "Live" : "Workspace-scoped"} ${viewModel.modeLabel.toLowerCase()} lineage query returned no visible edges.`
              : `${actorVisibleLineage ? "Authoritative" : "Workspace-scoped"} ${viewModel.modeLabel.toLowerCase()} lineage ready.`
            : `${viewModel.modeLabel} lineage unavailable`)}
        {selectedFqn ? (
          <button
            disabled={!selectedNodeOpenable || !authoritative}
            onClick={refocusGraph}
            title={!authoritative
              ? workspaceScopedLineage
                ? "Refocus requires actor-visible lineage proof for this route."
                : "Refocus requires backed live lineage evidence for this route."
              : !selectedNodeOpenable
                ? "This lineage node is not openable with the current permissions."
                : selectedNodeOpenabilityUnverified
                  ? "Refocus this lineage reference. If the graph is not visible for the current actor, the page will show an unavailable state."
                  : undefined}
            type="button"
          >
            Refocus graph
          </button>
        ) : null}
      </div>
    </section>
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
  onModeChange = NOOP,
  linkedRecordUnavailableOverrides = {},
  upstreamLevels = 2,
  downstreamLevels = 2,
  maxDepth = 2,
  nodesPerLayer = 10,
  includeColumns = false,
  onUpstreamLevelsChange = NOOP,
  onDownstreamLevelsChange = NOOP,
  onMaxDepthChange = NOOP,
  onNodesPerLayerChange = NOOP,
  onIncludeColumnsChange = NOOP,
  onContextChange = NOOP,
  onOpenGovernance = NOOP,
  onSelectAsset = NOOP,
  onOpenAsset = NOOP,
  onRefreshLineage,
  assetSearchQuery,
  onAssetSearchQueryChange = NOOP,
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

  if (!embedded) {
    return (
      <NorthStarLineageExplorer
        asset={asset}
        graph={graph || emptyGraph}
        lineagePayload={lineagePayload}
        loading={loading}
        error={error}
        notice={notice}
        overlay={overlay}
        authoritative={authoritative}
        provisional={provisional}
        context={context}
        includeColumns={includeColumns}
        onIncludeColumnsChange={onIncludeColumnsChange}
        onOpenGovernance={onOpenGovernance}
        onOpenAsset={onOpenAsset}
        onRefreshLineage={onRefreshLineage}
        onSelectAsset={onSelectAsset}
      />
    );
  }

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
            title={authoritative ? "Live lineage still loading" : "Lineage authority unavailable"}
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
            <LineageLoadingGraphShell message="Loading lineage graph..." title="Refreshing graph" />
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
