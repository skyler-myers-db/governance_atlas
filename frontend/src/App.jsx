import { useEffect, useState } from "react";
import AppFrame from "./components/AppFrame";
import DiscoveryWorkspace from "./components/DiscoveryWorkspace";
import GovernanceWorkspace from "./components/GovernanceWorkspace";
import LineageWorkspace from "./components/LineageWorkspace";
import { useBootstrap } from "./hooks/useBootstrap";
import { useAssetDetail } from "./hooks/useAssetDetail";
import { useLineage } from "./hooks/useLineage";

function defaultDiscoveryState(data) {
  return {
    query: "",
    sortBy: (data?.discovery?.sortOptions || ["Best match"])[0],
    views: ["All assets"],
    catalogs: ["All catalogs"],
    domains: ["All domains"],
    tiers: ["All tiers"],
    certifications: ["All certifications"],
    sensitivities: ["All sensitivities"],
    previewTab: "Overview",
  };
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
  const selectedSummary =
    assets.find((asset) => asset.fqn === selectedAssetFqn) || assets[0] || null;
  const assetDetail = useAssetDetail(selectedSummary?.fqn || "");
  const lineage = useLineage(selectedSummary?.fqn || "");

  if (loading) {
    return (
      <div className="gh-boot-screen">
        <div className="gh-boot-card">
          <div className="gh-eyebrow">Loading</div>
          <h1>Preparing the modern Governance Hub workspace.</h1>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="gh-boot-screen">
        <div className="gh-boot-card gh-error-card">
          <div className="gh-eyebrow">Modern Mode Unavailable</div>
          <h1>The React workspace could not load.</h1>
          <p>{error || "Bootstrap payload was unavailable."}</p>
        </div>
      </div>
    );
  }

  const shell = data.shell || {};
  let content = null;

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
    ) : null;
  } else {
    content = <GovernanceWorkspace governance={data.governance} />;
  }

  return (
    <AppFrame activeModule={module} onModuleChange={setModule} shell={shell}>
      {content}
    </AppFrame>
  );
}
