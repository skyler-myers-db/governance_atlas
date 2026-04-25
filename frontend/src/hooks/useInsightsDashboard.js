import { useQuery } from "@tanstack/react-query";
import { fetchInsightsDashboard } from "../lib/api";

const EMPTY_INSIGHTS_DASHBOARD = {
  kpis: [],
  policyComplianceTrend: [],
  resolutionTrend: [],
  metadataCoverageHeatmap: [],
  certificationCoverageByTier: [],
  riskHeatmap: [],
  domainLeaderboard: [],
  recommendations: [],
  scoring: { maturityFormula: [], availableSignals: [] },
  signalAvailability: {},
  meta: { state: "unknown", warnings: [] },
};

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeInsightsDashboard(payload) {
  const data = objectValue(payload);
  const scoring = objectValue(data.scoring);
  const meta = objectValue(data.meta);
  return {
    ...EMPTY_INSIGHTS_DASHBOARD,
    ...data,
    kpis: arrayValue(data.kpis).map((item) => objectValue(item)),
    policyComplianceTrend: arrayValue(data.policyComplianceTrend),
    resolutionTrend: arrayValue(data.resolutionTrend),
    metadataCoverageHeatmap: arrayValue(data.metadataCoverageHeatmap),
    certificationCoverageByTier: arrayValue(data.certificationCoverageByTier),
    riskHeatmap: arrayValue(data.riskHeatmap),
    domainLeaderboard: arrayValue(data.domainLeaderboard),
    recommendations: arrayValue(data.recommendations).map((item) => objectValue(item)),
    scoring: {
      ...scoring,
      maturityFormula: arrayValue(scoring.maturityFormula),
      availableSignals: arrayValue(scoring.availableSignals),
    },
    signalAvailability: objectValue(data.signalAvailability),
    meta: {
      ...meta,
      warnings: arrayValue(meta.warnings),
    },
  };
}

function normalizeOptions(options) {
  if (typeof options === "boolean") return { enabled: options };
  return options && typeof options === "object" ? options : {};
}

export function useInsightsDashboard(options = {}) {
  const resolvedOptions = normalizeOptions(options);
  const enabled = resolvedOptions.enabled !== false;
  const seedData = resolvedOptions.seedData || null;

  const query = useQuery({
    queryKey: ["atlas", "insights-dashboard"],
    queryFn: ({ signal }) => fetchInsightsDashboard({ signal }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 60_000,
    refetchInterval: resolvedOptions.refetchInterval ?? false,
  });

  const usableData = query.data || seedData || null;
  const data = normalizeInsightsDashboard(usableData || EMPTY_INSIGHTS_DASHBOARD);
  const message = query.error?.message || "Insights dashboard is unavailable.";
  const warnings = Array.isArray(data.meta?.warnings) ? data.meta.warnings : [];
  const refreshError = usableData && query.isError ? message : "";
  const state = query.isError && !usableData
    ? "error"
    : query.isPending && !usableData
      ? "loading"
      : data.meta?.state === "degraded" || refreshError || warnings.length
        ? "degraded"
        : "ready";

  return {
    data,
    state,
    loading: enabled && query.isPending && !usableData,
    refreshing: query.isFetching,
    error: usableData ? "" : query.isError ? message : "",
    refreshError,
    warnings,
    degraded: state === "degraded",
    refresh: query.refetch,
  };
}

export default useInsightsDashboard;
export { EMPTY_INSIGHTS_DASHBOARD, normalizeInsightsDashboard };
