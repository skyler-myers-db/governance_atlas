/**
 * OwnerAvatar — tiny circular chip showing the owner initials with a
 * deterministic color per email. Matches OpenMetadata's owner glyph
 * density so a row of owners reads as recognizable humans rather than
 * a blob of text.
 */

const PALETTE = [
  { bg: "#eef2ff", fg: "#4f46e5" },
  { bg: "#ecfeff", fg: "#0891b2" },
  { bg: "#f0fdfa", fg: "#0f766e" },
  { bg: "#fffbeb", fg: "#b45309" },
  { bg: "#fdf4ff", fg: "#a21caf" },
  { bg: "#fef3c7", fg: "#92400e" },
  { bg: "#fff7ed", fg: "#c2410c" },
  { bg: "#f0f9ff", fg: "#0369a1" },
  { bg: "#fef2f2", fg: "#b91c1c" },
  { bg: "#f5f3ff", fg: "#6d28d9" },
];

function hashString(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function ownerInitials(label) {
  const raw = String(label || "").trim();
  if (!raw) return "—";
  // email → first letter + first letter after non-alphanum separator
  const local = raw.includes("@") ? raw.split("@")[0] : raw;
  const parts = local.split(/[\s._+-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return raw.slice(0, 2).toUpperCase();
}

export function OwnerAvatar({ owner = "", size = 22, className = "" }) {
  const profile = PALETTE[hashString(owner) % PALETTE.length];
  const initials = ownerInitials(owner);
  return (
    <span
      aria-label={owner || "No owner"}
      className={`gh-owner-avatar ${className}`.trim()}
      role="img"
      style={{
        alignItems: "center",
        background: profile.bg,
        borderRadius: "50%",
        color: profile.fg,
        display: "inline-flex",
        flex: "0 0 auto",
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
        height: `${size}px`,
        justifyContent: "center",
        letterSpacing: "0.01em",
        width: `${size}px`,
      }}
      title={owner || "No owner"}
    >
      {initials}
    </span>
  );
}

export function OwnerAvatarStack({ owners = [], limit = 3, size = 22 }) {
  if (!owners.length) return null;
  const visible = owners.slice(0, limit);
  const extra = owners.length - visible.length;
  return (
    <span className="gh-owner-avatar-stack" aria-label={owners.join(", ")}>
      {visible.map((o, i) => (
        <OwnerAvatar
          key={`${o}-${i}`}
          owner={o}
          size={size}
          className={i > 0 ? "gh-owner-avatar-overlap" : ""}
        />
      ))}
      {extra > 0 ? (
        <span
          aria-hidden="true"
          className="gh-owner-avatar gh-owner-avatar-overflow"
          style={{ width: `${size}px`, height: `${size}px`, fontSize: Math.round(size * 0.38) }}
          title={`+${extra} more`}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
