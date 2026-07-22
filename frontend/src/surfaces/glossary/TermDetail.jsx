import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  EntityChip,
  SectionCard,
  SuggestInput,
  toast,
} from "../../components/system";
import { useAtlasMutation } from "../../hooks/useAtlasQuery";
import { useWorkspaceRoster } from "../../hooks/useWorkspaceRoster";
import { upsertGovernanceGlossaryTerm } from "../../lib/api";
import {
  compactDate,
  humanizeTaxonomyRef,
  statusLabelFor,
  statusToneFor,
  termAssociationSummary,
  termAwaitingReview,
  termReviewSummary,
} from "./glossaryPresentation";

/*
 * TermDetail — the term miniature hub (PRODUCT_BLUEPRINT §3b). Answers, in
 * order: definition & status → linked assets → hierarchy → pending review →
 * stewardship. Every entity mention (assets, owners, work items, parent and
 * child terms) is a real EntityChip anchor; hierarchy renders REAL structure
 * only, with internal taxonomy ids humanized, never raw.
 */

function OwnerLine({ label, email }) {
  return (
    <div className="ga-glos-owner-line">
      <span className="ga-glos-kv-label">{label}</span>
      {email ? (
        <EntityChip appearance="inline" entity={{ kind: "owner", id: email, label: email }} />
      ) : (
        <span className="ga-glos-muted">Unassigned</span>
      )}
    </div>
  );
}

export function TermDetail({ term, termLookup, childTerms = [], onEdit, onClose }) {
  // Reviewer assignment goes through the same governed glossary upsert the
  // legacy registry used (POST /governance/glossary, replaying term fields
  // alongside the extended roster).
  const [reviewerFormOpen, setReviewerFormOpen] = useState(false);
  const [reviewerEmail, setReviewerEmail] = useState("");
  // Autofill reviewer picks from real account principals (fetched only while
  // the assign form is open); the server validates against the same roster.
  const roster = useWorkspaceRoster({ enabled: reviewerFormOpen });

  const assignReviewer = useAtlasMutation({
    mutate: (email) =>
      upsertGovernanceGlossaryTerm({
        termId: term.termId,
        name: term.term,
        definition: term.definition || "",
        domain: term.domain === "Unassigned" ? "" : term.domain || "",
        ownerEmail: term.ownerEmail || "",
        status: term.status || "draft",
        reviewers: [
          ...term.reviewers.map((reviewer) => ({
            email: reviewer.email,
            role: reviewer.role || "Reviewer",
            state: reviewer.state || "active",
          })),
          { email, role: "Reviewer", state: "active" },
        ],
        changeNote: `Reviewer ${email} assigned from the glossary registry.`,
      }),
    invalidates: [["atlas", "taxonomy-overview"], ["governance", "glossary"]],
  });

  // Term switches reset the inline form state.
  useEffect(() => {
    setReviewerFormOpen(false);
    setReviewerEmail("");
    assignReviewer.reset();
    // reset is stable (react-query); keying on the term id only is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term.termId]);

  const handleAssignReviewer = async (event) => {
    event.preventDefault();
    const email = reviewerEmail.trim();
    if (!email || assignReviewer.submitting) return;
    try {
      await assignReviewer.mutate(email);
      toast(`Reviewer ${email} assigned to ${term.term}.`, { tone: "success" });
      setReviewerEmail("");
      setReviewerFormOpen(false);
    } catch {
      /* assignReviewer.errorMessage renders inline below the form. */
    }
  };

  const parentResolved = term.parentTermId ? termLookup.get(term.parentTermId) : null;
  const hasHierarchy = Boolean(term.parentTermId || childTerms.length);
  const pendingRequests = term.recentRequests.filter((request) => request.status === "pending");
  const awaitingReview = termAwaitingReview(term);
  const firstAsset = term.assets.find((asset) => asset.fqn) || null;

  return (
    <section aria-label={`${term.term} detail`} className="ga-glos-term-detail">
      <header className="ga-glos-detail-head">
        <div>
          <span className="ga-glos-eyebrow">Term detail</span>
          <h2>{term.term}</h2>
        </div>
        <div className="ga-glos-detail-head-actions">
          <Button onClick={() => onEdit(term)} size="sm" variant="secondary">
            Edit term
          </Button>
          <Button aria-label={`Close ${term.term} detail`} onClick={onClose} size="sm" variant="tertiary">
            Close
          </Button>
        </div>
      </header>

      <div className="ga-glos-detail-grid">
        {/* 1 — definition & status */}
        <SectionCard
          className="ga-glos-detail-card is-definition"
          title="Definition & status"
          actions={<Badge tone={statusToneFor(term.status)}>{statusLabelFor(term.status, "Draft")}</Badge>}
        >
          <p className="ga-glos-definition">
            {term.definition || "No definition recorded for this term."}
          </p>
          <div className="ga-glos-kv-grid">
            <OwnerLine email={term.ownerEmail} label="Owner" />
            <OwnerLine email={term.stewardEmail} label="Steward" />
            <div className="ga-glos-owner-line">
              <span className="ga-glos-kv-label">Domain</span>
              <span>{term.domain || "Unassigned"}</span>
            </div>
            <div className="ga-glos-owner-line">
              <span className="ga-glos-kv-label">Review</span>
              <span>{termReviewSummary(term)}</span>
            </div>
            <div className="ga-glos-owner-line">
              <span className="ga-glos-kv-label">Version</span>
              <span>{term.currentVersion || "No backed version label"}</span>
            </div>
            {term.synonyms.length ? (
              <div className="ga-glos-owner-line">
                <span className="ga-glos-kv-label">Synonyms</span>
                <span>{term.synonyms.join(", ")}</span>
              </div>
            ) : null}
          </div>
        </SectionCard>

        {/* 2 — linked assets */}
        <SectionCard
          className="ga-glos-detail-card"
          title="Linked assets"
          subtitle={termAssociationSummary(term)}
          actions={
            firstAsset ? (
              <EntityChip
                appearance="inline"
                entity={{ kind: "lineage", fqn: firstAsset.fqn, label: "Open lineage" }}
              />
            ) : null
          }
        >
          {term.assets.length ? (
            <div className="ga-glos-linked-assets">
              {term.assets.map((asset) => (
                <EntityChip
                  appearance="row"
                  entity={{
                    kind: "asset",
                    fqn: asset.fqn,
                    label: asset.fqn || asset.label,
                    meta: [asset.type, asset.platform].filter(Boolean).join(" · "),
                  }}
                  key={asset.id}
                />
              ))}
            </div>
          ) : (
            <p className="ga-glos-muted">No linked assets are recorded for this term.</p>
          )}
        </SectionCard>

        {/* 3 — hierarchy (real structure only, humanized labels) */}
        <SectionCard className="ga-glos-detail-card" title="Hierarchy">
          {hasHierarchy ? (
            <div className="ga-glos-hierarchy">
              <div className="ga-glos-owner-line">
                <span className="ga-glos-kv-label">Parent</span>
                {parentResolved ? (
                  <EntityChip
                    appearance="inline"
                    entity={{ kind: "term", id: parentResolved.termId, label: parentResolved.term }}
                  />
                ) : term.parentTermId ? (
                  // Parent references a taxonomy node outside the glossary:
                  // humanize the slug; the raw id survives only in the title
                  // attribute for operators.
                  <span title={term.parentTermId}>{humanizeTaxonomyRef(term.parentTermId)}</span>
                ) : (
                  <span>Root term</span>
                )}
              </div>
              <div className="ga-glos-owner-line">
                <span className="ga-glos-kv-label">Child terms</span>
                {childTerms.length ? (
                  <span className="ga-glos-chip-row">
                    {childTerms.map((child) => (
                      <EntityChip
                        appearance="inline"
                        entity={{ kind: "term", id: child.termId, label: child.term }}
                        key={child.termId}
                      />
                    ))}
                  </span>
                ) : (
                  <span className="ga-glos-muted">No child terms recorded</span>
                )}
              </div>
            </div>
          ) : (
            <p className="ga-glos-muted">No parent or child terms are recorded for this term.</p>
          )}
        </SectionCard>

        {/* 4 — pending review → the stewardship work item */}
        <SectionCard className="ga-glos-detail-card" title="Pending review">
          {pendingRequests.length ? (
            <div className="ga-glos-review-list">
              {pendingRequests.map((request) => (
                <EntityChip
                  appearance="row"
                  entity={{
                    kind: "request",
                    id: request.id,
                    label: `${request.id} · ${request.title}`,
                    meta: request.createdAt ? `Filed ${compactDate(request.createdAt)}` : "",
                  }}
                  key={request.id}
                />
              ))}
            </div>
          ) : awaitingReview ? (
            <p className="ga-glos-muted">
              This term is {statusLabelFor(term.status, "Draft")} and awaiting review. No stewardship
              item is filed yet — assign a reviewer below to start the workflow.
            </p>
          ) : (
            <p className="ga-glos-muted">
              No review is pending.{" "}
              {term.reviewedAt ? `Last reviewed ${compactDate(term.reviewedAt)}.` : "No review timestamp recorded."}
            </p>
          )}
        </SectionCard>

        {/* 5 — stewardship: reviewers + history */}
        <SectionCard
          className="ga-glos-detail-card is-stewardship"
          title="Stewardship"
          actions={
            <Button
              onClick={() => setReviewerFormOpen((current) => !current)}
              size="sm"
              variant="secondary"
            >
              {reviewerFormOpen ? "Cancel" : "Assign reviewer"}
            </Button>
          }
        >
          {term.reviewers.length ? (
            <ul className="ga-glos-reviewer-list">
              {term.reviewers.slice(0, 4).map((reviewer) => (
                <li key={reviewer.id || reviewer.email}>
                  {reviewer.email ? (
                    <EntityChip
                      appearance="inline"
                      entity={{ kind: "owner", id: reviewer.email, label: reviewer.email }}
                    />
                  ) : (
                    <span>Reviewer</span>
                  )}
                  <span className="ga-glos-muted">
                    {reviewer.role || "Reviewer"} · {reviewer.state || "active"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ga-glos-muted">No reviewer assignments are recorded for this term.</p>
          )}
          {reviewerFormOpen ? (
            <form
              aria-label={`Assign reviewer to ${term.term}`}
              className="ga-glos-inline-form"
              onSubmit={handleAssignReviewer}
            >
              <label className="ga-glos-field">
                <span>Reviewer email</span>
                <SuggestInput
                  disabled={assignReviewer.submitting}
                  onChange={(event) => setReviewerEmail(event.target.value)}
                  options={roster.emails}
                  placeholder="reviewer@your-company.ai"
                  required
                  type="email"
                  value={reviewerEmail}
                />
              </label>
              {assignReviewer.errorMessage ? (
                <p className="ga-glos-form-error" role="alert">
                  {assignReviewer.errorMessage}
                </p>
              ) : null}
              <Button
                disabled={!reviewerEmail.trim()}
                loading={assignReviewer.submitting}
                type="submit"
                variant="primary"
                size="sm"
              >
                Assign reviewer
              </Button>
            </form>
          ) : null}
          {term.termHistory.length ? (
            <div className="ga-glos-history">
              <span className="ga-glos-kv-label">Version history</span>
              <ul>
                {term.termHistory.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    <strong>
                      {entry.version} · {entry.title}
                    </strong>
                    <span className="ga-glos-muted">
                      {entry.changedAt ? compactDate(entry.changedAt) : "Timestamp unavailable"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ga-glos-muted">No version history is recorded for this term.</p>
          )}
        </SectionCard>
      </div>
    </section>
  );
}

export default TermDetail;
