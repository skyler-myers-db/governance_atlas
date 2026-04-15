import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
      onModuleChange={() => {}}
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
    expect(screen.getByText("Claims narrowed until readiness improves.")).not.toBeNull();
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
