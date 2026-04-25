export function PageHero({
  title,
  subtitle = "",
  eyebrow = "",
  actions = null,
  visual = null,
  children = null,
  className = "",
}) {
  return (
    <section className={`ga-page-hero ${className}`.trim()}>
      <div className="ga-page-hero-copy">
        {eyebrow ? <div className="ga-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="ga-page-hero-actions">{actions}</div> : null}
      {visual ? <div className="ga-page-hero-visual" aria-hidden="true">{visual}</div> : null}
    </section>
  );
}

export default PageHero;
