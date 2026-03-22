import { useEffect, useMemo, useState } from "react";
import AppFrame from "./components/AppFrame";
import DiscoveryWorkspace from "./components/DiscoveryWorkspace";
import EntityWorkspace from "./components/EntityWorkspace";
import GovernanceWorkspace from "./components/GovernanceWorkspace";
import LineageWorkspace from "./components/LineageWorkspace";
import { useBootstrap } from "./hooks/useBootstrap";
import { useAssetSearch } from "./hooks/useAssetSearch";
import { useDiscoveryResults } from "./hooks/useDiscoveryResults";
import { useSurfaceUrlSync } from "./hooks/useSurfaceUrlSync";

function defaultDiscoveryState(data) {
  return {
    query: data?.discovery?.defaultQuery || "",
    sortBy: (data?.discovery?.sortOptions || ["Best match"])[0],
    view: (data?.discovery?.views || ["All assets"])[0],
    type: (data?.discovery?.assetTypes || ["All types"])[0],
    catalogs: ["All catalogs"],
    domains: ["All domains"],
    tiers: ["All tiers"],
    certifications: ["All certifications"],
    sensitivities: ["All sensitivities"],
  };
}

function initialRouteState() {
  if (typeof window === "undefined") {
    return {
      surface: "discovery",
      asset: "",
      entityTab: "Overview",
      lineageContext: "Data Lineage",
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
  };
}

function unavailableWorkspace(message) {
  return (
    <section className="gh-workspace gh-unavailable-workspace">
      <div className="gh-panel gh-unavailable-panel">
        <div className="gh-panel-title">Workspace Unavailable</div>
        <h2>The live metadata workspace could not initialize.</h2>
        <p>
          {message ||
            "Verify warehouse access, Unity Catalog permissions, and governance configuration, then retry."}
        </p>
      </div>
    </section>
  );
}

export default function App() {
  const route = useMemo(() => initialRouteState(), []);
  const { loading, error, data } = useBootstrap();
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
  const [discoveryState, setDiscoveryState] = useState(defaultDiscoveryState(null));
  const [shellSearchQuery, setShellSearchQuery] = useState("");

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

  useEffect(() => {
    if (!data) return;
    setDiscoveryState((current) => ({ ...defaultDiscoveryState(data), ...current }));
  }, [data]);

  useEffect(() => {
    if (surface === "discovery") {
      setShellSearchQuery(discoveryState.query || "");
    } else {
      setShellSearchQuery("");
    }
  }, [discoveryState.query, surface]);

  const discovery = useDiscoveryResults(discoveryState, data?.assets || []);
  const shellSearchOpen =
    shellSearchQuery.trim().length >= 2 &&
    (surface !== "discovery" || shellSearchQuery !== discoveryState.query);
  const shellSearch = useAssetSearch(shellSearchQuery, shellSearchOpen);

  useEffect(() => {
    const initialFqn = route.asset || data?.initialSelection?.primaryAssetFqn || "";
    if (!initialFqn) return;
    if (surface === "entity" && !entityState.assetFqn) {
      setEntityState((current) => ({ ...current, assetFqn: initialFqn }));
    }
    if (surface === "lineage" && !lineageState.focusAssetFqn) {
      setLineageState((current) => ({ ...current, focusAssetFqn: initialFqn }));
    }
    if (surface === "governance" && !governanceState.assetFqn) {
      setGovernanceState((current) => ({ ...current, assetFqn: initialFqn }));
    }
  }, [
    data?.initialSelection?.primaryAssetFqn,
    entityState.assetFqn,
    governanceState.assetFqn,
    lineageState.focusAssetFqn,
    route.asset,
    surface,
  ]);

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
  });

  if (loading) {
    return (
      <div className="gh-boot-screen">
        <div className="gh-boot-card">
          <div className="gh-eyebrow">Loading</div>
          <h1>Preparing the metadata workspace.</h1>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="gh-boot-screen">
        <div className="gh-boot-card gh-error-card">
          <div className="gh-eyebrow">Workspace Unavailable</div>
          <h1>The workspace could not load.</h1>
          <p>{error || "Bootstrap payload was unavailable."}</p>
        </div>
      </div>
    );
  }

  const shell = data.shell || {};
  const bootState = data.bootState || "live";
  const bootMessage = data.bootMessage || "";
  let content = unavailableWorkspace(bootMessage);

  if (bootState !== "unavailable" && bootState !== "error") {
    if (surface === "discovery") {
      content = (
        <DiscoveryWorkspace
          bootstrap={data}
          discoveryState={discoveryState}
          onDiscoveryStateChange={setDiscoveryState}
          onOpenAsset={openEntityWorkspace}
          onOpenGovernance={openGovernanceWorkspace}
          onOpenLineage={openLineageWorkspace}
          results={discovery.assets}
          resultsCount={discovery.count}
          resultsError={discovery.error}
          resultsFacets={discovery.facets}
          resultsLoading={discovery.loading}
        />
      );
    } else if (surface === "entity") {
      content = (
        <EntityWorkspace
          activeTab={entityState.tab}
          assetFqn={entityState.assetFqn}
          bootstrap={data}
          discoveryAssets={discovery.assets}
          lineageContext={entityLineageContext}
          onBack={() => {
            setSurface("discovery");
          }}
          onLineageContextChange={setEntityLineageContext}
          onOpenGovernance={openGovernanceWorkspace}
          onOpenLineage={(nextContext = "Data Lineage") =>
            openLineageWorkspace(entityState.assetFqn, nextContext)
          }
          onSelectAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
          onTabChange={(nextTab) =>
            setEntityState((current) => ({
              ...current,
              tab: nextTab,
            }))
          }
        />
      );
    } else if (surface === "lineage") {
      content = (
        <LineageWorkspace
          bootstrap={data}
          discoveryAssets={discovery.assets}
          initialAssetFqn={lineageState.focusAssetFqn}
          initialContext={lineageState.context}
          onRouteStateChange={({ assetFqn, context }) =>
            setLineageState((current) => ({
              focusAssetFqn: assetFqn ?? current.focusAssetFqn,
              context: context ?? current.context,
            }))
          }
          onOpenGovernance={openGovernanceWorkspace}
          onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
        />
      );
    } else {
      content = (
        <GovernanceWorkspace
          bootstrap={data}
          discoveryAssets={discovery.assets}
          initialAssetFqn={governanceState.assetFqn}
          governance={data.governance}
          onRouteAssetChange={(assetFqn) =>
            setGovernanceState({
              assetFqn,
            })
          }
          onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Governance")}
          onOpenLineage={openLineageWorkspace}
        />
      );
    }
  }

  return (
    <AppFrame
      activeModule={
        surface === "lineage" ? "lineage" : surface === "governance" ? "governance" : "discovery"
      }
      bootMessage={bootMessage}
      bootState={bootState}
      onModuleChange={(nextModule) => {
        if (nextModule === "discovery") {
          setSurface("discovery");
        } else if (nextModule === "lineage") {
          setSurface("lineage");
        } else {
          setSurface("governance");
        }
      }}
      onSearchQueryChange={setShellSearchQuery}
      onSearchResultSelect={(assetFqn) => {
        setShellSearchQuery("");
        openEntityWorkspace(assetFqn, "Overview");
      }}
      onSearchSubmit={() => {
        setDiscoveryState((current) => ({
          ...current,
          query: shellSearchQuery,
        }));
        setSurface("discovery");
      }}
      searchError={shellSearch.error}
      searchLoading={shellSearch.loading}
      searchPanelOpen={shellSearchOpen}
      searchQuery={shellSearchQuery}
      searchResults={shellSearch.assets}
      shell={shell}
    >
      {content}
    </AppFrame>
  );
}
