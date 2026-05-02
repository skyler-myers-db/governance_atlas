import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DegradedBanner } from "./DegradedBanner";

describe("DegradedBanner", () => {
  it("suppresses prototype-mock provenance banners that are already labeled by shell evidence", () => {
    render(
      <DegradedBanner
        meta={{
          state: "prototype_mock",
          degraded: true,
          warnings: ["Prototype mock data, not live Databricks evidence."],
        }}
      />,
    );

    expect(screen.queryByText("Data availability is limited")).toBeNull();
    expect(screen.queryByText("Prototype mock data, not live Databricks evidence.")).toBeNull();
  });

  it("keeps real degraded warnings visible", () => {
    render(
      <DegradedBanner
        meta={{
          state: "degraded",
          degraded: true,
          warnings: ["Lineage coverage is temporarily unavailable."],
        }}
      />,
    );

    expect(screen.getByText("Data availability is limited")).not.toBeNull();
    expect(screen.getByText("Lineage coverage is temporarily unavailable.")).not.toBeNull();
  });
});
