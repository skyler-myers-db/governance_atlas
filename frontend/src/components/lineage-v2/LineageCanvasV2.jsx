import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
 * Replaces the legacy band-based NorthStarLineageExplorer for the v2 surface.
 * Layout is BFS-from-focus column distance (NOT medallion / NOT fixed
 * 5-band slots), so the canvas adapts cleanly to graphs of any depth and
 * any branching factor. Each column's width is derived from its node count
 * and longest label so dense fan-in/fan-out gets breathing room while
 * sparse columns stay tight.
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

const NODE_COLUMN_GAP = 280; // horizontal pixel gap between BFS hop columns
const NODE_ROW_GAP = 36; // vertical gap between sibling nodes in the same column
const NODE_HEIGHT_COMPACT = 96;
const NODE_HEIGHT_TALL = 230;

// ---------------------------------------------------------------------------
// BFS layout: assign each node a column = signed hop distance from focus,
// then position siblings within each column. The y position centers
// vertically per column. Nodes that aren't reachable from focus (orphans
// in the returned graph) get column=0 and are stacked next to focus —
// rare in practice because the API constructs the graph by walking
// outward from focus, but kept honest for safety.
// ---------------------------------------------------------------------------
function computeBfsLayout(nodes, edges, focusId) {
  if (!nodes.length) return { positions: new Map(), columns: new Map() };
  const adjacencyOut = new Map();
  const adjacencyIn = new Map();
  edges.forEach((edge) => {
    if (!adjacencyOut.has(edge.source)) adjacencyOut.set(edge.source, []);
    if (!adjacencyIn.has(edge.target)) adjacencyIn.set(edge.target, []);
    adjacencyOut.get(edge.source).push(edge.target);
    adjacencyIn.get(edge.target).push(edge.source);
  });
  const hop = new Map();
  if (focusId) hop.set(focusId, 0);
  // Walk upstream (negative hops)
  let frontier = focusId ? [focusId] : [];
  while (frontier.length) {
    const next = [];
    frontier.forEach((id) => {
      (adjacencyIn.get(id) || []).forEach((parent) => {
        if (!hop.has(parent)) {
          hop.set(parent, hop.get(id) - 1);
          next.push(parent);
        }
      });
    });
    frontier = next;
  }
  // Walk downstream (positive hops)
  frontier = focusId ? [focusId] : [];
  while (frontier.length) {
    const next = [];
    frontier.forEach((id) => {
      (adjacencyOut.get(id) || []).forEach((child) => {
        if (!hop.has(child)) {
          hop.set(child, hop.get(id) + 1);
          next.push(child);
        }
      });
    });
    frontier = next;
  }
  // Orphans
  nodes.forEach((node) => {
    if (!hop.has(node.id)) hop.set(node.id, 0);
  });

  // Group by column
  const columns = new Map();
  nodes.forEach((node) => {
    const col = hop.get(node.id);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col).push(node);
  });

  // Sort each column by label so layout is stable across renders
  for (const [, column] of columns) {
    column.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }

  // Position: column index 0 = focus column at x=0; negative columns to the
  // left (upstream), positive columns to the right (downstream).
  const positions = new Map();
  for (const [col, columnNodes] of columns) {
    const colHeight = columnNodes.reduce((acc, node) => {
      return acc + (nodeIsTall(node) ? NODE_HEIGHT_TALL : NODE_HEIGHT_COMPACT) + NODE_ROW_GAP;
    }, -NODE_ROW_GAP);
    let cursor = -colHeight / 2;
    columnNodes.forEach((node) => {
      const height = nodeIsTall(node) ? NODE_HEIGHT_TALL : NODE_HEIGHT_COMPACT;
      positions.set(node.id, {
        x: col * NODE_COLUMN_GAP,
        y: cursor,
      });
      cursor += height + NODE_ROW_GAP;
    });
  }
  return { positions, columns, hop };
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

  const nodesArray = graph.nodes;
  const edgesArray = graph.edges;
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

  const layout = useMemo(
    () => computeBfsLayout(nodesArray, edgesArray, focusId || graph.focus?.fqn),
    [nodesArray, edgesArray, focusId, graph.focus?.fqn],
  );

  // React Flow expects { id, position, data, type } for nodes and
  // { id, source, target, type } for edges. We wrap the node id in
  // a stable object so we can pass tracing flags into LineageFlowNode
  // through `data` without the parent re-mounting React Flow.
  const flowNodes = useMemo(() => {
    return nodesArray.map((node) => {
      const position = layout.positions.get(node.id) || { x: 0, y: 0 };
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
  }, [nodesArray, layout, hoveredNodeId, tracedNodeIds, handleNodeClick]);

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
      {hydrating ? (
        <div className="ga-lineage-v2-canvas-banner" role="status">
          <span aria-hidden="true" className="ga-lineage-v2-canvas-spinner" />
          Hydrating from Unity Catalog…
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
