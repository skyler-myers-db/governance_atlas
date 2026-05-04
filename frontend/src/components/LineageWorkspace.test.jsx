import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../hooks/useAssetDetail", () => ({ useAssetDetail: vi.fn() }));
vi.mock("../hooks/useAssetSearch", () => ({ useAssetSearch: vi.fn() }));
vi.mock("../hooks/useSeededAssetContext", () => ({ useSeededAssetContext: vi.fn() }));
vi.mock("./lineage-v2/useLineageGraphV2", () => ({ useLineageGraphV2: vi.fn() }));
vi.mock("./lineage-v2/LineageCanvasV2", () => ({
  LineageCanvasV2: ({ focusId, onFocusChange, graph }) => (
    <div data-testid="canvas-v2">
      <span>focus={focusId}</span>
      <span>nodes={graph?.nodes?.length || 0}</span>
      <button data-testid="canvas-pick-upstream" onClick={() => onFocusChange("a.b.upstream")} type="button">
        click upstream
      </button>
    </div>
  ),
}));

import LineageWorkspace from "./LineageWorkspace";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { useLineageGraphV2 } from "./lineage-v2/useLineageGraphV2";

const baseBootstrap = {
  capabilities: { tableLineage: { available: true, state: "available" } },
  featureFlags: [{ key: "table_lineage_surface", enabled: true }],
};
const baseRuntimeFeatureFlags = [{ key: "table_lineage_surface", enabled: true }];
const baseWorkspaceAccess = { canUseLineage: true, mode: "obo-available" };

beforeEach(() => {
  useAssetDetail.mockReset();
  useAssetSearch.mockReset();
  useSeededAssetContext.mockReset();
  useLineageGraphV2.mockReset();
  useAssetDetail.mockReturnValue({ detail: null, loading: false, error: "" });
  useAssetSearch.mockReturnValue({ assets: [], loading: false, resolvedQuery: "" });
  useSeededAssetContext.mockReturnValue({ summary: null });
  useLineageGraphV2.mockReturnValue({
    focus: null,
    nodes: [],
    edges: [],
    columnEdges: [],
    hydrating: false,
    loading: false,
    error: "",
    meta: null,
    refresh: () => null,
  });
});

describe("LineageWorkspace (v2)", () => {
  it("renders the empty-state hero when no asset is selected", () => {
    render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    expect(screen.getByText("Trace the path of any governed asset")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search for an asset")).toBeTruthy();
    expect(screen.getByText("Node types")).toBeTruthy();
  });

  it("offers asset suggestions in the empty-state search", () => {
    useAssetSearch.mockReturnValue({
      assets: [{ fqn: "a.b.c", name: "c", catalogName: "a", schemaName: "b" }],
      loading: false,
      resolvedQuery: "c",
    });
    const onRouteAssetChange = vi.fn();
    render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        onRouteAssetChange={onRouteAssetChange}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    fireEvent.click(screen.getByText("c"));
    expect(onRouteAssetChange).toHaveBeenCalledWith("a.b.c", "Data Lineage");
  });

  it("renders the v2 canvas + hero when an asset is focused", () => {
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [{ id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" }],
      edges: [],
      columnEdges: [],
      hydrating: false,
      loading: false,
      error: "",
      meta: null,
      refresh: () => null,
    });
    render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        initialAssetFqn="a.b.focus"
        runtimeFeatureFlags={baseRuntimeFeatureFlags}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    expect(screen.getByTestId("canvas-v2")).toBeTruthy();
    expect(screen.getByText("focus=a.b.focus")).toBeTruthy();
    expect(screen.getByText("nodes=1")).toBeTruthy();
  });

  it("propagates canvas onFocusChange through onRouteAssetChange", () => {
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus" },
      nodes: [{ id: "f", fqn: "a.b.focus" }],
      edges: [],
      columnEdges: [],
      hydrating: false,
      loading: false,
      error: "",
      meta: null,
      refresh: () => null,
    });
    const onRouteAssetChange = vi.fn();
    render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        initialAssetFqn="a.b.focus"
        onRouteAssetChange={onRouteAssetChange}
        runtimeFeatureFlags={baseRuntimeFeatureFlags}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    fireEvent.click(screen.getByTestId("canvas-pick-upstream"));
    expect(onRouteAssetChange).toHaveBeenCalledWith("a.b.upstream", "Data Lineage");
  });

  it("shows the unavailable error state when lineage surface is gated off", () => {
    render(
      <LineageWorkspace
        bootstrap={{ capabilities: { tableLineage: { available: false, reason: "Not granted" } } }}
        initialAssetFqn="a.b.focus"
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    expect(screen.getByText("Lineage unavailable")).toBeTruthy();
  });
});
