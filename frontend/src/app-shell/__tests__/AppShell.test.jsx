/*
 * Wave B1 shell tests — replaces the old App.test.jsx / AppFrame.test.jsx,
 * which asserted the dead architecture (13-branch switch, AppFrame props).
 * Covers: route generation from nav/routes.js, alias redirects via
 * resolveUrl, rail generation (incl. the contextual Asset 360 entry and the
 * admin gate), the my-work badge hydration contract, the unified palette,
 * the ?peek= drawer binding, and boot gating.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useBootstrapMock = vi.fn();
const useRuntimeStatusMock = vi.fn();
const useGovernanceSummaryMock = vi.fn();
const useInboxWorkMock = vi.fn();
const useCommandCenterMock = vi.fn();
const usePaletteSearchMock = vi.fn();

const homePageMock = vi.fn(() => <div data-testid="home-page" />);
const discoveryMock = vi.fn(() => <div data-testid="discovery-workspace" />);
const entityMock = vi.fn(() => <div data-testid="entity-workspace" />);
const lineageMock = vi.fn(() => <div data-testid="lineage-workspace" />);
const governanceMock = vi.fn(() => <div data-testid="governance-workspace" />);
const auditMock = vi.fn(() => <div data-testid="audit-workspace" />);
const taxonomyMock = vi.fn(() => <div data-testid="taxonomy-workspace" />);
const adminMock = vi.fn(() => <div data-testid="admin-workspace" />);
const capabilityMock = vi.fn(() => <div data-testid="capability-dashboard" />);
const helpMock = vi.fn(() => <div data-testid="help-page" />);
// Wave-B2 contract: the peek panel receives {fqn, open, onClose} and owns
// its own drawer chrome.
const asset360DrawerMock = vi.fn(({ fqn, open }) =>
  open && fqn ? <div data-testid="asset360-drawer">{fqn}</div> : null,
);

vi.mock("../../hooks/useBootstrap", () => ({ useBootstrap: (...args) => useBootstrapMock(...args) }));
vi.mock("../../hooks/useRuntimeStatus", () => ({ useRuntimeStatus: (...args) => useRuntimeStatusMock(...args) }));
vi.mock("../../hooks/useGovernanceSummary", () => ({
  useGovernanceSummary: (...args) => useGovernanceSummaryMock(...args),
}));
vi.mock("../../hooks/useInboxWork", () => ({ useInboxWork: (...args) => useInboxWorkMock(...args) }));
vi.mock("../../hooks/useCommandCenter", () => ({ useCommandCenter: (...args) => useCommandCenterMock(...args) }));
vi.mock("../../hooks/usePaletteSearch", () => ({ usePaletteSearch: (...args) => usePaletteSearchMock(...args) }));
vi.mock("../../hooks/useAtlasAiConversation", () => ({
  useAtlasAiConversation: () => ({
    messages: [],
    loading: false,
    draft: "",
    setDraft: vi.fn(),
    ask: vi.fn(),
  }),
}));

// Wave C2: the Command Center lives at surfaces/home (components/HomePage
// was deleted with the legacy dashboard).
vi.mock("../../surfaces/home/HomePage.jsx", () => ({ default: (props) => homePageMock(props) }));
vi.mock("../../components/DiscoveryWorkspace", () => ({ default: (props) => discoveryMock(props) }));
vi.mock("../../surfaces/asset/AssetHubPage.jsx", () => ({ default: (props) => entityMock(props) }));
vi.mock("../../components/LineageWorkspace", () => ({ default: (props) => lineageMock(props) }));
vi.mock("../../components/GovernanceWorkspace", () => ({ default: (props) => governanceMock(props) }));
vi.mock("../../components/AuditBrowserWorkspace", () => ({ default: (props) => auditMock(props) }));
vi.mock("../../components/TaxonomyWorkspace", () => ({ default: (props) => taxonomyMock(props) }));
vi.mock("../../components/AdminWorkspace", () => ({ default: (props) => adminMock(props) }));
vi.mock("../../components/CapabilityDashboard", () => ({ default: (props) => capabilityMock(props) }));
vi.mock("../../components/HelpPage", () => ({ default: (props) => helpMock(props) }));
vi.mock("../../surfaces/asset/AssetPeekPanel.jsx", () => ({
  AssetPeekPanel: (props) => asset360DrawerMock(props),
  default: (props) => asset360DrawerMock(props),
}));
vi.mock("../../components/WorkspaceSetupWizard", () => ({ default: () => <div data-testid="setup-wizard" /> }));
vi.mock("../../components/WorkspaceDiagnosticsSurface", () => ({
  default: () => <div data-testid="diagnostics-surface" />,
}));

import App from "../../App";

let lastLocation = null;
function LocationProbe() {
  lastLocation = useLocation();
  return null;
}

const LIVE_BOOTSTRAP = {
  bootState: "live",
  shell: {
    userEmail: "skyler@entrada.ai",
    userName: "Skyler",
    role: "Admin",
    ai: { state: "available", provider: "genie" },
    environment: { label: "Dev" },
  },
  identity: { actorEmail: "skyler@entrada.ai", actorRole: "Admin" },
  assets: [{ fqn: "main.core.orders", name: "orders" }],
  discovery: {},
};

function primeHooks({
  bootstrap = LIVE_BOOTSTRAP,
  bootstrapLoading = false,
  bootstrapError = "",
  inboxLoading = false,
  badgeCount = 3,
  unreadCount = 2,
} = {}) {
  useBootstrapMock.mockReturnValue({
    loading: bootstrapLoading,
    shellOnly: false,
    error: bootstrapError,
    refreshError: "",
    data: bootstrapLoading || bootstrapError ? null : bootstrap,
    refresh: vi.fn(),
  });
  useRuntimeStatusMock.mockReturnValue({
    data: null,
    error: "",
    loading: false,
    refreshError: "",
    refreshing: false,
    refresh: vi.fn(),
  });
  useGovernanceSummaryMock.mockReturnValue({
    loading: false,
    refreshing: false,
    error: "",
    refreshError: "",
    data: { inbox: { state: "ready", unreadCount, items: [] } },
    refresh: vi.fn(),
  });
  useInboxWorkMock.mockReturnValue({
    openRequests: [],
    reviewTerms: [],
    badgeCount,
    loading: inboxLoading,
  });
  useCommandCenterMock.mockReturnValue({
    data: { estate: {}, recentAssets: [], insights: {}, meta: {} },
    loading: false,
    hydrating: false,
    hasLiveData: false,
    refreshing: false,
    error: "",
    refreshError: "",
    degraded: false,
    warnings: [],
    meta: null,
    oboScopeFallback: false,
    oboFallbackReason: "",
    refresh: vi.fn(),
    refreshActorScope: vi.fn(),
  });
  usePaletteSearchMock.mockReturnValue({
    assets: [],
    glossaryTerms: [],
    searching: false,
    searchError: "",
    resolvedQuery: "",
  });
}

function renderApp(initialEntry = "/home") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lastLocation = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
  primeHooks();
});

describe("AppShell routing", () => {
  it("renders the Command Center surface at /home", async () => {
    renderApp("/home");
    expect(await screen.findByTestId("home-page")).toBeTruthy();
    expect(lastLocation.pathname).toBe("/home");
  });

  it("redirects every legacy alias to its canonical route", async () => {
    const cases = [
      ["/", "/home", "home-page"],
      ["/command-center", "/home", "home-page"],
      ["/insights", "/home", "home-page"],
      ["/discover", "/discovery", "discovery-workspace"],
      ["/governance", "/stewardship", "governance-workspace"],
      ["/sk", "/stewardship", "governance-workspace"],
      ["/audit", "/evidence", "audit-workspace"],
      ["/audit-evidence", "/evidence", "audit-workspace"],
      ["/taxonomy", "/glossary", "taxonomy-workspace"],
      ["/control-center", "/admin", "admin-workspace"],
    ];
    for (const [from, to, testId] of cases) {
      const view = renderApp(from);
      expect(await screen.findByTestId(testId)).toBeTruthy();
      expect(lastLocation.pathname).toBe(to);
      view.unmount();
    }
  });

  it("redirects /inbox to the stewardship queue scoped to my work", async () => {
    renderApp("/inbox");
    expect(await screen.findByTestId("governance-workspace")).toBeTruthy();
    expect(lastLocation.pathname).toBe("/stewardship");
    expect(new URLSearchParams(lastLocation.search).get("assignee")).toBe("me");
  });

  it("redirects /cde to the glossary CDE tab", async () => {
    renderApp("/cde");
    expect(await screen.findByTestId("taxonomy-workspace")).toBeTruthy();
    expect(lastLocation.pathname).toBe("/glossary");
    expect(new URLSearchParams(lastLocation.search).get("tab")).toBe("cdes");
  });

  it("redirects /capabilities to admin diagnostics and renders the capability dashboard", async () => {
    renderApp("/capabilities");
    expect(await screen.findByTestId("capability-dashboard")).toBeTruthy();
    expect(lastLocation.pathname).toBe("/admin");
    expect(new URLSearchParams(lastLocation.search).get("tab")).toBe("diagnostics");
  });

  it("redirects legacy /entity/* deep links to /assets and mounts the hub with the decoded FQN", async () => {
    renderApp("/entity/main.core.orders");
    expect(await screen.findByTestId("entity-workspace")).toBeTruthy();
    // The rebuilt hub reads :fqn from the router itself — the URL, not a
    // drilled prop, is the contract now.
    expect(lastLocation.pathname).toBe("/assets/main.core.orders");
  });

  it("promotes transient /glossary?term= links to the durable term path", async () => {
    renderApp("/glossary?term=Churn%20Rate");
    expect(await screen.findByTestId("taxonomy-workspace")).toBeTruthy();
    expect(lastLocation.pathname).toBe("/glossary/Churn%20Rate");
    // The legacy TaxonomyWorkspace consumer still gets its staged handoff.
    expect(window.sessionStorage.getItem("ga-pending-glossary-term")).toBe("Churn Rate");
  });

  it("keeps discovery URL state on /discovery (q + shortcut filter merge)", async () => {
    renderApp('/discovery?q=churn&domain=Customer&filters={"tiers":["Gold"]}');
    expect(await screen.findByTestId("discovery-workspace")).toBeTruthy();
    const props = discoveryMock.mock.calls.at(-1)[0];
    expect(props.initialQuery).toBe("churn");
    expect(props.initialFilterGroups.domains).toEqual(["Customer"]);
    expect(props.initialFilterGroups.tiers).toEqual(["Gold"]);
  });

  it("routes bare /lineage to the picker and /lineage/<fqn> to the focused graph", async () => {
    const bare = renderApp("/lineage");
    expect(await screen.findByTestId("lineage-workspace")).toBeTruthy();
    expect(lineageMock.mock.calls.at(-1)[0].initialAssetFqn).toBe("");
    bare.unmount();
    renderApp("/lineage/main.core.orders");
    await waitFor(() =>
      expect(lineageMock.mock.calls.at(-1)[0].initialAssetFqn).toBe("main.core.orders"),
    );
  });

  it("falls back to /home for unknown paths", async () => {
    renderApp("/definitely-not-a-surface");
    expect(await screen.findByTestId("home-page")).toBeTruthy();
    expect(lastLocation.pathname).toBe("/home");
  });
});

describe("AppShell rail", () => {
  it("generates the rail from the route table sections", async () => {
    renderApp("/home");
    await screen.findByTestId("home-page");
    const nav = screen.getByLabelText("Primary modules");
    for (const label of [
      "Command Center",
      "Discover",
      "Stewardship",
      "Glossary & CDEs",
      "Lineage Atlas",
      "Evidence",
      "Control Center",
      "Help",
    ]) {
      expect(nav.textContent).toContain(label);
    }
  });

  it("hides the admin-gated Control Center entry for non-admin roles", async () => {
    primeHooks({
      bootstrap: {
        ...LIVE_BOOTSTRAP,
        shell: { ...LIVE_BOOTSTRAP.shell, role: "Data Steward" },
        identity: { actorEmail: "skyler@entrada.ai", actorRole: "Data Steward" },
      },
    });
    renderApp("/home");
    await screen.findByTestId("home-page");
    expect(screen.getByLabelText("Primary modules").textContent).not.toContain("Control Center");
  });

  it("shows the contextual Asset 360 entry when an asset is in context", async () => {
    renderApp("/assets/main.core.orders");
    await screen.findByTestId("entity-workspace");
    const entry = screen.getByLabelText("Primary modules").querySelector('a[href^="/assets/"]');
    expect(entry).toBeTruthy();
    expect(entry.textContent).toContain("Asset 360");
  });

  it("omits the Asset 360 entry with no asset in context", async () => {
    renderApp("/home");
    await screen.findByTestId("home-page");
    expect(screen.getByLabelText("Primary modules").textContent).not.toContain("Asset 360");
  });

  it("renders rail items as real anchors resolved from the route table", async () => {
    renderApp("/home");
    await screen.findByTestId("home-page");
    const nav = screen.getByLabelText("Primary modules");
    const hrefs = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/discovery");
    expect(hrefs).toContain("/stewardship");
    expect(hrefs).toContain("/evidence");
  });
});

describe("my-work badge hydration contract", () => {
  it("shows no badge while inbox sources are loading (no definitive zeros)", async () => {
    primeHooks({ inboxLoading: true });
    renderApp("/home");
    await screen.findByTestId("home-page");
    expect(document.querySelector(".ga-side-nav-badge")).toBeNull();
  });

  it("shows unread + actionable work once both sources settle", async () => {
    primeHooks({ badgeCount: 3, unreadCount: 2 });
    renderApp("/home");
    await screen.findByTestId("home-page");
    expect(document.querySelector(".ga-side-nav-badge").textContent).toBe("5");
  });
});

describe("palette + drawers", () => {
  it("opens the unified palette on Cmd+K", async () => {
    renderApp("/home");
    await screen.findByTestId("home-page");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByPlaceholderText("Search assets, glossary terms, owners…")).toBeTruthy();
  });

  it("opens the palette from the header search trigger", async () => {
    renderApp("/home");
    await screen.findByTestId("home-page");
    fireEvent.click(screen.getByLabelText("Search assets, glossary terms, and owners"));
    expect(await screen.findByPlaceholderText("Search assets, glossary terms, owners…")).toBeTruthy();
  });

  it("binds the asset preview drawer to ?peek=", async () => {
    renderApp("/home?peek=main.core.orders");
    expect(await screen.findByTestId("asset360-drawer")).toBeTruthy();
    expect(screen.getByTestId("asset360-drawer").textContent).toBe("main.core.orders");
  });
});

describe("boot gating", () => {
  it("renders the boot loading card before bootstrap resolves", async () => {
    primeHooks({ bootstrapLoading: true });
    renderApp("/home");
    expect(await screen.findByText("Preparing the workspace surface.")).toBeTruthy();
    expect(screen.queryByTestId("home-page")).toBeNull();
  });

  it("renders the unavailable card when bootstrap fails", async () => {
    primeHooks({ bootstrapError: "Bootstrap payload was unavailable." });
    renderApp("/home");
    expect(
      await screen.findByText("The live metadata workspace could not initialize."),
    ).toBeTruthy();
    expect(screen.queryByTestId("home-page")).toBeNull();
  });
});
