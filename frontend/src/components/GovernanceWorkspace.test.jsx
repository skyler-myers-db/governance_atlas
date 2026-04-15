import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GovernanceWorkspace from "./GovernanceWorkspace";

const useAssetDetailMock = vi.fn();
const useGovernanceGlossaryTermMock = vi.fn();
const useAssetSearchMock = vi.fn();
const useSeededAssetContextMock = vi.fn();

vi.mock("../hooks/useAssetDetail", () => ({
  canOpenAssetRecord: vi.fn(() => true),
  invalidateAssetDetail: vi.fn(),
  prefetchAssetDetail: vi.fn(),
  primeAssetDetail: vi.fn(),
  useAssetDetail: (...args) => useAssetDetailMock(...args),
}));

vi.mock("../hooks/useGovernanceGlossaryTerm", () => ({
  useGovernanceGlossaryTerm: (...args) => useGovernanceGlossaryTermMock(...args),
}));

vi.mock("../hooks/useAssetSearch", () => ({
  clearAssetSearchCache: vi.fn(),
  useAssetSearch: (...args) => useAssetSearchMock(...args),
}));

vi.mock("../hooks/useSeededAssetContext", () => ({
  useSeededAssetContext: (...args) => useSeededAssetContextMock(...args),
}));

vi.mock("../lib/assetRecordNavigation", () => ({
  openAssetRecordSafely: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  createGovernanceRequest: vi.fn(),
  normalizeGovernancePayload: (payload) => payload,
  updateGovernanceGlossaryTerm: vi.fn(),
  updateGovernanceRequest: vi.fn(),
  upsertGovernanceGlossaryTerm: vi.fn(),
  upsertGovernanceOwner: vi.fn(),
  getRuntimeDiagnostics: () => ({
    initialNavigation: {
      durationMs: 123,
    },
    lastRequest: {
      httpRequestId: "req-123",
      clientDurationMs: 45.6,
    },
    requests: [],
  }),
}));

const governancePayload = {
  authoritative: true,
  provenance: {
    warnings: [],
  },
  metrics: [],
  backlog: [],
  glossary: [],
};

describe("GovernanceWorkspace", () => {
  beforeEach(() => {
    useAssetDetailMock.mockReset();
    useGovernanceGlossaryTermMock.mockReset();
    useAssetSearchMock.mockReset();
    useSeededAssetContextMock.mockReset();

    useAssetDetailMock.mockReturnValue({
      detail: null,
      loading: false,
      error: "",
    });
    useGovernanceGlossaryTermMock.mockReturnValue({
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      refresh: vi.fn(),
      term: null,
    });
    useAssetSearchMock.mockReturnValue({
      loading: false,
      assets: [],
      resolvedQuery: "",
      error: "",
    });
    useSeededAssetContextMock.mockReturnValue({
      summary: null,
    });
  });

  it("keeps governance focused on stewardship and glossary even for admin roles", async () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Admin",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={governancePayload}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stewardship" })).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Diagnostics" })).toBeNull();
  });

  it("does not surface a diagnostics mode for non-admin roles", () => {
    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Reader",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={governancePayload}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Diagnostics" })).toBeNull();
  });

  it("hydrates selected glossary terms through the dedicated term detail hook", async () => {
    const curatedTerm = {
      termId: "term-1",
      term: "Customer Identifier",
      definition: "Curated glossary detail",
      reviewerRoster: [{ id: "rev-1", email: "reviewer@example.com", role: "Reviewer" }],
    };
    const idleResult = {
      loading: false,
      refreshing: false,
      error: "",
      refreshError: "",
      refresh: vi.fn(),
      term: null,
    };
    const activeResult = {
      ...idleResult,
      term: curatedTerm,
    };
    useGovernanceGlossaryTermMock.mockImplementation((termId) =>
      termId === "term-1" ? activeResult : idleResult,
    );

    render(
      <GovernanceWorkspace
        bootstrap={{
          assets: [],
          shell: {
            role: "Steward",
            diagnosticsEnabled: true,
          },
        }}
        contextSeedAssets={[]}
        governance={{
          ...governancePayload,
          glossary: [
            {
              termId: "term-1",
              term: "Customer Identifier",
              definition: "Seed definition",
              domain: "Sales",
              ownerEmail: "owner@example.com",
              status: "Approved",
              reviewerRoster: [],
              reviewers: [],
              termHistory: [],
              assetCount: 0,
              assets: [],
            },
          ],
        }}
        initialAssetFqn=""
        onGovernanceChange={() => {}}
        onNavigationStateChange={() => {}}
        onOpenAsset={() => {}}
        onOpenLineage={() => {}}
        onRouteAssetChange={() => {}}
        onSurfaceReady={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));
    fireEvent.click(screen.getByRole("button", { name: /Customer Identifier/i }));

    await waitFor(() => {
      expect(useGovernanceGlossaryTermMock).toHaveBeenCalledWith(
        "term-1",
        expect.objectContaining({
          enabled: true,
          seedTerm: expect.objectContaining({
            termId: "term-1",
          }),
        }),
      );
    });

    expect(screen.getAllByText("Curated glossary detail").length).toBeGreaterThan(0);
    expect(screen.getAllByText("reviewer@example.com").length).toBeGreaterThan(0);
  });
});
