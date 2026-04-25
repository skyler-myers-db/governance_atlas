import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasQueryClient } from "../lib/queryClient";
import { useCommandCenter } from "./useCommandCenter";

const fetchCommandCenterMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchCommandCenter: (...args) => fetchCommandCenterMock(...args),
}));

function createWrapper() {
  const queryClient = createAtlasQueryClient();
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useCommandCenter", () => {
  beforeEach(() => {
    fetchCommandCenterMock.mockReset();
  });

  it("returns normalized command center data when fetch resolves", async () => {
    fetchCommandCenterMock.mockResolvedValue({
      estate: {
        visibleAssetCount: 12,
        catalogCount: 2,
        openRequests: 3,
        coverageScore: 82,
      },
      kpis: [],
      meta: { state: "available", warnings: [] },
    });

    const { result } = renderHook(() => useCommandCenter(true), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchCommandCenterMock).toHaveBeenCalledTimes(1);
    expect(fetchCommandCenterMock.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data.estate.visibleAssetCount).toBe(12);
    expect(result.current.degraded).toBe(false);
  });

  it("stays idle when disabled", () => {
    const { result } = renderHook(() => useCommandCenter(false), {
      wrapper: createWrapper(),
    });

    expect(fetchCommandCenterMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data.estate.visibleAssetCount).toBeNull();
  });

  it("surfaces an error when fetch fails without seed data", async () => {
    fetchCommandCenterMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCommandCenter(true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBe("boom");
    });
    expect(result.current.data.estate.visibleAssetCount).toBeNull();
  });

  it("keeps seed data and reports refreshError when fetch fails", async () => {
    fetchCommandCenterMock.mockRejectedValue(new Error("refresh failed"));
    const seedData = {
      estate: {
        visibleAssetCount: 7,
        catalogCount: 1,
        openRequests: 0,
        coverageScore: 70,
      },
      meta: { state: "available", warnings: [] },
    };

    const { result } = renderHook(
      () => useCommandCenter({ enabled: true, seedData }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.refreshError).toBe("refresh failed");
    });
    expect(result.current.error).toBe("");
    expect(result.current.data.estate.visibleAssetCount).toBe(7);
    expect(result.current.degraded).toBe(true);
  });

  it("refreshActorScope sends refresh flag on next fetch", async () => {
    fetchCommandCenterMock.mockResolvedValue({
      estate: { visibleAssetCount: 1 },
      meta: { state: "degraded", warnings: ["fallback"] },
    });

    const { result } = renderHook(() => useCommandCenter(true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(fetchCommandCenterMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      result.current.refreshActorScope();
    });

    await waitFor(() => {
      expect(fetchCommandCenterMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchCommandCenterMock.mock.calls[1][0].refresh).toBe(true);
  });
});
