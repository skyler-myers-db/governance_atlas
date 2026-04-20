import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchClassificationRecommendation,
  fetchClassificationRecommendations,
  reviewClassificationRecommendation,
} from "../lib/api";

const EMPTY_LIST = {
  recommendations: [],
  count: 0,
  pendingCount: 0,
};

/**
 * List hook for the Classification lane in GovernanceWorkspace.
 *
 * @param {{ status?: string, assetFqn?: string, enabled?: boolean, refetchInterval?: number | false } | boolean} [options]
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
  const query = useQuery({
    queryKey: ["classification-recommendations", status, assetFqn],
    queryFn: ({ signal }) =>
      fetchClassificationRecommendations({ status, assetFqn, signal }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 15000,
    refetchInterval: resolvedOptions.refetchInterval ?? false,
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
  const query = useQuery({
    queryKey: ["classification-recommendation", normalized],
    queryFn: ({ signal }) => fetchClassificationRecommendation(normalized, { signal }),
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
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ recommendationId, decision, note }) =>
      reviewClassificationRecommendation(recommendationId, { decision, note }),
    onSuccess: (record) => {
      if (record?.recommendationId) {
        queryClient.setQueryData(
          ["classification-recommendation", record.recommendationId],
          record,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["classification-recommendations"] });
    },
  });
  const review = useCallback(
    (args) => mutation.mutateAsync(args),
    [mutation],
  );
  return {
    review,
    submitting: mutation.isPending,
    error: mutation.isError ? mutation.error?.message || "Review failed." : "",
    lastRecord: mutation.data || null,
    reset: mutation.reset,
  };
}
