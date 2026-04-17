const WORKSPACE_INTENT_KEY = "gh.workspace.intent.v1";

function storageKey(kind, assetFqn = "") {
  if (typeof window === "undefined") {
    return `${WORKSPACE_INTENT_KEY}:${kind}:${assetFqn || "none"}`;
  }
  return `${WORKSPACE_INTENT_KEY}:${window.location.pathname}:${kind}:${assetFqn || "none"}`;
}

export function setWorkspaceIntent(kind, assetFqn, value) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(kind, assetFqn), JSON.stringify({ value }));
  } catch {
    // best-effort only
  }
}

export function peekWorkspaceIntent(kind, assetFqn, fallback = "") {
  if (typeof window === "undefined") return fallback;
  try {
    const key = storageKey(kind, assetFqn);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed?.value || fallback;
  } catch {
    return fallback;
  }
}

export function consumeWorkspaceIntent(kind, assetFqn, fallback = "") {
  if (typeof window === "undefined") return fallback;
  try {
    const key = storageKey(kind, assetFqn);
    const value = peekWorkspaceIntent(kind, assetFqn, fallback);
    window.sessionStorage.removeItem(key);
    return value;
  } catch {
    return fallback;
  }
}
