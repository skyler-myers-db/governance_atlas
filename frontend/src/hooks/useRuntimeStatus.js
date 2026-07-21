import { fetchRuntimeStatus } from "../lib/api";
import { useAtlasQuery } from "./useAtlasQuery";

/**
 * @param {{enabled?: boolean, staleTime?: number, refetchInterval?: number | false | ((query: any) => number | false)} | boolean} [options={}]
 */
export function useRuntimeStatus(options = {}) {
  const resolvedOptions =
    typeof options === "boolean"
      ? { enabled: options }
      : options && typeof options === "object"
        ? options
        : {};
  const enabled = resolvedOptions.enabled !== false;
  const { query } = useAtlasQuery({
    key: ["runtime-status"],
    fetch: (signal) => fetchRuntimeStatus({ signal }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 15000,
    // No default poll. Legacy call sites (App.jsx diagnostics heartbeat) may
    // still pass an explicit refetchInterval; honor it verbatim until their
    // Wave B/C rewrite moves them onto the bounded `poll` contract.
    unsafeRefetchInterval: resolvedOptions.refetchInterval ?? false,
  });
  const message = query.error?.message || "Failed to load workspace diagnostics.";

  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.data ? "" : query.isError ? message : "",
    refreshError: query.data && query.isError ? message : "",
    data: query.data || null,
    refresh: query.refetch,
  };
}
