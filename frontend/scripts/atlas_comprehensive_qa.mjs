/**
 * Prototype-era deployed QA compatibility wrapper.
 *
 * The legacy comprehensive QA script encoded the retired pre-prototype shell
 * selectors. Keep the public npm command stable, but delegate to the current
 * live endpoint validator that checks routed surfaces, Genie grounding,
 * Lakebase mirror health, lineage, Asset 360, audit, CDE, and control-center
 * contracts.
 *
 * Usage:
 *   node frontend/scripts/atlas_comprehensive_qa.mjs <base-url>
 */

if (process.argv[2] && !process.env.GOVAT_BASE_URL) {
  process.env.GOVAT_BASE_URL = process.argv[2];
}

if (process.env.GOVAT_QA_OUT_DIR && !process.env.GOVAT_ROUTE_OUT) {
  process.env.GOVAT_ROUTE_OUT = `${process.env.GOVAT_QA_OUT_DIR.replace(/\/+$/, "")}/route-validation.json`;
}

await import("./atlas_route_live_validation.mjs");
