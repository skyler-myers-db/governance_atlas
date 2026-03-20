import { useEffect, useState } from "react";
import { fetchDiscoverySearch } from "../lib/api";

export function useAssetSearch(query, enabled = true) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    assets: [],
  });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, error: "", assets: [] });
      return;
    }

    let canceled = false;
    const timeout = setTimeout(() => {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      fetchDiscoverySearch({
        query,
        sortBy: "Best match",
        limit: query ? 8 : 6,
      })
        .then((payload) => {
          if (canceled) return;
          setState({
            loading: false,
            error: "",
            assets: payload.assets || [],
          });
        })
        .catch((error) => {
          if (canceled) return;
          setState({
            loading: false,
            error: error?.message || "Failed to search assets.",
            assets: [],
          });
        });
    }, 160);

    return () => {
      canceled = true;
      clearTimeout(timeout);
    };
  }, [enabled, query]);

  return state;
}
