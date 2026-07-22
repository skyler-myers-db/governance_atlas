/*
 * surfaces/admin/adminPresentation.js — pure presentation helpers for the
 * Control Center surface (Wave C6). Ported from the legacy AdminWorkspace.jsx
 * normalizers so every honesty behavior the persona audits fought for
 * survives the migration verbatim:
 *   - future "last run" timestamps route to "Next run" ("Not yet run" honesty)
 *   - year-carrying, UTC-labeled timestamps (never raw ISO, never local zone)
 *   - job-name hash tails truncate for display, full name kept for title=
 *   - integrations render the backend's rows verbatim (no fabricated slots)
 *   - metadata-scoped coverage rows must SAY they are metadata coverage
 */

export function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function label(value, fallback = "Unavailable") {
  return text(value) || fallback;
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function numberValue(value) {
  const numeric = numberOrNull(value);
  return numeric == null ? "Unavailable" : numeric.toLocaleString();
}

export function percentValue(value) {
  const numeric = numberOrNull(value);
  if (numeric == null) return "Unavailable";
  // App-wide percent convention (matches topbar badge + Command Center):
  // integers stay whole, fractional values keep one decimal — never round
  // 95.5% up to 96% or the same value diverges across surfaces.
  return Number.isInteger(numeric) ? `${numeric.toFixed(0)}%` : `${numeric.toFixed(1)}%`;
}

/**
 * Human-readable timestamp for backend ISO strings, rendered in UTC: every
 * governance surface labels evidence times UTC, and browser-local rendering
 * produced contradictory EDT labels. Unparseable values pass through raw so
 * we never fabricate a date.
 */
export function humanTimestamp(value) {
  const raw = text(value);
  if (!raw) return "Unavailable";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/**
 * A future timestamp under "Last run" is a scheduling artifact, not history —
 * route it to "Next run" and report "Not yet run" honestly. Unparseable
 * relative strings ("4 min ago") pass through untouched as last-run text.
 */
export function splitJobRunTimes(rawLastRun) {
  const raw = text(rawLastRun);
  // Backend contract (persona-audit wave): lastRun is empty ONLY when the
  // job has never run — say so, instead of the ambiguous "Unavailable".
  if (!raw) return { lastRun: "Not yet run", nextRun: "" };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { lastRun: raw, nextRun: "" };
  if (parsed.getTime() > Date.now()) {
    return { lastRun: "Not yet run", nextRun: humanTimestamp(raw) };
  }
  return { lastRun: humanTimestamp(raw), nextRun: "" };
}

// Job names can embed raw run hashes ("[RUNNER] pixels | 0f1f0a3b2a5f…").
// Truncate long hex tails for display; the full name stays on the title attr.
export function compactJobName(name) {
  return text(name).replace(/\b([0-9a-f]{12,})\b/gi, (_match, hash) => `${hash.slice(0, 8)}…`);
}

/** Backend state string → Badge tone. */
export function statusTone(state) {
  const value = text(state).toLowerCase();
  if (["ok", "connected", "available", "healthy", "active", "enabled", "live", "ready", "success"].includes(value)) {
    return "good";
  }
  if (["slow", "degraded", "warning", "warn", "unavailable", "unknown", "loading", "skipped"].includes(value)) {
    return "warn";
  }
  if (["failed", "error", "bad"].includes(value)) return "bad";
  return "muted";
}

export function stateText(state) {
  const value = text(state);
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Unavailable";
}

export function readableState(state = "") {
  const normalized = text(state);
  if (!normalized) return "Unknown";
  return normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

/** Capability-flag availability tone/label (ported from CapabilityDashboard). */
export function toneForAvailability(value, state) {
  if (state === "degraded" || state === "unknown") return "warn";
  if (value === true) return "good";
  if (value === false) return "bad";
  return "neutral";
}

export function availabilityLabel(value, state) {
  if (state === "degraded") return "Degraded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "Unknown";
}

export function responseStatus(error) {
  if (!error || typeof error !== "object") return 0;
  return Number(
    Object.prototype.hasOwnProperty.call(error, "status")
      ? /** @type {{ status?: number | string }} */ (error).status
      : 0,
  );
}

function roleSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Admin gate for the Control Center content. This predicate MUST stay in
 * lockstep with `adminRailAllowed` in app-shell/Rail.jsx (the rail hides the
 * entry with the same rule so it never advertises a surface that will render
 * an access card). It lives here too because dependencies point inward only —
 * a surface may not import from app-shell.
 */
export function adminRoleAllowed(shell) {
  if (!shell) return true;
  const email = roleSlug(shell.userEmail || shell.actorEmail);
  if (!email || email === "unknown") return false;
  const role = roleSlug(shell.role || shell.actorRole);
  if (!role) return Boolean(shell.roleProvisional);
  return role.includes("admin");
}

export function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

/** Does a detail string look like a UC asset FQN (catalog.schema.object…)? */
export function looksLikeAssetFqn(value) {
  return /^[\w$-]+\.[\w$-]+\.[\w$./-]+$/.test(text(value));
}

/* ------------------------------------------------------------------ */
/* Payload normalizers (ported verbatim from AdminWorkspace.jsx)        */
/* ------------------------------------------------------------------ */

export function normalizeJobs(dashboard) {
  const candidates =
    dashboard.scheduledJobs ||
    dashboard.jobs ||
    dashboard.runtimeSummary?.scheduledJobs ||
    dashboard.runtime?.scheduledJobs ||
    [];
  if (!Array.isArray(candidates)) return [];
  return candidates.map((job, index) => {
    const name = label(job.name || job.label || job.job);
    // "Next run" prefers an explicit backend field; otherwise a future
    // timestamp mistakenly shipped as lastRun is rerouted there.
    const split = splitJobRunTimes(job.lastRun || job.last_run || job.relativeTime || job.updatedAt);
    const explicitNextRun = text(job.nextRun || job.next_run);
    return {
      id: label(job.id || job.key || job.name, `job-${index}`),
      name,
      displayName: compactJobName(name),
      schedule: label(job.schedule || job.cron || job.frequency),
      lastRun: split.lastRun,
      nextRun: explicitNextRun ? humanTimestamp(explicitNextRun) : split.nextRun,
      status: label(job.status || job.state, "unavailable"),
      url: text(job.url || job.runUrl || job.jobUrl),
    };
  });
}

// Policy requirement cards (policyRequirements.cards): the backed exceptions
// signal (consistent with the Command Center) plus honest-unavailable
// library/enforcement cards with the API's own reason strings.
export function normalizePolicyCards(dashboard) {
  const cards = Array.isArray(dashboard.policyRequirements?.cards)
    ? dashboard.policyRequirements.cards
    : [];
  return cards.map((card, index) => ({
    id: label(card.key || card.label, `policy-card-${index}`),
    label: label(card.label),
    value: card.value,
    state: text(card.state) || (card.value == null ? "unavailable" : "available"),
    reason: text(card.reason),
  }));
}

export function normalizeIntegrations(dashboard) {
  // The backend's rows ARE the source of truth. The old fixed-slot regex
  // mapping silently DROPPED real backend rows that matched no slot while
  // rendering fabricated "Unavailable" placeholders for products the runtime
  // never probes — the worst kind of trust bug. Rows render verbatim.
  const candidates = Array.isArray(dashboard.integrations) ? dashboard.integrations : [];
  return candidates.map((item, index) => ({
    id: label(item.key || item.id || item.label, `integration-${index}`),
    label: label(item.label || item.name),
    subtitle: label(item.subtitle || item.description || item.reason, "Runtime signal"),
    status: label(item.status || item.state, "unavailable"),
    reason: text(item.reason),
    url: text(item.url || item.configUrl || item.workspaceUrl),
  }));
}

export function normalizeActivity(dashboard) {
  const candidates = Array.isArray(dashboard.recentAdminActivity) ? dashboard.recentAdminActivity : [];
  return candidates.map((row, index) => ({
    id: label(row.id, `activity-${index}`),
    title: label(row.title, "Governance event"),
    detail: text(row.detail),
    createdAt: text(row.createdAt),
    actorEmail: text(row.actorEmail),
    tone: text(row.tone),
    status: text(row.status),
  }));
}

export function normalizePolicies(dashboard) {
  const policy = dashboard.policyCoverage || dashboard.policy || dashboard.policyRequirements || {};
  const candidates = policy.rules || policy.coverage || policy.rows || [];
  if (Array.isArray(candidates) && candidates.length) {
    return candidates.map((item, index) => ({
      id: label(item.key || item.id || item.label || item.name, `policy-${index}`),
      label: label(item.label || item.name || item.domain),
      domain: text(item.domain),
      value: item.value ?? item.coverage ?? item.score,
      coverageKind: text(item.coverageKind),
      note: text(item.reason),
      status: label(item.status || item.state, "unavailable"),
    }));
  }
  const byDomain = Array.isArray(policy.byDomain) ? policy.byDomain : [];
  // byDomain rows carry METADATA coverage (coverageKind: "metadata"), not
  // policy-enforcement coverage — surface the real number and let the panel
  // retitle itself instead of rendering disabled "Unavailable" rows while
  // the payload holds 100/97.8/… in metadataCoverage.
  return byDomain.map((item, index) => {
    const coverage = item.coverage ?? item.metadataCoverage;
    return {
      id: label(item.domain || item.label, `domain-policy-${index}`),
      label: label(item.domain || item.label),
      domain: text(item.domain || item.label),
      value: coverage,
      coverageKind: text(item.coverageKind) || (item.metadataCoverage != null ? "metadata" : ""),
      note: text(item.reason),
      status: coverage === null || coverage === undefined ? "unavailable" : "available",
    };
  });
}

/** Collect every warning surface the control-center payload can carry. */
export function collectWarnings(payload) {
  const dashboard = envelopeData(payload) || {};
  return [
    ...(Array.isArray(payload?.warnings) ? payload.warnings : []),
    ...(Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings : []),
    ...(Array.isArray(dashboard.warnings) ? dashboard.warnings : []),
    ...(Array.isArray(dashboard.meta?.warnings) ? dashboard.meta.warnings : []),
  ].map((warning) => text(warning)).filter(Boolean);
}

/* Truth-check drift formatting (ported from the legacy TruthCheckPanel). */
export function deltaTone(delta) {
  if (delta === 0 || delta === null || delta === undefined) return "muted";
  if (Math.abs(delta) <= 2) return "warn";
  return "bad";
}

export function deltaLabel(delta) {
  if (delta === null || delta === undefined) return "Unavailable";
  const numeric = Number(delta);
  if (!Number.isFinite(numeric)) return "Unavailable";
  if (numeric === 0) return "0";
  return numeric > 0 ? `+${numeric.toLocaleString()}` : numeric.toLocaleString();
}
