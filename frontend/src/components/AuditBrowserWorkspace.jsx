import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditEvidence } from "../lib/api";
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

function text(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
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
    const entries = Object.entries(value);
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
    "request_id",
    "evidence_kind",
    "authoritative",
  ];
  const rows = events.map((event) => [
    event.createdAt,
    event.actor,
    event.action,
    event.status,
    event.objectLabel,
    evidenceReference(event, provenance.evidenceKind === "prototype_mock"),
    event.requestId,
    provenance.evidenceKind || "unavailable",
    provenance.authoritative ? "true" : "false",
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

function normalizeEvent(event, index = 0) {
  const value = event && typeof event === "object" ? event : {};
  const id = eventId(value, index);
  const entityFqn = text(value.entity_fqn || value.entityFqn);
  const entityId = text(value.entity_id || value.entityId || value.objectId);
  const entityType = text(value.entity_type || value.entityType || value.kind || "Audit object");
  const actor = text(value.actor_email || value.actorEmail || value.created_by || value.createdBy);
  const requestId = text(value.request_id || value.requestId);
  const createdAt = text(value.created_at || value.createdAt);
  return {
    ...value,
    id,
    actor,
    actorRole: text(value.actor_role || value.actorRole || "Audit actor"),
    entityFqn,
    entityId,
    entityType,
    objectLabel: entityFqn || entityId || "Unavailable object",
    action: text(value.action) || "change recorded",
    source: text(value.source) || "Evidence source unavailable",
    status: text(value.status) || "unavailable",
    requestId,
    detail: text(value.detail),
    createdAt,
    beforeJson: value.before_json ?? value.beforeJson ?? value.before ?? "",
    afterJson: value.after_json ?? value.afterJson ?? value.after ?? "",
    domain: text(value.domain) || inferDomain(entityFqn || entityId),
  };
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

function evidenceReference(event = {}, prototypeMockEvidence = false) {
  const reference = auditEvidenceSummary(event);
  return prototypeMockEvidence && reference !== "Evidence reference unavailable"
    ? `Prototype fixture - not live audit proof: ${reference}`
    : reference;
}

function auditEvidenceSummary(event = {}) {
  const parts = [
    event.requestId ? `Request ${event.requestId}` : "",
    event.source || event.detail || "Evidence reference unavailable",
  ].filter(Boolean);
  return parts.join(" · ");
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
 * @param {{ onOpenAsset?: (assetFqn: string, nextTab?: string) => void }} props
 */
export default function AuditBrowserWorkspace({ onOpenAsset = undefined } = {}) {
  const [selectedId, setSelectedId] = useState("");
  const [activeFilter, setActiveFilter] = useState("All events");
  const [dateRange, setDateRange] = useState("24h");
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [status, setStatus] = useState("");

  const query = useQuery({
    queryKey: ["atlas", "audit-evidence", selectedId || "latest", dateRange, DEFAULT_LIMIT],
    queryFn: ({ signal }) => fetchAuditEvidence({ auditId: selectedId, dateRange, limit: DEFAULT_LIMIT, signal }),
    placeholderData: (previousData) => previousData,
    retry: false,
    staleTime: 60_000,
  });

  const payload = envelopeData(query.data) || {};
  const meta = envelopeMeta(query.data);
  const events = useMemo(
    () => (Array.isArray(payload.events) ? payload.events : []).map(normalizeEvent),
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
  const selected = selectedInFiltered || null;

  useEffect(() => {
    if (!filteredEvents.length) {
      setSelectedId("");
      return;
    }
    if (selectedId && !filteredEvents.some((event) => event.id === selectedId)) {
      setSelectedId("");
    }
  }, [filteredEvents, selectedId]);

  const loading = query.isLoading;
  const queryError = query.error?.message || "";
  const forbidden = responseStatus(query.error) === 403;
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
  const prototypeMockEvidence =
    auditSource === "local-prototype-mock" ||
    String(meta?.state || "").trim().toLowerCase() === "prototype_mock";
  const degradedEvidence =
    !prototypeMockEvidence &&
    (
      meta?.authoritative === false ||
      meta?.degraded === true ||
      ["degraded", "warning", "unavailable", "error"].includes(String(meta?.state || "").trim().toLowerCase()) ||
      (Array.isArray(meta?.warnings) && meta.warnings.length > 0)
    );
  const authoritativeEvidence =
    !prototypeMockEvidence &&
    !degradedEvidence &&
    Boolean(auditSource) &&
    (meta?.authoritative === true || payload.authoritative === true || summary.authoritative === true);
  const evidenceKind = prototypeMockEvidence
    ? "prototype_mock"
    : authoritativeEvidence ? "runtime_evidence" : (auditSource ? "degraded" : "unavailable");
  const auditEvidenceNote = text(
    summary.evidenceNote ||
      summary.auditEvidenceNote ||
      payload.evidenceNote ||
      payload.auditEvidenceNote,
    auditSource
      ? prototypeMockEvidence
        ? "Append-only Delta table governance_state.audit_log · 7-year retention · time-travel queries via VERSION AS OF. No raw row values are stored - only metadata + references."
      : `Append-only Delta audit log ${auditSource} · time-travel evidence references only, no raw row values.`
      : `Audit evidence source unavailable · ${dateRange} scope`,
  );
  const retentionSupport = prototypeMockEvidence
    ? text(summary.retentionNote || summary.retentionSource, "Delta · time-travel enabled")
    : retentionYears == null
    ? "Retention policy not reported"
    : text(summary.retentionNote || summary.retentionSource, "Retention reported by audit API");
  const eventSupport = prototypeMockEvidence ? text(summary.eventsDeltaText || summary.eventsSupport, "+312 vs prev") : text(
    summary.eventsDeltaText ||
      summary.eventsSupport ||
      summary.eventsSource ||
      summary.summarySource ||
      meta?.source,
    events24h == null ? "No scoped event summary reported; showing loaded rows" : "Event summary source unavailable",
  );
  const policySupport = prototypeMockEvidence ? text(summary.policyViolationsDeltaText || summary.policyViolationsSupport, "-2 vs prev") : text(
    summary.policyViolationsDeltaText ||
      summary.policyViolationsSupport ||
      summary.policySource ||
      summary.summarySource,
    "Policy summary unavailable unless reported by audit API",
  );
  const accessSupport = prototypeMockEvidence ? text(summary.accessReviewsDeltaText || summary.accessReviewsSupport, "0 vs prev") : text(
    summary.accessReviewsDeltaText ||
      summary.accessReviewsSupport ||
      summary.accessReviewSource ||
      summary.summarySource,
    "Access review summary unavailable unless reported by audit API",
  );
  const auditSummaryUnavailable =
    events24h == null &&
    events.length === 0 &&
    (degradedEvidence || meta?.degraded === true || payload?.degraded === true || summary?.degraded === true);
  const scopedEventMetric = events24h ?? (auditSummaryUnavailable ? null : events.length);
  const eventsMetricLabel = summary.events24h == null && !auditSummaryUnavailable ? "Events · loaded" : `Events · ${dateRange}`;
  const filters = [
    ["All events", events.length],
    ["By users", events.filter((event) => !/^svc-|bot|service/i.test(event.actor)).length],
    ["By services", events.filter((event) => /^svc-|bot|service/i.test(event.actor)).length],
    ["Violations", events.filter((event) => /violation|failed|exception/i.test(`${event.action} ${event.status} ${event.detail}`)).length],
  ];
  const dateRanges = ["24h", "7d", "30d", "90d"];
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
      auditCsv(filteredEvents, { authoritative: authoritativeEvidence, evidenceKind }),
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
      authoritative: authoritativeEvidence,
      evidenceKind,
      prototypeMockEvidence,
      summary: {
        events: filteredEvents.length,
        policyViolations: policyViolations ?? null,
        accessReviewsOpen: accessReviews ?? null,
        retentionYears: retentionYears ?? null,
        authoritative: authoritativeEvidence,
        evidenceKind,
        source: prototypeMockEvidence
          ? "prototype mock audit payload"
          : auditSource || "unavailable",
        liveDatabricksEvidence: authoritativeEvidence,
      },
      events: filteredEvents.slice(0, 25).map((event) => ({
        ...event,
        source: evidenceReference(event, prototypeMockEvidence),
        authoritative: authoritativeEvidence,
        evidenceKind,
        evidenceSource: prototypeMockEvidence
          ? "prototype mock audit payload"
          : auditSource || "unavailable",
        liveDatabricksEvidence: authoritativeEvidence,
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
  const copySelectedRequest = async () => {
    if (!selected?.requestId) {
      setStatus("Request ID unavailable for this audit row.");
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selected.requestId);
      }
      setStatus(`Request ID ${selected.requestId} copied.`);
    } catch {
      setStatus(`Request ID ${selected.requestId} selected for review.`);
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
	                {queryError && !prototypeMockEvidence
	                  ? "Audit evidence is unavailable for this workspace. The evidence log structure remains visible so exports, filters, and retention state can fail closed."
	                  : "Every governance action by humans or services is appended to a Delta audit log. Events are searchable, time-ordered, and exportable for SOC 2 / SOX evidence."}
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
              <button onClick={generateReport} type="button"><AuditActionIcon name="report" /><span>Generate report</span></button>
              <button className="is-primary" onClick={exportCsv} type="button"><AuditActionIcon name="download" /><span>Export CSV</span></button>
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
                    <small title={evidenceReference(event, prototypeMockEvidence)}>
                      <span>{auditEvidenceSummary(event)}</span>
                      {prototypeMockEvidence ? <em>Prototype fixture</em> : null}
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
                <div><dt>Evidence</dt><dd>{evidenceReference(selected, prototypeMockEvidence)}</dd></div>
                <div><dt>Request ID</dt><dd>{selected.requestId ? (prototypeMockEvidence ? `Prototype ${selected.requestId}` : selected.requestId) : "Unavailable"}</dd></div>
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
                <button disabled={!selected.entityFqn || !onOpenAsset} onClick={openSelectedAsset} type="button">
                  Open asset
                </button>
                <button disabled={!selected.requestId} onClick={copySelectedRequest} type="button">
                  Copy request ID
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
