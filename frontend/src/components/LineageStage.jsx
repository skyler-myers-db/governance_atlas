import { useMemo, useRef, useState } from "react";
import { displayObjectType } from "../lib/assetPresentation";
import { Breadcrumbs } from "./primitives/Breadcrumbs";
import LineageGraph from "./LineageGraph";
import { EmptyStateBlock, InlineStatusBanner } from "./ShellStatePrimitives";

/** @type {(...args: any[]) => void} */
const NOOP = () => {};

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
    const leftOrder = numericValue(left?.hop, left?.order, left?.sequence, 0) ?? 0;
    const rightOrder = numericValue(right?.hop, right?.order, right?.sequence, 0) ?? 0;
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
  const stageFor = (node) => {
    const explicit = String(node?.stage || node?.lineageStage || node?.band || "").toLowerCase();
    if (/upstream|source|input/.test(explicit)) return "upstream";
    if (/transform|job|pipeline|process|intermediate/.test(explicit)) return "transformation";
    if (/downstream|consumer|output/.test(explicit)) return "downstream";
    if (/focus|current/.test(explicit) || node?.role === "focus") return "focus";
    const id = node?.id || nodeFqn(node);
    const kind = String(nodeType(node)).toLowerCase();
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
  const displaySubtitle = !authoritative && /permission-limited/i.test(subtitle)
    ? "PROTOTYPE PERMISSION BOUNDARY"
    : subtitle;
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
        {displaySubtitle ? <span>{displaySubtitle}</span> : null}
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

function prototypeLineageText(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/system\.access/i.test(text)) return fallback;
  return text
    .replace(/^prototype\s+/i, "")
    .replace(/\b(\d+(?:\.\d+)?[KMB]?)\s+prototype rows\b/gi, "$1 rows");
}

function prototypeRelativeTime(value, fallback = "11 min ago") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  const compact = text.match(/^(\d+)\s*m$/i);
  if (compact) return `${compact[1]} min ago`;
  if (/^\d+\s*min/i.test(text) || /\bago\b/i.test(text)) return text;
  return text.replace(/^prototype\s+/i, "");
}

function prototypeActivityTitle(value) {
  const text = String(value || "").trim();
  if (!text) return "Notebook payments_clean succeeded · 13.5M rows";
  return text
    .replace(/^prototype\s+/i, "")
    .replace(/\b(\d+(?:\.\d+)?[KMB]?)\s+prototype rows\b/gi, "$1 rows");
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

function splitImpactDetail(item, prototypeMode) {
  const rawDetail = textValue(item?.detail, item?.subtitle, item?.meta);
  const detail = prototypeMode
    ? prototypeLineageText(rawDetail, "Downstream consumer")
    : rawDetail || "No backed downstream impact evidence returned.";
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

function impactDisplayTitle(item, prototypeMode) {
  const title = textValue(item?.title, item?.label, nodeTitle(item?.node || {}), "Downstream consumer");
  if (prototypeMode) {
    return title.replace("Board Pack - Revenue", "Board Pack — Revenue");
  }
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
  prototypeMode = false,
  onSelect = NOOP,
}) {
  const title = nodeDisplayTitle(selectedNode);
  const subtitle = nodeSubtitle(selectedNode);
  const rowCount = compactCount(selectedNode?.rowCount || selectedNode?.rows || selectedNode?.details?.rows);
  const recentEvents = asArray(events).slice(0, 2);
  const displayFreshness = authoritative
    ? (freshness || "Unavailable")
    : prototypeMode
      ? prototypeRelativeTime(freshness)
      : (freshness || "Unavailable");
  const displayRows = authoritative
    ? rowCount
    : prototypeMode
      ? rowCount !== "Unavailable"
        ? `${rowCount} rows`
        : "13.5M rows"
      : rowCount;
  const ownerInitials = String(owner || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const displayOwner = authoritative
    ? owner || "Unavailable"
    : prototypeMode
      ? ownerInitials || owner || "MR"
      : owner || "Unavailable";
  const visibleSources = sourceNodes.slice(0, authoritative ? 3 : prototypeMode ? 1 : 3);
  const visibleConsumers = authoritative
    ? downstreamNodes.slice(0, 2)
    : prototypeMode
      ? [{
          id: "finance_prod.revenue_recognition",
          label: "finance_prod · revenue_recognition...",
          subtitle: "",
          freshness: "",
        }]
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
            <span>{displayFreshness}</span>
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
      {prototypeMode ? (
        <p className="ga-lineage-details-proof">
          Prototype inspector - not live row, owner, source, consumer, or activity proof.
        </p>
      ) : !authoritative ? (
        <p className="ga-lineage-details-proof">
          Live lineage inspector unavailable for this route; unavailable values are not prototype evidence.
        </p>
      ) : null}
      <section>
        <h3><span>Sources</span><b>{visibleSources.length}</b></h3>
        {visibleSources.length ? visibleSources.map((node) => (
          <button key={node?.id || nodeFqn(node)} onClick={() => onSelect(node)} type="button">
            <span>{nodeTitle(node)}</span>
            <small>{authoritative ? nodeSubtitle(node) : prototypeMode ? textValue(node?.freshness, "14m") : nodeSubtitle(node)}</small>
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
            <span>{authoritative || !prototypeMode ? event.title : prototypeActivityTitle(event.title)}</span>
            <small>
              {authoritative || !prototypeMode
                ? event.detail
                : prototypeLineageText(event.detail, "svc-job-runner · 11m ago")}
            </small>
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

function PillButton({ children, active = false, onClick = NOOP, testId = "" }) {
  return (
    <button
      aria-pressed={active}
      className={`ga-lineage-pill-button ${active ? "is-active" : ""}`.trim()}
      data-testid={testId || undefined}
      onClick={onClick}
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
  onSelectAsset,
}) {
  const [lineageMode, setLineageMode] = useState(includeColumns ? "column" : "table");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [status, setStatus] = useState("");
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [graphSearchOpen, setGraphSearchOpen] = useState(false);
  const [graphSearchQuery, setGraphSearchQuery] = useState("");
  const [impactActive, setImpactActive] = useState(false);
  const [workflowPanel, setWorkflowPanel] = useState(null);
  const [graphZoom, setGraphZoom] = useState(1);
  const impactRef = useRef(null);
  const columnRef = useRef(null);
  const viewModel = useMemo(
    () => buildLineageViewModel(graph, asset, lineagePayload, context),
    [asset, context, graph, lineagePayload],
  );
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
  const hasGraphEvidence = Boolean(viewModel.nodes.length || selectedNode);
  const hasColumnLineage = viewModel.columnTraceCount > 0;
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
  const activateColumn = () => {
    setLineageMode("column");
    onIncludeColumnsChange?.(true);
    setStatus(hasColumnLineage ? "Column lineage view active." : "Column lineage is not observed for this asset yet.");
    columnRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  const selectNode = (node) => {
    const title = nodeTitle(node);
    setSelectedNodeId(node?.id || nodeFqn(node));
    if (isPermissionBoundaryNode(node)) {
      setWorkflowPanel(makePermissionWorkflow(node));
      setStatus(`${title} selected. Permission boundary detail workflow unavailable without live Unity Catalog proof.`);
      return;
    }
    setStatus(`${title} selected.`);
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
  const lineageMeta = lineagePayload?.meta && typeof lineagePayload.meta === "object" ? lineagePayload.meta : {};
  const lineageSourceText = [
    lineageMeta.state,
    lineageMeta.source,
    lineagePayload?.state,
    lineagePayload?.source,
  ].filter(Boolean).join(" ").toLowerCase();
  const prototypeMode = !authoritative && /prototype|mock|local-prototype-mock/.test(lineageSourceText);
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
    if (!prototypeMode) {
      return {
        ...item,
        node,
        detail: node ? nodeSubtitle(node, nodeFqn(node)) : item?.detail || item?.subtitle || "No backed downstream impact evidence returned.",
        proof: "Live impact proof unavailable for this route.",
        tone: "Unavailable",
      };
    }
    return {
      ...item,
      node,
      detail: textValue(item?.detail, item?.subtitle, item?.meta)
        ? prototypeLineageText(textValue(item?.detail, item?.subtitle, item?.meta), "Downstream consumer")
        : node
          ? nodeSubtitle(node, nodeFqn(node))
          : "Downstream consumer",
      proof: "Prototype impact fixture - not live usage or backed impact proof.",
      tone: item?.restricted ? "Restricted" : item?.tone || "Medium",
    };
  });
  if (hiddenDownstream && !impactRows.some((item) => item?.restricted)) {
    impactRows.push({
      id: "restricted-downstream",
      title: `${hiddenDownstream} downstream assets`,
      detail: authoritative
        ? "Hidden by Unity Catalog permissions"
        : prototypeMode
          ? "Prototype permission boundary - live UC hidden-downstream proof not verified."
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
  const sourceNodes = viewModel.upstream.filter((node) => /source/.test(String(nodeType(node)).toLowerCase()) || /source/.test(String(node?.stage || ""))).slice(0, 3);
  const upstreamTableOrder = ["charges", "invoices", "orders"];
  const upstreamTables = viewModel.upstream
    .filter((node) => !sourceNodes.includes(node))
    .sort((left, right) => {
      const leftText = `${nodeTitle(left)} ${nodeFqn(left)}`.toLowerCase();
      const rightText = `${nodeTitle(right)} ${nodeFqn(right)}`.toLowerCase();
      const leftIndex = upstreamTableOrder.findIndex((item) => leftText.includes(item));
      const rightIndex = upstreamTableOrder.findIndex((item) => rightText.includes(item));
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    })
    .slice(0, 3);
  const transformNodes = viewModel.transformation.slice(0, 4);
  const downstreamNodes = viewModel.downstream.slice(0, 4);
  const inspectorSourceNodes = /payments/i.test(`${nodeTitle(inspectorNode)} ${nodeFqn(inspectorNode)}`)
    ? transformNodes.slice(0, 2)
    : sourceNodes;
  const hasBackedEdges = asArray(viewModel.edges).length > 0;
  const thinLiveLineage = authoritative && !hasBackedEdges;
  const lineageEvidenceKind = authoritative
    ? "live_databricks_lineage"
    : prototypeMode
      ? "prototype_mock"
      : "live_lineage_unavailable";
  const isPermissionBoundaryNode = (node) => {
    const text = `${nodeTitle(node)} ${nodeSubtitle(node)} ${nodeType(node)} ${node?.stage || ""} ${node?.details?.resolutionState || ""}`;
    return /restricted|permission|hidden|downstream assets/i.test(text);
  };
  const makeUnavailableReason = (workflowLabel) => {
    if (authoritative) return `${workflowLabel} requires returned backing evidence for this actor and asset.`;
    if (prototypeMode) return `${workflowLabel} is represented by prototype topology only; live Databricks backing proof is not verified.`;
    return `${workflowLabel} is unavailable because no live lineage evidence was returned for this route.`;
  };
  const makePermissionWorkflow = (node) => ({
    kind: "permission",
    eyebrow: "Permission Boundary",
    title: `${nodeTitle(node)} detail`,
    state: authoritative ? "Backing evidence required" : "Unavailable workflow",
    source: authoritative ? "Unity Catalog visibility policy" : prototypeMode ? "prototype_mock permission boundary" : "live lineage unavailable",
    detail: makeUnavailableReason("Permission-boundary detail workflow"),
    result: "No request, grant, or access-review mutation was submitted from this prototype state.",
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
      source: backed ? "lineage impactAnalysis payload" : prototypeMode ? "prototype_mock impact fixture" : "live lineage unavailable",
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
    const backed = Boolean(authoritative && columnRows.length);
    setWorkflowPanel({
      kind: "column",
      eyebrow: "Column Lineage",
      title: `${column} workflow`,
      state: backed ? "Backed workflow" : "Unavailable workflow",
      source: authoritative
        ? (columnSource || "lineage API column evidence")
        : prototypeMode
          ? "prototype_mock column lineage"
          : "live column lineage unavailable",
      detail: backed
        ? `Source column ${row?.sourceColumn || row?.targetColumn || "unavailable"} is visible for this actor.`
        : makeUnavailableReason("Column-lineage detail workflow"),
      result: backed
        ? "Column trace can be reviewed from the returned lineage payload."
        : "No column-level mutation or false completeness claim was created.",
    });
    setStatus(`${column} column lineage row selected. ${backed ? "Column lineage detail workflow opened." : "Column lineage detail workflow unavailable without backed column proof."}`);
  };
  const lineageSourceLabel = authoritative
    ? "live graph"
    : prototypeMode
      ? "prototype topology"
      : "current live route";
  const asOfValue = authoritative
    ? lineageAsOfDate(viewModel.generatedAt)
    : prototypeMode
      ? "2026-04-27"
      : "Unavailable";
  const asOfState = prototypeMode ? "Prototype fixture" : thinLiveLineage ? "No visible edges" : authoritative ? "Live query" : "No live graph";
  const asOfMode = prototypeMode ? "not live" : thinLiveLineage ? "queried" : authoritative ? "live" : "unavailable";
  const asOfAction = prototypeMode ? "Reset preview" : thinLiveLineage ? "Refresh graph" : authoritative ? "Now" : "Retry";
  const graphBands = [
    {
      label: "4 Hops Upstream",
      emptyTitle: "No source systems observed",
      emptyMessage: "Unity Catalog has not reported a source-system edge for this asset.",
      nodes: sourceNodes,
      role: "upstream",
    },
    {
      label: "3 Hops Upstream",
      emptyTitle: "No upstream tables observed",
      emptyMessage: "No permitted upstream table hop is visible.",
      nodes: upstreamTables,
      role: "upstream",
    },
    {
      label: "2 Hops Upstream",
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
  const generatedAt = authoritative
    ? viewModel.generatedAt
      ? `Topology refreshed ${viewModel.generatedAt}`
      : "Topology source reported by lineage API"
    : prototypeMode
      ? "19 nodes · 19 edges"
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
    ? authoritative
      ? (columnSource ? `From ${columnSource}` : "From lineage API column evidence")
      : prototypeMode
        ? "Prototype column-lineage shape; system.access.column_lineage not verified"
        : "Column lineage is unavailable for this live route"
    : "No column-lineage rows returned for this asset";
  const lineageHeroCopy = prototypeMode
    ? "Permission-aware end-to-end lineage from operational sources through to consumer dashboards. Hidden segments mean a node exists, but you don't have UC permission to view it."
    : hasBackedEdges
      ? "Permission-aware lineage from actor-visible upstream assets through to permitted downstream consumers."
      : authoritative
        ? "Permission-aware lineage for the selected asset. Upstream and downstream hops appear when Unity Catalog reports actor-visible edges."
        : "Lineage is unavailable for this asset in the current workspace scope. Search for an openable asset to continue.";
  const hiddenLineageCopy = hiddenDownstream
    ? authoritative
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
    : prototypeMode
      ? "5 upstream · 23 downstream"
      : `${upstreamCount} upstream · ${downstreamCount} downstream`;
  const impactActionLabel = "Run impact analysis";
  const graphCounterLabel = authoritative
    ? `${viewModel.nodes.length || 0} nodes · ${asArray(viewModel.edges).length || 0} edges`
    : prototypeMode
      ? "19 nodes · 19 edges"
      : `${viewModel.nodes.length || 0} nodes · ${asArray(viewModel.edges).length || 0} edges`;
  const prototypeChipTitle = prototypeMode
    ? "Prototype mock value - not live Databricks proof."
    : !authoritative
      ? "Value unavailable; no live lineage proof returned for this route."
      : undefined;
  const exportEvidence = () => {
    const evidenceKind = lineageEvidenceKind;
    const mockEvidenceWarning = authoritative
      ? ""
      : prototypeMode
        ? "Prototype mock data, not live Databricks evidence."
        : "Live lineage unavailable; export contains no authoritative graph proof.";
    const payload = {
      meta: {
        generatedAt: new Date().toISOString(),
        evidenceKind,
        mockEvidenceWarning,
        source: authoritative ? "lineage-api" : prototypeMode ? "prototype-mock" : "lineage-unavailable",
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
  const openImpactAnalysis = () => {
    setImpactActive(true);
    setStatus(authoritative
      ? impactRows.length
        ? "Impact analysis focused on downstream lineage consumers."
        : "Impact analysis has no downstream evidence for this asset yet."
      : impactRows.length
        ? "Impact analysis focused on downstream lineage consumers."
        : "Impact analysis has no downstream evidence for this asset yet.");
    impactRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  const refocusGraph = () => {
    if (!selectedFqn) return;
    setStatus(`Lineage graph refocused on ${compactName(selectedFqn)}.`);
    if (authoritative) {
      onSelectAsset?.(selectedFqn);
    }
  };
  const setZoomLevel = (nextZoom) => {
    const bounded = Math.min(1.25, Math.max(0.85, nextZoom));
    setGraphZoom(bounded);
    setStatus(`Lineage graph zoom set to ${Math.round(bounded * 100)}%.`);
  };
  const fitGraphToView = () => {
    setGraphZoom(1);
    setStatus("Lineage graph fit to view.");
  };

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
            <span title={prototypeChipTitle} className={/certified/i.test(certification) ? "tone-good" : "tone-muted"}>{certificationChip}</span>
            <span title={prototypeChipTitle} className={freshness ? "" : "tone-muted"}>{freshnessDisplayChip}</span>
            <span title={prototypeChipTitle} className={cdeCount ? "tone-good" : "tone-muted"}>{cdeDisplayChip}</span>
            <span title={prototypeChipTitle} className={owner ? "" : "tone-muted"}>{ownerDisplayChip}</span>
            <span title={prototypeChipTitle}>{topologyDisplayChip}</span>
            <span title={prototypeChipTitle} className={revenueImpact ? "" : "tone-muted"}>{impactChip}</span>
          </div>
        </div>
        <div className="ga-lineage-hero-actions">
          <button onClick={activateColumn} type="button">
            <LineageIcon name="columns" />
            <span>Column lineage</span>
          </button>
          <button className="is-primary" onClick={openImpactAnalysis} type="button">
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
                <button aria-label="Zoom in" type="button" onClick={() => setZoomLevel(graphZoom + 0.08)}>+</button>
                <button aria-label="Zoom out" type="button" onClick={() => setZoomLevel(graphZoom - 0.08)}>-</button>
                <button aria-label="Fit graph" type="button" onClick={fitGraphToView}>
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
              {authoritative && hasBackedEdges ? (
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
              {authoritative && hasBackedEdges ? (
                <div className="ga-lineage-graph-toolbar" aria-label="Lineage graph tools">
                  <PillButton active={lineageMode === "table"} onClick={activateTable} testId="lineage-table-mode">
                    Table lineage
                  </PillButton>
                  <PillButton active={lineageMode === "column"} onClick={activateColumn} testId="lineage-column-mode">
                    Column lineage
                  </PillButton>
                  <button
                    aria-expanded={graphSearchOpen}
                    onClick={() => {
                      setGraphSearchOpen((current) => !current);
                      setStatus("Graph search opened for the current lineage nodes.");
                    }}
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
                    placeholder="Find node or column"
                    type="search"
                    value={graphSearchQuery}
                  />
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
              <EmptyStateBlock message="Refreshing live lineage evidence..." title="Loading lineage graph" />
            ) : overlay && !viewModel.nodes.length ? (
              <div className="ga-lineage-overlay-slot">{overlay}</div>
            ) : (
              <div
                className={`ga-lineage-graph-body is-prototype-topology ${authoritative ? "is-authoritative" : prototypeMode ? "is-prototype-mock" : "is-live-unavailable"} ${
                  thinLiveLineage ? "is-thin-live-lineage" : ""
                }`.trim()}
              >
                <div
                  className={`ga-lineage-graph-bands ${lineageMode === "column" ? "is-column-mode" : ""}`.trim()}
                  data-zoom-level={graphZoom.toFixed(2)}
                  style={{ "--ga-lineage-zoom": graphZoom }}
                >
                  {hasBackedEdges ? (
                    <svg
                      aria-hidden="true"
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
                      <path d="M145 348 C188 348 198 192 240 190" />
                      <path d="M145 448 C188 448 198 532 240 532" />
                      <path d="M423 190 C474 190 454 560 496 590" />
                      <path d="M423 532 C462 532 462 582 496 590" />
                      <path d="M683 590 C725 590 714 168 760 168" />
                      <path d="M683 590 C724 590 718 458 760 456" />
                      <path d="M683 590 C726 590 719 724 760 728" />
                      <path className="is-muted is-boundary" d="M856 168 C944 174 950 788 978 816" />
                      <path className="is-muted" d="M856 728 C905 752 927 802 978 816" />
                    </svg>
                  ) : null}
                  {graphBands.map((band) => (
                    <section className={band.role === "focus" ? "is-focus-band" : ""} key={band.label}>
                      <h2>{band.label}</h2>
                      {band.nodes.length ? (
                        band.nodes.map((node) => {
                          const nodeKey = node?.id || nodeFqn(node);
                          const inspectorKey = inspectorNode?.id || nodeFqn(inspectorNode);
                          return (
                            <NodeButton
                              active={band.role === "focus" || nodeKey === selectedNodeId || (!selectedNodeId && nodeKey === inspectorKey)}
                              asset={asset}
                              key={nodeKey}
                              node={node}
                              role={band.role}
                              authoritative={authoritative}
                              onSelect={selectNode}
                            />
                          );
                        })
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
                  prototypeMode={prototypeMode}
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
                {authoritative
                  ? "via system.access.table_lineage"
                  : prototypeMode
                    ? "Prototype topology shape; system.access.table_lineage not verified"
                    : "No live topology returned; system.access.table_lineage not verified for this route"}
              </em>
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
                type="button"
                onClick={() => setStatus(authoritative
                  ? thinLiveLineage
                    ? "Lineage graph refreshed; no actor-visible edges were returned."
                    : "Lineage time selection reset to now."
                  : "Lineage view reset.")}
              >
                <LineageIcon name="history" />
                <span>{asOfAction}</span>
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
                  title={!authoritative || !hasBackedImpact ? "Owner notification requires backed impact evidence." : undefined}
                  type="button"
                >
                  Notify owners
                </button>
              </header>
              <div className="ga-lineage-impact-list">
                {impactRows.length ? impactRows.map((item, index) => {
                  const kind = impactKind(item);
                  const detail = splitImpactDetail(item, prototypeMode);
                  const title = impactDisplayTitle(item, prototypeMode);
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
                      : prototypeMode
                        ? "prototype impact fixture - not live usage proof"
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
                      {authoritative
                        ? (columnSource || "lineage API")
                        : prototypeMode
                          ? "system.access.column_lineage not verified"
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
          : authoritative
            ? thinLiveLineage
              ? `Live ${viewModel.modeLabel.toLowerCase()} lineage query returned no actor-visible edges.`
              : `Authoritative ${viewModel.modeLabel.toLowerCase()} lineage ready.`
            : `${viewModel.modeLabel} lineage ready`)}
        {selectedFqn ? (
          <button
            disabled={!selectedNodeOpenable}
            onClick={refocusGraph}
            title={!selectedNodeOpenable
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
            title={authoritative ? "Live lineage still loading" : prototypeMode ? "Prototype lineage pending authority check" : "Lineage authority unavailable"}
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
            <EmptyStateBlock message="Loading lineage graph…" title="Refreshing graph" />
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
