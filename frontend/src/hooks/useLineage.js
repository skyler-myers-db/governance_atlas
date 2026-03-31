import { useEffect, useRef, useState } from "react";
import { fetchLineage } from "../lib/api";

export function useLineage(assetFqn, seededGraph = null, enabled = true) {
  const previousAssetRef = useRef(assetFqn);
  const [state, setState] = useState({
    loading: false,
    error: "",
    graph: seededGraph,
    payload: seededGraph ? { graphs: seededGraph } : null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({
        loading: false,
        error: "",
        graph: seededGraph || null,
        payload: seededGraph ? { graphs: seededGraph } : null,
      });
      return;
    }

    if (!assetFqn) {
      setState({ loading: false, error: "", graph: null, payload: null });
      return;
    }

    let canceled = false;
    const assetChanged = previousAssetRef.current !== assetFqn;
    previousAssetRef.current = assetFqn;
    setState((current) => ({
      loading: true,
      error: "",
      graph: assetChanged ? seededGraph || null : current.graph || seededGraph || null,
      payload:
        assetChanged
          ? seededGraph
            ? { graphs: seededGraph }
            : null
          : current.payload || (seededGraph ? { graphs: seededGraph } : null),
    }));
    fetchLineage(assetFqn)
      .then((payload) => {
        if (canceled) return;
        setState({
          loading: false,
          error: "",
          graph: payload.graphs || null,
          payload: payload || null,
        });
      })
      .catch((error) => {
        if (canceled) return;
        setState((prev) => ({
          loading: false,
          error: error?.message || "Failed to load lineage.",
          graph: prev.graph || seededGraph || null,
          payload: prev.payload || (seededGraph ? { graphs: seededGraph } : null),
        }));
      });

    return () => {
      canceled = true;
    };
  }, [assetFqn, enabled, seededGraph]);

  return state;
}
