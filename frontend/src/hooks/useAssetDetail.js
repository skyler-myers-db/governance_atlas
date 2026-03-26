import { useEffect, useState } from "react";
import { fetchAssetDetail } from "../lib/api";

export function useAssetDetail(assetFqn) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    detail: null,
  });

  useEffect(() => {
    if (!assetFqn) {
      setState({ loading: false, error: "", detail: null });
      return;
    }

    let canceled = false;
    setState((current) => ({
      loading: true,
      error: "",
      detail: current.detail?.fqn === assetFqn ? current.detail : null,
    }));
    fetchAssetDetail(assetFqn)
      .then((detail) => {
        if (canceled) return;
        setState({ loading: false, error: "", detail });
      })
      .catch((error) => {
        if (canceled) return;
        setState((current) => ({
          loading: false,
          error: error?.message || "Failed to load asset detail.",
          detail: current.detail?.fqn === assetFqn ? current.detail : null,
        }));
      });

    return () => {
      canceled = true;
    };
  }, [assetFqn]);

  return state;
}
