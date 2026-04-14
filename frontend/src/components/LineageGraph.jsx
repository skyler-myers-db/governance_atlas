import { useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { assetPathLabel } from "../lib/assetPresentation";

function nodeColor(kind) {
  if (kind === "View") return "#5b6af7";
  if (kind === "Notebook") return "#44b2ff";
  if (kind === "Pipeline") return "#8e67ff";
  return "#1d2a44";
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
  const base = node?.role === "focus" ? 260 : 220;
  return Math.max(base, Math.min(320, 168 + longest * 2.4));
}

function estimateNodeHeight(node) {
  const labelLines = Math.max(1, Math.ceil(String(node?.label || "").trim().length / 22));
  const subtitleLines = Math.max(1, Math.ceil(String(node?.subtitle || "").trim().length / 28));
  const footLines = Math.max(1, Math.ceil(((node?.foot || []).join(" • ").length || 0) / 24));
  return 72 + labelLines * 18 + subtitleLines * 16 + footLines * 12;
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
  const depthGapX = 320;
  const branchGapY = 60;
  const stackGapY = 20;
  const levelNudgeY = 18;

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

function NodeLabel({ data }) {
  return (
    <div className="gh-graph-node-card">
      <div className="gh-graph-node-kicker">{data.kicker || data.kind}</div>
      <div className="gh-graph-node-title">{data.label}</div>
      <div className="gh-graph-node-subtitle">{data.subtitle}</div>
      <div className="gh-graph-node-foot">
        <span
          className="gh-graph-kind-dot"
          style={{ backgroundColor: nodeColor(data.kind) }}
        />
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

  return (
    <BaseEdge
      id={id}
      interactionWidth={40}
      markerEnd={markerEnd}
      path={path}
      style={{
        stroke: selected ? "#3a2ce0" : "#4453db",
        strokeWidth: data?.depth === 1 ? (selected ? 5.2 : 4.2) : selected ? 4.4 : 3.6,
        opacity: selected ? 1 : 0.96,
      }}
    />
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
  focusActionLabel = "Set as focus",
  onOpenAsset,
  onOpenGovernance,
  onRefocus,
  onTraceUpstream,
  onShowImpact,
}) {
  const detail = nodeDetailRecord(node);
  const isOpenable = detail?.isOpenable !== false;
  const tags = [
    node?.kind,
    node?.role === "focus" ? "Focus" : node?.role === "source" ? "Upstream" : node?.role === "target" ? "Downstream" : "",
    detail?.governanceStatus,
    detail?.domain,
    detail?.tier,
    detail?.certification,
    detail?.sensitivity,
    !isOpenable ? "Lineage only" : "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
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
            <span className="gh-attribute-value">Lineage-only reference</span>
          </div>
        ) : null}
      </div>

      <div className="gh-lineage-record-actions">
        {node?.assetFqn && onOpenAsset ? (
          <button
            className="gh-secondary-button gh-secondary-button-compact"
            disabled={!isOpenable}
            onClick={() => onOpenAsset(node.assetFqn)}
            type="button"
          >
            Open Record
          </button>
        ) : null}
        {node?.assetFqn && onOpenGovernance ? (
          <button
            className="gh-secondary-button gh-secondary-button-compact"
            disabled={!isOpenable}
            onClick={() => onOpenGovernance(node.assetFqn)}
            type="button"
          >
            Open Governance
          </button>
        ) : null}
        {node?.assetFqn && onRefocus ? (
          <button
            className="gh-primary-button gh-secondary-button-compact"
            disabled={!isOpenable}
            onClick={() => onRefocus(node.assetFqn)}
            type="button"
          >
            {focusActionLabel}
          </button>
        ) : null}
        {onTraceUpstream ? (
          <button className="gh-secondary-button gh-secondary-button-compact" onClick={onTraceUpstream} type="button">
            Trace Upstream
          </button>
        ) : null}
        {onShowImpact ? (
          <button className="gh-secondary-button gh-secondary-button-compact" onClick={onShowImpact} type="button">
            Show Impact
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
  overlay = null,
  onAssetSearchQueryChange,
  onContextChange,
  onOpenAsset,
  onOpenGovernance,
  onSelectAsset,
}) {
  const nodeTypes = useMemo(() => ({ assetNode: AssetNode }), []);
  const edgeTypes = useMemo(() => ({ assetEdge: AssetEdge }), []);
  const transformed = useMemo(() => transformGraph(graph), [graph]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [graphMode, setGraphMode] = useState("explore");
  const [flowInstance, setFlowInstance] = useState(null);
  const [allowDefaultSelection, setAllowDefaultSelection] = useState(true);
  const [refocusOpen, setRefocusOpen] = useState(false);
  const refocusRootRef = useRef(null);
  const canvasRef = useRef(null);
  const lastAutoFitKeyRef = useRef("");

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

  const focusNode = transformed.nodes.find((node) => node.data.role === "focus")?.data || null;
  const defaultFocusNodeId = focusNode?.id || transformed.nodes[0]?.id || "";
  const graphHasEdges = hasEdges ?? transformed.edges.length > 0;

  useEffect(() => {
    setSelectedNodeId(defaultFocusNodeId);
    setSelectedEdgeId("");
    setDrawerOpen(false);
    setGraphMode("explore");
    setAllowDefaultSelection(true);
    setRefocusOpen(false);
    onAssetSearchQueryChange?.("");
  }, [asset?.fqn, defaultFocusNodeId]);

  useEffect(() => {
    setSelectedEdgeId("");
    setSelectedNodeId(defaultFocusNodeId);
    setDrawerOpen(false);
    setGraphMode("explore");
    setAllowDefaultSelection(true);
    setRefocusOpen(false);
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
  const showMiniMap = false;
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
                  type="button"
                >
                  Refocus
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
            {canReturnToFocus ? (
              <button
                className="gh-secondary-button"
                onClick={() => {
                  clearSelection({ keepDrawer: false, keepFocusNode: true });
                  setRefocusOpen(false);
                  setGraphMode("explore");
                  flowInstance?.fitView?.({ padding: 0.18 });
                }}
                type="button"
              >
                Return to focus
              </button>
            ) : null}
          </div>
        </div>
        <div className="gh-lineage-flow-shell">
          <ReactFlow
            edges={transformed.edges.map((edge) => ({
              ...edge,
              className: activeEdgeIds.includes(edge.id)
                ? "is-active"
                : hasActiveGraphSelection
                  ? "is-muted"
                  : "",
            }))}
            onInit={setFlowInstance}
            minZoom={0.3}
            nodes={transformed.nodes.map((node) => ({
              ...node,
              data: node.data,
              className: activeNodeIds.includes(node.id)
                ? "is-active"
                : hasActiveGraphSelection
                  ? "is-muted"
                  : "",
              type: "assetNode",
            }))}
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
          {overlay ? <div className="gh-lineage-overlay">{overlay}</div> : null}
        </div>
      </div>

      <aside className={`gh-lineage-drawer ${drawerOpen ? "is-open" : ""}`}>
        <div className="gh-lineage-drawer-head">
          <div className="gh-panel-title">{selectedEdge ? "Relationship details" : "Selected node"}</div>
          <button className="gh-secondary-button" onClick={() => closeDrawer()} type="button">
            Close drawer
          </button>
        </div>

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
              <div className="gh-detail-section">
                <div className="gh-panel-title">Operational context</div>
                <div className="gh-lineage-linked-list">
                  {edgeDetails.entities.map((entity) => (
                    <div className="gh-lineage-linked-row is-readonly" key={entity.key}>
                      <span>{entity.name}</span>
                      <span>{entity.entityLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {edgeDetails?.columnMappings?.length ? (
              <div className="gh-detail-section">
                <div className="gh-panel-title">Column mappings</div>
                <div className="gh-lineage-linked-list">
                  {edgeDetails.columnMappings.map((mapping, index) => (
                    <div className="gh-lineage-linked-row is-readonly" key={`${selectedEdge.id}-mapping-${index}`}>
                      <span>{mapping.sourceColumn}</span>
                      <span>{mapping.targetColumn}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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

            {activePathNodes.length ? (
              <div className="gh-detail-section">
                <div className="gh-panel-title">Path nodes</div>
                <div className="gh-lineage-linked-list">
                  {activePathNodes.map((node) => (
                    <button
                      className="gh-lineage-linked-row"
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
              </div>
            ) : null}

          </>
        ) : selectedNode ? (
          <>
            <LineageRecordCard
              title="Selected node"
              node={selectedNode}
              tone={selectedNode.role === "focus" ? "focus" : selectedNode.role || "neutral"}
              onOpenAsset={onOpenAsset}
              onOpenGovernance={onOpenGovernance}
            />
            <div className="gh-detail-section">
              <div className="gh-support-copy">
                {selectedNode.role === "focus"
                  ? "This asset anchors the current graph."
                  : selectedNode.role === "source"
                    ? "This node flows into the focused asset."
                    : "This node depends on the focused asset."}
              </div>
            </div>
            {neighborBuckets.upstream.length || neighborBuckets.downstream.length ? (
              <div className="gh-detail-section">
                <div className="gh-panel-title">Connected nodes</div>
                <div className="gh-lineage-linked-list">
                  {neighborBuckets.upstream.slice(0, 3).map((node) => (
                    <button
                      className="gh-lineage-linked-row"
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
                      className="gh-lineage-linked-row"
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
              </div>
            ) : null}
            {Array.isArray(selectedNode.details) && selectedNode.details.length ? (
              <div className="gh-detail-section">
                <div className="gh-panel-title">Entity details</div>
                <div className="gh-lineage-linked-list">
                  {selectedNode.details.map((item) => (
                    <div className="gh-lineage-linked-row is-readonly" key={item.key}>
                      <span>{item.name}</span>
                      <span>{item.entityLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedNode.assetFqn ? (
              <div className="gh-action-grid gh-lineage-drawer-actions">
                {selectedNode.role !== "focus" ? (
                  <button
                    className="gh-primary-button"
                    onClick={() => {
                      setAllowDefaultSelection(true);
                      onSelectAsset(selectedNode.assetFqn);
                    }}
                    type="button"
                  >
                    Set as focus
                  </button>
                ) : null}
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
                <button
                  className="gh-secondary-button"
                  onClick={() => {
                    flowInstance?.fitView?.({ padding: 0.18 });
                  }}
                  type="button"
                >
                  Center in graph
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="gh-empty-state">Select a node or edge to inspect the graph.</div>
        )}
      </aside>
    </div>
  );
}
