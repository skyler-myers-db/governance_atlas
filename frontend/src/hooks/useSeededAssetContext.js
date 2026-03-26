import { useMemo } from "react";

function assetFallback(assetFqn) {
  if (!assetFqn) return null;
  const parts = assetFqn.split(".");
  return {
    fqn: assetFqn,
    name: parts.at(-1) || assetFqn,
    catalog: parts[0] || "",
    schema: parts[1] || "",
    objectType: "",
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

export function useSeededAssetContext(assetFqn, bootstrap, discoveryAssets = []) {
  const bootstrapAssets = bootstrap?.assets || [];
  const bootstrapIndex = bootstrap?.assetIndex || {};
  const bootstrapGraphs = bootstrap?.graphs || {};

  const summary = useMemo(
    () => summaryForAsset(assetFqn, discoveryAssets, bootstrapAssets, bootstrapIndex),
    [assetFqn, bootstrapAssets, bootstrapIndex, discoveryAssets]
  );

  const seededGraph = useMemo(
    () => (assetFqn && bootstrapGraphs[assetFqn]) || null,
    [assetFqn, bootstrapGraphs]
  );

  return {
    summary,
    seededGraph,
  };
}
