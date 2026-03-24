import { useEffect, useMemo, useState } from "react";
import { setWorkspaceIntent } from "../lib/workspaceIntent";
import { useSurfaceUrlSync } from "./useSurfaceUrlSync";

function parseRouteState() {
  if (typeof window === "undefined") {
    return {
      surface: "discovery",
      asset: "",
      discoveryQuery: "",
    };
  }
  const params = new URLSearchParams(window.location.search);
  const surface = params.get("surface");
  const module = params.get("module");
  const initialSurface =
    surface && ["discovery", "entity", "lineage", "governance"].includes(surface)
      ? surface
      : module === "lineage"
        ? "lineage"
        : module === "governance"
          ? "governance"
          : "discovery";

  return {
    surface: initialSurface,
    asset: initialSurface === "discovery" ? "" : params.get("asset") || "",
    discoveryQuery: params.get("q") || "",
  };
}

export function useAppRouteState() {
  const route = useMemo(() => parseRouteState(), []);
  const [surface, setSurface] = useState(route.surface);
  const [routeAssetFqn, setRouteAssetFqn] = useState(route.surface === "discovery" ? "" : route.asset);
  const [discoveryRouteState, setDiscoveryRouteState] = useState({
    query: route.discoveryQuery || "",
    requestKey: route.discoveryQuery ? 1 : 0,
    fresh: false,
  });

  const openEntityWorkspace = (assetFqn, nextTab = "Overview") => {
    if (!assetFqn) return;
    setWorkspaceIntent("entityTab", assetFqn, nextTab);
    setRouteAssetFqn(assetFqn);
    setSurface("entity");
  };

  const openLineageWorkspace = (assetFqn, nextContext = "Data Lineage") => {
    if (assetFqn !== undefined) {
      setWorkspaceIntent("lineageContext", assetFqn || "", nextContext);
      setRouteAssetFqn(assetFqn || "");
    }
    setSurface("lineage");
  };

  const openGovernanceWorkspace = (assetFqn) => {
    if (assetFqn !== undefined) {
      setRouteAssetFqn(assetFqn || "");
    }
    setSurface("governance");
  };

  const setDiscoveryRouteQuery = (query = "", options = {}) => {
    setDiscoveryRouteState((current) =>
      current.query === query
        && current.fresh === Boolean(options.fresh)
        ? current
        : {
            ...current,
            query,
            requestKey: Date.now(),
            fresh: Boolean(options.fresh),
          },
    );
  };

  const openDiscoveryWorkspace = (query = "", options = {}) => {
    setSurface("discovery");
    setRouteAssetFqn("");
    setDiscoveryRouteQuery(query, options);
  };

  const onModuleChange = (nextModule) => {
    if (nextModule === "discovery") {
      openDiscoveryWorkspace("", { fresh: true });
    } else if (nextModule === "lineage") {
      setSurface("lineage");
    } else {
      setSurface("governance");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const onPopState = () => {
      const nextRoute = parseRouteState();
      setSurface(nextRoute.surface);
      setRouteAssetFqn(nextRoute.surface === "discovery" ? "" : nextRoute.asset);
      setDiscoveryRouteState({
        query: nextRoute.discoveryQuery || "",
        requestKey: Date.now(),
        fresh: false,
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useSurfaceUrlSync({
    surface,
    routeAssetFqn,
    discoveryQuery: discoveryRouteState.query,
  });

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
