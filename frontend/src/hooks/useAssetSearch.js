import { useEffect, useState } from "react";
import { fetchDiscoverySearch } from "../lib/api";

export function useAssetSearch(query, enabled = true) {
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
    setState((prev) => ({
      loading: false,
      assets: prev.resolvedQuery === trimmedQuery ? prev.assets : [],
      error: "",
      resolvedQuery: prev.resolvedQuery === trimmedQuery ? prev.resolvedQuery : "",
    }));
    const timeout = setTimeout(() => {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      fetchDiscoverySearch({
        query: trimmedQuery,
        sortBy: "Best match",
        limit: 8,
      })
        .then((payload) => {
          if (canceled) return;
          setState({
            loading: false,
            error: "",
            assets: payload.assets || [],
            resolvedQuery: trimmedQuery,
          });
        })
        .catch((error) => {
          if (canceled) return;
          setState({
            loading: false,
            error: error?.message || "Failed to search assets.",
            assets: [],
            resolvedQuery: "",
          });
        });
    }, 90);

    return () => {
      canceled = true;
      clearTimeout(timeout);
    };
  }, [enabled, query]);

  return state;
}
