import { useQuery } from "@tanstack/react-query";
import { fetchAccessExplain } from "../lib/api";

/**
 * Phase 14 — "Why can't I access this?" explainer.
 * Returns authMode, visibilityScope, remediation steps, and
 * Databricks deep-link URLs scoped to the given asset (or generic).
 */
export function useAccessExplain(assetFqn = "", options = {}) {
  const trimmed = String(assetFqn || "").trim();
  const enabled = options.enabled !== false;
  const query = useQuery({
    queryKey: ["accessExplain", trimmed || "__global__"],
    enabled,
    queryFn: ({ signal }) => fetchAccessExplain(trimmed, { signal }),
  });
  return {
    loading: enabled && query.isPending && !query.data,
    error: query.isError && !query.data ? query.error?.message || "Failed to load access explainer." : "",
    data: query.data || null,
  };
}
