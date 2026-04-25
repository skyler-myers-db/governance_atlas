export function DegradedBanner({ meta, title = "Data availability is limited" }) {
  const warnings = Array.isArray(meta?.warnings) ? meta.warnings.filter(Boolean) : [];
  if (!meta?.degraded && warnings.length === 0 && meta?.state !== "degraded") return null;

  return (
    <div className="ga-degraded-banner" role="status">
      <strong>{title}</strong>
      {warnings.length ? (
        <span>{warnings.join(" ")}</span>
      ) : (
        <span>Some live signals are unavailable for the current visibility scope.</span>
      )}
    </div>
  );
}

export default DegradedBanner;
