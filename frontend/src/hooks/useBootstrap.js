import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBootstrap } from "../lib/api";

/** @returns {any} */
function initialBootstrap() {
  if (typeof window === "undefined") return null;
  return /** @type {any} */ (window.__GOVAT_BOOTSTRAP__) || null;
}

function normalizeRouteContext(routeContext = {}) {
  return {
    surface: routeContext.surface || "discovery",
    asset: routeContext.asset || "",
  };
}

function isInlineShellBootstrap(payload) {
  return payload?.bootstrapContract?.mode === "inline-shell";
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
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
  });
  const message = query.error?.message || "Failed to load Governance Atlas bootstrap payload.";
  const shellOnly = isInlineShellBootstrap(query.data);
  const hasData = Boolean(query.data);

  return {
    loading: !hasData || (shellOnly && query.isFetching),
    refreshing: query.isFetching,
    shellOnly,
    error: !hasData && query.isError ? message : "",
    refreshError: hasData && query.isError ? message : "",
    data: query.data || null,
    refresh: query.refetch,
  };
}
