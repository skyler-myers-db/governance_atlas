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

function summaryForAsset(assetFqn, discoveryAssets, bootstrapAssets, bootstrapIndex) {
  if (!assetFqn) return null;
  return (
    discoveryAssets.find((asset) => asset.fqn === assetFqn) ||
    bootstrapIndex[assetFqn] ||
    bootstrapAssets.find((asset) => asset.fqn === assetFqn) ||
    assetFallback(assetFqn)
  );
}

export default function App() {
  const route = useMemo(() => initialRouteState(), []);
  const { loading, error, data } = useBootstrap();
  const [surface, setSurface] = useState(route.surface);
  const [focusedAssetFqn, setFocusedAssetFqn] = useState(route.asset);
  const [lineageContext, setLineageContext] = useState(route.lineageContext);
  const [entityTab, setEntityTab] = useState(route.entityTab);
  const [discoveryState, setDiscoveryState] = useState(defaultDiscoveryState(null));
  const [shellSearchQuery, setShellSearchQuery] = useState("");
  const [lineageSearchQuery, setLineageSearchQuery] = useState("");

  const openEntityWorkspace = (assetFqn, nextTab = "Overview") => {
    setFocusedAssetFqn(assetFqn);
    setEntityTab(nextTab);
    setSurface("entity");
  };

  const openLineageWorkspace = (assetFqn, nextContext = "Data Lineage") => {
    if (assetFqn) {
      setFocusedAssetFqn(assetFqn);
    }
    setLineageContext(nextContext);
    setSurface("lineage");
  };

  const openGovernanceWorkspace = (assetFqn = "") => {
    if (assetFqn) {
      setFocusedAssetFqn(assetFqn);
    }
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
  const bootstrapAssets = data?.assets || [];
  const bootstrapIndex = data?.assetIndex || {};
  const shellSearchOpen =
    shellSearchQuery.trim().length >= 2 &&
    (surface !== "discovery" || shellSearchQuery !== discoveryState.query);
  const shellSearch = useAssetSearch(shellSearchQuery, shellSearchOpen);

  useEffect(() => {
    const initialFqn = route.asset || data?.initialSelection?.primaryAssetFqn || "";
    if (surface !== "discovery" && !focusedAssetFqn && initialFqn) {
      setFocusedAssetFqn(initialFqn);
    }
  }, [data?.initialSelection?.primaryAssetFqn, focusedAssetFqn, route.asset, surface]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const activeModule =
      surface === "lineage" ? "lineage" : surface === "governance" ? "governance" : "discovery";
    params.set("module", activeModule);
    params.set("surface", surface);
    if (surface !== "discovery" && focusedAssetFqn) params.set("asset", focusedAssetFqn);
    else params.delete("asset");
    params.delete("preview");
    if (surface === "entity") {
      params.set("entityTab", entityTab);
    } else {
      params.delete("entityTab");
    }
    if (surface === "lineage") params.set("lineageContext", lineageContext);
    else params.delete("lineageContext");
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", nextUrl);
  }, [entityTab, focusedAssetFqn, lineageContext, surface]);

  const focusedSummary = useMemo(
    () => summaryForAsset(focusedAssetFqn, discovery.assets, bootstrapAssets, bootstrapIndex),
    [bootstrapAssets, bootstrapIndex, discovery.assets, focusedAssetFqn]
  );

  const assetDetail = useAssetDetail(focusedAssetFqn || "");
  const currentAsset = assetDetail.detail || focusedSummary;
  const seededGraph = (focusedAssetFqn && data?.graphs?.[focusedAssetFqn]) || null;
  const lineage = useLineage(focusedAssetFqn || "", seededGraph);
  const lineageAssetSearch = useAssetSearch(lineageSearchQuery, surface === "lineage");

  useEffect(() => {
    if (surface !== "lineage") return;
    setLineageSearchQuery("");
  }, [currentAsset?.fqn, surface]);

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
          activeTab={entityTab}
          asset={currentAsset}
          detail={assetDetail.detail}
          lineageContext={lineageContext}
          lineageBundle={lineage.graph}
          lineageLoading={lineage.loading}
          loading={assetDetail.loading}
          onBack={() => {
            setSurface("discovery");
          }}
          onLineageContextChange={setLineageContext}
          onOpenGovernance={openGovernanceWorkspace}
          onOpenLineage={(nextContext = "Data Lineage") =>
            openLineageWorkspace(currentAsset?.fqn, nextContext)
          }
          onSelectAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
          onTabChange={setEntityTab}
        />
      );
    } else if (surface === "lineage") {
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
          onOpenGovernance={openGovernanceWorkspace}
          onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
          onSelectAsset={setFocusedAssetFqn}
        />
      ) : (
        unavailableWorkspace("Select an asset to inspect its lineage workspace.")
      );
    } else {
      content = (
        <GovernanceWorkspace
          governance={data.governance}
          onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Governance")}
          onOpenLineage={openLineageWorkspace}
          selectedAsset={currentAsset}
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
        setFocusedAssetFqn("");
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
