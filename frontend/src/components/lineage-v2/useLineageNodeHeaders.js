/**
 * useLineageNodeHeaders — batch-fetch asset header detail for every node
 * in the lineage graph so each node card can render UC-grade per-node
 * detail (size, freshness, type, owner, state) instead of the bare
 * "Table" footer the lineage payload alone provides.
 *
 * The lineage API (system.access.table_lineage) genuinely doesn't carry
 * rows/freshness/owner/state. Those fields live on
 * /api/assets/<fqn>?sections=header. To match Databricks UC's native
 * lineage UX, every visible node card needs a header fetch. This hook
 * batches that — one query per FQN, parallel fetch, results memoized
 * into a Map keyed by FQN.
 *
 * The hook is rate-limit conscious: it caps the parallel fetch at
 * MAX_PARALLEL so N=20-node graphs don't fan out into 20 concurrent
 * warehouse calls. Beyond the cap, FQNs queue and resolve in the next
 * batch.
 *
 * Returns: { headers: Map<fqn, headerObject>, loading: boolean }
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAssetDetail } from "../../lib/api";

const MAX_PARALLEL = 8;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — header rarely changes intra-session

// Module-scoped cache so multiple LineageWorkspace mounts share results
// across route changes without re-fetching identical FQNs.
const moduleHeaderCache = new Map(); // fqn -> { fetchedAt, header }
const moduleInflight = new Map(); // fqn -> Promise<header>

function fetchHeader(fqn) {
  const now = Date.now();
  const cached = moduleHeaderCache.get(fqn);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached.header);
  }
  const inflight = moduleInflight.get(fqn);
  if (inflight) return inflight;
  const promise = fetchAssetDetail(fqn, { sections: ["header"] })
    .then((payload) => {
      const detail = payload?.data || payload?.detail || payload || {};
      moduleHeaderCache.set(fqn, { fetchedAt: Date.now(), header: detail });
      moduleInflight.delete(fqn);
      return detail;
    })
    .catch((error) => {
      moduleInflight.delete(fqn);
      // Cache the failure briefly so we don't hammer a 404'd FQN every render.
      moduleHeaderCache.set(fqn, { fetchedAt: Date.now(), header: { error: error?.message || "fetch failed" } });
      return { error: error?.message || "fetch failed" };
    });
  moduleInflight.set(fqn, promise);
  return promise;
}

async function batchFetch(fqnsToFetch, onResolve) {
  // Process in chunks of MAX_PARALLEL; resolve callbacks fire as each
  // header lands so the UI can incrementally fill in the cards.
  for (let i = 0; i < fqnsToFetch.length; i += MAX_PARALLEL) {
    const chunk = fqnsToFetch.slice(i, i + MAX_PARALLEL);
    await Promise.all(
      chunk.map(async (fqn) => {
        const header = await fetchHeader(fqn);
        onResolve(fqn, header);
      }),
    );
  }
}

export function useLineageNodeHeaders(fqns = []) {
  const [headerMap, setHeaderMap] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const cancelTokenRef = useRef(0);

  // Stable cache key from the sorted, deduped FQN list.
  const fqnKey = useMemo(() => {
    const unique = Array.from(new Set((fqns || []).filter(Boolean))).sort();
    return unique.join("|");
  }, [fqns]);

  useEffect(() => {
    const unique = Array.from(new Set((fqns || []).filter(Boolean)));
    if (!unique.length) {
      setHeaderMap(new Map());
      setLoading(false);
      return undefined;
    }

    // Seed from module cache immediately for cards we already have.
    const seeded = new Map();
    const toFetch = [];
    const now = Date.now();
    unique.forEach((fqn) => {
      const cached = moduleHeaderCache.get(fqn);
      if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        seeded.set(fqn, cached.header);
      } else {
        toFetch.push(fqn);
      }
    });
    if (seeded.size) setHeaderMap(seeded);

    if (!toFetch.length) {
      setLoading(false);
      return undefined;
    }

    cancelTokenRef.current += 1;
    const myToken = cancelTokenRef.current;
    setLoading(true);

    batchFetch(toFetch, (fqn, header) => {
      if (cancelTokenRef.current !== myToken) return;
      setHeaderMap((current) => {
        const next = new Map(current);
        next.set(fqn, header);
        return next;
      });
    }).finally(() => {
      if (cancelTokenRef.current === myToken) setLoading(false);
    });

    return () => {
      // Bumping the token invalidates the resolver — pending fetches still
      // populate the module cache but won't write into stale state.
      cancelTokenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fqnKey]);

  return { headers: headerMap, loading };
}

export default useLineageNodeHeaders;
