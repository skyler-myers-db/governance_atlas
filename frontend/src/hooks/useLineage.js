import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLineage } from "../lib/api";
import { govhubQueryClient } from "../lib/queryClient";

const LINEAGE_CACHE_TTL_MS = 300_000;
// Keep prefetched neighbor payloads alive long enough to be useful. The
// default React Query gcTime (5 min) drops inactive prefetched queries
// before the user can click them, causing a full refetch on refocus.
const LINEAGE_GC_TIME_MS = 15 * 60 * 1000;
const LINEAGE_QUERY_PREFIX = "lineage";
const LINEAGE_NEIGHBOR_PREFETCH_LIMIT = 8;

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

function collectFirstHopNeighbors(payload, focusFqn) {
  const graph = payload?.graphs?.data;
  if (!graph) return [];
  const nodesById = new Map();
  for (const node of graph.nodes || []) {
    if (node?.id) nodesById.set(node.id, node);
  }
  const focusId = (graph.nodes || []).find((node) => node?.role === "focus")?.id;
  const seen = new Set();
  const neighbors = [];
  for (const edge of graph.edges || []) {
    const source = edge?.source;
    const target = edge?.target;
    const depth = Number(edge?.depth ?? 1);
    if (depth !== 1) continue;
    let neighborId = "";
    if (source === focusId) neighborId = target;
    else if (target === focusId) neighborId = source;
    else continue;
    const neighbor = nodesById.get(neighborId);
    const fqn = neighbor?.assetFqn;
    if (!fqn || fqn === focusFqn || seen.has(fqn)) continue;
    seen.add(fqn);
    neighbors.push(fqn);
  }
  return neighbors;
}

export function prefetchLineage(assetFqn, options = {}) {
  if (!assetFqn) return Promise.resolve(null);
  const force = options.force === true;
  const cached = force ? null : readCachedLineage(assetFqn);
  if (cached) return Promise.resolve(cached);
  return govhubQueryClient
    .fetchQuery({
      queryKey: lineageQueryKey(assetFqn),
      staleTime: LINEAGE_CACHE_TTL_MS,
      gcTime: LINEAGE_GC_TIME_MS,
      queryFn: ({ signal }) => fetchLineage(assetFqn, { signal }),
    })
    .then((payload) => setCachedLineage(assetFqn, payload))
    .catch(() => readCachedLineage(assetFqn, { maxAgeMs: null }) || null);
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

  useEffect(() => {
    if (!enabled) return;
    const payload = query.data;
    if (!payload || !payload.authoritative) return;
    const neighbors = collectFirstHopNeighbors(payload, assetFqn);
    if (!neighbors.length) return;
    const handles = [];
    neighbors.slice(0, LINEAGE_NEIGHBOR_PREFETCH_LIMIT).forEach((neighborFqn, index) => {
      // Stagger prefetches so the focus asset's in-flight queries aren't
      // starved. 150 ms spacing still lets all 8 kick off within ~1.2 s,
      // which is much faster than the user can click through them.
      const handle = setTimeout(() => {
        prefetchLineage(neighborFqn);
      }, index * 150);
      handles.push(handle);
    });
    return () => {
      handles.forEach((handle) => clearTimeout(handle));
    };
  }, [assetFqn, enabled, query.data?.fqn, query.data?.authoritative]);

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
