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

  it("keeps seeded lineage provisional until the live payload resolves", async () => {
    fetchLineageMock.mockResolvedValue({
      fqn: "main.sales.orders",
      graphs: {
        data: {
          nodes: [{ id: "live", assetFqn: "main.sales.orders" }],
          edges: [],
        },
      },
    });

    const seededGraph = {
      data: {
        nodes: [{ id: "seed", assetFqn: "main.sales.orders" }],
        edges: [],
      },
    };

    const { result } = renderHook(
      () => useLineage("main.sales.orders", seededGraph, true),
      {
        wrapper: Wrapper,
      },
    );

    expect(result.current.graph).toEqual(seededGraph);
    expect(result.current.loading).toBe(true);
    expect(result.current.authoritative).toBe(false);
    expect(result.current.provisional).toBe(true);

    await waitFor(() => {
      expect(fetchLineageMock).toHaveBeenCalledTimes(1);
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

    expect(fetchLineageMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
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
      ({ assetFqn, seededGraph }) => useLineage(assetFqn, seededGraph, true),
      {
        initialProps: { assetFqn: "main.sales.orders", seededGraph: null },
        wrapper: Wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.graph?.data?.nodes?.[0]?.id).toBe("orders");
    });

    rerender({ assetFqn: "main.sales.customers", seededGraph: null });

    expect(result.current.loading).toBe(true);
    expect(result.current.graph).toBe(null);
    expect(result.current.payload).toBe(null);
    expect(result.current.authoritative).toBe(false);
    expect(result.current.provisional).toBe(false);
  });
});
