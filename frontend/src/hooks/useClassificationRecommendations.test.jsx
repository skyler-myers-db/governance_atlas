import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAtlasQueryClient } from "../lib/queryClient";
import {
  useClassificationRecommendation,
  useClassificationRecommendations,
  useClassificationReview,
} from "./useClassificationRecommendations";

const fetchListMock = vi.fn();
const fetchSingleMock = vi.fn();
const reviewMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchClassificationRecommendations: (...args) => fetchListMock(...args),
  fetchClassificationRecommendation: (...args) => fetchSingleMock(...args),
  reviewClassificationRecommendation: (...args) => reviewMock(...args),
}));

function createWrapper() {
  const queryClient = createAtlasQueryClient();
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useClassificationRecommendations list", () => {
  beforeEach(() => {
    fetchListMock.mockReset();
  });

  it("loads the pending queue on mount", async () => {
    fetchListMock.mockResolvedValue({
      recommendations: [
        {
          recommendationId: "r1",
          assetFqn: "main.sales.customers",
          columnName: "ssn",
          status: "pending",
        },
      ],
      count: 1,
      pendingCount: 1,
    });

    const { result } = renderHook(() => useClassificationRecommendations(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(fetchListMock).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data.pendingCount).toBe(1);
    expect(result.current.data.recommendations[0].recommendationId).toBe("r1");
    expect(fetchListMock.mock.calls[0][0].status).toBe("pending");
    expect(typeof result.current.refresh).toBe("function");
  });

  it("stays idle when disabled", () => {
    const { result } = renderHook(
      () => useClassificationRecommendations({ enabled: false }),
      { wrapper: createWrapper() },
    );
    expect(fetchListMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({
      recommendations: [],
      count: 0,
      pendingCount: 0,
    });
  });

  it("forwards the assetFqn filter", async () => {
    fetchListMock.mockResolvedValue({ recommendations: [], count: 0, pendingCount: 0 });
    renderHook(
      () => useClassificationRecommendations({ assetFqn: "main.sales.customers" }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(fetchListMock).toHaveBeenCalledTimes(1));
    expect(fetchListMock.mock.calls[0][0].assetFqn).toBe("main.sales.customers");
  });
});

describe("useClassificationRecommendation single", () => {
  beforeEach(() => {
    fetchSingleMock.mockReset();
  });

  it("fetches a single recommendation when enabled", async () => {
    fetchSingleMock.mockResolvedValue({ recommendationId: "r1", status: "pending" });
    const { result } = renderHook(() => useClassificationRecommendation("r1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(fetchSingleMock).toHaveBeenCalledWith("r1", expect.any(Object));
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data.recommendationId).toBe("r1");
  });

  it("skips fetch when id is empty", () => {
    renderHook(() => useClassificationRecommendation(""), { wrapper: createWrapper() });
    expect(fetchSingleMock).not.toHaveBeenCalled();
  });
});

describe("useClassificationReview", () => {
  beforeEach(() => {
    reviewMock.mockReset();
  });

  it("submits review and exposes the resulting record", async () => {
    reviewMock.mockResolvedValue({
      recommendationId: "r1",
      status: "approved",
    });
    const { result } = renderHook(() => useClassificationReview(), {
      wrapper: createWrapper(),
    });

    const record = await result.current.review({
      recommendationId: "r1",
      decision: "approved",
      note: "looks good",
    });

    expect(reviewMock).toHaveBeenCalledWith("r1", {
      decision: "approved",
      note: "looks good",
    });
    expect(record.status).toBe("approved");
    await waitFor(() => {
      expect(result.current.lastRecord?.recommendationId).toBe("r1");
    });
  });

  it("reports a friendly error when the API rejects", async () => {
    reviewMock.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useClassificationReview(), {
      wrapper: createWrapper(),
    });
    await expect(
      result.current.review({
        recommendationId: "r1",
        decision: "approved",
      }),
    ).rejects.toThrow("nope");
    await waitFor(() => expect(result.current.error).toBe("nope"));
  });
});
