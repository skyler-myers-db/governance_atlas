import LineageStage from "./LineageStage";

export default function LineageWorkspace({
  asset,
  graphBundle,
  loading,
  error,
  context,
  onContextChange,
  onOpenGovernance,
  onSelectAsset,
  onOpenAsset,
  assetSearchQuery,
  onAssetSearchQueryChange,
  assetSearchResults,
  assetSearchLoading,
}) {
  return (
    <section className="gh-lineage-shell">
      <LineageStage
        asset={asset}
        assetSearchLoading={assetSearchLoading}
        assetSearchQuery={assetSearchQuery}
        assetSearchResults={assetSearchResults}
        context={context}
        embedded={false}
        error={error}
        graphBundle={graphBundle}
        loading={loading}
        onAssetSearchQueryChange={onAssetSearchQueryChange}
        onContextChange={onContextChange}
        onOpenAsset={onOpenAsset}
        onOpenGovernance={onOpenGovernance}
        onSelectAsset={onSelectAsset}
      />
    </section>
  );
}
