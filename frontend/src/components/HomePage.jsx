import { useCallback, useEffect, useMemo, useState } from "react";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
import {
  DegradedBanner,
  EmptyState,
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
  meta: { state: "unknown", warnings: [] },
};

const KPI_DEFS = [
  { key: "governedAssets", label: "Governed Assets", icon: "assets", tooltip: "Actor-visible Unity Catalog assets included in this workspace snapshot." },
  { key: "certifiedCriticalAssets", label: "Certified Critical Assets", icon: "shield", tooltip: "Assets that are both critical and certified when both source signals are available." },
  { key: "metadataCoverage", label: "Metadata Coverage", icon: "coverage", tooltip: "Weighted coverage of required governance metadata across visible assets." },
  { key: "openStewardship", label: "Open Stewardship Actions", icon: "owner", tooltip: "" },
  { key: "policyExceptions", label: "Policy Exceptions", icon: "flag", tooltip: "Explicit policy-exception signals when available from governed workflow or audit data." },
  { key: "auditReadiness", label: "Audit Readiness", icon: "check", tooltip: "Composite audit readiness when the required control and evidence signals are available." },
];

// Trend windows slice the daily snapshot series (points are days).
const TREND_WINDOWS = [
  { key: "12w", label: "12w", points: 84 },
  { key: "26w", label: "26w", points: 182 },
  { key: "52w", label: "52w", points: 364 },
];

// ----- CountUp helper -----
// Animates a numeric value from 0 to `to` over `dur` ms using cubic ease-out.
// Honours prefers-reduced-motion and shows the final value immediately when
// the input is non-numeric or the user prefers reduced motion. The component
// renders a span with role="text" for screen readers; the formatted final
// value is announced once via aria-label so assistive tech doesn't read every
// frame.
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (event) => setReduced(event.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

function CountUp({ to, dur = 1100, decimals = 0, prefix = "", suffix = "", format }) {
  const reduced = useReducedMotion();
  const numericTarget = typeof to === "number" && Number.isFinite(to) ? to : null;
  const [value, setValue] = useState(() => {
    if (numericTarget === null) return null;
    if (reduced) return numericTarget;
    return 0;
  });
  useEffect(() => {
    if (numericTarget === null) {
      setValue(null);
      return undefined;
    }
    if (reduced) {
      setValue(numericTarget);
      return undefined;
    }
    let raf;
    const start = performance.now();
    const from = 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / dur);
      setValue(from + (numericTarget - from) * ease(t));
      if (t < 1) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => raf && window.cancelAnimationFrame(raf);
  }, [numericTarget, dur, reduced]);
  if (numericTarget === null || value === null) {
    return <span aria-label="Signal unavailable">-</span>;
  }
  const display = format
    ? format(value)
    : value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
  const finalDisplay = format
    ? format(numericTarget)
    : numericTarget.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
  return (
    <span className="ga-count-up tnum" aria-label={`${prefix}${finalDisplay}${suffix}`}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

// Parse a value that may already be formatted (e.g. "1,247", "87.4%", "+9 pts")
// into a raw numeric for the CountUp animation. Returns { numeric, prefix,
// suffix, decimals } so we can re-render the original formatting at the end of
// the animation. Returns numeric=null when the input isn't a number-bearing
// string, in which case CountUp falls back to "-".
function parseAnimatable(rawValue) {
  if (rawValue === null || rawValue === undefined) return { numeric: null };
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue)
      ? { numeric: rawValue, prefix: "", suffix: "", decimals: 0 }
      : { numeric: null };
  }
  const text = String(rawValue).trim();
  if (!text || text === "-") return { numeric: null };
  // Pull leading non-digit characters (e.g. currency, "+", "-") as the prefix
  // and trailing non-digit characters (e.g. "%", " pts", "/ 100") as suffix.
  const match = text.match(/^([^0-9.,-]*)(-?[\d,]+(?:\.[\d]+)?)(.*)$/);
  if (!match) return { numeric: null };
  const numeric = parseFloat(match[2].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return { numeric: null };
  const decimals = match[2].includes(".") ? match[2].split(".")[1].length : 0;
  return { numeric, prefix: match[1], suffix: match[3], decimals };
}

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
    database: (
      <>
        <ellipse cx="12" cy="5" rx="6" ry="2.5" />
        <path d="M6 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5" />
        <path d="M6 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    presentation: (
      <>
        <path d="M4 5h16v10H4z" />
        <path d="M12 15v5" />
        <path d="m8 20 4-4 4 4" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="m10.5 10.5 8 8" />
        <path d="m15 15 2-2" />
        <path d="m17 17 2-2" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
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

function CommandCenterTrustRing({ value = 0, trend = "Trend unavailable", label = "Posture", size = 200 }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const displayValue = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
  const stroke = 14;
  const radius = (size - stroke - 24) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const center = size / 2;
  const ticks = Array.from({ length: 60 }, (_, index) => {
    const angle = (index / 60) * Math.PI * 2 - Math.PI / 2;
    const r1 = radius + 14;
    const r2 = radius + (index % 5 === 0 ? 18 : 16);
    return {
      index,
      major: index % 5 === 0,
      x1: center + Math.cos(angle) * r1,
      y1: center + Math.sin(angle) * r1,
      x2: center + Math.cos(angle) * r2,
      y2: center + Math.sin(angle) * r2,
    };
  });

  return (
    <div className="gh-command-center-trust-ring" style={{ width: size, height: size }}>
      <div className="gh-command-center-trust-glow" aria-hidden="true" />
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="commandCenterRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3D84AD" />
            <stop offset="60%" stopColor="#66C5FF" />
            <stop offset="100%" stopColor="#5CE1E6" />
          </linearGradient>
        </defs>
        <circle className="gh-command-center-trust-outer" cx={center} cy={center} r={radius + 10} />
        {ticks.map((tick) => (
          <line
            className={tick.major ? "is-major" : ""}
            key={tick.index}
            x1={tick.x1}
            x2={tick.x2}
            y1={tick.y1}
            y2={tick.y2}
          />
        ))}
        <circle className="gh-command-center-trust-track" cx={center} cy={center} r={radius} />
        <circle
          className="gh-command-center-trust-value"
          cx={center}
          cy={center}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="gh-command-center-trust-center">
        <span>{label}</span>
        <strong>{displayValue}<small>%</small></strong>
        {/* "History since…" is provenance, not a delta — the green "+"
            badge on it read as a positive trend and crowded the ring. */}
        <em
          data-trend-state={
            /(unavailable|^-$)/i.test(String(trend))
              ? "unavailable"
              : /^(history since|trend history|collecting)/i.test(String(trend).trim())
                ? "history"
                : "delta"
          }
        >
          {trend}
        </em>
      </div>
    </div>
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
  if (kpi?.format === "percent") {
    return Number.isInteger(numeric) ? `${numeric.toFixed(0)}%` : `${numeric.toFixed(1)}%`;
  }
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

function isPrototypeMockWarning(warning) {
  return isNonAuthoritativeMockEvidence(String(warning || ""));
}

function commandCenterWarnings(data, warnings = []) {
  return Array.from(new Set([
    ...(Array.isArray(warnings) ? warnings : []),
    ...((data?.meta && Array.isArray(data.meta.warnings)) ? data.meta.warnings : []),
  ].map((warning) => String(warning || "").trim()).filter(Boolean)));
}

function commandCenterEvidenceKind(data, warnings = [], state = "ready") {
  const allWarnings = commandCenterWarnings(data, warnings);
  const markers = [
    data?.state,
    data?.source,
    data?.evidenceKind,
    data?.evidence_kind,
    data?.meta?.state,
    data?.meta?.source,
    data?.meta?.evidenceKind,
    data?.meta?.evidence_kind,
    data?.meta?.sourceKind,
    state,
  ].map((value) => String(value || "").trim().toLowerCase());

  if (markers.some((value) => value.includes("prototype") || value.includes("mock")) || allWarnings.some(isPrototypeMockWarning)) {
    return "non_authoritative";
  }
  if (markers.includes("seed") || markers.includes("loading")) return "hydrating";
  if (
    data?.authoritative === false ||
    data?.meta?.authoritative === false ||
    data?.provenance?.authoritative === false ||
    data?.meta?.liveDatabricksEvidence === false ||
    data?.meta?.live_databricks_evidence === false
  ) {
    return "degraded";
  }
  if (markers.includes("degraded") || allWarnings.length) return "degraded";
  return "live";
}

function provenanceSummary(evidenceKind) {
  if (evidenceKind === "hydrating") {
    return "Command-center metadata is hydrating; unavailable values remain blank until backed evidence arrives.";
  }
  if (evidenceKind === "degraded") {
    return "Databricks-backed command-center evidence is workspace-scoped or partially unavailable; unavailable signals remain marked unavailable.";
  }
  if (evidenceKind === "non_authoritative") {
    return "Non-authoritative command-center evidence; unverified signals remain marked unavailable.";
  }
  return "Databricks-backed command-center evidence from the configured metadata plane.";
}

function isDeployedDatabricksAppHost() {
  if (typeof window === "undefined") return false;
  const host = String(window.location?.hostname || "").toLowerCase();
  return host.endsWith(".databricksapps.com");
}

function isDatabricksBackedCommandCenter(data, evidenceKind) {
  if (!data || evidenceKind === "non_authoritative" || evidenceKind === "hydrating") {
    return false;
  }
  const markers = [
    data.source,
    data.evidenceKind,
    data.evidence_kind,
    data.meta?.source,
    data.meta?.evidenceKind,
    data.meta?.evidence_kind,
    data.provenance?.source,
  ].map((value) => String(value || "").toLowerCase());
  const sourceIsDatabricks =
    markers.some((value) => value.includes("unity-catalog") || value.includes("governance-store") || value.includes("databricks"));
  const hasBackedSignal =
    Number.isFinite(Number(data.estate?.visibleAssetCount)) ||
    Number.isFinite(Number(data.estate?.catalogCount)) ||
    Number.isFinite(Number(data.estate?.coverageScore)) ||
    (Array.isArray(data.recentAssets) && data.recentAssets.length > 0);
  if (evidenceKind === "live" && hasBackedSignal) return true;
  return sourceIsDatabricks && hasBackedSignal;
}

function TrendUnavailableChart({ point = null, collectingSince = "" }) {
  const hasPoint = Number.isFinite(point);
  const pointY = hasPoint ? 8 + ((100 - Math.max(0, Math.min(100, point))) / 100) * 134 : null;
  return (
    <div
      className="gh-home-trend-chart"
      role="img"
      aria-label={hasPoint
        ? `Trend history collecting since ${collectingSince || "today"}`
        : "Governance posture trend unavailable"}
    >
      <div className="gh-home-trend-axis">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
        <span>0%</span>
      </div>
      <div className="gh-home-trend-plot">
        <div className="gh-home-trend-grid" />
        {hasPoint ? (
          <svg className="gh-home-trend-svg" viewBox="0 0 360 156" preserveAspectRatio="none" aria-hidden="true">
            <line className="gh-home-trend-line tone-posture" x1="24" x2="336" y1={pointY} y2={pointY} strokeDasharray="4 6" opacity="0.5" />
            <circle className="gh-home-trend-latest" cx="330" cy={pointY} r="4" />
          </svg>
        ) : null}
        <div className="gh-home-chart-empty">
          {hasPoint
            ? `Daily snapshots recording — history since ${collectingSince || "today"}`
            : "Trend history unavailable"}
        </div>
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

function formatPathNumber(value) {
  return Number(value).toFixed(1);
}

function smoothLinePath(pairs) {
  if (pairs.length < 2) return "";
  let path = `M${formatPathNumber(pairs[0][0])} ${formatPathNumber(pairs[0][1])}`;
  for (let index = 0; index < pairs.length - 1; index += 1) {
    const previous = pairs[index - 1] || pairs[index];
    const current = pairs[index];
    const next = pairs[index + 1];
    const afterNext = pairs[index + 2] || next;
    const cp1x = current[0] + (next[0] - previous[0]) / 6;
    const cp1y = current[1] + (next[1] - previous[1]) / 6;
    const cp2x = next[0] - (afterNext[0] - current[0]) / 6;
    const cp2y = next[1] - (afterNext[1] - current[1]) / 6;
    path += ` C${formatPathNumber(cp1x)} ${formatPathNumber(cp1y)} ${formatPathNumber(cp2x)} ${formatPathNumber(cp2y)} ${formatPathNumber(next[0])} ${formatPathNumber(next[1])}`;
  }
  return path;
}

function smoothAreaPath(pairs, baseline) {
  if (pairs.length < 2) return "";
  const line = smoothLinePath(pairs).replace(/^M[^\s]+ [^\s]+/, "");
  const first = pairs[0];
  const last = pairs[pairs.length - 1];
  return [
    `M${formatPathNumber(first[0])} ${formatPathNumber(baseline)}`,
    `L${formatPathNumber(first[0])} ${formatPathNumber(first[1])}`,
    line,
    `L${formatPathNumber(last[0])} ${formatPathNumber(baseline)}`,
    "Z",
  ].join(" ");
}

function metricSparklineShape(values = [], width = 100, height = 36) {
  const indexedValues = (Array.isArray(values) ? values : [])
    .map((value, index) => ({ value: Number(value), index }))
    .filter((item) => Number.isFinite(item.value));
  if (indexedValues.length < 2) return null;
  const rawValues = indexedValues.map((item) => item.value);
  const min = Math.min(...rawValues);
  const max = Math.max(...rawValues);
  const range = max - min || 1;
  const count = Math.max(1, values.length - 1);
  const pairs = indexedValues.map(({ value, index }) => {
    const x = (index / count) * width;
    const y = height - 2 - ((value - min) / range) * (height - 8);
    return [x, y];
  });
  return {
    line: smoothLinePath(pairs),
    area: smoothAreaPath(pairs, height - 1),
  };
}

function trendScale(points, key) {
  const values = points
    .map((point) => point[key])
    .filter((value) => Number.isFinite(value));
  const min = Math.min(...values) - 2;
  const max = Math.max(...values) + 2;
  return { min, max, range: max - min || 1 };
}

function trendY(value, scale, height) {
  return 8 + ((scale.max - value) / scale.range) * (height - 22);
}

function trendPairs(points, key, width, height, scale = trendScale(points, key)) {
  return points
    .map((point, index) => {
      const value = point[key];
      if (!Number.isFinite(value)) return null;
      const x = points.length > 1 ? (index / (points.length - 1)) * width : width / 2;
      const y = trendY(value, scale, height);
      return [x, y];
    })
    .filter(Boolean);
}

function trendSeries(points) {
  return [
    { key: "overall", className: "tone-posture", label: "Overall Posture" },
    { key: "policy", className: "tone-policy", label: "Policy Compliance" },
    { key: "quality", className: "tone-quality", label: "Data Quality" },
  ].find((series) => points.filter((point) => Number.isFinite(point[series.key])).length >= 2);
}

function visibleTrendTicks(points) {
  if (points.length <= 7) return points;
  const cadence = Math.ceil(points.length / 6);
  return points.filter((_, index) => index === 0 || index === points.length - 1 || index % cadence === 0);
}

function PostureTrendChart({ trend = [], collectingSince = "" }) {
  const points = normalizeTrend(trend).filter((point) =>
    Number.isFinite(point.overall) || Number.isFinite(point.policy) || Number.isFinite(point.quality)
  );
  if (points.length === 1) {
    return (
      <TrendUnavailableChart
        point={points[0].overall}
        collectingSince={collectingSince || points[0].label}
      />
    );
  }
  if (points.length < 2) return <TrendUnavailableChart />;

  const width = 360;
  const height = 156;
  const series = trendSeries(points);
  if (!series) return <TrendUnavailableChart />;
  const scale = trendScale(points, series.key);
  const pairs = trendPairs(points, series.key, width, height, scale);
  const linePath = smoothLinePath(pairs);
  const areaPath = smoothAreaPath(pairs, height);
  const latest = pairs[pairs.length - 1];
  const ticks = visibleTrendTicks(points);

  return (
    <div className="gh-home-trend-chart" role="img" aria-label={`Governance posture trend: ${series.label}`}>
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
          <defs>
            <linearGradient id="gh-command-center-trend-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
              <stop offset="62%" stopColor="currentColor" stopOpacity="0.15" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className={`gh-home-trend-area ${series.className}`} d={areaPath} />
          <path className={`gh-home-trend-line ${series.className}`} d={linePath} />
          {latest ? <circle className="gh-home-trend-latest" cx={latest[0]} cy={latest[1]} r="4" /> : null}
        </svg>
        <div className="gh-home-trend-months">
          {ticks.map((point) => <span key={point.label}>{trendTickLabel(point.label)}</span>)}
        </div>
      </div>
    </div>
  );
}

// Human-readable tick/date label. ISO dates become "Jul 20" instead of the
// old `slice(0, 8)` truncation that produced footers like "0pp vs 2026-07-".
function trendTickLabel(label) {
  const text = String(label || "").trim();
  if (!text) return text;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text.slice(0, 10) + "T00:00:00Z");
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    }
  }
  return text;
}

// "evidence from May 3" stamp for signals whose backing run is older than the
// panel implies. Empty string when no usable timestamp exists.
function evidenceDateLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `evidence from ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function trendDeltaLabel(trend = []) {
  const points = normalizeTrend(trend).filter((point) => Number.isFinite(point.overall));
  // A delta needs at least two snapshots; one point is history collection,
  // not a trend.
  if (points.length < 2) return "Trend unavailable";
  const first = points[0];
  const last = points[points.length - 1];
  const delta = Math.round(last.overall - first.overall);
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}pp vs ${trendTickLabel(first.label)}`;
}

function trendForWindow(trend = [], windowKey = "12w") {
  const selectedWindow = TREND_WINDOWS.find((item) => item.key === windowKey) || TREND_WINDOWS[0];
  const points = normalizeTrend(trend);
  return points.length > selectedWindow.points ? points.slice(-selectedWindow.points) : points;
}

function kpiByKey(kpis = [], key) {
  return kpis.find((item) => item?.key === key || item?.label === key) || null;
}

function numericValue(value) {
  if (!hasNumericValue(value)) return null;
  return Number(value);
}

// One percent formatter everywhere: whole numbers stay whole, fractional
// values keep one decimal. The ring, narrative, KPI tiles, and topbar badge
// previously mixed Math.round with toFixed(1), so one screen showed the same
// coverage as 95.5% and 96% simultaneously.
function percentLabel(value, fallback = "-") {
  const numeric = numericValue(value);
  if (numeric === null) return fallback;
  return Number.isInteger(numeric) ? `${numeric.toFixed(0)}%` : `${numeric.toFixed(1)}%`;
}

const percentPointLabel = percentLabel;

function shortDelta(kpi, fallback = "Unavailable") {
  if (!kpi) return fallback;
  const text = kpi.deltaText || kpi.delta || kpi.detail;
  if (text) return text;
  // A KPI with a real value but no trend history must never read "Signal
  // unavailable" — the signal IS available, only its history is young.
  if (kpi.trendState === "collecting") {
    return kpi.collectingSince ? `History since ${kpi.collectingSince}` : "Trend history collecting";
  }
  if (metricState(kpi) === "available") return "No trend history yet";
  return kpi.reason || fallback;
}

function summarizeCatalogs(assets = []) {
  const byCatalog = new Map();
  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    const catalog = asset?.catalog || String(asset?.fqn || "").split(".")[0] || "";
    if (!catalog) return;
    const entry = byCatalog.get(catalog) || {
      name: catalog,
      tables: 0,
      coverageValues: [],
      classifications: new Set(),
      risk: "Unavailable",
    };
    entry.tables += 1;
    const coverage = numericValue(asset.metadataCoverage ?? asset.coverage ?? asset.coverageScore);
    if (coverage !== null) entry.coverageValues.push(coverage);
    const classification = asset.classification || asset.sensitivity || asset.sensitivityLabel;
    if (classification) entry.classifications.add(classification);
    const risk = String(asset.risk || asset.criticality || "").toLowerCase();
    if (["high", "critical"].includes(risk)) entry.risk = "High";
    else if (["medium", "moderate"].includes(risk) && entry.risk !== "High") entry.risk = "Medium";
    else if (risk && entry.risk === "Unavailable") entry.risk = "Low";
    byCatalog.set(catalog, entry);
  });
  return Array.from(byCatalog.values())
    .map((entry) => {
      const coverage = entry.coverageValues.length
        ? entry.coverageValues.reduce((sum, value) => sum + value, 0) / entry.coverageValues.length
        : null;
      return {
        ...entry,
        coverage,
        classification: entry.classifications.size ? Array.from(entry.classifications)[0] : "Unclassified",
      };
    })
    // Worst coverage first to match the backed payload ordering; never
    // truncate — hiding catalogs is how `datapact 89.8%` vanished.
    .sort((a, b) => (a.coverage ?? 101) - (b.coverage ?? 101));
}

function backedCatalogRows(data, assets = []) {
  const explicitRows = data?.catalogHealth || data?.catalogs || data?.topCatalogs;
  const rows = Array.isArray(explicitRows) ? explicitRows : [];
  const normalized = rows
    .map((row) => ({
      name: row.name || row.catalog || row.catalogName || "",
      tables: numericValue(row.tables ?? row.tableCount ?? row.assets ?? row.assetCount),
      coverage: numericValue(row.coverage ?? row.coverageScore ?? row.metadataCoverage),
      classification: row.classified || row.classification || row.sensitivity || "Unclassified",
      risk: row.risk || row.riskLevel || "Unavailable",
      state: row.state || "available",
    }))
    .filter((row) => row.name);
  // The payload is complete and worst-first; slicing here re-introduced the
  // "worst catalog invisible" defect. Render everything the API returned.
  return normalized.length ? normalized : summarizeCatalogs(assets);
}

function domainBars(domains = []) {
  return (Array.isArray(domains) ? domains : [])
    .map((domain, index) => {
      const score = numericValue(domain.score ?? domain.value ?? domain.coverage);
      const label = domain.domain || domain.label || domain.name || `Domain ${index + 1}`;
      const count = numericValue(domain.count ?? domain.assets ?? domain.assetCount);
      const tone = domain.tone || (
        score === null ? "empty" :
        score >= 90 ? "high" :
        score >= 84 ? "good" :
        score >= 78 ? "mid" :
        "warn"
      );
      return { label, score, count, tone };
    })
    // Complete worst-first list — a posture panel that hides the worst
    // domains defeats its purpose, so no top-N slice here.
    .filter((domain) => domain.label);
}

function cdeNameFromAsset(asset) {
  const term = asset?.glossaryTerm || (Array.isArray(asset?.glossaryTerms) ? asset.glossaryTerms[0] : "");
  return term || asset?.name || String(asset?.fqn || "").split(".").pop() || "Critical data element";
}

function cdeRows(data, assets = []) {
  const explicitRows = data?.cdes || data?.criticalDataElements || data?.cdeItems;
  const rows = Array.isArray(explicitRows) ? explicitRows : [];
  const normalized = rows
    .map((row) => ({
      id: row.id || row.column || row.assetFqn || row.name,
      name: row.name || row.term || "Critical data element",
      column: row.column || row.sourceColumn || row.assetFqn || row.fqn || "",
      owner: row.owner || row.steward || row.team || "",
      status: row.status || row.controlState || row.health || "",
      sox: Boolean(row.sox) || /sox/i.test(String(row.tags || row.badges || "")),
      assetFqn: row.assetFqn || row.fqn || "",
      state: row.state || "available",
    }))
    .filter((row) => row.id || row.name);
  if (normalized.length) return normalized.slice(0, 4);

  return (Array.isArray(assets) ? assets : [])
    .filter((asset) => {
      const haystack = [
        asset?.criticality,
        asset?.tier,
        asset?.glossaryTerm,
        ...(Array.isArray(asset?.glossaryTerms) ? asset.glossaryTerms : []),
        ...(Array.isArray(asset?.tagLabels) ? asset.tagLabels : []),
        asset?.tags && typeof asset.tags === "object" ? Object.values(asset.tags).join(" ") : asset?.tags,
      ].join(" ").toLowerCase();
      return haystack.includes("critical") || haystack.includes("cde") || haystack.includes("sox");
    })
    .slice(0, 4)
    .map((asset) => ({
      id: asset.fqn || asset.name,
      name: cdeNameFromAsset(asset),
      column: asset.fqn || "",
      owner: Array.isArray(asset.owners) && asset.owners.length ? asset.owners[0].name : asset.owner || asset.domain || "",
      status: asset.certification && asset.certification !== "Unassigned" ? asset.certification : "Review required",
      sox: /sox/i.test(JSON.stringify(asset.tags || asset.tagLabels || "")),
      assetFqn: asset.fqn || "",
      state: "available",
    }));
}

function riskSummaryFromData(data, policyKpi, governedAssetsKpi) {
  const raw = data?.riskBreakdown || data?.risk || data?.exposureSummary || {};
  const high = numericValue(raw.high ?? raw.highRisk ?? raw.highRiskExposures);
  const medium = numericValue(raw.medium ?? raw.mediumRisk ?? raw.mediumRiskFindings);
  const informational = numericValue(raw.informational ?? raw.info ?? raw.low ?? raw.lowRisk);
  const openExposure = numericValue(raw.open ?? raw.openExposures ?? raw.total ?? raw.totalExposures ?? policyKpi?.value);
  const clean = numericValue(raw.cleanScore ?? raw.riskClean ?? raw.riskCleanScore);
  const governed = numericValue(governedAssetsKpi?.value);
  // Risk-clean must count medium findings too — excluding them overstated
  // cleanliness whenever medium-severity findings existed.
  const actionableFindings = high !== null || medium !== null
    ? (high || 0) + (medium || 0)
    : null;
  const derivedClean = clean !== null
    ? clean
    : actionableFindings !== null && governed && governed > 0
      ? Math.max(0, Math.min(100, ((governed - actionableFindings) / governed) * 100))
      : null;
  return {
    cleanScore: derivedClean,
    high,
    medium,
    informational,
    openExposure,
    severityAvailable: high !== null || medium !== null || informational !== null,
    sourceAvailable: clean !== null || high !== null || medium !== null || informational !== null || openExposure !== null,
  };
}

function relativeTimeLabel(value) {
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

function isHighPriorityEvent(event) {
  const value = String(event?.priority || event?.severity || "").toLowerCase();
  return ["critical", "high", "p0", "p1"].includes(value);
}

function eventRows(events = []) {
  return (Array.isArray(events) ? events : []).slice(0, 5).map((event, index) => ({
    id: event.id || `${event.title || "event"}-${index}`,
    title: event.title || "Governance event",
    detail: event.detail || event.description || "No event detail provided.",
    actor: event.actor || event.user || event.owner || "Governance Atlas",
    time: relativeTimeLabel(event.createdAt || event.timestamp || event.time),
    tone: event.tone || (isHighPriorityEvent(event) ? "bad" : "info"),
    target: event.target || event.assetFqn || event.fqn || "",
    evidenceUrl: event.evidenceUrl || event.evidenceHref || "",
  }));
}

function explicitChangeRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((item, index) => ({
      label: item?.label || item?.metric || `Change ${index + 1}`,
      value: item?.value,
      delta: item?.delta || item?.detail || "",
      previous: item?.previous ?? item?.previousValue ?? null,
      previousFormat: item?.previousFormat || item?.format || "count",
      format: item?.format || item?.valueFormat || item?.previousFormat || "count",
      tone: item?.tone || "info",
    }))
    .filter((item) => item.label);
}

function formatChangeValue(value, format = "count") {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string" && !Number.isFinite(Number(value))) return value;
  return format === "percent" ? percentPointLabel(value) : formatCount(value);
}

function availableKpi(kpis, key, fallback) {
  return kpiByKey(kpis, key) || fallback;
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
  hydrating = false,
  onRetry,
  onNavigate,
  // When provided, activity-stream events whose `target` looks like a fully-
  // qualified asset name (catalog.schema.table) open the Asset 360 drawer
  // overlay instead of jumping the surface to the Audit browser. Falls back
  // to the existing onNavigate("audit") flow when no FQN is present.
  onOpenAsset360Drawer = null,
  // When provided, chip clicks (Customer / Finance / etc. domain bars,
  // catalog cards, etc.) navigate into Discovery with a pre-applied filter
  // so the user lands on a meaningfully scoped result set instead of an
  // unfiltered list. Signature: ({domains?: string[], catalogs?: string[],
  // tiers?: string[], certifications?: string[], sensitivities?: string[]},
  // optionalQuery?: string) => void.
  onOpenDiscoveryWithFilter = null,
}) {
  const [trendWindow, setTrendWindow] = useState("26w");
  const [presentMode, setPresentMode] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  // Which KPI tile's "how is this calculated" popover is open (by label).
  const [openKpiInfo, setOpenKpiInfo] = useState("");
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onFullscreenChange = () => {
      setPresentMode(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  const normalizedData = useMemo(
    () => normalizeCommandCenter(commandCenter, estate, recentAssets),
    [commandCenter, estate, recentAssets],
  );
  const rejectedNonAuthoritativePayload = isNonAuthoritativeMockEvidence(
    commandCenter,
    normalizedData.meta,
    warnings,
  );
  const data = useMemo(
    () =>
      rejectedNonAuthoritativePayload
        ? normalizeCommandCenter(null, EMPTY_ESTATE_SNAPSHOT, [])
        : normalizedData,
    [normalizedData, rejectedNonAuthoritativePayload],
  );
  const evidenceMeta = useMemo(
    () => (rejectedNonAuthoritativePayload ? normalizedData.meta || {} : data.meta || {}),
    [data.meta, normalizedData.meta, rejectedNonAuthoritativePayload],
  );
  const statusMessage = useMemo(() => {
    if (hydrating) return "Hydrating live Unity Catalog command center.";
    if (state === "loading") return "Loading command center.";
    if (refreshing) return "Refreshing live command center.";
    if (state === "error") return message || "Command center unavailable.";
    if (refreshError) return refreshError;
    if (warnings.length) return warnings[0];
    if (state === "degraded") return message || "Command center data is degraded.";
    return "";
  }, [hydrating, message, refreshError, refreshing, state, warnings]);
  const statusMeta = statusMetaFor({ state, warnings, refreshError });
  const evidenceKind = rejectedNonAuthoritativePayload
    ? "non_authoritative"
    : commandCenterEvidenceKind(data, warnings, state);
  const evidenceWarnings = commandCenterWarnings(data, warnings);
  const isLiveEvidence = evidenceKind === "live";
  const databricksBackedMetadata = isDatabricksBackedCommandCenter(data, evidenceKind);
  const commandCenterRefreshLabel = isLiveEvidence && (data.meta?.generatedAt || data.meta?.updatedAt || data.meta?.observedAt)
      ? `Live · refreshed ${relativeTimeLabel(data.meta.generatedAt || data.meta.updatedAt || data.meta.observedAt)}`
      : isLiveEvidence
        ? "Live"
        : databricksBackedMetadata
          ? "Databricks-backed · workspace scope"
          : "Not live verified";
  const heroDescription = isLiveEvidence || databricksBackedMetadata
      ? "Backed values use live Unity Catalog and governance-store signals; unavailable values are labeled instead of inferred."
      : provenanceSummary(evidenceKind);
  const shellAlreadyShowsScopeWarning =
    !refreshError && warnings.length > 0 && warnings.every(isShellScopeWarning);
  const warningOnlyNeedsShellProvenance =
    !refreshError && warnings.length > 0 && warnings.every((warning) =>
      isShellScopeWarning(warning) || isPrototypeMockWarning(warning),
    );

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
    ? Number(data.posture.overall)
    : null;
  // Prefer the COMPLETE worst-first byDomain list; topDomains is a top-5
  // convenience slice that hid the worst-scoring domains from this panel.
  const topDomains = (Array.isArray(data.posture?.byDomain) && data.posture.byDomain.length)
    ? data.posture.byDomain
    : data.topDomains;
  const openSurface = (surfaceKey) => {
    if (!surfaceKey) return;
    onNavigate?.(surfaceKey);
  };
  const isHydrating = hydrating || state === "loading";
  const governedAssetsKpi = availableKpi(kpis, "governedAssets", {
    value: data.estate.visibleAssetCount,
    format: "number",
  });
  const coverageKpi = availableKpi(kpis, "metadataCoverage", {
    value: data.estate.coverageScore,
    format: "percent",
  });
  const certifiedKpi = availableKpi(kpis, "certifiedCriticalAssets", {
    value: null,
    state: "unavailable",
  });
  const stewardshipKpi = availableKpi(kpis, "openStewardship", {
    value: data.estate.openRequests,
    format: "number",
  });
  const policyKpi = availableKpi(kpis, "policyExceptions", {
    value: null,
    state: "unavailable",
  });
  const coverageValue = numericValue(coverageKpi.value);
  const postureValue = postureOverall ?? coverageValue;
  const postureTitle = postureOverall !== null
    ? "Governance posture"
    : coverageValue !== null
      ? "Metadata coverage"
      : "Governance posture unavailable";
  // Ring/trend caption: prefer a real delta; while snapshot history is
  // young, say so with the collection start date instead of "unavailable".
  const postureTrendLabel = (() => {
    // Delta labels require >= 2 snapshots; while collecting, say so honestly.
    if (data.posture?.trendState === "collecting") {
      return `History since ${trendTickLabel(data.posture?.collectingSince) || "today"}`;
    }
    return trendDeltaLabel(data.posture?.trend || []);
  })();
  const domainSignalTitle = postureOverall !== null ? "Posture by domain" : "Coverage by domain";
  const domainSignalName = postureOverall !== null ? "domain posture" : "domain coverage";
  const domainSignalUnavailableText = postureOverall !== null
    ? "Domain posture signals unavailable."
    : "Domain coverage signals unavailable.";
  const domainBarItems = domainBars(topDomains);
  const catalogRows = backedCatalogRows(data, data.recentAssets || recentAssets);
  const catalogEvidenceAvailable = databricksBackedMetadata && catalogRows.length > 0;
  const catalogSubtitle = catalogEvidenceAvailable
    ? "Visible catalog health joined with backed governance state"
    : "Catalog health unavailable until live metadata coverage is returned";
  const catalogTooltip = catalogEvidenceAvailable
    ? "Catalog rows are derived from visible asset inventory and backed metadata coverage fields."
    : "This panel keeps the catalog-health structure visible, but it does not infer catalog scores without live backed metadata.";
  // Real rows only — padding the table with rows literally named
  // "Unavailable catalog signal N" made a healthy estate look broken.
  // All catalogs render (the payload is worst-first and complete); a visual
  // cap only applies on very large estates and is explicitly captioned.
  const CATALOG_DISPLAY_CAP = 12;
  const displayCatalogRows = catalogRows.slice(0, CATALOG_DISPLAY_CAP);
  const catalogCapCaption = catalogRows.length > CATALOG_DISPLAY_CAP
    ? `Showing worst ${CATALOG_DISPLAY_CAP} of ${catalogRows.length} catalogs`
    : "";
  const cdeItems = cdeRows(data, data.recentAssets || recentAssets);
  const activityRows = eventRows(data.recentEvents);
  const riskSummary = riskSummaryFromData(data, policyKpi, governedAssetsKpi);
  // Panel title comes from the payload label ("Quality risk findings") so the
  // panel names its actual source instead of a generic "Risk breakdown".
  const policySignalTitle = riskSummary.severityAvailable
    ? (data.riskBreakdown?.label || "Quality risk findings")
    : "Policy exception signals";
  const cdeTrackedCount = numericValue(
    data.cdeSignal?.count ?? data.estate?.cdeCount ?? data.insights?.tiles?.cdeCount ?? data.cdeSummary?.totalCdes,
  );
  const baselineAssetCount = numericValue(data.estate?.baselineAssetCount ?? data.narrative?.baselineAssetCount);
  // Hero scope: the hero aggregates the WHOLE visible estate, so it titles
  // itself from estate.estateLabel — never from a catalog row. (Falling back
  // to the first catalog-health row produced "THE STATE OF FINANCE_PROD"
  // above estate-wide numbers; worst-first ordering made it even worse.)
  const estateScopeLabel = (() => {
    const label = String(data.estate?.estateLabel || "").trim();
    if (label) return /^data estate$/i.test(label) ? "the data estate" : label;
    return (
      data.estate.catalogCount
        ? `the data estate (${formatCount(data.estate.catalogCount)} visible catalog${Number(data.estate.catalogCount) === 1 ? "" : "s"})`
        : "the visible data estate"
    );
  })();
  const visibleTrend = useMemo(
    () => trendForWindow(data.posture?.trend || [], trendWindow),
    [data.posture?.trend, trendWindow],
  );
  const selectedTrendWindow = TREND_WINDOWS.find((item) => item.key === trendWindow) || TREND_WINDOWS[0];
  const exportCommandCenterBrief = useCallback(() => {
    if (typeof document === "undefined" || typeof Blob === "undefined") {
      setExportStatus("Command Center export is unavailable in this browser context.");
      return;
    }
    const workspaceLabel =
      evidenceMeta.workspace ||
      evidenceMeta.workspaceName ||
      evidenceMeta.workspaceLabel ||
      data.estate?.workspace ||
      data.estate?.workspaceName ||
      data.estate?.workspaceLabel ||
      evidenceMeta.catalog ||
      null;
    const deployedDatabricksAppEvidence = databricksBackedMetadata && isDeployedDatabricksAppHost();
    const evidenceBoundary = deployedDatabricksAppEvidence ? "deployed-databricks-app" : "local-runtime";
    const brief = {
      exportedAt: new Date().toISOString(),
      workspace: {
        label: workspaceLabel,
        evidenceKind,
        databricksBackedMetadata,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
        source: databricksBackedMetadata
          ? "Databricks metadata plane"
          : "non-authoritative command-center metadata",
        warning: deployedDatabricksAppEvidence
          ? null
          : "This export was generated from the local runtime boundary and is not deployed Databricks App closure evidence.",
      },
      workspaceLabel,
      generatedAt: evidenceMeta.generatedAt || evidenceMeta.updatedAt || null,
      provenance: {
        evidenceKind,
        databricksBackedMetadata,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
        summary: provenanceSummary(evidenceKind),
        state,
        metaState: evidenceMeta.state || null,
        warnings: evidenceWarnings,
      },
      posture: {
        value: postureValue,
        title: postureTitle,
        trendDelta: trendDeltaLabel(data.posture?.trend || []),
        evidenceKind,
        databricksBackedMetadata,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
        source: provenanceSummary(evidenceKind),
      },
      kpis: kpis.map((kpi) => ({
        key: kpi.key,
        label: kpi.label,
        value: formatMetricValue(kpi),
        delta: shortDelta(kpi, "Unavailable"),
        state: metricState(kpi),
        evidenceKind,
        databricksBackedMetadata,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
        source: provenanceSummary(evidenceKind),
      })),
      topCatalogs: catalogRows.map((catalog) => ({
        catalog: catalog.name,
        tables: catalog.tables,
        coverage: catalog.coverage,
        classification: catalog.classification,
        risk: catalog.risk,
        evidenceKind,
        databricksBackedMetadata,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
        source: provenanceSummary(evidenceKind),
      })),
      recentActivity: activityRows.map((activity) => ({
        ...activity,
        evidenceKind,
        databricksBackedMetadata,
        liveDatabricksEvidence: deployedDatabricksAppEvidence,
        evidenceBoundary,
        source: provenanceSummary(evidenceKind),
      })),
    };
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" });
    const createUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL
      : null;
    const revokeUrl = typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function"
      ? URL.revokeObjectURL.bind(URL)
      : null;
    if (!createUrl) {
      setExportStatus("Command Center export is unavailable because this browser cannot create download URLs.");
      return;
    }
    const url = createUrl(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `governance-atlas-command-center-${new Date().toISOString().slice(0, 10)}.json`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (revokeUrl) {
      window.setTimeout(() => revokeUrl(url), 0);
    }
    setExportStatus("Command Center brief export started.");
  }, [activityRows, catalogRows, data.estate?.workspace, data.estate?.workspaceLabel, data.estate?.workspaceName, data.posture?.trend, databricksBackedMetadata, evidenceKind, evidenceMeta, evidenceWarnings, kpis, postureTitle, postureValue, state]);
  const togglePresentMode = useCallback(() => {
    if (typeof document === "undefined") {
      setPresentMode((current) => !current);
      return;
    }
    const active = Boolean(document.fullscreenElement);
    if (active && typeof document.exitFullscreen === "function") {
      document.exitFullscreen()
        .then(() => {
          setPresentMode(false);
        })
        .catch(() => {
          setPresentMode(false);
        });
      return;
    }
    const root = document.querySelector(".gh-command-center-page") || document.documentElement;
    if (root && typeof root.requestFullscreen === "function") {
      root.requestFullscreen()
        .then(() => {
          setPresentMode(true);
        })
        .catch(() => {
          setPresentMode(true);
        });
      return;
    }
    setPresentMode((current) => !current);
  }, []);
  const openCommandCenterSurface = useCallback((surfaceKey) => {
    if (!surfaceKey) return;
    onNavigate?.(surfaceKey);
  }, [onNavigate]);
  const explicitChanges = explicitChangeRows(data.changesToday || data.changes || data.deltaRows);
  // Evidence stamps: quality signals from an old run must say so instead of
  // sitting undated under "What changed today" (they read as today's news).
  const qualityEvidenceStamp = evidenceDateLabel(data.insights?.qualityEvidenceAt);
  const riskEvidenceStamp = evidenceDateLabel(
    data.riskBreakdown?.evidenceAt || data.insights?.qualityEvidenceAt,
  );
  const fallbackChanges = [
    {
      // "Coverage" alone was ambiguous against the Discover per-asset
      // "Governance score" metric; this row is the metadata-coverage formula.
      label: "Metadata coverage",
      value: percentLabel(coverageKpi.value),
      delta: shortDelta(coverageKpi, "Coverage evidence unavailable"),
      previous: coverageKpi.previousValue ?? coverageKpi.previous ?? null,
      previousFormat: "percent",
      tone: metricState(coverageKpi) === "unavailable" ? "muted" : "good",
    },
    {
      label: "Quality SLA",
      value: percentLabel(data.insights?.qualitySla ?? data.qualitySla),
      delta: data.insights?.qualitySignalAvailable
        ? `${formatCount(data.insights?.qualityChecksEvaluated)} checks evaluated${qualityEvidenceStamp ? ` · ${qualityEvidenceStamp}` : ""}`
        : "No quality checks run yet",
      previous: data.insights?.previousQualitySla ?? null,
      previousFormat: "percent",
      tone: data.insights?.qualitySignalAvailable ? "good" : "muted",
    },
    {
      // Renamed from "High-risk exposures": these are quality-run findings,
      // and the row carries the run date so old evidence is not implied to
      // have happened today.
      label: riskSummary.severityAvailable ? "High-risk quality findings" : "Policy exceptions",
      value: riskSummary.severityAvailable
        ? (riskSummary.high === null ? "-" : formatCount(riskSummary.high))
        : formatMetricValue(policyKpi),
      delta: riskSummary.severityAvailable
        ? (riskEvidenceStamp || "Quality-run findings by severity")
        : metricState(policyKpi) === "degraded"
          ? "Text-derived signal"
          : shortDelta(policyKpi, "Signal unavailable"),
      previous: policyKpi.previousValue ?? policyKpi.previous ?? null,
      previousFormat: "count",
      tone: metricState(policyKpi) === "unavailable"
        ? "muted"
        : numericValue(policyKpi.value) === 0 && !riskSummary.severityAvailable
          ? "good"
          : "warn",
    },
    {
      label: "Lineage coverage",
      value: percentLabel(data.lineage?.coverage ?? data.insights?.lineageCoverage),
      delta: data.signalAvailability?.lineage
        ? (data.lineage?.reason || "Backed by Unity Catalog lineage")
        : "Lineage signal unavailable",
      previous: data.lineage?.previousCoverage ?? data.insights?.previousLineageCoverage ?? null,
      previousFormat: "percent",
      tone: data.signalAvailability?.lineage ? "info" : "muted",
    },
  ];
  const changedToday = explicitChanges.length ? explicitChanges : fallbackChanges;
  // Honesty gate: a row only counts as "changed today" when a prior snapshot
  // value exists AND differs from the current value. All-zero deltas render
  // an explicit "No changes today" instead of zero-delta rows dressed as news.
  const changesHaveRealDelta = explicitChanges.length > 0 || fallbackChanges.some((row) => {
    const previous = numericValue(row.previous);
    if (previous === null) return false;
    const parsed = parseAnimatable(row.value);
    return parsed.numeric !== null && Math.abs(parsed.numeric - previous) >= 0.05;
  });
  // Only assert a quarter-over-quarter coverage delta when the API actually
  // supplies a real previous coverage value. Previously this fabricated a
  // story against hardcoded constants (78.4 baseline, "90% Q2 target",
  // "week 30") the backend never returns — a governance-honesty violation.
  const coveragePrevious = numericValue(coverageKpi.previousValue ?? coverageKpi.previous);
  const coverageNow = numericValue(postureValue ?? coverageKpi.value);
  const narrativeTarget = typeof data.narrative?.target === "string" ? data.narrative.target.trim() : "";
  const narrativeTargetWeek = typeof data.narrative?.targetWeek === "string" ? data.narrative.targetWeek.trim() : "";
  const governedCount = numericValue(governedAssetsKpi.value);
  const narrativeHeadline = baselineAssetCount !== null && governedCount !== null
    ? (
      <>
        <strong>{formatMetricValue(governedAssetsKpi)}</strong> of {formatCount(baselineAssetCount)} productionized assets meet baseline policy.
        {coveragePrevious !== null && coverageNow !== null ? (
          <>
            {" "}Coverage is {coverageNow >= coveragePrevious ? "up" : "down"} <strong>{Math.abs(Math.round(coverageNow) - Math.round(coveragePrevious))} points</strong>
            {narrativeTarget ? (
              <>{" "}from the prior period — on track to hit the <span>{narrativeTarget}</span>{narrativeTargetWeek ? ` by ${narrativeTargetWeek}` : ""}.</>
            ) : " from the prior period."}
          </>
        ) : (
          <>{" "}Coverage is {percentLabel(coverageKpi.value, "unavailable")}.</>
        )}
      </>
    )
    : governedCount !== null
    ? (
      <>
        <strong>{formatMetricValue(governedAssetsKpi)}</strong> governed assets are in scope
        {coverageValue !== null ? (
          <>{" "}with <strong>{percentLabel(coverageKpi.value)}</strong> metadata coverage across the visible estate.</>
        ) : (
          <>. Coverage evidence is still hydrating.</>
        )}
      </>
    )
    : (
      <>
        <strong>Command Center is waiting on backed governance metrics.</strong>
        {" "}Unavailable values stay blank until Unity Catalog or the governance store returns evidence.
      </>
    );
  const heroFacts = [
    {
      icon: "shield",
      // This count is certified AND critical assets — labelling it plain
      // "Certified assets" contradicted the Insights tile (certified-only).
      label: "Certified critical assets",
      value: formatMetricValue(certifiedKpi),
      delta: shortDelta(certifiedKpi, "Signal unavailable"),
      tone: "good",
      onOpen: () => {
        // Certified evidence lives in Discover's strict Certified view.
        if (onOpenDiscoveryWithFilter) onOpenDiscoveryWithFilter({}, "", { views: ["Certified"] });
        else openCommandCenterSurface("discovery");
      },
      openLabel: "Open Discover filtered to certified assets",
    },
    {
      icon: "flag",
      // Always "Policy exceptions": this stat renders policyKpi, so titling
      // it "Open exposures" made one screen show "exposures 0" next to a
      // "high-risk 2" KPI computed from a different (quality) source.
      label: "Policy exceptions",
      value: formatMetricValue(policyKpi),
      delta: metricState(policyKpi) === "degraded"
        ? "Text-derived signal"
        : shortDelta(policyKpi, "Signal unavailable"),
      tone: metricState(policyKpi) === "unavailable"
        ? "muted"
        : numericValue(policyKpi.value) === 0
          ? "good"
          : "bad",
      onOpen: () => openCommandCenterSurface("governance"),
      openLabel: "Open the stewardship queue for policy exception evidence",
    },
    {
      icon: "key",
      label: "CDEs tracked",
      value: cdeTrackedCount === null ? "-" : formatCount(cdeTrackedCount),
      // Subtitle comes from the payload (cdeSignal.subtitle =
      // "Criticality-derived"); the old hardcoded "Tag-governed ·
      // lineage-backed" copy described a registry that does not exist.
      delta: cdeTrackedCount === null
        ? "CDE registry unavailable"
        : cdeTrackedCount === 0
          ? "No assets tagged as CDEs yet"
          : data.cdeSignal?.subtitle || "Criticality-derived",
      tone: "info",
      onOpen: () => openCommandCenterSurface("cde"),
      openLabel: "Open the CDE registry tab in Glossary & CDEs",
    },
  ];
  // Every headline tile is a real click into filtered evidence (matching the
  // domain-bar navigation pattern) and carries an info popover explaining its
  // formula — payload formula strings first, honest static copy otherwise.
  const commandCenterKpis = [
    {
      // "Governance coverage" was ambiguous against Discover's per-asset
      // "Governance score"; this tile is the metadata-coverage formula (95.5).
      label: "Metadata coverage",
      value: percentLabel(coverageKpi.value),
      delta: shortDelta(coverageKpi, "Signal unavailable"),
      tone: metricState(coverageKpi) === "unavailable" ? "muted" : "good",
      sparkline: coverageKpi.sparkline || [],
      info: coverageKpi.formula || "Weighted coverage of required governance metadata fields across visible assets.",
      onOpen: () => {
        // Evidence: Discover sorted by Governance score so the weakest-scored
        // assets are inspectable from the coverage number.
        if (onOpenDiscoveryWithFilter) onOpenDiscoveryWithFilter({}, "", { sortBy: "Governance score" });
        else openCommandCenterSurface("discovery");
      },
      openLabel: "Open Discover sorted by governance score",
    },
    {
      label: "Certified critical assets",
      value: formatMetricValue(certifiedKpi),
      delta: shortDelta(certifiedKpi, "Signal unavailable"),
      tone: metricState(certifiedKpi) === "unavailable" ? "muted" : "good",
      sparkline: certifiedKpi.sparkline || [],
      info: certifiedKpi.formula || "Assets that are both critical and strictly certified (certification == Certified), counted when both source signals are available.",
      onOpen: () => {
        if (onOpenDiscoveryWithFilter) onOpenDiscoveryWithFilter({}, "", { views: ["Certified"] });
        else openCommandCenterSurface("discovery");
      },
      openLabel: "Open Discover filtered to certified assets",
    },
    {
      label: "Open stewardship items",
      value: formatMetricValue(stewardshipKpi),
      delta: shortDelta(stewardshipKpi, "Signal unavailable"),
      tone: metricState(stewardshipKpi) === "unavailable" ? "muted" : "warn",
      sparkline: stewardshipKpi.sparkline || [],
      info: stewardshipKpi.formula || "Open governance change requests targeting assets in the visible estate.",
      onOpen: () => openCommandCenterSurface("governance"),
      openLabel: "Open the stewardship work queue",
    },
    {
      // Renamed from "High-risk exposures": the count is failed quality-run
      // findings, a different source than the policy-exception KPI — the two
      // must never share a name while carrying different values.
      label: riskSummary.severityAvailable ? "High-risk quality findings" : "Policy exceptions",
      value: riskSummary.severityAvailable
        ? (riskSummary.high === null ? "-" : formatCount(riskSummary.high))
        : formatMetricValue(policyKpi),
      delta: riskSummary.severityAvailable
        ? (riskEvidenceStamp || "Quality-run findings by severity")
        : metricState(policyKpi) === "degraded"
          ? "Text-derived signal"
          : shortDelta(policyKpi, "Signal unavailable"),
      tone: metricState(policyKpi) === "unavailable" && !riskSummary.severityAvailable
        ? "muted"
        : riskSummary.severityAvailable
          ? (numericValue(riskSummary.high) > 0 ? "bad" : "good")
          : numericValue(policyKpi.value) === 0
            ? "good"
            : "bad",
      sparkline: policyKpi.sparkline || [],
      info: riskSummary.severityAvailable
        ? `High-severity findings from the most recent quality runs (${data.riskBreakdown?.source || "quality run results"}).`
        : policyKpi.formula || "Explicit policy-exception signals from governed workflow and audit records.",
      onOpen: () => openCommandCenterSurface(riskSummary.severityAvailable ? "insights" : "governance"),
      openLabel: riskSummary.severityAvailable
        ? "Open governance insights for quality risk evidence"
        : "Open the stewardship queue for policy exception evidence",
    },
  ];

  return (
    <section
      aria-busy={isHydrating || refreshing ? "true" : undefined}
      aria-label="Governance Atlas command center"
      className={`gh-home-page gh-command-center-page ga-page ${isHydrating ? "is-hydrating" : ""} ${refreshing && !isHydrating ? "is-refreshing" : ""} ${presentMode ? "is-presenting" : ""}`.trim()}
    >
      <div className="gh-command-center-shell">
        <header className="gh-command-center-hero">
          <div>
            <div className="gh-command-center-kicker">
              <span className="ga-eyebrow">Executive Command Center</span>
              <span className="gh-command-center-kicker-sep" aria-hidden="true" />
              <span className="gh-command-center-live">
                <span aria-hidden="true" />
                <em>{commandCenterRefreshLabel}</em>
              </span>
            </div>
            <h1>{postureOverall !== null ? "Governance posture, at a glance" : "Governance coverage, at a glance"}</h1>
            <p>{heroDescription}</p>
          </div>
          <div className="gh-command-center-actions">
            <button type="button" onClick={exportCommandCenterBrief}><Icon name="download" />Export brief</button>
            <button type="button" aria-pressed={presentMode} onClick={togglePresentMode}>
              <Icon name="presentation" />
              {presentMode ? "Exit present mode" : "Present mode"}
            </button>
            {exportStatus ? <span className="gh-command-center-present-note" role="status">{exportStatus}</span> : null}
            {presentMode ? <span className="gh-command-center-present-note" role="status">Local presentation view - no metadata changes.</span> : null}
          </div>
        </header>

        {isHydrating ? (
          <div className="gh-home-status gh-home-hydration-status" role="status">
            <span className="gh-home-status-spinner" aria-hidden="true" />
            <span>
              <strong>{statusMessage}</strong>
              <em>Showing the command-center structure while live governed metadata finishes loading.</em>
            </span>
          </div>
        ) : state === "error" ? (
          <EmptyState
            tone="danger"
            title={statusMessage || "Command center unavailable."}
            message="The command center snapshot could not be loaded from the live metadata plane."
            actions={onRetry ? (
              <button className="gh-tertiary-button gh-inline-link-button" type="button" onClick={() => onRetry()}>
                Retry
              </button>
            ) : null}
          />
        ) : statusMeta.degraded && !shellAlreadyShowsScopeWarning && !warningOnlyNeedsShellProvenance ? (
          <DegradedBanner meta={statusMeta} title="Data availability is limited" />
        ) : refreshing ? (
          <div className="gh-home-status gh-home-refresh-status" role="status">
            <span className="gh-home-status-spinner" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
        ) : null}

        <section className="gh-command-center-state-card" aria-label={postureOverall !== null ? "Current governance posture" : "Current metadata coverage"}>
          <div className="gh-command-center-score">
            {postureValue === null ? (
              <>
                <div className="gh-command-center-score-unavailable">
                  <strong>-</strong>
                  <span>{postureTitle}</span>
                </div>
                <em>{postureTrendLabel}</em>
              </>
            ) : (
              <CommandCenterTrustRing
                label={postureTitle}
                value={postureValue}
                trend={postureTrendLabel.replace(/^\+/, "")}
              />
            )}
          </div>
          <div className="gh-command-center-narrative">
            <span>The state of {estateScopeLabel}</span>
            <h2>
              {narrativeHeadline}
            </h2>
            <div className="gh-command-center-facts">
              {heroFacts.map((fact) => (
                <span className={`tone-${fact.tone}`} key={fact.label}>
                  {/* Overlay button keeps the stat grid intact while making
                      the whole stat a real click into its evidence surface
                      (hero stats were dead clicks). */}
                  {fact.onOpen ? (
                    <button
                      aria-label={fact.openLabel || `Open evidence for ${fact.label}`}
                      className="gh-command-center-fact-open"
                      onClick={fact.onOpen}
                      title={fact.openLabel}
                      type="button"
                    />
                  ) : null}
                  <i aria-hidden="true"><Icon name={fact.icon} /></i>
                  <small>{fact.label}</small>
                  <b>{fact.value}</b>
                  <em>{fact.delta}</em>
                </span>
              ))}
            </div>
          </div>
          <div className="gh-command-center-changes" aria-busy={isHydrating ? "true" : undefined}>
            <h3>What changed today</h3>
            {isHydrating && !changesHaveRealDelta ? (
              // Still loading: don't assert "No changes today" before the
              // command-center payload has actually arrived.
              <div className="gh-command-center-no-changes" role="status">
                <strong>Loading today's changes…</strong>
                <em>Reading the latest governance snapshot</em>
              </div>
            ) : changesHaveRealDelta ? (
              changedToday.map((item) => (
                <div
                  className={`gh-command-center-change tone-${item.tone}`}
                  key={item.label}
                  title={undefined}
                >
                  <span>{item.label}</span>
                  <strong>
                    {item.previous !== null && item.previous !== undefined ? (
                      <>
                        <small>{formatChangeValue(item.previous, item.previousFormat)}</small>
                        {formatChangeValue(item.value, item.format)}
                      </>
                    ) : formatChangeValue(item.value, item.format)}
                  </strong>
                  <em>{item.delta}</em>
                </div>
              ))
            ) : (
              // Honest zero-delta state: no prior snapshot differs from the
              // current values, so nothing actually changed today. Old May
              // quality stats are labeled by evidence date instead of being
              // presented as today's movement.
              <div className="gh-command-center-no-changes" role="status">
                <strong>No changes today</strong>
                <em>
                  {qualityEvidenceStamp
                    ? `Latest quality ${qualityEvidenceStamp}`
                    : "Signals are unchanged since the last recorded snapshot"}
                </em>
              </div>
            )}
          </div>
        </section>

        <section
          aria-busy={isHydrating ? "true" : undefined}
          aria-label="Governance summary metrics"
          className="gh-command-center-kpi-row"
        >
          {commandCenterKpis.map((metric) => {
            const animatable = parseAnimatable(metric.value);
            const infoOpen = openKpiInfo === metric.label;
            return (
            <article className={`gh-command-center-kpi tone-${metric.tone} ga-tile-glow`} key={metric.label}>
              {/* Full-tile overlay click into the metric's evidence surface —
                  headline tiles were dead clicks before. The info glyph sits
                  above the overlay (higher z-index) so both stay reachable. */}
              {metric.onOpen ? (
                <button
                  aria-label={metric.openLabel || `Open evidence for ${metric.label}`}
                  className="gh-command-center-kpi-open"
                  onClick={metric.onOpen}
                  title={metric.openLabel}
                  type="button"
                />
              ) : null}
              <span>
                {metric.label}
                {metric.info ? (
                  <button
                    aria-expanded={infoOpen}
                    aria-label={`How ${metric.label} is calculated`}
                    className="gh-command-center-kpi-info"
                    onClick={() => setOpenKpiInfo(infoOpen ? "" : metric.label)}
                    title={metric.info}
                    type="button"
                  >
                    i
                  </button>
                ) : null}
              </span>
              {metric.info && infoOpen ? (
                <div className="gh-command-center-kpi-popover" role="note">
                  {metric.info}
                </div>
              ) : null}
              <strong>
                {animatable.numeric !== null ? (
                  <CountUp
                    to={animatable.numeric}
                    decimals={animatable.decimals}
                    prefix={animatable.prefix}
                    suffix={animatable.suffix}
                  />
                ) : (
                  metric.value
                )}
              </strong>
              <em>{metric.delta}</em>
              <div className="gh-command-center-kpi-spark">
                {(() => {
                  const shape = metric.sparkline?.length >= 2 ? metricSparklineShape(metric.sparkline) : null;
                  if (shape) {
                    return (
                      <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
                        <path className="gh-command-center-kpi-spark-fill" d={shape.area} />
                        <path className="gh-command-center-kpi-spark-line" d={shape.line} />
                      </svg>
                    );
                  }
                  // No history yet: a flat dashed baseline, never an invented
                  // upward curve dressed as data.
                  return (
                    <svg className="is-unavailable" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M0 28 L100 28" strokeDasharray="4 5" />
                    </svg>
                  );
                })()}
              </div>
            </article>
            );
          })}
        </section>

        <div className="gh-command-center-grid">
          <SectionCard
            className="gh-command-center-trend"
            title={postureOverall !== null ? `Posture trend · ${selectedTrendWindow.label}` : `Coverage trend · ${selectedTrendWindow.label}`}
            subtitle="Daily governance snapshots recorded by Governance Atlas"
            tooltip="Historical posture snapshots are shown only when available."
            actions={(
              <div className="gh-command-center-window-group" role="group" aria-label="Coverage trend range">
                {TREND_WINDOWS.map((item) => (
                  <button
                    aria-pressed={selectedTrendWindow.key === item.key}
                    className={selectedTrendWindow.key === item.key ? "is-active" : ""}
                    key={item.key}
                    onClick={() => setTrendWindow(item.key)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          >
            {/* While snapshot history is collecting (a single daily point),
                render the explicit collecting state — a full-width 26/52-week
                line drawn through one snapshot is synthetic data. */}
            {data.posture?.trendState === "collecting" ? (
              <TrendUnavailableChart
                point={(() => {
                  const points = normalizeTrend(data.posture?.trend || [])
                    .filter((point) => Number.isFinite(point.overall));
                  return points.length ? points[points.length - 1].overall : null;
                })()}
                collectingSince={trendTickLabel(data.posture?.collectingSince) || ""}
              />
            ) : (
              <PostureTrendChart trend={visibleTrend} collectingSince={data.posture?.collectingSince || ""} />
            )}
            <div className="gh-command-center-trend-footer">
              <span>
                <strong>
                  {data.posture?.trendState === "collecting"
                    ? `Collecting since ${trendTickLabel(data.posture?.collectingSince) || "today"}`
                    : trendDeltaLabel(visibleTrend)}
                </strong>
                {data.posture?.trendState === "collecting"
                  ? " · one snapshot per day"
                  : ` over the last ${selectedTrendWindow.label.replace("w", " weeks")}`}
              </span>
            </div>
          </SectionCard>

          <SectionCard
            className="gh-command-center-domain"
            title={domainSignalTitle}
            subtitle="Coverage x visible asset count"
            tooltip={postureOverall !== null
              ? "Domain posture scores use backed command-center domain signals when available."
              : "Domain coverage scores use backed metadata coverage signals when available."}
          >
            <div className={`gh-command-center-domain-bars ${domainBarItems.length ? "" : "is-unavailable"}`.trim()}>
              {domainBarItems.map((domain) => (
                <button
                  aria-label={domain.score === null ? `${domain.label} domain signal unavailable` : `Open discovery filtered to ${domain.label} domain`}
                  className={`gh-command-center-domain-row tone-${domain.tone || "empty"}`}
                  disabled={domain.score === null}
                  key={domain.label}
                  onClick={() => {
                    if (domain.score === null) return;
                    if (onOpenDiscoveryWithFilter) {
                      onOpenDiscoveryWithFilter({ domains: [domain.label] });
                    } else {
                      openCommandCenterSurface("discovery");
                    }
                  }}
                  title={domain.score === null
                    ? `${domainSignalTitle} signal unavailable`
                    : `Open discovery filtered to ${domain.label} domain`}
                  type="button"
                >
                  <span>{domain.label}</span>
                  <i aria-hidden="true"><b style={{ width: `${domain.score ?? 0}%` }} /></i>
                  <strong>{domain.score === null ? "-" : `${Math.round(domain.score)}%`}</strong>
                  {domain.count !== null ? <em>{formatCount(domain.count)} assets</em> : <em>Domain signal unavailable</em>}
                </button>
              ))}
              {!domainBarItems.length ? (
                <div className="gh-command-center-inline-unavailable">{domainSignalUnavailableText}</div>
              ) : null}
              </div>
          </SectionCard>

          <SectionCard
            className="gh-command-center-risk"
            title={policySignalTitle}
            subtitle={riskSummary.severityAvailable
              ? `Quality-run findings by severity${riskEvidenceStamp ? ` · ${riskEvidenceStamp}` : ""}`
              : "Policy exception signal availability"}
            tooltip={riskSummary.severityAvailable
              ? "Findings come from recorded quality-run results, split by severity; nothing is inferred."
              : "Policy exception signals render without inferring unavailable severity."}
          >
            <div className="gh-command-center-risk-body">
              <div className={`gh-command-center-risk-ring ${riskSummary.cleanScore === null && riskSummary.openExposure === null ? "is-unavailable" : ""}`.trim()}>
                {riskSummary.cleanScore !== null ? (
                  <>
                    <strong>{`${Math.round(riskSummary.cleanScore)}%`}</strong>
                    <span>Risk-clean</span>
                  </>
                ) : riskSummary.openExposure !== null ? (
                  // Zero open exceptions is a healthy, backed answer — show
                  // the count, not a dash labelled "unavailable".
                  <>
                    <strong>{formatCount(riskSummary.openExposure)}</strong>
                    <span>Open exceptions</span>
                  </>
                ) : (
                  <>
                    <strong>-</strong>
                    <span>No severity data yet</span>
                  </>
                )}
              </div>
              {/* All three severity rows drill into the SAME quality-evidence
                  surface (governance insights). The old mix — high → an empty
                  stewardship queue, medium/info → audit — scattered one
                  finding set across three unrelated destinations. Policy
                  exception signals (no severity source) still route to the
                  stewardship queue, where exception requests live. */}
              <ul>
                <li>
                  <button
                    aria-label={riskSummary.severityAvailable
                      ? "Open quality risk evidence for high-severity findings"
                      : "Open stewardship for policy exception signals"}
                    disabled={!riskSummary.sourceAvailable}
                    onClick={() => openCommandCenterSurface(riskSummary.severityAvailable ? "insights" : "governance")}
                    title={riskSummary.sourceAvailable
                      ? (riskSummary.severityAvailable
                        ? "Open governance insights for quality risk evidence"
                        : "Open stewardship queue for policy exception review")
                      : "Policy exception signal unavailable"}
                    type="button"
                  >
                    <b className="tone-bad" />
                    <span>{riskSummary.severityAvailable ? "High severity" : "Policy exception signals"}</span>
                    <strong>
                      {riskSummary.severityAvailable
                        ? (riskSummary.high === null ? "-" : formatCount(riskSummary.high))
                        : (riskSummary.openExposure === null ? "-" : formatCount(riskSummary.openExposure))}
                    </strong>
                  </button>
                </li>
                <li>
                  <button
                    aria-label={riskSummary.severityAvailable ? "Open quality risk evidence for medium-severity findings" : "Medium severity source unavailable"}
                    disabled={!riskSummary.severityAvailable}
                    onClick={() => openCommandCenterSurface("insights")}
                    title={riskSummary.severityAvailable ? "Open governance insights for quality risk evidence" : "Risk severity source unavailable"}
                    type="button"
                  >
                    <b className="tone-warn" />
                    <span>Medium severity</span>
                    <strong>{riskSummary.medium === null ? "-" : formatCount(riskSummary.medium)}</strong>
                  </button>
                </li>
                <li>
                  <button
                    aria-label={riskSummary.severityAvailable ? "Open quality risk evidence for informational findings" : "Informational severity source unavailable"}
                    disabled={!riskSummary.severityAvailable}
                    onClick={() => openCommandCenterSurface("insights")}
                    title={riskSummary.severityAvailable ? "Open governance insights for quality risk evidence" : "Risk severity source unavailable"}
                    type="button"
                  >
                    <b className="tone-info" />
                    <span>Informational</span>
                    <strong>{riskSummary.informational === null ? "-" : formatCount(riskSummary.informational)}</strong>
                  </button>
                </li>
              </ul>
            </div>
            <p>
              {riskSummary.severityAvailable
                  ? "Risk-clean score counts high and medium quality-run findings across governed assets."
                  : riskSummary.openExposure !== null
                  ? "Policy exception count is backed by governance workflow evidence; a severity split appears once quality checks record findings."
                  : "A severity split appears once quality checks record findings."}
            </p>
          </SectionCard>

          <SectionCard
            className="gh-command-center-catalogs"
            title="Catalog health · worst coverage first"
            subtitle={catalogSubtitle}
            tooltip={catalogTooltip}
          >
            <div className={`gh-command-center-catalog-table ${catalogRows.length ? "" : "is-unavailable"}`.trim()} role="table" aria-label="Catalog health snapshot, worst coverage first">
              <div role="row">
                <span role="columnheader">Catalog</span>
                <span role="columnheader">Tables</span>
                <span role="columnheader">Coverage</span>
                <span role="columnheader">Classification</span>
                <span role="columnheader">Risk</span>
              </div>
              {displayCatalogRows.map((catalog) => {
                const isPlaceholder = catalog.state === "placeholder";
                // Match the domain-bar pattern: land on Discover pre-filtered
                // to this catalog rather than an unscoped list.
                const openCatalog = () => {
                  if (onOpenDiscoveryWithFilter) onOpenDiscoveryWithFilter({ catalogs: [catalog.name] });
                  else openCommandCenterSurface("discovery");
                };
                return (
                  <div
                    className={isPlaceholder ? "is-placeholder" : "is-clickable"}
                    onClick={isPlaceholder ? undefined : openCatalog}
                    onKeyDown={isPlaceholder ? undefined : (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openCatalog();
                    }}
                    role="row"
                    tabIndex={isPlaceholder ? -1 : 0}
                    title={isPlaceholder ? "Catalog health signal unavailable" : `Open discovery filtered to ${catalog.name}`}
                    key={catalog.name}
                  >
                    <strong role="cell"><Icon name="database" />{catalog.name}</strong>
                    <span role="cell">{formatCount(catalog.tables)}</span>
                    <span role="cell" className="gh-command-center-catalog-coverage">
                      <b>{percentLabel(catalog.coverage)}</b>
                      <i aria-hidden="true"><em style={{ width: `${catalog.coverage ?? 0}%` }} /></i>
                    </span>
                    <span role="cell" className="gh-command-center-chip-cell">{catalog.classification}</span>
                    <span role="cell" className="gh-command-center-chip-cell">{catalog.risk}</span>
                  </div>
                );
              })}
              {!catalogRows.length ? (
                <div className="gh-command-center-inline-unavailable">Catalog health rows unavailable until visible asset inventory hydrates.</div>
              ) : null}
            </div>
            {catalogCapCaption ? (
              <p className="gh-command-center-catalog-cap" role="note">{catalogCapCaption}</p>
            ) : null}
          </SectionCard>

          <SectionCard
            className="gh-command-center-cdes"
            title="Critical data elements"
            subtitle="Backed CDE registry rows with owner and lineage evidence when available"
            tooltip="CDE rows require backed CDE registry data or asset-level critical-element metadata."
            actions={<button type="button" className="ga-link-button" onClick={() => openSurface("cde")}>View all</button>}
          >
            <div className={`gh-command-center-cde-grid ${cdeItems.length ? "" : "is-unavailable"}`.trim()}>
              {cdeItems.map((item) => {
                const isPlaceholder = item.state === "placeholder";
                return (
                  <button
                    type="button"
                    className="gh-command-center-cde-card"
                    disabled={isPlaceholder}
                    onClick={() => openCommandCenterSurface("cde")}
                    title={isPlaceholder ? "CDE source signal unavailable" : `Open CDE context for ${item.name}`}
                    key={item.id || item.name}
                  >
                    <span>
                      <Icon name="key" />
                      <strong>{item.name}</strong>
                      {item.sox ? <em>SOX</em> : null}
                    </span>
                    <code>{item.column}</code>
                    <small>
                      <b>{item.owner || "Owner unavailable"}</b>
                      <i title={undefined}>
                        {item.status || "Unavailable"}
                      </i>
                    </small>
                  </button>
                );
              })}
              {!cdeItems.length ? (
                <div className="gh-command-center-inline-unavailable">No assets are tagged as Critical Data Elements yet. Tag an asset with `cde` (or flag it from its asset page) to build the registry.</div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            className="gh-command-center-activity"
            title="Activity stream"
            subtitle={isLiveEvidence ? "Live audit log · permission-filtered" : "Audit events unavailable until live evidence is returned"}
            tooltip="Recent activity uses audit/governance events returned by the command-center API."
          >
            <ul className={`gh-command-center-activity-list ${activityRows.length ? "" : "is-unavailable"}`.trim()}>
              {(activityRows.length ? activityRows : [
                { id: "activity-placeholder-1", actor: "Governance Atlas", title: "No recent governance activity available.", time: "Awaiting backed audit events", tone: "info", state: "placeholder" },
                { id: "activity-placeholder-2", actor: "Audit evidence", title: "Activity stream will populate when events are returned.", time: "Unavailable", tone: "info", state: "placeholder" },
              ]).map((event) => {
                const isPlaceholder = event.state === "placeholder";
                // Treat target as an asset FQN if it looks like a UC three-part
                // name (catalog.schema.table). Anything else routes to Audit.
                const looksLikeFqn = typeof event.target === "string" && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(event.target);
                const handleClick = () => {
                  if (looksLikeFqn && onOpenAsset360Drawer) {
                    onOpenAsset360Drawer(event.target);
                  } else {
                    openCommandCenterSurface("audit");
                  }
                };
                return (
                  <li className={`tone-${event.tone}`} key={event.id}>
                    <button type="button" disabled={isPlaceholder} onClick={handleClick}>
                      <b aria-hidden="true" />
                      <span>
                        <span className="gh-command-center-activity-line"><strong>{event.actor}</strong> {event.title}</span>
                        {event.target ? <code>{event.target}</code> : event.detail ? <small>{event.detail}</small> : null}
                        <em>{event.time}</em>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </div>
      </div>
    </section>
  );
}

export default HomePage;
