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

function lineageQueryKey(assetFqn) {
  return [LINEAGE_QUERY_PREFIX, assetFqn];
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
  const queryKey = lineageQueryKey(assetFqn);
  const payload = govhubQueryClient.getQueryData(queryKey) || null;
  if (!payload) return null;
  if (!isFresh(queryKey, maxAgeMs)) return null;
  return payload;
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
  govhubQueryClient.setQueryData(lineageQueryKey(assetFqn), normalized);
  return normalized;
}

export function primeLineagePayload(assetFqn, payload) {
  return setCachedLineage(assetFqn, payload);
}

export function invalidateLineage(assetFqn) {
  if (!assetFqn) return;
  govhubQueryClient.removeQueries({
    queryKey: lineageQueryKey(assetFqn),
    exact: true,
  });
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
        queryKey: lineageQueryKey(_inflightPrefetchFqn),
        exact: true,
      });
    } catch {
      // best-effort; cancellation races are non-fatal
    }
  }
  _inflightPrefetchFqn = assetFqn;
  return govhubQueryClient
    .fetchQuery({
      queryKey: lineageQueryKey(assetFqn),
      staleTime: LINEAGE_CACHE_TTL_MS,
      gcTime: LINEAGE_GC_TIME_MS,
      queryFn: ({ signal }) => fetchLineage(assetFqn, { signal }),
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

  const query = useQuery({
    queryKey: lineageQueryKey(assetFqn || ""),
    enabled: Boolean(assetFqn) && enabled,
    staleTime: LINEAGE_CACHE_TTL_MS,
    gcTime: LINEAGE_GC_TIME_MS,
    queryFn: ({ signal }) => fetchLineage(assetFqn, { signal }),
  });
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

  const payload = query.data || cachedPayload || null;
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

  return {
    loading: query.isPending || (query.isFetching && !authoritative),
    error: query.isError ? query.error?.message || "Failed to load lineage." : "",
    graph: payload?.graphs || null,
    payload: payload || null,
    authoritative,
    provisional,
  };
}
