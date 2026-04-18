import { useQuery } from "@tanstack/react-query";
import { fetchAssetCustomProperties } from "../lib/api";

/**
 * Phase 8 — persisted custom property assignments for an asset.
 * Thin wrapper around /api/assets/:fqn/custom-properties.
 */
export function useAssetCustomProperties(assetFqn, options = {}) {
  const trimmed = String(assetFqn || "").trim();
  const enabled = options.enabled !== false && Boolean(trimmed);
  const query = useQuery({
    queryKey: ["assetCustomProperties", trimmed],
    enabled,
    queryFn: ({ signal }) => fetchAssetCustomProperties(trimmed, { signal }),
  });
  const assignments = Array.isArray(query.data) ? query.data : [];
  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error:
      query.isError && !query.data
        ? query.error?.message || "Failed to load custom properties."
        : "",
    assignments,
    refresh: query.refetch,
  };
}
