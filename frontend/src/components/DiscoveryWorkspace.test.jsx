import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveryWorkspace from "./DiscoveryWorkspace";

const useDiscoveryWorkspaceMock = vi.fn();
const useAssetDetailMock = vi.fn();
const useAssetAvailabilityMock = vi.fn();
const useLineageMock = vi.fn();

vi.mock("../hooks/useDiscoveryWorkspace", () => ({
  useDiscoveryWorkspace: (...args) => useDiscoveryWorkspaceMock(...args),
}));

vi.mock("../hooks/useAssetDetail", () => ({
  isUsableAssetDetail: (detail) => Boolean(detail?.fqn),
  useAssetAvailability: (...args) => useAssetAvailabilityMock(...args),
  useAssetDetail: (...args) => useAssetDetailMock(...args),
}));

vi.mock("../hooks/useLineage", () => ({
  useLineage: (...args) => useLineageMock(...args),
}));

vi.mock("../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: vi.fn(),
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
  certification: "Certified",
  sensitivity: "PII",
};

const lineageUnavailableReason = "Lineage is disabled in this workspace.";
const lineageRolloutUnavailableReason = "Table lineage rollout is disabled in this workspace.";

function bootstrapPayload({
  capabilityAvailable = false,
  capabilityReason = lineageUnavailableReason,
} = {}) {
  return {
    bootState: "live",
    discovery: {
      summary: {
        visibleAssets: 1,
      },
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
      tableLineage: {
        available: capabilityAvailable,
        state: capabilityAvailable ? "available" : "unavailable",
        reason: capabilityReason,
      },
    },
    assets: [asset],
  };
}

describe("DiscoveryWorkspace", () => {
  beforeEach(() => {
    useDiscoveryWorkspaceMock.mockReset();
    useAssetDetailMock.mockReset();
    useAssetAvailabilityMock.mockReset();
    useLineageMock.mockReset();

    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: {
        query: "",
        sortBy: "Best match",
        views: [],
        types: [],
        catalogs: [],
        domains: [],
        tiers: [],
        certifications: [],
        sensitivities: [],
      },
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockReturnValue({
      detail: asset,
      loading: false,
      error: "",
    });
    useAssetAvailabilityMock.mockReturnValue({});
    useLineageMock.mockReturnValue({
      authoritative: false,
      provisional: false,
      loading: false,
      error: "",
      graph: null,
      payload: null,
    });
  });

  it("disables lineage affordances when the lineage rollout is disabled", () => {
    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          capabilityAvailable: true,
          capabilityReason: "",
        })}
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
        querySeedKey="test"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: false,
            state: "unavailable",
            unavailableReason: lineageRolloutUnavailableReason,
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const unavailableButtons = screen.getAllByRole("button", {
      name: "Lineage unavailable",
    });
    expect(unavailableButtons).toHaveLength(2);
    unavailableButtons.forEach((button) => expect(button.disabled).toBe(true));
    expect(screen.getByText(lineageRolloutUnavailableReason)).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });

  it("fails closed when the lineage rollout flag is missing", () => {
    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          capabilityAvailable: true,
          capabilityReason: "",
        })}
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
        querySeedKey="test"
        runtimeFeatureFlags={[]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const unavailableButtons = screen.getAllByRole("button", {
      name: "Lineage unavailable",
    });
    expect(unavailableButtons).toHaveLength(2);
    unavailableButtons.forEach((button) => expect(button.disabled).toBe(true));
    expect(
      screen.getByText("Table lineage rollout is not available in this workspace right now."),
    ).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });

  it("fails closed when workspace access blocks lineage despite available capability and rollout", () => {
    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          capabilityAvailable: true,
          capabilityReason: "",
        })}
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
        querySeedKey="test"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        workspaceAccess={{
          canUseLineage: false,
          gates: [
            {
              key: "lineage_access",
              reason: "Lineage is blocked by workspace access.",
            },
          ],
        }}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const unavailableButtons = screen.getAllByRole("button", {
      name: "Lineage unavailable",
    });
    expect(unavailableButtons).toHaveLength(2);
    unavailableButtons.forEach((button) => expect(button.disabled).toBe(true));
    expect(screen.getByText("Lineage is blocked by workspace access.")).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, null, false);
  });
});
