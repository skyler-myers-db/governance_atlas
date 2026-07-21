/**
 * Regression tests for the lineage "incomplete product" gap fixes, ported
 * from components/lineage-v2/lineage.gaps.test.jsx when the legacy
 * LineageWorkspace was deleted (Wave C7). The LineageNodeCard /
 * deriveCardStats blocks stayed with the kit; the workspace-level gaps
 * (L1/L2/L3/L5/L6/L10/L12/L13) now assert against LineagePage.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../hooks/useAssetDetail", () => ({ useAssetDetail: vi.fn() }));
vi.mock("../../../hooks/useAssetDatabricksEvidence", () => ({ useAssetDatabricksEvidence: vi.fn() }));
vi.mock("../../../hooks/useAssetQuality", () => ({ useAssetQuality: vi.fn() }));
vi.mock("../../../hooks/useAccessExplain", () => ({ useAccessExplain: vi.fn() }));
vi.mock("../../../hooks/useColumnLineageTrace", () => ({ useColumnLineageTrace: vi.fn() }));
vi.mock("../../../hooks/useLineageRecommendations", () => ({ useLineageRecommendations: vi.fn() }));
vi.mock("../../../hooks/usePaletteSearch", () => ({ usePaletteSearch: vi.fn() }));
vi.mock("../../../hooks/useSeededAssetContext", () => ({ useSeededAssetContext: vi.fn() }));
vi.mock("../../../lib/api", () => ({ createGovernanceRequest: vi.fn(), fetchAssetHeaders: vi.fn() }));
vi.mock("../../../components/lineage-v2/useLineageGraphV2", () => ({ useLineageGraphV2: vi.fn() }));
vi.mock("../../../components/lineage-v2/useLineageNodeHeaders", () => ({ useLineageNodeHeaders: vi.fn() }));
vi.mock("../../../components/lineage-v2/LineageCanvasV2", () => ({
  LineageCanvasV2: ({ focusId, nodeHeaders, onFocusChange }) => (
    <div data-testid="canvas-v2-gaps">
      <span data-testid="focus-header-rows">
        {nodeHeaders?.get?.(focusId)?.rows || "none"}
      </span>
      <button data-testid="pick-upstream" onClick={() => onFocusChange("a.b.upstream")} type="button">
        pick upstream
      </button>
    </div>
  ),
}));

import LineagePage from "../LineagePage.jsx";
import { useAssetDetail } from "../../../hooks/useAssetDetail";
import { useAssetDatabricksEvidence } from "../../../hooks/useAssetDatabricksEvidence";
import { useAssetQuality } from "../../../hooks/useAssetQuality";
import { useAccessExplain } from "../../../hooks/useAccessExplain";
import { useColumnLineageTrace } from "../../../hooks/useColumnLineageTrace";
import { useLineageRecommendations } from "../../../hooks/useLineageRecommendations";
import { usePaletteSearch } from "../../../hooks/usePaletteSearch";
import { useSeededAssetContext } from "../../../hooks/useSeededAssetContext";
import { useLineageGraphV2 } from "../../../components/lineage-v2/useLineageGraphV2";
import { useLineageNodeHeaders } from "../../../components/lineage-v2/useLineageNodeHeaders";

const baseBootstrap = {
  capabilities: { tableLineage: { available: true, state: "available" } },
  featureFlags: [{ key: "table_lineage_surface", enabled: true }],
};
const baseRuntimeFeatureFlags = [{ key: "table_lineage_surface", enabled: true }];
const baseWorkspaceAccess = { canUseLineage: true, mode: "obo-available" };

function baseGraph(overrides = {}) {
  return {
    focus: { id: "f", fqn: "a.b.focus", label: "focus", subtitle: "a / b", isFocus: true },
    nodes: [
      { id: "f", fqn: "a.b.focus", isFocus: true, label: "focus", subtitle: "a / b" },
      { id: "u", fqn: "a.b.upstream", label: "upstream", subtitle: "a / b", kind: "table", role: "upstream" },
    ],
    edges: [{ id: "e", source: "u", target: "f" }],
    columnEdges: [],
    columnLineage: { upstream: [], downstream: [], meta: {} },
    edgeDetails: {},
    stats: {},
    payload: { source: "unity-catalog-lineage", authoritative: true },
    hydrating: false,
    warming: false,
    loading: false,
    error: "",
    meta: { source: "unity-catalog-lineage", authoritative: true, visibilityScope: "actor-scoped" },
    refresh: () => null,
    ...overrides,
  };
}

beforeEach(() => {
  useAssetDetail.mockReset();
  useAssetDatabricksEvidence.mockReset();
  useAssetQuality.mockReset();
  useAccessExplain.mockReset();
  useColumnLineageTrace.mockReset();
  useLineageRecommendations.mockReset();
  usePaletteSearch.mockReset();
  useSeededAssetContext.mockReset();
  useLineageGraphV2.mockReset();
  useLineageNodeHeaders.mockReset();
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
  usePaletteSearch.mockReturnValue({
    assets: [],
    glossaryTerms: [],
    searching: false,
    searchError: "",
    resolvedQuery: "",
  });
  useSeededAssetContext.mockReturnValue({ summary: null });
  useLineageGraphV2.mockReturnValue(baseGraph());
  useLineageNodeHeaders.mockReturnValue({ headers: new Map(), loading: false });
});

function renderLineage(initialEntry = "/lineage/a.b.focus") {
  const page = (
    <LineagePage
      bootstrap={baseBootstrap}
      runtimeFeatureFlags={baseRuntimeFeatureFlags}
      workspaceAccess={baseWorkspaceAccess}
    />
  );
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={page} path="/lineage/*" />
        <Route element={page} path="/lineage" />
        <Route element={null} path="*" />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LineagePage gap fixes", () => {
  it("L1: fetches quality evidence once the header hydrates (live header is the visibility proof)", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus" },
      loading: false,
      error: "",
    });
    renderLineage();
    expect(useAssetQuality).toHaveBeenCalledWith("a.b.focus", { enabled: true });
    expect(useAssetDatabricksEvidence).toHaveBeenCalledWith("a.b.focus", { enabled: true });
  });

  it("L3: seeds the canvas header map with the focus asset detail", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus", rows: "4.2M" },
      loading: false,
      error: "",
    });
    renderLineage();
    expect(screen.getByTestId("focus-header-rows").textContent).toBe("4.2M");
  });

  it("L2: rail Details shows the batch header stats for a selected non-focus node", () => {
    useLineageNodeHeaders.mockReturnValue({
      headers: new Map([
        [
          "a.b.upstream",
          {
            fqn: "a.b.upstream",
            rows: "8.4M",
            size: "1.1 GiB",
            owners: [{ displayName: "Peer Owner" }],
            objectType: "Table",
            managementType: "Managed",
          },
        ],
      ]),
      loading: false,
    });
    renderLineage();
    fireEvent.click(screen.getByTestId("pick-upstream"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("8.4M")).toBeTruthy();
    expect(screen.getByText("Peer Owner")).toBeTruthy();
    expect(screen.getByText("Managed · Table")).toBeTruthy();
  });

  it("L5: the decision packet never renders 'Unavailable: no …' jargon or an approval-blockers row", () => {
    renderLineage();
    expect(screen.queryByText(/Unavailable: no/)).toBeNull();
    expect(screen.queryByText(/Approval blockers/)).toBeNull();
    expect(screen.getByText(/No policies linked/)).toBeTruthy();
    expect(screen.getByText(/No controls linked/)).toBeTruthy();
  });

  it("L6: hero chips show loading placeholders while the header loads — never '… unavailable'", () => {
    useAssetDetail.mockReturnValue({ detail: null, loading: true, error: "" });
    renderLineage();
    expect(screen.getByText("Certification …")).toBeTruthy();
    expect(screen.queryByText(/Certification unavailable/)).toBeNull();
    expect(screen.queryByText(/Owner unavailable/)).toBeNull();
    expect(screen.queryByText("Not certified")).toBeNull();
  });

  it("L6: a resolved header renders honest empties instead of 'unavailable'", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus" },
      loading: false,
      error: "",
    });
    renderLineage();
    expect(screen.getByText("Not certified")).toBeTruthy();
    expect(screen.queryByText(/Certification unavailable/)).toBeNull();
  });

  it("L10: the Details tab lazily fetches and renders recorded activity", () => {
    useAssetDetail.mockImplementation((fqn, options = {}) => {
      if ((options.sections || []).includes("activity")) {
        return {
          detail: {
            fqn: "a.b.focus",
            activity: [{ kind: "UPDATE", timestamp: "2026-07-01 10:00" }],
          },
          loading: false,
          error: "",
        };
      }
      return { detail: { fqn: "a.b.focus", name: "focus" }, loading: false, error: "" };
    });
    renderLineage();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("UPDATE")).toBeTruthy();
    expect(screen.getByText("2026-07-01 10:00")).toBeTruthy();
    expect(screen.queryByText("No recent lineage activity returned.")).toBeNull();
  });

  it("L10: a genuinely empty activity fetch renders a short honest empty", () => {
    useAssetDetail.mockReturnValue({ detail: { fqn: "a.b.focus" }, loading: false, error: "" });
    renderLineage();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("No recorded activity.")).toBeTruthy();
  });

  it("L13: zero downstream counts are annotated with the visibility scope", () => {
    useLineageGraphV2.mockReturnValue(
      baseGraph({
        nodes: [{ id: "f", fqn: "a.b.focus", isFocus: true, label: "focus", subtitle: "a / b" }],
        edges: [],
      }),
    );
    renderLineage();
    expect(
      screen.getByText("No downstream consumers returned for this asset within your visibility scope."),
    ).toBeTruthy();
  });

  it("L12: non-numeric recommendation counts render a dash, never 'Unavailable edges'", () => {
    useLineageRecommendations.mockReturnValue({
      loading: false,
      error: "",
      items: [
        {
          fqn: "a.b.rich",
          name: "rich",
          catalogName: "a",
          schemaName: "b",
          // edgeCount intentionally missing → "—"
          upstreamCount: 2,
          downstreamCount: 3,
        },
      ],
      meta: null,
      envelopeMeta: null,
      authoritative: true,
      degraded: false,
      visibilityScope: "actor-scoped",
      relationshipVisibilityScope: "",
    });
    const { container } = renderLineage("/lineage");
    expect(container.textContent).toContain("— edges");
    expect(container.textContent).not.toContain("Unavailable edges");
  });
});
