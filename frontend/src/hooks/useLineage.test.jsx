import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { govhubQueryClient } from "../lib/queryClient";
import { primeLineagePayload, useLineage } from "./useLineage";

const fetchLineageMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchLineage: (...args) => fetchLineageMock(...args),
}));

function Wrapper({ children }) {
  return <QueryClientProvider client={govhubQueryClient}>{children}</QueryClientProvider>;
}

describe("useLineage", () => {
  beforeEach(() => {
    fetchLineageMock.mockReset();
    govhubQueryClient.clear();
  });

  it("starts without provisional seeded lineage and resolves to the live payload", async () => {
    fetchLineageMock.mockResolvedValue({
      fqn: "main.sales.orders",
      graphs: {
        data: {
          nodes: [{ id: "live", assetFqn: "main.sales.orders" }],
          edges: [],
        },
      },
    });

    const { result } = renderHook(
      () => useLineage("main.sales.orders", true),
      {
        wrapper: Wrapper,
      },
    );

    expect(result.current.graph).toBe(null);
    expect(result.current.loading).toBe(true);
    expect(result.current.authoritative).toBe(false);
    expect(result.current.provisional).toBe(false);

    await waitFor(() => {
      // useLineage now dual-fetches: first-hop (depth=1) for fast paint
      // and full for the complete graph. Both resolve with the same
      // stub, so two calls to fetchLineage are expected.
      expect(fetchLineageMock).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
      expect(result.current.authoritative).toBe(true);
      expect(result.current.provisional).toBe(false);
      expect(result.current.graph).toEqual({
        data: {
          nodes: [{ id: "live", assetFqn: "main.sales.orders" }],
          edges: [],
        },
      });
    });

    // Each fetch is wired with its own AbortSignal so unmount cancels
    // both in flight without leaving orphans.
    expect(fetchLineageMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchLineageMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    // The two calls are distinguished by the `depth` option — one with
    // depth=1 (first-hop), one without (full).
    const depths = fetchLineageMock.mock.calls.map((c) => c[1].depth);
    expect(new Set(depths)).toEqual(new Set([1, undefined]));
  });

  it("does not reuse the previous asset graph when route focus changes", async () => {
    fetchLineageMock
      .mockResolvedValueOnce({
        fqn: "main.sales.orders",
        graphs: {
          data: {
            nodes: [{ id: "orders", assetFqn: "main.sales.orders" }],
            edges: [],
          },
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise(() => {}),
      );

    primeLineagePayload("main.sales.orders", {
      fqn: "main.sales.orders",
      graphs: {
        data: {
          nodes: [{ id: "orders", assetFqn: "main.sales.orders" }],
          edges: [],
        },
      },
    });

    const { result, rerender } = renderHook(
      ({ assetFqn, enabled }) => useLineage(assetFqn, enabled),
      {
        initialProps: { assetFqn: "main.sales.orders", enabled: true },
        wrapper: Wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.graph?.data?.nodes?.[0]?.id).toBe("orders");
    });

    rerender({ assetFqn: "main.sales.customers", enabled: true });

    expect(result.current.loading).toBe(true);
    expect(result.current.graph).toBe(null);
    expect(result.current.payload).toBe(null);
    expect(result.current.authoritative).toBe(false);
    expect(result.current.provisional).toBe(false);
  });
});
