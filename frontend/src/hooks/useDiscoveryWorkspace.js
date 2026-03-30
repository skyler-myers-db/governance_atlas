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
    views: [],
    types: [],
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
  const views = new Set((bootstrap?.discovery?.views || ["All assets"]).filter((value) => value !== "All assets"));
  const assetTypes = new Set((bootstrap?.discovery?.assetTypes || ["All types"]).filter((value) => value !== "All types"));

  const normalizeMulti = (values, optionSet) => {
    if (!Array.isArray(values) || !values.length) return [];
    const next = values.filter((value) => optionSet.has(value));
    return next.length ? next : [];
  };

  const legacyViews =
    typeof state.view === "string" && state.view && state.view !== "All assets" ? [state.view] : [];
  const legacyTypes =
    typeof state.type === "string" && state.type && state.type !== "All types" ? [state.type] : [];

  return {
    ...fallback,
    ...state,
    query: queryOverride ?? (typeof state.query === "string" ? state.query : fallback.query),
    sortBy: sortOptions.has(state.sortBy) ? state.sortBy : fallback.sortBy,
    views: normalizeMulti(state.views || legacyViews, views),
    types: normalizeMulti(state.types || legacyTypes, assetTypes),
    catalogs: normalizeMulti(state.catalogs, catalogs),
    domains: normalizeMulti(state.domains, domains),
    tiers: normalizeMulti(state.tiers, tiers),
    certifications: normalizeMulti(state.certifications, certifications),
    sensitivities: normalizeMulti(state.sensitivities, sensitivities),
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
  allowSeededDiscovery = true,
  onRouteQueryChange,
}) {
  const seededAssets = useMemo(() => {
    if (!allowSeededDiscovery) return [];
    const seen = new Set();
    return [...(bootstrap?.assets || [])].filter((asset) => {
      if (!asset?.fqn || seen.has(asset.fqn)) return false;
      seen.add(asset.fqn);
      return true;
    });
  }, [allowSeededDiscovery, bootstrap?.assets]);
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

  const results = useDiscoveryResults(filters, seededAssets);

  return {
    filters,
    setFilters: updateFilters,
    results,
  };
}
