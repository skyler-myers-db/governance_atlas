import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dagre from "dagre";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LineageNodeCard } from "./LineageNodeCard";

/**
 * LineageCanvasV2 — design-faithful lineage canvas built on React Flow.
 *
 * Layout is dagre-driven (Sugiyama / layered DAG) with rankdir = LR so
 * upstream nodes always sit to the LEFT of focus and downstream nodes
 * always sit to the RIGHT. Multi-parent / multi-child topologies route
 * cleanly without overlapping siblings. Ranks are stable across re-anchors
 * because dagre considers the entire returned graph and assigns each
 * node a deterministic rank from edge structure.
 *
 * Interaction:
 *   wheel = zoom only (React Flow handles the preventDefault for us)
 *   drag = pan (React Flow built-in)
 *   click node card = re-anchor focus (calls onFocusChange)
 *   hover node card = trace the connected subgraph
 *
 * The toolbar is docked top-right inside the canvas (React Flow's <Controls>
 * gives us the +/-/fit set) so it can never end up floating outside the
 * graph viewport like the legacy `.ga-lineage-canvas-tools` did.
 */

const NODE_WIDTH = 240;
const NODE_HEIGHT_COMPACT = 96;
const NODE_HEIGHT_TALL = 230;
const RANK_SEP = 110; // horizontal gap between dagre ranks (pixels)
const NODE_SEP = 22; // vertical gap between siblings in the same rank (pixels)
const EDGE_SEP = 18;

// ---------------------------------------------------------------------------
// Dagre layout: feed the entire (nodes, edges) set into a directed graph
// with rankdir = LR (left-to-right). Dagre handles multi-parent + multi-child
// topologies by assigning each node a stable rank based on longest path and
// minimizing edge crossings. The resulting positions are absolute pixel
// coords we hand straight to React Flow.
// ---------------------------------------------------------------------------
function computeDagreLayout(nodes, edges) {
  if (!nodes.length) return new Map();
  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    edgesep: EDGE_SEP,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: nodeIsTall(node) ? NODE_HEIGHT_TALL : NODE_HEIGHT_COMPACT,
    });
  });

  edges.forEach((edge) => {
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) return;
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const positions = new Map();
  nodes.forEach((node) => {
    const layoutNode = g.node(node.id);
    if (!layoutNode) return;
    // dagre returns center positions; React Flow expects top-left.
    positions.set(node.id, {
      x: layoutNode.x - NODE_WIDTH / 2,
      y: layoutNode.y - (nodeIsTall(node) ? NODE_HEIGHT_TALL : NODE_HEIGHT_COMPACT) / 2,
    });
  });
  return positions;
}

function nodeIsTall(node) {
  return Boolean(node?.columns?.length);
}

// ---------------------------------------------------------------------------
// React Flow node component — wraps LineageNodeCard with React Flow's
// connection handles. Both sides of the card have a handle so edges can
// enter from the left and exit on the right.
// ---------------------------------------------------------------------------
const LineageFlowNode = memo(function LineageFlowNode({ data }) {
  return (
    <div className="ga-lineage-v2-flow-node">
      <Handle
        className="ga-lineage-v2-flow-handle"
        position={Position.Left}
        type="target"
      />
      <LineageNodeCard
        isDimmed={data.isDimmed}
        isFocus={data.isFocus}
        isHovered={data.isHovered}
        isTraced={data.isTraced}
        node={data.node}
        onClick={data.onSelect}
        variant={nodeIsTall(data.node) ? "tall" : "compact"}
      />
      <Handle
        className="ga-lineage-v2-flow-handle"
        position={Position.Right}
        type="source"
      />
    </div>
  );
});

const NODE_TYPES = { lineage: LineageFlowNode };

function buildAdjacency(edges) {
  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });
  return adjacency;
}

function tracedSubgraph(adjacency, seedId) {
  if (!seedId || !adjacency.has(seedId)) return new Set();
  const visited = new Set([seedId]);
  const queue = [seedId];
  while (queue.length) {
    const next = queue.shift();
    (adjacency.get(next) || []).forEach((id) => {
      if (visited.has(id)) return;
      visited.add(id);
      queue.push(id);
    });
  }
  return visited;
}

function CanvasInner({
  graph,
  hydrating,
  error,
  onFocusChange,
  focusId,
}) {
  const reactFlow = useReactFlow();
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  // Retain the previously rendered nodes/edges across focus switches so
  // the canvas doesn't blank-flash while the new query is in flight. The
  // moment the new graph arrives with nodes, we adopt it; until then we
  // continue rendering the prior topology with a subtle "Switching focus"
  // banner instead of the full hydrating state.
  const [stickyGraph, setStickyGraph] = useState({ nodes: graph.nodes, edges: graph.edges });
  useEffect(() => {
    if (graph.nodes.length) {
      setStickyGraph({ nodes: graph.nodes, edges: graph.edges });
    }
  }, [graph.nodes, graph.edges]);

  const useSticky = !graph.nodes.length && stickyGraph.nodes.length > 0;
  const nodesArray = useSticky ? stickyGraph.nodes : graph.nodes;
  const edgesArray = useSticky ? stickyGraph.edges : graph.edges;
  const adjacency = useMemo(() => buildAdjacency(edgesArray), [edgesArray]);
  const tracedNodeIds = useMemo(() => tracedSubgraph(adjacency, hoveredNodeId), [adjacency, hoveredNodeId]);

  const handleNodeClick = useCallback(
    (node) => {
      if (!node) return;
      // Permission-honest: refuse to navigate to lineage-only / unverified
      // references (the card already disables hover state for them, but a
      // double-check here makes the parent contract clear).
      if (node.isOpenable === false) return;
      if (node.fqn && node.fqn !== focusId) onFocusChange?.(node.fqn);
    },
    [focusId, onFocusChange],
  );

  const positions = useMemo(
    () => computeDagreLayout(nodesArray, edgesArray),
    [nodesArray, edgesArray],
  );

  // React Flow expects { id, position, data, type } for nodes and
  // { id, source, target, type } for edges. We wrap the node id in
  // a stable object so we can pass tracing flags into LineageFlowNode
  // through `data` without the parent re-mounting React Flow.
  const flowNodes = useMemo(() => {
    return nodesArray.map((node) => {
      const position = positions.get(node.id) || { x: 0, y: 0 };
      const isFocus = node.isFocus;
      const isHovered = hoveredNodeId === node.id;
      const isTraced = !hoveredNodeId || tracedNodeIds.has(node.id);
      const isDimmed = false;
      return {
        id: node.id,
        type: "lineage",
        position,
        data: {
          node,
          isFocus,
          isHovered,
          isTraced,
          isDimmed,
          onSelect: handleNodeClick,
        },
        // Disable React Flow's selection / drag — node identity is the
        // model, not a draggable artifact.
        selectable: false,
        draggable: false,
      };
    });
  }, [nodesArray, positions, hoveredNodeId, tracedNodeIds, handleNodeClick]);

  const focusReactFlowId = graph.focus?.id;
  const flowEdges = useMemo(() => {
    return edgesArray.map((edge) => {
      const isFocusEdge = focusReactFlowId
        ? edge.source === focusReactFlowId || edge.target === focusReactFlowId
        : false;
      const isTraced = !hoveredNodeId
        || (tracedNodeIds.has(edge.source) && tracedNodeIds.has(edge.target));
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        animated: isFocusEdge,
        markerEnd: { type: MarkerType.ArrowClosed, color: isFocusEdge ? "#66c5ff" : "rgba(178, 189, 194, 0.55)" },
        style: {
          stroke: isFocusEdge ? "#66c5ff" : "rgba(102, 197, 255, 0.45)",
          strokeWidth: isFocusEdge ? 1.6 : 1.1,
          opacity: isTraced ? (isFocusEdge ? 1 : 0.6) : 0.18,
          transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        },
        data: { isRestricted: edge.isRestricted },
        className: edge.isRestricted ? "ga-lineage-v2-edge-restricted" : undefined,
      };
    });
  }, [edgesArray, focusReactFlowId, hoveredNodeId, tracedNodeIds]);

  // After the graph changes, fit the new node set into view exactly once.
  useEffect(() => {
    if (!flowNodes.length) return;
    const handle = window.requestAnimationFrame(() => {
      try {
        reactFlow.fitView({ padding: 0.2, includeHiddenNodes: false, duration: 240 });
      } catch (_) {
        // React Flow not ready yet — ignore silently
      }
    });
    return () => window.cancelAnimationFrame(handle);
  }, [reactFlow, flowNodes.length, focusId]);

  const handlePaneNodeMouseEnter = useCallback(
    (_event, node) => setHoveredNodeId(node?.id || ""),
    [],
  );
  const handlePaneNodeMouseLeave = useCallback(() => setHoveredNodeId(""), []);

  if (error) {
    return (
      <div className="ga-lineage-v2-canvas-state ga-lineage-v2-canvas-state-error">
        <strong>Lineage unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!nodesArray.length && hydrating) {
    return (
      <div className="ga-lineage-v2-canvas-state ga-lineage-v2-canvas-state-hydrating">
        <span aria-hidden="true" className="ga-lineage-v2-canvas-spinner" />
        <strong>Hydrating lineage from Unity Catalog</strong>
        <span>Walking system.access.table_lineage outward from the focus asset…</span>
      </div>
    );
  }

  if (!nodesArray.length) {
    return (
      <div className="ga-lineage-v2-canvas-state">
        <strong>No lineage edges returned</strong>
        <span>Unity Catalog hasn't reported any actor-visible upstream or downstream edges for this asset.</span>
      </div>
    );
  }

  return (
    <div className="ga-lineage-v2-canvas">
      {hydrating || useSticky ? (
        <div className="ga-lineage-v2-canvas-banner" role="status">
          <span aria-hidden="true" className="ga-lineage-v2-canvas-spinner" />
          {useSticky ? "Switching focus…" : "Hydrating from Unity Catalog…"}
        </div>
      ) : null}
      <ReactFlow
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        maxZoom={1.4}
        minZoom={0.5}
        nodes={flowNodes}
        nodeTypes={NODE_TYPES}
        nodesConnectable={false}
        nodesDraggable={false}
        onlyRenderVisibleElements={false}
        onNodeMouseEnter={handlePaneNodeMouseEnter}
        onNodeMouseLeave={handlePaneNodeMouseLeave}
        panOnDrag
        proOptions={{ hideAttribution: true }}
        zoomOnScroll
        preventScrolling={true}
      >
        <Background color="rgba(61, 132, 173, 0.18)" gap={24} size={1} />
        <Controls position="top-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function LineageCanvasV2({ graph, hydrating, error, focusId, onFocusChange }) {
  // ReactFlowProvider is mounted at the application root in main.jsx, so we
  // don't need to wrap the canvas here. CanvasInner consumes the provider
  // via useReactFlow().
  return (
    <CanvasInner
      error={error}
      focusId={focusId}
      graph={graph}
      hydrating={hydrating}
      onFocusChange={onFocusChange}
    />
  );
}

export default LineageCanvasV2;
