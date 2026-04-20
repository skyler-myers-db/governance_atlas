import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiscoveryWorkspace } from "./useDiscoveryWorkspace";

const useDiscoveryResultsMock = vi.fn();

vi.mock("./useDiscoveryResults", () => ({
  useDiscoveryResults: (...args) => useDiscoveryResultsMock(...args),
}));

function sessionKey(bootstrap) {
  const userScope = bootstrap?.shell?.userEmail || bootstrap?.shell?.userName || "anonymous";
  return `gh.discovery.session.v1:${window.location.pathname}:${userScope}`;
}

function bootstrapPayload(overrides = {}) {
  return {
    shell: {
      userEmail: "admin@example.com",
    },
    discovery: {
      defaultQuery: "",
      sortOptions: ["Best match", "Recently updated"],
      views: ["All assets", "Needs review"],
      assetTypes: ["Table"],
      catalogs: ["sandbox"],
      domains: ["Legacy"],
      tiers: ["Bronze"],
      certifications: ["Draft"],
      sensitivities: ["Internal"],
    },
    ...overrides,
  };
}

describe("useDiscoveryWorkspace", () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    useDiscoveryResultsMock.mockReset();
    useDiscoveryResultsMock.mockReturnValue({
      authoritative: false,
      assets: [],
      count: 0,
      facets: {},
      loading: false,
      error: "",
      settled: false,
      resolvedQuery: "",
    });
  });

  it("keeps blank-route grouped filters authoritative instead of reviving session selections", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "orders",
        sortBy: "Recently updated",
        views: ["Needs review"],
        types: ["Materialized View"],
        catalogs: ["main"],
        domains: ["Finance"],
        tiers: ["Gold"],
        certifications: ["Certified"],
        sensitivities: ["PII"],
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        onRouteQueryChange: undefined,
      }),
    );

    expect(result.current.filters).toEqual({
      query: "",
      sortBy: "Best match",
      views: [],
      types: [],
      catalogs: [],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
    });
  });

  it("still normalizes saved views and sort options against bootstrap-owned shell configuration", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "",
        sortBy: "Coverage score",
        views: ["Missing view"],
        types: ["Table"],
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        onRouteQueryChange: undefined,
      }),
    );

    expect(result.current.filters.sortBy).toBe("Best match");
    expect(result.current.filters.views).toEqual([]);
    expect(result.current.filters.types).toEqual([]);
  });

  it("treats provided grouped route filters as authoritative over saved session filters", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "",
        sortBy: "Best match",
        views: [],
        types: ["Materialized View"],
        catalogs: ["sandbox"],
        domains: ["Legacy"],
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialFilterGroups: {
          types: ["Table"],
          catalogs: ["main"],
          domains: ["Finance"],
          tiers: [],
          certifications: [],
          sensitivities: [],
        },
        onRouteQueryChange: undefined,
        onRouteFilterGroupsChange: undefined,
      }),
    );

    expect(result.current.filters.types).toEqual(["Table"]);
    expect(result.current.filters.catalogs).toEqual(["main"]);
    expect(result.current.filters.domains).toEqual(["Finance"]);
    expect(result.current.filters.tiers).toEqual([]);
    expect(result.current.filters.certifications).toEqual([]);
    expect(result.current.filters.sensitivities).toEqual([]);
  });

  it("treats a provided route sort as authoritative over the saved session sort", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "",
        sortBy: "Best match",
        views: [],
        types: ["Table"],
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialSort: "Recently updated",
        onRouteQueryChange: undefined,
        onRouteSortChange: undefined,
      }),
    );

    expect(result.current.filters.sortBy).toBe("Recently updated");
  });

  it("treats provided route saved views as authoritative over the saved session views", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "",
        sortBy: "Best match",
        views: [],
        types: ["Table"],
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialViews: ["Needs review"],
        onRouteQueryChange: undefined,
        onRouteViewsChange: undefined,
      }),
    );

    expect(result.current.filters.views).toEqual(["Needs review"]);
  });

  it("keeps a blank discovery route on no saved view even when session storage remembers one", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "",
        sortBy: "Best match",
        views: ["Needs review"],
        types: ["Table"],
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialViews: [],
        onRouteQueryChange: undefined,
        onRouteViewsChange: undefined,
      }),
    );

    expect(result.current.filters.views).toEqual([]);
  });

  it("keeps a blank discovery route on the canonical default sort even when session storage remembers another sort", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "",
        sortBy: "Recently updated",
        views: [],
        types: ["Table"],
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialSort: "",
        onRouteQueryChange: undefined,
        onRouteSortChange: undefined,
      }),
    );

    expect(result.current.filters.sortBy).toBe("Best match");
  });

  it("resets grouped route filters on a fresh route seed without depending on bootstrap facet lists", async () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "stale",
        sortBy: "Recently updated",
        views: ["Needs review"],
        types: ["Materialized View"],
        catalogs: ["main"],
        domains: ["Finance"],
        tiers: ["Gold"],
        certifications: ["Certified"],
        sensitivities: ["PII"],
      }),
    );

    const { result, rerender } = renderHook(
      (props) =>
        useDiscoveryWorkspace({
          bootstrap,
          initialQuery: props.initialQuery,
          initialFilterGroups: props.initialFilterGroups,
          onRouteQueryChange: undefined,
          querySeedFresh: props.querySeedFresh,
          querySeedKey: props.querySeedKey,
        }),
      {
        initialProps: {
          initialQuery: "",
          initialFilterGroups: {
            types: ["Materialized View"],
            catalogs: ["main"],
            domains: ["Finance"],
            tiers: ["Gold"],
            certifications: ["Certified"],
            sensitivities: ["PII"],
          },
          querySeedFresh: false,
          querySeedKey: "seed-1",
        },
      },
    );

    expect(result.current.filters.types).toEqual(["Materialized View"]);

    rerender({
      initialQuery: "finance",
      initialFilterGroups: {},
      querySeedFresh: true,
      querySeedKey: "seed-2",
    });

    await waitFor(() => {
      expect(result.current.filters).toEqual({
        query: "finance",
        sortBy: "Best match",
        views: [],
        types: [],
        catalogs: [],
        domains: [],
        tiers: [],
        certifications: [],
        sensitivities: [],
      });
    });
  });

  it("keeps blank-route grouped filters authoritative even against legacy type restoration", () => {
    const bootstrap = bootstrapPayload();
    window.sessionStorage.setItem(
      sessionKey(bootstrap),
      JSON.stringify({
        query: "",
        sortBy: "Recently updated",
        view: "Needs review",
        type: "Materialized View",
      }),
    );

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        onRouteQueryChange: undefined,
      }),
    );

    expect(result.current.filters.views).toEqual([]);
    expect(result.current.filters.types).toEqual([]);
  });

  it("persists dynamic filter selections back to session storage without bootstrap allowlists", async () => {
    const bootstrap = bootstrapPayload();

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        onRouteQueryChange: undefined,
      }),
    );

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        types: ["Materialized View"],
        query: "finance",
      }));
    });

    await waitFor(() => {
      expect(
        JSON.parse(window.sessionStorage.getItem(sessionKey(bootstrap)) || "{}"),
      ).toEqual(
        expect.objectContaining({
          query: "finance",
          types: ["Materialized View"],
        }),
      );
    });
  });

  it("passes the requested discovery result limit through without treating it as route state", () => {
    const bootstrap = bootstrapPayload();

    renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        requestedResultLimit: 120,
        onRouteQueryChange: undefined,
      }),
    );

    expect(useDiscoveryResultsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "",
        sortBy: "Best match",
      }),
      expect.objectContaining({ limit: 120 }),
    );
  });

  it("does not echo a seeded route query back through the debounced route sync", async () => {
    vi.useFakeTimers();
    const bootstrap = bootstrapPayload();
    const onRouteQueryChange = vi.fn();

    renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "orders",
        onRouteQueryChange,
        querySeedKey: "seed-1",
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onRouteQueryChange).not.toHaveBeenCalled();
  });

  it("dispatches only the settled local query edit through the debounced route sync", async () => {
    vi.useFakeTimers();
    const bootstrap = bootstrapPayload();
    const onRouteQueryChange = vi.fn();

    const { result } = renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        onRouteQueryChange,
        querySeedKey: "seed-1",
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onRouteQueryChange).not.toHaveBeenCalled();

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        query: "ord",
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        query: "orders",
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(219);
    });

    expect(onRouteQueryChange).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(onRouteQueryChange).toHaveBeenCalledTimes(1);
    expect(onRouteQueryChange).toHaveBeenCalledWith("orders");
  });

  it("does not replay a fresh route seed back into the debounced route sync", async () => {
    vi.useFakeTimers();
    const bootstrap = bootstrapPayload();
    const onRouteQueryChange = vi.fn();

    const { result, rerender } = renderHook(
      (props) =>
        useDiscoveryWorkspace({
          bootstrap,
          initialQuery: props.initialQuery,
          onRouteQueryChange,
          querySeedFresh: props.querySeedFresh,
          querySeedKey: props.querySeedKey,
        }),
      {
        initialProps: {
          initialQuery: "",
          querySeedFresh: false,
          querySeedKey: "seed-1",
        },
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        query: "finance",
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });

    expect(onRouteQueryChange).toHaveBeenCalledTimes(1);
    expect(onRouteQueryChange).toHaveBeenLastCalledWith("finance");

    act(() => {
      rerender({
        initialQuery: "shared",
        querySeedFresh: true,
        querySeedKey: "seed-2",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.filters.query).toBe("shared");
    expect(onRouteQueryChange).toHaveBeenCalledTimes(1);
  });

  it("does not echo a seeded route sort back through the route sync", () => {
    const bootstrap = bootstrapPayload();
    const onRouteSortChange = vi.fn();

    renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialSort: "Recently updated",
        onRouteQueryChange: undefined,
        onRouteSortChange,
        querySeedKey: "seed-sort-1",
      }),
    );

    expect(onRouteSortChange).not.toHaveBeenCalled();
  });

  it("does not echo a seeded route view back through the route sync", () => {
    const bootstrap = bootstrapPayload();
    const onRouteViewsChange = vi.fn();

    renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialViews: ["Needs review"],
        onRouteQueryChange: undefined,
        onRouteViewsChange,
        querySeedKey: "seed-view-1",
      }),
    );

    expect(onRouteViewsChange).not.toHaveBeenCalled();
  });

  it("does not echo seeded grouped route filters back through the route sync", () => {
    const bootstrap = bootstrapPayload();
    const onRouteFilterGroupsChange = vi.fn();

    renderHook(() =>
      useDiscoveryWorkspace({
        bootstrap,
        initialQuery: "",
        initialFilterGroups: {
          types: ["Table"],
          catalogs: ["main"],
          domains: [],
          tiers: [],
          certifications: [],
          sensitivities: [],
        },
        onRouteQueryChange: undefined,
        onRouteFilterGroupsChange,
        querySeedKey: "seed-filters-1",
      }),
    );

    expect(onRouteFilterGroupsChange).not.toHaveBeenCalled();
  });

  it("dispatches local sort changes through the route sync without replaying a fresh sort seed", () => {
    const bootstrap = bootstrapPayload();
    const onRouteSortChange = vi.fn();

    const { result, rerender } = renderHook(
      (props) =>
        useDiscoveryWorkspace({
          bootstrap,
          initialQuery: "",
          initialSort: props.initialSort,
          onRouteQueryChange: undefined,
          onRouteSortChange,
          querySeedFresh: props.querySeedFresh,
          querySeedKey: props.querySeedKey,
        }),
      {
        initialProps: {
          initialSort: "Best match",
          querySeedFresh: false,
          querySeedKey: "seed-sort-1",
        },
      },
    );

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        sortBy: "Recently updated",
      }));
    });

    expect(onRouteSortChange).toHaveBeenCalledTimes(1);
    expect(onRouteSortChange).toHaveBeenLastCalledWith("Recently updated");

    rerender({
      initialSort: "Best match",
      querySeedFresh: true,
      querySeedKey: "seed-sort-2",
    });

    expect(result.current.filters.sortBy).toBe("Best match");
    expect(onRouteSortChange).toHaveBeenCalledTimes(1);
  });

  it("dispatches local saved view changes through the route sync without replaying a fresh view seed", () => {
    const bootstrap = bootstrapPayload();
    const onRouteViewsChange = vi.fn();

    const { result, rerender } = renderHook(
      (props) =>
        useDiscoveryWorkspace({
          bootstrap,
          initialQuery: "",
          initialViews: props.initialViews,
          onRouteQueryChange: undefined,
          onRouteViewsChange,
          querySeedFresh: props.querySeedFresh,
          querySeedKey: props.querySeedKey,
        }),
      {
        initialProps: {
          initialViews: [],
          querySeedFresh: false,
          querySeedKey: "seed-view-1",
        },
      },
    );

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        views: ["Needs review"],
      }));
    });

    expect(onRouteViewsChange).toHaveBeenCalledTimes(1);
    expect(onRouteViewsChange).toHaveBeenLastCalledWith(["Needs review"]);

    rerender({
      initialViews: [],
      querySeedFresh: true,
      querySeedKey: "seed-view-2",
    });

    expect(result.current.filters.views).toEqual([]);
    expect(onRouteViewsChange).toHaveBeenCalledTimes(1);
  });

  it("dispatches local grouped filter changes through the route sync without replaying a fresh filter seed", () => {
    const bootstrap = bootstrapPayload();
    const onRouteFilterGroupsChange = vi.fn();

    const { result, rerender } = renderHook(
      (props) =>
        useDiscoveryWorkspace({
          bootstrap,
          initialQuery: "",
          initialFilterGroups: props.initialFilterGroups,
          onRouteQueryChange: undefined,
          onRouteFilterGroupsChange,
          querySeedFresh: props.querySeedFresh,
          querySeedKey: props.querySeedKey,
        }),
      {
        initialProps: {
          initialFilterGroups: {
            types: [],
            catalogs: [],
            domains: [],
            tiers: [],
            certifications: [],
            sensitivities: [],
          },
          querySeedFresh: false,
          querySeedKey: "seed-filters-1",
        },
      },
    );

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        types: ["Table"],
        catalogs: ["main"],
      }));
    });

    expect(onRouteFilterGroupsChange).toHaveBeenCalledTimes(1);
    expect(onRouteFilterGroupsChange).toHaveBeenLastCalledWith({
      types: ["Table"],
      catalogs: ["main"],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
    });

    rerender({
      initialFilterGroups: {
        types: [],
        catalogs: [],
        domains: [],
        tiers: [],
        certifications: [],
        sensitivities: [],
      },
      querySeedFresh: true,
      querySeedKey: "seed-filters-2",
    });

    expect(result.current.filters.types).toEqual([]);
    expect(result.current.filters.catalogs).toEqual([]);
    expect(onRouteFilterGroupsChange).toHaveBeenCalledTimes(1);
  });
});
