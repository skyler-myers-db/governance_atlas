import { useEffect, useRef, useState } from "react";
import { fetchLineage } from "../lib/api";

export function useLineage(assetFqn, seededGraph = null, enabled = true) {
  const previousAssetRef = useRef(assetFqn);
  const [state, setState] = useState({
    loading: false,
    error: "",
    graph: seededGraph,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, error: "", graph: seededGraph || null });
      return;
    }

    if (!assetFqn) {
      setState({ loading: false, error: "", graph: null });
      return;
    }

    let canceled = false;
    const assetChanged = previousAssetRef.current !== assetFqn;
    previousAssetRef.current = assetFqn;
    setState((current) => ({
      loading: true,
      error: "",
      graph: assetChanged ? seededGraph || current.graph || null : current.graph || seededGraph || null,
    }));
    fetchLineage(assetFqn)
      .then((payload) => {
        if (canceled) return;
        setState({ loading: false, error: "", graph: payload.graphs || null });
      })
      .catch((error) => {
        if (canceled) return;
        setState((prev) => ({
          loading: false,
          error: error?.message || "Failed to load lineage.",
          graph: prev.graph || seededGraph || null,
        }));
      });

    return () => {
      canceled = true;
    };
  }, [assetFqn, enabled, seededGraph]);

  return state;
}
