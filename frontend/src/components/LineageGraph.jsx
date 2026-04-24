// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { assetPathLabel } from "../lib/assetPresentation";
import { exportLineagePng } from "../lib/exportLineagePng";
import { SurfaceDrawer, SurfaceDrawerSection } from "./ShellLayoutPrimitives";
import { AssetTypeIcon } from "./primitives/AssetTypeIcon";

// Defect 1 — turn a three-part UC fqn (catalog.schema.table) + a workspace
// host into the canonical Unity Catalog explorer URL. Returns "" when
// either piece is missing so callers can disable the deep-link button
// gracefully. We do NOT URL-encode the path segments here because the
// explorer accepts raw UC identifiers (which are already restricted to
// a narrow charset); re-encoding would double-encode dots and dashes
// and break the catalog route.
function databricksCatalogUrl(assetFqn, workspaceHost) {
  const host = String(workspaceHost || "").trim();
  if (!host) return "";
  const parts = String(assetFqn || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 3) return "";
  const [catalog, schema, table] = parts;
  return `https://${host}/explore/data/${catalog}/${schema}/${table}`;
}

function edgeStroke({ selected }) {
  if (selected) return "#2f2f46";
  return "#8d9099";
}

function edgeDashArray() {
  return undefined;
}

function normalizeNodeSortValue(value) {
  return String(value || "").trim().toLowerCase();
}

function compareNodes(left, right) {
  return normalizeNodeSortValue(left?.label || left?.subtitle || left?.id).localeCompare(
    normalizeNodeSortValue(right?.label || right?.subtitle || right?.id)
  );
}

function estimateNodeWidth(node) {
  const labelLength = String(node?.label || "").trim().length;
  const subtitleLength = String(node?.subtitle || "").trim().length;
  const longest = Math.max(labelLength, Math.min(subtitleLength, 52));
  // Round 20 defect #1: peer nodes are thin horizontal rectangles per
  // the mockup (wider than tall). Previous round shrank them to ~134px
  // wide which forced the name to truncate with "..." and the type
  // line to wrap off-card. New target: 190-240px wide, 44-52px tall.
  if (node?.role === "focus") {
    return Math.max(248, Math.min(348, 180 + longest * 3.0));
  }
  return Math.max(190, Math.min(240, 148 + longest * 2.6));
}

function estimateNodeHeight(node) {
  if (node?.role === "focus") {
    const labelLines = Math.max(1, Math.ceil(String(node?.label || "").trim().length / 22));
    const subtitleLines = Math.max(1, Math.ceil(String(node?.subtitle || "").trim().length / 28));
    return 88 + labelLines * 19 + subtitleLines * 17;
  }
  // Round 20 defect #1: flat peer height so the card reads as a thin
  // rectangle (icon + name + single type line + optional depth chip).
  // ~48px lets the schema-typography fit without empty padding.
  return 52;
}

function buildAdjacencyMaps(nodes, edges) {
  const lookup = new Map((nodes || []).map((node) => [node.id, node]));
  const forward = new Map();
  const reverse = new Map();

  const addEdge = (map, fromId, toId) => {
    if (!fromId || !toId) return;
    const bucket = map.get(fromId) || [];
    bucket.push(toId);
    map.set(fromId, bucket);
  };

  (edges || []).forEach((edge) => {
    addEdge(forward, edge.source, edge.target);
    addEdge(reverse, edge.target, edge.source);
  });

  for (const map of [forward, reverse]) {
    for (const [nodeId, nodeIds] of map.entries()) {
      nodeIds.sort((leftId, rightId) => compareNodes(lookup.get(leftId), lookup.get(rightId)));
      map.set(nodeId, [...new Set(nodeIds)]);
    }
  }

  return { lookup, forward, reverse };
}

function traverseBranchGraph(focusId, adjacency, lookup) {
  const depths = new Map();
  const parents = new Map();
  const branchRoots = new Map();

  if (!focusId) return { depths, parents, branchRoots };

  depths.set(focusId, 0);
  parents.set(focusId, null);
  branchRoots.set(focusId, focusId);

  const queue = [focusId];
  while (queue.length) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || [];
    neighbors.forEach((nextId) => {
      const nextDepth = (depths.get(current) || 0) + 1;
      const existingDepth = depths.get(nextId);
      const existingBranch = branchRoots.get(nextId) || "";
      const currentBranch = current === focusId ? nextId : branchRoots.get(current) || nextId;
      const candidateBranch = normalizeNodeSortValue(lookup.get(currentBranch)?.label || lookup.get(currentBranch)?.subtitle || currentBranch);
      const existingBranchSort = normalizeNodeSortValue(lookup.get(existingBranch)?.label || lookup.get(existingBranch)?.subtitle || existingBranch);
      const shouldReplace =
        existingDepth == null || nextDepth < existingDepth || (nextDepth === existingDepth && candidateBranch < existingBranchSort);
      if (!shouldReplace) return;
      depths.set(nextId, nextDepth);
      parents.set(nextId, current);
      branchRoots.set(nextId, current === focusId ? nextId : currentBranch);
      queue.push(nextId);
    });
  }

  return { depths, parents, branchRoots };
}

function layoutGraphNodes(nodes, edges) {
  const ranked = [...(nodes || [])].sort((left, right) => {
    if (left.role === "focus") return -1;
    if (right.role === "focus") return 1;
    const leftRole = normalizeNodeSortValue(left.role);
    const rightRole = normalizeNodeSortValue(right.role);
    if (leftRole !== rightRole) return leftRole.localeCompare(rightRole);
    return compareNodes(left, right);
  });

  const focusNode = ranked.find((node) => node.role === "focus") || ranked[0] || null;
  const focusId = focusNode?.id || "";
  const { lookup, forward, reverse } = buildAdjacencyMaps(ranked, edges || []);
  const upstream = traverseBranchGraph(focusId, reverse, lookup);
  const downstream = traverseBranchGraph(focusId, forward, lookup);
  const buckets = {
    upstream: new Map(),
    downstream: new Map(),
    orphan: new Map(),
  };

  const placementFor = (node) => {
    if (!node || node.id === focusId) {
      return {
        side: "focus",
        depth: 0,
        branchRoot: focusId,
      };
    }

    const upstreamDepth = upstream.depths.get(node.id);
    const downstreamDepth = downstream.depths.get(node.id);
    const upstreamBranch = upstream.branchRoots.get(node.id) || node.id;
    const downstreamBranch = downstream.branchRoots.get(node.id) || node.id;

    if (upstreamDepth == null && downstreamDepth == null) {
      return {
        side: "orphan",
        depth: 0,
        branchRoot: node.id,
      };
    }

    if (
      upstreamDepth != null &&
      (downstreamDepth == null || upstreamDepth < downstreamDepth || (upstreamDepth === downstreamDepth && compareNodes(lookup.get(upstreamBranch), lookup.get(downstreamBranch)) <= 0))
    ) {
      return {
        side: "upstream",
        depth: upstreamDepth,
        branchRoot: upstreamBranch,
      };
    }

    return {
      side: "downstream",
      depth: downstreamDepth || 0,
      branchRoot: downstreamBranch,
    };
  };

  ranked.forEach((node) => {
    const placement = placementFor(node);
    if (placement.side === "focus") return;
    const depthBucket = buckets[placement.side].get(placement.depth) || [];
    depthBucket.push({
      node,
      branchRoot: placement.branchRoot,
    });
    buckets[placement.side].set(placement.depth, depthBucket);
  });

  const focusX = 0;
  const focusY = 0;
  const depthGapX = 260;
  const branchGapY = 46;
  const stackGapY = 20;
  const levelNudgeY = 6;

  const positioned = ranked
    .filter((node) => node.id === focusId)
    .map((node) => ({
      ...node,
      width: estimateNodeWidth(node),
      height: estimateNodeHeight(node),
      position: {
        x: focusX - estimateNodeWidth(node) / 2,
        y: focusY - estimateNodeHeight(node) / 2,
      },
      layout: {
        side: "focus",
        depth: 0,
        branchRoot: focusId,
      },
    }));

  const sideOrder = ["upstream", "downstream", "orphan"];
  sideOrder.forEach((side) => {
    const depthMap = buckets[side];
    [...depthMap.keys()]
      .sort((left, right) => left - right)
      .forEach((depth) => {
        const depthEntries = depthMap.get(depth) || [];
        const branchMap = new Map();
        depthEntries.forEach((entry) => {
          const branchBucket = branchMap.get(entry.branchRoot) || [];
          branchBucket.push(entry.node);
          branchMap.set(entry.branchRoot, branchBucket);
        });

        const branchEntries = [...branchMap.entries()].sort((left, right) =>
          compareNodes(lookup.get(left[0]), lookup.get(right[0]))
        );
        const laidOutBranches = branchEntries.map(([branchRoot, branchNodes]) => {
          const members = branchNodes.sort(compareNodes).map((node) => ({
            node,
            width: estimateNodeWidth(node),
            height: estimateNodeHeight(node),
          }));
          return {
            branchRoot,
            members,
            height:
              members.reduce((total, member) => total + member.height, 0) +
              Math.max(0, members.length - 1) * stackGapY,
          };
        });
        const totalBranchHeight =
          laidOutBranches.reduce((total, branch) => total + branch.height, 0) +
          Math.max(0, laidOutBranches.length - 1) * branchGapY;
        let branchCursor = focusY - totalBranchHeight / 2;

        laidOutBranches.forEach(({ branchRoot, members, height: branchHeight }) => {
          let nodeCursor = branchCursor;
          members.forEach(({ node, width, height }) => {
            const depthDistance = depth * depthGapX;
            const sideDirection =
              side === "upstream" ? -1 : side === "downstream" ? 1 : 0.76;
            const centerX =
              focusX +
              sideDirection * (node.role === "focus" ? 0 : 210 + depthDistance);
            const centerY = nodeCursor + height / 2 + depth * levelNudgeY;

            positioned.push({
              ...node,
              width,
              height,
              position: {
                x: centerX - width / 2,
                y: centerY - height / 2,
              },
              layout: {
                side,
                depth,
                branchRoot,
              },
            });
            nodeCursor += height + stackGapY;
          });
          branchCursor += branchHeight + branchGapY;
        });
      });
  });

  return positioned;
}

function transformGraph(graph) {
  if (!graph) return { nodes: [], edges: [] };
  const laidOutNodes = layoutGraphNodes(graph.nodes || [], graph.edges || []);

  return {
    nodes: laidOutNodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: node,
      style: {
        width: node.width || estimateNodeWidth(node),
        borderRadius: node.role === "focus" ? 14 : 10,
        border:
          node.role === "focus"
            ? "2px solid #3d2f8f"
            : "1px solid #d8dbe2",
        // Round 19 defect #10: drop the thick left/right indicator stripe
        // on peer nodes — it was adding ~4px of chrome on every card and
        // reinforcing the upstream/downstream distinction that the graph
        // position already communicates.
        borderLeftWidth: 1,
        borderRightWidth: 1,
        background:
          node.role === "focus"
            ? "#ffffff"
            : "#ffffff",
        boxShadow:
          node.role === "focus"
            ? "0 2px 8px rgba(35, 37, 52, 0.12)"
            : "0 1px 4px rgba(35, 37, 52, 0.10)",
        padding: node.role === "focus" ? 12 : 10,
      },
      type: "assetNode",
      sourcePosition: "right",
      targetPosition: "left",
    })),
    edges: (graph.edges || []).map((edge, index) => ({
      id: edge.key || `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      type: "assetEdge",
      data: edge,
      animated: false,
      style: {
        stroke: "#8d9099",
        strokeWidth: edge.depth === 1 ? 1.25 : 1.1,
      },
    })),
  };
}

function connectedSelection(edges, nodeId) {
  if (!nodeId) return { nodeIds: [], edgeIds: [] };
  const edgeIds = [];
  const nodeIds = new Set([nodeId]);
  edges.forEach((edge) => {
    if (edge.source === nodeId || edge.target === nodeId) {
      edgeIds.push(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  });
  return { nodeIds: [...nodeIds], edgeIds };
}

function shortestDirectedPath(edges, startId, endId) {
  if (!startId || !endId) return { nodeIds: [], edgeIds: [] };
  if (startId === endId) return { nodeIds: [startId], edgeIds: [] };

  const neighbors = new Map();
  edges.forEach((edge) => {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, []);
    neighbors.get(edge.source).push({ nodeId: edge.target, edgeId: edge.id });
  });

  const queue = [startId];
  const seen = new Set([startId]);
  const previous = new Map();

  while (queue.length) {
    const current = queue.shift();
    const nextNodes = neighbors.get(current) || [];
    for (const next of nextNodes) {
      if (seen.has(next.nodeId)) continue;
      seen.add(next.nodeId);
      previous.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
      if (next.nodeId === endId) {
        const nodeIds = [endId];
        const edgeIds = [];
        let cursor = endId;
        while (previous.has(cursor)) {
          const step = previous.get(cursor);
          edgeIds.unshift(step.edgeId);
          nodeIds.unshift(step.nodeId);
          cursor = step.nodeId;
        }
        return { nodeIds, edgeIds };
      }
      queue.push(next.nodeId);
    }
  }

  return { nodeIds: [], edgeIds: [] };
}

function lineagePath(edges, anchorId, focusId) {
  const upstream = shortestDirectedPath(edges, anchorId, focusId);
  if (upstream.nodeIds.length) return upstream;
  return shortestDirectedPath(edges, focusId, anchorId);
}

function downstreamSelection(edges, startId) {
  if (!startId) return { nodeIds: [], edgeIds: [] };
  const queue = [startId];
  const seen = new Set([startId]);
  const edgeIds = [];

  while (queue.length) {
    const current = queue.shift();
    edges.forEach((edge) => {
      if (edge.source !== current) return;
      edgeIds.push(edge.id);
      if (!seen.has(edge.target)) {
        seen.add(edge.target);
        queue.push(edge.target);
      }
    });
  }

  return { nodeIds: [...seen], edgeIds };
}

function upstreamSelection(edges, startId) {
  if (!startId) return { nodeIds: [], edgeIds: [] };
  const queue = [startId];
  const seen = new Set([startId]);
  const edgeIds = [];

  while (queue.length) {
    const current = queue.shift();
    edges.forEach((edge) => {
      if (edge.target !== current) return;
      edgeIds.push(edge.id);
      if (!seen.has(edge.source)) {
        seen.add(edge.source);
        queue.push(edge.source);
      }
    });
  }

  return { nodeIds: [...seen], edgeIds };
}

function nodeSignalDots(data) {
  const detail = Array.isArray(data?.details) ? data.details[0] || {} : data?.details || {};
  const signals = [];
  const push = (tone, label) => {
    const clean = String(label || "").trim();
    if (!clean || clean === "—" || clean.toLowerCase() === "unassigned") return;
    signals.push({ tone, label: clean });
  };
  const certification = String(detail.certification || "").trim();
  if (certification && certification.toLowerCase() !== "unassigned") {
    push(/certified|published|approved/i.test(certification) ? "good" : "warn", certification);
  }
  const sensitivity = String(detail.sensitivity || "").trim();
  if (sensitivity && sensitivity.toLowerCase() !== "unassigned") {
    push(/restricted|pii|phi|sensitive/i.test(sensitivity) ? "warn" : "good", sensitivity);
  }
  const status = String(detail.governanceStatus || "").trim();
  if (status && !/^(needs work|unassigned)$/i.test(status)) {
    push(/ready|operational|published|approved/i.test(status) ? "good" : "warn", status);
  }
  if (detail.isOpenable === false) {
    push("muted", "Metadata record unavailable");
  }
  return signals.slice(0, 3);
}

function NodeLabel({ data }) {
  const branchToggleVisible =
    typeof data?.onToggleBranchCollapse === "function" && Number(data?.branchDescendantCount || 0) > 0;
  const isFocus = data.role === "focus";
  const iconSize = isFocus ? "lg" : "md";
  const signals = nodeSignalDots(data);

  // Round 20 defect #4: peer nodes now carry a depth label ("Upstream 1",
  // "Downstream 2") so the direction + hop count are obvious at a glance.
  // Focus node keeps its "Focus" eyebrow via `kicker`.
  const side = String(data?.layout?.side || "").toLowerCase();
  const depth = Number(data?.layout?.depth || 0);
  let depthLabel = "";
  if (!isFocus && side && depth > 0) {
    const prefix = side === "upstream" ? "Upstream" : side === "downstream" ? "Downstream" : "";
    if (prefix) depthLabel = `${prefix} ${depth}`;
  }

  return (
    <div className={`gh-graph-node-card ${isFocus ? "is-focus" : "is-peer"}`.trim()}>
      <div className="gh-graph-node-head">
        <AssetTypeIcon type={data.kind} size={iconSize} className="gh-graph-node-icon" />
        <div className="gh-graph-node-head-copy">
          {isFocus && data.kicker && data.kicker !== "Focus" ? (
            // Hide the "Focus" kicker — the purple border already signals
            // this is the focused node, and a "Focus" eyebrow on top of a
            // "FOCUS" footer pill reads as duplicated debug chrome.
            <div className="gh-graph-node-kicker">{data.kicker}</div>
          ) : null}
          <div className="gh-graph-node-title">{data.label}</div>
          {!isFocus ? (
            <div className="gh-graph-node-peer-meta">
              {/* "Lineage Reference" is the backend's label for nodes that
                  exist in UC lineage but not in the governance store. That
                  distinction is meaningful inside the drawer but it's noise
                  on every peer card — suppress it here and only surface a
                  real asset kind (Table, View, Pipeline, …) when available. */}
              {data.kind && data.kind !== "Lineage Reference" ? (
                <span className="gh-graph-node-type-line">{data.kind}</span>
              ) : null}
              {depthLabel ? (
                <span className="gh-graph-node-depth-chip">{depthLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        {signals.length ? (
          <div className="gh-graph-node-signal-dots" aria-label="Backed node signals">
            {signals.map((signal, index) => (
              <span
                aria-hidden="true"
                className={`gh-graph-node-signal-dot tone-${signal.tone}`}
                key={`${data.id}-signal-${index}`}
                title={signal.label}
              />
            ))}
          </div>
        ) : null}
        {branchToggleVisible ? (
          <button
            className={`gh-graph-branch-toggle ${data.branchCollapsed ? "is-collapsed" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleBranchCollapse?.();
            }}
            type="button"
          >
            {data.branchCollapsed ? `Expand ${data.branchDescendantCount}` : `Collapse ${data.branchDescendantCount}`}
          </button>
        ) : null}
      </div>
      {isFocus ? (
        <>
          <div className="gh-graph-node-subtitle">{data.subtitle}</div>
          {/* Round 20 defect #2: the focus node ALWAYS shows its schema
              preview (up to 4 rows) when the backend supplies columns —
              no more waiting for "Include Columns" to be toggled on. The
              toggle now expands the preview from 4 rows to 8 rows. This
              matches the mockup where customer_churn_model shows its
              columns inline directly on the focus card. */}
          {Array.isArray(data.columns) && data.columns.length > 0 ? (
            <ul className="gh-graph-node-columns" aria-label="Asset columns">
              {/* Round 20 defect #2: cap at 4 rows by default, expand to
                  8 when Include Columns is on so the toggle stays
                  meaningful. */}
              {data.columns.slice(0, data.__showInlineColumns ? 8 : 4).map((column) => {
                const name = typeof column === "string" ? column : column?.name || "";
                const type =
                  typeof column === "object"
                    ? column?.type || column?.dataType || ""
                    : "";
                if (!name) return null;
                return (
                  <li className="gh-graph-node-columns-row" key={name}>
                    <span className="gh-graph-node-columns-name" title={name}>{name}</span>
                    {type ? <span className="gh-graph-node-columns-type">{type}</span> : null}
                  </li>
                );
              })}
              {data.columns.length > (data.__showInlineColumns ? 8 : 4) ? (
                <li className="gh-graph-node-columns-more">
                  +{data.columns.length - (data.__showInlineColumns ? 8 : 4)} more
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="gh-graph-node-foot">
            <span>{data.kind === "Lineage Reference" ? "Lineage only" : data.kind}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AssetEdge({
  data,
  id,
  markerEnd,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.28,
  });
  const branchToggleVisible =
    typeof data?.onToggleBranchCollapse === "function" && data?.depth === 1 && Number(data?.branchDescendantCount || 0) > 0;
  const toggleX =
    data?.focusAnchor === "target" ? targetX - 26 : data?.focusAnchor === "source" ? sourceX + 26 : (sourceX + targetX) / 2;
  const toggleY =
    data?.focusAnchor === "target" ? targetY - 16 : data?.focusAnchor === "source" ? sourceY - 16 : (sourceY + targetY) / 2;

  return (
    <>
      <BaseEdge
        id={id}
        interactionWidth={40}
        markerEnd={markerEnd}
        path={path}
        style={{
          stroke: edgeStroke({ selected, data }),
          // Round 18 defect #2: scale widths down from 3.6-5.2px to 1.4-2.2px
          // so the graph reads with delicate strokes per the mockup.
          strokeWidth: data?.depth === 1 ? (selected ? 2.2 : 1.8) : selected ? 2.0 : 1.4,
          opacity: selected ? 1 : 0.9,
          strokeDasharray: edgeDashArray(data),
        }}
      />
      {branchToggleVisible ? (
        <EdgeLabelRenderer>
          <button
            className={`gh-lineage-edge-toggle ${data?.branchCollapsed ? "is-collapsed" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              data?.onToggleBranchCollapse?.();
            }}
            style={{
              transform: `translate(-50%, -50%) translate(${toggleX}px, ${toggleY}px)`,
            }}
            type="button"
          >
            {data?.branchCollapsed ? "+" : "−"}
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function AssetNode({ data }) {
  return (
    <div className={`gh-graph-node-shell role-${data.role || "other"}`}>
      <Handle className="gh-graph-handle" position={Position.Left} type="target" />
      <NodeLabel data={data} />
      <Handle className="gh-graph-handle" position={Position.Right} type="source" />
    </div>
  );
}

function nodeDetailRecord(node) {
  if (Array.isArray(node?.details)) return node.details[0] || {};
  return node?.details || {};
}

function LineageRecordCard({
  title,
  node,
  tone = "neutral",
  focusActionLabel = "Set as Focus",
  availabilityOverride = null,
  onOpenAsset,
  onOpenGovernance,
  onRefocus,
  onTraceUpstream,
  onShowImpact,
  includeOpenAssetAction = true,
  includeOpenGovernanceAction = true,
  includeFocusAction = true,
  includeTraceActions = true,
}) {
  const detail = nodeDetailRecord(node);
  const forcedUnavailable = availabilityOverride === false;
  const isOpenable = !forcedUnavailable && detail?.isOpenable !== false;
  const unavailableReason = !isOpenable
    ? forcedUnavailable
      ? "This asset has no governed metadata record yet. It only appears as a lineage reference."
      : "This node is a lineage-only reference with no governed metadata record in the visible catalog."
    : undefined;
  // Role + lineage status are always meaningful; governance attributes only
  // render if the backend returned a real value. "Unassigned" is the
  // placeholder the governance store emits for empty slots — render it as
  // nothing instead of stamping three identical chips on the card.
  const roleChip =
    node?.role === "focus"
      ? "Focus"
      : node?.role === "source"
        ? "Upstream"
        : node?.role === "target"
          ? "Downstream"
          : "";
  const tags = [
    roleChip,
    detail?.governanceStatus,
    detail?.domain,
    detail?.tier,
    detail?.certification,
    detail?.sensitivity,
    !forcedUnavailable && !isOpenable ? "Lineage only" : "",
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) return false;
      if (value === String(node?.kind || "").trim()) return false;
      if (value.toLowerCase() === "unassigned") return false;
      if (value === "—") return false;
      return true;
    })
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 5);
  const identifier = detail?.statementId || detail?.entityId || node?.assetFqn || node?.subtitle || "";
  const description = detail?.description || node?.subtitle || "";

  return (
    <section className={`gh-lineage-record-card tone-${tone}`}>
      <div className="gh-lineage-record-card-head">
        <div className="gh-lineage-record-card-copy">
          <div className="gh-panel-title">{title}</div>
          <h3>{node?.label || "No selected node"}</h3>
          <div className="gh-support-copy">{node?.subtitle || identifier || "No additional context"}</div>
        </div>
        <span className="gh-chip gh-chip-soft">{node?.kind || "Asset"}</span>
      </div>

      {tags.length ? (
        <div className="gh-chip-row gh-lineage-record-tags">
          {tags.map((tag) => (
            <span className="gh-chip gh-chip-soft" key={`${node?.id || title}-${tag}`}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {description ? <div className="gh-support-copy">{description}</div> : null}

      <div className="gh-attribute-list gh-lineage-record-meta">
        {identifier ? (
          <div className="gh-attribute-row">
            <span className="gh-attribute-label">Identifier</span>
            <span className="gh-attribute-value">{identifier}</span>
          </div>
        ) : null}
        {node?.assetFqn ? (
          <div className="gh-attribute-row">
            <span className="gh-attribute-label">Asset</span>
            <span className="gh-attribute-value">{node.assetFqn}</span>
          </div>
        ) : null}
        {!isOpenable ? (
          <div className="gh-attribute-row">
            <span className="gh-attribute-label">Availability</span>
            <span className="gh-attribute-value">
              {forcedUnavailable ? "Metadata record unavailable" : "Lineage-only reference"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="gh-lineage-record-actions">
        {includeOpenAssetAction && node?.assetFqn && onOpenAsset ? (
          <button
            className="gh-secondary-button gh-secondary-button-compact"
            disabled={!isOpenable}
            onClick={() => onOpenAsset(node.assetFqn)}
            title={unavailableReason}
            type="button"
          >
            {forcedUnavailable ? "Metadata record unavailable" : "Open Record"}
          </button>
        ) : null}
        {includeOpenGovernanceAction && node?.assetFqn && onOpenGovernance ? (
          <button
            className="gh-secondary-button gh-secondary-button-compact"
            disabled={!isOpenable}
            onClick={() => onOpenGovernance(node.assetFqn)}
            title={unavailableReason}
            type="button"
          >
            Open Governance
          </button>
        ) : null}
        {includeFocusAction && node?.assetFqn && onRefocus ? (
          <button
            className="gh-primary-button gh-secondary-button-compact"
            disabled={!isOpenable}
            onClick={() => onRefocus(node.assetFqn)}
            title={unavailableReason}
            type="button"
          >
            {focusActionLabel}
          </button>
        ) : null}
        {includeTraceActions && onTraceUpstream ? (
          <button className="gh-secondary-button gh-secondary-button-compact" onClick={onTraceUpstream} type="button">
            Trace Upstream
          </button>
        ) : null}
        {includeTraceActions && onShowImpact ? (
          <button className="gh-secondary-button gh-secondary-button-compact" onClick={onShowImpact} type="button">
            Trace Impact
          </button>
        ) : null}
      </div>
    </section>
  );
}

// Selected-node drawer body — dense, tabbed, with a sticky action footer.
// Mirrors the lineage mockup: icon + FQN header, 5-tab row, per-tab panel
// scrolling inside a flex column, and `View in Databricks Catalog` +
// `Add Steward` locked to the bottom.
//
// Row-level rule: when the backing value is missing or equals "Unassigned" /
// "—", the row is omitted entirely rather than stamped as an empty label.
function LineageNodeDrawerBody({
  node,
  tab,
  onTabChange,
  neighbors,
  isRecordUnavailable,
  onOpenInCatalog,
  catalogUrl,
  onAddSteward,
  onNeighborSelect,
}) {
  const detail = Array.isArray(node?.details) ? node.details[0] || {} : node?.details || {};
  const record = node?.record || detail || {};
  const objectType = node?.kind || record?.objectType || detail?.objectType || "Asset";
  const fqn = node?.assetFqn || node?.subtitle || node?.label || "";

  const TAB_ORDER = ["details", "columns", "quality", "stewardship", "dependencies"];
  const TAB_LABELS = [
    { key: "details", label: "Details" },
    { key: "columns", label: "Columns" },
    { key: "quality", label: "Quality" },
    { key: "stewardship", label: "Stewardship" },
    { key: "dependencies", label: "Depend.", ariaLabel: "Dependencies" },
  ];

  const handleTabKey = (event) => {
    const current = TAB_ORDER.indexOf(tab);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onTabChange(TAB_ORDER[(current + 1) % TAB_ORDER.length]);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onTabChange(TAB_ORDER[(current - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
    } else if (event.key === "Home") {
      event.preventDefault();
      onTabChange(TAB_ORDER[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      onTabChange(TAB_ORDER[TAB_ORDER.length - 1]);
    }
  };

  return (
    <div className="gh-lineage-node-body-root">
      {/* Header: icon + FQN + object-type chip. The SurfaceDrawer's own
          close control is rendered via its `actions` slot, so nothing
          to duplicate here. */}
      <header className="gh-lineage-node-header">
        <AssetTypeIcon type={objectType} size="md" />
        <div className="gh-lineage-node-header-copy">
          <div className="gh-lineage-node-header-fqn" title={fqn}>
            {fqn || node?.label || "Selected node"}
          </div>
          <div className="gh-chip-row gh-lineage-node-header-chips">
            <span className="gh-chip gh-chip-soft">{objectType}</span>
            {isRecordUnavailable ? (
              <span className="gh-chip gh-chip-soft" title="Metadata record unavailable">
                Metadata record unavailable
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* Tab row — 5 tabs, keyboard navigable. */}
      <div
        aria-label="Selected node details"
        className="gh-lineage-node-tabs"
        data-testid="lineage-node-tabs"
        role="tablist"
      >
        {TAB_LABELS.map((t) => (
          <button
            aria-label={t.ariaLabel || t.label}
            aria-controls={`lineage-node-panel-${t.key}`}
            aria-selected={tab === t.key}
            className={`gh-lineage-node-tab ${tab === t.key ? "is-active" : ""}`}
            data-testid={`lineage-node-tab-${t.key}`}
            id={`lineage-node-tab-${t.key}`}
            key={t.key}
            onClick={() => onTabChange(t.key)}
            onKeyDown={handleTabKey}
            role="tab"
            tabIndex={tab === t.key ? 0 : -1}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Scrollable tab panel. The footer below sits outside so it stays
          pinned to the bottom of the drawer regardless of panel height. */}
      <div className="gh-lineage-node-scroll">
        {tab === "details" ? (
          <LineageNodeDetailsPanel node={node} detail={detail} record={record} objectType={objectType} />
        ) : null}
        {tab === "columns" ? (
          <LineageNodeColumnsPanel node={node} detail={detail} />
        ) : null}
        {tab === "quality" ? (
          <LineageNodeQualityPanel node={node} detail={detail} />
        ) : null}
        {tab === "stewardship" ? (
          <LineageNodeStewardshipPanel node={node} detail={detail} />
        ) : null}
        {tab === "dependencies" ? (
          <LineageNodeDependenciesPanel neighbors={neighbors} onNeighborSelect={onNeighborSelect} />
        ) : null}
      </div>

      {/* Sticky action footer — always rendered, irrespective of active
          tab, per the mockup. Defect 1: the "View in Databricks Catalog"
          button now deep-links into the Unity Catalog explorer in a new
          tab instead of routing through the in-app entity page. When the
          workspace host isn't known yet (bootstrap hasn't hydrated), we
          fall back to disabling the button with a tooltip so stewards
          aren't clicking a dead action. */}
      <footer className="gh-lineage-node-footer" data-testid="lineage-node-footer">
        <button
          className="gh-primary-button gh-secondary-button-compact"
          disabled={!node?.assetFqn || !catalogUrl || isRecordUnavailable}
          onClick={onOpenInCatalog}
          title={
            catalogUrl
              ? `Open ${node?.assetFqn || "asset"} in the Databricks Unity Catalog explorer`
              : "Workspace URL unavailable"
          }
          type="button"
        >
          View in Databricks Catalog
        </button>
        <button
          className="gh-secondary-button gh-secondary-button-compact"
          disabled={!node?.assetFqn}
          onClick={onAddSteward}
          type="button"
        >
          Add Steward
        </button>
      </footer>
    </div>
  );
}

function isMeaningful(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return false;
  if (clean === "—") return false;
  if (clean.toLowerCase() === "unassigned") return false;
  return true;
}

// Defect 9 — humanize a byte count into KB / MB / GB / TB. Accepts a
// number, a numeric string, or pre-formatted text ("1.2 GB"); pre-formatted
// input passes through unchanged so a backend that decides to emit
// "Partitioned · 800 MB" still renders cleanly.
function formatSizeBytes(value) {
  if (value == null) return "";
  if (typeof value === "string" && Number.isNaN(Number(value))) {
    const trimmed = value.trim();
    return trimmed;
  }
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const scaled = bytes / 1024 ** exp;
  const precision = scaled >= 100 || exp === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(precision)} ${units[exp]}`;
}

// Defect 9 — humanize a row count with thousands separators. Pre-formatted
// strings fall through unchanged so a backend that emits "≈ 12M" stays
// intact; pure numbers get locale-grouped (e.g. 1_234_567 → "1,234,567").
function formatRowCount(value) {
  if (value == null) return "";
  if (typeof value === "string" && Number.isNaN(Number(value))) {
    return value.trim();
  }
  const rows = Number(value);
  if (!Number.isFinite(rows) || rows < 0) return "";
  return rows.toLocaleString("en-US");
}

function LineageNodeDetailsPanel({ node, detail, record, objectType }) {
  // Defect 9 — derive Schema/Catalog from the FQN when the payload
  // doesn't split them out. Most lineage nodes only carry `assetFqn`
  // ("catalog.schema.table"), so relying on `node.schema` / `node.catalog`
  // alone caused both rows to disappear even when the data was obviously
  // available. Splitting the FQN as a last resort keeps the grid dense
  // without fabricating values — the split produces real identifiers,
  // not placeholders.
  const fqnParts = String(node?.assetFqn || "")
    .split(".")
    .map((part) => part.trim());
  const [fqnCatalog, fqnSchema] = fqnParts.length === 3 ? fqnParts : ["", ""];

  // Size / rows — the backend may emit raw numbers (`sizeBytes`,
  // `rowCount`) or pre-formatted strings. Humanize the numeric form so
  // the operator reads "1.2 GB" / "12,345" instead of "1288490188" /
  // "12345". If the field is absent, the row is hidden via the
  // `isMeaningful` filter below.
  const sizeValue =
    formatSizeBytes(detail?.sizeBytes ?? record?.sizeBytes) ||
    String(detail?.size ?? record?.size ?? "").trim();
  const rowValue =
    formatRowCount(detail?.rowCount ?? record?.rowCount) ||
    String(detail?.rows ?? record?.rows ?? "").trim();

  const rows = [
    { label: "Type", value: objectType },
    { label: "Schema", value: node?.schema || record?.schema || detail?.schema || fqnSchema },
    { label: "Catalog", value: node?.catalog || record?.catalog || detail?.catalog || fqnCatalog },
    { label: "Owner", value: detail?.owner || record?.owner || node?.owner },
    { label: "Created", value: detail?.createdAt || record?.createdAt },
    { label: "Last Updated", value: detail?.updatedAt || record?.updatedAt || detail?.lastUpdatedAt },
    { label: "Databricks Object ID", value: detail?.objectId || record?.objectId || detail?.statementId },
    { label: "Size", value: sizeValue },
    { label: "Rows", value: rowValue },
  ].filter((row) => isMeaningful(row.value));

  const description = detail?.description || record?.description || node?.subtitle || "";

  // Column preview — first 4 rows, with a "+N more" link when truncated.
  const columns =
    (Array.isArray(node?.columns) && node.columns) ||
    (Array.isArray(detail?.columns) && detail.columns) ||
    [];
  const previewColumns = columns.slice(0, 4);
  const overflow = columns.length - previewColumns.length;

  return (
    <div
      className="gh-lineage-node-panel"
      data-testid="lineage-node-panel-details"
      id="lineage-node-panel-details"
      role="tabpanel"
    >
      {rows.length ? (
        <div className="gh-attribute-list gh-lineage-node-details">
          {rows.map((row) => (
            <div className="gh-attribute-row" key={row.label}>
              <span className="gh-attribute-label">{row.label}</span>
              <span className="gh-attribute-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {description ? (
        <div className="gh-lineage-node-description">
          <div className="gh-attribute-label">Description</div>
          <div className="gh-support-copy">{description}</div>
        </div>
      ) : null}

      {previewColumns.length ? (
        <div className="gh-lineage-node-column-preview">
          <div className="gh-attribute-label">Columns</div>
          <LineageNodeColumnTable columns={previewColumns} nodeId={node?.id} />
          {overflow > 0 ? (
            <div className="gh-support-copy gh-lineage-node-more">
              +{overflow} more — open <strong>Columns</strong> tab for the full schema.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LineageNodeColumnsPanel({ node, detail }) {
  const columns =
    (Array.isArray(node?.columns) && node.columns) ||
    (Array.isArray(detail?.columns) && detail.columns) ||
    [];
  return (
    <div
      className="gh-lineage-node-panel"
      data-testid="lineage-node-panel-columns"
      id="lineage-node-panel-columns"
      role="tabpanel"
    >
      {columns.length ? (
        <LineageNodeColumnTable columns={columns} nodeId={node?.id} />
      ) : (
        <div className="gh-support-copy gh-lineage-node-empty">
          No column metadata is exposed for this node yet.
        </div>
      )}
    </div>
  );
}

function LineageNodeColumnTable({ columns, nodeId }) {
  return (
    <table className="gh-lineage-node-columns">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Quality</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((column, index) => {
          const name =
            typeof column === "string"
              ? column
              : column?.name || column?.columnName || "";
          const type =
            typeof column === "string"
              ? ""
              : column?.dataType || column?.type || "";
          const tone = typeof column === "object" ? column?.qualityTone : "";
          return (
            <tr key={`${nodeId || "node"}-column-${index}`}>
              <td className="gh-lineage-node-columns-name">{name}</td>
              <td className="gh-lineage-node-columns-type">{type}</td>
              <td>
                {tone ? (
                  <span
                    aria-label={`Column quality ${tone}`}
                    className={`gh-lineage-column-quality-dot tone-${tone}`}
                    title={column?.qualityLabel || tone}
                  />
                ) : (
                  <span className="gh-support-copy">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LineageNodeQualityPanel({ node, detail }) {
  const qualityRuns =
    (Array.isArray(node?.qualityRuns) && node.qualityRuns) ||
    (Array.isArray(detail?.qualityRuns) && detail.qualityRuns) ||
    [];
  return (
    <div
      className="gh-lineage-node-panel"
      data-testid="lineage-node-panel-quality"
      id="lineage-node-panel-quality"
      role="tabpanel"
    >
      {qualityRuns.length ? (
        <div className="gh-lineage-linked-list">
          {qualityRuns.map((run, index) => (
            <div
              className="gh-lineage-linked-row is-readonly"
              key={`${node?.id || "node"}-quality-${index}`}
            >
              <span>{run.ruleName || run.name || "Quality rule"}</span>
              <span>{run.status || run.outcome || "—"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="gh-support-copy gh-lineage-node-empty">
          No quality runs linked.
        </div>
      )}
    </div>
  );
}

function LineageNodeStewardshipPanel({ node, detail }) {
  const owner = detail?.owner || node?.owner || "";
  const steward = detail?.steward || node?.steward || "";
  const governanceStatus = detail?.governanceStatus || "";
  const certification = detail?.certification || "";
  const rows = [
    { label: "Business Owner", value: owner },
    { label: "Data Steward", value: steward },
    { label: "Certification", value: certification },
    { label: "Governance State", value: governanceStatus },
  ].filter((row) => isMeaningful(row.value));

  return (
    <div
      className="gh-lineage-node-panel"
      data-testid="lineage-node-panel-stewardship"
      id="lineage-node-panel-stewardship"
      role="tabpanel"
    >
      {rows.length ? (
        <div className="gh-attribute-list gh-lineage-node-details">
          {rows.map((row) => (
            <div className="gh-attribute-row" key={row.label}>
              <span className="gh-attribute-label">{row.label}</span>
              <span className="gh-attribute-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="gh-support-copy gh-lineage-node-empty">
          No stewardship signals.
        </div>
      )}
    </div>
  );
}

function LineageNodeDependenciesPanel({ neighbors, onNeighborSelect }) {
  const upstream = neighbors?.upstream || [];
  const downstream = neighbors?.downstream || [];
  const hasAny = upstream.length > 0 || downstream.length > 0;

  return (
    <div
      className="gh-lineage-node-panel"
      data-testid="lineage-node-panel-dependencies"
      id="lineage-node-panel-dependencies"
      role="tabpanel"
    >
      {hasAny ? (
        <div className="gh-lineage-linked-list">
          {upstream.length ? (
            <div className="gh-lineage-node-deps-group">
              <div className="gh-attribute-label">Upstream</div>
              {upstream.map((n) => (
                <button
                  className="gh-lineage-linked-row is-node-link"
                  data-testid="lineage-node-dependency"
                  key={`dep-up-${n.id}`}
                  onClick={() => onNeighborSelect(n)}
                  type="button"
                >
                  <span>↑ {n.label}</span>
                  <span>{n.subtitle || n.kind || ""}</span>
                </button>
              ))}
            </div>
          ) : null}
          {downstream.length ? (
            <div className="gh-lineage-node-deps-group">
              <div className="gh-attribute-label">Downstream</div>
              {downstream.map((n) => (
                <button
                  className="gh-lineage-linked-row is-node-link"
                  data-testid="lineage-node-dependency"
                  key={`dep-down-${n.id}`}
                  onClick={() => onNeighborSelect(n)}
                  type="button"
                >
                  <span>↓ {n.label}</span>
                  <span>{n.subtitle || n.kind || ""}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="gh-support-copy gh-lineage-node-empty">
          No adjacent assets on this lineage graph.
        </div>
      )}
    </div>
  );
}

export default function LineageGraph({
  asset,
  assetSearchLoading,
  assetSearchQuery,
  assetSearchResults,
  assetSearchResolvedQuery,
  allowRefocus = true,
  context,
  graph,
  lineagePayload = null,
  hasEdges,
  linkedRecordUnavailableOverrides = {},
  overlay = null,
  // Workspace-level stepper props — when these are provided the control
  // bar above the canvas owns the clamp knobs; the legacy in-canvas
  // filter rail still works on its own when the parent doesn't wire
  // them (tests, embeds).
  upstreamLevels = null,
  downstreamLevels = null,
  maxDepth = null,
  nodesPerLayer = null,
  includeColumns = null,
  onRegisterGraphActions = null,
  showCanvasControls = true,
  onAssetSearchQueryChange,
  onContextChange,
  onOpenAsset,
  onOpenGovernance,
  onSelectAsset,
  userEmail = "",
  workspaceHost = "",
}) {
  const nodeTypes = useMemo(() => ({ assetNode: AssetNode }), []);
  const edgeTypes = useMemo(() => ({ assetEdge: AssetEdge }), []);
  const transformedBase = useMemo(() => transformGraph(graph), [graph]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  // Default open so the focused asset's detail rail is visible immediately
  // on page load, matching the lineage mockup (docs/mockups/lineage_mockup.png).
  // Users can collapse via the drawer's Close button for full-canvas view.
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [graphMode, setGraphMode] = useState("explore");
  const [flowInstance, setFlowInstance] = useState(null);
  const [allowDefaultSelection, setAllowDefaultSelection] = useState(true);
  const [refocusOpen, setRefocusOpen] = useState(false);
  // Phase 2-j.1 — hovering a column mapping row inside the edge drawer lights
  // up the exact edge + source/target nodes so prospects see the column-
  // level flow, one hop at a time. Single-hop only; multi-hop transitive
  // paths are still a Phase 3+ backend slice.
  const [hoveredColumnIndex, setHoveredColumnIndex] = useState(-1);
  useEffect(() => {
    setHoveredColumnIndex(-1);
  }, [selectedEdgeId]);
  const [collapsedBranches, setCollapsedBranches] = useState({});
  // Filter rail — type exclusions + max depth. State lives locally so
  // filters reset when you re-root the graph (which the user usually
  // wants, because type availability differs per asset).
  const [filterRailOpen, setFilterRailOpen] = useState(false);
  const [excludedKinds, setExcludedKinds] = useState(() => new Set());
  const [maxVisibleDepth, setMaxVisibleDepth] = useState(4);
  // A5.1 — "Include column lineage" toggle. When off, column-level nodes
  // (kind === "Column") are filtered out so the graph reads as table/view
  // lineage only. The toggle persists locally via useState — a graph-wide
  // lineage store is not yet present, so we do not push this across the
  // app boundary. When the backend starts emitting column nodes, enabling
  // the toggle reveals them without further frontend work.
  const [includeColumnLineage, setIncludeColumnLineage] = useState(false);
  // Node drawer tab — the mockup groups node context into Details /
  // Columns / Quality / Stewardship / Dependencies. We default to
  // Details and reset whenever the selected node flips over.
  const [nodeDrawerTab, setNodeDrawerTab] = useState("details");
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const refocusRootRef = useRef(null);
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const lastAutoFitKeyRef = useRef("");
  // Tracks whether the user has physically interacted with the graph
  // (click, drag, zoom). When first-hop lands and the user starts poking
  // the graph before the full-tier payload arrives, we must NOT auto-fit
  // again when the node count changes — that would yank the viewport
  // mid-interaction. Reset to false on every new asset fqn.
  const hasUserInteractedRef = useRef(false);
  useEffect(() => {
    hasUserInteractedRef.current = false;
  }, [asset?.fqn]);

  const focusNode = transformedBase.nodes.find((node) => node.data.role === "focus")?.data || null;
  const defaultFocusNodeId = focusNode?.id || transformedBase.nodes[0]?.id || "";
  const graphHasEdges = hasEdges ?? transformedBase.edges.length > 0;
  const availableKinds = useMemo(() => {
    const kinds = new Set();
    for (const node of transformedBase.nodes) {
      const kind = String(node.data?.kind || "").trim();
      if (kind) kinds.add(kind);
    }
    return [...kinds].sort();
  }, [transformedBase.nodes]);

  const toggleBranchCollapse = (branchRootId) => {
    if (!branchRootId) return;
    setCollapsedBranches((current) => ({
      ...current,
      [branchRootId]: !current[branchRootId],
    }));
  };

  const branchMetadata = useMemo(() => {
    return transformedBase.nodes.reduce((acc, node) => {
      const branchRootId = node.data?.layout?.branchRoot;
      if (!branchRootId || branchRootId === defaultFocusNodeId) return acc;
      const current = acc[branchRootId] || {
        rootNodeId: branchRootId,
        side: node.data?.layout?.side || "",
        nodeCount: 0,
        descendantCount: 0,
        maxDepth: 0,
      };
      current.nodeCount += 1;
      current.maxDepth = Math.max(current.maxDepth, Number(node.data?.layout?.depth || 0));
      if (node.id !== branchRootId) current.descendantCount += 1;
      acc[branchRootId] = current;
      return acc;
    }, {});
  }, [defaultFocusNodeId, transformedBase.nodes]);

  // Effective clamp values — workspace control bar wins when it provides
  // them, otherwise fall back to the legacy filter-rail state so existing
  // tests and embeds keep working.
  const effectiveIncludeColumns = includeColumns == null ? includeColumnLineage : Boolean(includeColumns);
  const effectiveMaxDepth = maxDepth == null ? maxVisibleDepth : Math.max(1, Number(maxDepth) || 1);
  const effectiveUpstreamLevels = upstreamLevels == null ? null : Math.max(0, Number(upstreamLevels) || 0);
  const effectiveDownstreamLevels = downstreamLevels == null ? null : Math.max(0, Number(downstreamLevels) || 0);
  const effectiveNodesPerLayer = nodesPerLayer == null ? null : Math.max(1, Number(nodesPerLayer) || 0);

  const transformed = useMemo(() => {
    // First pass — base visibility (branch collapse, kind exclusion,
    // column toggle, per-side depth budget, global max-depth clamp).
    const baseVisible = transformedBase.nodes.filter((node) => {
      const branchRootId = node.data?.layout?.branchRoot;
      if (branchRootId && branchRootId !== defaultFocusNodeId && collapsedBranches[branchRootId] && node.id !== branchRootId) {
        return false;
      }
      if (node.data?.role === "focus") return true;
      const kind = String(node.data?.kind || "").trim();
      if (excludedKinds.has(kind)) return false;
      if (!effectiveIncludeColumns && /^column$/i.test(kind)) return false;
      const depth = Number(node.data?.layout?.depth || 0);
      if (depth > effectiveMaxDepth) return false;
      // Per-direction caps from the workspace-level steppers. When the
      // backend doesn't honor these caps in the payload, we clamp the
      // rendered graph here so the user sees the depth they asked for.
      const side = node.data?.layout?.side;
      if (effectiveUpstreamLevels != null && side === "upstream" && depth > effectiveUpstreamLevels) {
        return false;
      }
      if (effectiveDownstreamLevels != null && side === "downstream" && depth > effectiveDownstreamLevels) {
        return false;
      }
      return true;
    });

    // Second pass — per-layer node budget. Bucket nodes by (side, depth)
    // and trim each bucket to `effectiveNodesPerLayer` after the focus is
    // always kept. We sort by branchRoot label to get a deterministic
    // slice; preserving the same nodes between renders.
    let layerLimited = baseVisible;
    if (effectiveNodesPerLayer != null) {
      const buckets = new Map();
      for (const node of baseVisible) {
        if (node.data?.role === "focus") continue;
        const side = node.data?.layout?.side || "other";
        const depth = Number(node.data?.layout?.depth || 0);
        const key = `${side}:${depth}`;
        const bucket = buckets.get(key) || [];
        bucket.push(node);
        buckets.set(key, bucket);
      }
      const kept = new Set(
        baseVisible.filter((node) => node.data?.role === "focus").map((node) => node.id),
      );
      for (const [, bucket] of buckets) {
        bucket.sort((left, right) => {
          const leftSort = String(left.data?.layout?.branchRoot || left.data?.label || left.id);
          const rightSort = String(right.data?.layout?.branchRoot || right.data?.label || right.id);
          return leftSort.localeCompare(rightSort);
        });
        bucket.slice(0, effectiveNodesPerLayer).forEach((node) => kept.add(node.id));
      }
      layerLimited = baseVisible.filter((node) => kept.has(node.id));
    }

    const visibleNodeIds = new Set(layerLimited.map((node) => node.id));

    return {
      nodes: transformedBase.nodes
        .filter((node) => visibleNodeIds.has(node.id))
        .map((node) => {
          const branch = branchMetadata[node.id] || null;
          return {
            ...node,
            data: {
              ...node.data,
              branchDescendantCount: branch?.descendantCount || 0,
              branchCollapsed: Boolean(branch && collapsedBranches[node.id]),
              onToggleBranchCollapse:
                branch && branch.descendantCount
                  ? () => toggleBranchCollapse(node.id)
                  : null,
              // Round 18 defect #8: the focused node renders an inline
              // column list when Include Columns is on — matches the
              // mockup's expanded customer_churn_model card. Non-focus
              // nodes never get column stamping.
              __showInlineColumns: Boolean(
                effectiveIncludeColumns && node.data?.role === "focus",
              ),
            },
          };
        }),
      edges: transformedBase.edges
        .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
        .map((edge) => {
          const branchRootId =
            edge.target === defaultFocusNodeId
              ? edge.source
              : edge.source === defaultFocusNodeId
                ? edge.target
                : "";
          const branch = branchRootId ? branchMetadata[branchRootId] || null : null;
          return {
            ...edge,
            data: {
              ...edge.data,
              focusAnchor:
                edge.target === defaultFocusNodeId
                  ? "target"
                  : edge.source === defaultFocusNodeId
                    ? "source"
                    : "",
              branchRootId,
              branchDescendantCount: branch?.descendantCount || 0,
              branchCollapsed: Boolean(branchRootId && collapsedBranches[branchRootId]),
              onToggleBranchCollapse:
                branchRootId && branch?.descendantCount
                  ? () => toggleBranchCollapse(branchRootId)
                  : null,
            },
          };
        }),
    };
  }, [
    branchMetadata,
    collapsedBranches,
    defaultFocusNodeId,
    effectiveDownstreamLevels,
    effectiveIncludeColumns,
    effectiveMaxDepth,
    effectiveNodesPerLayer,
    effectiveUpstreamLevels,
    excludedKinds,
    transformedBase.edges,
    transformedBase.nodes,
  ]);

  const clearSelection = (options = {}) => {
    const { keepDrawer = false, keepFocusNode = true } = options;
    setAllowDefaultSelection(keepFocusNode);
    setSelectedEdgeId("");
    setSelectedNodeId(keepFocusNode ? defaultFocusNodeId : "");
    if (!keepDrawer) setDrawerOpen(false);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const nodesById = useMemo(
    () =>
      transformed.nodes.reduce((acc, node) => {
        acc[node.id] = node.data;
        return acc;
      }, {}),
    [transformed.nodes]
  );

  useEffect(() => {
    setSelectedNodeId(defaultFocusNodeId);
    setSelectedEdgeId("");
    // Drawer stays open on asset switch so the new focus node's detail rail
    // is visible without a click. Matches docs/mockups/lineage_mockup.png.
    setDrawerOpen(Boolean(defaultFocusNodeId));
    setGraphMode("explore");
    setAllowDefaultSelection(true);
    setRefocusOpen(false);
    setCollapsedBranches({});
    setNodeDrawerTab("details");
    onAssetSearchQueryChange?.("");
  }, [asset?.fqn, defaultFocusNodeId]);

  useEffect(() => {
    // Reset back to Details whenever the focused node switches.
    setNodeDrawerTab("details");
  }, [selectedNodeId]);

  useEffect(() => {
    setSelectedEdgeId("");
    setSelectedNodeId(defaultFocusNodeId);
    setDrawerOpen(Boolean(defaultFocusNodeId));
    setGraphMode("explore");
    setAllowDefaultSelection(true);
    setRefocusOpen(false);
    setCollapsedBranches({});
  }, [context, defaultFocusNodeId]);

  useEffect(() => {
    if (!graphHasEdges && graphMode !== "explore") {
      setGraphMode("explore");
    }
  }, [graphHasEdges, graphMode]);

  useEffect(() => {
    const edgeStillExists = selectedEdgeId && transformed.edges.some((edge) => edge.id === selectedEdgeId);
    const nodeStillExists = selectedNodeId && nodesById[selectedNodeId];

    if (selectedEdgeId && !edgeStillExists) {
      setSelectedEdgeId("");
    }
    if (selectedNodeId && !nodeStillExists) {
      setSelectedNodeId(defaultFocusNodeId);
    }
    if (!selectedEdgeId && !selectedNodeId && defaultFocusNodeId && allowDefaultSelection) {
      setSelectedNodeId(defaultFocusNodeId);
    }
  }, [allowDefaultSelection, defaultFocusNodeId, nodesById, selectedEdgeId, selectedNodeId, transformed.edges]);

  const selectedNode = selectedNodeId
    ? nodesById[selectedNodeId] || null
    : allowDefaultSelection
      ? nodesById[defaultFocusNodeId] || null
      : null;
  const selectedEdge = transformed.edges.find((edge) => edge.id === selectedEdgeId) || null;
  const edgeDetails = selectedEdge ? lineagePayload?.edgeDetails?.[selectedEdge.id] || null : null;
  const selectedSource = selectedEdge ? nodesById[selectedEdge.source] || null : null;
  const selectedTarget = selectedEdge ? nodesById[selectedEdge.target] || null : null;
  // Minimap is always useful — even a 2-hop graph benefits from the
  // viewport rectangle because the DAG layout frequently overflows the
  // stage height. The old `>= 5` gate was rendering an empty box on
  // small graphs and an unreachable minimap on larger ones (the
  // legacy CSS was stuck at min-height: 0).
  const showMiniMap = false;
  const showControls = false;
  const canReturnToFocus =
    defaultFocusNodeId && (Boolean(selectedEdge) || Boolean(selectedNode && selectedNode.id !== defaultFocusNodeId));
  const topRefocusCandidate =
    !assetSearchLoading && assetSearchResolvedQuery === assetSearchQuery.trim()
      ? assetSearchResults?.[0] || null
      : null;
  const nodeStats = selectedNode
    ? {
        upstream: transformed.edges.filter((edge) => edge.target === selectedNode.id).length,
        downstream: transformed.edges.filter((edge) => edge.source === selectedNode.id).length,
      }
    : { upstream: 0, downstream: 0 };
  const neighborBuckets = useMemo(() => {
    if (!selectedNode) return { upstream: [], downstream: [] };
    const upstream = transformed.edges
      .filter((edge) => edge.target === selectedNode.id)
      .map((edge) => nodesById[edge.source])
      .filter(Boolean);
    const downstream = transformed.edges
      .filter((edge) => edge.source === selectedNode.id)
      .map((edge) => nodesById[edge.target])
      .filter(Boolean);
    return { upstream, downstream };
  }, [nodesById, selectedNode, transformed.edges]);

  // Phase 2-i.2 — arrow-key navigation between connected nodes.
  //   ArrowLeft  → move upstream (neighbor with an edge terminating at the
  //                 currently selected node); cycles through siblings.
  //   ArrowRight → move downstream.
  //   ArrowUp/Down → cycle through same-direction siblings when there are
  //                  multiple upstream or multiple downstream neighbors.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const isEditable = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return el.isContentEditable;
    };

    const pickNeighbor = (node, direction) => {
      if (!node) return null;
      const ids =
        direction === "upstream"
          ? transformed.edges.filter((e) => e.target === node.id).map((e) => e.source)
          : transformed.edges.filter((e) => e.source === node.id).map((e) => e.target);
      const unique = [...new Set(ids)]
        .map((id) => nodesById[id])
        .filter(Boolean);
      if (!unique.length) return null;
      return unique[0];
    };

    const pickSibling = (node, offset) => {
      if (!node) return null;
      // Find other nodes that share a neighbor with the current one (siblings
      // under the same upstream or downstream pivot).
      const upstreamIds = transformed.edges
        .filter((e) => e.target === node.id)
        .map((e) => e.source);
      const siblingSet = new Set();
      for (const upId of upstreamIds) {
        for (const e of transformed.edges) {
          if (e.source === upId && e.target !== node.id) siblingSet.add(e.target);
        }
      }
      const downstreamIds = transformed.edges
        .filter((e) => e.source === node.id)
        .map((e) => e.target);
      for (const downId of downstreamIds) {
        for (const e of transformed.edges) {
          if (e.target === downId && e.source !== node.id) siblingSet.add(e.source);
        }
      }
      const siblings = [...siblingSet]
        .map((id) => nodesById[id])
        .filter(Boolean)
        .sort((a, b) =>
          String(a?.data?.label || a?.id || "").localeCompare(
            String(b?.data?.label || b?.id || ""),
          ),
        );
      if (!siblings.length) return null;
      // Keep a stable index by hashing current node; simple cycle.
      const current = siblings.findIndex((s) => s.id === node.id);
      const idx = current >= 0 ? (current + offset + siblings.length) % siblings.length : 0;
      return siblings[idx] || null;
    };

    const onKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(document.activeElement)) return;
      if (refocusOpen) return;
      if (!viewport.isConnected) return;
      const rect = viewport.getBoundingClientRect?.();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const currentNode = selectedNodeId
        ? nodesById[selectedNodeId]
        : defaultFocusNodeId
          ? nodesById[defaultFocusNodeId]
          : null;
      if (!currentNode) return;

      let next = null;
      if (event.key === "ArrowRight") {
        next = pickNeighbor(currentNode, "downstream");
      } else if (event.key === "ArrowLeft") {
        next = pickNeighbor(currentNode, "upstream");
      } else if (event.key === "ArrowDown") {
        next = pickSibling(currentNode, 1);
      } else if (event.key === "ArrowUp") {
        next = pickSibling(currentNode, -1);
      } else {
        return;
      }
      if (!next) return;
      event.preventDefault();
      setAllowDefaultSelection(false);
      setSelectedEdgeId("");
      setSelectedNodeId(next.id);
      setGraphMode("explore");
      setDrawerOpen(true);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    defaultFocusNodeId,
    nodesById,
    refocusOpen,
    selectedNodeId,
    transformed.edges,
  ]);

  const activeSelection = useMemo(() => {
    if (!allowDefaultSelection && !selectedEdge && !selectedNode) {
      return { nodeIds: [], edgeIds: [] };
    }

    if (
      graphMode === "explore"
      && !selectedEdge
      && (!selectedNode || selectedNode.id === defaultFocusNodeId)
    ) {
      return { nodeIds: [], edgeIds: [] };
    }

    if (graphMode === "path") {
      if (selectedEdge) {
        const sourcePath = lineagePath(transformed.edges, selectedEdge.source, defaultFocusNodeId);
        const targetPath = lineagePath(transformed.edges, selectedEdge.target, defaultFocusNodeId);
        return {
          nodeIds: [...new Set([selectedEdge.source, selectedEdge.target, ...sourcePath.nodeIds, ...targetPath.nodeIds])],
          edgeIds: [...new Set([selectedEdge.id, ...sourcePath.edgeIds, ...targetPath.edgeIds])],
        };
      }
      const anchorNodeId = selectedNode?.id || defaultFocusNodeId;
      return lineagePath(transformed.edges, anchorNodeId, defaultFocusNodeId);
    }

    if (graphMode === "upstream") {
      const anchorNodeId = selectedSource?.id || selectedNode?.id || defaultFocusNodeId;
      return upstreamSelection(transformed.edges, anchorNodeId);
    }

    if (graphMode === "impact") {
      const anchorNodeId = selectedTarget?.id || selectedNode?.id || defaultFocusNodeId;
      return downstreamSelection(transformed.edges, anchorNodeId);
    }

    if (selectedEdge) {
      return { nodeIds: [selectedEdge.source, selectedEdge.target], edgeIds: [selectedEdge.id] };
    }
    return connectedSelection(transformed.edges, selectedNode?.id || defaultFocusNodeId);
  }, [defaultFocusNodeId, graphMode, selectedEdge, selectedNode?.id, selectedTarget?.id, transformed.edges]);

  const activeNodeIds = activeSelection.nodeIds;
  const activeEdgeIds = activeSelection.edgeIds;
  const hasActiveGraphSelection = activeNodeIds.length > 0 || activeEdgeIds.length > 0;
  const activePathNodes = useMemo(() => {
    return activeNodeIds
      .map((nodeId) => nodesById[nodeId])
      .filter(Boolean)
      .slice(0, 6);
  }, [activeNodeIds, nodesById]);
  const drawerTitle = selectedEdge ? "Relationship Details" : "";

  useEffect(() => {
    if (!refocusOpen) return undefined;
    const onPointerDown = (event) => {
      if (!refocusRootRef.current?.contains(event.target)) {
        setRefocusOpen(false);
        onAssetSearchQueryChange?.("");
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setRefocusOpen(false);
        onAssetSearchQueryChange?.("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onAssetSearchQueryChange, refocusOpen]);

  // Phase 2-i.3 — Cmd+F / Ctrl+F / Cmd+K opens the refocus (node search)
  // overlay from anywhere on the lineage page. Escape closes it via the
  // existing refocusOpen effect above.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const onKeyDown = (event) => {
      if (!viewport.isConnected) return;
      const rect = viewport.getBoundingClientRect?.();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      const key = (event.key || "").toLowerCase();
      if (key !== "f" && key !== "k") return;
      event.preventDefault();
      setRefocusOpen(true);
      // Focus the search input on the next tick once the overlay renders.
      requestAnimationFrame(() => {
        const input = refocusRootRef.current?.querySelector?.("input[type='search'], input[type='text'], input");
        input?.focus?.();
        input?.select?.();
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const autoFitKey = `${asset?.fqn || "none"}:${context}:${transformed.nodes.length}:${transformed.edges.length}`;

  useEffect(() => {
    if (!flowInstance || !transformed.nodes.length) return undefined;
    if (lastAutoFitKeyRef.current === autoFitKey) return undefined;
    // If the user has already interacted with the graph (clicked a node,
    // panned, zoomed), treat subsequent graph-size changes — which
    // typically come from first-hop → full tier transitions — as
    // in-place updates. The new nodes appear, but the viewport doesn't
    // yank. Users who want to see the whole graph can hit Focus View /
    // Reset Zoom manually.
    if (lastAutoFitKeyRef.current && hasUserInteractedRef.current) {
      lastAutoFitKeyRef.current = autoFitKey;
      return undefined;
    }
    lastAutoFitKeyRef.current = autoFitKey;
    const frame = requestAnimationFrame(() => {
      flowInstance.fitView?.({ padding: 0.08, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFitKey, flowInstance, transformed.nodes.length]);

  useEffect(() => {
    if (!flowInstance || !transformed.nodes.length) return undefined;
    // React Flow leaves new nodes at `visibility: hidden` until its
    // internal ResizeObserver measures each one. When the drawer opens on
    // mount the canvas width shifts mid-measurement and the observer
    // silently stops firing, leaving every node invisible on cold load.
    // Dispatch a synthetic resize (twice, with a small gap) to force the
    // observer to re-measure, then fit the view. The two-shot is belt +
    // suspenders: the first resize kicks the observer, the second survives
    // any drawer-open layout that happens on the same frame.
    const frame = requestAnimationFrame(() => {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"));
      flowInstance.fitView?.({ padding: drawerOpen ? 0.06 : 0.1, duration: 180 });
    });
    const kick = setTimeout(() => {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"));
      flowInstance.fitView?.({ padding: drawerOpen ? 0.06 : 0.1, duration: 180 });
    }, 240);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(kick);
    };
  }, [drawerOpen, flowInstance, transformed.nodes.length]);

  // Expose focus-view / reset-zoom handlers to the workspace control bar
  // so the top-row "Focus View" and "Reset Zoom" buttons drive the same
  // ReactFlow instance we already manage locally. Registering null on
  // unmount keeps dangling callbacks from firing after teardown.
  useEffect(() => {
    if (typeof onRegisterGraphActions !== "function") return undefined;
    onRegisterGraphActions({
      focusView: () => {
        if (!flowInstance) return;
        const targetId = selectedNodeId || defaultFocusNodeId;
        const node = targetId ? flowInstance.getNode?.(targetId) : null;
        if (node?.position) {
          const width = node.width || node.measured?.width || 240;
          const height = node.height || node.measured?.height || 120;
          flowInstance.setCenter?.(
            node.position.x + width / 2,
            node.position.y + height / 2,
            { zoom: 1.15, duration: 240 },
          );
        } else {
          flowInstance.fitView?.({ padding: 0.1, duration: 240 });
        }
      },
      resetZoom: () => {
        flowInstance?.fitView?.({ padding: 0.1, duration: 220 });
      },
    });
    return () => onRegisterGraphActions(null);
  }, [defaultFocusNodeId, flowInstance, onRegisterGraphActions, selectedNodeId]);

  useEffect(() => {
    if (!flowInstance || !viewportRef.current || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        flowInstance.fitView?.({ padding: drawerOpen ? 0.06 : 0.1, duration: 140 });
      });
    });
    observer.observe(viewportRef.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [drawerOpen, flowInstance]);

  return (
    <div className={`gh-lineage-canvas ${drawerOpen ? "has-drawer" : ""}`} ref={canvasRef}>
      <div className="gh-lineage-main-stage">
        {showCanvasControls ? (
        <div className="gh-lineage-canvas-controls">
          <div className="gh-lineage-command-strip">
            {allowRefocus ? (
              <div className="gh-lineage-command" ref={refocusRootRef}>
                <button
                  className={`gh-secondary-button ${refocusOpen ? "is-active" : ""}`}
                  onClick={() => {
                    setRefocusOpen((open) => {
                      if (open) onAssetSearchQueryChange?.("");
                      return !open;
                    });
                  }}
                  title="Search the catalog and re-root the lineage graph on a different asset"
                  type="button"
                >
                  Search another asset
                </button>
                {refocusOpen ? (
                  <div className="gh-lineage-command-popover">
                    <div className="gh-filter-title">Refocus graph</div>
                    <input
                      className="gh-input"
                      onChange={(event) => onAssetSearchQueryChange?.(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && topRefocusCandidate) {
                          event.preventDefault();
                          setRefocusOpen(false);
                          onAssetSearchQueryChange?.("");
                          onSelectAsset(topRefocusCandidate.fqn);
                        }
                      }}
                      placeholder={asset?.name ? `Search from ${asset.name}` : "Search for an asset"}
                      value={assetSearchQuery}
                    />
                    <div className="gh-lineage-search-list">
                      {assetSearchLoading ? (
                        <div className="gh-lineage-search-empty">Searching assets…</div>
                      ) : assetSearchResults?.length ? (
                        assetSearchResults.map((candidate) => (
                          <button
                            className={`gh-lineage-search-row ${candidate.fqn === asset?.fqn ? "is-active" : ""}`}
                            key={candidate.fqn}
                            onClick={() => {
                              setRefocusOpen(false);
                              onAssetSearchQueryChange?.("");
                              onSelectAsset(candidate.fqn);
                            }}
                            type="button"
                          >
                            <span>{candidate.name}</span>
                            <span>{assetPathLabel(candidate)}</span>
                          </button>
                        ))
                      ) : (
                        <div className="gh-lineage-search-empty">
                          {assetSearchQuery ? "No matching assets." : "Start typing to refocus the graph."}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* Round 19 defect #5: removed the redundant in-canvas
                "Reset view" button — the workspace control bar's
                "Reset Zoom" action already drives `flowInstance.fitView`
                via the registered graphActions callback. Having two
                buttons that do the same thing just cluttered the
                top-strip overlay. */}
            <button
              className="gh-secondary-button"
              data-testid="lineage-export-png"
              onClick={async () => {
                // Defect 4 — the button used to swallow every failure so a
                // user who clicked it got no feedback at all. We now:
                //   1. Attempt the SVG/foreignObject export (works in most
                //      modern browsers for DOM trees without cross-origin
                //      images).
                //   2. On failure, surface a visible fallback via
                //      `window.alert` so the user knows the click
                //      registered. Calling window.print is the
                //      documented escape hatch — the user can print-to-PDF
                //      from the OS dialog if PNG rasterization blows up.
                if (!viewportRef.current) {
                  if (typeof window !== "undefined") {
                    window.alert(
                      "Lineage view isn't ready for export yet. Try again after the graph finishes loading.",
                    );
                  }
                  return;
                }
                try {
                  await exportLineagePng(viewportRef.current, asset?.fqn);
                } catch (err) {
                  console.error("lineage PNG export failed", err);
                  if (typeof window !== "undefined") {
                    const useFallback = window.confirm(
                      "PNG export isn't supported in this browser. Use the system print dialog as a fallback? (You can 'Save as PDF'.)",
                    );
                    if (useFallback && typeof window.print === "function") {
                      window.print();
                    }
                  }
                }
              }}
              title="Download a PNG snapshot of the current lineage view"
              type="button"
            >
              Export PNG
            </button>
            {canReturnToFocus ? (
              <button
                className="gh-secondary-button"
                onClick={() => {
                  clearSelection({ keepDrawer: false, keepFocusNode: true });
                  setRefocusOpen(false);
                  setGraphMode("explore");
                  flowInstance?.fitView?.({ padding: 0.18 });
                }}
                title="Clear the current node/edge selection and re-center on the focus asset"
                type="button"
              >
                Recenter on focus
              </button>
            ) : null}
            <button
              className={`gh-secondary-button ${graphMode === "impact" ? "is-active" : ""}`}
              onClick={() => {
                setGraphMode((mode) => (mode === "impact" ? "explore" : "impact"));
              }}
              title={
                graphMode === "impact"
                  ? "Exit impact mode"
                  : "Highlight every asset downstream of the focus to preview the blast radius of a change"
              }
              type="button"
            >
              {graphMode === "impact" ? "Exit impact" : "Impact mode"}
            </button>
            <button
              className={`gh-secondary-button ${filterRailOpen ? "is-active" : ""}`}
              onClick={() => setFilterRailOpen((open) => !open)}
              title="Filter the graph by node type and lineage depth"
              type="button"
            >
              Filters
              {excludedKinds.size > 0 || maxVisibleDepth < 4 ? (
                <span className="gh-lineage-filter-badge">
                  {excludedKinds.size + (maxVisibleDepth < 4 ? 1 : 0)}
                </span>
              ) : null}
            </button>
            <button
              className="gh-secondary-button"
              onClick={async () => {
                try {
                  const url = new URL(window.location.href);
                  await navigator.clipboard.writeText(url.toString());
                  setShareLinkCopied(true);
                  setTimeout(() => setShareLinkCopied(false), 1800);
                } catch {
                  // Fallback: let the user see the URL so they can copy manually
                  window.prompt("Copy lineage link", window.location.href);
                }
              }}
              title="Copy a link to this lineage view so a teammate lands on the exact same focus + filters"
              type="button"
            >
              {shareLinkCopied ? "Link copied" : "Share link"}
            </button>
          </div>
          {filterRailOpen ? (
            <div className="gh-lineage-filter-panel" role="region" aria-label="Lineage filters">
              <div className="gh-lineage-filter-head">
                <div className="gh-filter-title">Filter graph</div>
                <button
                  className="gh-secondary-button gh-secondary-button-compact"
                  onClick={() => {
                    setExcludedKinds(new Set());
                    setMaxVisibleDepth(4);
                  }}
                  type="button"
                >
                  Clear
                </button>
              </div>
              <div className="gh-lineage-filter-section">
                <div className="gh-filter-label">Node types</div>
                <div className="gh-chip-row">
                  {availableKinds.map((kind) => {
                    const isExcluded = excludedKinds.has(kind);
                    return (
                      <button
                        className={`gh-chip ${isExcluded ? "gh-chip-muted" : "gh-chip-soft"}`}
                        key={kind}
                        onClick={() => {
                          setExcludedKinds((current) => {
                            const next = new Set(current);
                            if (next.has(kind)) next.delete(kind);
                            else next.add(kind);
                            return next;
                          });
                        }}
                        title={
                          isExcluded
                            ? `Show ${kind} nodes`
                            : `Hide ${kind} nodes from the graph`
                        }
                        type="button"
                      >
                        {isExcluded ? "◻" : "◼"} {kind}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="gh-lineage-filter-section">
                <div className="gh-filter-label">
                  Max depth from focus: <strong>{maxVisibleDepth}</strong>
                </div>
                <input
                  aria-label="Maximum lineage hops visible from focus"
                  className="gh-range"
                  max={4}
                  min={1}
                  onChange={(event) => setMaxVisibleDepth(Number(event.target.value))}
                  step={1}
                  type="range"
                  value={maxVisibleDepth}
                />
              </div>
              <div className="gh-lineage-filter-section">
                <label className="gh-lineage-filter-toggle">
                  <input
                    aria-label="Include column lineage"
                    checked={includeColumnLineage}
                    data-testid="lineage-include-columns-toggle"
                    onChange={(event) => setIncludeColumnLineage(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Include column lineage
                  </span>
                </label>
                <div className="gh-filter-hint">
                  Reveals column-level nodes and edges when the backend exposes them.
                </div>
              </div>
            </div>
          ) : null}
        </div>
        ) : null}
        <div className="gh-lineage-flow-shell">
          <div className="gh-lineage-viewport" ref={viewportRef}>
            <ReactFlow
              edges={transformed.edges.map((edge) => {
                const isColumnHighlighted =
                  hoveredColumnIndex >= 0 && selectedEdge && edge.id === selectedEdge.id;
                const base = activeEdgeIds.includes(edge.id)
                  ? "is-active"
                  : hasActiveGraphSelection
                    ? "is-muted"
                    : "";
                return {
                  ...edge,
                  className: `${base}${isColumnHighlighted ? " is-column-highlighted" : ""}`.trim(),
                };
              })}
              onInit={setFlowInstance}
              minZoom={0.3}
              nodes={transformed.nodes.map((node) => {
                const isColumnEndpoint =
                  hoveredColumnIndex >= 0 &&
                  selectedEdge &&
                  (node.id === selectedEdge.source || node.id === selectedEdge.target);
                const base = activeNodeIds.includes(node.id)
                  ? "is-active"
                  : hasActiveGraphSelection
                    ? "is-muted"
                    : "";
                return {
                  ...node,
                  data: node.data,
                  className: `${base}${isColumnEndpoint ? " is-column-endpoint" : ""}`.trim(),
                  type: "assetNode",
                };
              })}
              edgeTypes={edgeTypes}
              nodeTypes={nodeTypes}
              onEdgeClick={(_, edge) => {
                hasUserInteractedRef.current = true;
                setAllowDefaultSelection(false);
                setSelectedEdgeId(edge.id);
                setSelectedNodeId("");
                setDrawerOpen(true);
                setRefocusOpen(false);
                setGraphMode("path");
              }}
              onNodeClick={(_, node) => {
                hasUserInteractedRef.current = true;
                setAllowDefaultSelection(false);
                setSelectedNodeId(node.id);
                setSelectedEdgeId("");
                setDrawerOpen(true);
                setRefocusOpen(false);
                setGraphMode("explore");
              }}
              onPaneClick={() => {
                hasUserInteractedRef.current = true;
                if (refocusOpen) setRefocusOpen(false);
                if (drawerOpen) setDrawerOpen(false);
              }}
              onMoveStart={(event) => {
                // React Flow fires onMoveStart for BOTH programmatic
                // fitView animations and genuine user gestures. The
                // programmatic fit has no `event` (or a synthetic one
                // without a concrete DOM target), whereas a real user
                // pan/zoom always passes a MouseEvent / WheelEvent /
                // TouchEvent. Gate on event.type / target to avoid the
                // own-fit from flipping `hasUserInteractedRef` before
                // the user has actually touched the graph.
                if (!event || !event.type) return;
                hasUserInteractedRef.current = true;
              }}
              nodesDraggable={false}
              nodesConnectable={false}
              selectionOnDrag={false}
              /* Round 20 defects #5-6: correct scroll + zoom semantics.
                 - `zoomOnDoubleClick` is explicit true so empty-pane
                   double-click steps in one zoom level.
                 - `zoomOnScroll` is BACK ON so the mouse wheel zooms
                   (the previous round disabled it entirely to make
                   trackpad pan, which also broke wheel zoom).
                 - Trackpad pan is now enforced via a custom wheel
                   handler (`onWheel` below) that detects pixel-mode
                   scroll with small deltas and redirects it to pan
                   translation via the ReactFlow instance. Mouse-wheel
                   (`deltaMode === 1` line-mode, or pixel-mode with
                   integer coarse deltas) falls through to ReactFlow's
                   native zoomOnScroll. */
              zoomOnDoubleClick={true}
              zoomOnScroll={true}
              panOnScroll={false}
              zoomOnPinch
              panOnDrag
              onWheel={(event) => {
                // Detect mouse-wheel vs trackpad:
                //   deltaMode === 1 (lines) → classic mouse wheel
                //   deltaMode === 0 with ctrlKey → trackpad pinch
                //   deltaMode === 0 without ctrl + large int delta ≥ 100 → likely wheel
                //   otherwise → trackpad scroll → pan
                const isMouseWheel =
                  event.deltaMode === 1 ||
                  event.ctrlKey ||
                  (Math.abs(event.deltaY) >= 100 &&
                    Number.isInteger(event.deltaY) &&
                    event.deltaX === 0);
                if (isMouseWheel) {
                  // Let ReactFlow's zoomOnScroll handle it.
                  return;
                }
                if (!flowInstance) return;
                // Trackpad scroll → pan. Cancel ReactFlow's zoom and
                // translate the viewport by the scroll delta.
                event.preventDefault();
                event.stopPropagation();
                try {
                  const vp = flowInstance.getViewport?.() || { x: 0, y: 0, zoom: 1 };
                  flowInstance.setViewport?.(
                    {
                      x: vp.x - event.deltaX,
                      y: vp.y - event.deltaY,
                      zoom: vp.zoom,
                    },
                    { duration: 0 },
                  );
                } catch (_) {
                  /* older ReactFlow — fail open */
                }
              }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: "assetEdge" }}
            >
              {showMiniMap ? (
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-right"
                  maskColor="rgba(61, 43, 196, 0.08)"
                  /* Round 19 fix #3: the previous nodeColor ("#d7dff4") was
                     near-invisible on the white minimap background, making
                     the map look completely blank. Use the indigo brand
                     accent with a darker border so the node rectangles
                     actually read. */
                  nodeColor={(node) => (node?.data?.role === "focus" ? "#3d2bc4" : "#a6a0f5")}
                  nodeStrokeColor="#2d1f93"
                  nodeStrokeWidth={1.5}
                  nodeBorderRadius={3}
                />
              ) : null}
              {showControls ? <Controls showInteractive={false} /> : null}
            </ReactFlow>
            {graphMode === "impact" && activeNodeIds.length > 0 ? (
              <div className="gh-lineage-mode-overlay" role="status" aria-live="polite">
                <span className="gh-lineage-mode-dot" aria-hidden="true" />
                <div className="gh-lineage-mode-copy">
                  <strong>Impact mode</strong>
                  <span>
                    {Math.max(0, activeNodeIds.length - 1)} asset
                    {activeNodeIds.length === 2 ? "" : "s"} downstream
                    {activeEdgeIds.length
                      ? ` via ${activeEdgeIds.length} edge${activeEdgeIds.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </div>
              </div>
            ) : null}
            {overlay ? <div className="gh-lineage-overlay">{overlay}</div> : null}
            {transformed?.nodes?.length ? (
              <div className="gh-lineage-stats-strip" data-testid="lineage-stats-strip">
                {(() => {
                  const focusId = defaultFocusNodeId;
                  const upstreamCount = transformed.edges.filter((edge) => edge.target === focusId).length;
                  const downstreamCount = transformed.edges.filter((edge) => edge.source === focusId).length;
                  const columnsCount = Array.isArray(focusNode?.columns)
                    ? focusNode.columns.length
                    : Array.isArray(asset?.columns)
                      ? asset.columns.length
                      : 0;
                  return (
                    <span className="gh-lineage-stats-strip-copy">
                      {upstreamCount} upstream · {downstreamCount} downstream
                      {columnsCount ? ` · ${columnsCount} columns` : ""}
                    </span>
                  );
                })()}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SurfaceDrawer
        actions={
          <button
            aria-label="Close drawer"
            className="gh-lineage-drawer-close"
            onClick={() => closeDrawer()}
            type="button"
          >
            ×
          </button>
        }
        bodyClassName={selectedNode && !selectedEdge ? "gh-lineage-node-drawer-body" : ""}
        className="gh-lineage-drawer"
        isOpen={drawerOpen}
        onClose={closeDrawer}
        title={drawerTitle}
      >
        {selectedEdge ? (
          <>
            <div className="gh-lineage-edge-summary">
              <div className="gh-lineage-edge-summary-copy">
                <h2>
                  {selectedSource?.label || selectedEdge.source} → {selectedTarget?.label || selectedEdge.target}
                </h2>
                <div className="gh-support-copy">
                  {edgeDetails?.summary || "Inspect the source and target records, the mapping payload, and the connected operational context."}
                </div>
              </div>
              <div className="gh-chip-stack">
                <span className="gh-chip">Lineage edge</span>
                <span className="gh-chip gh-chip-soft">
                  {edgeDetails?.kind || selectedSource?.kind || "Asset"} → {selectedTarget?.kind || "Asset"}
                </span>
                {edgeDetails?.mappingCount ? (
                  <span className="gh-chip gh-chip-soft">{edgeDetails.mappingCount} column mappings</span>
                ) : null}
                {edgeDetails?.entities?.length ? (
                  <span className="gh-chip gh-chip-soft">{edgeDetails.entities.length} operational entities</span>
                ) : null}
              </div>
            </div>

            <div className="gh-lineage-edge-grid">
              <LineageRecordCard
                title="Source record"
                node={selectedSource}
                tone="source"
                availabilityOverride={linkedRecordUnavailableOverrides?.[selectedSource?.assetFqn] === true ? false : null}
                onOpenAsset={onOpenAsset}
                onOpenGovernance={onOpenGovernance}
                onRefocus={(assetFqn) => onSelectAsset(assetFqn)}
                focusActionLabel="Set as focus"
                onTraceUpstream={
                  selectedSource?.id
                    ? () => {
                        setAllowDefaultSelection(false);
                        setSelectedEdgeId("");
                        setSelectedNodeId(selectedSource.id);
                        setGraphMode("upstream");
                        setDrawerOpen(true);
                        setRefocusOpen(false);
                      }
                    : null
                }
              />
              <LineageRecordCard
                title="Target record"
                node={selectedTarget}
                tone="target"
                availabilityOverride={linkedRecordUnavailableOverrides?.[selectedTarget?.assetFqn] === true ? false : null}
                onOpenAsset={onOpenAsset}
                onOpenGovernance={onOpenGovernance}
                onRefocus={(assetFqn) => onSelectAsset(assetFqn)}
                focusActionLabel="Set as focus"
                onShowImpact={
                  selectedTarget?.id
                    ? () => {
                        setAllowDefaultSelection(false);
                        setSelectedEdgeId("");
                        setSelectedNodeId(selectedTarget.id);
                        setGraphMode("impact");
                        setDrawerOpen(true);
                        setRefocusOpen(false);
                      }
                    : null
                }
              />
            </div>

            {edgeDetails?.kind === "operational" && edgeDetails.entities?.length ? (
              <SurfaceDrawerSection title="Operational Context">
                <div className="gh-lineage-linked-list">
                  {edgeDetails.entities.map((entity) => (
                    <div className="gh-lineage-linked-row is-readonly" key={entity.key}>
                      <span>{entity.name}</span>
                      <span>{entity.entityLabel}</span>
                    </div>
                  ))}
                </div>
              </SurfaceDrawerSection>
            ) : null}

            {edgeDetails?.columnMappings?.length ? (
              <SurfaceDrawerSection title="Column Mappings">
                <div className="gh-lineage-linked-list">
                  {edgeDetails.columnMappings.map((mapping, index) => {
                    const isHighlighted = hoveredColumnIndex === index;
                    return (
                      <div
                        className={`gh-lineage-linked-row is-readonly gh-lineage-column-mapping ${isHighlighted ? "is-highlighted" : ""}`.trim()}
                        key={`${selectedEdge.id}-mapping-${index}`}
                        onMouseEnter={() => setHoveredColumnIndex(index)}
                        onMouseLeave={() => setHoveredColumnIndex(-1)}
                        title={`${mapping.sourceColumn} → ${mapping.targetColumn}`}
                      >
                        <span>{mapping.sourceColumn}</span>
                        <span aria-hidden="true" className="gh-lineage-column-mapping-arrow">→</span>
                        <span>{mapping.targetColumn}</span>
                      </div>
                    );
                  })}
                </div>
              </SurfaceDrawerSection>
            ) : null}

            <LineageEdgeSqlEvidence edge={selectedEdge} details={edgeDetails} />

            <SurfaceDrawerSection title="Edge Details">
              <div className="gh-attribute-list gh-lineage-edge-attributes">
                <div className="gh-attribute-row">
                  <span className="gh-attribute-label">Source</span>
                  <span className="gh-attribute-value">{selectedSource?.subtitle || selectedEdge.source}</span>
                </div>
                <div className="gh-attribute-row">
                  <span className="gh-attribute-label">Target</span>
                  <span className="gh-attribute-value">{selectedTarget?.subtitle || selectedEdge.target}</span>
                </div>
                <div className="gh-attribute-row">
                  <span className="gh-attribute-label">Relationship</span>
                  <span className="gh-attribute-value">{selectedEdge.data?.kind || "Lineage"}</span>
                </div>
              </div>
            </SurfaceDrawerSection>

            {activePathNodes.length ? (
              <SurfaceDrawerSection title="Path Nodes">
                <div className="gh-lineage-linked-list">
                  {activePathNodes.map((node) => (
                    <button
                      className="gh-lineage-linked-row is-node-link"
                      key={node.id}
                      onClick={() => {
                        setAllowDefaultSelection(false);
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId("");
                        setDrawerOpen(true);
                        setGraphMode("explore");
                      }}
                      type="button"
                    >
                      <span>{node.label}</span>
                      <span>{node.subtitle}</span>
                    </button>
                  ))}
                </div>
              </SurfaceDrawerSection>
            ) : null}

          </>
        ) : selectedNode ? (
          <LineageNodeDrawerBody
            node={selectedNode}
            tab={nodeDrawerTab}
            onTabChange={setNodeDrawerTab}
            neighbors={neighborBuckets}
            isRecordUnavailable={
              linkedRecordUnavailableOverrides?.[selectedNode?.assetFqn] === true
            }
            catalogUrl={databricksCatalogUrl(selectedNode.assetFqn, workspaceHost)}
            onOpenInCatalog={() => {
              // Defect 1: open the Unity Catalog explorer in a new tab
              // rather than routing through the in-app entity page.
              // `databricksCatalogUrl` returns "" when either the
              // workspace host or the three-part FQN is missing, which
              // already disables the button via the `catalogUrl` prop.
              const url = databricksCatalogUrl(selectedNode.assetFqn, workspaceHost);
              if (!url || typeof window === "undefined") return;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            onAddSteward={() => {
              if (selectedNode.assetFqn && onOpenGovernance) {
                onOpenGovernance(selectedNode.assetFqn);
              }
            }}
            onNeighborSelect={(neighbor) => {
              if (neighbor.assetFqn && onSelectAsset) {
                onSelectAsset(neighbor.assetFqn);
              } else {
                setAllowDefaultSelection(false);
                setSelectedNodeId(neighbor.id);
                setSelectedEdgeId("");
                setDrawerOpen(true);
                setGraphMode("explore");
              }
            }}
          />
        ) : (
          <div className="gh-empty-state">Select a node or edge to inspect the graph.</div>
        )}
      </SurfaceDrawer>
    </div>
  );
}

// A5.2 — collapsible "SQL evidence" section for the edge drawer. Renders
// whichever SQL-ish derivation field the backend populated for the edge —
// today the backend does not emit a SQL snippet (see govhub/services/
// lineage.py edge details), so most edges fall through to the muted
// placeholder. When the backend starts emitting sqlSnippet (or producerSql
// / derivation / viewDefinition as common aliases), the drawer will pick
// it up automatically.
export function LineageEdgeSqlEvidence({ edge, details }) {
  const snippet =
    edge?.data?.sqlSnippet ||
    edge?.data?.producerSql ||
    edge?.data?.derivation ||
    edge?.data?.viewDefinition ||
    details?.sqlSnippet ||
    details?.producerSql ||
    details?.derivation ||
    details?.viewDefinition ||
    "";
  const [open, setOpen] = useState(Boolean(snippet));
  const trimmed = typeof snippet === "string" ? snippet.trim() : "";

  return (
    <SurfaceDrawerSection
      title="SQL evidence"
      actions={
        <button
          aria-expanded={open}
          className="gh-tertiary-button gh-inline-link-button"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? "Hide" : "Show"}
        </button>
      }
    >
      {open ? (
        trimmed ? (
          <pre className="gh-lineage-sql-evidence" data-testid="lineage-sql-evidence">
            <code>{trimmed}</code>
          </pre>
        ) : (
          <div className="gh-support-copy gh-lineage-sql-evidence-empty">
            No SQL evidence recorded for this edge.
          </div>
        )
      ) : null}
    </SurfaceDrawerSection>
  );
}
