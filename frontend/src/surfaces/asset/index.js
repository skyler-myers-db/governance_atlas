/*
 * surfaces/asset — the Asset 360 hub surface (Wave B2).
 *
 * Route-flip exports (the orchestrator wires these after B1+B2 land):
 *   /assets/:fqn         → AssetHubPage   (default export of AssetHubPage.jsx)
 *   ?peek=<fqn> drawer   → AssetPeekPanel (shell mounts with {fqn, open, onClose})
 */
export { AssetHubPage, default } from "./AssetHubPage";
export { AssetPeekPanel } from "./AssetPeekPanel";
export { certifyGate, catalogExplorerGate, lineageGate, requestChangeGate } from "./gates";
