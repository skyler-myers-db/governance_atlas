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
    entityState,
    setEntityState,
    entityLineageContext,
    setEntityLineageContext,
    lineageState,
    setLineageState,
    governanceState,
    setGovernanceState,
    discoveryRouteState,
    setDiscoveryRouteQuery,
    openEntityWorkspace,
    openLineageWorkspace,
    openGovernanceWorkspace,
    submitDiscoverySearch,
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
          activeTab={entityState.tab}
          assetFqn={entityState.assetFqn}
          bootstrap={data}
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
      activeModule={surface === "lineage" ? "lineage" : surface === "governance" ? "governance" : "discovery"}
      bootMessage={bootMessage}
      bootState={bootState}
      onModuleChange={onModuleChange}
      onSearchBrowse={submitDiscoverySearch}
      onSearchResultSelect={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
      shell={shell}
    >
      {content}
    </AppFrame>
  );
}
