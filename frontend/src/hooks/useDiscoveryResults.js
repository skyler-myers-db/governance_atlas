import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDiscoverySearch } from "../lib/api";

function requestKey(filters = {}) {
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

function canSeedFromBootstrap(filters = {}) {
  const query = String(filters.query || "").trim();
  if (query) return false;
  if ((filters.views || []).length) return false;
  if ((filters.types || []).length) return false;
  if ((filters.catalogs || []).length) return false;
  if ((filters.domains || []).length) return false;
  if ((filters.tiers || []).length) return false;
  if ((filters.certifications || []).length) return false;
  if ((filters.sensitivities || []).length) return false;
  return !filters.sortBy || filters.sortBy === "Best match";
}

export function useDiscoveryResults(filters, seededAssets = []) {
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
  const currentRequestKey = requestKey(normalizedFilters);
  const seededSignature = (seededAssets || [])
    .map((asset) => asset?.fqn || "")
    .filter(Boolean)
    .join("|");
  const seededFallback = useMemo(() => {
    const useSeeded = canSeedFromBootstrap(normalizedFilters);
    const assets = useSeeded ? seededAssets : [];
    return {
      assets,
      count: assets.length,
      facets: null,
    };
  }, [normalizedFilters, seededAssets]);
  const query = useQuery({
    queryKey: ["discoveryResults", currentRequestKey, seededSignature],
    queryFn: ({ signal }) =>
      fetchDiscoverySearch(
        {
          ...normalizedFilters,
          limit: 80,
        },
        { signal },
    ),
    placeholderData: seededFallback,
  });
  const usingPlaceholder = query.isPlaceholderData === true;
  const assets = query.data?.assets || seededFallback.assets;
  const count = typeof query.data?.count === "number" ? query.data.count : seededFallback.count;

  return {
    loading: query.isPending || (query.isFetching && usingPlaceholder),
    error: query.isError ? query.error?.message || "Failed to search metadata assets." : "",
    assets,
    count,
    facets: query.data?.facets || seededFallback.facets,
    requestKey: currentRequestKey,
    seededSignature,
    settled: query.isError || (query.isSuccess && !usingPlaceholder),
    authoritative: query.isSuccess && !usingPlaceholder,
  };
}
