import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("../../hooks/useLineage", () => ({
  useLineage: vi.fn(),
}));

import { useLineage } from "../../hooks/useLineage";
import { useLineageGraphV2 } from "./useLineageGraphV2";

describe("useLineageGraphV2", () => {
  beforeEach(() => {
    useLineage.mockReset();
  });

  it("returns the empty shape when there is no payload", () => {
    useLineage.mockReturnValue({ payload: null, loading: false, error: "", refresh: () => null });
    const { result } = renderHook(() => useLineageGraphV2("a.b.c"));
    expect(result.current.focus).toBeNull();
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
    expect(result.current.hydrating).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("flips hydrating=true when the payload reports profile=initial", () => {
    useLineage.mockReturnValue({
      payload: {
        profile: "initial",
        meta: { state: "loading", capabilities: { hydrating: true } },
        stats: { progressive: { tableLineageDeferred: true } },
        graphs: { data: { nodes: [{ id: "focus-a.b.c", role: "focus", assetFqn: "a.b.c" }], edges: [] } },
      },
      loading: false,
      error: "",
      refresh: () => null,
    });
    const { result } = renderHook(() => useLineageGraphV2("a.b.c"));
    expect(result.current.hydrating).toBe(true);
    expect(result.current.focus?.fqn).toBe("a.b.c");
  });

  it("merges graphs.data.meta (truncation, flags, emptyReason) into graph.meta", () => {
    // Adversarial verify P1: the API ships truncation totals + directional
    // flags at graphs.data.meta, while the envelope meta rides at
    // payload.meta. Consumers read graph.meta, so the adapter must merge
    // both — envelope keys winning on collision.
    useLineage.mockReturnValue({
      payload: {
        profile: "full",
        meta: { state: "available", warnings: [] },
        graphs: {
          data: {
            nodes: [{ id: "focus-a.b.c", role: "focus", assetFqn: "a.b.c" }],
            edges: [],
            meta: {
              truncation: { nodesShown: 21, nodesTotal: 660, edgesShown: 20, edgesTotal: 659 },
              upstreamTruncated: true,
              downstreamTruncated: false,
              emptyReason: "",
              lineageQueryFailed: false,
              graphDepthLimit: 1,
              // A data-graph "state" (hypothetical collision) must NOT
              // override the envelope's authoritative state.
              state: "should-not-win",
            },
          },
        },
      },
      loading: false,
      error: "",
      refresh: () => null,
    });
    const { result } = renderHook(() => useLineageGraphV2("a.b.c"));
    expect(result.current.meta.truncation).toEqual({
      nodesShown: 21,
      nodesTotal: 660,
      edgesShown: 20,
      edgesTotal: 659,
    });
    expect(result.current.meta.upstreamTruncated).toBe(true);
    expect(result.current.meta.downstreamTruncated).toBe(false);
    expect(result.current.meta.graphDepthLimit).toBe(1);
    expect(result.current.meta.state).toBe("available");
  });

  it("normalizes nodes with rowCount + freshness + isOpenable + columns", () => {
    useLineage.mockReturnValue({
      payload: {
        profile: "full",
        meta: { state: "available" },
        graphs: {
          data: {
            nodes: [
              {
                id: "focus-a.b.c",
                assetFqn: "a.b.c",
                role: "focus",
                kind: "Delta Table",
                rowCount: 1247835,
                freshness: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2h ago
                owners: [{ displayName: "Alice" }, { displayName: "Bob" }],
                columns: [
                  { name: "id", type: "BIGINT" },
                  { name: "amount", type: "DECIMAL" },
                ],
                totalColumns: 12,
                details: { isOpenable: true, certification: "Certified", sensitivity: "Confidential" },
              },
              {
                id: "u1",
                assetFqn: "raw.x.y",
                role: "source",
                kind: "table",
                details: { isOpenable: false, resolutionState: "lineage-only" },
              },
            ],
            edges: [{ id: "e1", source: "u1", target: "focus-a.b.c" }],
          },
        },
      },
      loading: false,
      error: "",
      refresh: () => null,
    });
    const { result } = renderHook(() => useLineageGraphV2("a.b.c"));
    expect(result.current.nodes).toHaveLength(2);
    const focus = result.current.focus;
    expect(focus.fqn).toBe("a.b.c");
    expect(focus.rowCount).toBe("1.2M");
    expect(focus.freshness).toBe("2h ago");
    expect(focus.kind).toBe("table");
    expect(focus.isCertified).toBe(true);
    expect(focus.classification).toBe("Confidential");
    expect(focus.totalColumns).toBe(12);
    expect(focus.columns).toHaveLength(2);
    const upstream = result.current.nodes.find((n) => n.fqn === "raw.x.y");
    // Preserve backend openability: lineage-only nodes can stay in lineage
    // context without opening a hollow Asset 360 record.
    expect(upstream.isOpenable).toBe(false);
    expect(upstream.lineageOnly).toBe(true);
    expect(result.current.edges).toEqual([
      expect.objectContaining({ source: "u1", target: "focus-a.b.c" }),
    ]);
  });
});
