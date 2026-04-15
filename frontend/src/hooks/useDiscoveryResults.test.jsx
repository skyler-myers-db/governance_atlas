import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGovhubQueryClient } from "../lib/queryClient";
import { useDiscoveryResults } from "./useDiscoveryResults";

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

describe("useDiscoveryResults", () => {
  beforeEach(() => {
    fetchDiscoverySearchMock.mockReset();
  });

  it("keeps seeded discovery data provisional until the live query resolves", async () => {
    fetchDiscoverySearchMock.mockResolvedValue({
      assets: [{ fqn: "main.sales.authoritative" }],
      count: 1,
      facets: {
        catalogs: [{ value: "main", count: 1 }],
      },
    });
    const seededAssets = [{ fqn: "main.sales.seeded" }];

    const { result } = renderHook(
      () =>
        useDiscoveryResults(
          {
            query: "",
            views: [],
            types: [],
            catalogs: [],
            domains: [],
            tiers: [],
            certifications: [],
            sensitivities: [],
            sortBy: "Best match",
          },
          seededAssets,
        ),
      {
        wrapper: createWrapper(),
      },
    );

    expect(result.current.assets).toEqual(seededAssets);
    expect(result.current.authoritative).toBe(false);

    await waitFor(() => {
      expect(fetchDiscoverySearchMock).toHaveBeenCalledTimes(1);
      expect(result.current.authoritative).toBe(true);
      expect(result.current.assets).toEqual([{ fqn: "main.sales.authoritative" }]);
    });

    expect(fetchDiscoverySearchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("does not reuse stale prior results as placeholder data when filters change", async () => {
    fetchDiscoverySearchMock
      .mockResolvedValueOnce({
        assets: [{ fqn: "main.sales.authoritative" }],
        count: 1,
        facets: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise(() => {}),
      );

    const { result, rerender } = renderHook(
      ({ query }) =>
        useDiscoveryResults(
          {
            query,
            views: [],
            types: [],
            catalogs: [],
            domains: [],
            tiers: [],
            certifications: [],
            sensitivities: [],
            sortBy: "Best match",
          },
          [],
        ),
      {
        initialProps: { query: "" },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.authoritative).toBe(true);
      expect(result.current.assets).toEqual([{ fqn: "main.sales.authoritative" }]);
    });

    rerender({ query: "finance" });

    expect(result.current.authoritative).toBe(false);
    expect(result.current.assets).toEqual([]);
  });
});
