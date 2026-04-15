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
    tableTypeRaw: "",
    description: "",
    coverageScore: null,
    rows: "",
    format: "",
    storageFormat: "",
    managementType: "",
    size: "",
    files: "",
    domain: "",
    tier: "",
    certification: "",
    sensitivity: "",
    criticality: "",
    openRequests: null,
    owners: [],
    tags: [],
    relatedAssets: [],
    preview: [],
    columns: [],
    governanceStatus: "",
  };
}

function summaryForAsset(
  assetFqn,
  discoveryAssets,
  bootstrapAssets,
  bootstrapIndex,
  { allowFallback = true } = {},
) {
  if (!assetFqn) return null;
  return (
    discoveryAssets.find((asset) => asset.fqn === assetFqn) ||
    bootstrapIndex[assetFqn] ||
    bootstrapAssets.find((asset) => asset.fqn === assetFqn) ||
    (allowFallback ? assetFallback(assetFqn) : null)
  );
}

export function useSeededAssetContext(assetFqn, bootstrap, discoveryAssets = [], options = {}) {
  const bootstrapAssets = bootstrap?.assets || [];
  const bootstrapIndex = bootstrap?.assetIndex || {};
  const bootstrapGraphs = bootstrap?.graphs || {};
  const allowFallback = options?.allowFallback !== false;

  const summary = useMemo(
    () =>
      summaryForAsset(assetFqn, discoveryAssets, bootstrapAssets, bootstrapIndex, {
        allowFallback,
      }),
    [allowFallback, assetFqn, bootstrapAssets, bootstrapIndex, discoveryAssets]
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
