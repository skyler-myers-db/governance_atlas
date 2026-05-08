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

export function useLineageRecommendations(options = {}) {
  const enabled = options.enabled !== false;
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(25, Math.trunc(Number(options.limit))))
    : 8;
  const query = useQuery({
    queryKey: ["lineageRecommendations", limit],
    enabled,
    staleTime: 120_000,
    refetchInterval: (query) => (
      lineageRecommendationHydrating(query?.state?.data) ? 3_000 : false
    ),
    queryFn: ({ signal }) => fetchLineageRecommendations({ signal, limit }),
  });
  const payload = query.data && !isNonAuthoritativeMockEvidence(query.data, query.data?.meta, query.data?.warnings)
    ? query.data
    : null;
  const items = Array.isArray(payload?.items)
    ? payload.items.map(normalizeRecommendation).filter(Boolean)
    : [];
  const hydrating = lineageRecommendationHydrating(payload);
  return {
    loading: enabled && ((query.isPending && !payload) || hydrating),
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
    refresh: query.refetch,
  };
}

export default useLineageRecommendations;
