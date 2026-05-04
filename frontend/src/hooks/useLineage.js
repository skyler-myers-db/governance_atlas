import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLineage } from "../lib/api";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
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

function normalizeCanonicalPayload(assetFqn, payload, { authoritative = false, source = "live" } = {}) {
  if (!assetFqn || !payload) return null;
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  const payloadState = String(meta.state || payload.state || "").trim().toLowerCase();
  const payloadSource = String(meta.source || payload.source || source || "").trim().toLowerCase();
  const mockPayload = isNonAuthoritativeMockEvidence(payload, meta, payload.warnings);
  if (mockPayload) return null;
  const resolvedAuthoritative = mockPayload
    ? false
    : typeof payload.authoritative === "boolean"
      ? payload.authoritative
      : typeof meta.authoritative === "boolean"
        ? meta.authoritative
      : authoritative;
  return {
    ...payload,
    fqn: payload.fqn || assetFqn,
    authoritative: resolvedAuthoritative,
    source: payload.source || meta.source || source,
  };
}

function isWorkspaceScopedDatabricksLineage(payload, meta = {}) {
  if (!payload || typeof payload !== "object") return false;
  const payloadSource = String(meta.source || payload.source || "").trim().toLowerCase();
  const visibilityScope = String(meta.visibilityScope || meta.readScope || "").trim().toLowerCase();
  const authMode = String(meta.authMode || meta.productMode || "").trim().toLowerCase();
  const nodes = payload.graphs?.data?.nodes || payload.graph?.nodes || [];
  return (
    payloadSource.includes("unity-catalog-lineage") &&
    (
      visibilityScope === "workspace-app-principal" ||
      visibilityScope === "workspace_app_principal" ||
      authMode === "app-principal-only" ||
      authMode === "app_principal_only"
    ) &&
    Array.isArray(nodes) &&
    nodes.length > 0
  );
}

function setCachedLineage(assetFqn, payload) {
  const normalized = normalizeCanonicalPayload(assetFqn, payload);
  if (!normalized) return null;
  const profile = normalized.profile === LINEAGE_PROFILE_INITIAL ? LINEAGE_PROFILE_INITIAL : LINEAGE_PROFILE_FULL;
  atlasQueryClient.setQueryData(lineageQueryKey(assetFqn, profile), normalized);
  return normalized;
}

function lineagePayloadHydrating(payload) {
  if (!payload || typeof payload !== "object") return false;
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  const capabilities = meta.capabilities && typeof meta.capabilities === "object"
    ? meta.capabilities
    : {};
  const state = String(meta.state || payload.state || "").trim().toLowerCase();
  return state === "loading" || capabilities.hydrating === true;
}

function lineageRefetchInterval(query) {
  return lineagePayloadHydrating(query?.state?.data) ? 3_000 : false;
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

export function useLineage(assetFqn, enabled = true, options = {}) {
  const fullProfileRequested = options.fullProfile === true || options.loadFullProfile === true;
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
    refetchInterval: lineageRefetchInterval,
    queryFn: ({ signal }) => fetchLineage(assetFqn, { signal, profile: LINEAGE_PROFILE_INITIAL }),
  });

  const fullQuery = useQuery({
    queryKey: lineageQueryKey(assetFqn || "", LINEAGE_PROFILE_FULL),
    enabled: Boolean(assetFqn) &&
      enabled &&
      fullProfileRequested &&
      Boolean(initialQuery.data || cachedInitialPayload || cachedFullPayload),
    staleTime: LINEAGE_CACHE_TTL_MS,
    gcTime: LINEAGE_GC_TIME_MS,
    retry: false,
    refetchInterval: lineageRefetchInterval,
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
      refresh: async () => null,
    };
  }

  const initialPayload = initialQuery.data
    ? normalizeCanonicalPayload(assetFqn, initialQuery.data, { authoritative: false, source: "live" })
    : cachedInitialPayload || null;
  const fullPayload = fullQuery.data
    ? normalizeCanonicalPayload(assetFqn, fullQuery.data, { authoritative: false, source: "live" })
    : null;
  const payload = fullPayload || cachedFullPayload || initialPayload || null;
  const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
  const payloadState = String(meta.state || payload?.state || "").trim().toLowerCase();
  const payloadSource = String(meta.source || payload?.source || "").trim().toLowerCase();
  const prototypePayload = isNonAuthoritativeMockEvidence(payload, meta, payload?.warnings);
  const safePayload = prototypePayload ? null : payload;
  const explicitAuthoritativeFalse = safePayload?.authoritative === false || meta.authoritative === false;
  const workspaceScopedLineage = isWorkspaceScopedDatabricksLineage(safePayload, meta);
  const authoritative = Boolean(
    safePayload &&
      payloadState !== "prototype_mock" &&
      payloadSource !== "local-prototype-mock" &&
      !explicitAuthoritativeFalse &&
      !workspaceScopedLineage &&
      (
        safePayload.authoritative === true ||
        meta.authoritative === true ||
        ["authoritative", "live"].includes(payloadState)
      ),
  );
  const provisional = Boolean(safePayload) && !authoritative;

  if (!enabled) {
    return {
      loading: false,
      error: "",
      graph: safePayload?.graphs || null,
      payload: safePayload || null,
      authoritative,
      provisional,
      refresh: async () => safePayload,
    };
  }

  const refresh = async () => {
    if (!assetFqn) return null;
    atlasQueryClient.removeQueries({
      queryKey: [LINEAGE_QUERY_PREFIX],
      exact: false,
      predicate: (query) => query.queryKey?.[2] === assetFqn,
    });
    const initial = await initialQuery.refetch();
    const initialValue = normalizeCanonicalPayload(assetFqn, initial.data, {
      authoritative: false,
      source: "live",
    });
    if (!initialValue) return null;
    setCachedLineage(assetFqn, initialValue);
    const full = await fullQuery.refetch();
      const fullValue = normalizeCanonicalPayload(assetFqn, full.data, {
        authoritative: false,
        source: "live",
      });
    if (fullValue) return setCachedLineage(assetFqn, fullValue);
    return initialValue;
  };

  return {
    loading: !safePayload && initialQuery.isPending && !initialQuery.isError,
    error: !safePayload && (initialQuery.isError || fullQuery.isError)
      ? initialQuery.error?.message || fullQuery.error?.message || "Failed to load lineage."
      : "",
    graph: safePayload?.graphs || null,
    payload: safePayload || null,
    authoritative,
    provisional,
    refresh,
  };
}
