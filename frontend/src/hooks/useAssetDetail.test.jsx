import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { govhubQueryClient } from "../lib/queryClient";
import {
  prefetchAssetDetail,
  primeAssetDetail,
  useAssetDetail,
} from "./useAssetDetail";

const fetchAssetAvailabilityMock = vi.fn();
const fetchAssetDetailMock = vi.fn();

vi.mock("../lib/api", () => ({
  fetchAssetAvailability: (...args) => fetchAssetAvailabilityMock(...args),
  fetchAssetDetail: (...args) => fetchAssetDetailMock(...args),
}));

function Wrapper({ children }) {
  return <QueryClientProvider client={govhubQueryClient}>{children}</QueryClientProvider>;
}

describe("useAssetDetail", () => {
  beforeEach(() => {
    fetchAssetAvailabilityMock.mockReset();
    fetchAssetDetailMock.mockReset();
    govhubQueryClient.clear();
  });

  it("merges activity payloads into the canonical asset record, including metadata audit updates", async () => {
    primeAssetDetail("main.sales.orders", {
      fqn: "main.sales.orders",
      name: "orders",
      metadataAudit: [{ id: "audit-old" }],
      loadedSections: ["header"],
      deferredSections: ["activity", "schema"],
    });
    fetchAssetDetailMock.mockResolvedValue({
      fqn: "main.sales.orders",
      activity: [{ id: "activity-new" }],
      metadataAudit: [{ id: "audit-new" }],
      loadedSections: ["activity"],
      deferredSections: ["schema"],
    });

    const detail = await prefetchAssetDetail("main.sales.orders", {
      force: true,
      sections: ["activity"],
    });

    expect(detail.loadedSections).toEqual(["activity", "header"]);
    expect(detail.metadataAudit).toEqual([{ id: "audit-new" }]);
    expect(detail.activity).toEqual([{ id: "activity-new" }]);
  });

  it("requests asset detail through an abortable query-backed fetch", async () => {
    fetchAssetDetailMock.mockResolvedValue({
      fqn: "main.sales.orders",
      name: "orders",
      loadedSections: ["header"],
      deferredSections: [],
    });

    const { result } = renderHook(
      () =>
        useAssetDetail("main.sales.orders", {
          sections: ["header"],
        }),
      {
        wrapper: Wrapper,
      },
    );

    await waitFor(() => {
      expect(fetchAssetDetailMock).toHaveBeenCalledTimes(1);
      expect(result.current.detail?.fqn).toBe("main.sales.orders");
    });

    expect(fetchAssetDetailMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
