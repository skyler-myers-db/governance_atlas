function classes(...values) {
  return values.filter(Boolean).join(" ");
}

export function MetadataChip({
  label = "",
  value = "",
  tone = "neutral",
  soft = false,
  title = "",
  children = null,
  className = "",
  ...props
}) {
  const toneClass = tone && tone !== "neutral" ? `tone-${tone}` : "";
  const content =
    children ??
    (label || value
      ? (
        <>
          {label ? <span className="gh-chip-label">{label}</span> : null}
          {label && value ? <span className="gh-chip-separator">{" · "}</span> : null}
          {value ? <span className="gh-chip-value">{value}</span> : null}
        </>
      )
      : null);

  return (
    <span
      className={classes(
        "gh-chip",
        soft && "gh-chip-soft",
        toneClass && "gh-chip-status",
        toneClass,
        className,
      )}
      title={title || undefined}
      {...props}
    >
      {content}
    </span>
  );
}
