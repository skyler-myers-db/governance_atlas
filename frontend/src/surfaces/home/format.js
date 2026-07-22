/*
 * surfaces/home/format.js — Command Center formatters + payload normalizers
 * (Wave C2). Pure functions only: the sections render payload labels, never
 * re-derive semantics (COHESION law #2 — semantics.py owns the numbers).
 */

export function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatCount(value) {
  const numeric = numericValue(value);
  if (numeric === null) return "—";
  return Math.max(0, Math.trunc(numeric)).toLocaleString();
}

/*
 * One percent formatter everywhere: whole numbers stay whole, fractional
 * values keep one decimal. (The legacy page mixed Math.round with toFixed(1)
 * and showed the same coverage as 95.5% and 96% on one screen.)
 */
export function percentLabel(value, fallback = "—") {
  const numeric = numericValue(value);
  if (numeric === null) return fallback;
  return Number.isInteger(numeric) ? `${numeric.toFixed(0)}%` : `${numeric.toFixed(1)}%`;
}

export function formatKpiValue(kpi) {
  const numeric = numericValue(kpi?.value);
  if (numeric === null) return "—";
  if (kpi?.format === "percent") return percentLabel(numeric);
  return formatCount(numeric);
}

export function kpiState(kpi) {
  if (!kpi || kpi.state === "unavailable") return "unavailable";
  if (numericValue(kpi.value) === null) return "unavailable";
  return kpi.state || "available";
}

/* Human tick/date label: ISO dates become "Jul 20" (UTC, never fabricated). */
export function trendTickLabel(label) {
  const text = String(label || "").trim();
  if (!text) return text;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(`${text.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    }
  }
  return text;
}

/*
 * "evidence from May 3" stamp for signals whose backing run is older than the
 * panel implies. Empty string when no usable timestamp exists — a signal
 * without a date never gets one invented.
 */
export function evidenceDateLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `evidence from ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function relativeTimeLabel(value) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs >= 0) {
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 1) return `${Math.max(1, Math.floor(deltaMs / 1_000))}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Trend normalization                                                  */
/* ------------------------------------------------------------------ */

function clampedScore(value) {
  const numeric = numericValue(value);
  if (numeric === null) return null;
  return Math.max(0, Math.min(100, numeric));
}

export function normalizeTrend(trend = []) {
  return (Array.isArray(trend) ? trend : []).map((point, index) => {
    if (typeof point === "number") {
      return { label: `P${index + 1}`, overall: clampedScore(point) };
    }
    if (!point || typeof point !== "object") {
      return { label: `P${index + 1}`, overall: null };
    }
    return {
      label: point.label || point.date || point.period || `P${index + 1}`,
      overall: clampedScore(point.overall ?? point.posture ?? point.value ?? point.score),
    };
  });
}

/* A delta needs >= 2 snapshots; one point is history collection, not a trend. */
export function trendDeltaLabel(trend = []) {
  const points = normalizeTrend(trend).filter((point) => Number.isFinite(point.overall));
  if (points.length < 2) return "Trend unavailable";
  const first = points[0];
  const last = points[points.length - 1];
  const delta = Math.round(last.overall - first.overall);
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}pp vs ${trendTickLabel(first.label)}`;
}

/* ------------------------------------------------------------------ */
/* Payload row normalizers (defensive against field spelling drift)     */
/* ------------------------------------------------------------------ */

export function catalogRows(data) {
  const raw = Array.isArray(data?.catalogHealth) ? data.catalogHealth : [];
  return raw
    .map((row) => ({
      name: row.name || row.catalog || row.catalogName || "",
      tables: numericValue(row.tables ?? row.tableCount ?? row.assets ?? row.assetCount),
      coverage: numericValue(row.coverage ?? row.coverageScore ?? row.metadataCoverage),
      classification: row.classified || row.classification || row.sensitivity || "Unclassified",
      risk: row.risk || row.riskLevel || "Unavailable",
    }))
    .filter((row) => row.name);
  // The payload is complete and worst-first; never slice — hiding catalogs is
  // how the worst-covered catalog vanished from the legacy panel.
}

export function domainRows(data) {
  const byDomain = Array.isArray(data?.posture?.byDomain) ? data.posture.byDomain : [];
  const source = byDomain.length ? byDomain : Array.isArray(data?.topDomains) ? data.topDomains : [];
  return source
    .map((domain, index) => ({
      label: domain.domain || domain.label || domain.name || `Domain ${index + 1}`,
      score: clampedScore(domain.score ?? domain.value ?? domain.coverage),
      count: numericValue(domain.count ?? domain.assets ?? domain.assetCount),
    }))
    .filter((domain) => domain.label);
}

export function cdeRows(data) {
  const raw = Array.isArray(data?.cdes) ? data.cdes : [];
  return raw
    .map((row) => ({
      id: row.id || row.assetFqn || row.name,
      name: row.name || "Critical data element",
      assetFqn: row.assetFqn || row.fqn || "",
      owner: row.owner || "",
      status: row.status || "",
      sox: Boolean(row.sox),
    }))
    .filter((row) => row.id || row.name);
}

export function requestRows(data) {
  const raw = Array.isArray(data?.governance?.pendingRequests) ? data.governance.pendingRequests : [];
  return raw
    .map((row) => ({
      id:
        row.request_id || row.requestId || row.id || row.audit_id || row.auditId || "",
      assetFqn:
        row.uc_full_name || row.ucFullName || row.entity_fqn || row.entityFqn || row.assetFqn || "",
      summary: row.summary || row.detail || row.request_type || row.requestType || "Governance request",
      requestedBy: row.requested_by || row.requestedBy || row.actor_email || row.actorEmail || "",
      status: row.status || "pending",
      createdAt: row.created_at || row.createdAt || "",
    }))
    .filter((row) => row.id || row.assetFqn);
}

export function eventRows(data, limit = 6) {
  const raw = Array.isArray(data?.recentEvents) ? data.recentEvents : [];
  return raw.slice(0, limit).map((event, index) => {
    const priority = String(event.priority || event.severity || "").toLowerCase();
    // Prefer the AUD-<hex8> display id: Evidence addresses events by it, and
    // raw backing ids made the activity links land on "not found" (final
    // verifier BLOCK-2). The resolver now also accepts raw ids, but emitting
    // the canonical form keeps URLs consistent app-wide.
    return {
      id:
        event.displayAuditId ||
        event.auditDisplayId ||
        event.id ||
        `${event.title || "event"}-${index}`,
      title: event.title || "Governance event",
      detail: event.detail || "",
      actor: event.actorEmail || event.actor || "",
      time: relativeTimeLabel(event.createdAt || event.timestamp || event.time),
      tone: event.tone || (["critical", "high", "p0", "p1"].includes(priority) ? "bad" : "info"),
    };
  });
}

/*
 * Quality-run severity split. Rendered ONLY from the backed riskBreakdown
 * payload (quality_run_results); nothing is inferred when the block is
 * absent.
 */
export function riskSummary(data) {
  const raw = data?.riskBreakdown;
  if (!raw || typeof raw !== "object") {
    return { available: false, label: "", high: null, medium: null, informational: null, evidenceAt: "" };
  }
  return {
    available: true,
    label: raw.label || "Quality risk findings",
    source: raw.source || "",
    high: numericValue(raw.high),
    medium: numericValue(raw.medium),
    informational: numericValue(raw.informational),
    total: numericValue(raw.total),
    evidenceAt: raw.evidenceAt || "",
  };
}

/* True when at least one command-center signal is actually backed by data —
 * used to keep skeletons up while a 200-but-still-warming envelope arrives
 * (never definitive zeros during hydration; COHESION law #3). */
export function hasBackedSignal(data) {
  if (!data || typeof data !== "object") return false;
  const estate = data.estate || {};
  if (
    numericValue(estate.visibleAssetCount) !== null ||
    numericValue(estate.catalogCount) !== null ||
    numericValue(estate.coverageScore) !== null
  ) {
    return true;
  }
  if (Array.isArray(data.kpis) && data.kpis.some((kpi) => numericValue(kpi?.value) !== null)) {
    return true;
  }
  return Array.isArray(data.recentAssets) && data.recentAssets.length > 0;
}
