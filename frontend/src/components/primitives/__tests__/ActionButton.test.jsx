import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionButton } from "../ActionButton.jsx";

describe("ActionButton", () => {
  it("applies the variant class and fires onClick when enabled", () => {
    const handler = vi.fn();
    render(
      <ActionButton variant="primary" onClick={handler}>
        Save
      </ActionButton>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.classList.contains("gh-primary-button")).toBe(true);
    fireEvent.click(button);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("swallows clicks and surfaces the disabled reason via title when disabled", () => {
    const handler = vi.fn();
    render(
      <ActionButton
        variant="primary"
        disabled
        disabledReason="OBO token required to write metadata"
        onClick={handler}
      >
        Save
      </ActionButton>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.click(button);
    expect(handler).not.toHaveBeenCalled();
    expect(button.getAttribute("title")).toBe(
      "OBO token required to write metadata",
    );
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("exposes aria-pressed on segment/subtab variants so screen readers track active state", () => {
    render(
      <ActionButton variant="segment" active>
        Discovery
      </ActionButton>,
    );
    const button = screen.getByRole("button", { name: "Discovery" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("is-active")).toBe(true);
  });

  it("wires ariaDescribedBy through to aria-describedby", () => {
    render(
      <div>
        <p id="disabled-reason">Read-only until OBO lands.</p>
        <ActionButton
          disabled
          disabledReason="Read-only until OBO lands."
          ariaDescribedBy="disabled-reason"
        >
          Save
        </ActionButton>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-describedby")).toBe("disabled-reason");
  });
});
