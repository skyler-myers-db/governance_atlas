import { useEffect, useMemo, useState } from "react";
import { fetchAssetAvailability, fetchAssetDetail } from "../lib/api";

const ASSET_DETAIL_CACHE = new Map();
const ASSET_DETAIL_IN_FLIGHT = new Map();
const ASSET_AVAILABILITY_CACHE = new Map();
const ASSET_AVAILABILITY_IN_FLIGHT = new Map();
const PLACEHOLDER_DESCRIPTION = "No description has been captured for this asset yet.";
const DETAIL_CACHE_TTL_MS = 20_000;
const AVAILABILITY_CACHE_TTL_MS = 10_000;

function readCachedEntry(cache, key, maxAgeMs = null) {
  if (!key) return null;
  const cached = cache.get(key);
  if (!cached) return null;
  if (maxAgeMs != null && Date.now() - cached.updatedAt > maxAgeMs) {
    return null;
  }
  return cached.detail || null;
}

function readCachedDetail(assetFqn, options = {}) {
  if (!assetFqn) return null;
  return readCachedEntry(ASSET_DETAIL_CACHE, assetFqn, options.maxAgeMs ?? DETAIL_CACHE_TTL_MS);
}

function rememberDetail(assetFqn, detail) {
  if (!assetFqn || !detail) return;
  ASSET_DETAIL_CACHE.set(assetFqn, {
    detail,
    updatedAt: Date.now(),
  });
}

function readCachedAvailability(assetFqn, options = {}) {
  if (!assetFqn) return null;
  return readCachedEntry(
    ASSET_AVAILABILITY_CACHE,
    assetFqn,
    options.maxAgeMs ?? AVAILABILITY_CACHE_TTL_MS,
  );
}

function rememberAvailability(assetFqn, detail) {
  if (!assetFqn || !detail) return;
  ASSET_AVAILABILITY_CACHE.set(assetFqn, {
    detail,
    updatedAt: Date.now(),
  });
}

function availabilityRequest(assetFqns) {
  const targets = [...new Set((assetFqns || []).filter(Boolean))];
  if (!targets.length) return Promise.resolve({});
  const requestKey = targets.slice().sort().join("|");
  if (ASSET_AVAILABILITY_IN_FLIGHT.has(requestKey)) {
    return ASSET_AVAILABILITY_IN_FLIGHT.get(requestKey);
  }
  const request = fetchAssetAvailability(targets)
    .then((payload) => {
      const assets = payload?.assets || {};
      targets.forEach((assetFqn) => {
        rememberAvailability(assetFqn, assets[assetFqn] || {
          visible: false,
          exists: false,
          openable: false,
        });
      });
      ASSET_AVAILABILITY_IN_FLIGHT.delete(requestKey);
      return assets;
    })
    .catch((error) => {
      ASSET_AVAILABILITY_IN_FLIGHT.delete(requestKey);
      throw error;
    });
  ASSET_AVAILABILITY_IN_FLIGHT.set(requestKey, request);
  return request;
}

export function prefetchAssetAvailability(assetFqns = [], options = {}) {
  const targets = [...new Set((assetFqns || []).filter(Boolean))];
  if (!targets.length) return Promise.resolve({});
  const force = options.force === true;
  const maxAgeMs = force ? 0 : options.maxAgeMs ?? AVAILABILITY_CACHE_TTL_MS;
  const missing = force
    ? targets
    : targets.filter((assetFqn) => !readCachedAvailability(assetFqn, { maxAgeMs }));
  if (!missing.length) {
    return Promise.resolve(
      Object.fromEntries(
        targets.map((assetFqn) => [assetFqn, readCachedAvailability(assetFqn, { maxAgeMs })]),
      ),
    );
  }
  return availabilityRequest(missing)
    .then(() =>
      Object.fromEntries(
        targets.map((assetFqn) => [assetFqn, readCachedAvailability(assetFqn, { maxAgeMs: null })]),
      ),
    )
    .catch(() =>
      Object.fromEntries(
        targets.map((assetFqn) => [
          assetFqn,
          readCachedAvailability(assetFqn, { maxAgeMs: null }) || {
            visible: false,
            exists: false,
            openable: false,
          },
        ]),
      ),
    );
}

export function isUsableAssetDetail(detail) {
  if (!detail?.fqn) return false;
  return (
    hasStructuredAssetDetail(detail) ||
    hasLiveAssetSignals(detail) ||
    hasResolvedAssetIdentity(detail)
  );
}

export function hasStructuredAssetDetail(detail) {
  if (!detail?.fqn) return false;
  if (Array.isArray(detail.columns) && detail.columns.length) return true;
  if (Array.isArray(detail.preview) && detail.preview.length) return true;
  return false;
}

export function hasLiveAssetSignals(detail) {
  if (!detail?.fqn) return false;
  const description = String(detail?.description || "").trim();
  if (description && description !== PLACEHOLDER_DESCRIPTION && description !== "—") return true;
  if (detail?.rows != null && detail.rows !== "" && detail.rows !== "—") return true;
  if (detail?.size != null && detail.size !== "" && detail.size !== "—") return true;
  if (detail?.files != null && detail.files !== "" && detail.files !== "—") return true;
  return false;
}

export function hasResolvedAssetIdentity(detail) {
  if (!detail?.fqn) return false;
  const rawTableType = String(detail?.tableTypeRaw || "").trim();
  if (rawTableType) return true;
  const managementType = String(detail?.managementType || "").trim();
  if (managementType && managementType !== "—") return true;
  const objectType = String(detail?.objectType || "").trim();
  if (objectType && !objectType.toLowerCase().includes("unknown")) return true;
  const storageFormat = String(detail?.storageFormat || detail?.format || "").trim();
  if (storageFormat && storageFormat !== "—" && !storageFormat.toLowerCase().includes("unknown")) {
    return true;
  }
  return false;
}

export function isNavigableAssetDetail(detail) {
  if (!detail?.fqn) return false;
  return hasStructuredAssetDetail(detail) || hasLiveAssetSignals(detail);
}

export function hasRenderableAssetRecord(detail) {
  if (!detail?.fqn) return false;
  return isNavigableAssetDetail(detail) || hasResolvedAssetIdentity(detail);
}

function availabilityOpenableValue(availability = null) {
  if (!availability || typeof availability !== "object") return null;
  if (typeof availability.openable === "boolean") return availability.openable;
  if (typeof availability.visible === "boolean") return availability.visible;
  return null;
}

function resolveAvailabilityState(
  availability = null,
  knownVisible = false,
  strict = false,
  requireRenderableDetail = false,
  detail = null,
) {
  const availabilityOpenable = strict
    ? availabilityOpenableValue(availability) === true
      ? true
      : availabilityOpenableValue(availability) === false
        ? false
        : null
    : knownVisible || availabilityOpenableValue(availability) === true
      ? true
      : availabilityOpenableValue(availability) === false
        ? false
        : null;
  if (availabilityOpenable !== true) return availabilityOpenable;
  if (!requireRenderableDetail) return true;
  if (!detail) return null;
  return hasRenderableAssetRecord(detail) ? true : false;
}

export function canOpenLinkedAssetRecord(detail, availability = null) {
  const availabilityOpenable = availabilityOpenableValue(availability);
  if (availabilityOpenable === false) return false;
  if (availabilityOpenable === true) return true;
  return hasRenderableAssetRecord(detail);
}

export function canOpenAssetRecord(detail, availability = null) {
  const availabilityOpenable = availabilityOpenableValue(availability);
  if (availabilityOpenable === false) return false;
  if (availabilityOpenable === true) return true;
  return hasRenderableAssetRecord(detail);
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

export function prefetchAssetDetail(assetFqn, options = {}) {
  if (!assetFqn) return Promise.resolve(null);
  const force = options.force === true;
  const maxAgeMs = force ? 0 : options.maxAgeMs ?? DETAIL_CACHE_TTL_MS;
  const cachedDetail = force ? null : readCachedDetail(assetFqn, { maxAgeMs });
  if (cachedDetail) return Promise.resolve(cachedDetail);
  return detailRequest(assetFqn).catch(() => null);
}

export function useAssetAvailability(assetFqns = [], knownVisibleAssetSet = null, options = {}) {
  const targets = useMemo(
    () => [...new Set((assetFqns || []).filter(Boolean))],
    [assetFqns],
  );
  const [availability, setAvailability] = useState({});
  const strict = options?.strict === true;
  const requireRenderableDetail = options?.requireRenderableDetail === true;

  useEffect(() => {
    if (!targets.length) {
      setAvailability({});
      return;
    }

    let canceled = false;
    setAvailability(() => {
      const next = {};
      targets.forEach((assetFqn) => {
        const knownVisible = knownVisibleAssetSet?.has?.(assetFqn) === true;
        const cachedAvailability = readCachedAvailability(assetFqn, {
          maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
        });
        const cachedDetail = requireRenderableDetail
          ? readCachedDetail(assetFqn, { maxAgeMs: DETAIL_CACHE_TTL_MS })
          : null;
        next[assetFqn] = resolveAvailabilityState(
          cachedAvailability,
          knownVisible,
          strict,
          requireRenderableDetail,
          cachedDetail,
        );
      });
      return next;
    });

    const availabilityPromise = prefetchAssetAvailability(targets, {
      maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
    });

    Promise.resolve(availabilityPromise).then(async (entries) => {
      if (canceled) return;
      const detailByAssetFqn = new Map();
      if (requireRenderableDetail) {
        const renderableTargets = targets.filter((assetFqn) => {
          const availabilityDetail =
            entries[assetFqn] ||
            readCachedAvailability(assetFqn, {
              maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
            });
          return availabilityOpenableValue(availabilityDetail) === true;
        });
        await Promise.all(
          renderableTargets.map(async (assetFqn) => {
            const detail = await prefetchAssetDetail(assetFqn);
            detailByAssetFqn.set(assetFqn, detail);
          }),
        );
      }
      setAvailability(
        Object.fromEntries(
          targets.map((assetFqn) => {
            const availabilityDetail =
              entries[assetFqn] ||
              readCachedAvailability(assetFqn, {
                maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
              });
            const knownVisible = knownVisibleAssetSet?.has?.(assetFqn) === true;
            const detail = requireRenderableDetail
              ? detailByAssetFqn.get(assetFqn) ||
                readCachedDetail(assetFqn, { maxAgeMs: DETAIL_CACHE_TTL_MS })
              : null;
            const openable = resolveAvailabilityState(
              availabilityDetail,
              knownVisible,
              strict,
              requireRenderableDetail,
              detail,
            );
            return [assetFqn, openable];
          }),
        ),
      );
    });

    return () => {
      canceled = true;
    };
  }, [knownVisibleAssetSet, requireRenderableDetail, strict, targets]);

  return availability;
}

export function useAssetDetail(assetFqn) {
  const initialDetail = readCachedDetail(assetFqn);
  const [state, setState] = useState(() => ({
    loading: Boolean(assetFqn && !initialDetail),
    error: "",
    detail: initialDetail,
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
