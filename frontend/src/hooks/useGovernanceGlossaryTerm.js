import { fetchGovernanceGlossaryTerm } from "../lib/api";
import { useAtlasQuery } from "./useAtlasQuery";

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
  const { query } = useAtlasQuery({
    key: ["governanceGlossaryTerm", String(termId || "").trim()],
    enabled,
    fetch: (signal) => fetchGovernanceGlossaryTerm(termId, { signal }),
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
