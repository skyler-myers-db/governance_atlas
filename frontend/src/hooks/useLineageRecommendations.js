import { useQuery } from "@tanstack/react-query";
import { fetchLineageRecommendations } from "../lib/api";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";

function normalizeRecommendation(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  if (isNonAuthoritativeMockEvidence(item, item.meta, item.provenance, item.warnings)) return null;
  const fqn = String(item.fqn || item.assetFqn || "").trim();
  if (!fqn) return null;
  return {
    ...item,
    fqn,
    name: String(item.name || fqn.split(".").pop() || fqn).trim(),
    edgeCount: Number.isFinite(Number(item.edgeCount)) ? Math.max(0, Number(item.edgeCount)) : 0,
    upstreamCount: Number.isFinite(Number(item.upstreamCount)) ? Math.max(0, Number(item.upstreamCount)) : 0,
    downstreamCount: Number.isFinite(Number(item.downstreamCount)) ? Math.max(0, Number(item.downstreamCount)) : 0,
  };
}

function lineageRecommendationHydrating(payload) {
  const state = String(payload?.meta?.state || payload?.state || "").trim().toLowerCase();
  return (
    state === "loading" ||
    state === "hydrating" ||
    payload?.recommendationMeta?.hydrating === true ||
    payload?.meta?.capabilities?.hydrating === true
  );
}

// Poll-loop guard (perf audit P1): mirror useLineage — the recommendations
// warmer used to re-poll every 3s indefinitely while the backend reported a
// loading envelope. Stop as soon as items exist or after a bounded number
// of attempts, then surface an honest "still warming" state via `warming`.
const RECOMMENDATION_POLL_ATTEMPT_LIMIT = 10;
const recommendationPollAttempts = new Map();

function recommendationRefetchInterval(query) {
  const payload = query?.state?.data;
  const key = String(query?.queryKey?.join?.("|") || "lineageRecommendations");
  if (!lineageRecommendationHydrating(payload)) {
    recommendationPollAttempts.delete(key);
    return false;
  }
  if (Array.isArray(payload?.items) && payload.items.length) return false;
  const attempts = recommendationPollAttempts.get(key) || 0;
  if (attempts >= RECOMMENDATION_POLL_ATTEMPT_LIMIT) return false;
  recommendationPollAttempts.set(key, attempts + 1);
  return 3_000;
}

export function useLineageRecommendations(options = {}) {
  const enabled = options.enabled !== false;
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(25, Math.trunc(Number(options.limit))))
    : 8;
  const query = useQuery({
    queryKey: ["lineageRecommendations", limit],
    enabled,
    staleTime: 120_000,
    refetchInterval: recommendationRefetchInterval,
    queryFn: ({ signal }) => fetchLineageRecommendations({ signal, limit }),
  });
  const payload = query.data && !isNonAuthoritativeMockEvidence(query.data, query.data?.meta, query.data?.warnings)
    ? query.data
    : null;
  const items = Array.isArray(payload?.items)
    ? payload.items.map(normalizeRecommendation).filter(Boolean)
    : [];
  const hydrating = lineageRecommendationHydrating(payload);
  // Warming = the envelope is still hydrating with zero items and the poll
  // budget is spent. Consumers must show "still warming — retry", not an
  // eternal loading spinner.
  const pollKey = `lineageRecommendations|${limit}`;
  const warming =
    hydrating &&
    !items.length &&
    (recommendationPollAttempts.get(pollKey) || 0) >= RECOMMENDATION_POLL_ATTEMPT_LIMIT;
  return {
    loading: enabled && ((query.isPending && !payload) || (hydrating && !warming)),
    warming,
    refreshing: enabled && query.isFetching,
    error: query.isError && !payload ? query.error?.message || "Failed to load lineage recommendations." : "",
    items,
    meta: payload?.recommendationMeta || payload?.meta || null,
    envelopeMeta: payload?.meta || null,
    authoritative: payload ? payload?.meta?.authoritative === true : null,
    degraded: payload?.meta?.degraded === true || payload?.meta?.authoritative === false,
    visibilityScope:
      payload?.meta?.visibilityScope ||
      payload?.meta?.readScope ||
      payload?.meta?.capabilities?.visibilityScope ||
      "",
    relationshipVisibilityScope:
      payload?.meta?.capabilities?.relationshipVisibilityScope ||
      payload?.recommendationMeta?.relationshipVisibilityScope ||
      "",
    warning: Array.isArray(payload?.meta?.warnings) ? payload.meta.warnings[0] || "" : "",
    refresh: () => {
      // Explicit retry restores the poll budget so the warmer can resume.
      recommendationPollAttempts.delete(pollKey);
      return query.refetch();
    },
  };
}

export default useLineageRecommendations;
