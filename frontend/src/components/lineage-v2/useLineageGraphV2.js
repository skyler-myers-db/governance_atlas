/**
 * useLineageGraphV2 — single source of truth for the rebuilt lineage canvas.
 *
 * Consolidates the data the new LineageCanvasV2 needs into one normalized
 * shape: { focus, nodes, edges, hydrating, error, columnLineage }.
 *
 * Rather than spread useLineage payload reading across the canvas,
 * the node card, the toolbar, and the impact panel — and end up with
 * each consumer drift-tolerating different fields — this adapter does
 * all of the payload normalization in one place. New downstream
 * components consume the normalized struct directly.
 *
 * The transformation is intentionally permission-honest. The legacy
 * payload encodes "is this asset openable from this actor?" via
 * details.isOpenable / details.openabilityState / details.resolutionState
 * (lineage-only references that exist in system.access.table_lineage
 * but where Unity Catalog has not granted the actor visibility on the
 * referenced asset). We surface that as a single `isOpenable` boolean
 * on each node so the canvas can disable click navigation accordingly.
 */
import { useMemo } from "react";
import { useLineage } from "../../hooks/useLineage";

const NODE_KIND_FROM_TYPE = {
  table: "table",
  view: "table",
  "delta table": "table",
  pipeline: "pipeline",
  job: "job",
  notebook: "notebook",
  "saved query": "saved-query",
  query: "saved-query",
  dashboard: "dashboard",
  model: "model",
  "ml model": "model",
  udf: "udf",
  function: "udf",
  volume: "volume",
};

function normalizeKind(rawType) {
  const trimmed = String(rawType || "").trim().toLowerCase();
  if (!trimmed) return "table";
  if (NODE_KIND_FROM_TYPE[trimmed]) return NODE_KIND_FROM_TYPE[trimmed];
  if (trimmed.includes("notebook")) return "notebook";
  if (trimmed.includes("pipeline")) return "pipeline";
  if (trimmed.includes("job")) return "job";
  if (trimmed.includes("dashboard")) return "dashboard";
  if (trimmed.includes("model")) return "model";
  if (trimmed.includes("udf") || trimmed.includes("function")) return "udf";
  if (trimmed.includes("volume")) return "volume";
  return "table";
}

function compactPath(fqn) {
  const text = String(fqn || "").trim();
  if (!text) return "";
  const parts = text.split(".");
  if (parts.length >= 3) return `${parts[0]} / ${parts[1]}`;
  if (parts.length === 2) return parts[0];
  return text;
}

function compactName(fqn) {
  const text = String(fqn || "").trim();
  if (!text) return "";
  const parts = text.split(".");
  return parts[parts.length - 1] || text;
}

function compactNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return String(Math.trunc(num));
}

function relativeTime(iso) {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const deltaMs = Date.now() - ts;
  if (deltaMs < 0) return "future";
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}

function normalizeNode(rawNode, focusFqn) {
  if (!rawNode || typeof rawNode !== "object") return null;
  const fqn = String(
    rawNode.assetFqn ||
      rawNode.fqn ||
      (typeof rawNode.id === "string" && rawNode.id.startsWith("focus-")
        ? rawNode.id.slice("focus-".length)
        : rawNode.id) ||
      "",
  ).trim();
  if (!fqn && !rawNode.id) return null;
  const id = String(rawNode.id || fqn).trim();
  const role = String(rawNode.role || "").toLowerCase();
  const isFocus = role === "focus" || (focusFqn && fqn === focusFqn);
  const details = rawNode.details && typeof rawNode.details === "object" ? rawNode.details : {};
  // Allow click navigation for ANY node that has a real FQN. The backend's
  // isOpenable / openabilityState / resolutionState fields are conservative
  // (they assume per-actor verification not present today and over-flag
  // nodes as "lineage-only" / "unverified" — including the user's own
  // focus node when bootstrap visibility hasn't fully hydrated). For
  // admins who have full UC access, those flags hide working drill paths.
  // Clicking "lineage-only" node either reveals new actual lineage at
  // /lineage/<fqn>, or surfaces an honest empty state — both better than
  // silently doing nothing. The card still shows a small "Lineage only"
  // chip so the user knows the node may be sparse before clicking.
  const lineageOnly =
    String(details.resolutionState || "").toLowerCase() === "lineage-only" ||
    String(details.openabilityState || "").toLowerCase() === "unverified";
  const isOpenable = Boolean(fqn);
  const owners = Array.isArray(rawNode.owners) ? rawNode.owners : [];
  const recentActivity = Array.isArray(rawNode.recentActivity) ? rawNode.recentActivity : [];
  const columns = Array.isArray(rawNode.columns) ? rawNode.columns.slice(0, 5) : [];
  const totalColumns = Number.isFinite(Number(rawNode.totalColumns))
    ? Number(rawNode.totalColumns)
    : columns.length;
  // Lineage payload doesn't carry row count / freshness / owner data — those
  // live on the asset detail endpoint, not on lineage system tables. So we
  // pass through whatever the API gave us (typically null) and let the card
  // render the API-provided `foot` strings instead of "Metadata pending"
  // when we have nothing to derive.
  const rowCount = compactNumber(
    rawNode.rowCount ?? rawNode.rows ?? details.rows ?? details.rowCount,
  );
  const freshnessRaw = rawNode.freshness || rawNode.lastRefresh || details.freshness || details.lastRefresh || "";
  const freshness = relativeTime(freshnessRaw) || String(freshnessRaw || "").trim();
  // The lineage API ships per-node pre-formatted `foot` strings (e.g.
  // ["Table"], ["Metadata unavailable", "Metadata record unavailable"])
  // and a `kicker` for the eyebrow tag (e.g. "Focus", "Upstream",
  // "Downstream"). The legacy renderer used these directly and that's
  // honest — we don't know rows / freshness / owners from system.access.*.
  const footRaw = Array.isArray(rawNode.foot)
    ? rawNode.foot.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const kicker = String(rawNode.kicker || "").trim();
  const apiKindRaw = String(rawNode.kind || details.kind || "").trim();
  return {
    id,
    fqn,
    label: rawNode.label || compactName(fqn) || id,
    subtitle: rawNode.subtitle || compactPath(fqn),
    kind: normalizeKind(apiKindRaw),
    apiKind: apiKindRaw, // raw API kind ("Table", "View", "Lineage Reference") for honest display
    kicker, // eyebrow ("Focus" | "Upstream" | "Downstream" | "")
    foot: footRaw, // pre-formatted footer lines from the API
    role: isFocus ? "focus" : role || "peer",
    hop: Number.isFinite(Number(rawNode.depth ?? rawNode.hop ?? rawNode.distance))
      ? Number(rawNode.depth ?? rawNode.hop ?? rawNode.distance)
      : null,
    isOpenable,
    lineageOnly,
    isFocus,
    isCertified:
      String(details.certification || rawNode.certification || "").toLowerCase().includes("certified"),
    classification: String(details.sensitivity || rawNode.classification || "").trim(),
    containsPii: Boolean(details.containsPii ?? rawNode.containsPii ?? false),
    description: String(details.description || rawNode.description || "").trim(),
    governanceStatus: String(details.governanceStatus || "").trim(),
    domain: String(details.domain || "").trim(),
    rowCount,
    freshness,
    freshnessRaw,
    owners: owners.slice(0, 3),
    ownerCount: owners.length,
    recentActivity: recentActivity.slice(0, 3),
    recentActivityCount: recentActivity.length,
    columns,
    totalColumns,
    raw: rawNode,
  };
}

function normalizeEdge(rawEdge) {
  if (!rawEdge || typeof rawEdge !== "object") return null;
  const source = String(rawEdge.source || "").trim();
  const target = String(rawEdge.target || "").trim();
  if (!source || !target) return null;
  return {
    id: String(rawEdge.id || rawEdge.key || `${source}->${target}`),
    source,
    target,
    kind: String(rawEdge.kind || rawEdge.type || "").toLowerCase(),
    isRestricted:
      /restricted|permission|hidden|boundary/.test(String(rawEdge.kind || "")) ||
      Boolean(rawEdge.isRestricted),
    raw: rawEdge,
  };
}

/**
 * @param {string} assetFqn
 * @param {object} options { enabled?: boolean, fullProfile?: boolean }
 * @returns {{
 *   focus: object|null,
 *   nodes: object[],
 *   edges: object[],
 *   columnEdges: object[],
 *   hydrating: boolean,
 *   loading: boolean,
 *   error: string,
 *   meta: object|null,
 *   refresh: () => Promise<void>,
 * }}
 */
export function useLineageGraphV2(assetFqn, options = {}) {
  const enabled = options.enabled !== false;
  const fullProfile = options.fullProfile !== false; // default to true — we want full
  const lineage = useLineage(assetFqn, enabled, { fullProfile });
  const payload = lineage.payload;
  const focusFqn = String(assetFqn || "").trim();

  return useMemo(() => {
    const empty = {
      focus: null,
      nodes: [],
      edges: [],
      columnEdges: [],
      hydrating: false,
      loading: lineage.loading,
      error: lineage.error || "",
      meta: payload?.meta || null,
      refresh: lineage.refresh,
    };
    if (!payload || typeof payload !== "object") return empty;
    const profile = String(payload.profile || "").toLowerCase();
    const meta = payload.meta || {};
    const stats = payload.stats || {};
    const hydrating =
      profile === "initial" ||
      String(meta.state || "").toLowerCase() === "loading" ||
      Boolean(meta?.capabilities?.hydrating) ||
      Boolean(stats?.progressive?.tableLineageDeferred);
    const rawNodes = payload.graphs?.data?.nodes || payload.graph?.nodes || [];
    const rawEdges = payload.graphs?.data?.edges || payload.graph?.edges || [];
    const nodes = rawNodes
      .map((node) => normalizeNode(node, focusFqn))
      .filter(Boolean);
    const edges = rawEdges.map(normalizeEdge).filter(Boolean);
    const focusNode = nodes.find((node) => node.isFocus) || null;
    const columnEdges = Array.isArray(payload.columnLineage?.edges)
      ? payload.columnLineage.edges
      : [];
    return {
      focus: focusNode,
      nodes,
      edges,
      columnEdges,
      hydrating,
      loading: lineage.loading,
      error: lineage.error || "",
      meta,
      refresh: lineage.refresh,
    };
  }, [payload, focusFqn, lineage.error, lineage.loading, lineage.refresh]);
}

export default useLineageGraphV2;
