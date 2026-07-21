import { useCallback } from "react";
import {
  fetchClassificationRecommendation,
  fetchClassificationRecommendations,
  reviewClassificationRecommendation,
} from "../lib/api";
import { useAtlasMutation, useAtlasQuery } from "./useAtlasQuery";

const EMPTY_LIST = {
  recommendations: [],
  count: 0,
  pendingCount: 0,
};

/**
 * @typedef {{ recommendationId: string, decision: string, note?: string }} ClassificationReviewArgs
 */

/**
 * List hook for the Classification lane in GovernanceWorkspace.
 *
 * @param {{ status?: string, assetFqn?: string, enabled?: boolean, staleTime?: number, refetchInterval?: number | false } | boolean} [options]
 */
export function useClassificationRecommendations(options = {}) {
  const resolvedOptions =
    typeof options === "boolean"
      ? { enabled: options }
      : options && typeof options === "object"
        ? options
        : {};
  const status = resolvedOptions.status || "pending";
  const assetFqn = String(resolvedOptions.assetFqn || "").trim();
  const enabled = resolvedOptions.enabled !== false;
  const { query } = useAtlasQuery({
    key: ["classification-recommendations", status, assetFqn],
    fetch: (signal) =>
      fetchClassificationRecommendations({ status, assetFqn, signal }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 15000,
    // No default poll (unchanged); legacy escape hatch for explicit overrides.
    unsafeRefetchInterval: resolvedOptions.refetchInterval ?? false,
  });
  const message = query.error?.message || "Failed to load classification recommendations.";
  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.data ? "" : query.isError ? message : "",
    refreshError: query.data && query.isError ? message : "",
    data: query.data || EMPTY_LIST,
    empty: EMPTY_LIST,
    refresh: query.refetch,
  };
}

/**
 * Single-recommendation hook. Used by the evidence drawer.
 */
export function useClassificationRecommendation(recommendationId, options = {}) {
  const normalized = String(recommendationId || "").trim();
  const enabled = options.enabled !== false && Boolean(normalized);
  const { query } = useAtlasQuery({
    key: ["classification-recommendation", normalized],
    fetch: (signal) => fetchClassificationRecommendation(normalized, { signal }),
    enabled,
    staleTime: options.staleTime ?? 10000,
  });
  return {
    loading: enabled && query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.isError ? query.error?.message || "Failed to load recommendation." : "",
    data: query.data || null,
    refresh: query.refetch,
  };
}

/**
 * Mutation hook for steward review actions (approve/reject/defer).
 */
export function useClassificationReview() {
  const mutation = useAtlasMutation({
    /** @param {ClassificationReviewArgs} args */
    mutate: ({ recommendationId, decision, note }) =>
      reviewClassificationRecommendation(recommendationId, { decision, note }),
    // Refresh every list scope after a decision (success or failure) so the
    // lane never drifts from persisted truth.
    invalidates: [["classification-recommendations"]],
    onSuccess: (record, _variables, queryClient) => {
      // Seed the single-recommendation cache so the evidence drawer reflects
      // the review immediately without a refetch round-trip.
      if (record?.recommendationId) {
        queryClient.setQueryData(
          ["classification-recommendation", record.recommendationId],
          record,
        );
      }
    },
  });
  const mutateAsync = mutation.mutateAsync;
  const review = useCallback((args) => mutateAsync(args), [mutateAsync]);
  return {
    review,
    submitting: mutation.submitting,
    error: mutation.error ? mutation.error?.message || "Review failed." : "",
    lastRecord: mutation.data || null,
    reset: mutation.reset,
  };
}
