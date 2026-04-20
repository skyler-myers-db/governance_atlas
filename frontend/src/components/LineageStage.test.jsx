import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LineageStage from "./LineageStage";

vi.mock("./LineageGraph", () => ({
  default: () => <div data-testid="lineage-graph" />,
}));

describe("LineageStage", () => {
  it("labels truncated table lineage as partial instead of implying complete mappings", () => {
    render(
      <LineageStage
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
        }}
        context="Data Lineage"
        error=""
        graphBundle={{
          data: {
            nodes: [{ id: "focus", assetFqn: "main.sales.orders", role: "focus" }],
            edges: [],
          },
          operational: {
            nodes: [],
            edges: [],
          },
        }}
        lineagePayload={{
          stats: {
            limits: {
              tableLineage: 25,
            },
            truncated: {
              upstream: true,
              downstream: false,
              columnLineage: true,
            },
          },
        }}
        loading={false}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenFullGraph={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "Limited to 25 table edges. Column lineage may be partial or unavailable in this workspace.",
      ),
    ).not.toBeNull();
    expect(screen.getByTestId("lineage-graph")).not.toBeNull();
  });

  it("renders the workspace-level stepper controls and drives the stepper handlers", () => {
    const onUpstream = vi.fn();
    const onDownstream = vi.fn();
    const onDepth = vi.fn();
    const onPerLayer = vi.fn();
    const onIncludeColumns = vi.fn();

    render(
      <LineageStage
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
          catalog: "main",
          schema: "sales",
        }}
        context="Data Lineage"
        downstreamLevels={2}
        error=""
        graphBundle={{
          data: {
            nodes: [{ id: "focus", assetFqn: "main.sales.orders", role: "focus" }],
            edges: [],
          },
          operational: {
            nodes: [],
            edges: [],
          },
        }}
        includeColumns={false}
        lineagePayload={{ stats: {} }}
        loading={false}
        maxDepth={2}
        nodesPerLayer={10}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onDownstreamLevelsChange={onDownstream}
        onIncludeColumnsChange={onIncludeColumns}
        onMaxDepthChange={onDepth}
        onNodesPerLayerChange={onPerLayer}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
        onUpstreamLevelsChange={onUpstream}
        upstreamLevels={2}
      />,
    );

    // All four steppers should be rendered.
    expect(screen.getByTestId("lineage-upstream-stepper")).not.toBeNull();
    expect(screen.getByTestId("lineage-downstream-stepper")).not.toBeNull();
    expect(screen.getByTestId("lineage-depth-stepper")).not.toBeNull();
    expect(screen.getByTestId("lineage-per-layer-stepper")).not.toBeNull();

    // Each stepper increments through the provided handler.
    fireEvent.click(
      screen.getByTestId("lineage-upstream-stepper").querySelector('button[aria-label="Increase Upstream levels"]'),
    );
    expect(onUpstream).toHaveBeenCalledWith(3);

    fireEvent.click(
      screen.getByTestId("lineage-downstream-stepper").querySelector('button[aria-label="Decrease Downstream levels"]'),
    );
    expect(onDownstream).toHaveBeenCalledWith(1);

    // The include-columns toggle surfaces the workspace-level callback.
    fireEvent.click(screen.getByTestId("lineage-workspace-include-columns"));
    expect(onIncludeColumns).toHaveBeenCalledWith(true);

    // Focus View + Reset Zoom buttons render (tertiary styling).
    expect(screen.getByTestId("lineage-focus-view")).not.toBeNull();
    expect(screen.getByTestId("lineage-reset-zoom")).not.toBeNull();
  });

  it("renders the redesigned Lineage: <asset> header with breadcrumb + metadata chips", () => {
    render(
      <LineageStage
        asset={{
          fqn: "main.sales.customer_churn_model",
          name: "customer_churn_model",
          catalog: "main",
          schema: "sales",
          objectType: "View",
        }}
        context="Data Lineage"
        error=""
        graphBundle={{
          data: {
            nodes: [{ id: "focus", assetFqn: "main.sales.customer_churn_model", role: "focus" }],
            edges: [],
          },
          operational: { nodes: [], edges: [] },
        }}
        lineagePayload={{ stats: {} }}
        loading={false}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    // Title reads "Lineage: <assetName>" per the mockup.
    const title = screen.getByTestId("lineage-header-title");
    expect(title.textContent).toContain("Lineage:");
    expect(title.textContent).toContain("customer_churn_model");

    // Round 18: breadcrumb starts at the catalog (the "Unity Catalog"
    // prefix was removed because it duplicated the workspace brand in
    // the topbar). Assert the catalog + schema are present and the
    // leading item is NOT "Unity Catalog".
    expect(screen.queryByText("Unity Catalog")).toBeNull();
    expect(screen.getByText("main")).not.toBeNull();
    // "sales" appears in the breadcrumb and the Schema chip — assert at
    // least one breadcrumb link is rendered for it.
    expect(screen.getAllByText("sales").length).toBeGreaterThan(0);

    // Metadata chips render schema + source + databricks connection.
    expect(screen.getByTestId("lineage-chip-schema")).not.toBeNull();
    expect(screen.getByTestId("lineage-chip-source")).not.toBeNull();
    expect(screen.getByTestId("lineage-chip-databricks")).not.toBeNull();
  });

  it("keeps the shared context tabs interactive without touching graph behavior", () => {
    const onContextChange = vi.fn();

    render(
      <LineageStage
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
          catalog: "main",
          schema: "sales",
        }}
        context="Data Lineage"
        error=""
        graphBundle={{
          data: {
            nodes: [{ id: "focus", assetFqn: "main.sales.orders", role: "focus" }],
            edges: [],
          },
          operational: {
            nodes: [],
            edges: [],
          },
        }}
        lineagePayload={{
          stats: {},
        }}
        loading={false}
        onAssetSearchQueryChange={() => {}}
        onContextChange={onContextChange}
        onOpenAsset={() => {}}
        onOpenFullGraph={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Operational Lineage" }));

    expect(screen.getByTestId("lineage-header-title").textContent).toContain("orders");
    expect(onContextChange).toHaveBeenCalledWith("Operational Context");
  });
});
