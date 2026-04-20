import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InsightsWorkspace from "./InsightsWorkspace";

// The component accepts a `gapAnalysisOverride` prop so we can feed it a
// synthetic hook payload without having to mount the TanStack QueryClient
// in every test.
function renderWorkspace(overrides = {}) {
  const baseOverride = {
    tiles: {
      ownershipGaps: 2,
      policyGaps: 1,
      freshnessGaps: 1,
      qualityIncidents: 1,
      totalAssets: 10,
    },
    lanes: {
      ownership: [
        {
          assetFqn: "main.sales.alpha",
          assetName: "alpha",
          objectType: "Delta Table",
          gapKind: "ownership",
          gapReason: "No owners assigned",
          evidence: [],
          remediation: {
            label: "Assign owner",
            action: "governance.requestOwner",
            href: "/governance?lane=ownership&asset=main.sales.alpha",
          },
        },
        {
          assetFqn: "main.sales.beta",
          assetName: "beta",
          objectType: "Delta Table",
          gapKind: "ownership",
          gapReason: "No owners assigned",
          evidence: [],
          remediation: {
            label: "Assign owner",
            action: "governance.requestOwner",
            href: "/governance?lane=ownership&asset=main.sales.beta",
          },
        },
      ],
      policy: [
        {
          assetFqn: "main.raw.gamma",
          assetName: "gamma",
          objectType: "Delta Table",
          gapKind: "policy",
          gapReason: "Missing sensitivity, certification, domain, tier",
          evidence: [],
          remediation: {
            label: "Approve classification",
            action: "governance.approveClassification",
            href: "/governance?lane=policy&asset=main.raw.gamma",
          },
        },
      ],
      freshness: [
        {
          assetFqn: "main.sales.delta",
          assetName: "delta",
          objectType: "Delta Table",
          gapKind: "freshness",
          gapReason: "Last observation is older than 7 days",
          evidence: [],
          remediation: {
            label: "Run profile",
            action: "governance.runProfile",
            href: "/governance?lane=freshness&asset=main.sales.delta",
          },
        },
      ],
      quality: [
        {
          assetFqn: "main.sales.epsilon",
          assetName: "epsilon",
          objectType: "Delta Table",
          gapKind: "quality",
          gapReason: "Quality incidents in the last 7 days: 1 failed",
          evidence: [],
          remediation: {
            label: "View quality incident",
            action: "governance.viewQualityIncident",
            href: "/governance?lane=quality&asset=main.sales.epsilon",
          },
        },
      ],
    },
    lanesOrder: ["ownership", "policy", "freshness", "quality"],
    qualitySignalAvailable: true,
    meta: { state: "available" },
    isLoading: false,
    refreshing: false,
    error: "",
    refreshError: "",
    refresh: () => {},
    ...overrides,
  };
  return render(
    <InsightsWorkspace
      gapAnalysisOverride={baseOverride}
      onNavigate={() => {}}
      onSurfaceReady={() => {}}
    />,
  );
}

describe("InsightsWorkspace", () => {
  it("renders the four tile counts", () => {
    renderWorkspace();
    const tiles = document.querySelectorAll("[data-lane]");
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    // Tile values (buttons show the integer values)
    expect(screen.getByText("Ownership gaps")).toBeDefined();
    expect(screen.getByText("Policy gaps")).toBeDefined();
    expect(screen.getByText("Freshness blind spots")).toBeDefined();
    expect(screen.getByText("Quality incidents")).toBeDefined();
  });

  it("defaults to ownership lane and shows its rows", () => {
    renderWorkspace();
    // Ownership rows are visible by default.
    expect(screen.getByText("main.sales.alpha")).toBeDefined();
    expect(screen.getByText("main.sales.beta")).toBeDefined();
    const actions = screen.getAllByText(/Assign owner →/);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions[0].getAttribute("href")).toBe(
      "/governance?lane=ownership&asset=main.sales.alpha",
    );
  });

  it("switches lanes when a tile is clicked", () => {
    renderWorkspace();
    const policyTile = document.querySelector('button[data-lane="policy"]');
    expect(policyTile).not.toBeNull();
    fireEvent.click(policyTile);
    expect(screen.getByText("main.raw.gamma")).toBeDefined();
    expect(screen.getByText(/Approve classification/)).toBeDefined();
  });

  it("renders empty state for an empty lane", () => {
    renderWorkspace({
      tiles: {
        ownershipGaps: 0,
        policyGaps: 0,
        freshnessGaps: 0,
        qualityIncidents: 0,
        totalAssets: 10,
      },
      lanes: {
        ownership: [],
        policy: [],
        freshness: [],
        quality: [],
      },
    });
    expect(screen.getByText(/No current gaps in this lane/)).toBeDefined();
  });

  it("flags quality ledger unavailability in the header", () => {
    renderWorkspace({ qualitySignalAvailable: false });
    expect(screen.getByText(/Quality ledger unavailable/)).toBeDefined();
  });

  it("shows error banner when the hook reports an error", () => {
    renderWorkspace({ error: "boom", isLoading: false });
    expect(screen.getByText(/Insights unavailable/)).toBeDefined();
    expect(screen.getByText(/boom/)).toBeDefined();
  });

  it("calls onSurfaceReady once the hook is settled", () => {
    const ready = vi.fn();
    render(
      <InsightsWorkspace
        gapAnalysisOverride={{
          tiles: {
            ownershipGaps: 0,
            policyGaps: 0,
            freshnessGaps: 0,
            qualityIncidents: 0,
            totalAssets: 0,
          },
          lanes: { ownership: [], policy: [], freshness: [], quality: [] },
          lanesOrder: ["ownership", "policy", "freshness", "quality"],
          qualitySignalAvailable: true,
          isLoading: false,
          error: "",
        }}
        onSurfaceReady={ready}
      />,
    );
    expect(ready).toHaveBeenCalled();
  });
});
