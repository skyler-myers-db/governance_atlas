import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import land110m from "world-atlas/land-110m.json";
import { fetchAtlasAiRecommendations } from "../lib/api";
import { useAtlasAiConversation } from "../hooks/useAtlasAiConversation";
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
  quickActions: [],
  aiPrompts: [],
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

const FALLBACK_AI_PROMPTS = [
  "Which domains have the lowest metadata coverage?",
  "Which critical assets are not certified?",
  "What changed in governance metadata recently?",
  "Which assets need stewardship attention?",
  "Which governance issue should I prioritize next?",
  "Which assets have incomplete ownership?",
  "Where did policy exception activity increase?",
  "Which domains need certification cleanup?",
];

const TREND_WINDOWS = [
  { key: "12w", label: "12w", points: 12 },
  { key: "26w", label: "26w", points: 26 },
  { key: "52w", label: "52w", points: 52 },
];

const DOMAIN_PLACEHOLDER_ROWS = [
  "Revenue & Sales",
  "Customer",
  "Marketing",
  "Finance",
  "Operations",
  "People",
];

const CATALOG_PLACEHOLDER_ROWS = [
  "finance_prod",
  "sales_prod",
  "customer_360",
  "product_events",
  "marketing_mart",
  "hr_secure",
];

const CDE_PLACEHOLDER_ROWS = [
  "Net Revenue (USD)",
  "Customer ID",
  "Lifetime Value (USD)",
  "Compensation Band",
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

function CommandCenterTrustRing({ value = 0, trend = "9.0 pts QoQ", label = "Posture", size = 200 }) {
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
        <em>{trend}</em>
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

function isPrototypeMockWarning(warning) {
  return /prototype mock data|not live databricks evidence|local-prototype-mock/i.test(String(warning || ""));
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
    data?.meta?.state,
    data?.meta?.evidenceKind,
    data?.meta?.evidence_kind,
    data?.meta?.sourceKind,
    state,
  ].map((value) => String(value || "").trim().toLowerCase());

  if (markers.some((value) => value.includes("prototype") || value.includes("mock")) || allWarnings.some(isPrototypeMockWarning)) {
    return "prototype_mock";
  }
  if (markers.includes("seed") || markers.includes("loading")) return "seed";
  if (
    data?.authoritative === false ||
    data?.meta?.authoritative === false ||
    data?.provenance?.authoritative === false ||
    data?.meta?.liveDatabricksEvidence === false ||
    data?.meta?.live_databricks_evidence === false
  ) {
    return "non_authoritative";
  }
  if (markers.includes("degraded") || allWarnings.length) return "degraded";
  return "live";
}

function provenanceSummary(evidenceKind) {
  if (evidenceKind === "prototype_mock") {
    return "Prototype mock data, not live Databricks evidence.";
  }
  if (evidenceKind === "seed") {
    return "Seeded shell data while live command-center metadata hydrates.";
  }
  if (evidenceKind === "degraded") {
    return "Degraded command-center evidence; unavailable signals remain marked unavailable.";
  }
  if (evidenceKind === "non_authoritative") {
    return "Non-authoritative command-center evidence; unverified signals remain marked unavailable.";
  }
  return "Live command-center evidence from the configured metadata plane.";
}

const FALLBACK_LAND_RINGS = [
  [[-168, 72], [-145, 70], [-130, 58], [-125, 48], [-113, 40], [-105, 31], [-94, 28], [-82, 25], [-68, 45], [-54, 52], [-62, 63], [-92, 72], [-130, 74]],
  [[-82, 12], [-76, 2], [-70, -14], [-63, -28], [-59, -45], [-70, -54], [-78, -38], [-84, -18], [-90, 4]],
  [[-18, 36], [-8, 52], [16, 60], [42, 55], [52, 42], [36, 34], [18, 36], [2, 42]],
  [[-18, 32], [5, 36], [28, 30], [44, 12], [36, -14], [24, -34], [10, -35], [-6, -12], [-14, 8]],
  [[36, 55], [62, 62], [94, 58], [122, 48], [150, 52], [164, 36], [142, 18], [112, 8], [96, -5], [76, 18], [52, 22], [42, 38]],
  [[112, -11], [154, -10], [154, -38], [134, -44], [114, -32]],
  [[46, -14], [52, -20], [48, -25], [42, -20]],
  [[-52, 74], [-26, 72], [-18, 64], [-38, 60], [-56, 64]],
];

function buildWorldLandRings() {
  try {
    const landFeature = feature(land110m, land110m.objects.land);
    const geometry = landFeature?.geometry;
    const polygons = geometry?.type === "MultiPolygon"
      ? geometry.coordinates
      : geometry?.type === "Polygon"
        ? [geometry.coordinates]
        : [];
    return polygons
      .flatMap((polygon) => polygon)
      .filter((ring) => Array.isArray(ring) && ring.length >= 3)
      .map((ring) => ring.map(([lon, lat]) => [Number(lon), Number(lat)]));
  } catch {
    return [];
  }
}

const WORLD_LAND_RINGS = buildWorldLandRings();
const GLOBE_LAND_RINGS = WORLD_LAND_RINGS.length ? WORLD_LAND_RINGS : FALLBACK_LAND_RINGS;

const CITY_LIGHTS = [
  [-74, 40], [-118, 34], [-87, 42], [-99, 19], [-58, -34], [-46, -23],
  [-0.1, 51], [2, 49], [13, 52], [30, 60], [37, 56], [31, 30],
  [77, 28], [72, 19], [116, 40], [121, 31], [139, 35], [103, 1],
  [151, -34], [28, -26], [3, 6], [55, 25],
];

const NETWORK_ARCS = [
  [[-74, 40], [-0.1, 51]],
  [[-118, 34], [139, 35]],
  [[2, 49], [77, 28]],
  [[31, 30], [116, 40]],
  [[-46, -23], [28, -26]],
  [[103, 1], [151, -34]],
];

function drawProjectedPath(context, points, project) {
  let open = false;
  let visibleCount = 0;
  points.forEach(([lon, lat]) => {
    const point = project(lon, lat);
    if (!point.visible) {
      if (open) context.closePath();
      open = false;
      return;
    }
    if (!open) {
      context.moveTo(point.x, point.y);
      open = true;
    } else {
      context.lineTo(point.x, point.y);
    }
    visibleCount += 1;
  });
  if (open) context.closePath();
  return visibleCount;
}

function GlobeNetworkVisual() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined" || typeof window.CanvasRenderingContext2D === "undefined") {
      return undefined;
    }
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let frame = 0;
    let stopped = false;
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time = 0) => {
      const width = canvas.clientWidth || 760;
      const height = canvas.clientHeight || 260;
      const radius = Math.min(width * 0.36, height * 0.9);
      const cx = width * 0.64;
      const cy = height * 0.72;
      const rotation = reducedMotion ? -64 : -64 + (time / 1000) * 2.8;

      context.clearRect(0, 0, width, height);
      context.save();
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.clip();

      const ocean = context.createRadialGradient(cx - radius * 0.32, cy - radius * 0.44, radius * 0.08, cx, cy, radius);
      ocean.addColorStop(0, "rgba(82, 185, 244, 0.86)");
      ocean.addColorStop(0.44, "rgba(13, 103, 164, 0.7)");
      ocean.addColorStop(1, "rgba(2, 25, 46, 0.92)");
      context.fillStyle = ocean;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      const project = (lon, lat) => {
        const lambda = ((lon + rotation) * Math.PI) / 180;
        const phi = (lat * Math.PI) / 180;
        const cosPhi = Math.cos(phi);
        const x = cosPhi * Math.sin(lambda);
        const y = Math.sin(phi);
        const z = cosPhi * Math.cos(lambda);
        return {
          x: cx + x * radius,
          y: cy - y * radius,
          z,
          visible: z > -0.02,
        };
      };

      context.strokeStyle = "rgba(142, 219, 255, 0.16)";
      context.lineWidth = 1;
      for (let lat = -60; lat <= 60; lat += 30) {
        context.beginPath();
        let active = false;
        for (let lon = -180; lon <= 180; lon += 4) {
          const point = project(lon, lat);
          if (!point.visible) {
            active = false;
            continue;
          }
          if (!active) {
            context.moveTo(point.x, point.y);
            active = true;
          } else {
            context.lineTo(point.x, point.y);
          }
        }
        context.stroke();
      }
      for (let lon = -150; lon <= 180; lon += 30) {
        context.beginPath();
        let active = false;
        for (let lat = -80; lat <= 80; lat += 4) {
          const point = project(lon, lat);
          if (!point.visible) {
            active = false;
            continue;
          }
          if (!active) {
            context.moveTo(point.x, point.y);
            active = true;
          } else {
            context.lineTo(point.x, point.y);
          }
        }
        context.stroke();
      }

      GLOBE_LAND_RINGS.forEach((land) => {
        context.beginPath();
        const visibleCount = drawProjectedPath(context, land, project);
        if (visibleCount >= 3) {
          context.fillStyle = "rgba(27, 142, 164, 0.5)";
          context.strokeStyle = "rgba(184, 244, 255, 0.38)";
          context.lineWidth = 0.72;
          context.fill();
          context.stroke();
        }
      });

      context.strokeStyle = "rgba(102, 197, 255, 0.26)";
      context.lineWidth = 1.1;
      NETWORK_ARCS.forEach(([from, to]) => {
        const a = project(from[0], from[1]);
        const b = project(to[0], to[1]);
        if (!a.visible || !b.visible) return;
        context.beginPath();
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2 - radius * 0.22;
        context.moveTo(a.x, a.y);
        context.quadraticCurveTo(mx, my, b.x, b.y);
        context.stroke();
      });

      CITY_LIGHTS.forEach(([lon, lat], index) => {
        const point = project(lon, lat);
        if (!point.visible) return;
        const pulse = 0.65 + 0.35 * Math.sin(time / 620 + index);
        const opacity = Math.max(0.18, Math.min(0.92, point.z * pulse));
        context.beginPath();
        context.fillStyle = `rgba(214, 247, 255, ${opacity})`;
        context.shadowColor = "rgba(102, 197, 255, 0.75)";
        context.shadowBlur = 8;
        context.arc(point.x, point.y, 1.2 + opacity * 1.4, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      });

      const shade = context.createLinearGradient(cx - radius, cy, cx + radius, cy);
      shade.addColorStop(0, "rgba(2, 10, 22, 0.66)");
      shade.addColorStop(0.52, "rgba(2, 10, 22, 0.02)");
      shade.addColorStop(1, "rgba(2, 10, 22, 0.32)");
      context.fillStyle = shade;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      context.restore();
      context.beginPath();
      context.arc(cx, cy, radius, Math.PI * 1.02, Math.PI * 1.98);
      context.strokeStyle = "rgba(102, 197, 255, 0.62)";
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.arc(cx, cy, radius * 0.98, Math.PI * 1.08, Math.PI * 1.86);
      context.strokeStyle = "rgba(207, 239, 255, 0.16)";
      context.lineWidth = 1;
      context.stroke();

      if (!stopped && !reducedMotion) frame = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    if (!reducedMotion) frame = window.requestAnimationFrame(draw);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="gh-home-globe" aria-hidden="true">
      <canvas ref={canvasRef} />
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
        <svg className="gh-home-trend-placeholder" viewBox="0 0 360 156" preserveAspectRatio="none" aria-hidden="true">
          <path d="M34 126 C72 124 88 113 116 105 C154 94 172 74 214 66 C252 58 288 52 330 42 L330 156 L34 156 Z" />
          <path d="M34 126 C72 124 88 113 116 105 C154 94 172 74 214 66 C252 58 288 52 330 42" />
        </svg>
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

function PostureTrendChart({ trend = [] }) {
  const points = normalizeTrend(trend).filter((point) =>
    Number.isFinite(point.overall) || Number.isFinite(point.policy) || Number.isFinite(point.quality)
  );
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
  const slaY = trendY(90, scale, height);
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
          <line className="gh-home-trend-sla" x1="0" x2={width} y1={slaY} y2={slaY} />
          <path className={`gh-home-trend-area ${series.className}`} d={areaPath} />
          <path className={`gh-home-trend-line ${series.className}`} d={linePath} />
          {latest ? <circle className="gh-home-trend-latest" cx={latest[0]} cy={latest[1]} r="4" /> : null}
        </svg>
        <span className="gh-home-trend-sla-label">SLA 90%</span>
        <div className="gh-home-trend-months">
          {ticks.map((point) => <span key={point.label}>{String(point.label).slice(0, 8)}</span>)}
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

function trendForWindow(trend = [], windowKey = "12w") {
  const selectedWindow = TREND_WINDOWS.find((item) => item.key === windowKey) || TREND_WINDOWS[0];
  const points = normalizeTrend(trend);
  return points.length > selectedWindow.points ? points.slice(-selectedWindow.points) : points;
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
    if (minutes < 1) return `${Math.max(1, Math.floor(deltaMs / 1_000))}s ago`;
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

function kpiByKey(kpis = [], key) {
  return kpis.find((item) => item?.key === key || item?.label === key) || null;
}

function numericValue(value) {
  if (!hasNumericValue(value)) return null;
  return Number(value);
}

function percentLabel(value, fallback = "-") {
  const numeric = numericValue(value);
  return numeric === null ? fallback : `${Math.round(numeric)}%`;
}

function percentPointLabel(value, fallback = "-") {
  const numeric = numericValue(value);
  if (numeric === null) return fallback;
  return Number.isInteger(numeric) ? `${numeric.toFixed(0)}%` : `${numeric.toFixed(1)}%`;
}

function shortDelta(kpi, fallback = "Unavailable") {
  if (!kpi) return fallback;
  return kpi.deltaText || kpi.delta || kpi.detail || kpi.reason || fallback;
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
    .sort((a, b) => b.tables - a.tables)
    .slice(0, 6);
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
  return normalized.length ? normalized.slice(0, 6) : summarizeCatalogs(assets);
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
    .filter((domain) => domain.label)
    .slice(0, 6);
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
  const derivedClean = clean !== null
    ? clean
    : high !== null && governed && governed > 0
      ? Math.max(0, Math.min(100, ((governed - high) / governed) * 100))
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
  atlasAiRequest = fetchAtlasAiRecommendations,
  onRetry,
  onNavigate,
}) {
  const atlasAi = useAtlasAiConversation({ request: atlasAiRequest });
  const [suggestionPage, setSuggestionPage] = useState(0);
  const [trendWindow, setTrendWindow] = useState("26w");
  const [presentMode, setPresentMode] = useState(false);
  const data = useMemo(
    () => normalizeCommandCenter(commandCenter, estate, recentAssets),
    [commandCenter, estate, recentAssets],
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
  const evidenceKind = commandCenterEvidenceKind(data, warnings, state);
  const evidenceWarnings = commandCenterWarnings(data, warnings);
  const isPrototypeEvidence = evidenceKind === "prototype_mock";
  const isLiveEvidence = evidenceKind === "live";
  const commandCenterRefreshLabel = isPrototypeEvidence
    ? `Prototype mock · refreshed ${relativeTimeLabel(data.meta?.generatedAt || data.meta?.updatedAt)} · not live Databricks evidence`
    : isLiveEvidence && (data.meta?.generatedAt || data.meta?.updatedAt)
      ? `Live · refreshed ${relativeTimeLabel(data.meta.generatedAt || data.meta.updatedAt)}`
      : isLiveEvidence
        ? "Live"
        : "Not live verified";
  const heroDescription = isPrototypeEvidence
    ? "Live mode reads Unity Catalog directly: permission-aware, lineage-verified when Databricks reports lineage, and traceable to system table evidence. Prototype capture; not live Databricks proof."
    : isLiveEvidence
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
  const topDomains = data.topDomains.length ? data.topDomains : data.posture?.byDomain || [];
  const priorityEvents = data.recentEvents.filter(isHighPriorityEvent);
  const eventTitle = "Recent High-Priority Events";
  const openSurface = (surfaceKey) => {
    if (!surfaceKey) return;
    onNavigate?.(surfaceKey);
  };
  const aiPromptPool = useMemo(() => {
    const merged = [
      ...(Array.isArray(data.aiPrompts) ? data.aiPrompts : []),
      ...FALLBACK_AI_PROMPTS,
    ]
      .map((prompt) => String(prompt || "").trim())
      .filter(Boolean);
    return Array.from(new Set(merged));
  }, [data.aiPrompts]);
  const visiblePromptCount = atlasAi.messages.length ? 1 : 4;
  const aiPrompts = useMemo(() => {
    if (!aiPromptPool.length) return [];
    const start = (suggestionPage * visiblePromptCount) % aiPromptPool.length;
    return Array.from({ length: Math.min(visiblePromptCount, aiPromptPool.length) }, (_, index) =>
      aiPromptPool[(start + index) % aiPromptPool.length]
    );
  }, [aiPromptPool, suggestionPage, visiblePromptCount]);
  const askAtlasAi = useCallback((question) => atlasAi.ask(question), [atlasAi]);
  const showMoreSuggestions = useCallback(() => {
    setSuggestionPage((current) => current + 1);
  }, []);
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
  const postureValue = postureOverall ?? numericValue(coverageKpi.value);
  const postureTitle = postureOverall === null && numericValue(coverageKpi.value) !== null
    ? "Governance coverage"
    : "Governance posture";
  const domainBarItems = domainBars(topDomains);
  const catalogRows = backedCatalogRows(data, data.recentAssets || recentAssets);
  const displayCatalogRows = [
    ...catalogRows,
    ...CATALOG_PLACEHOLDER_ROWS
      .filter((name) => !catalogRows.some((row) => row.name === name))
      .slice(0, Math.max(0, 6 - catalogRows.length))
      .map((name) => ({
        name,
        tables: null,
        coverage: null,
        classification: "Unavailable",
        risk: "Unavailable",
        state: "placeholder",
      })),
  ].slice(0, 6);
  const cdeItems = cdeRows(data, data.recentAssets || recentAssets);
  const activityRows = eventRows(data.recentEvents);
  const riskSummary = riskSummaryFromData(data, policyKpi, governedAssetsKpi);
  const cdeTrackedCount = numericValue(data.estate?.cdeCount ?? data.insights?.tiles?.cdeCount ?? data.cdeSummary?.totalCdes);
  const baselineAssetCount = numericValue(data.estate?.baselineAssetCount ?? data.narrative?.baselineAssetCount);
  const primaryCatalogLabel = data.meta?.primaryCatalog
    || data.meta?.catalog
    || catalogRows.find((row) => row.state !== "placeholder")?.name
    || (data.estate.catalogCount ? `${formatCount(data.estate.catalogCount)} visible catalog${Number(data.estate.catalogCount) === 1 ? "" : "s"}` : "the visible workspace");
  const visibleTrend = useMemo(
    () => trendForWindow(data.posture?.trend || [], trendWindow),
    [data.posture?.trend, trendWindow],
  );
  const visibleTrendHasHistory = normalizeTrend(visibleTrend).filter((point) =>
    Number.isFinite(point.overall),
  ).length >= 2;
  const selectedTrendWindow = TREND_WINDOWS.find((item) => item.key === trendWindow) || TREND_WINDOWS[0];
  const exportCommandCenterBrief = useCallback(() => {
    if (typeof document === "undefined" || typeof Blob === "undefined") return;
    const workspaceLabel =
      data.meta?.workspace ||
      data.meta?.workspaceName ||
      data.meta?.workspaceLabel ||
      data.estate?.workspace ||
      data.estate?.workspaceName ||
      data.estate?.workspaceLabel ||
      data.meta?.catalog ||
      null;
    const liveDatabricksEvidence = evidenceKind === "live";
    const brief = {
      exportedAt: new Date().toISOString(),
      workspace: {
        label: workspaceLabel,
        evidenceKind,
        liveDatabricksEvidence,
        source: liveDatabricksEvidence
          ? "Databricks workspace/runtime metadata"
          : evidenceKind === "prototype_mock"
            ? "prototype mock shell/meta workspace label"
            : "non-authoritative command-center metadata",
        warning: liveDatabricksEvidence
          ? null
          : "Workspace label is not live Databricks proof.",
      },
      workspaceLabel,
      generatedAt: data.meta?.generatedAt || data.meta?.updatedAt || null,
      provenance: {
        evidenceKind,
        liveDatabricksEvidence,
        summary: provenanceSummary(evidenceKind),
        state,
        metaState: data.meta?.state || null,
        warnings: evidenceWarnings,
      },
      posture: {
        value: postureValue,
        title: postureTitle,
        trendDelta: trendDeltaLabel(data.posture?.trend || []),
        evidenceKind,
        liveDatabricksEvidence: evidenceKind === "live",
        source: evidenceKind === "prototype_mock" ? "prototype mock command-center payload" : provenanceSummary(evidenceKind),
      },
      kpis: kpis.map((kpi) => ({
        key: kpi.key,
        label: kpi.label,
        value: formatMetricValue(kpi),
        delta: shortDelta(kpi, "Unavailable"),
        state: metricState(kpi),
        evidenceKind,
        liveDatabricksEvidence: evidenceKind === "live",
        source: evidenceKind === "prototype_mock" ? "prototype mock command-center payload" : provenanceSummary(evidenceKind),
      })),
      topCatalogs: catalogRows.map((catalog) => ({
        catalog: catalog.name,
        tables: catalog.tables,
        coverage: catalog.coverage,
        classification: catalog.classification,
        risk: catalog.risk,
        evidenceKind,
        liveDatabricksEvidence: evidenceKind === "live",
        source: evidenceKind === "prototype_mock" ? "prototype mock command-center payload" : provenanceSummary(evidenceKind),
      })),
      recentActivity: activityRows.map((activity) => ({
        ...activity,
        evidenceKind,
        liveDatabricksEvidence: evidenceKind === "live",
        source: evidenceKind === "prototype_mock" ? "prototype mock command-center payload" : provenanceSummary(evidenceKind),
      })),
    };
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" });
    const createUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL
      : null;
    const revokeUrl = typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function"
      ? URL.revokeObjectURL.bind(URL)
      : null;
    if (!createUrl) return;
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
  }, [activityRows, catalogRows, data.meta, data.posture?.trend, evidenceKind, evidenceWarnings, kpis, postureTitle, postureValue, state]);
  const togglePresentMode = useCallback(() => {
    setPresentMode((current) => !current);
  }, []);
  const openCommandCenterSurface = useCallback((surfaceKey) => {
    if (!surfaceKey) return;
    onNavigate?.(surfaceKey);
  }, [onNavigate]);
  const handleCatalogKeyDown = useCallback((event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openCommandCenterSurface("discovery");
  }, [openCommandCenterSurface]);
  const explicitChanges = explicitChangeRows(data.changesToday || data.changes || data.deltaRows);
  const changedToday = explicitChanges.length ? explicitChanges : [
    {
      label: "Coverage",
      value: percentLabel(coverageKpi.value),
      delta: shortDelta(coverageKpi, "Coverage signal unavailable"),
      previous: coverageKpi.previousValue ?? coverageKpi.previous ?? null,
      previousFormat: "percent",
      tone: metricState(coverageKpi) === "unavailable" ? "muted" : "good",
    },
    {
      label: "Quality SLA",
      value: percentLabel(data.insights?.qualitySla ?? data.qualitySla),
      delta: data.insights?.qualitySignalAvailable ? "Latest quality expectations passing" : "Quality signal unavailable",
      previous: data.insights?.previousQualitySla ?? null,
      previousFormat: "percent",
      tone: data.insights?.qualitySignalAvailable ? "good" : "muted",
    },
    {
      label: riskSummary.severityAvailable ? "High-risk exposures" : "Open exposures",
      value: riskSummary.severityAvailable
        ? (riskSummary.high === null ? "-" : formatCount(riskSummary.high))
        : formatMetricValue(policyKpi),
      delta: shortDelta(policyKpi, "Exposure signal unavailable"),
      previous: policyKpi.previousValue ?? policyKpi.previous ?? null,
      previousFormat: "count",
      tone: metricState(policyKpi) === "unavailable" ? "muted" : "warn",
    },
    {
      label: "Lineage coverage",
      value: percentLabel(data.lineage?.coverage ?? data.insights?.lineageCoverage),
      delta: data.signalAvailability?.lineage ? "Lineage signal available" : "Lineage signal unavailable",
      previous: data.lineage?.previousCoverage ?? data.insights?.previousLineageCoverage ?? null,
      previousFormat: "percent",
      tone: data.signalAvailability?.lineage ? "info" : "muted",
    },
  ];
  const narrativeTarget = data.narrative?.target || "90% Q2 target";
  const narrativeTargetWeek = data.narrative?.targetWeek || "week 30";
  const narrativeHeadline = baselineAssetCount !== null && numericValue(governedAssetsKpi.value) !== null
    ? (
      <>
        <strong>{formatMetricValue(governedAssetsKpi)}</strong> of {formatCount(baselineAssetCount)} productionized assets meet baseline policy.
        {" "}Coverage is up <strong>{Math.round(postureValue ?? numericValue(coverageKpi.value) ?? 0) - Math.round(numericValue(coverageKpi.previousValue ?? coverageKpi.previous ?? 78.4) ?? 78.4)} points</strong>
        {" "}this quarter - on track to hit the <span>{narrativeTarget}</span> by {narrativeTargetWeek}.
      </>
    )
    : (
      <>
        <strong>{formatMetricValue(governedAssetsKpi)}</strong> governed assets are in scope.
        {" "}Coverage is {percentLabel(coverageKpi.value, "unavailable")}.
      </>
    );
  const heroCertifiedKpi = isPrototypeEvidence ? governedAssetsKpi : certifiedKpi;
  const heroFacts = [
    {
      icon: "shield",
      label: "Certified assets",
      value: formatMetricValue(heroCertifiedKpi),
      delta: isPrototypeEvidence ? (shortDelta(governedAssetsKpi, "+82 this quarter")) : shortDelta(certifiedKpi, "Signal unavailable"),
      tone: "good",
    },
    {
      icon: "flag",
      label: "Open exposures",
      value: formatMetricValue(policyKpi),
      delta: isPrototypeEvidence ? "3 require Compliance review" : shortDelta(policyKpi, "Signal unavailable"),
      tone: metricState(policyKpi) === "unavailable" ? "muted" : "bad",
    },
    {
      icon: "key",
      label: "CDEs tracked",
      value: cdeTrackedCount === null ? "-" : formatCount(cdeTrackedCount),
      delta: isPrototypeEvidence
        ? "Prototype registry fixture"
        : data.signalAvailability?.lineage
          ? "Lineage-backed"
          : "Lineage proof unavailable",
      tone: "info",
    },
  ];
  const prototypeKpis = [
    {
      label: "Governance coverage",
      value: percentLabel(coverageKpi.value),
      delta: shortDelta(coverageKpi, "Signal unavailable"),
      tone: metricState(coverageKpi) === "unavailable" ? "muted" : "good",
      sparkline: coverageKpi.sparkline || [],
    },
    {
      label: "Certified assets",
      value: formatMetricValue(certifiedKpi),
      delta: shortDelta(certifiedKpi, "Signal unavailable"),
      tone: metricState(certifiedKpi) === "unavailable" ? "muted" : "good",
      sparkline: certifiedKpi.sparkline || [],
    },
    {
      label: "Open stewardship items",
      value: formatMetricValue(stewardshipKpi),
      delta: shortDelta(stewardshipKpi, "Signal unavailable"),
      tone: metricState(stewardshipKpi) === "unavailable" ? "muted" : "warn",
      sparkline: stewardshipKpi.sparkline || [],
    },
    {
      label: riskSummary.severityAvailable ? "High-risk exposures" : "Open exposures",
      value: riskSummary.severityAvailable
        ? (riskSummary.high === null ? "-" : formatCount(riskSummary.high))
        : formatMetricValue(policyKpi),
      delta: shortDelta(policyKpi, "Signal unavailable"),
      tone: metricState(policyKpi) === "unavailable" ? "muted" : "bad",
      sparkline: policyKpi.sparkline || [],
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
            <h1>Governance posture, at a glance</h1>
            <p>{heroDescription}</p>
          </div>
          <div className="gh-command-center-actions">
            <button type="button" onClick={exportCommandCenterBrief}><Icon name="download" />Export brief</button>
            <button type="button" aria-pressed={presentMode} onClick={togglePresentMode}>
              <Icon name="presentation" />
              {presentMode ? "Exit present mode" : "Present mode"}
            </button>
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

        <section className="gh-command-center-state-card" aria-label="Current governance posture">
          <div className="gh-command-center-score">
            {postureValue === null ? (
              <>
                <div className="gh-command-center-score-unavailable">
                  <strong>-</strong>
                  <span>{postureTitle}</span>
                </div>
                <em>{trendDeltaLabel(data.posture?.trend || [])}</em>
              </>
            ) : (
              <CommandCenterTrustRing
                value={postureValue}
                trend={isPrototypeEvidence ? "9.0 pts QoQ" : trendDeltaLabel(data.posture?.trend || []).replace(/^\+/, "")}
              />
            )}
          </div>
          <div className="gh-command-center-narrative">
            <span>The state of {primaryCatalogLabel}</span>
            <h2>
              {narrativeHeadline}
            </h2>
            <div className="gh-command-center-facts">
              {heroFacts.map((fact) => (
                <span className={`tone-${fact.tone}`} key={fact.label}>
                  <i aria-hidden="true"><Icon name={fact.icon} /></i>
                  <small>{fact.label}</small>
                  <b>{fact.value}</b>
                  <em>{fact.delta}</em>
                </span>
              ))}
            </div>
          </div>
          <div className="gh-command-center-changes">
            <h3>What changed today</h3>
            {changedToday.map((item) => (
              <div
                className={`gh-command-center-change tone-${item.tone}`}
                key={item.label}
                title={isPrototypeEvidence ? "Prototype mock change row, not live Databricks evidence." : undefined}
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
            ))}
          </div>
        </section>

        <section className="gh-command-center-kpi-row" aria-label="Governance summary metrics">
          {prototypeKpis.map((metric) => (
            <article className={`gh-command-center-kpi tone-${metric.tone}`} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <em>{metric.delta}</em>
              <div className="gh-command-center-kpi-spark">
                {metric.sparkline?.length >= 2 ? (
                  (() => {
                    const shape = metricSparklineShape(metric.sparkline);
                    return shape ? (
                      <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
                        <path className="gh-command-center-kpi-spark-fill" d={shape.area} />
                        <path className="gh-command-center-kpi-spark-line" d={shape.line} />
                      </svg>
                    ) : (
                      <svg className="is-unavailable" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M0 30 C20 30 28 27 42 27 C56 27 66 22 78 20 C88 18 96 12 100 6" />
                      </svg>
                    );
                  })()
                ) : (
                  <svg className="is-unavailable" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M0 30 C20 30 28 27 42 27 C56 27 66 22 78 20 C88 18 96 12 100 6" />
                  </svg>
                )}
              </div>
            </article>
          ))}
        </section>

        <div className="gh-command-center-grid">
          <SectionCard
            className="gh-command-center-trend"
            title="Coverage trend · last 12 weeks"
            subtitle="Share of productionized assets meeting baseline policy"
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
            <PostureTrendChart trend={visibleTrend} />
            <div className="gh-command-center-trend-footer">
              <span><strong>{isPrototypeEvidence ? "+9.0 pts" : trendDeltaLabel(visibleTrend)}</strong> over the last 12 weeks</span>
              <span>{`SLA: >=90% by end of Q2`}</span>
              {isPrototypeEvidence && visibleTrendHasHistory ? (
                <span>Projected: <strong>91.2% by W30</strong></span>
              ) : (
                <span><strong>Projection unavailable</strong></span>
              )}
            </div>
          </SectionCard>

          <SectionCard
            className="gh-command-center-domain"
            title="Posture by domain"
            subtitle={isPrototypeEvidence ? "Coverage x certified asset count" : "Coverage x visible asset count"}
            tooltip={isPrototypeEvidence
              ? "Prototype domain scores are visual fixtures, not live certified-count proof."
              : "Domain scores use backed command-center domain signals when available."}
          >
            <div className={`gh-command-center-domain-bars ${domainBarItems.length ? "" : "is-unavailable"}`.trim()}>
              {(domainBarItems.length ? domainBarItems : DOMAIN_PLACEHOLDER_ROWS.map((label) => ({
                label,
                score: null,
                count: null,
              }))).map((domain) => (
                <button
                  aria-label={domain.score === null ? `${domain.label} domain signal unavailable` : `Open discovery for ${domain.label} domain posture`}
                  className={`gh-command-center-domain-row tone-${domain.tone || "empty"}`}
                  disabled={domain.score === null}
                  key={domain.label}
                  onClick={() => openCommandCenterSurface("discovery")}
                  title={domain.score === null ? "Domain posture signal unavailable" : `Open discovery for ${domain.label}`}
                  type="button"
                >
                  <span>{domain.label}</span>
                  <i aria-hidden="true"><b style={{ width: `${domain.score ?? 0}%` }} /></i>
                  <strong>{domain.score === null ? "-" : `${Math.round(domain.score)}%`}</strong>
                  {domain.count !== null ? <em>{formatCount(domain.count)} {isPrototypeEvidence ? "cert" : "assets"}</em> : <em>Domain signal unavailable</em>}
                </button>
              ))}
              {!domainBarItems.length ? (
                <div className="gh-command-center-inline-unavailable">Domain posture signals unavailable.</div>
              ) : null}
              </div>
          </SectionCard>

          <SectionCard
            className="gh-command-center-risk"
            title="Risk breakdown"
            subtitle="Open exposures by severity"
            tooltip="Risk distribution renders unavailable unless explicit exposure severity signals are present."
          >
            <div className="gh-command-center-risk-body">
              <div className={`gh-command-center-risk-ring ${riskSummary.cleanScore === null ? "is-unavailable" : ""}`.trim()}>
                <strong>{riskSummary.cleanScore === null ? "-" : `${Math.round(riskSummary.cleanScore)}%`}</strong>
                <span>Risk-clean</span>
              </div>
              <ul>
                <li>
                  <button
                    aria-label={`Open stewardship for ${riskSummary.severityAvailable ? "high-risk exposures" : "open exposures"}`}
                    disabled={!riskSummary.sourceAvailable}
                    onClick={() => openCommandCenterSurface("stewardship")}
                    title={riskSummary.sourceAvailable ? "Open stewardship queue for exposure review" : "Exposure source unavailable"}
                    type="button"
                  >
                    <b className="tone-bad" />
                    <span>{riskSummary.severityAvailable ? "High-risk exposures" : "Open exposures"}</span>
                    <strong>
                      {riskSummary.severityAvailable
                        ? (riskSummary.high === null ? "-" : formatCount(riskSummary.high))
                        : (riskSummary.openExposure === null ? "-" : formatCount(riskSummary.openExposure))}
                    </strong>
                  </button>
                </li>
                <li>
                  <button
                    aria-label="Open audit evidence for medium-risk findings"
                    disabled={!riskSummary.severityAvailable}
                    onClick={() => openCommandCenterSurface("audit")}
                    title={riskSummary.severityAvailable ? "Open audit evidence for risk findings" : "Risk severity source unavailable"}
                    type="button"
                  >
                    <b className="tone-warn" />
                    <span>Medium-risk findings</span>
                    <strong>{riskSummary.medium === null ? "-" : formatCount(riskSummary.medium)}</strong>
                  </button>
                </li>
                <li>
                  <button
                    aria-label="Open audit evidence for informational risk findings"
                    disabled={!riskSummary.severityAvailable}
                    onClick={() => openCommandCenterSurface("audit")}
                    title={riskSummary.severityAvailable ? "Open audit evidence for informational findings" : "Risk severity source unavailable"}
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
              {isPrototypeEvidence
                ? "Prototype fixture - 3 of 7 high-risk items require Compliance review."
                : riskSummary.severityAvailable
                  ? "Risk-clean score is derived from backed exposure counts across governed assets."
                  : riskSummary.openExposure !== null
                  ? "Open exposure count is backed; severity split is unavailable for this workspace."
                  : "Exposure severity source unavailable for this workspace."}
            </p>
          </SectionCard>

          <SectionCard
            className="gh-command-center-catalogs"
            title="Top catalogs · health snapshot"
            subtitle={isPrototypeEvidence
              ? "From system.information_schema joined with governance state"
              : "Visible catalog health joined with backed governance state"}
            tooltip={isPrototypeEvidence
              ? "Prototype catalog health rows are visual fixtures, not live catalog diagnostics."
              : "Catalog rows are derived from visible asset inventory and backed metadata coverage fields."}
          >
            <div className={`gh-command-center-catalog-table ${catalogRows.length ? "" : "is-unavailable"}`.trim()} role="table" aria-label="Top catalog health snapshot">
              <div role="row">
                <span role="columnheader">Catalog</span>
                <span role="columnheader">Tables</span>
                <span role="columnheader">Coverage</span>
                <span role="columnheader">Classification</span>
                <span role="columnheader">Risk</span>
              </div>
              {displayCatalogRows.map((catalog) => {
                const isPlaceholder = catalog.state === "placeholder";
                return (
                  <div
                    className={isPlaceholder ? "is-placeholder" : "is-clickable"}
                    onClick={isPlaceholder ? undefined : () => openCommandCenterSurface("discovery")}
                    onKeyDown={isPlaceholder ? undefined : handleCatalogKeyDown}
                    role="row"
                    tabIndex={isPlaceholder ? -1 : 0}
                    title={isPlaceholder ? "Catalog health signal unavailable" : `Open discovery for ${catalog.name}`}
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
          </SectionCard>

          <SectionCard
            className="gh-command-center-cdes"
            title="Critical data elements"
            subtitle={isPrototypeEvidence
              ? "Prototype registry fixture - not live lineage proof"
              : "Backed CDE registry rows with owner and lineage evidence when available"}
            tooltip={isPrototypeEvidence
              ? "Prototype CDE rows are visual fixtures until backed by a live CDE registry signal."
              : "CDE rows require backed CDE registry data or asset-level critical-element metadata."}
            actions={<button type="button" className="ga-link-button" onClick={() => openSurface("cde")}>View all</button>}
          >
            <div className={`gh-command-center-cde-grid ${cdeItems.length ? "" : "is-unavailable"}`.trim()}>
              {(cdeItems.length ? cdeItems : CDE_PLACEHOLDER_ROWS.map((name) => ({
                id: name,
                name,
                column: "Source-of-record column unavailable",
                owner: "Owner unavailable",
                status: "Unavailable",
                sox: false,
                state: "placeholder",
              }))).map((item) => {
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
                      <i title={isPrototypeEvidence && !isPlaceholder ? "Prototype mock CDE row, not live Databricks evidence." : undefined}>
                        {item.status || "Unavailable"}
                      </i>
                    </small>
                  </button>
                );
              })}
              {!cdeItems.length ? (
                <div className="gh-command-center-inline-unavailable">Critical data element registry signals are unavailable in this command-center snapshot.</div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            className="gh-command-center-activity"
            title="Activity stream"
            subtitle={isPrototypeEvidence ? "Prototype audit log · permission-filtered" : "Live audit log · permission-filtered"}
            tooltip={isPrototypeEvidence
              ? "Prototype activity rows are visual fixtures, not live audit events."
              : "Recent activity uses audit/governance events returned by the command-center API."}
          >
            <ul className={`gh-command-center-activity-list ${activityRows.length ? "" : "is-unavailable"}`.trim()}>
              {(activityRows.length ? activityRows : [
                { id: "activity-placeholder-1", actor: "Governance Atlas", title: "No recent governance activity available.", time: "Awaiting backed audit events", tone: "info", state: "placeholder" },
                { id: "activity-placeholder-2", actor: "Audit evidence", title: "Activity stream will populate when events are returned.", time: "Unavailable", tone: "info", state: "placeholder" },
              ]).map((event) => {
                const isPlaceholder = event.state === "placeholder";
                return (
                  <li className={`tone-${event.tone}`} key={event.id}>
                    <button type="button" disabled={isPlaceholder} onClick={() => openCommandCenterSurface("audit")}>
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
