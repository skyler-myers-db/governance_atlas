// Hook used by the LineageCanvasV2 test mock to swap in a stand-in for
// the registered React Flow node type. The mock reads helpers.TYPES.lineage
// at render time, so a per-test override can inject a click target without
// re-mocking the whole module.
export const TYPES = { lineage: null };
