import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLineage } from "../lib/api";
import { govhubQueryClient } from "../lib/queryClient";

const LINEAGE_CACHE_TTL_MS = 300_000;
// Keep prefetched neighbor payloads alive long enough to be useful. The
// default React Query gcTime (5 min) drops inactive prefetched queries
// before the user can click them, causing a full refetch on refocus.
const LINEAGE_GC_TIME_MS = 15 * 60 * 1000;
const LINEAGE_QUERY_PREFIX = "lineage";

// Tier keys coexist so a fast first-hop payload and the full 2-hop
// payload can both live in the cache for the same asset. The backend
// stamps `stats.fetchTier` = "first-hop" | "full" on the response.
function lineageQueryKey(assetFqn, tier = "full") {
  return [LINEAGE_QUERY_PREFIX, assetFqn, tier];
}

function queryUpdatedAt(queryKey) {
  return govhubQueryClient.getQueryState(queryKey)?.dataUpdatedAt || 0;
}

function isFresh(queryKey, maxAgeMs = null) {
  if (maxAgeMs == null) return true;
  const updatedAt = queryUpdatedAt(queryKey);
  if (!updatedAt) return false;
  return Date.now() - updatedAt <= maxAgeMs;
}

function readCachedLineage(assetFqn, { maxAgeMs = LINEAGE_CACHE_TTL_MS } = {}) {
  if (!assetFqn) return null;
  // Prefer the full-tier cache; fall back to first-hop if that's all
  // we have. Callers use the return value to decide whether a network
  // fetch is needed, so any cached payload is acceptable.
  for (const tier of ["full", "first-hop"]) {
    const queryKey = lineageQueryKey(assetFqn, tier);
    const payload = govhubQueryClient.getQueryData(queryKey) || null;
    if (!payload) continue;
    if (!isFresh(queryKey, maxAgeMs)) continue;
    return payload;
  }
  return null;
}

function normalizeCanonicalPayload(assetFqn, payload, { authoritative = true, source = "live" } = {}) {
  if (!assetFqn || !payload) return null;
  return {
    ...payload,
    fqn: payload.fqn || assetFqn,
    authoritative,
    source,
  };
}

function setCachedLineage(assetFqn, payload) {
  const normalized = normalizeCanonicalPayload(assetFqn, payload);
  if (!normalized) return payload;
  // Stamp under the tier the server declared so the useLineage selector
  // can merge first-hop and full cleanly.
  const tier = normalized?.stats?.fetchTier === "first-hop" ? "first-hop" : "full";
  govhubQueryClient.setQueryData(lineageQueryKey(assetFqn, tier), normalized);
  return normalized;
}

export function primeLineagePayload(assetFqn, payload) {
  return setCachedLineage(assetFqn, payload);
}

export function invalidateLineage(assetFqn) {
  if (!assetFqn) return;
  // Nuke every tier for this asset so a Refresh click blows away both
  // the first-hop and full cache entries.
  for (const tier of ["first-hop", "full"]) {
    govhubQueryClient.removeQueries({
      queryKey: lineageQueryKey(assetFqn, tier),
      exact: true,
    });
  }
}

// Module-scoped tracker for the one-at-a-time prefetch contract. Discovery
// hover fires `prefetchLineage(fqn)` on every settled 300ms dwell; without
// cancellation, a user skimming 10 rows would stampede the warehouse with
// 10 concurrent 30-60s cold queries. When a new prefetch arrives while a
// prior one is in flight, cancel the prior query's fetch and let the new
// one take its slot.
let _inflightPrefetchFqn = null;

export function prefetchLineage(assetFqn, options = {}) {
  if (!assetFqn) return Promise.resolve(null);
  const force = options.force === true;
  const cached = force ? null : readCachedLineage(assetFqn);
  if (cached) return Promise.resolve(cached);
  // If another prefetch is in flight for a different asset, cancel it so
  // we don't stampede the warehouse. `cancelQueries` aborts the fetch's
  // AbortSignal, which `fetchLineage` threads through to the HTTP call.
  if (_inflightPrefetchFqn && _inflightPrefetchFqn !== assetFqn) {
    try {
      govhubQueryClient.cancelQueries({
        queryKey: lineageQueryKey(_inflightPrefetchFqn, "full"),
        exact: true,
      });
    } catch {
      // best-effort; cancellation races are non-fatal
    }
  }
  _inflightPrefetchFqn = assetFqn;
  // Prefetch always warms the full-tier cache — the first-hop optimization
  // only helps the user actively waiting on their own fetch. A background
  // prefetch has no latency budget to preserve.
  return govhubQueryClient
    .fetchQuery({
      queryKey: lineageQueryKey(assetFqn, "full"),
      staleTime: LINEAGE_CACHE_TTL_MS,
      gcTime: LINEAGE_GC_TIME_MS,
      queryFn: ({ signal }) =>
        fetchLineage(assetFqn, { signal, force }),
    })
    .then((payload) => {
      if (_inflightPrefetchFqn === assetFqn) _inflightPrefetchFqn = null;
      return setCachedLineage(assetFqn, payload);
    })
    .catch(() => {
      if (_inflightPrefetchFqn === assetFqn) _inflightPrefetchFqn = null;
      return readCachedLineage(assetFqn, { maxAgeMs: null }) || null;
    });
}

export function useLineage(assetFqn, enabled = true) {
  const cachedPayload = useMemo(
    () => readCachedLineage(assetFqn, { maxAgeMs: null }),
    [assetFqn],
  );

  // Two queries fire in parallel:
  //   - first-hop (depth=1, 5-10s cold, skips column/operational)
  //   - full (25-45s cold, complete graph)
  // The UI renders whichever completes first. When full arrives, it
  // supersedes first-hop (merge-by-id in the selector below) so the
  // user sees a richer graph without losing any state they created
  // during the intermediate first-hop render.
  const firstHopQuery = useQuery({
    queryKey: lineageQueryKey(assetFqn || "", "first-hop"),
    enabled: Boolean(assetFqn) && enabled,
    staleTime: LINEAGE_CACHE_TTL_MS,
    gcTime: LINEAGE_GC_TIME_MS,
    queryFn: ({ signal }) =>
      fetchLineage(assetFqn, { signal, depth: 1 }),
  });
  const fullQuery = useQuery({
    queryKey: lineageQueryKey(assetFqn || "", "full"),
    enabled: Boolean(assetFqn) && enabled,
    staleTime: LINEAGE_CACHE_TTL_MS,
    gcTime: LINEAGE_GC_TIME_MS,
    queryFn: ({ signal }) => fetchLineage(assetFqn, { signal }),
  });
  const query = fullQuery;
  // Neighbor prefetch is intentionally *not* auto-triggered here. Eager
  // stampedes (8 parallel lineage queries) starved the SQL warehouse and
  // turned every focus load into a 2+ minute wait. Callers that actually
  // need a warm neighbor (e.g. hover dwell > 600 ms) must call
  // `prefetchLineage()` explicitly, one neighbor at a time.

  if (!assetFqn) {
    return {
      loading: false,
      error: "",
      graph: null,
      payload: null,
      authoritative: false,
      provisional: false,
    };
  }

  // Prefer the fuller payload when both have resolved. First-hop carries
  // a `stats.fetchTier === "first-hop"` marker so downstream can tell it
  // apart when needed.
  const payload =
    fullQuery.data ||
    firstHopQuery.data ||
    cachedPayload ||
    null;
  const authoritative = Boolean(payload && payload.authoritative !== false);
  const provisional = Boolean(payload) && !authoritative;

  if (!enabled) {
    return {
      loading: false,
      error: "",
      graph: payload?.graphs || null,
      payload: payload || null,
      authoritative,
      provisional,
    };
  }

  // Loading state: only show the skeleton when NEITHER query has a
  // payload. Once first-hop lands, the graph paints even while the
  // full query is still in flight.
  const noPayloadYet = !firstHopQuery.data && !fullQuery.data;
  const anyFetching =
    firstHopQuery.isPending || fullQuery.isPending ||
    ((firstHopQuery.isFetching || fullQuery.isFetching) && !authoritative);

  return {
    loading: noPayloadYet && anyFetching,
    error: query.isError ? query.error?.message || "Failed to load lineage." : "",
    graph: payload?.graphs || null,
    payload: payload || null,
    authoritative,
    provisional,
  };
}
