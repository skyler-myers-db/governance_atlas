import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchGapAnalysis } from "../lib/api";

const EMPTY_TILES = {
  ownershipGaps: 0,
  policyGaps: 0,
  freshnessGaps: 0,
  qualityIncidents: 0,
  totalAssets: 0,
};

const EMPTY_LANES = {
  ownership: [],
  policy: [],
  freshness: [],
  quality: [],
};

/**
 * Thin TanStack Query wrapper around `GET /api/insights/gap-analysis`.
 *
 * Exposes `{tiles, lanes, isLoading, error, refresh}` so InsightsWorkspace
 * can render tile counts, lane tables, and empty states without re-
 * implementing cache / retry / abort semantics.
 *
 * @param {{enabled?: boolean, limit?: number, staleTime?: number} | boolean} [options]
 */
export function useGapAnalysis(options = {}) {
  const resolvedOptions =
    typeof options === "boolean"
      ? { enabled: options }
      : options && typeof options === "object"
        ? options
        : {};
  const enabled = resolvedOptions.enabled !== false;
  const limit = Number.isFinite(Number(resolvedOptions.limit))
    ? Math.max(1, Math.min(500, Math.trunc(Number(resolvedOptions.limit))))
    : 200;

  // Round 17: track a one-shot "force a fresh actor-scoped load" flag so
  // the UI can offer an escape hatch when the prior response fell back to
  // the app-principal view. The next fetch sends `?refresh=1`; after it
  // resolves we reset the flag so normal caching resumes.
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["insights-gap-analysis", limit, pendingRefresh ? "force" : "cache"],
    queryFn: ({ signal }) =>
      fetchGapAnalysis({ limit, signal, refresh: pendingRefresh }).finally(() => {
        if (pendingRefresh) setPendingRefresh(false);
      }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 30_000,
    refetchInterval: resolvedOptions.refetchInterval ?? false,
  });

  const refreshActorScope = useCallback(() => {
    setPendingRefresh(true);
    // Invalidate so the next render picks up the force-refresh query key.
    queryClient.invalidateQueries({ queryKey: ["insights-gap-analysis"] });
  }, [queryClient]);

  const data = query.data || null;
  const tiles = data?.tiles ? { ...EMPTY_TILES, ...data.tiles } : EMPTY_TILES;
  const lanes = data?.lanes ? { ...EMPTY_LANES, ...data.lanes } : EMPTY_LANES;
  const message = query.error?.message || "Failed to load governance insights.";

  return {
    tiles,
    lanes,
    lanesOrder: Array.isArray(data?.lanesOrder)
      ? data.lanesOrder
      : ["ownership", "policy", "freshness", "quality"],
    qualitySignalAvailable:
      typeof data?.qualitySignalAvailable === "boolean"
        ? data.qualitySignalAvailable
        : true,
    meta: data?.meta || null,
    oboScopeFallback: Boolean(data?.meta?.oboScopeFallback),
    oboFallbackReason: data?.meta?.oboFallbackReason || "",
    isLoading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.data ? "" : query.isError ? message : "",
    refreshError: query.data && query.isError ? message : "",
    refresh: query.refetch,
    refreshActorScope,
  };
}

export default useGapAnalysis;
