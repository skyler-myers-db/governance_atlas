/**
 * Regression tests locking Tranche A fixes on the left icon rail.
 *
 * Each test corresponds to a defect the user flagged in the 2026-04-19
 * reconstruction audit (numbers map to that audit's 23-item list).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SideIconRail } from "../SideIconRail";

describe("SideIconRail — Tranche A regression suite", () => {
  it("defect 1: Home and Discovery do not both render as active when the surface is discovery", () => {
    render(<SideIconRail activeModule="discovery" onModuleChange={() => {}} />);
    const home = screen.getByLabelText("Go to Home");
    const discovery = screen.getByLabelText("Go to Discovery");
    expect(home.classList.contains("is-active")).toBe(false);
    expect(discovery.classList.contains("is-active")).toBe(true);
  });

  it("defect 17: Activity (clock) rail button reports audit as its module target", () => {
    const onModuleChange = vi.fn();
    render(<SideIconRail activeModule="discovery" onModuleChange={onModuleChange} />);
    screen.getByLabelText("Go to Activity").click();
    expect(onModuleChange).toHaveBeenCalledWith("audit");
  });

  it("defect 15: Sign out asks for confirmation and, when declined, never opens a new window", () => {
    // Stub confirm to decline so we neither open a window nor navigate.
    const origConfirm = window.confirm;
    const origOpen = window.open;
    window.confirm = vi.fn(() => false);
    window.open = vi.fn();

    render(<SideIconRail activeModule="discovery" onModuleChange={() => {}} />);
    screen.getByLabelText("Sign out").click();

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled();

    window.confirm = origConfirm;
    window.open = origOpen;
  });

  it("defect 15: Sign out, when confirmed, opens the Databricks workspace sign-out URL in a new tab", () => {
    const origConfirm = window.confirm;
    const origOpen = window.open;
    window.confirm = vi.fn(() => true);
    window.open = vi.fn();

    render(<SideIconRail activeModule="discovery" onModuleChange={() => {}} />);
    screen.getByLabelText("Sign out").click();

    expect(window.open).toHaveBeenCalledTimes(1);
    const [url, target] = window.open.mock.calls[0];
    expect(url).toMatch(/\/login\.html\?action=logOut$/);
    expect(target).toBe("_blank");

    window.confirm = origConfirm;
    window.open = origOpen;
  });

  it("mockup parity 2026-04-20 round 7: Settings sits in the primary nav below Teams & stewards", () => {
    // Operator round 7 moved Settings out of the bottom footer and
    // put it directly below Teams & stewards in the main nav column,
    // with a thin divider above it. Help + Sign out stay at the
    // bottom.
    const { container } = render(
      <SideIconRail activeModule="discovery" onModuleChange={() => {}} />,
    );
    const nav = container.querySelector(".gh-side-rail-nav");
    const footer = container.querySelector(".gh-side-rail-footer");
    expect(nav).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(nav?.querySelector('[aria-label="Settings"]')).not.toBeNull();
    expect(footer?.querySelector('[aria-label="Settings"]')).toBeNull();
    expect(footer?.querySelector('[aria-label="Sign out"]')).not.toBeNull();
    expect(footer?.querySelector('[aria-label="Help"]')).not.toBeNull();
  });

  it("mockup parity 2026-04-20 round 7: rail footer contains only Help + Sign out in order", () => {
    const { container } = render(
      <SideIconRail activeModule="discovery" onModuleChange={() => {}} />,
    );
    const footer = container.querySelector(".gh-side-rail-footer");
    expect(footer).not.toBeNull();
    const buttons = Array.from(footer?.querySelectorAll("button") || []);
    const labels = buttons.map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Help", "Sign out"]);
  });

  it("mockup parity 2026-04-19: Help button opens the in-app help surface, not an external GitHub link", () => {
    // Operator 2026-04-19 flagged the old behavior (opening
    // github.com/entrada-ai/governance_hub#readme in a new tab) as
    // "takes you to a non existent page which should actually be a
    // detailed and helpful part of the app." The button now routes to
    // /help via onModuleChange.
    const origOpen = window.open;
    window.open = vi.fn();
    const onModuleChange = vi.fn();
    render(<SideIconRail activeModule="discovery" onModuleChange={onModuleChange} />);
    screen.getByLabelText("Help").click();
    expect(window.open).not.toHaveBeenCalled();
    expect(onModuleChange).toHaveBeenCalledWith("help");
    window.open = origOpen;
  });

  it("mockup parity 2026-04-19: Help button lights up as active when the current surface is help", () => {
    render(<SideIconRail activeModule="help" onModuleChange={() => {}} />);
    const help = screen.getByLabelText("Help");
    expect(help.classList.contains("is-active")).toBe(true);
  });
});
