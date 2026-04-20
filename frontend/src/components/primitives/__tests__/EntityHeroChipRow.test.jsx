import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntityHeroChipRow } from "../EntityHero.jsx";

describe("EntityHeroChipRow", () => {
  it("renders domain, tier, owner, usage, and environment chips when present", () => {
    render(
      <EntityHeroChipRow
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
          domain: "Commerce",
          tier: "Gold",
          owners: ["ada.lovelace@example.com"],
          usageLabel: "Operational",
          environment: "prod",
        }}
      />,
    );
    // Label parts render next to values for visual scanability.
    expect(screen.getByText("Commerce")).not.toBeNull();
    expect(screen.getByText("Gold")).not.toBeNull();
    // Owner inline pretty name
    expect(screen.getByText("Ada Lovelace")).not.toBeNull();
    expect(screen.getByText("Operational")).not.toBeNull();
    expect(screen.getByText("prod")).not.toBeNull();
  });

  it("hides chips when the underlying value is missing or Unassigned", () => {
    const { container } = render(
      <EntityHeroChipRow
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
          domain: "Unassigned",
          tier: "",
          owners: [],
          // no usageLabel / environment
        }}
      />,
    );
    // With every field empty/unassigned the whole row should not render.
    expect(container.querySelector("[data-testid='gh-entity-hero-chips']")).toBeNull();
  });

  it("renders only the available chips when some fields are missing", () => {
    render(
      <EntityHeroChipRow
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
          domain: "Commerce",
          owners: [],
        }}
      />,
    );
    expect(screen.getByText("Commerce")).not.toBeNull();
    // No owner / tier / usage / environment chips
    expect(screen.queryByText("Gold")).toBeNull();
    expect(screen.queryByText("Operational")).toBeNull();
  });

  it("accepts owner objects as well as strings", () => {
    render(
      <EntityHeroChipRow
        asset={{
          fqn: "main.sales.orders",
          name: "orders",
          owners: [{ name: "Grace Hopper", email: "grace@example.com" }],
        }}
      />,
    );
    expect(screen.getByText("Grace Hopper")).not.toBeNull();
  });
});
