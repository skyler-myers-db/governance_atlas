import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasQueryClient } from "../lib/queryClient";
import { useDiscoveryResults } from "./useDiscoveryResults";

const fetchDiscoverySearchMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchDiscoverySearch: (...args) => fetchDiscoverySearchMock(...args),
}));

function createWrapper() {
  const queryClient = createAtlasQueryClient();
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useDiscoveryResults", () => {
  beforeEach(() => {
    fetchDiscoverySearchMock.mockReset();
  });

  it("keeps discovery rows empty until the live query resolves", async () => {
    fetchDiscoverySearchMock.mockResolvedValue({
      assets: [{ fqn: "main.sales.authoritative" }],
      count: 1,
      facets: {
        catalogs: [{ value: "main", count: 1 }],
      },
    });

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
        ),
      {
        wrapper: createWrapper(),
      },
    );

    expect(result.current.assets).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.authoritative).toBe(false);

    await waitFor(() => {
      expect(fetchDiscoverySearchMock).toHaveBeenCalledTimes(1);
      expect(result.current.authoritative).toBe(true);
      expect(result.current.assets).toEqual([{ fqn: "main.sales.authoritative" }]);
      expect(result.current.requestKey).toBe(
        JSON.stringify({
          query: "",
          views: [],
          types: [],
          catalogs: [],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
          sortBy: "Best match",
        }),
      );
    });

    expect(fetchDiscoverySearchMock.mock.calls[0][0].limit).toBe(80);
    expect(fetchDiscoverySearchMock.mock.calls[0][0].queryMode).toBe("structured");
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
          {
            limit: 80,
          },
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

  it("keeps the last authoritative rows visible while the same discovery scope fetches a larger limit", async () => {
    fetchDiscoverySearchMock
      .mockResolvedValueOnce({
        assets: [{ fqn: "main.sales.authoritative" }],
        count: 150,
        facets: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise(() => {}),
      );

    const { result, rerender } = renderHook(
      ({ limit }) =>
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
          { limit },
        ),
      {
        initialProps: { limit: 80 },
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.authoritative).toBe(true);
      expect(result.current.assets).toEqual([{ fqn: "main.sales.authoritative" }]);
    });

    rerender({ limit: 120 });

    expect(result.current.loading).toBe(true);
    expect(result.current.authoritative).toBe(false);
    expect(result.current.assets).toEqual([{ fqn: "main.sales.authoritative" }]);
    expect(result.current.count).toBe(150);
    expect(result.current.requestKey).toBe(
      JSON.stringify({
        query: "",
        views: [],
        types: [],
        catalogs: [],
        domains: [],
        tiers: [],
        certifications: [],
        sensitivities: [],
        sortBy: "Best match",
      }),
    );

    expect(fetchDiscoverySearchMock).toHaveBeenCalledTimes(2);
    expect(fetchDiscoverySearchMock.mock.calls[1][0].limit).toBe(120);
  });

  it("surfaces structured invalid-query responses without treating them as runtime outages", async () => {
    fetchDiscoverySearchMock.mockRejectedValue(
      Object.assign(new Error("Unknown discovery field `workspace`."), {
        status: 400,
        payload: {
          detail: "Unknown discovery field `workspace`.",
          invalidQuery: {
            state: "invalid",
            message: "Unknown discovery field `workspace`.",
            syntaxHint:
              'Use AND, OR, parentheses, quoted phrases, and field:value selectors such as name:orders or domain:"Finance".',
            supportedFields: ["name", "fqn", "domain"],
          },
        },
      }),
    );

    const { result } = renderHook(
      () =>
        useDiscoveryResults({
          query: "workspace:main",
          views: [],
          types: [],
          catalogs: [],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
          sortBy: "Best match",
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.queryState?.state).toBe("invalid");
    });

    expect(result.current.assets).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.error).toBe("");
    expect(fetchDiscoverySearchMock.mock.calls[0][0].queryMode).toBe("structured");
  });

  it("preserves structured query clause chips from valid discovery responses", async () => {
    fetchDiscoverySearchMock.mockResolvedValue({
      assets: [{ fqn: "main.sales.authoritative" }],
      count: 1,
      facets: null,
      queryState: {
        state: "valid",
        syntaxHint: "Use field:value with AND/OR groups.",
        supportedFields: ["owner", "domain"],
        clauseChips: [
          {
            label: 'owner:"Mia Chen"',
            expression: 'owner:"Mia Chen"',
            nextQuery: "domain:(Finance OR Support)",
            removable: true,
          },
          {
            label: "domain:(Finance OR Support)",
            expression: "domain:(Finance OR Support)",
            nextQuery: 'owner:"Mia Chen"',
            removable: true,
          },
        ],
      },
    });

    const { result } = renderHook(
      () =>
        useDiscoveryResults({
          query: 'owner:"Mia Chen" AND domain:(Finance OR Support)',
          views: [],
          types: [],
          catalogs: [],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
          sortBy: "Best match",
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.authoritative).toBe(true);
      expect(result.current.queryState?.clauseChips).toEqual([
        {
          label: 'owner:"Mia Chen"',
          expression: 'owner:"Mia Chen"',
          nextQuery: "domain:(Finance OR Support)",
          removable: true,
        },
        {
          label: "domain:(Finance OR Support)",
          expression: "domain:(Finance OR Support)",
          nextQuery: 'owner:"Mia Chen"',
          removable: true,
        },
      ]);
    });
  });
});
