export function ActionTile({ icon, label, description, onClick, disabled = false, className = "" }) {
  return (
    <button className={`ga-action-tile ${className}`.trim()} disabled={disabled} onClick={onClick} type="button">
      {icon ? <span className="ga-action-tile-icon">{icon}</span> : null}
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </button>
  );
}

export default ActionTile;
