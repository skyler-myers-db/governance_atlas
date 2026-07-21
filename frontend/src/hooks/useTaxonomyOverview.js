// Wave B/C surface hooks (unused until TaxonomyWorkspace's rewrite):
// extracted from the two inline useQuery declarations in
// TaxonomyWorkspace.jsx (classification taxonomy overview + the taxonomy
// view of the CDE dashboard). Query keys mirror the inline ones so Wave C
// adoption is a drop-in with cache continuity.
import { fetchCdeDashboard, fetchTaxonomyOverview } from "../lib/api";
import { useAtlasQuery } from "./useAtlasQuery";

/**
 * The classification taxonomy overview (namespaces, nodes, terms).
 * @param {{ enabled?: boolean }} [options]
 */
export function useTaxonomyOverview(options = {}) {
  const enabled = options.enabled !== false;
  return useAtlasQuery({
    key: ["atlas", "taxonomy-overview"],
    enabled,
    fetch: (signal) => fetchTaxonomyOverview({ signal }),
    staleTime: 60_000,
    // Same 3s hydration cadence as the inline refetchInterval, now bounded.
    poll: { interval: 3_000, maxAttempts: 20 },
  });
}

/**
 * The CDE dashboard as consumed by the Taxonomy surface. Kept on the
 * taxonomy-scoped key TaxonomyWorkspace already uses (distinct from
 * useCdeDashboard's ["atlas", "cde-dashboard"]); the C4 Glossary/CDE merge
 * decides which of the two keys survives.
 * @param {{ enabled?: boolean }} [options]
 */
export function useTaxonomyCdeDashboard(options = {}) {
  const enabled = options.enabled !== false;
  return useAtlasQuery({
    key: ["atlas", "taxonomy-cde-dashboard"],
    enabled,
    fetch: (signal) => fetchCdeDashboard({ signal }),
    staleTime: 60_000,
    poll: { interval: 3_000, maxAttempts: 20 },
  });
}

export default useTaxonomyOverview;
