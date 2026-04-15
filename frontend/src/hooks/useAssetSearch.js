import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDiscoverySearch } from "../lib/api";
import { govhubQueryClient } from "../lib/queryClient";

export function clearAssetSearchCache() {
  govhubQueryClient.removeQueries({ queryKey: ["assetSearch"] });
  govhubQueryClient.invalidateQueries({ queryKey: ["discoveryResults"] });
  govhubQueryClient.invalidateQueries({ queryKey: ["bootstrap"] });
}

function normalizeSearchText(...values) {
  return values
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localSearchScore(asset, trimmedQuery) {
  const queryText = normalizeSearchText(trimmedQuery);
  if (!queryText) return 0;
  const terms = queryText.split(" ").filter(Boolean);
  const haystack = normalizeSearchText(
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
  );
  if (!terms.every((term) => haystack.includes(term))) return 0;

  const name = normalizeSearchText(asset?.name);
  const fqn = normalizeSearchText(asset?.fqn);
  let score = 0;
  if (name.includes(queryText)) score += 8;
  else if (terms.every((term) => name.includes(term))) score += 5;
  if (fqn.includes(queryText)) score += 5;
  else if (terms.every((term) => fqn.includes(term))) score += 3;
  score += terms.length;
  return score;
}

function localMatches(seedAssets, trimmedQuery, limit = 8) {
  if (!trimmedQuery) return [];
  return [...(seedAssets || [])]
    .map((asset) => ({
      asset,
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
  const seededSignature = (seedAssets || [])
    .map((asset) => asset?.fqn || "")
    .filter(Boolean)
    .join("|");
  const seededMatches = useMemo(
    () => localMatches(seedAssets, trimmedQuery, 8),
    [seedAssets, trimmedQuery],
  );
  const queryState = useQuery({
    queryKey: ["assetSearch", cacheKeyForQuery(trimmedQuery), seededSignature],
    enabled: enabled && Boolean(trimmedQuery),
    queryFn: ({ signal }) =>
      fetchDiscoverySearch(
        {
          query: trimmedQuery,
          sortBy: "Best match",
          limit: 8,
        },
        { signal },
      ),
    placeholderData: {
      assets: seededMatches,
      count: seededMatches.length,
    },
  });
  const assets = trimmedQuery
    ? mergeAssets(queryState.data?.assets || [], seededMatches, 8)
    : [];

  return {
    loading: enabled && Boolean(trimmedQuery) ? queryState.isPending || (queryState.isFetching && !assets.length) : false,
    error:
      queryState.isError && !assets.length
        ? queryState.error?.message || "Failed to search assets."
        : "",
    assets,
    resolvedQuery: enabled && Boolean(trimmedQuery) ? trimmedQuery : "",
  };
}
