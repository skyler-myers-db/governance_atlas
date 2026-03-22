import AppFrame from "./components/AppFrame";
import DiscoveryWorkspace from "./components/DiscoveryWorkspace";
import EntityWorkspace from "./components/EntityWorkspace";
import GovernanceWorkspace from "./components/GovernanceWorkspace";
import LineageWorkspace from "./components/LineageWorkspace";
import { useAppRouteState } from "./hooks/useAppRouteState";
import { useBootstrap } from "./hooks/useBootstrap";

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
  const { loading, error, data } = useBootstrap();
  const {
    surface,
    setSurface,
    routeAssetFqn,
    routeEntityTab,
    setRouteEntityTab,
    routeLineageContext,
    setRouteLineageContext,
    discoveryRouteState,
    setDiscoveryRouteQuery,
    openDiscoveryWorkspace,
    openEntityWorkspace,
    openLineageWorkspace,
    openGovernanceWorkspace,
    onModuleChange,
  } = useAppRouteState();

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
          initialQuery={discoveryRouteState.query}
          onRouteQueryChange={setDiscoveryRouteQuery}
          onOpenAsset={openEntityWorkspace}
          onOpenGovernance={openGovernanceWorkspace}
          onOpenLineage={openLineageWorkspace}
          querySeedKey={discoveryRouteState.requestKey}
        />
      );
    } else if (surface === "entity") {
      content = (
        <EntityWorkspace
          assetFqn={surface === "entity" ? routeAssetFqn : ""}
          bootstrap={data}
          initialTab={routeEntityTab}
          onBack={() => {
            setSurface("discovery");
          }}
          onOpenGovernance={openGovernanceWorkspace}
          onOpenLineage={(assetFqn, nextContext = "Data Lineage") =>
            openLineageWorkspace(assetFqn || routeAssetFqn, nextContext)
          }
          onSelectAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
          onTabRouteChange={setRouteEntityTab}
        />
      );
    } else if (surface === "lineage") {
      content = (
        <LineageWorkspace
          bootstrap={data}
          initialAssetFqn={surface === "lineage" ? routeAssetFqn : ""}
          initialContext={routeLineageContext}
          onRouteStateChange={({ assetFqn, context }) =>
            {
              if (assetFqn !== undefined) {
                openLineageWorkspace(assetFqn, context ?? routeLineageContext);
              } else if (context !== undefined) {
                setRouteLineageContext(context);
              }
            }
          }
          onOpenGovernance={openGovernanceWorkspace}
          onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
        />
      );
    } else {
      content = (
        <GovernanceWorkspace
          bootstrap={data}
          initialAssetFqn={surface === "governance" ? routeAssetFqn : ""}
          governance={data.governance}
          onRouteAssetChange={(assetFqn) => openGovernanceWorkspace(assetFqn || "")}
          onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Governance")}
          onOpenLineage={openLineageWorkspace}
        />
      );
    }
  }

  return (
    <AppFrame
      activeModule={surface === "lineage" ? "lineage" : surface === "governance" ? "governance" : "discovery"}
      bootMessage={bootMessage}
      bootState={bootState}
      onBrowseCatalog={openDiscoveryWorkspace}
      onModuleChange={onModuleChange}
      onSearchResultSelect={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
      shell={shell}
    >
      {content}
    </AppFrame>
  );
}
