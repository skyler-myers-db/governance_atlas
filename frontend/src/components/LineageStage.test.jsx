import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lineageGraphProps = vi.hoisted(() => []);

vi.mock("./LineageGraph", () => ({
  default: (props) => {
    lineageGraphProps.push(props);
    return <div data-testid="lineage-graph" />;
  },
}));

import LineageStage from "./LineageStage";

describe("LineageStage", () => {
  beforeEach(() => {
    lineageGraphProps.length = 0;
  });

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

    fireEvent.change(
      screen.getByTestId("lineage-upstream-stepper").querySelector("select"),
      { target: { value: "3" } },
    );
    expect(onUpstream).toHaveBeenCalledWith(3);

    fireEvent.change(
      screen.getByTestId("lineage-downstream-stepper").querySelector("select"),
      { target: { value: "1" } },
    );
    expect(onDownstream).toHaveBeenCalledWith(1);

    // The include-columns toggle surfaces the workspace-level callback.
    fireEvent.click(screen.getByTestId("lineage-workspace-include-columns"));
    expect(onIncludeColumns).toHaveBeenCalledWith(true);

    // Focus View + Reset Zoom buttons render (tertiary styling).
    expect(screen.getByTestId("lineage-focus-view")).not.toBeNull();
    expect(screen.getByTestId("lineage-reset-zoom")).not.toBeNull();
  });

  it("does not render invisible full-surface controls removed from the mockup", () => {
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
        lineagePayload={{ stats: {} }}
        loading={false}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onRefreshLineage={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    expect(screen.queryByTestId("lineage-refresh")).toBeNull();
    expect(lineageGraphProps.at(-1)?.showCanvasControls).toBe(false);
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

    expect(screen.getByText("Unity Catalog")).not.toBeNull();
    expect(screen.getByText("main")).not.toBeNull();
    // "sales" appears in the breadcrumb and the Schema chip — assert at
    // least one breadcrumb link is rendered for it.
    expect(screen.getAllByText("sales").length).toBeGreaterThan(0);

    // Metadata chips render schema + asset type + databricks connection.
    expect(screen.getByTestId("lineage-chip-schema")).not.toBeNull();
    expect(screen.getByTestId("lineage-chip-asset-type")).not.toBeNull();
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
