/**
 * Audit A1.4 — operator-facing diagnostics strip on Discovery empty
 * states.
 *
 * When Discovery returns zero rows, the empty-state surface now renders
 * a compact, muted diagnostics strip showing runtime state, auth mode,
 * inventory source, visible-asset count, and last-observed timestamp.
 * This lets operators see at a glance WHY the grid is empty without
 * opening DevTools.
 */

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveryWorkspace, {
  DiscoveryDiagnosticsStrip,
} from "./DiscoveryWorkspace";

const useDiscoveryWorkspaceMock = vi.fn();
const useAssetDetailMock = vi.fn();
const useAssetAvailabilityMock = vi.fn();
const useLineageMock = vi.fn();
const openAssetRecordSafelyMock = vi.fn();

vi.mock("../hooks/useDiscoveryWorkspace", () => ({
  useDiscoveryWorkspace: (...args) => useDiscoveryWorkspaceMock(...args),
}));

vi.mock("../hooks/useAssetDetail", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isUsableAssetDetail: (detail) => Boolean(detail?.fqn),
    useAssetAvailability: (...args) => useAssetAvailabilityMock(...args),
    useAssetDetail: (...args) => useAssetDetailMock(...args),
  };
});

vi.mock("../hooks/useLineage", () => ({
  useLineage: (...args) => useLineageMock(...args),
}));

vi.mock("../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: (...args) => openAssetRecordSafelyMock(...args),
}));

const fullWorkspaceAccess = {
  mode: "obo-available",
  observedAt: "2026-04-20T00:00:00Z",
  canUseAssetPreview: true,
  canUseLineage: true,
  canUseQueryHistory: true,
  gates: [],
};

function bootstrapPayload() {
  return {
    bootState: "live",
    discovery: {
      assetTypes: ["Table"],
      views: ["All assets"],
      catalogs: ["main"],
      domains: ["Finance"],
      tiers: ["Gold"],
      certifications: ["Certified"],
      sensitivities: ["PII"],
      sortOptions: ["Best match"],
    },
    capabilities: {
      systemInventoryRead: {
        available: true,
        state: "available",
        reason: "",
      },
      tableLineage: {
        available: true,
        state: "available",
        reason: "",
      },
    },
    identity: {
      actorEmail: "skyler@entrada.ai",
      actorRole: "Steward",
      authenticatedUserPresent: true,
      authMode: "obo-available",
      visibilityScope: "actor-scoped",
      source: "forwarded-headers",
    },
    assets: [],
  };
}

function discoveryFilters(overrides = {}) {
  return {
    query: "",
    sortBy: "Best match",
    views: [],
    types: [],
    catalogs: [],
    domains: [],
    tiers: [],
    certifications: [],
    sensitivities: [],
    ...overrides,
  };
}

function emptyDiscoveryMeta(overrides = {}) {
  return {
    state: "available",
    discoveryState: "no_visible_assets",
    discoveryStateReason:
      "Runtime is live but the actor-scoped inventory returned zero visible assets.",
    authMode: "obo-available",
    productMode: "obo-available",
    visibilityScope: "actor-scoped",
    readScope: "actor-scoped",
    source: "unity-catalog-inventory",
    observedAt: "2026-04-20T12:34:56Z",
    visibleAssetCount: 0,
    ...overrides,
  };
}

describe("DiscoveryDiagnosticsStrip (pure)", () => {
  it("renders each audit-requested field with formatted labels", () => {
    const { container } = render(
      <DiscoveryDiagnosticsStrip
        runtimeState="live"
        authMode="obo-available"
        visibilityScope="actor-scoped"
        visibleAssets={42}
        observedAt="2026-04-20T12:34:56Z"
        inventorySource="unity-catalog-inventory"
        discoveryState="no_visible_assets"
      />,
    );

    const strip = container.querySelector(".gh-discovery-diagnostics-strip");
    expect(strip).not.toBeNull();
    expect(screen.getByTestId("gh-discovery-diagnostics-runtime").textContent).toBe("live");
    expect(screen.getByTestId("gh-discovery-diagnostics-auth").textContent).toBe("OBO");
    expect(screen.getByTestId("gh-discovery-diagnostics-source").textContent).toBe(
      "Unity Catalog (actor-scoped)",
    );
    expect(screen.getByTestId("gh-discovery-diagnostics-visible").textContent).toBe("42");
    expect(screen.getByTestId("gh-discovery-diagnostics-observed").textContent).toBe(
      "2026-04-20T12:34:56Z",
    );
    expect(screen.getByTestId("gh-discovery-diagnostics-state").textContent).toBe(
      "no_visible_assets",
    );
  });

  it("formats app-principal auth mode as 'app-principal' and falls back to em dash on missing values", () => {
    render(
      <DiscoveryDiagnosticsStrip
        runtimeState=""
        authMode="app-principal-only"
        visibilityScope=""
        visibleAssets={null}
        observedAt=""
        inventorySource=""
      />,
    );
    expect(screen.getByTestId("gh-discovery-diagnostics-auth").textContent).toBe(
      "app-principal",
    );
    expect(screen.getByTestId("gh-discovery-diagnostics-source").textContent).toBe(
      "Unity Catalog (app-principal)",
    );
    expect(screen.getByTestId("gh-discovery-diagnostics-visible").textContent).toBe("—");
    expect(screen.getByTestId("gh-discovery-diagnostics-observed").textContent).toBe("—");
  });
});

describe("DiscoveryWorkspace — diagnostics strip integration", () => {
  beforeEach(() => {
    useDiscoveryWorkspaceMock.mockReset();
    useAssetDetailMock.mockReset();
    useAssetAvailabilityMock.mockReset();
    useLineageMock.mockReset();
    openAssetRecordSafelyMock.mockReset();

    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: [],
        count: 0,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: null,
        requestKey: "empty-request",
        meta: emptyDiscoveryMeta(),
      },
    });
    useAssetDetailMock.mockReturnValue({ detail: null, loading: false, error: "" });
    useAssetAvailabilityMock.mockReturnValue({});
    useLineageMock.mockReturnValue({
      authoritative: false,
      provisional: false,
      loading: false,
      error: "",
      graph: null,
      payload: null,
    });
    openAssetRecordSafelyMock.mockResolvedValue(true);
  });

  it("renders the diagnostics strip with bootstrap + envelope data on empty Discovery", () => {
    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload()}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={0}
        initialQuery=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="test-empty"
        runtimeFeatureFlags={[
          { key: "table_lineage_surface", enabled: true, state: "available" },
        ]}
        sharedVisibleAssetSet={new Set()}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    // Diagnostics strip renders alongside the empty-state card.
    const strip = screen.getByTestId("gh-discovery-diagnostics-strip");
    expect(strip).not.toBeNull();

    // Each audit-required field is present with bootstrap/envelope data.
    expect(within(strip).getByTestId("gh-discovery-diagnostics-runtime").textContent).toBe(
      "live",
    );
    expect(within(strip).getByTestId("gh-discovery-diagnostics-auth").textContent).toBe(
      "OBO",
    );
    expect(within(strip).getByTestId("gh-discovery-diagnostics-source").textContent).toBe(
      "Unity Catalog (actor-scoped)",
    );
    expect(within(strip).getByTestId("gh-discovery-diagnostics-visible").textContent).toBe(
      "0",
    );
    expect(within(strip).getByTestId("gh-discovery-diagnostics-observed").textContent).toBe(
      "2026-04-20T12:34:56Z",
    );
    expect(within(strip).getByTestId("gh-discovery-diagnostics-state").textContent).toBe(
      "no_visible_assets",
    );

    // Empty-state card still renders — the strip is additive, not a replacement.
    // Text depends on whether we're in inventory-empty vs filter-empty mode.
    const emptyHeading =
      screen.queryByText("No visible assets are being returned.") ||
      screen.queryByText("No assets match the current scope.");
    expect(emptyHeading).not.toBeNull();
  });

  it("does not render the diagnostics strip when Discovery has results", () => {
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: [
          {
            fqn: "main.sales.orders",
            name: "orders",
            description: "Orders fact table",
            coverageScore: 88,
            openRequests: 0,
            owners: [],
            columns: [],
            relatedAssets: [],
            governanceStatus: "Operational",
            domain: "Finance",
            tier: "Gold",
            certification: "Certified",
            sensitivity: "PII",
          },
        ],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: null,
        requestKey: "populated-request",
        meta: { ...emptyDiscoveryMeta(), discoveryState: "live", visibleAssetCount: 1 },
      },
    });
    useAssetDetailMock.mockReturnValue({
      detail: { fqn: "main.sales.orders", name: "orders", columns: [] },
      loading: false,
      error: "",
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload()}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={1}
        initialQuery=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="test-populated"
        runtimeFeatureFlags={[
          { key: "table_lineage_surface", enabled: true, state: "available" },
        ]}
        sharedVisibleAssetSet={new Set(["main.sales.orders"])}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    expect(screen.queryByTestId("gh-discovery-diagnostics-strip")).toBeNull();
  });
});
