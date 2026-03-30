import { useEffect, useState } from "react";
import { fetchDiscoverySearch } from "../lib/api";

const SEARCH_CACHE = new Map();

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
  const [state, setState] = useState({
    loading: false,
    error: "",
    assets: [],
    resolvedQuery: "",
  });

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!enabled) {
      setState({ loading: false, error: "", assets: [], resolvedQuery: "" });
      return;
    }

    if (!trimmedQuery) {
      setState({ loading: false, error: "", assets: [], resolvedQuery: "" });
      return;
    }

    let canceled = false;
    const cacheKey = cacheKeyForQuery(trimmedQuery);
    const seededMatches = localMatches(seedAssets, trimmedQuery, 8);
    const cachedMatches = SEARCH_CACHE.get(cacheKey) || [];
    const initialMatches = mergeAssets(cachedMatches, seededMatches, 8);
    setState((prev) => ({
      loading: !initialMatches.length,
      assets:
        initialMatches.length
          ? initialMatches
          : prev.resolvedQuery === trimmedQuery
            ? prev.assets
            : [],
      error: "",
      resolvedQuery: trimmedQuery,
    }));
    const timeout = setTimeout(() => {
      fetchDiscoverySearch({
        query: trimmedQuery,
        sortBy: "Best match",
        limit: 8,
      })
        .then((payload) => {
          if (canceled) return;
          const assets = mergeAssets(payload.assets || [], seededMatches, 8);
          SEARCH_CACHE.set(cacheKey, assets);
          setState({
            loading: false,
            error: "",
            assets,
            resolvedQuery: trimmedQuery,
          });
        })
        .catch((error) => {
          if (canceled) return;
          setState({
            loading: false,
            error: seededMatches.length ? "" : error?.message || "Failed to search assets.",
            assets: seededMatches,
            resolvedQuery: trimmedQuery,
          });
        });
    }, cachedMatches.length ? 10 : 20);

    return () => {
      canceled = true;
      clearTimeout(timeout);
    };
  }, [enabled, query, seedAssets]);

  return state;
}
