import { useQuery } from "@tanstack/react-query";
import { fetchGovernanceAuditTimeline } from "../lib/api";

/**
 * Reverse-chronological governance audit timeline for a single asset.
 *
 * Feeds the AuditTimelineDrawer. Reads from the existing metadata_audit_log
 * table via /api/governance/audit-timeline/{fqn} — no new schema.
 *
 * @param {string} assetFqn
 * @param {{ enabled?: boolean }} [options]
 */
export function useGovernanceAuditTimeline(assetFqn, options = {}) {
  const trimmed = String(assetFqn || "").trim();
  const enabled = options.enabled !== false && Boolean(trimmed);
  const query = useQuery({
    queryKey: ["governanceAuditTimeline", trimmed],
    enabled,
    queryFn: ({ signal }) => fetchGovernanceAuditTimeline(trimmed, { signal }),
  });
  const message = query.error?.message || "Failed to load audit timeline.";
  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.isError && !query.data ? message : "",
    entries: Array.isArray(query.data?.entries) ? query.data.entries : [],
    total: Number(query.data?.total || 0),
    refresh: query.refetch,
  };
}
