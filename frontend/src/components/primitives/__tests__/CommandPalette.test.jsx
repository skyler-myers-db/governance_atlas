import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";
import { fetchDiscoverySearch, fetchGovernanceGlossary } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  fetchDiscoverySearch: vi.fn(),
  fetchGovernanceGlossary: vi.fn(),
}));

const assets = [
  {
    fqn: "finance_prod.curated.revenue_daily",
    name: "revenue_daily",
    catalog: "finance_prod",
    schema: "curated",
    owners: [{ name: "Priya Shah", email: "priya.shah@entrada.ai" }],
  },
  {
    fqn: "customer_360.gold.customer_profile",
    name: "customer_profile",
    catalog: "customer_360",
    schema: "gold",
    owners: [{ name: "Sarah Johnson" }],
  },
];

describe("CommandPalette", () => {
  beforeEach(() => {
    // jsdom here may not provide localStorage; the palette guards its reads.
    window.localStorage?.clear?.();
    fetchGovernanceGlossary.mockReset();
    fetchGovernanceGlossary.mockResolvedValue({
      glossary: [
        {
          termId: "net-revenue",
          term: "Net Revenue",
          definition: "Recognized revenue net of adjustments.",
          domain: "Finance",
        },
        {
          termId: "active-customer",
          term: "Active Customer",
          definition: "Customer with a billable order in 90 days.",
          domain: "Customer",
        },
      ],
    });
    // Live discovery search resolves empty by default; individual tests
    // override with real payloads.
    fetchDiscoverySearch.mockReset();
    fetchDiscoverySearch.mockResolvedValue({ assets: [] });
  });

  it("keeps the search promise: assets, glossary terms, and owners all return results", async () => {
    const navigate = vi.fn();
    render(<CommandPalette assets={assets} navigate={navigate} onClose={() => {}} />);

    expect(screen.getByPlaceholderText("Search assets, glossary terms, owners…")).toBeDefined();
    await waitFor(() => expect(fetchGovernanceGlossary).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "revenue" },
    });

    // Asset result with a type badge.
    expect(await screen.findByText("revenue_daily")).toBeDefined();
    expect(screen.getAllByText("Asset").length).toBeGreaterThan(0);
    // Glossary term result routed to the taxonomy surface with the term id.
    expect(screen.getByText("Net Revenue")).toBeDefined();
    expect(screen.getAllByText("Term").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Net Revenue").closest("button"));
    expect(navigate).toHaveBeenCalledWith({ surface: "taxonomy", term: "net-revenue" });
  });

  it("queries the live discovery API (debounced) and surfaces assets missing from the seed inventory", async () => {
    // P1 fix: real asset names outside the seeded inventory used to return
    // "No commands match" with zero network calls. The palette now runs a
    // debounced /discovery/search query and renders those live results.
    fetchDiscoverySearch.mockResolvedValue({
      assets: [
        {
          fqn: "main.customer.customer_profile_live",
          name: "customer_profile_live",
          owners: [{ name: "Customer Steward" }],
        },
      ],
    });
    const navigate = vi.fn();
    render(<CommandPalette assets={[]} navigate={navigate} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "customer_profile" },
    });

    await waitFor(() =>
      expect(fetchDiscoverySearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: "customer_profile" }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText("customer_profile_live")).toBeDefined();
    fireEvent.click(screen.getByText("customer_profile_live").closest("button"));
    expect(navigate).toHaveBeenCalledWith({
      surface: "entity",
      fqn: "main.customer.customer_profile_live",
    });
  });

  it("shows an honest loading state while the live search is in flight", async () => {
    let resolveSearch;
    fetchDiscoverySearch.mockImplementation(
      () => new Promise((resolve) => { resolveSearch = resolve; }),
    );
    render(<CommandPalette assets={[]} navigate={vi.fn()} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "zzz_nothing" },
    });

    // While in flight there is no "no matches" claim.
    expect(
      await screen.findByText("Searching assets, glossary terms, and owners…"),
    ).toBeDefined();
    expect(screen.queryByText(/No matches for/)).toBeNull();

    // The fetch only fires after the debounce window; wait for it before
    // resolving the deferred promise.
    await waitFor(() => expect(fetchDiscoverySearch).toHaveBeenCalled());
    resolveSearch({ assets: [] });
    // Settled empty: plain-language copy, not command-palette jargon.
    expect(await screen.findByText('No matches for "zzz_nothing"')).toBeDefined();
    expect(screen.queryByText(/No commands match/)).toBeNull();
  });

  it("returns owner results that open Discover's structured owner search", async () => {
    const navigate = vi.fn();
    render(<CommandPalette assets={assets} navigate={navigate} onClose={() => {}} />);
    await waitFor(() => expect(fetchGovernanceGlossary).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "priya" },
    });

    expect(await screen.findByText("Priya Shah")).toBeDefined();
    expect(screen.getAllByText("Owner").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Priya Shah").closest("button"));
    expect(navigate).toHaveBeenCalledWith({
      surface: "discovery",
      query: 'owner:"Priya Shah"',
    });
  });

  it("surfaces owners that only appear in the live search payload", async () => {
    // Owner directory fix: owners of non-seeded assets (e.g. "Customer
    // Steward") were invisible because the owner list came from the seed
    // inventory only. Live payload owners now join the directory.
    fetchDiscoverySearch.mockResolvedValue({
      assets: [
        {
          fqn: "main.customer.customer_profile",
          name: "customer_profile",
          owners: [{ name: "Customer Steward" }],
        },
      ],
    });
    const navigate = vi.fn();
    render(<CommandPalette assets={[]} navigate={navigate} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "Customer Steward" },
    });

    expect(await screen.findByText("Customer Steward")).toBeDefined();
    fireEvent.click(screen.getByText("Customer Steward").closest("button"));
    expect(navigate).toHaveBeenCalledWith({
      surface: "discovery",
      query: 'owner:"Customer Steward"',
    });
  });

  it("omits the glossary group when the glossary fetch fails, without blocking assets", async () => {
    fetchGovernanceGlossary.mockRejectedValue(new Error("glossary down"));
    render(<CommandPalette assets={assets} navigate={vi.fn()} onClose={() => {}} />);
    await waitFor(() => expect(fetchGovernanceGlossary).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "revenue" },
    });

    expect(await screen.findByText("revenue_daily")).toBeDefined();
    expect(screen.queryByText("Net Revenue")).toBeNull();
  });

  it("degrades to seed-inventory matches when the live search fails", async () => {
    fetchDiscoverySearch.mockRejectedValue(new Error("search down"));
    render(<CommandPalette assets={assets} navigate={vi.fn()} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Command palette search"), {
      target: { value: "revenue" },
    });

    expect(await screen.findByText("revenue_daily")).toBeDefined();
  });
});
