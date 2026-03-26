import { useEffect, useState } from "react";
import { fetchAssetDetail } from "../lib/api";

const ASSET_DETAIL_CACHE = new Map();

function readCachedDetail(assetFqn) {
  if (!assetFqn) return null;
  return ASSET_DETAIL_CACHE.get(assetFqn)?.detail || null;
}

function rememberDetail(assetFqn, detail) {
  if (!assetFqn || !detail) return;
  ASSET_DETAIL_CACHE.set(assetFqn, {
    detail,
    updatedAt: Date.now(),
  });
}

export function useAssetDetail(assetFqn) {
  const [state, setState] = useState(() => ({
    loading: false,
    error: "",
    detail: readCachedDetail(assetFqn),
  }));

  useEffect(() => {
    if (!assetFqn) {
      setState({ loading: false, error: "", detail: null });
      return;
    }

    let canceled = false;
    const cachedDetail = readCachedDetail(assetFqn);
    setState((current) => ({
      loading: true,
      error: "",
      detail: cachedDetail || (current.detail?.fqn === assetFqn ? current.detail : null),
    }));
    fetchAssetDetail(assetFqn)
      .then((detail) => {
        if (canceled) return;
        rememberDetail(assetFqn, detail);
        setState({ loading: false, error: "", detail });
      })
      .catch((error) => {
        if (canceled) return;
        setState((current) => ({
          loading: false,
          error:
            cachedDetail || current.detail?.fqn === assetFqn
              ? ""
              : error?.message || "Failed to load asset detail.",
          detail:
            cachedDetail || (current.detail?.fqn === assetFqn ? current.detail : null),
        }));
      });

    return () => {
      canceled = true;
    };
  }, [assetFqn]);

  return state;
}
