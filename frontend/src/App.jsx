import { useEffect, useMemo, useState } from "react";
import AppFrame from "./components/AppFrame";
import DiscoveryWorkspace from "./components/DiscoveryWorkspace";
import GovernanceWorkspace from "./components/GovernanceWorkspace";
import LineageWorkspace from "./components/LineageWorkspace";
import { useBootstrap } from "./hooks/useBootstrap";
import { useAssetDetail } from "./hooks/useAssetDetail";
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
    previewTab: "Overview",
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
  const { loading, error, data } = useBootstrap();
  const [module, setModule] = useState("discovery");
  const [selectedAssetFqn, setSelectedAssetFqn] = useState("");
  const [lineageContext, setLineageContext] = useState("Data Lineage");
  const [discoveryState, setDiscoveryState] = useState(defaultDiscoveryState(null));

  useEffect(() => {
    if (!data) return;
    setDiscoveryState((current) => ({ ...defaultDiscoveryState(data), ...current }));
    if (!selectedAssetFqn && data.assets?.length) {
      setSelectedAssetFqn(data.assets[0].fqn);
    }
  }, [data, selectedAssetFqn]);

  const assets = data?.assets || [];
  const selectedSummary = useMemo(
    () => assets.find((asset) => asset.fqn === selectedAssetFqn) || assets[0] || null,
    [assets, selectedAssetFqn]
  );
  const assetDetail = useAssetDetail(selectedSummary?.fqn || "");
  const lineage = useLineage(selectedSummary?.fqn || "");

  if (loading) {
    return (
      <div className="gh-boot-screen">
        <div className="gh-boot-card">
          <div className="gh-eyebrow">Loading</div>
          <h1>Preparing the modern metadata workspace.</h1>
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
    if (module === "discovery") {
      content = (
        <DiscoveryWorkspace
          bootstrap={data}
          discoveryState={discoveryState}
          onDiscoveryStateChange={setDiscoveryState}
          onOpenLineage={(assetFqn) => {
            setSelectedAssetFqn(assetFqn);
            setModule("lineage");
          }}
          onSelectAsset={setSelectedAssetFqn}
          selectedAssetDetail={assetDetail.detail}
          selectedAssetFqn={selectedSummary?.fqn || ""}
          selectedAssetLoading={assetDetail.loading}
        />
      );
    } else if (module === "lineage") {
      content = selectedSummary ? (
        <LineageWorkspace
          asset={selectedSummary}
          context={lineageContext}
          error={lineage.error}
          graphBundle={lineage.graph}
          loading={lineage.loading}
          onContextChange={setLineageContext}
          onSelectAsset={(assetFqn) => {
            setSelectedAssetFqn(assetFqn);
            setModule("discovery");
          }}
        />
      ) : (
        unavailableWorkspace("Select an asset from discovery to inspect its lineage workspace.")
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
      onModuleChange={setModule}
      shell={shell}
    >
      {content}
    </AppFrame>
  );
}
