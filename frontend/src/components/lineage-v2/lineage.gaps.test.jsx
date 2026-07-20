/**
 * Regression tests for the lineage "incomplete product" gap fixes.
 *
 * L1  — quality/evidence gate trusts the hydrated asset header, not the
 *       bootstrap seed set.
 * L2  — rail Details reuses the batch-fetched node header for selected
 *       non-focus nodes instead of "Unavailable".
 * L3  — the canvas header map is seeded with the focus asset's detail.
 * L4/L9 — card foot renders backend loading / restricted status lines muted.
 * L5  — decision packet no longer spams "Unavailable: no … returned" rows.
 * L6  — hero chips show loading placeholders, never "… unavailable" flashes.
 * L10 — Details tab lazily fetches + renders recorded activity.
 * L12 — non-numeric counts render "—", never "Unavailable edges".
 * L13 — zero counts are annotated with the visibility scope.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../hooks/useAssetDetail", () => ({ useAssetDetail: vi.fn() }));
vi.mock("../../hooks/useAssetDatabricksEvidence", () => ({ useAssetDatabricksEvidence: vi.fn() }));
vi.mock("../../hooks/useAssetQuality", () => ({ useAssetQuality: vi.fn() }));
vi.mock("../../hooks/useAssetSearch", () => ({ useAssetSearch: vi.fn() }));
vi.mock("../../hooks/useAccessExplain", () => ({ useAccessExplain: vi.fn() }));
vi.mock("../../hooks/useColumnLineageTrace", () => ({ useColumnLineageTrace: vi.fn() }));
vi.mock("../../hooks/useLineageRecommendations", () => ({ useLineageRecommendations: vi.fn() }));
vi.mock("../../hooks/useSeededAssetContext", () => ({ useSeededAssetContext: vi.fn() }));
vi.mock("../../lib/api", () => ({ createGovernanceRequest: vi.fn(), fetchAssetHeaders: vi.fn() }));
vi.mock("./useLineageGraphV2", () => ({ useLineageGraphV2: vi.fn() }));
vi.mock("./useLineageNodeHeaders", () => ({ useLineageNodeHeaders: vi.fn() }));
vi.mock("./LineageCanvasV2", () => ({
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

import LineageWorkspace from "../LineageWorkspace";
import { LineageNodeCard, deriveCardStats } from "./LineageNodeCard";
import { useAssetDetail } from "../../hooks/useAssetDetail";
import { useAssetDatabricksEvidence } from "../../hooks/useAssetDatabricksEvidence";
import { useAssetQuality } from "../../hooks/useAssetQuality";
import { useAssetSearch } from "../../hooks/useAssetSearch";
import { useAccessExplain } from "../../hooks/useAccessExplain";
import { useColumnLineageTrace } from "../../hooks/useColumnLineageTrace";
import { useLineageRecommendations } from "../../hooks/useLineageRecommendations";
import { useSeededAssetContext } from "../../hooks/useSeededAssetContext";
import { useLineageGraphV2 } from "./useLineageGraphV2";
import { useLineageNodeHeaders } from "./useLineageNodeHeaders";

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
  useAssetSearch.mockReset();
  useAccessExplain.mockReset();
  useColumnLineageTrace.mockReset();
  useLineageRecommendations.mockReset();
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
  useLineageGraphV2.mockReturnValue(baseGraph());
  useLineageNodeHeaders.mockReturnValue({ headers: new Map(), loading: false });
});

function renderWorkspace(props = {}) {
  return render(
    <LineageWorkspace
      bootstrap={baseBootstrap}
      initialAssetFqn="a.b.focus"
      runtimeFeatureFlags={baseRuntimeFeatureFlags}
      workspaceAccess={baseWorkspaceAccess}
      {...props}
    />,
  );
}

describe("LineageNodeCard status foot lines (L4/L9)", () => {
  const bareNode = {
    id: "n",
    fqn: "a.b.n",
    label: "n",
    kind: "table",
    apiKind: "",
    rowCount: null,
    freshness: "",
    owners: [],
    ownerCount: 0,
    recentActivityCount: 0,
    columns: [],
  };

  it("renders the restricted foot line muted (single line, L9)", () => {
    const { container } = render(
      <LineageNodeCard node={{ ...bareNode, isOpenable: false, foot: ["Not visible to your account"] }} />,
    );
    const line = screen.getByText("Not visible to your account");
    expect(line.className).toContain("is-empty");
    expect(container.querySelectorAll(".ga-lineage-v2-card-foot .is-empty")).toHaveLength(1);
  });

  it("renders the cold-cache loading foot line muted (L4)", () => {
    render(<LineageNodeCard node={{ ...bareNode, foot: ["Loading metadata…"] }} />);
    const line = screen.getByText("Loading metadata…");
    expect(line.className).toContain("is-empty");
  });
});

describe("deriveCardStats header derivation (L2 helper)", () => {
  it("derives rows/size/owner from a batch header and skips placeholders", () => {
    const stats = deriveCardStats(
      { apiKind: "Table", owners: [] },
      {
        rows: "8.4M",
        size: "1.1 GiB",
        files: "—",
        owners: [{ displayName: "Peer Owner" }],
        managementType: "Managed",
        objectType: "Table",
      },
    );
    expect(stats.rowCount).toBe("8.4M");
    expect(stats.size).toBe("1.1 GiB");
    expect(stats.files).toBeNull(); // "—" placeholder suppressed
    expect(stats.ownerLabel).toBe("Peer Owner");
    expect(stats.typeLabel).toBe("Managed · Table");
  });
});

describe("LineageWorkspace gap fixes", () => {
  it("L1: fetches quality evidence once the header hydrates even when the bootstrap seed set excludes the focus", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus" },
      loading: false,
      error: "",
    });
    renderWorkspace({ sharedVisibleAssetSet: new Set(["a.b.other"]) });
    expect(useAssetQuality).toHaveBeenCalledWith("a.b.focus", { enabled: true });
    expect(useAssetDatabricksEvidence).toHaveBeenCalledWith("a.b.focus", { enabled: true });
  });

  it("L3: seeds the canvas header map with the focus asset detail", () => {
    useAssetDetail.mockReturnValue({
      detail: { fqn: "a.b.focus", name: "focus", rows: "4.2M" },
      loading: false,
      error: "",
    });
    renderWorkspace();
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
    renderWorkspace();
    fireEvent.click(screen.getByTestId("pick-upstream"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("8.4M")).toBeTruthy();
    expect(screen.getByText("Peer Owner")).toBeTruthy();
    expect(screen.getByText("Managed · Table")).toBeTruthy();
  });

  it("L5: the decision packet never renders 'Unavailable: no …' jargon or an approval-blockers row", () => {
    renderWorkspace();
    expect(screen.queryByText(/Unavailable: no/)).toBeNull();
    expect(screen.queryByText(/Approval blockers/)).toBeNull();
    expect(screen.getByText(/No policies linked/)).toBeTruthy();
    expect(screen.getByText(/No controls linked/)).toBeTruthy();
  });

  it("L6: hero chips show loading placeholders while the header loads — never '… unavailable'", () => {
    useAssetDetail.mockReturnValue({ detail: null, loading: true, error: "" });
    renderWorkspace();
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
    renderWorkspace();
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
    renderWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("UPDATE")).toBeTruthy();
    expect(screen.getByText("2026-07-01 10:00")).toBeTruthy();
    expect(screen.queryByText("No recent lineage activity returned.")).toBeNull();
  });

  it("L10: a genuinely empty activity fetch renders a short honest empty", () => {
    useAssetDetail.mockReturnValue({ detail: { fqn: "a.b.focus" }, loading: false, error: "" });
    renderWorkspace();
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
    renderWorkspace();
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
    const { container } = render(
      <LineageWorkspace
        bootstrap={baseBootstrap}
        runtimeFeatureFlags={baseRuntimeFeatureFlags}
        workspaceAccess={baseWorkspaceAccess}
      />,
    );
    expect(container.textContent).toContain("— edges");
    expect(container.textContent).not.toContain("Unavailable edges");
  });
});
