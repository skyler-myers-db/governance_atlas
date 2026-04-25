export function Sparkline({ values = [], width = 96, height = 32, label = "Trend" }) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const points = nums
    .map((value, index) => {
      const x = (index / (nums.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      aria-label={label}
      className="ga-sparkline"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default Sparkline;
