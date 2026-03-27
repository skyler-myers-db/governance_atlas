import AppFrame from "./components/AppFrame";
import DiscoveryWorkspace from "./components/DiscoveryWorkspace";
import EntityWorkspace from "./components/EntityWorkspace";
import GovernanceWorkspace from "./components/GovernanceWorkspace";
import LineageWorkspace from "./components/LineageWorkspace";
import { useAppRouteState } from "./hooks/useAppRouteState";
import { useBootstrap } from "./hooks/useBootstrap";

function bootShell(kicker, title, body) {
  return (
    <div className="gh-launch-screen">
      <div className="gh-launch-shell">
        <div className="gh-launch-header">
          <div className="gh-launch-brand">
            <div className="gh-launch-brand-mark">GH</div>
            <div className="gh-launch-brand-copy">
              <strong>Governance Hub</strong>
              <span>Metadata Workspace</span>
            </div>
          </div>
          <div className="gh-launch-modules">
            <span className="gh-launch-pill is-active">Discovery</span>
            <span className="gh-launch-pill">Lineage</span>
            <span className="gh-launch-pill">Governance</span>
          </div>
          <div className="gh-launch-identity">Preparing workspace</div>
        </div>

        <div className="gh-launch-search">
          <div className="gh-launch-search-label">Global Search</div>
          <div className="gh-launch-search-input">Search visible assets by name, schema, domain, or tag</div>
          <div className="gh-launch-search-button">Browse</div>
        </div>

        <div className="gh-launch-grid">
          <aside className="gh-launch-panel">
            <div className="gh-launch-kicker">Discovery Scope</div>
            <strong>Preparing filters</strong>
            <p>Loading asset types, saved views, and catalog scope.</p>
            <div className="gh-launch-skeleton-list">
              <span />
              <span />
              <span />
              <span />
            </div>
          </aside>

          <main className="gh-launch-panel">
            <div className="gh-launch-kicker">{kicker}</div>
            <strong>{title}</strong>
            <p>{body}</p>
            <div className="gh-launch-skeleton-cards">
              <span />
              <span />
              <span />
            </div>
          </main>

          <aside className="gh-launch-panel">
            <div className="gh-launch-kicker">Selected Asset</div>
            <strong>Preparing preview context</strong>
            <p>Loading schema, sample data, and lineage context for the first asset.</p>
            <div className="gh-launch-skeleton-list">
              <span />
              <span />
              <span />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
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
  const { loading, error, data } = useBootstrap();
  const {
    surface,
    setSurface,
    routeAssetFqn,
    discoveryRouteState,
    setDiscoveryRouteQuery,
    openDiscoveryWorkspace,
    openEntityWorkspace,
    openLineageWorkspace,
    openGovernanceWorkspace,
    onModuleChange,
  } = useAppRouteState();

  if (loading) {
    return bootShell(
      "Loading",
      "Preparing the metadata workspace.",
      "Connecting the discovery plane, lineage graph, and governance workbench.",
    );
  }

  if (error || !data) {
    return bootShell(
      "Workspace Unavailable",
      "The workspace could not load.",
      error || "Bootstrap payload was unavailable.",
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
          querySeedFresh={discoveryRouteState.fresh}
          querySeedKey={discoveryRouteState.requestKey}
        />
      );
    } else if (surface === "entity") {
      content = (
        <EntityWorkspace
          assetFqn={surface === "entity" ? routeAssetFqn : ""}
          bootstrap={data}
          onBack={() => {
            openDiscoveryWorkspace(discoveryRouteState.query, { fresh: false });
          }}
          onOpenGovernance={openGovernanceWorkspace}
          onOpenLineage={(assetFqn, nextContext = "Data Lineage") =>
            openLineageWorkspace(assetFqn || routeAssetFqn, nextContext)
          }
          onSelectAsset={(assetFqn, nextTab = "Overview") => openEntityWorkspace(assetFqn, nextTab)}
        />
      );
    } else if (surface === "lineage") {
      content = (
        <LineageWorkspace
          bootstrap={data}
          initialAssetFqn={surface === "lineage" ? routeAssetFqn : ""}
          onRouteAssetChange={(assetFqn, nextContext = "Data Lineage") =>
            openLineageWorkspace(assetFqn, nextContext)
          }
          onOpenGovernance={openGovernanceWorkspace}
          onOpenAsset={(assetFqn, nextTab = "Overview") => openEntityWorkspace(assetFqn, nextTab)}
        />
      );
    } else {
      content = (
        <GovernanceWorkspace
          bootstrap={data}
          initialAssetFqn={surface === "governance" ? routeAssetFqn : ""}
          governance={data.governance}
          onRouteAssetChange={(assetFqn) => openGovernanceWorkspace(assetFqn || "")}
          onOpenAsset={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
          onOpenLineage={openLineageWorkspace}
        />
      );
    }
  }

  return (
    <AppFrame
      activeModule={["discovery", "lineage", "governance"].includes(surface) ? surface : ""}
      bootMessage={bootMessage}
      bootState={bootState}
      onBrowseCatalog={(query) => openDiscoveryWorkspace(query, { fresh: true })}
      onModuleChange={onModuleChange}
      onSearchResultSelect={(assetFqn) => openEntityWorkspace(assetFqn, "Overview")}
      searchSeedAssets={data.assets || []}
      shell={shell}
    >
      {content}
    </AppFrame>
  );
}
