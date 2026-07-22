/*
 * surfaces/asset/gates.js — capability gates for the Asset 360 hub (Wave B2).
 *
 * Replaces EntityWorkspace's 25-boolean capability calculus with four small
 * gates built on ONE rule (CLAUDE.md "Bootstrap capability vs API authority",
 * teardown P1-5): bootstrap/runtime capability flags are conservative
 * workspace-level guesses; the per-asset LIVE response is the authority.
 * A control may be disabled only when the live signal itself confirms
 * unavailability — never on bootstrap pessimism alone. That is why none of
 * these gates take a bootstrap payload at all: every input below is a live
 * per-asset response, so there is nothing pessimistic to overrule.
 */

/**
 * Lineage header button — input is the live useLineageGraphV2 output for
 * THIS asset.
 *
 * WHY always enabled: teardown P1-5 caught the header saying "Lineage
 * Unavailable" (from bootstrap `tableLineage.available:false`) while the
 * per-asset lineage API returned a real graph. Any node with a real FQN is
 * navigable; the Lineage Atlas surfaces the truth at the destination
 * (CLAUDE.md openability rule). The gate therefore only shapes the LABEL and
 * tooltip from live data — it never disables the door.
 */
export function lineageGate(graph) {
  const nodeCount = Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
  if (nodeCount > 1) {
    return {
      enabled: true,
      label: "Open lineage",
      reason: `${nodeCount} assets in the live lineage graph.`,
    };
  }
  if (graph?.error) {
    return {
      enabled: true,
      label: "Open lineage",
      reason: "The live lineage request failed; the Lineage Atlas will retry on open.",
    };
  }
  if (graph?.loading || graph?.hydrating || graph?.warming) {
    return { enabled: true, label: "Open lineage", reason: "Live lineage is still loading." };
  }
  return {
    enabled: true,
    label: "Open lineage",
    reason:
      String(graph?.meta?.emptyReason || "").trim() ||
      "No lineage rows observed yet; the Lineage Atlas shows the live state.",
  };
}

/**
 * Certify menu — input is the live useAssetMetadataEditor result (the
 * per-asset metadata write contract, probed from the asset's own payload /
 * capability endpoint — not a workspace flag).
 *
 * WHY two modes instead of a disabled button: cohesion law 7 (no dead
 * controls). When the live write contract allows it, certification writes go
 * through the existing metadata PATCH path (which audit-logs server-side).
 * When it does not, the menu STAGES a pre-filled change request through the
 * real create-request API and says so — a click always does something real.
 */
export function certifyGate(editor) {
  if (editor?.available) {
    return { mode: "write", reason: "" };
  }
  return {
    mode: "stage",
    reason:
      "Direct metadata writes are not enabled for this asset — selecting an option files a change request for steward review.",
  };
}

/**
 * "Open in Catalog Explorer" — input is the live /360 access block (same
 * core as /access-explain, so this can never disagree with the Access tab).
 *
 * WHY href-or-honest-reason: the deep link exists whenever the FQN is a real
 * three-part name; when the access block hasn't loaded yet the menu item is
 * disabled WITH the reason, never silently missing.
 */
export function catalogExplorerGate(access) {
  const href = String(access?.deepLinks?.catalogExplorer || "").trim();
  if (href) return { enabled: true, href, reason: "" };
  if (String(access?.state || "").toLowerCase() === "loading") {
    return { enabled: false, href: "", reason: "Access context is still loading." };
  }
  return {
    enabled: false,
    href: "",
    reason: "No Catalog Explorer link is available for this asset.",
  };
}

/**
 * Request Change dialog — only needs a real asset identity to scope the
 * request; the create-request API is store-backed and always reachable.
 * Disabled ONLY while the page has no FQN (a dead-end URL), with the reason.
 */
export function requestChangeGate(assetFqn) {
  const fqn = String(assetFqn || "").trim();
  if (fqn) return { enabled: true, reason: "" };
  return { enabled: false, reason: "No asset is in context to scope a request to." };
}
