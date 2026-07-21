import { fetchAssetProfile } from "../lib/api";
import { useAtlasQuery } from "./useAtlasQuery";

/**
 * Phase 8 — persisted profile for an asset.
 * Reads the latest profile_run + metrics from /api/assets/:fqn/profile.
 */
export function useAssetProfile(assetFqn, options = {}) {
  const trimmed = String(assetFqn || "").trim();
  const enabled = options.enabled !== false && Boolean(trimmed);
  const { query } = useAtlasQuery({
    key: ["assetProfile", trimmed],
    enabled,
    fetch: (signal) => fetchAssetProfile(trimmed, { signal }),
  });
  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.isError && !query.data ? query.error?.message || "Failed to load profile." : "",
    run: query.data?.run || null,
    tableMetric: Array.isArray(query.data?.tableMetrics) ? query.data.tableMetrics[0] : query.data?.tableMetrics || null,
    columnMetrics: Array.isArray(query.data?.columnMetrics) ? query.data.columnMetrics : [],
    databricksProfile:
      query.data?.databricksProfile && typeof query.data.databricksProfile === "object"
        ? query.data.databricksProfile
        : null,
    refresh: query.refetch,
  };
}
