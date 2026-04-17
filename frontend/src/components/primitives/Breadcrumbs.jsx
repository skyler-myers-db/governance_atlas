function classes(...values) {
  return values.filter(Boolean).join(" ");
}

export function Breadcrumbs({
  items = [],
  separator = "/",
  className = "",
  ariaLabel = "Breadcrumb",
  onNavigate = null,
}) {
  const cleanItems = (items || []).filter((item) => item && item.label);
  if (!cleanItems.length) return null;

  return (
    <nav aria-label={ariaLabel} className={classes("gh-breadcrumbs", className)}>
      <ol className="gh-breadcrumbs-list">
        {cleanItems.map((item, index) => {
          const isLast = index === cleanItems.length - 1;
          const isClickable = !isLast && (item.onClick || item.href || onNavigate);
          const content = item.label;

          return (
            <li
              aria-current={isLast ? "page" : undefined}
              className={classes("gh-breadcrumbs-item", isLast && "is-current")}
              key={item.key ?? `${item.label}-${index}`}
            >
              {isClickable ? (
                <button
                  className="gh-breadcrumbs-link"
                  onClick={() => {
                    if (item.onClick) item.onClick(item);
                    else if (onNavigate) onNavigate(item);
                  }}
                  type="button"
                >
                  {content}
                </button>
              ) : (
                <span className="gh-breadcrumbs-label">{content}</span>
              )}
              {!isLast ? (
                <span aria-hidden="true" className="gh-breadcrumbs-separator">
                  {separator}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
