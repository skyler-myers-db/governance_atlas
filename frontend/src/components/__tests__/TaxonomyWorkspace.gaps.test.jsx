import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaxonomyWorkspace from "../TaxonomyWorkspace";
import {
  createGovernanceRequest,
  fetchCdeDashboard,
  fetchTaxonomyOverview,
  updateAssetMetadata,
  upsertGovernanceGlossaryTerm,
  upsertGovernanceOwner,
} from "../../lib/api";

vi.mock("../../lib/api", () => ({
  createGovernanceRequest: vi.fn(),
  fetchCdeDashboard: vi.fn(),
  fetchTaxonomyOverview: vi.fn(),
  updateAssetMetadata: vi.fn(),
  upsertGovernanceGlossaryTerm: vi.fn(),
  upsertGovernanceOwner: vi.fn(),
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

function term(termId, name, overrides = {}) {
  return {
    termId,
    term: name,
    definition: `${name} definition used by governed analytics.`,
    domain: "Finance",
    status: "approved",
    assetCount: 2,
    assetPreview: [
      {
        assetFqn: `finance_prod.curated.${termId.replaceAll("-", "_")}`,
        assetLabel: termId,
        assetType: "Delta Table",
        platform: "Unity Catalog",
      },
    ],
    ...overrides,
  };
}

// 21 enriched terms — mirrors the live payload volume that the old
// `terms.slice(0, 4)` silently truncated to 4 cards.
const manyTerms = [
  term("atlas-test-term", "Atlas Test Term", {
    status: "draft",
    assetCount: 0,
    assetPreview: [],
    domain: "Unassigned",
    definition: "Leftover test row.",
  }),
  term("net-revenue", "Net Revenue"),
  term("gross-revenue", "Gross Revenue"),
  term("discounts", "Discounts"),
  term("refunds", "Refunds"),
  ...Array.from({ length: 16 }, (_, index) =>
    term(`metric-${index + 1}`, `Metric ${String(index + 1).padStart(2, "0")}`, {
      domain: index % 2 ? "Customer" : "Finance",
    }),
  ),
];

function cdeItem(id, overrides = {}) {
  return {
    id,
    assetFqn: id,
    name: id.split(".").pop(),
    column: `${id}.value`,
    sourceColumn: `${id}.value`,
    domain: "Finance",
    owner: "finance-steward@entrada.ai",
    certification: "Certified",
    status: "Certified",
    sourceBacked: true,
    recert: "90d",
    lastReview: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const manyCdes = [
  cdeItem("main.finance.net_revenue_usd"),
  cdeItem("main.finance.order_total_usd"),
  cdeItem("main.finance.invoice_number", { certification: "", status: "Certification pending" }),
  cdeItem("main.finance.payment_amount"),
  cdeItem("main.finance.revenue_code", {
    column: "",
    sourceColumn: "",
    sourceBacked: false,
  }),
  cdeItem("main.customer.customer_id", { domain: "Customer" }),
  cdeItem("main.customer.lifetime_value_usd", { domain: "Customer" }),
  cdeItem("main.customer.email_address", { domain: "Customer" }),
];

const overviewPayload = {
  data: {
    glossaryTerms: manyTerms,
    cdes: manyCdes,
    summary: { termCount: manyTerms.length },
  },
  meta: { state: "available", warnings: [] },
};

describe("TaxonomyWorkspace gap fixes", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/glossary-cdes");
    fetchCdeDashboard.mockReset();
    fetchCdeDashboard.mockResolvedValue({ data: { items: [] }, meta: { state: "available" } });
    fetchTaxonomyOverview.mockReset();
    fetchTaxonomyOverview.mockResolvedValue(overviewPayload);
    createGovernanceRequest.mockReset();
    createGovernanceRequest.mockResolvedValue({ ok: true, requestId: "REQ-77" });
    updateAssetMetadata.mockReset();
    updateAssetMetadata.mockResolvedValue({ ok: true });
    upsertGovernanceGlossaryTerm.mockReset();
    upsertGovernanceGlossaryTerm.mockResolvedValue({ ok: true, termId: "net-revenue" });
    upsertGovernanceOwner.mockReset();
    upsertGovernanceOwner.mockResolvedValue({ ok: true });
  });

  it("G1: renders every glossary term with an accurate count and a working search", () => {
    renderTaxonomy(overviewPayload);

    expect(screen.getByRole("tab", { name: `Glossary ${manyTerms.length}` })).toBeDefined();
    const cards = screen.getByLabelText("Glossary cards");
    // Cards carry role="button" (clickable), so count them by heading.
    expect(within(cards).getAllByRole("heading").length).toBe(manyTerms.length);
    expect(screen.getByText(`Showing ${manyTerms.length} of ${manyTerms.length} governed glossary terms`)).toBeDefined();

    fireEvent.change(screen.getByLabelText("Search glossary terms"), {
      target: { value: "gross revenue" },
    });
    const filtered = screen.getByLabelText("Glossary cards");
    expect(within(filtered).getAllByRole("heading").length).toBe(1);
    expect(within(filtered).getByRole("heading", { name: "Gross Revenue" })).toBeDefined();
    expect(screen.getByText(`Showing 1 of ${manyTerms.length} governed glossary terms`)).toBeDefined();
  });

  it("G2: leftover draft test rows never lead the registry", () => {
    renderTaxonomy(overviewPayload);

    const cards = screen.getByLabelText("Glossary cards");
    const headings = within(cards).getAllByRole("heading").map((node) => node.textContent);
    expect(headings[0]).toBe("Net Revenue");
    expect(headings[headings.length - 1]).toBe("Atlas Test Term");
  });

  it("G3: renders all CDE rows with a domain filter and a Showing X of Y caption", () => {
    renderTaxonomy(overviewPayload);

    fireEvent.click(screen.getByRole("tab", { name: `CDE Registry ${manyCdes.length}` }));
    const table = screen.getByRole("table", { name: "CDE registry table" });
    expect(within(table).getAllByRole("row").length).toBe(manyCdes.length + 1);
    expect(screen.getByText(`Showing ${manyCdes.length} of ${manyCdes.length} CDE registry rows`)).toBeDefined();

    const domainFilter = screen.getByRole("group", { name: "Filter CDEs by domain" });
    fireEvent.click(within(domainFilter).getByRole("button", { name: /Customer/ }));
    expect(screen.getByText(`Showing 3 of ${manyCdes.length} CDE registry rows`)).toBeDefined();
    const filteredTable = screen.getByRole("table", { name: "CDE registry table" });
    expect(within(filteredTable).getAllByRole("row").length).toBe(4);
    expect(within(filteredTable).getByText("customer_id")).toBeDefined();
  });

  it("G6: a hydrating envelope renders skeletons, never fake unavailable records", () => {
    renderTaxonomy({
      data: { glossaryTerms: [], cdes: [], summary: { termCount: 0 } },
      meta: { state: "loading", capabilities: { hydrating: true }, warnings: [] },
    });

    expect(screen.getByLabelText("Loading glossary terms")).toBeDefined();
    expect(screen.queryByText("Glossary term unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 0" }));
    expect(screen.getAllByText("Fetching CDE registry rows").length).toBeGreaterThan(0);
    expect(screen.queryByText("CDE evidence unavailable")).toBeNull();
  });

  it("G6: a genuinely empty registry shows an honest empty state", () => {
    renderTaxonomy({
      data: { glossaryTerms: [], cdes: [], summary: { termCount: 0 } },
      meta: { state: "available", warnings: [] },
    });

    expect(screen.getByText("No glossary terms yet")).toBeDefined();
    expect(screen.queryByText("Glossary term unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 0" }));
    expect(screen.getByText("No Critical Data Elements yet")).toBeDefined();
    expect(screen.queryByText("CDE evidence unavailable")).toBeNull();
  });

  it("G4/G13: certification column shows real certification and untagged sources get actionable copy", () => {
    renderTaxonomy(overviewPayload);

    fireEvent.click(screen.getByRole("tab", { name: `CDE Registry ${manyCdes.length}` }));
    const table = screen.getByRole("table", { name: "CDE registry table" });
    expect(within(table).getByRole("columnheader", { name: "Certification" })).toBeDefined();
    expect(within(table).getAllByText("Certified").length).toBeGreaterThan(0);
    expect(within(table).getByText("Certification Pending")).toBeDefined();
    // Persona-audit fix: untagged sources render an honest "Not tagged" state;
    // the remediation instruction lives in the cell tooltip, not as the value.
    expect(within(table).getAllByText("Not tagged").length).toBeGreaterThan(0);
    expect(within(table).queryByText("Tag cde_source_column on the asset")).toBeNull();
    const untaggedCell = within(table).getAllByText("Not tagged")[0].closest("[role='cell']");
    expect(untaggedCell?.getAttribute("title") || "").toMatch(/tag cde_source_column/i);
    expect(within(table).queryByText("Source unavailable")).toBeNull();
  });

  it("G9: dashboard-payload CDEs keep their asset FQN so source/lineage actions enable", async () => {
    const onOpenAsset = vi.fn();
    fetchTaxonomyOverview.mockResolvedValue({
      data: { glossaryTerms: manyTerms, cdes: [], summary: { termCount: manyTerms.length } },
      meta: { state: "available", warnings: [] },
    });
    fetchCdeDashboard.mockResolvedValue({
      data: {
        items: [
          {
            id: "main.finance.net_revenue_usd",
            name: "net_revenue_usd",
            owner: "finance-steward@entrada.ai",
            certification: "Certified",
            domain: "Finance",
          },
        ],
      },
      meta: { state: "available", warnings: [] },
    });
    renderTaxonomy(undefined, { onOpenAsset });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "CDE Registry 1" })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("tab", { name: "CDE Registry 1" }));
    const table = screen.getByRole("table", { name: "CDE registry table" });
    fireEvent.click(within(table).getByText("Net Revenue (USD)").closest("[role='row']"));

    const detail = screen.getByRole("complementary", { name: "Net Revenue (USD) detail" });
    expect(within(detail).getByText("main.finance.net_revenue_usd")).toBeDefined();
    const openAsset = within(detail).getByRole("button", { name: "Open source asset" });
    expect(openAsset.disabled).toBe(false);
    fireEvent.click(openAsset);
    expect(onOpenAsset).toHaveBeenCalledWith("main.finance.net_revenue_usd", "Overview");
  });

  it("G8: request recertification routes through governance-request creation", async () => {
    renderTaxonomy(overviewPayload);

    fireEvent.click(screen.getByRole("tab", { name: `CDE Registry ${manyCdes.length}` }));
    const table = screen.getByRole("table", { name: "CDE registry table" });
    fireEvent.click(within(table).getByText("net_revenue_usd").closest("[role='row']"));
    const detail = screen.getByRole("complementary", { name: "net_revenue_usd detail" });

    expect(within(detail).queryByRole("button", { name: /Recertification evidence/ })).toBeNull();
    const recert = within(detail).getByRole("button", { name: "Request recertification" });
    expect(recert.disabled).toBe(false);
    fireEvent.click(recert);
    await waitFor(() => {
      expect(createGovernanceRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          assetFqn: "main.finance.net_revenue_usd",
          title: expect.stringContaining("Recertification requested"),
        }),
        { fast: true },
      );
    });
  });

  it("G8: owner assignment submits through the governance owner upsert", async () => {
    renderTaxonomy(overviewPayload);

    fireEvent.click(screen.getByRole("tab", { name: `CDE Registry ${manyCdes.length}` }));
    const table = screen.getByRole("table", { name: "CDE registry table" });
    fireEvent.click(within(table).getByText("net_revenue_usd").closest("[role='row']"));
    const detail = screen.getByRole("complementary", { name: "net_revenue_usd detail" });

    fireEvent.click(within(detail).getByRole("button", { name: "Assign owner" }));
    const form = within(detail).getByRole("form", { name: /Assign owner for/ });
    fireEvent.change(within(form).getByLabelText("Owner email"), {
      target: { value: "new-owner@entrada.ai" },
    });
    fireEvent.submit(form);
    await waitFor(() => {
      expect(upsertGovernanceOwner).toHaveBeenCalledWith({
        assetFqn: "main.finance.net_revenue_usd",
        ownerEmail: "new-owner@entrada.ai",
        ownerType: "steward",
      });
    });
  });

  it("G8: glossary reviewer assignment submits through the glossary upsert", async () => {
    renderTaxonomy(overviewPayload);

    const cards = screen.getByLabelText("Glossary cards");
    fireEvent.click(within(cards).getByRole("heading", { name: "Net Revenue" }).closest("article"));
    const detail = screen.getByRole("complementary", { name: "Net Revenue detail" });

    expect(within(detail).queryByRole("button", { name: /Reviewer workflow unavailable/ })).toBeNull();
    fireEvent.click(within(detail).getByRole("button", { name: "Assign reviewer" }));
    const form = within(detail).getByRole("form", { name: /Assign reviewer to/ });
    fireEvent.change(within(form).getByLabelText("Reviewer email"), {
      target: { value: "reviewer@entrada.ai" },
    });
    fireEvent.submit(form);
    await waitFor(() => {
      expect(upsertGovernanceGlossaryTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          termId: "net-revenue",
          name: "Net Revenue",
          reviewers: expect.arrayContaining([
            expect.objectContaining({ email: "reviewer@entrada.ai" }),
          ]),
        }),
      );
    });
  });

  it("G7: + New CDE opens a backed modal that PATCHes asset metadata", async () => {
    renderTaxonomy(overviewPayload);

    fireEvent.click(screen.getByRole("tab", { name: `CDE Registry ${manyCdes.length}` }));
    fireEvent.click(screen.getByRole("button", { name: "+ New CDE" }));
    const dialog = screen.getByRole("dialog", { name: "Flag asset as CDE" });

    // FQN validation blocks malformed input before any API call.
    fireEvent.change(within(dialog).getByLabelText(/Asset FQN/), { target: { value: "not-an-fqn" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Flag as CDE" }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/catalog\.schema\.table/);
    expect(updateAssetMetadata).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Asset FQN/), {
      target: { value: "main.finance.new_cde_table" },
    });
    fireEvent.change(within(dialog).getByLabelText("Rationale"), {
      target: { value: "Feeds the revenue close." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Flag as CDE" }));
    await waitFor(() => {
      expect(updateAssetMetadata).toHaveBeenCalledWith("main.finance.new_cde_table", {
        isCde: true,
        cdeRationale: "Feeds the revenue close.",
      });
    });
    expect(screen.queryByRole("dialog", { name: "Flag asset as CDE" })).toBeNull();
  });

  it("G10-G12: honest association, parent, and review copy", () => {
    const payload = {
      data: {
        glossaryTerms: [
          term("parent-term", "Revenue", { assetCount: 3 }),
          term("child-term", "Adjusted Revenue", {
            parentTermId: "parent-term",
            childCount: 0,
            assetCount: 0,
            assetPreview: [],
            reviewedAt: "",
            termHistory: [
              {
                id: "v2",
                version: "v2",
                title: "Definition approved",
                status: "approved",
                changedAt: "2026-05-10T00:00:00Z",
              },
            ],
          }),
        ],
        cdes: [],
        summary: { termCount: 2 },
      },
      meta: { state: "available", warnings: [] },
    };
    renderTaxonomy(payload);

    expect(screen.getByText("3 linked assets")).toBeDefined();
    expect(screen.queryByText(/actor visibility not verified/)).toBeNull();
    expect(screen.getByText("No assets linked yet")).toBeDefined();
    expect(screen.queryByText("Association evidence unavailable")).toBeNull();
    // compactDate renders in the local timezone, so the UTC midnight stamp
    // may display as May 9 or May 10 depending on the runner's TZ.
    expect(screen.getAllByText(/Reviewed May (9|10), 2026/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Status returned; reviewer evidence unavailable/)).toBeNull();

    const cards = screen.getByLabelText("Glossary cards");
    fireEvent.click(within(cards).getByRole("heading", { name: "Adjusted Revenue" }).closest("article"));
    const detail = screen.getByRole("complementary", { name: "Adjusted Revenue detail" });
    const hierarchy = within(detail).getByRole("heading", { name: "Hierarchy" }).closest("section");
    expect(within(hierarchy).getByText("Revenue")).toBeDefined();
    expect(within(hierarchy).queryByText("Parent term recorded")).toBeNull();
  });

  it("humanizes raw taxonomy-node parent ids instead of rendering them verbatim", () => {
    // Persona-audit jargon purge: a parent id that references a taxonomy NODE
    // ("ga-taxonomy-node-revenue") is outside the term lookup; the Hierarchy
    // card used to print the raw internal id. It now title-cases the slug
    // tail ("Revenue").
    const payload = {
      data: {
        glossaryTerms: [
          term("child-term", "Adjusted Revenue", {
            parentTermId: "ga-taxonomy-node-revenue",
            childCount: 0,
          }),
        ],
        cdes: [],
        summary: { termCount: 1 },
      },
      meta: { state: "available", warnings: [] },
    };
    renderTaxonomy(payload);

    const cards = screen.getByLabelText("Glossary cards");
    fireEvent.click(within(cards).getByRole("heading", { name: "Adjusted Revenue" }).closest("article"));
    const detail = screen.getByRole("complementary", { name: "Adjusted Revenue detail" });
    const hierarchy = within(detail).getByRole("heading", { name: "Hierarchy" }).closest("section");
    expect(within(hierarchy).getByText("Revenue")).toBeDefined();
    expect(within(hierarchy).queryByText("ga-taxonomy-node-revenue")).toBeNull();
  });
});
