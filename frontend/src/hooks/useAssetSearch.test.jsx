import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGovhubQueryClient } from "../lib/queryClient";
import { useAssetSearch } from "./useAssetSearch";

const fetchDiscoverySearchMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchDiscoverySearch: (...args) => fetchDiscoverySearchMock(...args),
}));

function createWrapper() {
  const queryClient = createGovhubQueryClient();
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAssetSearch", () => {
  beforeEach(() => {
    fetchDiscoverySearchMock.mockReset();
  });

  it("indexes seeded assets and merges them with the live search response", async () => {
    fetchDiscoverySearchMock.mockResolvedValue({
      assets: [{ fqn: "main.sales.authoritative" }],
      count: 1,
    });

    const seedAssets = [{ fqn: "main.sales.seeded", name: "Seeded Orders" }];

    const { result } = renderHook(() => useAssetSearch("seeded", true, seedAssets), {
      wrapper: createWrapper(),
    });

    expect(result.current.assets[0]?.fqn).toBe("main.sales.seeded");

    await waitFor(() => {
      expect(fetchDiscoverySearchMock).toHaveBeenCalledTimes(1);
      expect(result.current.assets[0]?.fqn).toBe("main.sales.authoritative");
    });

    expect(fetchDiscoverySearchMock.mock.calls[0][0]).toEqual({
      query: "seeded",
      sortBy: "Best match",
      limit: 8,
    });
    expect(fetchDiscoverySearchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("does not expose stale seeded matches after the query changes", async () => {
    fetchDiscoverySearchMock
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise(() => {}));

    const seedAssets = [{ fqn: "main.sales.seeded", name: "Seeded Orders" }];

    const { result, rerender } = renderHook(({ query }) => useAssetSearch(query, true, seedAssets), {
      initialProps: { query: "seeded" },
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.assets[0]?.fqn).toBe("main.sales.seeded");
    });

    rerender({ query: "customers" });

    expect(result.current.resolvedQuery).toBe("customers");
    expect(result.current.assets).toEqual([]);
  });
});
