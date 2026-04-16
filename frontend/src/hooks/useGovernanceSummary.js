import { useQuery } from "@tanstack/react-query";
import { fetchGovernanceSummary } from "../lib/api";

const EMPTY_GOVERNANCE = {
  metrics: [],
  backlog: [],
  glossary: [],
  inbox: null,
};

export function useGovernanceSummary(options = {}) {
  const resolvedOptions =
    typeof options === "boolean"
      ? { enabled: options }
      : options && typeof options === "object"
        ? options
        : {};
  const enabled = resolvedOptions.enabled !== false;
  const query = useQuery({
    queryKey: ["governance-summary"],
    queryFn: ({ signal }) => fetchGovernanceSummary({ signal }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 15000,
    refetchInterval: resolvedOptions.refetchInterval ?? false,
  });
  const message = query.error?.message || "Failed to load governance summary.";

  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.data ? "" : query.isError ? message : "",
    refreshError: query.data && query.isError ? message : "",
    data: query.data || null,
    empty: EMPTY_GOVERNANCE,
    refresh: query.refetch,
  };
}
