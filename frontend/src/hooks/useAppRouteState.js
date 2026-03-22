import { useEffect, useMemo, useState } from "react";
import { useSurfaceUrlSync } from "./useSurfaceUrlSync";

function parseRouteState() {
  if (typeof window === "undefined") {
    return {
      surface: "discovery",
      asset: "",
      entityTab: "Overview",
      lineageContext: "Data Lineage",
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
    entityTab: params.get("entityTab") || "Overview",
    lineageContext: params.get("lineageContext") || "Data Lineage",
    discoveryQuery: params.get("q") || "",
  };
}

export function useAppRouteState() {
  const route = useMemo(() => parseRouteState(), []);
  const [surface, setSurface] = useState(route.surface);
  const [entityState, setEntityState] = useState({
    assetFqn: route.surface === "entity" ? route.asset : "",
    tab: route.entityTab,
  });
  const [entityLineageContext, setEntityLineageContext] = useState("Data Lineage");
  const [lineageState, setLineageState] = useState({
    focusAssetFqn: route.surface === "lineage" ? route.asset : "",
    context: route.lineageContext,
  });
  const [governanceState, setGovernanceState] = useState({
    assetFqn: route.surface === "governance" ? route.asset : "",
  });
  const [discoveryRouteState, setDiscoveryRouteState] = useState({
    query: route.discoveryQuery || "",
    requestKey: route.discoveryQuery ? 1 : 0,
  });

  const openEntityWorkspace = (assetFqn, nextTab = "Overview") => {
    if (!assetFqn) return;
    setEntityState((current) => ({
      ...current,
      assetFqn,
      tab: nextTab,
    }));
    setSurface("entity");
  };

  const openLineageWorkspace = (assetFqn, nextContext = "Data Lineage") => {
    setLineageState({
      focusAssetFqn: assetFqn || "",
      context: nextContext,
    });
    setSurface("lineage");
  };

  const openGovernanceWorkspace = (assetFqn = "") => {
    setGovernanceState({
      assetFqn,
    });
    setSurface("governance");
  };

  const submitDiscoverySearch = (query = "") => {
    setEntityState({
      assetFqn: "",
      tab: "Overview",
    });
    setEntityLineageContext("Data Lineage");
    setLineageState({
      focusAssetFqn: "",
      context: "Data Lineage",
    });
    setGovernanceState({
      assetFqn: "",
    });
    setDiscoveryRouteState({
      query,
      requestKey: Date.now(),
    });
    setSurface("discovery");
  };

  const setDiscoveryRouteQuery = (query = "") => {
    setDiscoveryRouteState((current) =>
      current.query === query ? current : { ...current, query },
    );
  };

  const onModuleChange = (nextModule) => {
    if (nextModule === "discovery") {
      setSurface("discovery");
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
      setEntityState({
        assetFqn: nextRoute.surface === "entity" ? nextRoute.asset : "",
        tab: nextRoute.entityTab,
      });
      setLineageState({
        focusAssetFqn: nextRoute.surface === "lineage" ? nextRoute.asset : "",
        context: nextRoute.lineageContext,
      });
      setGovernanceState({
        assetFqn: nextRoute.surface === "governance" ? nextRoute.asset : "",
      });
      setDiscoveryRouteState({
        query: nextRoute.discoveryQuery || "",
        requestKey: Date.now(),
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const routeAssetFqn =
    surface === "entity"
      ? entityState.assetFqn
      : surface === "lineage"
        ? lineageState.focusAssetFqn
        : surface === "governance"
          ? governanceState.assetFqn
          : "";

  useSurfaceUrlSync({
    surface,
    routeAssetFqn,
    entityTab: entityState.tab,
    lineageContext: lineageState.context,
    discoveryQuery: discoveryRouteState.query,
  });

  return {
    surface,
    setSurface,
    entityState,
    setEntityState,
    entityLineageContext,
    setEntityLineageContext,
    lineageState,
    setLineageState,
    governanceState,
    setGovernanceState,
    discoveryRouteState,
    openEntityWorkspace,
    openLineageWorkspace,
    openGovernanceWorkspace,
    submitDiscoverySearch,
    setDiscoveryRouteQuery,
    onModuleChange,
  };
}
