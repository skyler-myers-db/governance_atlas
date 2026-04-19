import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveryWorkspace from "./DiscoveryWorkspace";

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

const secondAsset = {
  ...asset,
  fqn: "main.sales.returns",
  name: "returns",
  description: "Returns fact table",
};
const openableLinkedAssetFqn = "main.sales.customers";
const pendingLinkedAssetFqn = "main.sales.inventory";
const unavailableLinkedAssetFqn = "main.sales.ledger";

function makeAssets(count) {
  return Array.from({ length: count }, (_, index) => ({
    ...asset,
    fqn: `main.sales.asset_${index + 1}`,
    name: `asset-${index + 1}`,
    description: `Asset ${index + 1}`,
  }));
}

const lineageUnavailableReason = "Lineage is disabled in this workspace.";
const lineageRolloutUnavailableReason = "Table lineage rollout is disabled in this workspace.";
const fullWorkspaceAccess = {
  mode: "obo-available",
  observedAt: "2026-04-16T00:00:00Z",
  canUseAssetPreview: true,
  canUseLineage: true,
  canUseQueryHistory: true,
  gates: [],
};

function bootstrapPayload({
  capabilityAvailable = false,
  capabilityReason = lineageUnavailableReason,
  previewAvailable = true,
  previewReason = "",
  assets = [asset],
} = {}) {
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
        available: previewAvailable,
        state: previewAvailable ? "available" : "unavailable",
        reason: previewReason,
      },
      tableLineage: {
        available: capabilityAvailable,
        state: capabilityAvailable ? "available" : "unavailable",
        reason: capabilityReason,
      },
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
    ...overrides,
  };
}

describe("DiscoveryWorkspace", () => {
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
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: null,
        requestKey: "default-request",
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
    openAssetRecordSafelyMock.mockResolvedValue(true);
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
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    const unavailableButtons = screen.getAllByRole("button", {
      name: "Lineage unavailable",
    });
    expect(unavailableButtons).toHaveLength(2);
    unavailableButtons.forEach((button) => expect(button.disabled).toBe(true));
    expect(screen.getByText(lineageRolloutUnavailableReason)).not.toBeNull();
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
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
        workspaceAccess={fullWorkspaceAccess}
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
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
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
          ...fullWorkspaceAccess,
          canUseLineage: false,
          gates: [
            {
              key: "table_lineage",
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
    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("fails closed when preview capability is unavailable", () => {
    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          capabilityAvailable: true,
          capabilityReason: "",
          previewAvailable: false,
          previewReason: "Live preview rows are disabled in this workspace.",
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
        querySeedKey="test-preview-gated"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    expect(
      screen.getByText("Live preview rows and schema are unavailable for this workspace."),
    ).not.toBeNull();
    expect(screen.getByText("Live preview rows are disabled in this workspace.")).not.toBeNull();
    expect(useAssetDetailMock.mock.calls[0]?.[1]?.enabled).toBe(false);
    expect(useAssetDetailMock.mock.calls[1]?.[1]?.enabled).toBe(false);
  });

  it("keeps the selected-asset rail visible when live preview refresh is degraded", () => {
    useAssetDetailMock
      .mockReturnValueOnce({
        detail: asset,
        loading: false,
        error: "Live preview refresh stalled.",
      })
      .mockReturnValueOnce({
        detail: asset,
        loading: false,
        error: "",
      });

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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "orders" })).not.toBeNull();
    expect(within(preview).getByRole("button", { name: "Open Record" })).not.toBeNull();
  });

  it("disables discovery record actions when a rendered asset record is not openable", () => {
    vi.useFakeTimers();
    const assets = [asset, secondAsset];
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets,
        count: assets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: null,
        requestKey: "availability-request",
        resolvedQuery: "",
      },
    });
    useAssetAvailabilityMock.mockImplementation((assetFqns = []) =>
      Object.fromEntries(assetFqns.map((assetFqn) => [assetFqn, assetFqn === asset.fqn ? false : true])),
    );

    try {
      const { container } = render(
        <DiscoveryWorkspace
          bootstrap={bootstrapPayload({
            assets,
            capabilityAvailable: true,
            capabilityReason: "",
          })}
          effectiveBootMessage=""
          effectiveBootState="live"
          effectiveVisibleCount={assets.length}
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
          sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
        />,
      );

      act(() => {
        vi.runAllTimers();
      });

      const unavailableCard = container.querySelector(`[data-asset-fqn="${asset.fqn}"]`);
      if (!unavailableCard) throw new Error("Expected unavailable discovery card");
      expect(
        within(unavailableCard).getByRole("button", { name: "Metadata record unavailable" }).disabled,
      ).toBe(true);
      expect(
        within(unavailableCard).getByText(
          "Visible in discovery, but the record cannot be opened with current permissions.",
        ),
      ).not.toBeNull();
      expect(within(unavailableCard).getByRole("button", { name: "Open Governance" }).disabled).toBe(true);
      const preview = document.querySelector(".gh-selection-preview");
      if (!preview) throw new Error("Expected selected-asset preview rail");
      expect(
        within(preview).getByRole("button", { name: "Metadata record unavailable" }).disabled,
      ).toBe(true);
      expect(within(preview).getByRole("button", { name: "Open Governance" }).disabled).toBe(true);

      const availableCard = container.querySelector(`[data-asset-fqn="${secondAsset.fqn}"]`);
      if (!availableCard) throw new Error("Expected available discovery card");
      expect(within(availableCard).getByRole("button", { name: "Open Record" }).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables the selected preview open-record action when live detail is not renderable", () => {
    const unrenderableDetail = {
      fqn: asset.fqn,
      name: asset.name,
      description: "",
      objectType: "Unknown object",
      managementType: "—",
      format: "—",
      storageFormat: "—",
      rows: "—",
      size: "—",
      files: "—",
      columns: [],
      relatedAssets: [],
    };
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assetFqn ? unrenderableDetail : asset,
      loading: false,
      error: "",
    }));

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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(
      within(preview).getByRole("button", { name: "Metadata record unavailable" }).disabled,
    ).toBe(true);
    expect(
      within(preview).getByText(
        "Visible in discovery, but the record cannot be opened with current permissions.",
      ),
    ).not.toBeNull();
    expect(within(preview).getByRole("button", { name: "Open Governance" }).disabled).toBe(true);
  });

  it("demotes discovery record actions after a confirmed open failure", async () => {
    useAssetAvailabilityMock.mockReturnValue({
      [asset.fqn]: null,
    });
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === asset.fqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: {
          fqn: assetFqn,
        },
      });
      return Promise.resolve(true);
    });

    const { container } = render(
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
        querySeedKey="record-failure-a"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    fireEvent.click(within(preview).getByRole("button", { name: "Open Record" }));

    await waitFor(() => {
      expect(
        within(preview).getByRole("button", { name: "Metadata record unavailable" }).disabled,
      ).toBe(true);
    });
    expect(
      screen.getByText(
        "That asset is visible in discovery, but its metadata record is not openable with the current permissions.",
      ),
    ).not.toBeNull();

    const card = container.querySelector(`[data-asset-fqn="${asset.fqn}"]`);
    if (!card) throw new Error("Expected discovery result card");
    expect(within(card).getByRole("button", { name: "Metadata record unavailable" }).disabled).toBe(true);
    expect(within(card).getByRole("button", { name: "Open Governance" }).disabled).toBe(true);
  });

  it("clears discovery record-open failure overrides when the request scope changes", async () => {
    let workspaceState = {
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: null,
        requestKey: "record-failure-a",
        resolvedQuery: "",
      },
    };
    useDiscoveryWorkspaceMock.mockImplementation(() => workspaceState);
    useAssetAvailabilityMock.mockReturnValue({
      [asset.fqn]: null,
    });
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === asset.fqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: {
          fqn: assetFqn,
        },
      });
      return Promise.resolve(true);
    });

    const { rerender } = render(
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
        querySeedKey="record-failure-a"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const firstPreview = document.querySelector(".gh-selection-preview");
    if (!firstPreview) throw new Error("Expected first selected-asset preview rail");
    fireEvent.click(within(firstPreview).getByRole("button", { name: "Open Record" }));

    await waitFor(() => {
      expect(
        within(firstPreview).getByRole("button", { name: "Metadata record unavailable" }).disabled,
      ).toBe(true);
    });

    workspaceState = {
      ...workspaceState,
      results: {
        ...workspaceState.results,
        requestKey: "record-failure-b",
      },
    };

    rerender(
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
        querySeedKey="record-failure-b"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const refreshedPreview = document.querySelector(".gh-selection-preview");
    if (!refreshedPreview) throw new Error("Expected refreshed selected-asset preview rail");
    await waitFor(() => {
      expect(within(refreshedPreview).getByRole("button", { name: "Open Record" }).disabled).toBe(false);
    });
    expect(
      screen.queryByText(
        "That asset is visible in discovery, but its metadata record is not openable with the current permissions.",
      ),
    ).toBeNull();
  });

  it("truths connected linked-asset rows as openable, checking, or unavailable", () => {
    const previewAssetWithRelated = {
      ...asset,
      relatedAssets: [
        openableLinkedAssetFqn,
        pendingLinkedAssetFqn,
        unavailableLinkedAssetFqn,
      ],
    };
    useAssetDetailMock.mockImplementation(() => ({
      detail: previewAssetWithRelated,
      loading: false,
      error: "",
    }));
    useAssetAvailabilityMock.mockImplementation((assetFqns = []) =>
      Object.fromEntries(
        assetFqns.map((assetFqn) => [
          assetFqn,
          assetFqn === openableLinkedAssetFqn
            ? true
            : assetFqn === unavailableLinkedAssetFqn
              ? false
              : null,
        ]),
      ),
    );

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: [previewAssetWithRelated],
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
        sharedVisibleAssetSet={new Set([previewAssetWithRelated.fqn])}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");

    const openableRow = within(preview).getByText(openableLinkedAssetFqn).closest(".gh-lineage-linked-row");
    if (!openableRow) throw new Error("Expected openable linked-asset row");
    expect(openableRow.tagName).toBe("BUTTON");
    expect(within(openableRow).getByText("Open Record")).not.toBeNull();

    const pendingRow = within(preview).getByText(pendingLinkedAssetFqn).closest(".gh-lineage-linked-row");
    if (!pendingRow) throw new Error("Expected pending linked-asset row");
    expect(pendingRow.tagName).toBe("BUTTON");
    expect(within(pendingRow).getByText("Checking access...")).not.toBeNull();

    const unavailableRow = within(preview).getByText(unavailableLinkedAssetFqn).closest(".gh-lineage-linked-row");
    if (!unavailableRow) throw new Error("Expected unavailable linked-asset row");
    expect(unavailableRow.tagName).toBe("DIV");
    expect(within(unavailableRow).getByText("Metadata record unavailable")).not.toBeNull();
    expect(within(unavailableRow).queryByRole("button")).toBeNull();
  });

  it("demotes a pending linked-asset row after a confirmed open failure", () => {
    const previewAssetWithRelated = {
      ...asset,
      relatedAssets: [
        openableLinkedAssetFqn,
        pendingLinkedAssetFqn,
      ],
    };
    useAssetDetailMock.mockImplementation(() => ({
      detail: previewAssetWithRelated,
      loading: false,
      error: "",
    }));
    useAssetAvailabilityMock.mockImplementation((assetFqns = []) =>
      Object.fromEntries(
        assetFqns.map((assetFqn) => [
          assetFqn,
          assetFqn === openableLinkedAssetFqn ? true : null,
        ]),
      ),
    );
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === pendingLinkedAssetFqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: {
          fqn: assetFqn,
        },
      });
      return Promise.resolve(true);
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: [previewAssetWithRelated],
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
        sharedVisibleAssetSet={new Set([previewAssetWithRelated.fqn])}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");

    const pendingButton = within(preview).getByRole("button", {
      name: new RegExp(`^${pendingLinkedAssetFqn} `),
    });
    fireEvent.click(pendingButton);

    const unavailableRow = within(preview).getByText(pendingLinkedAssetFqn).closest(".gh-lineage-linked-row");
    if (!unavailableRow) throw new Error("Expected demoted linked-asset row");
    expect(unavailableRow.tagName).toBe("DIV");
    expect(within(unavailableRow).getByText("Metadata record unavailable")).not.toBeNull();
    expect(
      screen.getByText(
        "That linked asset is surfaced by live lineage, but its metadata record is not openable with the current permissions.",
      ),
    ).not.toBeNull();

    const stillOpenableRow = within(preview).getByText(openableLinkedAssetFqn).closest(".gh-lineage-linked-row");
    if (!stillOpenableRow) throw new Error("Expected openable linked-asset row");
    expect(stillOpenableRow.tagName).toBe("BUTTON");
    expect(within(stillOpenableRow).getByText("Open Record")).not.toBeNull();
  });

  it("clears linked-open failure overrides when the selected preview asset changes", () => {
    const firstPreviewAsset = {
      ...asset,
      relatedAssets: [pendingLinkedAssetFqn],
    };
    const secondPreviewAsset = {
      ...secondAsset,
      relatedAssets: [pendingLinkedAssetFqn],
    };
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: [firstPreviewAsset, secondPreviewAsset],
        count: 2,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: null,
        requestKey: "linked-open-reset",
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail:
        [firstPreviewAsset, secondPreviewAsset].find((candidate) => candidate.fqn === assetFqn) ||
        firstPreviewAsset,
      loading: false,
      error: "",
    }));
    useAssetAvailabilityMock.mockImplementation((assetFqns = []) =>
      Object.fromEntries(assetFqns.map((assetFqn) => [assetFqn, null])),
    );
    openAssetRecordSafelyMock.mockImplementation((assetFqn, options = {}) => {
      if (assetFqn === pendingLinkedAssetFqn) {
        options.onUnavailable?.({
          assetFqn,
          availability: {
            visible: false,
            exists: false,
            openable: false,
          },
          detail: null,
        });
        return Promise.resolve(false);
      }
      options.onOpen?.(assetFqn, {
        availability: {
          visible: true,
          exists: true,
          openable: true,
        },
        detail: {
          fqn: assetFqn,
        },
      });
      return Promise.resolve(true);
    });

    const { rerender } = render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: [firstPreviewAsset, secondPreviewAsset],
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={2}
        initialQuery=""
        initialSelectedAssetFqn={firstPreviewAsset.fqn}
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="linked-preview-a"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([firstPreviewAsset.fqn, secondPreviewAsset.fqn])}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    const firstPreview = document.querySelector(".gh-selection-preview");
    if (!firstPreview) throw new Error("Expected first selected-asset preview rail");
    fireEvent.click(within(firstPreview).getByRole("button", {
      name: new RegExp(`^${pendingLinkedAssetFqn} `),
    }));
    expect(within(firstPreview).getByText("Metadata record unavailable")).not.toBeNull();

    rerender(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: [firstPreviewAsset, secondPreviewAsset],
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={2}
        initialQuery=""
        initialSelectedAssetFqn={secondPreviewAsset.fqn}
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="linked-preview-b"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([firstPreviewAsset.fqn, secondPreviewAsset.fqn])}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    const secondPreview = document.querySelector(
      `aside[data-asset-fqn="${secondPreviewAsset.fqn}"]`,
    );
    if (!secondPreview) throw new Error("Expected second selected-asset preview rail");
    const resetRow = within(secondPreview).getByText(pendingLinkedAssetFqn).closest(".gh-lineage-linked-row");
    if (!resetRow) throw new Error("Expected reset linked-asset row");
    expect(resetRow.tagName).toBe("BUTTON");
    expect(within(resetRow).getByText("Checking access...")).not.toBeNull();
  });

  it("keeps already-resolved record-unavailable cards disabled while warming a larger result window", () => {
    vi.useFakeTimers();
    const assets = makeAssets(80);
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets,
        count: assets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: null,
        requestKey: "availability-load-more-request",
        resolvedQuery: "",
      },
    });
    useAssetAvailabilityMock.mockImplementation((assetFqns = []) =>
      Object.fromEntries(assetFqns.map((assetFqn) => [assetFqn, assetFqn === assets[0].fqn ? false : true])),
    );

    try {
      const { container } = render(
        <DiscoveryWorkspace
          bootstrap={bootstrapPayload({
            assets,
            capabilityAvailable: true,
            capabilityReason: "",
          })}
          effectiveBootMessage=""
          effectiveBootState="live"
          effectiveVisibleCount={assets.length}
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
          sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
        />,
      );

      act(() => {
        vi.runAllTimers();
      });

      const firstCard = container.querySelector(`[data-asset-fqn="${assets[0].fqn}"]`);
      if (!firstCard) throw new Error("Expected first discovery card");
      expect(
        within(firstCard).getByRole("button", { name: "Metadata record unavailable" }).disabled,
      ).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Load more results" }));

      expect(
        within(firstCard).getByRole("button", { name: "Metadata record unavailable" }).disabled,
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps discovery visible totals provisional until live counts resolve", () => {
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: false,
        assets: [asset],
        count: 0,
        settled: false,
        loading: true,
        error: "",
        facets: {},
        resolvedQuery: "",
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={{
          ...bootstrapPayload({
            capabilityAvailable: true,
            capabilityReason: "",
          }),
          discovery: {
            ...bootstrapPayload().discovery,
            summary: {
              visibleAssets: 17,
            },
          },
        }}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={null}
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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    // The sidebar no longer shows a "{N} visible" caption next to the title
    // (removed to match the target mockup's plain "Filters" header). The
    // asset count is still surfaced in the result heading. Verify neither
    // location claims a fake "17 visible" stub.
    expect(screen.queryByText(/17 visible/i)).toBeNull();
    expect(screen.queryByText(/of 17 assets/i)).toBeNull();
  });

  it("uses live discovery result counts when no explicit visible-count prop is passed", () => {
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: [asset, secondAsset],
        count: 2,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: [asset, secondAsset].find((candidate) => candidate.fqn === assetFqn) || asset,
      loading: false,
      error: "",
    }));

    render(
      <DiscoveryWorkspace
        bootstrap={{
          ...bootstrapPayload({
            assets: [asset, secondAsset],
            capabilityAvailable: true,
            capabilityReason: "",
          }),
          discovery: {
            ...bootstrapPayload({ assets: [asset, secondAsset] }).discovery,
            summary: {
              visibleAssets: 17,
            },
          },
        }}
        effectiveBootMessage=""
        effectiveBootState="live"
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
        sharedVisibleAssetSet={new Set([asset.fqn, secondAsset.fqn])}
      />,
    );

    // The "{N} visible" sidebar caption was dropped (target parity); what
    // matters for this test is that we report the live count (2) — surfaced
    // in the "Showing N of M assets" heading — rather than the stale
    // bootstrap summary (17).
    expect(screen.getByText(/Showing/)).not.toBeNull();
    expect(screen.queryByText(/17 visible/i)).toBeNull();
  });

  it("keeps load-more result depth local until the discovery scope changes", () => {
    const manyAssets = makeAssets(65);
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: manyAssets,
        count: manyAssets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        requestKey: "many-assets-scope",
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: manyAssets.find((candidate) => candidate.fqn === assetFqn) || manyAssets[0],
      loading: false,
      error: "",
    }));

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: manyAssets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={manyAssets.length}
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
        sharedVisibleAssetSet={new Set(manyAssets.map((candidate) => candidate.fqn))}
      />,
    );

    expect(screen.queryByText("asset-61")).toBeNull();
    expect(
      screen.getByText("Showing 60 of 65 results to keep the catalog responsive."),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more results" }));

    expect(screen.getByText("asset-61")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Load more results" })).toBeNull();
  }, 15000);

  it("resets an expanded result window when a fresh discovery seed or request scope change lands", () => {
    const manyAssets = makeAssets(65);
    let workspaceState = {
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: manyAssets,
        count: manyAssets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        requestKey: "scope-a",
        resolvedQuery: "",
      },
    };
    useDiscoveryWorkspaceMock.mockImplementation(() => workspaceState);
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: manyAssets.find((candidate) => candidate.fqn === assetFqn) || manyAssets[0],
      loading: false,
      error: "",
    }));

    const { rerender } = render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: manyAssets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={manyAssets.length}
        initialQuery=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="scope-seed-a"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(manyAssets.map((candidate) => candidate.fqn))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
    expect(screen.getByText("asset-61")).not.toBeNull();

    rerender(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: manyAssets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={manyAssets.length}
        initialQuery=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={true}
        querySeedKey="scope-seed-b"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(manyAssets.map((candidate) => candidate.fqn))}
      />,
    );

    expect(screen.queryByText("asset-61")).toBeNull();
    expect(
      screen.getByText("Showing 60 of 65 results to keep the catalog responsive."),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
    expect(screen.getByText("asset-61")).not.toBeNull();

    workspaceState = {
      ...workspaceState,
      results: {
        ...workspaceState.results,
        requestKey: "scope-b",
      },
    };

    rerender(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: manyAssets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={manyAssets.length}
        initialQuery="finance"
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="scope-seed-c"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(manyAssets.map((candidate) => candidate.fqn))}
      />,
    );

    expect(screen.queryByText("asset-61")).toBeNull();
    expect(
      screen.getByText("Showing 60 of 65 results to keep the catalog responsive."),
    ).not.toBeNull();
  }, 15000);

  it("keeps load-more available when the live result count exceeds the fetched discovery rows", () => {
    const fetchedAssets = makeAssets(80);
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: fetchedAssets,
        count: 150,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        requestKey: "partial-fetch-scope",
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: fetchedAssets.find((candidate) => candidate.fqn === assetFqn) || fetchedAssets[0],
      loading: false,
      error: "",
    }));

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: fetchedAssets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={150}
        initialQuery=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="partial-fetch-seed"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(fetchedAssets.map((candidate) => candidate.fqn))}
      />,
    );

    expect(
      screen.getByText("Showing 60 of 150 results to keep the catalog responsive."),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more results" }));

    expect(screen.getByText("asset-80")).not.toBeNull();
    expect(
      screen.getByText("Showing 80 of 150 results to keep the catalog responsive."),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Load more results" })).not.toBeNull();
  }, 15000);

  it("expands the local result window just enough to keep an explicit route preview card visible", () => {
    const manyAssets = makeAssets(80);
    const previewedAsset = manyAssets[74];
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: manyAssets,
        count: manyAssets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        requestKey: "many-assets-scope",
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: manyAssets.find((candidate) => candidate.fqn === assetFqn) || manyAssets[0],
      loading: false,
      error: "",
    }));
    const onRoutePreviewChange = vi.fn();

    const { container } = render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: manyAssets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={manyAssets.length}
        initialQuery=""
        initialSelectedAssetFqn={previewedAsset.fqn}
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={onRoutePreviewChange}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="preview-deep-link"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(manyAssets.map((candidate) => candidate.fqn))}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "asset-75" })).not.toBeNull();
    expect(
      container.querySelector(`[data-asset-fqn="${previewedAsset.fqn}"]`),
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-asset-fqn="${manyAssets[75].fqn}"]`),
    ).toBeNull();
    expect(
      screen.getByText("Showing 75 of 80 results to keep the catalog responsive."),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Load more results" })).not.toBeNull();
    expect(onRoutePreviewChange).not.toHaveBeenCalled();
  }, 15000);

  it("does not render bootstrap discovery summary cards when no results match", () => {
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: "missing" }),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets: [],
        count: 0,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "missing",
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={{
          ...bootstrapPayload({
            capabilityAvailable: true,
            capabilityReason: "",
          }),
          discovery: {
            ...bootstrapPayload().discovery,
            summary: {
              visibleAssets: 17,
              catalogCount: 4,
              observedCatalogCount: 9,
              ownedAssets: 12,
              assetTypeCounts: { Table: 17 },
              catalogCounts: { main: 17 },
            },
          },
        }}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={null}
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
        sharedVisibleAssetSet={new Set()}
      />,
    );

    expect(screen.getByText("No matching assets")).not.toBeNull();
    expect(screen.queryByText("Catalogs")).toBeNull();
    expect(screen.queryByText("Observed catalogs")).toBeNull();
    expect(screen.queryByText("Owned assets")).toBeNull();
    expect(screen.queryByText(/^17$/)).toBeNull();
  });

  it("does not hydrate preview lineage from bootstrap graph seeds when lineage is available", () => {
    render(
      <DiscoveryWorkspace
        bootstrap={{
          ...bootstrapPayload({
            capabilityAvailable: true,
            capabilityReason: "",
          }),
          graphs: {
            [asset.fqn]: {
              data: {
                nodes: [{ id: "seed", assetFqn: asset.fqn }],
                edges: [],
              },
            },
          },
        }}
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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    expect(useLineageMock).toHaveBeenCalledWith(asset.fqn, false);
  });

  it("keeps the discovery command shell controls and stacked filter popover live", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters,
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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    // The inline toolbar search input was removed (target parity). The
    // equivalent query text input now lives inside the Filters popover,
    // reachable via the Stack Filters launcher below.
    expect(screen.getByRole("combobox", { name: "Sort metadata catalog results" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Sort metadata catalog results"), {
      target: { value: "Best match" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));

    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(
      setFilters.mock.calls.some(
        ([updater]) => typeof updater === "function" && updater(discoveryFilters()).sortBy === "Best match",
      ),
    ).toBe(true);
    // "Filters" now appears in the sidebar title, the quick-filter launcher,
    // and the popover heading. Assert via the popover's stable DOM id.
    expect(document.querySelector(".gh-filters-popover")).not.toBeNull();
    expect(screen.getByText("Structured Search Helper")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(document.querySelector(".gh-filters-popover")).toBeNull();
  });

  it("does not hydrate dynamic filter options from bootstrap when live facets are empty", () => {
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const assetTypeSection = screen.getByText("Asset Type").closest("section");
    if (!assetTypeSection) throw new Error("Expected asset-type sidebar section");
    expect(within(assetTypeSection).getByText("Asset types populate from live discovery facets.")).not.toBeNull();
    expect(within(assetTypeSection).queryByRole("button", { name: "Table" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));

    // The sidebar now also carries the word "Filters" as its section title,
    // so locate the popover by its stable DOM id instead of by text match.
    const filtersPopover = document.querySelector(".gh-filters-popover");
    if (!filtersPopover) throw new Error("Expected filters popover");

    expect(within(filtersPopover).getByRole("button", { name: "All assets" })).not.toBeNull();
    expect(within(filtersPopover).getByText("Asset types populate from live discovery facets.")).not.toBeNull();
    expect(within(filtersPopover).getByText("Catalog filters populate from live discovery facets.")).not.toBeNull();
    expect(within(filtersPopover).getByText("Domain filters populate from live discovery facets.")).not.toBeNull();
    expect(within(filtersPopover).queryByRole("button", { name: "Table" })).toBeNull();
  });

  it("adds a quoted single structured clause from the search helper", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters,
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "valid",
          syntaxHint: "Use field:value with quoted phrases when needed.",
          supportedFields: ["name", "domain", "owner"],
        },
        resolvedQuery: "",
      },
    });

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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));
    fireEvent.change(screen.getByLabelText("Query builder field"), {
      target: { value: "name" },
    });
    fireEvent.change(screen.getByLabelText("Query builder value"), {
      target: { value: "Customer Orders" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert into search" }));

    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(setFilters.mock.calls[0][0](discoveryFilters()).query).toBe('name:"Customer Orders"');
  });

  it("escapes quotes and backslashes when inserting a structured clause", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters,
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "valid",
          syntaxHint: "Use field:value with quoted phrases when needed.",
          supportedFields: ["description", "domain", "owner"],
        },
        resolvedQuery: "",
      },
    });

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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));
    fireEvent.change(screen.getByLabelText("Query builder field"), {
      target: { value: "description" },
    });
    fireEvent.change(screen.getByLabelText("Query builder value"), {
      target: { value: 'Customer "Orders" \\ Archive' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert into search" }));

    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(setFilters.mock.calls[0][0](discoveryFilters()).query).toBe(
      'description:"Customer \\"Orders\\" \\\\ Archive"',
    );
  });

  it("builds grouped any-of clauses and appends them to the existing search query", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: 'owner:"Mia Chen"' }),
      setFilters,
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "valid",
          syntaxHint: "Use field:value with AND/OR groups.",
          supportedFields: ["name", "domain", "owner"],
        },
        resolvedQuery: 'owner:"Mia Chen"',
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={1}
        initialQuery='owner:"Mia Chen"'
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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));
    fireEvent.change(screen.getByLabelText("Query builder field"), {
      target: { value: "domain" },
    });
    fireEvent.change(screen.getByLabelText("Query builder match mode"), {
      target: { value: "any" },
    });
    fireEvent.change(screen.getByLabelText("Query builder value"), {
      target: { value: "Finance, Support" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert into search" }));

    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(
      setFilters.mock.calls[0][0](discoveryFilters({ query: 'owner:"Mia Chen"' })).query,
    ).toBe('(owner:"Mia Chen") AND domain:(Finance OR Support)');
  });

  it("wraps an existing compound query before appending a new helper clause", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: "name:orders OR name:returns" }),
      setFilters,
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "valid",
          syntaxHint: "Use field:value with AND/OR groups.",
          supportedFields: ["name", "domain", "owner"],
        },
        resolvedQuery: "name:orders OR name:returns",
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={1}
        initialQuery="name:orders OR name:returns"
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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));
    fireEvent.change(screen.getByLabelText("Query builder field"), {
      target: { value: "owner" },
    });
    fireEvent.change(screen.getByLabelText("Query builder value"), {
      target: { value: "Mia Chen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert into search" }));

    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(
      setFilters.mock.calls[0][0](discoveryFilters({ query: "name:orders OR name:returns" })).query,
    ).toBe('(name:orders OR name:returns) AND owner:"Mia Chen"');
  });

  it("builds grouped all-of clauses with AND joining inside the field group", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters,
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "valid",
          syntaxHint: "Use field:value with AND/OR groups.",
          supportedFields: ["name", "domain", "owner"],
        },
        resolvedQuery: "",
      },
    });

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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));
    fireEvent.change(screen.getByLabelText("Query builder field"), {
      target: { value: "domain" },
    });
    fireEvent.change(screen.getByLabelText("Query builder match mode"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("Query builder value"), {
      target: { value: "Finance, Support" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert into search" }));

    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(setFilters.mock.calls[0][0](discoveryFilters()).query).toBe(
      "domain:(Finance AND Support)",
    );
  });

  it("surfaces structured query clauses as removable discovery chips", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: 'owner:"Mia Chen" AND domain:(Finance OR Support)' }),
      setFilters,
      results: {
        authoritative: true,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "valid",
          syntaxHint: "Use field:value with AND/OR groups.",
          supportedFields: ["owner", "domain"],
          clauseChips: [
            {
              label: 'owner:"Mia Chen"',
              expression: 'owner:"Mia Chen"',
              nextQuery: "domain:(Finance OR Support)",
              removable: true,
            },
            {
              label: "domain:(Finance OR Support)",
              expression: "domain:(Finance OR Support)",
              nextQuery: 'owner:"Mia Chen"',
              removable: true,
            },
          ],
        },
        resolvedQuery: 'owner:"Mia Chen" AND domain:(Finance OR Support)',
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={1}
        initialQuery='owner:"Mia Chen" AND domain:(Finance OR Support)'
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
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    // "Stack Filters" launcher still carries that aria-label; the
    // visible badge count lives in a separate element.
    expect(screen.getByRole("button", { name: "Stack Filters" })).not.toBeNull();
    expect(screen.getByRole("button", { name: 'owner:"Mia Chen"' })).not.toBeNull();
    expect(screen.getByRole("button", { name: "domain:(Finance OR Support)" })).not.toBeNull();
    expect(screen.queryByText('Search: owner:"Mia Chen" AND domain:(Finance OR Support)')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "domain:(Finance OR Support)" }));

    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(
      setFilters.mock.calls[0][0](
        discoveryFilters({ query: 'owner:"Mia Chen" AND domain:(Finance OR Support)' }),
      ).query,
    ).toBe('owner:"Mia Chen"');
  });

  it("keeps the selected-asset preview rail interactive when the result selection changes", () => {
    const onOpenGovernance = vi.fn();
    const onOpenLineage = vi.fn();
    const onRoutePreviewChange = vi.fn();
    const assets = [asset, secondAsset];
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets,
        count: assets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assets.find((candidate) => candidate.fqn === assetFqn) || asset,
      loading: false,
      error: "",
    }));

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={assets.length}
        initialQuery=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={onOpenGovernance}
        onOpenLineage={onOpenLineage}
        onRoutePreviewChange={onRoutePreviewChange}
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
        sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
        workspaceAccess={fullWorkspaceAccess}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "orders" })).not.toBeNull();
    expect(onRoutePreviewChange).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByText("returns").closest("[role='button'], button"),
    );

    expect(within(preview).getByRole("heading", { name: "returns" })).not.toBeNull();
    expect(onRoutePreviewChange).toHaveBeenCalledWith(secondAsset.fqn);

    fireEvent.click(within(preview).getByRole("button", { name: "Open Governance" }));
    fireEvent.click(within(preview).getByRole("button", { name: "Open Lineage" }));

    expect(onOpenGovernance).toHaveBeenCalledWith(secondAsset.fqn);
    expect(onOpenLineage).toHaveBeenCalledWith(secondAsset.fqn, "Data Lineage");
  });

  it("keeps the default first visible preview local when the route has no explicit preview", () => {
    const onRoutePreviewChange = vi.fn();
    const assets = [asset, secondAsset];
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets,
        count: assets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assets.find((candidate) => candidate.fqn === assetFqn) || asset,
      loading: false,
      error: "",
    }));

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={assets.length}
        initialQuery=""
        initialSelectedAssetFqn=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={onRoutePreviewChange}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="preview-blank"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "orders" })).not.toBeNull();
    expect(onRoutePreviewChange).not.toHaveBeenCalled();
  });

  it("respects a route-seeded preview selection without echoing it back into the router", () => {
    const onRoutePreviewChange = vi.fn();
    const assets = [asset, secondAsset];
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets,
        count: assets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assets.find((candidate) => candidate.fqn === assetFqn) || asset,
      loading: false,
      error: "",
    }));

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={assets.length}
        initialQuery=""
        initialSelectedAssetFqn={secondAsset.fqn}
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={onRoutePreviewChange}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="preview-seed"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "returns" })).not.toBeNull();
    expect(onRoutePreviewChange).not.toHaveBeenCalled();
  });

  it("clears explicit route preview state on reset browse and rebinds the rail to the first visible result", () => {
    const onRoutePreviewChange = vi.fn();
    const setFilters = vi.fn();
    const assets = [asset, secondAsset];
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: "returns", views: ["Needs review"] }),
      setFilters,
      results: {
        authoritative: true,
        assets,
        count: assets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "returns",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assets.find((candidate) => candidate.fqn === assetFqn) || asset,
      loading: false,
      error: "",
    }));

    const { rerender } = render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={assets.length}
        initialQuery="returns"
        initialSelectedAssetFqn={secondAsset.fqn}
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={onRoutePreviewChange}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="preview-reset-1"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
      />,
    );

    let preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "returns" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reset browse" }));

    expect(setFilters).toHaveBeenCalledWith(discoveryFilters());
    expect(onRoutePreviewChange).toHaveBeenCalledWith("");

    rerender(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={assets.length}
        initialQuery=""
        initialSelectedAssetFqn=""
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={onRoutePreviewChange}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="preview-reset-2"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
      />,
    );

    preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "orders" })).not.toBeNull();
  });

  it("clears a route-seeded preview when the selected asset is no longer in scope", () => {
    const onRoutePreviewChange = vi.fn();
    const assets = [asset, secondAsset];
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
      setFilters: vi.fn(),
      results: {
        authoritative: true,
        assets,
        count: assets.length,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        resolvedQuery: "",
      },
    });
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assets.find((candidate) => candidate.fqn === assetFqn) || asset,
      loading: false,
      error: "",
    }));
    const { rerender } = render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets,
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={assets.length}
        initialQuery=""
        initialSelectedAssetFqn={secondAsset.fqn}
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={onRoutePreviewChange}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="preview-seed"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set(assets.map((entry) => entry.fqn))}
      />,
    );

    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters(),
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
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assetFqn === secondAsset.fqn ? secondAsset : asset,
      loading: false,
      error: "",
    }));

    rerender(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload({
          assets: [asset],
          capabilityAvailable: true,
          capabilityReason: "",
        })}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={1}
        initialQuery=""
        initialSelectedAssetFqn={secondAsset.fqn}
        onLiveCatalogStateChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenGovernance={() => {}}
        onOpenLineage={() => {}}
        onRoutePreviewChange={onRoutePreviewChange}
        onRouteQueryChange={() => {}}
        onSurfaceReady={() => {}}
        querySeedFresh={false}
        querySeedKey="preview-seed"
        runtimeFeatureFlags={[
          {
            key: "table_lineage_surface",
            enabled: true,
            state: "available",
          },
        ]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const preview = document.querySelector(".gh-selection-preview");
    if (!preview) throw new Error("Expected selected-asset preview rail");
    expect(within(preview).getByRole("heading", { name: "orders" })).not.toBeNull();
    expect(onRoutePreviewChange).toHaveBeenCalledWith("");
  });

  it("preserves clear-search and reset-browse actions inside the normalized discovery error state", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: "orders" }),
      setFilters,
      results: {
        authoritative: false,
        assets: [],
        count: 0,
        settled: true,
        loading: false,
        error: "Discovery backend timed out.",
        facets: {},
        queryState: null,
        resolvedQuery: "orders",
      },
    });

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
        querySeedKey="test"
        runtimeFeatureFlags={[]}
        sharedVisibleAssetSet={new Set([asset.fqn])}
      />,
    );

    const stateCard = screen.getByText("Discovery Unavailable").closest(".gh-workspace-state-card");
    if (!stateCard) throw new Error("Expected normalized discovery state card");

    fireEvent.click(within(stateCard).getByRole("button", { name: "Clear search" }));
    fireEvent.click(within(stateCard).getByRole("button", { name: "Reset browse" }));

    expect(setFilters).toHaveBeenCalledTimes(2);
    expect(setFilters.mock.calls[0][0](discoveryFilters({ query: "orders" })).query).toBe("");
    expect(setFilters.mock.calls[1][0]).toEqual(discoveryFilters());
  });

  it("renders invalid discovery queries as a dedicated invalid-search state", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: "workspace:main" }),
      setFilters,
      results: {
        authoritative: false,
        assets: [],
        count: 0,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "invalid",
          message: "Unknown discovery field `workspace`.",
          syntaxHint:
            'Use AND, OR, parentheses, quoted phrases, and field:value selectors such as name:orders or domain:"Finance".',
        },
        requestKey: "invalid-query-request",
        resolvedQuery: "workspace:main",
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload()}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={0}
        initialQuery="workspace:main"
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

    const stateCard = screen.getByText("Invalid Search").closest(".gh-workspace-state-card");
    if (!stateCard) throw new Error("Expected invalid discovery query state card");

    expect(within(stateCard).getByText("Unknown discovery field `workspace`.")).not.toBeNull();
    expect(within(stateCard).getByText(/Use AND, OR, parentheses/)).not.toBeNull();

    fireEvent.click(within(stateCard).getByRole("button", { name: "Clear search" }));
    fireEvent.click(within(stateCard).getByRole("button", { name: "Reset browse" }));

    expect(setFilters).toHaveBeenCalledTimes(2);
    expect(setFilters.mock.calls[0][0](discoveryFilters({ query: "workspace:main" })).query).toBe("");
    expect(setFilters.mock.calls[1][0]).toEqual(discoveryFilters());
  });

  it("disables the structured search helper while the current query is invalid", () => {
    const setFilters = vi.fn();
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: "workspace:main" }),
      setFilters,
      results: {
        authoritative: false,
        assets: [],
        count: 0,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "invalid",
          message: "Unknown discovery field `workspace`.",
          syntaxHint: "Use supported field:value selectors only.",
          supportedFields: ["name", "domain"],
        },
        requestKey: "invalid-query-request",
        resolvedQuery: "workspace:main",
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload()}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={0}
        initialQuery="workspace:main"
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

    fireEvent.click(screen.getByRole("button", { name: "Stack Filters" }));
    fireEvent.change(screen.getByLabelText("Query builder value"), {
      target: { value: "Finance" },
    });

    expect(
      screen.getByText(
        "Clear or correct the invalid search in the main query box before inserting another helper clause.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Insert into search" }).disabled).toBe(true);
    expect(screen.getByLabelText("Query builder boolean operator").disabled).toBe(true);
    expect(setFilters).not.toHaveBeenCalled();
  });

  it("prefers the invalid-search state over stale renderable results", () => {
    useAssetDetailMock.mockImplementation((assetFqn) => ({
      detail: assetFqn ? asset : null,
      loading: false,
      error: "",
    }));
    useDiscoveryWorkspaceMock.mockReturnValue({
      filters: discoveryFilters({ query: "workspace:main" }),
      setFilters: vi.fn(),
      results: {
        authoritative: false,
        assets: [asset],
        count: 1,
        settled: true,
        loading: false,
        error: "",
        facets: {},
        queryState: {
          state: "invalid",
          message: "Unknown discovery field `workspace`.",
          syntaxHint: "Use supported field:value selectors only.",
        },
        requestKey: "invalid-query-request",
        resolvedQuery: "workspace:main",
      },
    });

    render(
      <DiscoveryWorkspace
        bootstrap={bootstrapPayload()}
        effectiveBootMessage=""
        effectiveBootState="live"
        effectiveVisibleCount={1}
        initialQuery="workspace:main"
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

    expect(screen.getByText("Invalid Search")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open Record" })).toBeNull();
  });
});
