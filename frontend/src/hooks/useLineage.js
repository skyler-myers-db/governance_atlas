import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLineage } from "../lib/api";
import { atlasQueryClient } from "../lib/queryClient";

const LINEAGE_CACHE_TTL_MS = 300_000;
// Keep prefetched neighbor payloads alive long enough to be useful. The
// default React Query gcTime (5 min) drops inactive prefetched queries
// before the user can click them, causing a full refetch on refocus.
const LINEAGE_GC_TIME_MS = 15 * 60 * 1000;
const LINEAGE_QUERY_PREFIX = "lineage";
const LINEAGE_PROFILE_FULL = "full";
const LINEAGE_PROFILE_INITIAL = "initial";

function lineageQueryKey(assetFqn, profile = LINEAGE_PROFILE_FULL) {
  return [LINEAGE_QUERY_PREFIX, profile, assetFqn];
}

function queryUpdatedAt(queryKey) {
  return atlasQueryClient.getQueryState(queryKey)?.dataUpdatedAt || 0;
}

function isFresh(queryKey, maxAgeMs = null) {
  if (maxAgeMs == null) return true;
  const updatedAt = queryUpdatedAt(queryKey);
  if (!updatedAt) return false;
  return Date.now() - updatedAt <= maxAgeMs;
}

function readCachedLineage(assetFqn, { maxAgeMs = LINEAGE_CACHE_TTL_MS, profile = LINEAGE_PROFILE_FULL } = {}) {
  if (!assetFqn) return null;
  const queryKey = lineageQueryKey(assetFqn, profile);
  const payload = atlasQueryClient.getQueryData(queryKey) || null;
  if (!payload) return null;
  if (!isFresh(queryKey, maxAgeMs)) return null;
  return payload;
}

function normalizeCanonicalPayload(assetFqn, payload, { authoritative = true, source = "live" } = {}) {
  if (!assetFqn || !payload) return null;
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  const payloadState = String(meta.state || payload.state || "").trim().toLowerCase();
  const payloadSource = String(meta.source || payload.source || source || "").trim().toLowerCase();
  const mockPayload = payloadState === "prototype_mock" || payloadSource === "local-prototype-mock";
  const resolvedAuthoritative = mockPayload
    ? false
    : typeof payload.authoritative === "boolean"
      ? payload.authoritative
      : authoritative;
  return {
    ...payload,
    fqn: payload.fqn || assetFqn,
    authoritative: resolvedAuthoritative,
    source: payload.source || meta.source || source,
  };
}

function setCachedLineage(assetFqn, payload) {
  const normalized = normalizeCanonicalPayload(assetFqn, payload);
  if (!normalized) return payload;
  const profile = normalized.profile === LINEAGE_PROFILE_INITIAL ? LINEAGE_PROFILE_INITIAL : LINEAGE_PROFILE_FULL;
  atlasQueryClient.setQueryData(lineageQueryKey(assetFqn, profile), normalized);
  return normalized;
}

export function primeLineagePayload(assetFqn, payload) {
  return setCachedLineage(assetFqn, payload);
}

export function invalidateLineage(assetFqn) {
  if (!assetFqn) return;
  atlasQueryClient.removeQueries({
    queryKey: [LINEAGE_QUERY_PREFIX],
    exact: false,
    predicate: (query) => query.queryKey?.[2] === assetFqn,
  });
}

export function prefetchLineage(assetFqn, options = {}) {
  if (!assetFqn) return Promise.resolve(null);
  const force = options.force === true;
  const profile = options.profile === LINEAGE_PROFILE_INITIAL ? LINEAGE_PROFILE_INITIAL : LINEAGE_PROFILE_FULL;
  const cached = force ? null : readCachedLineage(assetFqn, { profile });
  if (cached) return Promise.resolve(cached);
  return atlasQueryClient
    .fetchQuery({
      queryKey: lineageQueryKey(assetFqn, profile),
      staleTime: LINEAGE_CACHE_TTL_MS,
      gcTime: LINEAGE_GC_TIME_MS,
      queryFn: ({ signal }) => fetchLineage(assetFqn, { signal, profile }),
    })
    .then((payload) => setCachedLineage(assetFqn, payload))
    .catch(() => readCachedLineage(assetFqn, { maxAgeMs: null, profile }) || null);
}

export function useLineage(assetFqn, enabled = true) {
  const cachedFullPayload = useMemo(
    () => readCachedLineage(assetFqn, { maxAgeMs: null, profile: LINEAGE_PROFILE_FULL }),
    [assetFqn],
  );
  const cachedInitialPayload = useMemo(
    () => readCachedLineage(assetFqn, { maxAgeMs: null, profile: LINEAGE_PROFILE_INITIAL }),
    [assetFqn],
  );

  const initialQuery = useQuery({
    queryKey: lineageQueryKey(assetFqn || "", LINEAGE_PROFILE_INITIAL),
    enabled: Boolean(assetFqn) && enabled,
    staleTime: LINEAGE_CACHE_TTL_MS,
    gcTime: LINEAGE_GC_TIME_MS,
    retry: false,
    queryFn: ({ signal }) => fetchLineage(assetFqn, { signal, profile: LINEAGE_PROFILE_INITIAL }),
  });

  const fullQuery = useQuery({
    queryKey: lineageQueryKey(assetFqn || "", LINEAGE_PROFILE_FULL),
    enabled: Boolean(assetFqn) && enabled && Boolean(initialQuery.data || cachedInitialPayload || cachedFullPayload),
    staleTime: LINEAGE_CACHE_TTL_MS,
    gcTime: LINEAGE_GC_TIME_MS,
    retry: false,
    queryFn: ({ signal }) => fetchLineage(assetFqn, { signal, profile: LINEAGE_PROFILE_FULL }),
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

  const initialPayload = initialQuery.data
    ? normalizeCanonicalPayload(assetFqn, initialQuery.data, { authoritative: true, source: "live" })
    : cachedInitialPayload || null;
  const fullPayload = fullQuery.data
    ? normalizeCanonicalPayload(assetFqn, fullQuery.data, { authoritative: true, source: "live" })
    : null;
  const payload = fullPayload || cachedFullPayload || initialPayload || null;
  const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
  const payloadState = String(meta.state || payload?.state || "").trim().toLowerCase();
  const payloadSource = String(meta.source || payload?.source || "").trim().toLowerCase();
  const authoritative = Boolean(
    payload &&
      payloadState !== "prototype_mock" &&
      payloadSource !== "local-prototype-mock" &&
      (payload.authoritative === true || meta.authoritative === true || ["authoritative", "live"].includes(payloadState)),
  );
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
    loading: !payload && initialQuery.isPending && !initialQuery.isError,
    error: !payload && (initialQuery.isError || fullQuery.isError)
      ? initialQuery.error?.message || fullQuery.error?.message || "Failed to load lineage."
      : "",
    graph: payload?.graphs || null,
    payload: payload || null,
    authoritative,
    provisional,
  };
}
