import { useEffect, useRef, useState } from "react";
import { OwnerAvatar } from "./OwnerAvatar";

const BellIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
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
  userName = "",
  role = "",
  roleProvisional = false,
  inboxUnreadCount = 0,
  inboxOpen = false,
  onToggleInbox,
  showInbox = false,
  onSignOut,
  onOpenSettings,
  onOpenCapabilities,
}) {
  const displayName = prettyName(userName || userEmail);
  const displayRole = prettyRole(role);
  const avatarLabel = userName || displayName || userEmail;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="gh-user-chip" ref={menuRef}>
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
          {/* Unread dot only when there's a real unread count. Previously the
              dot rendered always "to match the mockup" — that read as a fake
              live-signal, which is exactly the kind of cosmetic-for-cosmetic's-
              sake copy the Tranche C cleanup removes elsewhere. */}
          {inboxUnreadCount > 0 ? (
            <span aria-hidden="true" className="gh-user-chip-bell-dot">
              {inboxUnreadCount > 9 ? "9+" : inboxUnreadCount}
            </span>
          ) : null}
        </button>
      ) : null}
      {/* Avatar BEFORE the name — matches the mockup silhouette. The wrapping
          button opens the identity menu so the chip is keyboard-reachable. */}
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={`Open profile menu for ${displayName}${roleProvisional ? ". Role verification pending." : ""}`}
        className="gh-user-chip-trigger"
        onClick={() => setMenuOpen((current) => !current)}
        type="button"
      >
        <OwnerAvatar owner={avatarLabel} size={42} className="gh-user-chip-avatar" />
        {/* Chevron signals this is a dropdown trigger — operator 2026-04-19
            flagged the missing disclosure cue next to the name. */}
        <span
          className={`gh-user-chip-caret ${menuOpen ? "is-open" : ""}`.trim()}
          aria-hidden="true"
        >
          <ChevronDownIcon />
        </span>
      </button>
      {menuOpen ? (
        <div className="gh-user-chip-menu" role="menu">
          <div className="gh-user-chip-menu-header">
            <div className="gh-user-chip-menu-name">{displayName}</div>
            <div className="gh-user-chip-menu-email">{userEmail || "Workspace user"}</div>
            {roleProvisional ? (
              <div className="gh-user-chip-menu-email">Role verification pending.</div>
            ) : null}
          </div>
          {onOpenSettings ? (
            <button
              className="gh-user-chip-menu-item"
              onClick={() => { setMenuOpen(false); onOpenSettings(); }}
              role="menuitem"
              type="button"
            >
              Settings &amp; diagnostics
            </button>
          ) : null}
          {onOpenCapabilities ? (
            <button
              className="gh-user-chip-menu-item"
              onClick={() => { setMenuOpen(false); onOpenCapabilities(); }}
              role="menuitem"
              type="button"
            >
              Capability dashboard
            </button>
          ) : null}
          {onSignOut ? (
            <button
              className="gh-user-chip-menu-item"
              onClick={() => { setMenuOpen(false); onSignOut(); }}
              role="menuitem"
              type="button"
            >
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default UserChip;
