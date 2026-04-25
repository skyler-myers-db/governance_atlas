export function DonutMetric({ value = 0, label, size = 132 }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="ga-donut-metric" style={{ width: size, height: size }}>
      <svg aria-hidden="true" viewBox="0 0 110 110">
        <circle className="ga-donut-track" cx="55" cy="55" r={radius} />
        <circle
          className="ga-donut-value"
          cx="55"
          cy="55"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ga-donut-label">
        <strong>{pct}%</strong>
        {label ? <span>{label}</span> : null}
      </div>
    </div>
  );
}

export default DonutMetric;
