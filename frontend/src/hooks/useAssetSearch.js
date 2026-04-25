import { useDeferredValue, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDiscoverySearch } from "../lib/api";
import { atlasQueryClient } from "../lib/queryClient";

export function clearAssetSearchCache() {
  atlasQueryClient.removeQueries({ queryKey: ["assetSearch"] });
  atlasQueryClient.invalidateQueries({ queryKey: ["discoveryResults"] });
  atlasQueryClient.invalidateQueries({ queryKey: ["bootstrap"] });
}

function normalizeSearchText(...values) {
  return values
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchIndex(seedAssets = []) {
  return (seedAssets || [])
    .filter(Boolean)
    .map((asset) => ({
      asset,
      haystack: normalizeSearchText(
        asset?.fqn,
        asset?.name,
        asset?.catalog,
        asset?.schema,
        asset?.description,
        asset?.domain,
        asset?.tier,
        asset?.certification,
        asset?.sensitivity,
        asset?.objectType,
        ...(Array.isArray(asset?.glossaryTerms)
          ? asset.glossaryTerms.flatMap((term) => {
              if (typeof term === "string") return [term];
              const value = String(term?.term || term?.name || "").trim();
              return value ? [value] : [];
            })
          : []),
        ...(asset?.tags || []),
        ...((asset?.owners || []).flatMap((owner) => [owner?.name, owner?.email, owner?.title])),
      ),
      name: normalizeSearchText(asset?.name),
      fqn: normalizeSearchText(asset?.fqn),
    }));
}

function localSearchScore(indexEntry, trimmedQuery) {
  const queryText = normalizeSearchText(trimmedQuery);
  if (!queryText) return 0;
  const terms = queryText.split(" ").filter(Boolean);
  if (!terms.every((term) => indexEntry.haystack.includes(term))) return 0;

  let score = 0;
  if (indexEntry.name.includes(queryText)) score += 8;
  else if (terms.every((term) => indexEntry.name.includes(term))) score += 5;
  if (indexEntry.fqn.includes(queryText)) score += 5;
  else if (terms.every((term) => indexEntry.fqn.includes(term))) score += 3;
  score += terms.length;
  return score;
}

function localMatches(searchIndex, trimmedQuery, limit = 8) {
  if (!trimmedQuery) return [];
  return [...(searchIndex || [])]
    .map((asset) => ({
      asset: asset.asset,
      score: localSearchScore(asset, trimmedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.asset?.fqn || "").localeCompare(String(right.asset?.fqn || ""));
    })
    .slice(0, limit)
    .map((entry) => entry.asset);
}

function mergeAssets(primary = [], secondary = [], limit = 8) {
  const merged = [];
  const seen = new Set();
  [...(primary || []), ...(secondary || [])].forEach((asset) => {
    const key = asset?.fqn;
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(asset);
  });
  return merged.slice(0, limit);
}

function cacheKeyForQuery(query) {
  return normalizeSearchText(query);
}

export function useAssetSearch(query, enabled = true, seedAssets = []) {
  const trimmedQuery = query.trim();
  const deferredQuery = useDeferredValue(trimmedQuery);
  const searchIndex = useMemo(() => buildSearchIndex(seedAssets), [seedAssets]);
  const seededSignature = useMemo(
    () =>
      searchIndex
        .map((entry) => entry?.asset?.fqn || "")
        .filter(Boolean)
        .join("|"),
    [searchIndex],
  );
  const seededMatches = useMemo(
    () => localMatches(searchIndex, deferredQuery, 8),
    [deferredQuery, searchIndex],
  );
  const activeQuery = enabled ? deferredQuery : "";
  const matchesAreCurrent = deferredQuery === trimmedQuery;
  const queryState = useQuery({
    queryKey: ["assetSearch", cacheKeyForQuery(activeQuery), seededSignature],
    enabled: Boolean(activeQuery),
    queryFn: ({ signal }) =>
      fetchDiscoverySearch(
        {
          query: activeQuery,
          sortBy: "Best match",
          limit: 8,
        },
        { signal },
      ),
    placeholderData:
      matchesAreCurrent && seededMatches.length
        ? {
            assets: seededMatches,
            count: seededMatches.length,
          }
        : undefined,
  });
  const assets = trimmedQuery && matchesAreCurrent
    ? mergeAssets(queryState.data?.assets || [], matchesAreCurrent ? seededMatches : [], 8)
    : [];

  return {
    loading:
      enabled && Boolean(trimmedQuery)
        ? !matchesAreCurrent || queryState.isPending || (queryState.isFetching && !assets.length)
        : false,
    error:
      queryState.isError && !assets.length
        ? queryState.error?.message || "Failed to search assets."
        : "",
    assets,
    resolvedQuery: enabled && Boolean(trimmedQuery) ? activeQuery : "",
  };
}
