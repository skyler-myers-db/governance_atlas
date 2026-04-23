import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setWorkspaceIntent } from "../lib/workspaceIntent";

const KNOWN_SURFACES = ["home", "discovery", "entity", "lineage", "governance", "audit", "taxonomy", "help", "inbox", "capabilities", "insights", "cde", "admin"];
const DISCOVERY_GROUPED_FILTER_KEYS = [
  "types",
  "catalogs",
  "domains",
  "tiers",
  "certifications",
  "sensitivities",
];
const DEFERRED_DISCOVERY_PARAM_KEYS = [
  "type",
  "types",
  "catalog",
  "catalogs",
  "domain",
  "domains",
  "tier",
  "tiers",
  "certification",
  "certifications",
  "sensitivity",
  "sensitivities",
];

function normalizeRouteList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  )];
}

function normalizeDiscoveryFilterGroups(groups = {}) {
  const source = groups && typeof groups === "object" ? groups : {};
  return DISCOVERY_GROUPED_FILTER_KEYS.reduce((next, key) => {
    next[key] = normalizeRouteList(source[key]);
    return next;
  }, {});
}

function parseDiscoveryFilterGroups(search = "") {
  if (!search) return normalizeDiscoveryFilterGroups();
  try {
    const parsed = JSON.parse(search);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return normalizeDiscoveryFilterGroups();
    }
    return normalizeDiscoveryFilterGroups(parsed);
  } catch {
    return normalizeDiscoveryFilterGroups();
  }
}

function serializeDiscoveryFilterGroups(groups = {}) {
  const normalized = normalizeDiscoveryFilterGroups(groups);
  const compact = DISCOVERY_GROUPED_FILTER_KEYS.reduce((next, key) => {
    if (normalized[key].length) {
      next[key] = normalized[key];
    }
    return next;
  }, {});
  return Object.keys(compact).length ? JSON.stringify(compact) : "";
}

function safeDecode(segment = "") {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parsePathRoute(pathname = "/") {
  const segments = String(pathname || "/")
    .split("/")
    .filter(Boolean);
  if (!segments.length) return null;
  const [root, ...rest] = segments;
  if (root === "discovery") {
    return {
      surface: "discovery",
      asset: "",
    };
  }
  if (root === "entity" && rest.length) {
    return {
      surface: "entity",
      asset: safeDecode(rest.join("/")),
    };
  }
  if (root === "lineage" && rest.length) {
    return {
      surface: "lineage",
      asset: safeDecode(rest.join("/")),
    };
  }
  if (root === "lineage") {
    return {
      surface: "lineage",
      asset: "",
    };
  }
  if (root === "governance" || root === "glossary") {
    return {
      surface: "governance",
      asset: "",
    };
  }
  if (root === "audit") {
    return {
      surface: "audit",
      asset: "",
    };
  }
  if (root === "taxonomy") {
    return {
      surface: "taxonomy",
      asset: "",
    };
  }
  if (root === "help") {
    return {
      surface: "help",
      asset: "",
    };
  }
  if (root === "inbox") {
    return {
      surface: "inbox",
      asset: "",
    };
  }
  if (root === "home") {
    return {
      surface: "home",
      asset: "",
    };
  }
  if (root === "capabilities") {
    return {
      surface: "capabilities",
      asset: "",
    };
  }
  if (root === "insights") {
    return {
      surface: "insights",
      asset: "",
    };
  }
  if (root === "cde") {
    return {
      surface: "cde",
      asset: "",
    };
  }
  if (root === "admin") {
    return {
      surface: "admin",
      asset: "",
    };
  }
  return null;
}

function parseRouteState(pathname = "/", search = "") {
  const params = new URLSearchParams(search);
  const pathRoute = parsePathRoute(pathname);
  const surface = params.get("surface");
  const module = params.get("module");
  const normalizedModule =
    module && KNOWN_SURFACES.includes(module) ? module : "";
  const discoveryViews = normalizeRouteList([
    ...params.getAll("views"),
    ...(params.get("view") ? [params.get("view")] : []),
  ]);
  // Operator 2026-04-19 round 5: opening the app at `/` should land
   // on the new Home surface, not Discovery. The pathRoute parser
   // returns null for `/` so we default to "home" when no explicit
   // surface is declared.
  const initialSurface =
    pathRoute?.surface ||
    (surface && KNOWN_SURFACES.includes(surface)
      ? surface
      : normalizedModule) ||
    "home";
  const pathAsset = pathRoute?.asset || "";
  const queryAsset = params.get("asset") || "";
  const previewAsset = params.get("preview") || "";
  // Lineage and Entity surfaces may be deep-linked via legacy `?preview=fqn`
  // URLs produced elsewhere (Discovery preview sharing). Treat preview as a
  // last-resort asset identity so the surface auto-focuses rather than
  // landing on an empty state.
  const lineageOrEntityFallback =
    (initialSurface === "lineage" || initialSurface === "entity") && !pathAsset && !queryAsset
      ? previewAsset
      : "";
  const initialAsset = pathAsset || queryAsset || lineageOrEntityFallback;

  return {
    surface: initialSurface,
    asset: initialSurface === "discovery" ? "" : initialAsset,
    discoveryQuery: params.get("q") || "",
    discoverySort: params.get("sort") || "",
    discoveryPreview: previewAsset,
    discoveryViews,
    discoveryFilterGroups: parseDiscoveryFilterGroups(params.get("filters") || ""),
  };
}

function canonicalPath(surface, routeAssetFqn) {
  if (surface === "entity") {
    return routeAssetFqn ? `/entity/${encodeURIComponent(routeAssetFqn)}` : "/discovery";
  }
  if (surface === "lineage") {
    return routeAssetFqn ? `/lineage/${encodeURIComponent(routeAssetFqn)}` : "/lineage";
  }
  if (surface === "governance") return "/governance";
  if (surface === "audit") return "/audit";
  if (surface === "taxonomy") return "/taxonomy";
  if (surface === "help") return "/help";
  if (surface === "inbox") return "/inbox";
  if (surface === "home") return "/home";
  if (surface === "capabilities") return "/capabilities";
  if (surface === "insights") return "/insights";
  if (surface === "cde") return "/cde";
  if (surface === "admin") return "/admin";
  return "/discovery";
}

function buildCanonicalUrl(
  surface,
  routeAssetFqn,
  discoveryQuery = "",
  search = "",
  discoverySort = "",
  discoveryPreview = "",
  discoveryViews = [],
  discoveryFilterGroups = {},
) {
  const params = new URLSearchParams(search || "");
  params.delete("module");
  params.delete("surface");
  params.delete("view");
  params.delete("views");
  DEFERRED_DISCOVERY_PARAM_KEYS.forEach((key) => params.delete(key));

  if (surface === "governance" && routeAssetFqn) params.set("asset", routeAssetFqn);
  else params.delete("asset");

  if (discoveryQuery.trim()) params.set("q", discoveryQuery.trim());
  else params.delete("q");

  if (discoverySort.trim()) params.set("sort", discoverySort.trim());
  else params.delete("sort");

  if (discoveryPreview.trim()) params.set("preview", discoveryPreview.trim());
  else params.delete("preview");

  normalizeRouteList(discoveryViews).forEach((view) => {
    params.append("views", view);
  });

  const serializedFilterGroups = serializeDiscoveryFilterGroups(discoveryFilterGroups);
  if (serializedFilterGroups) params.set("filters", serializedFilterGroups);
  else params.delete("filters");

  const nextPath = canonicalPath(surface, routeAssetFqn);
  const nextSearch = params.toString();
  return nextSearch ? `${nextPath}?${nextSearch}` : nextPath;
}

export function useAppRouteState() {
  const location = useLocation();
  const navigate = useNavigate();
  const preserveGlossaryPath = location.pathname.startsWith("/glossary");
  const route = useMemo(
    () => parseRouteState(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const surface = route.surface;
  const routeAssetFqn = route.surface === "discovery" ? "" : route.asset;
  const discoveryRouteState = useMemo(
    () => ({
      query: route.discoveryQuery || "",
      sortBy: route.discoverySort || "",
      previewAssetFqn: route.discoveryPreview || "",
      views: route.discoveryViews || [],
      filterGroups: route.discoveryFilterGroups || normalizeDiscoveryFilterGroups(),
      requestKey: location.key || `${location.pathname}${location.search}`,
      fresh: Boolean(location.state && location.state.fresh === true),
    }),
    [location.key, location.pathname, location.search, location.state, route.discoveryFilterGroups, route.discoveryPreview, route.discoveryQuery, route.discoverySort, route.discoveryViews],
  );

  useEffect(() => {
    if (preserveGlossaryPath && surface === "governance") return;
    const nextUrl = buildCanonicalUrl(
      surface,
      routeAssetFqn,
      discoveryRouteState.query,
      location.search,
      discoveryRouteState.sortBy,
      discoveryRouteState.previewAssetFqn,
      discoveryRouteState.views,
      discoveryRouteState.filterGroups,
    );
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl !== currentUrl) {
      navigate(nextUrl, { replace: true, state: { fresh: false } });
    }
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.query, discoveryRouteState.sortBy, discoveryRouteState.views, location.pathname, location.search, navigate, preserveGlossaryPath, routeAssetFqn, surface]);

  const openEntityWorkspace = useCallback((assetFqn, nextTab = "Overview") => {
    if (!assetFqn) return;
    setWorkspaceIntent("entityTab", assetFqn, nextTab);
    navigate(buildCanonicalUrl(
      "entity",
      assetFqn,
      discoveryRouteState.query,
      location.search,
      discoveryRouteState.sortBy,
      discoveryRouteState.previewAssetFqn,
      discoveryRouteState.views,
      discoveryRouteState.filterGroups,
    ), {
      state: { fresh: false },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.query, discoveryRouteState.sortBy, discoveryRouteState.views, location.search, navigate]);

  const openLineageWorkspace = useCallback((assetFqn, nextContext = "Data Lineage") => {
    const hasExplicitAsset = assetFqn !== undefined;
    const nextAssetFqn = hasExplicitAsset ? assetFqn || "" : routeAssetFqn || "";
    if (hasExplicitAsset) {
      setWorkspaceIntent("lineageContext", nextAssetFqn, nextContext);
    }
    navigate(buildCanonicalUrl(
      "lineage",
      nextAssetFqn,
      discoveryRouteState.query,
      location.search,
      discoveryRouteState.sortBy,
      discoveryRouteState.previewAssetFqn,
      discoveryRouteState.views,
      discoveryRouteState.filterGroups,
    ), {
      state: { fresh: false },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.query, discoveryRouteState.sortBy, discoveryRouteState.views, location.search, navigate, routeAssetFqn]);

  const openGovernanceWorkspace = useCallback((assetFqn) => {
    navigate(buildCanonicalUrl(
      "governance",
      assetFqn || "",
      discoveryRouteState.query,
      location.search,
      discoveryRouteState.sortBy,
      discoveryRouteState.previewAssetFqn,
      discoveryRouteState.views,
      discoveryRouteState.filterGroups,
    ), {
      state: { fresh: false },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.query, discoveryRouteState.sortBy, discoveryRouteState.views, location.search, navigate]);

  const setDiscoveryRouteQuery = useCallback((query = "", options = {}) => {
    const nextUrl = buildCanonicalUrl(
      "discovery",
      "",
      query,
      location.search,
      discoveryRouteState.sortBy,
      discoveryRouteState.previewAssetFqn,
      discoveryRouteState.views,
      discoveryRouteState.filterGroups,
    );
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl === currentUrl && !options.fresh) return;
    // Debounced live discovery edits keep one stable browser-history boundary.
    // Callers can still opt into push semantics for explicit fresh discovery opens.
    const shouldReplace = options.replace ?? true;
    navigate(nextUrl, {
      replace: shouldReplace,
      state: { fresh: Boolean(options.fresh) },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.sortBy, discoveryRouteState.views, location.pathname, location.search, navigate]);

  const setDiscoveryRouteSort = useCallback((sortBy = "", options = {}) => {
    const nextUrl = buildCanonicalUrl(
      "discovery",
      "",
      discoveryRouteState.query,
      location.search,
      sortBy,
      discoveryRouteState.previewAssetFqn,
      discoveryRouteState.views,
      discoveryRouteState.filterGroups,
    );
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl === currentUrl && !options.fresh) return;
    // Sort changes are live refinements, so they replace by default unless a
    // caller explicitly requests a fresh discovery navigation.
    const shouldReplace = options.replace ?? true;
    navigate(nextUrl, {
      replace: shouldReplace,
      state: { fresh: Boolean(options.fresh) },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.query, discoveryRouteState.views, location.pathname, location.search, navigate]);

  const setDiscoveryRoutePreview = useCallback((previewAssetFqn = "", options = {}) => {
    const nextUrl = buildCanonicalUrl(
      "discovery",
      "",
      discoveryRouteState.query,
      location.search,
      discoveryRouteState.sortBy,
      previewAssetFqn,
      discoveryRouteState.views,
      discoveryRouteState.filterGroups,
    );
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl === currentUrl && !options.fresh) return;
    // Preview selection is a live discovery refinement, so it replaces by
    // default unless a caller explicitly requests a fresh navigation boundary.
    const shouldReplace = options.replace ?? true;
    navigate(nextUrl, {
      replace: shouldReplace,
      state: { fresh: Boolean(options.fresh) },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.query, discoveryRouteState.sortBy, discoveryRouteState.views, location.pathname, location.search, navigate]);

  const setDiscoveryRouteViews = useCallback((views = [], options = {}) => {
    const nextUrl = buildCanonicalUrl(
      "discovery",
      "",
      discoveryRouteState.query,
      location.search,
      discoveryRouteState.sortBy,
      discoveryRouteState.previewAssetFqn,
      views,
      discoveryRouteState.filterGroups,
    );
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl === currentUrl && !options.fresh) return;
    // Saved view changes are live discovery refinements, so they replace by
    // default unless a caller explicitly requests a fresh navigation boundary.
    const shouldReplace = options.replace ?? true;
    navigate(nextUrl, {
      replace: shouldReplace,
      state: { fresh: Boolean(options.fresh) },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.query, discoveryRouteState.sortBy, location.pathname, location.search, navigate]);

  const setDiscoveryRouteFilterGroups = useCallback((filterGroups = {}, options = {}) => {
    const nextUrl = buildCanonicalUrl(
      "discovery",
      "",
      discoveryRouteState.query,
      location.search,
      discoveryRouteState.sortBy,
      discoveryRouteState.previewAssetFqn,
      discoveryRouteState.views,
      filterGroups,
    );
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl === currentUrl && !options.fresh) return;
    // Grouped filter changes are live discovery refinements, so they replace by
    // default unless a caller explicitly requests a fresh navigation boundary.
    const shouldReplace = options.replace ?? true;
    navigate(nextUrl, {
      replace: shouldReplace,
      state: { fresh: Boolean(options.fresh) },
    });
  }, [discoveryRouteState.previewAssetFqn, discoveryRouteState.query, discoveryRouteState.sortBy, discoveryRouteState.views, location.pathname, location.search, navigate]);

  const openDiscoveryWorkspace = useCallback((query = "", options = {}) => {
    const nextSort = options.sortBy ?? discoveryRouteState.sortBy;
    const freshOpen = Boolean(options.fresh);
    const nextPreview =
      options.previewAssetFqn ?? (freshOpen ? "" : discoveryRouteState.previewAssetFqn);
    const nextViews =
      options.views ?? (freshOpen ? [] : discoveryRouteState.views);
    const nextFilterGroups =
      options.filterGroups ?? (freshOpen ? normalizeDiscoveryFilterGroups() : discoveryRouteState.filterGroups);
    const nextUrl = buildCanonicalUrl(
      "discovery",
      "",
      query,
      location.search,
      nextSort,
      nextPreview,
      nextViews,
      nextFilterGroups,
    );
    navigate(nextUrl, {
      replace: Boolean(options.replace),
      state: { fresh: freshOpen },
    });
  }, [discoveryRouteState.filterGroups, discoveryRouteState.previewAssetFqn, discoveryRouteState.sortBy, discoveryRouteState.views, location.search, navigate]);

  const onModuleChange = useCallback((nextModule) => {
    // Home now has its own dedicated surface at `/` — a landing page
    // with a hero, quick-start cards, live estate stats, and recent
    // activity. Operator 2026-04-19 round 4 asked for Home to be a
    // real page, not a Discovery alias.
    if (nextModule === "home") {
      navigate(buildCanonicalUrl(
        "home",
        "",
        "",
        location.search,
        "",
        "",
        [],
        normalizeDiscoveryFilterGroups(),
      ), { state: { fresh: true } });
      return;
    }
    if (nextModule === "discovery") {
      openDiscoveryWorkspace(discoveryRouteState.query, { fresh: true });
      return;
    }
    if (nextModule === "lineage") {
      openLineageWorkspace(routeAssetFqn || "");
      return;
    }
    if (nextModule === "audit") {
      navigate(buildCanonicalUrl(
        "audit",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    if (nextModule === "taxonomy") {
      navigate(buildCanonicalUrl(
        "taxonomy",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    if (nextModule === "help") {
      navigate(buildCanonicalUrl(
        "help",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    if (nextModule === "inbox") {
      navigate(buildCanonicalUrl(
        "inbox",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    if (nextModule === "capabilities") {
      navigate(buildCanonicalUrl(
        "capabilities",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    if (nextModule === "insights") {
      navigate(buildCanonicalUrl(
        "insights",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    if (nextModule === "cde") {
      navigate(buildCanonicalUrl(
        "cde",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    if (nextModule === "admin") {
      navigate(buildCanonicalUrl(
        "admin",
        "",
        discoveryRouteState.query,
        location.search,
        discoveryRouteState.sortBy,
        discoveryRouteState.previewAssetFqn,
        discoveryRouteState.views,
        discoveryRouteState.filterGroups,
      ), { state: { fresh: false } });
      return;
    }
    openGovernanceWorkspace(routeAssetFqn || "");
  }, [
    discoveryRouteState.filterGroups,
    discoveryRouteState.previewAssetFqn,
    discoveryRouteState.query,
    discoveryRouteState.sortBy,
    discoveryRouteState.views,
    location.search,
    navigate,
    openDiscoveryWorkspace,
    openGovernanceWorkspace,
    openLineageWorkspace,
    routeAssetFqn,
  ]);

  const setSurface = useCallback((nextSurface) => {
    if (nextSurface === "entity" && routeAssetFqn) {
      openEntityWorkspace(routeAssetFqn);
      return;
    }
    onModuleChange(nextSurface);
  }, [onModuleChange, openEntityWorkspace, routeAssetFqn]);

  return {
    surface,
    setSurface,
    routeAssetFqn,
    discoveryRouteState,
    openEntityWorkspace,
    openLineageWorkspace,
    openGovernanceWorkspace,
    openDiscoveryWorkspace,
    setDiscoveryRouteFilterGroups,
    setDiscoveryRouteQuery,
    setDiscoveryRoutePreview,
    setDiscoveryRouteSort,
    setDiscoveryRouteViews,
    onModuleChange,
  };
}
