import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveryWorkspace from "../DiscoveryWorkspace";

const useDiscoveryWorkspaceMock = vi.fn();
const useAssetDetailMock = vi.fn();
const useAssetAvailabilityMock = vi.fn();
const useLineageMock = vi.fn();
const openAssetRecordSafelyMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  fetchAtlasAiRecommendations: vi.fn(),
  createGovernanceRequest: vi.fn(),
}));

vi.mock("../../hooks/useDiscoveryWorkspace", () => ({
  useDiscoveryWorkspace: (...args) => useDiscoveryWorkspaceMock(...args),
}));

vi.mock("../../hooks/useAssetDetail", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isUsableAssetDetail: (detail) => Boolean(detail?.fqn),
    useAssetAvailability: (...args) => useAssetAvailabilityMock(...args),
    useAssetDetail: (...args) => useAssetDetailMock(...args),
  };
});

vi.mock("../../hooks/useLineage", () => ({
  prefetchLineage: vi.fn(() => Promise.resolve(null)),
  useLineage: (...args) => useLineageMock(...args),
}));

vi.mock("../../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: (...args) => openAssetRecordSafelyMock(...args),
}));

vi.mock("../../lib/api", () => ({
  fetchAtlasAiRecommendations: (...args) => apiMocks.fetchAtlasAiRecommendations(...args),
  createGovernanceRequest: (...args) => apiMocks.createGovernanceRequest(...args),
}));

const asset = {
  fqn: "main.sales.orders",
  name: "orders",
  description: "Orders fact table",
  coverageScore: 88,
  openRequests: 2,
  owners: [],
  columns: [],
  relatedAssets: [],
  governanceStatus: "Operational",
  domain: "Finance",
  tier: "Gold",
  certification: "",
  sensitivity: "",
  updatedAt: "",
};

const fullWorkspaceAccess = {
  mode: "obo-available",
  observedAt: "2026-04-16T00:00:00Z",
  canUseAssetPreview: true,
  canUseLineage: true,
  canUseQueryHistory: true,
  gates: [],
};

function bootstrapPayload({ assets = [asset], role = "" } = {}) {
  return {
    bootState: "live",
    shell: role ? { role } : {},
    discovery: {
      assetTypes: ["Table"],
      views: ["All assets"],
      catalogs: ["main"],
      domains: ["Finance"],
      tiers: ["Gold"],
      certifications: ["Certified"],
      sensitivities: ["PII"],
      sortOptions: ["Best match", "Coverage score"],
    },
    capabilities: {
      systemInventoryRead: { available: true, state: "available", reason: "" },
      tableLineage: { available: true, state: "available", reason: "" },
    },
    assets,
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
    businessCriticalities: [],
    cdeOnly: false,
    ...overrides,
  };
}

const setFilters = vi.fn();

function mockResults({ assets = [asset], facets = {}, filters = discoveryFilters() } = {}) {
  useDiscoveryWorkspaceMock.mockReturnValue({
    filters,
    setFilters,
    results: {
      authoritative: true,
      assets,
      count: assets.length,
      settled: true,
      loading: false,
      error: "",
      facets,
      queryState: null,
      requestKey: "gaps-request",
      resolvedQuery: "",
    },
  });
}

function defaultProps(overrides = {}) {
  return {
    bootstrap: bootstrapPayload(),
    effectiveBootMessage: "",
    effectiveBootState: "live",
    effectiveVisibleCount: 1,
    initialQuery: "",
    onLiveCatalogStateChange: () => {},
    onNavigationStateChange: () => {},
    onOpenAsset: () => {},
    onOpenGovernance: () => {},
    onOpenLineage: () => {},
    onRouteQueryChange: () => {},
    onSurfaceReady: () => {},
    querySeedFresh: false,
    querySeedKey: "gaps-test",
    runtimeFeatureFlags: [
      { key: "table_lineage_surface", enabled: true, state: "available" },
    ],
    sharedVisibleAssetSet: new Set([asset.fqn]),
    workspaceAccess: fullWorkspaceAccess,
    ...overrides,
  };
}

describe("DiscoveryWorkspace gap fixes", () => {
  beforeEach(() => {
    useDiscoveryWorkspaceMock.mockReset();
    useAssetDetailMock.mockReset();
    useAssetAvailabilityMock.mockReset();
    useLineageMock.mockReset();
    openAssetRecordSafelyMock.mockReset();
    setFilters.mockReset();
    apiMocks.fetchAtlasAiRecommendations.mockReset();
    apiMocks.fetchAtlasAiRecommendations.mockResolvedValue({ recommendations: [] });
    apiMocks.createGovernanceRequest.mockReset();
    apiMocks.createGovernanceRequest.mockResolvedValue({ ok: true, requestId: "REQ-NEW-1" });
    window.sessionStorage.clear();
    window.localStorage.clear();

    mockResults();
    useAssetDetailMock.mockReturnValue({ detail: asset, loading: false, error: "" });
    useAssetAvailabilityMock.mockReturnValue({ [asset.fqn]: true });
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

  it("suppresses the usage strip when the payload carries no usage fields (absence is not zero)", () => {
    render(<DiscoveryWorkspace {...defaultProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.queryByText("No recent usage")).toBeNull();
  });

  it("shows the zero-usage line only when a real usage number of 0 was reported", () => {
    mockResults({ assets: [{ ...asset, queryCount: 0 }] });
    render(<DiscoveryWorkspace {...defaultProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.getByText("No recent usage")).not.toBeNull();
  });

  it("labels the coverage column and sort option as Coverage, never Trust", () => {
    render(<DiscoveryWorkspace {...defaultProps()} />);
    expect(screen.getByRole("columnheader", { name: "Coverage" })).not.toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Trust Signal" })).toBeNull();
    const sortOptions = Array.from(document.querySelectorAll(".gh-discovery-sort-option"));
    expect(sortOptions.some((el) => /Trust score/i.test(el.textContent || ""))).toBe(false);
  });

  it("renders labeled fallbacks instead of em-dashes in list cells", () => {
    render(<DiscoveryWorkspace {...defaultProps()} />);
    expect(screen.getByText("Not certified")).not.toBeNull();
    expect(screen.getByText("Unclassified")).not.toBeNull();
  });

  it("explains the disabled Quality filter with actionable copy", () => {
    render(<DiscoveryWorkspace {...defaultProps()} />);
    const qualitySelect = screen.getByLabelText("Quality");
    expect(qualitySelect.disabled).toBe(true);
    expect(qualitySelect.title).toMatch(/No quality checks have run yet/);
    expect(within(qualitySelect).getByText("No checks yet")).not.toBeNull();
  });

  it("replaces the deleted/inaccessible dead buttons with explanatory copy", () => {
    render(<DiscoveryWorkspace {...defaultProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));
    expect(screen.queryByRole("button", { name: "Deleted assets unavailable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Inaccessible hidden" })).toBeNull();
    expect(
      screen.getByText(/Deleted-asset search stays off because no authoritative deletion-state source/),
    ).not.toBeNull();
    expect(
      screen.getByText(/Inaccessible assets stay hidden until Databricks returns actor-visible metadata/),
    ).not.toBeNull();
  });

  it("supports saving, applying, and deleting local saved searches", async () => {
    mockResults({ filters: discoveryFilters({ query: "revenue", domains: ["Finance"] }) });
    render(<DiscoveryWorkspace {...defaultProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /Saved searches/i }));
    const dialog = screen.getByRole("dialog", { name: "Saved searches" });
    fireEvent.change(within(dialog).getByLabelText("Saved search name"), {
      target: { value: "Finance revenue" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save current search/i }));

    expect(within(dialog).getByText("Finance revenue")).not.toBeNull();
    const stored = JSON.parse(window.localStorage.getItem("gh-saved-searches") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Finance revenue");
    expect(stored[0].query).toBe("revenue");
    expect(stored[0].domains).toEqual(["Finance"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply saved search Finance revenue" }));
    expect(setFilters).toHaveBeenCalled();
    const updater = setFilters.mock.calls.at(-1)[0];
    const applied = typeof updater === "function" ? updater(discoveryFilters()) : updater;
    expect(applied.query).toBe("revenue");
    expect(applied.domains).toEqual(["Finance"]);

    // Reopen (Apply closed the popover) and delete.
    fireEvent.click(screen.getByRole("button", { name: /Saved searches/i }));
    const reopened = screen.getByRole("dialog", { name: "Saved searches" });
    fireEvent.click(within(reopened).getByRole("button", { name: "Delete saved search Finance revenue" }));
    expect(JSON.parse(window.localStorage.getItem("gh-saved-searches") || "[]")).toHaveLength(0);
  });

  it("keeps preview write actions disabled for readers with the honest copy", () => {
    render(
      <DiscoveryWorkspace
        {...defaultProps({
          initialSelectedAssetFqn: asset.fqn,
          onRoutePreviewChange: () => {},
        })}
      />,
    );
    const preview = document.querySelector(`aside[data-asset-fqn="${asset.fqn}"]`);
    expect(preview).not.toBeNull();
    expect(
      within(preview).getByRole("button", {
        name: "Comment unavailable: comment threads require a backed workflow before they can be created from Discover.",
      }).disabled,
    ).toBe(true);
  });

  it("enables preview Comment and Request access for steward actors and files real requests", async () => {
    render(
      <DiscoveryWorkspace
        {...defaultProps({
          bootstrap: bootstrapPayload({ role: "Steward" }),
          initialSelectedAssetFqn: asset.fqn,
          onRoutePreviewChange: () => {},
        })}
      />,
    );
    const preview = document.querySelector(`aside[data-asset-fqn="${asset.fqn}"]`);
    expect(preview).not.toBeNull();

    const commentButton = within(preview).getByRole("button", { name: `Comment on ${asset.name}` });
    expect(commentButton.disabled).toBe(false);
    fireEvent.click(commentButton);
    fireEvent.change(within(preview).getByLabelText("Comment for governance stewards"), {
      target: { value: "Please certify this table." },
    });
    fireEvent.click(within(preview).getByRole("button", { name: "File comment" }));
    await waitFor(() => {
      expect(apiMocks.createGovernanceRequest).toHaveBeenCalledWith(
        {
          assetFqn: asset.fqn,
          title: `Comment: ${asset.name}`,
          note: "Please certify this table.",
        },
        { fast: true },
      );
    });
    expect(await within(preview).findByText(/Comment filed as governance request REQ-NEW-1/)).not.toBeNull();

    fireEvent.click(within(preview).getByRole("button", { name: `Request access to ${asset.name}` }));
    await waitFor(() => {
      expect(apiMocks.createGovernanceRequest).toHaveBeenLastCalledWith(
        {
          assetFqn: asset.fqn,
          title: `Access request: ${asset.name}`,
          note: "Access requested from the Discover preview.",
        },
        { fast: true },
      );
    });
  });

  it("drops the Steward team preview row when no steward-role owner exists", () => {
    render(
      <DiscoveryWorkspace
        {...defaultProps({
          initialSelectedAssetFqn: asset.fqn,
          onRoutePreviewChange: () => {},
        })}
      />,
    );
    const preview = document.querySelector(`aside[data-asset-fqn="${asset.fqn}"]`);
    expect(preview).not.toBeNull();
    expect(within(preview).queryByText("Steward team")).toBeNull();
    // A steward-role owner brings the row back.
    useAssetDetailMock.mockReturnValue({
      detail: {
        ...asset,
        owners: [{ email: "stew@entrada.ai", name: "Stew Ward", ownerType: "steward" }],
      },
      loading: false,
      error: "",
    });
  });

  it("hides zero-count certification options in the prototype filter rail", () => {
    mockResults({
      facets: {
        certifications: [
          { value: "Certified", count: 3 },
          { value: "In Review", count: 0 },
        ],
      },
    });
    render(<DiscoveryWorkspace {...defaultProps()} />);
    const rail = document.querySelector(".gh-discovery-prototype-filter-rail");
    expect(rail).not.toBeNull();
    expect(within(rail).getByText("Certified")).not.toBeNull();
    expect(within(rail).queryByText("In Review")).toBeNull();
    expect(within(rail).queryByText("Uncertified")).toBeNull();
    // Header count reflects the shown options' facet counts, not the
    // unrelated total result count.
    expect(within(rail).getByText("3 results")).not.toBeNull();
  });
});
