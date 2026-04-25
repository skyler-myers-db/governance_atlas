export function EmptyState({ title = "Nothing to show", message = "", actions = null, tone = "neutral" }) {
  return (
    <div className={`ga-empty-state tone-${tone}`.trim()}>
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {actions ? <div className="ga-empty-state-actions">{actions}</div> : null}
    </div>
  );
}

export default EmptyState;
