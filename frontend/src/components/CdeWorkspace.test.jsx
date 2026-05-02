import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CdeWorkspace from "./CdeWorkspace";
import { fetchCdeDashboard, fetchCdeDetail } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchCdeDashboard: vi.fn(),
  fetchCdeDetail: vi.fn(),
}));

function candidate(id, overrides = {}) {
  const name = id.split(".").pop();
  return {
    id,
    name,
    assetFqn: id,
    domain: "Customer",
    owner: "customer-steward@entrada.ai",
    sensitivity: "Confidential",
    criticality: "Critical",
    certification: "Certified",
    controlCoverage: null,
    controlState: "unavailable",
    linkedPolicies: null,
    downstreamImpact: "Unavailable",
    lastReview: "",
    ...overrides,
  };
}

const cdeItems = [
  candidate("main.customer.customer_id"),
  candidate("main.customer.email_address", { sensitivity: "Restricted" }),
  candidate("main.customer.phone_number"),
  candidate("main.finance.account_balance", { domain: "Finance", certification: "Draft" }),
  candidate("main.finance.invoice_number", { domain: "Finance", criticality: "High", certification: "Draft" }),
  candidate("main.finance.lien_id", { domain: "Finance" }),
  candidate("main.finance.payment_amount", { domain: "Finance" }),
  candidate("main.finance.portfolio_score", { domain: "Finance" }),
  candidate("main.finance.revenue_code", { domain: "Finance" }),
  candidate("main.risk.risk_policy_flag", { domain: "Risk", sensitivity: "Restricted" }),
];

const dashboardEnvelope = {
  data: {
    summary: {
      totalCdes: 10,
      protectedCdes: null,
      sensitiveCandidates: 9,
      overdueReviews: null,
      domainsCovered: 3,
    },
    groups: [
      { domain: "Customer", items: cdeItems.filter((item) => item.domain === "Customer") },
      { domain: "Finance", items: cdeItems.filter((item) => item.domain === "Finance") },
      { domain: "Risk", items: cdeItems.filter((item) => item.domain === "Risk") },
    ],
    items: cdeItems,
  },
  meta: {
    state: "degraded",
    warnings: ["Dedicated CDE control coverage is unavailable; controls are marked unavailable rather than inferred."],
    capabilities: { controlCoverage: false },
  },
};

function detailFor(id) {
  return {
    data: {
      ...cdeItems.find((item) => item.id === id),
      businessDescription: "Authoritative customer identifier used across governed analytics.",
      lineageSnapshot: { state: "unavailable" },
      controls: [
        { name: "Access Control", state: "unavailable", coverage: null },
        { name: "Data Protection", state: "unavailable", coverage: null },
      ],
      linkedAssets: [{ assetFqn: id, name: id.split(".").pop(), type: "Table" }],
      activity: [],
    },
    meta: {
      state: "degraded",
      capabilities: { controlCoverage: false },
    },
  };
}

function renderCde(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CdeWorkspace {...props} />
    </QueryClientProvider>,
  );
}

describe("CdeWorkspace", () => {
  beforeEach(() => {
    fetchCdeDashboard.mockReset();
    fetchCdeDetail.mockReset();
    fetchCdeDashboard.mockResolvedValue(dashboardEnvelope);
    fetchCdeDetail.mockImplementation((id) => Promise.resolve(detailFor(id)));
  });

  it("renders the CDE North Star registry with truthful unavailable control state", async () => {
    const onSurfaceReady = vi.fn();
    renderCde({ onSurfaceReady });

    expect(await screen.findByText("Critical Data Elements Registry")).toBeDefined();
    expect(await screen.findByText("10")).toBeDefined();
    expect(screen.getByText("Discover, govern, and protect the data elements that drive trust and performance.")).toBeDefined();
    expect(screen.getByText("Total CDEs")).toBeDefined();
    expect(screen.getByText("Protected CDEs")).toBeDefined();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("9 sensitive candidates")).toBeDefined();
    expect(screen.queryByText("Certified Candidates")).toBeNull();
    expect(screen.getByLabelText("CDE filters")).toBeDefined();
    expect(screen.getByLabelText("CDE registry")).toBeDefined();
    expect(screen.getByText("Control Coverage")).toBeDefined();
    expect(screen.getByText("Linked Policies")).toBeDefined();
    expect(screen.getByText("Last Review")).toBeDefined();
    expect(onSurfaceReady).toHaveBeenCalledWith("cde");
  });

  it("preserves the North Star shell while the CDE registry is loading", () => {
    fetchCdeDashboard.mockReturnValue(new Promise(() => {}));
    renderCde();

    expect(screen.getByText("Critical Data Elements Registry")).toBeDefined();
    expect(screen.getByText("Loading CDE registry")).toBeDefined();
    expect(screen.getByLabelText("CDE filters")).toBeDefined();
    expect(screen.getByLabelText("CDE registry")).toBeDefined();
    expect(screen.getByLabelText("CDE detail")).toBeDefined();
    expect(screen.getByText("No CDE selected")).toBeDefined();
  });

  it("preserves the North Star shell when the CDE registry is unavailable", async () => {
    fetchCdeDashboard.mockRejectedValue(new Error("CDE endpoint failed"));
    renderCde();

    expect(await screen.findByText("CDE registry unavailable")).toBeDefined();
    expect(screen.getByText("Critical Data Elements Registry")).toBeDefined();
    expect(screen.getByLabelText("CDE filters")).toBeDefined();
    expect(screen.getByLabelText("CDE registry")).toBeDefined();
    expect(screen.getByLabelText("CDE detail")).toBeDefined();
  });

  it("filters, collapses groups, paginates, and updates the selected detail", async () => {
    renderCde();
    await screen.findAllByText("Customer Id");

    const registry = screen.getByLabelText("CDE registry");
    expect(within(registry).getByRole("button", { name: /Customer\s+\(3\)/i })).toBeDefined();
    expect(within(registry).getByRole("button", { name: /Finance\s+\(6\)/i })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Customer\s+\(3\)/i }));
    expect(within(registry).queryByText("Customer Id")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Customer\s+\(3\)/i }));
    expect(within(registry).getByText("Customer Id")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Search CDEs"), { target: { value: "email" } });
    expect(within(registry).getByText("Email Address")).toBeDefined();
    expect(within(registry).queryByText("Phone Number")).toBeNull();
    fireEvent.click(within(registry).getByRole("button", { name: /Email Address/i }));
    await waitFor(() => expect(fetchCdeDetail).toHaveBeenCalledWith("main.customer.email_address", expect.any(Object)));
    expect(await screen.findByText("Authoritative customer identifier used across governed analytics.")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Clear selected CDE"));
    expect(screen.getByText("No CDE selected")).toBeDefined();
    expect(document.querySelectorAll(".gh-cde-row.is-selected")).toHaveLength(0);
    fireEvent.click(within(registry).getByRole("button", { name: /Email Address/i }));
    expect(await screen.findByText("Authoritative customer identifier used across governed analytics.")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Search CDEs"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Domain filter"), { target: { value: "Finance" } });
    expect(within(registry).getByText("Invoice Number")).toBeDefined();
    expect(within(registry).queryByText("Risk Policy Flag")).toBeNull();
    fireEvent.change(screen.getByLabelText("Domain filter"), { target: { value: "All" } });

    fireEvent.click(screen.getByRole("button", { name: "›" }));
    expect(screen.getByText("Showing 10-10 of 10 CDEs")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Risk\s+\(1\)/i }));
    expect(within(registry).getByText("Risk Policy Flag")).toBeDefined();
  });

  it("switches detail tabs and routes backed asset and lineage actions", async () => {
    const onOpenAsset = vi.fn();
    const onOpenLineage = vi.fn();
    renderCde({ onOpenAsset, onOpenLineage });

    await screen.findByText("Critical Data Elements Registry");
    await screen.findByText("Business Description");
    fireEvent.click(screen.getByRole("tab", { name: "Controls" }));
    expect(screen.getByText("Control Status")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Linked Assets" }));
    expect(screen.getAllByText("Linked Assets").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /customer_id/i }));
    expect(onOpenAsset).toHaveBeenCalledWith("main.customer.customer_id");
    fireEvent.click(screen.getByRole("tab", { name: "Lineage" }));
    fireEvent.click(screen.getByRole("button", { name: "View full lineage" }));
    expect(onOpenLineage).toHaveBeenCalledWith("main.customer.customer_id");
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByText("CDE activity is unavailable for this visible candidate.")).toBeDefined();
  });
});
