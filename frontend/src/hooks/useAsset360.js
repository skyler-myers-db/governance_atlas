import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAsset360 } from "../lib/api";

export const EMPTY_ASSET_360 = {
  asset: null,
  owners: [],
  stewards: [],
  badges: [],
  freshness: { state: "unavailable", observedAt: "", message: "" },
  usage: {},
  schema: [],
  governance: {
    glossaryTerms: [],
    ownerAssignments: [],
    openActivity: [],
  },
  quality: { state: "unavailable", runs: [], message: "" },
  access: { state: "unavailable", message: "" },
  activity: [],
  relatedAssets: [],
  downstreamDashboards: [],
  loadedSections: [],
  meta: null,
};

function normalizeAsset360Payload(payload, assetFqn = "") {
  const data = payload && typeof payload === "object" ? payload : {};
  const asset = data.asset && typeof data.asset === "object" ? data.asset : null;
  return {
    ...EMPTY_ASSET_360,
    ...data,
    asset,
    owners: Array.isArray(data.owners) ? data.owners : [],
    stewards: Array.isArray(data.stewards) ? data.stewards : [],
    badges: Array.isArray(data.badges) ? data.badges : [],
    usage: data.usage && typeof data.usage === "object" ? data.usage : {},
    schema: Array.isArray(data.schema) ? data.schema : [],
    governance: {
      ...EMPTY_ASSET_360.governance,
      ...(data.governance && typeof data.governance === "object" ? data.governance : {}),
    },
    quality: {
      ...EMPTY_ASSET_360.quality,
      ...(data.quality && typeof data.quality === "object" ? data.quality : {}),
    },
    access: {
      ...EMPTY_ASSET_360.access,
      ...(data.access && typeof data.access === "object" ? data.access : {}),
    },
    freshness: {
      ...EMPTY_ASSET_360.freshness,
      ...(data.freshness && typeof data.freshness === "object" ? data.freshness : {}),
    },
    activity: Array.isArray(data.activity) ? data.activity : [],
    relatedAssets: Array.isArray(data.relatedAssets) ? data.relatedAssets : [],
    downstreamDashboards: Array.isArray(data.downstreamDashboards) ? data.downstreamDashboards : [],
    loadedSections: Array.isArray(data.loadedSections) ? data.loadedSections : [],
    sameAsset: Boolean(asset?.fqn && asset?.fqn === assetFqn),
  };
}

export function useAsset360(assetFqn, options = {}) {
  /** @type {{ enabled?: boolean, staleTime?: number, gcTime?: number }} */
  const resolvedOptions = options && typeof options === "object" ? options : {};
  const normalizedFqn = String(assetFqn || "").trim();
  const enabled = resolvedOptions.enabled !== false && Boolean(normalizedFqn);
  const query = useQuery({
    queryKey: ["atlas", "asset360", normalizedFqn],
    queryFn: ({ signal }) => fetchAsset360(normalizedFqn, { signal }),
    enabled,
    staleTime: resolvedOptions.staleTime ?? 60_000,
    gcTime: resolvedOptions.gcTime ?? 5 * 60_000,
  });
  const data = useMemo(
    () => (query.data ? normalizeAsset360Payload(query.data, normalizedFqn) : null),
    [normalizedFqn, query.data],
  );
  return {
    data,
    loading: enabled && query.isPending,
    refreshing: query.isFetching && Boolean(query.data),
    error: query.error?.message || "",
    meta: data?.meta || null,
    refetch: query.refetch,
  };
}

export default useAsset360;
