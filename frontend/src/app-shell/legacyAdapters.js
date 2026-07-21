/*
 * app-shell/legacyAdapters.js — Wave B1 bridge between the nav fabric and the
 * legacy surfaces' drilled callback props.
 *
 * Every legacy surface keeps working this wave, but App.jsx stops being a
 * callback switchboard: the ~16 drilled navigation callbacks are implemented
 * ONCE here over useAtlasNavigate/usePeek and handed to surfaces by their
 * route wrappers (SurfaceRoutes.jsx). Each adapter dies with its consumer's
 * Wave C migration (surfaces will then import navigate()/EntityChip
 * directly).
 *
 * Legacy contracts deliberately preserved this wave (kill notes inline):
 *   - workspaceIntent sessionStorage for the Entity tab / Lineage context
 *     handoff (EntityWorkspace + LineageWorkspace still read it; ?tab= /
 *     ?context= become the source of truth when Wave B2/C7 land).
 *   - location.state.fresh for Discovery "fresh open" semantics
 *     (useDiscoveryWorkspace resets its in-memory refinements on it; dies in
 *     Wave C1 when Discovery reads the URL directly).
 */

import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { refHref } from "../nav/refs.js";
import { useAtlasNavigate, usePeek } from "../nav/useAtlasNavigate.js";
import { setWorkspaceIntent } from "../lib/workspaceIntent";

// Legacy discovery filter-group grammar (types/catalogs/domains/tiers/
// certifications/sensitivities arrays). Compact away empty groups so the
// serialized ?filters= JSON matches what the legacy shell produced.
export function compactDiscoveryFilterGroups(groups = {}) {
  const source = groups && typeof groups === "object" ? groups : {};
  const compact = {};
  for (const [key, values] of Object.entries(source)) {
    const list = [...new Set((Array.isArray(values) ? values : [values])
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean))];
    if (list.length) compact[key] = list;
  }
  return Object.keys(compact).length ? compact : null;
}

// Legacy module keys (SideIconRail/HomePage/AdminWorkspace vocabulary) → nav
// fabric surface refs, honoring the COHESION_BLUEPRINT absorptions: inbox →
// stewardship?assignee=me, cde → glossary?tab=cdes, capabilities →
// admin?tab=diagnostics, insights → home.
export const LEGACY_MODULE_TARGETS = Object.freeze({
  home: { surface: "home" },
  discovery: { surface: "discovery" },
  lineage: { surface: "lineage" },
  governance: { surface: "stewardship" },
  stewardship: { surface: "stewardship" },
  inbox: { surface: "stewardship", params: { assignee: "me" } },
  audit: { surface: "evidence" },
  evidence: { surface: "evidence" },
  taxonomy: { surface: "glossary" },
  glossary: { surface: "glossary" },
  cde: { surface: "glossary", params: { tab: "cdes" } },
  admin: { surface: "admin" },
  capabilities: { surface: "admin", params: { tab: "diagnostics" } },
  insights: { surface: "home" },
  help: { surface: "help" },
});

export function useLegacyNavAdapters() {
  const navigate = useAtlasNavigate();
  const routerNavigate = useNavigate();
  const { openPeek } = usePeek();

  // Discovery opens ride the router directly (not useAtlasNavigate) because
  // the legacy `location.state.fresh` flag must travel with the entry.
  const openDiscovery = useCallback(
    (params = {}, { fresh = true, replace = false } = {}) => {
      routerNavigate(refHref({ surface: "discovery", params }), {
        replace,
        state: { fresh: Boolean(fresh) },
      });
    },
    [routerNavigate],
  );

  const onOpenAsset = useCallback(
    (assetFqn, nextTab = "Overview") => {
      if (!assetFqn) return;
      // Parity: stage the target tab the way openEntityWorkspace did so the
      // legacy EntityWorkspace lands on the intended tab. WAVE-B2 kills this
      // in favor of ?tab=.
      setWorkspaceIntent("entityTab", assetFqn, nextTab);
      navigate({ kind: "asset", fqn: assetFqn });
    },
    [navigate],
  );

  const onOpenLineage = useCallback(
    (assetFqn, nextContext = "Data Lineage") => {
      if (assetFqn) {
        // Parity: Data Lineage vs Operational Context still travels via
        // workspaceIntent (LineageWorkspace reads it; ?context= takes over in C7).
        setWorkspaceIntent("lineageContext", assetFqn, nextContext);
        navigate({ kind: "lineage", fqn: assetFqn });
        return;
      }
      navigate({ surface: "lineage" });
    },
    [navigate],
  );

  const onOpenGovernance = useCallback(
    (assetFqn) => {
      navigate({ surface: "stewardship", params: assetFqn ? { asset: assetFqn } : {} });
    },
    [navigate],
  );

  const onOpenGlossaryTerm = useCallback(
    (term) => {
      if (!term) return;
      // The durable address replaces the sessionStorage+event double-handoff;
      // the /glossary/:termId route wrapper re-stages it for the legacy
      // TaxonomyWorkspace consumer (SurfaceRoutes.jsx).
      navigate({ kind: "term", id: term });
    },
    [navigate],
  );

  // HomePage contract: (filterGroups, query?, options?) where options may
  // carry {sortBy, views} for saved-view drills (e.g. Certified).
  const onOpenDiscoveryWithFilter = useCallback(
    (filterGroups, query = "", options = {}) => {
      const params = { q: query || "" };
      const filters = compactDiscoveryFilterGroups(filterGroups);
      if (filters) params.filters = filters;
      if (options.sortBy) params.sort = options.sortBy;
      if (Array.isArray(options.views) && options.views.length) params.views = options.views;
      if (options.previewAssetFqn) params.preview = options.previewAssetFqn;
      openDiscovery(params, { fresh: true });
    },
    [openDiscovery],
  );

  const onNavigate = useCallback(
    (moduleKey) => {
      const target = LEGACY_MODULE_TARGETS[String(moduleKey || "").trim()];
      if (!target) return;
      if (target.surface === "discovery") {
        openDiscovery(target.params || {}, { fresh: true });
        return;
      }
      navigate(target);
    },
    [navigate, openDiscovery],
  );

  return useMemo(
    () => ({
      onOpenAsset,
      // Legacy prop-name aliases for the same intent ("go to this asset"):
      // three names existed (onOpenAsset/onSelectAsset/onOpenAsset360); one
      // implementation now.
      onSelectAsset: onOpenAsset,
      onOpenLineage,
      onOpenGovernance,
      onOpenGlossaryTerm,
      onOpenDiscoveryWithFilter,
      onNavigate,
      openDiscovery,
      openPeek,
      navigate,
    }),
    [navigate, onNavigate, onOpenAsset, onOpenDiscoveryWithFilter, onOpenGlossaryTerm, onOpenGovernance, onOpenLineage, openDiscovery, openPeek],
  );
}

export default useLegacyNavAdapters;
