import { beforeEach, describe, expect, it, vi } from "vitest";
import { openAssetRecordSafely } from "./assetRecordNavigation";

const canOpenAssetRecordMock = vi.fn();
const prefetchAssetAvailabilityMock = vi.fn();
const prefetchAssetDetailMock = vi.fn();

vi.mock("../hooks/useAssetDetail", () => ({
  canOpenAssetRecord: (...args) => canOpenAssetRecordMock(...args),
  prefetchAssetAvailability: (...args) => prefetchAssetAvailabilityMock(...args),
  prefetchAssetDetail: (...args) => prefetchAssetDetailMock(...args),
}));

describe("openAssetRecordSafely", () => {
  beforeEach(() => {
    canOpenAssetRecordMock.mockReset();
    prefetchAssetAvailabilityMock.mockReset();
    prefetchAssetDetailMock.mockReset();
  });

  it("opens records only when the shared openability gate succeeds", async () => {
    const onOpen = vi.fn();
    prefetchAssetAvailabilityMock.mockResolvedValue({
      "main.sales.orders": true,
    });
    prefetchAssetDetailMock.mockResolvedValue({
      fqn: "main.sales.orders",
    });
    canOpenAssetRecordMock.mockReturnValue(true);

    const opened = await openAssetRecordSafely("main.sales.orders", {
      onOpen,
    });

    expect(opened).toBe(true);
    expect(onOpen).toHaveBeenCalledWith("main.sales.orders", {
      availability: true,
      detail: { fqn: "main.sales.orders" },
    });
  });

  it("does not auto-open when availability is unresolved and the detail is not openable", async () => {
    const onOpen = vi.fn();
    const onUnavailable = vi.fn();
    const onNavigationStateChange = vi.fn();
    prefetchAssetAvailabilityMock.mockResolvedValue({
      "main.sales.orders": null,
    });
    prefetchAssetDetailMock.mockResolvedValue(null);
    canOpenAssetRecordMock.mockReturnValue(false);

    const opened = await openAssetRecordSafely("main.sales.orders", {
      onOpen,
      onUnavailable,
      onNavigationStateChange,
    });

    expect(opened).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith({
      assetFqn: "main.sales.orders",
      availability: null,
      detail: null,
    });
    expect(onNavigationStateChange).toHaveBeenNthCalledWith(1, true, "Opening metadata record…");
    expect(onNavigationStateChange).toHaveBeenNthCalledWith(2, false, "");
  });

  it("still opens when availability lookup fails but detail is renderable", async () => {
    const onOpen = vi.fn();
    prefetchAssetAvailabilityMock.mockRejectedValue(new Error("availability unavailable"));
    prefetchAssetDetailMock.mockResolvedValue({
      fqn: "main.sales.orders",
      objectType: "Table",
    });
    canOpenAssetRecordMock.mockReturnValue(true);

    const opened = await openAssetRecordSafely("main.sales.orders", {
      onOpen,
    });

    expect(opened).toBe(true);
    expect(onOpen).toHaveBeenCalledWith("main.sales.orders", {
      availability: null,
      detail: {
        fqn: "main.sales.orders",
        objectType: "Table",
      },
    });
  });
});
