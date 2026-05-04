import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditEvidence } from "../lib/api";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
import { EmptyState } from "./northstar";
import "../styles/operations-pages.css";

const PAGE_SIZE_OPTIONS = [8, 12, 20, 50];
const DEFAULT_LIMIT = 200;

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function envelopeMeta(payload) {
  return payload && typeof payload === "object" ? payload.meta || {} : {};
}

function envelopeHydrating(payload) {
  const meta = envelopeMeta(payload);
  const capabilities = meta.capabilities && typeof meta.capabilities === "object" ? meta.capabilities : {};
  return text(meta.state || payload?.state).toLowerCase() === "loading" || capabilities.hydrating === true;
}

function text(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function safeOrdinal(index = 0) {
  return String(Number(index) + 1).padStart(2, "0");
}

function customerSafeEvidenceId(value, index = 0, prefix = "AUD") {
  const raw = text(value);
  if (!raw) return `${prefix}-${safeOrdinal(index)}`;
  const homeMatch = raw.match(/^GOV-HOME-EVIDENCE-(request|audit)-(\d+)$/i);
  if (homeMatch) {
    const safePrefix = homeMatch[1].toLowerCase() === "request" ? "GOV" : "AUD";
    return `${safePrefix}-${String(Number(homeMatch[2])).padStart(2, "0")}`;
  }
  if (/^(ga-home-seed|ga-taxonomy-seed|prototype|mock|fixture|seed)/i.test(raw)) return "";
  if (/GOV-HOME-EVIDENCE/i.test(raw)) return `${prefix}-${safeOrdinal(index)}`;
  return raw;
}

function sanitizeCustomerEvidenceText(value, index = 0) {
  const raw = text(value);
  if (!raw) return raw;
  if (hasNonAuthoritativeAuditMarker(raw)) return "";
  return raw
    .replace(/GOV-HOME-EVIDENCE-request-(\d+)/gi, (_, ordinal) => `GOV-${String(Number(ordinal)).padStart(2, "0")}`)
    .replace(/GOV-HOME-EVIDENCE-audit-(\d+)/gi, (_, ordinal) => `AUD-${String(Number(ordinal)).padStart(2, "0")}`)
    .replace(/\bga-taxonomy-node-[a-z0-9-]+\b/gi, "Glossary parent record")
    .replace(/\bga-home-[a-z0-9-]+\b/gi, `Governance evidence ${safeOrdinal(index)}`);
}

function hasNonAuthoritativeAuditMarker(...values) {
  const haystack = values.map((value) => {
    if (value == null) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (_error) {
        return "";
      }
    }
    return String(value);
  }).join(" ").toLowerCase();
  return /prototype|mock|fixture|validation[_\s-]*seed|validation sample|home[_\s-]*northstar[_\s-]*seed|home[_\s-]*evidence[_\s-]*plane|ga[_\s-]*home[_\s-]*seed|ga[_\s-]*taxonomy[_\s-]*seed/.test(haystack);
}

function isNonAuthoritativeAuditEvent(event = {}) {
  return Boolean(
    hasNonAuthoritativeAuditMarker(event) ||
      isNonAuthoritativeMockEvidence(
        event,
        event?.meta,
        event?.provenance,
        event?.warnings,
      ),
  );
}

function eventId(event, index = 0) {
  return text(event?.audit_id || event?.auditId || event?.id) || `${text(event?.created_at || event?.createdAt) || "audit"}-${index}`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function statusTone(value) {
  const normalized = normalizeStatus(value);
  if (["success", "succeeded", "approved", "complete"].includes(normalized)) return "good";
  if (["failed", "error", "rejected"].includes(normalized)) return "bad";
  if (["pending", "draft", "warning"].includes(normalized)) return "warn";
  return "muted";
}

function actionTone(value) {
  const normalized = normalizeStatus(value);
  if (normalized.includes("approved")) return "good";
  if (normalized.includes("failed") || normalized.includes("rejected")) return "bad";
  if (normalized.includes("policy")) return "info";
  return "muted";
}

function eventDisplayLabel(value) {
  const label = displayLabel(value);
  return label ? `${label.slice(0, 1)}${label.slice(1).toLowerCase()}` : label;
}

function displayLabel(value, fallback = "Unavailable") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactDateTime(value) {
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
    timeZoneName: "short",
  });
}

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
  return /(^|\.|_)(before_json|after_json|beforeJson|afterJson|diff_before_json|diff_after_json|requested_payload_json|actor_entry_id|assignee_entry_id|reviewer_entry_id|entry_id|uc_full_name|identity_key|row_hash)$/i.test(String(key || ""));
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

function diffRows(beforeValue, afterValue) {
  const before = new Map(flattenObject(parseJsonValue(beforeValue)));
  const after = new Map(flattenObject(parseJsonValue(afterValue)));
  const keys = Array.from(new Set([...before.keys(), ...after.keys()]));
  return keys
    .filter((key) => (before.get(key) || "") !== (after.get(key) || ""))
    .slice(0, 8)
    .map((key) => ({
      key,
      before: before.get(key) || "Unavailable",
      after: after.get(key) || "Unavailable",
    }));
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function auditCsv(events, provenance = {}) {
  const header = [
    "time_utc",
    "actor",
    "action",
    "status",
    "target",
    "evidence",
    "evidence_id",
    "evidence_kind",
    "authoritative",
    "runtime_authoritative",
    "live_databricks_evidence",
    "evidence_boundary",
  ];
  const rows = events.map((event) => [
    event.createdAt,
    event.actor,
    event.action,
    event.status,
    event.objectLabel,
    evidenceReference(event),
    event.displayRequestId || event.displayAuditId,
    provenance.evidenceKind || "unavailable",
    provenance.authoritative ? "true" : "false",
    provenance.runtimeAuthoritative ? "true" : "false",
    provenance.liveDatabricksEvidence ? "true" : "false",
    provenance.evidenceBoundary || "unavailable",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function downloadText(filename, textBody, mimeType) {
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

function isDeployedDatabricksAppHost() {
  if (typeof window === "undefined") return false;
  const host = String(window.location?.hostname || "").toLowerCase();
  return host.endsWith(".databricksapps.com");
}

function normalizeEvent(event, index = 0) {
  const value = event && typeof event === "object" ? event : {};
  const id = eventId(value, index);
  const entityFqn = text(value.entity_fqn || value.entityFqn);
  const entityId = text(value.entity_id || value.entityId || value.objectId);
  const entityType = text(value.entity_type || value.entityType || value.kind || "Audit object");
  const actor = text(value.actor_email || value.actorEmail || value.created_by || value.createdBy);
  const requestId = text(value.request_id || value.requestId);
  const displayRequestId = customerSafeEvidenceId(
    value.display_request_id || value.displayRequestId || requestId,
    index,
    "GOV",
  );
  const displayAuditId = customerSafeEvidenceId(
    value.display_audit_id || value.displayAuditId || value.audit_id || value.auditId || value.id,
    index,
    "AUD",
  );
  const createdAt = text(value.created_at || value.createdAt);
  return {
    ...value,
    id,
    displayAuditId,
    displayRequestId,
    actor,
    actorRole: text(value.actor_role || value.actorRole || "Audit actor"),
    entityFqn,
    entityId,
    entityType,
    objectLabel: sanitizeCustomerEvidenceText(text(value.object_label || value.objectLabel) || entityFqn || entityId || "Unavailable object", index),
    action: sanitizeCustomerEvidenceText(text(value.action) || "change recorded", index),
    source: sanitizeCustomerEvidenceText(text(value.display_source || value.displaySource || value.source) || "Evidence source unavailable", index),
    status: text(value.status) || "unavailable",
    requestId,
    detail: sanitizeCustomerEvidenceText(text(value.display_detail || value.displayDetail || value.detail), index),
    createdAt,
    beforeJson: value.before_json ?? value.beforeJson ?? value.before ?? "",
    afterJson: value.after_json ?? value.afterJson ?? value.after ?? "",
    domain: text(value.domain) || inferDomain(entityFqn || entityId),
  };
}

function isInternalMaintenanceEvent(event = {}) {
  const haystack = [
    event.action,
    event.detail,
    event.objectLabel,
    event.entityType,
    event.source,
  ].map(text).join(" ");
  return /identity directory upserted|identity directory|actor_entry_id|assignee_entry_id|reviewer_entry_id/i.test(haystack);
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

function uniqueOptions(items, key) {
  return ["All", ...Array.from(new Set(items.map((item) => item[key]).filter(Boolean))).sort()];
}

function filterByText(item, query, keys) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return keys.some((key) => text(item[key]).toLowerCase().includes(needle));
}

function KpiCard({ icon, label, value, support, tone = "neutral" }) {
  const supportClass = /vs prev|delta/i.test(String(support || "")) ? "gh-audit-kpi-delta" : "";
  return (
    <article className={`gh-audit-kpi is-${tone}`}>
      <div>
        <span aria-hidden="true" className="gh-audit-kpi-icon">{icon}</span>
        <p>{label}</p>
      </div>
      <strong>{value}</strong>
      <small className={supportClass}>{support}</small>
    </article>
  );
}

function Field({ label, children }) {
  return (
    <label className="gh-audit-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function AuditStatus({ status }) {
  const tone = statusTone(status);
  return <span className={`gh-audit-status is-${tone}`}><i />{displayLabel(status)}</span>;
}

function ActionBadge({ action }) {
  return <span className={`gh-audit-action is-${actionTone(action)}`}><i aria-hidden="true" />{eventDisplayLabel(action)}</span>;
}

function Unavailable({ children }) {
  return <p className="gh-audit-unavailable">{children}</p>;
}

function responseStatus(error) {
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

function auditRoleAllowed(shell) {
  if (!shell) return true;
  const email = roleSlug(shell.userEmail || shell.actorEmail);
  if (!email || email === "unknown") return false;
  const role = roleSlug(shell.role || shell.actorRole);
  if (!role) return Boolean(shell.roleProvisional);
  return role.includes("admin") || role.includes("steward");
}

function evidenceReference(event = {}) {
  return auditEvidenceSummary(event);
}

function auditEvidenceSummary(event = {}) {
  const parts = [
    event.displayRequestId ? `Evidence ${event.displayRequestId}` : "",
    event.source || event.detail || "Evidence reference unavailable",
  ].filter(Boolean);
  return parts.join(" · ");
}

function auditReportEvent(event, provenance = {}) {
  return {
    auditId: event.displayAuditId || event.id,
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

function AuditActionIcon({ name }) {
  const paths = {
    filter: (
      <>
        <path d="M4 5h16" />
        <path d="M7 12h10" />
        <path d="M10 19h4" />
      </>
    ),
    report: (
      <>
        <path d="M7 4h7l3 3v13H7z" />
        <path d="M14 4v4h4" />
        <path d="M9 12h6" />
        <path d="M9 16h5" />
      </>
    ),
    download: (
      <>
        <path d="M12 4v10" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 20h14" />
      </>
    ),
    service: (
      <>
        <path d="M12 8v8" />
        <path d="M8 12h8" />
        <circle cx="12" cy="12" r="6" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6 20c.9-4 3-6 6-6s5.1 2 6 6" />
      </>
    ),
    external: (
      <>
        <path d="M7 17 17 7" />
        <path d="M10 7h7v7" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 19 6v5c0 4.3-2.4 7.7-7 10-4.6-2.3-7-5.7-7-10V6z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || paths.report}
    </svg>
  );
}

function ActorMark({ actor }) {
  return <AuditActionIcon name={/^svc-|bot|service/i.test(text(actor)) ? "service" : "user"} />;
}

/**
 * @param {{ onOpenAsset?: (assetFqn: string, nextTab?: string) => void, shell?: Record<string, any> | null }} props
 */
export default function AuditBrowserWorkspace({ onOpenAsset = undefined, shell = null } = {}) {
  const [selectedId, setSelectedId] = useState("");
  const [activeFilter, setActiveFilter] = useState("All events");
  const [dateRange, setDateRange] = useState("24h");
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [status, setStatus] = useState("");

  const canReadAudit = auditRoleAllowed(shell);
  const query = useQuery({
    queryKey: ["atlas", "audit-evidence", dateRange, DEFAULT_LIMIT],
    queryFn: ({ signal }) => fetchAuditEvidence({ dateRange, limit: DEFAULT_LIMIT, signal }),
    enabled: canReadAudit,
    placeholderData: (previousData) => previousData,
    refetchInterval: (currentQuery) => envelopeHydrating(currentQuery?.state?.data) ? 3_000 : false,
    retry: false,
    staleTime: 60_000,
  });

  const rawPayload = envelopeData(query.data) || {};
  const rawMeta = envelopeMeta(query.data);
  const nonAuthoritativeAuditPayload = isNonAuthoritativeMockEvidence(
    query.data,
    rawPayload,
    rawPayload?.summary,
    rawMeta,
  );
  const payload = nonAuthoritativeAuditPayload ? {} : rawPayload;
  const meta = nonAuthoritativeAuditPayload ? {} : rawMeta;
  const events = useMemo(
    () => (Array.isArray(payload.events) ? payload.events : [])
      .filter((event) => !isNonAuthoritativeAuditEvent(event))
      .map(normalizeEvent)
      .filter((event) => !isInternalMaintenanceEvent(event)),
    [payload.events],
  );
  const summary = payload.summary || {};
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (activeFilter === "Violations") return /violation|failed|exception/i.test(`${event.action} ${event.status} ${event.detail}`);
      if (activeFilter === "By users") return !/^svc-|bot|service/i.test(event.actor);
      if (activeFilter === "By services") return /^svc-|bot|service/i.test(event.actor);
      return true;
    });
  }, [activeFilter, events]);

  const pageRows = filteredEvents.slice(0, 8);
  const selectedInFiltered = selectedId ? filteredEvents.find((event) => event.id === selectedId) : null;
  const selected = selectedInFiltered || filteredEvents.find((event) => event.entityFqn && event.requestId) || null;

  useEffect(() => {
    if (!filteredEvents.length) {
      setSelectedId("");
      return;
    }
    if (selectedId && !filteredEvents.some((event) => event.id === selectedId)) {
      setSelectedId("");
    }
  }, [filteredEvents, selectedId]);

  const loading = canReadAudit && query.isLoading;
  const queryError = canReadAudit ? query.error?.message || "" : "Audit trail requires steward or admin permissions.";
  const forbidden = !canReadAudit || responseStatus(query.error) === 403;
  const events24h = numberOrNull(summary.events24h ?? summary.totalChanges);
  const policyViolations = numberOrNull(summary.policyViolations ?? summary.failedActions);
  const accessReviews = numberOrNull(summary.accessReviewsOpen ?? summary.approvals);
  const retentionYears = numberOrNull(summary.retentionYears);
  const auditSource = text(
    summary.sourceTable ||
      summary.auditTable ||
      summary.source ||
      payload.sourceTable ||
      payload.source ||
      meta?.source,
  );
  const degradedEvidence =
    (
      meta?.authoritative === false ||
      meta?.degraded === true ||
      ["degraded", "warning", "unavailable", "error"].includes(String(meta?.state || "").trim().toLowerCase()) ||
      (Array.isArray(meta?.warnings) && meta.warnings.length > 0)
    );
  const authoritativeEvidence =
    !degradedEvidence &&
    Boolean(auditSource) &&
    (meta?.authoritative === true || payload.authoritative === true || summary.authoritative === true);
  const evidenceKind = authoritativeEvidence ? "runtime_evidence" : (auditSource ? "degraded" : "unavailable");
  const deployedDatabricksAppEvidence = authoritativeEvidence && isDeployedDatabricksAppHost();
  const closureAuthoritativeEvidence = authoritativeEvidence && deployedDatabricksAppEvidence;
  const evidenceBoundary = deployedDatabricksAppEvidence ? "deployed-databricks-app" : "local-runtime";
  const auditEvidenceNote = text(
    summary.evidenceNote ||
      summary.auditEvidenceNote ||
      payload.evidenceNote ||
      payload.auditEvidenceNote,
    auditSource
      ? `Append-only Delta audit log ${auditSource} · time-travel evidence references only, no raw row values.`
      : `Audit evidence source unavailable · ${dateRange} scope`,
  );
  const retentionSupport = retentionYears == null
    ? "Retention policy not reported"
    : text(summary.retentionNote || summary.retentionSource, "Retention reported by audit API");
  const eventSupport = text(
    summary.eventsDeltaText ||
      summary.eventsSupport ||
      summary.eventsSource ||
      summary.summarySource ||
      meta?.source,
    events24h == null ? "No scoped event summary reported; showing loaded rows" : "Event summary source unavailable",
  );
  const policySupport = text(
    summary.policyViolationsDeltaText ||
      summary.policyViolationsSupport ||
      summary.policySource ||
      summary.summarySource,
    "Policy summary unavailable unless reported by audit API",
  );
  const accessSupport = text(
    summary.accessReviewsDeltaText ||
      summary.accessReviewsSupport ||
      summary.accessReviewSource ||
      summary.summarySource,
    "Access review summary unavailable unless reported by audit API",
  );
  const auditSummaryUnavailable =
    events24h == null &&
    (degradedEvidence || meta?.degraded === true || payload?.degraded === true || summary?.degraded === true);
  const scopedEventMetric = events24h ?? null;
  const eventsMetricLabel = `Events · ${dateRange}`;
  const filters = [
    ["All events", events.length],
    ["By users", events.filter((event) => !/^svc-|bot|service/i.test(event.actor)).length],
    ["By services", events.filter((event) => /^svc-|bot|service/i.test(event.actor)).length],
    ["Violations", events.filter((event) => /violation|failed|exception/i.test(`${event.action} ${event.status} ${event.detail}`)).length],
  ];
  const dateRanges = ["24h", "7d", "30d", "90d"];
  const auditExportUnavailableReason = loading
    ? "Audit export unavailable while audit rows are still loading."
    : "Audit export unavailable because no audit rows match the current filter.";
  const auditExportDisabled = loading || !filteredEvents.length;
  const selectDateRange = (nextRange) => {
    setDateRange(nextRange);
    setDateMenuOpen(false);
    setStatus(`Audit date range set to ${nextRange}.`);
  };
  const exportCsv = () => {
    if (!filteredEvents.length) {
      setStatus("CSV export unavailable because no audit rows match the current filter.");
      return;
    }
    const ok = downloadText(
      `governance-audit-${dateRange}.csv`,
      auditCsv(filteredEvents, {
        authoritative: closureAuthoritativeEvidence,
        runtimeAuthoritative: authoritativeEvidence,
        evidenceKind,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
      }),
      "text/csv;charset=utf-8",
    );
    setStatus(ok
      ? `CSV export prepared with ${filteredEvents.length} audit rows and ${evidenceKind} provenance.`
      : "CSV export prepared, but this browser cannot start downloads in the current session.");
  };
  const generateReport = () => {
    if (!filteredEvents.length) {
      setStatus("Report unavailable because no audit rows match the current filter.");
      return;
    }
    const report = {
      generatedAt: new Date().toISOString(),
      dateRange,
      source: auditSource || "unavailable",
      authoritative: closureAuthoritativeEvidence,
      evidenceKind,
      databricksBackedRuntime: authoritativeEvidence,
      runtimeAuthoritative: authoritativeEvidence,
      liveDatabricksEvidence: deployedDatabricksAppEvidence,
      closureEvidence: closureAuthoritativeEvidence,
      evidenceBoundary,
      warning: deployedDatabricksAppEvidence
        ? ""
        : "This report was generated from the local runtime boundary and is not deployed Databricks App closure evidence.",
      summary: {
        events: filteredEvents.length,
        policyViolations: policyViolations ?? null,
        accessReviewsOpen: accessReviews ?? null,
        retentionYears: retentionYears ?? null,
        authoritative: closureAuthoritativeEvidence,
        evidenceKind,
        source: auditSource || "unavailable",
        databricksBackedRuntime: authoritativeEvidence,
        runtimeAuthoritative: authoritativeEvidence,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        closureEvidence: closureAuthoritativeEvidence,
        evidenceBoundary,
      },
      events: filteredEvents.slice(0, 25).map((event) => auditReportEvent(event, {
        authoritative: closureAuthoritativeEvidence,
        runtimeAuthoritative: authoritativeEvidence,
        evidenceKind,
        source: auditSource || "unavailable",
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
      })),
    };
    const ok = downloadText(
      `governance-audit-report-${dateRange}.json`,
      JSON.stringify(report, null, 2),
      "application/json;charset=utf-8",
    );
    setStatus(ok
      ? `Audit report generated from ${filteredEvents.length} visible evidence rows with ${evidenceKind} provenance.`
      : "Audit report generated, but this browser cannot start downloads in the current session.");
  };
  const openSelectedAsset = () => {
    if (!selected?.entityFqn || !onOpenAsset) {
      setStatus("Open asset unavailable because this audit row has no backed asset route.");
      return;
    }
    onOpenAsset(selected.entityFqn);
  };
  const copySelectedEvidenceId = async () => {
    const evidenceId = selected?.displayRequestId || selected?.displayAuditId || "";
    if (!evidenceId) {
      setStatus("Evidence ID unavailable for this audit row.");
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(evidenceId);
      }
      setStatus(`Evidence ID ${evidenceId} copied.`);
    } catch {
      setStatus(`Evidence ID ${evidenceId} selected for review.`);
    }
  };

  return (
    <section className="ga-page gh-audit-ns" data-testid="audit-northstar">
      <div className="gh-audit-shell">
        <main className="gh-audit-main gh-audit-prototype">
          <header className="gh-audit-hero gh-audit-prototype-hero">
            <div>
              <span className="gh-prototype-eyebrow">Audit Evidence</span>
              <h1>Immutable governance event log</h1>
	              <p>
	                {queryError
	                  ? "Audit evidence is unavailable for this workspace. The evidence log structure remains visible so exports, filters, and retention state can fail closed."
                  : "Governance Atlas records backed metadata workflow events in a searchable Delta audit log. Export and retention controls stay unavailable until the runtime reports those capabilities."}
	              </p>
            </div>
            <div className="gh-audit-prototype-actions">
              <div className="gh-audit-menu-wrap">
                <button
                  aria-expanded={dateMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setDateMenuOpen((open) => !open)}
                  type="button"
                >
                  <AuditActionIcon name="filter" />
                  <span>Date range</span>
                </button>
                {dateMenuOpen ? (
                  <div className="gh-audit-menu" role="menu">
                    {dateRanges.map((range) => (
                      <button
                        aria-checked={dateRange === range}
                        className={dateRange === range ? "is-active" : ""}
                        key={range}
                        onClick={() => selectDateRange(range)}
                        role="menuitemradio"
                        type="button"
                      >
                        <span>{range}</span>
                        <small>{range === "24h" ? "Last 24 hours" : `Last ${range}`}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                disabled={auditExportDisabled}
                onClick={generateReport}
                title={auditExportDisabled ? auditExportUnavailableReason : "Generate an audit evidence report for the current filtered rows."}
                type="button"
              >
                <AuditActionIcon name="report" /><span>Generate report</span>
              </button>
              <button
                className="is-primary"
                disabled={auditExportDisabled}
                onClick={exportCsv}
                title={auditExportDisabled ? auditExportUnavailableReason : "Export the current filtered audit rows as CSV."}
                type="button"
              >
                <AuditActionIcon name="download" /><span>Export CSV</span>
              </button>
            </div>
          </header>

          <div className="gh-audit-kpis gh-audit-prototype-kpis" aria-label="Audit metrics">
            <KpiCard icon="▦" label={eventsMetricLabel} value={loading ? "Loading..." : queryError ? "Unavailable" : metricValue(scopedEventMetric)} support={loading ? "Reading audit rows" : eventSupport} tone="info" />
            <KpiCard icon="!" label={summary.policyViolations == null ? "Policy violations" : "Policy violations · 7d"} value={loading ? "Loading..." : queryError ? "Unavailable" : metricValue(policyViolations)} support={policySupport} tone="bad" />
            <KpiCard icon="✓" label="Access reviews · open" value={loading ? "Loading..." : queryError ? "Unavailable" : metricValue(accessReviews)} support={accessSupport} tone="good" />
            <KpiCard icon="▣" label="Retention" value={loading ? "Loading..." : queryError ? "Unavailable" : (retentionYears == null ? "Unavailable" : `${retentionYears} yr`)} support={retentionSupport} tone="info" />
          </div>

          {loading ? (
            <EmptyState title="Loading audit trail" message="Reading governed metadata audit evidence." />
          ) : queryError ? (
            <EmptyState
              tone={forbidden ? "warn" : "bad"}
              title={forbidden ? "Audit trail is steward/admin only" : "Audit trail unavailable"}
              message={forbidden ? "Ask a workspace steward or admin to grant audit visibility." : (queryError || "Audit evidence could not be loaded.")}
            />
          ) : null}

          <section className="gh-audit-prototype-tabs" aria-label="Audit filters">
            {filters.map(([name, count]) => (
              <button
                aria-pressed={activeFilter === name}
                className={activeFilter === name ? "is-active" : ""}
                key={name}
                onClick={() => setActiveFilter(name)}
                type="button"
                aria-label={`${name}, ${count} events`}
              >
                {name}
              </button>
            ))}
          </section>

          <section className="gh-audit-table-panel gh-audit-prototype-table" aria-label="Audit events">
            <div className="gh-audit-table-head" role="row">
              <span>Time (UTC)</span>
              <span>Actor</span>
              <span>Event</span>
              <span>Target</span>
              <span>Evidence</span>
            </div>
            <div className="gh-audit-table-body">
              {pageRows.length ? pageRows.map((event) => (
                <div
                  className={`gh-audit-row${selected?.id === event.id ? " is-selected" : ""}`}
                  key={event.id}
                  onClick={() => {
                    setSelectedId(event.id);
                    setStatus(`${displayLabel(event.action)} evidence selected.`);
                  }}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                      keyEvent.preventDefault();
                      setSelectedId(event.id);
                      setStatus(`${displayLabel(event.action)} evidence selected.`);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="gh-audit-time">{event.createdAt ? new Date(event.createdAt).toISOString().replace("T", " ").slice(0, 19) : "Unavailable"}</span>
                  <span className="gh-audit-actor"><ActorMark actor={event.actor} /><strong>{event.actor || "Unavailable"}</strong></span>
                  <span><ActionBadge action={event.action} /><small>{event.detail || "No detail recorded"}</small></span>
                  <span className="gh-audit-object"><strong>{event.objectLabel}</strong></span>
                  <span className="gh-audit-source">
                    <small title={evidenceReference(event)}>
                      <span>{auditEvidenceSummary(event)}</span>
                    </small>
                    <button
                      aria-label={`Open evidence target for ${event.objectLabel}`}
                      disabled={!event.entityFqn || !onOpenAsset}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onOpenAsset?.(event.entityFqn);
                      }}
                      title={event.entityFqn ? "Open evidence target asset" : "No evidence target asset route is available"}
                      type="button"
                    >
                      <AuditActionIcon name="external" />
                    </button>
                  </span>
                </div>
              )) : (
                <div className="gh-audit-empty">No audit events match the current filters.</div>
              )}
            </div>
          </section>
          <footer className="gh-audit-prototype-note">
            <AuditActionIcon name="shield" />
            <span>{auditEvidenceNote}</span>
          </footer>
          {selected ? (
            <aside className="gh-audit-selected-detail" aria-label="Selected audit event detail">
              <header>
                <div>
                  <span>Selected evidence</span>
                  <h2>{displayLabel(selected.action)}</h2>
                </div>
                <AuditStatus status={selected.status} />
              </header>
              <dl>
                <div><dt>Actor</dt><dd>{selected.actor || "Unavailable"}</dd></div>
                <div><dt>Target</dt><dd>{selected.objectLabel}</dd></div>
                <div><dt>Evidence</dt><dd>{evidenceReference(selected)}</dd></div>
                <div><dt>Evidence ID</dt><dd>{selected.displayRequestId || selected.displayAuditId || "Unavailable"}</dd></div>
              </dl>
              {diffRows(selected.beforeJson, selected.afterJson).length ? (
                <div className="gh-audit-diff-preview">
                  {diffRows(selected.beforeJson, selected.afterJson).map((row) => (
                    <p key={row.key}><strong>{row.key}</strong><span>{row.before}</span><em>{row.after}</em></p>
                  ))}
                </div>
              ) : (
                <Unavailable>No before/after metadata diff was reported for this event.</Unavailable>
              )}
              <div className="gh-audit-selected-actions">
                <button
                  disabled={!selected.entityFqn || !onOpenAsset}
                  onClick={openSelectedAsset}
                  title={!selected.entityFqn || !onOpenAsset ? "Open asset unavailable because this audit row has no backed asset route." : undefined}
                  type="button"
                >
                  Open asset
                </button>
                <button
                  disabled={!selected.displayRequestId && !selected.displayAuditId}
                  onClick={copySelectedEvidenceId}
                  title={!selected.displayRequestId && !selected.displayAuditId ? "Evidence ID unavailable for this audit row." : undefined}
                  type="button"
                >
                  Copy evidence ID
                </button>
              </div>
            </aside>
          ) : null}
          <div className="gh-audit-status-line" aria-live="polite">{status}</div>
        </main>
      </div>
    </section>
  );
}

function draftDate(value, endOfDay = false) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(`${raw}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function metricValue(value) {
  const number = numberOrNull(value);
  return number == null ? "Unavailable" : number.toLocaleString();
}
