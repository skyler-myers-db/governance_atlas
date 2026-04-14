import { useEffect, useState } from "react";
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
  const initialKey = requestKey(filters);
  const seededSignature = (seededAssets || [])
    .map((asset) => asset?.fqn || "")
    .filter(Boolean)
    .join("|");
  const [state, setState] = useState({
    loading: false,
    error: "",
    assets: canSeedFromBootstrap(filters) ? seededAssets : [],
    count: canSeedFromBootstrap(filters) ? seededAssets.length : 0,
    facets: null,
    requestKey: initialKey,
    seededSignature,
    settled: false,
    authoritative: false,
  });

  useEffect(() => {
    const nextRequestKey = requestKey(filters);
    const useSeeded = canSeedFromBootstrap(filters);
    let canceled = false;
    let timeoutId = 0;
    let idleId = 0;
    const fetchResults = () => {
      if (canceled) return;
      setState((current) => {
        const seededFallbackAssets = useSeeded ? seededAssets : [];
        const sameRequest = current.requestKey === nextRequestKey;
        return {
          loading: true,
          error: "",
          assets: sameRequest ? current.assets : seededFallbackAssets,
          count: sameRequest ? current.count : seededFallbackAssets.length,
          facets: sameRequest ? current.facets : null,
          requestKey: nextRequestKey,
          seededSignature,
          settled: sameRequest ? current.settled : false,
          authoritative: sameRequest ? current.authoritative : false,
        };
      });
      fetchDiscoverySearch({
        query: filters.query,
        views: filters.views,
        types: filters.types,
        catalogs: filters.catalogs,
        domains: filters.domains,
        tiers: filters.tiers,
        certifications: filters.certifications,
        sensitivities: filters.sensitivities,
        sortBy: filters.sortBy,
        limit: 80,
      })
        .then((payload) => {
          if (canceled) return;
          setState({
            loading: false,
            error: "",
            assets: payload.assets || [],
            count: payload.count || 0,
            facets: payload.facets || null,
            requestKey: nextRequestKey,
            seededSignature,
            settled: true,
            authoritative: true,
          });
        })
        .catch((error) => {
          if (canceled) return;
          setState((current) => {
            const fallbackAssets = current.assets?.length
              ? current.assets
              : useSeeded
                ? seededAssets
                : [];
            return {
              loading: false,
              error: error?.message || "Failed to search metadata assets.",
              assets: fallbackAssets,
              count: fallbackAssets.length ? current.count || fallbackAssets.length : 0,
              facets: current.facets || null,
              requestKey: nextRequestKey,
              seededSignature,
              settled: true,
              authoritative: false,
            };
          });
        });
    };

    if (useSeeded && typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(fetchResults, { timeout: 1600 });
    } else {
      timeoutId = setTimeout(fetchResults, useSeeded ? 180 : 60);
    }

    return () => {
      canceled = true;
      if (typeof window !== "undefined" && idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      clearTimeout(timeoutId);
    };
  }, [
    filters.catalogs,
    filters.certifications,
    filters.domains,
    filters.query,
    seededSignature,
    filters.sensitivities,
    filters.sortBy,
    filters.tiers,
    filters.types,
    filters.views,
  ]);

  return state;
}
