import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDiscoverySearch } from "../lib/api";

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
  const seededAssets = Array.isArray(options?.seedAssets) ? options.seedAssets : [];
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
  const query = useQuery({
    queryKey: ["discoveryResults", currentScopeKey, safeLimit, safeOffset],
    queryFn: ({ signal }) =>
      fetchDiscoverySearch(
        {
          ...normalizedFilters,
          queryMode: "structured",
          limit: safeLimit,
          offset: safeOffset,
        },
        { signal },
      ),
    placeholderData,
  });
  const usingPlaceholder = query.isPlaceholderData === true;
  const assets = query.data?.assets || seededFallback.assets;
  const count = typeof query.data?.count === "number" ? query.data.count : seededFallback.count;
  /** @type {{ status?: number, payload?: { invalidQuery?: { state?: string, message?: string, syntaxHint?: string, supportedFields?: string[] } } } | null} */
  const discoveryError =
    query.error && typeof query.error === "object"
      ? /** @type {{ status?: number, payload?: { invalidQuery?: { state?: string, message?: string, syntaxHint?: string, supportedFields?: string[] } } }} */ (query.error)
      : null;
  const invalidQuery =
    query.isError && discoveryError?.status === 400 && discoveryError?.payload?.invalidQuery
      ? discoveryError.payload.invalidQuery
      : null;

  useEffect(() => {
    if (query.isSuccess && !usingPlaceholder) {
      lastAuthoritativeResultRef.current = {
        scopeKey: currentScopeKey,
        data: query.data || seededFallback,
      };
    }
  }, [currentScopeKey, query.data, query.isSuccess, seededFallback, usingPlaceholder]);

  return {
    loading: query.isPending || (query.isFetching && usingPlaceholder),
    error:
      query.isError && !invalidQuery
        ? query.error?.message || "Failed to search metadata assets."
        : "",
    assets,
    count,
    facets: query.data?.facets || seededFallback.facets,
    queryState: invalidQuery || query.data?.queryState || null,
    requestKey: currentScopeKey,
    fetching: query.isFetching,
    fetchLimit: safeLimit,
    settled: query.isError || (query.isSuccess && !usingPlaceholder),
    authoritative: query.isSuccess && !usingPlaceholder,
  };
}
