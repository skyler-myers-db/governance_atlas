import { useEffect, useMemo, useState } from "react";
import { useDiscoveryResults } from "./useDiscoveryResults";

const DISCOVERY_SESSION_KEY = "gh.discovery.session.v1";

function discoverySessionKey(bootstrap) {
  if (typeof window === "undefined") return DISCOVERY_SESSION_KEY;
  const userScope = bootstrap?.shell?.userEmail || bootstrap?.shell?.userName || "anonymous";
  return `${DISCOVERY_SESSION_KEY}:${window.location.pathname}:${userScope}`;
}

function defaultDiscoveryState(bootstrap, query = "") {
  return {
    query: query || bootstrap?.discovery?.defaultQuery || "",
    sortBy: (bootstrap?.discovery?.sortOptions || ["Best match"])[0],
    view: (bootstrap?.discovery?.views || ["All assets"])[0],
    type: (bootstrap?.discovery?.assetTypes || ["All types"])[0],
    catalogs: [],
    domains: [],
    tiers: [],
    certifications: [],
    sensitivities: [],
  };
}

function freshDiscoveryState(bootstrap, query = "") {
  return {
    ...defaultDiscoveryState(bootstrap, ""),
    query,
  };
}

function normalizeDiscoveryState(bootstrap, state = {}, queryOverride) {
  const fallback = defaultDiscoveryState(
    bootstrap,
    queryOverride ?? (typeof state.query === "string" ? state.query : ""),
  );
  const catalogs = new Set(bootstrap?.discovery?.catalogs || []);
  const domains = new Set(bootstrap?.discovery?.domains || []);
  const tiers = new Set(bootstrap?.discovery?.tiers || []);
  const certifications = new Set(bootstrap?.discovery?.certifications || []);
  const sensitivities = new Set(bootstrap?.discovery?.sensitivities || []);
  const sortOptions = new Set(bootstrap?.discovery?.sortOptions || ["Best match"]);
  const views = new Set(bootstrap?.discovery?.views || ["All assets"]);
  const assetTypes = new Set(bootstrap?.discovery?.assetTypes || ["All types"]);

  const normalizeMulti = (values, allLabel, optionSet) => {
    if (!Array.isArray(values) || !values.length) return [];
    const next = values.filter((value) => optionSet.has(value));
    return next.length ? next : [];
  };

  return {
    ...fallback,
    ...state,
    query: queryOverride ?? (typeof state.query === "string" ? state.query : fallback.query),
    sortBy: sortOptions.has(state.sortBy) ? state.sortBy : fallback.sortBy,
    view: views.has(state.view) ? state.view : fallback.view,
    type: assetTypes.has(state.type) ? state.type : fallback.type,
    catalogs: normalizeMulti(state.catalogs, "All catalogs", catalogs),
    domains: normalizeMulti(state.domains, "All domains", domains),
    tiers: normalizeMulti(state.tiers, "All tiers", tiers),
    certifications: normalizeMulti(state.certifications, "All certifications", certifications),
    sensitivities: normalizeMulti(state.sensitivities, "All sensitivities", sensitivities),
  };
}

function readDiscoverySession(bootstrap, initialQuery = "", preferFresh = false) {
  const fallback = preferFresh
    ? freshDiscoveryState(bootstrap, initialQuery)
    : defaultDiscoveryState(bootstrap, initialQuery);
  if (typeof window === "undefined") return fallback;
  if (preferFresh) return fallback;

  try {
    const raw = window.sessionStorage.getItem(discoverySessionKey(bootstrap));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    return normalizeDiscoveryState(bootstrap, parsed, initialQuery || parsed.query || fallback.query);
  } catch {
    return fallback;
  }
}

export function useDiscoveryWorkspace({
  bootstrap,
  initialQuery = "",
  querySeedKey = 0,
  querySeedFresh = false,
  onRouteQueryChange,
}) {
  const seedState = useMemo(
    () => readDiscoverySession(bootstrap, initialQuery, querySeedFresh),
    [bootstrap, initialQuery, querySeedFresh],
  );
  const [filters, setFilters] = useState(seedState);
  const updateFilters = (updater) => {
    setFilters((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return normalizeDiscoveryState(bootstrap, next);
    });
  };

  useEffect(() => {
    updateFilters((current) => current);
  }, [bootstrap]);

  useEffect(() => {
    if (!querySeedKey) return;
    updateFilters((current) =>
      querySeedFresh
        ? freshDiscoveryState(bootstrap, initialQuery)
        : normalizeDiscoveryState(bootstrap, current, initialQuery)
    );
  }, [bootstrap, initialQuery, querySeedFresh, querySeedKey]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onRouteQueryChange?.(filters.query || "");
    }, 220);

    return () => {
      clearTimeout(timeout);
    };
  }, [filters.query, onRouteQueryChange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(discoverySessionKey(bootstrap), JSON.stringify(filters));
    } catch {
      // Best-effort only; do not block the workspace.
    }
  }, [filters]);

  const results = useDiscoveryResults(filters, bootstrap?.assets || []);

  return {
    filters,
    setFilters: updateFilters,
    results,
  };
}
