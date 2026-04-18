import { useEffect, useRef } from "react";

function classes(...values) {
  return values.filter(Boolean).join(" ");
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[tabindex]:not([tabindex=\"-1\"])",
  "[contenteditable=true]",
].join(",");

function getFocusableWithin(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
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

export function SurfaceTabs({
  items = [],
  activeKey = "",
  onChange = null,
  variant = "subtab",
  className = "",
  ariaLabel = "",
}) {
  const wrapperClass =
    variant === "segment"
      ? "gh-segment-row gh-surface-tabs gh-surface-tabs-segment"
      : "gh-subtabs gh-surface-tabs gh-surface-tabs-subtab";
  const buttonClass = variant === "segment" ? "gh-segment-button gh-surface-tab" : "gh-subtab gh-surface-tab";

  return (
    <div aria-label={ariaLabel || undefined} className={classes(wrapperClass, className)}>
      {items
        .filter((item) => !item?.hidden)
        .map((item) => (
          <button
            aria-pressed={activeKey === item.key}
            className={classes(buttonClass, activeKey === item.key && "is-active")}
            disabled={Boolean(item.disabled)}
            key={item.key}
            onClick={() => {
              if (!item.disabled) onChange?.(item.key);
            }}
            title={item.title}
            type="button"
          >
            {item.icon ? <span className="gh-surface-tab-icon">{item.icon}</span> : null}
            <span>{item.label}</span>
          </button>
        ))}
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

export function SurfacePanelSection({
  title = "",
  titleMeta = null,
  actions = null,
  className = "",
  children = null,
  empty = "",
}) {
  return (
    <section className={classes("gh-surface-panel-section", className)}>
      {title || titleMeta || actions ? (
        <div className="gh-surface-panel-section-head">
          <div className="gh-surface-panel-section-title-row">
            {title ? <div className="gh-panel-title">{title}</div> : null}
            {titleMeta ? <div className="gh-surface-panel-section-title-meta">{titleMeta}</div> : null}
          </div>
          {actions ? <div className="gh-surface-panel-section-actions">{actions}</div> : null}
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

export function SurfaceDrawerSection({
  title = "",
  titleMeta = null,
  actions = null,
  className = "",
  children = null,
  empty = "",
}) {
  return (
    <section className={classes("gh-surface-drawer-section", className)}>
      {title || titleMeta || actions ? (
        <div className="gh-surface-drawer-section-head">
          <div className="gh-surface-drawer-section-title-row">
            {title ? <div className="gh-panel-title">{title}</div> : null}
            {titleMeta ? <div className="gh-surface-drawer-section-title-meta">{titleMeta}</div> : null}
          </div>
          {actions ? <div className="gh-surface-drawer-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children ? children : empty ? <div className="gh-support-copy">{empty}</div> : null}
    </section>
  );
}

export function SurfaceDrawer({
  eyebrow = "",
  title = "",
  titleMeta = null,
  actions = null,
  className = "",
  bodyClassName = "",
  isOpen = false,
  onClose = null,
  children = null,
  ...props
}) {
  const drawerRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    if (typeof document === "undefined") return undefined;

    previousFocusRef.current = document.activeElement;
    const drawer = drawerRef.current;
    if (drawer) {
      const focusables = getFocusableWithin(drawer);
      const initialTarget =
        focusables[0] || (drawer.hasAttribute("tabindex") ? drawer : null);
      if (initialTarget) {
        window.requestAnimationFrame(() => initialTarget.focus?.());
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && typeof onClose === "function") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const drawerNode = drawerRef.current;
      if (!drawerNode) return;
      const focusables = getFocusableWithin(drawerNode);
      if (focusables.length === 0) {
        event.preventDefault();
        drawerNode.focus?.();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !drawerNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const restoreTarget = previousFocusRef.current;
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (restoreTarget && typeof restoreTarget.focus === "function") {
        restoreTarget.focus();
      }
    };
  }, [isOpen, onClose]);

  return (
    <aside
      aria-modal={isOpen ? "true" : undefined}
      className={classes("gh-surface-drawer", isOpen && "is-open", className)}
      ref={drawerRef}
      role={isOpen ? "dialog" : undefined}
      tabIndex={isOpen ? -1 : undefined}
      {...props}
    >
      <div className="gh-surface-drawer-head">
        <div className="gh-surface-drawer-title-block">
          {eyebrow ? <div className="gh-panel-title">{eyebrow}</div> : null}
          {title || titleMeta ? (
            <div className="gh-surface-drawer-title-row">
              {title ? <div className="gh-panel-title">{title}</div> : null}
              {titleMeta ? <div className="gh-surface-drawer-title-meta">{titleMeta}</div> : null}
            </div>
          ) : null}
        </div>
        {actions ? <div className="gh-surface-drawer-head-actions">{actions}</div> : null}
      </div>
      {children ? <div className={classes("gh-surface-drawer-body", bodyClassName)}>{children}</div> : null}
    </aside>
  );
}
