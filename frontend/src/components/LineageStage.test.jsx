import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LineageStage from "./LineageStage";

vi.mock("./LineageGraph", () => ({
  default: () => <div data-testid="lineage-graph" />,
}));

describe("LineageStage", () => {
  it("labels truncated table lineage as partial instead of implying complete mappings", () => {
    render(
      <LineageStage
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
        }}
        context="Data Lineage"
        error=""
        graphBundle={{
          data: {
            nodes: [{ id: "focus", assetFqn: "main.sales.orders", role: "focus" }],
            edges: [],
          },
          operational: {
            nodes: [],
            edges: [],
          },
        }}
        lineagePayload={{
          stats: {
            limits: {
              tableLineage: 25,
            },
            truncated: {
              upstream: true,
              downstream: false,
              columnLineage: true,
            },
          },
        }}
        loading={false}
        onAssetSearchQueryChange={() => {}}
        onContextChange={() => {}}
        onOpenAsset={() => {}}
        onOpenFullGraph={() => {}}
        onOpenGovernance={() => {}}
        onSelectAsset={() => {}}
      />,
    );

    expect(
      screen.getByText(
        "Limited to 25 table edges. Column lineage may be partial or unavailable in this workspace.",
      ),
    ).not.toBeNull();
    expect(screen.getByTestId("lineage-graph")).not.toBeNull();
  });
});
