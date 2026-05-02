import { useEffect, useMemo, useState } from "react";
import { DegradedBanner } from "./northstar";
import { useInsightsDashboard as defaultUseInsightsDashboard } from "../hooks/useInsightsDashboard";

const KPI_ORDER = [
  {
    key: "maturity",
    label: "Governance Maturity Score",
    tooltip: "Weighted score from live governance signals that are available; unavailable policy, quality, and audit signals are excluded.",
    icon: "score",
  },
  {
    key: "policyCompliance",
    label: "Policy Compliance",
    tooltip: "Authoritative policy compliance when a policy evaluation source is configured.",
    icon: "policy",
  },
  {
    key: "resolutionDays",
    label: "Time to Resolution (P1)",
    tooltip: "Average priority-one governance resolution time when reviewed request history is available.",
    icon: "clock",
  },
  {
    key: "certifiedAssets",
    label: "Certified Assets",
    tooltip: "Count of visible assets with certified or approved certification metadata.",
    icon: "certified",
  },
  {
    key: "criticalExceptions",
    label: "Critical Policy Exceptions",
    tooltip: "Text-derived policy exception evidence from governance requests and audit records until a dedicated source exists.",
    icon: "exception",
  },
  {
    key: "metadataCoverage",
    label: "Metadata Coverage",
    tooltip: "Average completeness across description, domain, tier, certification, sensitivity, criticality, data product, and ownership.",
    icon: "coverage",
  },
];

const MONTH_LABELS = ["Dec '24", "Jan '25", "Feb '25", "Mar '25", "Apr '25", "May '25"];
const RANGE_OPTIONS = ["Last 6 Months", "Last 90 Days", "Last 30 Days"];
const RISK_COLUMNS = ["Very Low", "Low", "Medium", "High", "Very High"];
const RISK_ROWS = ["Very High", "High", "Medium", "Low", "Very Low"];

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cssVars(value) {
  return /** @type {import("react").CSSProperties} */ (value);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value) {
  const n = numberValue(value);
  if (n === null) return "Unavailable";
  return Math.round(n).toLocaleString();
}

function formatValue(kpi) {
  if (!kpi || kpi.state === "unavailable" || kpi.value === null || kpi.value === undefined || kpi.value === "") {
    return "-";
  }
  const n = numberValue(kpi.value);
  if (n === null) return "-";
  if (kpi.format === "percent") return `${Math.round(n)}%`;
  if (kpi.key === "resolutionDays") return `${n.toFixed(n >= 10 ? 0 : 1)} days`;
  if (kpi.format === "score") return String(Math.round(n));
  return Math.max(0, Math.trunc(n)).toLocaleString();
}

function valueSuffix(kpi) {
  if (kpi?.key === "maturity" && kpi.state !== "unavailable" && kpi.value !== null && kpi.value !== undefined) {
    return "/100";
  }
  return "";
}

function kpiState(kpi) {
  if (!kpi || kpi.state === "unavailable" || kpi.value === null || kpi.value === undefined || kpi.value === "") {
    return "unavailable";
  }
  if (kpi.state === "degraded") {
    return "degraded";
  }
  return "available";
}

function kpiFooterText(state) {
  if (state === "unavailable") return "Signal unavailable";
  if (state === "degraded") return "Degraded signal";
  return "Live signal";
}

function kpiProgress(kpi) {
  if (kpiState(kpi) === "unavailable") return null;
  const n = numberValue(kpi.value);
  if (n === null) return null;
  if (kpi.format === "percent" || kpi.format === "score" || kpi.key === "maturity") {
    return Math.max(0, Math.min(100, n));
  }
  return null;
}

function valuesFromSeries(series) {
  return arrayValue(series)
    .map((item) => {
      if (typeof item === "number") return item;
      if (!item || typeof item !== "object") return null;
      return numberValue(item.value ?? item.score ?? item.percent ?? item.days);
    })
    .filter((item) => item !== null);
}

function pathForValues(values, width = 260, height = 112) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const spread = max - min || 1;
  return nums
    .map((value, index) => {
      const x = (index / Math.max(1, nums.length - 1)) * width;
      const y = height - ((value - min) / spread) * (height - 14) - 7;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function Icon({ type }) {
  return (
    <span className={`gh-insights-icon tone-${type}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        {type === "score" ? (
          <>
            <path d="M5 15a7 7 0 1 1 14 0" />
            <path d="m12 13 4-5" />
            <path d="M8 19h8" />
          </>
        ) : null}
        {type === "policy" ? (
          <>
            <path d="M5 4h14v16H5z" />
            <path d="M8 9h8M8 13h6" />
          </>
        ) : null}
        {type === "clock" ? (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 7v5l3 2" />
          </>
        ) : null}
        {type === "certified" ? (
          <>
            <path d="M12 3 5 6v5c0 4.2 2.6 7.5 7 9 4.4-1.5 7-4.8 7-9V6z" />
            <path d="m8.7 12 2.1 2.1 4.6-5" />
          </>
        ) : null}
        {type === "exception" ? (
          <>
            <path d="M12 3 3.8 18h16.4z" />
            <path d="M12 8v5M12 16h.01" />
          </>
        ) : null}
        {type === "coverage" ? (
          <>
            <path d="M5 5h14v14H5z" />
            <path d="M9 5v14M5 10h14M5 15h14" />
          </>
        ) : null}
        {type === "ai" ? (
          <>
            <circle cx="5" cy="7" r="1.5" />
            <circle cx="6.5" cy="17" r="1.2" />
            <path d="m13 3 1.6 5.1L20 10l-5.4 1.9L13 17l-1.6-5.1L6 10l5.4-1.9z" />
          </>
        ) : null}
      </svg>
    </span>
  );
}

function KpiCard({ definition, kpi }) {
  const progress = kpiProgress(kpi);
  const state = kpiState(kpi);
  const unavailable = state === "unavailable";
  const degraded = state === "degraded";
  const value = formatValue({ ...kpi, key: definition.key });
  const suffix = valueSuffix({ ...kpi, key: definition.key });
  const sparkValues = valuesFromSeries(kpi?.sparkline || kpi?.trend || []);

  return (
    <article className={`gh-insights-kpi ${unavailable ? "is-unavailable" : ""} ${degraded ? "is-degraded" : ""}`.trim()}>
      <div className="gh-insights-kpi-head">
        <Icon type={definition.icon} />
        <span className="gh-insights-kpi-label">
          <span>{kpi?.label || definition.label}</span>
          <button
            aria-label={`${definition.label}: ${definition.tooltip}`}
            className="ga-info-tooltip"
            title={definition.tooltip}
            type="button"
          >
            i
          </button>
        </span>
      </div>
      <div className="gh-insights-kpi-main">
        <strong>
          {value}
          {suffix ? <small>{suffix}</small> : null}
        </strong>
        {definition.key === "maturity" && progress !== null ? (
          <div className="gh-insights-ring" style={cssVars({ "--value": `${progress}%` })} aria-label={`${definition.label} ${Math.round(progress)} percent`} />
        ) : null}
        {definition.key !== "maturity" ? (
          <MiniTrend values={sparkValues} unavailable={unavailable || !sparkValues.length} />
        ) : null}
      </div>
      {progress !== null && definition.key !== "maturity" ? (
        <div className="gh-insights-progress" aria-label={`${definition.label} progress`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <p className={`gh-insights-kpi-foot tone-${unavailable ? "muted" : degraded ? "degraded" : "good"}`}>
        {kpiFooterText(state)}
      </p>
    </article>
  );
}

function MiniTrend({ values, unavailable }) {
  const path = pathForValues(values, 78, 28);
  if (unavailable || !path) {
    return <span className="gh-insights-mini-trend is-unavailable" aria-label="Trend unavailable" />;
  }
  return (
    <svg className="gh-insights-mini-trend" viewBox="0 0 78 28" aria-label="Live trend">
      <path d={path} />
    </svg>
  );
}

function LineChart({ title, values, label, unavailableMessage = "Trend history unavailable" }) {
  const path = pathForValues(values, 310, 130);
  const hasData = Boolean(path);
  return (
    <div className="gh-insights-line-chart" role="img" aria-label={title}>
      <div className="gh-insights-chart-grid" aria-hidden="true">
        {[0, 25, 50, 75, 100].map((tick) => <span key={tick} style={{ bottom: `${tick}%` }} />)}
      </div>
      {hasData ? (
        <svg viewBox="0 0 310 130" preserveAspectRatio="none">
          <path d={path} />
          {values.map((value, index) => {
            const nums = values.filter((item) => Number.isFinite(item));
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const spread = max - min || 1;
            const x = (index / Math.max(1, values.length - 1)) * 310;
            const y = 130 - ((value - min) / spread) * 116 - 7;
            return <circle cx={x} cy={y} r="3" key={`${value}-${index}`} />;
          })}
        </svg>
      ) : (
        <div className="gh-insights-unavailable-pill">{unavailableMessage}</div>
      )}
      <div className="gh-insights-chart-axis" aria-hidden="true">
        {MONTH_LABELS.map((month) => <span key={month}>{month}</span>)}
      </div>
      <div className="gh-insights-chart-legend">
        <span>{label}</span>
      </div>
    </div>
  );
}

function RangeControl({ id, label, range, open, onToggle, onSelect, compact = false }) {
  return (
    <div className={`gh-insights-range ${compact ? "is-card" : ""}`.trim()}>
      <button
        aria-controls={`gh-insights-range-menu-${id}`}
        aria-expanded={open}
        aria-label={`${label}: ${range}`}
        onClick={onToggle}
        type="button"
      >
        {range}
        <span aria-hidden="true">v</span>
      </button>
      {open ? (
        <div className="gh-insights-popover" id={`gh-insights-range-menu-${id}`} role="menu">
          {RANGE_OPTIONS.map((option) => (
            <button
              aria-pressed={range === option}
              key={option}
              onClick={() => onSelect(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function heatmapRows(cells = []) {
  const byRow = new Map();
  for (const cell of arrayValue(cells)) {
    const rowName = cell.row || cell.domain || cell.label || "Unassigned";
    const column = cell.column || cell.metric || "Coverage";
    const current = byRow.get(rowName) || { domain: rowName, values: {} };
    current.values[column] = cell.value;
    byRow.set(rowName, current);
  }
  return Array.from(byRow.values());
}

function HeatmapPanel({ cells }) {
  const rows = heatmapRows(cells).slice(0, 7);
  const columns = Array.from(new Set(arrayValue(cells).map((cell) => cell.column || cell.metric || "Coverage"))).slice(0, 7);
  if (!rows.length || !columns.length) {
    return <div className="gh-insights-empty-panel">No heatmap signals available.</div>;
  }
  return (
    <div
      className="gh-insights-coverage-heatmap"
      role="table"
      aria-label="Metadata coverage by domain"
      style={cssVars({ "--heatmap-columns": columns.length })}
    >
      <div className="gh-insights-coverage-row is-header" role="row">
        <span role="columnheader" />
        {columns.map((column) => <span key={column} role="columnheader">{column}</span>)}
      </div>
      {rows.map((row) => (
        <div className="gh-insights-coverage-row" key={row.domain} role="row">
          <strong role="rowheader">{row.domain}</strong>
          {columns.map((column) => {
            const value = numberValue(row.values[column]) ?? 0;
            return (
              <span
                aria-label={`${row.domain} ${column} ${Math.round(value)} percent`}
                className={`tone-${heatTone(value)}`}
                key={column}
                role="cell"
                title={`${column}: ${Math.round(value)}%`}
              />
            );
          })}
        </div>
      ))}
      <div className="gh-insights-heatmap-scale" aria-hidden="true"><span>Low</span><i /><span>High</span></div>
    </div>
  );
}

function heatTone(value) {
  if (value >= 85) return "high";
  if (value >= 65) return "mid";
  if (value > 0) return "low";
  return "empty";
}

function CertificationTierPanel({ rows, showAll, onToggle }) {
  const items = arrayValue(rows).slice(0, showAll ? 8 : 4);
  return (
    <div className="gh-insights-tier-panel">
      {items.length ? items.map((item) => {
        const value = numberValue(item.value ?? item.coverage ?? item.percent) ?? 0;
        const label = item.label || item.tier || "Unassigned tier";
        return (
          <div className="gh-insights-tier-row" key={label}>
            <span>{label}</span>
            <i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
            <strong>{Math.round(value)}%</strong>
          </div>
        );
      }) : (
        <div className="gh-insights-empty-panel">Tier certification coverage unavailable for the current live scope.</div>
      )}
      <button className="gh-insights-link" type="button" onClick={onToggle}>
        {showAll ? "Show fewer tiers" : "View all tiers"} -&gt;
      </button>
    </div>
  );
}

function RiskHeatmapPanel({ cells }) {
  const values = new Map();
  arrayValue(cells).forEach((cell) => {
    const row = cell.row || cell.impact || "Medium";
    const column = cell.column || cell.likelihood || "Medium";
    values.set(`${row}::${column}`, numberValue(cell.value ?? cell.count) ?? 0);
  });
  const hasData = values.size > 0;
  return (
    <div className="gh-insights-risk-panel">
      <div className="gh-insights-risk-label-axis">Impact</div>
      <div className="gh-insights-risk-grid" role="table" aria-label="Governance risk heatmap">
        {RISK_ROWS.map((row) => (
          <div className="gh-insights-risk-row" role="row" key={row}>
            <strong role="rowheader">{row}</strong>
            {RISK_COLUMNS.map((column) => {
              const value = values.get(`${row}::${column}`) || 0;
              return (
                <span
                  className={`tone-${riskTone(row, column, value)}`}
                  key={column}
                  role="cell"
                  title={hasData ? `${row} impact, ${column} likelihood: ${value}` : "Risk evidence unavailable"}
                >
                  {value ? value : ""}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {!hasData ? <div className="gh-insights-risk-unavailable">Risk evidence unavailable</div> : null}
      <div className="gh-insights-risk-axis" aria-hidden="true">
        <span>Very Low</span><span>Low</span><span>Medium</span><span>High</span><span>Very High</span>
      </div>
    </div>
  );
}

function riskTone(row, column, value) {
  if (!value) return "empty";
  const score = (RISK_ROWS.length - RISK_ROWS.indexOf(row)) + RISK_COLUMNS.indexOf(column);
  if (score >= 8) return "critical";
  if (score >= 6) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function DomainMaturityPanel({ items, showAll, onToggle }) {
  const rows = arrayValue(items).slice(0, showAll ? 10 : 7);
  return (
    <div className="gh-insights-domain-panel">
      {rows.length ? rows.map((item, index) => {
        const value = numberValue(item.score ?? item.value) ?? 0;
        const label = item.domain || item.label || `Domain ${index + 1}`;
        return (
          <div className="gh-insights-domain-row" key={label}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
            <i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
            <em>{Math.round(value)}</em>
          </div>
        );
      }) : (
        <div className="gh-insights-empty-panel">No domain maturity rows available.</div>
      )}
      <button className="gh-insights-link" type="button" onClick={onToggle}>
        {showAll ? "Show fewer domains" : "View all domains"} -&gt;
      </button>
    </div>
  );
}

function RecommendationRail({ recommendations, onNavigate }) {
  const rows = arrayValue(recommendations).slice(0, 4);
  const placeholders = Array.from({ length: Math.max(0, 4 - rows.length) });
  return (
    <aside className="gh-insights-right-rail" aria-label="Atlas AI strategic recommendations">
      <section className="gh-insights-recommendations">
        <header>
          <div>
            <Icon type="ai" />
            <h2>Atlas AI <span>Beta</span></h2>
          </div>
          <h3>Strategic Recommendations</h3>
        </header>
        <div className="gh-insights-rec-list">
          {rows.map((item) => (
            <button
              className="gh-insights-rec-card"
              key={item.key || item.title}
              onClick={() => onNavigate?.("governance")}
              type="button"
            >
              <span className="gh-insights-rec-icon" aria-hidden="true" />
              <span>
                <strong>{item.title || "Evidence-backed recommendation"}</strong>
                <small>{item.detail || "Recommendation evidence is available in governance metadata."}</small>
              </span>
              <em aria-hidden="true">-&gt;</em>
            </button>
          ))}
          {placeholders.map((_, index) => (
            <div className="gh-insights-rec-card is-unavailable" key={`placeholder-${index}`}>
              <span className="gh-insights-rec-icon" aria-hidden="true" />
              <span>
                <strong>{rows.length ? "No additional evidence-backed recommendation" : "No evidence-backed recommendation available"}</strong>
                <small>Atlas AI did not return an actor-visible recommendation for this slot.</small>
              </span>
            </div>
          ))}
        </div>
        <button className="gh-insights-link" type="button" onClick={() => onNavigate?.("governance")}>
          View all recommendations -&gt;
        </button>
      </section>
      <section className="gh-insights-roi">
        <header>
          <h2>Governance ROI</h2>
          <span>Last 6 Months</span>
          <button
            aria-label="Governance ROI: requires live incidents, approvals, and productivity evidence."
            className="ga-info-tooltip"
            title="Governance ROI requires live incidents, approvals, and productivity evidence."
            type="button"
          >
            i
          </button>
        </header>
        <div className="gh-insights-roi-grid">
          {["Incidents Reduced", "Approvals Accelerated", "Analyst Productivity"].map((label) => (
            <div key={label}>
              <Icon type={label.includes("Incidents") ? "certified" : label.includes("Approvals") ? "clock" : "score"} />
              <strong>Unavailable</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

/**
 * Insights surface backed by the Atlas composite API.
 */
export function InsightsWorkspace({
  onNavigate,
  onSurfaceReady,
  insightsOverride = null,
  gapAnalysisOverride = null,
  useInsightsDashboardImpl = defaultUseInsightsDashboard,
}) {
  const override = insightsOverride || gapAnalysisOverride;
  const hookImpl = override ? () => ({}) : useInsightsDashboardImpl;
  const liveInsights = hookImpl({ enabled: !override });
  const insights = override || liveInsights;
  const data = objectValue(insights.data || insights);
  const [range, setRange] = useState(RANGE_OPTIONS[0]);
  const [openRangeControl, setOpenRangeControl] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showAllTiers, setShowAllTiers] = useState(false);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const selectRange = (option) => {
    setRange(option);
    setOpenRangeControl(null);
  };

  useEffect(() => {
    if (!insights.loading && !insights.isLoading) {
      onSurfaceReady?.();
    }
  }, [insights.isLoading, insights.loading, onSurfaceReady]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previous = document.title;
    document.title = "Insights - Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  const meta = {
    ...(data.meta || {}),
    degraded: insights.degraded || data.meta?.state === "degraded",
    warnings: insights.refreshError
      ? [insights.refreshError]
      : Array.isArray(data.meta?.warnings)
        ? data.meta.warnings
        : [],
  };
  const kpisByKey = useMemo(() => {
    const map = new Map();
    arrayValue(data.kpis).forEach((kpi) => {
      if (kpi?.key) map.set(kpi.key, kpi);
    });
    return map;
  }, [data.kpis]);
  const policyTrend = valuesFromSeries(data.policyComplianceTrend);
  const resolutionTrend = valuesFromSeries(data.resolutionTrend);
  const surfaceState = insights.error
    ? "error"
    : insights.loading || insights.isLoading
      ? "loading"
      : meta.degraded
        ? "degraded"
        : "ready";

  return (
    <section
      aria-label="Governance Insights"
      className="gh-workspace gh-insights-workspace ga-page"
      data-surface="insights"
      data-state={surfaceState}
    >
      <div className="gh-insights-globe" aria-hidden="true">
        <svg viewBox="0 0 840 300" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="gh-insights-globe-core" cx="48%" cy="58%" r="58%">
              <stop offset="0%" stopColor="#1d91db" stopOpacity="0.58" />
              <stop offset="54%" stopColor="#096ba9" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#03213b" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="gh-insights-globe-line" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#80ddff" stopOpacity="0.25" />
              <stop offset="58%" stopColor="#2ebaff" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#a7f6ff" stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <path className="gh-insights-globe-core" d="M72 268c76-154 222-232 392-210 128 16 232 82 303 182" fill="url(#gh-insights-globe-core)" />
          <path className="gh-insights-globe-rim" d="M78 260c78-138 206-206 370-198 137 7 245 65 332 170" fill="none" />
          <g className="gh-insights-globe-network" fill="none" stroke="url(#gh-insights-globe-line)" strokeWidth="1.15">
            <path d="M126 246 212 190 318 218 430 152 554 174 706 124" />
            <path d="M160 226 286 122 444 198 610 92 746 182" />
            <path d="M250 256 336 166 492 112 650 220" />
            <path d="M420 70 405 250M566 92 516 246M250 110 318 248" opacity=".55" />
          </g>
          <g className="gh-insights-globe-cities" fill="#d7f7ff" opacity=".34">
            {[164, 204, 248, 286, 336, 388, 432, 496, 548, 592, 642, 704].map((cx, index) => (
              <circle key={cx} cx={cx} cy={index % 3 === 0 ? 176 : index % 3 === 1 ? 132 : 222} r={index % 4 === 0 ? 3 : 2} />
            ))}
          </g>
        </svg>
      </div>

      <header className="gh-insights-hero">
        <div>
          <h1>Governance Insights</h1>
          <p>Operationalize trust at scale. Measure what matters. Drive business impact.</p>
        </div>
        <div className="gh-insights-hero-actions">
          <RangeControl
            id="global"
            label="Global date range"
            range={range}
            open={openRangeControl === "global"}
            onToggle={() => setOpenRangeControl((value) => (value === "global" ? null : "global"))}
            onSelect={selectRange}
          />
          <button
            aria-expanded={filtersOpen}
            className="gh-insights-filter-button"
            onClick={() => setFiltersOpen((value) => !value)}
            type="button"
          >
            <span aria-hidden="true">T</span>
            Filters
          </button>
        </div>
      </header>

      {filtersOpen ? (
        <div className="gh-insights-filter-panel" role="status">
          <strong>Live visibility scope</strong>
          <span>Filters use actor-visible catalogs, domains, and governed metadata returned by the Atlas API.</span>
          <button type="button" onClick={() => setFiltersOpen(false)}>Close</button>
        </div>
      ) : null}

      {insights.error ? (
        <div className="gh-insights-error" role="alert">
          <strong>Insights unavailable.</strong>
          <span>{insights.error}</span>
          {insights.refresh ? <button type="button" onClick={() => insights.refresh()}>Retry</button> : null}
        </div>
      ) : null}

      <DegradedBanner meta={meta} title="Insights data is partially available" />

      <section className="gh-insights-kpi-grid" aria-label="Insights metrics">
        {KPI_ORDER.map((definition) => (
          <KpiCard
            definition={definition}
            key={definition.key}
            kpi={{
              ...objectValue(kpisByKey.get(definition.key)),
              key: definition.key,
              label: objectValue(kpisByKey.get(definition.key)).label || definition.label,
            }}
          />
        ))}
      </section>

      <div className="gh-insights-dashboard">
        <main className="gh-insights-main">
          <section className="gh-insights-card gh-insights-policy-card">
            <CardHeader
              title="Policy Compliance Trend"
              tooltip="Trend line from returned policy compliance history when available."
              action={(
                <RangeControl
                  compact
                  id="policy"
                  label="Policy Compliance Trend date range"
                  range={range}
                  open={openRangeControl === "policy"}
                  onToggle={() => setOpenRangeControl((value) => (value === "policy" ? null : "policy"))}
                  onSelect={selectRange}
                />
              )}
            />
            <LineChart
              title="Policy Compliance Trend"
              values={policyTrend}
              label="Overall Compliance"
              unavailableMessage="Policy trend history unavailable"
            />
          </section>

          <section className="gh-insights-card gh-insights-resolution-card">
            <CardHeader
              title="Time to Resolution Trend (P1)"
              tooltip="Priority-one resolution trend from reviewed governance request history."
              action={(
                <RangeControl
                  compact
                  id="resolution"
                  label="Time to Resolution Trend date range"
                  range={range}
                  open={openRangeControl === "resolution"}
                  onToggle={() => setOpenRangeControl((value) => (value === "resolution" ? null : "resolution"))}
                  onSelect={selectRange}
                />
              )}
            />
            <LineChart
              title="Time to Resolution Trend"
              values={resolutionTrend}
              label="Time to Resolution (Days)"
              unavailableMessage="Resolution trend unavailable"
            />
          </section>

          <section className="gh-insights-card gh-insights-coverage-card">
            <CardHeader title="Metadata Coverage by Domain" tooltip="Coverage dimensions computed from visible asset metadata." />
            <HeatmapPanel cells={data.metadataCoverageHeatmap} />
          </section>

          <section className="gh-insights-card gh-insights-tier-card">
            <CardHeader title="Certification Coverage by Tier" tooltip="Certified asset share by live tier metadata." />
            <CertificationTierPanel
              rows={data.certificationCoverageByTier}
              showAll={showAllTiers}
              onToggle={() => setShowAllTiers((value) => !value)}
            />
          </section>

          <section className="gh-insights-card gh-insights-risk-card">
            <CardHeader title="Risk Heatmap" tooltip="Risk counts from live criticality and metadata-gap evidence." />
            <RiskHeatmapPanel cells={data.riskHeatmap} />
          </section>

          <section className="gh-insights-card gh-insights-domain-card">
            <CardHeader title="Top Domains by Governance Maturity" tooltip="Domain scores derived from visible metadata completeness." />
            <DomainMaturityPanel
              items={data.domainLeaderboard}
              showAll={showAllDomains}
              onToggle={() => setShowAllDomains((value) => !value)}
            />
          </section>
        </main>

        <RecommendationRail recommendations={data.recommendations} onNavigate={onNavigate} />
      </div>
    </section>
  );
}

function CardHeader({ title, tooltip, action = null }) {
  return (
    <header className="gh-insights-card-header">
      <h2>
        <span>{title}</span>
        <button
          aria-label={`${title}: ${tooltip}`}
          className="ga-info-tooltip"
          title={tooltip}
          type="button"
        >
          i
        </button>
      </h2>
      {action}
    </header>
  );
}

export default InsightsWorkspace;
