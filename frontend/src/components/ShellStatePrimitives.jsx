function classes(...values) {
  return values.filter(Boolean).join(" ");
}

export function WorkspaceStateCard({
  eyebrow = "",
  title = "",
  message = "",
  tone = "neutral",
  loading = false,
  actions = null,
  className = "",
  children = null,
}) {
  return (
    <div className={classes("gh-panel", "gh-unavailable-panel", "gh-workspace-state-card", `tone-${tone}`, className)}>
      {eyebrow ? <div className="gh-panel-title">{eyebrow}</div> : null}
      {title ? <h2>{title}</h2> : null}
      {message ? <div className="gh-support-copy gh-workspace-state-message">{message}</div> : null}
      {loading ? (
        <div aria-hidden="true" className="gh-workspace-state-skeleton">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {children ? <div className="gh-workspace-state-extra">{children}</div> : null}
      {actions ? <div className="gh-empty-state-actions">{actions}</div> : null}
    </div>
  );
}

export function InlineStatusBanner({
  title = "",
  message = "",
  tone = "warn",
  className = "",
  actions = null,
  children = null,
}) {
  return (
    <div className={classes("gh-inline-alert", "gh-inline-status-banner", `tone-${tone}`, className)}>
      {title ? <div className="gh-inline-alert-title">{title}</div> : null}
      {message ? <div>{message}</div> : null}
      {children ? <div className="gh-inline-status-banner-extra">{children}</div> : null}
      {actions ? <div className="gh-inline-status-banner-actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyStateBlock({
  title = "",
  message = "",
  actions = null,
  className = "",
  children = null,
}) {
  return (
    <div className={classes("gh-empty-state", "gh-empty-state-block", className)}>
      {title ? <div className="gh-empty-state-title">{title}</div> : null}
      {message ? <div>{message}</div> : null}
      {children ? <div className="gh-empty-state-extra">{children}</div> : null}
      {actions ? <div className="gh-empty-state-actions">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ message = "Loading…", className = "" }) {
  return (
    <div
      aria-live="polite"
      className={classes("gh-empty-state", "gh-loading-state", className)}
      role="status"
    >
      {message}
    </div>
  );
}
