import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../StatusBadge.jsx";

describe("StatusBadge", () => {
  it("renders label inside a status role element", () => {
    render(<StatusBadge tone="good" label="Live" />);
    const badge = screen.getByRole("status");
    expect(badge.textContent).toContain("Live");
    expect(badge.classList.contains("tone-good")).toBe(true);
  });

  it("builds a truthful aria-label from tone + label when no override is given", () => {
    render(<StatusBadge tone="warn" label="Stale" />);
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toBe("attention: Stale");
  });

  it("honors an explicit ariaLabel override", () => {
    render(
      <StatusBadge tone="bad" label="Failed" ariaLabel="Snapshot run failed" />,
    );
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toBe("Snapshot run failed");
  });

  it("accepts children as label source", () => {
    render(<StatusBadge tone="neutral">Pending</StatusBadge>);
    const badge = screen.getByRole("status");
    expect(badge.textContent).toContain("Pending");
    expect(badge.getAttribute("aria-label")).toBe("status: Pending");
  });
});
