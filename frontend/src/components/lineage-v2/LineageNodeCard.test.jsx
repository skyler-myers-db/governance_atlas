import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LineageNodeCard } from "./LineageNodeCard";

const baseNode = {
  id: "n1",
  fqn: "datapact.curated.revenue_daily",
  label: "revenue_daily",
  subtitle: "datapact / curated",
  kind: "table",
  isOpenable: true,
  isCertified: true,
  classification: "Confidential",
  containsPii: false,
  rowCount: "1.2M",
  freshness: "2h ago",
  freshnessRaw: "2026-05-04T01:00:00Z",
  owners: [{ displayName: "Marisol Reyes" }],
  ownerCount: 1,
  recentActivity: [{}, {}, {}],
  recentActivityCount: 3,
  columns: [
    { name: "id", type: "BIGINT" },
    { name: "amount", type: "DECIMAL" },
  ],
  totalColumns: 12,
};

describe("LineageNodeCard", () => {
  it("renders the title, subtitle, and footer metadata in compact mode", () => {
    render(<LineageNodeCard node={baseNode} variant="compact" />);
    expect(screen.getByText("revenue_daily")).toBeTruthy();
    expect(screen.getByText("datapact / curated")).toBeTruthy();
    expect(screen.getByText("1.2M rows")).toBeTruthy();
    expect(screen.getByText("2h ago")).toBeTruthy();
    expect(screen.getByText("1 owner")).toBeTruthy();
    expect(screen.getByText("3 recent")).toBeTruthy();
  });

  it("renders columns + classification chip + PII chip in tall mode", () => {
    render(
      <LineageNodeCard
        node={{ ...baseNode, containsPii: true }}
        variant="tall"
      />,
    );
    expect(screen.getByText("id")).toBeTruthy();
    expect(screen.getByText("BIGINT")).toBeTruthy();
    expect(screen.getByText("amount")).toBeTruthy();
    expect(screen.getByText("DECIMAL")).toBeTruthy();
    expect(screen.getByText("+10 more columns")).toBeTruthy();
    expect(screen.getByText("PII")).toBeTruthy();
    expect(screen.getByText("Confidential")).toBeTruthy();
  });

  it("fires onClick when the card is navigable", () => {
    const onClick = vi.fn();
    render(<LineageNodeCard node={baseNode} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledWith(baseNode);
  });

  it("does NOT mark the card navigable when isOpenable=false", () => {
    const lineageOnly = { ...baseNode, isOpenable: false };
    const { container } = render(<LineageNodeCard node={lineageOnly} onClick={() => {}} />);
    const card = container.querySelector(".ga-lineage-v2-card");
    expect(card?.getAttribute("data-navigable")).toBe("false");
  });

  it("renders a 'Metadata pending' empty state when no metadata is present", () => {
    const sparse = {
      ...baseNode,
      rowCount: null,
      freshness: "",
      ownerCount: 0,
      recentActivityCount: 0,
    };
    render(<LineageNodeCard node={sparse} />);
    expect(screen.getByText("Metadata pending")).toBeTruthy();
  });

  it("marks the focus card with is-focus and aria-current", () => {
    const { container } = render(<LineageNodeCard node={baseNode} isFocus />);
    const card = container.querySelector(".ga-lineage-v2-card");
    expect(card?.classList.contains("is-focus")).toBe(true);
    expect(card?.getAttribute("aria-current")).toBe("true");
  });
});
