import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks/useAssetDetail", () => ({ useAssetDetail: vi.fn() }));
vi.mock("../hooks/useAssetDatabricksEvidence", () => ({ useAssetDatabricksEvidence: vi.fn() }));
vi.mock("../hooks/useAssetQuality", () => ({ useAssetQuality: vi.fn() }));
vi.mock("../hooks/useAssetSearch", () => ({ useAssetSearch: vi.fn() }));
vi.mock("../hooks/useAccessExplain", () => ({ useAccessExplain: vi.fn() }));
vi.mock("../hooks/useColumnLineageTrace", () => ({ useColumnLineageTrace: vi.fn() }));
vi.mock("../hooks/useLineageRecommendations", () => ({ useLineageRecommendations: vi.fn() }));
vi.mock("../hooks/useSeededAssetContext", () => ({ useSeededAssetContext: vi.fn() }));
vi.mock("../lib/api", () => ({ createGovernanceRequest: vi.fn() }));
vi.mock("./lineage-v2/useLineageGraphV2", () => ({ useLineageGraphV2: vi.fn() }));
vi.mock("./lineage-v2/useLineageNodeHeaders", () => ({ useLineageNodeHeaders: vi.fn(() => ({ headers: {} })) }));
vi.mock("./lineage-v2/LineageCanvasV2", () => ({
  LineageCanvasV2: ({ focusId, onColumnSelect, onFocusChange, graph }) => (
    <div data-testid="canvas-v2">
      <span>focus={focusId}</span>
      <span>nodes={graph?.nodes?.length || 0}</span>
      <button data-testid="canvas-pick-upstream" onClick={() => onFocusChange("a.b.upstream")} type="button">
        click upstream
      </button>
      <button
        data-testid="canvas-pick-column"
        onClick={() => onColumnSelect?.({ fqn: focusId }, { name: "mortgage_amount", type: "DECIMAL" })}
        type="button"
      >
        click column
      </button>
    </div>
  ),
}));

import LineageWorkspace from "./LineageWorkspace";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetDatabricksEvidence } from "../hooks/useAssetDatabricksEvidence";
import { useAssetQuality } from "../hooks/useAssetQuality";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useAccessExplain } from "../hooks/useAccessExplain";
import { useColumnLineageTrace } from "../hooks/useColumnLineageTrace";
import { useLineageRecommendations } from "../hooks/useLineageRecommendations";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { createGovernanceRequest } from "../lib/api";
import { useLineageGraphV2 } from "./lineage-v2/useLineageGraphV2";

const baseBootstrap = {
  capabilities: { tableLineage: { available: true, state: "available" } },
  featureFlags: [{ key: "table_lineage_surface", enabled: true }],
};
const baseRuntimeFeatureFlags = [{ key: "table_lineage_surface", enabled: true }];
const baseWorkspaceAccess = { canUseLineage: true, mode: "obo-available" };

beforeEach(() => {
  useAssetDetail.mockReset();
  useAssetDatabricksEvidence.mockReset();
  useAssetQuality.mockReset();
  useAssetSearch.mockReset();
  useAccessExplain.mockReset();
  useColumnLineageTrace.mockReset();
  useLineageRecommendations.mockReset();
  useSeededAssetContext.mockReset();
  useLineageGraphV2.mockReset();
  createGovernanceRequest.mockReset();
  useAssetDetail.mockReturnValue({ detail: null, loading: false, error: "" });
  useAssetDatabricksEvidence.mockReturnValue({
    loading: false,
    error: "",
    available: false,
    qualityMonitoring: {},
    profileMetrics: {},
    lakeflow: {},
    pipelineEvents: {},
    provenance: [],
  });
  useAssetQuality.mockReturnValue({
    loading: false,
    error: "",
    runs: [],
    results: [],
    available: false,
    summaryBacked: false,
    summary: { passed: 0, failed: 0, errored: 0, skipped: 0 },
  });
  useAssetSearch.mockReturnValue({ assets: [], loading: false, resolvedQuery: "" });
  useAccessExplain.mockReturnValue({ loading: false, error: "", data: null });
  useColumnLineageTrace.mockReturnValue({
    loading: false,
    upstream: null,
    downstream: null,
    upstreamError: "",
    downstreamError: "",
  });
  useLineageRecommendations.mockReturnValue({
    loading: false,
    error: "",
    items: [],
    meta: null,
    envelopeMeta: null,
    authoritative: null,
    degraded: false,
    visibilityScope: "",
    relationshipVisibilityScope: "",
  });
  useSeededAssetContext.mockReturnValue({ summary: null });
  useLineageGraphV2.mockReturnValue({
    focus: null,
    nodes: [],
    edges: [],
    columnEdges: [],
    columnLineage: { upstream: [], downstream: [], meta: {} },
    edgeDetails: {},
    stats: {},
    payload: null,
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

  it("opens the top actor-scoped high-lineage recommendation from the default lineage route", async () => {
    useLineageRecommendations.mockReturnValue({
      loading: false,
      error: "",
      items: [
        {
          fqn: "a.b.rich",
          name: "rich",
          catalogName: "a",
          schemaName: "b",
          edgeCount: 12,
          upstreamCount: 5,
          downstreamCount: 7,
          source: "system.access.table_lineage",
        },
      ],
      meta: { source: "system.access.table_lineage" },
      envelopeMeta: { authoritative: true, visibilityScope: "actor-scoped" },
      authoritative: true,
      degraded: false,
      visibilityScope: "actor-scoped",
      relationshipVisibilityScope: "",
    });
    const onRouteAssetChange = vi.fn();
    render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        onRouteAssetChange={onRouteAssetChange}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    await waitFor(() => {
      expect(onRouteAssetChange).toHaveBeenCalledWith("a.b.rich", "Data Lineage");
    });
  });

  it("renders the v2 canvas + hero when an asset is focused", () => {
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [{ id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" }],
      edges: [],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage" },
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

  it("does not fetch quality evidence for a lineage focus outside actor-visible inventory", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus" },
      loading: false,
      error: "",
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [{ id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" }],
      edges: [],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage" },
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
        sharedVisibleAssetSet={new Set(["a.b.other"])}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    expect(useAssetQuality).toHaveBeenCalledWith("a.b.focus", { enabled: false });
    expect(useAssetDatabricksEvidence).toHaveBeenCalledWith("a.b.focus", { enabled: false });
  });

  it("fetches quality evidence when the lineage focus is actor-visible", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus" },
      loading: false,
      error: "",
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [{ id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" }],
      edges: [],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage" },
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
        sharedVisibleAssetSet={new Set(["a.b.focus"])}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    expect(useAssetQuality).toHaveBeenCalledWith("a.b.focus", { enabled: true });
    expect(useAssetDatabricksEvidence).toHaveBeenCalledWith("a.b.focus", { enabled: true });
  });

  it("propagates canvas onFocusChange through onRouteAssetChange", () => {
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus" },
      nodes: [{ id: "f", fqn: "a.b.focus" }],
      edges: [],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage" },
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

  it("shows honest zero-edge recommendations for a dead lineage asset", () => {
    useLineageRecommendations.mockReturnValue({
      loading: false,
      error: "",
      items: [
        {
          fqn: "a.b.rich",
          name: "rich",
          catalogName: "a",
          schemaName: "b",
          edgeCount: 12,
          upstreamCount: 5,
          downstreamCount: 7,
          source: "system.access.table_lineage",
        },
      ],
      meta: { source: "system.access.table_lineage" },
      envelopeMeta: { authoritative: true, visibilityScope: "actor-scoped" },
      authoritative: true,
      degraded: false,
      visibilityScope: "actor-scoped",
      relationshipVisibilityScope: "",
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [{ id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" }],
      edges: [],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage" },
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
    expect(screen.getByText("No actor-visible lineage edges returned for this asset.")).toBeTruthy();
    fireEvent.click(screen.getByText("rich"));
    expect(onRouteAssetChange).toHaveBeenCalledWith("a.b.rich", "Data Lineage");
  });

  it("traces a selected column through the inspector column tab", () => {
    useColumnLineageTrace.mockReturnValue({
      loading: false,
      upstream: { nodes: [{ id: "root", assetFqn: "a.b.focus", column: "mortgage_amount" }] },
      downstream: null,
      upstreamError: "",
      downstreamError: "Column lineage requires per-user authorization (OBO).",
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [{ id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" }],
      edges: [],
      columnEdges: [{ column: "mortgage_amount" }],
      columnLineage: {
        upstream: [{ column: "mortgage_amount", sources: [{ assetFqn: "raw.loan", column: "amount" }] }],
        downstream: [],
        meta: {},
      },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage" },
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
    fireEvent.click(screen.getByTestId("canvas-pick-column"));
    fireEvent.click(screen.getByRole("tab", { name: "Columns" }));
    expect(screen.getByText("mortgage_amount on a.b.focus")).toBeTruthy();
    expect(screen.getByText("Column lineage requires per-user authorization (OBO).")).toBeTruthy();
  });

  it("does not report zero quality issues when quality evidence is unavailable", () => {
    useAssetQuality.mockReturnValue({
      loading: false,
      error: "",
      runs: [],
      results: [],
      available: false,
      summaryBacked: false,
      summary: { passed: 0, failed: 0, errored: 0, skipped: 0 },
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [
        { id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" },
        { id: "d", fqn: "a.b.down", role: "downstream", label: "down" },
      ],
      edges: [{ id: "e", source: "f", target: "d" }],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage", authoritative: true },
      hydrating: false,
      loading: false,
      error: "",
      meta: { source: "unity-catalog-lineage", authoritative: true, visibilityScope: "actor-scoped" },
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
    expect(screen.getByText("Quality issues")).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Quality failures\/errors returned: 0/i)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByText(/quality-runner/)).toBeTruthy();
    expect(screen.getAllByText(/unavailable/).length).toBeGreaterThan(0);
  });

  it("does not promote an empty quality API payload to available quality evidence", () => {
    useAssetQuality.mockReturnValue({
      loading: false,
      error: "",
      runs: [],
      results: [],
      available: true,
      summaryBacked: false,
      summary: { passed: 0, failed: 0, errored: 0, skipped: 0 },
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [
        { id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" },
        { id: "d", fqn: "a.b.down", role: "downstream", label: "down" },
      ],
      edges: [{ id: "e", source: "f", target: "d" }],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage", authoritative: true },
      hydrating: false,
      loading: false,
      error: "",
      meta: { source: "unity-catalog-lineage", authoritative: true, visibilityScope: "actor-scoped" },
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

    expect(screen.getByText("Quality issues")).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 Atlas run(s) · DQM unavailable")).toBeNull();
  });

  it("labels aggregate recommendation fallback without contradicting actor scope", () => {
    useLineageRecommendations.mockReturnValue({
      loading: false,
      error: "",
      items: [
        {
          fqn: "a.b.rich",
          name: "rich",
          catalogName: "a",
          schemaName: "b",
          edgeCount: 12,
          upstreamCount: 5,
          downstreamCount: 7,
          source: "system.access.table_lineage",
        },
      ],
      meta: { source: "system.access.table_lineage" },
      envelopeMeta: { authoritative: false, visibilityScope: "actor-scoped" },
      authoritative: false,
      degraded: true,
      visibilityScope: "actor-scoped",
      relationshipVisibilityScope: "actor-openable-candidate-aggregate",
    });

    render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        runtimeFeatureFlags={baseRuntimeFeatureFlags}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );

    expect(screen.getByText(/Candidate assets were verified openable for actor-scoped/i)).toBeTruthy();
    expect(screen.queryByText(/workspace-scoped Databricks lineage because actor-scoped/i)).toBeNull();
  });

  it("surfaces backed Databricks quality and Lakeflow evidence in the impact inspector", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus", openRequests: 1 },
      loading: false,
      error: "",
    });
    useAssetDatabricksEvidence.mockReturnValue({
      loading: false,
      error: "",
      available: true,
      qualityMonitoring: {
        state: "available",
        source: "system.data_quality_monitoring.table_results",
        rows: [{ event_time: "2026-05-05T01:00:00Z", status: "Healthy" }],
        summary: {
          healthStatus: "Healthy",
          freshnessStatus: "Healthy",
          completenessStatus: "Healthy",
        },
      },
      profileMetrics: {
        state: "available",
        source: "system.information_schema.tables",
        rows: [{ table_name: "focus_profile_metrics" }],
        summary: { lookupMethod: "data_quality.get_monitor" },
      },
      lakeflow: {
        state: "available",
        source: "system.lakeflow",
        jobs: [{ job_id: "job-1", job_name: "daily refresh", result_state: "SUCCESS" }],
        pipelines: [],
      },
      pipelineEvents: { state: "empty", source: "event_log", rows: [] },
      provenance: ["system.data_quality_monitoring.table_results", "system.lakeflow.jobs"],
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [
        { id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" },
        { id: "d", fqn: "a.b.down", role: "downstream", label: "down", kind: "job" },
      ],
      edges: [{ id: "e", source: "f", target: "d" }],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: {} },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage", authoritative: true },
      hydrating: false,
      loading: false,
      error: "",
      meta: { source: "unity-catalog-lineage", authoritative: true, visibilityScope: "actor-scoped" },
      refresh: () => null,
    });
    render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        initialAssetFqn="a.b.focus"
        runtimeFeatureFlags={baseRuntimeFeatureFlags}
        sharedVisibleAssetSet={new Set(["a.b.focus"])}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    expect(screen.getByText("DQM health")).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText(/daily refresh/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByText(/system.data_quality_monitoring.table_results/)).toBeTruthy();
    expect(screen.getByText(/system.lakeflow/)).toBeTruthy();
  });

  it("creates a backed governance request from the impact brief action", async () => {
    createGovernanceRequest.mockResolvedValue({ requestId: "req-123" });
    useAssetQuality.mockReturnValue({
      loading: false,
      error: "",
      runs: [{ run_id: "run-1" }],
      results: [{ result_id: "result-1", outcome: "failed" }],
      available: true,
      summaryBacked: true,
      summary: { passed: 0, failed: 1, errored: 0, skipped: 0 },
    });
    useLineageGraphV2.mockReturnValue({
      focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b" },
      nodes: [
        { id: "f", fqn: "a.b.focus", isFocus: true, label: "focus" },
        { id: "d", fqn: "a.b.down", role: "downstream", label: "down", kind: "job" },
      ],
      edges: [{ id: "e", source: "f", target: "d" }],
      columnEdges: [],
      columnLineage: { upstream: [], downstream: [], meta: { truncated: false } },
      edgeDetails: {},
      stats: {},
      payload: { source: "unity-catalog-lineage", authoritative: true },
      hydrating: false,
      loading: false,
      error: "",
      meta: { source: "unity-catalog-lineage", authoritative: true, visibilityScope: "actor-scoped" },
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
    fireEvent.click(screen.getByRole("button", { name: "Create request" }));
    await waitFor(() => {
      expect(createGovernanceRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          assetFqn: "a.b.focus",
          title: expect.stringContaining("Lineage impact review"),
          note: expect.stringContaining("Quality failures/errors returned: 1"),
        }),
        { fast: true },
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Governance request created: req-123")).toBeTruthy();
    });
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
