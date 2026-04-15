import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setWorkspaceIntent } from "../lib/workspaceIntent";

const KNOWN_SURFACES = ["discovery", "entity", "lineage", "governance"];

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
  return null;
}

function parseRouteState(pathname = "/", search = "") {
  const params = new URLSearchParams(search);
  const pathRoute = parsePathRoute(pathname);
  const surface = params.get("surface");
  const module = params.get("module");
  const normalizedModule =
    module && KNOWN_SURFACES.includes(module) ? module : "";
  const initialSurface =
    pathRoute?.surface ||
    (surface && KNOWN_SURFACES.includes(surface)
      ? surface
      : normalizedModule) ||
    "discovery";
  const pathAsset = pathRoute?.asset || "";
  const queryAsset = params.get("asset") || "";
  const initialAsset = pathAsset || queryAsset;

  return {
    surface: initialSurface,
    asset: initialSurface === "discovery" ? "" : initialAsset,
    discoveryQuery: params.get("q") || "",
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
  return "/discovery";
}

function buildCanonicalUrl(surface, routeAssetFqn, discoveryQuery = "", search = "") {
  const params = new URLSearchParams(search || "");
  params.delete("module");
  params.delete("surface");
  params.delete("preview");

  if (surface === "governance" && routeAssetFqn) params.set("asset", routeAssetFqn);
  else params.delete("asset");

  if (surface === "discovery" && discoveryQuery.trim()) params.set("q", discoveryQuery.trim());
  else params.delete("q");

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
      requestKey: location.key || `${location.pathname}${location.search}`,
      fresh: Boolean(location.state && location.state.fresh === true),
    }),
    [location.key, location.pathname, location.search, location.state, route.discoveryQuery],
  );

  useEffect(() => {
    if (preserveGlossaryPath && surface === "governance") return;
    const nextUrl = buildCanonicalUrl(surface, routeAssetFqn, discoveryRouteState.query, location.search);
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl !== currentUrl) {
      navigate(nextUrl, { replace: true, state: { fresh: false } });
    }
  }, [discoveryRouteState.query, location.pathname, location.search, navigate, preserveGlossaryPath, routeAssetFqn, surface]);

  const openEntityWorkspace = useCallback((assetFqn, nextTab = "Overview") => {
    if (!assetFqn) return;
    setWorkspaceIntent("entityTab", assetFqn, nextTab);
    navigate(canonicalPath("entity", assetFqn), { state: { fresh: false } });
  }, [navigate]);

  const openLineageWorkspace = useCallback((assetFqn, nextContext = "Data Lineage") => {
    const hasExplicitAsset = assetFqn !== undefined;
    const nextAssetFqn = hasExplicitAsset ? assetFqn || "" : routeAssetFqn || "";
    if (hasExplicitAsset) {
      setWorkspaceIntent("lineageContext", nextAssetFqn, nextContext);
    }
    navigate(canonicalPath("lineage", nextAssetFqn), {
      state: { fresh: false },
    });
  }, [navigate, routeAssetFqn]);

  const openGovernanceWorkspace = useCallback((assetFqn) => {
    navigate(buildCanonicalUrl("governance", assetFqn || "", discoveryRouteState.query, location.search), {
      state: { fresh: false },
    });
  }, [discoveryRouteState.query, location.search, navigate]);

  const setDiscoveryRouteQuery = useCallback((query = "", options = {}) => {
    const nextUrl = buildCanonicalUrl("discovery", "", query, location.search);
    const currentUrl = `${location.pathname}${location.search}`;
    if (nextUrl === currentUrl && !options.fresh) return;
    navigate(nextUrl, {
      replace: options.replace !== false,
      state: { fresh: Boolean(options.fresh) },
    });
  }, [location.pathname, location.search, navigate]);

  const openDiscoveryWorkspace = useCallback((query = "", options = {}) => {
    const nextUrl = buildCanonicalUrl("discovery", "", query, location.search);
    navigate(nextUrl, {
      replace: Boolean(options.replace),
      state: { fresh: Boolean(options.fresh) },
    });
  }, [location.search, navigate]);

  const onModuleChange = useCallback((nextModule) => {
    if (nextModule === "discovery") {
      openDiscoveryWorkspace(discoveryRouteState.query, { fresh: false });
    } else if (nextModule === "lineage") {
      openLineageWorkspace(routeAssetFqn || "");
    } else {
      openGovernanceWorkspace(routeAssetFqn || "");
    }
  }, [
    discoveryRouteState.query,
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
    setDiscoveryRouteQuery,
    onModuleChange,
  };
}
