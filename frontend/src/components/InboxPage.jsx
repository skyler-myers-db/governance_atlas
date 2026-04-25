import { useEffect } from "react";
import { InboxPanel } from "./primitives/InboxPanel";

export function InboxPage({ governanceInbox, onInboxItemAction, onBack }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = "Inbox — Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <section className="gh-inbox-page" aria-label="Governance inbox">
      <header className="gh-inbox-page-head">
        <div>
          <div className="gh-eyebrow">Governance</div>
          <h1 className="gh-inbox-page-title">Inbox</h1>
          <p className="gh-inbox-page-lede">
            Workflow notifications tied to your governance activity — stewardship
            requests assigned to you, ownership changes on assets you watch,
            quality run breaches, and glossary term reviews awaiting approval.
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

      <InboxPanel
        governanceInbox={governanceInbox}
        onInboxItemAction={onInboxItemAction}
      />
    </section>
  );
}

export default InboxPage;
