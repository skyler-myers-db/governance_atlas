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
  onModuleChange = () => { },
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
      onBrowseCatalog={() => { }}
      onModuleChange={onModuleChange}
      onNavigationStateChange={() => { }}
      onSearchResultSelect={() => { }}
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
  it("opens workspace setup via the profile menu when diagnostics are available", () => {
    const onToggle = vi.fn();
    render(
      <AppFrame
        activeModule="discovery"
        bootMessage=""
        bootState="live"
        diagnosticsAvailable
        diagnosticsStatus={null}
        diagnosticsOpen={false}
        liveCatalogVisibleCount={3}
        navigationState={{ pending: false, label: "" }}
        onBrowseCatalog={() => { }}
        onInboxItemAction={() => { }}
        onModuleChange={() => { }}
        onNavigationStateChange={() => { }}
        onSearchResultSelect={() => { }}
        onToggleDiagnostics={onToggle}
        onToggleInbox={() => { }}
        searchSeedAssets={[]}
        shell={{ role: "Admin", userEmail: "admin@example.com" }}
        visibleAssetSet={new Set()}
      >
        <div>Workspace body</div>
      </AppFrame>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open profile menu for Admin/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings & diagnostics" }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("keeps diagnostics available from the profile menu regardless of diagnostics state", () => {
    render(<FrameHarness diagnosticsAvailable={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Open profile menu for Admin/i }));
    expect(screen.getByRole("menuitem", { name: "Settings & diagnostics" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Workspace setup" })).toBeNull();
  });

  it("does not surface 'Setup attention' copy in the topbar", () => {
    render(
      <FrameHarness
        diagnosticsAvailable
        diagnosticsStatus={{
          state: "attention_required",
          nextStep: "per_user_authorization",
        }}
      />,
    );

    // Setup attention copy moved into the diagnostics drawer (not rendered in
    // this harness). The topbar must be clean to match the target mockup.
    expect(screen.queryByText("Setup attention")).toBeNull();
    expect(screen.queryByText(/Next step: Per User Authorization/i)).toBeNull();
  });

  it("renders the topbar search input with the discovery-wide placeholder", () => {
    render(<FrameHarness />);

    // The topbar search is the global entry point for catalog lookup. The
    // placeholder guidance used to live in a separate command-bar block; it
    // now reads from the input's placeholder attribute instead.
    const searchInput = screen.getByLabelText(
      /Search Databricks Unity Catalog/i,
    );
    expect(searchInput).not.toBeNull();
    expect(searchInput.getAttribute("placeholder")).toMatch(
      /Search tables, columns, pipelines, assets/i,
    );
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

  it("routes the brand button and visible rail buttons through the shared module callback", () => {
    const onModuleChange = vi.fn();

    render(<FrameHarness onModuleChange={onModuleChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Governance Hub/i }));
    fireEvent.click(screen.getByRole("button", { name: "Go to Catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to Lineage" }));

    expect(onModuleChange).toHaveBeenNthCalledWith(1, "discovery");
    expect(onModuleChange).toHaveBeenNthCalledWith(2, "discovery");
    expect(onModuleChange).toHaveBeenNthCalledWith(3, "lineage");
  });

  it("keeps diagnostics reachable via the profile menu even without a 'Workspace setup' trigger", () => {
    render(
      <FrameHarness
        diagnosticsAvailable={false}
        diagnosticsStatus={{
          state: "attention_required",
          nextStep: "per_user_authorization",
        }}
      />,
    );

    // The topbar no longer surfaces "Setup attention" copy or a dedicated
    // "Workspace setup" button. Diagnostics remain available from the
    // identity menu so the rail can stay focused on product navigation.
    expect(screen.queryByText("Setup attention")).toBeNull();
    expect(screen.queryByRole("button", { name: "Workspace setup" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open profile menu for Admin/i }));
    expect(screen.getByRole("menuitem", { name: "Settings & diagnostics" })).not.toBeNull();
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

    // The inbox trigger lives in the top bar as a dedicated tray icon
    // (separate from the user chip). Its accessible name reads "Inbox (N
    // unread)" when there are unread items.
    fireEvent.click(
      screen.getByRole("button", { name: /Inbox \(2 unread\)/i }),
    );

    expect(screen.getByText("Inbox ready")).not.toBeNull();
    expect(screen.getByText("2 unread")).not.toBeNull();
    expect(screen.getByText("Review requested")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Mark read" })[0]).not.toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Mark read" })[0]);

    expect(screen.getByText("1 unread")).not.toBeNull();
    expect(screen.getByText("Read")).not.toBeNull();
  });
});
