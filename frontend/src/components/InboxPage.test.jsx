import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InboxPage from "./InboxPage";
import { fetchGovernanceGlossary, fetchGovernanceWorkbench } from "../lib/api";

vi.mock("../lib/api", () => ({
  fetchGovernanceGlossary: vi.fn(),
  fetchGovernanceWorkbench: vi.fn(),
}));

function renderInbox(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxPage
        governanceInbox={{ state: "live", message: "", unreadCount: 0, items: [] }}
        onInboxItemAction={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("InboxPage", () => {
  beforeEach(() => {
    fetchGovernanceWorkbench.mockReset();
    fetchGovernanceGlossary.mockReset();
    fetchGovernanceWorkbench.mockResolvedValue({
      data: {
        requests: [
          {
            requestId: "req-1",
            title: "Governance review: product_mortgage_signal",
            status: "Pending",
            assetFqn: "datapact.enterprise_metadata_ops.product_mortgage_signal",
            createdAt: "2026-05-05T20:37:58.000Z",
          },
          {
            requestId: "req-2",
            title: "Resolved request",
            status: "Approved",
            assetFqn: "main.datapact.run_history",
          },
        ],
      },
    });
    fetchGovernanceGlossary.mockResolvedValue({
      glossary: [
        { termId: "t-1", term: "Average Revenue", status: "Proposed", definition: "Avg revenue measure." },
        { termId: "t-2", term: "Atlas Test Term", status: "Draft", definition: "" },
        { termId: "t-3", term: "Net Revenue", status: "Approved", definition: "Approved term." },
      ],
    });
  });

  it("populates open requests and review-pending terms from real sources with links", async () => {
    const onOpenGovernance = vi.fn();
    const onOpenGlossaryTerm = vi.fn();
    renderInbox({ onOpenGovernance, onOpenGlossaryTerm });

    // Open requests: only open/pending statuses count, resolved ones do not.
    const requestsSection = await screen.findByLabelText("Open stewardship requests");
    expect(await within(requestsSection).findByText("Governance review: product_mortgage_signal")).toBeDefined();
    expect(within(requestsSection).queryByText("Resolved request")).toBeNull();
    expect(within(requestsSection).getByText("1")).toBeDefined();
    fireEvent.click(within(requestsSection).getByText("Governance review: product_mortgage_signal").closest("button"));
    expect(onOpenGovernance).toHaveBeenCalledWith("datapact.enterprise_metadata_ops.product_mortgage_signal");

    // Term reviews: Proposed + Draft only; approved terms are not inbox work.
    const termsSection = screen.getByLabelText("Glossary terms awaiting review");
    expect(within(termsSection).getByText("Average Revenue")).toBeDefined();
    expect(within(termsSection).getByText("Atlas Test Term")).toBeDefined();
    expect(within(termsSection).queryByText("Net Revenue")).toBeNull();
    expect(within(termsSection).getByText("2")).toBeDefined();
    fireEvent.click(within(termsSection).getByText("Average Revenue").closest("button"));
    expect(onOpenGlossaryTerm).toHaveBeenCalledWith("t-1");
  });

  it("shows honest empty states when the sources are genuinely empty", async () => {
    fetchGovernanceWorkbench.mockResolvedValue({ data: { requests: [] } });
    fetchGovernanceGlossary.mockResolvedValue({ glossary: [] });
    renderInbox();

    expect(await screen.findByText("No open stewardship requests right now.")).toBeDefined();
    expect(screen.getByText("No glossary terms are waiting on review.")).toBeDefined();
  });

  it("never renders a definitive zero while the sources are still loading", () => {
    fetchGovernanceWorkbench.mockReturnValue(new Promise(() => {}));
    fetchGovernanceGlossary.mockReturnValue(new Promise(() => {}));
    renderInbox();

    const requestsSection = screen.getByLabelText("Open stewardship requests");
    expect(requestsSection.getAttribute("aria-busy")).toBe("true");
    expect(within(requestsSection).queryByText("0")).toBeNull();
    expect(within(requestsSection).getByText(/Loading from the governance control plane/i)).toBeDefined();
  });
});
