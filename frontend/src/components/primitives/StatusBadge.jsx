function classes(...values) {
  return values.filter(Boolean).join(" ");
}

const TONE_LABELS = {
  good: "healthy",
  warn: "attention",
  bad: "issue",
  neutral: "status",
};

export function StatusBadge({
  tone = "neutral",
  label = "",
  title = "",
  ariaLabel = "",
  className = "",
  children = null,
  ...props
}) {
  const resolvedLabel = label || (typeof children === "string" ? children : "");
  const toneClass = `tone-${tone}`;
  const resolvedAriaLabel =
    ariaLabel ||
    (resolvedLabel
      ? `${TONE_LABELS[tone] || "status"}: ${resolvedLabel}`
      : TONE_LABELS[tone] || "status");

  return (
    <span
      aria-label={resolvedAriaLabel}
      className={classes("gh-status-chip", toneClass, className)}
      role="status"
      title={title || undefined}
      {...props}
    >
      {children ?? label}
    </span>
  );
}
