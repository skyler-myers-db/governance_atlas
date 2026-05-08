/**
 * useLineageNodeHeaders — hydrate bounded lineage card headers from the
 * lightweight /api/assets/headers batch endpoint. The lineage API carries
 * graph truth; this hook only fills in cheap card metadata from the visible
 * inventory when available. Missing rows remain visibly sparse instead of
 * causing N full asset-detail requests on every graph load.
 *
 * Returns: { headers: Map<fqn, headerObject>, loading: boolean }
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAssetHeaders } from "../../lib/api";

const MAX_NODE_HEADERS = 18;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — header rarely changes intra-session

// Module-scoped cache so multiple LineageWorkspace mounts share results
// across route changes without re-fetching identical FQNs.
const moduleHeaderCache = new Map(); // fqn -> { fetchedAt, header }
const moduleInflight = new Map(); // key -> Promise<Map<fqn, header>>

function batchKey(fqns) {
  return [...fqns].sort().join("|");
}

function fetchHeaderBatch(fqns) {
  const targets = [...new Set((fqns || []).filter(Boolean))].slice(0, MAX_NODE_HEADERS);
  if (!targets.length) return Promise.resolve(new Map());
  const key = batchKey(targets);
  const inflight = moduleInflight.get(key);
  if (inflight) return inflight;
  const promise = fetchAssetHeaders(targets)
    .then((payload) => {
      const assets = payload?.assets && typeof payload.assets === "object" ? payload.assets : {};
      const resolved = new Map();
      targets.forEach((fqn) => {
        const header = assets[fqn] || { fqn, error: "header unavailable" };
        moduleHeaderCache.set(fqn, { fetchedAt: Date.now(), header });
        resolved.set(fqn, header);
      });
      moduleInflight.delete(key);
      return resolved;
    })
    .catch((error) => {
      const resolved = new Map();
      targets.forEach((fqn) => {
        const header = { fqn, error: error?.message || "fetch failed" };
        moduleHeaderCache.set(fqn, { fetchedAt: Date.now(), header });
        resolved.set(fqn, header);
      });
      moduleInflight.delete(key);
      return resolved;
    });
  moduleInflight.set(key, promise);
  return promise;
}

function splitCachedHeaders(fqns) {
  const seeded = new Map();
  const toFetch = [];
  const now = Date.now();
  fqns.forEach((fqn) => {
    const cached = moduleHeaderCache.get(fqn);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      seeded.set(fqn, cached.header);
    } else {
      toFetch.push(fqn);
    }
  });
  return { seeded, toFetch };
}

export function useLineageNodeHeaders(fqns = []) {
  const [headerMap, setHeaderMap] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const cancelTokenRef = useRef(0);

  // Stable cache key from the sorted, deduped, capped FQN list.
  const cappedFqns = useMemo(
    () => Array.from(new Set((fqns || []).filter(Boolean))).slice(0, MAX_NODE_HEADERS),
    [fqns],
  );
  const fqnKey = useMemo(() => batchKey(cappedFqns), [cappedFqns]);

  useEffect(() => {
    if (!cappedFqns.length) {
      setHeaderMap(new Map());
      setLoading(false);
      return undefined;
    }

    const { seeded, toFetch } = splitCachedHeaders(cappedFqns);
    setHeaderMap(seeded);

    if (!toFetch.length) {
      setLoading(false);
      return undefined;
    }

    cancelTokenRef.current += 1;
    const myToken = cancelTokenRef.current;
    setLoading(true);

    fetchHeaderBatch(toFetch).then((headers) => {
      if (cancelTokenRef.current !== myToken) return;
      setHeaderMap((current) => {
        const next = new Map(current);
        headers.forEach((header, fqn) => {
          next.set(fqn, header);
        });
        return next;
      });
    }).finally(() => {
      if (cancelTokenRef.current === myToken) setLoading(false);
    });

    return () => {
      cancelTokenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fqnKey]);

  return { headers: headerMap, loading };
}

export default useLineageNodeHeaders;
