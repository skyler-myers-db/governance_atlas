import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAssetAvailability, fetchAssetDetail } from "../lib/api";
import { isNonAuthoritativeEvidenceEnvelope } from "../lib/nonAuthoritativeEvidence";
import { atlasQueryClient } from "../lib/queryClient";

const PLACEHOLDER_DESCRIPTION = "No description has been captured for this asset yet.";
const DETAIL_CACHE_TTL_MS = 20_000;
const AVAILABILITY_CACHE_TTL_MS = 10_000;
const ASSET_DETAIL_CANONICAL_PREFIX = "assetDetailCanonical";
const ASSET_DETAIL_REQUEST_PREFIX = "assetDetail";
const ASSET_AVAILABILITY_CANONICAL_PREFIX = "assetAvailabilityCanonical";
const ASSET_AVAILABILITY_REQUEST_PREFIX = "assetAvailability";
const DETAIL_SECTION_FIELDS = {
  header: [
    "fqn",
    "name",
    "catalog",
    "schema",
    "objectType",
    "description",
    "coverageScore",
    "rows",
    "format",
    "storageFormat",
    "tableTypeRaw",
    "managementType",
    "size",
    "files",
    "domain",
    "tier",
    "certification",
    "sensitivity",
    "criticality",
    "openRequests",
    "owners",
    "tags",
    "glossaryTerm",
    "glossaryTerms",
    "glossaryLinks",
    "governanceStatus",
    "metadataEditor",
  ],
  activity: ["ownerAssignments", "activity", "metadataAudit"],
  schema: ["columns", "columnCount"],
  preview: ["preview"],
  properties: ["tableProperties", "customProperties", "constraints"],
  operational: ["relatedAssets", "operationalContext", "queries", "usage"],
  profiler: ["profiler"],
};
const DEFAULT_DETAIL_SECTIONS = Object.keys(DETAIL_SECTION_FIELDS);

function normalizeDetailSections(sections = []) {
  if (!Array.isArray(sections) || !sections.length) return [];
  return [...new Set(sections.map((section) => String(section || "").trim().toLowerCase()).filter(Boolean))].sort();
}

function assetDetailCanonicalKey(assetFqn) {
  return [ASSET_DETAIL_CANONICAL_PREFIX, assetFqn];
}

function assetDetailRequestKey(assetFqn, sections = []) {
  const normalizedSections = normalizeDetailSections(sections);
  return [ASSET_DETAIL_REQUEST_PREFIX, assetFqn, normalizedSections.join(",") || "all"];
}

function assetAvailabilityCanonicalKey(assetFqn) {
  return [ASSET_AVAILABILITY_CANONICAL_PREFIX, assetFqn];
}

function assetAvailabilityRequestKey(targets = [], strict = false, requireRenderableDetail = false, visibilitySignature = "") {
  return [
    ASSET_AVAILABILITY_REQUEST_PREFIX,
    targets.slice().sort().join("|"),
    strict ? 1 : 0,
    requireRenderableDetail ? 1 : 0,
    visibilitySignature,
  ];
}

function queryUpdatedAt(queryKey) {
  return atlasQueryClient.getQueryState(queryKey)?.dataUpdatedAt || 0;
}

function isFresh(queryKey, maxAgeMs = null) {
  if (maxAgeMs == null) return true;
  const updatedAt = queryUpdatedAt(queryKey);
  if (!updatedAt) return false;
  return Date.now() - updatedAt <= maxAgeMs;
}

function readCanonicalDetail(assetFqn, options = {}) {
  if (!assetFqn) return null;
  const queryKey = assetDetailCanonicalKey(assetFqn);
  const detail = atlasQueryClient.getQueryData(queryKey) || null;
  if (!detail) return null;
  if (!isFresh(queryKey, options.maxAgeMs ?? DETAIL_CACHE_TTL_MS)) return null;
  return detail;
}

function readCanonicalAvailability(assetFqn, options = {}) {
  if (!assetFqn) return null;
  const queryKey = assetAvailabilityCanonicalKey(assetFqn);
  const detail = atlasQueryClient.getQueryData(queryKey) || null;
  if (!detail) return null;
  if (!isFresh(queryKey, options.maxAgeMs ?? AVAILABILITY_CACHE_TTL_MS)) return null;
  return detail;
}

function cachedDetailHasSections(detail, sections = []) {
  const normalizedSections = normalizeDetailSections(sections);
  if (!normalizedSections.length) return Boolean(detail);
  const loadedSections = new Set(detail?.loadedSections || []);
  return normalizedSections.every((section) => loadedSections.has(section));
}

function detailHydrating(detail) {
  if (!detail || typeof detail !== "object") return false;
  const meta = detail.meta && typeof detail.meta === "object" ? detail.meta : {};
  const state = String(meta.state || detail.state || "").trim().toLowerCase();
  const capabilities = meta.capabilities && typeof meta.capabilities === "object"
    ? meta.capabilities
    : {};
  return state === "loading" || detail.hydrating === true || capabilities.hydrating === true;
}

function assetDetailRefetchInterval(query) {
  return detailHydrating(query?.state?.data) ? 3_000 : false;
}

function mergeLoadedSections(currentDetail, incomingDetail) {
  const merged = new Set([...(currentDetail?.loadedSections || []), ...(incomingDetail?.loadedSections || [])]);
  return [...merged].sort();
}

function mergeAssetDetail(currentDetail, incomingDetail) {
  if (!currentDetail) return incomingDetail;
  if (!incomingDetail) return currentDetail;

  const merged = {
    ...currentDetail,
  };
  const incomingSections = new Set(incomingDetail.loadedSections || []);
  const mergedSections = mergeLoadedSections(currentDetail, incomingDetail);

  Object.entries(DETAIL_SECTION_FIELDS).forEach(([section, fields]) => {
    if (!incomingSections.has(section)) return;
    fields.forEach((field) => {
      merged[field] = incomingDetail[field];
    });
  });

  Object.keys(incomingDetail).forEach((field) => {
    if (field in merged) return;
    merged[field] = incomingDetail[field];
  });

  merged.loadedSections = mergedSections;
  merged.deferredSections = DEFAULT_DETAIL_SECTIONS.filter((section) => !mergedSections.includes(section));
  return merged;
}

function setCanonicalDetail(assetFqn, detail) {
  if (isNonAuthoritativeEvidenceEnvelope(detail)) {
    atlasQueryClient.removeQueries({ queryKey: assetDetailCanonicalKey(assetFqn), exact: true });
    atlasQueryClient.removeQueries({ queryKey: [ASSET_DETAIL_REQUEST_PREFIX, assetFqn] });
    syncAvailabilityRequestsForAsset(assetFqn);
    return null;
  }
  const current = readCanonicalDetail(assetFqn, { maxAgeMs: null });
  const mergedDetail = mergeAssetDetail(current, detail);
  atlasQueryClient.setQueryData(assetDetailCanonicalKey(assetFqn), mergedDetail);
  atlasQueryClient.setQueriesData(
    { queryKey: [ASSET_DETAIL_REQUEST_PREFIX, assetFqn] },
    mergedDetail,
  );
  syncAvailabilityRequestsForAsset(assetFqn);
  return mergedDetail;
}

function setCanonicalAvailability(assetFqn, availability) {
  atlasQueryClient.setQueryData(assetAvailabilityCanonicalKey(assetFqn), availability);
  syncAvailabilityRequestsForAsset(assetFqn);
  return availability;
}

function buildVisibilitySignature(targets = [], knownVisibleAssetSet = null) {
  return targets.map((assetFqn) => (knownVisibleAssetSet?.has?.(assetFqn) ? "1" : "0")).join("");
}

function knownVisibleLookup(targets = [], visibilitySignature = "") {
  return {
    has(assetFqn) {
      const index = targets.indexOf(assetFqn);
      return index >= 0 && visibilitySignature.charAt(index) === "1";
    },
  };
}

function parseAvailabilityRequestKey(queryKey = /** @type {readonly unknown[]} */ ([])) {
  const targets = String(queryKey?.[1] || "")
    .split("|")
    .filter(Boolean);
  return {
    targets,
    strict: Number(queryKey?.[2] || 0) === 1,
    requireRenderableDetail: Number(queryKey?.[3] || 0) === 1,
    visibilitySignature: String(queryKey?.[4] || ""),
  };
}

function syncAvailabilityRequestsForAsset(assetFqn) {
  atlasQueryClient
    .getQueryCache()
    .findAll({ queryKey: [ASSET_AVAILABILITY_REQUEST_PREFIX] })
    .forEach((query) => {
      const { targets, strict, requireRenderableDetail, visibilitySignature } = parseAvailabilityRequestKey(query.queryKey);
      if (!targets.includes(assetFqn)) return;
      atlasQueryClient.setQueryData(
        query.queryKey,
        buildAvailabilityStateMap(
          targets,
          knownVisibleLookup(targets, visibilitySignature),
          {
            strict,
            requireRenderableDetail,
            maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
          },
        ),
      );
    });
}

function readCachedDetail(assetFqn, options = {}) {
  const detail = readCanonicalDetail(assetFqn, { maxAgeMs: options.maxAgeMs ?? DETAIL_CACHE_TTL_MS });
  if (!detail) return null;
  if (!cachedDetailHasSections(detail, options.sections)) return null;
  return detail;
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

function buildAvailabilityStateMap(targets = [], knownVisibleAssetSet = null, options = {}) {
  const strict = options.strict === true;
  const requireRenderableDetail = options.requireRenderableDetail === true;
  const maxAgeMs = options.maxAgeMs ?? (strict ? AVAILABILITY_CACHE_TTL_MS : null);
  return Object.fromEntries(
    targets.map((assetFqn) => {
      const knownVisible = knownVisibleAssetSet?.has?.(assetFqn) === true;
      const availability = readCanonicalAvailability(assetFqn, { maxAgeMs });
      const detail = requireRenderableDetail
        ? readCanonicalDetail(assetFqn, { maxAgeMs: DETAIL_CACHE_TTL_MS })
        : null;
      return [
        assetFqn,
        resolveAvailabilityState(
          availability,
          knownVisible,
          strict,
          requireRenderableDetail,
          detail,
        ),
      ];
    }),
  );
}

async function ensureAssetDetail(assetFqn, options = {}) {
  if (!assetFqn) return null;
  const cachedDetail = options.force !== true
    ? readCachedDetail(assetFqn, {
        sections: options.sections,
        maxAgeMs: options.maxAgeMs ?? DETAIL_CACHE_TTL_MS,
      })
    : null;
  if (cachedDetail) return cachedDetail;

  const detail = await fetchAssetDetail(assetFqn, {
    sections: options.sections,
    signal: options.signal,
  });
  return setCanonicalDetail(assetFqn, detail);
}

async function ensureAssetAvailability(assetFqns = [], options = {}) {
  const targets = [...new Set((assetFqns || []).filter(Boolean))].sort();
  if (!targets.length) return {};

  const strict = options.strict === true;
  const requireRenderableDetail = options.requireRenderableDetail === true;
  const maxAgeMs = options.force === true
    ? 0
    : options.maxAgeMs ?? (strict ? AVAILABILITY_CACHE_TTL_MS : null);

  const missing = options.force === true
    ? targets
    : targets.filter((assetFqn) => !readCanonicalAvailability(assetFqn, { maxAgeMs }));

  if (missing.length) {
    const payload = await fetchAssetAvailability(missing, { signal: options.signal });
    const assets = payload?.assets || {};
    missing.forEach((assetFqn) => {
      setCanonicalAvailability(
        assetFqn,
        assets[assetFqn] || {
          visible: false,
          exists: false,
          openable: false,
        },
      );
    });
  }

  if (requireRenderableDetail) {
    const renderableTargets = targets.filter((assetFqn) => {
      const availability = readCanonicalAvailability(assetFqn, { maxAgeMs: null });
      return availabilityOpenableValue(availability) === true;
    });
    // Concurrency cap: Promise.all(60 fetches) used to fire every
    // renderable candidate at once on page mount, each blocking a
    // serverless warehouse slot for 15–30 s. The user saw it as
    // mouse lag / unresponsive UI because every click had to wait
    // behind a queue of 60 in-flight requests. 4 at a time still
    // warms the first visible result rows quickly but lets the
    // browser + warehouse stay responsive.
    const RENDERABLE_PREFETCH_CONCURRENCY = 4;
    const queue = renderableTargets.slice();
    const runWorker = async () => {
      while (queue.length) {
        const assetFqn = queue.shift();
        if (!assetFqn) return;
        if (options.signal?.aborted) return;
        try {
          await prefetchAssetDetail(assetFqn, {
            sections: ["header"],
            signal: options.signal,
          });
        } catch {
          // Best-effort: missing detail for one asset should not
          // stall the rest of the availability resolution.
        }
      }
    };
    const workerCount = Math.min(RENDERABLE_PREFETCH_CONCURRENCY, renderableTargets.length);
    await Promise.all(Array.from({ length: workerCount }, runWorker));
  }

  return buildAvailabilityStateMap(targets, options.knownVisibleAssetSet, {
    strict,
    requireRenderableDetail,
    maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
  });
}

export function primeAssetDetail(assetFqn, detail) {
  if (!assetFqn || !detail) return detail || null;
  return setCanonicalDetail(assetFqn, detail);
}

export function primeAssetAvailability(assetFqn, availability) {
  if (!assetFqn || !availability) return availability || null;
  return setCanonicalAvailability(assetFqn, availability);
}

export function invalidateAssetDetail(assetFqn) {
  if (!assetFqn) return Promise.resolve();
  atlasQueryClient.removeQueries({ queryKey: assetDetailCanonicalKey(assetFqn), exact: true });
  return atlasQueryClient.invalidateQueries({ queryKey: [ASSET_DETAIL_REQUEST_PREFIX, assetFqn] });
}

export function invalidateAssetAvailability(assetFqns = []) {
  const targets = [...new Set((assetFqns || []).filter(Boolean))];
  targets.forEach((assetFqn) => {
    atlasQueryClient.removeQueries({ queryKey: assetAvailabilityCanonicalKey(assetFqn), exact: true });
  });
  return atlasQueryClient.invalidateQueries({ queryKey: [ASSET_AVAILABILITY_REQUEST_PREFIX] });
}

export function prefetchAssetDetail(assetFqn, options = {}) {
  if (!assetFqn) return Promise.resolve(null);
  const force = options.force === true;
  const cachedDetail = force
    ? null
    : readCachedDetail(assetFqn, {
        sections: options.sections,
        maxAgeMs: options.maxAgeMs ?? DETAIL_CACHE_TTL_MS,
      });
  if (cachedDetail) return Promise.resolve(cachedDetail);

  return atlasQueryClient.fetchQuery({
    queryKey: assetDetailRequestKey(assetFqn, options.sections),
    staleTime: force ? 0 : DETAIL_CACHE_TTL_MS,
    queryFn: ({ signal }) =>
      ensureAssetDetail(assetFqn, {
        sections: options.sections,
        signal: options.signal || signal,
        force,
        maxAgeMs: options.maxAgeMs,
      }),
  }).catch(() => readCanonicalDetail(assetFqn, { maxAgeMs: null }) || null);
}

export function prefetchAssetAvailability(assetFqns = [], options = {}) {
  const targets = [...new Set((assetFqns || []).filter(Boolean))].sort();
  if (!targets.length) return Promise.resolve({});

  const strict = options.strict === true;
  const requireRenderableDetail = options.requireRenderableDetail === true;
  const visibilitySignature = buildVisibilitySignature(targets, options.knownVisibleAssetSet);
  const cachedAvailability = options.force === true
    ? null
    : buildAvailabilityStateMap(targets, options.knownVisibleAssetSet, {
        strict,
        requireRenderableDetail,
        maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
      });
  const hasAllCachedValues = cachedAvailability && targets.every((assetFqn) => cachedAvailability[assetFqn] !== undefined);
  if (hasAllCachedValues && targets.every((assetFqn) => readCanonicalAvailability(assetFqn, {
    maxAgeMs: options.maxAgeMs ?? (strict ? AVAILABILITY_CACHE_TTL_MS : null),
  }))) {
    return Promise.resolve(cachedAvailability);
  }

  return atlasQueryClient.fetchQuery({
    queryKey: assetAvailabilityRequestKey(
      targets,
      strict,
      requireRenderableDetail,
      visibilitySignature,
    ),
    staleTime: options.force === true ? 0 : AVAILABILITY_CACHE_TTL_MS,
    queryFn: ({ signal }) =>
      ensureAssetAvailability(targets, {
        force: options.force === true,
        knownVisibleAssetSet: options.knownVisibleAssetSet,
        strict,
        requireRenderableDetail,
        maxAgeMs: options.maxAgeMs,
        signal: options.signal || signal,
      }),
  }).catch(() =>
    buildAvailabilityStateMap(targets, options.knownVisibleAssetSet, {
      strict,
      requireRenderableDetail,
      maxAgeMs: null,
    }),
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

export function useAssetAvailability(assetFqns = [], knownVisibleAssetSet = null, options = {}) {
  const targets = useMemo(
    () => [...new Set((assetFqns || []).filter(Boolean))].sort(),
    [assetFqns],
  );
  const strict = options?.strict === true;
  const requireRenderableDetail = options?.requireRenderableDetail === true;
  const visibilitySignature = useMemo(
    () => buildVisibilitySignature(targets, knownVisibleAssetSet),
    [knownVisibleAssetSet, targets],
  );
  const placeholder = useMemo(
    () =>
      buildAvailabilityStateMap(targets, knownVisibleAssetSet, {
        strict,
        requireRenderableDetail,
        maxAgeMs: strict ? AVAILABILITY_CACHE_TTL_MS : null,
      }),
    [knownVisibleAssetSet, requireRenderableDetail, strict, targets],
  );

  const query = useQuery({
    queryKey: assetAvailabilityRequestKey(
      targets,
      strict,
      requireRenderableDetail,
      visibilitySignature,
    ),
    enabled: targets.length > 0,
    queryFn: ({ signal }) =>
      ensureAssetAvailability(targets, {
        knownVisibleAssetSet,
        strict,
        requireRenderableDetail,
        signal,
      }),
    placeholderData: placeholder,
    staleTime: AVAILABILITY_CACHE_TTL_MS,
  });

  return targets.length ? query.data || placeholder : {};
}

export function useAssetDetail(assetFqn, options = {}) {
  const enabled = options.enabled !== false;
  const sections = useMemo(
    () => normalizeDetailSections(options.sections || []),
    [options.sections],
  );
  const cachedAnyDetail = assetFqn ? readCanonicalDetail(assetFqn, { maxAgeMs: null }) : null;
  const placeholder = cachedAnyDetail || null;
  const query = useQuery({
    queryKey: assetDetailRequestKey(assetFqn || "", sections),
    enabled: Boolean(enabled && assetFqn),
    queryFn: ({ signal }) =>
      ensureAssetDetail(assetFqn, {
        sections,
        signal,
      }),
    placeholderData: placeholder || undefined,
    staleTime: DETAIL_CACHE_TTL_MS,
    refetchInterval: assetDetailRefetchInterval,
  });

  if (!assetFqn) {
    return {
      loading: false,
      error: "",
      detail: null,
    };
  }

  if (!enabled) {
    return {
      loading: false,
      error: "",
      detail: cachedAnyDetail,
    };
  }

  const detail = query.data || placeholder || null;
  const missingRequestedSections = !cachedDetailHasSections(detail, sections);
  const hydrating = detailHydrating(detail);
  return {
    loading:
      Boolean(query.isPending && !detail) ||
      Boolean(query.isFetching && missingRequestedSections) ||
      hydrating,
    error:
      query.isError && missingRequestedSections
        ? query.error?.message || "Failed to load asset detail."
        : "",
    detail,
  };
}
