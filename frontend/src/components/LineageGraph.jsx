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

export default function LineageGraph({ graph, onSelectNode, selectedNodeId }) {
  const transformed = transformGraph(graph);

  return (
    <div className="gh-lineage-canvas">
      <ReactFlow
        edges={transformed.edges}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        nodes={transformed.nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            label: <NodeLabel data={node.data} />,
          },
          className: node.id === selectedNodeId ? "is-active" : "",
        }))}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <MiniMap pannable zoomable maskColor="rgba(16, 24, 40, 0.08)" />
        <Controls showInteractive={false} />
        <Background color="#d9e2ff" gap={22} />
      </ReactFlow>
    </div>
  );
}
