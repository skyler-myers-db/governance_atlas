import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PRODUCT } from "../../../config/product";
import { GlobalHeader } from "../GlobalHeader";

function renderHeader(overrides = {}) {
  return render(
    <GlobalHeader
      shell={{
        userEmail: "skyler@entrada.ai",
        userName: "Skyler Kohler",
        role: "Admin",
        environment: {
          label: "Dev - DEFAULT",
          displayLabel: "Dev · datapact.atlas",
          target: "Dev",
          catalog: "datapact",
          schema: "atlas",
          warehouseId: "da02d15a9490650b",
        },
      }}
      onOpenHome={() => {}}
      showInbox
      inboxOpen={false}
      inboxUnreadCount={0}
      onToggleInbox={() => {}}
      onOpenAiCopilot={() => {}}
      onOpenHelp={() => {}}
      environmentTone="good"
      ucCoverageScore={87.4}
      ucStatusState="live"
      {...overrides}
    />,
  );
}

describe("GlobalHeader", () => {
  it("renders the workspace breadcrumb from shell environment metadata", () => {
    renderHeader({
      shell: {
        product: { productName: "Governance Atlas" },
        role: "Admin",
        userName: "Skyler Kohler",
        userEmail: "skyler@entrada.ai",
        environment: { label: "Dev - DEFAULT", displayLabel: "Dev · datapact.atlas" },
      },
    });
    expect(screen.getByRole("button", { name: "Open Governance Atlas Command Center" })).not.toBeNull();
    expect(screen.getByText("Workspace")).not.toBeNull();
    expect(screen.getByText("Dev - DEFAULT")).not.toBeNull();
  });

  it("falls back to the configured Governance Atlas command center label without shell product metadata", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: `Open ${PRODUCT.productName} Command Center` })).not.toBeNull();
  });

  it("renders the truth-backed environment chip", () => {
    renderHeader();
    expect(screen.getByText("UC connected · 87.4% coverage")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "UC connected · 87.4% coverage" })).toBeNull();
  });

  it("treats prototype shell status as unavailable UC evidence", () => {
    renderHeader({ environmentTone: "warn", ucStatusState: "prototype_mock" });
    expect(screen.getByText("UC unavailable")).not.toBeNull();
  });

  it("opens the Atlas AI surface without routing through the command palette", () => {
    const onOpenAiCopilot = vi.fn();
    renderHeader({ onOpenAiCopilot });
    const ai = screen.getByRole("button", { name: "Atlas AI" });
    expect(ai.disabled).toBe(false);
    expect(ai.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(ai);
    expect(onOpenAiCopilot).toHaveBeenCalledTimes(1);
  });

  it("renders notifications with unread count when governance inbox has unread items", () => {
    renderHeader({ inboxUnreadCount: 4 });
    expect(screen.getByRole("button", { name: "Notifications (4 unread)" })).not.toBeNull();
  });

  it("marks notifications degraded without disabling inbox navigation", () => {
    const onToggleInbox = vi.fn();
    renderHeader({
      inboxMessage: "Notification delivery health is unavailable.",
      inboxState: "unavailable",
      onToggleInbox,
    });
    const notifications = screen.getByRole("button", { name: "Notifications unavailable" });
    expect(notifications.className).toContain("is-unavailable");
    expect(notifications.getAttribute("title")).toContain("Notification delivery health is unavailable");
    fireEvent.click(notifications);
    expect(onToggleInbox).toHaveBeenCalledTimes(1);
  });

  it("keeps profile identity out of the topbar and exposes help in the action cluster", () => {
    const onOpenHelp = vi.fn();
    const { container } = renderHeader({ onOpenHelp });
    expect(container.querySelector(".gh-user-chip-trigger")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("does not render hidden duplicate module navigation in the topbar", () => {
    const { container } = renderHeader();
    expect(container.querySelector(".gh-shell-nav-secondary")).toBeNull();
  });
});
