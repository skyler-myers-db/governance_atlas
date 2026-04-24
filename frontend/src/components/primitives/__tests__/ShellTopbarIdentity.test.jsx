/**
 * Regression tests locking Tranche B fixes on the top-bar identity zone
 * (brand, Quick Action, inbox bell, avatar-before-name).
 *
 * The 23-item audit pointed out that the previous sigma/squiggle brand
 * mark, missing inbox button, missing Quick Action, and name-before-avatar
 * ordering were all divergences from the approved mockup. These tests
 * pin the correct shape so a future well-meaning refactor can't undo
 * them silently.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalHeader } from "../GlobalHeader";

function renderHeader(overrides = {}) {
  return render(
    <GlobalHeader
      shell={{ userEmail: "skyler@tristategt.org", role: "Admin" }}
      activeModule="discovery"
      onOpenDiscovery={() => {}}
      onModuleChange={() => {}}
      showInbox
      inboxOpen={false}
      inboxUnreadCount={0}
      onToggleInbox={() => {}}
      onOpenCommandPalette={() => {}}
      onSignOut={() => {}}
      {...overrides}
    />,
  );
}

describe("GlobalHeader — Tranche B regression suite", () => {
  it("mockup parity: brand mark renders as a lightweight line stack icon", () => {
    const { container } = renderHeader();
    const brand = container.querySelector(".gh-shell-brand-mark svg");
    expect(brand).not.toBeNull();
    expect(brand?.querySelector("rect")).toBeNull();
    expect(brand?.querySelectorAll("path").length).toBeGreaterThanOrEqual(3);
  });

  it("defect 19: inbox button is present in the top bar with accessible name", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "Inbox" })).not.toBeNull();
  });

  it("defect 19: inbox button exposes unread count in accessible name when > 0", () => {
    renderHeader({ inboxUnreadCount: 4 });
    expect(screen.getByRole("button", { name: "Inbox (4 unread)" })).not.toBeNull();
  });

  it("mockup parity 2026-04-19: Quick action is NOT in the header tail — it moved to the Discovery sub-tab row", () => {
    // Operator 2026-04-19 flagged the Quick action belonged next to the
    // Discovery/Navigation tabs, not on the header chrome. The header
    // still accepts onOpenCommandPalette for backwards-compat but does
    // not render a tail button for it anymore.
    renderHeader({ onOpenCommandPalette: vi.fn() });
    expect(screen.queryByRole("button", { name: /Quick action/i })).toBeNull();
  });

  it("mockup parity 2026-04-19: Alerts bell renders in the tail (where Quick action used to sit)", () => {
    renderHeader({ onToggleAlerts: vi.fn(), alertsUnreadCount: 0 });
    // Bell always renders when onToggleAlerts is wired, regardless of
    // unread count — the dot only paints for real unread alerts.
    expect(screen.getByRole("button", { name: "Alerts" })).not.toBeNull();
  });

  it("defect 20: user chip renders avatar BEFORE the name/role column", () => {
    const { container } = renderHeader();
    const trigger = container.querySelector(".gh-user-chip-trigger");
    expect(trigger).not.toBeNull();
    // First child must be the avatar; the identity column comes second.
    expect(trigger?.firstElementChild?.classList.contains("gh-user-chip-avatar")).toBe(true);
    expect(trigger?.children[1]?.classList.contains("gh-user-chip-identity")).toBe(true);
  });

  it("defect 20: clicking the user chip trigger opens a profile menu with Sign out", () => {
    const onSignOut = vi.fn();
    renderHeader({ onSignOut });
    // fireEvent.click wraps the state change in act() so the menu renders
    // before we query for it.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Open profile menu/i }));
    });
    expect(screen.getByRole("menu")).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("mockup parity: brand, search slot, and tail are arranged brand → center → right", () => {
    const { container } = renderHeader({
      topbarSearchSlot: <div data-testid="topbar-search-slot" />,
    });
    const band = container.querySelector(".gh-shell-brand-band");
    expect(band).not.toBeNull();
    // Exactly three direct children in this order: brand / search slot / tail.
    const kids = Array.from(band?.children || []);
    expect(kids.length).toBe(3);
    expect(kids[0].classList.contains("gh-shell-brand")).toBe(true);
    expect(kids[1].classList.contains("gh-shell-brand-search-slot")).toBe(true);
    expect(kids[2].classList.contains("gh-shell-brand-tail")).toBe(true);
    // Search slot actually carries the passed search element.
    expect(kids[1].querySelector("[data-testid='topbar-search-slot']")).not.toBeNull();
  });

  it("mockup parity: tail cluster contains alerts, help, inbox, and user chip", () => {
    renderHeader({ alertsUnreadCount: 0, onToggleAlerts: () => {} });
    const tail = document.querySelector(".gh-shell-brand-tail");
    expect(tail).not.toBeNull();
    expect(tail?.querySelector("button[aria-label='Alerts']")).not.toBeNull();
    expect(tail?.querySelector("button[aria-label='Help']")).not.toBeNull();
    expect(tail?.querySelector("button[aria-label='Inbox']")).not.toBeNull();
    expect(tail?.querySelector(".gh-user-chip-trigger")).not.toBeNull();
    // Quick action is not in the tail — it lives on the Discovery sub-tab row.
    expect(tail?.querySelector(".gh-shell-topbar-quick-action")).toBeNull();
  });

  it("mockup parity: header does not keep a hidden duplicate module nav", () => {
    const { container } = renderHeader();
    expect(container.querySelector(".gh-shell-nav-secondary")).toBeNull();
  });
});
