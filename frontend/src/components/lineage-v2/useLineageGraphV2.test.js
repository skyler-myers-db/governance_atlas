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
    // The adapter intentionally allows click navigation for any node with
    // a real FQN — backend's isOpenable / openabilityState / resolutionState
    // flags are conservative and over-flag visible nodes as "lineage-only".
    // The card surfaces a separate "Lineage only" chip for sparse references.
    expect(upstream.isOpenable).toBe(true);
    expect(upstream.lineageOnly).toBe(true);
    expect(result.current.edges).toEqual([
      expect.objectContaining({ source: "u1", target: "focus-a.b.c" }),
    ]);
  });
});
