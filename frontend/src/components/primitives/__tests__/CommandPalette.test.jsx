import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";
import { fetchGovernanceGlossary } from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
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
});
