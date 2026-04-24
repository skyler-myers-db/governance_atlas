export function statusTone(bootState) {
  if (bootState === "unavailable" || bootState === "error") return "bad";
  return "neutral";
}

export function statusLabel(bootState) {
  if (bootState === "unavailable" || bootState === "error") return "Unavailable";
  return "Live";
}

export function humanizeStatusLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function setupStatusTone(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "blocked" || normalized === "unavailable") return "bad";
  if (normalized === "attention_required" || normalized === "unknown") return "warn";
  if (normalized === "ready") return "good";
  return "neutral";
}

export function setupStatusLabel(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "blocked") return "Setup blocked";
  if (normalized === "attention_required") return "Setup attention";
  if (normalized === "unavailable") return "Setup unavailable";
  if (normalized === "unknown") return "Setup unknown";
  if (normalized === "ready") return "Setup ready";
  return "Workspace setup";
}

export function inboxStatusTone(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "unavailable") return "bad";
  if (normalized === "degraded" || normalized === "attention_required") return "warn";
  if (normalized === "ready" || normalized === "available") return "good";
  return "neutral";
}

export function inboxStatusLabel(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "ready" || normalized === "available") return "Inbox ready";
  if (normalized === "degraded") return "Inbox degraded";
  if (normalized === "unavailable") return "Inbox unavailable";
  if (normalized === "attention_required") return "Inbox attention";
  return "Inbox";
}
