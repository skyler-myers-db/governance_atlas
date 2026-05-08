import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as helpers from "./LineageCanvasV2.test-helpers";

vi.mock("@xyflow/react", () => {
  const Handle = () => null;
  const ReactFlow = ({ children, maxZoom, nodes, onNodeMouseEnter, onNodeMouseLeave }) => (
    <div data-max-zoom={maxZoom} data-testid="rf-canvas">
      {nodes.map((node) => {
        const NodeType = node.type ? helpers.TYPES[node.type] : null;
        return (
          <div
            data-testid={`rf-node-${node.id}`}
            key={node.id}
            onMouseEnter={(e) => onNodeMouseEnter && onNodeMouseEnter(e, node)}
            onMouseLeave={() => onNodeMouseLeave && onNodeMouseLeave()}
          >
            {NodeType ? <NodeType data={node.data} /> : null}
          </div>
        );
      })}
      {children}
    </div>
  );
  return {
    Background: () => null,
    Controls: () => <div data-testid="rf-controls" />,
    Handle,
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right" },
    ReactFlow,
    useReactFlow: () => ({ fitView: vi.fn() }),
    useUpdateNodeInternals: () => vi.fn(),
  };
});

import { LineageCanvasV2 } from "./LineageCanvasV2";

const baseGraph = {
  focus: { id: "focus-a", fqn: "datapact.x.focus", isFocus: true, label: "focus" },
  nodes: [
    {
      id: "focus-a",
      fqn: "datapact.x.focus",
      label: "focus",
      kind: "table",
      isFocus: true,
      isOpenable: true,
      rowCount: "1.2M",
      freshness: "2h ago",
    },
    {
      id: "u1",
      fqn: "datapact.x.upstream",
      label: "upstream",
      kind: "table",
      isFocus: false,
      isOpenable: true,
      rowCount: "8.4M",
    },
    {
      id: "u2",
      fqn: "datapact.x.lineage_only",
      label: "lineage_only",
      kind: "table",
      isFocus: false,
      isOpenable: false,
    },
  ],
  edges: [
    { id: "e1", source: "u1", target: "focus-a", isRestricted: false },
    { id: "e2", source: "u2", target: "focus-a", isRestricted: false },
  ],
  columnEdges: [],
};

beforeEach(() => {
  helpers.TYPES.lineage = ({ data }) => (
    <button
      data-testid={`card-${data.node.id}`}
      onClick={() => data.onSelect(data.node)}
      type="button"
    >
      {data.node.label}
    </button>
  );
});

describe("LineageCanvasV2", () => {
  it("renders the hydrating state when graph has no nodes and hydrating=true", () => {
    render(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.focus"
        graph={{ focus: null, nodes: [], edges: [], columnEdges: [] }}
        hydrating={true}
        onFocusChange={() => {}}
      />,
    );
    expect(screen.getByText("Hydrating lineage from Unity Catalog")).toBeTruthy();
  });

  it("renders the error state when error is set", () => {
    render(
      <LineageCanvasV2
        error="Asset not visible to actor"
        focusId="datapact.x.focus"
        graph={{ focus: null, nodes: [], edges: [], columnEdges: [] }}
        hydrating={false}
        onFocusChange={() => {}}
      />,
    );
    expect(screen.getByText("Lineage unavailable")).toBeTruthy();
    expect(screen.getByText("Asset not visible to actor")).toBeTruthy();
  });

  it("renders one rf-node per graph node when nodes are present", () => {
    render(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.focus"
        graph={baseGraph}
        hydrating={false}
        onFocusChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rf-node-focus-a")).toBeTruthy();
    expect(screen.getByTestId("rf-node-u1")).toBeTruthy();
    expect(screen.getByTestId("rf-node-u2")).toBeTruthy();
  });

  it("keeps enough max zoom headroom for visible canvas controls", () => {
    render(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.focus"
        graph={baseGraph}
        hydrating={false}
        onFocusChange={() => {}}
      />,
    );
    expect(Number(screen.getByTestId("rf-canvas").dataset.maxZoom)).toBeGreaterThan(2);
  });

  it("calls onFocusChange when a navigable node card is clicked", () => {
    const onFocusChange = vi.fn();
    render(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.focus"
        graph={baseGraph}
        hydrating={false}
        onFocusChange={onFocusChange}
      />,
    );
    fireEvent.click(screen.getByTestId("card-u1"));
    expect(onFocusChange).toHaveBeenCalledWith("datapact.x.upstream");
  });

  it("does NOT call onFocusChange for lineage-only (isOpenable=false) nodes", () => {
    const onFocusChange = vi.fn();
    render(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.focus"
        graph={baseGraph}
        hydrating={false}
        onFocusChange={onFocusChange}
      />,
    );
    fireEvent.click(screen.getByTestId("card-u2"));
    expect(onFocusChange).not.toHaveBeenCalled();
  });

  it("keeps accumulated topology when the same FQN returns with a new focus node id", async () => {
    const nextGraph = {
      focus: { id: "focus-upstream", fqn: "datapact.x.upstream", isFocus: true, label: "upstream" },
      nodes: [
        {
          id: "focus-upstream",
          fqn: "datapact.x.upstream",
          label: "upstream",
          kind: "table",
          isFocus: true,
          isOpenable: true,
        },
        {
          id: "target-new",
          fqn: "datapact.x.new_target",
          label: "new_target",
          kind: "table",
          isOpenable: true,
        },
      ],
      edges: [{ id: "e-new", source: "focus-upstream", target: "target-new" }],
      columnEdges: [],
    };
    const { rerender } = render(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.focus"
        graph={baseGraph}
        hydrating={false}
        onFocusChange={() => {}}
      />,
    );
    rerender(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.upstream"
        graph={nextGraph}
        hydrating={false}
        onFocusChange={() => {}}
      />,
    );
    expect(await screen.findByTestId("rf-node-focus-a")).toBeTruthy();
    expect(screen.getByTestId("rf-node-focus-upstream")).toBeTruthy();
    expect(screen.getByTestId("rf-node-target-new")).toBeTruthy();
  });

  it("DOES call onFocusChange when clicking the focus node — selection state, not refetch", () => {
    // Click is now a client-side selection event. The handler can fire
    // even on the URL-focus node so the user can re-select it after
    // visiting a different card. The parent decides whether to refetch
    // (it does NOT — focus-change is rail/highlight only; URL change is
    // gated behind an explicit "Re-anchor" button).
    const onFocusChange = vi.fn();
    render(
      <LineageCanvasV2
        error=""
        focusId="datapact.x.focus"
        graph={baseGraph}
        hydrating={false}
        onFocusChange={onFocusChange}
      />,
    );
    fireEvent.click(screen.getByTestId("card-focus-a"));
    expect(onFocusChange).toHaveBeenCalledWith("datapact.x.focus");
  });
});
