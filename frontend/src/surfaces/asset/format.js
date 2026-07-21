/*
 * surfaces/asset/format.js — pure formatting + ref-building helpers for the
 * Asset 360 hub (Wave B2). Kept free of React so they unit-test in isolation.
 *
 * Formatting law (ASSET360_TEARDOWN P0-4, COHESION law 4): timestamps render
 * as ABSOLUTE UTC ("May 3, 2026, 19:51 UTC") with the raw ISO in the tooltip.
 * Never a raw ISO headline, never a fabricated relative window.
 */

const UTC_FORMATTER =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : null;

/**
 * ISO/timestamp string → { display: "May 3, 2026, 19:51 UTC", iso } or null
 * when the input is empty/unparseable (callers render an honest "—").
 */
export function formatUtcInstant(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const display = UTC_FORMATTER
    ? `${UTC_FORMATTER.format(date)} UTC`
    : `${date.toISOString()} UTC`;
  return { display, iso: date.toISOString() };
}

/** "p1" → "P1"; empty → "". */
export function priorityLabel(priority) {
  const raw = String(priority || "").trim();
  return raw ? raw.toUpperCase() : "";
}

/** Priority → Badge tone. p0/p1 are urgent, p2 elevated, the rest neutral. */
export function priorityTone(priority) {
  const raw = String(priority || "").trim().toLowerCase();
  if (raw === "p0" || raw === "p1") return "bad";
  if (raw === "p2") return "warn";
  return "neutral";
}

/**
 * Glossary link/term → EntityChip ref. Links carrying a real termId get the
 * canonical /glossary/<termId> address; name-only terms fall back to the
 * legacy ?term= search grammar (still a real, working href) rather than
 * rendering dead text.
 */
export function termRef(linkOrName) {
  if (linkOrName && typeof linkOrName === "object") {
    const term = String(linkOrName.term || linkOrName.name || "").trim();
    const termId = String(linkOrName.termId || linkOrName.id || "").trim();
    if (termId) return { kind: "term", id: termId, label: term || termId };
    if (term) return { surface: "glossary", params: { term }, label: term };
    return null;
  }
  const name = String(linkOrName || "").trim();
  return name ? { surface: "glossary", params: { term: name }, label: name } : null;
}

/**
 * Owner entry ({name, displayName, title} or a bare email string) → owner
 * EntityChip ref. NO regex prettifying, no role inference — the display name
 * comes from the payload or is the raw identity (teardown P2-10).
 */
export function ownerRef(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const who = entry.trim();
    return who ? { kind: "owner", email: who, label: who } : null;
  }
  const email = String(entry.email || entry.name || "").trim();
  if (!email) return null;
  const label = String(entry.displayName || "").trim() || email;
  return { kind: "owner", email, label };
}

/** Split first-hop neighbors out of a useLineageGraphV2 graph. */
export function firstHopNeighbors(graph) {
  const focus = graph?.focus || null;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (!focus) return { focus: null, upstream: [], downstream: [] };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const upstream = [];
  const downstream = [];
  const seen = new Set();
  for (const edge of edges) {
    if (edge.target === focus.id) {
      const node = byId.get(edge.source);
      if (node && !seen.has(`u:${node.id}`)) {
        seen.add(`u:${node.id}`);
        upstream.push(node);
      }
    }
    if (edge.source === focus.id) {
      const node = byId.get(edge.target);
      if (node && !seen.has(`d:${node.id}`)) {
        seen.add(`d:${node.id}`);
        downstream.push(node);
      }
    }
  }
  return { focus, upstream, downstream };
}
