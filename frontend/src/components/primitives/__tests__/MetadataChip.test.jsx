import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetadataChip } from "../MetadataChip.jsx";

describe("MetadataChip", () => {
  it("renders label and value with separator", () => {
    render(<MetadataChip label="Domain" value="Finance" />);
    expect(screen.getByText("Domain")).not.toBeNull();
    expect(screen.getByText("Finance")).not.toBeNull();
  });

  it("applies tone class when tone is set", () => {
    const { container } = render(
      <MetadataChip label="Status" value="stale" tone="warn" />,
    );
    const chip = container.querySelector(".gh-chip");
    expect(chip?.classList.contains("gh-chip-status")).toBe(true);
    expect(chip?.classList.contains("tone-warn")).toBe(true);
  });

  it("passes title down to the chip element", () => {
    const { container } = render(
      <MetadataChip label="Owner" value="alice" title="Primary owner" />,
    );
    const chip = container.querySelector(".gh-chip");
    expect(chip?.getAttribute("title")).toBe("Primary owner");
  });

  it("renders children instead of label/value when both are provided", () => {
    render(
      <MetadataChip label="ignored" value="ignored">
        custom
      </MetadataChip>,
    );
    expect(screen.queryByText("ignored")).toBeNull();
    expect(screen.getByText("custom")).not.toBeNull();
  });
});
