import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaxonomyWorkspace from "./TaxonomyWorkspace";
import { fetchCdeDashboard, fetchTaxonomyOverview, upsertGovernanceGlossaryTerm } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchCdeDashboard: vi.fn(),
  fetchTaxonomyOverview: vi.fn(),
  upsertGovernanceGlossaryTerm: vi.fn(),
}));

function renderTaxonomy(override, props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaxonomyWorkspace taxonomyOverride={override} {...props} />
    </QueryClientProvider>,
  );
}

const taxonomyPayload = {
  data: {
    glossaryTerms: [
      {
        termId: "net-revenue",
        term: "Net Revenue",
        definition: "Gross revenue minus discounts and refunds; recognized per ASC 606.",
        domain: "Finance",
        steward: "Finance Stewards",
        status: "Approved",
        assetCount: 4,
        currentVersion: "v3",
        reviewers: [
          {
            email: "finance.steward@entrada.ai",
            role: "Steward",
            state: "approved",
          },
        ],
        termHistory: [
          {
            id: "net-revenue-v3",
            version: "v3",
            title: "Definition approved",
            changedAt: "2026-04-01T12:00:00Z",
          },
        ],
        assetPreview: [
          {
            assetFqn: "finance_prod.curated.revenue_daily",
            assetLabel: "revenue_daily",
            assetType: "Delta Table",
            platform: "Unity Catalog",
          },
        ],
      },
      {
        termId: "active-customer",
        term: "Active Customer",
        definition: "A customer with at least one billable order in the trailing 90 days.",
        domain: "Customer",
        steward: "Customer Stewards",
        status: "Approved",
        assetCount: 7,
      },
      {
        termId: "booking",
        term: "Booking",
        definition: "A confirmed order, regardless of recognition status.",
        domain: "Revenue & Sales",
        steward: "Revenue Stewards",
        status: "In Review",
        assetCount: 6,
      },
    ],
    cdes: [
      {
        id: "net-revenue-usd",
        name: "Net Revenue (USD)",
        column: "finance_prod.curated.revenue_daily.net_revenue_usd",
        owner: "Finance Stewards",
        sox: true,
        recert: "90d",
        status: "Healthy",
      },
      {
        id: "customer-id",
        name: "Customer ID",
        column: "customer_360.gold.customer_profile.customer_id",
        owner: "Customer Stewards",
        recert: "180d",
        status: "Healthy",
      },
      {
        id: "ltv-usd",
        name: "Lifetime Value (USD)",
        column: "customer_360.gold.customer_profile.lifetime_value_usd",
        owner: "Customer Stewards",
        recert: "90d",
        status: "Recert due (8d)",
      },
    ],
    summary: { termCount: 3 },
  },
  meta: {
    state: "available",
    warnings: [],
  },
};

describe("TaxonomyWorkspace", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/glossary-cdes");
    fetchCdeDashboard.mockReset();
    fetchCdeDashboard.mockResolvedValue({ data: { items: [] }, meta: { state: "available" } });
    fetchTaxonomyOverview.mockReset();
    fetchTaxonomyOverview.mockResolvedValue(taxonomyPayload);
    upsertGovernanceGlossaryTerm.mockReset();
    upsertGovernanceGlossaryTerm.mockResolvedValue({ data: { termId: "gross-margin" } });
  });

  it("renders the Glossary & CDE Registry glossary cards", () => {
    renderTaxonomy(taxonomyPayload);

    expect(screen.getByText("Glossary & CDE Registry")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Shared business meaning, anchored to data" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Glossary 3" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "CDE Registry 3" })).toBeDefined();
    const cards = screen.getByLabelText("Glossary cards");
    expect(within(cards).getByRole("heading", { name: "Net Revenue" })).toBeDefined();
    expect(within(cards).getByText(/Finance · Finance Stewards/)).toBeDefined();
    expect(within(cards).getByText("Gross revenue minus discounts and refunds; recognized per ASC 606.")).toBeDefined();
    expect(within(cards).getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.queryByText("Business Taxonomy & Glossary")).toBeNull();
  });

  it("switches to the CDE Registry tab and preserves source-of-record columns", () => {
    renderTaxonomy(taxonomyPayload);

    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 3" }));
    expect(screen.getByRole("tab", { name: "CDE Registry 3" }).getAttribute("aria-selected")).toBe("true");
    const table = screen.getByRole("table", { name: "CDE registry table" });
    expect(within(table).getByRole("columnheader", { name: "Source-of-record column" })).toBeDefined();
    expect(within(table).getByText("Net Revenue (USD)")).toBeDefined();
    expect(within(table).getByText("finance_prod.curated.revenue_daily.net_revenue_usd")).toBeDefined();
    expect(within(table).getByText("Finance Stewards")).toBeDefined();
    expect(within(table).getByText("Recert Due (8d)")).toBeDefined();
    expect(within(table).getByText("SOX")).toBeDefined();
    expect(screen.getByText("Status and recertification are registry metadata values. Quality test-run or recertification workflow proof appears only when backed evidence is returned.")).toBeDefined();
  });

  it("keeps CDE registry rows in priority order without extra first-viewport controls", () => {
    renderTaxonomy(taxonomyPayload);

    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 3" }));
    const table = screen.getByRole("table", { name: "CDE registry table" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Net Revenue (USD)"),
      expect.stringContaining("Customer ID"),
      expect.stringContaining("Lifetime Value (USD)"),
    ]);
    expect(screen.queryByLabelText("Search CDE registry")).toBeNull();
    expect(screen.queryByLabelText("Filter CDE registry by status")).toBeNull();
    expect(screen.queryByLabelText("Sort CDE registry")).toBeNull();
  });

  it("wires registry actions to backed route callbacks and disables unavailable workflow mutations", async () => {
    const onOpenAsset = vi.fn();
    const onOpenLineage = vi.fn();
    renderTaxonomy(taxonomyPayload, { onOpenAsset, onOpenLineage });

    const newTerm = screen.getByRole("button", { name: "+ New term" });
    expect(newTerm.disabled).toBe(false);
    expect(newTerm.getAttribute("title")).toBe("Open the New term form");
    fireEvent.click(newTerm);
    expect(screen.getByRole("dialog", { name: "New glossary term" })).toBeDefined();
    fireEvent.change(screen.getByLabelText(/Term name/), { target: { value: "Gross Margin" } });
    fireEvent.click(screen.getByRole("button", { name: "Create term" }));
    await waitFor(() => {
      expect(upsertGovernanceGlossaryTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Gross Margin",
          status: "draft",
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "4 assets" }));
    const detail = screen.getByRole("complementary", { name: "Net Revenue detail" });
    expect(within(detail).getByRole("heading", { name: "Associated assets" })).toBeDefined();
    expect(within(detail).getByText("finance_prod.curated.revenue_daily")).toBeDefined();
    fireEvent.click(within(detail).getByRole("button", { name: /finance_prod\.curated\.revenue_daily/ }));
    expect(onOpenAsset).toHaveBeenCalledWith("finance_prod.curated.revenue_daily", "Overview");

    const glossaryCards = screen.getByLabelText("Glossary cards");
    const netRevenueCard = within(glossaryCards).getByRole("heading", { name: "Net Revenue" }).closest("article");
    fireEvent.click(within(netRevenueCard).getByRole("button", { name: "Preview lineage ->" }));
    expect(onOpenLineage).toHaveBeenCalledWith("finance_prod.curated.revenue_daily", "Data Lineage");
  });

  it("opens visible glossary term detail without inventing reviewer or version state", () => {
    const onOpenAsset = vi.fn();
    const onOpenLineage = vi.fn();
    renderTaxonomy(taxonomyPayload, { onOpenAsset, onOpenLineage });

    const glossaryCards = screen.getByLabelText("Glossary cards");
    fireEvent.click(within(glossaryCards).getByRole("heading", { name: "Net Revenue" }).closest("article"));

    const detail = screen.getByRole("complementary", { name: "Net Revenue detail" });
    expect(within(detail).getByRole("heading", { name: "Reviewer workflow" })).toBeDefined();
    expect(within(detail).getByText("finance.steward@entrada.ai")).toBeDefined();
    expect(within(detail).getByRole("heading", { name: "Version history" })).toBeDefined();
    expect(within(detail).getAllByText(/v3/).length).toBeGreaterThan(0);
    expect(within(detail).getByRole("heading", { name: "Hierarchy" })).toBeDefined();
    expect(within(detail).getByText("No nested child terms are recorded for this term.")).toBeDefined();

    fireEvent.click(within(detail).getByRole("button", { name: "Open first asset" }));
    expect(onOpenAsset).toHaveBeenCalledWith("finance_prod.curated.revenue_daily", "Overview");
    fireEvent.click(within(detail).getByRole("button", { name: "Open lineage" }));
    expect(onOpenLineage).toHaveBeenCalledWith("finance_prod.curated.revenue_daily", "Data Lineage");
    fireEvent.click(within(detail).getByRole("button", { name: "Browse all associations" }));
    expect(within(detail).getByRole("heading", { name: "Associated assets" })).toBeDefined();
    const reviewerWorkflow = within(detail).getByRole("button", { name: "Assign reviewer" });
    expect(reviewerWorkflow.disabled).toBe(false);
    fireEvent.click(within(detail).getByRole("button", { name: "Close Net Revenue detail" }));
    expect(screen.queryByRole("complementary", { name: "Net Revenue detail" })).toBeNull();
  });

  it("opens zero-asset glossary association detail and keeps lineage disabled with explicit rationale", () => {
    const payload = {
      data: {
        glossaryTerms: [
          {
            termId: "term-empty",
            term: "Unmapped Term",
            domain: "Finance",
            status: "approved",
            definition: "Term without registered asset associations.",
            assetCount: 0,
            linkedAssets: [],
          },
        ],
        cdes: [],
        summary: { termCount: 1 },
      },
      meta: { state: "available", warnings: [] },
    };
    renderTaxonomy(payload);

    const glossaryCards = screen.getByLabelText("Glossary cards");
    const emptyCard = within(glossaryCards).getByRole("heading", { name: "Unmapped Term" }).closest("article");
    const assetCount = within(emptyCard).getByRole("button", { name: "0 assets" });
    expect(assetCount.disabled).toBe(false);
    expect(assetCount.getAttribute("title")).toBe("Open association detail; no linked assets are recorded for this term");
    expect(within(emptyCard).getByRole("button", { name: "Preview lineage ->" }).disabled).toBe(true);

    fireEvent.click(assetCount);
    const detail = screen.getByRole("complementary", { name: "Unmapped Term detail" });
    expect(within(detail).getByRole("heading", { name: "Associated assets" })).toBeDefined();
    expect(within(detail).getByText("No linked assets are recorded for this term.")).toBeDefined();
    expect(within(detail).getByRole("button", { name: "Open first asset" }).disabled).toBe(true);
    expect(within(detail).getByRole("button", { name: "Open lineage" }).disabled).toBe(true);
    expect(within(detail).getByRole("button", { name: "Hide associations" }).disabled).toBe(false);
  });

  it("opens CDE detail actions using the source-of-record column table FQN", () => {
    const onOpenAsset = vi.fn();
    const onOpenLineage = vi.fn();
    renderTaxonomy(taxonomyPayload, { onOpenAsset, onOpenLineage });

    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 3" }));
    const newCde = screen.getByRole("button", { name: "+ New CDE" });
    expect(newCde.disabled).toBe(false);
    expect(newCde.getAttribute("title")).toBe("Flag an asset as a Critical Data Element");
    fireEvent.click(newCde);
    expect(screen.getByRole("heading", { name: "Flag asset as CDE" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const table = screen.getByRole("table", { name: "CDE registry table" });
    fireEvent.click(within(table).getByText("Net Revenue (USD)").closest("[role='row']"));

    const detail = screen.getByRole("complementary", { name: "Net Revenue (USD) detail" });
    expect(within(detail).getByRole("heading", { name: "Source-of-record column" })).toBeDefined();
    expect(within(detail).getByText("finance_prod.curated.revenue_daily.net_revenue_usd")).toBeDefined();

    fireEvent.click(within(detail).getByRole("button", { name: "Open source asset" }));
    expect(onOpenAsset).toHaveBeenCalledWith("finance_prod.curated.revenue_daily", "Overview");
    fireEvent.click(within(detail).getByRole("button", { name: "Open lineage" }));
    expect(onOpenLineage).toHaveBeenCalledWith("finance_prod.curated.revenue_daily", "Data Lineage");
    const ownerWorkflow = within(detail).getByRole("button", { name: "Assign owner" });
    expect(ownerWorkflow.disabled).toBe(false);
    expect(within(detail).getByRole("button", { name: "Request recertification" }).disabled).toBe(false);
    expect(within(detail).queryByRole("button", { name: /Recertification evidence/i })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Close Net Revenue (USD) detail" }));
    expect(screen.queryByRole("complementary", { name: "Net Revenue (USD) detail" })).toBeNull();
  });

  it("keeps an honest empty state for missing glossary and CDE rows", () => {
    renderTaxonomy({
      data: {
        glossaryTerms: [],
        cdes: [],
        summary: { termCount: 0 },
      },
      meta: { state: "available", warnings: [] },
    });

    // Fabricated "unavailable" records are gone: a genuinely empty registry
    // renders honest empty states, never fake rows styled like data.
    expect(screen.queryByText("Glossary term unavailable")).toBeNull();
    expect(screen.getByText("No glossary terms yet")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 0" }));
    expect(screen.queryByText("CDE evidence unavailable")).toBeNull();
    expect(screen.getByText("No Critical Data Elements yet")).toBeDefined();
  });

  it("rejects non-authoritative taxonomy and CDE payload rows", async () => {
    fetchCdeDashboard.mockResolvedValue({
      data: {
        items: [
          {
            id: "flagged-cde",
            name: "Flagged CDE",
            column: "main.sales.orders.flagged",
          },
        ],
      },
      meta: { evidenceKind: "non_authoritative_mock_capture" },
    });

    renderTaxonomy({
      ...taxonomyPayload,
      meta: {
        source: "prototype-mock",
        warnings: ["not live Databricks evidence"],
      },
    });

    expect(screen.getByText("Non-authoritative glossary and taxonomy payload rejected.")).toBeDefined();
    expect(screen.queryByText("Net Revenue")).toBeNull();
    expect(screen.queryByText("Glossary term unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 0" }));
    expect(screen.queryByText("Flagged CDE")).toBeNull();
    expect(screen.queryByText("CDE evidence unavailable")).toBeNull();
  });
});
