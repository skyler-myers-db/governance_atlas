import { useEffect, useMemo, useRef, useState } from "react";
import { useDiscoveryResults } from "./useDiscoveryResults";

const DISCOVERY_SESSION_KEY = "gh.discovery.session.v1";
const DISCOVERY_GROUPED_FILTER_KEYS = [
  "types",
  "catalogs",
  "domains",
  "tiers",
  "certifications",
  "sensitivities",
];
const GROUPED_FILTER_ALL_LABELS = {
  types: "All types",
  catalogs: "All catalogs",
  domains: "All domains",
  tiers: "All tiers",
  certifications: "All certifications",
  sensitivities: "All sensitivities",
};
/** @typedef {{
 *   types: string[],
 *   catalogs: string[],
 *   domains: string[],
 *   tiers: string[],
 *   certifications: string[],
 *   sensitivities: string[],
 * }} DiscoveryFilterGroups */

function discoverySessionKey(bootstrap) {
  if (typeof window === "undefined") return DISCOVERY_SESSION_KEY;
  const userScope = bootstrap?.shell?.userEmail || bootstrap?.shell?.userName || "anonymous";
  return `${DISCOVERY_SESSION_KEY}:${window.location.pathname}:${userScope}`;
}

function defaultDiscoveryState(bootstrap, query = "", sortBy = "") {
  return {
    query: query || bootstrap?.discovery?.defaultQuery || "",
    sortBy: sortBy || (bootstrap?.discovery?.sortOptions || ["Best match"])[0],
    views: [],
    types: [],
    catalogs: [],
    domains: [],
    tiers: [],
    certifications: [],
    sensitivities: [],
  };
}

function freshDiscoveryState(bootstrap, query = "", sortBy = "") {
  return {
    ...defaultDiscoveryState(bootstrap, "", sortBy),
    query,
  };
}

function discoverySelectionKey(values = []) {
  return JSON.stringify(
    [...new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    )].sort(),
  );
}

function normalizeDiscoveryFilterGroups(groups = {}) {
  const source = groups && typeof groups === "object" ? groups : {};
  return DISCOVERY_GROUPED_FILTER_KEYS.reduce((next, key) => {
    next[key] = discoverySelectionValues(source[key], GROUPED_FILTER_ALL_LABELS[key]);
    return next;
  }, /** @type {DiscoveryFilterGroups} */ ({
    types: [],
    catalogs: [],
    domains: [],
    tiers: [],
    certifications: [],
    sensitivities: [],
  }));
}

function discoverySelectionValues(values = [], disallow = "") {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .filter((value) => !disallow || value !== disallow),
  )];
}

function discoveryFilterGroupsKey(groups = {}) {
  const normalized = normalizeDiscoveryFilterGroups(groups);
  return JSON.stringify(
    DISCOVERY_GROUPED_FILTER_KEYS.reduce((next, key) => {
      next[key] = [...normalized[key]].sort();
      return next;
    }, {}),
  );
}

function normalizeDiscoveryState(
  bootstrap,
  state = {},
  queryOverride,
  sortOverride,
  viewsOverride,
  filterGroupsOverride,
) {
  const fallback = defaultDiscoveryState(
    bootstrap,
    queryOverride ?? (typeof state.query === "string" ? state.query : ""),
    typeof sortOverride === "string" && sortOverride.trim() ? sortOverride.trim() : "",
  );
  const sortOptions = new Set(bootstrap?.discovery?.sortOptions || ["Best match"]);
  const views = new Set((bootstrap?.discovery?.views || ["All assets"]).filter((value) => value !== "All assets"));
  const normalizedRouteSort =
    typeof sortOverride === "string" && sortOverride.trim() ? sortOverride.trim() : "";
  const normalizedRouteFilterGroups =
    filterGroupsOverride !== undefined
      ? normalizeDiscoveryFilterGroups(filterGroupsOverride)
      : null;

  const normalizeMulti = (values, { optionSet = null, disallow = [] } = {}) => {
    if (!Array.isArray(values) || !values.length) return [];
    const disallowed = new Set(disallow);
    const next = [...new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .filter((value) => !disallowed.has(value)),
    )];
    if (optionSet instanceof Set && optionSet.size) {
      return next.filter((value) => optionSet.has(value));
    }
    return next.length ? next : [];
  };

  const legacyViews =
    typeof state.view === "string" && state.view && state.view !== "All assets" ? [state.view] : [];
  const legacyTypes =
    typeof state.type === "string" && state.type && state.type !== "All types" ? [state.type] : [];
  const normalizedRouteViews = Array.isArray(viewsOverride)
    ? normalizeMulti(viewsOverride, { optionSet: views, disallow: ["All assets"] })
    : null;

  return {
    ...fallback,
    ...state,
    query: queryOverride ?? (typeof state.query === "string" ? state.query : fallback.query),
    sortBy: normalizedRouteSort
      ? sortOptions.has(normalizedRouteSort)
        ? normalizedRouteSort
        : fallback.sortBy
      : sortOptions.has(state.sortBy)
        ? state.sortBy
        : fallback.sortBy,
    views:
      normalizedRouteViews ??
      normalizeMulti(state.views || legacyViews, { optionSet: views, disallow: ["All assets"] }),
    types: normalizedRouteFilterGroups
      ? normalizedRouteFilterGroups.types
      : normalizeMulti(state.types || legacyTypes, { disallow: ["All types"] }),
    catalogs: normalizedRouteFilterGroups
      ? normalizedRouteFilterGroups.catalogs
      : normalizeMulti(state.catalogs, { disallow: ["All catalogs"] }),
    domains: normalizedRouteFilterGroups
      ? normalizedRouteFilterGroups.domains
      : normalizeMulti(state.domains, { disallow: ["All domains"] }),
    tiers: normalizedRouteFilterGroups
      ? normalizedRouteFilterGroups.tiers
      : normalizeMulti(state.tiers, { disallow: ["All tiers"] }),
    certifications: normalizedRouteFilterGroups
      ? normalizedRouteFilterGroups.certifications
      : normalizeMulti(state.certifications, { disallow: ["All certifications"] }),
    sensitivities: normalizedRouteFilterGroups
      ? normalizedRouteFilterGroups.sensitivities
      : normalizeMulti(state.sensitivities, { disallow: ["All sensitivities"] }),
  };
}

function readDiscoverySession(
  bootstrap,
  initialQuery = "",
  initialSort = "",
  initialViews = [],
  initialFilterGroups = {},
  preferFresh = false,
) {
  const fallback = normalizeDiscoveryState(
    bootstrap,
    preferFresh
      ? freshDiscoveryState(bootstrap, initialQuery, initialSort)
      : defaultDiscoveryState(bootstrap, initialQuery, initialSort),
    initialQuery,
    initialSort,
    initialViews,
    initialFilterGroups,
  );
  if (typeof window === "undefined") return fallback;
  if (preferFresh) return fallback;

  try {
    const raw = window.sessionStorage.getItem(discoverySessionKey(bootstrap));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    // A blank discovery route should use the canonical default sort instead of
    // reviving a sticky session sort the URL does not actually declare.
    const routeOwnedSort =
      typeof initialSort === "string" && initialSort.trim() ? initialSort.trim() : fallback.sortBy;
    return normalizeDiscoveryState(
      bootstrap,
      parsed,
      initialQuery || parsed.query || fallback.query,
      routeOwnedSort,
      initialViews,
      initialFilterGroups,
    );
  } catch {
    return fallback;
  }
}

export function useDiscoveryWorkspace({
  bootstrap,
  initialQuery = "",
  initialSort = "",
  initialViews = [],
  initialFilterGroups = {},
  requestedResultLimit = 80,
  querySeedKey = 0,
  querySeedFresh = false,
  onRouteQueryChange,
  onRouteSortChange,
  onRouteViewsChange,
  onRouteFilterGroupsChange,
}) {
  const initialRouteQuery = String(initialQuery || "");
  const initialRouteSort = String(initialSort || "");
  const initialRouteViews = useMemo(
    () => (Array.isArray(initialViews) ? initialViews : []),
    [initialViews],
  );
  const initialRouteFilterGroups = useMemo(
    () => normalizeDiscoveryFilterGroups(initialFilterGroups),
    [initialFilterGroups],
  );
  const seedState = useMemo(
    () => readDiscoverySession(
      bootstrap,
      initialRouteQuery,
      initialRouteSort,
      initialRouteViews,
      initialRouteFilterGroups,
      querySeedFresh,
    ),
    [bootstrap, initialRouteFilterGroups, initialRouteQuery, initialRouteSort, initialRouteViews, querySeedFresh],
  );
  const [filters, setFilters] = useState(seedState);
  const lastSyncedRouteQueryRef = useRef(seedState.query || initialRouteQuery);
  const lastSyncedRouteSortRef = useRef(seedState.sortBy || initialRouteSort);
  const lastSyncedRouteViewsRef = useRef(discoverySelectionKey(initialRouteViews));
  const lastSyncedRouteFilterGroupsRef = useRef(discoveryFilterGroupsKey(initialRouteFilterGroups));
  const appliedRouteSeedKeyRef = useRef(/** @type {string | number | null} */ (null));
  const updateFilters = (updater) => {
    setFilters((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return normalizeDiscoveryState(bootstrap, next);
    });
  };

  useEffect(() => {
    setFilters((current) => normalizeDiscoveryState(bootstrap, current));
  }, [bootstrap]);

  useEffect(() => {
    if (appliedRouteSeedKeyRef.current === querySeedKey) return;
    appliedRouteSeedKeyRef.current = querySeedKey;
    lastSyncedRouteQueryRef.current = initialRouteQuery;
    lastSyncedRouteSortRef.current = initialRouteSort || seedState.sortBy;
    lastSyncedRouteViewsRef.current = discoverySelectionKey(initialRouteViews);
    lastSyncedRouteFilterGroupsRef.current = discoveryFilterGroupsKey(initialRouteFilterGroups);
    setFilters((current) =>
      querySeedFresh
        ? normalizeDiscoveryState(
            bootstrap,
            freshDiscoveryState(bootstrap, initialRouteQuery, initialRouteSort),
            initialRouteQuery,
            initialRouteSort,
            initialRouteViews,
            initialRouteFilterGroups,
          )
        : normalizeDiscoveryState(
            bootstrap,
            current,
            initialRouteQuery,
            initialRouteSort,
            initialRouteViews,
            initialRouteFilterGroups,
          )
    );
  }, [bootstrap, initialRouteFilterGroups, initialRouteQuery, initialRouteSort, initialRouteViews, querySeedFresh, querySeedKey, seedState.sortBy]);

  useEffect(() => {
    const nextQuery = filters.query || "";
    if (nextQuery === lastSyncedRouteQueryRef.current) return undefined;

    const timeout = setTimeout(() => {
      onRouteQueryChange?.(nextQuery);
      lastSyncedRouteQueryRef.current = nextQuery;
    }, 220);

    return () => {
      clearTimeout(timeout);
    };
  }, [filters.query, onRouteQueryChange]);

  useEffect(() => {
    const nextSort = filters.sortBy || "";
    if (nextSort === lastSyncedRouteSortRef.current) return;
    onRouteSortChange?.(nextSort);
    lastSyncedRouteSortRef.current = nextSort;
  }, [filters.sortBy, onRouteSortChange]);

  useEffect(() => {
    const nextViewsKey = discoverySelectionKey(filters.views);
    if (nextViewsKey === lastSyncedRouteViewsRef.current) return;
    onRouteViewsChange?.(filters.views || []);
    lastSyncedRouteViewsRef.current = nextViewsKey;
  }, [filters.views, onRouteViewsChange]);

  useEffect(() => {
    const nextFilterGroups = {
      types: filters.types,
      catalogs: filters.catalogs,
      domains: filters.domains,
      tiers: filters.tiers,
      certifications: filters.certifications,
      sensitivities: filters.sensitivities,
    };
    const nextFilterGroupsKey = discoveryFilterGroupsKey(nextFilterGroups);
    if (nextFilterGroupsKey === lastSyncedRouteFilterGroupsRef.current) return;
    onRouteFilterGroupsChange?.(nextFilterGroups);
    lastSyncedRouteFilterGroupsRef.current = nextFilterGroupsKey;
  }, [
    filters.catalogs,
    filters.certifications,
    filters.domains,
    filters.sensitivities,
    filters.tiers,
    filters.types,
    onRouteFilterGroupsChange,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(discoverySessionKey(bootstrap), JSON.stringify(filters));
    } catch {
      // Best-effort only; do not block the workspace.
    }
  }, [bootstrap, filters]);

  const results = useDiscoveryResults(filters, {
    limit: requestedResultLimit,
  });

  return {
    filters,
    setFilters: updateFilters,
    results,
  };
}
