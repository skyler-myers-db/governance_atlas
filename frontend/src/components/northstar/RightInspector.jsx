export function RightInspector({
  title,
  subtitle = "",
  actions = null,
  children,
  onClose = null,
  className = "",
}) {
  return (
    <aside className={`ga-right-inspector ${className}`.trim()} aria-label={title}>
      <header className="ga-right-inspector-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {onClose ? (
          <button className="ga-icon-button" type="button" aria-label="Close inspector" onClick={onClose}>
            x
          </button>
        ) : null}
      </header>
      <div className="ga-right-inspector-body">{children}</div>
      {actions ? <footer className="ga-right-inspector-actions">{actions}</footer> : null}
    </aside>
  );
}

export default RightInspector;
