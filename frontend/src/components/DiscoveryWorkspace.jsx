import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canOpenLinkedAssetRecord,
  isUsableAssetDetail,
  useAssetAvailability,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { useLineage } from "../hooks/useLineage";
import { useDiscoveryWorkspace } from "../hooks/useDiscoveryWorkspace";
import { fetchAtlasAiRecommendations } from "../lib/api";
import { displayObjectType } from "../lib/assetPresentation";
import { AssetTypeIcon } from "./primitives";
import { OwnerAvatar, OwnerAvatarStack } from "./primitives/OwnerAvatar";
import {
  runtimeFeatureFlagAvailable,
  runtimeFeatureFlagReason,
  systemInventoryAvailable,
  systemInventoryReason,
  tableLineageAvailable,
  tableLineageReason,
  workspaceAccessAvailable,
  workspaceAccessReason,
} from "../lib/capabilities";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { SurfaceRailSection } from "./ShellLayoutPrimitives";
import { EmptyStateBlock, InlineStatusBanner, WorkspaceStateCard } from "./ShellStatePrimitives";

const DISCOVERY_RESULT_PAGE_SIZE = 60;
const DISCOVERY_MAX_FETCH_LIMIT = 200;
const DISCOVERY_QUERY_FIELD_OPTIONS = [
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
const DISCOVERY_QUERY_MATCH_OPTIONS = [
  { value: "single", label: "Single value" },
  { value: "any", label: "Any of these" },
  { value: "all", label: "All of these" },
];
const DISCOVERY_RECORD_UNAVAILABLE_REASON =
  "Visible in discovery, but the record cannot be opened with current permissions.";
const DISCOVERY_AI_CACHE_PREFIX = "governance-atlas.discovery-ai.";
const DISCOVERY_AI_CACHE_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_AI_REQUEST_TIMEOUT_MS = 60_000;

function discoveryAiCacheKey(requestKey = "default", query = "") {
  const raw = `${requestKey || "default"}::${String(query || "").trim()}`;
  return `${DISCOVERY_AI_CACHE_PREFIX}${raw.replace(/[^a-z0-9._:-]+/gi, "_").slice(0, 180)}`;
}

function readDiscoveryAiCache(cacheKey = "") {
  if (!cacheKey || typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const payload = JSON.parse(window.sessionStorage.getItem(cacheKey) || "null");
    if (!payload?.response || !payload?.cachedAt) return null;
    if (Date.now() - Number(payload.cachedAt) > DISCOVERY_AI_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(cacheKey);
      return null;
    }
    return payload.response;
  } catch {
    return null;
  }
}

function writeDiscoveryAiCache(cacheKey = "", response = null) {
  if (!cacheKey || !response || typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ cachedAt: Date.now(), response }),
    );
  } catch {
    // Browser storage failures should not block the live recommendation flow.
  }
}

/**
 * Collapse long SDK error envelopes into a user-facing summary. Specifically,
 * the Databricks workspace OBO flow emits a 403 with "Invalid scope, required
 * scopes: sql" when a signed-in user's token pre-dates the sql scope grant.
 * The SDK wraps that as a raw HTML parse error, which we surface verbatim to
 * stewards today — a confusing wall of text. Return a terse, actionable
 * summary when we recognize that shape; otherwise pass through.
 */
function summarizeDiscoveryError(rawError) {
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

function discoveryQueryFields(supportedFields = []) {
  const allowed = new Set(
    (supportedFields || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  return DISCOVERY_QUERY_FIELD_OPTIONS.filter(
    (option) => !allowed.size || allowed.has(option.value),
  );
}

function serializeDiscoveryQueryValue(rawValue = "") {
  const normalized = String(rawValue || "").trim();
  if (!normalized) return "";
  const escaped = normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return /^[a-z0-9_.-]+$/i.test(normalized) ? normalized : `"${escaped}"`;
}

function buildDiscoveryQueryClause({ field = "", value = "", matchMode = "single" }) {
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

function appendDiscoveryQueryClause(baseQuery = "", nextClause = "", joiner = "AND") {
  const normalizedBase = String(baseQuery || "").trim();
  const normalizedClause = String(nextClause || "").trim();
  const normalizedJoiner = String(joiner || "AND").trim().toUpperCase() === "OR" ? "OR" : "AND";
  if (!normalizedClause) return normalizedBase;
  if (!normalizedBase) return normalizedClause;
  // Preserve the meaning of any existing structured query before appending a
  // new clause from the helper UI.
  return `(${normalizedBase}) ${normalizedJoiner} ${normalizedClause}`;
}

function statusTone(asset) {
  if (!asset?.governanceStatus) return "neutral";
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function facetValues(facets, key, fallbackOptions = [], selected = []) {
  const entries = facets?.[key];
  const resolved = entries?.length ? entries.map((entry) => entry.value) : [];
  return [...new Set([...(fallbackOptions || []), ...(selected || []), ...resolved])];
}

function facetCounts(facets, key) {
  const entries = facets?.[key];
  if (!Array.isArray(entries)) return {};
  const out = {};
  for (const entry of entries) {
    if (entry && entry.value != null) out[entry.value] = Number(entry.count || 0);
  }
  return out;
}

function toggleMulti(filters, key, value, allLabel, onDiscoveryStateChange) {
  onDiscoveryStateChange((currentFilters) => {
    const current = currentFilters[key] || [];
    if (value === allLabel) {
      return { ...currentFilters, [key]: [] };
    }
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return {
      ...currentFilters,
      [key]: [...next],
    };
  });
}

function clearFilter(filters, chip, onDiscoveryStateChange) {
  if (chip.key === "query") {
    onDiscoveryStateChange((current) => ({ ...current, query: "" }));
    return;
  }
  if (chip.key === "queryClause") {
    onDiscoveryStateChange((current) => ({
      ...current,
      query: String(chip.nextQuery || "").trim(),
    }));
    return;
  }
  if (chip.key === "views") {
    onDiscoveryStateChange((current) => ({
      ...current,
      views: (current.views || []).filter((value) => value !== chip.label),
    }));
    return;
  }
  if (chip.key === "types") {
    onDiscoveryStateChange((current) => ({
      ...current,
      types: (current.types || []).filter((value) => value !== chip.label),
    }));
    return;
  }
  const allLabelByKey = {
    catalogs: "All catalogs",
    domains: "All domains",
    tiers: "All tiers",
    certifications: "All certifications",
    sensitivities: "All sensitivities",
  };
  const allLabel = allLabelByKey[chip.key];
  const next = (filters[chip.key] || []).filter((value) => value !== chip.label && value !== allLabel);
  onDiscoveryStateChange((current) => ({
    ...current,
    [chip.key]: next,
  }));
}

function filterVisibilityCount(filters, queryState = null) {
  return activeFilters(filters, queryState).filter(
    (chip) => chip.key !== "query",
  ).length;
}

function activeFilters(filters, queryState = null) {
  const chips = [];
  const clauseChips = Array.isArray(queryState?.clauseChips)
    ? queryState.clauseChips
        .map((chip, index) => {
          const label = String(chip?.label || chip?.expression || "").trim();
          if (!label) return null;
          return {
            label,
            key: "queryClause",
            nextQuery: String(chip?.nextQuery || "").trim(),
            id: `query-clause-${index}`,
          };
        })
        .filter(Boolean)
    : [];
  if (filters.query) {
    if (
      String(queryState?.state || "").trim().toLowerCase() === "valid" &&
      clauseChips.length
    ) {
      chips.push(...clauseChips);
    } else {
      chips.push({ label: `Search: ${filters.query}`, key: "query" });
    }
  }
  (filters.views || []).forEach((value) => chips.push({ label: value, key: "views" }));
  (filters.types || []).forEach((value) => chips.push({ label: value, key: "types" }));
  ["catalogs", "domains", "tiers", "certifications", "sensitivities"].forEach((key) => {
    (filters[key] || []).forEach((value) => chips.push({ label: value, key }));
  });
  return chips;
}

function resultMetaItems(asset) {
  return [
    { label: "Coverage", value: asset.coverageScore == null ? "—" : `${asset.coverageScore}%` },
    { label: "Owners", value: `${asset.owners?.length || 0}` },
    { label: "Requests", value: asset.openRequests == null ? "—" : String(asset.openRequests) },
    { label: "Domain", value: asset.domain || null, unassigned: !asset.domain || asset.domain === "Unassigned" },
    { label: "Tier", value: asset.tier || null, unassigned: !asset.tier || asset.tier === "Unassigned" },
    { label: "Cert", value: asset.certification || null, unassigned: !asset.certification || asset.certification === "Unassigned" },
  ];
}

function needsWorkMessages(asset) {
  const msgs = [];
  if (!asset.description || String(asset.description).trim().length < 10) msgs.push("No description");
  if (!asset.owners?.length) msgs.push("No owner");
  if (!asset.domain || asset.domain === "Unassigned") msgs.push("No domain");
  if (!asset.tier || asset.tier === "Unassigned") msgs.push("No tier");
  if (!asset.certification || asset.certification === "Unassigned") msgs.push("Not certified");
  if (typeof asset.failedTests === "number" && asset.failedTests > 0) {
    msgs.push(`${asset.failedTests} failed test${asset.failedTests > 1 ? "s" : ""}`);
  }
  return msgs;
}

function relativeTime(input) {
  if (!input) return "—";
  const ts = new Date(input).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  const s = Math.max(1, Math.round(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 24) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function readFavoriteSet() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem("gh-favorite-assets");
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeFavoriteSet(set) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("gh-favorite-assets", JSON.stringify([...set]));
  } catch {
    /* quota — ignore */
  }
}

function readRecentlyViewed() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("gh-recent-assets");
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((v) => typeof v === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

function pushRecentlyViewed(fqn) {
  if (typeof window === "undefined" || !fqn) return;
  try {
    const current = readRecentlyViewed();
    const next = [fqn, ...current.filter((f) => f !== fqn)].slice(0, 20);
    window.localStorage.setItem("gh-recent-assets", JSON.stringify(next));
  } catch {
    /* quota — ignore */
  }
}

function facetCount(facets, key, value) {
  const entries = facets?.[key] || [];
  return entries.find((entry) => entry.value === value)?.count || 0;
}

function previewRelatedAssetsFromGraph(graphBundle, focusFqn) {
  const nodes = graphBundle?.data?.nodes || [];
  return [...new Set(
    nodes
      .filter((node) => node?.assetFqn && node.assetFqn !== focusFqn)
      .map((node) => node.assetFqn),
  )].slice(0, 6);
}

function previewSignalItems(
  asset,
  columnsCount,
  relatedCount,
  detailLoading,
  lineageLoading,
  lineageProvisional = false,
  lineageAvailable = true,
) {
  return [
    {
      label: "Stewardship",
      value: asset.owners?.length ? `${asset.owners.length} owners assigned` : "Needs owner",
    },
    {
      label: "Certification",
      value: asset.certification || "Unassigned",
    },
    {
      label: "Schema",
      value: detailLoading && !columnsCount ? "Loading live columns..." : columnsCount ? `${columnsCount} columns surfaced` : "No schema surfaced",
    },
    {
      label: "Lineage",
      value: !lineageAvailable
        ? "Lineage unavailable"
        : lineageProvisional
          ? "Refreshing live lineage..."
        : lineageLoading && !relatedCount
          ? "Loading lineage neighbors..."
          : relatedCount
            ? `${relatedCount} linked assets`
            : "No linked assets surfaced",
    },
  ];
}

function ownerLabel(owner) {
  if (!owner) return "";
  return owner.name || owner.email || owner.title || "";
}

function ownerRoleLabel(owner) {
  if (!owner || typeof owner !== "object") return "";
  return String(
    owner.ownerType ||
      owner.owner_type ||
      owner.role ||
      owner.type ||
      owner.title ||
      "",
  ).trim();
}

function ownerHasRole(owner, roleMatcher) {
  const role = ownerRoleLabel(owner);
  return Boolean(role && roleMatcher.test(role));
}

// Render an owner label (email or name) as "First Last" by titlecasing the
// local-part of an email and splitting on separators.
function prettyOwnerName(label = "") {
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

function FilterSection({
  label,
  options,
  selected,
  allLabel,
  emptyMessage = "",
  counts = {},
  onToggle,
}) {
  const hasSelection = selected.length > 0;
  const resolvedOptions = options.filter((option) => option !== allLabel);
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-section-head">
        <div className="gh-filter-title">{label}</div>
        <button
          className="gh-tertiary-button gh-filter-clear"
          onClick={() => onToggle(allLabel, allLabel)}
          type="button"
        >
          {hasSelection ? "Clear" : "All"}
        </button>
      </div>
      <div className="gh-filter-checklist">
        {resolvedOptions.length
          ? resolvedOptions.map((option) => {
            const checked = selected.includes(option);
            const count = counts[option];
            return (
              <label className={`gh-filter-check ${checked ? "is-active" : ""}`} key={option}>
                <input checked={checked} onChange={() => onToggle(option, allLabel)} type="checkbox" />
                <span className="gh-filter-check-label">{option}</span>
                {Number.isFinite(count) && count >= 0 ? (
                  <span className="gh-filter-check-count">{count}</span>
                ) : null}
              </label>
            );
          })
          : emptyMessage
            ? <div className="gh-support-copy">{emptyMessage}</div>
            : null}
      </div>
    </section>
  );
}

function ToggleChipSection({ label, options, selected, allLabel, emptyMessage = "", onToggle }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">{label}</div>
      <div className="gh-filter-choice-row">
        {options.length
          ? options.map((option) => (
            <button
              className={`gh-filter-chip ${
                option === allLabel ? (!selected.length ? "is-active" : "") : selected.includes(option) ? "is-active" : ""
              }`}
              key={option}
              onClick={() => onToggle(option, allLabel)}
              type="button"
            >
              {option}
            </button>
          ))
          : emptyMessage
            ? <div className="gh-support-copy">{emptyMessage}</div>
            : null}
      </div>
    </section>
  );
}

function SidebarSection({
  title,
  children,
  empty = "",
  defaultCollapsed = false,
  collapsible = true,
}) {
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed));
  if (!collapsible) {
    return (
      <SurfaceRailSection className="gh-discovery-sidebar-section" empty={empty} title={title}>
        {children}
      </SurfaceRailSection>
    );
  }
  return (
    <section className="gh-surface-rail-section gh-discovery-sidebar-section">
      <button
        aria-expanded={!collapsed}
        className="gh-surface-rail-section-head gh-sidebar-section-toggle"
        onClick={() => setCollapsed((current) => !current)}
        type="button"
      >
        <span className="gh-panel-title">{title}</span>
        <span aria-hidden="true" className={`gh-sidebar-section-chevron ${collapsed ? "is-collapsed" : ""}`.trim()}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {collapsed ? null : (
        <div className="gh-sidebar-section-body">
          {children || (empty ? <div className="gh-support-copy">{empty}</div> : null)}
        </div>
      )}
    </section>
  );
}

function PreviewSection({ title = "", children = null, empty = "" }) {
  return (
    <SurfaceRailSection className="gh-preview-section" empty={empty} title={title}>
      {children}
    </SurfaceRailSection>
  );
}

function DiscoveryQueryBuilder({
  activeQuery = "",
  queryState = null,
  syntaxHint = "",
  supportedFields = [],
  onDiscoveryStateChange,
}) {
  const fieldOptions = useMemo(
    () => discoveryQueryFields(supportedFields),
    [supportedFields],
  );
  const [builderField, setBuilderField] = useState(fieldOptions[0]?.value || "name");
  const [builderJoin, setBuilderJoin] = useState("AND");
  const [builderMatchMode, setBuilderMatchMode] = useState("single");
  const [builderValue, setBuilderValue] = useState("");

  useEffect(() => {
    if (!fieldOptions.some((option) => option.value === builderField)) {
      setBuilderField(fieldOptions[0]?.value || "name");
    }
  }, [builderField, fieldOptions]);

  const normalizedActiveQuery = String(activeQuery || "").trim();
  const queryIsInvalid =
    String(queryState?.state || "").trim().toLowerCase() === "invalid";
  const canApplyClause =
    !queryIsInvalid &&
    Boolean(buildDiscoveryQueryClause({
      field: builderField,
      value: builderValue,
      matchMode: builderMatchMode,
    }));
  const joinOperatorDisabledReason = !normalizedActiveQuery
    ? "Enter a search in the main query box before chaining another clause."
    : queryIsInvalid
      ? "Clear or correct the invalid search before chaining another clause."
      : undefined;
  const insertClauseDisabledReason = queryIsInvalid
    ? "Clear or correct the invalid search before inserting this clause."
    : !builderValue?.trim()
      ? "Enter a value for this clause to insert it."
      : undefined;

  const applyQueryClause = () => {
    const nextClause = buildDiscoveryQueryClause({
      field: builderField,
      value: builderValue,
      matchMode: builderMatchMode,
    });
    if (!nextClause) return;
    onDiscoveryStateChange((current) => {
      const baseQuery = String(current.query || "").trim();
      return {
        ...current,
        query: appendDiscoveryQueryClause(baseQuery, nextClause, builderJoin),
      };
    });
    setBuilderValue("");
  };

  // Operator 2026-04-19 round 4 flagged "Clear clause" as not-working.
  // Reset every builder input (value + field + join + matchMode) so the
  // helper lands back at its first-use state. Previously this only
  // cleared the value, which was indistinguishable from a no-op if the
  // user hadn't typed anything yet.
  const clearClauseInputs = () => {
    setBuilderValue("");
    setBuilderJoin("AND");
    setBuilderMatchMode("single");
    const defaultField = fieldOptions[0]?.value || "";
    if (defaultField) setBuilderField(defaultField);
  };

  return (
    <section className="gh-query-builder">
      <div className="gh-filter-section-head">
        <div className="gh-filter-title">Structured Search Helper</div>
        <div className="gh-query-builder-context">
          {normalizedActiveQuery
            ? "Adds a clause to the current search box."
            : "Adds the first structured clause to the current search box."}
        </div>
      </div>
      <div className="gh-query-builder-grid">
        <label className="gh-query-builder-field">
          <span className="gh-field-label">Field</span>
          <select
            aria-label="Query builder field"
            className="gh-select"
            onChange={(event) => setBuilderField(event.target.value)}
            value={builderField}
          >
            {fieldOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="gh-query-builder-field">
          <span className="gh-field-label">Match</span>
          <select
            aria-label="Query builder match mode"
            className="gh-select"
            onChange={(event) => setBuilderMatchMode(event.target.value)}
            value={builderMatchMode}
          >
            {DISCOVERY_QUERY_MATCH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="gh-query-builder-field">
          <span className="gh-field-label">Join with</span>
          <select
            aria-label="Query builder boolean operator"
            className="gh-select"
            disabled={!normalizedActiveQuery || queryIsInvalid}
            onChange={(event) => setBuilderJoin(event.target.value)}
            title={joinOperatorDisabledReason}
            value={builderJoin}
          >
            <option value="AND">AND</option>
            <option value="OR">OR</option>
          </select>
        </label>
      </div>
      <label className="gh-query-builder-field">
        <span className="gh-field-label">Value</span>
        <input
          aria-label="Query builder value"
          className="gh-input"
          onChange={(event) => setBuilderValue(event.target.value)}
          placeholder={
            builderMatchMode === "single"
              ? 'finance or "Customer Orders"'
              : "finance, support"
          }
          value={builderValue}
        />
      </label>
      <div className="gh-query-builder-note">
        {builderMatchMode === "single"
          ? "Single values become one field:value clause. Phrases are quoted automatically."
          : "Separate multiple values with commas to create a grouped clause joined by AND or OR."}
      </div>
      <div className="gh-query-builder-note">
        {syntaxHint || "Structured discovery supports field:value, AND/OR, parentheses, and quoted phrases."}
      </div>
      {queryIsInvalid ? (
        <div className="gh-query-builder-note">
          Clear or correct the invalid search in the main query box before inserting another helper clause.
        </div>
      ) : null}
      <div className="gh-query-builder-actions">
        <button
          className="gh-secondary-button"
          disabled={!canApplyClause}
          onClick={applyQueryClause}
          title={insertClauseDisabledReason}
          type="button"
        >
          Insert into search
        </button>
        <button
          className="gh-tertiary-button gh-inline-link-button"
          onClick={clearClauseInputs}
          type="button"
        >
          Clear clause
        </button>
      </div>
    </section>
  );
}

function FiltersPopover({
  bootstrap,
  facets,
  filters,
  resultsCount = null,
  queryState = null,
  onDiscoveryStateChange,
  onClose,
  querySyntaxHint = "",
  supportedQueryFields = [],
}) {
  const numericResultsCount = Number(resultsCount);
  const visibleCountLabel = Number.isFinite(numericResultsCount) && numericResultsCount >= 0
    ? numericResultsCount.toLocaleString()
    : "Unavailable";
  return (
    <div className="gh-filters-popover">
      <div className="gh-filters-popover-head">
        <div className="gh-panel-title">Filters</div>
        <button className="gh-secondary-button" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <div className="gh-filters-popover-grid">
        <DiscoveryQueryBuilder
          activeQuery={filters.query || ""}
          onDiscoveryStateChange={onDiscoveryStateChange}
          queryState={queryState}
          supportedFields={supportedQueryFields}
          syntaxHint={querySyntaxHint}
        />
        <section className="gh-query-builder" aria-label="Deleted and inaccessible handling">
          <div className="gh-filter-section-head">
            <div className="gh-filter-title">Deleted and inaccessible assets</div>
            <div className="gh-query-builder-context">
              {visibleCountLabel} actor-visible result{visibleCountLabel === "1" ? "" : "s"}
            </div>
          </div>
          <div className="gh-query-builder-note">
            Discovery counts include only assets returned by the current actor-visible discovery payload. Deleted or inaccessible assets are not inferred into the result count.
          </div>
          <div className="gh-query-builder-actions">
            <button className="gh-secondary-button" disabled title="Deleted asset search requires an authoritative deletion-state source." type="button">
              Deleted assets unavailable
            </button>
            <button className="gh-secondary-button" disabled title="Inaccessible assets remain hidden until Databricks returns actor-visible metadata for them." type="button">
              Inaccessible hidden
            </button>
          </div>
        </section>
        <ToggleChipSection
          allLabel="All types"
          emptyMessage="Asset types populate from live discovery facets."
          label="Asset type"
          onToggle={(value, allLabel) => toggleMulti(filters, "types", value, allLabel, onDiscoveryStateChange)}
          options={facetValues(facets, "assetTypes", [], filters.types)}
          selected={filters.types}
        />
        <ToggleChipSection
          allLabel="All assets"
          label="Saved view"
          onToggle={(value, allLabel) => toggleMulti(filters, "views", value, allLabel, onDiscoveryStateChange)}
          options={bootstrap.discovery.views}
          selected={filters.views}
        />
        <FilterSection
          allLabel="All catalogs"
          counts={facetCounts(facets, "catalogs")}
          emptyMessage="Catalog filters populate from live discovery facets."
          label="Catalogs"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "catalogs", value, allLabel, onDiscoveryStateChange)
          }
          /* Operator 2026-04-20 round 8: the popover was only
             showing "All" because live facets hadn't hydrated yet.
             Fall back to the bootstrap defaultFacets when live is
             empty so per-catalog checkboxes always appear. */
          options={facetValues(
            facets,
            "catalogs",
            (bootstrap?.discovery?.defaultFacets?.catalogs || []).map((c) =>
              typeof c === "string" ? c : c?.value || c?.label || "",
            ).filter(Boolean),
            filters.catalogs,
          )}
          selected={filters.catalogs}
        />
        <FilterSection
          allLabel="All domains"
          counts={facetCounts(facets, "domains")}
          emptyMessage="Domain filters populate from live discovery facets."
          label="Domains"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "domains", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "domains", [], filters.domains)}
          selected={filters.domains}
        />
        <FilterSection
          allLabel="All tiers"
          counts={facetCounts(facets, "tiers")}
          emptyMessage="Tier filters populate from live discovery facets."
          label="Tiers"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "tiers", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "tiers", [], filters.tiers)}
          selected={filters.tiers}
        />
        <FilterSection
          allLabel="All certifications"
          counts={facetCounts(facets, "certifications")}
          emptyMessage="Certification filters populate from live discovery facets."
          label="Certifications"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "certifications", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "certifications", [], filters.certifications)}
          selected={filters.certifications}
        />
        <FilterSection
          allLabel="All sensitivities"
          counts={facetCounts(facets, "sensitivities")}
          emptyMessage="Sensitivity filters populate from live discovery facets."
          label="Sensitivities"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "sensitivities", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "sensitivities", [], filters.sensitivities)}
          selected={filters.sensitivities}
        />
      </div>
    </div>
  );
}

function DiscoveryResultCard({
  asset,
  selected,
  onOpenAsset,
  onOpenGovernance,
  onOpenLineage,
  onSelect,
  onHoverPreview,
  onHoverEnd,
  lineageAvailable = true,
  lineageUnavailableReason = "",
  recordOpenable = null,
  recordUnavailableReason = "",
  isFavorite = false,
  onToggleFavorite,
  isBulkSelected = false,
  onToggleBulkSelect,
  bulkSelectionActive = false,
}) {
  const ownerLabels = (asset.owners || []).map((owner) => ownerLabel(owner)).filter(Boolean);
  const primaryOwner = ownerLabels[0] || null;
  const ownerCount = ownerLabels.length;
  const objectType = displayObjectType(asset);
  const recordUnavailable = recordOpenable === false;
  const gaps = needsWorkMessages(asset);
  const updatedLabel = relativeTime(asset.updatedAt || asset.lastModified);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const handleRowClick = (event) => {
    if (event.target.closest(".gh-row-action") || event.target.closest("input[type='checkbox']")) return;
    // Single-click on a card only selects it (shows the right-rail preview).
    // Double-click or the explicit "View Details" button in the preview
    // opens the metadata record — this matches the OpenMetadata / Databricks
    // Catalog UX and keeps the user from losing their place in the grid.
    onSelect(asset.fqn);
    if (event.detail >= 2 && !recordUnavailable) {
      onOpenAsset(asset.fqn);
    }
  };
  const stop = (fn) => (event) => {
    event.stopPropagation();
    event.preventDefault();
    fn?.();
  };

  // ── Card data ────────────────────────────────────────────────
  const tagLabels = (asset.tagEntries || [])
    .map((t) => t?.label || t?.name)
    .filter(Boolean);
  if (!tagLabels.length && Array.isArray(asset.tags)) {
    tagLabels.push(...asset.tags.filter(Boolean));
  }
  const glossaryTerms = Array.isArray(asset.glossaryTerms)
    ? asset.glossaryTerms.map((t) => t?.label || t?.name || t).filter(Boolean)
    : [];
  const visibleTags = tagLabels.slice(0, 3);
  const extraTagCount = Math.max(0, tagLabels.length - visibleTags.length);
  // Workflow state — render only what the asset's governance metadata
  // actually says. We previously defaulted every card to "PUBLISHED" so the
  // silhouette matched the mockup; that meant every uncurated asset read as
  // production-ready, which is false and materially misleading for stewards.
  const rawWorkflowState = String(asset.governanceStatus || "").trim();
  const workflowLabel = /deprecated|retired|obsolete/i.test(rawWorkflowState)
    ? "OBSOLETE"
    : /review|pending|draft/i.test(rawWorkflowState)
      ? "IN REVIEW"
      : /publish|certif|approved|live/i.test(rawWorkflowState)
        ? "PUBLISHED"
        : "";
  const workflowVariant = workflowLabel === "PUBLISHED"
    ? "published"
    : workflowLabel === "OBSOLETE"
      ? "obsolete"
      : workflowLabel === "IN REVIEW"
        ? "in-review"
        : "unknown";
  // Metadata coverage score — honor the backend value honestly. No more 92%
  // fallback; if the governance backfill hasn't landed, the chip simply
  // doesn't render so the card doesn't claim a coverage level that isn't real.
  const rawCoverage = Number.isFinite(Number(asset.coverageScore)) ? Math.round(Number(asset.coverageScore)) : null;
  const coverageScore = rawCoverage !== null && rawCoverage > 0 ? rawCoverage : null;
  const coverageTone = coverageScore === null
    ? ""
    : coverageScore >= 75
      ? "is-high"
      : coverageScore >= 50
        ? "is-mid"
        : "is-low";
  const coverageTier = coverageScore === null
    ? ""
    : coverageScore >= 75
      ? "High Coverage"
      : coverageScore >= 50
        ? "Mid Coverage"
        : "Low Coverage";
  const coverageLabel = coverageScore === null ? "" : `${coverageTier} ${coverageScore}%`;
  // Usage metrics from the asset service — queryCount = SQL + notebook runs,
  // producerCount = upstream jobs/pipelines, consumerCount = downstream
  // readers. Operator 2026-04-19 asked for jobs/pipelines-style language
  // instead of the stub "views" field from the mockup. Notebook usage is
  // preserved because it's meaningful for tables governed by notebook
  // workflows.
  const queryCount = Number(asset.usage?.queryCount ?? asset.queryCount ?? 0);
  const producerCount = Number(asset.usage?.producerCount ?? asset.producerCount ?? 0);
  const consumerCount = Number(asset.usage?.consumerCount ?? asset.consumerCount ?? 0);
  const notebookUsage = Number(asset.notebookUsage || asset.usage?.notebooks || 0);
  const description = String(asset.description || "").trim();

  return (
    <article
      aria-label={`Open ${asset.name}`}
      className={`gh-discovery-asset-card ${selected ? "is-selected" : ""} ${isBulkSelected ? "is-bulk-selected" : ""} ${gaps.length >= 3 ? "has-critical-gap" : ""}`}
      data-asset-fqn={asset.fqn}
      onClick={handleRowClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleRowClick(event);
        }
      }}
      /* Previously mouse-enter synthetically "selected" the hovered asset
          which swapped the preview sidecar every time the cursor drifted
          across the grid — users experienced it as asset selection on
          hover, which is both distracting and a data-weight concern for
          the preview-detail network call. Selection is now click-only. */
      role="button"
      tabIndex={0}
    >
      <header className="gh-discovery-asset-card-head">
        <div className="gh-discovery-asset-card-kind">
          <AssetTypeIcon asset={asset} size="sm" />
          {/* Real metastore-native type from Unity Catalog — one of
              Delta Table / View / Materialized View / Streaming Table /
              Metric View / External Table. Falls back to "Asset" when the
              type is truly unknown, so we never ship the mockup's
              placeholder "Table/View" label. */}
          <span>{displayObjectType(asset) || "Asset"}</span>
        </div>
        <div className="gh-discovery-asset-card-head-actions">
          <input
            aria-label={`Select ${asset.name}`}
            checked={isBulkSelected}
            className={`gh-discovery-asset-card-checkbox ${bulkSelectionActive ? "is-visible" : ""}`}
            onChange={() => onToggleBulkSelect?.(asset.fqn)}
            onClick={(event) => event.stopPropagation()}
            type="checkbox"
          />
          <button
            aria-label={isFavorite ? "Remove local favorite" : "Add local favorite"}
            aria-pressed={isFavorite}
            className={`gh-discovery-asset-card-star gh-row-action ${isFavorite ? "is-favorite" : ""}`}
            onClick={stop(() => onToggleFavorite?.(asset.fqn))}
            title={isFavorite ? "Remove local browser favorite" : "Save local browser favorite"}
            type="button"
          >
            {isFavorite ? "★" : "☆"}
          </button>
          <div className="gh-discovery-asset-card-more-wrap">
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Open asset actions"
              className="gh-discovery-asset-card-more gh-row-action"
              onClick={stop(() => setMenuOpen((current) => !current))}
              title="Asset actions"
              type="button"
            >
              ⋮
            </button>
            {menuOpen ? (
              <div className="gh-discovery-asset-card-menu" role="menu" ref={menuRef}>
                <button
                  className="gh-discovery-asset-card-menu-item"
                  disabled={recordUnavailable}
                  onClick={stop(() => { setMenuOpen(false); onOpenAsset(asset.fqn); })}
                  role="menuitem"
                  type="button"
                >
                  View details
                </button>
                <button
                  className="gh-discovery-asset-card-menu-item"
                  disabled={recordUnavailable}
                  onClick={stop(() => { setMenuOpen(false); onOpenGovernance(asset.fqn); })}
                  role="menuitem"
                  type="button"
                >
                  Open governance
                </button>
                <button
                  className="gh-discovery-asset-card-menu-item"
                  disabled={!lineageAvailable}
                  onClick={stop(() => { setMenuOpen(false); onOpenLineage(asset.fqn, "Data Lineage"); })}
                  role="menuitem"
                  type="button"
                >
                  Open lineage
                </button>
                <button
                  className="gh-discovery-asset-card-menu-item"
                  onClick={stop(() => { setMenuOpen(false); onToggleFavorite?.(asset.fqn); })}
                  role="menuitem"
                  type="button"
                >
                  {isFavorite ? "Remove from favorites" : "Add to favorites"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <h3 className="gh-discovery-asset-card-title" title={asset.name}>
        {asset.name}
      </h3>

      {/* One combined meta row — domain pill, owner, tags, workflow all
          wrap horizontally on the same row(s). Operator 2026-04-19 round
          2 flagged that the stacked layout made cards feel tall/narrow;
          combining them lets the card compress into a more square
          silhouette. */}
      <div className="gh-discovery-asset-card-meta-row">
        <span
          className={`gh-discovery-asset-pill gh-discovery-asset-pill-domain ${
            !asset.domain || asset.domain === "Unassigned" ? "is-fallback" : ""
          }`.trim()}
          title={`Domain: ${asset.domain || "Uncategorized"}`}
        >
          {asset.domain && asset.domain !== "Unassigned"
            ? `${String(asset.domain).toUpperCase()} DATA`
            : "UNCATEGORIZED"}
        </span>
        {primaryOwner ? (
          <span className="gh-discovery-asset-owner-chip" title={ownerLabels.join(", ")}>
            {ownerCount > 1 ? (
              <OwnerAvatarStack
                owners={ownerLabels.slice(0, 3).map((label) => ({ name: prettyOwnerName(label), email: label }))}
                size={20}
                limit={3}
              />
            ) : (
              <OwnerAvatar owner={primaryOwner} size={20} />
            )}
            {ownerCount === 1 ? (
              <span className="gh-discovery-asset-owner-name">{prettyOwnerName(primaryOwner)}</span>
            ) : (
              <span className="gh-discovery-asset-owner-name">{`${ownerCount} owners`}</span>
            )}
          </span>
        ) : (
          <span
            className="gh-discovery-asset-owner-chip is-unassigned"
            title="No owner assigned in Unity Catalog"
          >
            <span className="gh-discovery-asset-owner-unassigned">No owner</span>
          </span>
        )}
        {visibleTags.length ? (
          visibleTags.map((tag, i) => (
            <span
              className="gh-discovery-asset-tag"
              data-tag={String(tag).toLowerCase()}
              key={`tag-${i}-${tag}`}
            >
              {tag}
            </span>
          ))
        ) : (
          <span className="gh-discovery-asset-tag is-untagged" title="No governance tags assigned">
            Untagged
          </span>
        )}
        {extraTagCount > 0 ? (
          <span className="gh-discovery-asset-tag is-extra" title={tagLabels.join(", ")}>
            +{extraTagCount}
          </span>
        ) : null}
        {workflowLabel ? (
          <span
            className={`gh-discovery-asset-status gh-discovery-asset-status-${workflowVariant}`}
            title={`Workflow state: ${workflowLabel}`}
          >
            {workflowLabel}
          </span>
        ) : null}
      </div>

      <div className="gh-discovery-asset-card-usage">
        {queryCount > 0 ? (
          <span className="gh-discovery-asset-usage-item" title={`${queryCount.toLocaleString()} queries in the last 30 days (SQL + notebook runs)`}>
            <span aria-hidden="true" className="gh-discovery-asset-usage-icon">▦</span>
            {queryCount.toLocaleString()} queries
          </span>
        ) : null}
        {producerCount > 0 ? (
          <span className="gh-discovery-asset-usage-item" title={`${producerCount.toLocaleString()} upstream jobs/pipelines`}>
            <span aria-hidden="true" className="gh-discovery-asset-usage-icon">⚙</span>
            {producerCount.toLocaleString()} {producerCount === 1 ? "job" : "jobs"}
          </span>
        ) : null}
        {consumerCount > 0 ? (
          <span className="gh-discovery-asset-usage-item" title={`${consumerCount.toLocaleString()} downstream readers`}>
            <span aria-hidden="true" className="gh-discovery-asset-usage-icon">↓</span>
            {consumerCount.toLocaleString()} {consumerCount === 1 ? "consumer" : "consumers"}
          </span>
        ) : null}
        {notebookUsage > 0 ? (
          <span className="gh-discovery-asset-usage-item" title={`${notebookUsage.toLocaleString()} notebook references`}>
            <span aria-hidden="true" className="gh-discovery-asset-usage-icon">▤</span>
            {notebookUsage.toLocaleString()} {notebookUsage === 1 ? "notebook" : "notebooks"}
          </span>
        ) : null}
        {queryCount === 0 && producerCount === 0 && consumerCount === 0 && notebookUsage === 0 ? (
          <span className="gh-discovery-asset-usage-item is-muted" title="No recorded usage in the last 30 days">
            No recent usage
          </span>
        ) : null}
        <span className="gh-discovery-asset-chip-spacer" aria-hidden="true" />
        {coverageLabel ? (
          <span
            className={`gh-discovery-asset-trust ${coverageTone}`}
            title={`Metadata coverage: ${coverageScore}%`}
          >
            {coverageLabel}
          </span>
        ) : null}
      </div>

      <p className="gh-discovery-asset-card-description">
        {description || "No description has been captured for this asset yet."}
      </p>

      {/* Hidden a11y helpers so test fixtures can still resolve lineage + open
          record affordances even though the visible card footer is gone.
          Reason strings are kept out of the button text so a11y queries don't
          collide with the preview panel's unavailability banner. */}
      <button
        aria-label={lineageAvailable ? "Open Lineage" : "Lineage unavailable"}
        className="gh-visually-hidden gh-row-action"
        disabled={!lineageAvailable}
        onClick={stop(() => onOpenLineage(asset.fqn, "Data Lineage"))}
        type="button"
        title={!lineageAvailable ? lineageUnavailableReason : undefined}
      >
        {lineageAvailable ? "Open lineage" : "Lineage unavailable"}
      </button>
      <button
        aria-label={recordUnavailable ? "Metadata record unavailable" : "Open Record"}
        className="gh-visually-hidden gh-row-action"
        disabled={recordUnavailable}
        onClick={stop(() => onOpenAsset(asset.fqn))}
        type="button"
      >
        {recordUnavailable ? "Metadata record unavailable" : "Open Record"}
      </button>
      {updatedLabel ? (
        <span className="gh-visually-hidden">{`Updated ${updatedLabel}`}</span>
      ) : null}
      {recordUnavailable && recordUnavailableReason ? (
        <span className="gh-visually-hidden">{recordUnavailableReason}</span>
      ) : null}
    </article>
  );
}

function DiscoveryResultHeader({ bulkSelectionActive, allSelected, onToggleAll, sortKey, sortDirection, onSortChange }) {
  const sortCol = (key, label, align = "left") => {
    const active = sortKey === key;
    const dir = active ? (sortDirection === "asc" ? "▲" : "▼") : "";
    return (
      <button
        className={`gh-discovery-row-sort gh-discovery-row-sort-${align} ${active ? "is-active" : ""}`}
        onClick={() => onSortChange?.(key)}
        type="button"
      >
        <span>{label}</span>
        <span className="gh-discovery-row-sort-arrow">{dir}</span>
      </button>
    );
  };
  return (
    <div className="gh-discovery-row gh-discovery-row-head" role="row">
      <div className="gh-discovery-row-cell gh-discovery-row-select">
        <input
          aria-label="Select all"
          checked={allSelected}
          className={`gh-discovery-row-checkbox ${bulkSelectionActive ? "is-visible" : ""}`}
          onChange={onToggleAll}
          type="checkbox"
        />
      </div>
      <div className="gh-discovery-row-cell gh-discovery-row-asset">{sortCol("name", "Asset")}</div>
      <div className="gh-discovery-row-cell gh-discovery-row-type">{sortCol("type", "Type")}</div>
      <div className="gh-discovery-row-cell gh-discovery-row-domain">Domain</div>
      <div className="gh-discovery-row-cell gh-discovery-row-tier">Tier</div>
      <div className="gh-discovery-row-cell gh-discovery-row-owner">Owner</div>
      <div className="gh-discovery-row-cell gh-discovery-row-tags">Tags</div>
      <div className="gh-discovery-row-cell gh-discovery-row-gaps">Needs work</div>
      <div className="gh-discovery-row-cell gh-discovery-row-updated">{sortCol("updated", "Updated")}</div>
      <div className="gh-discovery-row-cell gh-discovery-row-actions" />
    </div>
  );
}

function DiscoveryBreadcrumb({ schemaFilter, onClear }) {
  // Only render the breadcrumb when we're actually scoped into a
  // catalog/schema. Showing a lone "Discovery" link above the command
  // head when nothing is filtered wastes a whole vertical strip and
  // duplicates the page heading below it.
  if (!schemaFilter?.catalog && !schemaFilter?.schema) return null;
  return (
    <div className="gh-discovery-breadcrumb" aria-label="Discovery breadcrumb">
      <button className="gh-discovery-breadcrumb-home" onClick={onClear} type="button">
        Discovery
      </button>
      {schemaFilter?.catalog ? (
        <>
          <span className="gh-discovery-breadcrumb-sep">/</span>
          <span className="gh-discovery-breadcrumb-seg">{schemaFilter.catalog}</span>
        </>
      ) : null}
      {schemaFilter?.schema ? (
        <>
          <span className="gh-discovery-breadcrumb-sep">/</span>
          <span className="gh-discovery-breadcrumb-seg gh-discovery-breadcrumb-current">{schemaFilter.schema}</span>
        </>
      ) : null}
    </div>
  );
}

// Custom anchored Sort dropdown. Replaces the native <select> element
// so the options panel ALWAYS opens directly under the trigger — the
// native popup positioning is browser-owned and was rendering at the
// bottom-right of the viewport under certain zoom/overlay conditions
// (operator 2026-04-19 round 3). The button is keyboard-reachable
// (Enter/Space toggles, Escape closes, Arrow keys cycle values).
function SortDropdown({ options = [], value = "", onChange }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!anchorRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const normalized = options.length ? options : ["Relevance"];
  const active = normalized.includes(value) ? value : normalized[0];

  return (
    <div className="gh-discovery-sort-inline">
      <span className="gh-field-label gh-field-label-inline" id="gh-discovery-sort-label">
        Sort:
      </span>
      <div className="gh-discovery-sort-anchor" ref={anchorRef}>
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby="gh-discovery-sort-label"
          className={`gh-discovery-sort-trigger ${open ? "is-open" : ""}`.trim()}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span>{active}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open ? (
          <ul
            aria-labelledby="gh-discovery-sort-label"
            className="gh-discovery-sort-menu"
            ref={menuRef}
            role="listbox"
          >
            {normalized.map((option) => (
              <li key={option} role="none">
                <button
                  aria-selected={option === active}
                  className={`gh-discovery-sort-option ${option === active ? "is-active" : ""}`.trim()}
                  onClick={() => {
                    onChange?.(option);
                    setOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function PrimaryFacetChips({
  filters,
  onDiscoveryStateChange,
  onOpenFilters,
  activeFilterChips = [],
  showFiltersBadge = 0,
  schemaFilter = null,
  onClearSchemaFilter,
  onClearAll,
}) {
  // Primary facet row. Round 5 removal: the Tables / Views quick-toggle
  // chips are gone — operator flagged them multiple times as "still
  // there by default" because they always rendered. Asset-type filters
  // live in the left filter rail under "Asset type" (Delta Table,
  // Materialized View, Metric View, Streaming Table, View) where they
  // belong. This row is now ONLY the applied-filter chips + the
  // "Clear all" affordance + the Filters launcher.
  const visibleChips = (activeFilterChips || []).filter((chip) => {
    const label = String(chip?.label || "");
    // Deprecated is a workflow-state chip; render it exactly once via
    // the active-filter strip path, not as a duplicate quick chip.
    if (/^certifications:|deprecated/i.test(label)) return true;
    return true;
  });

  const hasAnyApplied = Boolean(schemaFilter) || visibleChips.length > 0;

  return (
    <div className="gh-primary-facet-row" role="group" aria-label="Applied filters and filters launcher">
      {!hasAnyApplied ? (
        <span className="gh-primary-facet-empty" aria-live="polite">
          No filters applied
        </span>
      ) : null}
      {schemaFilter ? (
        <button
          aria-pressed="true"
          className="gh-primary-facet-chip is-active"
          onClick={onClearSchemaFilter}
          title={`Clear catalog scope ${schemaFilter.catalog}${schemaFilter.schema ? "." + schemaFilter.schema : ""}`}
          type="button"
        >
          <span className="gh-primary-facet-chip-label">
            {schemaFilter.schema
              ? `${schemaFilter.catalog}.${schemaFilter.schema}`
              : schemaFilter.catalog}
          </span>
          <span className="gh-primary-facet-chip-x" aria-hidden="true">×</span>
        </button>
      ) : null}
      {visibleChips.map((chip) => (
        <button
          aria-pressed="true"
          className="gh-primary-facet-chip is-active"
          key={chip.id || `${chip.key}-${chip.label}`}
          onClick={chip.clear || (() => clearFilter(filters, chip, onDiscoveryStateChange))}
          title={`Remove ${chip.label}`}
          type="button"
        >
          <span className="gh-primary-facet-chip-label">{chip.label}</span>
          <span className="gh-primary-facet-chip-x" aria-hidden="true">×</span>
        </button>
      ))}
      {(showFiltersBadge > 0 || schemaFilter) && onClearAll ? (
        <button
          className="gh-primary-facet-clear-all"
          onClick={onClearAll}
          title="Clear all applied filters"
          type="button"
        >
          Clear all
        </button>
      ) : null}
      <div className="gh-primary-facet-spacer" />
      <button
        aria-controls="gh-discovery-filter-popover"
        aria-expanded="false"
        aria-haspopup="dialog"
        aria-label="Stack Filters"
        className="gh-primary-facet-launch"
        onClick={onOpenFilters}
        title="Open detailed filters"
        type="button"
      >
        <span aria-hidden="true" className="gh-primary-facet-launch-icon">
          {/* Two-column-bars icon to match the target Filters launcher glyph */}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
        </span>
        <span>Filters</span>
        {showFiltersBadge ? (
          <span className="gh-primary-facet-launch-badge" aria-hidden="true">
            {showFiltersBadge}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function ActiveFilterStrip({ filters, schemaFilter, onDiscoveryStateChange, onClearSchemaFilter }) {
  const chips = [];
  if (schemaFilter?.schema) {
    chips.push({
      id: "schema",
      label: `Schema: ${schemaFilter.catalog}.${schemaFilter.schema}`,
      clear: onClearSchemaFilter,
    });
  }
  for (const type of filters.types || []) {
    chips.push({
      id: `type-${type}`,
      label: `Type: ${type}`,
      clear: () => onDiscoveryStateChange((current) => ({
        ...current,
        types: (current.types || []).filter((t) => t !== type),
      })),
    });
  }
  for (const catalog of filters.catalogs || []) {
    chips.push({
      id: `catalog-${catalog}`,
      label: `Catalog: ${catalog}`,
      clear: () => onDiscoveryStateChange((current) => ({
        ...current,
        catalogs: (current.catalogs || []).filter((c) => c !== catalog),
      })),
    });
  }
  for (const domain of filters.domains || []) {
    chips.push({
      id: `domain-${domain}`,
      label: `Domain: ${domain}`,
      clear: () => onDiscoveryStateChange((current) => ({
        ...current,
        domains: (current.domains || []).filter((d) => d !== domain),
      })),
    });
  }
  for (const tier of filters.tiers || []) {
    chips.push({
      id: `tier-${tier}`,
      label: `Tier: ${tier}`,
      clear: () => onDiscoveryStateChange((current) => ({
        ...current,
        tiers: (current.tiers || []).filter((t) => t !== tier),
      })),
    });
  }
  for (const cert of filters.certifications || []) {
    chips.push({
      id: `cert-${cert}`,
      label: `Cert: ${cert}`,
      clear: () => onDiscoveryStateChange((current) => ({
        ...current,
        certifications: (current.certifications || []).filter((c) => c !== cert),
      })),
    });
  }
  if (filters.query) {
    chips.push({
      id: "query",
      label: `Search: "${filters.query}"`,
      clear: () => onDiscoveryStateChange((current) => ({ ...current, query: "" })),
    });
  }
  if (!chips.length) return null;
  const clearAll = () => {
    onClearSchemaFilter?.();
    onDiscoveryStateChange((current) => ({
      ...current,
      query: "",
      types: [],
      catalogs: [],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
    }));
  };
  return (
    <div className="gh-filter-strip" role="status" aria-live="polite">
      <span className="gh-filter-chip-label">Filtered by</span>
      {chips.map((chip) => (
        <button
          aria-label={`Clear ${chip.label}`}
          className="gh-filter-chip"
          key={chip.id}
          onClick={chip.clear}
          type="button"
        >
          <span>{chip.label}</span>
          <span className="gh-filter-chip-x" aria-hidden="true">×</span>
        </button>
      ))}
      <button className="gh-filter-chip-clear-all" onClick={clearAll} type="button">
        Clear all
      </button>
    </div>
  );
}

function DiscoveryActivityHome({ favorites, recentlyViewed, assetsByFqn, onOpen }) {
  const pickAssets = (fqns) => fqns.map((fqn) => assetsByFqn.get(fqn)).filter(Boolean).slice(0, 6);
  const favoriteAssets = pickAssets([...favorites]);
  const recentAssets = pickAssets(recentlyViewed);
  if (!favoriteAssets.length && !recentAssets.length) return null;
  return (
    <div className="gh-activity-home">
      {favoriteAssets.length ? (
        <div className="gh-activity-column">
          <div className="gh-activity-title">★ Your favorites</div>
          <div className="gh-activity-list">
            {favoriteAssets.map((asset) => (
              <button
                className="gh-activity-chip"
                key={asset.fqn}
                onClick={() => onOpen(asset.fqn)}
                type="button"
                title={asset.fqn}
              >
                <AssetTypeIcon asset={asset} size="sm" />
                <span className="gh-activity-chip-name">{asset.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {recentAssets.length ? (
        <div className="gh-activity-column">
          <div className="gh-activity-title">⧗ Recently viewed</div>
          <div className="gh-activity-list">
            {recentAssets.map((asset) => (
              <button
                className="gh-activity-chip"
                key={asset.fqn}
                onClick={() => onOpen(asset.fqn)}
                type="button"
                title={asset.fqn}
              >
                <AssetTypeIcon asset={asset} size="sm" />
                <span className="gh-activity-chip-name">{asset.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiscoveryBulkBar({ count, onClear, onAssignOwner, onAddTag, onAddGlossary, disabled = false }) {
  if (!count) return null;
  return (
    <div className="gh-discovery-bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="gh-discovery-bulk-count">{count} selected</span>
      <div className="gh-discovery-bulk-actions">
        <button className="gh-secondary-button gh-secondary-button-compact" disabled={disabled} onClick={onAssignOwner} type="button">
          Assign owner…
        </button>
        <button className="gh-secondary-button gh-secondary-button-compact" disabled={disabled} onClick={onAddTag} type="button">
          Add tag…
        </button>
        <button className="gh-secondary-button gh-secondary-button-compact" disabled={disabled} onClick={onAddGlossary} type="button">
          Add glossary…
        </button>
        <button className="gh-tertiary-button gh-inline-link-button" onClick={onClear} type="button">
          Clear
        </button>
      </div>
    </div>
  );
}

function assetSourceLabel(asset) {
  const fullPath = String(asset?.fullPath || asset?.fqn || "").trim();
  if (fullPath && fullPath !== String(asset?.name || "").trim()) return fullPath;
  const catalog = String(asset?.catalog || "").trim();
  const schema = String(asset?.schema || "").trim();
  const objectType = displayObjectType(asset) || "Asset";
  return [catalog || objectType, schema].filter(Boolean).join(" · ");
}

function certificationLabel(asset) {
  const value = String(asset?.certification || "").trim();
  if (!value || value === "Unassigned") return "";
  return value;
}

function sensitivityLabel(asset) {
  const value = String(asset?.sensitivity || "").trim();
  if (!value || value === "Unassigned") return "";
  return value;
}

function criticalityLabel(asset) {
  const value = String(asset?.criticality || asset?.businessCriticality || "").trim();
  if (!value || value === "Unassigned") return "";
  return value;
}

function coveragePercent(asset) {
  const value = Number(asset?.coverageScore);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function glossaryLabels(asset) {
  return Array.isArray(asset?.glossaryTerms)
    ? asset.glossaryTerms.map((term) => term?.label || term?.name || term).filter(Boolean)
    : [];
}

function sensitivityToneClass(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (/restricted|pii|personal|critical/.test(normalized)) return "restricted";
  if (/confidential/.test(normalized)) return "confidential";
  if (/internal/.test(normalized)) return "internal";
  return "";
}

function assetHasCdeSignal(asset) {
  const values = [
    asset?.cde,
    asset?.isCde,
    asset?.criticalDataElement,
    ...(Array.isArray(asset?.tagLabels) ? asset.tagLabels : []),
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
  ];
  return values.some((value) => value === true || /^cde$/i.test(String(value || "").trim()));
}

function assetHasPiiSignal(asset) {
  const values = [
    asset?.pii,
    asset?.containsPii,
    asset?.sensitivity,
    ...(Array.isArray(asset?.tagLabels) ? asset.tagLabels : []),
    ...(Array.isArray(asset?.tags) ? asset.tags : []),
  ];
  return values.some((value) => value === true || /\bpii\b|personal/i.test(String(value || "")));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactCount(value, suffix = "") {
  const number = numberOrNull(value);
  if (number === null || number < 0) return "";
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(number >= 10_000_000_000 ? 0 : 1)}B${suffix}`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M${suffix}`;
  if (number >= 1_000) return `${Math.round(number).toLocaleString()}${suffix}`;
  return `${Math.round(number).toLocaleString()}${suffix}`;
}

function prototypeSafeDiscoveryText(value = "") {
  return String(value || "")
    .replace(/\bAuthoritative\b/gi, "Prototype")
    .replace(/\bSource-of-record\b/gi, "Prototype reference")
    .replace(/\bsource-of-record\b/gi, "prototype reference");
}

function discoveryResultMetadata(asset, primaryOwner = "", sourceAuthoritative = true) {
  const owner = prettyOwnerName(primaryOwner);
  if (!sourceAuthoritative) {
    const freshness = String(asset?.freshness || asset?.freshnessLabel || asset?.updatedAgo || "").trim();
    const queries = compactCount(asset?.queries30d || asset?.queryCount30d || asset?.usage?.queries30d, " queries / 30d");
    const upstream = numberOrNull(asset?.upstream || asset?.upstreamCount);
    const downstream = numberOrNull(asset?.downstream || asset?.downstreamCount);
    const lineage =
      upstream !== null || downstream !== null
        ? `${upstream ?? 0} up / ${downstream ?? 0} down`
        : "";
    const rows = typeof asset?.rows === "string" && asset.rows !== "-"
      ? asset.rows
      : compactCount(asset?.rows || asset?.rowCount, " rows");
    return [
      owner ? { key: "owner", label: owner } : null,
      freshness ? { key: "freshness", label: `Fresh ${freshness}` } : null,
      queries ? { key: "usage", label: queries } : null,
      lineage ? { key: "lineage", label: lineage } : null,
      rows ? { key: "rows", label: rows } : null,
      { key: "prototype-proof", label: "Prototype fixture - not live proof", hidden: true },
    ].filter(Boolean);
  }
  const freshness = String(asset?.freshness || asset?.freshnessLabel || asset?.updatedAgo || "").trim();
  const queries = compactCount(asset?.queries30d || asset?.queryCount30d || asset?.usage?.queries30d, " queries / 30d");
  const upstream = numberOrNull(asset?.upstream || asset?.upstreamCount);
  const downstream = numberOrNull(asset?.downstream || asset?.downstreamCount);
  const lineage =
    upstream !== null || downstream !== null
      ? `${upstream ?? 0} up / ${downstream ?? 0} down`
      : "";
  const rows = typeof asset?.rows === "string" && asset.rows !== "—"
    ? asset.rows
    : compactCount(asset?.rows || asset?.rowCount, " rows");
  return [owner, freshness ? `Fresh ${freshness}` : "", queries, lineage, rows].filter(Boolean);
}

function ownerLabelsForAsset(asset) {
  return Array.isArray(asset?.owners) ? asset.owners.map((owner) => ownerLabel(owner)).filter(Boolean) : [];
}

function ownerLabelForRole(asset, roleMatcher) {
  if (!Array.isArray(asset?.owners)) return "";
  const owner = asset.owners.find((candidate) => ownerHasRole(candidate, roleMatcher));
  return ownerLabel(owner);
}

function columnPreviewForAsset(asset, limit = 4) {
  return Array.isArray(asset?.columns)
    ? asset.columns
        .map((column) => ({
          name: String(column?.name || "").trim(),
          type: String(column?.type || column?.dataType || "").trim(),
          keyEvidence: Boolean(
            column?.isPrimaryKey ||
            column?.primaryKey ||
            column?.isPartitionKey ||
            /primary|foreign|key|identifier|pii|cde/i.test(String(column?.constraint || column?.tags || column?.name || "")),
          ),
        }))
        .filter((column) => column.name)
        .slice(0, limit)
    : [];
}

function tagLabels(asset) {
  const entries = Array.isArray(asset?.tagEntries)
    ? asset.tagEntries.map((tag) => tag?.label || tag?.name || tag?.value)
    : [];
  const tags = Array.isArray(asset?.tags)
    ? asset.tags.map((tag) => (typeof tag === "string" ? tag : tag?.label || tag?.name || tag?.value))
    : [];
  return [...new Set([...entries, ...tags].map((tag) => String(tag || "").trim()).filter(Boolean))];
}

function previewMetricItems({ asset, primaryOwner, stewardOwner, coverage, qualityScore, totalColumnCount, sourceAuthoritative = true }) {
  const freshness =
    String(asset?.freshness || asset?.freshnessLabel || asset?.updatedAgo || "").trim() ||
    relativeTime(asset?.updatedAt || asset?.lastModified);
  const rawRows = asset?.rows ?? asset?.rowCount;
  const rowCount = Number.isFinite(Number(rawRows))
    ? Number(rawRows).toLocaleString()
    : typeof rawRows === "string" && rawRows !== "—"
      ? rawRows
      : "";
  const usage =
    compactCount(asset?.queries30d || asset?.queryCount30d || asset?.usage?.queries30d || asset?.queryCount, " queries");
  return [
    {
      label: "Owner",
      value: primaryOwner ? prettyOwnerName(primaryOwner) : "Unassigned",
      unavailable: !primaryOwner,
    },
    {
      label: "Steward team",
      value: stewardOwner ? prettyOwnerName(stewardOwner) : "Unavailable",
      unavailable: !stewardOwner,
    },
    {
      label: "Freshness",
      value: freshness && freshness !== "—" ? freshness : "Unavailable",
      unavailable: !freshness || freshness === "—",
    },
    {
      label: "Quality score",
      value: qualityScore !== null ? `${Math.round(qualityScore)} / 100` : "Unavailable",
      unavailable: qualityScore === null,
    },
    {
      label: "Rows",
      value: rowCount || "Unavailable",
      unavailable: !rowCount,
    },
    {
      label: "Usage · 30d",
      value: usage || "Unavailable",
      unavailable: !usage,
    },
  ];
}

function resultTabDefinitions({ resultsCount = 0, assets = [], facets = {} }) {
  const typeCount = (matchers) => {
    const assetTypeFacets = /** @type {{ assetTypes?: unknown }} */ (facets).assetTypes;
    const facetEntries = Array.isArray(assetTypeFacets) ? assetTypeFacets : [];
    const facetTotal = facetEntries.reduce((sum, entry) => {
      const value = String(entry?.value || "");
      return matchers.some((matcher) => matcher.test(value)) ? sum + Number(entry?.count || 0) : sum;
    }, 0);
    if (facetTotal) return facetTotal;
    return assets.filter((asset) => {
      const value = `${displayObjectType(asset)} ${asset?.assetType || ""} ${asset?.objectType || ""}`;
      return matchers.some((matcher) => matcher.test(value));
    }).length;
  };
  return [
    { key: "all", label: "Results", count: resultsCount || assets.length, types: [] },
    {
      key: "datasets",
      label: "Datasets",
      count: typeCount([/table/i, /view/i, /dataset/i]),
      types: ["Delta Table", "Managed Table", "Materialized View", "View", "Streaming Table", "External Table"],
    },
    { key: "reports", label: "Reports", count: typeCount([/report/i]), types: ["Report"] },
    { key: "dashboards", label: "Dashboards", count: typeCount([/dashboard/i]), types: ["Dashboard"] },
    { key: "policies", label: "Policies", count: typeCount([/policy/i]), types: ["Policy"] },
    { key: "glossary", label: "Glossary Terms", count: typeCount([/glossary/i, /term/i]), types: ["Glossary Term"] },
  ];
}

function DiscoveryFilterSelect({
  label,
  value = "",
  allLabel = "All",
  options = [],
  onChange,
  disabled = false,
  title = "",
}) {
  const normalizedOptions = [...new Set((options || []).filter(Boolean))];
  return (
    <label className="gh-discovery-filter-select">
      <span>{label}</span>
      <select
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        title={title}
        value={value || ""}
      >
        <option value="">{allLabel}</option>
        {normalizedOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiscoverySearchHero({
  filters,
  facets,
  bootstrap,
  onDiscoveryStateChange,
  onOpenSavedSearches,
  onOpenFilters,
  onClearAll,
  onAskAtlas,
  atlasAiAvailable = true,
  atlasAiLoading = false,
  atlasAiUnavailableReason = "",
  savedSearchesOpen = false,
  advancedOpen = false,
  ownerOptions = [],
  ownerFilterValue = "",
  onOwnerFilterChange,
  sourceAuthoritative = true,
}) {
  const selectedOne = (values = []) => (Array.isArray(values) && values.length === 1 ? values[0] : "");
  const setSingle = (key) => (value) =>
    onDiscoveryStateChange((current) => ({
      ...current,
      [key]: value ? [value] : [],
    }));
  return (
    <section className="gh-discovery-hero" aria-label="Discovery search">
      <div className="gh-discovery-hero-copy">
        <div className="ga-eyebrow">Discover</div>
        <h1>Find trusted, governed data</h1>
        <p>
          {sourceAuthoritative
            ? "Search across catalogs, schemas, tables, columns, models, and glossary terms. Results are permission-aware and ranked by governed trust signals."
            : "Search across catalogs, schemas, tables, columns, models, and glossary terms. Prototype results are permission-aware in shape and ranked by non-live trust fixtures."}
        </p>
      </div>
      <div className="gh-discovery-search-row">
        <label className="gh-discovery-search-box">
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
          </span>
          <input
            aria-label="Search discovery assets"
            onChange={(event) =>
              onDiscoveryStateChange((current) => ({
                ...current,
                query: event.target.value,
              }))
            }
            placeholder="Try: revenue, customer_id, churn, marisol, sox-relevant..."
            value={filters.query || ""}
          />
        </label>
        <button
          aria-expanded={savedSearchesOpen}
          className="gh-discovery-secondary-action"
          onClick={onOpenSavedSearches}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" />
          </svg>
          <span>Saved searches</span>
        </button>
        <button
          aria-expanded={advancedOpen}
          className="gh-discovery-secondary-action"
          onClick={onOpenFilters}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16" />
            <path d="M7 12h10" />
            <path d="M10 19h4" />
          </svg>
          <span>Advanced</span>
        </button>
        <button
          className="gh-discovery-ai-button"
          disabled={atlasAiLoading || !atlasAiAvailable}
          onClick={onAskAtlas}
          title={!atlasAiAvailable ? atlasAiUnavailableReason : undefined}
          type="button"
        >
          <span aria-hidden="true">✦</span>
          <span>{atlasAiLoading ? "Asking Atlas AI" : "Ask Atlas AI"}</span>
          <small>BETA</small>
        </button>
        <button
          aria-label="Stack Filters"
          className="gh-discovery-icon-button"
          onClick={onOpenFilters}
          title="Open detailed filters"
          type="button"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16" />
            <path d="M7 12h10" />
            <path d="M10 17h4" />
          </svg>
        </button>
      </div>
      <div className="gh-discovery-filter-row">
        <DiscoveryFilterSelect
          allLabel="All Types"
          label="Asset Type"
          onChange={setSingle("types")}
          options={facetValues(facets, "assetTypes", [], filters.types)}
          value={selectedOne(filters.types)}
        />
        <DiscoveryFilterSelect
          allLabel="All Catalogs"
          label="Catalog"
          onChange={setSingle("catalogs")}
          options={facetValues(facets, "catalogs", [], filters.catalogs)}
          value={selectedOne(filters.catalogs)}
        />
        <DiscoveryFilterSelect
          allLabel="All Domains"
          label="Domain"
          onChange={setSingle("domains")}
          options={facetValues(facets, "domains", [], filters.domains)}
          value={selectedOne(filters.domains)}
        />
        <DiscoveryFilterSelect
          allLabel="All Owners"
          label="Owner"
          onChange={onOwnerFilterChange}
          options={ownerOptions}
          value={ownerFilterValue}
        />
        <DiscoveryFilterSelect
          allLabel="All"
          label="Certification"
          onChange={setSingle("certifications")}
          options={facetValues(facets, "certifications", [], filters.certifications)}
          value={selectedOne(filters.certifications)}
        />
        <DiscoveryFilterSelect
          allLabel="All"
          label="Sensitivity"
          onChange={setSingle("sensitivities")}
          options={facetValues(facets, "sensitivities", [], filters.sensitivities)}
          value={selectedOne(filters.sensitivities)}
        />
        <DiscoveryFilterSelect
          allLabel="Unavailable"
          disabled
          label="Quality"
          onChange={() => {}}
          options={[]}
          title="Quality filters require persisted quality-run evidence."
          value=""
        />
        <DiscoveryFilterSelect
          allLabel="All"
          label="Criticality"
          onChange={setSingle("tiers")}
          options={facetValues(facets, "tiers", [], filters.tiers)}
          value={selectedOne(filters.tiers)}
        />
        <button className="gh-discovery-more-filters" onClick={onOpenFilters} type="button">
          More Filters
          <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M7 12h10M10 17h4" />
          </svg>
        </button>
        <button className="gh-discovery-clear-filters" onClick={onClearAll} type="button">
          Clear All
        </button>
      </div>
    </section>
  );
}

function PrototypeDiscoveryFilterRail({
  filters,
  facets,
  assets = [],
  resultsCount = 0,
  onDiscoveryStateChange,
}) {
  const domainOptions = facetValues(facets, "domains", [], filters.domains || [])
    .filter((option) => !/^all\s+domains$/i.test(String(option || "")))
    .slice(0, 6);
  const classificationOptions = facetValues(facets, "sensitivities", [], filters.sensitivities || [])
    .filter((option) => !/^all\s+(sensitivit|classificat)/i.test(String(option || "")))
    .slice(0, 4);
  const certificationOptions = facetValues(facets, "certifications", ["Certified", "In Review", "Uncertified"], filters.certifications || [])
    .filter((option) => !/^all\s+(certificat|workflow)/i.test(String(option || "")))
    .slice(0, 4);
  const activeCertifications = filters.certifications || [];
  const activeDomains = filters.domains || [];
  const activeClassifications = filters.sensitivities || [];
  const totalCount = Number(resultsCount || assets.length || 0);
  const appendAttributeQuery = (clause) => {
    onDiscoveryStateChange((current) => ({
      ...current,
      query: appendDiscoveryQueryClause(current.query || "", clause, "AND"),
    }));
  };

  return (
    <aside className="gh-discovery-prototype-filter-rail" aria-label="Discovery filters">
      <FilterRailGroup eyebrow="Certification" count={totalCount}>
        {certificationOptions.map((option) => {
          const active = activeCertifications.includes(option);
          return (
            <button
              aria-pressed={active}
              key={option}
              onClick={() => toggleMulti(filters, "certifications", option, null, onDiscoveryStateChange)}
              type="button"
            >
              <span className={`gh-discovery-filter-dot tone-${/cert/i.test(option) ? "good" : /review|draft/i.test(option) ? "warn" : "bad"}`} />
              <span>{option}</span>
              <small>{Number(facetCount(facets, "certifications", option) || 0).toLocaleString()}</small>
            </button>
          );
        })}
      </FilterRailGroup>
      <FilterRailGroup eyebrow="Domain">
        {domainOptions.map((option) => {
          const active = activeDomains.includes(option);
          return (
            <button
              aria-pressed={active}
              key={option}
              onClick={() => toggleMulti(filters, "domains", option, null, onDiscoveryStateChange)}
              type="button"
            >
              <span className="gh-discovery-filter-square" />
              <span>{option}</span>
              <small>{Number(facetCount(facets, "domains", option) || 0).toLocaleString()}</small>
            </button>
          );
        })}
      </FilterRailGroup>
      <FilterRailGroup eyebrow="Classification">
        {classificationOptions.map((option) => {
          const active = activeClassifications.includes(option);
          return (
            <button
              aria-pressed={active}
              key={option}
              onClick={() => toggleMulti(filters, "sensitivities", option, null, onDiscoveryStateChange)}
              type="button"
            >
              <span className={`gh-discovery-filter-chip tone-${/restrict/i.test(option) ? "bad" : /conf/i.test(option) ? "warn" : "info"}`}>
                {option}
              </span>
              <small>{Number(facetCount(facets, "sensitivities", option) || 0).toLocaleString()}</small>
            </button>
          );
        })}
      </FilterRailGroup>
      <FilterRailGroup eyebrow="Attributes">
        <button type="button" onClick={() => appendAttributeQuery("tag:CDE")}>
          <span className="gh-discovery-filter-square tone-teal" />
          <span>Critical Data Element</span>
        </button>
        <button type="button" onClick={() => appendAttributeQuery("tag:pii")}>
          <span className="gh-discovery-filter-dot tone-bad" />
          <span>Contains PII</span>
        </button>
        <button type="button" onClick={() => appendAttributeQuery("tag:no_pii")}>
          <span className="gh-discovery-filter-dot tone-muted" />
          <span>No PII</span>
        </button>
      </FilterRailGroup>
    </aside>
  );
}

function FilterRailGroup({ eyebrow, count = null, children }) {
  return (
    <section className="gh-discovery-filter-group">
      <header>
        <span>{eyebrow}</span>
        {count !== null ? <small>{Number(count || 0).toLocaleString()} results</small> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

function DiscoverySavedSearchesPopover({ savedViewCounts = {}, onDiscoveryStateChange, onClose }) {
  const savedViews = [
    { label: "Revenue CDEs", view: "Certified", query: "tag:CDE domain:Finance" },
    { label: "PII assets", view: "Needs attention", query: "tag:pii" },
    { label: "High coverage certified", view: "High coverage", query: "certification:Certified" },
  ];
  return (
    <div className="gh-discovery-saved-searches-popover" role="dialog" aria-label="Saved searches">
      {savedViews.map((view) => (
        <button
          key={view.label}
          onClick={() => {
            onDiscoveryStateChange((current) => ({
              ...current,
              query: view.query,
              views: view.view ? [view.view] : current.views || [],
            }));
            onClose?.();
          }}
          type="button"
        >
          <strong>{view.label}</strong>
          <span>{view.query}</span>
          <small>{Number(savedViewCounts[view.view] || 0).toLocaleString()} visible</small>
        </button>
      ))}
      <div className="gh-discovery-saved-searches-actions" aria-label="Saved search management">
        <button
          aria-disabled="true"
          disabled
          title="Creating saved searches requires a backed user-preference store; this prototype-mock evidence does not mutate Databricks."
          type="button"
        >
          <strong>Create saved search unavailable</strong>
          <span>Requires backed preferences</span>
          <small>Disabled</small>
        </button>
        <button
          aria-disabled="true"
          disabled
          title="Managing saved searches requires a backed user-preference store; this prototype-mock evidence does not mutate Databricks."
          type="button"
        >
          <strong>Manage saved searches unavailable</strong>
          <span>Requires backed preferences</span>
          <small>Disabled</small>
        </button>
      </div>
    </div>
  );
}

function DiscoveryGlobeVisual() {
  const nodes = [
    [156, 238, 3.8], [178, 216, 2.4], [212, 185, 2.4], [238, 156, 2.4],
    [260, 226, 3.8], [302, 142, 2.4], [344, 214, 2.4], [356, 104, 2.4],
    [407, 168, 3.8], [448, 88, 2.4], [470, 236, 2.4], [520, 112, 2.4],
    [560, 220, 3.8], [574, 132, 2.4], [644, 158, 2.4], [690, 176, 2.4],
  ];
  const microNodes = [
    [228, 130], [246, 198], [276, 118], [318, 204], [332, 126], [374, 150],
    [430, 118], [462, 210], [512, 146], [540, 176], [594, 150], [628, 214],
    [672, 202], [704, 146],
  ];
  const cityNodes = [
    [244, 166], [268, 174], [292, 160], [316, 178], [340, 162], [366, 186],
    [394, 142], [416, 154], [438, 146], [462, 166], [486, 154], [510, 172],
    [536, 138], [560, 150], [584, 166], [608, 152], [632, 178], [656, 164],
  ];
  const pulseNodes = [
    [302, 142, 14], [407, 168, 18], [520, 112, 16], [560, 220, 20], [644, 158, 18],
  ];
  return (
    <div className="gh-discovery-globe" aria-hidden="true">
      <svg viewBox="0 0 760 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="gh-discovery-globe-core" cx="48%" cy="60%" r="58%">
            <stop offset="0%" stopColor="#1198de" stopOpacity="0.74" />
            <stop offset="58%" stopColor="#0870ad" stopOpacity="0.48" />
            <stop offset="100%" stopColor="#03111f" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="gh-discovery-globe-line" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6cd0ff" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#5ce1e6" stopOpacity="0.26" />
          </linearGradient>
          <radialGradient id="gh-discovery-globe-node" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
            <stop offset="100%" stopColor="#66c5ff" stopOpacity="0.32" />
          </radialGradient>
          <pattern id="gh-discovery-globe-city" width="24" height="18" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="4" r=".8" fill="#cfefff" opacity=".38" />
            <circle cx="13" cy="8" r=".7" fill="#66c5ff" opacity=".32" />
            <circle cx="21" cy="15" r=".55" fill="#5ce1e6" opacity=".26" />
          </pattern>
          <filter id="gh-discovery-globe-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path className="gh-discovery-globe-core" d="M90 260c70-142 205-214 362-194 118 15 214 75 280 168" fill="url(#gh-discovery-globe-core)" />
        <path d="M104 254c72-128 195-192 348-184 121 6 221 58 300 157-86-25-178-40-276-44-128-5-252 19-372 71Z" fill="url(#gh-discovery-globe-city)" opacity=".44" />
        <g className="gh-discovery-globe-land" fill="#0a74b2" opacity=".34">
          <path d="M254 154c31-22 71-30 117-24 23 3 42 1 58-7 18-8 40-7 65 4-13 14-33 24-60 31-32 8-55 19-70 33-22-13-45-19-70-18-20 1-34-5-40-19Z" />
          <path d="M470 182c25-18 58-22 98-13 33 8 60 7 81-3 17 11 30 25 41 42-35 3-66 0-94-10-28-9-55-7-82 8-19 10-34 2-44-24Z" />
          <path d="M322 96c38-10 75-9 112 2 29 8 58 9 88 2 10 8 16 17 18 28-46 1-86 7-119 19-24-17-58-25-100-23-12-11-12-20 1-28Z" />
        </g>
        <path d="M96 250c72-126 190-190 340-182 126 7 226 59 306 156" fill="none" stroke="#2bb8ff" strokeOpacity=".6" strokeWidth="2" />
        <path className="gh-discovery-globe-shine" d="M132 238c118-82 250-118 396-104 82 8 152 29 212 64" fill="none" stroke="#d6f7ff" strokeOpacity=".42" strokeWidth="1.4" />
        <g fill="none" stroke="#7bd7ff" strokeLinecap="round" strokeLinejoin="round" opacity=".24">
          <path d="M260 176c18-14 38-20 58-15 14 4 24 2 34-8 12-12 30-14 52-6" />
          <path d="M420 134c18-16 44-20 76-12 16 4 31 2 44-6 18-10 41-8 70 7" />
          <path d="M250 206c34-10 62-9 86 3 19 9 45 9 78-1" />
          <path d="M500 186c29-13 58-14 88-2 22 9 48 10 79 3" />
        </g>
        <path d="M155 236c86-76 184-112 294-108 96 4 176 34 244 90" fill="none" stroke="#66c5ff" strokeOpacity=".35" />
        <path d="M126 242c112-38 230-55 354-50 92 4 177 18 256 43" fill="none" stroke="#66c5ff" strokeOpacity=".18" />
        <path d="M146 206c112-58 226-83 344-72 90 8 170 35 240 80" fill="none" stroke="#66c5ff" strokeOpacity=".2" />
        <path d="M222 220c58-114 122-166 194-156 75 11 128 86 160 178" fill="none" stroke="#66c5ff" strokeOpacity=".22" />
        <path d="M300 234c-6-82 18-144 72-185" fill="none" stroke="#66c5ff" strokeOpacity=".18" />
        <path d="M494 232c16-82-4-144-60-184" fill="none" stroke="#66c5ff" strokeOpacity=".18" />
        <path d="M380 60c-18 72-18 134 0 188" fill="none" stroke="#66c5ff" strokeOpacity=".22" />
        <g className="gh-discovery-globe-network" fill="none" stroke="url(#gh-discovery-globe-line)" strokeWidth="1.2">
          <path d="M212 185 302 142 407 168 520 112 644 158" />
          <path d="M260 226 407 168 560 220" />
          <path d="M302 142 448 88 520 112" />
          <path d="M344 214 407 168 448 88" />
          <path d="M178 216 260 226 344 214 470 236 560 220 690 238" />
          <path d="M238 156 302 142 356 104 448 88 574 132 690 176" />
          <path d="M156 238 212 185 238 156 356 104" />
          <path d="M520 112 574 132 644 158 690 176" />
        </g>
        <g className="gh-discovery-globe-pulses" fill="none" stroke="#8be7ff" strokeWidth="1" filter="url(#gh-discovery-globe-glow)">
          {pulseNodes.map(([cx, cy, r]) => (
            <circle key={`${cx}-${cy}-pulse`} cx={cx} cy={cy} r={r} />
          ))}
        </g>
        {nodes.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="url(#gh-discovery-globe-node)" opacity={r > 3 ? 1 : 0.74} />
        ))}
        <g className="gh-discovery-globe-micro" fill="#cfefff" opacity=".28">
          {microNodes.map(([cx, cy]) => <circle key={`${cx}-${cy}-micro`} cx={cx} cy={cy} r="0.9" />)}
        </g>
        <g className="gh-discovery-globe-city-lights" fill="#cfefff" opacity=".24">
          {cityNodes.map(([cx, cy]) => <circle key={`${cx}-${cy}-city`} cx={cx} cy={cy} r="1.1" />)}
        </g>
      </svg>
    </div>
  );
}

function DiscoveryActiveFilterRow({
  chips = [],
  filters,
  onDiscoveryStateChange,
  onResetBrowse,
}) {
  const visibleChips = chips.filter((chip) => {
    const label = String(chip?.label || "");
    return chip?.key !== "query" && !/^search\s*:/i.test(label);
  });
  if (!visibleChips.length) return null;
  return (
    <div className="gh-discovery-active-filter-row" role="status" aria-live="polite">
      <span className="gh-filter-chip-label">Filtered by</span>
      {visibleChips.map((chip, index) => {
        const key = chip.id || `${chip.key}-${chip.label}-${index}`;
        return (
          <button
            className="gh-filter-chip"
            key={key}
            onClick={() => clearFilter(filters, chip, onDiscoveryStateChange)}
            title={`Clear ${chip.label}`}
            type="button"
          >
            <span>{chip.label}</span>
            <span className="gh-filter-chip-x" aria-hidden="true">×</span>
          </button>
        );
      })}
      <button className="gh-filter-chip-clear-all" onClick={onResetBrowse} type="button">
        Reset browse
      </button>
    </div>
  );
}

function DiscoveryResultsTable({
  assets = [],
  resultsCount = 0,
  facets = {},
  filters,
  bootstrap,
  sortOptions = [],
  onDiscoveryStateChange,
  onSelect,
  selectedAssetFqn = "",
  favorites,
  onToggleFavorite,
  onOpenAsset,
  onOpenGovernance,
  onOpenLineage,
  lineageAvailable = true,
  lineageUnavailableReason = "",
  renderedRecordAvailability = {},
  recordUnavailableOverrides = {},
  recordUnavailableReason = "",
  sourceAuthoritative = false,
  sourceLabel = "",
  sourceIsPrototype = false,
}) {
  const [displayMode, setDisplayMode] = useState("list");
  const tabs = resultTabDefinitions({ resultsCount, assets, facets });
  const activeTypeSet = new Set(filters.types || []);
  const activeTab =
    tabs.find((tab) => tab.types.length && tab.types.every((type) => activeTypeSet.has(type))) ||
    (!activeTypeSet.size ? tabs[0] : null);
  const applyTab = (tab) => {
    onDiscoveryStateChange((current) => ({
      ...current,
      types: tab.types || [],
    }));
  };
  const sortValues = (() => {
    const opts = Array.isArray(sortOptions) ? sortOptions : [];
    const filtered = opts
      .filter((option) => !/best\s*match/i.test(String(option)))
      .map((option) => (/coverage\s*score/i.test(String(option)) ? "Trust score" : option));
    return filtered.some((option) => /relevance/i.test(String(option))) ? filtered : ["Relevance", ...filtered];
  })();
  const normalizedSortValue = /coverage\s*score/i.test(String(filters.sortBy || ""))
    ? "Trust score"
    : filters.sortBy || "Relevance";
  return (
    <section
      aria-label="Discovery results"
      className="gh-discovery-results-panel"
      data-display-mode={displayMode}
    >
      <div className="gh-visually-hidden">
        Showing {Math.min(assets.length, resultsCount || assets.length).toLocaleString()} of {(resultsCount || assets.length).toLocaleString()} assets
      </div>
      {!sourceAuthoritative && !sourceIsPrototype ? (
        <div className="gh-discovery-source-strip" role="status">
          <strong>{sourceLabel || "Degraded discovery payload"}</strong>
          <span>Asset values shown here are not live Databricks proof unless the source is explicitly live and authoritative.</span>
        </div>
      ) : null}
      <div className="gh-discovery-results-tabs">
        {tabs.map((tab) => (
          <button
            aria-pressed={(activeTab?.key || "") === tab.key}
            className={(activeTab?.key || "") === tab.key ? "is-active" : ""}
            key={tab.key}
            onClick={() => applyTab(tab)}
            type="button"
          >
            <span>{tab.label}</span>
            <small>{Number(tab.count || 0).toLocaleString()}</small>
          </button>
        ))}
        <div className="gh-discovery-results-tabs-spacer" />
        <SortDropdown
          options={sortValues}
          value={normalizedSortValue}
          onChange={(nextValue) =>
            onDiscoveryStateChange((current) => ({
              ...current,
              sortBy: /trust\s*score/i.test(String(nextValue)) ? "Coverage score" : nextValue,
            }))
          }
        />
        <div className="gh-discovery-view-mode" aria-label="Result layout">
          <button
            aria-label="Grid view"
            aria-pressed={displayMode === "grid"}
            className={`gh-discovery-view-mode-button ${displayMode === "grid" ? "is-active" : ""}`.trim()}
            onClick={() => setDisplayMode("grid")}
            title="Grid view"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="4" width="6" height="6" rx="1" />
              <rect x="14" y="4" width="6" height="6" rx="1" />
              <rect x="4" y="14" width="6" height="6" rx="1" />
              <rect x="14" y="14" width="6" height="6" rx="1" />
            </svg>
          </button>
          <button
            aria-label="List view"
            aria-pressed={displayMode === "list"}
            className={`gh-discovery-view-mode-button ${displayMode === "list" ? "is-active" : ""}`.trim()}
            onClick={() => setDisplayMode("list")}
            title="List view"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 6h12" />
              <path d="M8 12h12" />
              <path d="M8 18h12" />
              <path d="M4 6h.01" />
              <path d="M4 12h.01" />
              <path d="M4 18h.01" />
            </svg>
          </button>
        </div>
      </div>
      <div className="gh-discovery-table-grid" role="table" aria-rowcount={assets.length + 1}>
        <div className="gh-discovery-table-head" role="row">
          <div role="columnheader">Asset Name</div>
          <div role="columnheader">Type</div>
          <div role="columnheader">Owner</div>
          <div role="columnheader">Certification</div>
          <div role="columnheader">Domain</div>
          <div role="columnheader">{sourceAuthoritative ? "Trust Signal" : "Prototype Trust"}</div>
          <div role="columnheader">Sensitivity</div>
          <div role="columnheader">Glossary Linkage</div>
          <div role="columnheader">Description</div>
        </div>
        {assets.map((asset) => (
          <DiscoveryResultTableRow
            asset={asset}
            isFavorite={favorites.has(asset.fqn)}
            key={asset.fqn}
            lineageAvailable={lineageAvailable}
            lineageUnavailableReason={lineageUnavailableReason}
            onOpenAsset={onOpenAsset}
            onOpenGovernance={onOpenGovernance}
            onOpenLineage={onOpenLineage}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
            recordOpenable={
              recordUnavailableOverrides[asset.fqn] === true
                ? false
                : renderedRecordAvailability[asset.fqn] ?? null
            }
            recordUnavailableReason={recordUnavailableReason}
            selected={asset.fqn === selectedAssetFqn}
            sourceAuthoritative={sourceAuthoritative}
          />
        ))}
      </div>
    </section>
  );
}

function PrototypeDiscoveryAssetGlyph({ asset }) {
  const type = displayObjectType(asset);
  const isModel = /model/i.test(type);
  const isView = /view/i.test(type);
  return (
    <span
      aria-label={type || "Asset"}
      className={`gh-discovery-prototype-asset-glyph ${isModel ? "is-model" : isView ? "is-view" : "is-table"}`}
      role="img"
      title={type || "Asset"}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {isModel ? (
          <>
            <path d="M8 4a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 4 4" />
            <path d="M16 4a4 4 0 0 1 4 4v1a3 3 0 0 1 0 6v1a4 4 0 0 1-4 4" />
            <path d="M12 4v16" />
          </>
        ) : isView ? (
          <>
            <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
            <circle cx="12" cy="12" r="2.5" />
          </>
        ) : (
          <>
            <rect x="5" y="5" width="14" height="14" rx="2" />
            <path d="M5 10h14" />
            <path d="M10 5v14" />
            <path d="M14 5v14" />
          </>
        )}
      </svg>
    </span>
  );
}

function DiscoveryMetaIcon({ kind = "" }) {
  const commonProps = {
    "aria-hidden": "true",
    className: "gh-discovery-prototype-meta-icon",
    fill: "none",
    height: "12",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.8",
    viewBox: "0 0 24 24",
    width: "12",
  };
  if (kind === "freshness") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (kind === "usage") {
    return (
      <svg {...commonProps}>
        <path d="M3 17h3l3-10 4 10 3-6 2 6h3" />
      </svg>
    );
  }
  if (kind === "lineage") {
    return (
      <svg {...commonProps}>
        <circle cx="6" cy="7" r="2" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="12" cy="17" r="2" />
        <path d="M7.8 8.2 11 15" />
        <path d="M16.2 8.2 13 15" />
      </svg>
    );
  }
  if (kind === "rows") {
    return (
      <svg {...commonProps}>
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M5 10h14" />
        <path d="M5 15h14" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

function DiscoveryResultTableRow({
  asset,
  selected,
  onSelect,
  onOpenAsset,
  onOpenGovernance,
  onOpenLineage,
  isFavorite = false,
  onToggleFavorite,
  lineageAvailable = true,
  lineageUnavailableReason = "",
  recordOpenable = null,
  recordUnavailableReason = "",
  sourceAuthoritative = true,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const owners = ownerLabelsForAsset(asset);
  const primaryOwner = owners[0] || "";
  const cert = certificationLabel(asset);
  const sensitivity = sensitivityLabel(asset);
  const coverage = coveragePercent(asset);
  const terms = glossaryLabels(asset);
  const metadataItems = discoveryResultMetadata(asset, primaryOwner, sourceAuthoritative);
  const recordUnavailable = recordOpenable === false;
  const description = prototypeSafeDiscoveryText(asset.description || "");

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const stop = (fn) => (event) => {
    event.stopPropagation();
    event.preventDefault();
    fn?.();
  };

  return (
    <article
      aria-label={`Select ${asset.name}`}
      className={`gh-discovery-table-row gh-discovery-asset-card ${selected ? "is-selected" : ""}`.trim()}
      data-asset-fqn={asset.fqn}
      onClick={() => onSelect(asset.fqn)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(asset.fqn);
        }
      }}
      role="row"
      tabIndex={0}
    >
      <div className="gh-discovery-cell gh-discovery-name-cell" role="cell">
        {sourceAuthoritative ? (
          <AssetTypeIcon asset={asset} size="lg" />
        ) : (
          <PrototypeDiscoveryAssetGlyph asset={asset} />
        )}
        <div className="gh-discovery-name-stack">
          <button
            className="gh-discovery-row-title"
            onClick={stop(() => onSelect(asset.fqn))}
            title={asset.fqn}
            type="button"
          >
            {asset.name}
          </button>
          <span>{assetSourceLabel(asset)}</span>
        </div>
          <button
            aria-label={isFavorite ? "Remove local favorite" : "Add local favorite"}
            aria-pressed={isFavorite}
            className={`gh-discovery-row-star gh-row-action ${isFavorite ? "is-favorite" : ""}`.trim()}
            onClick={stop(() => onToggleFavorite?.(asset.fqn))}
            title={isFavorite ? "Remove local browser favorite" : "Save local browser favorite"}
            type="button"
          >
            {isFavorite ? "★" : "☆"}
        </button>
      </div>
      <div className="gh-discovery-cell gh-discovery-type-cell" role="cell">
        <span className="gh-discovery-type-chip">{displayObjectType(asset) || "Asset"}</span>
      </div>
      <div className="gh-discovery-cell gh-discovery-owner-cell" role="cell">
        {primaryOwner ? (
          <>
            <OwnerAvatar owner={primaryOwner} size={24} />
            <span className="gh-truncate" title={owners.join(", ")}>{prettyOwnerName(primaryOwner)}</span>
          </>
        ) : (
          <span className="gh-discovery-muted">Unassigned</span>
        )}
      </div>
      <div className="gh-discovery-cell gh-discovery-cert-cell" role="cell">
        {cert ? <span className="gh-discovery-status-pill certified">{cert}</span> : <span className="gh-discovery-muted">—</span>}
      </div>
      <div className="gh-discovery-cell gh-discovery-domain-cell" role="cell">{asset.domain && asset.domain !== "Unassigned" ? asset.domain : "Unassigned"}</div>
      <div className="gh-discovery-cell gh-discovery-coverage-cell" role="cell">
        {coverage !== null ? (
          sourceAuthoritative ? (
            <>
              <span>{coverage}%</span>
              <span className="gh-discovery-coverage-bar" aria-hidden="true">
                <i style={{ width: `${coverage}%` }} />
              </span>
              <span className="gh-discovery-asset-trust gh-visually-hidden">{coverage}%</span>
            </>
          ) : (
            <>
              <span className="gh-discovery-trust-score">{coverage}</span>
              <span className="gh-discovery-trust-label">Trust</span>
              <span className="gh-visually-hidden">Prototype trust fixture, not live score proof</span>
            </>
          )
        ) : (
          <span className="gh-discovery-muted">—</span>
        )}
      </div>
      <div className="gh-discovery-cell gh-discovery-sensitivity-cell" role="cell">
        {sensitivity ? <span className={`gh-discovery-sensitivity-pill ${sensitivityToneClass(sensitivity)}`.trim()}>{sensitivity}</span> : <span className="gh-discovery-muted">—</span>}
      </div>
      <div className="gh-discovery-cell gh-discovery-linkage-cell" role="cell">
        {assetHasCdeSignal(asset) || assetHasPiiSignal(asset) ? (
          <>
            {assetHasCdeSignal(asset) ? <span className="gh-discovery-linkage gh-discovery-cde-pill">CDE</span> : null}
            {assetHasPiiSignal(asset) ? <span className="gh-discovery-linkage gh-discovery-pii-pill">PII</span> : null}
          </>
        ) : terms.length ? (
          <span className="gh-discovery-linkage">{terms.length} term{terms.length === 1 ? "" : "s"}</span>
        ) : (
          <span className="gh-discovery-muted">—</span>
        )}
      </div>
      <div className="gh-discovery-cell gh-discovery-description-cell" role="cell">
        <span className="gh-truncate" title={description || ""}>
          {description || "No description has been captured for this asset yet."}
        </span>
        {metadataItems.length ? (
          <div className="gh-discovery-prototype-meta-line" aria-label="Asset metadata">
            {metadataItems.map((item) => {
              const entry = typeof item === "string" ? { key: item, label: item } : item;
              return (
                <span
                  className={entry.hidden ? "gh-visually-hidden" : ""}
                  data-meta-kind={entry.key}
                  key={entry.key || entry.label}
                >
                  {entry.hidden ? null : <DiscoveryMetaIcon kind={entry.key} />}
                  {entry.label}
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="gh-discovery-row-menu-wrap" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Open asset actions"
            className="gh-discovery-row-menu-button gh-row-action"
            onClick={stop(() => setMenuOpen((current) => !current))}
            type="button"
          >
            ⋮
          </button>
          {menuOpen ? (
            <div className="gh-discovery-asset-card-menu" role="menu">
              <button
                className="gh-discovery-asset-card-menu-item"
                disabled={recordUnavailable}
                onClick={stop(() => { setMenuOpen(false); onOpenAsset(asset.fqn); })}
                role="menuitem"
                type="button"
              >
                View details
              </button>
              <button
                className="gh-discovery-asset-card-menu-item"
                disabled={recordUnavailable}
                onClick={stop(() => { setMenuOpen(false); onOpenGovernance(asset.fqn); })}
                role="menuitem"
                type="button"
              >
                Open governance
              </button>
              <button
                className="gh-discovery-asset-card-menu-item"
                disabled={!lineageAvailable}
                onClick={stop(() => { setMenuOpen(false); onOpenLineage(asset.fqn, "Data Lineage"); })}
                role="menuitem"
                title={!lineageAvailable ? lineageUnavailableReason : undefined}
                type="button"
              >
                Open lineage
              </button>
              <button
                className="gh-discovery-asset-card-menu-item"
                onClick={stop(() => { setMenuOpen(false); onToggleFavorite?.(asset.fqn); })}
                role="menuitem"
                type="button"
              >
                {isFavorite ? "Remove from favorites" : "Add to favorites"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <button
        aria-label={recordUnavailable ? "Metadata record unavailable" : "Open Record"}
        className="gh-visually-hidden gh-row-action"
        disabled={recordUnavailable}
        onClick={stop(() => onOpenAsset(asset.fqn))}
        type="button"
      >
        {recordUnavailable ? "Metadata record unavailable" : "Open Record"}
      </button>
      <button
        aria-label={lineageAvailable ? "Open Lineage" : "Lineage unavailable"}
        className="gh-visually-hidden gh-row-action"
        disabled={!lineageAvailable}
        onClick={stop(() => onOpenLineage(asset.fqn, "Data Lineage"))}
        title={!lineageAvailable ? lineageUnavailableReason : undefined}
        type="button"
      >
        {lineageAvailable ? "Open lineage" : "Lineage unavailable"}
      </button>
      {recordUnavailable && recordUnavailableReason ? (
        <span className="gh-visually-hidden">{recordUnavailableReason}</span>
      ) : null}
      {cert ? <span className="gh-discovery-asset-status gh-visually-hidden">{cert}</span> : null}
    </article>
  );
}

function DiscoveryDegradedResultsState({
  filters,
  message = "",
  onClearSearch,
  onResetBrowse,
  title = "Discovery search degraded",
}) {
  const hasQuery = Boolean(String(filters?.query || "").trim());
  const summarizedMessage =
    summarizeDiscoveryError(message) ||
    "The search surface is reachable, but live discovery could not return results.";
  return (
    <section className="gh-discovery-degraded-prototype" aria-label="Discovery degraded state">
      <article className="gh-discovery-table-row gh-discovery-asset-card gh-discovery-degraded-row" role="status">
        <div className="gh-discovery-cell gh-discovery-name-cell">
          <PrototypeDiscoveryAssetGlyph asset={{ objectType: "Table" }} />
          <div className="gh-discovery-name-stack">
            <strong className="gh-discovery-row-title">Discovery unavailable</strong>
            <span>Live catalog result row unavailable</span>
          </div>
        </div>
        <div className="gh-discovery-cell gh-discovery-coverage-cell">
          <span className="gh-discovery-trust-score">--</span>
          <span className="gh-visually-hidden">Trust unavailable because live discovery did not return results.</span>
        </div>
        <div className="gh-discovery-cell gh-discovery-description-cell">
          <span className="gh-truncate">{summarizedMessage}</span>
          <div className="gh-discovery-prototype-meta-line" aria-label="Unavailable asset metadata">
            {[
              ["owner", "Owner unavailable"],
              ["freshness", "Freshness unavailable"],
              ["usage", "Usage unavailable"],
              ["lineage", "Lineage unavailable"],
              ["rows", "Rows unavailable"],
            ].map(([kind, label]) => (
              <span data-meta-kind={kind} key={kind}>
                <DiscoveryMetaIcon kind={kind} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </article>
      <WorkspaceStateCard
        actions={(
          <>
            {hasQuery ? (
              <button
                className="gh-secondary-button"
                onClick={onClearSearch}
                type="button"
              >
                Clear search
              </button>
            ) : null}
            <button className="gh-secondary-button" onClick={onResetBrowse} type="button">
              Reset browse
            </button>
          </>
        )}
        className="gh-discovery-empty-state"
        eyebrow="Discovery Unavailable"
        message={
          "The prototype row shape is preserved with unavailable trust, usage, lineage, and row metrics instead of synthetic values."
        }
        title={title}
        tone="bad"
      />
    </section>
  );
}

function DiscoveryBottomPanels({
  assets = [],
  savedViewCounts = {},
  onDiscoveryStateChange,
  onSelect,
  aiState,
  onAskAtlas,
  atlasAiAvailable = true,
  atlasAiUnavailableReason = "",
}) {
  const savedViews = [
    { label: "Needs Owner", view: "Needs owner", count: savedViewCounts["Needs owner"] },
    { label: "Needs Certification", view: "Needs certification", count: savedViewCounts["Needs certification"] },
    { label: "Certified Data", view: "Certified", count: savedViewCounts["Certified"] },
    { label: "High Coverage Assets", view: "High coverage", count: savedViewCounts["High coverage"] },
  ];
  const recommendedAssets = [...assets]
    .filter((asset) => coveragePercent(asset) !== null)
    .sort((a, b) => (coveragePercent(b) || 0) - (coveragePercent(a) || 0))
    .slice(0, 3);
  const aiRecommendations = Array.isArray(aiState?.response?.recommendations)
    ? aiState.response.recommendations
    : [];
  return (
    <section className="gh-discovery-bottom-grid" aria-label="Discovery accelerators">
      <div className="gh-discovery-bottom-card">
        <header>
          <h2>Saved Views</h2>
          <button
            onClick={() => onDiscoveryStateChange((current) => ({ ...current, views: [] }))}
            type="button"
          >
            View all
          </button>
        </header>
        <div className="gh-discovery-saved-list">
          {savedViews.map((view) => (
            <button
              key={view.label}
              onClick={() =>
                onDiscoveryStateChange((current) => ({
                  ...current,
                  views: view.view ? [view.view] : [],
                }))
              }
              type="button"
            >
              <AssetTypeIcon type="Delta Table" size="sm" />
              <span>{view.label}</span>
              <small>{Number(view.count || 0).toLocaleString()} visible</small>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
      <div className="gh-discovery-bottom-card">
        <header>
          <h2>Recommended Assets</h2>
          <button onClick={() => recommendedAssets[0] && onSelect(recommendedAssets[0].fqn)} type="button">
            View all
          </button>
        </header>
        <div className="gh-discovery-recommended-list">
          {recommendedAssets.length ? recommendedAssets.map((asset) => {
            const coverage = coveragePercent(asset);
            return (
              <button key={asset.fqn} onClick={() => onSelect(asset.fqn)} type="button">
                <AssetTypeIcon asset={asset} size="md" />
                <span>
                  <strong>{asset.name}</strong>
                  <small>{asset.domain && asset.domain !== "Unassigned" ? asset.domain : assetSourceLabel(asset)}</small>
                </span>
                <b>{coverage}%</b>
              </button>
            );
          }) : (
            <div className="gh-discovery-bottom-empty">Recommendations appear after live coverage evidence is available.</div>
          )}
        </div>
      </div>
      <div className="gh-discovery-bottom-card gh-discovery-ai-card">
        <header>
          <h2><span aria-hidden="true">✦</span> Atlas AI Recommendations <small>BETA</small></h2>
          <button
            aria-label="Run Atlas AI recommendations"
            disabled={aiState.loading || !atlasAiAvailable}
            onClick={(event) => {
              event.preventDefault();
              onAskAtlas?.();
            }}
            title={!atlasAiAvailable ? atlasAiUnavailableReason : undefined}
            type="button"
          >
            {aiState.loading ? "Running" : "View all"}
          </button>
        </header>
        {aiState.error ? <div className="gh-discovery-bottom-empty">{aiState.error}</div> : null}
        {aiRecommendations.length ? (
          <div className="gh-discovery-ai-list">
            {aiRecommendations.slice(0, 3).map((recommendation, index) => {
              const evidence = Array.isArray(recommendation.evidence) ? recommendation.evidence[0] : null;
              const evidenceId = evidence?.id || "";
              const asset = evidenceId ? assets.find((candidate) => candidate.fqn === evidenceId) : null;
              const provider = recommendation.provider || aiState.response?.recommendationsProvider || aiState.response?.provider || "AI";
              const localEvidenceProvider = /local-evidence|prototype/i.test(String(provider));
              const authorityLabel =
                aiState.response?.authoritative === false || localEvidenceProvider
                  ? "Local evidence recommendation - not live Genie proof"
                  : "Evidence-backed recommendation from Atlas AI";
              return (
                <button
                  key={`${recommendation.title || "recommendation"}-${index}`}
                  onClick={() => asset ? onSelect(asset.fqn) : onAskAtlas()}
                  type="button"
                >
                  <AssetTypeIcon asset={asset || assets[index]} size="sm" />
                  <span>
                    <strong>{recommendation.title || "Governance recommendation"}</strong>
                    <small>{recommendation.detail ? `${authorityLabel}: ${recommendation.detail}` : authorityLabel}</small>
                  </span>
                  <em>{provider}</em>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="gh-discovery-bottom-empty">
            {!atlasAiAvailable
              ? atlasAiUnavailableReason || "Atlas AI recommendations require a configured evidence-backed endpoint."
              : aiState.loading
              ? "Atlas AI is gathering governed metadata evidence."
              : "Run Atlas AI to generate evidence-backed recommendations for this result set."}
          </div>
        )}
      </div>
    </section>
  );
}

function PreviewProfileList({ items }) {
  return (
    <div className="gh-preview-profile-list">
      {items.map((item) => (
        <div className="gh-preview-profile-row" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function DiscoveryNorthstarStrip({
  authoritative = false,
  visibleCount = 0,
  totalCount = 0,
  selectedSchemaCount = 0,
  filtersAppliedCount = 0,
  queryState = null,
  loading = false,
}) {
  const queryStateLabel = queryState?.state
    ? String(queryState.state).replace(/[_-]+/g, " ")
    : "Search ready";
  const items = [
    {
      label: "Source",
      value: authoritative ? "Live Unity Catalog" : loading ? "Refreshing" : "Degraded",
    },
    {
      label: "Results",
      value: totalCount ? `${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()}` : `${visibleCount.toLocaleString()}`,
    },
    {
      label: "Scopes",
      value: selectedSchemaCount ? `${selectedSchemaCount} selected` : "All visible schemas",
    },
    {
      label: "Filters",
      value: filtersAppliedCount ? `${filtersAppliedCount} active` : "None",
    },
    {
      label: "Query",
      value: queryStateLabel,
    },
  ];
  return (
    <section className="gh-panel gh-discovery-northstar-strip" aria-label="Discovery source and filter summary">
      {items.map((item) => (
        <div className="gh-preview-profile-row" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </section>
  );
}

function SelectionPreview({
  asset,
  detailLoading,
  detailError,
  onOpenAsset,
  onOpenGovernance,
  onOpenLinkedAsset,
  onOpenLineage,
  onClearSelection,
  linkedRecordUnavailableOverrides = {},
  previewAvailable = true,
  previewUnavailableReason = "",
  lineageAvailable = true,
  lineageUnavailableReason = "",
  recordOpenable = null,
  recordUnavailableReason = "",
  interactionResetKey = "",
  visibleAssetSet = new Set(),
  sourceAuthoritative = false,
  sourceLabel = "",
}) {
  const [lineageWarm, setLineageWarm] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [actionNotice, setActionNotice] = useState("");

  useEffect(() => {
    setNavigating(false);
    setActiveTab("overview");
    setActionNotice("");
  }, [asset?.fqn, interactionResetKey]);

  const lineage = useLineage(
    asset?.fqn || "",
    Boolean(asset?.fqn) && lineageWarm && lineageAvailable && previewAvailable,
  );
  const lineageAuthoritative = lineage.authoritative;
  const previewRelatedAssets = useMemo(() => {
    if (!asset || !lineageAvailable) return [];
    return [
      ...new Set([
        ...(asset.relatedAssets || []),
        ...(lineageAuthoritative ? previewRelatedAssetsFromGraph(lineage.graph, asset.fqn) : []),
      ]),
    ].slice(0, 4);
  }, [asset, lineage.graph, lineageAuthoritative, lineageAvailable]);
  const relatedAssetAvailability = useAssetAvailability(
    previewRelatedAssets,
    visibleAssetSet,
    {
      strict: true,
      requireRenderableDetail: true,
    },
  );

  useEffect(() => {
    if (!asset?.fqn || !lineageAvailable || !previewAvailable) {
      setLineageWarm(false);
      return undefined;
    }
    let timeoutId = 0;
    let idleId = 0;
    setLineageWarm(false);
    const enableWarmLineage = () => {
      setLineageWarm(true);
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(enableWarmLineage, { timeout: 2400 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(enableWarmLineage, 820);
    } else {
      enableWarmLineage();
    }
    return () => {
      if (typeof window !== "undefined" && idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (typeof window !== "undefined" && timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [asset?.fqn, lineageAvailable, previewAvailable]);

  if (!asset) {
    return (
      <aside className="gh-selection-preview gh-discovery-preview-card" aria-label="Asset preview">
        <EmptyStateBlock
          message="Select a result to review metadata, schema, and stewardship posture."
          title="Nothing selected"
        />
      </aside>
    );
  }

  const recordUnavailable = recordOpenable === false;
  const shortDescription = String(asset.description || "").trim();
  const targetDescriptionLine = "No description has been captured for this asset yet.";
  const owners = ownerLabelsForAsset(asset);
  const primaryOwner = owners[0] || "";
  const stewardOwner =
    String(asset.stewardTeam || asset.steward_team || "").trim() ||
    ownerLabelForRole(asset, /(^|\b)steward(ship)?(\b|$)/i);
  const ownerCount = owners.length;
  const cert = certificationLabel(asset);
  const sensitivity = sensitivityLabel(asset);
  const criticality = criticalityLabel(asset);
  const coverage = coveragePercent(asset);
  const terms = glossaryLabels(asset);
  const tags = tagLabels(asset);
  const cdeSignal = assetHasCdeSignal(asset);
  const piiSignal = assetHasPiiSignal(asset);
  const governanceTags = [
    ...new Set([
      ...tags,
      ...(cdeSignal ? ["CDE"] : []),
      ...(piiSignal ? ["PII"] : []),
    ]),
  ];
  const previewColumns = columnPreviewForAsset(asset, 6);
  const hasKeyEvidence = previewColumns.some((column) => column.keyEvidence);
  const totalColumnCountReal =
    Number.isFinite(Number(asset.columnCount))
      ? Number(asset.columnCount)
      : Array.isArray(asset.columns)
        ? asset.columns.length
        : null;
  const extraColumnCount =
    totalColumnCountReal && previewColumns.length
      ? Math.max(0, totalColumnCountReal - previewColumns.length)
      : 0;
  const rawQualityScore = asset.qualityScore ?? asset.quality?.score;
  const qualityScore =
    rawQualityScore !== "" && rawQualityScore !== null && rawQualityScore !== undefined && Number.isFinite(Number(rawQualityScore))
      ? Number(rawQualityScore)
      : null;
  const lineageNodes = previewRelatedAssets.map((fqn) => ({
    fqn,
    label: String(fqn).split(".").pop(),
  }));
  const displayLineageCount =
    numberOrNull(asset.lineageCount ?? asset.lineage_count ?? asset.relatedAssetCount) ??
    previewRelatedAssets.length;
  const metrics = previewMetricItems({
    asset,
    primaryOwner,
    stewardOwner,
    coverage,
    qualityScore,
    totalColumnCount: totalColumnCountReal,
    sourceAuthoritative,
  });
  const tabDefinitions = [
    { key: "overview", label: "Overview" },
    {
      key: "columns",
      label: totalColumnCountReal !== null
        ? `Columns · ${totalColumnCountReal.toLocaleString()}`
        : "Columns",
    },
    {
      key: "lineage",
      label: displayLineageCount
        ? `Lineage · ${displayLineageCount.toLocaleString()}`
        : "Lineage",
    },
    { key: "quality", label: "Quality" },
    { key: "access", label: "Access" },
  ];
  const metadataSummary = (
    <dl className="gh-asset-preview-metadata">
      <div className="gh-asset-preview-metadata-row">
        <dt>Domain</dt>
        <dd>{asset.domain && asset.domain !== "Unassigned" ? asset.domain : <span className="gh-asset-preview-metadata-empty">Unassigned</span>}</dd>
      </div>
      <div className="gh-asset-preview-metadata-row">
        <dt>Owner</dt>
        <dd className="gh-truncate" title={owners.join(", ") || "No owner assigned in Unity Catalog"}>
          {primaryOwner ? (
            ownerCount === 1
              ? prettyOwnerName(primaryOwner)
              : `${ownerCount} owners`
          ) : (
            <span className="gh-asset-preview-metadata-empty">Unassigned</span>
          )}
        </dd>
      </div>
      <div className="gh-asset-preview-metadata-row">
        <dt>Steward</dt>
        <dd>{stewardOwner ? prettyOwnerName(stewardOwner) : <span className="gh-asset-preview-metadata-empty">Unassigned</span>}</dd>
      </div>
      <div className="gh-asset-preview-metadata-row">
        <dt>Certified</dt>
        <dd>{cert || <span className="gh-asset-preview-metadata-empty">Unavailable</span>}</dd>
      </div>
      <div className="gh-asset-preview-metadata-row">
        <dt>Criticality</dt>
        <dd>{criticality || <span className="gh-asset-preview-metadata-empty">Unavailable</span>}</dd>
      </div>
      <div className="gh-asset-preview-metadata-row">
        <dt>Sensitivity</dt>
        <dd>{sensitivity || <span className="gh-asset-preview-metadata-empty">Unavailable</span>}</dd>
      </div>
    </dl>
  );
  const linkedLineagePreview = lineageAvailable && lineage.loading ? (
    <div className="gh-support-copy">
      {sourceAuthoritative ? "Refreshing live lineage context..." : "Refreshing prototype lineage context..."}
    </div>
  ) : lineageAvailable && lineageNodes.length ? (
    <div className="gh-lineage-mini-preview">
      {lineageNodes.slice(0, 3).map((node) => {
        const availability =
          linkedRecordUnavailableOverrides[node.fqn] === true
            ? false
            : relatedAssetAvailability[node.fqn];
        const status =
          availability === false
            ? "Metadata record unavailable"
            : availability === true
              ? "Open Record"
              : "Checking access...";
        const body = (
          <>
            <span className="gh-lineage-node-label gh-truncate" title={node.fqn}>{node.label}</span>
            <span className="gh-lineage-node-fqn gh-truncate" title={node.fqn}>{node.fqn}</span>
            <span className="gh-lineage-node-status">{status}</span>
          </>
        );
        return availability === false ? (
          <div
            className="gh-lineage-mini-node gh-lineage-linked-row is-readonly"
            key={node.fqn}
          >
            {body}
          </div>
        ) : (
          <button
            aria-label={`${node.fqn} ${status}`}
            className="gh-lineage-mini-node gh-lineage-linked-row is-asset-link"
            key={node.fqn}
            onClick={() => onOpenLinkedAsset?.(node.fqn)}
            type="button"
          >
            {body}
          </button>
        );
      })}
      <span aria-hidden="true" className="gh-lineage-mini-arrow">→</span>
      <div className="gh-lineage-mini-node is-current">
        <span className="gh-lineage-node-label gh-truncate" title={asset.fqn}>{asset.name}</span>
        <span className="gh-lineage-node-fqn gh-truncate" title={asset.fqn}>{asset.fqn}</span>
      </div>
    </div>
  ) : (
    <div className="gh-support-copy">
      {lineageAvailable
        ? sourceAuthoritative
          ? "No live upstream lineage edges are surfaced for this asset yet."
          : "Live upstream lineage is not verified in this prototype capture."
        : lineageUnavailableReason || "Lineage preview not available for this asset."}
    </div>
  );
  const buildabilityNote = recordUnavailable
    ? "Asset 360 is unavailable with current permissions, so workflow mutations remain disabled."
    : previewColumns.length || shortDescription || terms.length || governanceTags.length
      ? sourceAuthoritative
        ? "This preview is assembled from live Discover and Asset 360 fields. Unsupported workflow mutations remain unavailable here."
        : "Prototype buildability mirrors system.information_schema.tables, information_schema.table_tags, UC grants, Lakeflow freshness, and governance_state.asset_trust. This is not live Databricks proof; unsupported workflow mutations remain unavailable here."
      : "The record is openable, but descriptive, schema, and governance metadata are sparse.";

  return (
    <aside
      aria-label="Asset preview"
      className="gh-selection-preview gh-discovery-preview-card"
      data-asset-fqn={asset.fqn}
    >
      <div className="gh-asset-preview">
        <header className="gh-discovery-preview-header">
          <div className="gh-discovery-preview-title-row">
            <AssetTypeIcon asset={asset} size="xl" />
            <div>
              <div className="gh-discovery-preview-title-line">
                <h2 className="gh-truncate" title={asset.name}>{asset.name}</h2>
                <div className="gh-discovery-preview-title-badges">
                  {cert ? <span className="gh-discovery-status-pill certified">{cert}</span> : null}
                  {sensitivity ? (
                    <span className={`gh-discovery-sensitivity-pill ${sensitivityToneClass(sensitivity)}`.trim()}>{sensitivity}</span>
                  ) : null}
                  {cdeSignal ? <span className="gh-discovery-linkage gh-discovery-cde-pill">CDE</span> : null}
                </div>
              </div>
              <p>{displayObjectType(asset) || "Asset"} · {assetSourceLabel(asset)}</p>
            </div>
          </div>
          {onClearSelection ? (
            <button
              aria-label="Close preview"
              className="gh-discovery-preview-close"
              onClick={() => onClearSelection()}
              title="Close"
              type="button"
            >
              ×
            </button>
          ) : null}
        </header>

        {sourceAuthoritative ? (
          <div className="gh-discovery-preview-actions gh-discovery-preview-utility-actions">
            <button
              aria-label={recordUnavailable ? "Metadata record unavailable" : "Open Record"}
              className={`gh-primary-button ${navigating ? "is-loading" : ""}`.trim()}
              disabled={recordUnavailable || navigating}
              onClick={() => {
                setNavigating(true);
                onOpenAsset(asset.fqn, "Overview");
              }}
              title={recordUnavailable ? recordUnavailableReason : "Open Asset 360"}
              type="button"
            >
              {navigating ? "Opening..." : "Open Asset 360"}
            </button>
            <button
              aria-label={lineageAvailable ? "Open Lineage" : "Lineage unavailable"}
              className="gh-secondary-button"
              disabled={!lineageAvailable || !asset?.fqn}
              onClick={() => onOpenLineage?.(asset.fqn, "Data Lineage")}
              title={!lineageAvailable ? lineageUnavailableReason : "View live lineage"}
              type="button"
            >
              {lineageAvailable ? "Open Lineage" : "Lineage unavailable"}
            </button>
            <button
              aria-label="Open Governance"
              className="gh-secondary-button"
              disabled={recordUnavailable}
              onClick={() => onOpenGovernance(asset.fqn)}
              title={recordUnavailable ? recordUnavailableReason : "Open governance workspace"}
              type="button"
            >
              Governance
            </button>
          </div>
        ) : null}

        {detailError ? <InlineStatusBanner message={detailError} title="Preview degraded" /> : null}
        {detailLoading ? (
          <div className="gh-selection-preview-inline-notice" role="status">
            <span className="gh-selection-preview-inline-notice-label">Refreshing preview</span>
            <span className="gh-selection-preview-inline-notice-body">Loading available metadata from the asset record.</span>
          </div>
        ) : null}
        {!previewAvailable && previewUnavailableReason ? (
          <div className="gh-selection-preview-inline-notice" role="status">
            <span className="gh-selection-preview-inline-notice-label">Live rows unavailable</span>
            <span className="gh-selection-preview-inline-notice-body">{previewUnavailableReason}</span>
          </div>
        ) : null}
        {recordUnavailable ? (
          <div className="gh-support-copy gh-selection-preview-record-state">
            {recordUnavailableReason}
          </div>
        ) : null}

        {sourceAuthoritative ? (
          <div className="gh-discovery-preview-badges">
            {cert ? <span className="gh-discovery-status-pill certified">{cert}</span> : null}
            {coverage !== null ? (
              <span className="gh-discovery-coverage-chip">
                {`${coverage}% Metadata Coverage`}
                <i aria-hidden="true"><b style={{ width: `${coverage}%` }} /></i>
              </span>
            ) : (
              <span className="gh-discovery-muted-pill">Metadata coverage unavailable</span>
            )}
            {sensitivity ? (
              <span className={`gh-discovery-sensitivity-pill ${sensitivityToneClass(sensitivity)}`.trim()}>{sensitivity}</span>
            ) : null}
          </div>
        ) : null}

        <div className="gh-discovery-preview-tabs" role="tablist" aria-label="Asset preview sections">
          {tabDefinitions.map((tab) => (
            <button
              aria-controls={`gh-discovery-preview-panel-${tab.key}`}
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "is-active" : ""}
              id={`gh-discovery-preview-tab-${tab.key}`}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="gh-discovery-preview-body">
          {actionNotice ? (
            <div className="gh-selection-preview-inline-notice gh-selection-preview-action-notice" role="status">
              <span className="gh-selection-preview-inline-notice-label">Action unavailable</span>
              <span className="gh-selection-preview-inline-notice-body">{actionNotice}</span>
            </div>
          ) : null}

          {activeTab === "overview" ? (
            <div
              aria-labelledby="gh-discovery-preview-tab-overview"
              id="gh-discovery-preview-panel-overview"
              role="tabpanel"
            >
              <div className="gh-asset-preview-description">
                {shortDescription || targetDescriptionLine}
              </div>

              <section className="gh-asset-preview-section">
                <div className="gh-panel-title">Metadata</div>
                <div className="gh-discovery-preview-metric-grid">
                  {metrics.map((metric) => (
                    <div
                      className={`gh-discovery-preview-metric ${metric.unavailable ? "is-unavailable" : ""}`.trim()}
                      key={metric.label}
                    >
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="gh-asset-preview-section">
                <div className="gh-panel-title">{sourceAuthoritative ? "Connected Assets" : "Prototype connected assets"}</div>
                {linkedLineagePreview}
              </section>

              <section className="gh-asset-preview-section">
                <div className="gh-panel-title-row">
                  <span className="gh-panel-title">Tags & Glossary</span>
                  {terms.length ? <span className="gh-asset-preview-section-count">{terms.length} terms</span> : null}
                </div>
                {governanceTags.length || terms.length ? (
                  <div className="gh-discovery-glossary-list">
                    {governanceTags.slice(0, 5).map((tag) => (
                      <span className="gh-labeled-pill gh-labeled-pill-tag" key={`tag-${tag}`}>{tag}</span>
                    ))}
                    {terms.slice(0, 5).map((term) => (
                      <span className="gh-labeled-pill gh-labeled-pill-glossary" key={`term-${term}`}>{term}</span>
                    ))}
                    {governanceTags.length + terms.length > 10 ? (
                      <span className="gh-chip gh-chip-soft">+{governanceTags.length + terms.length - 10} more</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="gh-support-copy">No tags or glossary terms are linked to this asset yet.</div>
                )}
              </section>

              <section className="gh-asset-preview-section gh-discovery-preview-buildability">
                <div className="gh-panel-title">Buildability Note</div>
                {sourceAuthoritative || recordUnavailable ? (
                  <p>{buildabilityNote}</p>
                ) : (
                  <>
                    <p className="gh-discovery-buildability-subtitle">How this view is composed</p>
                    <div className="gh-discovery-buildability-box">
                      Metadata sourced from <code>system.information_schema.tables</code>: description and tags from <code>information_schema.table_tags</code>; ownership from UC grants; freshness from a Lakeflow Job that records last-write timestamp; trust score is computed nightly into <code>governance_state.asset_trust</code>. This is not live Databricks proof.
                    </div>
                  </>
                )}
              </section>
            </div>
          ) : null}

          {activeTab === "columns" ? (
            <section
              aria-labelledby="gh-discovery-preview-tab-columns"
              className="gh-asset-preview-section"
              id="gh-discovery-preview-panel-columns"
              role="tabpanel"
            >
              <div className="gh-panel-title-row">
                <span className="gh-panel-title">{hasKeyEvidence ? "Key Columns" : "Columns"}</span>
                {totalColumnCountReal !== null ? (
                  <span className="gh-asset-preview-section-count">
                    {`${totalColumnCountReal.toLocaleString()} column${totalColumnCountReal === 1 ? "" : "s"}`}
                  </span>
                ) : null}
              </div>
              {previewColumns.length ? (
                <ul className="gh-asset-preview-columns">
                  {previewColumns.map((col) => (
                    <li className="gh-asset-preview-column" key={col.name}>
                      <span className="gh-asset-preview-column-name gh-truncate" title={col.name}>
                        {col.name}
                      </span>
                      {col.type ? (
                        <span className="gh-asset-preview-column-type" title={col.type}>
                          {col.type}
                        </span>
                      ) : null}
                    </li>
                  ))}
                  {extraColumnCount > 0 ? (
                    <li className="gh-asset-preview-column is-more">
                      <button
                        className="gh-tertiary-button"
                        disabled={recordUnavailable || navigating}
                        onClick={() => {
                          setNavigating(true);
                          onOpenAsset(asset.fqn, "Schema");
                        }}
                        type="button"
                      >
                        {`+${extraColumnCount.toLocaleString()} more - open Schema`}
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <div className="gh-asset-preview-schema-empty">
                  Columns are unavailable from the current live metadata response.
                </div>
              )}
            </section>
          ) : null}

          {activeTab === "lineage" ? (
            <section
              aria-labelledby="gh-discovery-preview-tab-lineage"
              className="gh-asset-preview-section"
              id="gh-discovery-preview-panel-lineage"
              role="tabpanel"
            >
              <div className="gh-panel-title">Lineage Preview</div>
              {linkedLineagePreview}
            </section>
          ) : null}

          {activeTab === "quality" ? (
            <section
              aria-labelledby="gh-discovery-preview-tab-quality"
              className="gh-asset-preview-section"
              id="gh-discovery-preview-panel-quality"
              role="tabpanel"
            >
              <div className="gh-panel-title">Quality</div>
              {qualityScore !== null ? (
                <div className="gh-discovery-quality-preview">
                  <strong>{Math.round(qualityScore)} / 100</strong>
                  <span>Quality score from the asset metadata response.</span>
                </div>
              ) : (
                <div className="gh-support-copy">Quality score is unavailable for this asset in the current live metadata response.</div>
              )}
              {Array.isArray(asset.failedTests) && asset.failedTests.length ? (
                <ul className="gh-discovery-quality-list">
                  {asset.failedTests.slice(0, 4).map((test) => (
                    <li key={String(test?.id || test?.name || test)}>
                      {String(test?.name || test?.label || test)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {activeTab === "access" ? (
            <section
              aria-labelledby="gh-discovery-preview-tab-access"
              className="gh-asset-preview-section"
              id="gh-discovery-preview-panel-access"
              role="tabpanel"
            >
              <div className="gh-panel-title">Access & Stewardship</div>
              {metadataSummary}
              <div className="gh-discovery-preview-access-note">
                {recordUnavailable
                  ? recordUnavailableReason
                  : "Governed access and certification decisions open in the backed governance workspace."}
              </div>
            </section>
          ) : null}
        </div>

        <div className="gh-support-copy gh-discovery-preview-workflow-note">
          Comment and access-request creation are disabled here until a backed governance workflow is configured.
        </div>
        <footer className="gh-discovery-preview-footer" aria-label="Preview workflow actions">
          <button
            className="gh-secondary-button"
            disabled
            title="Comment threads require a backed workflow before they can be created from Discover."
            type="button"
          >
            Comment
          </button>
          <button
            className="gh-secondary-button"
            disabled
            title="Access requests require a backed workflow before they can be created from Discover."
            type="button"
          >
            Request access
          </button>
          <button
            className="gh-primary-button"
            disabled={recordUnavailable}
            onClick={() => onOpenGovernance(asset.fqn)}
            title={
              recordUnavailable
                ? recordUnavailableReason
                : sourceAuthoritative
                  ? "Open governance workspace"
                  : "Open governance certification review context; this does not certify metadata in prototype mode."
            }
            type="button"
          >
            {sourceAuthoritative ? "Certify" : "Review cert"}
          </button>
        </footer>
      </div>
    </aside>
  );
}

function SelectionPreviewTabs({
  asset,
  columns,
  signalItems,
  detailLoading,
  lineageAvailable,
  lineageUnavailableReason,
  lineageLoading,
  lineageProvisional,
  previewRelatedAssets,
  relatedAssetAvailability,
  linkedRecordUnavailableOverrides,
  onOpenLinkedAsset,
}) {
  const [active, setActive] = useState("overview");
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "schema", label: `Schema${asset?.columns?.length ? ` · ${asset.columns.length}` : ""}` },
    { key: "lineage", label: "Lineage" },
    { key: "usage", label: "Usage" },
  ];
  return (
    <div className="gh-selection-preview-tabs">
      <nav className="gh-selection-preview-tabrow" role="tablist" aria-label="Selected asset tabs">
        {tabs.map((tab) => (
          <button
            aria-pressed={active === tab.key}
            className={`gh-selection-preview-tab ${active === tab.key ? "is-active" : ""}`}
            key={tab.key}
            onClick={() => setActive(tab.key)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {active === "overview" ? (
        <>
          <PreviewSection title="Definition">
            <div className="gh-support-copy">
              {asset.description || "No description is available for this asset yet."}
            </div>
          </PreviewSection>
          <PreviewSection title="Signals">
            <PreviewProfileList items={signalItems} />
          </PreviewSection>
          {/* Peek at connected assets on the Overview tab so stewards
              don't need to switch tabs just to see the linked-asset
              list for a quick nav check. Full list lives on Lineage. */}
          {previewRelatedAssets.length ? (
            <PreviewSection title="Connected Assets">
              <div className="gh-lineage-linked-list">
                {previewRelatedAssets.map((item) => {
                  const linkedRecordAvailability =
                    linkedRecordUnavailableOverrides[item] === true ? false : relatedAssetAvailability[item];
                  return linkedRecordAvailability === false ? (
                    <div className="gh-lineage-linked-row is-readonly" key={item}>
                      <span>{item}</span>
                      <span>Metadata record unavailable</span>
                    </div>
                  ) : (
                    <button
                      className="gh-lineage-linked-row is-asset-link"
                      key={item}
                      onClick={() => onOpenLinkedAsset(item)}
                      type="button"
                    >
                      <span>{item}</span>
                      <span>{linkedRecordAvailability === true ? "Open Record" : "Checking access..."}</span>
                    </button>
                  );
                })}
              </div>
            </PreviewSection>
          ) : null}
        </>
      ) : null}

      {active === "schema" ? (
        <PreviewSection
          title="Schema"
          empty={
            detailLoading
              ? "Loading live schema metadata..."
              : "No schema metadata is available for this asset yet."
          }
        >
          {columns.length ? (
            <div className="gh-preview-column-list">
              {columns.map((column) => (
                <div className="gh-preview-column-row" key={column.name}>
                  <div>
                    <strong>{column.name}</strong>
                    <span>{column.type}</span>
                  </div>
                  <p>{column.description}</p>
                </div>
              ))}
              {asset.columns?.length > columns.length ? (
                <div className="gh-support-copy gh-preview-column-overflow">
                  +{asset.columns.length - columns.length} more columns — open the record for the full schema.
                </div>
              ) : null}
            </div>
          ) : null}
        </PreviewSection>
      ) : null}

      {active === "lineage" ? (
        <PreviewSection
          title="Connected Assets"
          empty={
            !lineageAvailable
              ? lineageUnavailableReason
              : lineageLoading || lineageProvisional
                ? "Refreshing live lineage context..."
                : "No connected lineage edges are surfaced for this asset yet."
          }
        >
          {previewRelatedAssets.length ? (
            <div className="gh-lineage-linked-list">
              {previewRelatedAssets.map((item) => {
                const linkedRecordAvailability =
                  linkedRecordUnavailableOverrides[item] === true ? false : relatedAssetAvailability[item];
                return linkedRecordAvailability === false ? (
                  <div className="gh-lineage-linked-row is-readonly" key={item}>
                    <span>{item}</span>
                    <span>Metadata record unavailable</span>
                  </div>
                ) : (
                  <button
                    className="gh-lineage-linked-row is-asset-link"
                    key={item}
                    onClick={() => onOpenLinkedAsset(item)}
                    type="button"
                  >
                    <span>{item}</span>
                    <span>{linkedRecordAvailability === true ? "Open Record" : "Checking access..."}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </PreviewSection>
      ) : null}

      {active === "usage" ? (
        <PreviewSection
          title="Usage"
          empty="Usage signals (recent queries, top consumers, workload impact) are available on the full asset record."
        />
      ) : null}

    </div>
  );
}

/**
 * Compact diagnostics strip rendered alongside Discovery empty states.
 *
 * Audit A1.4 asked for a single-line, muted row that surfaces — at a
 * glance — what the runtime actually sees when Discovery returns no
 * rows: runtime state, auth mode, inventory source, visible-asset
 * count, and when the envelope was observed. It is only rendered on
 * empty-state paths so the regular catalog grid remains uncluttered.
 */
function labelForAuthMode(authMode) {
  const raw = String(authMode || "").trim().toLowerCase();
  if (raw === "obo-available") return "OBO";
  if (raw === "app-principal-only") return "app-principal";
  if (raw === "no-identity") return "no-identity";
  return raw || "unknown";
}

function labelForInventorySource(source, authMode) {
  const normalizedSource = String(source || "").trim();
  const normalizedMode = String(authMode || "").trim().toLowerCase();
  if (normalizedMode === "obo-available") {
    return "Unity Catalog (actor-scoped)";
  }
  if (normalizedMode === "app-principal-only") {
    return "Unity Catalog (app-principal)";
  }
  if (normalizedSource) return normalizedSource;
  return "Unity Catalog";
}

function labelForRuntimeState(state) {
  const raw = String(state || "").trim().toLowerCase();
  if (raw === "live") return "live";
  if (raw === "degraded") return "degraded";
  if (raw === "unavailable" || raw === "error") return "unavailable";
  if (raw === "loading" || raw === "warming") return "loading";
  return raw || "unknown";
}

export function DiscoveryDiagnosticsStrip({
  runtimeState = "",
  authMode = "",
  visibilityScope = "",
  visibleAssets = null,
  observedAt = "",
  inventorySource = "",
  discoveryState = "",
}) {
  const runtimeLabel = labelForRuntimeState(runtimeState);
  const authLabel = labelForAuthMode(authMode);
  const sourceLabel = labelForInventorySource(
    inventorySource || visibilityScope,
    authMode,
  );
  const visibleCountLabel =
    visibleAssets === null || visibleAssets === undefined || Number.isNaN(Number(visibleAssets))
      ? "—"
      : Number(visibleAssets).toLocaleString();
  const observedLabel = observedAt ? String(observedAt) : "—";
  return (
    <div
      aria-label="Discovery diagnostics"
      className="gh-discovery-diagnostics-strip"
      data-testid="gh-discovery-diagnostics-strip"
      role="status"
    >
      <span className="gh-discovery-diagnostics-item">
        <span className="gh-discovery-diagnostics-label">Runtime</span>
        <span
          className="gh-discovery-diagnostics-value"
          data-testid="gh-discovery-diagnostics-runtime"
        >
          {runtimeLabel}
        </span>
      </span>
      <span aria-hidden="true" className="gh-discovery-diagnostics-sep">·</span>
      <span className="gh-discovery-diagnostics-item">
        <span className="gh-discovery-diagnostics-label">Auth mode</span>
        <span
          className="gh-discovery-diagnostics-value"
          data-testid="gh-discovery-diagnostics-auth"
        >
          {authLabel}
        </span>
      </span>
      <span aria-hidden="true" className="gh-discovery-diagnostics-sep">·</span>
      <span className="gh-discovery-diagnostics-item">
        <span className="gh-discovery-diagnostics-label">Inventory source</span>
        <span
          className="gh-discovery-diagnostics-value"
          data-testid="gh-discovery-diagnostics-source"
        >
          {sourceLabel}
        </span>
      </span>
      <span aria-hidden="true" className="gh-discovery-diagnostics-sep">·</span>
      <span className="gh-discovery-diagnostics-item">
        <span className="gh-discovery-diagnostics-label">Visible assets</span>
        <span
          className="gh-discovery-diagnostics-value"
          data-testid="gh-discovery-diagnostics-visible"
        >
          {visibleCountLabel}
        </span>
      </span>
      <span aria-hidden="true" className="gh-discovery-diagnostics-sep">·</span>
      <span className="gh-discovery-diagnostics-item">
        <span className="gh-discovery-diagnostics-label">Last observed</span>
        <span
          className="gh-discovery-diagnostics-value"
          data-testid="gh-discovery-diagnostics-observed"
        >
          {observedLabel}
        </span>
      </span>
      {discoveryState ? (
        <>
          <span aria-hidden="true" className="gh-discovery-diagnostics-sep">·</span>
          <span className="gh-discovery-diagnostics-item">
            <span className="gh-discovery-diagnostics-label">State</span>
            <span
              className="gh-discovery-diagnostics-value"
              data-testid="gh-discovery-diagnostics-state"
            >
              {discoveryState}
            </span>
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * Round 19 defect #2: permanent user-visible surfacing of OBO scope
 * fallback. When the request's UC client silently degrades to the
 * app-principal (user's token missing the `sql` scope), the inventory
 * reflects the SP's narrower visibility — the user needs to KNOW they're
 * seeing a subset AND have a one-click path to retry.
 */
export function DiscoveryOboFallbackBanner({ reason, onRetry, retrying = false }) {
  return (
    <div
      aria-live="polite"
      className="gh-discovery-obo-fallback-banner"
      data-testid="gh-discovery-obo-fallback-banner"
      role="status"
    >
      <div className="gh-discovery-obo-fallback-copy">
        <strong>Showing app-principal view.</strong>{" "}
        {reason ||
          "The forwarded user token is missing the `sql` scope; Discovery is showing the app-principal view of the catalog."}
      </div>
      <button
        className="gh-tertiary-button gh-inline-link-button"
        data-testid="gh-discovery-obo-fallback-retry"
        disabled={retrying}
        onClick={() => onRetry?.()}
        type="button"
      >
        {retrying ? "Retrying…" : "Retry with actor scope"}
      </button>
    </div>
  );
}

export default function DiscoveryWorkspace({
  bootstrap,
  effectiveBootMessage = "",
  effectiveBootState = "live",
  effectiveVisibleCount = null,
  initialFilterGroups = {},
  initialQuery,
  initialSelectedAssetFqn = "",
  initialSort,
  initialViews = [],
  onNavigationStateChange,
  onSurfaceReady,
  onRouteFilterGroupsChange,
  querySeedKey,
  querySeedFresh,
  onLiveCatalogStateChange,
  onRoutePreviewChange,
  onRouteQueryChange,
  onRouteSortChange,
  onRouteViewsChange,
  onOpenAsset,
  onOpenGovernance,
  onOpenLineage,
  sharedVisibleAssetSet,
  runtimeFeatureFlags = [],
  workspaceAccess = null,
  atlasAiAvailable = true,
  atlasAiUnavailableReason = "Atlas AI is unavailable until the shell reports a configured Genie endpoint.",
}) {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [atlasAiState, setAtlasAiState] = useState({
    loading: false,
    response: null,
    error: "",
    cacheKey: "",
  });
  const atlasAiAutoRunKeyRef = useRef("");
  const atlasAiAbortRef = useRef(null);
  const atlasAiCacheKeyRef = useRef("");
  const atlasAiRequestSeqRef = useRef(0);
  const hoverPreviewTimerRef = useRef(null);
  const handleHoverPreview = (fqn) => {
    if (!fqn) return;
    if (hoverPreviewTimerRef.current) clearTimeout(hoverPreviewTimerRef.current);
    hoverPreviewTimerRef.current = setTimeout(() => {
      setPreviewDismissed(false);
      setSelectedAssetFqn((current) => (current === fqn ? current : fqn));
    }, 300);
  };
  const handleHoverEnd = () => {
    if (hoverPreviewTimerRef.current) {
      clearTimeout(hoverPreviewTimerRef.current);
      hoverPreviewTimerRef.current = null;
    }
  };
  useEffect(() => () => {
    if (hoverPreviewTimerRef.current) clearTimeout(hoverPreviewTimerRef.current);
  }, []);
  useEffect(() => () => {
    atlasAiAbortRef.current?.abort?.();
  }, []);
  const [density, setDensityState] = useState(() => {
    if (typeof window === "undefined") return "normal";
    const stored = window.localStorage?.getItem?.("gh-discovery-density");
    return stored === "compact" || stored === "spacious" ? stored : "normal";
  });
  const setDensity = (next) => {
    setDensityState(next);
    try {
      window.localStorage?.setItem?.("gh-discovery-density", next);
    } catch {
      /* localStorage may be unavailable in sandboxed contexts */
    }
  };
  const [selectedAssetFqn, setSelectedAssetFqn] = useState("");
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [previewExplicitOpen, setPreviewExplicitOpen] = useState(false);
  const [visibleResultCount, setVisibleResultCount] = useState(DISCOVERY_RESULT_PAGE_SIZE);
  const [navigationNotice, setNavigationNotice] = useState("");
  const [favorites, setFavorites] = useState(() => readFavoriteSet());
  const [recentlyViewed, setRecentlyViewed] = useState(() => readRecentlyViewed());
  const [bulkSelection, setBulkSelection] = useState(() => new Set());
  // sortKey="" means "preserve backend ordering" (best-match); user
  // explicitly opts into a column sort by clicking the header.
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");
  // Hierarchical service-tree state: which catalogs are expanded and
  // which (catalog, schema) leaf is currently selected for client-side
  // filtering. Selecting the same leaf again clears the pick.
  const [expandedCatalogs, setExpandedCatalogs] = useState(() => new Set());
  // Multi-select set of `catalog.schema` keys. Previously this was a single
  // `{catalog, schema}` pick which meant stewards could only scope to one
  // schema at a time — a stark usability regression versus real governance
  // tooling. Using a Set keeps the URL cheap and the set semantics obvious.
  const [selectedSchemas, setSelectedSchemas] = useState(() => new Set());
  const [ownerFilterText, setOwnerFilterText] = useState("");
  const [glossaryFilterText, setGlossaryFilterText] = useState("");
  const [showSavedSearches, setShowSavedSearches] = useState(false);
  // The North Star Discovery surface has no Discovery/Navigation sub-tab. Keep
  // a default data marker for compatibility with older tests/CSS without
  // mutating the route with the retired ?view= contract.
  const [discoverySubTab, setDiscoverySubTab] = useState("discovery");
  const legacyNavigationEnabled = Boolean(bootstrap?.features?.legacyDiscoveryNavigation);
  const [openCardMenuFqn, setOpenCardMenuFqn] = useState("");
  const toggleCatalogExpanded = (catalog) => {
    setExpandedCatalogs((current) => {
      const next = new Set(current);
      if (next.has(catalog)) next.delete(catalog); else next.add(catalog);
      return next;
    });
  };
  const schemaKey = (catalog, schema) => `${catalog || "unknown"}.${schema || "unknown"}`;
  const toggleSchema = (catalog, schema) => {
    setSelectedSchemas((current) => {
      const next = new Set(current);
      const key = schemaKey(catalog, schema);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const isSchemaSelected = (catalog, schema) => selectedSchemas.has(schemaKey(catalog, schema));
  const hasSchemaSelection = selectedSchemas.size > 0;
  // Back-compat shim: code below still references `selectedSchema` (the
  // single-value shape) for the schema-filter notice and preview scoping.
  // Preserve the first-entry shape so callers don't need to rewrite, while
  // the user can still select additional schemas via toggleSchema.
  const selectedSchema = useMemo(() => {
    if (!selectedSchemas.size) return null;
    const [first] = selectedSchemas;
    const [catalog, schema] = String(first).split(".");
    return { catalog, schema };
  }, [selectedSchemas]);
  const toggleFavorite = (fqn) => {
    setFavorites((current) => {
      const next = new Set(current);
      const removing = next.has(fqn);
      if (removing) next.delete(fqn); else next.add(fqn);
      writeFavoriteSet(next);
      const assetName =
        allDiscoveryAssets.find((asset) => asset.fqn === fqn)?.name ||
        String(fqn || "asset").split(".").pop() ||
        "asset";
      setNavigationNotice(
        removing
          ? `Removed ${assetName} from local browser favorites.`
          : `Saved ${assetName} as a local browser favorite.`,
      );
      return next;
    });
  };
  const toggleBulkSelect = (fqn) => {
    setBulkSelection((current) => {
      const next = new Set(current);
      if (next.has(fqn)) next.delete(fqn); else next.add(fqn);
      return next;
    });
  };
  const clearBulkSelection = () => setBulkSelection(new Set());
  const handleSort = (key) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return currentKey;
      }
      setSortDirection("asc");
      return key;
    });
  };
  const [linkedRecordUnavailableOverrides, setLinkedRecordUnavailableOverrides] = useState({});
  const [recordAvailabilityTargets, setRecordAvailabilityTargets] = useState([]);
  const filterCommandRef = useRef(null);
  const routePreviewAssetFqn = String(initialSelectedAssetFqn || "");
  const requestedResultLimit = Math.min(
    Math.max(
      routePreviewAssetFqn ? DISCOVERY_MAX_FETCH_LIMIT : visibleResultCount,
      80,
    ),
    DISCOVERY_MAX_FETCH_LIMIT,
  );
  const { filters, setFilters, results: discoveryResults } = useDiscoveryWorkspace({
    bootstrap,
    initialFilterGroups,
    initialQuery,
    initialSort,
    initialViews,
    requestedResultLimit,
    onRouteFilterGroupsChange,
    onRouteQueryChange,
    onRouteSortChange,
    onRouteViewsChange,
    querySeedKey,
    querySeedFresh,
  });
  const recordUnavailableScopeKey = `${discoveryResults.requestKey || "default"}:${querySeedFresh ? "fresh" : "stable"}`;
  const [recordUnavailableOverrideState, setRecordUnavailableOverrideState] = useState({
    overrides: {},
    scopeKey: recordUnavailableScopeKey,
  });
  const recordUnavailableOverrides =
    recordUnavailableOverrideState.scopeKey === recordUnavailableScopeKey
      ? recordUnavailableOverrideState.overrides
      : {};
  const setRecordUnavailableOverrides = useCallback(
    (nextValue) => {
      setRecordUnavailableOverrideState((current) => {
        const currentOverrides =
          current.scopeKey === recordUnavailableScopeKey ? current.overrides : {};
        const nextOverrides =
          typeof nextValue === "function" ? nextValue(currentOverrides) : nextValue;
        return {
          overrides: nextOverrides || {},
          scopeKey: recordUnavailableScopeKey,
        };
      });
    },
    [recordUnavailableScopeKey],
  );

  const suppressCatalogRows =
    effectiveBootState !== "live" &&
    !discoveryResults.authoritative &&
    !(discoveryResults.assets || []).length;
  const allDiscoveryAssets = useMemo(
    () => (suppressCatalogRows || !Array.isArray(discoveryResults.assets) ? [] : discoveryResults.assets),
    [discoveryResults.assets, suppressCatalogRows],
  );
  // Asset type counts: prefer backend facet counts (which aggregate over the
  // FULL match set, matching Domain/Sensitivity/Workflow) over client-side
  // counts of the visible page. Falls back to per-page counts only when
  // facets haven't been returned yet.
  const liveAssetTypeCounts = useMemo(() => {
    const facetTypeEntries = Array.isArray(discoveryResults.facets?.assetTypes)
      ? discoveryResults.facets.assetTypes
      : [];
    const facetMap = {};
    for (const entry of facetTypeEntries) {
      if (entry && entry.value != null) facetMap[entry.value] = Number(entry.count || 0);
    }
    const totalFromFacets = facetTypeEntries.reduce(
      (sum, entry) => sum + Number(entry?.count || 0),
      0,
    );
    // Client-side per-visible-page tally (fallback + merge)
    const clientCounts = {};
    for (const entry of allDiscoveryAssets) {
      const t = String(entry?.assetType || entry?.objectType || entry?.type || "").trim();
      const resolved =
        t === "Delta Table" || t === "MANAGED_TABLE" || t === "Managed Table" ? "Delta Table"
        : t === "Materialized View" || t === "MATERIALIZED_VIEW" ? "Materialized View"
        : t === "View" || t === "VIEW" ? "View"
        : t === "Streaming Table" || t === "STREAMING_TABLE" ? "Streaming Table"
        : t === "Metric View" || t === "METRIC_VIEW" ? "Metric View"
        : t || "Unknown";
      clientCounts[resolved] = (clientCounts[resolved] || 0) + 1;
    }
    const counts = { ...clientCounts, ...facetMap };
    // "All types" should reflect the full result-set count, aligning with
    // "All domains" (which reads facet totals). Fall back to facet sum or
    // visible-page length if resultsCount isn't yet known.
    counts["All types"] =
      (Number.isFinite(Number(discoveryResults.count)) && Number(discoveryResults.count) > 0)
        ? Number(discoveryResults.count)
        : totalFromFacets || allDiscoveryAssets.length;
    return counts;
  }, [allDiscoveryAssets, discoveryResults.count, discoveryResults.facets]);

  // #11 Real saved-view counts computed client-side so the numbers
  // actually track state (previously they were either unreachable
  // via facets or hardcoded as 0 / 1197).
  const savedViewCounts = useMemo(() => {
    const counts = {
      "All assets": allDiscoveryAssets.length,
      "Needs attention": 0,
      "Needs owner": 0,
      "Needs certification": 0,
      "Certified": 0,
      "High coverage": 0,
    };
    for (const entry of allDiscoveryAssets) {
      const noOwner = !(entry?.owners?.length);
      const noCert = !entry?.certification || entry.certification === "Unassigned";
      const isCertified = !noCert;
      const score = Number(entry?.coverageScore || 0);
      if (noOwner) counts["Needs owner"] += 1;
      if (noCert) counts["Needs certification"] += 1;
      if (isCertified) counts["Certified"] += 1;
      if (score >= 80) counts["High coverage"] += 1;
      if (noOwner || noCert || score < 50) counts["Needs attention"] += 1;
    }
    return counts;
  }, [allDiscoveryAssets]);
  // Index by FQN for O(1) lookups from Activity Home panel.
  const assetsByFqnMap = useMemo(() => {
    const map = new Map();
    for (const entry of allDiscoveryAssets) {
      if (entry?.fqn) map.set(entry.fqn, entry);
    }
    return map;
  }, [allDiscoveryAssets]);
  // Build the catalog/schema tree. Schema-level counts are computed from
  // the visible inventory (there is no schema facet over the whole
  // catalog from the backend), but CATALOG totals prefer the backend
  // `facets.catalogs` count when available — the previous client-side
  // tally reported e.g. "prod (2)" because only the fetched batch was
  // counted, which read as catastrophically wrong.
  const catalogSchemaTree = useMemo(() => {
    const counts = new Map();
    for (const entry of allDiscoveryAssets) {
      const catalog = entry?.catalog || "unknown";
      const schema = entry?.schema || "unknown";
      if (!counts.has(catalog)) counts.set(catalog, new Map());
      const schemaMap = counts.get(catalog);
      schemaMap.set(schema, (schemaMap.get(schema) || 0) + 1);
    }
    const backendCatalogFacets = Array.isArray(discoveryResults.facets?.catalogs)
      ? discoveryResults.facets.catalogs
      : [];
    const backendCounts = new Map();
    for (const entry of backendCatalogFacets) {
      if (entry?.value != null) backendCounts.set(String(entry.value), Number(entry.count || 0));
    }
    // Ensure catalogs that only appear in backend facets (but no assets
    // yet in the visible batch) still show up in the tree.
    for (const [catalog] of backendCounts.entries()) {
      if (!counts.has(catalog)) counts.set(catalog, new Map());
    }
    return [...counts.entries()]
      .map(([catalog, schemaMap]) => {
        const clientTotal = [...schemaMap.values()].reduce((a, b) => a + b, 0);
        const backendTotal = backendCounts.get(catalog);
        return {
          catalog,
          count: typeof backendTotal === "number" && backendTotal > 0 ? backendTotal : clientTotal,
          schemas: [...schemaMap.entries()]
            .map(([schema, count]) => ({ schema, count }))
            .sort((a, b) => a.schema.localeCompare(b.schema)),
        };
      })
      .sort((a, b) => a.catalog.localeCompare(b.catalog));
  }, [allDiscoveryAssets, discoveryResults.facets]);
  // Apply the (catalog,schema) pick + owner/glossary free-text filters as
  // client-side scopes on the result list without round-tripping through
  // the discovery search contract.
  const renderableDiscoveryAssets = useMemo(() => {
    let list = allDiscoveryAssets;
    if (selectedSchemas.size) {
      list = list.filter((entry) => selectedSchemas.has(schemaKey(entry?.catalog, entry?.schema)));
    }
    const ownerNeedle = ownerFilterText.trim().toLowerCase();
    if (ownerNeedle === "__unassigned__") {
      list = list.filter((entry) => !(Array.isArray(entry?.owners) && entry.owners.length));
    } else if (ownerNeedle) {
      list = list.filter((entry) => {
        const owners = Array.isArray(entry?.owners) ? entry.owners : [];
        return owners.some((owner) => {
          const label = typeof owner === "string" ? owner : owner?.name || owner?.email || owner?.label || "";
          return String(label).toLowerCase().includes(ownerNeedle);
        });
      });
    }
    const glossaryNeedle = glossaryFilterText.trim().toLowerCase();
    if (glossaryNeedle) {
      list = list.filter((entry) => {
        const terms = Array.isArray(entry?.glossaryTerms) ? entry.glossaryTerms : [];
        if (terms.some((term) => {
          const label = typeof term === "string" ? term : term?.name || term?.label || "";
          return String(label).toLowerCase().includes(glossaryNeedle);
        })) {
          return true;
        }
        const tags = Array.isArray(entry?.tags) ? entry.tags : [];
        return tags.some((tag) => {
          const label = typeof tag === "string" ? tag : tag?.name || tag?.label || "";
          return String(label).toLowerCase().includes(glossaryNeedle);
        });
      });
    }
    return list;
  }, [allDiscoveryAssets, selectedSchemas, ownerFilterText, glossaryFilterText]);
  const explicitRoutePreviewIndex = useMemo(
    () =>
      routePreviewAssetFqn
        ? renderableDiscoveryAssets.findIndex((asset) => asset.fqn === routePreviewAssetFqn)
        : -1,
    [renderableDiscoveryAssets, routePreviewAssetFqn],
  );
  // Route-owned preview identity should never point at a card that the visible
  // discovery slice hides. This raises the local window only enough to keep the
  // explicitly selected card in view without inventing route-owned paging.
  const effectiveVisibleResultCount =
    explicitRoutePreviewIndex >= 0
      ? Math.max(visibleResultCount, explicitRoutePreviewIndex + 1)
      : visibleResultCount;
  const sortedDiscoveryAssets = useMemo(() => {
    // When no sort is active, preserve backend ordering so load-more
    // pagination stays predictable. Favorites float to the top only
    // when there's at least one favorite (keeps the default view stable).
    if (!sortKey && favorites.size === 0) {
      return renderableDiscoveryAssets;
    }
    const list = [...renderableDiscoveryAssets];
    const direction = sortDirection === "desc" ? -1 : 1;
    const accessor = {
      name: (a) => (a?.name || "").toLowerCase(),
      type: (a) => String(displayObjectType(a) || "").toLowerCase(),
      updated: (a) => new Date(a?.updatedAt || a?.lastModified || 0).getTime() || 0,
    }[sortKey];
    list.sort((a, b) => {
      // Keep favorites on top regardless of sort direction (OM does this too).
      const favA = favorites.has(a?.fqn) ? 1 : 0;
      const favB = favorites.has(b?.fqn) ? 1 : 0;
      if (favA !== favB) return favB - favA;
      if (!accessor) return 0;
      const va = accessor(a);
      const vb = accessor(b);
      if (va < vb) return -1 * direction;
      if (va > vb) return 1 * direction;
      return 0;
    });
    return list;
  }, [renderableDiscoveryAssets, sortKey, sortDirection, favorites]);
  const renderedDiscoveryAssets = useMemo(
    () => sortedDiscoveryAssets.slice(0, effectiveVisibleResultCount),
    [effectiveVisibleResultCount, sortedDiscoveryAssets],
  );
  const renderedDiscoveryAssetFqns = useMemo(
    () => renderedDiscoveryAssets.map((asset) => asset.fqn).filter(Boolean),
    [renderedDiscoveryAssets],
  );
  const renderedDiscoveryAssetKey = useMemo(
    () => renderedDiscoveryAssetFqns.join("|"),
    [renderedDiscoveryAssetFqns],
  );
  const invalidQuery =
    discoveryResults.queryState?.state === "invalid" ? discoveryResults.queryState : null;
  const selectedSeedAsset =
    invalidQuery || previewDismissed
      ? null
      : renderableDiscoveryAssets.find((asset) => asset.fqn === selectedAssetFqn) ||
        renderableDiscoveryAssets[0] ||
        null;
  const previewAvailable = systemInventoryAvailable(bootstrap);
  const previewUnavailableReason = systemInventoryReason(bootstrap);
  const workspaceAccessResolved = Boolean(
    workspaceAccess &&
      (
        workspaceAccess.mode ||
        workspaceAccess.observedAt ||
        Array.isArray(workspaceAccess.gates) ||
        typeof workspaceAccess.canUseAssetPreview === "boolean" ||
        typeof workspaceAccess.canUseLineage === "boolean"
      ),
  );
  const workspacePreviewAvailable = workspaceAccessAvailable(
    workspaceAccess,
    "canUseAssetPreview",
    true,
  );
  const previewSurfaceAvailable = previewAvailable && (!workspaceAccessResolved || workspacePreviewAvailable);
  const previewSurfaceUnavailableReason = workspaceAccessResolved && !workspacePreviewAvailable
    ? workspaceAccessReason(workspaceAccess, "asset_preview", previewUnavailableReason)
    : previewUnavailableReason || "Live preview rows and schema are not available in this workspace right now.";
  const previewDetail = useAssetDetail(selectedSeedAsset?.fqn || "", {
    sections: ["header"],
    enabled: Boolean(selectedSeedAsset?.fqn) && previewSurfaceAvailable,
  });
  const previewSchemaDetail = useAssetDetail(selectedSeedAsset?.fqn || "", {
    // Include the `operational` section too so the sidecar can render
    // REAL usage counts (producer / consumer / query counts from lineage)
    // and a REAL column schema preview, instead of placeholder zeros.
    sections: ["header", "schema", "operational"],
    enabled: Boolean(selectedSeedAsset?.fqn) && previewSurfaceAvailable,
  });
  const previewAsset = isUsableAssetDetail(previewSchemaDetail.detail)
    ? previewSchemaDetail.detail
    : isUsableAssetDetail(previewDetail.detail)
      ? previewDetail.detail
      : selectedSeedAsset;
  const visibleAssetSet = useMemo(() => {
    const next = new Set();
    if (sharedVisibleAssetSet?.forEach) {
      sharedVisibleAssetSet.forEach((assetFqn) => {
        if (assetFqn) next.add(assetFqn);
      });
    }
    return next;
  }, [sharedVisibleAssetSet]);
  const renderedRecordAvailability = useAssetAvailability(
    recordAvailabilityTargets,
    visibleAssetSet,
    {
      strict: true,
      requireRenderableDetail: true,
    },
  );
  const lineageAvailable = tableLineageAvailable(bootstrap);
  const lineageUnavailableReason = tableLineageReason(bootstrap);
  const workspaceLineageAvailable = workspaceAccessAvailable(workspaceAccess, "canUseLineage", true);
  const lineageRolloutAvailable = runtimeFeatureFlagAvailable(
    runtimeFeatureFlags,
    "table_lineage_surface",
  );
  const lineageSurfaceAvailable =
    lineageAvailable &&
    lineageRolloutAvailable &&
    (!workspaceAccessResolved || workspaceLineageAvailable);
  const lineageRolloutUnavailableReason =
    "Table lineage rollout is not available in this workspace right now.";
  const lineageSurfaceUnavailableReason = workspaceAccessResolved && !workspaceLineageAvailable
    ? workspaceAccessReason(workspaceAccess, "table_lineage", lineageUnavailableReason)
    : lineageAvailable
    ? lineageRolloutAvailable
      ? lineageUnavailableReason
      : runtimeFeatureFlagReason(
          runtimeFeatureFlags,
          "table_lineage_surface",
          lineageRolloutUnavailableReason,
        )
    : lineageUnavailableReason;
  const resultsCount = discoveryResults.count;
  const resultsLoading = discoveryResults.loading;
  const resultsFetching = Boolean(discoveryResults.fetching);
  const resultsError = discoveryResults.error;
  const resultsSettled = discoveryResults.settled;
  const resultsFacets = discoveryResults.facets;
  const discoverySourceAuthoritative = discoveryResults.authoritative === true;
  const discoverySourceIsPrototype =
    effectiveBootState === "prototype_mock" ||
    /prototype/i.test(String(discoveryResults.meta?.state || "")) ||
    /prototype/i.test(String(discoveryResults.meta?.source || ""));
  const discoverySourceLabel = discoverySourceAuthoritative
    ? "Live Unity Catalog"
    : discoverySourceIsPrototype
      ? "Prototype mock · not live Databricks evidence"
      : "Degraded discovery payload";
  useEffect(() => {
    if (!showAdvancedFilters) return undefined;
    const onPointerDown = (event) => {
      if (!filterCommandRef.current?.contains(event.target)) {
        setShowAdvancedFilters(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setShowAdvancedFilters(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showAdvancedFilters]);

  useEffect(() => {
    if (routePreviewAssetFqn) {
      setPreviewDismissed(false);
      setPreviewExplicitOpen(true);
    } else {
      setPreviewExplicitOpen(false);
    }
    setSelectedAssetFqn(routePreviewAssetFqn);
  }, [querySeedKey, routePreviewAssetFqn]);

  useEffect(() => {
    setPreviewDismissed(false);
    if (!routePreviewAssetFqn) setPreviewExplicitOpen(false);
  }, [discoveryResults.requestKey, routePreviewAssetFqn]);

  useEffect(() => {
    if (!renderableDiscoveryAssets.length) {
      setSelectedAssetFqn("");
      return;
    }

    setSelectedAssetFqn((current) => {
      if (previewDismissed && !routePreviewAssetFqn) {
        return "";
      }
      // Blank discovery routes keep the first visible preview local. Only an
      // explicit route preview or an explicit user selection should write
      // preview identity back into the router.
      if (
        routePreviewAssetFqn &&
        renderableDiscoveryAssets.some((asset) => asset.fqn === routePreviewAssetFqn)
      ) {
        return routePreviewAssetFqn;
      }
      if (current && renderableDiscoveryAssets.some((asset) => asset.fqn === current)) {
        return current;
      }
      return renderableDiscoveryAssets[0].fqn;
    });
  }, [previewDismissed, renderableDiscoveryAssets, routePreviewAssetFqn]);

  useEffect(() => {
    setLinkedRecordUnavailableOverrides({});
  }, [selectedSeedAsset?.fqn]);

  useEffect(() => {
    setRecordUnavailableOverrides({});
  }, [discoveryResults.requestKey, querySeedFresh, setRecordUnavailableOverrides]);

  useEffect(() => {
    setNavigationNotice("");
  }, [discoveryResults.requestKey, selectedSeedAsset?.fqn]);

  useEffect(() => {
    if (!renderedDiscoveryAssetFqns.length || invalidQuery || resultsLoading) {
      setRecordAvailabilityTargets([]);
      return undefined;
    }
    let timeoutId = 0;
    let idleId = 0;
    const warmAvailability = () => {
      setRecordAvailabilityTargets((current) => {
        const currentKey = current.join("|");
        return currentKey === renderedDiscoveryAssetKey ? current : renderedDiscoveryAssetFqns;
      });
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(warmAvailability, { timeout: 1800 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(warmAvailability, 320);
    } else {
      warmAvailability();
    }
    return () => {
      if (typeof window !== "undefined" && idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (typeof window !== "undefined" && timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [invalidQuery, renderedDiscoveryAssetFqns, renderedDiscoveryAssetFqns.length, renderedDiscoveryAssetKey, resultsLoading]);

  useEffect(() => {
    // Result depth is local UI state, but it should reset whenever discovery
    // scope changes or a fresh discovery open reseeds the same scope.
    setVisibleResultCount(DISCOVERY_RESULT_PAGE_SIZE);
  }, [
    discoveryResults.requestKey,
    querySeedFresh,
  ]);
  const queryBuilderFields = useMemo(
    () => discoveryQueryFields(discoveryResults.queryState?.supportedFields || []),
    [discoveryResults.queryState?.supportedFields],
  );
  const queryBuilderSyntaxHint =
    discoveryResults.queryState?.syntaxHint ||
    "Use field:value clauses with AND/OR, parentheses, and quoted phrases.";
  const filtersApplied = activeFilters(filters, discoveryResults.queryState);
  const directFilterCount = filterVisibilityCount(filters, discoveryResults.queryState);
  const rawVisibleCount = effectiveVisibleCount ?? resultsCount;
  const showLiveFacetCounts = resultsSettled && !resultsError;
  const visibleAssetsSummary = showLiveFacetCounts ? (rawVisibleCount ?? 0) : "—";
  const assetTypeOptions = facetValues(
    resultsFacets,
    "assetTypes",
    [],
    filters.types,
  ).filter(Boolean);
  const catalogOptions = facetValues(
    resultsFacets,
    "catalogs",
    [],
    filters.catalogs,
  ).filter((value) => value && value !== "All catalogs");
  const ownerFilterOptions = useMemo(() => {
    const facetEntries = Array.isArray(resultsFacets?.owners) ? resultsFacets.owners : [];
    const fromFacets = facetEntries
      .map((entry) => String(entry?.value || "").trim())
      .filter((value) => value && value !== "All owners" && value !== "Unassigned");
    const fromAssets = allDiscoveryAssets.flatMap((entry) => ownerLabelsForAsset(entry));
    return [...new Set([...fromFacets, ...fromAssets])].slice(0, 20);
  }, [allDiscoveryAssets, resultsFacets]);
  const atlasAiCacheKey = useMemo(
    () => discoveryAiCacheKey(discoveryResults.requestKey || "default", filters.query),
    [discoveryResults.requestKey, filters.query],
  );
  const visibleAtlasAiState = useMemo(() => {
    if (atlasAiState.cacheKey === atlasAiCacheKey) return atlasAiState;
    return {
      loading: false,
      response: null,
      error: "",
      cacheKey: atlasAiCacheKey,
    };
  }, [atlasAiCacheKey, atlasAiState]);
  useEffect(() => {
    atlasAiCacheKeyRef.current = atlasAiCacheKey;
    atlasAiAbortRef.current?.abort?.();
    const cached = readDiscoveryAiCache(atlasAiCacheKey);
    setAtlasAiState((current) => {
      if (cached) {
        return {
          loading: false,
          response: cached,
          error: "",
          cacheKey: atlasAiCacheKey,
        };
      }
      if (current.cacheKey === atlasAiCacheKey) return current;
      return {
        loading: false,
        response: null,
        error: "",
        cacheKey: atlasAiCacheKey,
      };
    });
  }, [atlasAiCacheKey]);
  const onDiscoveryStateChange = (nextState) => setFilters(nextState);
  const clearDiscoveryFilters = () => {
    setSelectedSchemas(new Set());
    setOwnerFilterText("");
    setGlossaryFilterText("");
    const emptyFilterGroups = {
      types: [],
      catalogs: [],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
    };
    onRouteQueryChange?.("", {
      views: [],
      filterGroups: emptyFilterGroups,
    });
    onDiscoveryStateChange((current) => ({
      ...current,
      types: [],
      catalogs: [],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
      views: [],
      query: "",
    }));
  };
  const askAtlasForDiscovery = useCallback(() => {
    if (!atlasAiAvailable) {
      setAtlasAiState({
        loading: false,
        response: null,
        error: atlasAiUnavailableReason,
        cacheKey: atlasAiCacheKey,
      });
      return;
    }
    const requestCacheKey = atlasAiCacheKey;
    if (atlasAiState.cacheKey === requestCacheKey && atlasAiState.loading) return;
    const cached = readDiscoveryAiCache(requestCacheKey);
    if (cached) {
      setAtlasAiState({
        loading: false,
        response: cached,
        error: "",
        cacheKey: requestCacheKey,
      });
      return;
    }
    atlasAiAbortRef.current?.abort?.();
    const controller = new AbortController();
    atlasAiAbortRef.current = controller;
    const requestId = atlasAiRequestSeqRef.current + 1;
    atlasAiRequestSeqRef.current = requestId;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, DISCOVERY_AI_REQUEST_TIMEOUT_MS);
    setAtlasAiState((current) => ({
      loading: true,
      response: current.cacheKey === requestCacheKey ? current.response : null,
      error: "",
      cacheKey: requestCacheKey,
    }));
    fetchAtlasAiRecommendations(
      filters.query
        ? `Recommend governed assets and priorities for this Discovery search: ${filters.query}`
        : "Recommend the next governed assets and governance priorities for Discovery.",
      { signal: controller.signal },
    )
      .then((response) => {
        window.clearTimeout(timeoutId);
        if (atlasAiRequestSeqRef.current !== requestId) {
          return;
        }
        if (atlasAiAbortRef.current === controller) atlasAiAbortRef.current = null;
        writeDiscoveryAiCache(requestCacheKey, response);
        setAtlasAiState({
          loading: false,
          response,
          error: "",
          cacheKey: requestCacheKey,
        });
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        if (
          atlasAiRequestSeqRef.current !== requestId ||
          atlasAiCacheKeyRef.current !== requestCacheKey
        ) {
          return;
        }
        if (atlasAiAbortRef.current === controller) atlasAiAbortRef.current = null;
        setAtlasAiState({
          loading: false,
          response: null,
          cacheKey: requestCacheKey,
          error:
            error?.name === "AbortError"
              ? "Atlas AI recommendations are taking longer than expected. Try again."
              : error?.message || "Atlas AI recommendations are unavailable.",
        });
      });
  }, [atlasAiAvailable, atlasAiCacheKey, atlasAiState.cacheKey, atlasAiState.loading, atlasAiUnavailableReason, filters.query]);
  useEffect(() => {
    if (
      !atlasAiAvailable ||
      !resultsSettled ||
      resultsLoading ||
      invalidQuery ||
      !renderableDiscoveryAssets.length ||
      visibleAtlasAiState.loading ||
      visibleAtlasAiState.response ||
      visibleAtlasAiState.error
    ) {
      return undefined;
    }
    const autoRunKey = atlasAiCacheKey;
    if (atlasAiAutoRunKeyRef.current === autoRunKey) return undefined;
    const cached = readDiscoveryAiCache(atlasAiCacheKey);
    if (cached) {
      atlasAiAutoRunKeyRef.current = autoRunKey;
      setAtlasAiState({
        loading: false,
        response: cached,
        error: "",
        cacheKey: atlasAiCacheKey,
      });
      return undefined;
    }
    atlasAiAutoRunKeyRef.current = autoRunKey;
    const timeoutId = window.setTimeout(() => {
      askAtlasForDiscovery();
    }, 900);
    return () => window.clearTimeout(timeoutId);
  }, [
    atlasAiCacheKey,
    atlasAiAvailable,
    askAtlasForDiscovery,
    invalidQuery,
    renderableDiscoveryAssets.length,
    resultsLoading,
    resultsSettled,
    visibleAtlasAiState.error,
    visibleAtlasAiState.loading,
    visibleAtlasAiState.response,
  ]);
  const resetBrowse = () => {
    // Resetting browse returns the workspace to a clean discovery scope rather
    // than preserving an earlier explicit preview selection.
    setSelectedAssetFqn("");
    setPreviewDismissed(false);
    setPreviewExplicitOpen(false);
    if (routePreviewAssetFqn) {
      onRoutePreviewChange?.("");
    }
    const nextSort = bootstrap.discovery.sortOptions[0];
    const emptyFilterGroups = {
      types: [],
      catalogs: [],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
    };
    onRouteQueryChange?.("", {
      sortBy: nextSort,
      previewAssetFqn: "",
      views: [],
      filterGroups: emptyFilterGroups,
      fresh: true,
    });
    onDiscoveryStateChange({
      query: "",
      sortBy: nextSort,
      views: [],
      ...emptyFilterGroups,
    });
  };

  const openAssetRecord = (assetFqn) => {
    if (!assetFqn) return;
    setNavigationNotice("");
    // Track that this asset was recently viewed (for the Activity home
    // panel) regardless of whether the record actually opens — the intent
    // is to record that the user engaged with this FQN.
    pushRecentlyViewed(assetFqn);
    setRecentlyViewed(readRecentlyViewed());
    void openAssetRecordSafely(assetFqn, {
      onNavigationStateChange,
      onOpen: () => {
        setRecordUnavailableOverrides((current) => {
          if (!current[assetFqn]) return current;
          const next = { ...current };
          delete next[assetFqn];
          return next;
        });
        onOpenAsset(assetFqn);
      },
      onUnavailable: ({ availability = null, detail = null, error = null } = {}) => {
        const explicitUnavailable =
          !error &&
          (
            availability?.openable === false ||
            availability?.visible === false ||
            availability?.exists === false ||
            Boolean(detail?.fqn)
          );
        if (explicitUnavailable) {
          setRecordUnavailableOverrides((current) =>
            current[assetFqn] ? current : { ...current, [assetFqn]: true });
        }
        setNavigationNotice(
          "That asset is visible in discovery, but its metadata record is not openable with the current permissions.",
        );
      },
    });
  };
  const openLinkedAsset = (assetFqn) => {
    if (!assetFqn) return;
    setNavigationNotice("");
    void openAssetRecordSafely(assetFqn, {
      canOpen: canOpenLinkedAssetRecord,
      loadingLabel: "Opening linked metadata record…",
      onNavigationStateChange,
      onOpen: () => {
        setLinkedRecordUnavailableOverrides((current) => {
          if (!current[assetFqn]) return current;
          const next = { ...current };
          delete next[assetFqn];
          return next;
        });
        onOpenAsset(assetFqn);
      },
      onUnavailable: ({ availability = null, detail = null, error = null } = {}) => {
        const explicitUnavailable =
          !error &&
          (
            availability?.openable === false ||
            availability?.visible === false ||
            availability?.exists === false ||
            Boolean(detail?.fqn)
          );
        if (explicitUnavailable) {
          setLinkedRecordUnavailableOverrides((current) =>
            current[assetFqn] ? current : { ...current, [assetFqn]: true });
        }
        setNavigationNotice(
          "That linked asset is surfaced by live lineage, but its metadata record is not openable with the current permissions.",
        );
      },
    });
  };
  const openLineageWorkspace = (nextAssetFqn, context = "Data Lineage") => {
    if (!nextAssetFqn) return;
    if (!lineageSurfaceAvailable) {
      setNavigationNotice(lineageSurfaceUnavailableReason);
      return;
    }
    setNavigationNotice("");
    onNavigationStateChange?.(true, context === "Operational Context" ? "Opening operational context…" : "Opening lineage…");
    onOpenLineage(nextAssetFqn, context);
  };
  const openGovernanceWorkbench = (nextAssetFqn) => {
    if (!nextAssetFqn) return;
    setNavigationNotice("");
    onNavigationStateChange?.(true, "Opening governance…");
    onOpenGovernance(nextAssetFqn);
  };
  const hasRenderableResults = renderableDiscoveryAssets.length > 0;
  const handleSelectAsset = (assetFqn) => {
    const nextAssetFqn = assetFqn || "";
    setPreviewDismissed(false);
    setPreviewExplicitOpen(Boolean(nextAssetFqn));
    setSelectedAssetFqn(nextAssetFqn);
    if (nextAssetFqn !== routePreviewAssetFqn) {
      onRoutePreviewChange?.(nextAssetFqn);
    }
  };
  const previewOverlayOpen = Boolean(routePreviewAssetFqn || previewExplicitOpen);
  const closePreviewOverlay = () => {
    setPreviewDismissed(true);
    setPreviewExplicitOpen(false);
    setSelectedAssetFqn("");
    onRoutePreviewChange?.("");
  };

  useEffect(() => {
    if (!routePreviewAssetFqn || !resultsSettled) return;
    const routePreviewStillVisible = renderableDiscoveryAssets.some(
      (asset) => asset.fqn === routePreviewAssetFqn,
    );
    if (!routePreviewStillVisible) {
      onRoutePreviewChange?.("");
    }
  }, [onRoutePreviewChange, renderableDiscoveryAssets, resultsSettled, routePreviewAssetFqn]);
  const showInventoryEmptyState = resultsSettled && suppressCatalogRows && !hasRenderableResults;
  const emptyHeading = showInventoryEmptyState
    ? "No visible assets are being returned."
    : "No assets match the current scope.";
  const emptyCopy = showInventoryEmptyState
    ? effectiveBootMessage ||
      "The workspace can load, but the current principal is not surfacing any visible catalog assets yet."
    : "Relax the current search, saved view, or filters to widen the catalog scope.";
  // A1.4: operator-facing diagnostics strip. Only materialize the
  // props object when an empty-state branch will render, so we never
  // pay the render cost on the happy path.
  const discoveryMeta = discoveryResults.meta || null;
  const discoveryDiagnostics = {
    runtimeState: effectiveBootState || discoveryMeta?.state || bootstrap?.bootState || "",
    authMode:
      bootstrap?.identity?.authMode ||
      discoveryMeta?.authMode ||
      discoveryMeta?.productMode ||
      "",
    visibilityScope:
      bootstrap?.identity?.visibilityScope ||
      discoveryMeta?.visibilityScope ||
      discoveryMeta?.readScope ||
      "",
    inventorySource: discoveryMeta?.source || "",
    visibleAssets:
      typeof discoveryMeta?.visibleAssetCount === "number"
        ? discoveryMeta.visibleAssetCount
        : effectiveVisibleCount ?? (Array.isArray(discoveryResults.assets)
          ? discoveryResults.assets.length
          : 0),
    observedAt: discoveryMeta?.observedAt || "",
    discoveryState: discoveryMeta?.discoveryState || "",
  };
  const showingCount = renderedDiscoveryAssets.length;
  const canLoadMoreResults = resultsCount > showingCount;
  const loadingMoreResults =
    hasRenderableResults &&
    canLoadMoreResults &&
    resultsLoading &&
    renderableDiscoveryAssets.length < visibleResultCount;
  const selectedPreviewRecordDetail = previewSchemaDetail.detail?.fqn
    ? previewSchemaDetail.detail
    : previewDetail.detail?.fqn
      ? previewDetail.detail
      : null;
  const selectedPreviewRecordAvailability = selectedSeedAsset?.fqn
    ? renderedRecordAvailability[selectedSeedAsset.fqn] ?? null
    : null;
  const selectedPreviewHasFetchedDetail =
    selectedPreviewRecordDetail?.fqn && selectedPreviewRecordDetail !== selectedSeedAsset;
  const selectedPreviewDetailBlocksOpen =
    selectedPreviewHasFetchedDetail &&
    (
      selectedPreviewRecordDetail?.openable === false ||
      selectedPreviewRecordDetail?.recordOpenable === false ||
      selectedPreviewRecordDetail?.availability?.openable === false ||
      /unknown\s*object/i.test(String(selectedPreviewRecordDetail?.objectType || ""))
    );
  const selectedPreviewRecordOpenable =
    !selectedSeedAsset?.fqn
      ? null
      : recordUnavailableOverrides[selectedSeedAsset.fqn] === true
        ? false
      : selectedPreviewRecordAvailability === false
        ? false
        : selectedPreviewDetailBlocksOpen
        ? false
        : selectedPreviewRecordAvailability;

  useEffect(() => {
    onLiveCatalogStateChange?.({
      assets: discoveryResults.assets || [],
      count: resultsCount,
      settled: resultsSettled,
      error: resultsError,
      baselineScope: filtersApplied.length === 0,
      authoritative: discoveryResults.authoritative === true,
      facets: discoveryResults.facets || null,
    });
  }, [
    discoveryResults.authoritative,
    discoveryResults.assets,
    discoveryResults.facets,
    filtersApplied.length,
    onLiveCatalogStateChange,
    resultsCount,
    resultsError,
    resultsSettled,
  ]);

  useEffect(() => {
    const previewReady =
      !selectedSeedAsset ||
      !previewSurfaceAvailable ||
      !previewDetail.loading ||
      Boolean(previewDetail.error) ||
      isUsableAssetDetail(previewDetail.detail);
    if (!resultsLoading && resultsSettled && previewReady) {
      onSurfaceReady?.();
    }
  }, [
    onSurfaceReady,
    previewDetail.detail,
    previewDetail.error,
    previewDetail.loading,
    previewSurfaceAvailable,
    resultsLoading,
    resultsSettled,
    selectedSeedAsset,
  ]);

  return (
    <section className="gh-workspace gh-discovery-shell">
      {/* Discovery / Navigation sub-tab strip. Operator 2026-04-19
          requested the Quick action button sit here (right side of the
          tab row) instead of in the global header, so it's the module-
          specific primary action rather than a global chrome element.
          The palette is opened via a window-level custom event so we
          don't need to plumb a setter through App.jsx → AppFrame →
          children; AppFrame installs the listener. */}
      {legacyNavigationEnabled ? (
      <div className="gh-discovery-subtabs" role="tablist" aria-label="Discovery view">
        <button
          aria-selected={discoverySubTab === "discovery"}
          className={`gh-discovery-subtab ${discoverySubTab === "discovery" ? "is-active" : ""}`.trim()}
          onClick={() => setDiscoverySubTab("discovery")}
          role="tab"
          type="button"
        >
          Discovery
        </button>
        <button
          aria-selected={discoverySubTab === "navigation"}
          className={`gh-discovery-subtab ${discoverySubTab === "navigation" ? "is-active" : ""}`.trim()}
          onClick={() => setDiscoverySubTab("navigation")}
          role="tab"
          type="button"
        >
          Navigation
        </button>
        <div className="gh-discovery-subtabs-spacer" aria-hidden="true" />
        <button
          aria-label="Quick action (⌘K)"
          className="gh-discovery-subtabs-quick-action"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("gh:open-command-palette"));
            }
          }}
          title="Quick action (⌘K)"
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          <span>Quick action</span>
        </button>
      </div>
      ) : null}
      <section
        className="gh-discovery-main gh-discovery-main-grid"
        data-preview-open={previewOverlayOpen ? "true" : undefined}
        data-sub-tab={discoverySubTab}
        data-prototype-filters={!legacyNavigationEnabled ? "true" : undefined}
      >
        {legacyNavigationEnabled ? (
        <aside className="gh-discovery-sidebar gh-surface-rail gh-filters-rail" aria-label="Filters">
          <header className="gh-filters-rail-head">
            <h2 className="gh-filters-rail-title">Filters</h2>
          </header>

          {/* 1. Catalog (top). Catalogs collapse/expand via a dedicated
              chevron so the checkbox is purely a filter toggle, not an
              expand toggle (previously the two were conflated, which
              meant un-checking a catalog also closed its schemas and
              hid whatever the user was scoped into). Schemas cap at 5
              per catalog with a "Show more" escape hatch so a catalog
              with 50 schemas doesn't stampede the sidebar. */}
          <SidebarSection title="Catalog">
            {catalogSchemaTree.length ? (
              <div className="gh-catalog-tree" role="tree" aria-label="Catalog navigation">
                {catalogSchemaTree.map((entry, index) => {
                  const catalogHasSchemaPick = [...selectedSchemas].some((key) =>
                    String(key).startsWith(`${entry.catalog}.`),
                  );
                  const catalogActive =
                    (filters.catalogs || []).includes(entry.catalog) ||
                    catalogHasSchemaPick;
                  const manuallyExpanded = expandedCatalogs.has(entry.catalog);
                  const expanded =
                    manuallyExpanded ||
                    catalogActive ||
                    (index === 0 && !expandedCatalogs.size); /* auto-expand first by default */
                  const hasSchemas = entry.schemas.length > 0;
                  const visibleSchemas = expanded ? entry.schemas : [];
                  return (
                    <div className="gh-catalog-tree-entry" key={entry.catalog}>
                      <div className={`gh-catalog-tree-row gh-catalog-tree-catalog-row ${catalogActive ? "is-active" : ""}`.trim()}>
                        <button
                          aria-label={expanded ? `Collapse ${entry.catalog}` : `Expand ${entry.catalog}`}
                          aria-expanded={expanded}
                          className={`gh-catalog-tree-chevron ${expanded ? "is-open" : ""}`.trim()}
                          disabled={!hasSchemas}
                          onClick={() => toggleCatalogExpanded(entry.catalog)}
                          type="button"
                        >
                          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="5 4 10 8 5 12" />
                          </svg>
                        </button>
                        <input
                          aria-label={`Filter to catalog ${entry.catalog}`}
                          checked={catalogActive}
                          className="gh-catalog-tree-checkbox"
                          onChange={() =>
                            toggleMulti(
                              filters,
                              "catalogs",
                              entry.catalog,
                              null,
                              onDiscoveryStateChange,
                            )
                          }
                          type="checkbox"
                        />
                        <span className="gh-catalog-tree-label gh-truncate" title={entry.catalog}>{entry.catalog}</span>
                        <span className="gh-catalog-tree-count">({entry.count.toLocaleString()})</span>
                      </div>
                      {expanded && hasSchemas ? (
                        <div className="gh-catalog-tree-schemas">
                          {(manuallyExpanded ? visibleSchemas : visibleSchemas.slice(0, 5)).map((schemaEntry) => {
                            const active = isSchemaSelected(entry.catalog, schemaEntry.schema);
                            return (
                              <label
                                className={`gh-catalog-tree-row gh-catalog-tree-schema-row ${active ? "is-active" : ""}`.trim()}
                                key={schemaEntry.schema}
                                title={`Filter to ${entry.catalog}.${schemaEntry.schema}`}
                              >
                                <span className="gh-catalog-tree-schema-indent" aria-hidden="true" />
                                <input
                                  aria-label={`Filter to schema ${entry.catalog}.${schemaEntry.schema}`}
                                  checked={active}
                                  className="gh-catalog-tree-checkbox"
                                  onChange={() => toggleSchema(entry.catalog, schemaEntry.schema)}
                                  type="checkbox"
                                />
                                <span className="gh-catalog-tree-label gh-truncate" title={schemaEntry.schema}>
                                  {schemaEntry.schema}
                                </span>
                                <span className="gh-catalog-tree-count">
                                  ({schemaEntry.count.toLocaleString()})
                                </span>
                              </label>
                            );
                          })}
                          {!manuallyExpanded && visibleSchemas.length > 5 ? (
                            <button
                              className="gh-tertiary-button gh-catalog-tree-show-more"
                              onClick={() => toggleCatalogExpanded(entry.catalog)}
                              type="button"
                            >
                              Show all {visibleSchemas.length} schemas
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {hasSchemaSelection ? (
                  <button
                    className="gh-tertiary-button gh-catalog-tree-clear"
                    onClick={() => setSelectedSchemas(new Set())}
                    type="button"
                  >
                    Clear schema filter{selectedSchemas.size > 1 ? "s" : ""}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="gh-support-copy">Catalog tree will populate from visible inventory.</div>
            )}
          </SidebarSection>

          {/* 2. Asset Type (singular, checkboxes) */}
          <SidebarSection title="Asset Type">
            {assetTypeOptions.length ? (
              <div className="gh-checkbox-list">
                {assetTypeOptions
                  .filter((option) => option !== "All types")
                  .slice(0, 8)
                  .map((option) => {
                    const active = (filters.types || []).includes(option);
                    const count =
                      liveAssetTypeCounts[option] ??
                      facetCount(resultsFacets, "assetTypes", option);
                    return (
                      <label
                        className={`gh-checkbox-row ${active ? "is-active" : ""}`.trim()}
                        key={option}
                      >
                        <input
                          aria-label={`Filter by ${option}`}
                          checked={active}
                          className="gh-checkbox"
                          onChange={() =>
                            toggleMulti(filters, "types", option, "All types", onDiscoveryStateChange)
                          }
                          type="checkbox"
                        />
                        <span className="gh-checkbox-label">{option}</span>
                        <span className="gh-checkbox-count">({Number(count || 0).toLocaleString()})</span>
                      </label>
                    );
                  })}
              </div>
            ) : (
              <div className="gh-support-copy">Asset types populate from live discovery facets.</div>
            )}
          </SidebarSection>

          {/* 3. Domain (checkboxes) — "All domains" is always the top row
              so stewards never start in a state that reads as nothing-selected.
              The row is checked by default (when filters.domains is empty)
              and unchecks as soon as a specific domain is picked. We strip
              any "All domains" string the backend may have synthesized as a
              facet so the row doesn't appear twice. */}
          {(() => {
            const rawDomainOptions = facetValues(resultsFacets, "domains", [], filters.domains || []);
            const domainOptions = rawDomainOptions.filter((option) => !/^all\s+domains$/i.test(String(option || "")));
            const activeDomains = filters.domains || [];
            const allSelected = activeDomains.length === 0;
            const totalCount = Number(discoveryResults.count || allDiscoveryAssets.length);
            return (
              <SidebarSection title="Domain">
                <div className="gh-checkbox-list">
                  <label className={`gh-checkbox-row ${allSelected ? "is-active" : ""}`.trim()}>
                    <input
                      aria-label="Show assets from all domains"
                      checked={allSelected}
                      className="gh-checkbox"
                      onChange={() =>
                        onDiscoveryStateChange((current) => ({ ...current, domains: [] }))
                      }
                      type="checkbox"
                    />
                    <span className="gh-checkbox-label">All domains</span>
                    <span className="gh-checkbox-count">({Number(totalCount || 0).toLocaleString()})</span>
                  </label>
                  {domainOptions.slice(0, 8).map((option) => {
                    const active = activeDomains.includes(option);
                    const count = facetCount(resultsFacets, "domains", option);
                    return (
                      <label
                        className={`gh-checkbox-row ${active ? "is-active" : ""}`.trim()}
                        key={option}
                      >
                        <input
                          aria-label={`Filter by domain ${option}`}
                          checked={active}
                          className="gh-checkbox"
                          onChange={() =>
                            toggleMulti(filters, "domains", option, null, onDiscoveryStateChange)
                          }
                          type="checkbox"
                        />
                        <span className="gh-checkbox-label">{option}</span>
                        <span className="gh-checkbox-count">({Number(count || 0).toLocaleString()})</span>
                      </label>
                    );
                  })}
                </div>
              </SidebarSection>
            );
          })()}

          {/* 4. Owner — reads from backend `owners` facet when present
               (Round 13: full-matched-set counts vs paged-window counts) and
               falls back to a client-side tally over `allDiscoveryAssets`
               when the backend hasn't populated the facet yet. The fallback
               preserves the pre-facet UX so the section never collapses to
               just "All owners" when the backend envelope omits `owners`. */}
          <SidebarSection title="Owner">
            {(() => {
              const ownerFacetEntries = Array.isArray(discoveryResults.facets?.owners)
                ? discoveryResults.facets.owners
                : [];
              const hasBackendFacet = ownerFacetEntries.some(
                (entry) =>
                  entry &&
                  entry.value &&
                  entry.value !== "All owners" &&
                  entry.value !== "Unassigned",
              );

              let ownerEntries;
              let unassignedCount;
              let ownerTotalCount;

              if (hasBackendFacet) {
                ownerEntries = ownerFacetEntries
                  .filter(
                    (entry) =>
                      entry &&
                      entry.value &&
                      entry.value !== "All owners" &&
                      entry.value !== "Unassigned",
                  )
                  .map((entry) => [entry.value, Number(entry.count || 0)])
                  .slice(0, 8);
                const unassignedEntry = ownerFacetEntries.find(
                  (entry) => entry && entry.value === "Unassigned",
                );
                unassignedCount = Number(unassignedEntry?.count || 0);
                const allEntry = ownerFacetEntries.find(
                  (entry) => entry && entry.value === "All owners",
                );
                ownerTotalCount = Number(
                  allEntry?.count ?? discoveryResults.count ?? allDiscoveryAssets.length ?? 0,
                );
              } else {
                // Fallback: aggregate owners from the visible page of assets.
                // This path is exercised when the backend envelope omits the
                // `owners` facet (older server, test fixtures, degraded response).
                const ownerCounts = new Map();
                let localUnassigned = 0;
                for (const entry of allDiscoveryAssets) {
                  const owners = Array.isArray(entry?.owners) ? entry.owners : [];
                  if (!owners.length) {
                    localUnassigned += 1;
                    continue;
                  }
                  const seenForAsset = new Set();
                  for (const owner of owners) {
                    const label =
                      typeof owner === "string"
                        ? owner
                        : owner?.email || owner?.name || owner?.label || "";
                    if (!label || seenForAsset.has(label)) continue;
                    seenForAsset.add(label);
                    ownerCounts.set(label, (ownerCounts.get(label) || 0) + 1);
                  }
                }
                ownerEntries = [...ownerCounts.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8);
                unassignedCount = localUnassigned;
                ownerTotalCount = Number(
                  discoveryResults.count ?? allDiscoveryAssets.length ?? 0,
                );
              }

              const allSelected = !ownerFilterText;
              return (
                <div className="gh-checkbox-list">
                  <label className={`gh-checkbox-row ${allSelected ? "is-active" : ""}`.trim()}>
                    <input
                      aria-label="Show assets from all owners"
                      checked={allSelected}
                      className="gh-checkbox"
                      onChange={() => setOwnerFilterText("")}
                      type="checkbox"
                    />
                    <span className="gh-checkbox-label">All owners</span>
                    <span className="gh-checkbox-count">({ownerTotalCount.toLocaleString()})</span>
                  </label>
                  {ownerEntries.map(([label, count]) => {
                    const active = ownerFilterText === label;
                    return (
                      <label
                        className={`gh-checkbox-row ${active ? "is-active" : ""}`.trim()}
                        key={label}
                      >
                        <input
                          aria-label={`Filter by owner ${label}`}
                          checked={active}
                          className="gh-checkbox"
                          onChange={() => setOwnerFilterText(active ? "" : label)}
                          type="checkbox"
                        />
                        <span className="gh-checkbox-label gh-truncate" title={label}>{prettyOwnerName(label)}</span>
                        <span className="gh-checkbox-count">({Number(count).toLocaleString()})</span>
                      </label>
                    );
                  })}
                  {unassignedCount > 0 ? (
                    <label
                      className={`gh-checkbox-row ${ownerFilterText === "__unassigned__" ? "is-active" : ""}`.trim()}
                    >
                      <input
                        aria-label="Show assets with no owner"
                        checked={ownerFilterText === "__unassigned__"}
                        className="gh-checkbox"
                        onChange={() =>
                          setOwnerFilterText(ownerFilterText === "__unassigned__" ? "" : "__unassigned__")
                        }
                        type="checkbox"
                      />
                      <span className="gh-checkbox-label">Unassigned</span>
                      <span className="gh-checkbox-count">({unassignedCount.toLocaleString()})</span>
                    </label>
                  ) : null}
                </div>
              );
            })()}
          </SidebarSection>

          {/* 5. Classification (renamed from "Sensitivity" in round 3).
              Shows "All classifications" sentinel + real values from
              the live facet. We never seed PII / Conf / Internal as
              placeholders — only render values the catalog actually
              carries, matching the Domain/Owner pattern. */}
          {(() => {
            const rawSensitivities = facetValues(
              resultsFacets,
              "sensitivities",
              [],
              filters.sensitivities || [],
            );
            const sensitivityOptions = rawSensitivities.filter((option) =>
              !/^all\s+sensitivit/i.test(String(option || "")) &&
              !/^all\s+classificat/i.test(String(option || "")),
            );
            const activeSens = filters.sensitivities || [];
            const allSelected = activeSens.length === 0;
            const totalCount = Number(discoveryResults.count || allDiscoveryAssets.length);
            return (
              <SidebarSection title="Classification">
                <div className="gh-checkbox-list">
                  <label className={`gh-checkbox-row ${allSelected ? "is-active" : ""}`.trim()}>
                    <input
                      aria-label="Show assets with any classification"
                      checked={allSelected}
                      className="gh-checkbox"
                      onChange={() =>
                        onDiscoveryStateChange((current) => ({ ...current, sensitivities: [] }))
                      }
                      type="checkbox"
                    />
                    <span className="gh-checkbox-label">All classifications</span>
                    <span className="gh-checkbox-count">({Number(totalCount || 0).toLocaleString()})</span>
                  </label>
                  {sensitivityOptions.slice(0, 6).map((option) => {
                    const active = activeSens.includes(option);
                    const count = facetCount(resultsFacets, "sensitivities", option);
                    const shortLabel = /conf/i.test(option)
                      ? "Conf"
                      : /internal/i.test(option)
                        ? "Internal"
                        : option;
                    return (
                      <label
                        className={`gh-checkbox-row ${active ? "is-active" : ""}`.trim()}
                        key={option}
                      >
                        <input
                          aria-label={`Filter by sensitivity ${option}`}
                          checked={active}
                          className="gh-checkbox"
                          onChange={() =>
                            toggleMulti(filters, "sensitivities", option, null, onDiscoveryStateChange)
                          }
                          type="checkbox"
                        />
                        <span className="gh-checkbox-label">{shortLabel}</span>
                        <span className="gh-checkbox-count">({Number(count || 0).toLocaleString()})</span>
                      </label>
                    );
                  })}
                </div>
              </SidebarSection>
            );
          })()}

          {/* 6. Glossary Term (free-text input in a bordered panel) */}
          <SidebarSection title="Glossary Term">
            <input
              aria-label="Filter by glossary term or tag"
              className="gh-sidebar-input"
              onChange={(event) => setGlossaryFilterText(event.target.value)}
              placeholder="Glossary Term"
              type="text"
              value={glossaryFilterText}
            />
          </SidebarSection>

          {/* 7. Workflow State — "All workflow states" sentinel + real
              values only. Operator 2026-04-19 round 4 flagged "All
              certifications" leaking into the option list (it was
              coming from the backend facet as a synthetic "All" row
              and getting rendered as if it were a real certification). */}
          {(() => {
            const rawCertOptions = facetValues(
              resultsFacets,
              "certifications",
              ["Certified", "Pending", "Deprecated"],
              filters.certifications || [],
            );
            const certOptions = rawCertOptions.filter((option) =>
              !/^all\s+certificat/i.test(String(option || "")) &&
              !/^all\s+workflow/i.test(String(option || "")),
            );
            if (!certOptions.length) return null;
            const workflowLabelFor = (option) =>
              /publish|certified|enterpri/i.test(option)
                ? "Published"
                : /pending|review|draft/i.test(option)
                  ? "In Review"
                  : /deprecated|retired|obsolete/i.test(option)
                    ? "Deprecated"
                    : option;
            const activeCerts = filters.certifications || [];
            const allCertsSelected = activeCerts.length === 0;
            const certTotalCount = Number(
              discoveryResults.count || allDiscoveryAssets.length,
            );
            return (
              <SidebarSection title="Workflow State">
                <div className="gh-checkbox-list">
                  <label className={`gh-checkbox-row ${allCertsSelected ? "is-active" : ""}`.trim()}>
                    <input
                      aria-label="Show assets in any workflow state"
                      checked={allCertsSelected}
                      className="gh-checkbox"
                      onChange={() =>
                        onDiscoveryStateChange((current) => ({ ...current, certifications: [] }))
                      }
                      type="checkbox"
                    />
                    <span className="gh-checkbox-label">All workflow states</span>
                    <span className="gh-checkbox-count">({certTotalCount.toLocaleString()})</span>
                  </label>
                  {certOptions.slice(0, 6).map((option) => {
                    const active = (filters.certifications || []).includes(option);
                    const count = facetCount(resultsFacets, "certifications", option);
                    return (
                      <label
                        className={`gh-checkbox-row ${active ? "is-active" : ""}`.trim()}
                        key={option}
                      >
                        <input
                          aria-label={`Filter by workflow ${workflowLabelFor(option)}`}
                          checked={active}
                          className="gh-checkbox"
                          onChange={() =>
                            toggleMulti(filters, "certifications", option, null, onDiscoveryStateChange)
                          }
                          type="checkbox"
                        />
                        <span className="gh-checkbox-label">{workflowLabelFor(option)}</span>
                        <span className="gh-checkbox-count">({Number(count || 0).toLocaleString()})</span>
                      </label>
                    );
                  })}
                </div>
              </SidebarSection>
            );
          })()}
        </aside>
        ) : null}
        {!legacyNavigationEnabled ? (
          <PrototypeDiscoveryFilterRail
            assets={allDiscoveryAssets}
            facets={resultsFacets}
            filters={filters}
            onDiscoveryStateChange={onDiscoveryStateChange}
            resultsCount={resultsCount}
          />
        ) : null}

        <section className="gh-results-column">
          {/* Round 19 defect #2: permanent OBO scope-fallback banner.
              Renders above the facet row when the backend flagged the
              response as app-principal-scoped so the user always knows
              they're looking at a narrower inventory AND has a one-click
              path back to actor-scoped data. */}
          {discoveryResults.oboScopeFallback ? (
            <DiscoveryOboFallbackBanner
              reason={discoveryResults.oboFallbackReason}
              onRetry={() => discoveryResults.refreshActorScope?.()}
              retrying={discoveryResults.refreshing}
            />
          ) : null}
        <DiscoverySearchHero
          atlasAiAvailable={atlasAiAvailable}
          atlasAiLoading={visibleAtlasAiState.loading}
          atlasAiUnavailableReason={atlasAiUnavailableReason}
          advancedOpen={showAdvancedFilters}
          bootstrap={bootstrap}
            facets={resultsFacets}
            filters={filters}
            onAskAtlas={askAtlasForDiscovery}
            onClearAll={clearDiscoveryFilters}
            onDiscoveryStateChange={onDiscoveryStateChange}
            onOpenFilters={() => setShowAdvancedFilters((current) => !current)}
            onOpenSavedSearches={() => setShowSavedSearches((current) => !current)}
            onOwnerFilterChange={(value) => setOwnerFilterText(value || "")}
            ownerFilterValue={ownerFilterText === "__unassigned__" ? "" : ownerFilterText}
            ownerOptions={ownerFilterOptions}
            savedSearchesOpen={showSavedSearches}
            sourceAuthoritative={discoverySourceAuthoritative}
          />
          {showSavedSearches ? (
            <DiscoverySavedSearchesPopover
              onClose={() => setShowSavedSearches(false)}
              onDiscoveryStateChange={onDiscoveryStateChange}
              savedViewCounts={savedViewCounts}
            />
          ) : null}
          <DiscoveryActiveFilterRow
            chips={filtersApplied}
            filters={filters}
            onDiscoveryStateChange={onDiscoveryStateChange}
            onResetBrowse={resetBrowse}
          />
          {showAdvancedFilters ? (
            <div className="gh-discovery-filter-shell gh-discovery-hero-filter-popover" id="gh-discovery-filter-popover" ref={filterCommandRef}>
              <FiltersPopover
                bootstrap={bootstrap}
                facets={resultsFacets}
                filters={filters}
                onClose={() => setShowAdvancedFilters(false)}
                onDiscoveryStateChange={onDiscoveryStateChange}
                queryState={discoveryResults.queryState}
                querySyntaxHint={queryBuilderSyntaxHint}
                resultsCount={resultsCount}
                supportedQueryFields={queryBuilderFields.map((field) => field.value)}
              />
            </div>
          ) : null}
          {navigationNotice ? (
            <InlineStatusBanner
              message={navigationNotice}
              title={/favorite/i.test(navigationNotice) ? "Local state updated" : "Navigation limited"}
            />
          ) : null}

          {resultsError ? (
            <InlineStatusBanner
              message={summarizeDiscoveryError(resultsError)}
              title="Discovery search degraded"
            />
          ) : null}

          {resultsLoading ? (
            <InlineStatusBanner
              message="Searching the visible catalog metadata for matching governed assets."
              title="Loading discovery results"
            />
          ) : null}

          {resultsFetching && !resultsLoading && !resultsError ? (
            <InlineStatusBanner
              message="Updating the visible result set from catalog metadata."
              title="Refreshing discovery results"
            />
          ) : null}

          {invalidQuery ? (
            <WorkspaceStateCard
              actions={(
                <>
                  {filters.query ? (
                    <button
                      className="gh-secondary-button"
                      onClick={() => onDiscoveryStateChange((current) => ({ ...current, query: "" }))}
                      type="button"
                    >
                      Clear search
                    </button>
                  ) : null}
                  <button className="gh-secondary-button" onClick={resetBrowse} type="button">
                    Reset browse
                  </button>
                </>
              )}
              className="gh-discovery-empty-state"
              eyebrow="Invalid Search"
              message={
                invalidQuery.syntaxHint ||
                "Use AND, OR, parentheses, quoted phrases, and supported field selectors."
              }
              title={invalidQuery.message || "Invalid discovery query."}
              tone="bad"
            />
          ) : resultsError ? (
            <>
              <DiscoveryDiagnosticsStrip {...discoveryDiagnostics} />
              <DiscoveryDegradedResultsState
                filters={filters}
                message={resultsError || bootstrap.bootMessage}
                onClearSearch={() => onDiscoveryStateChange((current) => ({ ...current, query: "" }))}
                onResetBrowse={resetBrowse}
                title={summarizeDiscoveryError(resultsError) || "Discovery search degraded"}
              />
            </>
          ) : hasRenderableResults ? (
            <div className="gh-discovery-table-stack">
              <DiscoveryResultsTable
                assets={renderedDiscoveryAssets}
                bootstrap={bootstrap}
                facets={resultsFacets}
                favorites={favorites}
                filters={filters}
                lineageAvailable={lineageSurfaceAvailable}
                lineageUnavailableReason={lineageSurfaceUnavailableReason}
                onDiscoveryStateChange={onDiscoveryStateChange}
                onOpenAsset={openAssetRecord}
                onOpenGovernance={openGovernanceWorkbench}
                onOpenLineage={openLineageWorkspace}
                onSelect={handleSelectAsset}
                onToggleFavorite={toggleFavorite}
                recordUnavailableOverrides={recordUnavailableOverrides}
                recordUnavailableReason={DISCOVERY_RECORD_UNAVAILABLE_REASON}
                renderedRecordAvailability={renderedRecordAvailability}
                resultsCount={resultsCount}
                selectedAssetFqn={previewOverlayOpen ? selectedAssetFqn : ""}
                sortOptions={bootstrap.discovery.sortOptions}
                sourceAuthoritative={discoverySourceAuthoritative}
                sourceIsPrototype={discoverySourceIsPrototype}
                sourceLabel={discoverySourceLabel}
              />
              <DiscoveryBottomPanels
                aiState={visibleAtlasAiState}
                atlasAiAvailable={atlasAiAvailable}
                atlasAiUnavailableReason={atlasAiUnavailableReason}
                assets={renderedDiscoveryAssets}
                onAskAtlas={askAtlasForDiscovery}
                onDiscoveryStateChange={onDiscoveryStateChange}
                onSelect={handleSelectAsset}
                savedViewCounts={savedViewCounts}
              />
              {canLoadMoreResults ? (
                <div className="gh-panel gh-discovery-results-more">
                  <div className="gh-support-copy">
                    Showing {showingCount} of {resultsCount} results to keep the catalog responsive.
                  </div>
                  <button
                    className="gh-secondary-button"
                    disabled={loadingMoreResults}
                    onClick={() =>
                      setVisibleResultCount((current) =>
                        Math.min(
                          current + DISCOVERY_RESULT_PAGE_SIZE,
                          resultsCount || current + DISCOVERY_RESULT_PAGE_SIZE,
                        ),
                      )
                    }
                    title={loadingMoreResults ? "Loading the next page of results — please wait." : undefined}
                    type="button"
                  >
                    {loadingMoreResults ? "Loading more results…" : "Load more results"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : resultsLoading ? (
            <div className="gh-result-list gh-discovery-table" aria-busy="true" aria-label="Loading catalog">
              {[...Array(8)].map((_, idx) => (
                <div className="gh-skeleton-row" key={`skel-${idx}`}>
                  <div className="gh-skeleton-cell" style={{ width: 14 }} />
                  <div className="gh-skeleton-cell" style={{ width: `${60 + ((idx * 7) % 30)}%` }} />
                  <div className="gh-skeleton-cell" style={{ width: 60 }} />
                  <div className="gh-skeleton-cell" style={{ width: "70%" }} />
                  <div className="gh-skeleton-cell" style={{ width: 50 }} />
                  <div className="gh-skeleton-cell" style={{ width: 60 }} />
                  <div className="gh-skeleton-cell" style={{ width: 90 }} />
                  <div className="gh-skeleton-cell" style={{ width: 80 }} />
                  <div className="gh-skeleton-cell" style={{ width: 50 }} />
                  <div className="gh-skeleton-cell" style={{ width: 40 }} />
                </div>
              ))}
            </div>
          ) : (
            <>
              <DiscoveryDiagnosticsStrip {...discoveryDiagnostics} />
              <WorkspaceStateCard
                actions={(
                  <>
                    {filters.query ? (
                      <button
                        className="gh-secondary-button"
                        onClick={() => onDiscoveryStateChange((current) => ({ ...current, query: "" }))}
                        type="button"
                      >
                        Clear search
                      </button>
                    ) : null}
                    <button className="gh-secondary-button" onClick={resetBrowse} type="button">
                      Reset browse
                    </button>
                  </>
                )}
                className="gh-discovery-empty-state"
                eyebrow={showInventoryEmptyState ? "Inventory empty" : "No matching assets"}
                message={emptyCopy}
                title={emptyHeading}
              />
            </>
          )}
        </section>

        {previewOverlayOpen ? (
          <button
            aria-label="Close asset preview overlay"
            className="gh-discovery-preview-scrim"
            onClick={closePreviewOverlay}
            type="button"
          />
        ) : null}
        <SelectionPreview
          asset={previewAsset}
          detailError={
            previewSurfaceAvailable ? previewSchemaDetail.error || previewDetail.error : ""
          }
          detailLoading={
            previewSurfaceAvailable
              ? previewDetail.loading || (previewSchemaDetail.loading && !previewSchemaDetail.detail?.columns?.length)
              : false
          }
          interactionResetKey={recordUnavailableScopeKey}
          linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
          previewAvailable={previewSurfaceAvailable}
          previewUnavailableReason={previewSurfaceUnavailableReason}
          lineageAvailable={lineageSurfaceAvailable}
          lineageUnavailableReason={lineageSurfaceUnavailableReason}
          onClearSelection={() => {
            closePreviewOverlay();
          }}
          onOpenAsset={openAssetRecord}
          onOpenGovernance={openGovernanceWorkbench}
          onOpenLinkedAsset={openLinkedAsset}
          onOpenLineage={openLineageWorkspace}
          recordOpenable={selectedPreviewRecordOpenable}
          recordUnavailableReason={DISCOVERY_RECORD_UNAVAILABLE_REASON}
          sourceAuthoritative={discoverySourceAuthoritative}
          sourceLabel={discoverySourceLabel}
          visibleAssetSet={visibleAssetSet}
        />
      </section>
    </section>
  );
}
