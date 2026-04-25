export function SectionCard({ title, eyebrow = "", actions = null, children, className = "", tooltip = "" }) {
  return (
    <section className={`ga-section-card ${className}`.trim()}>
      <header className="ga-section-card-header">
        <div>
          {eyebrow ? <div className="ga-eyebrow">{eyebrow}</div> : null}
          <h2>
            <span>{title}</span>
            {tooltip ? (
              <button
                aria-label={`${title}: ${tooltip}`}
                className="ga-info-tooltip"
                title={tooltip}
                type="button"
              >
                i
              </button>
            ) : null}
          </h2>
        </div>
        {actions ? <div className="ga-section-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export default SectionCard;
