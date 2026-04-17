import { useQuery } from "@tanstack/react-query";
import { fetchRuntimeStatus } from "../lib/api";

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
  const query = useQuery({
    queryKey: ["runtime-status"],
    queryFn: ({ signal }) => fetchRuntimeStatus({ signal }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 15000,
    refetchInterval: resolvedOptions.refetchInterval ?? false,
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
