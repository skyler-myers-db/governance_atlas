/*
 * surfaces/discovery/discoveryPresentation.js — pure presentation helpers for
 * the Discover surface (Wave C1). Ported from the legacy DiscoveryWorkspace
 * with their honesty rules intact:
 *   - absence of a field is NEVER rendered as zero ("No recent usage" only
 *     when the payload actually reported a usage number),
 *   - coverage is called coverage (never "trust"),
 *   - "Unassigned"/"Untagged"/"Not certified" labeled fallbacks, never bare
 *     em-dashes in cells.
 */

import { displayObjectType } from "../../lib/assetPresentation";

export function ownerLabel(owner) {
  if (!owner) return "";
  if (typeof owner === "string") return owner;
  return owner.name || owner.email || owner.label || owner.title || "";
}

export function ownerLabelsForAsset(asset) {
  return Array.isArray(asset?.owners)
    ? asset.owners.map((owner) => ownerLabel(owner)).filter(Boolean)
    : [];
}

export function ownerEmailForLabel(asset, label) {
  const owners = Array.isArray(asset?.owners) ? asset.owners : [];
  const match = owners.find((owner) => ownerLabel(owner) === label);
  return (match && typeof match === "object" && match.email) || label;
}

/** "skyler.myers@x" → "Skyler Myers" (display only — refs keep the raw id). */
export function prettyOwnerName(label = "") {
  const raw = String(label || "").trim();
  if (!raw) return "";
  const local = raw.includes("@") ? raw.split("@")[0] : raw;
  const parts = local.split(/[\s._+-]+/).filter(Boolean);
  if (!parts.length) return raw;
  return parts
    .slice(0, 2)
    .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function certificationLabel(asset) {
  const value = String(asset?.certification || "").trim();
  return !value || value === "Unassigned" ? "" : value;
}

export function sensitivityLabel(asset) {
  const value = String(asset?.sensitivity || "").trim();
  return !value || value === "Unassigned" ? "" : value;
}

export function coveragePercent(asset) {
  const value = Number(asset?.coverageScore);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function glossaryTermLabels(asset) {
  return Array.isArray(asset?.glossaryTerms)
    ? asset.glossaryTerms.map((term) => term?.label || term?.name || term).filter(Boolean)
    : [];
}

export function tagLabelsForAsset(asset) {
  const entries = Array.isArray(asset?.tagEntries)
    ? asset.tagEntries.map((tag) => tag?.label || tag?.name || tag?.value)
    : [];
  const tags = Array.isArray(asset?.tags)
    ? asset.tags.map((tag) => (typeof tag === "string" ? tag : tag?.label || tag?.name || tag?.value))
    : [];
  return [...new Set([...entries, ...tags].map((tag) => String(tag || "").trim()).filter(Boolean))];
}

export function assetHasCdeSignal(asset) {
  const values = [
    asset?.cde,
    asset?.isCde,
    asset?.criticalDataElement,
    ...(Array.isArray(asset?.tagLabels) ? asset.tagLabels : []),
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
  ];
  return values.some((value) => value === true || /^cde$/i.test(String(value || "").trim()));
}

export function assetHasPiiSignal(asset) {
  const values = [
    asset?.pii,
    asset?.containsPii,
    asset?.sensitivity,
    ...(Array.isArray(asset?.tagLabels) ? asset.tagLabels : []),
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
  ];
  return values.some((value) => value === true || /\bpii\b|personal/i.test(String(value || "")));
}

/** Workflow-state label derived ONLY from real governance metadata. */
export function workflowState(asset) {
  const raw = String(asset?.governanceStatus || "").trim();
  if (!raw) return null;
  if (/deprecated|retired|obsolete/i.test(raw)) return { label: "Obsolete", tone: "bad" };
  if (/review|pending|draft/i.test(raw)) return { label: "In review", tone: "warn" };
  if (/publish|certif|approved|live/i.test(raw)) return { label: "Published", tone: "good" };
  return null;
}

export function assetSourceLabel(asset) {
  const fullPath = String(asset?.fullPath || asset?.fqn || "").trim();
  if (fullPath && fullPath !== String(asset?.name || "").trim()) return fullPath;
  const catalog = String(asset?.catalog || "").trim();
  const schema = String(asset?.schema || "").trim();
  const objectType = displayObjectType(asset) || "Asset";
  return [catalog || objectType, schema].filter(Boolean).join(" · ");
}

export function usageSummary(asset) {
  const fields = [
    asset?.usage?.queryCount,
    asset?.queryCount,
    asset?.usage?.producerCount,
    asset?.producerCount,
    asset?.usage?.consumerCount,
    asset?.consumerCount,
    asset?.usage?.notebooks,
    asset?.notebookUsage,
  ];
  // Absence of usage fields is NOT zero usage: without evidence, no claim.
  const evidencePresent = fields.some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  const queries = Number(asset?.usage?.queryCount ?? asset?.queryCount ?? 0);
  const producers = Number(asset?.usage?.producerCount ?? asset?.producerCount ?? 0);
  const consumers = Number(asset?.usage?.consumerCount ?? asset?.consumerCount ?? 0);
  const notebooks = Number(asset?.notebookUsage || asset?.usage?.notebooks || 0);
  const items = [];
  if (queries > 0) items.push(`${queries.toLocaleString()} queries`);
  if (producers > 0) items.push(`${producers.toLocaleString()} ${producers === 1 ? "job" : "jobs"}`);
  if (consumers > 0)
    items.push(`${consumers.toLocaleString()} ${consumers === 1 ? "consumer" : "consumers"}`);
  if (notebooks > 0)
    items.push(`${notebooks.toLocaleString()} ${notebooks === 1 ? "notebook" : "notebooks"}`);
  if (items.length) return { items, none: false };
  return { items: [], none: evidencePresent };
}

/**
 * Collapse long SDK error envelopes into a user-facing summary (the OBO
 * "Invalid scope, required scopes: sql" wall of HTML → plain guidance).
 */
export function summarizeDiscoveryError(rawError) {
  const text = String(rawError || "").trim();
  if (!text) return "";
  if (/required scopes:\s*sql/i.test(text) || /Invalid scope,\s*required scopes/i.test(text)) {
    return (
      "Your session is missing the Databricks sql scope needed to read " +
      "Unity Catalog metadata. Sign out and back in so the app can pick up " +
      "the updated workspace scopes, then retry. Discovery has already " +
      "auto-retried on the app principal; if you still see this banner, " +
      "your operator may need to re-approve the app in Databricks."
    );
  }
  return text;
}

/* ---------------- facets ---------------- */

export function facetEntries(facets, key) {
  const entries = facets?.[key];
  return Array.isArray(entries) ? entries.filter((entry) => entry && entry.value != null) : [];
}

export function facetCount(facets, key, value) {
  return Number(facetEntries(facets, key).find((entry) => entry.value === value)?.count || 0);
}

/**
 * Facet options for a FilterBar facet: live buckets (incl. "Unassigned")
 * union the currently-selected values (so an applied value can always be
 * un-toggled), with the backend's synthetic "All …" sentinel rows dropped.
 */
export function facetOptions(facets, key, selected = [], fallbackValues = []) {
  const live = facetEntries(facets, key);
  const counts = new Map(live.map((entry) => [String(entry.value), Number(entry.count || 0)]));
  const values = [
    ...new Set([
      ...live.map((entry) => String(entry.value)),
      ...fallbackValues.map((value) => String(value)),
      ...selected.map((value) => String(value)),
    ]),
  ].filter((value) => value && !/^all\s/i.test(value));
  return values.map((value) => ({
    value,
    label: value,
    count: counts.has(value) ? counts.get(value) : undefined,
  }));
}

/* ---------------- structured query helper ---------------- */

export const DISCOVERY_QUERY_FIELD_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "fqn", label: "Fully qualified name" },
  { value: "description", label: "Description" },
  { value: "catalog", label: "Catalog" },
  { value: "schema", label: "Schema" },
  { value: "domain", label: "Domain" },
  { value: "tier", label: "Tier" },
  { value: "certification", label: "Certification" },
  { value: "sensitivity", label: "Sensitivity" },
  { value: "criticality", label: "Criticality" },
  { value: "glossary", label: "Glossary term" },
  { value: "tag", label: "Tag" },
  { value: "owner", label: "Owner" },
  { value: "type", label: "Asset type" },
  { value: "data_product", label: "Data product" },
];

export function discoveryQueryFields(supportedFields = []) {
  const allowed = new Set(
    (supportedFields || []).map((value) => String(value || "").trim()).filter(Boolean),
  );
  return DISCOVERY_QUERY_FIELD_OPTIONS.filter(
    (option) => !allowed.size || allowed.has(option.value),
  );
}

export function serializeDiscoveryQueryValue(rawValue = "") {
  const normalized = String(rawValue || "").trim();
  if (!normalized) return "";
  const escaped = normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return /^[a-z0-9_.-]+$/i.test(normalized) ? normalized : `"${escaped}"`;
}

export function buildDiscoveryQueryClause({ field = "", value = "", matchMode = "single" }) {
  const normalizedField = String(field || "").trim();
  if (!normalizedField) return "";
  if (matchMode === "any" || matchMode === "all") {
    const values = String(value || "")
      .split(",")
      .map((item) => serializeDiscoveryQueryValue(item))
      .filter(Boolean);
    if (!values.length) return "";
    if (values.length === 1) return `${normalizedField}:${values[0]}`;
    const joiner = matchMode === "all" ? " AND " : " OR ";
    return `${normalizedField}:(${values.join(joiner)})`;
  }
  const normalizedValue = serializeDiscoveryQueryValue(value);
  if (!normalizedValue) return "";
  return `${normalizedField}:${normalizedValue}`;
}

export function appendDiscoveryQueryClause(baseQuery = "", nextClause = "", joiner = "AND") {
  const normalizedBase = String(baseQuery || "").trim();
  const normalizedClause = String(nextClause || "").trim();
  const normalizedJoiner = String(joiner || "AND").trim().toUpperCase() === "OR" ? "OR" : "AND";
  if (!normalizedClause) return normalizedBase;
  if (!normalizedBase) return normalizedClause;
  // Parenthesize the existing query so appending never changes its meaning.
  return `(${normalizedBase}) ${normalizedJoiner} ${normalizedClause}`;
}

/* ---------------- diagnostics vocabulary (humanized, never raw enums) ---- */

export function humanizeEnumLabel(value) {
  const raw = String(value || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function labelForAuthMode(authMode) {
  const raw = String(authMode || "").trim().toLowerCase();
  if (raw === "obo-available") return "Permission-aware (your access)";
  if (raw === "app-principal-only") return "Workspace service view";
  if (raw === "no-identity") return "No signed-in identity";
  return raw ? humanizeEnumLabel(raw) : "Unknown";
}

export function labelForInventorySource(source, authMode) {
  const normalizedSource = String(source || "").trim();
  const normalizedMode = String(authMode || "").trim().toLowerCase();
  if (normalizedMode === "obo-available") {
    return "Live Unity Catalog inventory · permission-aware";
  }
  if (normalizedMode === "app-principal-only") {
    return "Live Unity Catalog inventory · workspace service view";
  }
  if (normalizedSource) return humanizeEnumLabel(normalizedSource);
  return "Unity Catalog inventory";
}

export function labelForDiscoveryState(state) {
  const raw = String(state || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "no_matches") return "No results match the current filters";
  if (raw === "no_visible_assets") return "No assets are visible to your account";
  if (raw === "live") return "Live";
  if (raw === "degraded") return "Partially available";
  return humanizeEnumLabel(raw);
}

export function labelForRuntimeState(state) {
  const raw = String(state || "").trim().toLowerCase();
  if (raw === "live") return "Live";
  if (raw === "degraded") return "Partially available";
  if (raw === "unavailable" || raw === "error") return "Unavailable";
  if (raw === "loading" || raw === "warming") return "Loading";
  return raw ? humanizeEnumLabel(raw) : "Unknown";
}

/** Workspace-scoped Databricks-backed payloads count as trustworthy sources. */
export function isDatabricksBackedDiscoveryMeta(meta = {}) {
  if (!meta || typeof meta !== "object") return false;
  const source = String(meta.source || meta.inventorySource || meta.dataSource || "").toLowerCase();
  const visibilityScope = String(meta.visibilityScope || meta.readScope || "").toLowerCase();
  const authMode = String(meta.authMode || meta.productMode || "").toLowerCase();
  const discoveryState = String(meta.discoveryState || meta.state || "").toLowerCase();
  const trustedSource =
    source.includes("unity-catalog") ||
    source.includes("unity_catalog") ||
    source.includes("databricks") ||
    source.includes("governance-store") ||
    source.includes("governance_store");
  const workspaceScoped =
    visibilityScope === "workspace-app-principal" ||
    visibilityScope === "workspace_app_principal" ||
    authMode === "app-principal-only" ||
    authMode === "app_principal_only";
  return trustedSource && workspaceScoped && (discoveryState === "live" || discoveryState === "degraded");
}
