import { Sparkline } from "./Sparkline";

function clampProgress(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

export function MetricCard({
  icon = null,
  label,
  value,
  delta = "",
  deltaTone = "good",
  sparkline = [],
  progress = undefined,
  meta = "",
  className = "",
  tooltip = "",
}) {
  const hasProgress = typeof progress === "number";

  return (
    <article className={`ga-metric-card ${className}`.trim()}>
      <div className="ga-metric-card-head">
        {icon ? <span className="ga-metric-icon">{icon}</span> : null}
        <span className="ga-metric-label">
          <span>{label}</span>
          {tooltip ? (
            <button
              aria-label={`${label}: ${tooltip}`}
              className="ga-info-tooltip"
              title={tooltip}
              type="button"
            >
              i
            </button>
          ) : null}
        </span>
      </div>
      <div className="ga-metric-main">
        <strong>{value}</strong>
        {sparkline.length ? <Sparkline values={sparkline} label={`${label} trend`} /> : null}
      </div>
      {hasProgress ? (
        <div className="ga-progress" aria-label={`${label} progress`}>
          <span style={{ width: `${clampProgress(progress)}%` }} />
        </div>
      ) : null}
      {delta ? <div className={`ga-metric-delta tone-${deltaTone}`}>{delta}</div> : null}
      {meta ? <div className="ga-metric-meta">{meta}</div> : null}
    </article>
  );
}

export default MetricCard;
