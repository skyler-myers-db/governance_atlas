function cellTone(value) {
  const num = Math.max(0, Math.min(100, Number(value) || 0));
  if (num >= 85) return "high";
  if (num >= 65) return "mid";
  if (num > 0) return "low";
  return "empty";
}

export function HeatmapMatrix({ data = [], columns = [] }) {
  const resolvedColumns = columns.length
    ? columns
    : Array.from(new Set(data.flatMap((row) => Object.keys(row.values || {}))));

  if (!data.length || !resolvedColumns.length) {
    return <div className="ga-chart-empty">No heatmap signals available.</div>;
  }

  return (
    <div className="ga-heatmap" role="table" aria-label="Domain heatmap">
      <div className="ga-heatmap-row ga-heatmap-head" role="row">
        <span role="columnheader" />
        {resolvedColumns.map((column) => (
          <span key={column} role="columnheader">{column}</span>
        ))}
      </div>
      {data.map((row) => (
        <div className="ga-heatmap-row" key={row.domain || row.label} role="row">
          <strong role="rowheader">{row.domain || row.label}</strong>
          {resolvedColumns.map((column) => {
            const value = row.values?.[column] ?? row[column] ?? 0;
            return (
              <span
                aria-label={`${column}: ${value}%`}
                className={`ga-heatmap-cell tone-${cellTone(value)}`}
                key={column}
                role="cell"
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default HeatmapMatrix;
