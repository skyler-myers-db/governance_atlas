import { humanizeStatusLabel, inboxStatusLabel, inboxStatusTone } from "./shellStatusLabels";

export function InboxPanel({
  governanceInbox,
  onInboxItemAction,
  // When mounted inside the dedicated /inbox page (InboxPage already
  // renders its own page-level header) the panel's internal head row is
  // a duplicate. Setting this true suppresses the internal head so the
  // page only shows one Inbox title.
  hideHeader = false,
}) {
  const inboxItems = Array.isArray(governanceInbox?.items) ? governanceInbox.items : [];
  const inboxUnreadCount = Number.isFinite(Number(governanceInbox?.unreadCount))
    ? Math.max(0, Math.trunc(Number(governanceInbox.unreadCount)))
    : 0;
  const inboxState = String(governanceInbox?.state || "").trim().toLowerCase();
  const inboxTone = inboxStatusTone(inboxState);
  const inboxLabel = inboxStatusLabel(inboxState);
  const inboxMessage =
    String(governanceInbox?.message || "").trim() ||
    "Unread workflow notifications from governance activity.";

  return (
    <section className="gh-panel gh-shell-inbox-panel" aria-label="Governance inbox">
      {hideHeader ? null : (
        <div className="gh-shell-inbox-head">
          <div className="gh-shell-inbox-title-block">
            <div className="gh-panel-title">Inbox</div>
            <div className="gh-support-copy">{inboxMessage}</div>
          </div>
          <div className="gh-shell-inbox-head-meta">
            <span className={`gh-chip gh-chip-status tone-${inboxTone}`}>{inboxLabel}</span>
            <span className="gh-shell-inbox-count">
              {inboxUnreadCount > 0 ? `${inboxUnreadCount} unread` : "No unread items"}
            </span>
          </div>
        </div>
      )}
      {inboxItems.length ? (
        <div className="gh-shell-inbox-list">
          {inboxItems.map((item, index) => {
            const itemState = String(item?.inboxState || "").trim().toLowerCase();
            const itemTone =
              itemState === "dismissed"
                ? "bad"
                : itemState === "read"
                  ? "neutral"
                  : "warn";
            const canMarkRead = itemState !== "read" && itemState !== "dismissed";
            const canDismiss = itemState !== "dismissed";
            return (
              <article className="gh-shell-inbox-item" key={item.notificationId || `notification-${index}`}>
                <div className="gh-shell-inbox-item-copy">
                  <div className="gh-shell-inbox-item-title">{item.title || "Notification"}</div>
                  <div className="gh-shell-inbox-item-detail">
                    {item.detail || "No additional detail is available."}
                  </div>
                  <div className="gh-shell-inbox-item-meta">
                    {item.assetLabel || item.assetFqn ? <span>{item.assetLabel || item.assetFqn}</span> : null}
                    {item.createdBy ? <span>{item.createdBy}</span> : null}
                    {item.createdAt ? <span>{item.createdAt}</span> : null}
                  </div>
                </div>
                <div className="gh-shell-inbox-item-actions">
                  <span className="gh-chip gh-chip-soft">{humanizeStatusLabel(item.status || "open")}</span>
                  <span className={`gh-chip gh-chip-status tone-${itemTone}`}>
                    {humanizeStatusLabel(item.inboxState || "unread")}
                  </span>
                  <button
                    className="gh-tertiary-button gh-inline-link-button"
                    disabled={!canMarkRead}
                    onClick={() => onInboxItemAction?.(item.notificationId, "read")}
                    title={
                      !canMarkRead
                        ? itemState === "dismissed"
                          ? "Already dismissed — cannot mark read."
                          : "Already marked as read."
                        : undefined
                    }
                    type="button"
                  >
                    Mark read
                  </button>
                  <button
                    className="gh-tertiary-button gh-inline-link-button"
                    disabled={!canDismiss}
                    onClick={() => onInboxItemAction?.(item.notificationId, "dismiss")}
                    title={!canDismiss ? "Already dismissed." : undefined}
                    type="button"
                  >
                    Dismiss
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="gh-shell-inbox-empty">
          {inboxState === "loading" ? "Inbox items are loading from the governance control plane." : "No inbox items are currently available."}
        </div>
      )}
    </section>
  );
}
