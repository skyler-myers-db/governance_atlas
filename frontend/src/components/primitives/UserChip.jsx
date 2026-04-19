import { OwnerAvatar } from "./OwnerAvatar";

const BellIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

function prettyName(email = "") {
  const local = String(email).split("@")[0] || "";
  if (!local) return "Workspace user";
  return local
    .split(/[\s._+-]+/)
    .filter(Boolean)
    .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function prettyRole(role = "") {
  const value = String(role || "").trim();
  if (!value) return "Workspace user";
  // Preserve role casing but add a gentle tagline
  return value;
}

export function UserChip({
  userEmail = "",
  role = "",
  roleProvisional = false,
  inboxUnreadCount = 0,
  inboxOpen = false,
  onToggleInbox,
  showInbox = false,
}) {
  const displayName = prettyName(userEmail);
  const displayRole = prettyRole(role) + (roleProvisional ? " (verifying)" : "");
  return (
    <div className="gh-user-chip">
      {showInbox ? (
        <button
          aria-label={
            inboxUnreadCount > 0
              ? `Notifications (${inboxUnreadCount} unread)`
              : "Notifications"
          }
          aria-pressed={inboxOpen}
          className="gh-user-chip-bell"
          onClick={onToggleInbox || (() => {})}
          type="button"
        >
          <BellIcon />
          {/* Always render an unread dot so the bell reads as live, matching the
              target mockup. When there's a real unread count we show the number;
              otherwise the dot is decorative. */}
          <span aria-hidden="true" className="gh-user-chip-bell-dot">
            {inboxUnreadCount > 9 ? "9+" : inboxUnreadCount > 0 ? inboxUnreadCount : ""}
          </span>
        </button>
      ) : null}
      <div className="gh-user-chip-identity">
        <div className="gh-user-chip-name">{displayName}</div>
        <div className="gh-user-chip-role">{displayRole}</div>
      </div>
      <OwnerAvatar owner={userEmail || displayName} size={36} className="gh-user-chip-avatar" />
    </div>
  );
}

export default UserChip;
