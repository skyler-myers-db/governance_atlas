import { useEffect, useRef } from "react";

export function useSurfaceUrlSync({
  surface,
  routeAssetFqn,
  discoveryQuery,
}) {
  const previousRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const activeModule =
      surface === "lineage" ? "lineage" : surface === "governance" ? "governance" : "discovery";
    params.set("module", activeModule);
    params.set("surface", surface);
    if (surface !== "discovery" && routeAssetFqn) params.set("asset", routeAssetFqn);
    else params.delete("asset");
    params.delete("preview");
    if (surface === "discovery" && discoveryQuery?.trim()) params.set("q", discoveryQuery.trim());
    else params.delete("q");
    const nextSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, "");
    const nextState = {
      surface,
      routeAssetFqn: routeAssetFqn || "",
    };
    const previous = previousRef.current;
    const structuralChange = Boolean(
      previous &&
        (previous.surface !== nextState.surface ||
          previous.routeAssetFqn !== nextState.routeAssetFqn),
    );

    previousRef.current = nextState;
    if (currentSearch === nextSearch) return;

    const nextUrl = nextSearch ? `${window.location.pathname}?${nextSearch}` : window.location.pathname;
    if (structuralChange) {
      window.history.pushState({}, "", nextUrl);
    } else {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [discoveryQuery, routeAssetFqn, surface]);
}
