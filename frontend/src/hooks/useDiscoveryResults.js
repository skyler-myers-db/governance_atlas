import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDiscoverySearch } from "../lib/api";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";

const DISCOVERY_DEFAULT_FETCH_LIMIT = 80;
const DISCOVERY_MAX_FETCH_LIMIT = 200;

function scopeKey(filters = {}) {
  return JSON.stringify({
    query: String(filters.query || "").trim(),
    views: [...(filters.views || [])].sort(),
    types: [...(filters.types || [])].sort(),
    catalogs: [...(filters.catalogs || [])].sort(),
    domains: [...(filters.domains || [])].sort(),
    tiers: [...(filters.tiers || [])].sort(),
    certifications: [...(filters.certifications || [])].sort(),
    sensitivities: [...(filters.sensitivities || [])].sort(),
    sortBy: String(filters.sortBy || ""),
  });
}

function payloadAuthoritative(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (isNonAuthoritativeMockEvidence(payload, payload.meta, payload.queryState, payload.warnings)) return false;
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  const state = String(meta.state || meta.discoveryState || payload.state || "").trim().toLowerCase();
  const source = String(meta.source || payload.source || "").trim().toLowerCase();
  if (state === "prototype_mock" || source === "local-prototype-mock") return false;
  if (typeof payload.authoritative === "boolean") return payload.authoritative;
  if (typeof meta.authoritative === "boolean") return meta.authoritative;
  return ["authoritative", "live"].includes(state);
}

function payloadPrototypeMock(payload) {
  if (!payload || typeof payload !== "object") return false;
  return isNonAuthoritativeMockEvidence(payload, payload.meta, payload.queryState, payload.warnings);
}

function discoveryRefetchInterval(query) {
  const payload = query?.state?.data;
  const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
  const state = String(meta.state || meta.discoveryState || payload?.queryState?.state || "").trim().toLowerCase();
  return state === "loading" || meta.inventoryHydrating === true ? 3_000 : false;
}

export function useDiscoveryResults(filters, options = {}) {
  const normalizedFilters = useMemo(
    () => ({
      query: String(filters?.query || "").trim(),
      views: [...(filters?.views || [])].sort(),
      types: [...(filters?.types || [])].sort(),
      catalogs: [...(filters?.catalogs || [])].sort(),
      domains: [...(filters?.domains || [])].sort(),
      tiers: [...(filters?.tiers || [])].sort(),
      certifications: [...(filters?.certifications || [])].sort(),
      sensitivities: [...(filters?.sensitivities || [])].sort(),
      sortBy: String(filters?.sortBy || ""),
    }),
    [
      filters?.catalogs,
      filters?.certifications,
      filters?.domains,
      filters?.query,
      filters?.sensitivities,
      filters?.sortBy,
      filters?.tiers,
      filters?.types,
      filters?.views,
    ],
  );
  const currentScopeKey = scopeKey(normalizedFilters);
  const safeLimit = Math.max(
    1,
    Math.min(
      Number.isFinite(Number(options?.limit))
        ? Math.trunc(Number(options.limit))
        : DISCOVERY_DEFAULT_FETCH_LIMIT,
      DISCOVERY_MAX_FETCH_LIMIT,
    ),
  );
  const safeOffset = Math.max(
    0,
    Number.isFinite(Number(options?.offset)) ? Math.trunc(Number(options.offset)) : 0,
  );
  // Bootstrap seed — when the outer app hands us an initial assets array
  // (served by the app's SSR-ish bootstrap endpoint), use it to paint cards
  // IMMEDIATELY instead of sitting on an empty grid for the ~1-3s it takes
  // the structured search to round-trip. Only applies to the default
  // unfiltered scope because the seed reflects that scope.
  const seededAssets = useMemo(
    () => (Array.isArray(options?.seedAssets) ? options.seedAssets : []),
    [options?.seedAssets],
  );
  const seededCount = Number.isFinite(Number(options?.seedCount))
    ? Number(options.seedCount)
    : seededAssets.length;
  const seededScopeIsDefault =
    !normalizedFilters.query &&
    !normalizedFilters.views.length &&
    !normalizedFilters.types.length &&
    !normalizedFilters.catalogs.length &&
    !normalizedFilters.domains.length &&
    !normalizedFilters.tiers.length &&
    !normalizedFilters.certifications.length &&
    !normalizedFilters.sensitivities.length;
  const seededFacets = options?.seedFacets && typeof options.seedFacets === "object"
    ? options.seedFacets
    : null;
  const seededFallback = useMemo(
    () =>
      seededAssets.length && seededScopeIsDefault
        ? { assets: seededAssets, count: seededCount, facets: seededFacets }
        : { assets: [], count: 0, facets: null },
    [seededAssets, seededCount, seededFacets, seededScopeIsDefault],
  );
  const lastAuthoritativeResultRef = useRef({
    scopeKey: "",
    data: seededFallback,
  });
  const placeholderData =
    lastAuthoritativeResultRef.current.scopeKey === currentScopeKey
      ? lastAuthoritativeResultRef.current.data
      : seededFallback;
  // Round 19 OBO hardening: one-shot cache-bypass flag. When the user
  // clicks "Retry with actor scope" on the fallback banner, we send
  // ?refresh=1 on the next fetch so the server evicts the per-actor
  // inventory cache and re-attempts OBO from scratch. The flag resets
  // after the fetch resolves so normal caching resumes.
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["discoveryResults", currentScopeKey, safeLimit, safeOffset, pendingRefresh ? "force" : "cache"],
    queryFn: ({ signal }) =>
      fetchDiscoverySearch(
        {
          ...normalizedFilters,
          queryMode: "structured",
          limit: safeLimit,
          offset: safeOffset,
          refresh: pendingRefresh,
        },
        { signal },
      ).finally(() => {
        if (pendingRefresh) setPendingRefresh(false);
      }),
    placeholderData,
    refetchInterval: options?.refetchInterval ?? discoveryRefetchInterval,
  });
  const refreshActorScope = useCallback(() => {
    setPendingRefresh(true);
    queryClient.invalidateQueries({ queryKey: ["discoveryResults"] });
  }, [queryClient]);
  const usingPlaceholder = query.isPlaceholderData === true;
  const currentPayloadPrototypeMock = query.isSuccess && !usingPlaceholder && payloadPrototypeMock(query.data);
  const assets = currentPayloadPrototypeMock ? [] : query.data?.assets || seededFallback.assets;
  const count = currentPayloadPrototypeMock ? 0 : typeof query.data?.count === "number" ? query.data.count : seededFallback.count;
  /** @type {{ status?: number, payload?: { invalidQuery?: { state?: string, message?: string, syntaxHint?: string, supportedFields?: string[] } } } | null} */
  const discoveryError =
    query.error && typeof query.error === "object"
      ? /** @type {{ status?: number, payload?: { invalidQuery?: { state?: string, message?: string, syntaxHint?: string, supportedFields?: string[] } } }} */ (query.error)
      : null;
  const invalidQuery =
    query.isError && discoveryError?.status === 400 && discoveryError?.payload?.invalidQuery
      ? discoveryError.payload.invalidQuery
      : null;

  const currentPayloadAuthoritative = !currentPayloadPrototypeMock && payloadAuthoritative(query.data);
  const currentMeta = query.data?.meta && typeof query.data.meta === "object" ? query.data.meta : null;
  const currentMetaState = String(
    currentMeta?.state ||
      currentMeta?.discoveryState ||
      query.data?.queryState?.state ||
      "",
  ).trim().toLowerCase();
  const inventoryHydrating = currentMetaState === "loading" || currentMeta?.inventoryHydrating === true;

  useEffect(() => {
    if (query.isSuccess && !usingPlaceholder && currentPayloadAuthoritative) {
      lastAuthoritativeResultRef.current = {
        scopeKey: currentScopeKey,
        data: query.data || seededFallback,
      };
    }
  }, [currentPayloadAuthoritative, currentScopeKey, query.data, query.isSuccess, seededFallback, usingPlaceholder]);

  return {
    loading: query.isPending || (query.isFetching && usingPlaceholder) || inventoryHydrating,
    error:
      query.isError && !invalidQuery
        ? query.error?.message || "Failed to search metadata assets."
        : "",
    assets,
    count,
    facets: currentPayloadPrototypeMock ? null : query.data?.facets || seededFallback.facets,
    queryState: invalidQuery || (currentPayloadPrototypeMock ? { state: "unavailable", message: "Non-authoritative discovery payload rejected." } : query.data?.queryState) || null,
    // Expose the envelope `meta` block so downstream surfaces (diagnostics
    // strip for A1.4) can read the fine-grained discoveryState vocabulary
    // and observedAt timestamp without refetching.
    meta:
      currentMeta,
    oboScopeFallback: Boolean(query.data?.meta?.oboScopeFallback),
    oboFallbackReason: query.data?.meta?.oboFallbackReason || "",
    refreshActorScope,
    refreshing: query.isFetching,
    requestKey: currentScopeKey,
    fetching: query.isFetching,
    fetchLimit: safeLimit,
    settled: query.isError || (query.isSuccess && !usingPlaceholder && !inventoryHydrating),
    authoritative: query.isSuccess && !usingPlaceholder && currentPayloadAuthoritative,
  };
}
