import { act, fireEvent, render, screen } from "@testing-library/react";
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
        environment: { label: "Dev - DEFAULT" },
      }}
      onOpenHome={() => {}}
      showInbox
      inboxOpen={false}
      inboxUnreadCount={0}
      onToggleInbox={() => {}}
      onOpenAiCopilot={() => {}}
      onSignOut={() => {}}
      {...overrides}
    />,
  );
}

describe("GlobalHeader", () => {
  it("renders Governance Atlas from shell product metadata when provided", () => {
    renderHeader({
      shell: {
        product: { productName: "Governance Atlas" },
        role: "Admin",
        userName: "Skyler Kohler",
        userEmail: "skyler@entrada.ai",
        environment: { label: "Dev - DEFAULT" },
      },
    });
    expect(screen.getByRole("button", { name: "Governance Atlas" })).not.toBeNull();
    expect(screen.getByText("Governance Atlas")).not.toBeNull();
  });

  it("falls back to the configured Governance Atlas product name without shell product metadata", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: PRODUCT.productName })).not.toBeNull();
    expect(screen.getByText(PRODUCT.productName)).not.toBeNull();
  });

  it("renders Entrada company label and truth-backed environment chip", () => {
    renderHeader();
    expect(screen.getByText(PRODUCT.companyName)).not.toBeNull();
    expect(screen.getByText("Dev - DEFAULT")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Dev - DEFAULT" })).toBeNull();
  });

  it("opens the AI Copilot surface without routing through the command palette", () => {
    const onOpenAiCopilot = vi.fn();
    renderHeader({ onOpenAiCopilot });
    const ai = screen.getByRole("button", { name: "AI Copilot" });
    expect(ai.disabled).toBe(false);
    expect(ai.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(ai);
    expect(onOpenAiCopilot).toHaveBeenCalledTimes(1);
  });

  it("renders notifications with unread count when governance inbox has unread items", () => {
    renderHeader({ inboxUnreadCount: 4 });
    expect(screen.getByRole("button", { name: "Notifications (4 unread)" })).not.toBeNull();
  });

  it("user chip renders avatar before the name/role column and opens profile menu", () => {
    const onSignOut = vi.fn();
    const { container } = renderHeader({ onSignOut });
    const trigger = container.querySelector(".gh-user-chip-trigger");
    expect(trigger?.firstElementChild?.classList.contains("gh-user-chip-avatar")).toBe(true);
    expect(trigger?.firstElementChild?.textContent).toBe("SK");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Open profile menu/i }));
    });
    expect(screen.getByRole("menu")).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("does not render hidden duplicate module navigation in the topbar", () => {
    const { container } = renderHeader();
    expect(container.querySelector(".gh-shell-nav-secondary")).toBeNull();
  });
});
