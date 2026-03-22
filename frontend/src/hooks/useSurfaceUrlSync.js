import { useEffect } from "react";

export function useSurfaceUrlSync({
  surface,
  routeAssetFqn,
  entityTab,
  lineageContext,
  discoveryQuery,
}) {
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
    if (surface === "entity") params.set("entityTab", entityTab);
    else params.delete("entityTab");
    if (surface === "lineage") params.set("lineageContext", lineageContext);
    else params.delete("lineageContext");
    if (surface === "discovery" && discoveryQuery?.trim()) params.set("q", discoveryQuery.trim());
    else params.delete("q");
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", nextUrl);
  }, [discoveryQuery, entityTab, lineageContext, routeAssetFqn, surface]);
}
