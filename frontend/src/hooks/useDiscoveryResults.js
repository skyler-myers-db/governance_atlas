import { useEffect, useState } from "react";
import { fetchDiscoverySearch } from "../lib/api";

export function useDiscoveryResults(filters, seededAssets = []) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    assets: seededAssets,
    count: seededAssets.length,
    facets: null,
    selection: {
      primaryAssetFqn: seededAssets[0]?.fqn || "",
      reason: seededAssets.length ? "bootstrap" : "none",
    },
  });

  useEffect(() => {
    let canceled = false;
    const timeout = setTimeout(() => {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      fetchDiscoverySearch({
        query: filters.query,
        view: filters.view,
        type: filters.type,
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
            selection: payload.selection || {
              primaryAssetFqn: payload.assets?.[0]?.fqn || "",
              reason: payload.assets?.length ? "top_result" : "none",
            },
          });
        })
        .catch((error) => {
          if (canceled) return;
          setState((prev) => ({
            ...prev,
            loading: false,
            error: error?.message || "Failed to search metadata assets.",
          }));
        });
    }, 180);

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
    filters.type,
    filters.view,
  ]);

  return state;
}
