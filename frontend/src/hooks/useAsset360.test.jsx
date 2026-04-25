import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasQueryClient } from "../lib/queryClient";
import { useAsset360 } from "./useAsset360";

const fetchAsset360Mock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchAsset360: (...args) => fetchAsset360Mock(...args),
}));

function createWrapper() {
  const queryClient = createAtlasQueryClient();
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAsset360", () => {
  beforeEach(() => {
    fetchAsset360Mock.mockReset();
  });

  it("normalizes the composite payload and marks same-FQN data", async () => {
    fetchAsset360Mock.mockResolvedValue({
      asset: { fqn: "main.sales.orders", name: "orders" },
      schema: [{ name: "order_id" }],
      activity: [{ id: "req-1", title: "Review description" }],
      usage: { queryCount: 4 },
      badges: ["Certified"],
    });

    const { result } = renderHook(() => useAsset360("main.sales.orders"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.asset?.fqn).toBe("main.sales.orders");
    });

    expect(fetchAsset360Mock).toHaveBeenCalledTimes(1);
    expect(fetchAsset360Mock.mock.calls[0][0]).toBe("main.sales.orders");
    expect(fetchAsset360Mock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data.sameAsset).toBe(true);
    expect(result.current.data.schema).toHaveLength(1);
    expect(result.current.data.activity).toHaveLength(1);
    expect(result.current.data.usage.queryCount).toBe(4);
  });

  it("stays idle without an asset FQN", () => {
    const { result } = renderHook(() => useAsset360(""), {
      wrapper: createWrapper(),
    });

    expect(fetchAsset360Mock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});
