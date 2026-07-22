/*
 * surfaces/discovery/discoveryParams.js — Discover's URL contract (Wave C1).
 *
 * The URL is the state (COHESION layer 3): every restorable piece of Discover
 * view state lives in flat, surface-scoped search params read/written through
 * nav/useSurfaceParams. The legacy grammar — ?filters=<JSON>, plural facet
 * shortcuts (?domains=…), ?views=, ?preview= — stays alive as INPUT only:
 * normalizeLegacyDiscoverySearch() rewrites it into the flat params below via
 * a replace-redirect in the route wrapper, so every old deep link keeps
 * working while only canonical URLs are ever emitted.
 */

/** Canonical flat params. Module-level constant → useSurfaceParams normalizes once. */
export const DISCOVERY_PARAMS_SCHEMA = {
  q: { type: "string" },
  sort: { type: "string" },
  // Saved governance views from bootstrap.discovery.views ("Needs owner", …).
  view: { type: "array" },
  type: { type: "array" },
  catalog: { type: "array" },
  domain: { type: "array" },
  tier: { type: "array" },
  certification: { type: "array" },
  sensitivity: { type: "array" },
  criticality: { type: "array" },
  // Client-side owner facet (an exact owner label, or "__unassigned__").
  owner: { type: "string" },
  cde: { type: "bool", default: false },
  // ?peek= is deliberately NOT here: nav/usePeek owns it, and useSurfaceParams
  // preserves params outside the schema on every write.
};

// Legacy grouped-filter keys (the ?filters= JSON payload and plural shortcut
// params) → canonical flat param names.
const LEGACY_GROUP_TO_PARAM = {
  types: "type",
  type: "type",
  catalogs: "catalog",
  catalog: "catalog",
  domains: "domain",
  domain: "domain",
  tiers: "tier",
  tier: "tier",
  certifications: "certification",
  certification: "certification",
  sensitivities: "sensitivity",
  sensitivity: "sensitivity",
  businessCriticalities: "criticality",
  criticalities: "criticality",
  criticality: "criticality",
};

// Canonical param → legacy grouped-filter key (for the search request shape).
export const PARAM_TO_FILTER_GROUP = {
  type: "types",
  catalog: "catalogs",
  domain: "domains",
  tier: "tiers",
  certification: "certifications",
  sensitivity: "sensitivities",
  criticality: "businessCriticalities",
};

function cleanValues(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        // The legacy grammar sometimes shipped "All …" sentinels; they mean
        // "no filter" and must never survive into the URL.
        .filter((value) => !/^all\s/i.test(value)),
    ),
  ];
}

/**
 * Normalize a legacy discovery search string into the canonical flat grammar.
 * Returns the normalized search string ("" or "?…") when a rewrite is needed,
 * or null when the input is already canonical (no redirect required).
 */
export function normalizeLegacyDiscoverySearch(search) {
  const params = new URLSearchParams(search || "");
  let changed = false;
  const merged = new Map(); // canonical param -> Set of values

  const addTo = (param, values) => {
    if (!merged.has(param)) merged.set(param, new Set());
    const bucket = merged.get(param);
    for (const value of cleanValues(values)) bucket.add(value);
  };

  // 1. ?filters=<JSON grouped payload> → flat facet params.
  const rawFilters = params.get("filters");
  if (rawFilters != null) {
    changed = true;
    params.delete("filters");
    try {
      const parsed = JSON.parse(rawFilters);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [groupKey, values] of Object.entries(parsed)) {
          const param = LEGACY_GROUP_TO_PARAM[groupKey];
          if (param) addTo(param, values);
        }
      }
    } catch {
      /* malformed JSON in a hand-edited URL degrades to "no filters" */
    }
  }

  // 2. Plural facet shortcut params (?domains=…&domains=…) → singular.
  for (const [legacyKey, param] of Object.entries(LEGACY_GROUP_TO_PARAM)) {
    if (legacyKey === param) continue; // singular spellings are canonical
    const values = params.getAll(legacyKey);
    if (values.length) {
      changed = true;
      params.delete(legacyKey);
      addTo(param, values);
    }
  }

  // 3. ?views= (repeatable) → ?view= (canonical repeatable name).
  const legacyViews = params.getAll("views");
  if (legacyViews.length) {
    changed = true;
    params.delete("views");
    addTo("view", legacyViews);
  }

  // 4. ?preview=<fqn> → ?peek=<fqn> (the one addressable drawer binding —
  //    COHESION: "drawer preview binds ?peek=<fqn>"). An explicit ?peek= wins.
  const preview = params.get("preview");
  if (preview != null) {
    changed = true;
    params.delete("preview");
    if (preview && !params.get("peek")) params.set("peek", preview);
  }

  if (!changed) return null;

  for (const [param, bucket] of merged.entries()) {
    const existing = new Set(params.getAll(param));
    for (const value of bucket) {
      if (!existing.has(value)) params.append(param, value);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Map the flat URL params to the discovery search request shape consumed by
 * useDiscoveryResults (which still speaks the backend's grouped vocabulary).
 */
export function filtersFromParams(params, bootstrap) {
  const sortOptions = Array.isArray(bootstrap?.discovery?.sortOptions)
    ? bootstrap.discovery.sortOptions
    : [];
  const requestedSort = String(params.sort || "").trim();
  const sortBy = sortOptions.includes(requestedSort)
    ? requestedSort
    : sortOptions[0] || "Best match";
  const knownViews = new Set(
    (bootstrap?.discovery?.views || []).filter((value) => value !== "All assets"),
  );
  return {
    query: String(params.q || ""),
    sortBy,
    views: cleanValues(params.view).filter(
      (value) => !knownViews.size || knownViews.has(value),
    ),
    types: cleanValues(params.type),
    catalogs: cleanValues(params.catalog),
    domains: cleanValues(params.domain),
    tiers: cleanValues(params.tier),
    certifications: cleanValues(params.certification),
    sensitivities: cleanValues(params.sensitivity),
    businessCriticalities: cleanValues(params.criticality),
    cdeOnly: Boolean(params.cde),
  };
}

/** True when any non-query scope (facets/views/CDE) is active. */
export function hasNonQueryFilters(filters) {
  return Boolean(
    filters.views.length ||
      filters.types.length ||
      filters.catalogs.length ||
      filters.domains.length ||
      filters.tiers.length ||
      filters.certifications.length ||
      filters.sensitivities.length ||
      filters.businessCriticalities.length ||
      filters.cdeOnly,
  );
}

/** The empty facet patch — one setParams() call clears the whole scope. */
export function clearedFacetParams() {
  return {
    q: "",
    view: [],
    type: [],
    catalog: [],
    domain: [],
    tier: [],
    certification: [],
    sensitivity: [],
    criticality: [],
    owner: "",
    cde: false,
  };
}
