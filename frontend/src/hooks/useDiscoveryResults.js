import { useEffect, useState } from "react";
import { fetchDiscoverySearch } from "../lib/api";

export function useDiscoveryResults(filters, seededAssets = []) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    assets: seededAssets,
    count: seededAssets.length,
    facets: null,
  });

  useEffect(() => {
    let canceled = false;
    const timeout = setTimeout(() => {
      setState((current) => ({
        loading: true,
        error: "",
        assets: current.assets?.length ? current.assets : seededAssets,
        count: current.assets?.length ? current.count : seededAssets.length,
        facets: current.facets,
      }));
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
          });
        })
        .catch((error) => {
          if (canceled) return;
          setState({
            loading: false,
            error: error?.message || "Failed to search metadata assets.",
            assets: [],
            count: 0,
            facets: null,
          });
        });
    }, 60);

    return () => {
      canceled = true;
      clearTimeout(timeout);
    };
  }, [
    filters.catalogs,
    filters.certifications,
    filters.domains,
    filters.query,
    filters.sensitivities,
    filters.sortBy,
    filters.tiers,
    filters.types,
    filters.views,
  ]);

  return state;
}
