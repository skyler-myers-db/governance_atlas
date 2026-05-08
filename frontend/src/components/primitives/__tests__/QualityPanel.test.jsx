import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QualityPanel } from "../QualityPanel.jsx";

const useAssetQualityMock = vi.fn();

vi.mock("../../../hooks/useAssetQuality", () => ({
  useAssetQuality: (...args) => useAssetQualityMock(...args),
}));

describe("QualityPanel", () => {
  beforeEach(() => {
    useAssetQualityMock.mockReset();
  });

  it("renders Databricks data quality monitoring evidence without Atlas quality runs", () => {
    useAssetQualityMock.mockReturnValue({
      loading: false,
      error: "",
      runs: [],
      results: [],
      summary: { passed: 0, failed: 0, errored: 0, skipped: 0 },
      databricksMonitoring: {
        state: "available",
        source: "system.data_quality_monitoring.table_results",
        summary: {
          healthStatus: "Healthy",
          freshnessStatus: "Healthy",
          completenessStatus: "Healthy",
        },
        rows: [
          {
            event_time: "2026-05-05T12:00:00Z",
            status: "Healthy",
            freshness_status: "Healthy",
            completeness_status: "Healthy",
          },
        ],
      },
    });

    render(<QualityPanel assetFqn="main.sales.orders" />);

    expect(screen.getByText("Databricks monitoring")).toBeTruthy();
    expect(screen.getByText("system.data_quality_monitoring.table_results")).toBeTruthy();
    expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
  });

  it("does not report empty Databricks monitoring as a healthy zero-count result", () => {
    useAssetQualityMock.mockReturnValue({
      loading: false,
      error: "",
      runs: [],
      results: [],
      summary: { passed: 0, failed: 0, errored: 0, skipped: 0 },
      databricksMonitoring: {
        state: "empty",
        source: "system.data_quality_monitoring.table_results",
        summary: { healthStatus: "Not monitored" },
        rows: [],
      },
    });

    render(<QualityPanel assetFqn="main.sales.orders" />);

    expect(screen.getByText("No quality evidence recorded")).toBeTruthy();
    expect(screen.getByText(/returned no result rows/i)).toBeTruthy();
    expect(screen.queryByText("Healthy")).toBeNull();
  });
});
