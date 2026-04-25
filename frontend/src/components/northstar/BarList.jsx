export function BarList({ items = [], labelKey = "domain", valueKey = "score" }) {
  if (!items.length) return <div className="ga-chart-empty">No ranked items available.</div>;

  return (
    <ol className="ga-bar-list">
      {items.map((item, index) => {
        const value = Math.max(0, Math.min(100, Number(item[valueKey]) || 0));
        const label = item[labelKey] || item.label || item.name || `Item ${index + 1}`;
        return (
          <li key={item.key || label}>
            <span className="ga-bar-list-rank">{index + 1}</span>
            <span className="ga-bar-list-label">{label}</span>
            <span className="ga-bar-list-track" aria-hidden="true">
              <span style={{ width: `${value}%` }} />
            </span>
            <strong>{value}%</strong>
          </li>
        );
      })}
    </ol>
  );
}

export default BarList;
