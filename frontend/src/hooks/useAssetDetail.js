import { useEffect, useState } from "react";
import { fetchAssetDetail } from "../lib/api";

const ASSET_DETAIL_CACHE = new Map();
const ASSET_DETAIL_IN_FLIGHT = new Map();

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

function detailRequest(assetFqn) {
  if (!assetFqn) return Promise.resolve(null);
  if (ASSET_DETAIL_IN_FLIGHT.has(assetFqn)) {
    return ASSET_DETAIL_IN_FLIGHT.get(assetFqn);
  }
  const request = fetchAssetDetail(assetFqn)
    .then((detail) => {
      rememberDetail(assetFqn, detail);
      ASSET_DETAIL_IN_FLIGHT.delete(assetFqn);
      return detail;
    })
    .catch((error) => {
      ASSET_DETAIL_IN_FLIGHT.delete(assetFqn);
      throw error;
    });
  ASSET_DETAIL_IN_FLIGHT.set(assetFqn, request);
  return request;
}

export function prefetchAssetDetail(assetFqn) {
  if (!assetFqn) return Promise.resolve(null);
  const cachedDetail = readCachedDetail(assetFqn);
  if (cachedDetail) return Promise.resolve(cachedDetail);
  return detailRequest(assetFqn).catch(() => null);
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
    detailRequest(assetFqn)
      .then((detail) => {
        if (canceled) return;
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
