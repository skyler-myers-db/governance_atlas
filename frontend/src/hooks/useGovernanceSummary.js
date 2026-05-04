import { useQuery } from "@tanstack/react-query";
import { fetchGovernanceSummary } from "../lib/api";

const EMPTY_GOVERNANCE = {
  metrics: [],
  backlog: [],
  glossary: [],
  inbox: null,
};

/**
 * @param {{enabled?: boolean, staleTime?: number, refetchInterval?: number | false} | boolean} [options={}]
 */
export function useGovernanceSummary(options = {}) {
  const resolvedOptions =
    typeof options === "boolean"
      ? { enabled: options }
      : options && typeof options === "object"
        ? options
        : {};
  const enabled = resolvedOptions.enabled !== false;
  const sections = Array.isArray(resolvedOptions.sections)
    ? resolvedOptions.sections.filter(Boolean)
    : resolvedOptions.section
      ? [resolvedOptions.section]
      : [];
  const query = useQuery({
    queryKey: ["governance-summary", sections],
    queryFn: ({ signal }) => fetchGovernanceSummary({ signal, sections }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 15000,
    refetchInterval:
      resolvedOptions.refetchInterval ??
      ((queryState) => {
        const data = queryState?.state?.data;
        const inboxState = String(data?.inbox?.state || "").trim().toLowerCase();
        return inboxState === "loading" ? 2500 : false;
      }),
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
