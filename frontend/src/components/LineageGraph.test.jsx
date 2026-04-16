import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LineageGraph from "./LineageGraph";

vi.mock("@xyflow/react", () => ({
  BaseEdge: () => null,
  Background: () => null,
  Controls: () => null,
  EdgeLabelRenderer: ({ children }) => <div>{children}</div>,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrow-closed" },
  MiniMap: () => null,
  Position: { Left: "left", Right: "right" },
  ReactFlow: ({ children, edges = [], nodes = [], onEdgeClick, onNodeClick, onPaneClick }) => (
    <div data-testid="mock-react-flow">
      {nodes.map((node) => (
        <button key={node.id} onClick={() => onNodeClick?.({}, node)} type="button">
          {node.data?.label || node.id}
        </button>
      ))}
      {edges.map((edge) => (
        <button key={edge.id} onClick={() => onEdgeClick?.({}, edge)} type="button">
          {edge.id}
        </button>
      ))}
      <button onClick={() => onPaneClick?.()} type="button">
        Clear selection
      </button>
      {children}
    </div>
  ),
  getBezierPath: () => ["M0 0", 0, 0],
}));

describe("LineageGraph", () => {
  it("opens and closes the shared drawer wrapper without changing graph selection semantics", () => {
    const { container } = render(
      <LineageGraph
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
        }}
        assetSearchLoading={false}
        assetSearchQuery=""
        assetSearchResolvedQuery=""
        assetSearchResults={[]}
        context="Data Lineage"
        graph={{
          nodes: [
            {
              id: "focus",
              assetFqn: "main.sales.orders",
              kind: "Table",
              label: "orders",
              role: "focus",
              subtitle: "main.sales.orders",
            },
          ],
          edges: [],
        }}
        hasEdges={false}
        lineagePayload={{}}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    expect(container.querySelector(".gh-lineage-drawer.is-open")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "orders" }));

    expect(container.querySelector(".gh-lineage-drawer.is-open")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close drawer" })).not.toBeNull();
    expect(screen.getByText("This asset anchors the current lineage view.")).not.toBeNull();
    expect(screen.getByText("Graph Actions")).not.toBeNull();
    expect(container.querySelector(".gh-surface-drawer-section")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));

    expect(container.querySelector(".gh-lineage-drawer.is-open")).toBeNull();
  });

  it("shows a failed-open lineage record as unavailable in the drawer", () => {
    render(
      <LineageGraph
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
        }}
        assetSearchLoading={false}
        assetSearchQuery=""
        assetSearchResolvedQuery=""
        assetSearchResults={[]}
        context="Data Lineage"
        graph={{
          nodes: [
            {
              id: "focus",
              assetFqn: "main.sales.orders",
              kind: "Table",
              label: "orders",
              role: "focus",
              subtitle: "main.sales.orders",
              details: {
                isOpenable: true,
              },
            },
          ],
          edges: [],
        }}
        hasEdges={false}
        linkedRecordUnavailableOverrides={{
          "main.sales.orders": true,
        }}
        lineagePayload={{}}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "orders" }));

    expect(screen.getByRole("button", { name: "Metadata record unavailable" }).disabled).toBe(true);
    expect(screen.getAllByText("Metadata record unavailable")).toHaveLength(2);
  });

  it("renders shared drawer sections for selected lineage edges without changing edge selection flow", () => {
    const { container } = render(
      <LineageGraph
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
        }}
        assetSearchLoading={false}
        assetSearchQuery=""
        assetSearchResolvedQuery=""
        assetSearchResults={[]}
        context="Data Lineage"
        graph={{
          nodes: [
            {
              id: "focus",
              assetFqn: "main.sales.orders",
              kind: "Table",
              label: "orders",
              role: "focus",
              subtitle: "main.sales.orders",
            },
            {
              id: "upstream",
              assetFqn: "main.sales.raw_orders",
              kind: "Table",
              label: "raw_orders",
              role: "source",
              subtitle: "main.sales.raw_orders",
            },
          ],
          edges: [
            {
              id: "edge-1",
              source: "upstream",
              target: "focus",
              data: {
                kind: "Lineage",
              },
            },
          ],
        }}
        hasEdges
        lineagePayload={{
          edgeDetails: {
            "upstream-focus-0": {
              columnMappings: [
                {
                  sourceColumn: "order_id",
                  targetColumn: "order_id",
                },
              ],
            },
          },
        }}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "upstream-focus-0" }));

    expect(screen.getByText("Edge Details")).not.toBeNull();
    expect(screen.getByText("Column Mappings")).not.toBeNull();
    expect(container.querySelectorAll(".gh-surface-drawer-section").length).toBeGreaterThan(1);
  });
});
