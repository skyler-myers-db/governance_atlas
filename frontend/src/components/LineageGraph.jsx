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

function nodeColor(kind) {
  if (kind === "View") return "#5b6af7";
  if (kind === "Notebook") return "#44b2ff";
  if (kind === "Pipeline") return "#8e67ff";
  return "#1d2a44";
}

function collectDepths(seedId, edges, direction) {
  if (!seedId) return new Map();
  const depths = new Map();
  const queue = [{ id: seedId, depth: 0 }];

  while (queue.length) {
    const current = queue.shift();
    const matching = edges.filter((edge) =>
      direction === "upstream" ? edge.target === current.id : edge.source === current.id
    );
    matching.forEach((edge) => {
      const nextId = direction === "upstream" ? edge.source : edge.target;
      const nextDepth = current.depth + 1;
      if (depths.has(nextId) && depths.get(nextId) <= nextDepth) return;
      depths.set(nextId, nextDepth);
      queue.push({ id: nextId, depth: nextDepth });
    });
  }

  return depths;
}

function lineageLevelMap(nodes, edges) {
  const focusId = nodes.find((node) => node.role === "focus")?.id || nodes[0]?.id || "";
  const upstreamDepths = collectDepths(focusId, edges, "upstream");
  const downstreamDepths = collectDepths(focusId, edges, "downstream");

  return new Map(
    nodes.map((node) => {
      if (node.id === focusId) return [node.id, 0];
      if (upstreamDepths.has(node.id)) return [node.id, upstreamDepths.get(node.id) * -1];
      if (downstreamDepths.has(node.id)) return [node.id, downstreamDepths.get(node.id)];
      if (node.role === "source") return [node.id, -1];
      if (node.role === "target") return [node.id, 1];
      return [node.id, 2];
    })
  );
}

function layoutGraphNodes(nodes, edges) {
  const ranked = [...(nodes || [])].sort((left, right) => {
    const leftRank = typeof left.y === "number" ? left.y : Number.MAX_SAFE_INTEGER;
    const rightRank = typeof right.y === "number" ? right.y : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  });

  const levels = lineageLevelMap(ranked, edges || []);
  const buckets = new Map();

  ranked.forEach((node) => {
    const level = levels.get(node.id) || 0;
    const bucket = buckets.get(level) || [];
    bucket.push(node);
    buckets.set(level, bucket);
  });

  const orderedLevels = [...buckets.keys()].sort((left, right) => left - right);
  const minLevel = orderedLevels[0] ?? 0;
  const focusY = 240;
  const gapY = 70;
  const gapX = 164;

  return ranked.map((node) => {
    const level = levels.get(node.id) || 0;
    const bucket = buckets.get(level) || [];
    const index = bucket.findIndex((candidate) => candidate.id === node.id);
    const offsetY = bucket.length > 1 ? ((bucket.length - 1) * gapY) / 2 : 0;

    return {
      ...node,
      position: {
        x: 120 + (level - minLevel) * gapX,
        y: focusY + index * gapY - offsetY + (level === 0 ? 0 : 8),
      },
    };
  });
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
        width: node.role === "focus" ? 186 : 146,
        borderRadius: 10,
        border: node.role === "focus" ? "2px solid #5b6af7" : "1px solid #c9d6ee",
        background: "#ffffff",
        boxShadow: node.role === "focus" ? "0 8px 18px rgba(74,95,206,0.08)" : "0 1px 2px rgba(19,31,65,0.02)",
        padding: 6,
      },
      type: "assetNode",
      sourcePosition: "right",
      targetPosition: "left",
    })),
    edges: (graph.edges || []).map((edge, index) => ({
      id: `${edge.source}-${edge.target}-${index}`,
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
    setRefocusOpen(false);
  }, [context]);

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

  useEffect(() => {
    if (!flowInstance || !transformed.nodes.length) return;
    const frame = requestAnimationFrame(() => {
      flowInstance.fitView?.({ padding: 0.18, duration: 220 });
    });
    return () => cancelAnimationFrame(frame);
  }, [asset?.fqn, context, flowInstance, transformed.edges.length, transformed.nodes.length]);

  useEffect(() => {
    if (!flowInstance) return;
    if (graphMode === "explore" && !selectedEdgeId) return;
    const activeNodes = transformed.nodes.filter((node) => activeNodeIds.includes(node.id));
    if (!activeNodes.length) return;
    const frame = requestAnimationFrame(() => {
      flowInstance.fitView?.({ nodes: activeNodes, padding: 0.3, duration: 220 });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeNodeIds, flowInstance, graphMode, selectedEdgeId, transformed.nodes]);

  useEffect(() => {
    if (!flowInstance || !selectedNodeId || graphMode !== "explore") return;
    const related = connectedSelection(transformed.edges, selectedNodeId);
    const activeNodes = transformed.nodes.filter((node) => related.nodeIds.includes(node.id));
    if (!activeNodes.length) return;
    const frame = requestAnimationFrame(() => {
      flowInstance.fitView?.({ nodes: activeNodes, padding: 0.34, duration: 220 });
    });
    return () => cancelAnimationFrame(frame);
  }, [flowInstance, graphMode, selectedNodeId, transformed.edges, transformed.nodes]);

  return (
    <div className="gh-lineage-canvas">
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
        fitView
        fitViewOptions={{ padding: 0.18 }}
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

      <aside className={`gh-lineage-drawer ${drawerOpen ? "is-open" : ""}`}>
        <div className="gh-lineage-drawer-head">
          <div className="gh-panel-title">{selectedEdge ? "Relationship" : "Selected node"}</div>
          <button className="gh-secondary-button" onClick={() => closeDrawer()} type="button">
            Close details
          </button>
        </div>

        {selectedEdge ? (
          <>
            <h2>
              {selectedSource?.label || selectedEdge.source} → {selectedTarget?.label || selectedEdge.target}
            </h2>
            <div className="gh-chip-stack">
              <span className="gh-chip">Lineage edge</span>
              <span className="gh-chip gh-chip-soft">
                {selectedSource?.kind || "Asset"} → {selectedTarget?.kind || "Asset"}
              </span>
            </div>
            <div className="gh-support-copy">
              Reroot, trace, or open the linked assets directly.
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
            <div className="gh-action-grid gh-lineage-drawer-actions">
              <button
                className="gh-secondary-button"
                  onClick={() => {
                    setAllowDefaultSelection(false);
                    setSelectedEdgeId("");
                    setSelectedNodeId(selectedSource?.id || "");
                    setGraphMode("upstream");
                    setDrawerOpen(true);
                    setRefocusOpen(false);
                  }}
                  type="button"
                >
                Trace upstream
              </button>
              <button
                className="gh-secondary-button"
                  onClick={() => {
                    setAllowDefaultSelection(false);
                    setSelectedEdgeId("");
                    setSelectedNodeId(selectedTarget?.id || "");
                    setGraphMode("impact");
                    setDrawerOpen(true);
                    setRefocusOpen(false);
                  }}
                  type="button"
                >
                Show impact
              </button>
              {selectedSource?.assetFqn ? (
                <button
                  className="gh-primary-button"
                  onClick={() => onSelectAsset(selectedSource.assetFqn)}
                  type="button"
                >
                  Refocus source
                </button>
              ) : null}
              {selectedTarget?.assetFqn ? (
                <button
                  className="gh-primary-button"
                  onClick={() => onSelectAsset(selectedTarget.assetFqn)}
                  type="button"
                >
                  Refocus target
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
            {selectedNode.assetFqn ? (
              <div className="gh-action-grid gh-lineage-drawer-actions">
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
                  onClick={() => {
                    setGraphMode("path");
                    setDrawerOpen(true);
                  }}
                  type="button"
                >
                  Trace to focus
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => {
                    flowInstance?.fitView?.({ padding: 0.18 });
                    setDrawerOpen(false);
                  }}
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
