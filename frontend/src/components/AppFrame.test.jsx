import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppFrame from "./AppFrame";
import { fetchAtlasAiRecommendations } from "../lib/api";

vi.mock("../hooks/useAssetSearch", () => ({
  useAssetSearch: () => ({
    assets: [],
    error: "",
    loading: false,
  }),
}));

vi.mock("../lib/api", () => ({
  fetchAtlasAiRecommendations: vi.fn(),
}));

function FrameHarness({
  activeModule = "discovery",
  bootState = "live",
  diagnosticsAvailable = true,
  diagnosticsStatus = null,
  governanceInbox = null,
  shellOverrides = {},
  onModuleChange = () => { },
}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [currentInbox, setCurrentInbox] = useState(governanceInbox);

  return (
    <AppFrame
      activeModule={activeModule}
      bootMessage=""
      bootState={bootState}
      governanceInbox={currentInbox}
      inboxOpen={inboxOpen}
      diagnosticsAvailable={diagnosticsAvailable}
      diagnosticsStatus={diagnosticsStatus}
      diagnosticsOpen={diagnosticsOpen}
      liveCatalogVisibleCount={3}
      ucCoverageScore={87.4}
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
        userName: "Admin User",
        userEmail: "admin@example.com",
        ai: { state: "available" },
        ...shellOverrides,
      }}
      visibleAssetSet={new Set()}
    >
      <div>Workspace body</div>
    </AppFrame>
  );
}

describe("AppFrame", () => {
  it("opens workspace setup from the profile menu when diagnostics are available", () => {
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
        ucCoverageScore={87.4}
        navigationState={{ pending: false, label: "" }}
        onBrowseCatalog={() => { }}
        onInboxItemAction={() => { }}
        onModuleChange={() => { }}
        onNavigationStateChange={() => { }}
        onSearchResultSelect={() => { }}
        onToggleDiagnostics={onToggle}
        onToggleInbox={() => { }}
        searchSeedAssets={[]}
        shell={{ role: "Admin", userEmail: "admin@example.com", ai: { state: "available" } }}
        visibleAssetSet={new Set()}
      >
        <div>Workspace body</div>
      </AppFrame>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open profile menu/i }));
    const settings = screen.getByRole("menuitem", { name: "Settings & diagnostics" });
    fireEvent.click(settings);
    expect(onToggle).toHaveBeenCalled();
  });

  it("keeps profile settings available regardless of diagnostics state", () => {
    render(<FrameHarness diagnosticsAvailable={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Open profile menu/i }));
    expect(screen.getByRole("menuitem", { name: "Settings & diagnostics" })).not.toBeNull();
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
      /Search assets, columns, glossary terms, owners/i,
    );
    expect(searchInput).not.toBeNull();
    expect(searchInput.getAttribute("placeholder")).toMatch(
      /Search assets, columns, glossary terms, owners/i,
    );
  });

  it("submits global search with Enter and the mouse submit control", () => {
    const onBrowseCatalog = vi.fn();

    render(
      <AppFrame
        activeModule="home"
        bootMessage=""
        bootState="live"
        diagnosticsAvailable
        diagnosticsStatus={null}
        diagnosticsOpen={false}
        liveCatalogVisibleCount={3}
        ucCoverageScore={87.4}
        navigationState={{ pending: false, label: "" }}
        onBrowseCatalog={onBrowseCatalog}
        onInboxItemAction={() => { }}
        onModuleChange={() => { }}
        onNavigationStateChange={() => { }}
        onSearchResultSelect={() => { }}
        onToggleDiagnostics={() => { }}
        onToggleInbox={() => { }}
        searchSeedAssets={[]}
        shell={{ role: "Admin", userEmail: "admin@example.com", ai: { state: "available" } }}
        visibleAssetSet={new Set()}
      >
        <div>Workspace body</div>
      </AppFrame>,
    );

    const searchInput = screen.getByLabelText(/Search assets, columns, glossary terms, owners/i);
    fireEvent.change(searchInput, { target: { value: "net revenue" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    fireEvent.submit(searchInput.closest("form"));

    expect(onBrowseCatalog).toHaveBeenLastCalledWith("net revenue");

    fireEvent.change(searchInput, { target: { value: "customer profile" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit global search" }));

    expect(onBrowseCatalog).toHaveBeenLastCalledWith("customer profile");
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

  it("routes the brand button to Home and discovery tab through the shared module callback", () => {
    const onModuleChange = vi.fn();

    render(<FrameHarness onModuleChange={onModuleChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Open Governance Atlas Command Center/i }));
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    fireEvent.click(screen.getByRole("button", { name: "Lineage Atlas" }));

    expect(onModuleChange).toHaveBeenNthCalledWith(1, "home");
    expect(onModuleChange).toHaveBeenNthCalledWith(2, "discovery");
    expect(onModuleChange).toHaveBeenNthCalledWith(3, "lineage");
  });

  it("opens Atlas AI as a floating chat without changing the active route", () => {
    const onModuleChange = vi.fn();

    render(<FrameHarness onModuleChange={onModuleChange} />);

    if (!screen.queryByRole("dialog", { name: "Atlas AI" })) {
      fireEvent.click(screen.getByRole("button", { name: "Atlas AI" }));
    }
    expect(screen.getByRole("dialog", { name: "Atlas AI" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Atlas AI" }));
    expect(screen.queryByRole("dialog", { name: "Atlas AI" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Atlas AI" }));

    expect(onModuleChange).not.toHaveBeenCalledWith("home");
    const dialog = screen.getByRole("dialog", { name: "Atlas AI" });
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("gh-floating-ai-chat")).toBe(true);
    expect(screen.queryByRole("dialog", { name: /command/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close Atlas AI" }));
    expect(screen.queryByRole("dialog", { name: "Atlas AI" })).toBeNull();
  });

  it("does not auto-open Atlas AI on Lineage Atlas, but keeps the launcher operational", async () => {
    render(<FrameHarness activeModule="lineage" />);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Atlas AI" })).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Atlas AI" }));
    expect(screen.getByRole("dialog", { name: "Atlas AI" })).not.toBeNull();
  });

  it("closes the floating Atlas AI dialog with Escape while preserving shell controls", () => {
    render(<FrameHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Atlas AI" }));
    expect(screen.getByRole("dialog", { name: "Atlas AI" })).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Atlas AI" })).toBeNull();

    expect(screen.getByRole("button", { name: "Open Atlas AI" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Open profile menu/i })).not.toBeNull();
  });

  it("opens an unavailable Atlas AI panel when runtime marks the provider unavailable", () => {
    render(
      <FrameHarness
        shellOverrides={{
          ai: {
            state: "unavailable",
            message: "Atlas AI is configured for Genie, but GOVAT_GENIE_SPACE_ID is missing.",
          },
        }}
      />,
    );

    const headerButton = screen.getByRole("button", { name: "Atlas AI" });
    expect(headerButton.disabled).toBe(true);
    const button = screen.getByRole("button", {
      name: /Open Atlas AI unavailable state: Atlas AI is configured for Genie/i,
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Atlas AI" })).not.toBeNull();
    expect(screen.getByText(/GOVAT_GENIE_SPACE_ID is missing/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ask Atlas AI" }).disabled).toBe(true);
  });

  it("keeps non-authoritative Atlas AI answers unavailable while preserving the panel workflow", () => {
    render(
      <FrameHarness
        bootState="degraded"
        shellOverrides={{
          ai: {
            state: "prototype_mock",
            provider: "prototype-mock",
            message: "Prototype mock data, not live Databricks evidence.",
          },
        }}
      />,
    );

    const headerButton = screen.getByRole("button", { name: "Atlas AI" });
    expect(headerButton.disabled).toBe(true);
    const button = screen.getByRole("button", {
      name: /Open Atlas AI unavailable state: Prototype mock data/i,
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Atlas AI" })).not.toBeNull();
    expect(screen.getByText(/Prototype mock data, not live Databricks evidence/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ask Atlas AI" }).disabled).toBe(true);
  });

  it("uses route-specific Atlas AI prompts and input copy", () => {
    const { rerender } = render(
      <FrameHarness activeModule="admin" shellOverrides={{ ai: { state: "available", provider: "genie" } }} />,
    );

    if (!screen.queryByRole("dialog", { name: "Atlas AI" })) {
      fireEvent.click(screen.getByRole("button", { name: "Open Atlas AI" }));
    }

    expect(screen.getByText("Which runtime job or integration needs attention?")).not.toBeNull();
    expect(screen.getByPlaceholderText("Ask about runtime jobs, integrations, or policies...")).not.toBeNull();
    expect(screen.getByText(/runtime health, integrations, policy coverage/i)).not.toBeNull();

    rerender(
      <FrameHarness activeModule="audit" shellOverrides={{ ai: { state: "available", provider: "genie" } }} />,
    );

    expect(screen.getByText("Summarize audit evidence for the selected window.")).not.toBeNull();
    expect(screen.getByPlaceholderText("Ask about audit evidence, grants, or exports...")).not.toBeNull();
  });

  it("renders routed Atlas AI evidence chips for grounded answers", async () => {
    const onSearchResultSelect = vi.fn();
    fetchAtlasAiRecommendations.mockResolvedValueOnce({
      answer: "Genie said: **finance_prod.curated.revenue_daily** is certified.",
      evidence: [
        {
          label: "finance_prod.curated.revenue_daily",
          type: "asset",
        },
      ],
    });

    render(
      <AppFrame
        activeModule="home"
        bootMessage=""
        bootState="live"
        diagnosticsAvailable
        diagnosticsStatus={null}
        diagnosticsOpen={false}
        liveCatalogVisibleCount={3}
        ucCoverageScore={87.4}
        navigationState={{ pending: false, label: "" }}
        onBrowseCatalog={() => { }}
        onInboxItemAction={() => { }}
        onModuleChange={() => { }}
        onNavigationStateChange={() => { }}
        onSearchResultSelect={onSearchResultSelect}
        onToggleDiagnostics={() => { }}
        onToggleInbox={() => { }}
        searchSeedAssets={[]}
        shell={{ role: "Admin", userEmail: "admin@example.com", ai: { state: "available" } }}
        visibleAssetSet={new Set()}
      >
        <div>Workspace body</div>
      </AppFrame>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Atlas AI" }));
    const input = screen.getByPlaceholderText("Ask about a dashboard, owner, or risk signal...");
    fireEvent.change(input, { target: { value: "Who owns net revenue?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Atlas AI" }));

    await waitFor(() => {
      expect(screen.getByText("1 evidence record returned.")).not.toBeNull();
    });
    expect(screen.queryByText(/Genie said/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /finance_prod\.curated\.revenue_daily/i }));
    expect(onSearchResultSelect).toHaveBeenCalledWith("finance_prod.curated.revenue_daily");
  });

  it("opens generated SQL evidence from Atlas AI as an operational detail panel", async () => {
    fetchAtlasAiRecommendations.mockResolvedValueOnce({
      answer: "There are **three critical assets** without certification.",
      evidence: [
        {
          type: "genie_query",
          metric: "generatedSql",
          statementId: "stmt-123",
          rowCount: 3,
          sql: "SELECT asset_fqn FROM datapact.atlas_ai.atlas_ai_assets_current WHERE is_certified = FALSE",
          resultColumns: ["asset_fqn", "domain"],
          resultRows: [
            { asset_fqn: "datapact.governance_atlas_demo.customer_identity_quality", domain: "Customer" },
          ],
        },
      ],
    });

    render(<FrameHarness activeModule="home" shellOverrides={{ ai: { state: "available", provider: "genie" } }} />);

    fireEvent.click(screen.getByRole("button", { name: "Atlas AI" }));
    const input = screen.getByPlaceholderText("Ask about a dashboard, owner, or risk signal...");
    fireEvent.change(input, { target: { value: "Which critical assets are not certified?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Atlas AI" }));

    await waitFor(() => {
      expect(screen.getByText("1 evidence record returned.")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Generated SQL evidence/i }));

    expect(screen.getByRole("region", { name: "Atlas AI query evidence" })).not.toBeNull();
    expect(screen.getByText("3 metadata rows returned")).not.toBeNull();
    expect(screen.getByTestId("atlas-ai-query-evidence-sql").textContent).toContain("atlas_ai_assets_current");
    expect(screen.getByText("datapact.governance_atlas_demo.customer_identity_quality")).not.toBeNull();
  });

  it("renders Atlas AI markdown without raw formatting artifacts or unsafe links", async () => {
    fetchAtlasAiRecommendations.mockResolvedValueOnce({
      answer: [
        "**Certified** context is available for `finance_prod.curated.revenue_daily`.",
        "",
        "- Evidence is governance metadata.",
        "- Safe reference: [record](https://example.com/asset).",
        "- Unsafe reference: [bad](javascript:alert(1)).",
      ].join("\n"),
      evidence: [],
    });

    const { container } = render(<FrameHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Atlas AI" }));
    const input = screen.getByPlaceholderText("Ask about search results, owners, or glossary coverage...");
    fireEvent.change(input, { target: { value: "markdown rendering proof" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Atlas AI" }));

    await waitFor(() => {
      expect(screen.getByText("Certified")).not.toBeNull();
    });

    const messages = container.querySelectorAll(".gh-ai-message-markdown");
    const message = messages[messages.length - 1];
    expect(message?.querySelector("strong")?.textContent).toBe("Certified");
    expect(message?.querySelector("code")?.textContent).toBe("finance_prod.curated.revenue_daily");
    expect(message?.querySelectorAll("li").length).toBe(3);
    expect(message?.textContent).not.toContain("**");
    expect(message?.textContent).not.toContain("`finance_prod");
    expect(message?.querySelector("a[href^='https://']")?.textContent).toBe("record");
    expect(message?.querySelector("a[href^='javascript:']")).toBeNull();
  });

  it("uses the prototype rail without exposing the legacy collapse control", () => {
    const { container } = render(<FrameHarness />);

    expect(container.querySelector(".gh-app")?.getAttribute("data-rail-collapsed")).toBe("false");
    expect(screen.queryByRole("button", { name: /Collapse navigation/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Expand navigation/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Open profile menu/i })).not.toBeNull();
  });

  it("renders the stewardship shell badge from the governance inbox count", () => {
    render(
      <FrameHarness
        governanceInbox={{
          state: "ready",
          message: "Notifications from workflow activity.",
          unreadCount: 2,
          stewardshipCount: 184,
          items: [],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /Stewardship/ })).not.toBeNull();
    expect(screen.getByText("184")).not.toBeNull();
  });

  it("uses topbar help/status chrome instead of visible footer links", () => {
    const onModuleChange = vi.fn();
    const onOpenCapabilities = vi.fn();

    render(
      <AppFrame
        activeModule="home"
        bootMessage=""
        bootState="live"
        diagnosticsAvailable
        diagnosticsStatus={null}
        diagnosticsOpen={false}
        liveCatalogVisibleCount={3}
        ucCoverageScore={87.4}
        navigationState={{ pending: false, label: "" }}
        onBrowseCatalog={() => { }}
        onInboxItemAction={() => { }}
        onModuleChange={onModuleChange}
        onNavigationStateChange={() => { }}
        onOpenCapabilities={onOpenCapabilities}
        onSearchResultSelect={() => { }}
        onToggleDiagnostics={() => { }}
        onToggleInbox={() => { }}
        searchSeedAssets={[]}
        shell={{ role: "Admin", userEmail: "admin@example.com", ai: { state: "available" } }}
        visibleAssetSet={new Set()}
      >
        <div>Workspace body</div>
      </AppFrame>,
    );

    expect(screen.queryByRole("button", { name: "Privacy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Support" })).toBeNull();
    expect(screen.queryByRole("button", { name: /System Status/i })).toBeNull();
    expect(screen.getByText("UC connected · 87.4% coverage")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(onModuleChange).toHaveBeenCalledWith("help");
    expect(onOpenCapabilities).not.toHaveBeenCalled();
  });

  it("keeps the UC status scoped to app liveness while diagnostics stay separate", () => {
    const { container, rerender } = render(<FrameHarness diagnosticsStatus={null} />);

    expect(screen.getByText("UC connected · 87.4% coverage").closest(".ga-env-chip")?.className).toContain("tone-good");
    expect(container.querySelector(".ga-env-chip .ga-status-dot")).not.toBeNull();

    rerender(<FrameHarness diagnosticsStatus={{ state: "attention_required" }} />);
    expect(screen.getByText("UC connected · 87.4% coverage").closest(".ga-env-chip")?.className).toContain("tone-good");

    rerender(<FrameHarness diagnosticsStatus={{ state: "degraded" }} />);
    expect(screen.getByText("UC connected · 87.4% coverage").closest(".ga-env-chip")?.className).toContain("tone-good");

    rerender(<FrameHarness diagnosticsStatus={{ state: "unavailable" }} />);
    expect(screen.getByText("UC connected · 87.4% coverage").closest(".ga-env-chip")?.className).toContain("tone-good");

    rerender(<FrameHarness diagnosticsStatus={{ state: "ready" }} />);
    expect(screen.getByText("UC connected · 87.4% coverage").closest(".ga-env-chip")?.className).toContain("tone-good");

    rerender(<FrameHarness bootState="degraded" diagnosticsStatus={{ state: "ready" }} />);
    expect(screen.getByText("UC status degraded").closest(".ga-env-chip")?.className).toContain("tone-warn");
  });

  it("keeps non-authoritative Atlas AI provider metadata from changing UC app liveness", () => {
    render(
      <FrameHarness
        shellOverrides={{
          ai: {
            state: "available",
            provider: "local-prototype-mock",
            message: "Atlas AI provider is unavailable.",
          },
        }}
      />,
    );

    expect(screen.getByText("UC connected · 87.4% coverage").closest(".ga-env-chip")?.className).toContain("tone-good");
    const headerButton = screen.getByRole("button", { name: "Atlas AI" });
    expect(headerButton.disabled).toBe(true);
    const button = screen.getByRole("button", {
      name: /Open Atlas AI unavailable state: Atlas AI provider is unavailable/i,
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Atlas AI" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ask Atlas AI" }).disabled).toBe(true);
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

    expect(screen.queryByText("Setup attention")).toBeNull();
    expect(screen.queryByRole("button", { name: "Workspace setup" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open profile menu/i }));
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

    fireEvent.click(
      screen.getByRole("button", { name: /Notifications \(2 unread\)/i }),
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
