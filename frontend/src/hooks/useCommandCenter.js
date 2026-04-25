import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCommandCenter } from "../lib/api";

export const EMPTY_COMMAND_CENTER = {
  estate: {
    visibleAssetCount: null,
    catalogCount: null,
    openRequests: null,
    coverageScore: null,
  },
  kpis: [],
  posture: { overall: null, trend: [], byDomain: [], heatmap: [] },
  topDomains: [],
  recentEvents: [],
  recentAssets: [],
  governance: { pendingRequests: [] },
  insights: { tiles: {} },
  quickActions: [],
  aiPrompts: [],
  signalAvailability: {},
  meta: { state: "unknown", warnings: [] },
};

function normalizeOptions(options) {
  if (typeof options === "boolean") return { enabled: options };
  return options && typeof options === "object" ? options : {};
}

function mergeCommandCenter(seedData, queryData) {
  const base = seedData || EMPTY_COMMAND_CENTER;
  const data = queryData || base;
  return {
    ...EMPTY_COMMAND_CENTER,
    ...base,
    ...data,
    estate: {
      ...EMPTY_COMMAND_CENTER.estate,
      ...(base.estate || {}),
      ...(data.estate || {}),
    },
    posture: {
      ...EMPTY_COMMAND_CENTER.posture,
      ...(base.posture || {}),
      ...(data.posture || {}),
    },
    governance: {
      ...EMPTY_COMMAND_CENTER.governance,
      ...(base.governance || {}),
      ...(data.governance || {}),
    },
    insights: {
      ...EMPTY_COMMAND_CENTER.insights,
      ...(base.insights || {}),
      ...(data.insights || {}),
    },
    meta: {
      ...EMPTY_COMMAND_CENTER.meta,
      ...(base.meta || {}),
      ...(data.meta || {}),
      warnings: [
        ...new Set([
          ...((base.meta && Array.isArray(base.meta.warnings)) ? base.meta.warnings : []),
          ...((data.meta && Array.isArray(data.meta.warnings)) ? data.meta.warnings : []),
        ]),
      ],
    },
    kpis: Array.isArray(data.kpis) ? data.kpis : [],
    topDomains: Array.isArray(data.topDomains) ? data.topDomains : [],
    recentEvents: Array.isArray(data.recentEvents) ? data.recentEvents : [],
    recentAssets: Array.isArray(data.recentAssets) ? data.recentAssets : [],
    quickActions: Array.isArray(data.quickActions) ? data.quickActions : [],
    aiPrompts: Array.isArray(data.aiPrompts) ? data.aiPrompts : [],
  };
}

export function useCommandCenter(options = {}) {
  const resolvedOptions = normalizeOptions(options);
  const enabled = resolvedOptions.enabled !== false;
  const seedData = resolvedOptions.seedData || null;
  const [pendingRefresh, setPendingRefresh] = useState(false);

  const query = useQuery({
    queryKey: ["atlas", "command-center", pendingRefresh ? "force" : "cache"],
    queryFn: ({ signal }) =>
      fetchCommandCenter({ signal, refresh: pendingRefresh }).finally(() => {
        if (pendingRefresh) setPendingRefresh(false);
      }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 60_000,
    refetchInterval: resolvedOptions.refetchInterval ?? false,
  });

  const refreshActorScope = useCallback(() => {
    setPendingRefresh(true);
  }, []);

  const usableData = query.data || seedData || null;
  const data = mergeCommandCenter(seedData, query.data);
  const message = query.error?.message || "Command center is unavailable.";
  const warnings = Array.isArray(data?.meta?.warnings) ? data.meta.warnings : [];
  const refreshError = usableData && query.isError ? message : "";

  return {
    data,
    loading: enabled && query.isPending && !query.data && !seedData,
    refreshing: query.isFetching,
    error: usableData ? "" : query.isError ? message : "",
    refreshError,
    degraded:
      data?.meta?.state === "degraded" ||
      Boolean(refreshError) ||
      warnings.length > 0,
    warnings,
    meta: data?.meta || null,
    oboScopeFallback: Boolean(data?.meta?.oboScopeFallback),
    oboFallbackReason: data?.meta?.oboFallbackReason || "",
    refresh: query.refetch,
    refreshActorScope,
  };
}

export default useCommandCenter;
