import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock the api module before importing the hook so the hook picks up the
// mocked batch header fetch.
vi.mock("../../lib/api", () => ({
  fetchAssetHeaders: vi.fn(),
}));

import { fetchAssetHeaders } from "../../lib/api";
import { useLineageNodeHeaders } from "./useLineageNodeHeaders";

describe("useLineageNodeHeaders", () => {
  beforeEach(() => {
    fetchAssetHeaders.mockReset();
    fetchAssetHeaders.mockImplementation((fqns) =>
      Promise.resolve({
        assets: Object.fromEntries((fqns || []).map((fqn) => [
          fqn,
          {
            fqn,
            objectType: "Table",
            managementType: "Managed",
            rows: "1.2M",
            size: "12.4 GiB",
            owners: [{ displayName: "Test Owner" }],
            updatedAt: "2026-05-04T01:00:00Z",
          },
        ])),
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty Map when no FQNs are passed", () => {
    const { result } = renderHook(() => useLineageNodeHeaders([]));
    expect(result.current.headers).toBeInstanceOf(Map);
    expect(result.current.headers.size).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(fetchAssetHeaders).not.toHaveBeenCalled();
  });

  it("batch-fetches headers for every FQN and exposes them in the result map", async () => {
    const { result } = renderHook(() =>
      useLineageNodeHeaders(["catalog.schema.alpha", "catalog.schema.beta"]),
    );
    await waitFor(() => {
      expect(result.current.headers.size).toBe(2);
    });
    expect(result.current.headers.get("catalog.schema.alpha")?.objectType).toBe("Table");
    expect(result.current.headers.get("catalog.schema.beta")?.managementType).toBe("Managed");
    expect(fetchAssetHeaders).toHaveBeenCalledTimes(1);
    expect(fetchAssetHeaders).toHaveBeenCalledWith(
      ["catalog.schema.alpha", "catalog.schema.beta"],
    );
  });

  it("dedupes FQNs in the input and only fetches each once", async () => {
    const { result } = renderHook(() =>
      useLineageNodeHeaders(["x.y.z", "x.y.z", "x.y.z"]),
    );
    await waitFor(() => {
      expect(result.current.headers.size).toBe(1);
    });
    expect(fetchAssetHeaders).toHaveBeenCalledTimes(1);
  });

  it("caches results across re-renders so a second mount with the same FQN doesn't re-fetch", async () => {
    const { result, rerender } = renderHook(
      ({ fqns }) => useLineageNodeHeaders(fqns),
      { initialProps: { fqns: ["cached.asset.one"] } },
    );
    await waitFor(() => {
      expect(result.current.headers.size).toBe(1);
    });
    expect(fetchAssetHeaders).toHaveBeenCalledTimes(1);
    // Re-render with the same fqn — should NOT trigger another fetch.
    rerender({ fqns: ["cached.asset.one"] });
    await waitFor(() => {
      expect(result.current.headers.get("cached.asset.one")).toBeTruthy();
    });
    expect(fetchAssetHeaders).toHaveBeenCalledTimes(1);
  });

  it("caps cold node header hydration to a bounded batch", async () => {
    const manyFqns = Array.from({ length: 30 }, (_, index) => `catalog.schema.asset_${index}`);
    const { result } = renderHook(() => useLineageNodeHeaders(manyFqns));
    await waitFor(() => {
      expect(result.current.headers.size).toBe(18);
    });
    expect(fetchAssetHeaders).toHaveBeenCalledTimes(1);
    expect(fetchAssetHeaders.mock.calls[0][0]).toHaveLength(18);
  });
});
