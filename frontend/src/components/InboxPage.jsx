import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGovernanceGlossary, fetchGovernanceWorkbench } from "../lib/api";
import { InboxPanel } from "./primitives/InboxPanel";

// The Inbox used to render only governance notifications — an always-empty
// panel on this estate — while real actionable work (open stewardship
// requests, glossary terms awaiting review) lived unsurfaced elsewhere.
// It now aggregates those existing sources, each item linking to the surface
// where the work is done. Sources that are genuinely empty say so honestly.

function textValue(value) {
  return String(value ?? "").trim();
}

function compactDate(value) {
  const raw = textValue(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

const OPEN_REQUEST_STATUSES = new Set(["", "pending", "open", "in_review", "new"]);
const REVIEW_TERM_STATUSES = new Set(["proposed", "draft", "in_review", "review", "pending"]);

function openRequestsFromWorkbench(payload) {
  const data = envelopeData(payload) || {};
  const requests = Array.isArray(data.requests) ? data.requests : [];
  return requests.filter((request) =>
    OPEN_REQUEST_STATUSES.has(textValue(request?.status).toLowerCase()),
  );
}

function reviewTermsFromGlossary(payload) {
  const terms = Array.isArray(payload?.glossary) ? payload.glossary : [];
  return terms.filter((term) =>
    REVIEW_TERM_STATUSES.has(textValue(term?.reviewState || term?.status).toLowerCase()),
  );
}

function SourceSection({ title, count, caption, emptyMessage, loading, error, children }) {
  return (
    <section aria-busy={loading ? "true" : undefined} className="gh-inbox-source-section" aria-label={title}>
      <div className="gh-inbox-source-head">
        <h2>{title}</h2>
        {/* While loading, show no number at all — a definitive "0" before
            the source responds reads as data. */}
        {loading ? null : <span className="gh-inbox-source-count">{Number(count || 0).toLocaleString()}</span>}
        {caption ? <em>{caption}</em> : null}
      </div>
      {loading ? (
        <div className="gh-inbox-source-empty">Loading from the governance control plane…</div>
      ) : error ? (
        <div className="gh-inbox-source-empty">{error}</div>
      ) : count ? (
        <div className="gh-inbox-source-list">{children}</div>
      ) : (
        <div className="gh-inbox-source-empty">{emptyMessage}</div>
      )}
    </section>
  );
}

export function InboxPage({
  bootState = "live",
  governanceInbox,
  onInboxItemAction,
  onBack,
  // Navigation into the surfaces where the work happens.
  onOpenGovernance = undefined,
  onOpenGlossaryTerm = undefined,
}) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = "Inbox — Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  const workbenchQuery = useQuery({
    queryKey: ["inbox", "governance-workbench"],
    queryFn: ({ signal }) => fetchGovernanceWorkbench({ signal }),
    staleTime: 60_000,
  });
  const glossaryQuery = useQuery({
    queryKey: ["inbox", "governance-glossary"],
    queryFn: () => fetchGovernanceGlossary(),
    staleTime: 60_000,
  });

  const openRequests = openRequestsFromWorkbench(workbenchQuery.data);
  const reviewTerms = reviewTermsFromGlossary(glossaryQuery.data);

  return (
    <section className="gh-inbox-page" aria-label="Governance inbox">
      <header className="gh-inbox-page-head">
        <div>
          <div className="gh-eyebrow">Governance</div>
          <h1 className="gh-inbox-page-title">Inbox</h1>
          <p className="gh-inbox-page-lede">
            Actionable governance work in one place - open stewardship requests, glossary terms awaiting review, and workflow notifications tied to your activity.
          </p>
        </div>
        {onBack ? (
          <button
            className="gh-tertiary-button gh-inbox-page-back"
            onClick={onBack}
            type="button"
          >
            ← Back to Discovery
          </button>
        ) : null}
      </header>

      <div className="gh-inbox-page-sections">
        <SourceSection
          title="Open stewardship requests"
          count={openRequests.length}
          caption="From the governance work queue"
          emptyMessage="No open stewardship requests right now."
          loading={workbenchQuery.isPending}
          error={workbenchQuery.error ? "Stewardship requests could not be loaded from the governance workbench." : ""}
        >
          {openRequests.slice(0, 25).map((request) => (
            <button
              className="gh-inbox-source-item"
              key={request.requestId || request.id}
              onClick={() => onOpenGovernance?.(textValue(request.assetFqn))}
              title="Open this request in Stewardship"
              type="button"
            >
              <strong>{textValue(request.title) || "Governance request"}</strong>
              <small>{textValue(request.assetFqn) || textValue(request.detail) || "No target asset recorded"}</small>
              <span className="gh-inbox-source-item-meta">
                {[textValue(request.status) || "Open", compactDate(request.createdAt)].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
          {openRequests.length > 25 ? (
            <div className="gh-inbox-source-empty">{`Showing 25 of ${openRequests.length.toLocaleString()} open requests — open Stewardship for the full queue.`}</div>
          ) : null}
        </SourceSection>

        <SourceSection
          title="Glossary terms awaiting review"
          count={reviewTerms.length}
          caption="Proposed and draft terms"
          emptyMessage="No glossary terms are waiting on review."
          loading={glossaryQuery.isPending}
          error={glossaryQuery.error ? "Glossary review queue could not be loaded." : ""}
        >
          {reviewTerms.slice(0, 25).map((term, index) => {
            const name = textValue(term.term || term.name) || "Glossary term";
            return (
              <button
                className="gh-inbox-source-item"
                key={term.termId || `${name}-${index}`}
                onClick={() => onOpenGlossaryTerm?.(textValue(term.termId) || name)}
                title="Open this term in the glossary"
                type="button"
              >
                <strong>{name}</strong>
                <small>{textValue(term.definition) || "No definition recorded yet"}</small>
                <span className="gh-inbox-source-item-meta">
                  {[textValue(term.reviewState || term.status) || "Draft", textValue(term.ownerEmail)].filter(Boolean).join(" · ")}
                </span>
              </button>
            );
          })}
        </SourceSection>

        <InboxPanel
          governanceInbox={governanceInbox}
          onInboxItemAction={onInboxItemAction}
          hideHeader
        />
      </div>
    </section>
  );
}

export default InboxPage;
