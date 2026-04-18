import { useQuery } from "@tanstack/react-query";
import { fetchAssetQuality } from "../lib/api";

/**
 * Phase 10 — persisted quality results for an asset.
 * Reads /api/assets/:fqn/quality — runs + per-case results + summary.
 */
export function useAssetQuality(assetFqn, options = {}) {
  const trimmed = String(assetFqn || "").trim();
  const enabled = options.enabled !== false && Boolean(trimmed);
  const query = useQuery({
    queryKey: ["assetQuality", trimmed],
    enabled,
    queryFn: ({ signal }) => fetchAssetQuality(trimmed, { signal }),
  });
  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.isError && !query.data ? query.error?.message || "Failed to load quality." : "",
    runs: Array.isArray(query.data?.runs) ? query.data.runs : [],
    results: Array.isArray(query.data?.results) ? query.data.results : [],
    summary: query.data?.summary || { passed: 0, failed: 0, errored: 0, skipped: 0 },
    refresh: query.refetch,
  };
}
