import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dagre from "dagre";
import {
  Background,
  Controls,
  // @ts-ignore @xyflow/react exports Handle as a runtime component and a legacy type alias.
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  useUpdateNodeInternals,
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

const NODE_WIDTH = 224;
const NODE_HEIGHT_COMPACT = 96;
const NODE_HEIGHT_TALL = 230;
const RANK_SEP = 86; // horizontal gap between dagre ranks (pixels)
const NODE_SEP = 16; // vertical gap between siblings in the same rank (pixels)
const EDGE_SEP = 14;

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
/**
 * @param {{ data: any }} props
 */
function LineageFlowNodeComponent({ data }) {
  return (
    <div className="ga-lineage-v2-flow-node">
      <Handle
        className="ga-lineage-v2-flow-handle"
        position={Position.Left}
        type="target"
      />
      <LineageNodeCard
        header={data.header}
        isDimmed={data.isDimmed}
        isFocus={data.isFocus}
        isHovered={data.isHovered}
        isSelected={data.isSelected}
        isTraced={data.isTraced}
        node={data.node}
        onClick={data.onSelect}
        onColumnSelect={data.onColumnSelect}
        selectedColumnName={data.selectedColumnName}
        variant={nodeIsTall(data.node) ? "tall" : "compact"}
      />
      <Handle
        className="ga-lineage-v2-flow-handle"
        position={Position.Right}
        type="source"
      />
    </div>
  );
}

const LineageFlowNode = memo(LineageFlowNodeComponent);

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
  nodeHeaders = new Map(),
  selectedNodeFqn = "",
  selectedColumn = null,
  onColumnSelect = null,
}) {
  const reactFlow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  // Accumulated graph: the merged superset of nodes/edges seen across
  // all lineage payloads received THIS focus session. Two regimes:
  //   • EXPAND: the new payload's focus node is already in the merged
  //     set (because the user clicked it from the canvas, which fired
  //     onFocusChange → URL change → refetch). Merge new neighbors in
  //     additively so the canvas extends outward — the seamless UX.
  //   • RESET: the new payload's focus node is NOT in the merged set
  //     (external navigation: the user typed a new URL, used the
  //     hero search, or routed in from another page). Discard the
  //     accumulated state and start fresh — the merged set from the
  //     previous focus is irrelevant to this asset and would just
  //     confuse the dagre layout (and previously left the canvas
  //     blank when the new focus had nothing in common with the old).
  const [accumulatedGraph, setAccumulatedGraph] = useState(() => ({
    nodes: graph.nodes,
    edges: graph.edges,
    nodeMap: new Map(graph.nodes.map((n) => [n.id, n])),
    edgeMap: new Map(graph.edges.map((e) => [e.id, e])),
  }));
  useEffect(() => {
    if (!graph.nodes.length && !graph.edges.length) return;
    setAccumulatedGraph((current) => {
      const incomingFocusId = graph.focus?.id || null;
      const incomingFocusFqn = graph.focus?.fqn || graph.focus?.assetFqn || "";
      const currentFqns = new Set(
        current.nodes
          .map((node) => node?.fqn || node?.assetFqn || "")
          .filter(Boolean),
      );
      // EXPAND vs RESET decision: we're expanding only when the new
      // focus is already part of the existing merged set (meaning the
      // user clicked through to it from a visible neighbor). Otherwise
      // this is external navigation — discard the previous session's
      // graph and rebuild from scratch.
      const isExpand =
        Boolean(
          incomingFocusId &&
            (
              current.nodeMap.has(incomingFocusId) ||
              (incomingFocusFqn && currentFqns.has(incomingFocusFqn))
            ),
        );
      const baseNodeMap = isExpand ? new Map(current.nodeMap) : new Map();
      const baseEdgeMap = isExpand ? new Map(current.edgeMap) : new Map();
      graph.nodes.forEach((node) => {
        if (!node?.id) return;
        baseNodeMap.set(node.id, node);
      });
      graph.edges.forEach((edge) => {
        if (!edge?.id) return;
        baseEdgeMap.set(edge.id, edge);
      });
      return {
        nodes: Array.from(baseNodeMap.values()),
        edges: Array.from(baseEdgeMap.values()),
        nodeMap: baseNodeMap,
        edgeMap: baseEdgeMap,
      };
    });
  }, [graph.nodes, graph.edges, graph.focus?.id]);

  // Render from the accumulated set so the canvas never blanks while a
  // refetch is in flight. The accumulated set always contains at least
  // the current graph after the effect above runs.
  const nodesArray = accumulatedGraph.nodes.length ? accumulatedGraph.nodes : graph.nodes;
  const edgesArray = accumulatedGraph.edges.length ? accumulatedGraph.edges : graph.edges;
  const useSticky = !graph.nodes.length && accumulatedGraph.nodes.length > 0;
  const adjacency = useMemo(() => buildAdjacency(edgesArray), [edgesArray]);
  const tracedNodeIds = useMemo(() => tracedSubgraph(adjacency, hoveredNodeId), [adjacency, hoveredNodeId]);

  const handleNodeClick = useCallback(
    (node) => {
      if (!node) return;
      // Permission-honest: refuse to "select" a lineage-only / unverified
      // reference. The card already disables hover state for those.
      if (node.isOpenable === false) return;
      // Click triggers the parent's selection handler — the parent
      // updates BOTH the rail subject AND the URL (so a fresh
      // /api/lineage/<fqn> fires in the background). When that payload
      // arrives the canvas MERGES new neighbors into the accumulated
      // graph (above) instead of replacing — so the user sees the
      // graph extend outward toward the clicked node, never blanks.
      if (node.fqn) onFocusChange?.(node.fqn);
    },
    [onFocusChange],
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
      const measuredHeight = nodeIsTall(node) ? NODE_HEIGHT_TALL : NODE_HEIGHT_COMPACT;
      const isFocus = node.isFocus;
      const isHovered = hoveredNodeId === node.id;
      const isTraced = !hoveredNodeId || tracedNodeIds.has(node.id);
      const isDimmed = false;
      // The clicked / actively-selected node — distinct from the URL focus.
      // The card renders an extra "selected" outline so the user can see
      // exactly which card the rail is currently describing, separate from
      // the deep "FOCUS" highlight on the URL-anchored node.
      const isSelected = Boolean(selectedNodeFqn) && node.fqn === selectedNodeFqn;
      // Look up the per-node header batch-fetched by useLineageNodeHeaders.
      // This is what carries the UC-grade size / freshness / type / owner
      // detail that the lineage system tables don't expose. May be undefined
      // until the header request resolves; the card renders its API-foot
      // strings as a fallback.
      const header = nodeHeaders?.get?.(node.fqn) || null;
      return {
        id: node.id,
        type: "lineage",
        position,
        width: NODE_WIDTH,
        height: measuredHeight,
        initialWidth: NODE_WIDTH,
        initialHeight: measuredHeight,
        style: {
          width: NODE_WIDTH,
          height: measuredHeight,
        },
        data: {
          node,
          header,
          isFocus,
          isHovered,
          isTraced,
          isDimmed,
          isSelected,
          selectedColumnName:
            selectedColumn?.assetFqn === node.fqn ? selectedColumn?.columnName || "" : "",
          onSelect: handleNodeClick,
          onColumnSelect,
        },
        // Disable React Flow's selection / drag — node identity is the
        // model, not a draggable artifact.
        selectable: false,
        draggable: false,
      };
    });
  }, [
    nodesArray,
    positions,
    hoveredNodeId,
    tracedNodeIds,
    handleNodeClick,
    nodeHeaders,
    selectedNodeFqn,
    selectedColumn?.assetFqn,
    selectedColumn?.columnName,
    onColumnSelect,
  ]);

  const focusReactFlowId = graph.focus?.id;
  // Pull edge colors from CSS custom properties so design-token updates
  // flow through automatically. Falls back to the Entrada bright-blue if
  // the variable isn't yet applied (SSR / first-paint).
  const cssVar = (name, fallback) =>
    (typeof document !== "undefined"
      && getComputedStyle(document.documentElement).getPropertyValue(name).trim())
    || fallback;
  const focusEdgeColor = cssVar("--ga-bright-blue", "#66c5ff");
  const idleEdgeColor = "rgba(178, 189, 194, 0.55)";
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
        markerEnd: { type: MarkerType.ArrowClosed, color: isFocusEdge ? focusEdgeColor : idleEdgeColor },
        style: {
          stroke: isFocusEdge ? focusEdgeColor : `rgba(102, 197, 255, 0.45)`,
          strokeWidth: isFocusEdge ? 1.6 : 1.1,
          opacity: isTraced ? (isFocusEdge ? 1 : 0.6) : 0.18,
          transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        },
        data: { isRestricted: edge.isRestricted },
        className: edge.isRestricted ? "ga-lineage-v2-edge-restricted" : undefined,
      };
    });
  }, [edgesArray, focusReactFlowId, hoveredNodeId, tracedNodeIds, focusEdgeColor]);

  // Header hydration changes node card content after React Flow's initial
  // measurements. Refresh node internals so invisible handles keep valid
  // bounds and edge paths do not disappear after the UC detail footers load.
  useEffect(() => {
    if (!flowNodes.length) return undefined;
    let disposed = false;
    const frames = [];
    const refresh = () => {
      if (disposed) return;
      flowNodes.forEach((node) => updateNodeInternals(node.id));
    };
    const schedule = (callback) => {
      const frame = window.requestAnimationFrame(callback);
      frames.push(frame);
    };
    schedule(refresh);
    schedule(() => schedule(refresh));
    return () => {
      disposed = true;
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
    };
  }, [flowNodes, updateNodeInternals]);

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
        maxZoom={2.25}
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

export function LineageCanvasV2({
  graph,
  hydrating,
  error,
  focusId,
  onFocusChange,
  nodeHeaders = new Map(),
  selectedNodeFqn = "",
  selectedColumn = null,
  onColumnSelect = null,
}) {
  // ReactFlowProvider is mounted at the application root in main.jsx, so we
  // don't need to wrap the canvas here. CanvasInner consumes the provider
  // via useReactFlow().
  return (
    <CanvasInner
      error={error}
      focusId={focusId}
      graph={graph}
      hydrating={hydrating}
      nodeHeaders={nodeHeaders}
      onFocusChange={onFocusChange}
      onColumnSelect={onColumnSelect}
      selectedColumn={selectedColumn}
      selectedNodeFqn={selectedNodeFqn}
    />
  );
}

export default LineageCanvasV2;
