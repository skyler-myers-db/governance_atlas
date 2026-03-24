import { useEffect, useMemo, useRef, useState } from "react";
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
      </div>
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
  hasEdges,
  onAssetSearchQueryChange,
  onContextChange,
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
  const [allowDefaultSelection, setAllowDefaultSelection] = useState(true);
  const [refocusOpen, setRefocusOpen] = useState(false);
  const refocusRootRef = useRef(null);

  const clearSelection = (resetMode = true) => {
    setSelectedEdgeId("");
    setSelectedNodeId("");
    setDrawerOpen(false);
    setAllowDefaultSelection(false);
    if (resetMode) {
      setGraphMode("explore");
    }
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
    setDrawerOpen(Boolean(defaultFocusNodeId));
    setGraphMode("explore");
    setAllowDefaultSelection(true);
    setRefocusOpen(false);
    onAssetSearchQueryChange?.("");
  }, [asset?.fqn, context, defaultFocusNodeId]);

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
  const selectedSource = selectedEdge ? nodesById[selectedEdge.source] || null : null;
  const selectedTarget = selectedEdge ? nodesById[selectedEdge.target] || null : null;
  const selectionLabel = selectedEdge
    ? `${selectedSource?.label || "Source"} → ${selectedTarget?.label || "Target"}`
    : selectedNode?.label || (allowDefaultSelection ? focusNode?.label || asset?.name || "Graph focus" : "Selection cleared");
  const showMiniMap = transformed.nodes.length >= 6;
  const showControls = transformed.nodes.length >= 3;
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
    const onFocusIn = (event) => {
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
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onAssetSearchQueryChange, refocusOpen]);

  const hasHiddenSelection = !drawerOpen && (
    Boolean(selectedEdge)
    || Boolean(selectedNode)
    || (graphMode !== "explore" && (activeNodeIds.length || activeEdgeIds.length))
  );

  return (
    <div className="gh-lineage-canvas">
      <div className="gh-lineage-canvas-controls">
        <div className="gh-action-row">
          <div className="gh-segment-row">
            {["Data Lineage", "Operational Context"].map((option) => (
              <button
                className={`gh-segment-button ${context === option ? "is-active" : ""}`}
                key={option}
                onClick={() => onContextChange?.(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
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
                          <span>
                            {candidate.catalog} / {candidate.schema}
                          </span>
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
        </div>
        <div className="gh-segment-row">
          {graphHasEdges
            ? [
                { key: "explore", label: "Explore" },
                { key: "path", label: "Path" },
                { key: "upstream", label: "Upstream" },
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
              ))
            : null}
        </div>
        <div className="gh-action-row">
          <span className="gh-lineage-meta-inline">
            {transformed.nodes.length} nodes · {transformed.edges.length} edges · {graphMode}
          </span>
          <button
            className="gh-secondary-button"
            onClick={() => clearSelection()}
            type="button"
          >
            Neutral graph
          </button>
          <button
            className="gh-secondary-button"
            onClick={() => {
              clearSelection();
              flowInstance?.fitView?.({ padding: 0.18 });
            }}
            type="button"
          >
            Reset view
          </button>
          <button
            className="gh-secondary-button"
            onClick={() => {
              setAllowDefaultSelection(true);
              setSelectedEdgeId("");
              setSelectedNodeId(defaultFocusNodeId);
              setDrawerOpen(true);
              setRefocusOpen(false);
              setGraphMode("explore");
              flowInstance?.fitView?.({ padding: 0.18 });
            }}
            type="button"
          >
            Focus asset
          </button>
        </div>
      </div>
      {hasHiddenSelection ? (
        <div className="gh-lineage-selection-banner">
          <span className="gh-chip gh-chip-soft">{selectionLabel}</span>
          <div className="gh-action-row">
            <button
              className="gh-secondary-button"
              onClick={() => setDrawerOpen(true)}
              type="button"
            >
              Show details
            </button>
            <button
              className="gh-secondary-button"
              onClick={() => clearSelection()}
              type="button"
            >
              Neutral graph
            </button>
          </div>
        </div>
      ) : null}
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
          setAllowDefaultSelection(true);
          setSelectedEdgeId(edge.id);
          setSelectedNodeId("");
          setDrawerOpen(true);
          setGraphMode("explore");
        }}
        onNodeClick={(_, node) => {
          setAllowDefaultSelection(true);
          setSelectedNodeId(node.id);
          setSelectedEdgeId("");
          setDrawerOpen(true);
          setGraphMode("explore");
        }}
        onPaneClick={() => {
          clearSelection();
        }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        {showMiniMap ? <MiniMap pannable zoomable maskColor="rgba(16, 24, 40, 0.08)" nodeColor="#d7dff4" /> : null}
        {showControls ? <Controls showInteractive={false} /> : null}
        <Background color="#d9e2ff" gap={22} />
      </ReactFlow>

      <aside className={`gh-lineage-drawer ${drawerOpen ? "is-open" : ""}`}>
        <div className="gh-lineage-drawer-head">
          <div className="gh-panel-title">{selectedEdge ? "Relationship" : "Selected node"}</div>
          <button className="gh-secondary-button" onClick={() => closeDrawer()} type="button">
            Hide details
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
              <span className="gh-chip gh-chip-soft">Path edges {activeEdgeIds.length}</span>
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
            {activePathNodes.length ? (
              <div className="gh-detail-section">
                <div className="gh-panel-title">Active path</div>
                <div className="gh-chip-stack">
                  {activePathNodes.map((node) => (
                    <button
                      className="gh-filter-chip gh-chip-soft"
                      key={node.id}
                      onClick={() => {
                        setAllowDefaultSelection(true);
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId("");
                        setDrawerOpen(true);
                      }}
                      type="button"
                    >
                      {node.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="gh-action-grid">
              <button
                className="gh-secondary-button"
                onClick={() => {
                  setAllowDefaultSelection(true);
                  setSelectedEdgeId("");
                  setSelectedNodeId(selectedSource?.id || "");
                  setGraphMode("upstream");
                  setDrawerOpen(true);
                }}
                type="button"
              >
                Trace upstream
              </button>
              <button
                className="gh-secondary-button"
                onClick={() => {
                  setAllowDefaultSelection(true);
                  setSelectedEdgeId("");
                  setSelectedNodeId(selectedTarget?.id || "");
                  setGraphMode("impact");
                  setDrawerOpen(true);
                }}
                type="button"
              >
                Trace downstream
              </button>
              <button
                className="gh-secondary-button"
                onClick={() => {
                  setGraphMode("path");
                  setDrawerOpen(true);
                }}
                type="button"
              >
                Highlight route
              </button>
              {selectedSource?.assetFqn ? (
              <button
                className="gh-primary-button"
                onClick={() => {
                  setAllowDefaultSelection(true);
                  setSelectedNodeId(selectedSource.id);
                  setSelectedEdgeId("");
                  setDrawerOpen(true);
                }}
                type="button"
              >
                Focus source
                </button>
              ) : null}
              {selectedTarget?.assetFqn ? (
              <button
                className="gh-primary-button"
                onClick={() => {
                  setAllowDefaultSelection(true);
                  setSelectedNodeId(selectedTarget.id);
                  setSelectedEdgeId("");
                  setDrawerOpen(true);
                }}
                type="button"
              >
                Focus target
              </button>
              ) : null}
              {selectedSource?.assetFqn ? (
                <button
                  className="gh-secondary-button"
                  onClick={() => onSelectAsset(selectedSource.assetFqn)}
                  type="button"
                >
                  Re-root on source
                </button>
              ) : null}
              {selectedTarget?.assetFqn ? (
                <button
                  className="gh-secondary-button"
                  onClick={() => onSelectAsset(selectedTarget.assetFqn)}
                  type="button"
                >
                  Re-root on target
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
              {selectedSource?.assetFqn ? (
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenGovernance(selectedSource.assetFqn)}
                  type="button"
                >
                  Source governance
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
              {selectedTarget?.assetFqn ? (
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenGovernance(selectedTarget.assetFqn)}
                  type="button"
                >
                  Target governance
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
            {neighborBuckets.upstream.length || neighborBuckets.downstream.length ? (
              <div className="gh-detail-section">
                <div className="gh-panel-title">Connected nodes</div>
                {neighborBuckets.upstream.length ? (
                  <div className="gh-detail-section">
                    <div className="gh-support-copy">Upstream</div>
                    <div className="gh-chip-stack">
                      {neighborBuckets.upstream.slice(0, 5).map((node) => (
                        <button
                          className="gh-filter-chip gh-chip-soft"
                          key={node.id}
                          onClick={() => {
                            setAllowDefaultSelection(true);
                            setSelectedNodeId(node.id);
                            setSelectedEdgeId("");
                            setDrawerOpen(true);
                          }}
                          type="button"
                        >
                          {node.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {neighborBuckets.downstream.length ? (
                  <div className="gh-detail-section">
                    <div className="gh-support-copy">Downstream</div>
                    <div className="gh-chip-stack">
                      {neighborBuckets.downstream.slice(0, 5).map((node) => (
                        <button
                          className="gh-filter-chip gh-chip-soft"
                          key={node.id}
                          onClick={() => {
                            setAllowDefaultSelection(true);
                            setSelectedNodeId(node.id);
                            setSelectedEdgeId("");
                            setDrawerOpen(true);
                          }}
                          type="button"
                        >
                          {node.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {selectedNode.assetFqn ? (
              <div className="gh-action-grid">
                <button
                  className="gh-primary-button"
                  onClick={() => {
                    setAllowDefaultSelection(true);
                    onSelectAsset(selectedNode.assetFqn);
                  }}
                  type="button"
                >
                  Refocus graph
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => setGraphMode("path")}
                  type="button"
                >
                  Trace to focus
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => setGraphMode("upstream")}
                  type="button"
                >
                  Trace upstream
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
                  onClick={() => flowInstance?.fitView?.({ padding: 0.18 })}
                  type="button"
                >
                  Recenter
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
