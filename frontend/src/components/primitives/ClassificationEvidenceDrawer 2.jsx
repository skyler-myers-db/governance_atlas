/**
 * ClassificationEvidenceDrawer (A9.4).
 *
 * Steward review surface for a single classification recommendation.
 * Displays evidence, redacted sample values, remediation suggestions, and
 * approve/reject/defer actions. No UC policy writes from this drawer —
 * remediation suggestions are rendered as an explicit "informational"
 * bullet list.
 */

import { useCallback, useEffect, useState } from "react";
import { SurfaceDrawer, SurfaceDrawerSection } from "../ShellLayoutPrimitives";

const EVIDENCE_SOURCE_LABEL = {
  name_pattern: "Column name pattern",
  uc_tag: "Unity Catalog tag",
  column_comment: "Column comment",
  glossary_match: "Glossary match",
};

function evidenceSummaryText(entry) {
  const source = String(entry?.source || "").trim();
  if (source === "name_pattern") {
    return entry?.label || entry?.pattern || "Column-name pattern match";
  }
  if (source === "uc_tag") {
    const tagKey = String(entry?.tag || "").trim();
    const tagValue = String(entry?.value || "").trim();
    if (tagKey && tagValue) return `${tagKey} = ${tagValue}`;
    if (tagKey) return tagKey;
    return "Unity Catalog tag";
  }
  if (source === "column_comment") {
    const keyword = String(entry?.keyword || "").trim();
    return keyword ? `Comment mentions "${keyword}"` : "Column comment";
  }
  if (source === "glossary_match") {
    const term = String(entry?.termName || "").trim();
    return term ? `Glossary term: ${term}` : "Glossary match";
  }
  return "Evidence";
}

function confidenceTone(confidence) {
  const value = Number(confidence || 0);
  if (value >= 0.85) return "good";
  if (value >= 0.7) return "info";
  if (value > 0) return "warn";
  return "neutral";
}

function confidenceLabel(confidence) {
  const value = Number(confidence || 0);
  if (!value) return "";
  return `${Math.round(value * 100)}%`;
}

function assetLabel(recommendation) {
  const fqn = String(recommendation?.assetFqn || "").trim();
  const column = String(recommendation?.columnName || "").trim();
  if (!fqn && !column) return "Classification review";
  if (!column) return fqn;
  return `${column} · ${fqn}`;
}

export function ClassificationEvidenceDrawer({
  isOpen = false,
  onClose = null,
  recommendation = null,
  onReview = null,
  submitting = false,
  reviewError = "",
  onRequestFullSample = null,
}) {
  const [note, setNote] = useState("");
  const [requestedFullSample, setRequestedFullSample] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setRequestedFullSample(false);
    }
  }, [isOpen, recommendation?.recommendationId]);

  const handleReview = useCallback(
    (decision) => {
      if (typeof onReview !== "function") return;
      if (!recommendation?.recommendationId) return;
      onReview({
        recommendationId: recommendation.recommendationId,
        decision,
        note: note.trim(),
      });
    },
    [onReview, recommendation, note],
  );

  const handleRequestFullSample = useCallback(() => {
    if (requestedFullSample) return;
    setRequestedFullSample(true);
    if (typeof onRequestFullSample === "function") {
      try {
        onRequestFullSample({
          recommendationId: recommendation?.recommendationId || "",
          assetFqn: recommendation?.assetFqn || "",
          columnName: recommendation?.columnName || "",
        });
      } catch {
        // Intent is best-effort — drawer never fails the render.
      }
    } else if (typeof console !== "undefined") {
      // Default no-op for the MVP: log the intent so demos/screenshots
      // capture a trail.
      console.info("[classification] full-sample requested", {
        recommendationId: recommendation?.recommendationId,
        assetFqn: recommendation?.assetFqn,
        columnName: recommendation?.columnName,
      });
    }
  }, [requestedFullSample, onRequestFullSample, recommendation]);

  const evidence = Array.isArray(recommendation?.evidence) ? recommendation.evidence : [];
  const remediation = Array.isArray(recommendation?.remediationSuggestions)
    ? recommendation.remediationSuggestions
    : [];
  const sampleValues = recommendation?.sampleRedacted
    ? ["***", "***", "***"]
    : Array.isArray(recommendation?.sampleValues)
      ? recommendation.sampleValues
      : [];

  const status = String(recommendation?.status || "pending").toLowerCase();
  const isReviewable = status === "pending";

  return (
    <SurfaceDrawer
      className="gh-classification-drawer"
      isOpen={isOpen}
      onClose={onClose}
      eyebrow="Classification review"
      title={assetLabel(recommendation)}
      titleMeta={
        <span
          className={`gh-chip gh-chip-soft gh-chip-tone-${status === "approved" ? "good" : status === "rejected" ? "bad" : "info"}`}
        >
          {status}
        </span>
      }
    >
      <SurfaceDrawerSection
        title="Suggested classification"
        titleMeta={
          recommendation?.suggestedSensitivity ? (
            <span className="gh-chip gh-chip-soft">{recommendation.suggestedSensitivity}</span>
          ) : null
        }
      >
        <div className="gh-chip-row">
          {recommendation?.suggestedTier ? (
            <span className="gh-chip gh-chip-soft">Tier: {recommendation.suggestedTier}</span>
          ) : null}
          {recommendation?.suggestedCertification ? (
            <span className="gh-chip gh-chip-soft">
              Certification: {recommendation.suggestedCertification}
            </span>
          ) : null}
        </div>
      </SurfaceDrawerSection>

      <SurfaceDrawerSection
        title="Evidence"
        titleMeta={
          evidence.length ? (
            <span className="gh-chip gh-chip-soft">{evidence.length} signal{evidence.length === 1 ? "" : "s"}</span>
          ) : null
        }
        empty={evidence.length ? "" : "No evidence was attached to this recommendation."}
      >
        {evidence.length ? (
          <ul
            aria-label="Evidence signals"
            className="gh-classification-evidence-list"
            data-testid="classification-evidence-list"
          >
            {evidence.map((entry, index) => (
              <li
                className="gh-classification-evidence-card"
                key={`${entry?.source || "evidence"}-${index}`}
              >
                <div className="gh-classification-evidence-topline">
                  <span className="gh-chip gh-chip-soft">
                    {EVIDENCE_SOURCE_LABEL[entry?.source] || entry?.source || "Evidence"}
                  </span>
                  {entry?.confidence ? (
                    <span
                      className={`gh-chip gh-chip-tone-${confidenceTone(entry.confidence)}`}
                      data-testid="classification-evidence-confidence"
                    >
                      {confidenceLabel(entry.confidence)}
                    </span>
                  ) : null}
                </div>
                <div className="gh-classification-evidence-summary">
                  {evidenceSummaryText(entry)}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </SurfaceDrawerSection>

      <SurfaceDrawerSection
        title="Sample values"
        titleMeta={
          recommendation?.sampleRedacted ? (
            <span className="gh-chip gh-chip-soft">Masked by default</span>
          ) : (
            <span className="gh-chip gh-chip-soft">Unmasked</span>
          )
        }
      >
        <ul
          aria-label="Sample values"
          className="gh-classification-sample-list"
          data-testid="classification-sample-values"
        >
          {sampleValues.map((value, index) => (
            <li className="gh-classification-sample-value" key={`sample-${index}`}>
              <code>{value}</code>
            </li>
          ))}
        </ul>
        {recommendation?.sampleRedacted ? (
          <button
            className="gh-link-button"
            data-testid="classification-request-full-sample"
            disabled={requestedFullSample}
            onClick={handleRequestFullSample}
            type="button"
          >
            {requestedFullSample ? "Full-sample request logged" : "Request full sample"}
          </button>
        ) : null}
      </SurfaceDrawerSection>

      <SurfaceDrawerSection
        title="Remediation suggestions"
        titleMeta={<span className="gh-chip gh-chip-soft">Informational — not auto-applied</span>}
        empty={remediation.length ? "" : "No remediation suggestions for this recommendation."}
      >
        {remediation.length ? (
          <ul
            aria-label="Remediation suggestions"
            className="gh-classification-remediation-list"
            data-testid="classification-remediation-list"
          >
            {remediation.map((item, index) => (
              <li className="gh-classification-remediation-item" key={`rem-${index}`}>
                <span className="gh-classification-remediation-kind">
                  {String(item?.kind || "").replace(/[_-]+/g, " ") || "Suggestion"}
                </span>
                <span className="gh-classification-remediation-summary">
                  {item?.summary || ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </SurfaceDrawerSection>

      <SurfaceDrawerSection title="Review">
        {!isReviewable ? (
          <div className="gh-support-copy">
            This recommendation has already been {status}. Reviewed by{" "}
            <strong>{recommendation?.reviewedBy || "unknown"}</strong>
            {recommendation?.reviewNote ? `: ${recommendation.reviewNote}` : ""}
          </div>
        ) : (
          <>
            <label className="gh-field-stack" htmlFor="classification-review-note">
              <span className="gh-field-label">Review note (optional)</span>
              <textarea
                className="gh-textarea"
                data-testid="classification-review-note"
                id="classification-review-note"
                onChange={(event) => setNote(event.target.value)}
                placeholder="Context for the decision, e.g. 'confirmed with data product owner'."
                rows={3}
                value={note}
              />
            </label>
            <div className="gh-action-grid" role="group" aria-label="Classification review actions">
              <button
                className="gh-primary-button"
                data-testid="classification-review-approve"
                disabled={submitting}
                onClick={() => handleReview("approved")}
                type="button"
              >
                Approve
              </button>
              <button
                className="gh-secondary-button"
                data-testid="classification-review-reject"
                disabled={submitting}
                onClick={() => handleReview("rejected")}
                type="button"
              >
                Reject
              </button>
              <button
                className="gh-secondary-button"
                data-testid="classification-review-defer"
                disabled={submitting}
                onClick={() => handleReview("deferred")}
                type="button"
              >
                Defer
              </button>
            </div>
            {reviewError ? (
              <div className="gh-support-copy gh-support-error" role="alert">
                {reviewError}
              </div>
            ) : null}
          </>
        )}
      </SurfaceDrawerSection>
    </SurfaceDrawer>
  );
}

export default ClassificationEvidenceDrawer;
