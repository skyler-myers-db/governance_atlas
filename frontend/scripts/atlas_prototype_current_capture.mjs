import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_URL =
  process.env.GOVAT_BASE_URL ||
  "https://atlas-2543889327043640.aws.databricksapps.com";
const TOKEN = process.env.GOVAT_DATABRICKS_TOKEN || "";
const EXPECTED_BUILD_ID = process.env.GOVAT_BUILD_ID || "";
const DEPLOYMENT_ID = process.env.GOVAT_DEPLOYMENT_ID || "";
const SETTLE_TIMEOUT_MS = Number.parseInt(process.env.GOVAT_PROTOTYPE_SETTLE_TIMEOUT_MS || "90000", 10);
const TEXT_SETTLE_TIMEOUT_MS = Number.parseInt(process.env.GOVAT_PROTOTYPE_TEXT_SETTLE_TIMEOUT_MS || "120000", 10);
const SHELL_FALLBACK = process.env.GOVAT_PROTOTYPE_SHELL_FALLBACK === "1";
const MOCK_API = process.env.GOVAT_PROTOTYPE_MOCK_API === "1";
const SCROLL_MAIN = process.env.GOVAT_PROTOTYPE_SCROLL_MAIN === "1";
const CAPTURE_FULL_PAGE = process.env.GOVAT_PROTOTYPE_FULL_PAGE !== "0";
const CAPTURE_INTERACTIONS = process.env.GOVAT_PROTOTYPE_INTERACTIONS === "1";
const DEBUG_STEPS = process.env.GOVAT_PROTOTYPE_DEBUG_STEPS === "1";
const ROUTE_FILTER = new Set(
  (process.env.GOVAT_PROTOTYPE_ROUTES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const INTERACTION_FILTER = new Set(
  (process.env.GOVAT_PROTOTYPE_INTERACTION_KEYS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const OUT_DIR =
  process.env.GOVAT_PROTOTYPE_CAPTURE_OUT ||
  path.join(REPO_ROOT, "docs/northstar_visual_qa/prototype-current");
function normalizeEvidencePath(value) {
  const resolved = path.resolve(value);
  const relative = path.relative(REPO_ROOT, resolved);
  const normalized =
    relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative
      : value;
  return normalized.split(path.sep).join("/");
}
const CURRENT_REPORT_PATH = `${normalizeEvidencePath(OUT_DIR)}/prototype-current-report.json`;
const LIVE_DATABRICKS_CAPTURE = Boolean(TOKEN && /\.databricksapps\.com(?:\/|$)/i.test(BASE_URL));
const DEFAULT_ASSET_FQN = MOCK_API
  ? "finance_prod.curated.revenue_daily"
  : "datapact.governance_atlas_demo.customer_stewardship_queue";
const ASSET_FQN =
  process.env.GOVAT_PROTOTYPE_ASSET_FQN ||
  DEFAULT_ASSET_FQN;

const PROTOTYPE_DISCOVERY_ASSETS = [
  {
    fqn: "finance_prod.curated.revenue_daily",
    name: "revenue_daily",
    fullPath: "finance_prod.curated.revenue_daily",
    catalog: "finance_prod",
    schema: "curated",
    objectType: "Delta Table",
    description: "Authoritative day-grain revenue grain by product line, channel, and region. Source-of-record for the CFO dashboard and quarterly board reporting.",
    coverageScore: 96,
    qualityScore: 96,
    columnCount: 10,
    lineageCount: 28,
    rows: 1_247_835,
    domain: "Finance",
    certification: "Certified",
    sensitivity: "Confidential",
    cde: true,
    pii: false,
    freshness: "14 min ago",
    queries30d: 14782,
    upstream: 5,
    downstream: 23,
    owners: [{ name: "Marisol Reyes", title: "Finance Steward" }],
    stewardTeam: "Finance Stewards",
    tagLabels: ["sox-relevant", "revenue", "gold"],
    glossaryTerms: [{ label: "Net Revenue" }, { label: "Revenue Recognition" }],
    columns: [
      { name: "date_key", type: "DATE", isPrimaryKey: true },
      { name: "product_line", type: "STRING" },
      { name: "channel", type: "STRING" },
      { name: "region", type: "STRING" },
      { name: "gross_revenue_usd", type: "DECIMAL" },
      { name: "net_revenue_usd", type: "DECIMAL", tags: ["CDE"] },
    ],
  },
  {
    fqn: "customer_360.gold.customer_profile",
    name: "customer_profile",
    fullPath: "customer_360.gold.customer_profile",
    catalog: "customer_360",
    schema: "gold",
    objectType: "Delta Table",
    description: "360-degree unified customer profile: demographics, lifecycle stage, segments, contact channels. Driving personalization and CS routing.",
    coverageScore: 91,
    qualityScore: 92,
    columnCount: 64,
    lineageCount: 52,
    rows: 38_400_000,
    domain: "Customer",
    certification: "Certified",
    sensitivity: "Restricted",
    cde: true,
    pii: true,
    freshness: "1 hr ago",
    queries30d: 9210,
    upstream: 11,
    downstream: 41,
    owners: [{ name: "Aaron Chen", title: "Customer Steward" }],
    stewardTeam: "Customer Stewards",
    tagLabels: ["Certified", "Restricted", "CDE", "PII"],
    glossaryTerms: [{ label: "Customer" }],
  },
  {
    fqn: "sales_prod.silver.orders",
    name: "orders",
    fullPath: "sales_prod.silver.orders",
    catalog: "sales_prod",
    schema: "silver",
    objectType: "Delta Table",
    description: "Cleansed order events with currency normalization. Feeds revenue, attribution, and finance pipelines.",
    coverageScore: 94,
    qualityScore: 94,
    columnCount: 38,
    lineageCount: 20,
    rows: 9_100_000,
    domain: "Revenue & Sales",
    certification: "Certified",
    sensitivity: "Confidential",
    cde: true,
    freshness: "5 min ago",
    queries30d: 12044,
    upstream: 3,
    downstream: 17,
    owners: [{ name: "Priya Natarajan", title: "Revenue Steward" }],
    stewardTeam: "Revenue Stewards",
    tagLabels: ["Certified", "Confidential", "CDE"],
    glossaryTerms: [{ label: "Booking" }],
  },
  {
    fqn: "product_events.bronze.clickstream_events",
    name: "clickstream_events",
    fullPath: "product_events.bronze.clickstream_events",
    catalog: "product_events",
    schema: "bronze",
    objectType: "Delta Table",
    description: "Raw web and mobile click events from Snowplow. High volume; downstream pipelines aggregate into product_events.silver.sessions.",
    coverageScore: 78,
    qualityScore: 81,
    columnCount: 42,
    lineageCount: 7,
    rows: 4_287_400_000,
    domain: "Customer",
    certification: "In Review",
    sensitivity: "Internal",
    pii: true,
    freshness: "3 min ago",
    queries30d: 244,
    upstream: 1,
    downstream: 6,
    owners: [{ name: "Devon Park", title: "Product Analytics" }],
    stewardTeam: "Product Analytics",
    tagLabels: ["In Review", "Internal", "PII"],
    glossaryTerms: [{ label: "Session" }],
  },
  {
    fqn: "hr_secure.confidential.compensation_band",
    name: "compensation_band",
    fullPath: "hr_secure.confidential.compensation_band",
    catalog: "hr_secure",
    schema: "confidential",
    objectType: "Delta Table",
    description: "Compensation band metadata by job family and level. Restricted access. Permission-gated.",
    coverageScore: 99,
    qualityScore: null,
    columnCount: 16,
    lineageCount: 2,
    rows: 1248,
    domain: "People",
    certification: "Certified",
    sensitivity: "Restricted",
    cde: true,
    pii: true,
    freshness: "6 hr ago",
    queries30d: 86,
    upstream: 2,
    downstream: 0,
    owners: [{ name: "Yuki Tanaka", title: "People Steward" }],
    stewardTeam: "People Stewards",
    tagLabels: ["Certified", "Restricted", "CDE", "PII"],
    glossaryTerms: [{ label: "Compensation Band" }],
  },
  {
    fqn: "marketing_mart.gold.attribution_daily",
    name: "attribution_daily",
    fullPath: "marketing_mart.gold.attribution_daily",
    catalog: "marketing_mart",
    schema: "gold",
    objectType: "View",
    description: "Multi-touch attribution at the campaign and channel day grain. Used by exec marketing dashboards.",
    coverageScore: 88,
    qualityScore: 89,
    columnCount: 24,
    lineageCount: 17,
    rows: 400_000,
    domain: "Marketing",
    certification: "Certified",
    sensitivity: "Internal",
    freshness: "32 min ago",
    queries30d: 2810,
    upstream: 6,
    downstream: 11,
    owners: [{ name: "Lina Okafor", title: "Marketing Steward" }],
    stewardTeam: "Marketing Stewards",
    tagLabels: ["Certified", "Internal"],
    glossaryTerms: [{ label: "Attribution" }],
  },
  {
    fqn: "customer_360.ml.churn_propensity_v3",
    name: "churn_propensity_v3",
    fullPath: "customer_360.ml.churn_propensity_v3",
    catalog: "customer_360",
    schema: "ml",
    objectType: "Model",
    description: "Gradient-boosted churn propensity served via Databricks Model Serving. Inputs: customer_profile, billing_events.",
    coverageScore: 92,
    qualityScore: 91,
    columnCount: 31,
    lineageCount: 11,
    rows: "",
    domain: "Customer",
    certification: "Certified",
    sensitivity: "Confidential",
    freshness: "2 day ago",
    queries30d: 411,
    upstream: 3,
    downstream: 4,
    owners: [{ name: "Aaron Chen", title: "Customer Steward" }],
    stewardTeam: "Customer Stewards",
    tagLabels: ["Certified", "Confidential"],
    glossaryTerms: [{ label: "Churn Propensity" }],
  },
  {
    fqn: "experimental.sandbox.pricing_experiment_2025q4",
    name: "pricing_experiment_2025q4",
    fullPath: "experimental.sandbox.pricing_experiment_2025q4",
    catalog: "experimental",
    schema: "sandbox",
    objectType: "Delta Table",
    description: "Sandbox table from a pricing experiment. No owner, no description until last week. Auto-flagged.",
    coverageScore: 42,
    qualityScore: null,
    columnCount: 8,
    lineageCount: 1,
    rows: 100_000,
    domain: "Revenue & Sales",
    certification: "Uncertified",
    sensitivity: "Unclassified",
    freshness: "12 day ago",
    queries30d: 14,
    upstream: 1,
    downstream: 0,
    owners: [],
    tagLabels: ["Uncertified", "Unclassified"],
    glossaryTerms: [],
  },
];

const PROTOTYPE_DISCOVERY_FACETS = {
  certifications: [
    { value: "Certified", count: 6 },
    { value: "In Review", count: 1 },
    { value: "Uncertified", count: 1 },
  ],
  domains: [
    { value: "Revenue & Sales", count: 2 },
    { value: "Customer", count: 3 },
    { value: "Marketing", count: 1 },
    { value: "Finance", count: 1 },
    { value: "Operations", count: 0 },
    { value: "People", count: 1 },
  ],
  sensitivities: [
    { value: "Restricted", count: 2 },
    { value: "Confidential", count: 3 },
    { value: "Internal", count: 2 },
    { value: "Unclassified", count: 1 },
  ],
  assetTypes: [
    { value: "Delta Table", count: 6 },
    { value: "View", count: 1 },
    { value: "Model", count: 1 },
  ],
  catalogs: [
    { value: "finance_prod", count: 1 },
    { value: "customer_360", count: 2 },
    { value: "sales_prod", count: 1 },
    { value: "product_events", count: 1 },
    { value: "hr_secure", count: 1 },
    { value: "marketing_mart", count: 1 },
    { value: "experimental", count: 1 },
  ],
};

const DEFAULT_VIEWPORTS = [
  { name: "1536x1024", width: 1536, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x720", width: 1280, height: 720 },
];

function parseViewportList(value) {
  const parsed = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d{3,5})x(\d{3,5})$/i);
      if (!match) return null;
      const width = Number.parseInt(match[1], 10);
      const height = Number.parseInt(match[2], 10);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
      return { name: `${width}x${height}`, width, height };
    })
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_VIEWPORTS;
}

const VIEWPORTS = parseViewportList(process.env.GOVAT_PROTOTYPE_VIEWPORTS);

const SCREENSHOT_ROUTES = [
  { key: "command-center", path: "/command-center", settle: ".gh-home-page" },
  { key: "discover", path: "/discover", settle: ".gh-discovery-workspace,.gh-discovery-main-grid" },
  { key: "stewardship", path: "/stewardship", settle: ".gh-governance-ns-table,.gh-governance-ns-empty" },
  { key: "glossary", path: "/glossary-cdes", settle: ".gh-taxonomy-ns,.gh-taxonomy-workspace,.gh-workspace" },
  { key: "cde-registry", path: "/glossary-cdes?tab=cdes", settle: ".gh-taxonomy-ns,.gh-taxonomy-workspace,.gh-workspace" },
  { key: "lineage", path: `/lineage-atlas/${encodeURIComponent(ASSET_FQN)}`, settle: ".ga-lineage-explorer,.gh-lineage-workspace,.gh-lineage-canvas,.gh-workspace" },
  { key: "audit", path: "/audit-evidence", settle: ".gh-audit-ns,.gh-audit-workspace,.gh-workspace" },
  { key: "control-center", path: "/control-center", settle: ".gh-admin-ns,.gh-admin-workspace,.gh-workspace" },
];

const SUPPORTING_ROUTES = [
  { key: "asset360", path: `/entity/${encodeURIComponent(ASSET_FQN)}`, settle: ".gh-entity-workspace,.gh-entity-record-layout,.gh-workspace" },
];

const ROUTES = [...SCREENSHOT_ROUTES, ...SUPPORTING_ROUTES];
const KNOWN_ROUTE_KEYS = new Set(ROUTES.map((route) => route.key));
const UNKNOWN_ROUTE_FILTERS = Array.from(ROUTE_FILTER).filter((routeKey) => !KNOWN_ROUTE_KEYS.has(routeKey));

const SELECTED_ROUTES = ROUTE_FILTER.size
  ? ROUTES.filter((route) => ROUTE_FILTER.has(route.key))
  : SCREENSHOT_ROUTES;
const EXPECTED_CAPTURE_COUNT = SELECTED_ROUTES.length * VIEWPORTS.length;

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  buildId: EXPECTED_BUILD_ID,
  deploymentId: DEPLOYMENT_ID,
  assetFqn: ASSET_FQN,
  mockApi: MOCK_API,
  evidenceKind: MOCK_API ? "prototype_mock" : LIVE_DATABRICKS_CAPTURE ? "live_databricks" : "runtime_app_capture",
  mockEvidenceWarning: MOCK_API ? "Prototype mock data, not live Databricks evidence." : "",
  liveDatabricksCapture: LIVE_DATABRICKS_CAPTURE,
  routeFilter: Array.from(ROUTE_FILTER),
  interactionFilter: Array.from(INTERACTION_FILTER),
  routeFilterUnknown: UNKNOWN_ROUTE_FILTERS,
  selectedRoutes: SELECTED_ROUTES.map((route) => route.key),
  viewports: VIEWPORTS,
  expectedCaptureCount: EXPECTED_CAPTURE_COUNT,
  captures: [],
  interactions: [],
  console: [],
  pageErrors: [],
  requestFailures: [],
  checks: {
    buildMatches: EXPECTED_BUILD_ID ? false : true,
  },
};

const PROTOTYPE_MOCK_SOURCE = "local-prototype-mock";
const PROTOTYPE_MOCK_STATE = "prototype_mock";
const PROTOTYPE_MOCK_WARNING = "Prototype mock data, not live Databricks evidence.";
const mockApiFlags = {
  auditDegraded: process.env.GOVAT_PROTOTYPE_AUDIT_DEGRADED === "1",
  discoveryDegraded: false,
  governanceDegraded: process.env.GOVAT_PROTOTYPE_GOVERNANCE_DEGRADED === "1",
  previewDegraded: false,
  taxonomyDegraded: process.env.GOVAT_PROTOTYPE_TAXONOMY_DEGRADED === "1",
};

function prototypeMockWarnings(warnings = []) {
  return Array.from(new Set([PROTOTYPE_MOCK_WARNING, ...(Array.isArray(warnings) ? warnings : [])].filter(Boolean)));
}

function prototypeMockMeta(extra = {}) {
  return {
    ...extra,
    state: PROTOTYPE_MOCK_STATE,
    source: PROTOTYPE_MOCK_SOURCE,
    authoritative: false,
    degraded: true,
    warnings: prototypeMockWarnings(extra.warnings),
  };
}

function prototypeMockCapability(extra = {}) {
  return {
    ...extra,
    available: extra.available !== false,
    state: PROTOTYPE_MOCK_STATE,
    source: PROTOTYPE_MOCK_SOURCE,
    authoritative: false,
    reason: extra.reason || PROTOTYPE_MOCK_WARNING,
  };
}

function urlFor(routePath) {
  return new URL(routePath, BASE_URL).toString();
}

async function loadJson(relativePath, fallback) {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, relativePath), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  };
}

function requestRefererHasFlag(route, flag) {
  try {
    const referer = route.request().headers()?.referer || "";
    if (!referer) return false;
    return new URL(referer).searchParams.get(flag) === "1";
  } catch {
    return false;
  }
}

function syntheticCommandCenter() {
  const now = Date.now();
  const minutesAgo = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const secondsAgo = (seconds) => new Date(now - seconds * 1_000).toISOString();
  const domains = [
    { domain: "Revenue & Sales", score: 92, count: 138 },
    { domain: "Customer", score: 84, count: 174 },
    { domain: "Marketing", score: 88, count: 89 },
    { domain: "Finance", score: 95, count: 121 },
    { domain: "Operations", score: 79, count: 64 },
    { domain: "People", score: 72, count: 26 },
  ];
  const catalogs = [
    { catalog: "finance_prod", coverage: 94, classification: "Restricted", risk: "Low", count: 412 },
    { catalog: "sales_prod", coverage: 91, classification: "Internal", risk: "Low", count: 781 },
    { catalog: "customer_360", coverage: 82, classification: "Confidential", risk: "Medium", count: 528 },
    { catalog: "product_events", coverage: 76, classification: "Internal", risk: "Medium", count: 246 },
    { catalog: "marketing_mart", coverage: 88, classification: "Internal", risk: "Low", count: 192 },
    { catalog: "hr_secure", coverage: 71, classification: "Restricted", risk: "High", count: 84 },
  ];
  return {
    estate: {
      visibleAssetCount: 1247,
      baselineAssetCount: 1427,
      catalogCount: 6,
      openRequests: 184,
      coverageScore: 87.4,
      cdeCount: 42,
    },
    kpis: [
      {
        key: "governedAssets",
        label: "Governed Assets",
        value: 1247,
        format: "number",
        deltaText: "+82 this quarter",
        sparkline: [960, 985, 1008, 1044, 1090, 1128, 1164, 1196, 1214, 1228, 1238, 1247],
      },
      {
        key: "certifiedCriticalAssets",
        label: "Certified Critical Assets",
        value: 612,
        format: "number",
        deltaText: "+37 this week",
        sparkline: [410, 420, 440, 460, 488, 510, 530, 548, 560, 575, 590, 612],
      },
      {
        key: "metadataCoverage",
        label: "Metadata Coverage",
        value: 87.4,
        format: "percent",
        deltaText: "+2.1 pts vs last week",
        sparkline: [62, 65, 68, 70, 72, 74, 77, 80, 82, 84, 85, 87.4],
      },
      {
        key: "openStewardship",
        label: "Open Stewardship Actions",
        value: 184,
        format: "number",
        deltaText: "-11 this week",
        sparkline: [240, 232, 228, 222, 218, 212, 205, 200, 196, 192, 190, 184],
      },
      {
        key: "policyExceptions",
        label: "Policy Exceptions",
        value: 7,
        format: "number",
        deltaText: "+2 new this week",
        sparkline: [5, 5, 5, 5, 5, 5, 6, 6, 6, 7, 7, 7],
      },
      {
        key: "auditReadiness",
        label: "Audit Readiness",
        value: null,
        format: "percent",
        state: "unavailable",
        reason: "Readiness requires backed audit-control policy coverage.",
      },
    ],
    posture: {
      overall: 87.4,
      trend: [
        { label: "W14", overall: 78.4, policy: 80, quality: 74 },
        { label: "W15", overall: 79.1, policy: 81, quality: 75 },
        { label: "W16", overall: 81.0, policy: 82, quality: 77 },
        { label: "W17", overall: 82.3, policy: 84, quality: 79 },
        { label: "W18", overall: 83.7, policy: 85, quality: 80 },
        { label: "W19", overall: 84.2, policy: 86, quality: 81 },
        { label: "W20", overall: 85.0, policy: 87, quality: 82 },
        { label: "W21", overall: 85.4, policy: 88, quality: 82.5 },
        { label: "W22", overall: 86.0, policy: 89, quality: 83.4 },
        { label: "W23", overall: 86.4, policy: 89.5, quality: 84.2 },
        { label: "W24", overall: 86.9, policy: 90, quality: 85.1 },
        { label: "W25", overall: 87.4, policy: 91, quality: 86 },
      ],
      byDomain: domains,
      heatmap: [],
    },
    topDomains: domains,
    riskBreakdown: {
      cleanScore: 92,
      high: 7,
      medium: 28,
      informational: 64,
      totalExposures: 99,
    },
    catalogHealth: catalogs.map((catalog) => ({
      catalog: catalog.catalog,
      tables: catalog.count,
      coverage: catalog.coverage,
      classification: catalog.classification,
      risk: catalog.risk,
    })),
    criticalDataElements: [
      {
        id: "net-revenue-usd",
        name: "Net Revenue (USD)",
        column: "finance_prod.curated.revenue_daily.net_revenue_usd",
        owner: "Finance Stewards",
        status: "Healthy",
        sox: true,
      },
      {
        id: "customer-id",
        name: "Customer ID",
        column: "customer_360.gold.customer_profile.customer_id",
        owner: "Customer Stewards",
        status: "Healthy",
      },
      {
        id: "lifetime-value-usd",
        name: "Lifetime Value (USD)",
        column: "customer_360.gold.customer_profile.lifetime_value_usd",
        owner: "Customer Stewards",
        status: "Recert due (8d)",
      },
      {
        id: "compensation-band",
        name: "Compensation Band",
        column: "hr_secure.confidential.compensation.band_id",
        owner: "People Stewards",
        status: "Healthy",
      },
    ],
    changesToday: [
      {
        label: "Coverage",
        value: 87.4,
        previous: 86.8,
        previousFormat: "percent",
        delta: "+12 newly certified",
        tone: "good",
      },
      {
        label: "Quality SLA",
        value: 94.3,
        previous: 94.1,
        previousFormat: "percent",
        delta: "3 expectations passing",
        tone: "good",
      },
      {
        label: "High-risk exposures",
        value: 7,
        previous: 9,
        previousFormat: "count",
        delta: "2 mitigated by Steward team",
        tone: "bad",
      },
      {
        label: "Lineage coverage",
        value: 98.6,
        previous: 98.6,
        previousFormat: "percent",
        delta: "No regressions",
        tone: "muted",
      },
    ],
    narrative: {
      scopeLabel: "finance_prod",
      baselineAssetCount: 1427,
      target: "90% Q2 target",
      targetWeek: "week 30",
    },
    recentAssets: catalogs.flatMap((catalog) =>
      Array.from({ length: Math.max(1, Math.round(catalog.count / 120)) }, (_, index) => ({
        fqn: `${catalog.catalog}.curated.asset_${index + 1}`,
        name: `asset_${index + 1}`,
        catalog: catalog.catalog,
        schema: "curated",
        objectType: "Delta Table",
        metadataCoverage: catalog.coverage,
        classification: catalog.classification,
        risk: catalog.risk,
      }))
    ),
    recentEvents: [
      {
        id: "AE-78421",
        title: "flagged 1 asset for missing owner",
        detail: "Owner-required policy failed.",
        actor: "svc-governance-sweeper",
        createdAt: minutesAgo(12),
        tone: "bad",
        target: "experimental.sandbox.pricing_experiment_2025q4",
      },
      {
        id: "AE-78410",
        title: "certified",
        detail: "Re-certified for Q2 2026.",
        actor: "Marisol Reyes",
        createdAt: minutesAgo(32),
        tone: "good",
        target: "finance_prod.curated.revenue_daily",
      },
      {
        id: "AE-78404",
        title: "auto-tagged PII columns on",
        detail: "Classifier fixture event.",
        actor: "svc-classifier",
        createdAt: minutesAgo(54),
        tone: "info",
        target: "customer_360.silver.contact_events",
      },
      {
        id: "AE-78399",
        title: "approved access for `customer-success-leads` to",
        detail: "Access request approved.",
        actor: "Aaron Chen",
        createdAt: minutesAgo(64),
        tone: "info",
        target: "customer_360.gold.customer_profile",
      },
      {
        id: "AE-78392",
        title: "acknowledged quality alert on",
        detail: "Linked to Lakeflow run 1029384.",
        actor: "Priya Natarajan",
        createdAt: minutesAgo(121),
        tone: "warn",
        target: "sales_prod.silver.orders",
      },
    ],
    aiPrompts: [
      "What's powering the CFO Quarterly Dashboard, and is anything at risk this week?",
      "Which uncertified tables are queried by executives?",
      "Summarize PII coverage in customer_360.",
      "Who owns net_revenue_usd and when was it last certified?",
    ],
    meta: {
      generatedAt: secondsAgo(14),
      primaryCatalog: "finance_prod",
      workspace: "entrada-prod",
      workspaceLabel: "entrada-prod",
      workspaceName: "entrada-prod",
      ...prototypeMockMeta(),
    },
  };
}

function listParam(params, key) {
  const values = params.getAll(key);
  const single = params.get(key);
  if (single && !values.includes(single)) values.push(single);
  return values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function assetSearchText(asset) {
  return [
    asset?.name,
    asset?.fqn,
    asset?.fullPath,
    asset?.catalog,
    asset?.schema,
    asset?.objectType,
    asset?.description,
    asset?.domain,
    asset?.certification,
    asset?.sensitivity,
    ...(Array.isArray(asset?.tagLabels) ? asset.tagLabels : []),
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
    ...(Array.isArray(asset?.glossaryTerms) ? asset.glossaryTerms.map((term) => term?.label || term?.name || term) : []),
    ...(Array.isArray(asset?.owners) ? asset.owners.map((owner) => owner?.name || owner?.email || owner) : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function valuesMatch(assetValue, targets) {
  if (!targets.length) return true;
  const value = String(assetValue || "").toLowerCase();
  return targets.some((target) => value === String(target || "").toLowerCase());
}

function tagMatches(asset, target) {
  const normalized = String(target || "").toLowerCase();
  if (normalized === "cde") return Boolean(asset?.cde || asset?.isCde || asset?.criticalDataElement);
  if (normalized === "pii") return Boolean(asset?.pii || asset?.containsPii);
  if (normalized === "no_pii") return !asset?.pii && !asset?.containsPii;
  const tags = [
    ...(Array.isArray(asset?.tagLabels) ? asset.tagLabels : []),
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
  ].map((tag) => String(tag || "").toLowerCase());
  return tags.includes(normalized);
}

function discoveryClauseMatches(asset, rawClause) {
  const clause = String(rawClause || "").trim().replace(/^\(+|\)+$/g, "");
  if (!clause) return true;
  const fieldMatch = clause.match(/^([a-z_]+)\s*:\s*"?([^"]+?)"?$/i);
  if (!fieldMatch) return assetSearchText(asset).includes(clause.toLowerCase());
  const field = fieldMatch[1].toLowerCase();
  const value = fieldMatch[2].trim();
  if (!value) return true;
  switch (field) {
    case "name":
      return String(asset?.name || "").toLowerCase().includes(value.toLowerCase());
    case "fqn":
      return String(asset?.fqn || "").toLowerCase().includes(value.toLowerCase());
    case "description":
      return String(asset?.description || "").toLowerCase().includes(value.toLowerCase());
    case "catalog":
      return valuesMatch(asset?.catalog, [value]);
    case "schema":
      return valuesMatch(asset?.schema, [value]);
    case "domain":
      return valuesMatch(asset?.domain, [value]);
    case "certification":
      return valuesMatch(asset?.certification, [value]);
    case "sensitivity":
    case "classification":
      return valuesMatch(asset?.sensitivity, [value]);
    case "type":
      return valuesMatch(asset?.objectType, [value]);
    case "owner":
      return (asset?.owners || []).some((owner) => String(owner?.name || owner?.email || owner || "").toLowerCase().includes(value.toLowerCase()));
    case "glossary":
      return (asset?.glossaryTerms || []).some((term) => String(term?.label || term?.name || term || "").toLowerCase().includes(value.toLowerCase()));
    case "tag":
      return tagMatches(asset, value);
    default:
      return assetSearchText(asset).includes(value.toLowerCase());
  }
}

function queryLooksInvalid(query) {
  const text = String(query || "");
  if (!text.trim()) return false;
  const open = (text.match(/\(/g) || []).length;
  const close = (text.match(/\)/g) || []).length;
  if (open !== close) return true;
  return /:\s*$/.test(text) || /(?:AND|OR)\s*$/i.test(text);
}

function discoveryQueryMatches(asset, query) {
  const normalized = String(query || "").trim();
  if (!normalized) return true;
  const clauses = normalized
    .split(/\s+(?:AND|OR)\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.every((clause) => discoveryClauseMatches(asset, clause));
}

function facetEntries(assets, key, getter) {
  const counts = new Map(PROTOTYPE_DISCOVERY_FACETS[key]?.map((entry) => [entry.value, 0]) || []);
  assets.forEach((asset) => {
    const value = getter(asset);
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .filter((entry) => entry.count > 0 || (PROTOTYPE_DISCOVERY_FACETS[key] || []).some((seed) => seed.value === entry.value));
}

function syntheticDiscoveryFacets(assets) {
  return {
    certifications: facetEntries(assets, "certifications", (asset) => asset.certification),
    domains: facetEntries(assets, "domains", (asset) => asset.domain),
    sensitivities: facetEntries(assets, "sensitivities", (asset) => asset.sensitivity),
    assetTypes: facetEntries(assets, "assetTypes", (asset) => asset.objectType),
    catalogs: facetEntries(assets, "catalogs", (asset) => asset.catalog),
  };
}

function sortDiscoveryAssets(assets, sortBy) {
  const sort = String(sortBy || "").toLowerCase();
  const next = [...assets];
  if (/name/.test(sort)) {
    next.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  } else if (/coverage|trust/.test(sort)) {
    return next;
  } else if (/request|issue|open/.test(sort)) {
    next.sort((a, b) => String(a.certification || "").localeCompare(String(b.certification || "")));
  }
  return next;
}

function syntheticDiscoveryPayload(bootstrap, requestUrl = "") {
  const url = requestUrl ? new URL(requestUrl) : null;
  const params = url?.searchParams || new URLSearchParams();
  const query = String(params.get("query") || "").trim();
  if (queryLooksInvalid(query)) {
    return {
      status: 400,
      payload: {
        invalidQuery: {
          state: "invalid",
          message: "Invalid discovery query.",
          syntaxHint: "Use field:value clauses with balanced parentheses and supported fields.",
          supportedFields: ["name", "fqn", "domain", "certification", "sensitivity", "tag", "owner", "type"],
        },
      },
    };
  }
  const assets = Array.isArray(bootstrap?.discovery?.defaultResults)
    ? bootstrap.discovery.defaultResults
    : [];
  const catalogs = listParam(params, "catalogs");
  const domains = listParam(params, "domains");
  const certifications = listParam(params, "certifications");
  const sensitivities = listParam(params, "sensitivities");
  const types = listParam(params, "types");
  const views = listParam(params, "views");
  const sortedAssets = sortDiscoveryAssets(
    assets.filter((asset) => {
      if (!discoveryQueryMatches(asset, query)) return false;
      if (!valuesMatch(asset.catalog, catalogs)) return false;
      if (!valuesMatch(asset.domain, domains)) return false;
      if (!valuesMatch(asset.certification, certifications)) return false;
      if (!valuesMatch(asset.sensitivity, sensitivities)) return false;
      if (!valuesMatch(asset.objectType, types)) return false;
      if (views.some((view) => /certified/i.test(view)) && !/certified/i.test(String(asset.certification || ""))) return false;
      if (views.some((view) => /owner/i.test(view)) && Array.isArray(asset.owners) && asset.owners.length) return false;
      if (views.some((view) => /coverage/i.test(view)) && Number(asset.coverageScore || 0) < 80) return false;
      return true;
    }),
    params.get("sortBy") || "",
  );
  const limit = Math.max(1, Number(params.get("limit") || sortedAssets.length || 80));
  const offset = Math.max(0, Number(params.get("offset") || 0));
  const pageAssets = sortedAssets.slice(offset, offset + limit);
  return {
    status: 200,
    payload: {
      authoritative: false,
      settled: true,
      loading: false,
      error: "",
      assets: pageAssets,
      count: sortedAssets.length,
      facets: syntheticDiscoveryFacets(sortedAssets),
      queryState: {
        state: query ? "filtered" : "",
        message: query ? `Filtered by ${query}` : "",
        syntaxHint: "Use field:value clauses with AND/OR, quoted phrases, and parentheses.",
        supportedFields: [
          "name",
          "fqn",
          "description",
          "catalog",
          "schema",
          "domain",
          "certification",
          "sensitivity",
          "criticality",
          "glossary",
          "tag",
          "owner",
          "type",
          "data_product",
        ],
        clauseChips: query ? [{ key: "query", label: query }] : [],
      },
      meta: {
        visibleAssetCount: sortedAssets.length,
        observedAt: "2026-04-27T09:14:22Z",
        ...prototypeMockMeta(),
      },
    },
  };
}

function syntheticStewardshipItems() {
  return [
    {
      sortOrder: 0,
      requestId: "SI-2491",
      title: "Owner missing",
      rawTitle: "Owner missing",
      kind: "Owner missing",
      type: "owner",
      status: "Pending",
      priority: "P1 critical",
      requester: "svc-governance-sweeper",
      createdAt: "2026-04-17T12:00:00Z",
      dueAt: "2026-04-24T12:00:00Z",
      assetFqn: "experimental.sandbox.pricing_experiment_2025q4",
      assetName: "pricing_experiment_2025q4",
      domain: "Revenue & Sales",
      assigned: "Revenue Stewards",
      sla: "4d overdue",
      slaState: "crit",
      age: "11d",
      detail: "Prototype fixture: owner missing; sample query signal shown for layout only. No live query/user evidence was checked.",
      evidence: "Prototype fixture: owner missing; sample query signal shown for layout only. No live query/user evidence was checked.",
      source: "Prototype fixture query signal",
      implementation:
        "Prototype fixture: no live query history checked. Live mode writes backed governance_state stewardship items only when a supported workflow source is configured.",
      suggestedActions: [
        {
          icon: "user-plus",
          label: "Assign owner from suggested teams",
          detail: "Prototype suggestion: Sales Engineering fixture match; not live query/tag proof.",
        },
        {
          icon: "archive",
          label: "Archive sandbox cleanup",
          detail: "Prototype cleanup hint; not live retention or usage proof.",
        },
      ],
    },
    {
      sortOrder: 1,
      requestId: "SI-2487",
      title: "Description missing",
      rawTitle: "Description missing",
      kind: "Description missing",
      type: "description",
      status: "Pending",
      priority: "P2",
      requester: "svc-metadata-sweeper",
      createdAt: "2026-04-23T12:00:00Z",
      dueAt: "2026-04-30T12:00:00Z",
      assetFqn: "product_events.bronze.clickstream_events",
      assetName: "clickstream_events",
      domain: "Customer",
      assigned: "Customer Stewards",
      sla: "2d left",
      slaState: "warn",
      age: "5d",
      detail: "No steward-approved description is recorded for this customer-facing event table.",
      evidence: "No steward-approved description is recorded for this customer-facing event table.",
      suggestedActions: [
        {
          icon: "sparkles",
          label: "Draft description with Atlas AI",
          detail: "Grounded by upstream lineage and column metadata.",
        },
      ],
    },
    {
      sortOrder: 2,
      requestId: "SI-2482",
      title: "Re-certification due",
      rawTitle: "Re-certification due",
      kind: "Re-certification due",
      type: "certification",
      status: "Pending",
      priority: "P2",
      requester: "svc-certification",
      createdAt: "2026-04-26T12:00:00Z",
      dueAt: "2026-04-28T18:00:00Z",
      assetFqn: "finance_prod.curated.revenue_daily",
      assetName: "revenue_daily",
      domain: "Finance",
      assigned: "Marisol Reyes",
      assignedToMe: true,
      sla: "Today",
      slaState: "warn",
      age: "89d",
      detail: "Quarterly recertification is due for a finance board-reporting source table.",
      evidence: "Certification expires today; executive dashboard queries observed this week.",
    },
    {
      sortOrder: 3,
      requestId: "SI-2479",
      title: "Tag policy violation",
      rawTitle: "Tag policy violation",
      kind: "Tag policy violation",
      type: "policy",
      status: "Pending",
      priority: "P1",
      requester: "svc-classifier",
      createdAt: "2026-04-20T12:00:00Z",
      dueAt: "2026-04-27T12:00:00Z",
      assetFqn: "customer_360.silver.contact_events",
      assetName: "contact_events",
      domain: "Customer",
      assigned: "Customer Stewards",
      sla: "1d overdue",
      slaState: "crit",
      age: "8d",
      detail: "Classifier found PII columns without the required governed tag.",
      evidence: "Auto-tag confidence exceeded 0.92 for 6 columns.",
    },
    {
      sortOrder: 4,
      requestId: "SI-2475",
      title: "Lineage gap",
      rawTitle: "Lineage gap",
      kind: "Lineage gap",
      type: "lineage",
      status: "Pending",
      priority: "P3",
      requester: "svc-lineage-collector",
      createdAt: "2026-04-26T12:00:00Z",
      dueAt: "2026-05-04T12:00:00Z",
      assetFqn: "marketing_mart.gold.attribution_daily",
      assetName: "attribution_daily",
      domain: "Marketing",
      assigned: "Marketing Stewards",
      sla: "6d left",
      slaState: "good",
      age: "2d",
      detail: "Column-level lineage is missing for one downstream dashboard edge.",
      evidence: "Table lineage is present; column lineage coverage is incomplete.",
    },
    {
      sortOrder: 5,
      requestId: "SI-2471",
      title: "Quality regression",
      rawTitle: "Quality regression",
      kind: "Quality regression",
      type: "quality",
      status: "Pending",
      priority: "P1",
      requester: "svc-quality",
      createdAt: "2026-04-27T12:00:00Z",
      dueAt: "2026-04-28T20:00:00Z",
      assetFqn: "sales_prod.silver.orders",
      assetName: "orders",
      domain: "Revenue & Sales",
      assigned: "Priya Natarajan",
      sla: "12h left",
      slaState: "warn",
      age: "1d",
      detail: "Freshness and currency-code checks failed after the last pipeline run.",
      evidence: "Lakeflow run 1029384 reported check currency_code_not_null failed.",
    },
    {
      sortOrder: 6,
      requestId: "SI-2469",
      title: "Access exception",
      rawTitle: "Access exception",
      kind: "Access exception",
      type: "access",
      status: "Pending",
      priority: "P2",
      requester: "svc-access-review",
      createdAt: "2026-04-27T08:00:00Z",
      dueAt: "2026-05-01T12:00:00Z",
      assetFqn: "hr_secure.confidential.compensation_band",
      assetName: "compensation_band",
      domain: "People",
      assigned: "People Stewards",
      sla: "3d left",
      slaState: "good",
      age: "16h",
      detail: "Restricted table has an access exception pending quarterly review.",
      evidence: "Quarterly access review identified one grant requiring business justification.",
    },
    {
      sortOrder: 7,
      requestId: "SI-2462",
      title: "Glossary mapping",
      rawTitle: "Glossary mapping",
      kind: "Glossary mapping",
      type: "glossary",
      status: "Pending",
      priority: "P3",
      requester: "marisol.reyes@entrada.ai",
      createdAt: "2026-04-24T12:00:00Z",
      dueAt: "2026-05-06T12:00:00Z",
      assetFqn: "customer_360.gold.customer_profile",
      assetName: "customer_profile",
      domain: "Customer",
      assigned: "Customer Stewards",
      sla: "8d left",
      slaState: "good",
      age: "4d",
      detail: "A steward filed a request to link lifecycle_stage to the Active Customer term.",
      evidence: "Manual steward request submitted from the glossary association drawer.",
    },
  ];
}

function syntheticStewardshipWorkbench() {
  const requests = syntheticStewardshipItems();
  return {
    summary: {
      openWorkItems: 184,
      slaBreaches: 7,
    },
    requests,
    selectedRequest: requests[0],
    meta: {
      observedAt: "2026-04-27T09:14:22Z",
      ...prototypeMockMeta(),
    },
  };
}

function syntheticStewardshipWorkbenchDegraded() {
  return {
    summary: {
      openWorkItems: 0,
      slaBreaches: null,
    },
    requests: [],
    selectedRequest: null,
    meta: {
      observedAt: "2026-04-27T09:14:22Z",
      ...prototypeMockMeta({
        state: "degraded",
        warnings: ["Prototype degraded stewardship state for visual QA only."],
      }),
    },
  };
}

function syntheticTaxonomyOverview() {
  const glossaryTerms = [
    {
      termId: "net-revenue",
      term: "Net Revenue",
      definition:
        "Gross revenue minus discounts and refunds; recognized per ASC 606. Source-of-record column: `finance_prod.curated.revenue_daily.net_revenue_usd`.",
      domain: "Finance",
      steward: "Finance Stewards",
      status: "Approved",
      assetCount: 4,
      linkedAssets: [
        {
          assetFqn: "finance_prod.curated.revenue_daily",
          assetLabel: "revenue_daily",
          assetType: "Delta Table",
          platform: "Unity Catalog",
        },
      ],
    },
    {
      termId: "active-customer",
      term: "Active Customer",
      definition:
        "A customer with at least one billable order in the trailing 90 days. Computed in `customer_360.gold.customer_profile.lifecycle_stage`.",
      domain: "Customer",
      steward: "Customer Stewards",
      status: "Approved",
      assetCount: 7,
      linkedAssets: [
        {
          assetFqn: "customer_360.gold.customer_profile",
          assetLabel: "customer_profile",
          assetType: "Delta Table",
          platform: "Unity Catalog",
        },
      ],
    },
    {
      termId: "churn-propensity",
      term: "Churn Propensity",
      definition:
        "Modeled probability that a customer will churn in the next 30 days. Served via `customer_360.ml.churn_propensity_v3`.",
      domain: "Customer",
      steward: "Customer Stewards",
      status: "Approved",
      assetCount: 3,
      linkedAssets: [
        {
          assetFqn: "customer_360.ml.churn_propensity_v3",
          assetLabel: "churn_propensity_v3",
          assetType: "Model",
          platform: "Unity Catalog",
        },
      ],
    },
    {
      termId: "booking",
      term: "Booking",
      definition: "A confirmed order, regardless of recognition status.",
      domain: "Revenue & Sales",
      steward: "Revenue Stewards",
      status: "In Review",
      assetCount: 6,
      linkedAssets: [
        {
          assetFqn: "sales_prod.silver.orders",
          assetLabel: "orders",
          assetType: "Delta Table",
          platform: "Unity Catalog",
        },
      ],
    },
  ];
  const cdes = [
    {
      id: "net-revenue-usd",
      name: "Net Revenue (USD)",
      column: "finance_prod.curated.revenue_daily.net_revenue_usd",
      owner: "Finance Stewards",
      recert: "90d",
      status: "Healthy",
      sox: true,
    },
    {
      id: "customer-id",
      name: "Customer ID",
      column: "customer_360.gold.customer_profile.customer_id",
      owner: "Customer Stewards",
      recert: "180d",
      status: "Healthy",
    },
    {
      id: "lifetime-value-usd",
      name: "Lifetime Value (USD)",
      column: "customer_360.gold.customer_profile.lifetime_value_usd",
      owner: "Customer Stewards",
      recert: "90d",
      status: "Recert due (8d)",
    },
    {
      id: "compensation-band",
      name: "Compensation Band",
      column: "hr_secure.confidential.compensation_band.band_id",
      owner: "People Stewards",
      recert: "180d",
      status: "Healthy",
    },
    {
      id: "order-total-usd",
      name: "Order Total (USD)",
      column: "sales_prod.silver.orders.gross_total_usd",
      owner: "Revenue Stewards",
      recert: "90d",
      status: "Healthy",
      sox: true,
    },
  ];
  return {
    data: {
      glossaryTerms,
      cdes,
      summary: {
        termCount: glossaryTerms.length,
        cdeCount: cdes.length,
      },
    },
    meta: {
      ...prototypeMockMeta(),
    },
  };
}

function syntheticTaxonomyOverviewDegraded() {
  return {
    data: {
      glossaryTerms: [],
      cdes: [],
      summary: {
        termCount: 0,
        cdeCount: 0,
      },
    },
    meta: {
      ...prototypeMockMeta({
        state: "degraded",
        warnings: ["Prototype degraded taxonomy state for visual QA only."],
      }),
    },
  };
}

function syntheticAssetRecord(assetFqn = ASSET_FQN) {
  const fqn = assetFqn || ASSET_FQN;
  const parts = fqn.split(".");
  return {
    fqn,
    name: parts.at(-1) || fqn,
    catalog: parts[0] || "finance_prod",
    schema: parts[1] || "curated",
    objectType: /dashboard|board/i.test(fqn) ? "Dashboard" : /forecast|model/i.test(fqn) ? "Model" : "Delta Table",
    type: /dashboard|board/i.test(fqn) ? "dashboard" : /forecast|model/i.test(fqn) ? "model" : "table",
    description:
      fqn === "finance_prod.curated.revenue_daily"
        ? "Certified finance revenue table powering board reporting and CFO dashboards."
        : "Lineage-linked governed asset from local prototype evidence.",
    owner: "Marisol Reyes",
    ownerEmail: "marisol.reyes@entrada.ai",
    steward: "Finance Stewards",
    domain: "Finance",
    certification: "Certified",
    criticality: "High",
    qualityScore: 92,
    metadataCoverage: 96,
    policyTags: ["Certified", "Finance", "CDE"],
    tags: ["Certified", "CDE"],
    columns: [
      { name: "net_revenue_usd", dataType: "decimal(18,2)", qualityTone: "good", qualityLabel: "Healthy" },
      { name: "gross_revenue_usd", dataType: "decimal(18,2)", qualityTone: "good", qualityLabel: "Healthy" },
      { name: "discount_usd", dataType: "decimal(18,2)", qualityTone: "good", qualityLabel: "Healthy" },
      { name: "revenue_date", dataType: "date", qualityTone: "good", qualityLabel: "Healthy" },
    ],
  };
}

function syntheticLineagePayload(assetFqn = ASSET_FQN) {
  const focus = assetFqn || ASSET_FQN;
  const nodes = [
    { id: "dlt-payments-ingest", assetFqn: "finance_prod.dlt_payments_ingest", label: "finance_prod · dlt_payments_ingest", subtitle: "SOURCE - Payments", kind: "Source", stage: "source", hop: 1, columns: ["charge_id", "order_id", "amount"] },
    { id: "auto-loader-invoices", assetFqn: "finance_prod.auto_loader_invoices", label: "finance_prod · auto_loader_invoices", subtitle: "SOURCE - Finance", kind: "Source", stage: "source", hop: 1, columns: ["invoice_id", "order_id", "net_amount"] },
    { id: "bronze-orders", assetFqn: "finance_prod.bronze.orders_raw", label: "orders_raw", subtitle: "finance_prod · bronze", kind: "Delta Table", stage: "upstream", hop: 2, rowCount: 4800000, freshness: "14m", columns: [{ name: "order_id", key: "A", dataType: "STRING" }, { name: "customer_id", key: "A", dataType: "STRING" }, { name: "subtotal", key: "#", dataType: "DECIMAL" }] },
    { id: "bronze-charges", assetFqn: "finance_prod.bronze.charges_raw", label: "charges_raw", subtitle: "finance_prod · bronze", kind: "Delta Table", stage: "upstream", hop: 2, rowCount: 12400000, freshness: "8m", columns: [{ name: "charge_id", key: "A", dataType: "STRING" }, { name: "customer_id", key: "A", dataType: "STRING" }, { name: "amount", key: "#", dataType: "INT" }, { name: "currency", key: "A", dataType: "STRING" }, { name: "refund_amount", key: "#", dataType: "INT" }, { name: "status", key: "A", dataType: "STRING" }, { name: "processor", key: "A", dataType: "STRING" }, { name: "created_at", key: "A", dataType: "TIMESTAMP" }] },
    { id: "bronze-invoices", assetFqn: "finance_prod.bronze.invoices_raw", label: "invoices_raw", subtitle: "finance_prod · bronze", kind: "Delta Table", stage: "upstream", hop: 2, rowCount: 1100000, freshness: "41m", columns: [{ name: "invoice_id", key: "A", dataType: "STRING" }, { name: "customer_id", key: "A", dataType: "STRING" }, { name: "adjustment", key: "#", dataType: "DECIMAL" }, { name: "billing_period", key: "A", dataType: "STRING" }, { name: "created_at", key: "A", dataType: "TIMESTAMP" }] },
    { id: "silver-orders", assetFqn: "finance_prod.silver.orders", label: "orders", subtitle: "sales_prod · silver", kind: "Delta Table", stage: "downstream", hop: 2, rowCount: 4800000, freshness: "14m", columns: [{ name: "order_id", key: "A", dataType: "STRING" }, { name: "customer_id", key: "A", dataType: "STRING" }, { name: "order_value_usd", key: "#", dataType: "DECIMAL" }, { name: "discount_amount", key: "#", dataType: "DECIMAL" }, { name: "segment_id", key: "A", dataType: "STRING" }, { name: "channel", key: "A", dataType: "STRING" }] },
    { id: "silver-payments", assetFqn: "finance_prod.silver.payments", label: "payments", subtitle: "finance_prod · silver", kind: "Delta Table", stage: "downstream", hop: 1, rowCount: 13500000, freshness: "11m", columns: [{ name: "payment_id", key: "A", dataType: "STRING" }, { name: "customer_id", key: "A", dataType: "STRING" }, { name: "gross_amount", key: "#", dataType: "DECIMAL" }, { name: "refund_amount", key: "#", dataType: "DECIMAL" }, { name: "adjustment", key: "#", dataType: "DECIMAL" }, { name: "segment_id", key: "A", dataType: "STRING" }, { name: "processor", key: "A", dataType: "STRING" }, { name: "created_at", key: "A", dataType: "TIMESTAMP" }] },
    { id: "recognition-job", assetFqn: "finance_prod.ipynb.payments_clean", label: "ipynb", subtitle: "finance_prod · notebook", kind: "Notebook", stage: "transform", hop: 3 },
    {
      id: "focus-revenue",
      assetFqn: focus,
      label: "revenue_daily",
      subtitle: "finance_prod · curated",
      kind: "Delta Table",
      role: "focus",
      stage: "focus",
      rowCount: 1240000,
      freshness: "14m",
      columns: [
        { name: "net_revenue_usd", dataType: "decimal(18,2)", qualityTone: "good", qualityLabel: "Healthy" },
        { name: "gross_revenue_usd", dataType: "decimal(18,2)", qualityTone: "good", qualityLabel: "Healthy" },
        { name: "discount_usd", dataType: "decimal(18,2)", qualityTone: "good", qualityLabel: "Healthy" },
      ],
      policyTags: ["Certified", "CDE"],
      description: "Board-reporting revenue table certified by Finance Stewards.",
    },
    { id: "cfo-dashboard", assetFqn: "dashboards.finance.cfo_quarterly", label: "CFO Quarterly Dashboard", subtitle: "DASHBOARD - Finance", kind: "Dashboard", stage: "impact", hop: 4 },
    { id: "board-pack", assetFqn: "dashboards.finance.board_pack_revenue", label: "Board Pack - Revenue", subtitle: "DASHBOARD - Finance", kind: "Dashboard", stage: "impact", hop: 5 },
    { id: "forecast-model", assetFqn: "finance_prod.ml.revenue_forecast", label: "finance_prod.ml.revenue_forecast", subtitle: "MODEL - Finance", kind: "Model", stage: "impact", hop: 6 },
    { id: "restricted-hidden", assetFqn: "restricted.downstream.assets", label: "4 downstream assets", subtitle: "PROTOTYPE PERMISSION BOUNDARY", kind: "Restricted", stage: "downstream", hop: 3 },
  ];
  const edges = [
    { id: "payments-source-charges", source: "dlt-payments-ingest", target: "bronze-charges" },
    { id: "invoice-source-invoices", source: "auto-loader-invoices", target: "bronze-invoices" },
    { id: "orders-silver", source: "bronze-orders", target: "silver-orders" },
    { id: "charges-payments", source: "bronze-charges", target: "silver-payments" },
    { id: "invoices-payments", source: "bronze-invoices", target: "silver-payments" },
    { id: "silver-orders-job", source: "silver-orders", target: "recognition-job" },
    { id: "silver-payments-job", source: "silver-payments", target: "recognition-job" },
    { id: "job-focus", source: "recognition-job", target: "focus-revenue" },
    { id: "focus-cfo", source: "focus-revenue", target: "cfo-dashboard" },
    { id: "focus-board", source: "focus-revenue", target: "board-pack" },
    { id: "focus-model", source: "focus-revenue", target: "forecast-model" },
    { id: "focus-restricted", source: "focus-revenue", target: "restricted-hidden" },
  ];
  return {
    fqn: focus,
    authoritative: false,
    provisional: true,
    graphs: {
      data: { nodes, edges },
      operational: { nodes: [], edges: [] },
    },
    stats: {
      upstreamCount: 5,
      downstreamCount: 23,
      confidenceScore: 98,
      qualityScore: 92,
      brokenLinks: 0,
      cdeCount: 5,
      hiddenDownstreamCount: 4,
      owner: "Marisol Reyes",
      freshness: "14 min ago - within 15 min SLA",
      revenueImpact: "$142k/day revenue impact",
      generatedAt: "2026-04-27T09:14:22Z",
      limits: { tableLineage: 38 },
      truncated: { downstream: true },
    },
    columnLineage: {
      upstream: [
        { column: "net_revenue_usd", sourceColumn: "gross_revenue_usd", sourceAsset: "finance_prod.silver.orders", targetColumn: "net_revenue_usd" },
        { column: "net_revenue_usd", sourceColumn: "refund_usd", sourceAsset: "finance_prod.silver.payments", targetColumn: "net_revenue_usd" },
      ],
      downstream: [
        { column: "net_revenue_usd", sourceColumn: "net_revenue_usd", targetAsset: "dashboards.finance.cfo_quarterly", targetColumn: "net_revenue_usd" },
        { column: "net_revenue_usd", sourceColumn: "net_revenue_usd", targetAsset: "finance_prod.ml.revenue_forecast", targetColumn: "target" },
      ],
      meta: { source: "system.access.column_lineage", truncated: false },
    },
    impactAnalysis: [
      { id: "cfo-dashboard", title: "CFO Quarterly Dashboard", detail: "Finance Stewards - used in last 24h - 142 views", tone: "High impact" },
      { id: "board-pack", title: "Board Pack - Revenue", detail: "Marisol Reyes - quarterly distribution to board", tone: "High impact" },
      { id: "forecast-model", title: "finance_prod.ml.revenue_forecast", detail: "Finance Data Platform - trains nightly", tone: "Medium" },
      { id: "snapshot", title: "finance_prod.gold.arr_snapshot", detail: "Finance Stewards - prototype downstream shape - no live usage, workflow, or backed lineage proof", tone: "Medium" },
    ],
    events: [
      { id: "lineage-payments-clean", title: "Notebook payments_clean succeeded · 13.5M rows", detail: "svc-job-runner · 11m ago" },
      { id: "lineage-adjustment", title: "Schema evolution: +adjustment", detail: "priya.natarajan · 6d ago" },
      { id: "lineage-column-refresh", title: "Column lineage refreshed", detail: "4 net_revenue_usd column mappings observed." },
    ],
    meta: prototypeMockMeta({ generatedAt: "2026-04-27T09:14:22Z" }),
  };
}

function syntheticAuditEvidence() {
  const events = [
    {
      audit_id: "AE-78421",
      created_at: "2026-04-27T09:14:22Z",
      actor_email: "marisol.reyes@entrada.ai",
      actor_role: "Finance Steward",
      action: "Certification",
      status: "success",
      entity_fqn: "finance_prod.curated.revenue_daily",
      entity_type: "table",
      source: "owner, description, lineage coverage, freshness SLA",
      detail: "Re-certified for Q2 2026.",
      request_id: "SI-2482",
      domain: "Finance",
    },
    {
      audit_id: "AE-78410",
      created_at: "2026-04-27T08:52:09Z",
      actor_email: "svc-governance-sweeper",
      actor_role: "Service",
      action: "Tag applied",
      status: "success",
      entity_fqn: "customer_360.silver.contact_events",
      entity_type: "table",
      source: "Job run ID 9821044 · Classifier confidence >= 0.92",
      detail: "Auto-tagged 6 columns as pii.",
      request_id: "SI-2479",
      domain: "Customer",
    },
    {
      audit_id: "AE-78404",
      created_at: "2026-04-27T08:31:44Z",
      actor_email: "aaron.chen@entrada.ai",
      actor_role: "Data Owner",
      action: "Grant",
      status: "success",
      entity_fqn: "customer_360.gold.customer_profile",
      entity_type: "table",
      source: "Approved via stewardship workflow SI-2440",
      detail: "Granted SELECT to customer-success-leads group.",
      request_id: "SI-2440",
      domain: "Customer",
    },
    {
      audit_id: "AE-78395",
      created_at: "2026-04-27T07:58:01Z",
      actor_email: "svc-policy-engine",
      actor_role: "Service",
      action: "Policy violation",
      status: "failed",
      entity_fqn: "experimental.sandbox.pricing_experiment_2025q4",
      entity_type: "table",
      source: "No principal in owner grant set. Quarantined from search index.",
      detail: "Owner-required policy failed.",
      request_id: "SI-2491",
      domain: "Revenue & Sales",
    },
    {
      audit_id: "AE-78388",
      created_at: "2026-04-27T07:14:55Z",
      actor_email: "priya.natarajan@entrada.ai",
      actor_role: "Data Owner",
      action: "Quality alert",
      status: "pending",
      entity_fqn: "sales_prod.silver.orders",
      entity_type: "table",
      source: "Linked to Lakeflow run 1029384 · DQ check currency_code_not_null",
      detail: "Acknowledged quality regression on currency_code.",
      request_id: "SI-2471",
      domain: "Revenue & Sales",
    },
    {
      audit_id: "AE-78377",
      created_at: "2026-04-27T06:42:31Z",
      actor_email: "svc-lineage-collector",
      actor_role: "Service",
      action: "Lineage updated",
      status: "success",
      entity_fqn: "finance_prod.gold.revenue_recognition",
      entity_type: "job",
      source: "system.access.column_lineage · 38 new edges",
      detail: "Captured new column-level lineage for is_recognized.",
      request_id: "",
      domain: "Finance",
    },
    {
      audit_id: "AE-78358",
      created_at: "2026-04-27T05:18:12Z",
      actor_email: "devon.park@entrada.ai",
      actor_role: "Customer Steward",
      action: "Description",
      status: "success",
      entity_fqn: "product_events.bronze.clickstream_events",
      entity_type: "table",
      source: "Diff: +148 / -24 chars. Reviewer: Customer Stewards.",
      detail: "Edited table description.",
      request_id: "SI-2487",
      domain: "Customer",
    },
    {
      audit_id: "AE-78290",
      created_at: "2026-04-26T22:04:00Z",
      actor_email: "compliance-bot",
      actor_role: "Service",
      action: "Access review",
      status: "success",
      entity_fqn: "hr_secure.confidential.compensation_band",
      entity_type: "table",
      source: "12 grants reviewed · 2 revoked · 0 escalations",
      detail: "Quarterly access review completed.",
      request_id: "SI-2469",
      domain: "People",
    },
  ];
  return {
    data: {
      summary: {
        events24h: 2184,
        totalChanges: 2184,
        eventsDeltaText: "+312 vs prev",
        policyViolations: 6,
        policyViolationsDeltaText: "-2 vs prev",
        accessReviewsOpen: 3,
        accessReviewsDeltaText: "0 vs prev",
        retentionYears: 7,
        retentionNote: "Delta · time-travel enabled",
      },
      events,
      selectedEvent: events[0],
      evidence: {
        linkedRequest: "SI-2482",
        approvalChain: [],
        artifacts: [],
      },
    },
    meta: {
      ...prototypeMockMeta({ generatedAt: "2026-04-27T09:14:22Z" }),
    },
  };
}

function syntheticAuditEvidenceDegraded() {
  return {
    data: {
      summary: {
        events24h: null,
        totalChanges: null,
        eventsSupport: "No scoped event summary reported by audit API",
        policyViolations: null,
        policyViolationsSupport: "Policy summary unavailable unless reported by audit API",
        accessReviewsOpen: null,
        accessReviewsSupport: "Access review summary unavailable unless reported by audit API",
        retentionYears: null,
        retentionNote: "Retention policy not reported",
        evidenceNote: "Audit evidence source unavailable · retention policy not reported · exports remain disabled until rows are available.",
      },
      events: [],
      selectedEvent: null,
      evidence: {
        linkedRequest: "",
        approvalChain: [],
        artifacts: [],
      },
    },
    meta: {
      ...prototypeMockMeta({
        generatedAt: "2026-04-27T09:14:22Z",
        warnings: ["Synthetic degraded audit evidence state for visual QA only."],
      }),
      degraded: true,
    },
  };
}

function syntheticAdminControlCenter() {
  return {
    data: {
      environment: { displayLabel: "Dev · datapact.atlas" },
      scheduledJobs: [
        {
          id: "job-uc-sweeper",
          name: "UC metadata sweeper",
          schedule: "Every 15 min",
          lastRun: "4 min ago",
          status: "healthy",
          runUrl: "https://example.cloud.databricks.com/jobs/123/runs/456",
        },
        { id: "job-lineage", name: "Lineage collector", schedule: "Every 1 hr", lastRun: "21 min ago", status: "healthy" },
        { id: "job-quality", name: "Quality + freshness check", schedule: "Every 1 hr", lastRun: "32 min ago", status: "healthy" },
        { id: "job-policy", name: "Policy engine evaluator", schedule: "Hourly + on-write", lastRun: "7 min ago", status: "healthy" },
        { id: "job-classifier", name: "PII classifier (model serving)", schedule: "Daily 02:00 UTC", lastRun: "8 hr ago", status: "healthy" },
        { id: "job-trust", name: "Trust score recompute", schedule: "Daily 03:00 UTC", lastRun: "7 hr ago", status: "slow" },
      ],
      integrations: [
        { key: "uc", label: "Unity Catalog", subtitle: "Prototype mock - UC not verified", state: "warning" },
        { key: "warehouse", label: "Databricks SQL Warehouse", subtitle: "gov atlas wh M", state: "ok" },
        { key: "jobs", label: "Lakeflow Jobs", subtitle: "6 jobs scheduled", state: "ok" },
        { key: "model", label: "Model Serving · classifier-v2", subtitle: "Endpoint healthy", state: "ok" },
        { key: "slack", label: "Slack · #governance-alerts", subtitle: "Connected", state: "ok" },
        { key: "pagerduty", label: "PagerDuty · P1 stewardship", subtitle: "Connected", state: "ok" },
      ],
      policyCoverage: {
        rules: [
          { key: "owner", label: "Owner required on production", value: 96, state: "healthy" },
          { key: "cde-desc", label: "CDEs must have description", value: 100, state: "healthy" },
          { key: "pii-tag", label: "PII columns require tag", value: 92, state: "healthy" },
          { key: "recert", label: "90-day re-certification", value: 87, state: "healthy" },
          { key: "grant", label: "Restricted catalogs require justified grant", value: 100, state: "healthy" },
        ],
      },
    },
    meta: {
      ...prototypeMockMeta(),
    },
  };
}

function syntheticAsset360Payload(assetFqn, bootstrap) {
  const asset = assetFromBootstrap(bootstrap, assetFqn);
  const resolvedFqn = asset?.fqn || assetFqn || ASSET_FQN;
  return {
    asset: {
      ...asset,
      fqn: resolvedFqn,
      name: asset?.name || resolvedFqn.split(".").pop() || "revenue_daily",
      catalog: asset?.catalog || resolvedFqn.split(".")[0] || "finance_prod",
      schema: asset?.schema || resolvedFqn.split(".")[1] || "curated",
      objectType: asset?.objectType || asset?.type || "Delta table",
      description: asset?.description || "Certified finance revenue table powering board reporting and CFO dashboards.",
      domain: asset?.domain || "Finance",
      certification: asset?.certification || "Certified",
      criticality: asset?.criticality || "High",
      sensitivity: asset?.sensitivity || "Internal",
      dataProduct: asset?.dataProduct || "Revenue",
      rows: asset?.rows || 18420000,
      size: asset?.size || "42.8 GB",
      columns: asset?.columns || [
        { name: "booking_id", type: "string", description: "Source booking identifier." },
        { name: "net_revenue_usd", type: "decimal(18,2)", description: "Recognized net revenue in USD.", tags: { cde: "true" } },
        { name: "customer_id", type: "string", description: "Customer profile key." },
        { name: "recognized_at", type: "timestamp", description: "Revenue recognition timestamp." },
      ],
    },
    owners: [{ name: "Marisol Reyes", email: "marisol.reyes@entrada.ai", title: "Finance Steward" }],
    stewards: [{ name: "Finance Stewards", email: "finance-stewards@entrada.ai", title: "Steward team" }],
    badges: ["Certified", "5 CDEs", "Lineage verified"],
    freshness: { state: "healthy", label: "Fresh", observedAt: "2026-04-27T09:14:22Z", message: "14 min ago · within 15 min SLA" },
    usage: { rows: 18420000, rowDeltaLabel: "+1.2M last 30d", downstreamAssets: 4, users: 38, queries: 1742 },
    schema: [
      { name: "booking_id", type: "string", description: "Source booking identifier." },
      { name: "net_revenue_usd", type: "decimal(18,2)", description: "Recognized net revenue in USD.", cde: true },
      { name: "customer_id", type: "string", description: "Customer profile key." },
      { name: "recognized_at", type: "timestamp", description: "Revenue recognition timestamp." },
    ],
    governance: {
      glossaryTerms: ["Net Revenue", "Booking", "Active Customer"],
      policies: [
        { id: "policy-owner", title: "Owner required", status: "Healthy" },
        { id: "policy-cde", title: "CDE description", status: "Healthy" },
      ],
      ownerAssignments: [],
      openActivity: [],
    },
    quality: { state: "healthy", runs: [{ id: "dq-1029384", status: "passed", label: "currency_code_not_null" }], message: "4 checks passed." },
    access: { state: PROTOTYPE_MOCK_STATE, message: PROTOTYPE_MOCK_WARNING },
    activity: [
      { id: "act-1", title: "Certification renewed", detail: "Marisol Reyes re-certified for Q2 2026.", relativeTime: "14 min ago" },
      { id: "act-2", title: "Lineage refreshed", detail: "Column lineage captured from system.access.column_lineage.", relativeTime: "38 min ago" },
    ],
    relatedAssets: [
      { fqn: "finance_prod.gold.arr_snapshot", name: "arr_snapshot", relationship: "Same product" },
      { fqn: "sales_prod.silver.orders", name: "orders", relationship: "Upstream source" },
    ],
    downstreamDashboards: [
      { id: "cfo-quarterly", title: "CFO Quarterly Dashboard", owner: "Finance Stewards" },
      { id: "board-pack", title: "Board Pack - Revenue", owner: "Marisol Reyes" },
    ],
    loadedSections: ["header", "activity", "schema", "properties", "profiler", "operational"],
    meta: prototypeMockMeta({ state: PROTOTYPE_MOCK_STATE }),
  };
}

function assetFromBootstrap(bootstrap, assetFqn) {
  const assets = Array.isArray(bootstrap?.discovery?.defaultResults)
    ? bootstrap.discovery.defaultResults
    : [];
  return assets.find((asset) => asset?.fqn === assetFqn) || syntheticAssetRecord(assetFqn) || assets[0] || {};
}

async function installMockApi(context) {
  if (!MOCK_API) return;
  const bootstrap = await loadJson("northstar/genie/live-bootstrap-response.json", {
    bootState: PROTOTYPE_MOCK_STATE,
    bootMessage: PROTOTYPE_MOCK_WARNING,
    authoritative: false,
    discovery: { summary: { visibleAssets: 1247, catalogCount: 6, averageCoverage: 87.4 } },
    identity: { actorName: "Marisol Reyes", actorEmail: "marisol.reyes@entrada.ai", actorRole: "Finance Steward" },
    shell: {
      role: "Finance · Steward",
      userName: "Marisol Reyes",
      userEmail: "marisol.reyes@entrada.ai",
      workspaceLabel: "entrada-prod",
      workspaceName: "entrada-prod",
      environment: { displayLabel: "entrada-prod", target: "entrada-prod" },
      ai: { state: "available", provider: "prototype-mock", message: PROTOTYPE_MOCK_WARNING },
    },
    featureFlags: [
      { key: "table_lineage_surface", enabled: true, state: PROTOTYPE_MOCK_STATE },
      { key: "workspace_setup_diagnostics", enabled: true, state: PROTOTYPE_MOCK_STATE },
    ],
  });
  bootstrap.bootState = PROTOTYPE_MOCK_STATE;
  bootstrap.bootMessage = PROTOTYPE_MOCK_WARNING;
  bootstrap.authoritative = false;
  bootstrap.identity = {
    ...(bootstrap.identity || {}),
    actorName: "Marisol Reyes",
    actorEmail: "marisol.reyes@entrada.ai",
    actorRole: "Finance · Steward",
    actorRoleProvisional: false,
  };
  bootstrap.meta = prototypeMockMeta(bootstrap.meta);
  bootstrap.discovery = {
    ...(bootstrap.discovery || {}),
    sortOptions: ["Trust score", "Name (A-Z)", "Open requests"],
    defaultResults: PROTOTYPE_DISCOVERY_ASSETS,
    defaultCount: PROTOTYPE_DISCOVERY_ASSETS.length,
    defaultFacets: PROTOTYPE_DISCOVERY_FACETS,
    summary: {
      visibleAssets: 1247,
      catalogCount: 6,
      averageCoverage: 87.4,
      ...(bootstrap.discovery?.summary || {}),
    },
  };
  bootstrap.capabilities = {
    ...(bootstrap.capabilities || {}),
    systemInventoryRead: prototypeMockCapability({ visibilityScope: "workspace-app-principal" }),
    tableLineage: { ...prototypeMockCapability({ visibilityScope: "workspace-app-principal" }), state: PROTOTYPE_MOCK_STATE },
    columnLineage: { ...prototypeMockCapability({ visibilityScope: "workspace-app-principal" }), state: PROTOTYPE_MOCK_STATE },
    exportAllowed: prototypeMockCapability({ visibilityScope: "actor-scoped" }),
  };
  bootstrap.featureFlags = [
    ...(Array.isArray(bootstrap.featureFlags) ? bootstrap.featureFlags : []),
    { key: "table_lineage_surface", enabled: true, state: PROTOTYPE_MOCK_STATE, source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
    { key: "workspace_setup_diagnostics", enabled: true, state: PROTOTYPE_MOCK_STATE, source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
  ];
  bootstrap.shell = {
    ...(bootstrap.shell || {}),
    role: "Finance · Steward",
    userName: "Marisol Reyes",
    userEmail: "marisol.reyes@entrada.ai",
    workspaceLabel: "entrada-prod",
    workspaceName: "entrada-prod",
    environment: {
      ...(bootstrap.shell?.environment || {}),
      displayLabel: "entrada-prod",
      target: "entrada-prod",
    },
    ai: { state: PROTOTYPE_MOCK_STATE, provider: "prototype-mock", message: PROTOTYPE_MOCK_WARNING },
  };
  bootstrap.diagnostics = {
    ...(bootstrap.diagnostics || {}),
    featureFlags: bootstrap.featureFlags,
    workspaceAccess: {
      ...(bootstrap.diagnostics?.workspaceAccess || {}),
      mode: "obo-available",
      canUseLineage: true,
      observedAt: "2026-04-27T09:14:22Z",
      gates: [],
    },
  };
  const runtime = {
    runtime: { state: PROTOTYPE_MOCK_STATE, message: PROTOTYPE_MOCK_WARNING, catalogCount: 6 },
    store: { state: PROTOTYPE_MOCK_STATE, message: PROTOTYPE_MOCK_WARNING },
    capabilities: {
      systemInventoryRead: prototypeMockCapability({ visibilityScope: "workspace-app-principal" }),
      tableLineage: { ...prototypeMockCapability({ visibilityScope: "workspace-app-principal" }), state: PROTOTYPE_MOCK_STATE },
      columnLineage: { ...prototypeMockCapability({ visibilityScope: "workspace-app-principal" }), state: PROTOTYPE_MOCK_STATE },
      exportAllowed: prototypeMockCapability({ visibilityScope: "actor-scoped" }),
    },
    featureFlags: [
      { key: "table_lineage_surface", enabled: true, state: PROTOTYPE_MOCK_STATE, source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
      { key: "workspace_setup_diagnostics", enabled: true, state: PROTOTYPE_MOCK_STATE, source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
    ],
    diagnostics: {
      featureFlags: [
        { key: "table_lineage_surface", enabled: true, state: PROTOTYPE_MOCK_STATE, source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        { key: "workspace_setup_diagnostics", enabled: true, state: PROTOTYPE_MOCK_STATE, source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
      ],
      workspaceAccess: {
        mode: "obo-available",
        canUseLineage: true,
        observedAt: "2026-04-27T09:14:22Z",
        gates: [],
      },
    },
    config: { govCatalog: "datapact", govSchema: "atlas" },
    identity: {
      actorName: "Marisol Reyes",
      actorEmail: "marisol.reyes@entrada.ai",
      actorRole: "Finance · Steward",
      actorRoleProvisional: false,
    },
    ai: { state: PROTOTYPE_MOCK_STATE, provider: "prototype-mock", message: PROTOTYPE_MOCK_WARNING },
    meta: prototypeMockMeta(),
  };
  await context.route("**/api/bootstrap**", (route) => route.fulfill(jsonResponse(bootstrap)));
  await context.route("**/api/runtime/status**", (route) => route.fulfill(jsonResponse(runtime)));
  await context.route("**/api/atlas/command-center**", (route) => route.fulfill(jsonResponse(syntheticCommandCenter())));
  await context.route("**/api/discovery/search**", async (route) => {
    const url = route.request().url();
    if (mockApiFlags.discoveryDegraded || requestRefererHasFlag(route, "ga_degraded")) {
      return route.fulfill(jsonResponse({
        detail: "Discovery backend timed out.",
        message: "Discovery backend timed out.",
        meta: prototypeMockMeta({ state: "degraded" }),
      }, 503));
    }
    const response = syntheticDiscoveryPayload(bootstrap, url);
    const query = new URL(url).searchParams.get("query") || "";
    if (/slow/i.test(query)) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    return route.fulfill(jsonResponse(response.payload, response.status));
  });
  await context.route("**/api/governance/summary**", (route) => route.fulfill(jsonResponse({
    authoritative: false,
    metrics: [],
    backlog: syntheticStewardshipItems(),
    glossary: syntheticTaxonomyOverview().data.glossaryTerms,
    inbox: {
      state: "unavailable",
      message: "Prototype inbox delivery is unavailable; this is not live Databricks notification proof.",
      unreadCount: 0,
      stewardshipCount: 184,
      items: [],
    },
    provenance: {
      ...prototypeMockMeta(),
    },
  })));
  await context.route("**/api/classification-recommendations**", (route) => route.fulfill(jsonResponse({
    recommendations: [],
    count: 0,
    pendingCount: 0,
  })));
  await context.route("**/api/atlas/governance/workbench**", (route) => route.fulfill(jsonResponse(
    mockApiFlags.governanceDegraded || requestRefererHasFlag(route, "ga_governance_degraded")
      ? syntheticStewardshipWorkbenchDegraded()
      : syntheticStewardshipWorkbench()
  )));
  await context.route("**/api/atlas/taxonomy/overview**", (route) => route.fulfill(jsonResponse(
    mockApiFlags.taxonomyDegraded || requestRefererHasFlag(route, "ga_taxonomy_degraded")
      ? syntheticTaxonomyOverviewDegraded()
      : syntheticTaxonomyOverview()
  )));
  await context.route("**/api/atlas/cde**", (route) => route.fulfill(jsonResponse({
    ...(mockApiFlags.taxonomyDegraded || requestRefererHasFlag(route, "ga_taxonomy_degraded")
      ? syntheticTaxonomyOverviewDegraded().data
      : syntheticTaxonomyOverview().data),
    meta: (mockApiFlags.taxonomyDegraded || requestRefererHasFlag(route, "ga_taxonomy_degraded")
      ? syntheticTaxonomyOverviewDegraded().meta
      : syntheticTaxonomyOverview().meta),
  })));
  await context.route("**/api/atlas/audit/evidence**", (route) => {
    if (mockApiFlags.auditDegraded || requestRefererHasFlag(route, "ga_audit_degraded")) {
      return route.fulfill(jsonResponse(syntheticAuditEvidenceDegraded()));
    }
    return route.fulfill(jsonResponse(syntheticAuditEvidence()));
  });
  await context.route("**/api/atlas/admin/control-center**", (route) => route.fulfill(jsonResponse(syntheticAdminControlCenter())));
  await context.route("**/api/atlas/assets/**", (route) => {
    const url = new URL(route.request().url());
    if (/\/360$/i.test(url.pathname)) {
      const raw = url.pathname.replace(/^.*\/api\/atlas\/assets\//i, "").replace(/\/360$/i, "");
      const fqn = decodeURIComponent(raw || ASSET_FQN);
      return route.fulfill(jsonResponse(syntheticAsset360Payload(fqn, bootstrap)));
    }
    const raw = url.pathname.replace(/^.*\/api\/atlas\/assets\//i, "").split("/")[0] || "";
    const fqn = decodeURIComponent(raw || ASSET_FQN);
    return route.fulfill(jsonResponse(assetFromBootstrap(bootstrap, fqn)));
  });
  await context.route("**/api/atlas/governance/requests/**", (route) => {
    const requestId = decodeURIComponent(route.request().url().split("/").pop() || "");
    const detail = syntheticStewardshipItems().find((item) => item.requestId === requestId) || syntheticStewardshipItems()[0];
    return route.fulfill(jsonResponse(detail));
  });
  await context.route("**/api/governance/requests/**", (route) => {
    const requestId = decodeURIComponent(route.request().url().split("/").pop() || "");
    const detail = syntheticStewardshipItems().find((item) => item.requestId === requestId) || syntheticStewardshipItems()[0];
    if (route.request().method() === "PATCH") {
      let payload = {};
      try {
        payload = route.request().postDataJSON?.() || {};
      } catch {
        payload = {};
      }
      const reviewNote = String(payload.reviewNote || "").trim();
      const status = String(payload.status || detail.status || "").trim();
      const auditEventType = /resolved|approved|closed/i.test(status) ? "task_state_changed" : "comment_created";
      return route.fulfill(jsonResponse({
        ok: true,
        requestId,
        request: {
          ...detail,
          status,
          reviewNote,
          reviewedAt: "2026-04-30T06:45:00Z",
        },
        audit: {
          eventType: auditEventType,
          requestId,
          reviewNote,
          source: "prototype-governance-workflow-audit",
          evidenceKind: PROTOTYPE_MOCK_STATE,
        },
        governance: syntheticStewardshipWorkbench(),
        meta: prototypeMockMeta(),
      }));
    }
    return route.fulfill(jsonResponse({ governance: syntheticStewardshipWorkbench(), request: detail }));
  });
  await context.route("**/api/assets/**", (route) => {
    const url = new URL(route.request().url());
    if (/\/api\/assets\/availability/i.test(url.pathname)) {
      const assets = Array.isArray(bootstrap?.discovery?.defaultResults)
        ? bootstrap.discovery.defaultResults
        : [];
      return route.fulfill(jsonResponse({
        assets: Object.fromEntries(assets.map((asset) => [asset.fqn, {
          openable: true,
          available: true,
          authoritative: false,
          state: PROTOTYPE_MOCK_STATE,
          source: PROTOTYPE_MOCK_SOURCE,
          warning: PROTOTYPE_MOCK_WARNING,
        }])),
      }));
    }
    if (mockApiFlags.previewDegraded || requestRefererHasFlag(route, "ga_preview_degraded")) {
      return route.fulfill(jsonResponse({
        detail: "Live preview refresh stalled.",
        message: "Live preview refresh stalled.",
        meta: prototypeMockMeta({ state: "degraded" }),
      }, 503));
    }
    const encodedFqn = url.pathname.split("/api/assets/")[1] || "";
    const fqn = decodeURIComponent(encodedFqn.split("/")[0] || ASSET_FQN);
    return route.fulfill(jsonResponse(assetFromBootstrap(bootstrap, fqn)));
  });
  await context.route("**/api/lineage/**", (route) => {
    const encodedFqn = route.request().url().split("/api/lineage/")[1] || "";
    const fqn = decodeURIComponent(encodedFqn.split("?")[0] || ASSET_FQN);
    return route.fulfill(jsonResponse(syntheticLineagePayload(fqn)));
  });
  const routeAwareAtlasAiAnswer = (question) => {
    const base = {
      authoritative: false,
      state: PROTOTYPE_MOCK_STATE,
      source: PROTOTYPE_MOCK_SOURCE,
      warnings: prototypeMockWarnings(),
    };
    if (/audit|grant|notebook|export|evidence/i.test(question)) {
      return {
        ...base,
        answer: "Prototype mock Audit Evidence shows grant, certification, notebook, and export events with fixture request IDs. This is not live Databricks audit proof.",
        recommendations: [],
        evidence: [
          { label: "REQ-1001", type: "audit event", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "prototype audit export fixture", type: "export", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        ],
      };
    }
    if (/control|job|runtime|integration|policy/i.test(question)) {
      return {
        ...base,
        answer: "Prototype mock Control Center evidence shows UC metadata sweeper and Trust score recompute as runtime job fixtures, with prototype integration and policy coverage rows. This is not live Jobs, serving, or policy proof.",
        recommendations: [],
        evidence: [
          { label: "UC metadata sweeper", type: "runtime job fixture", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "Trust score recompute", type: "runtime job fixture", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "Prototype policy coverage", type: "policy fixture", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        ],
      };
    }
    if (/lineage|downstream|upstream|net_revenue|consumer|column/i.test(question)) {
      return {
        ...base,
        answer: "Prototype mock Lineage evidence shows finance_prod.curated.revenue_daily feeding CFO Quarterly Dashboard consumers and SI-2482 stewardship context. This is not live Databricks lineage proof.",
        recommendations: [],
        evidence: [
          { label: "finance_prod.curated.revenue_daily", type: "asset", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "SI-2482", type: "work item", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        ],
      };
    }
    if (/certified assets|important assets|discover|trust score/i.test(question)) {
      return {
        ...base,
        answer: "Prototype mock Discover evidence ranks finance_prod.curated.revenue_daily and customer_360.gold.customer_profile by fixture trust score, certification, and CDE coverage. This is not live Unity Catalog search proof.",
        recommendations: [
          {
            title: "Review revenue_daily recertification",
            detail: "Certified asset with board-facing usage and an active recertification item.",
            provider: "prototype",
            evidence: [{ id: "finance_prod.curated.revenue_daily", label: "finance_prod.curated.revenue_daily", type: "asset" }],
          },
          {
            title: "Inspect customer_profile PII coverage",
            detail: "Restricted CDE asset with PII tags and executive downstream consumers.",
            provider: "prototype",
            evidence: [{ id: "customer_360.gold.customer_profile", label: "customer_360.gold.customer_profile", type: "asset" }],
          },
        ],
        evidence: [
          { label: "finance_prod.curated.revenue_daily", type: "asset", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "customer_360.gold.customer_profile", type: "asset", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        ],
      };
    }
    if (/cde|recert/i.test(question)) {
      return {
        ...base,
        answer: "Prototype mock CDE registry evidence shows Lifetime Value (USD) as recertification due in 8 days. Net Revenue (USD) is approved; no live Databricks CDE mutation is implied.",
        recommendations: [],
        evidence: [
          { label: "Lifetime Value (USD)", type: "cde", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "Prototype Recert Due (8d)", type: "status", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        ],
      };
    }
    if (/glossary|net revenue/i.test(question)) {
      return {
        ...base,
        answer: "Prototype mock glossary evidence links Net Revenue to finance_prod.curated.revenue_daily with reviewer finance.steward@entrada.ai and version-history context. This is not live Databricks glossary proof.",
        recommendations: [],
        evidence: [
          { label: "Net Revenue", type: "glossary term", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "finance_prod.curated.revenue_daily", type: "asset", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        ],
      };
    }
    if (/steward|work item|attention/i.test(question)) {
      return {
        ...base,
        answer: "Prototype mock Stewardship evidence flags SI-2482 on finance_prod.curated.revenue_daily for recertification attention. No live workflow mutation is submitted by this answer.",
        recommendations: [],
        evidence: [
          { label: "SI-2482", type: "work item", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          { label: "finance_prod.curated.revenue_daily", type: "asset", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
        ],
      };
    }
    return {
      ...base,
      answer: "Prototype mock governance metadata says finance_prod.curated.revenue_daily is certified and has a recertification work item. This answer is not live Databricks evidence.",
      recommendations: [],
      evidence: [{ label: "finance_prod.curated.revenue_daily", type: "asset", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING }],
    };
  };
  await context.route("**/api/atlas-ai/recommendations**", async (route) => {
    const rawBody = route.request().postData() || "{}";
    let question = "";
    try {
      question = String(JSON.parse(rawBody)?.question || "");
    } catch {
      question = "";
    }
    if (/error|timeout|failure/i.test(question)) {
      return route.fulfill(jsonResponse({
        detail: "Atlas AI prototype error path validated.",
        meta: prototypeMockMeta(),
      }, 503));
    }
    if (/slow|loading/i.test(question)) {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    }
    if (/markdown/i.test(question)) {
      return route.fulfill(jsonResponse({
        data: {
          answer: [
            "**Prototype mock** lineage context is available for `finance_prod.curated.revenue_daily`.",
            "",
            "- Evidence: finance stewardship record.",
            "- Review: [asset record](https://example.com/governance-atlas).",
          ].join("\n"),
          authoritative: false,
          state: PROTOTYPE_MOCK_STATE,
          source: PROTOTYPE_MOCK_SOURCE,
          warnings: prototypeMockWarnings(),
          recommendations: [],
          evidence: [
            { label: "finance_prod.curated.revenue_daily", type: "asset", source: PROTOTYPE_MOCK_SOURCE, warning: PROTOTYPE_MOCK_WARNING },
          ],
        },
        meta: prototypeMockMeta({ scenario: "atlas-ai-markdown-safety" }),
      }));
    }
    return route.fulfill(jsonResponse({
      data: routeAwareAtlasAiAnswer(question),
      meta: prototypeMockMeta({ scenario: "atlas-ai-route-aware" }),
    }));
  });
  await context.route("**/api/atlas-ai/chat**", (route) => {
    const rawBody = route.request().postData() || "{}";
    let question = "";
    try {
      question = String(JSON.parse(rawBody)?.question || "");
    } catch {
      question = "";
    }
    return route.fulfill(jsonResponse(routeAwareAtlasAiAnswer(question)));
  });
}

async function flushReport() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const unexpectedRequestFailures = report.requestFailures.filter(
    (item) => !expectedRequestFailure(item) && (item.status >= 400 || item.failureText),
  );
  report.captureCount = report.captures.length;
  report.interactionCount = report.interactions.length;
  report.consoleErrorCount = report.console.filter((item) => /error/i.test(item.type || "")).length;
  report.pageErrorCount = report.pageErrors.length;
  report.requestFailureCount = unexpectedRequestFailures.length;
  report.passed =
    UNKNOWN_ROUTE_FILTERS.length === 0 &&
    EXPECTED_CAPTURE_COUNT > 0 &&
    report.captures.length === EXPECTED_CAPTURE_COUNT &&
    report.captures.every((capture) => capture.loaded && capture.screenshot) &&
    (!CAPTURE_INTERACTIONS || report.interactions.every((interaction) => interaction.loaded && interaction.screenshot)) &&
    report.pageErrors.length === 0 &&
    unexpectedRequestFailures.length === 0;
  await fs.writeFile(
    path.join(OUT_DIR, "prototype-current-report.json"),
    JSON.stringify(report, null, 2),
  );
}

async function captureRuntimeStatus() {
  if (MOCK_API || !LIVE_DATABRICKS_CAPTURE) return;
  const runtimeUrl = `${BASE_URL.replace(/\/$/, "")}/api/runtime/status`;
  try {
    const response = await fetch(runtimeUrl, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    });
    const body = await response.json().catch(() => ({}));
    const buildId = String(
      body?.diagnostics?.buildId ||
      body?.shell?.buildId ||
      body?.buildId ||
      "",
    ).trim();
    report.runtimeStatus = {
      url: runtimeUrl,
      status: response.status,
      ok: response.ok,
      buildId,
      state: String(body?.runtime?.state || body?.state || "").trim(),
      actorRole: String(body?.identity?.actorRole || body?.actorRole || "").trim(),
      govCatalog: String(body?.config?.govCatalog || body?.govCatalog || "").trim(),
      govSchema: String(body?.config?.govSchema || body?.govSchema || "").trim(),
    };
    report.checks.buildMatches = EXPECTED_BUILD_ID ? buildId === EXPECTED_BUILD_ID : response.ok;
  } catch (error) {
    report.runtimeStatus = {
      url: runtimeUrl,
      ok: false,
      error: error?.message || String(error),
    };
    report.checks.buildMatches = false;
  }
}

function expectedRequestFailure(item) {
  return (
    item?.expected === true ||
    (
      item?.status === 400 &&
      /\/api\/discovery\/search/i.test(String(item.url || "")) &&
      /query=name%3A%28/i.test(String(item.url || ""))
    ) ||
    (
      item?.status === 503 &&
      /\/api\/atlas-ai\/recommendations/i.test(String(item.url || ""))
    )
  );
}

function attachListeners(page) {
  page.on("pageerror", (error) => {
    report.pageErrors.push({
      message: error?.message || String(error),
      stack: error?.stack || "",
      url: page.url(),
    });
    void flushReport();
  });
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    if (/favicon|ResizeObserver loop/i.test(text)) return;
    report.console.push({
      type: message.type(),
      text,
      url: page.url(),
    });
    void flushReport();
  });
  page.on("requestfailed", (request) => {
    const failureText = request.failure()?.errorText || "failed";
    if (failureText === "net::ERR_ABORTED") return;
    report.requestFailures.push({
      method: request.method(),
      url: request.url(),
      failureText,
    });
    void flushReport();
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    if (!response.url().startsWith(new URL(BASE_URL).origin)) return;
    const url = response.url();
    const expectedDegradedDiscovery =
      mockApiFlags.discoveryDegraded &&
      response.status() === 503 &&
      /\/api\/discovery\/search/i.test(url);
    const expectedDegradedPreview =
      mockApiFlags.previewDegraded &&
      response.status() === 503 &&
      /\/api\/assets\//i.test(url) &&
      !/\/api\/assets\/availability/i.test(url);
    report.requestFailures.push({
      method: request.method(),
      url,
      status: response.status(),
      expected: expectedDegradedDiscovery || expectedDegradedPreview || undefined,
      scenario: expectedDegradedDiscovery
        ? "discover-degraded-results"
        : expectedDegradedPreview
          ? "discover-degraded-selected"
          : undefined,
    });
    void flushReport();
  });
}

async function pageMetrics(page) {
  return page.evaluate(() => {
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.hidden || node.closest("[hidden]")) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const styleFor = (selector, properties) => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) return null;
      const style = window.getComputedStyle(node);
      return Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]));
    };
    const visibleText = document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
    const links = Array.from(document.querySelectorAll("button,a,[role='button']"))
      .filter(isVisible)
      .slice(0, 80)
      .map((node) => ({
        text: (node.innerText || node.getAttribute("aria-label") || node.title || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120),
        disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
        aria: node.getAttribute("aria-label") || "",
      }))
      .filter((item) => item.text || item.aria);
    return {
      title: document.title,
      url: window.location.href,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      scroll: {
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        hasVerticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 2,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      },
      shell: rect(".gh-shell-header"),
      sideRail: rect(".ga-side-nav"),
      main: rect(".gh-main"),
      mainScroll: (() => {
        const node = document.querySelector(".gh-main");
        if (!(node instanceof HTMLElement)) return null;
        return {
          scrollTop: node.scrollTop,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          hasOverflow: node.scrollHeight > node.clientHeight + 2,
        };
      })(),
      home: rect(".gh-home-page"),
      discovery: rect(".gh-discovery-main-grid"),
      entity: rect(".gh-entity-record-layout"),
      lineage: rect(".gh-lineage-canvas") || rect(".ga-lineage-explorer"),
      lineagePrototype: {
        page: rect(".ga-lineage-explorer"),
        hero: rect(".ga-lineage-hero"),
        workbench: rect(".ga-lineage-workbench"),
        graph: rect(".ga-lineage-graph-card"),
      },
      audit: {
        page: rect(".gh-audit-ns"),
        shell: rect(".gh-audit-shell"),
        main: rect(".gh-audit-main"),
        table: rect(".gh-audit-table-panel"),
        mainStyle: styleFor(".gh-audit-main", ["width", "justify-self", "align-self", "grid-column", "display"]),
        shellStyle: styleFor(".gh-audit-shell", ["width", "grid-template-columns", "justify-items", "display"]),
      },
      admin: {
        page: rect(".gh-admin-ns"),
        shell: rect(".gh-admin-shell"),
        main: rect(".gh-admin-main"),
      },
      textPreview: visibleText.slice(0, 1600),
      controls: links,
    };
  });
}

async function visibleText(page, maxLength = 4000) {
  const text = await page.evaluate(() => document.body?.innerText?.replace(/\s+/g, " ").trim() || "");
  return text.slice(0, maxLength);
}

function patternMatched(text, pattern) {
  if (pattern instanceof RegExp) return pattern.test(text);
  return String(text).includes(String(pattern));
}

async function textChecks(page, checks) {
  const text = await visibleText(page, 8000);
  return Object.fromEntries(
    Object.entries(checks).map(([key, pattern]) => [key, patternMatched(text, pattern)]),
  );
}

async function controlSnapshot(locator) {
  const target = locator.first();
  return target.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      text: (node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
      ariaLabel: node.getAttribute("aria-label") || "",
      title: node.getAttribute("title") || "",
      role: node.getAttribute("role") || "",
      disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
      ariaPressed: node.getAttribute("aria-pressed") || "",
      ariaSelected: node.getAttribute("aria-selected") || "",
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  });
}

async function pressedGroupSnapshot(page, entries) {
  const snapshots = {};
  for (const [key, pattern] of entries) {
    snapshots[key] = await controlSnapshot(buttonByName(page, pattern));
  }
  return {
    snapshots,
    activeKeys: Object.entries(snapshots)
      .filter(([, snapshot]) => snapshot?.ariaPressed === "true")
      .map(([key]) => key),
  };
}

async function clickVisible(locator, description, options = {}) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: options.timeout || 15_000 });
  if (!options.skipScroll) {
    await target.scrollIntoViewIfNeeded().catch(() => {});
  }
  const before = await controlSnapshot(target);
  if (!options.allowDisabled && before.disabled) {
    throw new Error(`${description} is disabled`);
  }
  await target.click({ timeout: options.timeout || 15_000, force: options.force || false });
  await pagePause(locator.page?.()).catch(() => {});
  return before;
}

async function pagePause(page) {
  if (!page) return;
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

function buttonByName(page, name) {
  return page.getByRole("button", { name }).first();
}

function linkByName(page, name) {
  return page.getByRole("link", { name }).first();
}

const SHARED_CONTROL_COVERAGE = [
  { id: "shared-nav", ledger: "Cross-Page Shared global navigation routes", pattern: /^(Command Center|Discover|Stewardship(?:\s+\d+)?|Glossary & CDEs|Lineage Atlas|Audit Evidence|Control Center)$/i },
  { id: "shared-profile", ledger: "Cross-Page Shared profile menu", pattern: /^(Open profile menu\b.*|[A-Z]{1,3}\s+.+\s+Admin|[A-Z]{1,3}\s+.+\s+Steward)$/i },
  { id: "shared-breadcrumb", ledger: "Cross-Page Shared workspace breadcrumb", pattern: /^(Open Governance Atlas Command Center|Workspace\b.*)$/i },
  { id: "shared-search", ledger: "Cross-Page Shared global search", pattern: /^(Submit global search|Search assets.*)$/i },
  { id: "shared-notifications", ledger: "Cross-Page Shared notifications", pattern: /^Notifications/i },
  { id: "shared-help", ledger: "Cross-Page Shared help", pattern: /^Help$/i },
  { id: "shared-ai", ledger: "Cross-Page Shared Atlas AI", pattern: /^(Atlas AI|Open Atlas AI|Close Atlas AI|Ask Atlas AI|Atlas AI is responding)$/i },
];

const ROUTE_CONTROL_COVERAGE = {
  "command-center": [
    { id: "cc-primary", ledger: "Command Center primary controls", pattern: /^(Export brief|Present mode|12w|26w|52w)$/i },
    { id: "cc-info", ledger: "Command Center info affordances", pattern: /(Coverage trend|Posture by domain|Risk breakdown|Top catalogs|Critical data elements|Activity stream)/i },
    { id: "cc-domain", ledger: "Command Center domain routing", pattern: /(domain posture|Revenue & Sales.*assets|Customer.*assets|Marketing.*assets|Finance.*assets|Operations.*assets|People.*assets)/i },
    { id: "cc-risk", ledger: "Command Center risk routing/unavailable states", pattern: /(Open exposures|open exposures|Medium-risk findings|Informational|Open stewardship|Open audit evidence)/i },
    { id: "cc-cde", ledger: "Command Center CDE routing/unavailable rows", pattern: /(View all|Net Revenue|Customer ID|Lifetime Value|Compensation Band|Source-of-record column unavailable|CDE source signal unavailable)/i },
    { id: "cc-activity", ledger: "Command Center activity routing", pattern: /(certified finance_prod|flagged (?:1 asset for )?missing owner|auto-tagged PII columns|approved access for|acknowledged quality alert)/i },
  ],
  discover: [
    { id: "discover-facets", ledger: "Discover filters/facets", pattern: /(Certified|In Review|Uncertified|Restricted|Confidential|Internal|Unclassified|Critical Data Element|Contains PII|No PII|Revenue & Sales|Customer|Marketing|Finance|Operations|People)\s*\d*/i },
    { id: "discover-search-sort-view", ledger: "Discover search/sort/view", pattern: /(Search discovery assets|Saved searches|Advanced|Trust score|Grid view|List view)/i },
    { id: "discover-rows", ledger: "Discover result rows and actions", pattern: /(Open asset actions|Open Record|Open Lineage|Open lineage|compensation_band|revenue_daily|orders|churn_propensity|customer_profile|attribution_daily|clickstream_events|pricing_experiment)/i },
    { id: "discover-bottom", ledger: "Discover bottom cards and recommendations", pattern: /(View all|Needs Owner|Needs Certification|Certified Data|High Coverage Assets|Run Atlas AI recommendations|Review revenue_daily|Inspect customer_profile)/i },
  ],
  stewardship: [
    { id: "stewardship-actions", ledger: "Stewardship filters and workflow actions", pattern: /^(Filter|Bulk assign|New work item|All\s+\d+|P1 critical\s+\d+|Overdue\s+\d+|Assigned to me\s+\d+|Comment|Resolve|Next page|Close request detail)$|Prototype work items are visual workflow evidence only/i },
    { id: "stewardship-rows", ledger: "Stewardship work queue/detail routing", pattern: /(SI-\d+|experimental\.sandbox|customer_360|sales_prod|finance_prod|product_events|hr_secure|marketing_mart|Assign owner|Archive sandbox|Open lineage context|^1$|^>$|^x$)/i },
  ],
  glossary: [
    { id: "glossary-tabs-actions", ledger: "Glossary tabs and creation unavailable state", pattern: /(\+ New term|Glossary\s+\d+|CDE Registry\s+\d+)/i },
    { id: "glossary-term-actions", ledger: "Glossary term association and lineage controls", pattern: /(Net Revenue|Active Customer|Churn Propensity|Booking|assets|View lineage|Open lineage)/i },
  ],
  "cde-registry": [
    { id: "cde-tabs-actions", ledger: "CDE tabs/request/detail controls", pattern: /(\+ New term|Glossary\s+\d+|CDE Registry\s+\d+|Request recertification|Show owner workflow note|Show recertification note|Open lineage|Open source asset)/i },
  ],
  lineage: [
    { id: "lineage-header-canvas", ledger: "Lineage visible header, canvas, and time controls", pattern: /^(Column lineage|Run impact analysis|Preview impact|\+|-|Zoom in|Zoom out|Fit graph|Graph history|Now|Reset preview|Reset prototype view|Refocus graph|Notify owners|Owner notification requires backed impact evidence\.)$/i },
    { id: "lineage-nodes", ledger: "Lineage graph node selection", pattern: /(orders|charges|charges_raw|invoices_raw|payments|ipynb|dlt_payments_ingest|auto_loader_invoices|downstream assets)/i },
    { id: "lineage-details-rail", ledger: "Lineage details rail source and consumer selection", pattern: /(revenue_recognition|prototype-consumer|source-system details|downstream consumer details)/i },
    { id: "lineage-impact-columns", ledger: "Lineage impact and column rows", pattern: /(Finance Stewards|High impact|Medium|Restricted|net_revenue_usd|gross_revenue_usd|refund_usd|Prototype permission boundary|Prototype downstream shape|No backed)/i },
  ],
  audit: [
    { id: "audit-main", ledger: "Audit date/export/filter/detail controls", pattern: /(Date range|Generate report|Export CSV|All events|By users|By services|Violations|Open evidence target|Certification|Tag Applied|Grant|Policy Violation|Quality Alert|Lineage Updated|Description Edited|Access Review)/i },
  ],
  "control-center": [
    { id: "control-center-rows", ledger: "Control Center job/integration/policy controls", pattern: /(UC metadata sweeper|Lineage collector|Quality \+ freshness|Policy engine|PII classifier|Trust score recompute|Unity Catalog|Databricks SQL Warehouse|Lakeflow Jobs|Model Serving|Slack|PagerDuty|Owner required|CDEs must have|PII columns require|90-day re-certification|Restricted catalogs)/i },
    { id: "control-center-links", ledger: "Control Center linked resource behavior", pattern: /(Open linked resource|No Databricks URL available)/i },
  ],
};

const MUTATION_EVIDENCE = [
  {
    control: "Discover preview Comment and Request access",
    disposition: "disabled with visible prototype workflow rationale",
    report: CURRENT_REPORT_PATH,
    interaction: "preview-actions",
  },
  {
    control: "Stewardship Comment",
    disposition: "disabled with visible prototype work-item rationale; no PATCH submitted",
    report: CURRENT_REPORT_PATH,
    interaction: "workbench-controls",
  },
  {
    control: "Stewardship Resolve",
    disposition: "disabled with visible prototype work-item rationale; no PATCH submitted",
    report: CURRENT_REPORT_PATH,
    interaction: "workbench-controls",
  },
  {
    control: "Stewardship Bulk assign, New work item, Assign owner, and Archive suggested actions",
    disposition: "truthful unavailable panels, no mutation submitted",
    report: CURRENT_REPORT_PATH,
    interaction: "workbench-controls",
  },
  {
    control: "Glossary and CDE creation/reviewer/recertification workflows",
    disposition: "truthful unavailable states or disabled controls",
    report: CURRENT_REPORT_PATH,
    interaction: "glossary-controls",
  },
  {
    control: "Lineage Notify owners",
    disposition: "disabled until backed impact evidence exists",
    report: CURRENT_REPORT_PATH,
    interaction: "notify-owners",
  },
  {
    control: "Audit export controls",
    disposition: "downloaded artifacts verified for content and prototype provenance",
    report: CURRENT_REPORT_PATH,
    interaction: "audit-controls",
  },
  {
    control: "Lineage export controls",
    disposition: "authoritative export controls are absent from the non-authoritative prototype Lineage view",
    report: CURRENT_REPORT_PATH,
    interaction: "lineage-controls",
  },
];

function normalizeControlLabel(control) {
  return String(
    control?.ariaLabel ||
    control?.title ||
    control?.placeholder ||
    control?.text ||
    control?.name ||
    "",
  ).replace(/\s+/g, " ").trim();
}

function coverageForControl(routeKey, control) {
  const label = normalizeControlLabel(control);
  const candidates = [
    ...SHARED_CONTROL_COVERAGE,
    ...(ROUTE_CONTROL_COVERAGE[routeKey] || []),
  ];
  return candidates.find((item) => item.pattern.test(label)) || null;
}

async function collectControlInventoryForRoute(page, route) {
  await waitForRoute(page, route);
  const raw = await page.evaluate(() => {
    const controlSelector = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='switch']",
      "[role='checkbox']",
    ].join(",");
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.hidden || node.closest("[hidden]")) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const hiddenReason = (node) => {
      if (isVisible(node)) return "";
      if (node.hidden || node.closest("[hidden]")) return "hidden-attribute";
      const style = window.getComputedStyle(node);
      const box = node.getBoundingClientRect();
      if (node.classList.contains("gh-visually-hidden")) return "visually-hidden-class";
      if (style.display === "none") return "display-none";
      if (style.visibility === "hidden") return "visibility-hidden";
      if (Number(style.opacity) === 0) return "opacity-zero";
      if (box.width <= 0 || box.height <= 0) return "zero-rect";
      return "not-visible";
    };
    const labelFor = (node) => {
      const labelledBy = String(node.getAttribute("aria-labelledby") || "").trim();
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
        : "";
      return {
        text: String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
        ariaLabel: String(node.getAttribute("aria-label") || "").trim(),
        title: String(node.getAttribute("title") || "").trim(),
        placeholder: String(node.getAttribute("placeholder") || "").trim(),
        labelledBy: labelledText.replace(/\s+/g, " ").trim().slice(0, 160),
      };
    };
    const seen = new Set();
    return Array.from(document.querySelectorAll(controlSelector))
      .filter((node) => node instanceof HTMLElement)
      .map((node, index) => {
        const box = node.getBoundingClientRect();
        const labels = labelFor(node);
        const key = [
          node.tagName,
          node.getAttribute("role") || "",
          labels.ariaLabel || labels.title || labels.placeholder || labels.labelledBy || labels.text,
          Math.round(box.top),
          Math.round(box.left),
        ].join("|");
        if (seen.has(key)) return null;
        seen.add(key);
        const visible = isVisible(node);
        return {
          index,
          tag: node.tagName.toLowerCase(),
          role: String(node.getAttribute("role") || "").trim(),
          type: String(node.getAttribute("type") || "").trim(),
          href: String(node.getAttribute("href") || "").trim(),
          disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
          ariaPressed: String(node.getAttribute("aria-pressed") || "").trim(),
          ariaSelected: String(node.getAttribute("aria-selected") || "").trim(),
          visible,
          hiddenReason: visible ? "" : hiddenReason(node),
          rect: {
            top: Math.round(box.top),
            left: Math.round(box.left),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
          ...labels,
        };
      })
      .filter(Boolean);
  });
  const visibleControls = raw
    .filter((control) => control.visible)
    .map((control) => {
      const coverage = coverageForControl(route.key, control);
      return {
        ...control,
        label: normalizeControlLabel(control),
        coverageId: coverage?.id || "",
        ledger: coverage?.ledger || "",
      };
    });
  const accessibilityOnlyControls = raw
    .filter((control) => !control.visible)
    .map((control) => ({
      ...control,
      label: normalizeControlLabel(control),
    }))
    .filter((control) => control.label || control.hiddenReason);
  return {
    route: route.key,
    path: route.path,
    visibleControls,
    accessibilityOnlyControls,
    uncoveredControls: visibleControls.filter((control) => !control.coverageId),
  };
}

async function validateAtlasAiMarkdownRendering(page) {
  await waitForRoute(page, SCREENSHOT_ROUTES.find((route) => route.key === "command-center"));
  await clickButton(page, /Atlas AI/i, "Open Atlas AI for markdown rendering");
  await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
  const input = page.locator(".gh-floating-ai-input input").first();
  await input.fill("markdown rendering proof");
  await page.locator(".gh-floating-ai-input button").first().click();
  await page.waitForFunction(
    () => /Prototype mock lineage context is available/i.test(document.body?.innerText || ""),
    undefined,
    { timeout: 20_000 },
  );
  const state = await page.evaluate(() => {
    const messages = Array.from(document.querySelectorAll(".gh-ai-message-markdown"));
    const node = messages[messages.length - 1];
    const html = node?.innerHTML || "";
    const text = node?.innerText || "";
    return {
      html: html.slice(0, 1200),
      text: text.replace(/\s+/g, " ").trim().slice(0, 1200),
      hasStrong: Boolean(node?.querySelector("strong")),
      hasListItem: Boolean(node?.querySelector("li")),
      hasCode: Boolean(node?.querySelector("code")),
      hasSafeLink: Boolean(node?.querySelector("a[href^='https://']")),
      hasScriptElement: Boolean(node?.querySelector("script")),
      hasJavascriptHref: Boolean(node?.querySelector("a[href^='javascript:']")),
      hasRawBoldMarkers: /\*\*/.test(text),
      hasRawInlineCodeMarkers: /`/.test(text),
    };
  });
  await clickButton(page, /Close Atlas AI/i, "Close Atlas AI after markdown rendering");
  return state;
}

async function clickButton(page, name, description, options = {}) {
  return clickVisible(buttonByName(page, name), description, options);
}

async function openFirstDiscoverRowActions(page, description = "Discover row actions") {
  await page.waitForSelector(".gh-discovery-table-row.gh-discovery-asset-card", { state: "visible", timeout: 20_000 });
  const gridButton = buttonByName(page, /Grid view/i);
  const gridState = await controlSnapshot(gridButton).catch(() => null);
  if (gridState && gridState.ariaPressed !== "true") {
    await clickVisible(gridButton, "Discover grid view for visible row actions", { skipScroll: true });
  }
  const actionButton = page.getByRole("button", { name: /Open asset actions/i }).first();
  await clickVisible(actionButton, description, { skipScroll: true });
  await page.getByRole("menu").first().waitFor({ state: "visible", timeout: 8_000 });
}

async function firstDiscoverResultFqn(page) {
  return page.locator(".gh-discovery-table-row.gh-discovery-asset-card").first().getAttribute("data-asset-fqn");
}

async function clickDownload(page, locator, slug) {
  const downloadsDir = path.join(OUT_DIR, "downloads");
  await fs.mkdir(downloadsDir, { recursive: true });
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 15_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    target.click(),
  ]);
  const suggested = download.suggestedFilename() || `${slug}.download`;
  const safeName = `${slug}-${suggested}`.replace(/[^a-z0-9._-]+/gi, "-");
  const outputPath = path.join(downloadsDir, safeName);
  await download.saveAs(outputPath);
  const stat = await fs.stat(outputPath);
  const preview = await fs.readFile(outputPath, "utf8").then((raw) => raw.slice(0, 1200)).catch(() => "");
  return {
    ok: stat.size > 0,
    suggestedFilename: suggested,
    path: outputPath,
    size: stat.size,
    preview,
    hasPrototypeWarning: preview.includes(PROTOTYPE_MOCK_WARNING),
    hasJsonEvidence: /"meta"|"data"|"generatedAt"|audit_id|entity_fqn/i.test(preview),
  };
}

async function waitForPath(page, pattern, timeout = 10_000) {
  await page.waitForURL((url) => pattern.test(`${url.pathname}${url.search}`), { timeout });
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

async function getBodyState(page, checks = {}) {
  return {
    url: page.url(),
    text: await visibleText(page, 1600),
    checks: await textChecks(page, checks),
  };
}

async function getProfileMenuState(page) {
  const state = await getBodyState(page, {
    settings: /Settings & diagnostics/i,
    avatar: /Upload local avatar/i,
    signOut: /Sign out/i,
  });
  const localAvatarState = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".gh-user-chip-menu-item"));
    const item = items.find((node) => /Upload local avatar/i.test(node.textContent || ""));
    const title = item?.getAttribute("title") || "";
    return {
      label: (item?.textContent || "").replace(/\s+/g, " ").trim(),
      title,
      localOnly: /Stored only in this browser/i.test(title),
      databricksProfileExcluded: /does not update a Databricks profile/i.test(title),
    };
  });
  return { ...state, localAvatarState };
}

async function waitForRoute(page, route) {
  await page.goto(urlFor(route.path), { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  let settleSelectorMatched = false;
  if (route.settle) {
    settleSelectorMatched = await page.waitForSelector(route.settle, { timeout: SETTLE_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!settleSelectorMatched && SHELL_FALLBACK) {
      await page.waitForSelector(".gh-app", { timeout: 10_000 }).catch(() => {});
    }
  }
  const shellReady = await page.waitForFunction(
    () => {
      const text = document.body?.innerText || "";
      const blockedByText = /UC status loading|Preparing the workspace surface|Loading home|Loading discovery|Loading lineage|Loading audit|Loading admin|Loading governance|Loading glossary registry|Loading taxonomy|Loading CDE registry|Reading visible catalog metadata/i.test(text);
      return !blockedByText;
    },
    undefined,
    { timeout: TEXT_SETTLE_TIMEOUT_MS },
  ).then(() => true).catch(() => false);
  const readiness = await page.evaluate(() => {
    const isVisible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.hidden || node.closest("[hidden]")) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const visibleText = document.body?.innerText || "";
    const blockedText = /UC status loading|Preparing the workspace surface|Loading home|Loading discovery|Loading lineage|Loading audit|Loading admin|Loading governance|Loading glossary registry|Loading taxonomy|Loading CDE registry|Reading visible catalog metadata/i.exec(visibleText)?.[0] || "";
    const disabledAtlasLabels = Array.from(document.querySelectorAll(".ga-ai-chip"))
      .filter(isVisible)
      .filter((node) => Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"))
      .map((node) => `${node.innerText || ""} ${node.getAttribute("aria-label") || ""} ${node.title || ""}`.replace(/\s+/g, " ").trim())
      .filter((label) => /Atlas AI|AI Copilot/i.test(label));
    return {
      blockedText,
      disabledAtlasLabels,
    };
  }).catch(() => ({ blockedText: "readiness probe failed", disabledAtlasLabels: [] }));
  await page.waitForTimeout(1200);
  return { settleSelectorMatched, shellReady, readiness };
}

async function discoverFilterState(page) {
  return page.evaluate(() => {
    const rail = document.querySelector(".gh-discovery-prototype-filter-rail");
    const buttons = Array.from(rail?.querySelectorAll("button") || []);
    const activeButtons = buttons
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => (button.textContent || button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const resultRows = Array.from(document.querySelectorAll(".gh-discovery-table-row.gh-discovery-asset-card"));
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const showingMatch = bodyText.match(/Showing\s+\d+\s+of\s+\d+\s+assets/i)?.[0] || "";
    const searchInput = document.querySelector('[aria-label="Search discovery assets"]');
    return {
      activeButtons,
      resultRowCount: resultRows.length,
      firstResult: resultRows[0]?.getAttribute("data-asset-fqn") || "",
      showingText: showingMatch,
      searchValue: searchInput instanceof HTMLInputElement ? searchInput.value : "",
      hasSavedQuery: /tag:CDE|certification:Certified|Revenue CDEs|FILTERED BY Certified/i.test(bodyText),
    };
  });
}

async function captureRoute(page, route, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const item = {
    route: route.key,
    path: route.path,
    viewport: viewport.name,
    loaded: false,
    screenshot: "",
    fullPageScreenshot: "",
  };
  try {
    if (DEBUG_STEPS) console.log(`debug ${route.key} ${viewport.name} wait`);
    item.wait = await waitForRoute(page, route);
    if (DEBUG_STEPS) console.log(`debug ${route.key} ${viewport.name} metrics`);
    item.metrics = await pageMetrics(page);
    item.loaded = Boolean(item.wait?.settleSelectorMatched && item.wait?.shellReady);
    item.shellFallbackUsed = Boolean(!item.wait?.settleSelectorMatched && SHELL_FALLBACK && item.wait?.shellReady);
  } catch (error) {
    item.error = error?.message || String(error);
    item.metrics = await pageMetrics(page).catch(() => null);
  }
  const base = `${route.key}-${viewport.name}`;
  item.screenshot = path.join(OUT_DIR, `${base}.png`);
  item.fullPageScreenshot = path.join(OUT_DIR, `${base}-full.png`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  if (DEBUG_STEPS) console.log(`debug ${route.key} ${viewport.name} screenshot`);
  await page.screenshot({ path: item.screenshot, fullPage: false });
  if (CAPTURE_FULL_PAGE) {
    if (DEBUG_STEPS) console.log(`debug ${route.key} ${viewport.name} fullpage`);
    await page.screenshot({ path: item.fullPageScreenshot, fullPage: true });
  } else {
    item.fullPageScreenshot = "";
  }
  if (SCROLL_MAIN) {
    if (route.key === "command-center") {
      const openAiButton = page.getByRole("button", { name: /Open Atlas AI/i }).first();
      if (await openAiButton.isVisible().catch(() => false)) {
        const aiButtonEnabled = await openAiButton.isEnabled().catch(() => false);
        item.mainBottomAiButtonEnabled = aiButtonEnabled;
        if (aiButtonEnabled) {
          await openAiButton.click();
          await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 5_000 }).catch(() => {});
          item.mainBottomAiOpened = true;
        } else {
          item.mainBottomAiOpened = false;
          item.mainBottomAiDisabled = true;
        }
      }
    }
    const scrollInfo = await page.evaluate(() => {
      const node = document.querySelector(".gh-main");
      if (!(node instanceof HTMLElement)) return null;
      const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      node.scrollTop = maxScrollTop;
      return {
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        maxScrollTop,
      };
    });
    item.mainScrollCapture = scrollInfo;
    if (scrollInfo?.maxScrollTop > 2) {
      await page.waitForTimeout(300);
      item.mainBottomScreenshot = path.join(OUT_DIR, `${base}-main-bottom.png`);
      await page.screenshot({ path: item.mainBottomScreenshot, fullPage: false });
    }
  }
  report.captures.push(item);
  await flushReport();
  console.log(`${item.loaded ? "ok" : "warn"} ${route.key} ${viewport.name}`);
}

const INTERACTION_STATES = {
  "command-center": [
    {
      key: "primary-controls",
      description: "Exercise Command Center exports, present mode, and trend window controls.",
      async run(page) {
        const exportBrief = await clickDownload(page, buttonByName(page, /Export brief/i), "command-center-brief");
        await clickButton(page, /^Present mode$/i, "Command Center present mode");
        await page.waitForFunction(() => /Exit present mode/i.test(document.body?.innerText || ""), undefined, { timeout: 8_000 });
        const presentOn = await textChecks(page, { exitPresentMode: /Exit present mode/i });
        await clickButton(page, /^Exit present mode$/i, "Command Center exit present mode");
        await clickButton(page, /^26w$/i, "Command Center 26-week trend");
        const after26 = await pressedGroupSnapshot(page, [["w12", /^12w$/i], ["w26", /^26w$/i], ["w52", /^52w$/i]]);
        await clickButton(page, /^52w$/i, "Command Center 52-week trend");
        const after52 = await pressedGroupSnapshot(page, [["w12", /^12w$/i], ["w26", /^26w$/i], ["w52", /^52w$/i]]);
        await clickButton(page, /^12w$/i, "Command Center 12-week trend");
        const after12 = await pressedGroupSnapshot(page, [["w12", /^12w$/i], ["w26", /^26w$/i], ["w52", /^52w$/i]]);
        return {
          exportBrief,
          presentOn,
          trendButtons: {
            w12: after12.snapshots.w12,
            w26: after26.snapshots.w26,
            w52: after52.snapshots.w52,
            after26,
            after52,
            after12,
          },
        };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, {
          commandTitle: /Governance posture, at a glance/i,
          coverageTrend: /Coverage trend/i,
          postureByDomain: /Posture by domain/i,
        });
        return {
          loaded: Boolean(
            runResult?.exportBrief?.ok &&
            runResult?.presentOn?.exitPresentMode &&
            JSON.stringify(runResult?.trendButtons?.after26?.activeKeys || []) === JSON.stringify(["w26"]) &&
            JSON.stringify(runResult?.trendButtons?.after52?.activeKeys || []) === JSON.stringify(["w52"]) &&
            JSON.stringify(runResult?.trendButtons?.after12?.activeKeys || []) === JSON.stringify(["w12"]) &&
            checks.commandTitle
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "catalog-navigation",
      description: "Open Discover from a top-catalog health row.",
      async run(page) {
        const row = page.locator(".gh-command-center-catalog-table [role='row'].is-clickable").first();
        await row.waitFor({ state: "visible", timeout: 15_000 });
        await row.click();
        const pathAfterClick = await waitForPath(page, /\/discover/i);
        await page.waitForSelector(".gh-discovery-workspace,.gh-discovery-main-grid", { timeout: 15_000 });
        return { pathAfterClick };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { discoverTitle: /Find trusted, governed data|Discover/i });
        return { loaded: /\/discover/i.test(runResult?.pathAfterClick || "") && checks.discoverTitle, checks, runResult };
      },
    },
    {
      key: "domain-risk-activity-lower",
      description: "Validate Command Center info affordances, domain/risk/activity routing, and lower-scroll regions.",
      async run(page) {
        const infoControls = await Promise.all(
          (await page.locator(".gh-command-center-grid .ga-info-tooltip").all()).map(async (control) => controlSnapshot(control)),
        );
        const domainRow = page.getByRole("button", { name: /Open discovery for .* domain posture/i }).first();
        const domainBefore = await controlSnapshot(domainRow);
        await clickVisible(domainRow, "Command Center domain posture row");
        const pathAfterDomain = await waitForPath(page, /\/discover/i);
        await page.waitForSelector(".gh-discovery-workspace,.gh-discovery-main-grid", { timeout: 15_000 });
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-home-page", { timeout: 20_000 });
        await page.waitForFunction(() => /Risk breakdown|Posture by domain/i.test(document.body?.innerText || ""), undefined, { timeout: 20_000 });
        const riskRow = page.getByRole("button", { name: /Open stewardship for .*exposures/i }).first();
        const riskBefore = await controlSnapshot(riskRow);
        await clickVisible(riskRow, "Command Center risk/open exposure row");
        const pathAfterRisk = await waitForPath(page, /\/stewardship|\/governance/i);
        await page.waitForSelector(".gh-governance-ns,.gh-governance-workspace,.gh-workspace", { timeout: 15_000 });
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-home-page", { timeout: 20_000 });
        await page.waitForFunction(() => /Activity stream/i.test(document.body?.innerText || ""), undefined, { timeout: 20_000 });
        const activityRow = page.locator(".gh-command-center-activity-list button:not([disabled])").first();
        const activityBefore = await controlSnapshot(activityRow);
        await clickVisible(activityRow, "Command Center activity stream row");
        const pathAfterActivity = await waitForPath(page, /\/audit-evidence|\/audit/i);
        await page.waitForSelector(".gh-audit-ns,.gh-audit-workspace,.gh-workspace", { timeout: 15_000 });
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-home-page", { timeout: 20_000 });
        await page.waitForFunction(() => /Critical data elements|Activity stream|Top catalogs/i.test(document.body?.innerText || ""), undefined, { timeout: 20_000 });
        const lowerScroll = await page.evaluate(() => {
          const node = document.querySelector(".gh-main");
          if (!(node instanceof HTMLElement)) return null;
          const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
          node.scrollTop = maxScrollTop;
          const text = document.body?.innerText || "";
          return {
            scrollTop: node.scrollTop,
            maxScrollTop,
            hasCdes: /Critical data elements/i.test(text),
            hasActivity: /Activity stream/i.test(text),
            hasCatalogs: /Top catalogs/i.test(text),
          };
        });
        return { infoControls, domainBefore, pathAfterDomain, riskBefore, pathAfterRisk, activityBefore, pathAfterActivity, lowerScroll };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.infoControls?.length >= 6 &&
            runResult.infoControls.every((item) => item.ariaLabel && item.title) &&
            !runResult?.domainBefore?.disabled &&
            /\/discover/i.test(runResult?.pathAfterDomain || "") &&
            !runResult?.riskBefore?.disabled &&
            /\/stewardship|\/governance/i.test(runResult?.pathAfterRisk || "") &&
            !runResult?.activityBefore?.disabled &&
            /\/audit-evidence|\/audit/i.test(runResult?.pathAfterActivity || "") &&
            runResult?.lowerScroll?.maxScrollTop > 0 &&
            runResult?.lowerScroll?.hasCdes &&
            runResult?.lowerScroll?.hasActivity &&
            runResult?.lowerScroll?.hasCatalogs
          ),
          runResult,
        };
      },
    },
    {
      key: "cde-navigation",
      description: "Open the CDE registry from the Command Center CDE panel.",
      async run(page) {
        await clickVisible(page.locator(".gh-command-center-cdes .ga-link-button").first(), "Command Center CDE View all");
        const pathAfterClick = await waitForPath(page, /\/taxonomy|\/glossary-cdes/i);
        await page.waitForSelector(".gh-taxonomy-ns,.gh-taxonomy-workspace,.gh-workspace", { timeout: 15_000 });
        return { pathAfterClick, state: await getBodyState(page, { cdeRegistry: /CDE Registry/i }) };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { cdeRegistry: /CDE Registry/i, taxonomy: /Glossary|Critical Data Elements|CDE/i });
        return { loaded: Boolean(checks.cdeRegistry && /\/taxonomy|\/glossary-cdes/i.test(runResult?.pathAfterClick || "")), checks, runResult };
      },
    },
    {
      key: "shared-shell-ai",
      description: "Open the floating Atlas AI chat from the shell and validate suggestions, loading, answer, evidence, and error states.",
      async run(page) {
        await clickButton(page, /Atlas AI/i, "Open shell Atlas AI");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const suggestionsBefore = await page.locator(".gh-floating-ai-prompts button").count();
        const firstSuggestion = page.locator(".gh-floating-ai-prompts button").first();
        const suggestionBefore = await controlSnapshot(firstSuggestion);
        await clickVisible(firstSuggestion, "Submit Atlas AI suggested prompt");
        await page.waitForFunction(
          () => /finance_prod\.curated\.revenue_daily|recertification|certified/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        const suggestionsAfterSuggestion = await page.locator(".gh-floating-ai-prompts button").count();
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("slow governed metadata loading check");
        await page.locator(".gh-floating-ai-input button").first().click();
        const loadingReached = await page.waitForFunction(
          () => document.querySelector(".gh-floating-ai-input")?.getAttribute("aria-busy") === "true"
            && /Checking governed metadata/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 1_000 },
        ).then(() => true).catch(() => false);
        await page.waitForFunction(
          () => /finance_prod\.curated\.revenue_daily|recertification|certified/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        const suggestionsAfterAnswer = await page.locator(".gh-floating-ai-prompts button").count();
        const result = await getBodyState(page, {
          floatingChat: /Atlas AI/i,
          answer: /finance_prod\.curated\.revenue_daily|certified/i,
          evidence: /evidence record returned|finance_prod\.curated\.revenue_daily/i,
          disclaimer: /Atlas AI uses AI\. Review for accuracy\./i,
        });
        await clickButton(page, /Atlas AI accuracy notice/i, "Open shell Atlas AI accuracy notice");
        const accuracyNotice = await getBodyState(page, {
          notice: /prototype answers use mock governance metadata|grounded in available governance metadata|Review before action/i,
        });
        await input.fill("force atlas ai error path");
        await page.locator(".gh-floating-ai-input button").first().click();
        await page.waitForFunction(
          () => /Atlas AI prototype error path validated/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        const errorState = await getBodyState(page, {
          error: /Atlas AI prototype error path validated/i,
          transcript: /force atlas ai error path/i,
        });
        await clickButton(page, /Close Atlas AI/i, "Close shell Atlas AI");
        const panelClosed = await page.locator(".gh-floating-ai-chat").first().isVisible().then((visible) => !visible).catch(() => true);
        await clickButton(page, /Atlas AI/i, "Reopen shell Atlas AI for evidence routing");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const evidenceButton = page.locator(".gh-floating-ai-evidence button").first();
        const evidenceBefore = await controlSnapshot(evidenceButton).catch(() => null);
        let pathAfterEvidence = "";
        let panelClosedAfterEvidence = false;
        if (evidenceBefore && !evidenceBefore.disabled) {
          await clickVisible(evidenceButton, "Open shell Atlas AI evidence route", { skipScroll: true });
          pathAfterEvidence = await page.evaluate(() => window.location.pathname + window.location.search).catch(() => "");
          panelClosedAfterEvidence = await page.locator(".gh-floating-ai-chat").first().isVisible().then((visible) => !visible).catch(() => true);
        }
        return {
          ...result,
          loadingReached,
          suggestionBefore,
          suggestionsBefore,
          suggestionsAfterSuggestion,
          suggestionsAfterAnswer,
          accuracyNotice,
          errorState,
          panelClosed,
          evidenceRoute: {
            evidenceBefore,
            pathAfterEvidence,
            panelClosedAfterEvidence,
          },
        };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            runResult?.checks?.floatingChat &&
            runResult?.loadingReached &&
            runResult?.checks?.answer &&
            runResult?.checks?.evidence &&
            runResult?.checks?.disclaimer &&
            !runResult?.suggestionBefore?.disabled &&
            runResult?.suggestionsBefore >= 4 &&
            runResult?.suggestionsAfterSuggestion === 1 &&
            runResult?.suggestionsAfterAnswer === 1 &&
            runResult?.accuracyNotice?.checks?.notice &&
            runResult?.errorState?.checks?.error &&
            runResult?.errorState?.checks?.transcript &&
            runResult?.panelClosed &&
            runResult?.evidenceRoute?.evidenceBefore &&
            runResult?.evidenceRoute?.panelClosedAfterEvidence &&
            /\/entity|\/governance|\/audit|\/lineage/.test(runResult?.evidenceRoute?.pathAfterEvidence || "")
          ),
          runResult,
        };
      },
    },
    {
      key: "responsive-ai-fab",
      description: "Exercise the responsive floating Atlas AI launcher on every non-Lineage route and verify Lineage keeps it hidden for the lineage-detail reference shape.",
      async run(page) {
        const viewport = page.viewportSize();
        const results = [];
        for (const targetRoute of SCREENSHOT_ROUTES) {
          await waitForRoute(page, targetRoute);
          const expectVisible = targetRoute.key !== "lineage";
          const fab = page.locator(".gh-atlas-ai-fab").first();
          const visible = await fab.isVisible().catch(() => false);
          const result = {
            route: targetRoute.key,
            path: targetRoute.path,
            control: "Open Atlas AI floating action button",
            expectedVisible: expectVisible,
            visible,
            result: expectVisible ? "not-run" : "hidden-as-required",
            backedState: MOCK_API ? "prototype_mock" : "runtime",
          };
          if (!expectVisible) {
            result.passed = !visible;
            results.push(result);
            continue;
          }
          if (!visible) {
            result.passed = false;
            result.result = "missing";
            results.push(result);
            continue;
          }
          await clickVisible(fab, `Open ${targetRoute.key} responsive Atlas AI FAB`, { skipScroll: true });
          const chat = page.locator(".gh-floating-ai-chat").first();
          await chat.waitFor({ state: "visible", timeout: 10_000 });
          result.chatVisible = await chat.isVisible().catch(() => false);
          await clickButton(page, /Close Atlas AI/i, `Close ${targetRoute.key} responsive Atlas AI chat`);
          result.chatClosed = await chat.isVisible().then((isVisible) => !isVisible).catch(() => true);
          result.result = result.chatVisible && result.chatClosed ? "opened-and-closed-chat" : "chat-state-failed";
          result.passed = Boolean(result.chatVisible && result.chatClosed);
          results.push(result);
        }
        return { viewport, results };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.results?.length === SCREENSHOT_ROUTES.length &&
            runResult.results.every((item) => item.passed)
          ),
          runResult,
        };
      },
    },
    {
      key: "cross-page-control-contract",
      description: "Inventory visible controls on every North Star route, separate hidden accessibility controls, prove Atlas AI markdown rendering, and bind mutation controls to audited/disabled evidence.",
      async run(page) {
        const routeInventories = [];
        for (const targetRoute of SCREENSHOT_ROUTES) {
          routeInventories.push(await collectControlInventoryForRoute(page, targetRoute));
        }
        const markdownSafety = await validateAtlasAiMarkdownRendering(page);
        const uncoveredControls = routeInventories.flatMap((item) =>
          item.uncoveredControls.map((control) => ({
            route: item.route,
            label: control.label,
            tag: control.tag,
            role: control.role,
            disabled: control.disabled,
            rect: control.rect,
          })),
        );
        const visibleControlCount = routeInventories.reduce((total, item) => total + item.visibleControls.length, 0);
        const accessibilityOnlyControlCount = routeInventories.reduce((total, item) => total + item.accessibilityOnlyControls.length, 0);
        const mutationControlsObserved = routeInventories.flatMap((item) =>
          item.visibleControls
            .filter((control) => /(Comment|Resolve|Bulk assign|New work item|Assign owner|Archive|Request|Notify owners|\+ New term|Generate report|Export|Open linked resource|Approve|Reject|Defer|Certify)/i.test(control.label))
            .map((control) => ({
              route: item.route,
              label: control.label,
              disabled: control.disabled,
              ledger: control.ledger,
            })),
        );
        return {
          routeInventories,
          visibleControlCount,
          accessibilityOnlyControlCount,
          uncoveredControls,
          markdownSafety,
          mutationControlsObserved,
          mutationEvidence: MUTATION_EVIDENCE,
          evidenceBoundary: {
            currentReportEvidenceKind: MOCK_API ? "prototype_mock" : "runtime_app_capture",
            localPrototypeWarning: MOCK_API ? PROTOTYPE_MOCK_WARNING : "",
            liveDatabricksProofRecordedHere: false,
          },
        };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.routeInventories?.length === SCREENSHOT_ROUTES.length &&
            runResult?.visibleControlCount > 0 &&
            Array.isArray(runResult?.uncoveredControls) &&
            runResult.uncoveredControls.length === 0 &&
            Number.isFinite(Number(runResult?.accessibilityOnlyControlCount)) &&
            runResult?.markdownSafety?.hasStrong &&
            runResult?.markdownSafety?.hasListItem &&
            runResult?.markdownSafety?.hasCode &&
            runResult?.markdownSafety?.hasSafeLink &&
            !runResult?.markdownSafety?.hasScriptElement &&
            !runResult?.markdownSafety?.hasJavascriptHref &&
            !runResult?.markdownSafety?.hasRawBoldMarkers &&
            !runResult?.markdownSafety?.hasRawInlineCodeMarkers &&
            runResult?.mutationEvidence?.length >= 7 &&
            runResult.mutationEvidence.every((item) => item.report && item.interaction && item.disposition) &&
            runResult?.evidenceBoundary?.currentReportEvidenceKind === "prototype_mock" &&
            runResult?.evidenceBoundary?.liveDatabricksProofRecordedHere === false
          ),
          runResult,
        };
      },
    },
    {
      key: "shared-shell-search",
      description: "Submit global search from the topbar with keyboard and mouse controls and land in Discover with results.",
      async run(page) {
        const input = page.locator(".ga-top-search input, .gh-topbar-search input, input[placeholder*='Search assets']").first();
        await input.waitFor({ state: "visible", timeout: 10_000 });
        await input.fill("net revenue");
        await input.press("Enter");
        const pathAfterKeyboardSearch = await waitForPath(page, /\/discover/i);
        await page.waitForSelector(".gh-discovery-workspace,.gh-discovery-main-grid", { timeout: 15_000 });
        const keyboardState = await getBodyState(page, { revenueDaily: /revenue_daily|Net Revenue/i });
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-command-center-prototype,.gh-workspace", { timeout: 20_000 });
        const mouseInput = page.locator(".ga-top-search input, .gh-topbar-search input, input[placeholder*='Search assets']").first();
        await mouseInput.fill("customer profile");
        await clickButton(page, /Submit global search/i, "Submit global search with mouse");
        const pathAfterMouseSearch = await waitForPath(page, /\/discover/i);
        await page.waitForSelector(".gh-discovery-workspace,.gh-discovery-main-grid", { timeout: 15_000 });
        const mouseState = await getBodyState(page, { customerProfile: /customer_profile|Customer Profile|customer/i });
        return { pathAfterKeyboardSearch, keyboardState, pathAfterMouseSearch, mouseState };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            /\/discover/i.test(runResult?.pathAfterKeyboardSearch || "") &&
            runResult?.keyboardState?.checks?.revenueDaily &&
            /\/discover/i.test(runResult?.pathAfterMouseSearch || "") &&
            runResult?.mouseState?.checks?.customerProfile
          ),
          runResult,
        };
      },
    },
    {
      key: "shared-shell-chrome",
      description: "Exercise workspace breadcrumb, notifications, help, and profile menu controls.",
      async run(page) {
        await clickButton(page, /Open Governance Atlas Command Center/i, "Workspace breadcrumb to Command Center");
        const pathAfterBreadcrumb = await waitForPath(page, /\/home|\/command-center/i);
        await clickButton(page, /Notifications/i, "Open notifications inbox");
        const pathAfterNotifications = await waitForPath(page, /\/inbox/i);
        const inboxState = await getBodyState(page, { inbox: /Inbox|workflow notifications|No notifications/i });
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-command-center-prototype,.gh-workspace", { timeout: 20_000 });
        await clickButton(page, /^Help$/i, "Open help");
        const pathAfterHelp = await waitForPath(page, /\/help/i);
        const helpState = await getBodyState(page, { help: /How Governance Atlas works|Getting help/i });
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-command-center-prototype,.gh-workspace", { timeout: 20_000 });
        await clickButton(page, /Open profile menu/i, "Open profile menu");
        const profileState = await getProfileMenuState(page);
        return { pathAfterBreadcrumb, pathAfterNotifications, inboxState, pathAfterHelp, helpState, profileState };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            /\/home|\/command-center/i.test(runResult?.pathAfterBreadcrumb || "") &&
            /\/inbox/i.test(runResult?.pathAfterNotifications || "") &&
            runResult?.inboxState?.checks?.inbox &&
            /\/help/i.test(runResult?.pathAfterHelp || "") &&
            runResult?.helpState?.checks?.help &&
            runResult?.profileState?.checks?.settings &&
            runResult?.profileState?.checks?.avatar &&
            runResult?.profileState?.localAvatarState?.localOnly &&
            runResult?.profileState?.localAvatarState?.databricksProfileExcluded
          ),
          runResult,
        };
      },
    },
    {
      key: "shared-command-palette",
      description: "Open the global command palette, run a navigation command, verify empty-state search, and close it with Escape.",
      async run(page) {
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-command-center-prototype,.gh-workspace", { timeout: 20_000 });
        await page.keyboard.press("/");
        await page.waitForSelector("[role='dialog'][aria-label='Command palette']", { state: "visible", timeout: 10_000 });
        const input = page.getByLabel("Command palette search");
        const opened = await getBodyState(page, { palette: /Jump to|Command palette|Command Center|Discover/i });
        await input.fill("Lineage");
        await page.keyboard.press("Enter");
        const pathAfterNavigation = await waitForPath(page, /\/lineage/i);
        await page.waitForSelector(".ga-lineage-explorer,.gh-workspace", { timeout: 20_000 });
        await page.goto(urlFor("/command-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-command-center-prototype,.gh-workspace", { timeout: 20_000 });
        await page.keyboard.press("/");
        await page.waitForSelector("[role='dialog'][aria-label='Command palette']", { state: "visible", timeout: 10_000 });
        const emptyInput = page.getByLabel("Command palette search");
        await emptyInput.fill("zz-no-command-match");
        const emptyState = await getBodyState(page, { empty: /No commands match/i });
        await page.keyboard.press("Escape");
        const closed = await page.locator("[role='dialog'][aria-label='Command palette']").first().isVisible().then((visible) => !visible).catch(() => true);
        return { opened, pathAfterNavigation, emptyState, closed };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.opened?.checks?.palette &&
            /\/lineage/i.test(runResult?.pathAfterNavigation || "") &&
            runResult?.emptyState?.checks?.empty &&
            runResult?.closed
          ),
          runResult,
        };
      },
    },
    {
      key: "global-navigation-routes",
      description: "Exercise global navigation from the shell across every North Star prototype page.",
      async run(page) {
        const navTargets = [
          { label: /Discover/i, path: /\/discover/i, text: /Find trusted, governed data|Discovery/i },
          { label: /Stewardship/i, path: /\/stewardship|\/governance/i, text: /Stewardship Workbench|open work items|Work queue/i },
          { label: /Glossary & CDEs/i, path: /\/glossary-cdes|\/taxonomy/i, text: /Shared business meaning|Glossary|CDE Registry/i },
          { label: /Lineage Atlas/i, path: /\/lineage/i, text: /Lineage Atlas|Run impact analysis|Preview impact/i },
          { label: /Audit Evidence/i, path: /\/audit-evidence|\/audit/i, text: /Immutable governance event log|Audit Evidence/i },
          { label: /Control Center/i, path: /\/control-center|\/admin/i, text: /Atlas runtime, integrations, and policy|Control Center/i },
          { label: /Command Center/i, path: /\/command-center|\/home/i, text: /Governance posture, at a glance/i },
        ];
        const results = [];
        for (const target of navTargets) {
          await clickButton(page, target.label, `Global navigation to ${target.label}`);
          const pathAfterClick = await waitForPath(page, target.path, 20_000);
          await page.waitForFunction(
            (patternSource) => new RegExp(patternSource, "i").test(document.body?.innerText || ""),
            target.text.source,
            { timeout: 20_000 },
          );
          const state = await getBodyState(page, { destination: target.text });
          results.push({ label: String(target.label), pathAfterClick, state });
        }
        return { results };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.results?.length === 7 &&
            runResult.results.every((item) => item.state?.checks?.destination)
          ),
          runResult,
        };
      },
    },
  ],
  discover: [
    {
      key: "topbar-search-preload",
      description: "Route a typed topbar search into Discover and verify the Discover search box preloads the query.",
      async run(page) {
        const input = page.locator(".gh-topbar-search input, input[placeholder*='Search assets']").first();
        await input.waitFor({ state: "visible", timeout: 10_000 });
        await input.fill("customer");
        await input.press("Enter");
        await page.waitForFunction(
          () => window.location.pathname === "/discovery" && new URLSearchParams(window.location.search).get("q") === "customer",
          undefined,
          { timeout: 10_000 },
        );
        const searchUrl = new URL(page.url());
        const pathAfterSearch = `${searchUrl.pathname}${searchUrl.search}`;
        const discoverySearch = page.getByLabel("Search discovery assets").first();
        await discoverySearch.waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForFunction(() => {
          const field = document.querySelector("input[aria-label='Search discovery assets']");
          return field && field.value === "customer";
        }, undefined, { timeout: 10_000 });
        return {
          pathAfterSearch,
          discoverInputValue: await discoverySearch.inputValue(),
          state: await getBodyState(page, { customerResult: /customer_profile|Active Customer|customer/i }),
        };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            /\/discovery\?q=customer/i.test(runResult?.pathAfterSearch || "") &&
            runResult?.discoverInputValue === "customer" &&
            runResult?.state?.checks?.customerResult
          ),
          runResult,
        };
      },
    },
    {
      key: "selected",
      description: "Select the first Discover result and show the asset preview pane.",
      async run(page) {
        const row = page.locator(".gh-discovery-table-row.gh-discovery-asset-card").first();
        await row.waitFor({ state: "visible", timeout: 20_000 });
        await row.click();
        await page.waitForSelector(
          '.gh-discovery-main-grid[data-preview-open="true"] > .gh-selection-preview',
          { state: "visible", timeout: 20_000 },
        );
      },
      async validate(page) {
        return page.evaluate(() => {
          const grid = document.querySelector(".gh-discovery-main-grid");
          const preview = document.querySelector(".gh-discovery-main-grid[data-preview-open='true'] > .gh-selection-preview");
          const selected = document.querySelector(".gh-discovery-table-row.gh-discovery-asset-card.is-selected");
          const controls = Array.from(document.querySelectorAll(".gh-selection-preview button,.gh-selection-preview a"))
            .map((node) => ({
              text: (node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
              disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
            }))
            .filter((item) => item.text);
          const previewText = (preview?.textContent || "").replace(/\s+/g, " ").trim();
          const nonAuthoritativeNotice = /not live Databricks proof|not live Databricks evidence|Prototype mock/i.test(previewText);
          const livePreviewOverclaim = /assembled from live Discover and Asset 360 fields/i.test(previewText);
          return {
            loaded: Boolean(
              grid?.getAttribute("data-preview-open") === "true" &&
              preview &&
              selected &&
              nonAuthoritativeNotice &&
              !livePreviewOverclaim
            ),
            previewOpen: grid?.getAttribute("data-preview-open") === "true",
            previewVisible: Boolean(preview),
            selectedAssetFqn: selected?.getAttribute("data-asset-fqn") || "",
            previewText: previewText.slice(0, 1000),
            nonAuthoritativeNotice,
            livePreviewOverclaim,
            controls,
          };
        });
      },
    },
    {
      key: "degraded-results",
      description: "Capture the Discover degraded-results state while preserving result-row metric structure.",
      async run(page) {
        mockApiFlags.discoveryDegraded = true;
        mockApiFlags.previewDegraded = false;
        await page.goto(urlFor("/discover?ga_degraded=1"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-discovery-degraded-prototype", { state: "visible", timeout: 20_000 });
        await page.waitForFunction(
          () => /Discovery Unavailable|Discovery backend timed out|Trust unavailable|Lineage unavailable/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
      },
      async validate(page) {
        return page.evaluate(() => {
          const shell = document.querySelector(".gh-discovery-degraded-prototype");
          const row = document.querySelector(".gh-discovery-degraded-row");
          const text = (shell?.textContent || "").replace(/\s+/g, " ").trim();
          const controls = Array.from(document.querySelectorAll(".gh-discovery-degraded-prototype button"))
            .map((node) => ({
              text: (node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
              disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
            }))
            .filter((item) => item.text);
          return {
            loaded: Boolean(
              shell &&
              row &&
              /Discovery unavailable/i.test(text) &&
              /Owner unavailable/i.test(text) &&
              /Freshness unavailable/i.test(text) &&
              /Usage unavailable/i.test(text) &&
              /Lineage unavailable/i.test(text) &&
              /Rows unavailable/i.test(text)
            ),
            text: text.slice(0, 1000),
            controls,
          };
        });
      },
    },
    {
      key: "degraded-selected",
      description: "Capture selected-asset preview with degraded live refresh while preserving drawer tabs, metrics, and actions.",
      async run(page) {
        mockApiFlags.discoveryDegraded = false;
        mockApiFlags.previewDegraded = true;
        await page.goto(urlFor("/discover?ga_preview_degraded=1"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-discovery-table-row.gh-discovery-asset-card", { state: "visible", timeout: 20_000 });
        const row = page.locator(".gh-discovery-table-row.gh-discovery-asset-card").first();
        await row.click();
        await page.waitForSelector(".gh-selection-preview", { state: "visible", timeout: 20_000 });
        await page.waitForFunction(
          () => /Preview degraded|Live preview refresh stalled|Overview|Columns|Lineage|Quality|Access|Comment|Request access/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
      },
      async validate(page) {
        return page.evaluate(() => {
          const grid = document.querySelector(".gh-discovery-main-grid");
          const preview = document.querySelector(".gh-discovery-main-grid[data-preview-open='true'] > .gh-selection-preview");
          const text = (preview?.textContent || "").replace(/\s+/g, " ").trim();
          const metricCount = preview?.querySelectorAll(".gh-discovery-preview-metric").length || 0;
          const tabCount = preview?.querySelectorAll(".gh-discovery-preview-tabs [role='tab']").length || 0;
          const footer = preview?.querySelector(".gh-discovery-preview-footer");
          const footerRect = footer?.getBoundingClientRect?.();
          return {
            loaded: Boolean(
              grid?.getAttribute("data-preview-open") === "true" &&
              preview &&
              /Preview degraded|Live preview refresh stalled/i.test(text) &&
              /Overview/i.test(text) &&
              /Columns/i.test(text) &&
              /Lineage/i.test(text) &&
              /Quality/i.test(text) &&
              /Access/i.test(text) &&
              /Comment/i.test(text) &&
              /Request access/i.test(text) &&
              metricCount >= 4 &&
              tabCount >= 5 &&
              footerRect &&
              footerRect.width > 0 &&
              footerRect.height > 0
            ),
            text: text.slice(0, 1000),
            metricCount,
            tabCount,
            footerVisible: Boolean(footerRect && footerRect.width > 0 && footerRect.height > 0),
          };
        });
      },
    },
    {
      key: "filters-layout",
      description: "Exercise Discover search valid, invalid, empty, loading, facets, clear filters, and view controls.",
      async run(page) {
        let search = page.getByLabel("Search discovery assets").first();
        await search.waitFor({ state: "visible", timeout: 10_000 });
        await search.fill("customer");
        await search.press("Enter");
        await page.waitForFunction(() => /customer_profile|churn_propensity/i.test(document.body?.innerText || ""), undefined, { timeout: 10_000 });
        const validSearch = await textChecks(page, { customerProfile: /customer_profile/i, filtered: /Filtered by customer|customer/i });

        search = page.getByLabel("Search discovery assets").first();
        await search.fill("name:(");
        await search.press("Enter");
        await page.waitForFunction(() => /Invalid discovery query|Invalid Search/i.test(document.body?.innerText || ""), undefined, { timeout: 10_000 });
        const invalidSearch = await textChecks(page, { invalid: /Invalid discovery query|Invalid Search/i });
        await clickButton(page, /Clear search/i, "Discover clear invalid search");

        search = page.getByLabel("Search discovery assets").first();
        await search.fill("zzzz-no-results");
        await search.press("Enter");
        await page.waitForFunction(() => /No matching assets|No assets matched|No visible assets/i.test(document.body?.innerText || ""), undefined, { timeout: 10_000 });
        const emptySearch = await textChecks(page, { empty: /No matching assets|No assets matched|No visible assets/i });
        await clickButton(page, /Clear search/i, "Discover clear empty search");

        search = page.getByLabel("Search discovery assets").first();
        const slowResponse = page.waitForResponse((response) => /\/api\/discovery\/search/i.test(response.url()) && /query=slow/i.test(response.url()), { timeout: 10_000 }).catch(() => null);
        await search.fill("slow");
        await search.press("Enter");
        const loadingShown = await page.waitForFunction(
          () => /Loading discovery results|Refreshing discovery results/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 2_500 },
        ).then(() => true).catch(() => false);
        await slowResponse;
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        await clickButton(page, /Clear search/i, "Discover clear slow search");

        const beforeFilters = await discoverFilterState(page);
        const rail = page.locator(".gh-discovery-prototype-filter-rail").first();
        const certified = await clickVisible(rail.getByRole("button", { name: /Certified/i }).first(), "Discover certification facet");
        await page.waitForFunction(() => /Certified/i.test(document.body?.innerText || ""), undefined, { timeout: 8_000 });
        const afterCertified = await discoverFilterState(page);
        const customer = await clickVisible(rail.getByRole("button", { name: /Customer/i }).first(), "Discover domain facet");
        const afterCustomer = await discoverFilterState(page);
        const restricted = await clickVisible(rail.getByRole("button", { name: /Restricted/i }).first(), "Discover classification facet");
        const afterRestricted = await discoverFilterState(page);
        const cde = await clickVisible(rail.getByRole("button", { name: /Critical Data Element/i }).first(), "Discover CDE attribute filter");
        const afterCde = await discoverFilterState(page);
        const filteredState = await textChecks(page, { filtered: /Certified|Customer|Restricted|tag:CDE/i });

        await clickButton(page, /Reset browse/i, "Discover reset filters");
        await page.waitForFunction(() => !/tag:CDE|Filtered by tag:CDE/i.test(document.body?.innerText || ""), undefined, { timeout: 10_000 }).catch(() => {});
        const afterReset = await discoverFilterState(page);
        await clickButton(page, /Advanced/i, "Discover advanced filters");
        await page.waitForSelector(".gh-discovery-advanced-filters", { state: "visible", timeout: 10_000 }).catch(() => {});
        const advancedVisible = await page.locator(".gh-discovery-advanced-filters,.gh-discovery-filter-shell").first().isVisible().catch(() => false);
        const advancedBuilder = page.locator(".gh-query-builder").first();
        await advancedBuilder.getByLabel(/Query builder field/i).selectOption("domain").catch(() => {});
        await advancedBuilder.getByLabel(/Query builder match mode/i).selectOption("any").catch(() => {});
        await advancedBuilder.getByLabel(/Query builder value/i).fill("Finance, Customer").catch(() => {});
        const structuredInsert = await clickVisible(
          advancedBuilder.getByRole("button", { name: /Insert into search/i }).first(),
          "Discover insert grouped AND/OR query",
        );
        const structuredQueryValue = await page.getByLabel("Search discovery assets").first().inputValue().catch(() => "");
        const deletedUnavailable = await controlSnapshot(page.getByRole("button", { name: /Deleted assets unavailable/i }).first());
        const inaccessibleHidden = await controlSnapshot(page.getByRole("button", { name: /Inaccessible hidden/i }).first());
        await clickVisible(
          page.locator(".gh-filters-popover").getByRole("button", { name: /^Close$/i }).first(),
          "Discover close advanced filters",
        );
        await clickButton(page, /Reset browse/i, "Discover reset grouped query");
        await clickButton(page, /List view/i, "Discover list view");
        const afterListView = await pressedGroupSnapshot(page, [["grid", /Grid view/i], ["list", /List view/i]]);
        await clickButton(page, /Grid view/i, "Discover grid view");
        const afterGridView = await pressedGroupSnapshot(page, [["grid", /Grid view/i], ["list", /List view/i]]);
        await clickButton(page, /Saved searches/i, "Discover saved searches");
        await page.getByRole("dialog", { name: /Saved searches/i }).waitFor({ state: "visible", timeout: 10_000 });
        const savedSearchDialog = true;
        const savedSearchCreate = await controlSnapshot(page.getByRole("button", { name: /Create saved search unavailable/i }).first()).catch(() => null);
        const savedSearchManage = await controlSnapshot(page.getByRole("button", { name: /Manage saved searches unavailable/i }).first()).catch(() => null);
        await clickButton(page, /Revenue CDEs/i, "Discover saved search option");
        const afterSavedSearch = await discoverFilterState(page);
        return {
          validSearch,
          invalidSearch,
          emptySearch,
          loadingShown,
          beforeFilters,
          certified,
          afterCertified,
          customer,
          afterCustomer,
          restricted,
          afterRestricted,
          cde,
          afterCde,
          afterReset,
          filteredState,
          advancedVisible,
          structuredInsert,
          structuredQueryValue,
          deletedUnavailable,
          inaccessibleHidden,
          listView: afterListView.snapshots.list,
          gridView: afterGridView.snapshots.grid,
          layoutModeSnapshots: {
            afterListView,
            afterGridView,
          },
          savedSearchDialog,
          savedSearchCreate,
          savedSearchManage,
          afterSavedSearch,
          state: await getBodyState(page, {
            results: /results/i,
            savedQuery: /tag:CDE|certification:Certified|Revenue/i,
          }),
        };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { discoverTitle: /Find trusted, governed data|Discover/i });
        return {
          loaded: Boolean(
            checks.discoverTitle &&
            runResult?.validSearch?.customerProfile &&
            runResult?.invalidSearch?.invalid &&
            runResult?.emptySearch?.empty &&
            runResult?.loadingShown &&
            runResult?.certified?.ariaPressed === "false" &&
            runResult?.afterCertified?.activeButtons?.some((item) => /Certified/i.test(item)) &&
            runResult?.customer?.ariaPressed === "false" &&
            runResult?.afterCustomer?.activeButtons?.some((item) => /Customer/i.test(item)) &&
            runResult?.restricted?.ariaPressed === "false" &&
            runResult?.afterRestricted?.activeButtons?.some((item) => /Restricted/i.test(item)) &&
            (/tag:CDE/i.test(runResult?.afterCde?.searchValue || "") ||
              runResult?.afterCde?.activeButtons?.some((item) => /Critical Data Element/i.test(item))) &&
            runResult?.afterReset?.activeButtons?.length === 0 &&
            runResult?.afterReset?.searchValue === "" &&
            runResult?.savedSearchDialog &&
            runResult?.afterSavedSearch?.hasSavedQuery &&
            runResult?.savedSearchCreate?.disabled &&
            runResult?.savedSearchManage?.disabled &&
            runResult?.filteredState?.filtered &&
            JSON.stringify(runResult?.layoutModeSnapshots?.afterListView?.activeKeys || []) === JSON.stringify(["list"]) &&
            JSON.stringify(runResult?.layoutModeSnapshots?.afterGridView?.activeKeys || []) === JSON.stringify(["grid"])
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "sort-and-row-actions",
      description: "Exercise Discover sort, local favorite, and result-row action menu behavior.",
      async run(page) {
        await page.evaluate(() => window.localStorage?.removeItem?.("gh-favorite-assets"));
        await page.goto(urlFor("/discover"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-discovery-main-grid", { timeout: 20_000 });
        const firstBefore = await firstDiscoverResultFqn(page);
        await page.locator(".gh-discovery-sort-trigger").first().click();
        await clickVisible(page.getByRole("option", { name: /Name \(A-Z\)/i }).first(), "Discover sort by name");
        await page.waitForFunction(() => {
          const first = document.querySelector(".gh-discovery-table-row.gh-discovery-asset-card");
          return /attribution_daily/i.test(first?.textContent || "");
        }, undefined, { timeout: 10_000 });
        const firstAfterName = await firstDiscoverResultFqn(page);
        const sortControl = await controlSnapshot(page.locator(".gh-discovery-sort-trigger").first());
        await openFirstDiscoverRowActions(page, "Discover row actions");
        const favorite = await clickVisible(page.getByRole("menuitem", { name: /Add to favorites|Remove from favorites/i }).first(), "Discover local favorite from row menu", { skipScroll: true });
        await page.waitForFunction(() => /local browser favorite/i.test(document.body?.innerText || ""), undefined, { timeout: 8_000 });
        await openFirstDiscoverRowActions(page, "Reopen Discover row actions");
        const favoriteAfter = await controlSnapshot(page.getByRole("menuitem", { name: /Remove from favorites|Add to favorites/i }).first());
        const menuState = await textChecks(page, { viewDetails: /View details/i, governance: /Open governance/i, lineage: /Open lineage/i });
        return { firstBefore, firstAfterName, sortControl, favorite, favoriteAfter, menuState };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            runResult?.firstBefore &&
            runResult?.firstAfterName &&
            /attribution_daily/i.test(runResult.firstAfterName) &&
            /Name \(A-Z\)/i.test(runResult?.sortControl?.text || "") &&
            /Add to favorites|Remove from favorites/i.test(runResult?.favorite?.text || "") &&
            /Add to favorites|Remove from favorites/i.test(runResult?.favoriteAfter?.text || "") &&
            runResult.favorite.text !== runResult.favoriteAfter.text &&
            runResult?.menuState?.viewDetails &&
            runResult?.menuState?.governance &&
            runResult?.menuState?.lineage
          ),
          runResult,
        };
      },
    },
    {
      key: "row-menu-routing",
      description: "Click every Discover row action menu routing item and verify each destination.",
      async run(page) {
        await openFirstDiscoverRowActions(page, "Discover row actions for View details");
        const viewDetails = await clickVisible(page.getByRole("menuitem", { name: /View details/i }).first(), "Discover row menu View details", { skipScroll: true });
        const pathAfterViewDetails = await waitForPath(page, /\/entity\//i, 15_000);
        await page.goto(urlFor("/discover"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-discovery-main-grid", { timeout: 20_000 });

        await openFirstDiscoverRowActions(page, "Discover row actions for Open governance");
        const openGovernance = await clickVisible(page.getByRole("menuitem", { name: /Open governance/i }).first(), "Discover row menu Open governance", { skipScroll: true });
        const pathAfterGovernance = await waitForPath(page, /\/stewardship|\/governance/i, 15_000);
        await page.goto(urlFor("/discover"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-discovery-main-grid", { timeout: 20_000 });

        await openFirstDiscoverRowActions(page, "Discover row actions for Open lineage");
        const openLineage = await clickVisible(page.getByRole("menuitem", { name: /Open lineage/i }).first(), "Discover row menu Open lineage", { skipScroll: true });
        const pathAfterLineage = await waitForPath(page, /\/lineage/i, 15_000);
        return { viewDetails, openGovernance, openLineage, pathAfterViewDetails, pathAfterGovernance, pathAfterLineage };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            !runResult?.viewDetails?.disabled &&
            !runResult?.openGovernance?.disabled &&
            !runResult?.openLineage?.disabled &&
            /\/entity\//i.test(runResult?.pathAfterViewDetails || "") &&
            /\/stewardship|\/governance/i.test(runResult?.pathAfterGovernance || "") &&
            /\/lineage/i.test(runResult?.pathAfterLineage || "")
          ),
          runResult,
        };
      },
    },
    {
      key: "preview-actions",
      description: "Exercise Discover selected-preview tabs, disabled workflow actions, and sticky footer visibility.",
      async run(page) {
        const row = page.locator(".gh-discovery-table-row.gh-discovery-asset-card").first();
        await row.waitFor({ state: "visible", timeout: 20_000 });
        await row.click();
        await page.waitForSelector(".gh-selection-preview", { state: "visible", timeout: 15_000 });
        await page.waitForURL((url) => Boolean(url.searchParams.get("preview")), { timeout: 8_000 }).catch(() => {});
        const preview = page.locator(".gh-selection-preview").first();
        const tabStates = {};
        for (const name of ["Columns", "Lineage", "Quality", "Access", "Overview"]) {
          await clickVisible(preview.getByRole("tab", { name: new RegExp(`^${name}`, "i") }).first(), `Discover preview ${name} tab`, { skipScroll: true });
          tabStates[name.toLowerCase()] = await textChecks(page, {
            panel: new RegExp(name === "Columns" ? "Columns|Key Columns" : name === "Access" ? "Access & Stewardship" : name, "i"),
          });
        }
        const comment = await controlSnapshot(preview.getByRole("button", { name: /^Comment$/i }).first());
        const requestAccess = await controlSnapshot(preview.getByRole("button", { name: /^Request access$/i }).first());
        const workflowNote = await textChecks(page, { workflowDisabled: /Comment and access-request creation are disabled/i });
        const stickyFooter = await page.evaluate(() => {
          const footer = document.querySelector(".gh-discovery-preview-footer");
          if (!(footer instanceof HTMLElement)) return null;
          const rect = footer.getBoundingClientRect();
          return {
            visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight + 2,
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
          };
        });
        await clickVisible(preview.getByRole("button", { name: /Close preview/i }).first(), "Discover preview close", { force: true, skipScroll: true });
        await page.waitForFunction(
          () => document.querySelector(".gh-discovery-main-grid")?.getAttribute("data-preview-open") !== "true",
          undefined,
          { timeout: 8_000 },
        ).catch(() => {});
        const previewClosed = await page.locator(".gh-selection-preview").first().isVisible().then((visible) => !visible).catch(() => true);
        return { tabStates, comment, requestAccess, workflowNote, stickyFooter, previewClosed };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            runResult?.tabStates?.columns?.panel &&
            runResult?.tabStates?.lineage?.panel &&
            runResult?.tabStates?.quality?.panel &&
            runResult?.tabStates?.access?.panel &&
            runResult?.comment?.disabled &&
            runResult?.requestAccess?.disabled &&
            runResult?.workflowNote?.workflowDisabled &&
            runResult?.stickyFooter?.visible &&
            runResult?.previewClosed
          ),
          runResult,
        };
      },
    },
    {
      key: "preview-asset-routing",
      description: "Certification review routes from the Discover selected preview; asset and lineage routing are exercised from result-row actions.",
      async run(page) {
        const row = page.locator(".gh-discovery-table-row.gh-discovery-asset-card").first();
        await row.waitFor({ state: "visible", timeout: 20_000 });
        await row.click();
        await page.waitForSelector(".gh-selection-preview", { state: "visible", timeout: 15_000 });
        await clickVisible(
          page.locator(".gh-selection-preview .gh-discovery-preview-footer").getByRole("button", { name: /^(Certify|Review cert)$/i }).first(),
          "Discover preview footer certification review",
        );
        const pathAfterCertify = await waitForPath(page, /\/stewardship|\/governance/i);
        return { pathAfterCertify };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(/\/stewardship|\/governance/i.test(runResult?.pathAfterCertify || "")),
          runResult,
        };
      },
    },
    {
      key: "atlas-ai-recommendations",
      description: "Run Discover Atlas AI recommendations and route recommendation evidence into the selected preview.",
      async run(page) {
        const aiButton = page.locator(".gh-discovery-ai-card").getByRole("button", { name: /Run Atlas AI recommendations/i }).first();
        await aiButton.waitFor({ state: "visible", timeout: 15_000 });
        const aiButtonBefore = await controlSnapshot(aiButton);
        await page.evaluate(() => {
          Object.keys(window.sessionStorage || {})
            .filter((key) => key.startsWith("governance-atlas.discovery-ai."))
            .forEach((key) => window.sessionStorage.removeItem(key));
        });
        const aiResponsePromise = page.waitForResponse((response) => /\/api\/atlas-ai\/recommendations/i.test(response.url()), { timeout: 8_000 }).catch(() => null);
        await clickVisible(aiButton, "Run Discover Atlas AI recommendations");
        const aiResponse = await aiResponsePromise;
        const recommendationsVisible = await page.waitForFunction(() => /Review revenue_daily recertification|Inspect customer_profile PII coverage/i.test(document.body?.innerText || ""), undefined, { timeout: 12_000 }).then(() => true).catch(() => false);
        const recommendations = await textChecks(page, { recommendation: /Review revenue_daily recertification|Inspect customer_profile/i });
        if (recommendationsVisible) {
          await clickButton(page, /Review revenue_daily recertification/i, "Open Discover AI recommendation evidence");
          await page.waitForSelector(".gh-selection-preview", { state: "visible", timeout: 10_000 });
        }
        const selected = await textChecks(page, { selectedPreview: /revenue_daily|Metadata Coverage|Open Asset 360/i });
        await clickVisible(
          page.locator(".gh-shell-topbar .ga-ai-chip.is-primary").filter({ hasText: /Atlas AI/i }).first(),
          "Open Discover floating Atlas AI from topbar"
        );
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("Which certified assets are most important?");
        await clickVisible(page.locator(".gh-floating-ai-input button").first(), "Submit Discover floating Atlas AI prompt");
        await page.waitForFunction(() => /Prototype mock Discover evidence|trust score|customer_360\.gold\.customer_profile|finance_prod\.curated\.revenue_daily/i.test(document.body?.innerText || ""), undefined, { timeout: 20_000 });
        const floating = await getBodyState(page, {
          answer: /Prototype mock Discover evidence|trust score|finance_prod\.curated\.revenue_daily/i,
          evidence: /customer_360\.gold\.customer_profile|finance_prod\.curated\.revenue_daily/i,
        });
        return {
          aiButtonBefore,
          aiResponse: aiResponse ? { url: aiResponse.url(), status: aiResponse.status() } : null,
          recommendationsVisible,
          recommendations,
          selected,
          floating,
        };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            runResult?.recommendationsVisible &&
            runResult?.recommendations?.recommendation &&
            runResult?.selected?.selectedPreview &&
            runResult?.floating?.checks?.answer &&
            runResult?.floating?.checks?.evidence
          ),
          runResult,
        };
      },
    },
  ],
  stewardship: [
    {
      key: "workbench-controls",
      description: "Exercise Stewardship filters, queue pills, prototype-safe action messages, and degraded create/assign flows.",
      async run(page) {
        await clickButton(page, /^Filter$/i, "Stewardship filter");
        const filterPanel = await textChecks(page, { filterPanel: /Filter work queue/i });
        await clickButton(page, /P1 critical/i, "Stewardship P1 queue");
        const p1 = await controlSnapshot(buttonByName(page, /P1 critical/i));
        await clickButton(page, /Overdue/i, "Stewardship overdue queue");
        const overdue = await controlSnapshot(buttonByName(page, /Overdue/i));
        await clickButton(page, /Assigned to me/i, "Stewardship assigned to me queue");
        const assigned = await controlSnapshot(buttonByName(page, /Assigned to me/i));
        await clickButton(page, /^All\b/i, "Stewardship all queue");
        const firstWorkItem = page.locator("button.gh-governance-ns-table-row").first();
        await firstWorkItem.waitFor({ state: "visible", timeout: 15_000 });
        await firstWorkItem.click();
        await clickButton(page, /^Bulk assign$/i, "Stewardship bulk assign");
        const bulkPanel = await textChecks(page, { bulkUnavailable: /Bulk assignment requires a backed workflow|Submit assignment unavailable/i });
        await clickButton(page, /^Dismiss$/i, "Dismiss bulk assign panel");
        await clickButton(page, /^New work item$/i, "Stewardship new work item");
        const newItemPanel = await textChecks(page, { newUnavailable: /New work item creation is unavailable|Create work item unavailable/i });
        await clickButton(page, /^Dismiss$/i, "Dismiss new work item panel");
        await clickButton(page, /Assign owner from suggested teams/i, "Stewardship suggested action");
        const suggestedPanel = await textChecks(page, { suggestedUnavailable: /Run suggested action unavailable/i });
        await clickButton(page, /^Dismiss$/i, "Dismiss suggested action panel");
        await clickButton(page, /Archive sandbox cleanup/i, "Stewardship archive suggested action");
        const archivePanel = await textChecks(page, { archiveUnavailable: /Run suggested action unavailable|Archive sandbox cleanup/i });
        await clickButton(page, /^Dismiss$/i, "Dismiss archive suggested action panel");
        const nextPage = await controlSnapshot(page.getByRole("button", { name: /Next page/i }).first()).catch(() => ({
          hidden: true,
          disabled: true,
          title: "Single-page queue hides pagination to match the Stewardship reference.",
        }));
        const comment = await controlSnapshot(buttonByName(page, /^Comment$/i));
        const resolve = await controlSnapshot(buttonByName(page, /^Resolve$/i));
        return {
          filterPanel,
          p1,
          overdue,
          assigned,
          bulkPanel,
          newItemPanel,
          suggestedPanel,
          archivePanel,
          nextPage,
          comment,
          resolve,
        };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { workbench: /open work items|Work queue/i });
        return {
          loaded: Boolean(
            checks.workbench &&
            runResult?.filterPanel?.filterPanel &&
            runResult?.bulkPanel?.bulkUnavailable &&
            runResult?.newItemPanel?.newUnavailable &&
            runResult?.suggestedPanel?.suggestedUnavailable &&
            runResult?.archivePanel?.archiveUnavailable &&
            (runResult?.nextPage?.hidden ||
              (runResult?.nextPage?.disabled && /All visible work items/i.test(runResult?.nextPage?.title || ""))) &&
            runResult?.comment?.disabled &&
            /Prototype work items|visual workflow evidence/i.test(runResult?.comment?.title || "") &&
            runResult?.resolve?.disabled &&
            /Prototype work items|visual workflow evidence/i.test(runResult?.resolve?.title || "")
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "asset-routing",
      description: "Open the affected asset from a Stewardship work item.",
      async run(page) {
        const affectedAsset = page.locator(".gh-governance-ns-affected").getByRole("button").first();
        await affectedAsset.waitFor({ state: "visible", timeout: 15_000 });
        const before = await clickVisible(affectedAsset, "Stewardship affected asset");
        const pathAfterClick = await waitForPath(page, /\/entity\//i);
        await page.waitForSelector(".gh-entity-workspace,.gh-entity-shell,.gh-asset360-shell", { timeout: 15_000 }).catch(() => {});
        return { before, pathAfterClick, state: await getBodyState(page, { asset: /pricing_experiment|Asset|Overview/i }) };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(/\/entity\//i.test(runResult?.pathAfterClick || "") && runResult?.state?.checks?.asset),
          runResult,
        };
      },
    },
    {
      key: "lineage-navigation",
      description: "Verify the non-reference Stewardship detail lineage link is not exposed.",
      async run(page) {
        const openLineageContextCount = await page.getByRole("button", { name: /Open lineage context/i }).count();
        return { openLineageContextCount };
      },
      async validate(page, runResult) {
        return {
          loaded: runResult?.openLineageContextCount === 0,
          runResult,
        };
      },
    },
    {
      key: "atlas-ai",
      description: "Submit a Stewardship-specific Atlas AI prompt and verify grounded evidence appears.",
      async run(page) {
        await clickButton(page, /Atlas AI/i, "Open Stewardship Atlas AI");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("Which stewardship work items need attention?");
        await clickVisible(page.locator(".gh-floating-ai-input button").first(), "Submit Stewardship Atlas AI prompt");
        await page.waitForFunction(() => /recertification item|SI-2482|finance_prod\.curated\.revenue_daily|evidence/i.test(document.body?.innerText || ""), undefined, { timeout: 20_000 });
        return await getBodyState(page, {
          answer: /recertification item|finance_prod\.curated\.revenue_daily/i,
          evidence: /SI-2482|evidence/i,
        });
      },
      async validate(page, runResult) {
        return { loaded: Boolean(runResult?.checks?.answer && runResult?.checks?.evidence), runResult };
      },
    },
  ],
  glossary: [
    {
      key: "glossary-controls",
      description: "Exercise Glossary term request, association browser, detail, and lineage navigation controls.",
      async run(page) {
        await clickButton(page, /\+ New term/i, "Glossary new term");
        const newTerm = await textChecks(page, { unavailable: /New term request is unavailable/i });
        const firstCard = page.locator(".gh-taxonomy-prototype-card").first();
        await firstCard.waitFor({ state: "visible", timeout: 15_000 });
        await clickVisible(firstCard.getByRole("button", { name: /\d+ (?:prototype )?assets/i }).first(), "Glossary associated assets");
        await page.waitForSelector(".gh-taxonomy-prototype-detail", { timeout: 10_000 }).catch(() => {});
        const detail = await textChecks(page, {
          associations: /Associated assets|finance_prod\.curated\.revenue_daily|Unity Catalog/i,
          reviewer: /Reviewer workflow|finance\.steward@entrada\.ai/i,
          version: /Version history|Definition approved/i,
          hierarchy: /Hierarchy|nested child terms/i,
        });
        const associationToggle = await controlSnapshot(buttonByName(page, /Hide associations|Browse all associations/i));
        await clickButton(page, /Show reviewer workflow note/i, "Glossary reviewer workflow note");
        const reviewerNotice = await textChecks(page, { reviewerUnavailable: /reviewer workflow is unavailable|no glossary mutation was submitted/i });
        await clickButton(page, /Close .* detail/i, "Glossary close detail");
        const detailClosed = await page.locator(".gh-taxonomy-prototype-detail").count().then((count) => count === 0);
        await clickVisible(firstCard.getByRole("button", { name: /Preview lineage/i }).first(), "Glossary Preview lineage");
        const pathAfterClick = await waitForPath(page, /\/lineage/i);
        return { newTerm, detail, associationToggle, reviewerNotice, detailClosed, pathAfterClick };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { lineage: /Lineage Atlas|lineage/i });
        return {
          loaded: Boolean(
            runResult?.newTerm?.unavailable &&
            runResult?.detail?.associations &&
            runResult?.detail?.reviewer &&
            runResult?.detail?.version &&
            runResult?.detail?.hierarchy &&
            !runResult?.associationToggle?.disabled &&
            runResult?.reviewerNotice?.reviewerUnavailable &&
            runResult?.detailClosed &&
            /\/lineage/i.test(runResult?.pathAfterClick || "") &&
            checks.lineage
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "global-shell",
      description: "Exercise global search, help, and profile controls from the Glossary route.",
      async run(page) {
        const input = page.locator(".ga-top-search input, .gh-topbar-search input, input[placeholder*='Search assets']").first();
        await input.waitFor({ state: "visible", timeout: 10_000 });
        await input.fill("net revenue");
        await input.press("Enter");
        const pathAfterSearch = await waitForPath(page, /\/discover/i);
        await page.waitForSelector(".gh-discovery-workspace,.gh-discovery-main-grid", { timeout: 15_000 });
        const searchState = await getBodyState(page, { result: /revenue_daily|Net Revenue|finance_prod/i });

        await page.goto(urlFor("/glossary-cdes"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-taxonomy-ns,.gh-taxonomy-workspace,.gh-workspace", { timeout: 20_000 });
        await clickButton(page, /^Help$/i, "Open help from Glossary");
        const pathAfterHelp = await waitForPath(page, /\/help/i);
        const helpState = await getBodyState(page, { help: /How Governance Atlas works|Getting help/i });

        await page.goto(urlFor("/glossary-cdes"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-taxonomy-ns,.gh-taxonomy-workspace,.gh-workspace", { timeout: 20_000 });
        await clickButton(page, /Open profile menu/i, "Open profile menu from Glossary");
        const profileState = await getProfileMenuState(page);
        return { pathAfterSearch, searchState, pathAfterHelp, helpState, profileState };
      },
      async validate(page, runResult) {
        return {
          loaded: Boolean(
            /\/discover/i.test(runResult?.pathAfterSearch || "") &&
            runResult?.searchState?.checks?.result &&
            /\/help/i.test(runResult?.pathAfterHelp || "") &&
            runResult?.helpState?.checks?.help &&
            runResult?.profileState?.checks?.settings &&
            runResult?.profileState?.checks?.avatar &&
            runResult?.profileState?.localAvatarState?.localOnly &&
            runResult?.profileState?.localAvatarState?.databricksProfileExcluded &&
            runResult?.profileState?.checks?.signOut
          ),
          runResult,
        };
      },
    },
    {
      key: "atlas-ai",
      description: "Submit a Glossary-specific Atlas AI prompt and verify grounded evidence appears.",
      async run(page) {
        await clickButton(page, /Atlas AI/i, "Open Glossary Atlas AI");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("Summarize glossary coverage for net revenue.");
        await clickVisible(page.locator(".gh-floating-ai-input button").first(), "Submit Glossary Atlas AI prompt");
        await page.waitForFunction(
          () => /Net Revenue|reviewer finance\.steward@entrada\.ai|version-history|glossary evidence/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        return await getBodyState(page, {
          answer: /Net Revenue|reviewer finance\.steward@entrada\.ai|version-history/i,
          evidence: /Net Revenue|finance_prod\.curated\.revenue_daily/i,
          disclaimer: /Atlas AI uses AI\. Review for accuracy\./i,
        });
      },
      async validate(page, runResult) {
        return { loaded: Boolean(runResult?.checks?.answer && runResult?.checks?.evidence && runResult?.checks?.disclaimer), runResult };
      },
    },
    {
      key: "responsive-card-controls",
      description: "Validate Glossary card action controls remain visible and inside cards at the active viewport.",
      async run(page) {
        const layout = await page.evaluate(() => {
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const cards = Array.from(document.querySelectorAll(".gh-taxonomy-prototype-card"));
          const visibleActions = [];
          const failures = [];
          const rectInfo = (node) => {
            const rect = node.getBoundingClientRect();
            return {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          };
          cards.forEach((card, cardIndex) => {
            const cardRect = card.getBoundingClientRect();
            Array.from(card.querySelectorAll("button")).forEach((button, actionIndex) => {
              const rect = button.getBoundingClientRect();
              const text = (button.textContent || button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
              const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== "hidden";
              const insideCard =
                rect.left >= cardRect.left - 1 &&
                rect.right <= cardRect.right + 1 &&
                rect.top >= cardRect.top - 1 &&
                rect.bottom <= cardRect.bottom + 1;
              const insideViewport = rect.left >= 0 && rect.right <= viewport.width && rect.top >= 0 && rect.bottom <= viewport.height;
              visibleActions.push({ cardIndex, actionIndex, text, visible, insideCard, insideViewport, rect: rectInfo(button) });
              if (!visible || !insideCard || !insideViewport) {
                failures.push({ cardIndex, actionIndex, text, visible, insideCard, insideViewport, rect: rectInfo(button), cardRect: rectInfo(card) });
              }
            });
          });
          return { viewport, cardCount: cards.length, visibleActions, failures };
        });
        return { layout };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(runResult?.layout?.cardCount > 0 && runResult?.layout?.visibleActions?.length > 0 && runResult?.layout?.failures?.length === 0),
          runResult,
        };
      },
    },
  ],
  "cde-registry": [
    {
      key: "cde-detail-state",
      description: "Capture the CDE Registry selected-row/detail state without leaving the route.",
      async run(page) {
        await clickVisible(page.getByRole("tab", { name: /CDE Registry/i }).first(), "CDE Registry tab");
        const firstRow = page.locator(".gh-taxonomy-prototype-cde-row").first();
        await firstRow.waitFor({ state: "visible", timeout: 15_000 });
        await firstRow.click();
        await page.waitForSelector(".gh-taxonomy-prototype-detail", { timeout: 10_000 });
        const detail = await textChecks(page, {
          sourceColumn: /Source-of-record column|Open source asset/i,
          ownerWorkflow: /Reviewer workflow|recertification mutations are unavailable/i,
          status: /Healthy|Recert Due/i,
        });
        const selectedRows = await page.locator(".gh-taxonomy-prototype-cde-row.is-selected").count();
        return { detail, selectedRows };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.detail?.sourceColumn &&
            runResult?.detail?.ownerWorkflow &&
            runResult?.detail?.status &&
            runResult?.selectedRows >= 1
          ),
          runResult,
        };
      },
    },
    {
      key: "cde-controls",
      description: "Exercise CDE Registry detail, owner/recertification unavailable workflows, and lineage navigation.",
      async run(page) {
        await clickVisible(page.getByRole("tab", { name: /CDE Registry/i }).first(), "CDE Registry tab");
        const firstRow = page.locator(".gh-taxonomy-prototype-cde-row").first();
        await firstRow.waitFor({ state: "visible", timeout: 15_000 });
        await firstRow.click();
        await page.waitForSelector(".gh-taxonomy-prototype-detail", { timeout: 10_000 }).catch(() => {});
        const detail = await textChecks(page, {
          sourceColumn: /Source-of-record|Source column|Open source asset/i,
          ownerWorkflow: /Reviewer workflow|recertification mutations are unavailable/i,
        });
        const recert = await controlSnapshot(buttonByName(page, /Request recertification unavailable/i));
        await clickButton(page, /Show owner workflow note/i, "CDE owner workflow note");
        const ownerNotice = await textChecks(page, { ownerUnavailable: /owner workflow is unavailable|no CDE owner mutation was submitted/i });
        await clickButton(page, /Show recertification note/i, "CDE recertification workflow note");
        const recertNotice = await textChecks(page, { recertUnavailable: /recertification workflow is unavailable|no CDE mutation was submitted/i });
        await clickButton(page, /Close .* detail/i, "CDE close detail");
        const detailClosed = await page.locator(".gh-taxonomy-prototype-detail").count().then((count) => count === 0);
        await firstRow.click();
        await page.waitForSelector(".gh-taxonomy-prototype-detail", { timeout: 10_000 }).catch(() => {});
        await clickButton(page, /Open lineage/i, "CDE detail Open lineage");
        const pathAfterClick = await waitForPath(page, /\/lineage/i);
        return { detail, recert, ownerNotice, recertNotice, detailClosed, pathAfterClick };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { lineage: /Lineage Atlas|lineage/i });
        return {
          loaded: Boolean(
            runResult?.detail?.sourceColumn &&
            runResult?.detail?.ownerWorkflow &&
            runResult?.recert?.disabled &&
            runResult?.ownerNotice?.ownerUnavailable &&
            runResult?.recertNotice?.recertUnavailable &&
            runResult?.detailClosed &&
            /\/lineage/i.test(runResult?.pathAfterClick || "") &&
            checks.lineage
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "cde-tab-request-no-extra-tools",
      description: "Exercise CDE-tab request semantics and verify non-reference filter/sort controls are absent from the first viewport.",
      async run(page) {
        await clickVisible(page.getByRole("tab", { name: /CDE Registry/i }).first(), "CDE Registry tab");
        await clickButton(page, /\+ New term/i, "CDE tab new term request semantics");
        const newRequest = await textChecks(page, { cdeRequest: /New CDE request is unavailable/i });
        const toolState = await page.evaluate(() => {
          const byLabel = (label) => Boolean(document.querySelector(`[aria-label="${label}"]`));
          return {
            searchVisible: byLabel("Search CDE registry"),
            filterVisible: byLabel("Filter CDE registry by status"),
            sortVisible: byLabel("Sort CDE registry"),
            provenanceVisible: /Status and recertification are prototype registry fixtures/i.test(document.body?.innerText || ""),
            rowCount: document.querySelectorAll(".gh-taxonomy-prototype-cde-row").length,
          };
        });
        return { newRequest, toolState };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.newRequest?.cdeRequest &&
            runResult?.toolState?.rowCount >= 1 &&
            runResult?.toolState?.provenanceVisible &&
            !runResult?.toolState?.searchVisible &&
            !runResult?.toolState?.filterVisible &&
            !runResult?.toolState?.sortVisible
          ),
          runResult,
        };
      },
    },
    {
      key: "atlas-ai",
      description: "Submit a CDE Registry-specific Atlas AI prompt and verify grounded evidence appears.",
      async run(page) {
        await clickVisible(page.getByRole("tab", { name: /CDE Registry/i }).first(), "CDE Registry tab");
        await clickButton(page, /Atlas AI/i, "Open CDE Registry Atlas AI");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("Which CDEs need recertification?");
        await clickVisible(page.locator(".gh-floating-ai-input button").first(), "Submit CDE Registry Atlas AI prompt");
        await page.waitForFunction(
          () => /Lifetime Value \(USD\)|Recert Due \(8d\)|CDE registry evidence/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        return await getBodyState(page, {
          answer: /Lifetime Value \(USD\)|Recert Due \(8d\)|CDE registry evidence/i,
          evidence: /Lifetime Value \(USD\)|Recert Due \(8d\)/i,
          disclaimer: /Atlas AI uses AI\. Review for accuracy\./i,
        });
      },
      async validate(page, runResult) {
        return { loaded: Boolean(runResult?.checks?.answer && runResult?.checks?.evidence && runResult?.checks?.disclaimer), runResult };
      },
    },
    {
      key: "responsive-table-controls",
      description: "Validate CDE rows and important cells remain visible or contained at the active viewport.",
      async run(page) {
        await clickVisible(page.getByRole("tab", { name: /CDE Registry/i }).first(), "CDE Registry tab");
        const layout = await page.evaluate(() => {
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const rows = Array.from(document.querySelectorAll(".gh-taxonomy-prototype-cde-row"));
          const table = document.querySelector(".gh-taxonomy-prototype-cde-table");
          const rectInfo = (node) => {
            const rect = node.getBoundingClientRect();
            return {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          };
          const removedToolCount = document.querySelectorAll(".gh-taxonomy-prototype-cde-tools input, .gh-taxonomy-prototype-cde-tools select").length;
          const rowCellFailures = rows.flatMap((row, rowIndex) => {
            const rowRect = row.getBoundingClientRect();
            return Array.from(row.children).map((cell, cellIndex) => {
              const rect = cell.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(cell).visibility !== "hidden";
              const insideRow = rect.left >= rowRect.left - 1 && rect.right <= rowRect.right + 1;
              return { rowIndex, cellIndex, visible, insideRow, rect: rectInfo(cell), rowRect: rectInfo(row) };
            }).filter((item) => !item.visible || !item.insideRow);
          });
          return {
            viewport,
            removedToolCount,
            rowCount: rows.length,
            tableScrollable: Boolean(table && table.scrollWidth >= table.clientWidth),
            rowCellFailures,
          };
        });
        return { layout };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.layout?.removedToolCount === 0 &&
            runResult?.layout?.rowCount > 0 &&
            runResult?.layout?.rowCellFailures?.length === 0
          ),
          runResult,
        };
      },
    },
  ],
  lineage: [
    {
      key: "lineage-controls",
      description: "Exercise visible Lineage impact, column, zoom, refocus, and time controls.",
      async run(page) {
        await clickButton(page, /Run impact analysis|Preview impact/i, "Lineage impact control");
        const impact = await textChecks(page, {
          impactStatus: /Impact analysis focused|no downstream evidence|Prototype impact preview focused|no backed impact job/i,
        });
        await clickButton(page, /Column lineage/i, "Lineage column mode");
        const column = await textChecks(page, { columnStatus: /Column lineage view active|Column lineage is not observed/i });
        const columnModeClass = await page.locator(".ga-lineage-graph-bands.is-column-mode").first().isVisible().catch(() => false);
        const columnPanelFocused = await page.locator(".ga-lineage-bottom-card.is-focused", { hasText: /Column lineage/i }).first().isVisible().catch(() => false);
        const columnPanelProof = await textChecks(page, { proofOnly: /From system\.access\.column_lineage|column paths visible|No column-lineage rows returned/i });
        const hiddenAuthoritativeToolbar = await page.evaluate(() => {
          const visibleText = (node) => {
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
              ? String(node.textContent || "").trim()
              : "";
          };
          const labels = Array.from(document.querySelectorAll("button")).map(visibleText).filter(Boolean);
          const graphToolbarVisible = Boolean(document.querySelector(".ga-lineage-graph-toolbar")?.getBoundingClientRect().width);
          return {
            compareAbsent: !labels.includes("Compare versions"),
            tableAbsent: !labels.includes("Table lineage"),
            searchAbsent: !labels.includes("Search"),
            exportAbsent: !labels.includes("Export"),
            graphToolbarAbsent: !graphToolbarVisible,
          };
        });
        const readZoomLevel = () => page.locator(".ga-lineage-graph-bands").first().evaluate((node) => Number(node.getAttribute("data-zoom-level") || "1"));
        const initialZoom = await readZoomLevel();
        const zoomIn = await clickVisible(buttonByName(page, /^Zoom in$/i), "Lineage zoom in");
        const zoomInLevel = await readZoomLevel();
        const zoomInStatus = await textChecks(page, { ready: /Lineage graph zoom set to/i });
        const zoomOut = await clickVisible(buttonByName(page, /^Zoom out$/i), "Lineage zoom out");
        const zoomOutLevel = await readZoomLevel();
        const zoomOutStatus = await textChecks(page, { ready: /Lineage graph zoom set to/i });
        const fitGraph = await clickVisible(buttonByName(page, /^Fit graph$/i), "Lineage fit graph");
        const fitGraphLevel = await readZoomLevel();
        const fitGraphStatus = await textChecks(page, { ready: /Lineage graph fit to view/i });
        const graphHistory = await controlSnapshot(buttonByName(page, /^Graph history$/i));
        const graphHistoryStatus = {
          ready: graphHistory.disabled && /persisted lineage snapshots/i.test(graphHistory.title || ""),
          title: graphHistory.title,
        };
        await clickVisible(buttonByName(page, /^Refocus graph$/i), "Lineage refocus graph status control");
        const refocus = await textChecks(page, { ready: /Lineage graph refocused|refocused on/i });
        const timeResetButton = buttonByName(page, /^(Now|Reset preview|Reset lineage view)$/i);
        await clickVisible(timeResetButton, "Lineage time reset control");
        const now = await textChecks(page, { ready: /reset to now|Lineage view reset/i });
        const zoomControls = await page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll("button"))
            .map((node) => `${node.textContent || ""} ${node.getAttribute("aria-label") || ""}`.replace(/\s+/g, " ").trim())
            .filter(Boolean);
          return labels.filter((label) => /Zoom|Reset Zoom|Zoom in|Zoom out/i.test(label));
        });
        return {
          impact,
          column,
          columnModeClass,
          columnPanelFocused,
          columnPanelProof,
          hiddenAuthoritativeToolbar,
          zoomIn,
          initialZoom,
          zoomInLevel,
          zoomInStatus,
          zoomOut,
          zoomOutLevel,
          zoomOutStatus,
          fitGraph,
          fitGraphLevel,
          fitGraphStatus,
          graphHistory,
          graphHistoryStatus,
          refocus,
          now,
          zoomControls,
        };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { lineage: /Lineage Atlas/i });
        return {
          loaded: Boolean(
            checks.lineage &&
            runResult?.impact?.impactStatus &&
            runResult?.column?.columnStatus &&
            runResult?.columnModeClass &&
            runResult?.columnPanelFocused &&
            runResult?.columnPanelProof?.proofOnly &&
            runResult?.hiddenAuthoritativeToolbar?.compareAbsent &&
            runResult?.hiddenAuthoritativeToolbar?.tableAbsent &&
            runResult?.hiddenAuthoritativeToolbar?.searchAbsent &&
            runResult?.hiddenAuthoritativeToolbar?.exportAbsent &&
            runResult?.hiddenAuthoritativeToolbar?.graphToolbarAbsent &&
            runResult?.zoomIn &&
            runResult?.zoomInLevel > runResult?.initialZoom &&
            runResult?.zoomInStatus?.ready &&
            runResult?.zoomOut &&
            runResult?.zoomOutLevel < runResult?.zoomInLevel &&
            runResult?.zoomOutStatus?.ready &&
            runResult?.fitGraph &&
            Math.abs((runResult?.fitGraphLevel || 0) - 1) < 0.01 &&
            runResult?.fitGraphStatus?.ready &&
            runResult?.graphHistory?.disabled &&
            runResult?.graphHistoryStatus?.ready &&
            runResult?.refocus?.ready &&
            runResult?.now?.ready
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "lineage-selection",
      description: "Exercise every visible graph node, details-panel row, impact row, and column lineage row.",
      async run(page) {
        const clickAllVisible = async (locator, description, options = {}) => {
          const total = await locator.count();
          const results = [];
          for (let index = 0; index < total; index += 1) {
            const control = locator.nth(index);
            const visible = await control.isVisible().catch(() => false);
            if (!visible) {
              results.push({ index, visible: false, clicked: false });
              continue;
            }
            const before = await controlSnapshot(control);
            if (before.disabled) {
              results.push({ index, visible: true, clicked: false, disabled: true, before });
              continue;
            }
            await clickVisible(control, `${description} ${index + 1}`, { force: Boolean(options.force) });
            const after = await getBodyState(page, {
              selected: /selected/i,
              inspector: /Prototype Details|Lineage Details/i,
              boundary: /PROTOTYPE PERMISSION BOUNDARY|PERMISSION-LIMITED|Restricted|Prototype permission boundary|Hidden by Unity Catalog permissions|limited Unity Catalog visibility/i,
              column: /column lineage row selected/i,
            });
            results.push({ index, visible: true, clicked: true, disabled: false, before, after: after.checks });
          }
          const visibleResults = results.filter((item) => item.visible);
          const enabledResults = visibleResults.filter((item) => !item.disabled);
          return {
            total,
            visibleCount: visibleResults.length,
            enabledCount: enabledResults.length,
            clickedCount: enabledResults.filter((item) => item.clicked).length,
            labels: enabledResults.map((item) => item.before?.text || item.before?.ariaLabel || `control-${item.index + 1}`),
            results,
          };
        };

        const graphNodes = await clickAllVisible(
          page.locator(".ga-lineage-graph-bands").getByRole("button"),
          "Lineage graph visible node",
          { force: true },
        );
        await clickVisible(
          page.locator(".ga-lineage-graph-bands").getByRole("button", { name: /4 downstream assets|Restricted|Prototype permission boundary/i }).first(),
          "Lineage restricted node status check",
          { force: true },
        );
        const restrictedStatus = await textChecks(page, {
          selected: /4 downstream assets selected/i,
          boundary: /PROTOTYPE PERMISSION BOUNDARY|PERMISSION-LIMITED|Restricted|Prototype permission boundary|Hidden by Unity Catalog permissions|limited Unity Catalog visibility/i,
        });
        const restrictedWorkflow = await textChecks(page, {
          panel: /Permission Boundary/i,
          title: /4 downstream assets detail/i,
          unavailable: /Permission-boundary detail workflow.*live Databricks backing proof is not verified|Permission boundary detail workflow unavailable/i,
          mutationGuard: /No request, grant, or access-review mutation was submitted/i,
        });
        const detailRows = await clickAllVisible(
          page.locator(".ga-lineage-details-panel section").getByRole("button"),
          "Lineage details-panel visible row",
        );
        const detailStatus = await textChecks(page, {
          inspector: /Prototype Details|Lineage Details/i,
          selected: /selected/i,
        });
        const impactRows = await clickAllVisible(
          page.locator(".ga-lineage-impact-list").getByRole("button"),
          "Lineage impact visible row",
        );
        const impactStatus = await textChecks(page, {
          selected: /CFO Quarterly Dashboard selected|Board Pack - Revenue selected|4 downstream assets selected/i,
          inspector: /Prototype Details|Lineage Details/i,
          unavailable: /Downstream consumer|Prototype permission boundary|Hidden by Unity Catalog permissions|finance_prod \/ revenue_recognition|revenue_recognition/i,
        });
        const impactWorkflow = await textChecks(page, {
          panel: /Consumer Impact/i,
          title: /workflow/i,
          unavailable: /Consumer-impact workflow.*live Databricks backing proof is not verified|Consumer impact workflow unavailable/i,
          mutationGuard: /No owner notification, usage assertion, or consumer-impact mutation was submitted/i,
        });
        const columnRows = await clickAllVisible(
          page.locator(".ga-lineage-column-list").getByRole("button"),
          "Lineage column visible row",
        );
        const columnStatus = await textChecks(page, { selected: /column lineage row selected/i });
        const columnWorkflow = await textChecks(page, {
          panel: /Column Lineage/i,
          title: /workflow/i,
          unavailable: /Column-lineage detail workflow.*live Databricks backing proof is not verified|Column lineage detail workflow unavailable/i,
          mutationGuard: /No column-level mutation or false completeness claim was created/i,
        });
        return {
          graphNodes,
          restrictedStatus,
          restrictedWorkflow,
          detailRows,
          detailStatus,
          impactRows,
          impactStatus,
          impactWorkflow,
          columnRows,
          columnStatus,
          columnWorkflow,
          currentPath: new URL(page.url()).pathname,
        };
      },
      async validate(_page, runResult) {
        const allClicked = (result, expectedCount) => (
          result?.visibleCount === expectedCount &&
          result?.enabledCount === expectedCount &&
          result?.clickedCount === expectedCount
        );
        return {
          loaded: Boolean(
            allClicked(runResult?.graphNodes, 9) &&
            runResult?.restrictedStatus?.selected &&
            runResult?.restrictedStatus?.boundary &&
            runResult?.restrictedWorkflow?.panel &&
            runResult?.restrictedWorkflow?.title &&
            runResult?.restrictedWorkflow?.unavailable &&
            runResult?.restrictedWorkflow?.mutationGuard &&
            allClicked(runResult?.detailRows, 2) &&
            runResult?.detailStatus?.inspector &&
            runResult?.impactStatus?.selected &&
            runResult?.impactStatus?.inspector &&
            runResult?.impactStatus?.unavailable &&
            runResult?.impactWorkflow?.panel &&
            runResult?.impactWorkflow?.title &&
            runResult?.impactWorkflow?.unavailable &&
            runResult?.impactWorkflow?.mutationGuard &&
            allClicked(runResult?.impactRows, 5) &&
            allClicked(runResult?.columnRows, 4) &&
            runResult?.columnStatus?.selected &&
            runResult?.columnWorkflow?.panel &&
            runResult?.columnWorkflow?.title &&
            runResult?.columnWorkflow?.unavailable &&
            runResult?.columnWorkflow?.mutationGuard &&
            /\/lineage/i.test(runResult?.currentPath || "")
          ),
          runResult,
        };
      },
    },
    {
      key: "notify-owners",
      description: "Open the Lineage Notify owners workflow, or verify it is disabled with a truthful unavailable reason.",
      async run(page) {
        const control = buttonByName(page, /Notify owners/i);
        await control.waitFor({ state: "visible", timeout: 15_000 });
        const before = await controlSnapshot(control);
        if (before.disabled) {
          return { disabled: true, control: before };
        }
        await clickVisible(control, "Lineage Notify owners");
        const pathAfterClick = await waitForPath(page, /\/stewardship|\/governance/i);
        await page.waitForSelector(".gh-governance-ns,.gh-governance-workspace,.gh-workspace", { timeout: 15_000 }).catch(() => {});
        return { disabled: false, control: before, pathAfterClick, state: await getBodyState(page, { governance: /Stewardship|work item|Governance/i }) };
      },
      async validate(_page, runResult) {
        if (runResult?.disabled) {
          return {
            loaded: /Owner notification requires backed impact evidence/i.test(runResult?.control?.title || ""),
            runResult,
          };
        }
        return {
          loaded: Boolean(/\/stewardship|\/governance/i.test(runResult?.pathAfterClick || "") && runResult?.state?.checks?.governance),
          runResult,
        };
      },
    },
    {
      key: "asset-navigation",
      description: "Verify the former selected-strip Open asset action is absent from the non-authoritative prototype topology view.",
      async run(page) {
        const prototypeTopology = await page.locator(".ga-lineage-graph-body.is-prototype-topology").count();
        const openAssetVisible = await page.getByRole("button", { name: /^Open asset$/i }).first().isVisible().catch(() => false);
        return {
          prototypeTopology: prototypeTopology > 0,
          openAssetVisible,
          reason: "Prototype topology hides the selected-strip Open asset action until a backed selected-asset workflow is implemented.",
        };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(runResult?.prototypeTopology && runResult?.openAssetVisible === false),
          runResult,
        };
      },
    },
    {
      key: "atlas-ai",
      description: "Exercise Lineage Atlas AI suggestions, prompt submission, routed evidence chips, and accuracy notice.",
      async run(page) {
        const lineageUrl = page.url();
        await clickButton(page, /Atlas AI/i, "Open Lineage Atlas AI");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const suggestionsBefore = await page.locator(".gh-floating-ai-prompts button").count();
        const firstSuggestion = page.locator(".gh-floating-ai-prompts button").first();
        const suggestionBefore = await controlSnapshot(firstSuggestion);
        await clickVisible(firstSuggestion, "Submit Lineage Atlas AI suggested prompt");
        await page.waitForFunction(
          () => /finance_prod\.curated\.revenue_daily|CFO Quarterly Dashboard|certified|evidence/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        const suggestionChecks = await getBodyState(page, {
          answer: /finance_prod\.curated\.revenue_daily|CFO Quarterly Dashboard|certified/i,
          evidence: /evidence|finance_prod\.curated\.revenue_daily/i,
        });
        const assetEvidenceButton = page.locator(".gh-floating-ai-evidence button", { hasText: /Open (prototype )?asset/i }).first();
        const assetEvidence = await controlSnapshot(assetEvidenceButton);
        await clickVisible(assetEvidenceButton, "Open Lineage Atlas AI asset evidence");
        const pathAfterAssetEvidence = await waitForPath(page, /\/entity\//i, 15_000);
        await page.goto(lineageUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".ga-lineage-explorer,.gh-lineage-workspace", { timeout: 20_000 });
        await clickButton(page, /Atlas AI/i, "Reopen Lineage Atlas AI for typed prompt");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("What downstream consumers depend on net_revenue_usd?");
        await clickVisible(page.locator(".gh-floating-ai-input button").first(), "Submit Lineage Atlas AI prompt");
        await page.waitForFunction(
          () => /finance_prod\.curated\.revenue_daily|CFO Quarterly Dashboard|certified|evidence/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        const typedChecks = await getBodyState(page, {
          answer: /finance_prod\.curated\.revenue_daily|CFO Quarterly Dashboard|certified/i,
          evidence: /evidence|finance_prod\.curated\.revenue_daily/i,
          disclaimer: /Atlas AI uses AI\. Review for accuracy\./i,
        });
        const askButtonAfterAnswer = await controlSnapshot(page.locator(".gh-floating-ai-input button").first());
        const stewardshipEvidenceButton = page.locator(".gh-floating-ai-evidence button", { hasText: /Open (prototype )?stewardship/i }).first();
        const stewardshipEvidence = await controlSnapshot(stewardshipEvidenceButton);
        await clickVisible(stewardshipEvidenceButton, "Open Lineage Atlas AI stewardship evidence");
        const pathAfterStewardshipEvidence = await waitForPath(page, /\/stewardship|\/governance/i, 15_000);
        await page.goto(lineageUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".ga-lineage-explorer,.gh-lineage-workspace", { timeout: 20_000 });
        await clickButton(page, /Atlas AI/i, "Reopen Lineage Atlas AI for accuracy notice");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        await clickVisible(page.getByRole("button", { name: /Atlas AI accuracy notice/i }).first(), "Open Lineage Atlas AI accuracy notice");
        const accuracyNotice = await textChecks(page, {
          notice: /prototype answers use mock governance metadata and are not live Databricks evidence|grounded in available governance metadata and should be reviewed/i,
        });
        await clickButton(page, /Close Atlas AI/i, "Close Lineage Atlas AI");
        const panelClosed = await page.locator(".gh-floating-ai-chat").first().isVisible().then((visible) => !visible).catch(() => true);
        return {
          suggestionBefore,
          suggestionsBefore,
          suggestionChecks,
          assetEvidence,
          pathAfterAssetEvidence,
          typedChecks,
          askButtonAfterAnswer,
          stewardshipEvidence,
          pathAfterStewardshipEvidence,
          accuracyNotice,
          panelClosed,
        };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            runResult?.suggestionsBefore > 0 &&
            !runResult?.suggestionBefore?.disabled &&
            runResult?.suggestionChecks?.checks?.answer &&
            runResult?.suggestionChecks?.checks?.evidence &&
            /\/entity\//i.test(runResult?.pathAfterAssetEvidence || "") &&
            !runResult?.assetEvidence?.disabled &&
            runResult?.typedChecks?.checks?.answer &&
            runResult?.typedChecks?.checks?.evidence &&
            runResult?.typedChecks?.checks?.disclaimer &&
            runResult?.askButtonAfterAnswer?.disabled &&
            /Enter a prompt/i.test(runResult?.askButtonAfterAnswer?.title || "") &&
            /\/stewardship|\/governance/i.test(runResult?.pathAfterStewardshipEvidence || "") &&
            !runResult?.stewardshipEvidence?.disabled &&
            runResult?.accuracyNotice?.notice &&
            runResult?.panelClosed
          ),
          runResult,
        };
      },
    },
  ],
  audit: [
    {
      key: "degraded",
      description: "Capture the Audit Evidence degraded KPI and retention state while preserving the prototype table/footer frame.",
      async run(page) {
        mockApiFlags.auditDegraded = true;
        await page.goto(urlFor("/audit-evidence?ga_audit_degraded=1"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-audit-ns", { state: "visible", timeout: 20_000 });
        await page.waitForFunction(
          () => /Events · 24h|Unavailable|Retention policy not reported|No audit events match the current filters/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
      },
      async validate(page) {
        return page.evaluate(() => {
          const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
          const cards = Array.from(document.querySelectorAll(".gh-audit-kpi"));
          const unavailableCards = cards.filter((card) => /Unavailable/i.test(card.textContent || "")).length;
          return {
            loaded: Boolean(
              cards.length === 4 &&
              unavailableCards === 4 &&
              /Events · 24h/i.test(text) &&
              /Retention policy not reported/i.test(text) &&
              /No audit events match the current filters/i.test(text)
            ),
            unavailableCards,
            text: text.slice(0, 1000),
          };
        });
      },
    },
    {
      key: "audit-controls",
      description: "Exercise Audit Evidence date range, filters, report export, CSV export, row detail, and copy controls.",
      async run(page) {
        await clickButton(page, /Date range/i, "Audit Date range");
        const dateRangeResponsePromise = page.waitForResponse(
          (response) => /\/api\/atlas\/audit\/evidence/i.test(response.url()) && /date_range=7d/i.test(response.url()),
          { timeout: 10_000 },
        ).catch(() => null);
        await clickVisible(page.getByRole("menuitemradio", { name: /7d/i }).first(), "Audit 7d date range");
        const dateRangeResponse = await dateRangeResponsePromise;
        const dateRange = await textChecks(page, { dateStatus: /Audit date range set to 7d/i });
        const dateRangeScope = await textChecks(page, { kpiScope: /Events · 7d/i });
        await clickButton(page, /By users/i, "Audit By users");
        const byUsers = await controlSnapshot(buttonByName(page, /By users/i));
        await clickButton(page, /By services/i, "Audit By services");
        const byServices = await controlSnapshot(buttonByName(page, /By services/i));
        await clickButton(page, /Violations/i, "Audit Violations");
        const violations = await controlSnapshot(buttonByName(page, /Violations/i));
        await clickButton(page, /All events/i, "Audit All events");
        const reportDownload = await clickDownload(page, buttonByName(page, /Generate report/i), "audit-report");
        const csvDownload = await clickDownload(page, buttonByName(page, /Export CSV/i), "audit-events");
        const firstEvent = page.locator(".gh-audit-row").first();
        await firstEvent.waitFor({ state: "visible", timeout: 15_000 });
        await firstEvent.click();
        await page.waitForSelector(".gh-audit-selected-detail", { state: "visible", timeout: 10_000 });
        const selectedDetail = await page.locator(".gh-audit-selected-detail").first().evaluate((node) => {
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          const requestMatch =
            text.match(/Request ID\s*Prototype\s+([A-Z]{2}-\d+)/i) ||
            text.match(/Request ID\s+([A-Z]{2}-\d+)/i) ||
            text.match(/\b(SI-\d+)\b/i);
          return {
            text,
            requestId: requestMatch?.[1] || "",
            hasSelectedEvidence: /Selected evidence/i.test(text),
            hasRequestId: /Request ID/i.test(text),
          };
        });
        await clickButton(page, /Copy request ID/i, "Audit copy request ID");
        const copied = await textChecks(page, { copied: /Request ID .* copied|selected for review/i });
        const copyStatusText = await visibleText(page, 2000);
        return {
          dateRange,
          dateRangeScope,
          dateRangeRequest: {
            url: dateRangeResponse?.url?.() || "",
            status: dateRangeResponse?.status?.() || 0,
          },
          byUsers,
          byServices,
          violations,
          reportDownload,
          csvDownload,
          selectedDetail,
          copied,
          copyStatusText,
        };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { audit: /Prototype audit fixture log|Immutable governance event log/i });
        return {
          loaded: Boolean(
            checks.audit &&
            runResult?.dateRange?.dateStatus &&
            runResult?.dateRangeScope?.kpiScope &&
            /date_range=7d/i.test(runResult?.dateRangeRequest?.url || "") &&
            runResult?.dateRangeRequest?.status === 200 &&
            runResult?.byUsers?.ariaPressed === "true" &&
            runResult?.byServices?.ariaPressed === "true" &&
            runResult?.violations?.ariaPressed === "true" &&
            runResult?.reportDownload?.ok &&
            runResult?.csvDownload?.ok &&
            runResult?.selectedDetail?.hasSelectedEvidence &&
            runResult?.selectedDetail?.hasRequestId &&
            Boolean(runResult?.selectedDetail?.requestId) &&
            runResult?.copied?.copied
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "audit-asset-navigation",
      description: "Open the selected audit row asset.",
      async run(page) {
        const firstEvent = page.locator(".gh-audit-row").first();
        await firstEvent.waitFor({ state: "visible", timeout: 15_000 });
        await firstEvent.click();
        await page.waitForSelector(".gh-audit-selected-detail", { state: "visible", timeout: 10_000 });
        await clickButton(page, /Open asset/i, "Audit Open asset");
        const pathAfterClick = await waitForPath(page, /\/entity\//i);
        return { pathAfterClick };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { assetPage: /Overview|Asset|revenue_daily/i });
        return { loaded: Boolean(/\/entity\//i.test(runResult?.pathAfterClick || "") && checks.assetPage), checks, runResult };
      },
    },
    {
      key: "audit-evidence-link",
      description: "Open an inline audit evidence target link where a backed target is available.",
      async run(page) {
        const firstEvent = page.locator(".gh-audit-row").first();
        await firstEvent.waitFor({ state: "visible", timeout: 15_000 });
        const inlineLink = firstEvent.getByRole("button", { name: /Open evidence target/i }).first();
        const before = await controlSnapshot(inlineLink);
        await clickVisible(inlineLink, "Audit inline evidence target");
        const pathAfterClick = await waitForPath(page, /\/entity\//i);
        return { before, pathAfterClick };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { assetPage: /Overview|Asset|revenue_daily/i });
        return { loaded: Boolean(!runResult?.before?.disabled && /\/entity\//i.test(runResult?.pathAfterClick || "") && checks.assetPage), checks, runResult };
      },
    },
    {
      key: "atlas-ai",
      description: "Submit an Audit Evidence-specific Atlas AI prompt and verify grounded evidence appears.",
      async run(page) {
        await clickButton(page, /Atlas AI/i, "Open Audit Evidence Atlas AI");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("Summarize recent audit evidence.");
        await clickVisible(page.locator(".gh-floating-ai-input button").first(), "Submit Audit Evidence Atlas AI prompt");
        await page.waitForFunction(
          () => /Prototype mock Audit Evidence|grant|notebook|export events|audit proof/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        return await getBodyState(page, {
          answer: /Prototype mock Audit Evidence|grant, certification, notebook, and export events/i,
          evidence: /REQ-1001|prototype audit export fixture|not live Databricks audit proof/i,
          disclaimer: /Atlas AI uses AI\. Review for accuracy\./i,
        });
      },
      async validate(_page, runResult) {
        return { loaded: Boolean(runResult?.checks?.answer && runResult?.checks?.evidence && runResult?.checks?.disclaimer), runResult };
      },
    },
  ],
  "control-center": [
    {
      key: "control-controls",
      description: "Exercise Control Center linked-resource truth handling, no-URL fallback, integration detail, and policy detail.",
      async run(page) {
        await page.evaluate(() => {
          window.__governanceAtlasOpenedUrls = [];
          window.open = (url, target, features) => {
            window.__governanceAtlasOpenedUrls.push({ url: String(url || ""), target: String(target || ""), features: String(features || "") });
            return null;
          };
        });
        await clickButton(page, /UC metadata sweeper/i, "Control Center job row");
        const job = await textChecks(page, { selected: /UC metadata sweeper diagnostics selected|Selected control detail/i });
        const openLinkedWithUrl = await controlSnapshot(buttonByName(page, /Open linked resource/i));
        let clickedOpenLinked = false;
        if (!openLinkedWithUrl?.disabled) {
          await clickButton(page, /Open linked resource/i, "Open reported Databricks job URL");
          clickedOpenLinked = true;
        }
        const openedUrls = await page.evaluate(() => window.__governanceAtlasOpenedUrls || []);
        const openedStatus = await textChecks(page, {
          opened: /UC metadata sweeper linked resource opened/i,
          withheld: /Prototype URL withheld; not live Databricks resource proof/i,
        });
        await clickButton(page, /Lineage collector/i, "Control Center no-URL job row");
        const openLinkedNoUrl = await controlSnapshot(buttonByName(page, /Open linked resource/i));
        await clickButton(page, /Unity Catalog/i, "Control Center Unity Catalog integration");
        const integration = await textChecks(page, { selected: /Unity Catalog integration diagnostics selected|Selected control detail/i });
        await clickButton(page, /Owner required on production/i, "Control Center policy row");
        const policy = await textChecks(page, { selected: /coverage from diagnostics|Policy coverage/i });
        return { job, openLinkedWithUrl, clickedOpenLinked, openedUrls, openedStatus, openLinkedNoUrl, integration, policy };
      },
      async validate(page, runResult) {
        const checks = await textChecks(page, { control: /Atlas runtime, integrations, and policy/i });
        const linkedResourceHandled = MOCK_API
          ? runResult?.openLinkedWithUrl?.disabled &&
            !runResult?.clickedOpenLinked &&
            runResult?.openedStatus?.withheld &&
            (runResult?.openedUrls || []).length === 0
          : runResult?.openLinkedWithUrl &&
            !runResult.openLinkedWithUrl.disabled &&
            runResult?.openedUrls?.some((item) => /\/jobs\/123\/runs\/456/.test(item.url || "")) &&
            runResult?.openedStatus?.opened;
        return {
          loaded: Boolean(
            checks.control &&
            runResult?.job?.selected &&
            linkedResourceHandled &&
            runResult?.openLinkedNoUrl?.disabled &&
            runResult?.integration?.selected &&
            runResult?.policy?.selected
          ),
          checks,
          runResult,
        };
      },
    },
    {
      key: "control-shell-chrome",
      description: "Exercise topbar search, notifications, help, and profile controls from Control Center.",
      async run(page) {
        const input = page.locator(".ga-top-search input, .gh-topbar-search input, input[placeholder*='Search assets']").first();
        await input.waitFor({ state: "visible", timeout: 10_000 });
        await input.fill("net revenue");
        await clickButton(page, /Submit global search/i, "Submit Control Center global search");
        const pathAfterSearch = await waitForPath(page, /\/discover/i);
        await page.waitForSelector(".gh-discovery-workspace,.gh-discovery-main-grid", { timeout: 15_000 });
        const searchState = await getBodyState(page, { revenueDaily: /revenue_daily|Net Revenue/i });
        await page.goto(urlFor("/control-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-admin-ns,.gh-admin-workspace,.gh-workspace", { timeout: 20_000 });
        await clickButton(page, /Notifications/i, "Open Control Center notifications");
        const pathAfterNotifications = await waitForPath(page, /\/inbox/i);
        const inboxState = await getBodyState(page, { inbox: /Inbox|workflow notifications|No notifications/i });
        await page.goto(urlFor("/control-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-admin-ns,.gh-admin-workspace,.gh-workspace", { timeout: 20_000 });
        await clickButton(page, /^Help$/i, "Open help from Control Center");
        const pathAfterHelp = await waitForPath(page, /\/help/i);
        const helpState = await getBodyState(page, { help: /How Governance Atlas works|Getting help/i });
        await page.goto(urlFor("/control-center"), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector(".gh-admin-ns,.gh-admin-workspace,.gh-workspace", { timeout: 20_000 });
        await clickButton(page, /Open profile menu/i, "Open profile menu from Control Center");
        const profileState = await getProfileMenuState(page);
        return { pathAfterSearch, searchState, pathAfterNotifications, inboxState, pathAfterHelp, helpState, profileState };
      },
      async validate(_page, runResult) {
        return {
          loaded: Boolean(
            /\/discover/i.test(runResult?.pathAfterSearch || "") &&
            runResult?.searchState?.checks?.revenueDaily &&
            /\/inbox/i.test(runResult?.pathAfterNotifications || "") &&
            runResult?.inboxState?.checks?.inbox &&
            /\/help/i.test(runResult?.pathAfterHelp || "") &&
            runResult?.helpState?.checks?.help &&
            runResult?.profileState?.checks?.settings &&
            runResult?.profileState?.checks?.avatar &&
            runResult?.profileState?.localAvatarState?.localOnly &&
            runResult?.profileState?.localAvatarState?.databricksProfileExcluded &&
            runResult?.profileState?.checks?.signOut
          ),
          runResult,
        };
      },
    },
    {
      key: "atlas-ai",
      description: "Submit a Control Center-specific Atlas AI prompt and verify grounded evidence appears.",
      async run(page) {
        await clickButton(page, /Atlas AI/i, "Open Control Center Atlas AI");
        await page.waitForSelector(".gh-floating-ai-chat", { state: "visible", timeout: 10_000 });
        const input = page.locator(".gh-floating-ai-input input").first();
        await input.fill("Which control center jobs are healthy?");
        await clickVisible(page.locator(".gh-floating-ai-input button").first(), "Submit Control Center Atlas AI prompt");
        await page.waitForFunction(
          () => /Prototype mock Control Center|UC metadata sweeper|Trust score recompute|policy coverage/i.test(document.body?.innerText || ""),
          undefined,
          { timeout: 20_000 },
        );
        return await getBodyState(page, {
          answer: /Prototype mock Control Center|runtime job fixtures|policy coverage/i,
          evidence: /UC metadata sweeper|Trust score recompute|Prototype policy coverage/i,
          disclaimer: /Atlas AI uses AI\. Review for accuracy\./i,
        });
      },
      async validate(_page, runResult) {
        return { loaded: Boolean(runResult?.checks?.answer && runResult?.checks?.evidence && runResult?.checks?.disclaimer), runResult };
      },
    },
    {
      key: "responsive-control-layout",
      description: "Validate Control Center job, integration, policy, and detail controls remain visible within the main content region.",
      async run(page) {
        await clickButton(page, /UC metadata sweeper/i, "Control Center detail row for responsive layout");
        const layout = await page.evaluate(() => {
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const main = document.querySelector(".gh-main") || document.body;
          const mainRect = main.getBoundingClientRect();
          const rectInfo = (node) => {
            const rect = node.getBoundingClientRect();
            return {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          };
          const selectors = [
            [".gh-admin-prototype-job-row", "job"],
            [".gh-admin-prototype-integration", "integration"],
            [".gh-admin-prototype-policy-row", "policy"],
            [".gh-admin-control-detail", "detail"],
            [".gh-admin-control-actions button", "detail-action"],
          ];
          const groups = selectors.map(([selector, label]) => {
            const nodes = Array.from(document.querySelectorAll(selector));
            const failures = nodes.map((node) => {
              const rect = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
              const insideMainWidth = rect.left >= mainRect.left - 1 && rect.right <= mainRect.right + 1;
              return { label, text: (node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(), visible, insideMainWidth, rect: rectInfo(node) };
            }).filter((item) => !item.visible || !item.insideMainWidth);
            return { label, count: nodes.length, failures };
          });
          return {
            viewport,
            main: rectInfo(main),
            groups,
          };
        });
        return { layout };
      },
      async validate(_page, runResult) {
        const groups = runResult?.layout?.groups || [];
        const enoughControls = groups.every((group) => group.count > 0);
        const noFailures = groups.every((group) => group.failures.length === 0);
        return { loaded: Boolean(enoughControls && noFailures), runResult };
      },
    },
  ],
};

async function captureRouteInteractions(page, route, viewport) {
  const specs = (INTERACTION_STATES[route.key] || [])
    .filter((spec) => !INTERACTION_FILTER.size || INTERACTION_FILTER.has(spec.key));
  for (const spec of specs) {
    const item = {
      route: route.key,
      path: route.path,
      viewport: viewport.name,
      interaction: spec.key,
      description: spec.description,
      loaded: false,
      screenshot: "",
      fullPageScreenshot: "",
    };
    try {
      mockApiFlags.discoveryDegraded = false;
      mockApiFlags.previewDegraded = false;
      await waitForRoute(page, route);
      item.runResult = await spec.run(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(500);
      item.validation = await spec.validate(page, item.runResult);
      item.metrics = await pageMetrics(page);
      item.loaded = Boolean(item.validation?.loaded);
    } catch (error) {
      item.error = error?.message || String(error);
      item.metrics = await pageMetrics(page).catch(() => null);
    }
    const base = `${route.key}-${spec.key}-${viewport.name}`;
    item.screenshot = path.join(OUT_DIR, `${base}.png`);
    item.fullPageScreenshot = path.join(OUT_DIR, `${base}-full.png`);
    await fs.mkdir(OUT_DIR, { recursive: true });
    await page.screenshot({ path: item.screenshot, fullPage: false });
    if (CAPTURE_FULL_PAGE) {
      await page.screenshot({ path: item.fullPageScreenshot, fullPage: true });
    } else {
      item.fullPageScreenshot = "";
    }
    report.interactions.push(item);
    await flushReport();
    console.log(`${item.loaded ? "ok" : "warn"} ${route.key}:${spec.key} ${viewport.name}`);
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  if (UNKNOWN_ROUTE_FILTERS.length || !SELECTED_ROUTES.length) {
    report.fatal = UNKNOWN_ROUTE_FILTERS.length
      ? `Unknown prototype route filter(s): ${UNKNOWN_ROUTE_FILTERS.join(", ")}`
      : "No prototype routes selected.";
    await flushReport();
    console.error(report.fatal);
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1536, height: 1024 },
    acceptDownloads: true,
    extraHTTPHeaders: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  await captureRuntimeStatus();
  await context.addInitScript(() => {
    window.localStorage?.removeItem?.("governance-atlas:atlas-ai-dismissed");
  });
  await installMockApi(context);
  const page = await context.newPage();
  attachListeners(page);
  try {
    for (const viewport of VIEWPORTS) {
      for (const route of SELECTED_ROUTES) {
        await captureRoute(page, route, viewport);
        if (CAPTURE_INTERACTIONS) {
          await captureRouteInteractions(page, route, viewport);
        }
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await flushReport();
  }
  if (!report.passed) process.exit(1);
}

main().catch(async (error) => {
  report.fatal = error?.message || String(error);
  await flushReport();
  console.error(error);
  process.exit(1);
});
