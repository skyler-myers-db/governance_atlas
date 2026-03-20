import { useEffect, useMemo, useState } from "react";
import AppFrame from "./components/AppFrame";
import DiscoveryWorkspace from "./components/DiscoveryWorkspace";
import EntityWorkspace from "./components/EntityWorkspace";
import GovernanceWorkspace from "./components/GovernanceWorkspace";
import LineageWorkspace from "./components/LineageWorkspace";
import { useBootstrap } from "./hooks/useBootstrap";
import { useAssetDetail } from "./hooks/useAssetDetail";
import { useAssetSearch } from "./hooks/useAssetSearch";
import { useDiscoveryResults } from "./hooks/useDiscoveryResults";
import { useLineage } from "./hooks/useLineage";

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
      module: "discovery",
      asset: "",
      discoverySurface: "catalog",
      entityTab: "Overview",
      lineageContext: "Data Lineage",
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    module: params.get("module") || "discovery",
    asset: params.get("asset") || "",
    discoverySurface: params.get("surface") === "entity" ? "entity" : "catalog",
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

function assetFallback(assetFqn) {
  if (!assetFqn) return null;
  const parts = assetFqn.split(".");
  return {
    fqn: assetFqn,
    name: parts.at(-1) || assetFqn,
    catalog: parts[0] || "",
    schema: parts[1] || "",
    objectType: "Table",
    description: "",
    coverageScore: 0,
    rows: "—",
    format: "—",
    size: "—",
    files: "—",
    domain: "Unassigned",
    tier: "Unassigned",
    certification: "Unassigned",
    sensitivity: "Unassigned",
    criticality: "Unassigned",
    openRequests: 0,
    owners: [],
    tags: [],
    relatedAssets: [],
    preview: [],
    columns: [],
    governanceStatus: "Needs Work",
  };
}

export default function App() {
  const route = useMemo(() => initialRouteState(), []);
  const { loading, error, data } = useBootstrap();
  const [module, setModule] = useState(route.module);
  const [selectedAssetFqn, setSelectedAssetFqn] = useState(route.asset);
  const [lineageContext, setLineageContext] = useState(route.lineageContext);
  const [entityTab, setEntityTab] = useState(route.entityTab);
  const [discoverySurface, setDiscoverySurface] = useState(route.discoverySurface);
  const [discoveryState, setDiscoveryState] = useState(defaultDiscoveryState(null));
  const [lineageSearchQuery, setLineageSearchQuery] = useState("");

  useEffect(() => {
    if (!data) return;
    setDiscoveryState((current) => ({ ...defaultDiscoveryState(data), ...current }));
  }, [data]);

  const discovery = useDiscoveryResults(discoveryState, data?.assets || []);
  const bootstrapAssets = data?.assets || [];
  const bootstrapIndex = data?.assetIndex || {};

  useEffect(() => {
    const initialFqn =
      selectedAssetFqn ||
      data?.initialSelection?.primaryAssetFqn ||
      discovery.selection?.primaryAssetFqn ||
      bootstrapAssets[0]?.fqn ||
      "";
    if (!selectedAssetFqn && initialFqn) {
      setSelectedAssetFqn(initialFqn);
    }
  }, [
    bootstrapAssets,
    data?.initialSelection?.primaryAssetFqn,
    discovery.selection?.primaryAssetFqn,
    selectedAssetFqn,
  ]);

  useEffect(() => {
    if (module !== "discovery" || discoverySurface !== "catalog") return;
    if (!discovery.assets.length) return;
    const currentVisible = selectedAssetFqn
      ? discovery.assets.some((asset) => asset.fqn === selectedAssetFqn)
      : false;
    if (!currentVisible) {
      setSelectedAssetFqn(
        discovery.selection?.primaryAssetFqn || discovery.assets[0]?.fqn || ""
      );
    }
  }, [
    discovery.assets,
    discovery.selection?.primaryAssetFqn,
    discoverySurface,
    module,
    selectedAssetFqn,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("module", module);
    if (selectedAssetFqn) params.set("asset", selectedAssetFqn);
    else params.delete("asset");
    if (module === "discovery" && discoverySurface === "entity") {
      params.set("surface", "entity");
      params.set("entityTab", entityTab);
    } else {
      params.delete("surface");
      params.delete("entityTab");
    }
    if (module === "lineage") params.set("lineageContext", lineageContext);
    else params.delete("lineageContext");
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", nextUrl);
  }, [discoverySurface, entityTab, lineageContext, module, selectedAssetFqn]);

  const selectedSummary = useMemo(() => {
    return (
      discovery.assets.find((asset) => asset.fqn === selectedAssetFqn) ||
      bootstrapIndex[selectedAssetFqn] ||
      bootstrapAssets.find((asset) => asset.fqn === selectedAssetFqn) ||
      assetFallback(selectedAssetFqn)
    );
  }, [bootstrapAssets, bootstrapIndex, discovery.assets, selectedAssetFqn]);

  const assetDetail = useAssetDetail(selectedAssetFqn || "");
  const currentAsset = assetDetail.detail || selectedSummary;
  const seededGraph = (selectedAssetFqn && data?.graphs?.[selectedAssetFqn]) || null;
  const lineage = useLineage(selectedAssetFqn || "", seededGraph);
  const lineageAssetSearch = useAssetSearch(lineageSearchQuery, module === "lineage");

  useEffect(() => {
    if (module !== "lineage") return;
    setLineageSearchQuery(currentAsset?.name || "");
  }, [currentAsset?.fqn, currentAsset?.name, module]);

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
    if (module === "discovery" && discoverySurface === "catalog") {
      content = (
        <DiscoveryWorkspace
          bootstrap={data}
          discoveryState={discoveryState}
          onDiscoveryStateChange={setDiscoveryState}
          onOpenAsset={(assetFqn) => {
            setSelectedAssetFqn(assetFqn);
            setDiscoverySurface("entity");
            setEntityTab("Overview");
            setModule("discovery");
          }}
          onOpenLineage={(assetFqn) => {
            setSelectedAssetFqn(assetFqn);
            setModule("lineage");
          }}
          onSelectAsset={setSelectedAssetFqn}
          results={discovery.assets}
          resultsCount={discovery.count}
          resultsError={discovery.error}
          resultsFacets={discovery.facets}
          resultsLoading={discovery.loading}
          selectedAssetDetail={assetDetail.detail}
          selectedAssetFqn={selectedAssetFqn}
          selectedAssetLoading={assetDetail.loading}
        />
      );
    } else if (module === "discovery") {
      content = (
        <EntityWorkspace
          activeTab={entityTab}
          asset={currentAsset}
          detail={assetDetail.detail}
          lineageBundle={lineage.graph}
          lineageLoading={lineage.loading}
          loading={assetDetail.loading}
          onBack={() => setDiscoverySurface("catalog")}
          onOpenLineage={(nextContext = "Data Lineage") => {
            setLineageContext(nextContext);
            setModule("lineage");
          }}
          onTabChange={setEntityTab}
        />
      );
    } else if (module === "lineage") {
      content = currentAsset ? (
        <LineageWorkspace
          asset={currentAsset}
          assetSearchLoading={lineageAssetSearch.loading}
          assetSearchQuery={lineageSearchQuery}
          assetSearchResults={lineageAssetSearch.assets}
          context={lineageContext}
          error={lineage.error}
          graphBundle={lineage.graph}
          loading={lineage.loading}
          onAssetSearchQueryChange={setLineageSearchQuery}
          onContextChange={setLineageContext}
          onOpenAsset={(assetFqn) => {
            setSelectedAssetFqn(assetFqn);
            setEntityTab("Overview");
            setDiscoverySurface("entity");
            setModule("discovery");
          }}
          onSelectAsset={setSelectedAssetFqn}
        />
      ) : (
        unavailableWorkspace("Select an asset to inspect its lineage workspace.")
      );
    } else {
      content = <GovernanceWorkspace governance={data.governance} />;
    }
  }

  return (
    <AppFrame
      activeModule={module}
      bootMessage={bootMessage}
      bootState={bootState}
      onModuleChange={(nextModule) => {
        setModule(nextModule);
        if (nextModule === "discovery" && discoverySurface !== "entity") {
          setDiscoverySurface("catalog");
        }
      }}
      shell={shell}
    >
      {content}
    </AppFrame>
  );
}
