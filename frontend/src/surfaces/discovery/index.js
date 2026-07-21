/*
 * surfaces/discovery — the Discover surface (Wave C1).
 *   /discovery → DiscoveryPage (router-self-sufficient: URL params via
 *   nav/useSurfaceParams; preview via ?peek= handled by the shell).
 */
export { DiscoveryPage, default } from "./DiscoveryPage";
export {
  DISCOVERY_PARAMS_SCHEMA,
  filtersFromParams,
  normalizeLegacyDiscoverySearch,
} from "./discoveryParams";
