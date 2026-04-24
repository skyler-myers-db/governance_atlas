/**
 * Regression tests locking Tranche A fixes on the left icon rail.
 *
 * Each test corresponds to a defect the user flagged in the 2026-04-19
 * reconstruction audit (numbers map to that audit's 23-item list).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SideIconRail } from "../SideIconRail";

describe("SideIconRail — Tranche A regression suite", () => {
  it("mockup parity: Catalog is the active rail item when the surface is discovery", () => {
    render(<SideIconRail activeModule="discovery" onModuleChange={() => {}} />);
    const catalog = screen.getByLabelText("Go to Catalog");
    const lineage = screen.getByLabelText("Go to Lineage");
    expect(catalog.classList.contains("is-active")).toBe(true);
    expect(lineage.classList.contains("is-active")).toBe(false);
  });

  it("mockup parity: Reporting rail button routes to the audit/reporting surface", () => {
    const onModuleChange = vi.fn();
    render(<SideIconRail activeModule="discovery" onModuleChange={onModuleChange} />);
    screen.getByLabelText("Go to Reporting").click();
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

  it("mockup parity: rail exposes the labeled metadata-product nav set", () => {
    const { container } = render(
      <SideIconRail activeModule="discovery" onModuleChange={() => {}} />,
    );
    const nav = container.querySelector(".gh-side-rail-nav");
    expect(nav).not.toBeNull();
    const labels = Array.from(nav?.querySelectorAll("button") || []).map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "Go to Catalog",
      "Go to Lineage",
      "Go to Governance",
      "Go to Quality",
      "Go to Glossary",
      "Go to Reporting",
    ]);
  });

  it("mockup parity: rail collapse control is a real toggle", () => {
    const { container } = render(
      <SideIconRail activeModule="discovery" onModuleChange={() => {}} />,
    );
    const rail = container.querySelector(".gh-side-rail");
    const collapse = screen.getByLabelText("Collapse navigation");
    expect(rail?.classList.contains("is-collapsed")).toBe(false);
    fireEvent.click(collapse);
    expect(rail?.classList.contains("is-collapsed")).toBe(true);
    expect(screen.getByLabelText("Expand navigation")).not.toBeNull();
  });

  it("mockup parity: rail footer contains notifications + sign out in order", () => {
    const { container } = render(
      <SideIconRail activeModule="discovery" onModuleChange={() => {}} />,
    );
    const footer = container.querySelector(".gh-side-rail-footer");
    expect(footer).not.toBeNull();
    const buttons = Array.from(footer?.querySelectorAll("button") || []);
    const labels = buttons.map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Notifications", "Sign out"]);
  });

  it("mockup parity: Notifications button opens the in-app inbox surface", () => {
    const origOpen = window.open;
    window.open = vi.fn();
    const onModuleChange = vi.fn();
    render(<SideIconRail activeModule="discovery" onModuleChange={onModuleChange} />);
    screen.getByLabelText("Notifications").click();
    expect(window.open).not.toHaveBeenCalled();
    expect(onModuleChange).toHaveBeenCalledWith("inbox");
    window.open = origOpen;
  });

  it("mockup parity: Notifications button lights up as active on inbox", () => {
    render(<SideIconRail activeModule="inbox" onModuleChange={() => {}} />);
    const notifications = screen.getByLabelText("Notifications");
    expect(notifications.classList.contains("is-active")).toBe(true);
  });
});
