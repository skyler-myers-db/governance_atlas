import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBootstrap } from "../lib/api";

/** @returns {any} */
function initialBootstrap() {
  if (typeof window === "undefined") return null;
  return /** @type {any} */ (window.__GOVHUB_BOOTSTRAP__) || null;
}

function normalizeRouteContext(routeContext = {}) {
  return {
    surface: routeContext.surface || "discovery",
    asset: routeContext.asset || "",
  };
}

export function useBootstrap(routeContext = {}) {
  const seeded = useMemo(() => initialBootstrap(), []);
  const resolvedRouteContext = normalizeRouteContext(routeContext);
  const query = useQuery({
    queryKey: [
      "bootstrap",
      resolvedRouteContext.surface,
      resolvedRouteContext.asset,
    ],
    queryFn: ({ signal }) => fetchBootstrap(resolvedRouteContext, { signal }),
    initialData: seeded || undefined,
    staleTime: 0,
  });
  const message = query.error?.message || "Failed to load Governance Hub bootstrap payload.";

  return {
    loading: query.isPending && !query.data,
    refreshing: query.isFetching,
    error: query.data ? "" : query.isError ? message : "",
    refreshError: query.data && query.isError ? message : "",
    data: query.data || null,
    refresh: query.refetch,
  };
}
