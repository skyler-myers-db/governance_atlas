import { useQuery } from "@tanstack/react-query";
import { fetchGovernanceGlossaryTerm } from "../lib/api";

/**
 * @param {string} termId
 * @param {{enabled?: boolean, seedTerm?: any} | boolean} [options={}]
 */
export function useGovernanceGlossaryTerm(termId, options = {}) {
  const resolvedOptions =
    typeof options === "boolean"
      ? { enabled: options }
      : options && typeof options === "object"
      ? options
      : {};
  const enabled = resolvedOptions.enabled !== false && Boolean(termId);
  const seedTerm = resolvedOptions.seedTerm || null;
  const query = useQuery({
    queryKey: ["governanceGlossaryTerm", String(termId || "").trim()],
    enabled,
    queryFn: ({ signal }) => fetchGovernanceGlossaryTerm(termId, { signal }),
    placeholderData: seedTerm || undefined,
  });
  const message = query.error?.message || "Failed to load glossary term details.";

  return {
    loading: enabled && query.isPending && !query.data && !seedTerm,
    refreshing: query.isFetching,
    error: query.data || seedTerm ? "" : query.isError ? message : "",
    refreshError: query.data || seedTerm ? (query.isError ? message : "") : "",
    term: query.data || seedTerm || null,
    refresh: query.refetch,
  };
}
