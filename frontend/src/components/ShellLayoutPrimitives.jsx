function classes(...values) {
  return values.filter(Boolean).join(" ");
}

function renderMetaItem(item, index) {
  if (item == null || item === false) return null;
  if (typeof item === "object" && item.key && item.content !== undefined) {
    return (
      <span className="gh-surface-header-meta-item" key={item.key}>
        {item.content}
      </span>
    );
  }
  return (
    <span className="gh-surface-header-meta-item" key={`meta-${index}`}>
      {item}
    </span>
  );
}

/**
 * @param {{
 *   eyebrow?: string,
 *   title?: import("react").ReactNode,
 *   identity?: import("react").ReactNode,
 *   meta?: Array<unknown>,
 *   actions?: import("react").ReactNode,
 *   className?: string,
 *   variant?: "standard" | "featured",
 *   children?: import("react").ReactNode,
 * }} props
 */
export function SurfaceHeader({
  eyebrow = "",
  title = "",
  identity = "",
  meta = [],
  actions = null,
  className = "",
  variant = "standard",
  children = null,
}) {
  const metaItems = (meta || []).map(renderMetaItem).filter(Boolean);

  return (
    <div className={classes("gh-surface-header", variant === "featured" && "is-featured", className)}>
      <div className="gh-surface-header-main">
        <div className="gh-surface-header-title-block">
          {eyebrow ? <div className="gh-panel-title">{eyebrow}</div> : null}
          {title ? <div className="gh-surface-header-title">{title}</div> : null}
          {identity ? <div className="gh-surface-header-identity">{identity}</div> : null}
          {metaItems.length ? <div className="gh-surface-header-meta">{metaItems}</div> : null}
        </div>
        {actions ? <div className="gh-surface-header-actions">{actions}</div> : null}
      </div>
      {children ? <div className="gh-surface-header-extra">{children}</div> : null}
    </div>
  );
}

export function SurfaceRail({
  eyebrow = "",
  title = "",
  titleMeta = null,
  identity = "",
  actions = null,
  className = "",
  bodyClassName = "",
  children = null,
  ...props
}) {
  return (
    <aside className={classes("gh-panel gh-surface-rail", className)} {...props}>
      <div className="gh-surface-rail-head">
        <div className="gh-surface-rail-title-block">
          {eyebrow ? <div className="gh-eyebrow">{eyebrow}</div> : null}
          {title || titleMeta ? (
            <div className="gh-surface-rail-title-row">
              {title ? (
                <h3 className="gh-surface-rail-title gh-truncate" title={typeof title === "string" ? title : undefined}>
                  {title}
                </h3>
              ) : null}
              {titleMeta ? <div className="gh-surface-rail-title-meta">{titleMeta}</div> : null}
            </div>
          ) : null}
          {identity ? <div className="gh-support-copy">{identity}</div> : null}
        </div>
      </div>
      {actions ? <div className="gh-action-grid gh-surface-rail-actions">{actions}</div> : null}
      {children ? <div className={classes("gh-surface-rail-body", bodyClassName)}>{children}</div> : null}
    </aside>
  );
}

export function SurfaceRailSection({
  title = "",
  actions = null,
  className = "",
  children = null,
  empty = "",
}) {
  return (
    <section className={classes("gh-surface-rail-section", className)}>
      {title || actions ? (
        <div className="gh-surface-rail-section-head">
          {title ? <div className="gh-panel-title">{title}</div> : null}
          {actions ? <div className="gh-surface-rail-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children ? children : empty ? <div className="gh-support-copy">{empty}</div> : null}
    </section>
  );
}

export function SurfaceWorkbench({ variant = "standard", className = "", children = null, ...props }) {
  return (
    <div className={classes("gh-surface-workbench", variant && `gh-surface-workbench-${variant}`, className)} {...props}>
      {children}
    </div>
  );
}

export function SurfaceWorkbenchMain({ className = "", dense = false, children = null, ...props }) {
  return (
    <section
      className={classes(
        "gh-panel",
        "gh-surface-workbench-main",
        dense && "gh-surface-workbench-pane-dense",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}
