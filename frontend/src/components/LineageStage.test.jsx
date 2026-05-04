import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LineageStage from "./LineageStage";

vi.mock("./LineageGraph", () => ({
  default: () => <div data-testid="lineage-graph" />,
}));

const asset = {
  fqn: "main.sales.orders",
  name: "orders",
  catalog: "main",
  schema: "sales",
  objectType: "Table",
  description: "Order fulfillment facts.",
  owners: [{ name: "sales-steward@example.com", title: "Business Owner" }],
};

const graphBundle = {
  data: {
    nodes: [
      {
        id: "raw",
        assetFqn: "main.raw.orders_raw",
        label: "orders_raw",
        subtitle: "main / raw",
        kind: "Source",
        stage: "source",
        hop: 1,
      },
      {
        id: "bronze",
        assetFqn: "main.bronze.orders_raw",
        label: "orders_raw",
        subtitle: "main / bronze",
        kind: "Table",
        stage: "upstream",
        hop: 2,
      },
      {
        id: "job",
        assetFqn: "jobs.orders_refine",
        label: "orders_refine",
        subtitle: "Lakeflow",
        kind: "Job / Pipeline",
        stage: "transform",
        hop: 3,
      },
      {
        id: "focus",
        assetFqn: asset.fqn,
        label: "orders",
        subtitle: "main / sales",
        role: "focus",
        kind: "Table",
        columns: [{ name: "order_id" }, { name: "customer_id" }],
      },
      {
        id: "mart",
        assetFqn: "main.analytics.orders_mart",
        label: "orders_mart",
        subtitle: "main / analytics",
        kind: "Dashboard",
        stage: "downstream",
        hop: 1,
      },
    ],
    edges: [
      { id: "raw-bronze", source: "raw", target: "bronze" },
      { id: "bronze-job", source: "bronze", target: "job" },
      { id: "job-focus", source: "job", target: "focus" },
      { id: "focus-mart", source: "focus", target: "mart" },
    ],
  },
  operational: { nodes: [], edges: [] },
};

function renderStage(overrides = {}) {
  return render(
    <LineageStage
      asset={asset}
      context="Data Lineage"
      error=""
      graphBundle={graphBundle}
      lineagePayload={{
        stats: {
          upstreamCount: 1,
          downstreamCount: 1,
          confidenceScore: 92,
          qualityScore: 97,
          limits: { tableLineage: 25 },
          truncated: { upstream: true, downstream: false, columnLineage: true },
        },
        columnLineage: {
          upstream: [
            {
              column: "net_revenue_usd",
              sourceColumn: "gross_revenue_usd",
              sourceAsset: "main.raw.orders_raw",
            },
          ],
          downstream: [],
        },
        impactAnalysis: [
          {
            id: "finance-board",
            title: "Finance Board Dashboard",
            detail: "Finance Stewards - used in last 24h",
            tone: "High impact",
          },
        ],
      }}
      loading={false}
      onAssetSearchQueryChange={() => {}}
      onContextChange={() => {}}
      onOpenAsset={() => {}}
      onOpenGovernance={() => {}}
      onSelectAsset={() => {}}
      {...overrides}
    />,
  );
}

describe("LineageStage", () => {
  it("renders the North Star full-page lineage explorer regions", () => {
    renderStage();

    expect(screen.getByTestId("lineage-northstar-explorer")).not.toBeNull();
    expect(screen.getByText("Lineage Atlas")).not.toBeNull();
    expect(screen.getByText("main.sales.orders")).not.toBeNull();
    expect(screen.getByText("Owner: sales-steward@example.com")).not.toBeNull();
    expect(screen.getByText("2 Hops Upstream")).not.toBeNull();
    expect(screen.getByText("1 Hop Upstream")).not.toBeNull();
    expect(screen.getByText("Processing Context")).not.toBeNull();
    expect(screen.getByText("Focus")).not.toBeNull();
    expect(screen.getByText("1 Hop Downstream")).not.toBeNull();
    expect(screen.getByText("Impact analysis")).not.toBeNull();
    expect(screen.getByText("Column lineage · net_revenue_usd")).not.toBeNull();
    expect(
      screen.getByText("Limited to 25 table edges. Column lineage may be partial or unavailable in this workspace."),
    ).not.toBeNull();
  });

  it("preserves graph-shaped loading structure while live lineage evidence refreshes", () => {
    renderStage({
      graphBundle: {
        data: { nodes: [], edges: [] },
        operational: { nodes: [], edges: [] },
      },
      loading: true,
    });

    const loadingGraph = screen.getByTestId("lineage-loading-graph");
    expect(loadingGraph).not.toBeNull();
    expect(within(loadingGraph).getByText("Loading lineage graph")).not.toBeNull();
    expect(within(loadingGraph).getByText("Upstream")).not.toBeNull();
    expect(within(loadingGraph).getByText("Current asset")).not.toBeNull();
  });

  it("keeps full-route refresh degradation compact instead of inserting a graph-shifting banner", () => {
    const { container } = renderStage({ error: "Lineage API returned cached topology while refresh failed." });

    expect(screen.getByText("Refresh degraded")).not.toBeNull();
    expect(screen.getByText("Refresh degraded - current table topology remains visible.")).not.toBeNull();
    expect(container.querySelector(".ga-lineage-notice-stack .gh-inline-status-banner")).toBeNull();
  });

  it("draws topology connector paths from the returned graph edges", () => {
    const { container } = renderStage();

    const edgePaths = [...container.querySelectorAll("[data-testid='lineage-topology-edge']")];
    expect(edgePaths).toHaveLength(graphBundle.data.edges.length);
    expect(edgePaths.map((path) => `${path.getAttribute("data-edge-source")}->${path.getAttribute("data-edge-target")}`)).toEqual([
      "raw->bronze",
      "bronze->job",
      "job->focus",
      "focus->mart",
    ]);
    edgePaths.forEach((path) => {
      expect(path.getAttribute("d")).toMatch(/^M\d+ \d+ C/);
    });
  });

  it("keeps table and column lineage controls interactive", () => {
    const onIncludeColumnsChange = vi.fn();
    renderStage({ onIncludeColumnsChange });

    fireEvent.click(screen.getByTestId("lineage-column-mode"));
    expect(onIncludeColumnsChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Column lineage view active.")).not.toBeNull();

    fireEvent.click(screen.getByTestId("lineage-table-mode"));
    expect(onIncludeColumnsChange).toHaveBeenCalledWith(false);
    expect(screen.getByText("Table lineage view active.")).not.toBeNull();
  });

  it("pans the North Star lineage canvas by dragging empty graph space", () => {
    renderStage();

    const graphBody = screen.getByTestId("lineage-graph-body");
    fireEvent.mouseDown(graphBody, {
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.mouseMove(graphBody, {
      clientX: 142,
      clientY: 118,
    });
    fireEvent.mouseUp(graphBody, {
      clientX: 142,
      clientY: 118,
    });

    expect(graphBody.style.getPropertyValue("--ga-lineage-pan-x")).toBe("42px");
    expect(graphBody.style.getPropertyValue("--ga-lineage-pan-y")).toBe("18px");
    expect(screen.getByText("Lineage graph panned.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Fit graph" }));
    expect(graphBody.style.getPropertyValue("--ga-lineage-pan-x")).toBe("0px");
    expect(graphBody.style.getPropertyValue("--ga-lineage-pan-y")).toBe("0px");
  });

  it("zooms the North Star lineage canvas with the mouse wheel", () => {
    renderStage();

    const graphBody = screen.getByTestId("lineage-graph-body");
    fireEvent.wheel(graphBody, { deltaY: -100 });
    expect(graphBody.style.getPropertyValue("--ga-lineage-zoom")).toBe("1.05");
    expect(screen.getByText("Lineage graph zoom set to 105%.")).not.toBeNull();

    fireEvent.wheel(graphBody, { deltaY: 100 });
    expect(graphBody.style.getPropertyValue("--ga-lineage-zoom")).toBe("1");
    expect(screen.getByText("Lineage graph zoom set to 100%.")).not.toBeNull();
  });

  it("pans from graph nodes without breaking click selection", () => {
    const { container } = renderStage();

    const graphBody = screen.getByTestId("lineage-graph-body");
    const rawNode = Array.from(container.querySelectorAll(".ga-lineage-node"))
      .find((node) => node.textContent.includes("orders_raw"));
    expect(rawNode).not.toBeNull();
    fireEvent.click(rawNode);
    expect(screen.getByText("orders_raw selected.")).not.toBeNull();

    fireEvent.mouseDown(rawNode, {
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.mouseMove(graphBody, {
      clientX: 136,
      clientY: 120,
    });
    fireEvent.mouseUp(graphBody, {
      clientX: 136,
      clientY: 120,
    });

    expect(graphBody.style.getPropertyValue("--ga-lineage-pan-x")).toBe("36px");
    expect(graphBody.style.getPropertyValue("--ga-lineage-pan-y")).toBe("20px");
    expect(screen.getByText("Lineage graph panned.")).not.toBeNull();
  });

  it("searches graph nodes and exports current graph evidence from the toolbar", () => {
    const createObjectURL = vi.fn(() => "blob:lineage-evidence");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;
    const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
    vi.useFakeTimers();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
    window.HTMLAnchorElement.prototype.click = vi.fn();

    try {
      renderStage();

      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      const searchInput = screen.getByLabelText("Search graph");
      fireEvent.change(searchInput, { target: { value: "orders_raw" } });
      fireEvent.click(screen.getByRole("button", { name: "Clear graph search" }));
      expect(searchInput.value).toBe("");
      expect(screen.getByText("Graph search cleared.")).not.toBeNull();
      fireEvent.change(searchInput, { target: { value: "orders_raw" } });
      fireEvent.keyDown(searchInput, { key: "Enter" });
      expect(screen.getByText("orders_raw selected.")).not.toBeNull();
      fireEvent.click(screen.getAllByRole("button", { name: /orders_raw/ })[0]);
      expect(screen.getByText("orders_raw selected.")).not.toBeNull();
      fireEvent.keyDown(searchInput, { key: "Escape" });
      expect(screen.queryByLabelText("Search graph")).toBeNull();
      expect(screen.getByText("Graph search closed.")).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Export" }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:lineage-evidence");
      expect(screen.getByText("Lineage evidence export generated from the current graph.")).not.toBeNull();
    } finally {
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
      window.HTMLAnchorElement.prototype.click = originalAnchorClick;
      vi.useRealTimers();
    }
  });

  it("surfaces no-result graph search status on keyboard submit", () => {
    renderStage();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const searchInput = screen.getByLabelText("Search graph");
    fireEvent.change(searchInput, { target: { value: "no_such_node" } });
    expect(screen.getByText("No visible graph nodes match this search.")).not.toBeNull();
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(screen.getByText('No visible graph nodes match "no_such_node".')).not.toBeNull();
  });

  it("opens backed edge detail from click and keyboard selection", () => {
    const { container } = renderStage();

    const edgeHit = container.querySelector("[data-testid='lineage-topology-edge-hit']");
    expect(edgeHit).not.toBeNull();
    fireEvent.click(edgeHit);
    expect(screen.getByText("Lineage Edge")).not.toBeNull();
    expect(screen.getAllByText((content) => content.includes("orders_raw") && content.includes(" to ")).length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.includes("Lineage edge from orders_raw") && content.includes("selected.")).length).toBeGreaterThan(0);

    const secondEdgeHit = container.querySelectorAll("[data-testid='lineage-topology-edge-hit']")[1];
    fireEvent.keyDown(secondEdgeHit, { key: "Enter" });
    expect(screen.getAllByText((content) => content.includes("orders_raw") && content.includes("orders_refine")).length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.includes("Lineage edge from orders_raw") && content.includes("orders_refine") && content.includes("selected.")).length).toBeGreaterThan(0);
  });

  it("keeps hidden authoritative toolbar controls out of non-authoritative lineage", () => {
    renderStage({
      authoritative: false,
      lineagePayload: {
        meta: { state: "unavailable", source: "lineage-unavailable" },
        stats: {
          upstreamCount: 1,
          downstreamCount: 1,
        },
        columnLineage: {
          upstream: [
            {
              column: "net_revenue_usd",
              sourceColumn: "gross_revenue_usd",
              sourceAsset: "finance_prod.curated.revenue_daily",
            },
          ],
          downstream: [],
        },
        impactAnalysis: [
          {
            id: "finance-board",
            title: "Finance Board Dashboard",
            detail: "Finance Stewards - used in last 24h",
            tone: "High impact",
          },
        ],
      },
    });

    expect(screen.queryByRole("button", { name: "Compare versions" })).toBeNull();
    expect(screen.queryByTestId("lineage-table-mode")).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();

    const impact = screen.getByRole("button", { name: "Run impact analysis" });
    expect(impact.disabled).toBe(false);
    expect(impact.getAttribute("title")).toMatch(/honest unavailable state/i);
    fireEvent.click(impact);
    expect(screen.getByText(/Impact analysis opened with an honest unavailable state/i)).not.toBeNull();

    const column = screen.getByRole("button", { name: "Column lineage" });
    expect(column.disabled).toBe(true);
    expect(column.getAttribute("title")).toMatch(/requires backed live column proof/i);

    const refocus = screen.getByRole("button", { name: "Refocus graph" });
    expect(refocus.disabled).toBe(true);
    expect(refocus.getAttribute("title")).toMatch(/requires backed live lineage evidence/i);
  });

  it("keeps backed workspace-scoped lineage graph controls visible without actor-visible authority", () => {
    renderStage({
      authoritative: false,
      lineagePayload: {
        meta: {
          state: "live",
          source: "unity-catalog-lineage",
          visibilityScope: "workspace-app-principal",
          authoritative: false,
        },
        stats: {
          upstreamCount: 1,
          downstreamCount: 1,
        },
        columnLineage: {
          upstream: [
            {
              column: "net_revenue_usd",
              sourceColumn: "gross_revenue_usd",
              sourceAsset: "finance_prod.curated.revenue_daily",
            },
          ],
          downstream: [],
        },
      },
    });

    expect(screen.getByTestId("lineage-table-mode")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Search" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).not.toBeNull();
    expect(screen.getByText("Workspace-scoped table lineage ready.")).not.toBeNull();
    expect(screen.getByText("Workspace-scoped Databricks lineage; actor-visible proof unavailable")).not.toBeNull();
  });

  it("does not label live-unavailable lineage as local evidence", () => {
    renderStage({
      authoritative: false,
      asset: null,
      error: "Asset exists but is not visible in the current workspace scope.",
      graphBundle: { data: { nodes: [], edges: [] }, operational: { nodes: [], edges: [] } },
      lineagePayload: null,
      overlay: <div>Pick another asset to continue.</div>,
    });

    expect(screen.getByText("0 nodes · 0 edges")).not.toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("No live graph")).not.toBeNull();
    expect(screen.getByText("live column lineage unavailable")).not.toBeNull();
    expect(screen.queryByText("19 nodes · 19 edges")).toBeNull();
    expect(screen.queryByText("2026-04-27")).toBeNull();
    expect(screen.queryByText(/No live topology returned/)).not.toBeNull();
  });

  it("routes authoritative lineage actions", () => {
    const onOpenAsset = vi.fn();
    const onOpenGovernance = vi.fn();
    const onSelectAsset = vi.fn();
    renderStage({ onOpenAsset, onOpenGovernance, onSelectAsset });

    fireEvent.click(screen.getByRole("button", { name: "Open asset" }));
    expect(onOpenAsset).toHaveBeenCalledWith(asset.fqn, "Overview");

    fireEvent.click(screen.getByRole("button", { name: "Review owners" }));
    expect(onOpenGovernance).toHaveBeenCalledWith(asset.fqn);

    fireEvent.click(screen.getByRole("button", { name: "Refocus graph" }));
    expect(onSelectAsset).toHaveBeenCalledWith(asset.fqn);
  });

  it("keeps lineage as-of control disabled until a backed as-of action is advertised", () => {
    renderStage();

    const unavailableAsOf = screen.getByRole("button", { name: /Unavailable/i });
    expect(unavailableAsOf.disabled).toBe(true);
    expect(unavailableAsOf.getAttribute("title")).toMatch(/requires backed live lineage evidence/i);
    expect(screen.queryByText("Lineage time selection reset to now.")).toBeNull();
  });

  it("refreshes current live lineage from the as-of control when a backed callback is provided", async () => {
    const onRefreshLineage = vi.fn().mockResolvedValue({
      fqn: asset.fqn,
      graphs: graphBundle,
    });
    renderStage({ onRefreshLineage });

    fireEvent.click(screen.getByRole("button", { name: "Now" }));

    expect(onRefreshLineage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Refreshing current live lineage...")).not.toBeNull();
    expect(await screen.findByText("Lineage refreshed to current live graph.")).not.toBeNull();
  });

  it("keeps lineage-only selected nodes visible but disables open/refocus actions", () => {
    const onOpenAsset = vi.fn();
    const onSelectAsset = vi.fn();
    renderStage({
      graphBundle: {
        ...graphBundle,
        data: {
          ...graphBundle.data,
          nodes: graphBundle.data.nodes.map((node) =>
            node.id === "raw"
              ? {
                  ...node,
                  details: {
                    isOpenable: false,
                    resolutionState: "lineage-only",
                  },
                }
              : node,
          ),
        },
      },
      onOpenAsset,
      onSelectAsset,
    });

    fireEvent.click(screen.getAllByText("main / raw")[0].closest("button"));
    expect(screen.getByText("orders_raw selected.")).not.toBeNull();

    const openAsset = screen.getByRole("button", { name: "Open asset" });
    expect(openAsset.disabled).toBe(true);
    expect(openAsset.getAttribute("title")).toMatch(/not openable/);
    fireEvent.click(openAsset);
    expect(onOpenAsset).not.toHaveBeenCalled();

    const refocusGraph = screen.getByRole("button", { name: "Refocus graph" });
    expect(refocusGraph.disabled).toBe(true);
    expect(refocusGraph.getAttribute("title")).toMatch(/not openable/);
    fireEvent.click(refocusGraph);
    expect(onSelectAsset).not.toHaveBeenCalled();
  });

  it("routes unverified lineage references so the destination can render a truthful state", () => {
    const onOpenAsset = vi.fn();
    const onSelectAsset = vi.fn();
    renderStage({
      graphBundle: {
        ...graphBundle,
        data: {
          ...graphBundle.data,
          nodes: graphBundle.data.nodes.map((node) =>
            node.id === "raw"
              ? {
                  ...node,
                  details: {
                    isOpenable: false,
                    openabilityState: "unverified",
                    resolutionState: "lineage-only",
                  },
                }
              : node,
          ),
        },
      },
      onOpenAsset,
      onSelectAsset,
    });

    fireEvent.click(screen.getAllByText("main / raw")[0].closest("button"));

    const openAsset = screen.getByRole("button", { name: "Open asset" });
    expect(openAsset.disabled).toBe(false);
    fireEvent.click(openAsset);
    expect(onOpenAsset).toHaveBeenCalledWith("main.raw.orders_raw", "Overview");

    const refocusGraph = screen.getByRole("button", { name: "Refocus graph" });
    expect(refocusGraph.disabled).toBe(false);
    fireEvent.click(refocusGraph);
    expect(onSelectAsset).toHaveBeenCalledWith("main.raw.orders_raw");
  });

  it("labels authoritative no-edge lineage as queried without live-ready wording", () => {
    renderStage({
      graphBundle: {
        data: {
          nodes: [graphBundle.data.nodes.find((node) => node.id === "focus")],
          edges: [],
        },
        operational: { nodes: [], edges: [] },
      },
      lineagePayload: {
        generatedAt: "2026-05-01T12:02:52Z",
        stats: {
          upstreamCount: 0,
          downstreamCount: 0,
        },
        columnLineage: { upstream: [], downstream: [] },
        impactAnalysis: [],
      },
    });

	    expect(screen.getAllByText("2026-05-01").length).toBeGreaterThanOrEqual(1);
	    expect(screen.getByText("No visible edges")).not.toBeNull();
	    expect(screen.getByText("queried")).not.toBeNull();
	    const unavailableAsOf = screen.getByRole("button", { name: /Unavailable/i });
	    expect(unavailableAsOf.disabled).toBe(true);
	    expect(unavailableAsOf.getAttribute("title")).toMatch(/requires backed live lineage evidence/i);
	    expect(screen.getByText("Live table lineage query returned no visible edges.")).not.toBeNull();
	    expect(screen.queryByText("Today")).toBeNull();
	    expect(screen.queryByText("Now")).toBeNull();
	    expect(screen.queryByText("Authoritative table lineage - ready")).toBeNull();
	  });

  it("selects graph nodes, impact rows, restricted rows, and column lineage rows", () => {
    renderStage({
      lineagePayload: {
        stats: {
          upstreamCount: 1,
          downstreamCount: 1,
          hiddenDownstreamCount: 4,
          limits: { tableLineage: 25 },
          truncated: { upstream: true, downstream: false, columnLineage: true },
        },
        columnLineage: {
          upstream: [
            {
              column: "net_revenue_usd",
              sourceColumn: "gross_revenue_usd",
              sourceAsset: "main.raw.orders_raw",
            },
          ],
          downstream: [],
        },
        impactAnalysis: [
          {
            id: "finance-board",
            title: "Finance Board Dashboard",
            detail: "Finance Stewards - used in last 24h",
            tone: "High impact",
          },
        ],
      },
    });

    fireEvent.click(screen.getAllByText("main / raw")[0].closest("button"));
    expect(screen.getByText("orders_raw selected.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Finance Board Dashboard/ }));
    expect(screen.getByText(/Finance Board Dashboard selected/)).not.toBeNull();
    expect(screen.getByLabelText("Lineage workflow detail")).not.toBeNull();
    expect(screen.getByText(/Backed downstream impact evidence|Consumer-impact workflow/)).not.toBeNull();
    expect(screen.getByText(/Finance Stewards · used in last 24h/)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /4 downstream assets/ }));
    expect(screen.getByText(/4 downstream assets selected/)).not.toBeNull();
    expect(screen.getByText(/Consumer-impact workflow|Permission-boundary detail workflow/)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /gross_revenue_usd/ }));
    expect(screen.getByText(/net_revenue_usd column lineage row selected/)).not.toBeNull();
    expect(screen.getByText(/Source column gross_revenue_usd|Column-lineage detail workflow/)).not.toBeNull();
  });

  it("keeps embedded LineageStage on the existing graph path", () => {
    renderStage({ embedded: true });

    expect(screen.getByTestId("lineage-graph")).not.toBeNull();
    expect(screen.queryByTestId("lineage-northstar-explorer")).toBeNull();
  });
});
