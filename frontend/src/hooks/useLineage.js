import { useEffect, useState } from "react";
import { fetchLineage } from "../lib/api";

export function useLineage(assetFqn) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    graph: null,
  });

  useEffect(() => {
    if (!assetFqn) {
      setState({ loading: false, error: "", graph: null });
      return;
    }

    let canceled = false;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    fetchLineage(assetFqn)
      .then((payload) => {
        if (canceled) return;
        setState({ loading: false, error: "", graph: payload.graphs || null });
      })
      .catch((error) => {
        if (canceled) return;
        setState({
          loading: false,
          error: error?.message || "Failed to load lineage.",
          graph: null,
        });
      });

    return () => {
      canceled = true;
    };
  }, [assetFqn]);

  return state;
}
