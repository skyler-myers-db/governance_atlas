// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { assetPathLabel } from "../lib/assetPresentation";
import { upsertGovernanceOwner } from "../lib/api";
import { exportLineagePng } from "../lib/exportLineagePng";
import { SurfaceDrawer, SurfaceDrawerSection } from "./ShellLayoutPrimitives";
import { AssetTypeIcon } from "./primitives/AssetTypeIcon";

function nodeColor(kind) {
  if (kind === "View") return "#5b6af7";
  if (kind === "Notebook") return "#44b2ff";
  if (kind === "Pipeline") return "#8e67ff";
  return "#1d2a44";
}

function edgeKindFor(data) {
  const raw = String(data?.edgeKind || data?.kind || "").trim().toLowerCase();
  if (raw.includes("stream") || raw.includes("kafka") || raw.includes("kinesis")) return "streaming";
  if (raw.includes("pipeline") || raw.includes("job") || raw.includes("workflow")) return "operational";
  if (raw.includes("schema") || raw.includes("ddl")) return "schema";
  return "data";
}

function edgeStroke({ selected, data }) {
  if (selected) return "#3a2ce0";
  const kind = edgeKindFor(data);
  if (kind === "streaming") return "#0891b2";
  if (kind === "operational") return "#a21caf";
  if (kind === "schema") return "#b45309";
  return "#4453db";
}

function edgeDashArray(data) {
  const kind = edgeKindFor(data);
  if (kind === "streaming") return "6 4";
  if (kind === "schema") return "2 3";
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
  const base = node?.role === "focus" ? 316 : 252;
  return Math.max(base, Math.min(408, 196 + longest * 3.05));
}

function estimateNodeHeight(node) {
  const labelLines = Math.max(1, Math.ceil(String(node?.label || "").trim().length / 22));
  const subtitleLines = Math.max(1, Math.ceil(String(node?.subtitle || "").trim().length / 28));
  const footLines = Math.max(1, Math.ceil(((node?.foot || []).join(" • ").length || 0) / 24));
  return 82 + labelLines * 19 + subtitleLines * 17 + footLines * 13;
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
  const depthGapX = 388;
  const branchGapY = 84;
  const stackGapY = 30;
  const levelNudgeY = 22;

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
        borderRadius: 14,
        border:
          node.role === "focus"
            ? "2px solid #5b43ee"
            : node.layout?.side === "upstream"
              ? "1px solid rgba(84, 117, 255, 0.35)"
              : node.layout?.side === "downstream"
                ? "1px solid rgba(126, 79, 238, 0.35)"
                : "1px solid #c9d6ee",
        borderLeftWidth: node.layout?.side === "upstream" ? 4 : 1,
        borderRightWidth: node.layout?.side === "downstream" ? 4 : 1,
        background:
          node.role === "focus"
            ? "linear-gradient(180deg, #ffffff 0%, #f7f5ff 100%)"
            : node.layout?.side === "upstream"
              ? "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)"
              : node.layout?.side === "downstream"
                ? "linear-gradient(180deg, #ffffff 0%, #fbf8ff 100%)"
                : "#ffffff",
        boxShadow:
          node.role === "focus"
            ? "0 14px 24px rgba(74,95,206,0.10)"
            : "0 1px 2px rgba(19,31,65,0.03)",
        padding: 8,
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
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: "#3f34d8",
      },
      style: {
        stroke: "#4453db",
        strokeWidth: edge.depth === 1 ? 4.1 : 3.5,
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

function nodeDetailBadges(data) {
  const detail = Array.isArray(data?.details) ? data.details[0] || {} : data?.details || {};
  const badges = [];
  const push = (tone, label, title = "") => {
    const clean = String(label || "").trim();
    if (!clean || clean.toLowerCase() === "unassigned" || clean === "—") return;
    badges.push({ tone, label: clean, title: title || clean });
  };
  push("gov", detail.governanceStatus, `Governance status: ${detail.governanceStatus}`);
  push("cert", detail.certification, `Certification: ${detail.certification}`);
  if (detail.sensitivity && /pii|phi|sensitive|restricted/i.test(detail.sensitivity)) {
    push("pii", detail.sensitivity, `Sensitivity classification: ${detail.sensitivity}`);
  }
  push("domain", detail.domain, `Domain: ${detail.domain}`);
  push("tier", detail.tier, `Tier: ${detail.tier}`);
  return badges.slice(0, 3);
}

function NodeLabel({ data }) {
  const branchToggleVisible =
    typeof data?.onToggleBranchCollapse === "function" && Number(data?.branchDescendantCount || 0) > 0;
  const iconSize = data.role === "focus" ? "lg" : "md";
  const badges = nodeDetailBadges(data);

  return (
    <div className="gh-graph-node-card">
      <div className="gh-graph-node-head">
        <AssetTypeIcon type={data.kind} size={iconSize} className="gh-graph-node-icon" />
        <div className="gh-graph-node-head-copy">
          <div className="gh-graph-node-kicker">{data.kicker || data.kind}</div>
          <div className="gh-graph-node-title">{data.label}</div>
        </div>
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
      <div className="gh-graph-node-subtitle">{data.subtitle}</div>
      {badges.length ? (
        <div className="gh-graph-node-badges">
          {badges.map((badge, index) => (
            <span
              className={`gh-graph-node-badge tone-${badge.tone}`}
              key={`${data.id}-badge-${index}`}
              title={badge.title}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="gh-graph-node-foot">
        <span>{data.kind}</span>
        {data.layout?.side ? <span className="gh-graph-node-pill">{data.layout.side}</span> : null}
        {typeof data.layout?.depth === "number" && data.layout.depth > 0 ? (
          <span className="gh-graph-node-pill">{`d${data.layout.depth}`}</span>
        ) : null}
      </div>
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
          strokeWidth: data?.depth === 1 ? (selected ? 5.2 : 4.2) : selected ? 4.4 : 3.6,
          opacity: selected ? 1 : 0.96,
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
  onAssetSearchQueryChange,
  onContextChange,
  onOpenAsset,
  onOpenGovernance,
  onSelectAsset,
  userEmail = "",
}) {
  const nodeTypes = useMemo(() => ({ assetNode: AssetNode }), []);
  const edgeTypes = useMemo(() => ({ assetEdge: AssetEdge }), []);
  const transformedBase = useMemo(() => transformGraph(graph), [graph]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [quickGovernanceBusy, setQuickGovernanceBusy] = useState("");
  const [quickGovernanceStatus, setQuickGovernanceStatus] = useState({ fqn: "", message: "" });
  const refocusRootRef = useRef(null);
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const lastAutoFitKeyRef = useRef("");

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

  const transformed = useMemo(() => {
    const visibleNodeIds = new Set(
      transformedBase.nodes
        .filter((node) => {
          const branchRootId = node.data?.layout?.branchRoot;
          if (!branchRootId || branchRootId === defaultFocusNodeId) return true;
          if (!collapsedBranches[branchRootId]) return true;
          return node.id === branchRootId;
        })
        .filter((node) => {
          // Hide excluded kinds unless they are the focus — never hide
          // the asset the user is focused on, even if its kind is
          // filtered out.
          if (node.data?.role === "focus") return true;
          const kind = String(node.data?.kind || "").trim();
          if (excludedKinds.has(kind)) return false;
          const depth = Number(node.data?.layout?.depth || 0);
          if (depth > maxVisibleDepth) return false;
          return true;
        })
        .map((node) => node.id),
    );

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
  }, [branchMetadata, collapsedBranches, defaultFocusNodeId, transformedBase.edges, transformedBase.nodes]);

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
    setDrawerOpen(false);
    setGraphMode("explore");
    setAllowDefaultSelection(true);
    setRefocusOpen(false);
    setCollapsedBranches({});
    onAssetSearchQueryChange?.("");
  }, [asset?.fqn, defaultFocusNodeId]);

  useEffect(() => {
    setSelectedEdgeId("");
    setSelectedNodeId(defaultFocusNodeId);
    setDrawerOpen(false);
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
  const showMiniMap = (transformed?.nodes?.length || 0) >= 2;
  const showControls = true;
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
  const drawerTitle = selectedEdge ? "Relationship Details" : "Selected Node";

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
    lastAutoFitKeyRef.current = autoFitKey;
    const frame = requestAnimationFrame(() => {
      flowInstance.fitView?.({ padding: 0.24, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFitKey, flowInstance, transformed.nodes.length]);

  useEffect(() => {
    if (!flowInstance || !transformed.nodes.length) return undefined;
    const frame = requestAnimationFrame(() => {
      flowInstance.fitView?.({ padding: drawerOpen ? 0.18 : 0.22, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [drawerOpen, flowInstance, transformed.nodes.length]);

  useEffect(() => {
    if (!flowInstance || !viewportRef.current || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        flowInstance.fitView?.({ padding: drawerOpen ? 0.18 : 0.22, duration: 140 });
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
            <button
              className="gh-secondary-button"
              onClick={() => {
                flowInstance?.fitView?.({ padding: 0.18 });
              }}
              type="button"
            >
              Reset view
            </button>
            <button
              className="gh-secondary-button"
              onClick={async () => {
                try {
                  await exportLineagePng(viewportRef.current, asset?.fqn);
                } catch (err) {
                  // Silent — PNG export is best-effort; keep the graph usable.
                  console.error("lineage PNG export failed", err);
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
            </div>
          ) : null}
        </div>
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
                setAllowDefaultSelection(false);
                setSelectedEdgeId(edge.id);
                setSelectedNodeId("");
                setDrawerOpen(true);
                setRefocusOpen(false);
                setGraphMode("path");
              }}
              onNodeClick={(_, node) => {
                setAllowDefaultSelection(false);
                setSelectedNodeId(node.id);
                setSelectedEdgeId("");
                setDrawerOpen(true);
                setRefocusOpen(false);
                setGraphMode("explore");
              }}
              onPaneClick={() => {
                if (refocusOpen) setRefocusOpen(false);
                if (drawerOpen) setDrawerOpen(false);
              }}
              nodesDraggable={false}
              nodesConnectable={false}
              selectionOnDrag={false}
              zoomOnDoubleClick={false}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: "assetEdge" }}
            >
              {showMiniMap ? <MiniMap pannable zoomable maskColor="rgba(16, 24, 40, 0.06)" nodeColor="#d7dff4" /> : null}
              {showControls ? <Controls showInteractive={false} /> : null}
              <Background color="#d9e2ff" gap={22} />
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
          </div>
        </div>
      </div>

      <SurfaceDrawer
        actions={
          <button className="gh-secondary-button" onClick={() => closeDrawer()} type="button">
            Close drawer
          </button>
        }
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
          <>
            <LineageRecordCard
              title="Selected Node"
              node={selectedNode}
              tone={selectedNode.role === "focus" ? "focus" : selectedNode.role || "neutral"}
              availabilityOverride={linkedRecordUnavailableOverrides?.[selectedNode?.assetFqn] === true ? false : null}
              onOpenAsset={onOpenAsset}
              onOpenGovernance={onOpenGovernance}
              includeFocusAction={false}
              includeTraceActions={false}
            />
            <SurfaceDrawerSection>
              <div className="gh-support-copy">
                {selectedNode.role === "focus"
                  ? "This asset anchors the current lineage view."
                  : selectedNode.role === "source"
                    ? "This node flows into the current focus."
                    : "This node depends on the current focus."}
              </div>
            </SurfaceDrawerSection>
            {selectedNode.assetFqn && userEmail ? (
              <SurfaceDrawerSection title="Quick Governance">
                <div className="gh-support-copy">
                  Take governance action on <strong>{selectedNode.label}</strong> without
                  leaving the lineage graph.
                </div>
                <div className="gh-action-grid gh-lineage-drawer-actions">
                  <button
                    className="gh-secondary-button"
                    disabled={quickGovernanceBusy === selectedNode.assetFqn}
                    onClick={async () => {
                      if (!selectedNode.assetFqn || !userEmail) return;
                      setQuickGovernanceStatus({ fqn: selectedNode.assetFqn, message: "" });
                      setQuickGovernanceBusy(selectedNode.assetFqn);
                      try {
                        await upsertGovernanceOwner({
                          assetFqn: selectedNode.assetFqn,
                          ownerEmail: userEmail,
                          ownerType: "business",
                        });
                        setQuickGovernanceStatus({
                          fqn: selectedNode.assetFqn,
                          message: `Assigned ${userEmail} as business owner of this asset.`,
                        });
                      } catch (err) {
                        setQuickGovernanceStatus({
                          fqn: selectedNode.assetFqn,
                          message:
                            err?.message?.includes("403")
                              ? "Your workspace role does not allow governance writes."
                              : "Owner assignment failed. Check the governance store, then retry.",
                        });
                      } finally {
                        setQuickGovernanceBusy("");
                      }
                    }}
                    title="Claim ownership of this asset as the currently signed-in user"
                    type="button"
                  >
                    {quickGovernanceBusy === selectedNode.assetFqn
                      ? "Saving…"
                      : "Assign me as owner"}
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(selectedNode.assetFqn);
                        setQuickGovernanceStatus({
                          fqn: selectedNode.assetFqn,
                          message: `Copied ${selectedNode.assetFqn} to clipboard.`,
                        });
                      } catch {
                        window.prompt("Copy asset FQN", selectedNode.assetFqn);
                      }
                    }}
                    title="Copy the fully-qualified asset name to paste into another tool"
                    type="button"
                  >
                    Copy FQN
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={async () => {
                      try {
                        const url = new URL(window.location.href);
                        url.pathname = `/lineage/${selectedNode.assetFqn}`;
                        url.search = "";
                        await navigator.clipboard.writeText(url.toString());
                        setQuickGovernanceStatus({
                          fqn: selectedNode.assetFqn,
                          message: "Deep link copied. Paste to re-root on this node.",
                        });
                      } catch {
                        // Silently ignore — not worth blocking the UI
                      }
                    }}
                    title="Copy a lineage link that opens the graph rooted on this node"
                    type="button"
                  >
                    Copy deep link
                  </button>
                </div>
                {quickGovernanceStatus.fqn === selectedNode.assetFqn
                  && quickGovernanceStatus.message ? (
                  <div className="gh-support-copy gh-success-copy">
                    {quickGovernanceStatus.message}
                  </div>
                ) : null}
              </SurfaceDrawerSection>
            ) : null}
            {neighborBuckets.upstream.length || neighborBuckets.downstream.length ? (
              <SurfaceDrawerSection title="Connected Nodes">
                <div className="gh-lineage-linked-list">
                  {neighborBuckets.upstream.slice(0, 3).map((node) => (
                    <button
                      className="gh-lineage-linked-row is-node-link"
                      key={`up-${node.id}`}
                      onClick={() => {
                        setAllowDefaultSelection(false);
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId("");
                        setDrawerOpen(true);
                        setGraphMode("explore");
                      }}
                      type="button"
                    >
                      <span>↑ {node.label}</span>
                      <span>{node.subtitle}</span>
                    </button>
                  ))}
                  {neighborBuckets.downstream.slice(0, 3).map((node) => (
                    <button
                      className="gh-lineage-linked-row is-node-link"
                      key={`down-${node.id}`}
                      onClick={() => {
                        setAllowDefaultSelection(false);
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId("");
                        setDrawerOpen(true);
                        setGraphMode("explore");
                      }}
                      type="button"
                    >
                      <span>↓ {node.label}</span>
                      <span>{node.subtitle}</span>
                    </button>
                  ))}
                </div>
              </SurfaceDrawerSection>
            ) : null}
            {Array.isArray(selectedNode.details) && selectedNode.details.length ? (
              <SurfaceDrawerSection title="Entity Details">
                <div className="gh-lineage-linked-list">
                  {selectedNode.details.map((item) => (
                    <div className="gh-lineage-linked-row is-readonly" key={item.key}>
                      <span>{item.name}</span>
                      <span>{item.entityLabel}</span>
                    </div>
                  ))}
                </div>
              </SurfaceDrawerSection>
            ) : null}
            {selectedNode.assetFqn ? (
              <SurfaceDrawerSection title="Graph Actions">
                <div className="gh-action-grid gh-lineage-drawer-actions">
                  {/* "Set as Focus" lives in the record card above — do not
                      re-render it here. The Graph Actions panel is now
                      exclusively about how the selected node relates to the
                      visible graph (path tracing, branch collapse, centering),
                      not how to open its metadata. */}
                  {selectedNode.role !== "focus" ? (
                    <button
                      className="gh-secondary-button"
                      onClick={() => {
                        setGraphMode("path");
                        setDrawerOpen(true);
                      }}
                      type="button"
                    >
                      Trace to Focus
                    </button>
                  ) : null}
                  {selectedNode.branchDescendantCount ? (
                    <button
                      className="gh-secondary-button"
                      onClick={() => {
                        selectedNode.onToggleBranchCollapse?.();
                      }}
                      type="button"
                    >
                      {selectedNode.branchCollapsed ? "Expand Branch" : "Collapse Branch"}
                    </button>
                  ) : null}
                  <button
                    className="gh-secondary-button"
                    onClick={() => {
                      const node = flowInstance?.getNode?.(selectedNode.id);
                      if (node?.position) {
                        const width = node.width || node.measured?.width || 220;
                        const height = node.height || node.measured?.height || 120;
                        flowInstance?.setCenter?.(
                          node.position.x + width / 2,
                          node.position.y + height / 2,
                          { zoom: 1.1, duration: 240 },
                        );
                      } else {
                        flowInstance?.fitView?.({ padding: 0.2, duration: 240 });
                      }
                    }}
                    type="button"
                  >
                    Center in Graph
                  </button>
                </div>
              </SurfaceDrawerSection>
            ) : null}
          </>
        ) : (
          <div className="gh-empty-state">Select a node or edge to inspect the graph.</div>
        )}
      </SurfaceDrawer>
    </div>
  );
}
