import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasQueryClient } from "../lib/queryClient";
import { useGapAnalysis } from "./useGapAnalysis";

const fetchGapAnalysisMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchGapAnalysis: (...args) => fetchGapAnalysisMock(...args),
}));

function createWrapper() {
  const queryClient = createAtlasQueryClient();
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useGapAnalysis", () => {
  beforeEach(() => {
    fetchGapAnalysisMock.mockReset();
  });

  it("returns tiles and lanes once the fetch resolves", async () => {
    fetchGapAnalysisMock.mockResolvedValue({
      tiles: {
        ownershipGaps: 3,
        policyGaps: 7,
        freshnessGaps: 2,
        qualityIncidents: 1,
        totalAssets: 50,
      },
      lanes: {
        ownership: [{ assetFqn: "a.b.c", assetName: "c", gapReason: "No owners", gapKind: "ownership", objectType: "Table", evidence: [], remediation: { label: "Assign owner", href: "/governance?lane=ownership&asset=a.b.c" } }],
        policy: [],
        freshness: [],
        quality: [],
      },
      lanesOrder: ["ownership", "policy", "freshness", "quality"],
      qualitySignalAvailable: true,
      meta: { state: "available" },
    });

    const { result } = renderHook(() => useGapAnalysis(true), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(fetchGapAnalysisMock).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tiles.ownershipGaps).toBe(3);
    expect(result.current.tiles.policyGaps).toBe(7);
    expect(result.current.lanes.ownership).toHaveLength(1);
    expect(result.current.lanes.ownership[0].assetFqn).toBe("a.b.c");
    expect(result.current.lanesOrder).toEqual([
      "ownership",
      "policy",
      "freshness",
      "quality",
    ]);
    expect(typeof result.current.refresh).toBe("function");
    expect(fetchGapAnalysisMock.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(fetchGapAnalysisMock.mock.calls[0][0].limit).toBe(200);
  });

  it("surfaces error on fetch failure", async () => {
    fetchGapAnalysisMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useGapAnalysis(true), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.error).toBe("boom");
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.tiles.ownershipGaps).toBe(0);
    expect(result.current.lanes.ownership).toEqual([]);
  });

  it("stays idle when disabled", () => {
    const { result } = renderHook(() => useGapAnalysis(false), {
      wrapper: createWrapper(),
    });
    expect(fetchGapAnalysisMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.tiles.totalAssets).toBe(0);
    expect(result.current.lanes.quality).toEqual([]);
  });

  it("respects custom limit option", async () => {
    fetchGapAnalysisMock.mockResolvedValue({
      tiles: {
        ownershipGaps: 0,
        policyGaps: 0,
        freshnessGaps: 0,
        qualityIncidents: 0,
        totalAssets: 0,
      },
      lanes: { ownership: [], policy: [], freshness: [], quality: [] },
    });
    const { result } = renderHook(() => useGapAnalysis({ enabled: true, limit: 50 }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetchGapAnalysisMock.mock.calls[0][0].limit).toBe(50);
  });
});
