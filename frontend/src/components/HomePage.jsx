import { useEffect, useMemo, useState } from "react";
import { fetchAtlasAiRecommendations } from "../lib/api";
import {
  AtlasAiPanel,
  DegradedBanner,
  DonutMetric,
  EmptyState,
  MetricCard,
  SectionCard,
} from "./northstar";

const EMPTY_ESTATE_SNAPSHOT = {
  visibleAssetCount: null,
  catalogCount: null,
  openRequests: null,
  coverageScore: null,
};

const EMPTY_COMMAND_CENTER = {
  estate: EMPTY_ESTATE_SNAPSHOT,
  kpis: [],
  posture: { overall: null, trend: [], byDomain: [], heatmap: [] },
  topDomains: [],
  recentEvents: [],
  quickActions: [],
  aiPrompts: [],
  meta: { state: "unknown", warnings: [] },
};

const KPI_DEFS = [
  { key: "governedAssets", label: "Governed Assets", icon: "assets", tooltip: "Actor-visible Unity Catalog assets included in this workspace snapshot." },
  { key: "certifiedCriticalAssets", label: "Certified Critical Assets", icon: "shield", tooltip: "Assets that are both critical and certified when both source signals are available." },
  { key: "metadataCoverage", label: "Metadata Coverage", icon: "coverage", tooltip: "Weighted coverage of required governance metadata across visible assets." },
  { key: "openStewardship", label: "Open Stewardship Actions", icon: "owner", tooltip: "Open governance requests and stewardship work items from the governance store." },
  { key: "policyExceptions", label: "Policy Exceptions", icon: "flag", tooltip: "Explicit policy-exception signals when available from governed workflow or audit data." },
  { key: "auditReadiness", label: "Audit Readiness", icon: "check", tooltip: "Composite audit readiness when the required control and evidence signals are available." },
];

const QUICK_ACTIONS = [
  { key: "discovery", label: "Browse Discovery", description: "Trusted assets", icon: "register", surface: "discovery" },
  { key: "governance", label: "Review Queue", description: "Open requests", icon: "policy", surface: "governance" },
  { key: "insights", label: "Review Quality", description: "Signals", icon: "quality", surface: "insights" },
  { key: "governance-access", label: "Access Reviews", description: "Governance", icon: "access", surface: "governance" },
  { key: "taxonomy", label: "Open Glossary", description: "Terms", icon: "glossary", surface: "taxonomy" },
  { key: "audit", label: "Audit Trail", description: "Evidence", icon: "audit", surface: "audit" },
];

const DEFAULT_HEATMAP_COLUMNS = [
  "Discoverability",
  "Ownership",
  "Classification",
  "Criticality",
  "Data Product",
];

function Icon({ name }) {
  const paths = {
    assets: (
      <>
        <path d="M5 6h14" />
        <path d="M5 12h14" />
        <path d="M5 18h14" />
        <path d="M8 4v4" />
        <path d="M8 10v4" />
        <path d="M8 16v4" />
      </>
    ),
    shield: <path d="M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6l-7-3Z" />,
    coverage: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4v4" />
        <path d="m17.6 6.4-2.8 2.8" />
      </>
    ),
    owner: (
      <>
        <circle cx="10" cy="8" r="3" />
        <path d="M4 20c.8-4 3-6 6-6s5.2 2 6 6" />
        <path d="M17 9h4" />
        <path d="M19 7v4" />
      </>
    ),
    flag: (
      <>
        <path d="M6 21V4" />
        <path d="M6 5h11.5l-2 4 2 4H6z" fill="currentColor" opacity="0.18" />
        <path d="M6 5h11.5l-2 4 2 4H6" />
        <path d="M9 8h4.5" />
        <path d="M9 11h3" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.2 2.2 2.2 4.8-5" />
      </>
    ),
    register: <path d="M4 12h16M12 4v16" />,
    policy: (
      <>
        <path d="M7 4h10v16H7z" />
        <path d="M10 8h4" />
        <path d="M10 12h4" />
      </>
    ),
    quality: (
      <>
        <path d="M4 17h4l3-10 4 12 2-6h3" />
        <path d="M4 21h16" />
      </>
    ),
    access: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.7-3.2 2.6-5 5.5-5" />
        <path d="M15 14h5v5h-5z" />
        <path d="M16 14v-1.3a1.8 1.8 0 0 1 3.6 0V14" />
      </>
    ),
    glossary: (
      <>
        <path d="M6 4h12v16H6z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </>
    ),
    audit: (
      <>
        <path d="M5 5h14v14H5z" />
        <path d="m8.5 12 2 2 5-5" />
      </>
    ),
    event: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v6" />
        <path d="M12 17h.01" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || paths.assets}
    </svg>
  );
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return Math.max(0, Math.trunc(numeric)).toLocaleString();
}

function formatMetricValue(kpi) {
  const value = kpi?.value;
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  if (kpi?.format === "percent") return `${Math.round(numeric)}%`;
  return formatCount(numeric);
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function metricState(kpi) {
  if (!kpi || kpi.state === "unavailable") return "unavailable";
  if (kpi.value === null || kpi.value === undefined || kpi.value === "") return "unavailable";
  return kpi.state || "available";
}

function fallbackKpi(def, estateSnapshot) {
  if (def.key === "governedAssets") {
    return { key: def.key, label: def.label, value: estateSnapshot.visibleAssetCount, format: "number" };
  }
  if (def.key === "metadataCoverage") {
    return {
      key: def.key,
      label: def.label,
      value: estateSnapshot.coverageScore,
      format: "percent",
      progress: estateSnapshot.coverageScore,
      state: estateSnapshot.coverageScore === null || estateSnapshot.coverageScore === undefined ? "unavailable" : "available",
    };
  }
  if (def.key === "openStewardship") {
    return { key: def.key, label: def.label, value: estateSnapshot.openRequests, format: "number" };
  }
  return { key: def.key, label: def.label, value: null, state: "unavailable" };
}

function normalizeCommandCenter(commandCenter, estate, recentAssets) {
  const center = commandCenter && typeof commandCenter === "object" ? commandCenter : {};
  return {
    ...EMPTY_COMMAND_CENTER,
    ...center,
    estate: {
      ...EMPTY_ESTATE_SNAPSHOT,
      ...(estate && typeof estate === "object" ? estate : {}),
      ...(center.estate && typeof center.estate === "object" ? center.estate : {}),
    },
    posture: {
      ...EMPTY_COMMAND_CENTER.posture,
      ...(center.posture && typeof center.posture === "object" ? center.posture : {}),
    },
    kpis: Array.isArray(center.kpis) ? center.kpis : [],
    topDomains: Array.isArray(center.topDomains) ? center.topDomains : [],
    recentEvents: Array.isArray(center.recentEvents) ? center.recentEvents : [],
    recentAssets: Array.isArray(center.recentAssets) ? center.recentAssets : recentAssets || [],
    quickActions: Array.isArray(center.quickActions) ? center.quickActions : [],
    aiPrompts: Array.isArray(center.aiPrompts) ? center.aiPrompts : [],
    meta: center.meta && typeof center.meta === "object" ? center.meta : EMPTY_COMMAND_CENTER.meta,
  };
}

function statusMetaFor({ state, warnings, refreshError }) {
  return {
    state,
    degraded: state === "degraded" || Boolean(refreshError) || warnings.length > 0,
    warnings: refreshError ? [refreshError] : warnings,
  };
}

function isShellScopeWarning(warning) {
  const text = String(warning || "");
  return /workspace-scoped app-principal/i.test(text) && /actor-scoped proof|per-user authorization|obo/i.test(text);
}

function GlobeNetworkVisual() {
  return (
    <div className="gh-home-globe" aria-hidden="true">
      <svg viewBox="0 0 760 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="gh-home-globe-core" cx="48%" cy="60%" r="58%">
            <stop offset="0%" stopColor="#0f8fd8" stopOpacity="0.74" />
            <stop offset="58%" stopColor="#0865a3" stopOpacity="0.46" />
            <stop offset="100%" stopColor="#03111f" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="gh-home-globe-line" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#66c5ff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#5ce1e6" stopOpacity="0.25" />
          </linearGradient>
          <radialGradient id="gh-home-globe-node" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#66c5ff" stopOpacity="0.3" />
          </radialGradient>
          <pattern id="gh-home-globe-city" width="24" height="18" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="4" r=".8" fill="#cfefff" opacity=".38" />
            <circle cx="13" cy="8" r=".7" fill="#66c5ff" opacity=".32" />
            <circle cx="21" cy="15" r=".55" fill="#5ce1e6" opacity=".26" />
          </pattern>
        </defs>
        <path d="M90 260c70-142 205-214 362-194 118 15 214 75 280 168" fill="url(#gh-home-globe-core)" />
        <path d="M104 254c72-128 195-192 348-184 121 6 221 58 300 157-86-25-178-40-276-44-128-5-252 19-372 71Z" fill="url(#gh-home-globe-city)" opacity=".42" />
        <path d="M96 250c72-126 190-190 340-182 126 7 226 59 306 156" fill="none" stroke="#2bb8ff" strokeOpacity=".55" strokeWidth="2" />
        <g fill="none" stroke="#7bd7ff" strokeLinecap="round" strokeLinejoin="round" opacity=".24">
          <path d="M260 176c18-14 38-20 58-15 14 4 24 2 34-8 12-12 30-14 52-6" />
          <path d="M420 134c18-16 44-20 76-12 16 4 31 2 44-6 18-10 41-8 70 7" />
          <path d="M250 206c34-10 62-9 86 3 19 9 45 9 78-1" />
          <path d="M500 186c29-13 58-14 88-2 22 9 48 10 79 3" />
        </g>
        <path d="M155 236c86-76 184-112 294-108 96 4 176 34 244 90" fill="none" stroke="#66c5ff" strokeOpacity=".35" />
        <path d="M126 242c112-38 230-55 354-50 92 4 177 18 256 43" fill="none" stroke="#66c5ff" strokeOpacity=".18" />
        <path d="M146 206c112-58 226-83 344-72 90 8 170 35 240 80" fill="none" stroke="#66c5ff" strokeOpacity=".2" />
        <path d="M222 220c58-114 122-166 194-156 75 11 128 86 160 178" fill="none" stroke="#66c5ff" strokeOpacity=".22" />
        <path d="M300 234c-6-82 18-144 72-185" fill="none" stroke="#66c5ff" strokeOpacity=".18" />
        <path d="M494 232c16-82-4-144-60-184" fill="none" stroke="#66c5ff" strokeOpacity=".18" />
        <path d="M380 60c-18 72-18 134 0 188" fill="none" stroke="#66c5ff" strokeOpacity=".22" />
        <g fill="none" stroke="url(#gh-home-globe-line)" strokeWidth="1.2">
          <path d="M212 185 302 142 407 168 520 112 644 158" />
          <path d="M260 226 407 168 560 220" />
          <path d="M302 142 448 88 520 112" />
          <path d="M344 214 407 168 448 88" />
          <path d="M178 216 260 226 344 214 470 236 560 220 690 238" />
          <path d="M238 156 302 142 356 104 448 88 574 132 690 176" />
          <path d="M156 238 212 185 238 156 356 104" />
          <path d="M520 112 574 132 644 158 690 176" />
        </g>
        {[156, 178, 212, 238, 260, 302, 344, 356, 407, 448, 470, 520, 560, 574, 644, 690].map((cx, index) => {
          const cy = [238, 216, 185, 156, 226, 142, 214, 104, 168, 88, 236, 112, 220, 132, 158, 176][index];
          return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index % 4 === 0 ? 3.8 : 2.4} fill="url(#gh-home-globe-node)" opacity={index % 2 ? 0.72 : 1} />;
        })}
        <g fill="#66c5ff" opacity=".36">
          {[190, 286, 392, 486, 612, 664].map((cx, index) => (
            <circle key={cx} cx={cx} cy={[132, 194, 122, 182, 206, 128][index]} r="1.4" />
          ))}
        </g>
        <g fill="#cfefff" opacity=".28">
          {[
            [228, 130], [246, 198], [276, 118], [318, 204], [332, 126], [374, 150],
            [430, 118], [462, 210], [512, 146], [540, 176], [594, 150], [628, 214],
            [672, 202], [704, 146],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}-micro`} cx={cx} cy={cy} r="0.9" />
          ))}
        </g>
        <g fill="#cfefff" opacity=".24">
          {[
            [244, 166], [268, 174], [292, 160], [316, 178], [340, 162], [366, 186],
            [394, 142], [416, 154], [438, 146], [462, 166], [486, 154], [510, 172],
            [536, 138], [560, 150], [584, 166], [608, 152], [632, 178], [656, 164],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}-city`} cx={cx} cy={cy} r="1.1" />
          ))}
        </g>
      </svg>
    </div>
  );
}

function TrendUnavailableChart() {
  return (
    <div className="gh-home-trend-chart" role="img" aria-label="Governance posture trend unavailable">
      <div className="gh-home-trend-axis">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
        <span>0%</span>
      </div>
      <div className="gh-home-trend-plot">
        <div className="gh-home-trend-grid" />
        <div className="gh-home-chart-empty">Trend history unavailable</div>
      </div>
    </div>
  );
}

function trendNumber(value) {
  if (!hasNumericValue(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : null;
}

function normalizeTrendPoint(point, index) {
  if (typeof point === "number") {
    return { label: `P${index + 1}`, overall: trendNumber(point), policy: null, quality: null };
  }
  if (!point || typeof point !== "object") {
    return { label: `P${index + 1}`, overall: null, policy: null, quality: null };
  }
  return {
    label: point.label || point.month || point.period || point.date || `P${index + 1}`,
    overall: trendNumber(point.overall ?? point.posture ?? point.value ?? point.score),
    policy: trendNumber(point.policyCompliance ?? point.policy ?? point.compliance),
    quality: trendNumber(point.dataQuality ?? point.quality),
  };
}

function normalizeTrend(trend = []) {
  return Array.isArray(trend) ? trend.map(normalizeTrendPoint) : [];
}

function seriesPath(points, key, width, height) {
  const pairs = points
    .map((point, index) => {
      const value = point[key];
      if (!Number.isFinite(value)) return null;
      const x = points.length > 1 ? (index / (points.length - 1)) * width : width / 2;
      const y = height - (value / 100) * height;
      return [x, y];
    })
    .filter(Boolean);
  if (pairs.length < 2) return "";
  return pairs.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

function PostureTrendChart({ trend = [] }) {
  const points = normalizeTrend(trend).filter((point) =>
    Number.isFinite(point.overall) || Number.isFinite(point.policy) || Number.isFinite(point.quality)
  );
  if (points.length < 2) return <TrendUnavailableChart />;

  const width = 360;
  const height = 156;
  const paths = [
    { key: "overall", className: "tone-posture", label: "Overall Posture" },
    { key: "policy", className: "tone-policy", label: "Policy Compliance" },
    { key: "quality", className: "tone-quality", label: "Data Quality" },
  ].map((series) => ({ ...series, path: seriesPath(points, series.key, width, height) }));

  return (
    <div className="gh-home-trend-chart" role="img" aria-label="Governance posture trend">
      <div className="gh-home-trend-axis">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
        <span>0%</span>
      </div>
      <div className="gh-home-trend-plot">
        <div className="gh-home-trend-grid" />
        <svg className="gh-home-trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {paths.map((series) => series.path ? (
            <path className={series.className} d={series.path} key={series.key} />
          ) : null)}
        </svg>
        <div className="gh-home-trend-months">
          {points.map((point) => <span key={point.label}>{String(point.label).slice(0, 8)}</span>)}
        </div>
      </div>
    </div>
  );
}

function trendDeltaLabel(trend = []) {
  const points = normalizeTrend(trend).filter((point) => Number.isFinite(point.overall));
  if (points.length < 2) return "Trend unavailable";
  const first = points[0];
  const last = points[points.length - 1];
  const delta = Math.round(last.overall - first.overall);
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}pp vs ${first.label}`;
}

function trendLegend(trend = []) {
  const points = normalizeTrend(trend).filter((point) =>
    Number.isFinite(point.overall) || Number.isFinite(point.policy) || Number.isFinite(point.quality)
  );
  const visibleSeries = [
    { key: "overall", className: "tone-posture", label: "Overall Posture" },
    { key: "policy", className: "tone-policy", label: "Policy Compliance" },
    { key: "quality", className: "tone-quality", label: "Data Quality" },
  ].filter((series) => points.filter((point) => Number.isFinite(point[series.key])).length >= 2);

  if (!visibleSeries.length) return null;

  return (
    <div className="gh-home-chart-legend" aria-label="Governance posture legend">
      {visibleSeries.map((series) => (
        <span key={series.key}><i className={series.className} /> {series.label}</span>
      ))}
    </div>
  );
}

function transformHeatmap(flatHeatmap, domains) {
  const cells = Array.isArray(flatHeatmap) ? flatHeatmap : [];
  const columns = Array.from(new Set(cells.map((cell) => cell.column).filter(Boolean)));
  const domainNames = Array.from(new Set([
    ...cells.map((cell) => cell.row).filter(Boolean),
    ...(Array.isArray(domains) ? domains.map((item) => item.domain || item.label).filter(Boolean) : []),
  ])).slice(0, 6);
  const resolvedColumns = (columns.length ? columns : DEFAULT_HEATMAP_COLUMNS).slice(0, 6);
  const rows = (domainNames.length ? domainNames : ["Unavailable"]).map((domain) => {
    const values = {};
    cells
      .filter((cell) => cell.row === domain)
      .forEach((cell) => {
        values[cell.column] = cell.value;
      });
    return { domain, values };
  });
  return { rows, columns: resolvedColumns };
}

function HeatmapPreview({ heatmap = [], domains = [] }) {
  const { rows, columns } = transformHeatmap(heatmap, domains);
  const hasAnyValue = rows.some((row) => columns.some((column) => hasNumericValue(row.values[column])));
  const gridStyle = { gridTemplateColumns: `86px repeat(${Math.max(1, columns.length)}, minmax(32px, 1fr))` };
  return (
    <div className="gh-home-heatmap" role="table" aria-label="Posture by domain">
      <div className="gh-home-heatmap-row gh-home-heatmap-head" role="row" style={gridStyle}>
        <span role="columnheader" />
        {columns.map((column) => (
          <span key={column} role="columnheader" title={column}>{column}</span>
        ))}
      </div>
      {rows.map((row) => (
        <div className="gh-home-heatmap-row" key={row.domain} role="row" style={gridStyle}>
          <strong role="rowheader">{row.domain}</strong>
          {columns.map((column) => {
            const numeric = hasNumericValue(row.values[column]) ? Number(row.values[column]) : null;
            const tone = numeric !== null
              ? numeric >= 80 ? "high" : numeric >= 55 ? "mid" : "low"
              : "empty";
            return (
              <span
                aria-label={`${row.domain} ${column}: ${numeric !== null ? `${Math.round(numeric)}%` : "unavailable"}`}
                className={`gh-home-heatmap-cell tone-${tone}`}
                key={column}
                role="cell"
              />
            );
          })}
        </div>
      ))}
      {!hasAnyValue ? <div className="gh-home-heatmap-empty">Domain signals unavailable</div> : null}
    </div>
  );
}

function relativeTimeLabel(value) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs >= 0) {
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function displayFirstName(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "there";
  const local = raw.includes("@") ? raw.split("@")[0] : raw;
  if (/^\d{6,}$/.test(local)) return "there";
  const first = local.split(/[\s._+-]+/).filter(Boolean)[0] || local;
  return first ? first[0].toUpperCase() + first.slice(1) : "there";
}

function isHighPriorityEvent(event) {
  const value = String(event?.priority || event?.severity || "").toLowerCase();
  return ["critical", "high", "p0", "p1"].includes(value);
}

function EventList({ events = [], emptyTitle = "No governance events available" }) {
  if (!events.length) {
    return (
      <div className="gh-home-event-empty">
        <span className="gh-home-event-icon tone-info"><Icon name="event" /></span>
        <div>
          <strong>{emptyTitle}</strong>
          <span>Recent audit and governance events will appear here when available.</span>
        </div>
      </div>
    );
  }
  return (
    <ul className="gh-home-event-list">
      {events.slice(0, 4).map((event, index) => (
        <li key={event.id || `${event.title}-${index}`}>
          <span className={`gh-home-event-icon tone-${event.tone || "info"}`}>
            <Icon name="event" />
          </span>
          <div>
            <strong>{event.title || "Governance event"}</strong>
            <span>{event.detail || "No event detail provided."}</span>
          </div>
          <time>{relativeTimeLabel(event.createdAt)}</time>
        </li>
      ))}
    </ul>
  );
}

export function HomePage({
  commandCenter = null,
  estate = EMPTY_ESTATE_SNAPSHOT,
  recentAssets = [],
  state = "ready",
  message = "",
  refreshing = false,
  refreshError = "",
  warnings = [],
  userName = "",
  atlasAiRequest = fetchAtlasAiRecommendations,
  onRetry,
  onNavigate,
}) {
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResponse, setAiResponse] = useState(null);
  const data = useMemo(
    () => normalizeCommandCenter(commandCenter, estate, recentAssets),
    [commandCenter, estate, recentAssets],
  );
  const statusMessage = useMemo(() => {
    if (state === "loading") return "Loading command center.";
    if (state === "error") return message || "Command center unavailable.";
    if (refreshError) return refreshError;
    if (warnings.length) return warnings[0];
    if (state === "degraded") return message || "Command center data is degraded.";
    return "";
  }, [message, refreshError, state, warnings]);
  const statusMeta = statusMetaFor({ state, warnings, refreshError });
  const shellAlreadyShowsScopeWarning =
    !refreshError && warnings.length > 0 && warnings.every(isShellScopeWarning);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previous = document.title;
    document.title = "Home - Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  const kpis = KPI_DEFS.map((def) => {
    const payloadKpi = data.kpis.find((kpi) => kpi.key === def.key || kpi.label === def.label);
    const merged = { ...fallbackKpi(def, data.estate), ...payloadKpi, ...def };
    if (payloadKpi && !payloadKpi.state && payloadKpi.value !== null && payloadKpi.value !== undefined && payloadKpi.value !== "") {
      delete merged.state;
    }
    return merged;
  });
  const postureOverall = hasNumericValue(data.posture?.overall)
    ? Math.round(Number(data.posture.overall))
    : null;
  const topDomains = data.topDomains.length ? data.topDomains : data.posture?.byDomain || [];
  const priorityEvents = data.recentEvents.filter(isHighPriorityEvent);
  const eventTitle = "Recent High-Priority Events";
  const openSurface = (surfaceKey) => {
    if (!surfaceKey) return;
    onNavigate?.(surfaceKey);
  };
  const aiPrompts = data.aiPrompts.length
    ? data.aiPrompts
    : [
      "Which domains need the most stewardship attention?",
      "Which critical assets are missing certification?",
      "What changed in governance metadata recently?",
      "Which assets have incomplete ownership?",
    ];
  const askAtlasAi = async (question) => {
    const resolvedQuestion = String(question || aiQuestion || "").trim();
    if (!resolvedQuestion || aiLoading) return;
    setAiQuestion(resolvedQuestion);
    setAiLoading(true);
    setAiError("");
    try {
      const response = await atlasAiRequest(resolvedQuestion);
      setAiResponse(response && typeof response === "object" ? response : null);
    } catch (error) {
      setAiResponse(null);
      setAiError(error?.message || "Atlas AI recommendations are unavailable.");
    } finally {
      setAiLoading(false);
    }
  };
  const aiEvidenceCount = Array.isArray(aiResponse?.evidence) ? aiResponse.evidence.length : 0;

  return (
    <section className="gh-home-page ga-page" aria-label="Governance Atlas home">
      <div className="gh-home-hero">
        <div className="gh-home-hero-copy">
          <h1>Enterprise Governance Command Center</h1>
          <p>Unified visibility. Trusted data. Confident decisions.</p>
        </div>
        <GlobeNetworkVisual />
      </div>

      {state === "loading" ? (
        <div className="gh-home-status" role="status">
          <span>{statusMessage}</span>
        </div>
      ) : state === "error" ? (
        <EmptyState
          tone="danger"
          title={statusMessage || "Command center unavailable."}
          message="The home snapshot could not be loaded from the live metadata plane."
          actions={onRetry ? (
            <button className="gh-tertiary-button gh-inline-link-button" type="button" onClick={() => onRetry()}>
              Retry
            </button>
          ) : null}
        />
      ) : statusMeta.degraded && !shellAlreadyShowsScopeWarning ? (
        <DegradedBanner meta={statusMeta} title="Data availability is limited" />
      ) : null}

      <section className="gh-home-kpis ga-kpi-grid six" aria-label="Executive governance metrics">
        {kpis.map((kpi) => {
          const stateLabel = metricState(kpi);
          const unavailable = stateLabel === "unavailable";
          const degraded = stateLabel === "degraded";
          const delta = kpi.delta || (degraded ? "Derived signal" : unavailable ? "Signal unavailable" : "");
          const tooltip = [kpi.tooltip, kpi.reason].filter(Boolean).join(" ");
          return (
            <MetricCard
              className={`gh-home-kpi tone-${kpi.icon} ${unavailable ? "is-unavailable" : ""}`}
              tooltip={tooltip}
              delta={delta}
              deltaTone={unavailable || degraded ? "warn" : "good"}
              icon={<Icon name={kpi.icon} />}
              key={kpi.key}
              label={kpi.label}
              meta=""
              progress={typeof kpi.progress === "number" ? kpi.progress : undefined}
              sparkline={Array.isArray(kpi.sparkline) ? kpi.sparkline : []}
              value={formatMetricValue(kpi)}
            />
          );
        })}
      </section>

      <div className="gh-home-dashboard-grid">
        <div className="gh-home-main-grid">
          <SectionCard
            className="gh-home-posture-card"
            title="Governance Posture Over Time"
            tooltip="Live trend history when historical posture snapshots are available."
            actions={<span className="gh-home-range-button" title="Current trend window">Last 6 Months</span>}
          >
            <div className="gh-home-posture-content">
              <div>
                <PostureTrendChart trend={data.posture?.trend || []} />
                {trendLegend(data.posture?.trend || [])}
              </div>
              <div className="gh-home-posture-donut">
                {postureOverall === null ? (
                  <div className="gh-home-donut-unavailable">
                    <strong>-</strong>
                    <span>Overall Posture</span>
                  </div>
                ) : (
                  <DonutMetric value={postureOverall} label="Overall Posture" size={138} />
                )}
                <span className="gh-home-posture-delta">
                  {trendDeltaLabel(data.posture?.trend || [])}
                </span>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            className="gh-home-heatmap-card"
            title="Posture by Domain"
            tooltip="Domain-level metadata, ownership, classification, criticality, and data-product posture."
            actions={<button className="ga-link-button" type="button" onClick={() => openSurface("insights")}>View all</button>}
          >
            <HeatmapPreview heatmap={data.posture?.heatmap || []} domains={topDomains} />
            <div className="gh-home-heatmap-legend">
              <span>Low</span>
              <i />
              <span>High</span>
            </div>
          </SectionCard>

          <SectionCard
            className="gh-home-top-domains"
            title="Top Domains"
            tooltip="Highest-coverage domains available from the command-center snapshot."
            actions={<button className="ga-link-button" type="button" onClick={() => openSurface("insights")}>View all</button>}
          >
            {topDomains.length ? (
              <ol className="gh-home-domain-list">
                {topDomains.slice(0, 5).map((domain, index) => {
                  const rawScore = domain.score ?? domain.value;
                  const hasScore = hasNumericValue(rawScore);
                  const score = hasScore ? Number(rawScore) : null;
                  return (
                    <li key={domain.domain || domain.label || index}>
                      <span>{index + 1}</span>
                      <strong>{domain.domain || domain.label || "Unassigned"}</strong>
                      <i aria-hidden="true"><b style={{ width: `${hasScore ? Math.max(0, Math.min(100, score)) : 0}%` }} /></i>
                      <em>{hasScore ? `${Math.round(score)}%` : "Unavailable"}</em>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="ga-chart-empty">No domain posture signals available.</div>
            )}
          </SectionCard>

          <SectionCard
            className="gh-home-events"
            title={eventTitle}
            tooltip="High-priority governance events from real audit and governance signals."
            actions={<button className="ga-link-button" type="button" onClick={() => openSurface("audit")}>View all</button>}
          >
            <EventList
              events={priorityEvents}
              emptyTitle="No high-priority events available"
            />
          </SectionCard>

          <SectionCard className="gh-home-actions" title="Quick Actions" tooltip="Primary actions route to the operational surfaces where the work is performed.">
            <div className="gh-home-action-grid">
              {QUICK_ACTIONS.map((action) => (
                <button
                  className="gh-home-action-tile"
                  key={action.key}
                  onClick={() => openSurface(action.surface)}
                  type="button"
                >
                  <span><Icon name={action.icon} /></span>
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </button>
              ))}
            </div>
          </SectionCard>
        </div>

        <AtlasAiPanel
          title="Ask Atlas AI"
          prompts={aiPrompts.slice(0, 4)}
          promptsDisabled={aiLoading}
          onPromptClick={askAtlasAi}
          moreLabel="More suggestions"
          onMoreSuggestions={() => askAtlasAi("Which governance issue should I prioritize next?")}
          footer={(
            <form
              className="gh-home-ai-input"
              onSubmit={(event) => {
                event.preventDefault();
                void askAtlasAi(aiQuestion);
              }}
            >
              <span className="sr-only">Ask Atlas AI a question</span>
              <input
                disabled={aiLoading}
                onChange={(event) => setAiQuestion(event.target.value)}
                placeholder="Coverage, certs, owners..."
                type="text"
                value={aiQuestion}
              />
              <button
                aria-label="Ask Atlas AI"
                disabled={aiLoading || !aiQuestion.trim()}
                type="button"
                onClick={() => askAtlasAi(aiQuestion)}
              >
                &gt;
              </button>
            </form>
          )}
        >
          <div className="gh-home-ai-copy">
            <strong>{`Hi, ${displayFirstName(userName)}. I'm Atlas AI.`}</strong>
            <span>Your data governance copilot.</span>
            {aiLoading ? (
              <div className="gh-home-ai-result" role="status">Checking governed metadata...</div>
            ) : aiError ? (
              <div className="gh-home-ai-result tone-warn" role="alert">{aiError}</div>
            ) : aiResponse?.answer ? (
              <div className="gh-home-ai-result" role="status">
                <strong>{aiResponse.answer}</strong>
                <span>
                  {aiEvidenceCount
                    ? `${aiEvidenceCount} evidence record${aiEvidenceCount === 1 ? "" : "s"} returned.`
                    : "No evidence records returned for this question."}
                </span>
              </div>
            ) : null}
          </div>
        </AtlasAiPanel>
      </div>
    </section>
  );
}

export default HomePage;
