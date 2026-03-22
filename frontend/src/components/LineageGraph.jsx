import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MarkerType, MiniMap, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

function nodeColor(kind) {
  if (kind === "View") return "#5b6af7";
  if (kind === "Notebook") return "#44b2ff";
  if (kind === "Pipeline") return "#8e67ff";
  return "#1d2a44";
}

function transformGraph(graph) {
  if (!graph) return { nodes: [], edges: [] };

  return {
    nodes: (graph.nodes || []).map((node) => ({
      id: node.id,
      position: { x: (node.x || 0) * 16, y: (node.y || 0) * 10 },
      data: node,
      style: {
        width: 248,
        borderRadius: 16,
        border: node.role === "focus" ? "2px solid #5b6af7" : "1px solid #c9d6ee",
        background: "#ffffff",
        boxShadow:
          node.role === "focus"
            ? "0 14px 28px rgba(74,95,206,0.16)"
            : "0 8px 20px rgba(19,31,65,0.06)",
        padding: 16,
      },
      type: "default",
      sourcePosition: "right",
      targetPosition: "left",
    })),
    edges: (graph.edges || []).map((edge, index) => ({
      id: `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      data: edge,
      animated: edge.depth === 1,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: "#6d7af8",
      },
      style: {
        stroke: "#6d7af8",
        strokeWidth: edge.depth === 1 ? 2.5 : 1.8,
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

function shortestUndirectedPath(edges, startId, endId) {
  if (!startId || !endId) return { nodeIds: [], edgeIds: [] };
  if (startId === endId) return { nodeIds: [startId], edgeIds: [] };

  const neighbors = new Map();
  edges.forEach((edge) => {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, []);
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, []);
    neighbors.get(edge.source).push({ nodeId: edge.target, edgeId: edge.id });
    neighbors.get(edge.target).push({ nodeId: edge.source, edgeId: edge.id });
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
      </div>
    </div>
  );
}

export default function LineageGraph({
  asset,
  context,
  graph,
  onOpenAsset,
  onOpenGovernance,
  onSelectAsset,
}) {
  const transformed = useMemo(() => transformGraph(graph), [graph]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [graphMode, setGraphMode] = useState("explore");
  const [flowInstance, setFlowInstance] = useState(null);

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

  useEffect(() => {
    setSelectedNodeId(defaultFocusNodeId);
    setSelectedEdgeId("");
    setDrawerOpen(Boolean(defaultFocusNodeId));
    setGraphMode("explore");
  }, [asset?.fqn, context, defaultFocusNodeId]);

  useEffect(() => {
    const edgeStillExists = selectedEdgeId && transformed.edges.some((edge) => edge.id === selectedEdgeId);
    const nodeStillExists = selectedNodeId && nodesById[selectedNodeId];

    if (selectedEdgeId && !edgeStillExists) {
      setSelectedEdgeId("");
    }
    if (selectedNodeId && !nodeStillExists) {
      setSelectedNodeId(defaultFocusNodeId);
    }
    if (!selectedEdgeId && !selectedNodeId && defaultFocusNodeId) {
      setSelectedNodeId(defaultFocusNodeId);
    }
  }, [defaultFocusNodeId, nodesById, selectedEdgeId, selectedNodeId, transformed.edges]);

  const selectedNode = nodesById[selectedNodeId] || nodesById[defaultFocusNodeId] || null;
  const selectedEdge = transformed.edges.find((edge) => edge.id === selectedEdgeId) || null;
  const selectedSource = selectedEdge ? nodesById[selectedEdge.source] || null : null;
  const selectedTarget = selectedEdge ? nodesById[selectedEdge.target] || null : null;
  const nodeStats = selectedNode
    ? {
        upstream: transformed.edges.filter((edge) => edge.target === selectedNode.id).length,
        downstream: transformed.edges.filter((edge) => edge.source === selectedNode.id).length,
      }
    : { upstream: 0, downstream: 0 };

  const activeSelection = useMemo(() => {
    if (graphMode === "path") {
      if (selectedEdge) {
        const sourcePath = shortestUndirectedPath(transformed.edges, selectedEdge.source, defaultFocusNodeId);
        const targetPath = shortestUndirectedPath(transformed.edges, selectedEdge.target, defaultFocusNodeId);
        return {
          nodeIds: [...new Set([selectedEdge.source, selectedEdge.target, ...sourcePath.nodeIds, ...targetPath.nodeIds])],
          edgeIds: [...new Set([selectedEdge.id, ...sourcePath.edgeIds, ...targetPath.edgeIds])],
        };
      }
      const anchorNodeId = selectedNode?.id || defaultFocusNodeId;
      return shortestUndirectedPath(transformed.edges, anchorNodeId, defaultFocusNodeId);
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

  return (
    <div className="gh-lineage-canvas">
      <div className="gh-lineage-canvas-controls">
        <div className="gh-segment-row">
          {[
            { key: "explore", label: "Explore" },
            { key: "path", label: "Path" },
            { key: "impact", label: "Impact" },
          ].map((mode) => (
            <button
              className={`gh-segment-button ${graphMode === mode.key ? "is-active" : ""}`}
              key={mode.key}
              onClick={() => setGraphMode(mode.key)}
              type="button"
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="gh-action-row">
          <button
            className="gh-secondary-button"
            onClick={() => flowInstance?.fitView?.({ padding: 0.18 })}
            type="button"
          >
            Fit
          </button>
          <button
            className="gh-secondary-button"
            onClick={() => {
              setGraphMode("explore");
              setSelectedEdgeId("");
              setSelectedNodeId(defaultFocusNodeId);
              setDrawerOpen(Boolean(defaultFocusNodeId));
              flowInstance?.fitView?.({ padding: 0.18 });
            }}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>
      <ReactFlow
        edges={transformed.edges.map((edge) => ({
          ...edge,
          className: activeEdgeIds.includes(edge.id) ? "is-active" : "",
        }))}
        onInit={setFlowInstance}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        nodes={transformed.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            label: <NodeLabel data={node.data} />,
          },
          className: activeNodeIds.includes(node.id) ? "is-active" : "",
        }))}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
          setSelectedNodeId("");
          setGraphMode("path");
          setDrawerOpen(true);
        }}
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
          setSelectedEdgeId("");
          setDrawerOpen(true);
        }}
        onPaneClick={() => {
          setSelectedNodeId(defaultFocusNodeId);
          setSelectedEdgeId("");
          setDrawerOpen(false);
        }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <MiniMap pannable zoomable maskColor="rgba(16, 24, 40, 0.08)" nodeColor="#d7dff4" />
        <Controls showInteractive={false} />
        <Background color="#d9e2ff" gap={22} />
      </ReactFlow>

      <aside className={`gh-lineage-drawer ${drawerOpen ? "is-open" : ""}`}>
        <div className="gh-lineage-drawer-head">
          <div className="gh-panel-title">{selectedEdge ? "Relationship" : "Selected node"}</div>
          <button className="gh-secondary-button" onClick={() => setDrawerOpen(false)} type="button">
            Close
          </button>
        </div>

        {selectedEdge ? (
          <>
            <h2>
              {selectedSource?.label || selectedEdge.source} → {selectedTarget?.label || selectedEdge.target}
            </h2>
            <div className="gh-chip-stack">
              <span className="gh-chip">Lineage edge</span>
              <span className="gh-chip gh-chip-soft">Depth {selectedEdge.data?.depth || 1}</span>
              <span className="gh-chip gh-chip-soft">
                {selectedSource?.kind || "Asset"} → {selectedTarget?.kind || "Asset"}
              </span>
            </div>
            <div className="gh-support-copy">
              Follow this relationship to understand how context and data move through the current graph.
            </div>
            <div className="gh-attribute-list">
              <div className="gh-attribute-row">
                <span className="gh-attribute-label">Source</span>
                <span className="gh-attribute-value">{selectedSource?.subtitle || selectedEdge.source}</span>
              </div>
              <div className="gh-attribute-row">
                <span className="gh-attribute-label">Target</span>
                <span className="gh-attribute-value">{selectedTarget?.subtitle || selectedEdge.target}</span>
              </div>
            </div>
            <div className="gh-action-grid">
              <button
                className="gh-secondary-button"
                onClick={() => setGraphMode("path")}
                type="button"
              >
                Highlight path
              </button>
              {selectedSource?.assetFqn ? (
                <button
                  className="gh-primary-button"
                  onClick={() => onSelectAsset(selectedSource.assetFqn)}
                  type="button"
                >
                  Focus source
                </button>
              ) : null}
              {selectedTarget?.assetFqn ? (
                <button
                  className="gh-primary-button"
                  onClick={() => onSelectAsset(selectedTarget.assetFqn)}
                  type="button"
                >
                  Focus target
                </button>
              ) : null}
              {selectedSource?.assetFqn ? (
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenAsset(selectedSource.assetFqn)}
                  type="button"
                >
                  Open source
                </button>
              ) : null}
              {selectedTarget?.assetFqn ? (
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenAsset(selectedTarget.assetFqn)}
                  type="button"
                >
                  Open target
                </button>
              ) : null}
            </div>
          </>
        ) : selectedNode ? (
          <>
            <h2>{selectedNode.label}</h2>
            <div className="gh-support-copy">{selectedNode.subtitle}</div>
            <div className="gh-chip-stack">
              <span className="gh-chip">{selectedNode.kind}</span>
              <span className="gh-chip gh-chip-soft">{selectedNode.kicker || selectedNode.role}</span>
              <span className="gh-chip gh-chip-soft">{nodeStats.upstream} upstream</span>
              <span className="gh-chip gh-chip-soft">{nodeStats.downstream} downstream</span>
            </div>
            <div className="gh-detail-section">
              <div className="gh-support-copy">
                {selectedNode.role === "focus"
                  ? "This asset anchors the current graph."
                  : selectedNode.role === "source"
                    ? "This node contributes data or execution context into the focused asset."
                    : "This node consumes or depends on the focused asset."}
              </div>
            </div>
            {selectedNode.assetFqn ? (
              <div className="gh-action-grid">
                <button
                  className="gh-primary-button"
                  onClick={() => onSelectAsset(selectedNode.assetFqn)}
                  type="button"
                >
                  Refocus graph
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => setGraphMode("path")}
                  type="button"
                >
                  Highlight path
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => setGraphMode("impact")}
                  type="button"
                >
                  Show impact
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenAsset(selectedNode.assetFqn)}
                  type="button"
                >
                  Open asset
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenGovernance(selectedNode.assetFqn)}
                  type="button"
                >
                  Open governance
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
