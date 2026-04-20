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
    // The rebuilt drawer body always renders the 5 tab buttons + the sticky
    // action footer. Those two pieces are the new load-bearing structure —
    // they replace the old freeform "Graph Actions" / narrative sections.
    expect(screen.getByTestId("lineage-node-tabs")).not.toBeNull();
    expect(screen.getByTestId("lineage-node-footer")).not.toBeNull();
    expect(screen.getByRole("button", { name: "View in Databricks Catalog" })).not.toBeNull();

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

    // When the record is force-unavailable, the sticky footer's primary
    // action is disabled and the header carries an "unavailable" chip so
    // the steward knows governance writes won't land on this node.
    expect(
      screen.getByRole("button", { name: "View in Databricks Catalog" }).disabled,
    ).toBe(true);
    expect(screen.getByText("Metadata record unavailable")).not.toBeNull();
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

  it("exposes an include-column-lineage toggle in the filter panel (A5.1)", () => {
    render(
      <LineageGraph
        asset={{ fqn: "main.sales.orders", name: "orders" }}
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

    // Open the filter panel so the toggle is in the DOM.
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const toggle = screen.getByTestId("lineage-include-columns-toggle");
    expect(toggle).not.toBeNull();
    // Defaults to off — we don't force column nodes on by default.
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
  });

  it("renders SQL evidence when an edge supplies a snippet (A5.2)", () => {
    render(
      <LineageGraph
        asset={{ fqn: "main.sales.orders", name: "orders" }}
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
                sqlSnippet: "SELECT * FROM main.sales.raw_orders",
              },
            },
          ],
        }}
        hasEdges
        lineagePayload={{
          edgeDetails: {
            "upstream-focus-0": {
              sqlSnippet: "SELECT * FROM main.sales.raw_orders",
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

    expect(screen.getByText("SQL evidence")).not.toBeNull();
    const pre = screen.getByTestId("lineage-sql-evidence");
    expect(pre.textContent).toContain("SELECT * FROM main.sales.raw_orders");
  });

  it("renders the five node drawer tabs and lets the user switch between them", () => {
    render(
      <LineageGraph
        asset={{ fqn: "main.sales.orders", name: "orders" }}
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
              columns: [
                { name: "order_id", dataType: "String" },
                { name: "customer_id", dataType: "String" },
              ],
              details: {
                owner: "Data Platform",
                updatedAt: "2026-04-10T00:00:00Z",
              },
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

    fireEvent.click(screen.getByRole("button", { name: "orders" }));

    // All five tabs are in the DOM.
    expect(screen.getByTestId("lineage-node-tab-details")).not.toBeNull();
    expect(screen.getByTestId("lineage-node-tab-columns")).not.toBeNull();
    expect(screen.getByTestId("lineage-node-tab-quality")).not.toBeNull();
    expect(screen.getByTestId("lineage-node-tab-stewardship")).not.toBeNull();
    expect(screen.getByTestId("lineage-node-tab-dependencies")).not.toBeNull();
    // Details panel is the default.
    expect(screen.getByTestId("lineage-node-panel-details")).not.toBeNull();
    // Switching to Columns surfaces the column list.
    fireEvent.click(screen.getByTestId("lineage-node-tab-columns"));
    expect(screen.getByText("order_id")).not.toBeNull();
    expect(screen.getByText("customer_id")).not.toBeNull();
  });

  it("switches to the Depend. tab and lists adjacent neighbors that refocus on click", () => {
    const onSelectAsset = vi.fn();
    render(
      <LineageGraph
        asset={{ fqn: "main.sales.orders", name: "orders" }}
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
            {
              id: "downstream",
              assetFqn: "main.sales.orders_summary",
              kind: "View",
              label: "orders_summary",
              role: "target",
              subtitle: "main.sales.orders_summary",
            },
          ],
          edges: [
            { id: "edge-1", source: "upstream", target: "focus", data: { kind: "Lineage" } },
            { id: "edge-2", source: "focus", target: "downstream", data: { kind: "Lineage" } },
          ],
        }}
        hasEdges
        lineagePayload={{}}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={onSelectAsset}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "orders" }));
    fireEvent.click(screen.getByTestId("lineage-node-tab-dependencies"));

    const rows = screen.getAllByTestId("lineage-node-dependency");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Clicking a neighbor row refocuses the graph via the onSelectAsset
    // contract we agreed not to change.
    fireEvent.click(rows[0]);
    expect(onSelectAsset).toHaveBeenCalled();
  });

  it("keeps View in Databricks Catalog in the sticky footer across every tab", () => {
    render(
      <LineageGraph
        asset={{ fqn: "main.sales.orders", name: "orders" }}
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
              columns: [{ name: "order_id", dataType: "String" }],
              details: { owner: "Data Platform" },
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
            { id: "edge-1", source: "upstream", target: "focus", data: { kind: "Lineage" } },
          ],
        }}
        hasEdges
        lineagePayload={{}}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "orders" }));

    const tabs = ["details", "columns", "quality", "stewardship", "dependencies"];
    for (const tabKey of tabs) {
      fireEvent.click(screen.getByTestId(`lineage-node-tab-${tabKey}`));
      // Footer is always mounted and always holds the primary CTA — even
      // on tabs that render a muted placeholder.
      expect(screen.getByTestId("lineage-node-footer")).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "View in Databricks Catalog" }),
      ).not.toBeNull();
    }
  });

  it("shows a muted placeholder when no SQL evidence is available (A5.2)", () => {
    render(
      <LineageGraph
        asset={{ fqn: "main.sales.orders", name: "orders" }}
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
              data: { kind: "Lineage" },
            },
          ],
        }}
        hasEdges
        lineagePayload={{
          edgeDetails: {
            "upstream-focus-0": {
              sqlSnippet: null,
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

    // Section title is always visible so stewards can learn the data
    // exists; the body flips between snippet and placeholder copy.
    expect(screen.getByText("SQL evidence")).not.toBeNull();
    // User clicks Show to reveal the placeholder (collapsed when no snippet).
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("No SQL evidence recorded for this edge.")).not.toBeNull();
  });
});
