function classes(...values) {
  return values.filter(Boolean).join(" ");
}

const VARIANT_CLASS = {
  primary: "gh-primary-button",
  secondary: "gh-secondary-button",
  tertiary: "gh-tertiary-button",
  segment: "gh-segment-button",
  subtab: "gh-subtab",
};

export function ActionButton({
  variant = "secondary",
  active = false,
  disabled = false,
  disabledReason = "",
  ariaDescribedBy = "",
  children = null,
  className = "",
  type = "button",
  title = "",
  onClick,
  ...props
}) {
  const variantClass = VARIANT_CLASS[variant] || VARIANT_CLASS.secondary;
  // When disabled for a truthful reason, surface it via title + aria-describedby
  // so the user sees WHY the control is disabled (per plan §2 truthfulness rule).
  const resolvedTitle = disabled && disabledReason ? disabledReason : title || undefined;

  return (
    <button
      aria-describedby={ariaDescribedBy || undefined}
      aria-disabled={disabled || undefined}
      aria-pressed={variant === "segment" || variant === "subtab" ? active : undefined}
      className={classes(variantClass, active && "is-active", className)}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      title={resolvedTitle}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
