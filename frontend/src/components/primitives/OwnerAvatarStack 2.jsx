/**
 * OwnerAvatarStack — small circular avatars stacked with overlap.
 *
 * Generates initials from owner.email (or owner.name), assigns a stable
 * background color per person via a small hash, and caps the stack at
 * `max`, showing "+N" for the remainder. Used in the Entity hero and
 * anywhere else ownership needs a visual signal.
 */

const PALETTE = [
  { bg: "#eef2ff", fg: "#4338ca" },
  { bg: "#ecfeff", fg: "#155e75" },
  { bg: "#f0fdfa", fg: "#115e59" },
  { bg: "#fef3c7", fg: "#92400e" },
  { bg: "#fff7ed", fg: "#9a3412" },
  { bg: "#fdf4ff", fg: "#86198f" },
  { bg: "#fef2f2", fg: "#991b1b" },
];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h);
}

function initialsFor(owner) {
  const name = String(owner?.name || "").trim();
  const email = String(owner?.email || owner?.ownerEmail || "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (email) {
    const local = email.split("@")[0] || email;
    const bits = local.split(/[._-]+/).filter(Boolean);
    if (bits.length === 1) return bits[0].slice(0, 2).toUpperCase();
    return (bits[0][0] + bits[1][0]).toUpperCase();
  }
  return "??";
}

function seedFor(owner) {
  return String(owner?.email || owner?.ownerEmail || owner?.name || "anon");
}

export function OwnerAvatarStack({
  owners = [],
  max = 4,
  size = 28,
  className = "",
}) {
  if (!Array.isArray(owners) || owners.length === 0) return null;
  const visible = owners.slice(0, max);
  const overflow = Math.max(0, owners.length - visible.length);

  return (
    <span
      aria-label={`${owners.length} owner${owners.length === 1 ? "" : "s"}`}
      className={`gh-owner-avatar-stack ${className}`.trim()}
      style={{
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {visible.map((owner, idx) => {
        const seed = seedFor(owner);
        const palette = PALETTE[hash(seed) % PALETTE.length];
        const title = owner?.email || owner?.ownerEmail || owner?.name || "Owner";
        return (
          <span
            aria-hidden="true"
            className="gh-owner-avatar"
            key={`${seed}-${idx}`}
            style={{
              alignItems: "center",
              background: palette.bg,
              border: "2px solid #ffffff",
              borderRadius: "50%",
              color: palette.fg,
              display: "inline-flex",
              flex: "0 0 auto",
              fontSize: `${Math.round(size * 0.4)}px`,
              fontWeight: 700,
              height: `${size}px`,
              justifyContent: "center",
              marginLeft: idx === 0 ? 0 : `${-Math.round(size * 0.28)}px`,
              width: `${size}px`,
              zIndex: 10 - idx,
            }}
            title={title}
          >
            {initialsFor(owner)}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          aria-hidden="true"
          className="gh-owner-avatar gh-owner-avatar-overflow"
          style={{
            alignItems: "center",
            background: "#eef3f8",
            border: "2px solid #ffffff",
            borderRadius: "50%",
            color: "#52657d",
            display: "inline-flex",
            flex: "0 0 auto",
            fontSize: `${Math.round(size * 0.38)}px`,
            fontWeight: 700,
            height: `${size}px`,
            justifyContent: "center",
            marginLeft: `${-Math.round(size * 0.28)}px`,
            width: `${size}px`,
          }}
          title={`${overflow} more owner${overflow === 1 ? "" : "s"}`}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
