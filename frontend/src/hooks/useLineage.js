import { useEffect, useRef, useState } from "react";
import { fetchLineage } from "../lib/api";

const LINEAGE_CACHE_TTL_MS = 45_000;
const LINEAGE_CACHE = new Map();
const LINEAGE_IN_FLIGHT = new Map();
const LINEAGE_EVENT = "gh:lineage-updated";

function readCachedLineage(assetFqn, { maxAgeMs = LINEAGE_CACHE_TTL_MS } = {}) {
  if (!assetFqn) return null;
  const cached = LINEAGE_CACHE.get(assetFqn);
  if (!cached) return null;
  if (maxAgeMs !== null && Date.now() - cached.timestamp > maxAgeMs) {
    LINEAGE_CACHE.delete(assetFqn);
    return null;
  }
  return cached.payload || null;
}

function rememberLineage(assetFqn, payload) {
  if (!assetFqn || !payload) return payload;
  LINEAGE_CACHE.set(assetFqn, {
    timestamp: Date.now(),
    payload,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(LINEAGE_EVENT, {
        detail: { assetFqn },
      }),
    );
  }
  return payload;
}

function lineageRequest(assetFqn) {
  if (!assetFqn) return Promise.resolve(null);
  if (LINEAGE_IN_FLIGHT.has(assetFqn)) {
    return LINEAGE_IN_FLIGHT.get(assetFqn);
  }
  const request = fetchLineage(assetFqn)
    .then((payload) => {
      LINEAGE_IN_FLIGHT.delete(assetFqn);
      return rememberLineage(assetFqn, payload);
    })
    .catch((error) => {
      LINEAGE_IN_FLIGHT.delete(assetFqn);
      throw error;
    });
  LINEAGE_IN_FLIGHT.set(assetFqn, request);
  return request;
}

export function primeLineagePayload(assetFqn, payload) {
  return rememberLineage(assetFqn, payload);
}

export function prefetchLineage(assetFqn, options = {}) {
  if (!assetFqn) return Promise.resolve(null);
  const force = options.force === true;
  const cached = force ? null : readCachedLineage(assetFqn);
  if (cached) return Promise.resolve(cached);
  return lineageRequest(assetFqn).catch(() => readCachedLineage(assetFqn, { maxAgeMs: null }) || null);
}

export function useLineage(assetFqn, seededGraph = null, enabled = true) {
  const previousAssetRef = useRef(assetFqn);
  const cachedPayload = readCachedLineage(assetFqn);
  const cachedGraph = cachedPayload?.graphs || null;
  const [state, setState] = useState({
    loading: false,
    error: "",
    graph: cachedGraph || seededGraph,
    payload: cachedPayload || (seededGraph ? { graphs: seededGraph } : null),
  });

  useEffect(() => {
    if (!enabled) {
      const cached = readCachedLineage(assetFqn);
      setState({
        loading: false,
        error: "",
        graph: cached?.graphs || seededGraph || null,
        payload: cached || (seededGraph ? { graphs: seededGraph } : null),
      });
      return;
    }

    if (!assetFqn) {
      setState({ loading: false, error: "", graph: null, payload: null });
      return;
    }

    let canceled = false;
    const assetChanged = previousAssetRef.current !== assetFqn;
    const cached = readCachedLineage(assetFqn);
    const fallbackPayload = cached || (seededGraph ? { graphs: seededGraph } : null);
    const fallbackGraph = fallbackPayload?.graphs || null;
    previousAssetRef.current = assetFqn;
    setState((current) => ({
      loading: !(current.graph || fallbackGraph),
      error: "",
      graph: assetChanged
        ? fallbackGraph
        : current.graph || fallbackGraph,
      payload:
        assetChanged
          ? fallbackPayload
          : current.payload || fallbackPayload,
    }));
    lineageRequest(assetFqn)
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
          graph: prev.graph || cached?.graphs || seededGraph || null,
          payload: prev.payload || cached || (seededGraph ? { graphs: seededGraph } : null),
        }));
      });

    return () => {
      canceled = true;
    };
  }, [assetFqn, enabled, seededGraph]);

  useEffect(() => {
    if (typeof window === "undefined" || !assetFqn) return undefined;
    const onLineageUpdated = (event) => {
      if (event?.detail?.assetFqn !== assetFqn) return;
      const cached = readCachedLineage(assetFqn, { maxAgeMs: null });
      if (!cached) return;
      setState({
        loading: false,
        error: "",
        graph: cached.graphs || null,
        payload: cached,
      });
    };
    window.addEventListener(LINEAGE_EVENT, onLineageUpdated);
    return () => {
      window.removeEventListener(LINEAGE_EVENT, onLineageUpdated);
    };
  }, [assetFqn]);

  return state;
}
