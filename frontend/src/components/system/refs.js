/*
 * Entity/surface ref → href resolution.
 *
 * The route mapping below is LAW — it transcribes the "Cross-linking
 * contract" in docs/architecture/COHESION_BLUEPRINT.md verbatim:
 *
 *   asset   → /assets/<fqn>                       column → /assets/<fqn>?tab=columns&col=
 *   term    → /glossary/<termId>                  cde    → /glossary?tab=cdes&cde=
 *   owner   → /discovery?q=owner:"…"              request→ /stewardship?item=GOV-…
 *   event   → /evidence?event=AUD-…               quality→ /evidence?tab=quality&asset=…&run=…
 *   catalog → /discovery?filters={"catalogs":[…]} domain → /discovery?filters={"domains":[…]}
 *   lineage → /lineage/<fqn>
 *
 * EntityChip, StatTile.target and DataTable.rowTarget all resolve through
 * this single function so a route change is a one-line edit. Wave A3's nav
 * fabric will consume the same ref shapes; until it is wired, components
 * render plain href Links and accept an optional `navigate` adapter.
 */

const SURFACE_PATHS = Object.freeze({
  home: "/home",
  discovery: "/discovery",
  stewardship: "/stewardship",
  glossary: "/glossary",
  lineage: "/lineage",
  evidence: "/evidence",
  admin: "/admin",
  help: "/help",
});

/**
 * Serialize a flat params object into a search string. Arrays become
 * repeated params; plain objects (e.g. discovery `filters`) are
 * JSON-stringified — matching the existing discovery URL grammar.
 */
function searchFromParams(params) {
  if (!params || typeof params !== "object") return "";
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((item) => usp.append(key, String(item)));
    } else if (typeof value === "object") {
      usp.set(key, JSON.stringify(value));
    } else {
      usp.set(key, String(value));
    }
  }
  const out = usp.toString();
  return out ? `?${out}` : "";
}

/*
 * FQNs ride in the path segment. encodeURIComponent keeps `.` literal (so
 * catalog.schema.table stays readable) while making spaces/slashes/backticks
 * safe — matching how the existing /entity/<fqn> routes tolerate raw FQNs.
 */
function encodeFqn(fqn) {
  return encodeURIComponent(String(fqn));
}

function filtersHref(facetKey, name) {
  return `/discovery${searchFromParams({ filters: { [facetKey]: [String(name)] } })}`;
}

/**
 * Is this owner value a real account principal (email-shaped)? Only these are
 * linkable as owners — system actors, team/domain labels, and service slugs
 * are not account users and must not become owner-search links (identity
 * integrity). Kept minimal on purpose: the roster stores principals as emails.
 */
export function isPrincipalEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value ?? "").trim());
}

/**
 * Resolve an entityRef (`{kind, id|fqn, …}`) or surfaceRef
 * (`{surface, params}`) to its canonical href. Returns null for
 * unresolvable refs — callers render plain text instead of a dead link.
 */
export function hrefForRef(ref) {
  if (!ref || typeof ref !== "object") return null;

  if (ref.surface) {
    const base = SURFACE_PATHS[ref.surface];
    if (!base) return null;
    return `${base}${searchFromParams(ref.params)}`;
  }

  const kind = ref.kind;
  const id = ref.id != null ? String(ref.id) : null;
  // asset-like kinds accept the FQN in either `fqn` or `id`.
  const fqn = ref.fqn != null ? String(ref.fqn) : null;

  switch (kind) {
    case "asset": {
      const target = fqn ?? id;
      if (!target) return null;
      return `/assets/${encodeFqn(target)}${searchFromParams(ref.params)}`;
    }
    case "column": {
      // Column refs need the parent asset FQN plus the column name. When
      // `fqn` is present, `id`/`column`/`name` is the column; a column
      // without a parent asset has no address and resolves to null.
      const col = ref.column ?? ref.name ?? (fqn ? id : null);
      if (!fqn || col == null) return null;
      return `/assets/${encodeFqn(fqn)}${searchFromParams({ tab: "columns", col: String(col) })}`;
    }
    case "term":
      return id ? `/glossary/${encodeURIComponent(id)}` : null;
    case "cde":
      return id ? `/glossary${searchFromParams({ tab: "cdes", cde: id })}` : null;
    case "owner": {
      // One owner-search grammar for every rendered email/name
      // (PRODUCT_BLUEPRINT §4): /discovery?q=owner:"<name-or-email>"
      const who = ref.email ?? id ?? ref.label ?? null;
      if (!who) return null;
      // Identity integrity: ONLY real account principals (email-shaped) get a
      // clickable owner-search link. System actors ("identity-integrity-cleanup"),
      // team/domain labels ("Product"), and service slugs are not account users —
      // returning null here makes EntityChip fall back to plain text instead of a
      // link that searches for a user who doesn't exist.
      if (!isPrincipalEmail(who)) return null;
      return `/discovery${searchFromParams({ q: `owner:"${who}"` })}`;
    }
    case "request":
      return id ? `/stewardship${searchFromParams({ item: id })}` : null;
    case "event":
      return id ? `/evidence${searchFromParams({ event: id })}` : null;
    case "quality": {
      const asset = fqn ?? ref.asset ?? null;
      const params = { tab: "quality" };
      if (asset) params.asset = String(asset);
      if (ref.run != null) params.run = String(ref.run);
      return `/evidence${searchFromParams(params)}`;
    }
    case "domain": {
      const name = ref.name ?? id ?? ref.label;
      return name ? filtersHref("domains", name) : null;
    }
    case "catalog": {
      const name = ref.name ?? id ?? ref.label;
      return name ? filtersHref("catalogs", name) : null;
    }
    case "lineage": {
      const target = fqn ?? id;
      return target ? `/lineage/${encodeFqn(target)}` : null;
    }
    default:
      return null;
  }
}

/** Human label when the caller supplies none. The FQN/id text IS the anchor (law). */
export function defaultRefLabel(ref) {
  if (!ref || typeof ref !== "object") return "";
  if (ref.label != null) return String(ref.label);
  switch (ref.kind) {
    case "asset":
    case "lineage":
      return String(ref.fqn ?? ref.id ?? "");
    case "column":
      return String(ref.column ?? ref.name ?? ref.id ?? "");
    case "owner":
      return String(ref.email ?? ref.id ?? "");
    case "domain":
    case "catalog":
      return String(ref.name ?? ref.id ?? "");
    default:
      return String(ref.name ?? ref.id ?? "");
  }
}
