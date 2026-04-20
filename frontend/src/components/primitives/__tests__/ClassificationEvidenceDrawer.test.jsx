/**
 * ClassificationEvidenceDrawer (A9.4) tests.
 *
 * Locks the steward-review contract: evidence list renders, sample values
 * are masked by default, and approve/reject/defer emit review intents.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClassificationEvidenceDrawer } from "../ClassificationEvidenceDrawer";

const BASE_RECOMMENDATION = {
  recommendationId: "rec-1",
  assetFqn: "main.sales.customers",
  columnName: "ssn",
  suggestedSensitivity: "restricted",
  suggestedTier: "pii",
  suggestedCertification: "classified",
  status: "pending",
  sampleRedacted: true,
  sampleValues: [],
  evidence: [
    {
      source: "name_pattern",
      pattern: "ssn",
      label: "Social Security Number",
      confidence: 0.95,
    },
    {
      source: "column_comment",
      keyword: "pii",
      text: "Contains PII per GDPR",
      confidence: 0.6,
    },
  ],
  remediationSuggestions: [
    {
      kind: "mask_column",
      summary: "Consider applying column masking to restrict visibility.",
    },
  ],
  reviewNote: "",
  reviewedBy: "",
  reviewedAt: "",
};

function renderDrawer(overrides = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    recommendation: BASE_RECOMMENDATION,
    onReview: vi.fn(),
    submitting: false,
    reviewError: "",
    ...overrides,
  };
  return { ...render(<ClassificationEvidenceDrawer {...props} />), props };
}

describe("ClassificationEvidenceDrawer", () => {
  it("renders the header with asset fqn and column", () => {
    renderDrawer();
    const header = screen.getByText(/ssn · main\.sales\.customers/);
    expect(header).toBeTruthy();
  });

  it("renders each evidence card with its summary text", () => {
    renderDrawer();
    const list = screen.getByTestId("classification-evidence-list");
    expect(list.querySelectorAll("li").length).toBe(2);
    expect(list.textContent).toContain("Social Security Number");
    expect(list.textContent).toContain('Comment mentions "pii"');
  });

  it("masks sample values by default and exposes a Request full sample button", () => {
    renderDrawer();
    const samples = screen.getByTestId("classification-sample-values");
    expect(samples.textContent).toContain("***");
    expect(samples.querySelectorAll("li").length).toBe(3);
    const button = screen.getByTestId("classification-request-full-sample");
    expect(button.textContent).toMatch(/Request full sample/i);
  });

  it("labels remediation suggestions as informational", () => {
    renderDrawer();
    expect(screen.getByText(/Informational — not auto-applied/i)).toBeTruthy();
    const rem = screen.getByTestId("classification-remediation-list");
    expect(rem.textContent).toContain("Consider applying column masking");
  });

  it("emits approve with the entered review note", () => {
    const { props } = renderDrawer();
    const textarea = screen.getByTestId("classification-review-note");
    fireEvent.change(textarea, { target: { value: "confirmed with owner" } });
    fireEvent.click(screen.getByTestId("classification-review-approve"));
    expect(props.onReview).toHaveBeenCalledTimes(1);
    expect(props.onReview.mock.calls[0][0]).toEqual({
      recommendationId: "rec-1",
      decision: "approved",
      note: "confirmed with owner",
    });
  });

  it("emits reject without a note when textarea empty", () => {
    const { props } = renderDrawer();
    fireEvent.click(screen.getByTestId("classification-review-reject"));
    expect(props.onReview).toHaveBeenCalledTimes(1);
    expect(props.onReview.mock.calls[0][0]).toEqual({
      recommendationId: "rec-1",
      decision: "rejected",
      note: "",
    });
  });

  it("emits defer", () => {
    const { props } = renderDrawer();
    fireEvent.click(screen.getByTestId("classification-review-defer"));
    expect(props.onReview).toHaveBeenCalledTimes(1);
    expect(props.onReview.mock.calls[0][0].decision).toBe("deferred");
  });

  it("shows the reviewed summary and hides actions once already decided", () => {
    renderDrawer({
      recommendation: {
        ...BASE_RECOMMENDATION,
        status: "approved",
        reviewedBy: "alice@test.co",
        reviewNote: "looks good",
      },
    });
    expect(screen.queryByTestId("classification-review-approve")).toBeNull();
    expect(screen.queryByTestId("classification-review-reject")).toBeNull();
    expect(screen.queryByTestId("classification-review-defer")).toBeNull();
    expect(screen.getByText(/alice@test\.co/)).toBeTruthy();
  });

  it("surfaces reviewError when review fails", () => {
    renderDrawer({ reviewError: "Review failed: policy guardrail" });
    expect(screen.getByRole("alert").textContent).toContain("Review failed");
  });

  it("unmasks samples when sampleRedacted is false", () => {
    renderDrawer({
      recommendation: {
        ...BASE_RECOMMENDATION,
        sampleRedacted: false,
        sampleValues: ["alice@example.com"],
      },
    });
    const samples = screen.getByTestId("classification-sample-values");
    expect(samples.textContent).toContain("alice@example.com");
    expect(screen.queryByTestId("classification-request-full-sample")).toBeNull();
  });

  it("invokes the onRequestFullSample hook when the link is clicked", () => {
    const onRequestFullSample = vi.fn();
    renderDrawer({ onRequestFullSample });
    const button = screen.getByTestId("classification-request-full-sample");
    fireEvent.click(button);
    expect(onRequestFullSample).toHaveBeenCalledTimes(1);
    expect(onRequestFullSample.mock.calls[0][0]).toMatchObject({
      recommendationId: "rec-1",
      assetFqn: "main.sales.customers",
      columnName: "ssn",
    });
    expect(button.textContent).toMatch(/logged/i);
  });
});
