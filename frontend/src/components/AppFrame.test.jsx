import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppFrame from "./AppFrame";

vi.mock("../hooks/useAssetSearch", () => ({
  useAssetSearch: () => ({
    assets: [],
    error: "",
    loading: false,
  }),
}));

function FrameHarness({
  diagnosticsAvailable = true,
  diagnosticsStatus = null,
  governanceInbox = null,
  onModuleChange = () => {},
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [currentInbox, setCurrentInbox] = useState(governanceInbox);

  return (
    <AppFrame
      activeModule="discovery"
      bootMessage=""
      bootState="live"
      governanceInbox={currentInbox}
      inboxOpen={inboxOpen}
      diagnosticsAvailable={diagnosticsAvailable}
      diagnosticsStatus={diagnosticsStatus}
      diagnosticsOpen={diagnosticsOpen}
      liveCatalogVisibleCount={3}
      navigationState={{ pending: false, label: "" }}
      onInboxItemAction={(notificationId, action) => {
        setCurrentInbox((current) => {
          if (!current?.items?.length) return current;
          const nextItems = current.items.map((item) => {
            if (item.notificationId !== notificationId) return item;
            if (action === "read") {
              return { ...item, inboxState: "read" };
            }
            if (action === "dismiss") {
              return { ...item, inboxState: "dismissed" };
            }
            return item;
          });
          const unreadCount = nextItems.filter((item) => ["new", "seen", "unread"].includes(item.inboxState)).length;
          return {
            ...current,
            items: nextItems,
            unreadCount,
          };
        });
      }}
      onBrowseCatalog={() => {}}
      onModuleChange={onModuleChange}
      onNavigationStateChange={() => {}}
      onSearchResultSelect={() => {}}
      onToggleDiagnostics={() => setDiagnosticsOpen((current) => !current)}
      onToggleInbox={() => setInboxOpen((current) => !current)}
      searchSeedAssets={[]}
      shell={{
        role: "Admin",
        userEmail: "admin@example.com",
      }}
      visibleAssetSet={new Set()}
    >
      <div>Workspace body</div>
    </AppFrame>
  );
}

describe("AppFrame", () => {
  it("shows a shell-owned workspace setup trigger when diagnostics are available", () => {
    render(<FrameHarness diagnosticsAvailable />);

    const trigger = screen.getByRole("button", { name: "Workspace setup" });
    fireEvent.click(trigger);

    expect(screen.getByRole("button", { name: "Hide workspace setup" })).not.toBeNull();
  });

  it("hides the workspace setup trigger when diagnostics are unavailable", () => {
    render(<FrameHarness diagnosticsAvailable={false} />);

    expect(screen.queryByRole("button", { name: "Workspace setup" })).toBeNull();
  });

  it("shows a compact setup status hint when readiness needs attention", () => {
    render(
      <FrameHarness
        diagnosticsAvailable
        diagnosticsStatus={{
          state: "attention_required",
          nextStep: "per_user_authorization",
        }}
      />,
    );

    expect(screen.getByText("Setup attention")).not.toBeNull();
    expect(screen.getByText("Next step: Per User Authorization.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Workspace setup" })).not.toBeNull();
  });

  it("shows command bar guidance and visible catalog scope copy", () => {
    render(<FrameHarness />);

    expect(screen.getByText("Command bar")).not.toBeNull();
    expect(
      screen.getAllByText(
        "Search covers the workspace inventory visible to the app. Press Enter or Browse to open the full Discovery surface.",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("3 visible assets indexed")).not.toBeNull();
  });

  it("publishes a measured shell header height for sticky workspace offsets", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const baseRect = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON() {
          return {};
        },
      };
      if (this.classList?.contains("gh-shell-header")) {
        return {
          ...baseRect,
          width: 1280,
          right: 1280,
          height: 264,
          bottom: 264,
        };
      }
      return baseRect;
    });

    try {
      const { container } = render(<FrameHarness />);
      const app = container.querySelector(".gh-app");
      if (!app) throw new Error("Expected app shell root");

      await waitFor(() => {
        expect(app.style.getPropertyValue("--gh-shell-header-height")).toBe("264px");
      });
      expect(app.getAttribute("data-shell-sticky-ready")).toBe("true");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("routes the brand button and discovery tab through the shared discovery module callback", () => {
    const onModuleChange = vi.fn();

    render(<FrameHarness onModuleChange={onModuleChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Governance Hub/i }));
    fireEvent.click(screen.getByRole("button", { name: "Discovery" }));
    fireEvent.click(screen.getByRole("button", { name: "Lineage" }));

    expect(onModuleChange).toHaveBeenNthCalledWith(1, "discovery");
    expect(onModuleChange).toHaveBeenNthCalledWith(2, "discovery");
    expect(onModuleChange).toHaveBeenNthCalledWith(3, "lineage");
  });

  it("keeps a generic setup status hint visible when the diagnostics trigger is unavailable", () => {
    render(
      <FrameHarness
        diagnosticsAvailable={false}
        diagnosticsStatus={{
          state: "attention_required",
          nextStep: "per_user_authorization",
        }}
      />,
    );

    expect(screen.getByText("Setup attention")).not.toBeNull();
    expect(screen.getByText("Setup diagnostics have not loaded yet.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Workspace setup" })).toBeNull();
  });

  it("shows a shell-owned inbox trigger and panel for unread notifications", () => {
    render(
      <FrameHarness
        governanceInbox={{
          state: "ready",
          message: "Notifications from workflow activity.",
          unreadCount: 2,
          items: [
            {
              notificationId: "notification-1",
              title: "Review requested",
              detail: "Ownership change needs approval.",
              assetFqn: "main.sales.orders",
              createdAt: "2026-04-14T22:00:00Z",
              createdBy: "admin@example.com",
              status: "open",
              inboxState: "new",
            },
            {
              notificationId: "notification-2",
              title: "Task acknowledged",
              detail: "A steward acknowledged the request.",
              assetFqn: "main.sales.customers",
              createdAt: "2026-04-14T22:05:00Z",
              createdBy: "writer@example.com",
              status: "open",
              inboxState: "new",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));

    expect(screen.getByText("Inbox ready")).not.toBeNull();
    expect(screen.getByText("2 unread")).not.toBeNull();
    expect(screen.getByText("Review requested")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Mark read" })[0]).not.toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Mark read" })[0]);

    expect(screen.getByText("1 unread")).not.toBeNull();
    expect(screen.getByText("Read")).not.toBeNull();
  });
});
