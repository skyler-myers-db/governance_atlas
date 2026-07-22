/*
 * surfaces/evidence/evidenceFormat.js — pure helpers for the Evidence
 * surface (Wave C5). Ported verbatim-in-spirit from the deleted
 * components/AuditBrowserWorkspace.jsx: every hard-won honesty rule
 * (stable AUD ids, no client-side row suppression, UTC-only rendering,
 * "—" for genuinely-absent diff values, counted exclusions, truncation
 * warnings riding in exports) survives here as data, not JSX.
 */

export function text(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function metricValue(value) {
  const number = numberOrNull(value);
  return number == null ? "Unavailable" : number.toLocaleString();
}

export function normalizeEnum(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

export function displayLabel(value, fallback = "Unavailable") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function eventDisplayLabel(value) {
  const label = displayLabel(value);
  return label ? `${label.slice(0, 1)}${label.slice(1).toLowerCase()}` : label;
}

export function statusTone(value) {
  const normalized = normalizeEnum(value);
  if (["success", "succeeded", "approved", "complete", "passed"].includes(normalized)) return "good";
  if (["failed", "error", "errored", "rejected"].includes(normalized)) return "bad";
  if (["pending", "draft", "warning", "partial"].includes(normalized)) return "warn";
  return "muted";
}

export function actionTone(value) {
  const normalized = normalizeEnum(value);
  if (normalized.includes("approved")) return "good";
  if (normalized.includes("failed") || normalized.includes("rejected")) return "bad";
  if (normalized.includes("policy")) return "info";
  return "muted";
}

/** Severity buckets from the quality service (normalize_severity_level). */
export function severityTone(level) {
  const normalized = normalizeEnum(level);
  if (normalized === "high") return "bad";
  if (normalized === "medium") return "warn";
  if (normalized === "informational") return "info";
  return "muted";
}

export function outcomeTone(value) {
  const normalized = normalizeEnum(value);
  if (normalized === "passed") return "good";
  if (normalized === "failed" || normalized === "errored") return "bad";
  if (normalized === "skipped") return "muted";
  return "muted";
}

/** Always UTC: Evidence is a compliance surface; browser-local rendering
 * contradicted the "Time (UTC)" column header. */
export function compactDateTime(value) {
  const raw = text(value);
  if (!raw) return "Unavailable";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/** Date-only UTC form for backlog aging captions ("May 5, 2026"). */
export function compactDate(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Compact ISO-style table timestamp (UTC, seconds precision). */
export function tableTimestamp(value) {
  const raw = text(value);
  if (!raw) return "Unavailable";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function rangeNoun(range) {
  const nouns = {
    "24h": "24 hours",
    "7d": "7 days",
    "30d": "30 days",
    "90d": "90 days",
    all: "all recorded runs",
  };
  return nouns[range] || range;
}

/* ------------------------------------------------------------------ */
/* Audit event normalization                                            */
/* ------------------------------------------------------------------ */

// Full UUID-style evidence ids overflow the evidence rail; render a stable
// GOV-<first 8 hex> short form and keep the full id on title/copy paths.
export function shortEvidenceId(value) {
  const raw = text(value);
  if (!/^[0-9a-f][0-9a-f-]{15,}$/i.test(raw)) return raw;
  const hex = raw.replace(/[^0-9a-f]/gi, "");
  if (hex.length < 8) return raw;
  return `GOV-${hex.slice(0, 8).toLowerCase()}`;
}

// Cosmetic label rewrite only. Row SUPPRESSION on content markers was removed
// long ago: an actor merely writing "mock" in a comment must never silently
// delete a real audit event. Server-side counted exclusion is the only filter.
export function sanitizeCustomerEvidenceText(value) {
  const raw = text(value);
  if (!raw) return raw;
  return raw
    .replace(/GOV-HOME-EVIDENCE-request-(\d+)/gi, (_, ordinal) => `GOV-${String(Number(ordinal)).padStart(2, "0")}`)
    .replace(/GOV-HOME-EVIDENCE-audit-(\d+)/gi, (_, ordinal) => `AUD-${String(Number(ordinal)).padStart(2, "0")}`)
    .replace(/\bga-taxonomy-node-[a-z0-9-]+\b/gi, "Glossary parent record");
}

function eventId(event, index = 0) {
  return (
    text(event?.audit_id || event?.auditId || event?.id) ||
    `${text(event?.created_at || event?.createdAt) || "audit"}-${index}`
  );
}

function inferDomain(value) {
  const raw = text(value);
  if (!raw) return "Unassigned";
  const parts = raw.split(".");
  if (parts.length >= 2) return displayLabel(parts[1]);
  if (/customer/i.test(raw)) return "Customer";
  if (/finance|revenue|lien|payment/i.test(raw)) return "Finance";
  if (/policy|risk/i.test(raw)) return "Risk";
  return "Unassigned";
}

export function normalizeEvent(event, index = 0) {
  const value = event && typeof event === "object" ? event : {};
  const id = eventId(value, index);
  const entityFqn = text(value.entity_fqn || value.entityFqn);
  const entityId = text(value.entity_id || value.entityId || value.objectId);
  const entityType = text(value.entity_type || value.entityType || value.kind || "Audit object");
  const actor = text(value.actor_email || value.actorEmail || value.created_by || value.createdBy);
  const requestId = text(value.request_id || value.requestId);
  const displayRequestId = text(value.display_request_id || value.displayRequestId || requestId);
  // Stable identity contract: the backend derives displayAuditId from the
  // real event UUID (AUD-<first 8 hex>) and ships the full UUID as
  // auditEventId. NO positional fallback — a client-invented AUD-<index> id
  // changed with every filter and broke cross-surface joins.
  const displayAuditId = text(
    value.display_audit_id || value.displayAuditId || value.audit_id || value.auditId || value.id,
  );
  const auditEventId = text(value.auditEventId || value.audit_event_id || value.audit_id || value.auditId);
  const createdAt = text(value.created_at || value.createdAt);
  return {
    ...value,
    id,
    displayAuditId,
    auditEventId,
    displayRequestId,
    actor,
    actorRole: text(value.actor_role || value.actorRole || "Audit actor"),
    entityFqn,
    entityId,
    entityType,
    objectLabel: sanitizeCustomerEvidenceText(
      text(value.object_label || value.objectLabel) || entityFqn || entityId || "Unavailable object",
    ),
    action: sanitizeCustomerEvidenceText(text(value.action) || "change recorded"),
    source: sanitizeCustomerEvidenceText(
      text(value.display_source || value.displaySource || value.source) || "Evidence source unavailable",
    ),
    status: text(value.status) || "unavailable",
    requestId,
    detail: sanitizeCustomerEvidenceText(text(value.display_detail || value.displayDetail || value.detail)),
    createdAt,
    beforeJson: value.before_json ?? value.beforeJson ?? value.before ?? "",
    afterJson: value.after_json ?? value.afterJson ?? value.after ?? "",
    domain: text(value.domain) || inferDomain(entityFqn || entityId),
  };
}

export function filterByText(item, query, keys) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return keys.some((key) => text(item[key]).toLowerCase().includes(needle));
}

// Service-actor identity for the "Services" chip. The audit payload does not
// carry an actorKind field yet, so match the REAL service principals observed
// on this estate plus conventional service prefixes.
export function isServiceActor(actor) {
  const value = text(actor).toLowerCase();
  if (!value) return false;
  if (/^(?:svc-|bot[-._]|service[-._@])/.test(value)) return true;
  return /^(?:metadata\.quality|taxonomy\.curator|quality\.runner|governance\.sweeper)@/.test(value);
}

export function isViolationEvent(event) {
  return /violation|failed|exception/i.test(`${event.action} ${event.status} ${event.detail}`);
}

/* ------------------------------------------------------------------ */
/* Diff viewer                                                          */
/* ------------------------------------------------------------------ */

function parseJsonValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return String(value);
  }
}

function isInternalAuditField(key) {
  return /(^|\.|_)(before_json|after_json|beforeJson|afterJson|diff_before_json|diff_after_json|requested_payload_json|actor_entry_id|assignee_entry_id|reviewer_entry_id|entry_id|uc_full_name|identity_key|row_hash)$/i.test(
    String(key || ""),
  );
}

function flattenObject(value, prefix = "", rows = []) {
  if (rows.length >= 48) return rows;
  if (value == null) {
    if (prefix) rows.push([prefix, ""]);
    return rows;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      rows.push([prefix || "value", "[]"]);
      return rows;
    }
    value.slice(0, 4).forEach((item, index) => flattenObject(item, `${prefix}[${index}]`, rows));
    if (value.length > 4) rows.push([prefix || "items", `+${value.length - 4} more`]);
    return rows;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([key]) => !isInternalAuditField(prefix ? `${prefix}.${key}` : key));
    if (!entries.length && prefix) rows.push([prefix, "{}"]);
    entries.slice(0, 12).forEach(([key, nested]) => flattenObject(nested, prefix ? `${prefix}.${key}` : key, rows));
    if (entries.length > 12) rows.push([prefix || "fields", `+${entries.length - 12} more`]);
    return rows;
  }
  rows.push([prefix || "value", String(value)]);
  return rows;
}

export function diffRows(beforeValue, afterValue) {
  const before = new Map(flattenObject(parseJsonValue(beforeValue)));
  const after = new Map(flattenObject(parseJsonValue(afterValue)));
  const keys = Array.from(new Set([...before.keys(), ...after.keys()]));
  return keys
    .filter((key) => (before.get(key) || "") !== (after.get(key) || ""))
    .slice(0, 8)
    .map((key) => ({
      key,
      // "—" not "Unavailable": a creation event legitimately HAS no prior
      // value — labeling that "Unavailable" implied missing evidence.
      before: before.get(key) || "—",
      after: after.get(key) || "—",
    }));
}

/* ------------------------------------------------------------------ */
/* Exports (CSV + JSON report)                                          */
/* ------------------------------------------------------------------ */

export function evidenceReference(event = {}) {
  const parts = [
    event.displayRequestId ? `Evidence ${shortEvidenceId(event.displayRequestId)}` : "",
    event.source || event.detail || "Evidence reference unavailable",
  ].filter(Boolean);
  return parts.join(" · ");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function auditCsv(events, provenance = {}) {
  const header = [
    "time_utc",
    "actor",
    "action",
    "status",
    "target",
    "evidence",
    "evidence_id",
    // Stable identity contract: audit_id is the display form (AUD-<8 hex of
    // the event UUID>) and audit_event_id is the full backing UUID so
    // exported rows stay joinable across surfaces and re-exports.
    "audit_id",
    "audit_event_id",
    "evidence_kind",
    "authoritative",
    "runtime_authoritative",
    "live_databricks_evidence",
    "evidence_boundary",
    "window_truncated",
    "truncation_warning",
  ];
  const rows = events.map((event) => [
    event.createdAt,
    event.actor,
    event.action,
    event.status,
    event.objectLabel,
    evidenceReference(event),
    event.displayRequestId || event.displayAuditId,
    event.displayAuditId,
    event.auditEventId,
    provenance.evidenceKind || "unavailable",
    provenance.authoritative ? "true" : "false",
    provenance.runtimeAuthoritative ? "true" : "false",
    provenance.liveDatabricksEvidence ? "true" : "false",
    provenance.evidenceBoundary || "unavailable",
    provenance.windowTruncated ? "true" : "false",
    provenance.truncationWarning || "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function auditReportEvent(event, provenance = {}) {
  return {
    auditId: event.displayAuditId || event.id,
    // Full backing event UUID — keeps report rows joinable with the audit
    // table and other surfaces (same identity contract as the CSV export).
    auditEventId: event.auditEventId || null,
    occurredAt: event.createdAt || "unavailable",
    actor: event.actor || "unavailable",
    actorRole: event.actorRole || "unavailable",
    action: eventDisplayLabel(event.action) || "Change Recorded",
    status: displayLabel(event.status),
    target: event.objectLabel || "unavailable",
    targetType: event.entityType || "unavailable",
    evidenceId: event.displayRequestId || event.displayAuditId || null,
    evidence: evidenceReference(event),
    detail: event.detail || "No detail recorded",
    authoritative: Boolean(provenance.authoritative),
    runtimeAuthoritative: Boolean(provenance.runtimeAuthoritative),
    liveDatabricksEvidence: Boolean(provenance.liveDatabricksEvidence),
    evidenceKind: provenance.evidenceKind || "unavailable",
    evidenceSource: provenance.source || "unavailable",
    evidenceBoundary: provenance.evidenceBoundary || "unavailable",
  };
}

export function downloadText(filename, textBody, mimeType) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const blob = new Blob([textBody], { type: mimeType });
  const urlFactory = window.URL || window.webkitURL;
  if (!urlFactory?.createObjectURL) return false;
  const url = urlFactory.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  urlFactory.revokeObjectURL?.(url);
  return true;
}

export function isDeployedDatabricksAppHost() {
  if (typeof window === "undefined") return false;
  const host = String(window.location?.hostname || "").toLowerCase();
  return host.endsWith(".databricksapps.com");
}

/* ------------------------------------------------------------------ */
/* Access + errors                                                      */
/* ------------------------------------------------------------------ */

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

/** The /api/audit/* endpoints are steward/admin gated; mirror that client-side
 * so a reader shell never even issues the request. */
export function auditRoleAllowed(shell) {
  if (!shell) return true;
  const email = roleSlug(shell.userEmail || shell.actorEmail);
  if (!email || email === "unknown") return false;
  const role = roleSlug(shell.role || shell.actorRole);
  if (!role) return Boolean(shell.roleProvisional);
  return role.includes("admin") || role.includes("steward");
}
