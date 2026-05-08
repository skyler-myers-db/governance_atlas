import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePanel } from "../ProfilePanel.jsx";

const useAssetProfileMock = vi.fn();

vi.mock("../../../hooks/useAssetProfile", () => ({
  useAssetProfile: (...args) => useAssetProfileMock(...args),
}));

describe("ProfilePanel", () => {
  beforeEach(() => {
    useAssetProfileMock.mockReset();
  });

  it("renders Databricks profiling metric table evidence without an Atlas profile run", () => {
    useAssetProfileMock.mockReturnValue({
      loading: false,
      error: "",
      run: null,
      tableMetric: null,
      columnMetrics: [],
      databricksProfile: {
        state: "available",
        source: "system.information_schema.tables",
        monitor: { status: "ACTIVE", configured: true },
        rows: [
          {
            table_catalog: "monitoring",
            table_schema: "quality",
            table_name: "orders_profile_metrics",
            table_type: "MANAGED",
            table_owner: "data.platform@example.com",
            last_altered: "2026-05-05T12:00:00Z",
          },
        ],
      },
    });

    render(<ProfilePanel assetFqn="main.sales.orders" />);

    expect(screen.getByText("Databricks metric tables")).toBeTruthy();
    expect(screen.getByText("orders_profile_metrics")).toBeTruthy();
    expect(screen.getByText("ACTIVE")).toBeTruthy();
  });

  it("renders monitor configuration when metric table rows are not actor-visible", () => {
    useAssetProfileMock.mockReturnValue({
      loading: false,
      error: "",
      run: null,
      tableMetric: null,
      columnMetrics: [],
      databricksProfile: {
        state: "available",
        source: "system.information_schema.tables",
        monitor: {
          status: "ACTIVE",
          configured: true,
          profileMetricsTableName: "monitoring.quality.orders_profile_metrics",
          driftMetricsTableName: "monitoring.quality.orders_drift_metrics",
        },
        rows: [],
      },
    });

    render(<ProfilePanel assetFqn="main.sales.orders" />);

    expect(screen.getByText("monitoring.quality.orders_profile_metrics")).toBeTruthy();
    expect(screen.getByText("monitoring.quality.orders_drift_metrics")).toBeTruthy();
  });

  it("does not promote a table-id-only monitor lookup into profile evidence", () => {
    useAssetProfileMock.mockReturnValue({
      loading: false,
      error: "",
      run: null,
      tableMetric: null,
      columnMetrics: [],
      databricksProfile: {
        state: "empty",
        source: "system.information_schema.tables",
        monitor: {
          tableId: "table-1",
          configured: false,
        },
        rows: [],
      },
    });

    render(<ProfilePanel assetFqn="main.sales.orders" />);

    expect(screen.getByText("No profile runs recorded")).toBeTruthy();
    expect(screen.queryByText("Monitor configured")).toBeNull();
  });
});
