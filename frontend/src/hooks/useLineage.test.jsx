import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { atlasQueryClient } from "../lib/queryClient";
import { primeLineagePayload, useLineage } from "./useLineage";

const fetchLineageMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchLineage: (...args) => fetchLineageMock(...args),
}));

function Wrapper({ children }) {
  return <QueryClientProvider client={atlasQueryClient}>{children}</QueryClientProvider>;
}

describe("useLineage", () => {
  beforeEach(() => {
    fetchLineageMock.mockReset();
    atlasQueryClient.clear();
  });

  it("starts without provisional seeded lineage and resolves to the live payload", async () => {
    fetchLineageMock
      .mockResolvedValueOnce({
        fqn: "main.sales.orders",
        profile: "initial",
        graphs: {
          data: {
            nodes: [{ id: "initial", assetFqn: "main.sales.orders" }],
            edges: [],
          },
        },
      })
      .mockResolvedValueOnce({
        fqn: "main.sales.orders",
        profile: "full",
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
      expect(fetchLineageMock).toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
      expect(result.current.authoritative).toBe(true);
      expect(result.current.provisional).toBe(false);
      expect(result.current.graph).not.toBe(null);
    });

    expect(fetchLineageMock.mock.calls[0][1].profile).toBe("initial");

    await waitFor(() => {
      expect(fetchLineageMock).toHaveBeenCalledTimes(2);
      expect(result.current.graph).toEqual({
        data: {
          nodes: [{ id: "live", assetFqn: "main.sales.orders" }],
          edges: [],
        },
      });
    });

    expect(fetchLineageMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchLineageMock.mock.calls[1][1].profile).toBe("full");
  });

  it("does not reuse the previous asset graph when route focus changes", async () => {
    fetchLineageMock
      .mockResolvedValueOnce({
        fqn: "main.sales.orders",
        profile: "initial",
        graphs: {
          data: {
            nodes: [{ id: "orders", assetFqn: "main.sales.orders" }],
            edges: [],
          },
        },
      })
      .mockImplementation(
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

  it("surfaces unavailable lineage errors without staying in retry-loading state", async () => {
    fetchLineageMock.mockRejectedValueOnce(new Error("Lineage unavailable"));

    const { result } = renderHook(
      () => useLineage("main.sales.missing", true),
      {
        wrapper: Wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe("Lineage unavailable");
      expect(result.current.graph).toBe(null);
      expect(result.current.payload).toBe(null);
    });

    expect(fetchLineageMock).toHaveBeenCalledTimes(1);
    expect(fetchLineageMock.mock.calls[0][1].profile).toBe("initial");
  });
});
