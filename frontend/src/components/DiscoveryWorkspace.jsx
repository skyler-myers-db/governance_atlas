import { useEffect, useMemo, useRef, useState } from "react";
import {
  canOpenAssetRecord,
  canOpenLinkedAssetRecord,
  isUsableAssetDetail,
  useAssetAvailability,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { useLineage } from "../hooks/useLineage";
import { useDiscoveryWorkspace } from "../hooks/useDiscoveryWorkspace";
import { assetPathLabel, displayObjectType } from "../lib/assetPresentation";
import { AssetTypeIcon } from "./primitives";
import { OwnerAvatar, OwnerAvatarStack } from "./primitives/OwnerAvatar";
import { WithAssetHoverCard } from "./primitives/AssetHoverCard";
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
import { applyTargetMockupFixtureToAll, isFixtureMode } from "../lib/discoveryFixture";
import { SurfaceHeader, SurfaceRail, SurfaceRailSection } from "./ShellLayoutPrimitives";
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
          onClick={() => setBuilderValue("")}
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
  queryState = null,
  onDiscoveryStateChange,
  onClose,
  querySyntaxHint = "",
  supportedQueryFields = [],
}) {
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
          activeQuery={filters.query}
          onDiscoveryStateChange={onDiscoveryStateChange}
          queryState={queryState}
          supportedFields={supportedQueryFields}
          syntaxHint={querySyntaxHint}
        />
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
          options={facetValues(facets, "catalogs", [], filters.catalogs)}
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
  // Coverage / trust score — honor the backend value honestly. No more 92%
  // fallback; if the governance backfill hasn't landed, the chip simply
  // doesn't render so the card doesn't claim a trust level that isn't real.
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
      ? "High Trust"
      : coverageScore >= 50
        ? "Mid Trust"
        : "Low Trust";
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
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={isFavorite}
            className={`gh-discovery-asset-card-star gh-row-action ${isFavorite ? "is-favorite" : ""}`}
            onClick={stop(() => onToggleFavorite?.(asset.fqn))}
            title={isFavorite ? "Unfavorite" : "Favorite"}
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
                maxVisible={3}
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

function PrimaryFacetChips({
  assetTypeCounts,
  filters,
  onDiscoveryStateChange,
  onOpenFilters,
  showFiltersBadge = 0,
  obsoleteCount = 0,
}) {
  // Primary-facet chips. The mockup's "Banonns" / "Columns" chips were
  // GenAI placeholders with no real backing in our catalog, so they are
  // not rendered (operator called them out as confusing on 2026-04-19).
  // Tables and Views map directly to asset-type filters; Obsolete maps
  // to the Deprecated certification. Each chip shows a clear "×" when
  // applied so it doesn't read as a static label.
  const primary = [
    { key: "Delta Table", label: "Tables" },
    { key: "View", label: "Views" },
  ];
  const entries = primary
    .map((entry) => ({
      ...entry,
      count: Number(assetTypeCounts[entry.key] || 0),
      kind: "type",
    }))
    .filter((entry) => entry.count > 0);
  const typeFilters = Array.isArray(filters.types) ? filters.types : [];

  return (
    <div className="gh-primary-facet-row" role="group" aria-label="Quick asset-type filters">
      {entries.map((entry) => {
        const active = typeFilters.includes(entry.key);
        const handleToggle = () => {
          onDiscoveryStateChange((current) => {
            const currentTypes = Array.isArray(current.types) ? current.types : [];
            const nextTypes = currentTypes.includes(entry.key)
              ? currentTypes.filter((t) => t !== entry.key)
              : [...currentTypes, entry.key];
            return { ...current, types: nextTypes };
          });
        };
        return (
          <button
            aria-pressed={active}
            className={`gh-primary-facet-chip ${active ? "is-active" : ""}`.trim()}
            key={entry.key}
            onClick={handleToggle}
            title={active ? `Remove ${entry.label} filter` : `Filter to ${entry.label}`}
            type="button"
          >
            <span className="gh-primary-facet-chip-label">{entry.label}</span>
            <span className="gh-primary-facet-chip-count">
              ({Number(entry.count || 0).toLocaleString()})
            </span>
            {active ? (
              <span className="gh-primary-facet-chip-x" aria-hidden="true">×</span>
            ) : null}
          </button>
        );
      })}
      {obsoleteCount > 0 && (filters.certifications || []).includes("Deprecated") ? (
        <button
          aria-pressed="true"
          className="gh-primary-facet-chip is-active"
          onClick={() =>
            onDiscoveryStateChange((current) => ({
              ...current,
              certifications: (current.certifications || []).filter((c) => c !== "Deprecated"),
            }))
          }
          title="Remove Deprecated filter"
          type="button"
        >
          <span className="gh-primary-facet-chip-label">Deprecated</span>
          <span className="gh-primary-facet-chip-count">
            ({Number(obsoleteCount).toLocaleString()})
          </span>
          <span className="gh-primary-facet-chip-x" aria-hidden="true">×</span>
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

function SelectionPreview({
  asset,
  detailLoading,
  detailError,
  linkedRecordUnavailableOverrides = {},
  onOpenAsset,
  onOpenGovernance,
  onOpenLinkedAsset,
  onOpenLineage,
  onToggleFavorite,
  onClearSelection,
  isFavorite = false,
  visibleAssetSet,
  previewAvailable = true,
  previewUnavailableReason = "",
  lineageAvailable = true,
  lineageUnavailableReason = "",
  recordOpenable = null,
  recordUnavailableReason = "",
}) {
  const [lineageWarm, setLineageWarm] = useState(false);
  // Navigating to the full record is an async boundary (new route + a
  // second bootstrap). Without a signal, "View Details" read as broken
  // clicks. We flip a loading flag the moment the user clicks, so the
  // button shows a spinner until the route change lands.
  const [navigating, setNavigating] = useState(false);
  // Local "opening" state for individual Connected assets rows so the
  // row shows an instant spinner on click. Operator 2026-04-19 round 2
  // flagged the click as dead because the global loading state isn't
  // visible from the preview rail.
  const [openingLinkedAsset, setOpeningLinkedAsset] = useState(null);
  useEffect(() => {
    // Reset when the selected asset changes so switching cards clears
    // any stale spinner.
    setNavigating(false);
    setOpeningLinkedAsset(null);
  }, [asset?.fqn]);
  const lineage = useLineage(
    asset?.fqn || "",
    Boolean(asset?.fqn) && lineageWarm && lineageAvailable && previewAvailable,
  );
  const lineageAuthoritative = lineage.authoritative;
  const lineageProvisional = lineage.provisional;
  const previewRelatedAssets = useMemo(() => {
    if (!asset || !lineageAvailable) return [];
    return [
      ...new Set([
        ...(asset.relatedAssets || []),
        ...(lineageAuthoritative ? previewRelatedAssetsFromGraph(lineage.graph, asset.fqn) : []),
      ]),
    ].slice(0, 4);
  }, [asset, lineage.graph, lineageAuthoritative, lineageAvailable]);
  const relatedAssetAvailability = useAssetAvailability(previewRelatedAssets, visibleAssetSet, {
    strict: true,
    requireRenderableDetail: false,
  });

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
      <SurfaceRail className="gh-selection-preview" title="Preview">
        <EmptyStateBlock
          message="Select a result to review metadata, schema, and stewardship posture."
          title="Nothing selected"
        />
      </SurfaceRail>
    );
  }

  const columns = (asset.columns || []).slice(0, 4);
  const signalItems = previewSignalItems(
    asset,
    asset.columns?.length || 0,
    previewRelatedAssets.length,
    detailLoading,
    lineage.loading,
    lineageProvisional,
    lineageAvailable,
  );
  const recordUnavailable = recordOpenable === false;
  const previewActions = (
    <>
      <button
        className="gh-secondary-button"
        disabled={recordUnavailable}
        onClick={() => onOpenAsset(asset.fqn)}
        title={recordUnavailable ? recordUnavailableReason : undefined}
        type="button"
      >
        {recordUnavailable ? "Metadata record unavailable" : "Open Record"}
      </button>
      <button
        className="gh-secondary-button"
        disabled={!lineageAvailable}
        onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
        title={!lineageAvailable ? lineageUnavailableReason : undefined}
        type="button"
      >
        {lineageAvailable ? "Open Lineage" : "Lineage unavailable"}
      </button>
      <button
        className="gh-secondary-button"
        disabled={recordUnavailable}
        onClick={() => onOpenGovernance(asset.fqn)}
        title={recordUnavailable ? recordUnavailableReason : undefined}
        type="button"
      >
        Open Governance
      </button>
    </>
  );

  // When `previewAvailable` is false (workspace didn't grant preview/row
  // scopes) we USED to blow the right rail away and show a giant
  // "Preview unavailable" card. That threw away the metadata we already
  // had from the discovery list. Now we render the normal mockup-shaped
  // preview using only list data and surface the unavailability as a
  // compact banner, so stewards still get the Asset-name / Domain /
  // Glossary / Schema / Lineage / Usage / Tasks structure.

  const shortDescription = String(asset.description || "").trim();
  const glossaryLabels = Array.isArray(asset.glossaryTerms)
    ? asset.glossaryTerms.map((t) => t?.label || t?.name || t).filter(Boolean)
    : [];
  const schemaChipColumns = (asset.columns || []).slice(0, 6);
  const totalColumnCount = asset.columns?.length || 0;
  const notebookUsage = Number(
    asset.usage?.notebooks
      ?? asset.usage?.notebookUsage
      ?? asset.notebookUsage
      ?? 0,
  );
  const upstreamLabel = previewRelatedAssets[0]
    ? String(previewRelatedAssets[0]).split(".").pop()
    : "upstream";
  const currentLabel = asset.name;
  const needsWorkList = needsWorkMessages(asset);
  const associatedTask = needsWorkList[0] || "Review stewardship posture for this asset";

  const domainLabel =
    asset.domain && asset.domain !== "Unassigned" ? String(asset.domain).toUpperCase() : "UNCATEGORIZED";
  // Honest glossary-term slot: null-pill when none is assigned, rather
  // than defaulting to "Critical" (which read as real curation).
  const glossaryChipLabel = glossaryLabels[0] || null;
  const catalogLabel = asset.catalog || "";
  const schemaLabel = asset.schema || "";
  const totalColumnCountReal =
    Number.isFinite(Number(asset.columnCount))
      ? Number(asset.columnCount)
      : Array.isArray(asset.columns)
        ? asset.columns.length
        : null;
  // Real first-N columns for the Schema overview preview. Each chip shows
  // column name + data type so the steward can eyeball the shape without
  // opening the full record. Limit to 5 so the rail stays dense.
  const previewColumns = Array.isArray(asset.columns)
    ? asset.columns.slice(0, 5).map((col) => ({
        name: String(col?.name || "").trim(),
        type: String(col?.type || col?.dataType || "").trim(),
      })).filter((c) => c.name)
    : [];
  const extraColumnCount = totalColumnCountReal && previewColumns.length
    ? Math.max(0, totalColumnCountReal - previewColumns.length)
    : 0;
  // Real usage counts from the backend's `operational` section.
  const producerCount = Number.isFinite(Number(asset.usage?.producerCount))
    ? Number(asset.usage.producerCount)
    : 0;
  const consumerCount = Number.isFinite(Number(asset.usage?.consumerCount))
    ? Number(asset.usage.consumerCount)
    : 0;
  const queryCount = Number.isFinite(Number(asset.usage?.queryCount))
    ? Number(asset.usage.queryCount)
    : 0;
  const targetDescriptionLine =
    "No description has been captured for this asset yet.";

  return (
    <SurfaceRail
      className="gh-selection-preview gh-selection-preview-collapsed-head"
      data-asset-fqn={asset.fqn}
      eyebrow="Asset preview"
      identity=""
      title=""
      actions={previewActions}
    >
      {detailError ? <InlineStatusBanner message={detailError} title="Preview degraded" /> : null}
      {/* Previously we showed a plain-text "Refreshing live header and schema
          metadata…" while the detail API was hydrating. That line rendered
          ABOVE the "Asset preview" eyebrow and shifted the whole preview
          layout down, which the 2026-04-19 parity review flagged as a
          mockup divergence. The asset header and schema sections already
          render their own loading affordances; the standalone banner is
          redundant. Kept only the error banner (load failure) here. */}
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

      <div className="gh-asset-preview">
        {/* 0 — Eyebrow + close: matches the mockup's "Asset preview" label
            that sits above the asset title. Close button anchors right. */}
        <div className="gh-asset-preview-eyebrow-row">
          <span className="gh-asset-preview-eyebrow">Asset preview</span>
          {onClearSelection ? (
            <button
              aria-label="Close preview"
              className="gh-asset-preview-header-close"
              onClick={() => onClearSelection()}
              title="Close"
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>

        {/* 1 — Header row: asset icon square + asset name */}
        <div className="gh-asset-preview-header">
          <div className="gh-asset-preview-header-icon">
            <AssetTypeIcon asset={asset} size="md" />
          </div>
          <h3 className="gh-asset-preview-header-name gh-truncate" title={asset.name}>
            {asset.name}
          </h3>
        </div>

        {/* 2 — Description block */}
        <div className="gh-asset-preview-description">
          {shortDescription || targetDescriptionLine}
        </div>

        {/* 3 — 2×2 action grid (always 4 buttons, dimmed when unavailable) */}
        <div className="gh-asset-preview-action-grid">
          <button
            className={`gh-primary-button ${navigating ? "is-loading" : ""}`.trim()}
            disabled={recordUnavailable || navigating}
            onClick={() => {
              setNavigating(true);
              onOpenAsset(asset.fqn, "Overview");
            }}
            title={recordUnavailable ? recordUnavailableReason : "Open the asset metadata record"}
            type="button"
          >
            {navigating ? (
              <>
                <span aria-hidden="true" className="gh-button-spinner" />
                <span>Opening…</span>
              </>
            ) : (
              "View Details"
            )}
          </button>
          <button
            className="gh-secondary-button"
            disabled={recordUnavailable}
            onClick={() => onOpenGovernance(asset.fqn)}
            title={recordUnavailable ? recordUnavailableReason : "Request access to this asset"}
            type="button"
          >
            Request Access
          </button>
          <button
            className="gh-secondary-button"
            disabled={!lineageAvailable}
            onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
            title={!lineageAvailable ? lineageUnavailableReason : "Add this asset to the lineage graph"}
            type="button"
          >
            {/* Lineage glyph — two small nodes connected by an arrow.
                The prior build reused the favorite star here, which the
                operator flagged on 2026-04-19 as a misleading icon (a
                star implies favoriting, not graph placement). */}
            <svg
              aria-hidden="true"
              className="gh-asset-preview-action-glyph"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="6" r="2.2" />
              <circle cx="18" cy="18" r="2.2" />
              <path d="M7.5 7.5 16.5 16.5" />
            </svg>
            Add to Lineage
          </button>
          <button
            aria-pressed={isFavorite}
            className={`gh-secondary-button ${isFavorite ? "is-favorite" : ""}`}
            onClick={() => onToggleFavorite?.(asset.fqn)}
            title={isFavorite ? "Remove from favorites" : "Mark this asset as a favorite"}
            type="button"
          >
            <span aria-hidden="true" className="gh-asset-preview-action-glyph">★</span>
            {isFavorite ? "Favorited" : "Favorite"}
          </button>
        </div>

        {/* 4 — Metadata label/value rows with pill values */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title">Metadata</div>
          <dl className="gh-asset-preview-metadata">
            <div className="gh-asset-preview-metadata-row">
              <dt>Asset name</dt>
              <dd className="gh-truncate" title={asset.name}>{asset.name}</dd>
            </div>
            <div className="gh-asset-preview-metadata-row">
              <dt>Domain type</dt>
              <dd>
                <span
                  className="gh-labeled-pill gh-labeled-pill-domain"
                  data-domain-fallback={domainLabel === "UNCATEGORIZED" ? "true" : "false"}
                >
                  {domainLabel}
                </span>
              </dd>
            </div>
            <div className="gh-asset-preview-metadata-row">
              <dt>Glossary term</dt>
              <dd>
                {glossaryChipLabel ? (
                  <span className="gh-labeled-pill gh-labeled-pill-glossary">{glossaryChipLabel}</span>
                ) : (
                  <span className="gh-asset-preview-metadata-empty">—</span>
                )}
              </dd>
            </div>
            <div className="gh-asset-preview-metadata-row">
              <dt>Description</dt>
              <dd className="gh-asset-preview-metadata-description">
                {shortDescription || targetDescriptionLine}
              </dd>
            </div>
          </dl>
        </section>

        {/* 5 — Schema overview: real column preview pulled from the asset
            detail (first 5 columns with data type), plus a total-column
            count and a link into the Schema tab of the record. If the
            workspace doesn't return columns yet (OBO not granted), we
            still show the catalog.schema scope so stewards can see where
            the asset lives. */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title-row">
            <span className="gh-panel-title">Schema overview</span>
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
                    {`+${extraColumnCount.toLocaleString()} more — open Schema`}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="gh-asset-preview-schema-chips">
              {catalogLabel ? (
                <span className="gh-chip gh-chip-soft" title={`Catalog ${catalogLabel}`}>
                  {catalogLabel}
                </span>
              ) : null}
              {schemaLabel ? (
                <span className="gh-chip gh-chip-soft" title={`Schema ${schemaLabel}`}>
                  {schemaLabel}
                </span>
              ) : null}
              <span className="gh-asset-preview-schema-empty">
                Columns will load once workspace-scoped access is granted.
              </span>
            </div>
          )}
        </section>

        {/* 6 — Simplified lineage preview: icon → icon visual */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title">Simplified lineage preview</div>
          {lineageAvailable ? (
            <div className="gh-lineage-mini-preview">
              <div className="gh-lineage-mini-node">
                <AssetTypeIcon asset={asset} size="md" />
                <span
                  className="gh-lineage-mini-node-label gh-truncate"
                  title={previewRelatedAssets[0] || upstreamLabel}
                >
                  {upstreamLabel}
                </span>
              </div>
              <span aria-hidden="true" className="gh-lineage-mini-arrow">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
              <div className="gh-lineage-mini-node is-current">
                <AssetTypeIcon asset={asset} size="md" />
                <span className="gh-lineage-mini-node-label gh-truncate" title={asset.fqn}>
                  {currentLabel}
                </span>
              </div>
            </div>
          ) : (
            <div className="gh-support-copy">Lineage preview not available for this asset.</div>
          )}
        </section>

        {/* 7 — Usage metrics: real lineage-derived counts (producers,
            consumers, queries) from the backend's operational section.
            "Producers" = upstream entities that write to this asset.
            "Consumers" = downstream entities that read from it. The
            query count aggregates notebook / job / SQL-warehouse calls
            that transit the asset. Fallback caption appears when lineage
            hasn't resolved yet — never fake numbers. */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title-row">
            <span className="gh-panel-title">Usage metrics</span>
            <span className="gh-asset-preview-section-caption">Last 30 days · lineage</span>
          </div>
          <div className="gh-asset-preview-usage-grid">
            <div className="gh-asset-preview-usage-cell">
              <div className="gh-asset-preview-usage-stat">
                {producerCount.toLocaleString()}
              </div>
              <div className="gh-asset-preview-usage-label">Producers</div>
              <div className="gh-asset-preview-usage-caption">Upstream writers</div>
            </div>
            <div className="gh-asset-preview-usage-cell">
              <div className="gh-asset-preview-usage-stat">
                {consumerCount.toLocaleString()}
              </div>
              <div className="gh-asset-preview-usage-label">Consumers</div>
              <div className="gh-asset-preview-usage-caption">Downstream readers</div>
            </div>
            <div className="gh-asset-preview-usage-cell">
              <div className="gh-asset-preview-usage-stat">
                {queryCount.toLocaleString()}
              </div>
              <div className="gh-asset-preview-usage-label">Queries</div>
              <div className="gh-asset-preview-usage-caption">Notebook & SQL runs</div>
            </div>
          </div>
        </section>

        {/* Connected assets — stewardship navigation. Clicking a row
            now shows an immediate local "Opening…" spinner so the
            user has instant visual feedback even if the metadata
            record takes a second to hydrate. Operator 2026-04-19
            round 2 flagged that clicks felt dead. */}
        {previewRelatedAssets.length ? (
          <section className="gh-asset-preview-section">
            <div className="gh-panel-title">Connected assets</div>
            <div className="gh-lineage-linked-list">
              {previewRelatedAssets.map((item) => {
                const linkedRecordAvailability =
                  linkedRecordUnavailableOverrides[item] === true ? false : relatedAssetAvailability[item];
                const isOpening = openingLinkedAsset === item;
                return linkedRecordAvailability === false ? (
                  <div className="gh-lineage-linked-row is-readonly" key={item}>
                    <span>{item}</span>
                    <span>Metadata record unavailable</span>
                  </div>
                ) : (
                  <button
                    className={`gh-lineage-linked-row is-asset-link ${isOpening ? "is-opening" : ""}`.trim()}
                    disabled={isOpening}
                    key={item}
                    onClick={() => {
                      setOpeningLinkedAsset(item);
                      onOpenLinkedAsset(item);
                    }}
                    type="button"
                  >
                    <span>{item}</span>
                    {isOpening ? (
                      <span className="gh-lineage-linked-row-opening">
                        <span aria-hidden="true" className="gh-button-spinner" />
                        <span>Opening…</span>
                      </span>
                    ) : (
                      <span>{linkedRecordAvailability === true ? "Open Record" : "Checking access..."}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* 8 — Associated tasks: nested task with info tooltip + child row */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title gh-asset-preview-tasks-title">
            <span>Associated tasks</span>
            <span
              aria-label="Stewardship tasks are linked to this asset's governance workflow"
              className="gh-info-glyph"
              role="img"
              title="Stewardship tasks are linked to this asset's governance workflow."
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8v.01" />
              </svg>
            </span>
          </div>
          <div className="gh-asset-preview-task-tree">
            <label className="gh-asset-preview-task-row is-parent">
              <input type="checkbox" defaultChecked readOnly />
              <span className="gh-asset-preview-task-title">Published task</span>
              <span className="gh-asset-preview-task-detail gh-truncate" title={asset.fqn}>
                {asset.name}
              </span>
            </label>
            <div className="gh-asset-preview-task-child gh-truncate" title={asset.fqn}>
              {asset.name}
            </div>
          </div>
        </section>

        {/* Always-visible strip for unavailable lineage so stewards don't
            have to go hunting for the gating reason. */}
        {!lineageAvailable && lineageUnavailableReason ? (
          <div className="gh-selection-preview-alert">
            <span className="gh-selection-preview-alert-label">Lineage</span>
            <span className="gh-selection-preview-alert-body">{lineageUnavailableReason}</span>
          </div>
        ) : null}
      </div>
    </SurfaceRail>
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

      {/* Always-visible strip for unavailable lineage so stewards don't
          have to dig into the Lineage tab to see the gating reason. */}
      {!lineageAvailable && lineageUnavailableReason ? (
        <div className="gh-selection-preview-alert">
          <span className="gh-selection-preview-alert-label">Lineage</span>
          <span className="gh-selection-preview-alert-body">{lineageUnavailableReason}</span>
        </div>
      ) : null}
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
}) {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const hoverPreviewTimerRef = useRef(null);
  const handleHoverPreview = (fqn) => {
    if (!fqn) return;
    if (hoverPreviewTimerRef.current) clearTimeout(hoverPreviewTimerRef.current);
    hoverPreviewTimerRef.current = setTimeout(() => {
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
  // Discovery/Navigation sub-tab — matches the mockup's two-tab strip above
  // the filter rail. "discovery" = default card grid; "navigation" = catalog
  // tree focus mode (hides the card grid and expands the catalog tree for
  // breadth-first browsing). Persisted in URL via ?view= so deep links work.
  const [discoverySubTab, setDiscoverySubTab] = useState(() => {
    if (typeof window === "undefined") return "discovery";
    const params = new URLSearchParams(window.location.search || "");
    const raw = String(params.get("view") || "").trim().toLowerCase();
    return raw === "navigation" ? "navigation" : "discovery";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (discoverySubTab === "navigation") {
        url.searchParams.set("view", "navigation");
      } else {
        url.searchParams.delete("view");
      }
      window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
    } catch {
      /* ignore — ?view= is purely an affordance, not load-bearing */
    }
  }, [discoverySubTab]);
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
      if (next.has(fqn)) next.delete(fqn); else next.add(fqn);
      writeFavoriteSet(next);
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
  const [previewSchemaWarm, setPreviewSchemaWarm] = useState(false);
  const [recordUnavailableOverrides, setRecordUnavailableOverrides] = useState({});
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

  const suppressCatalogRows =
    effectiveBootState !== "live" &&
    !discoveryResults.authoritative &&
    !(discoveryResults.assets || []).length;
  const rawDiscoveryAssets = suppressCatalogRows ? [] : discoveryResults.assets;
  // L3 fixture hook: when the URL carries `?fixture=target-mockup`, overlay
  // synthetic golden metadata on every asset so the UI renders deterministic
  // state regardless of the live catalog's metadata quality. Opt-in only.
  const allDiscoveryAssets = useMemo(() => {
    if (typeof window === "undefined") return rawDiscoveryAssets;
    if (!isFixtureMode(window.location?.search || "")) return rawDiscoveryAssets;
    return applyTargetMockupFixtureToAll(rawDiscoveryAssets || []);
  }, [rawDiscoveryAssets]);
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
    invalidQuery
      ? null
      : renderableDiscoveryAssets.find((asset) => asset.fqn === selectedAssetFqn) ||
        renderableDiscoveryAssets[0] ||
        null;
  const previewAvailable = systemInventoryAvailable(bootstrap);
  const previewUnavailableReason = systemInventoryReason(bootstrap);
  const workspacePreviewAvailable = workspaceAccessAvailable(
    workspaceAccess,
    "canUseAssetPreview",
    false,
  );
  const previewSurfaceAvailable = previewAvailable && workspacePreviewAvailable;
  const previewSurfaceUnavailableReason = !workspacePreviewAvailable
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
    enabled: Boolean(selectedSeedAsset?.fqn) && previewSchemaWarm && previewSurfaceAvailable,
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
  const workspaceLineageAvailable = workspaceAccessAvailable(workspaceAccess, "canUseLineage", false);
  const lineageRolloutAvailable = runtimeFeatureFlagAvailable(
    runtimeFeatureFlags,
    "table_lineage_surface",
  );
  const lineageSurfaceAvailable = lineageAvailable && lineageRolloutAvailable && workspaceLineageAvailable;
  const lineageRolloutUnavailableReason =
    "Table lineage rollout is not available in this workspace right now.";
  const lineageSurfaceUnavailableReason = !workspaceLineageAvailable
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
  const resultsError = discoveryResults.error;
  const resultsSettled = discoveryResults.settled;
  const resultsFacets = discoveryResults.facets;
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
    setSelectedAssetFqn(routePreviewAssetFqn);
  }, [querySeedKey, routePreviewAssetFqn]);

  useEffect(() => {
    if (!renderableDiscoveryAssets.length) {
      setSelectedAssetFqn("");
      return;
    }

    setSelectedAssetFqn((current) => {
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
  }, [renderableDiscoveryAssets, routePreviewAssetFqn]);

  useEffect(() => {
    if (!selectedSeedAsset?.fqn) {
      setPreviewSchemaWarm(false);
      return undefined;
    }
    let timeoutId = 0;
    let idleId = 0;
    setPreviewSchemaWarm(false);
    const warmSchema = () => {
      setPreviewSchemaWarm(true);
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(warmSchema, { timeout: 1600 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(warmSchema, 480);
    } else {
      warmSchema();
    }
    return () => {
      if (typeof window !== "undefined" && idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (typeof window !== "undefined" && timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [selectedSeedAsset?.fqn]);

  useEffect(() => {
    setLinkedRecordUnavailableOverrides({});
  }, [selectedSeedAsset?.fqn]);

  useEffect(() => {
    setRecordUnavailableOverrides({});
  }, [discoveryResults.requestKey, querySeedFresh]);

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
  const onDiscoveryStateChange = (nextState) => setFilters(nextState);
  const resetBrowse = () => {
    // Resetting browse returns the workspace to a clean discovery scope rather
    // than preserving an earlier explicit preview selection.
    setSelectedAssetFqn("");
    if (routePreviewAssetFqn) {
      onRoutePreviewChange?.("");
    }
    onDiscoveryStateChange({
      query: "",
      sortBy: bootstrap.discovery.sortOptions[0],
      views: [],
      types: [],
      catalogs: [],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
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
    setSelectedAssetFqn(nextAssetFqn);
    if (nextAssetFqn !== routePreviewAssetFqn) {
      onRoutePreviewChange?.(nextAssetFqn);
    }
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
  const selectedPreviewRecordOpenable =
    !selectedSeedAsset?.fqn
      ? null
      : recordUnavailableOverrides[selectedSeedAsset.fqn] === true
        ? false
      : selectedPreviewRecordAvailability === false
        ? false
        : selectedPreviewRecordDetail?.fqn
        ? canOpenAssetRecord(selectedPreviewRecordDetail)
        : selectedPreviewRecordAvailability;

  useEffect(() => {
    onLiveCatalogStateChange?.({
      assets: discoveryResults.assets || [],
      count: resultsCount,
      settled: resultsSettled,
      error: resultsError,
      baselineScope: filtersApplied.length === 0,
      authoritative: discoveryResults.authoritative === true,
    });
  }, [
    discoveryResults.authoritative,
    discoveryResults.assets,
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
      <section
        className="gh-discovery-main gh-discovery-main-grid"
        data-sub-tab={discoverySubTab}
      >
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

          {/* 4. Owner (real owners from visible inventory + "All owners") */}
          <SidebarSection title="Owner">
            {(() => {
              // Distinct owner list from the live inventory. Previously this
              // section rendered a single "User/Team" checkbox as a mockup
              // stand-in, which gave stewards no way to actually filter by a
              // real owner. Now we tally owners out of the visible assets
              // and surface the top N as real filter checkboxes with counts.
              const ownerCounts = new Map();
              for (const entry of allDiscoveryAssets) {
                const owners = Array.isArray(entry?.owners) ? entry.owners : [];
                if (!owners.length) {
                  ownerCounts.set("__unassigned__", (ownerCounts.get("__unassigned__") || 0) + 1);
                  continue;
                }
                for (const owner of owners) {
                  const label = typeof owner === "string"
                    ? owner
                    : owner?.email || owner?.name || owner?.label || "";
                  if (!label) continue;
                  ownerCounts.set(label, (ownerCounts.get(label) || 0) + 1);
                }
              }
              const ownerEntries = [...ownerCounts.entries()]
                .filter(([key]) => key !== "__unassigned__")
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8);
              const unassignedCount = ownerCounts.get("__unassigned__") || 0;
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
                    <span className="gh-checkbox-count">({allDiscoveryAssets.length.toLocaleString()})</span>
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

          {/* 5. Sensitivity (chip row) — show "All" sentinel + real
              sensitivities from the live facet. Operator 2026-04-19
              round 2 flagged that PII / Conf / Internal were being
              rendered as fixed placeholders even when no asset has a
              sensitivity classification. Now we only include real
              values from the facet (no hardcoded seed) and always
              include an "All" row that reads as "no filter applied",
              matching the Domain/Owner pattern. */}
          {(() => {
            const rawSensitivities = facetValues(
              resultsFacets,
              "sensitivities",
              [],
              filters.sensitivities || [],
            );
            const sensitivityOptions = rawSensitivities.filter((option) =>
              !/^all\s+sensitivit/i.test(String(option || "")),
            );
            const activeSens = filters.sensitivities || [];
            const allSelected = activeSens.length === 0;
            const totalCount = Number(discoveryResults.count || allDiscoveryAssets.length);
            return (
              <SidebarSection title="Sensitivity">
                <div className="gh-checkbox-list">
                  <label className={`gh-checkbox-row ${allSelected ? "is-active" : ""}`.trim()}>
                    <input
                      aria-label="Show assets with any sensitivity"
                      checked={allSelected}
                      className="gh-checkbox"
                      onChange={() =>
                        onDiscoveryStateChange((current) => ({ ...current, sensitivities: [] }))
                      }
                      type="checkbox"
                    />
                    <span className="gh-checkbox-label">All sensitivities</span>
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

          {/* 7. Workflow State (checkboxes with relabel) */}
          {(() => {
            const certOptions = facetValues(
              resultsFacets,
              "certifications",
              ["Certified", "Pending", "Deprecated"],
              filters.certifications || [],
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
            return (
              <SidebarSection title="Workflow State">
                <div className="gh-checkbox-list">
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

        <section className="gh-results-column">
          <DiscoveryBreadcrumb
            onClear={() => setSelectedSchemas(new Set())}
            schemaFilter={selectedSchema}
          />
          <PrimaryFacetChips
            assetTypeCounts={liveAssetTypeCounts}
            filters={filters}
            obsoleteCount={facetCount(resultsFacets, "certifications", "Deprecated")}
            onDiscoveryStateChange={onDiscoveryStateChange}
            onOpenFilters={() => setShowAdvancedFilters((current) => !current)}
            showFiltersBadge={directFilterCount}
          />
          <ActiveFilterStrip
            filters={filters}
            onClearSchemaFilter={() => setSelectedSchemas(new Set())}
            onDiscoveryStateChange={onDiscoveryStateChange}
            schemaFilter={selectedSchema}
          />
          <div className="gh-panel gh-discovery-command-panel" ref={filterCommandRef}>
            {/* Discovery / Navigation sub-tab row deliberately removed —
                the mockup has no such toggle; instead the Discovery page
                shows just the page title + result count + sort. The
                "Navigation" grid view is still reachable via ?view=navigation
                for deep links, but it doesn't pollute the main header. */}
            <div className="gh-discovery-command-head-v2">
              <div className="gh-discovery-command-heading">
                <h2 className="gh-discovery-command-title">Discovery</h2>
                <div className="gh-discovery-command-subline">
                  {showLiveFacetCounts ? (
                    <>
                      Showing <strong>{Math.min(renderedDiscoveryAssets.length, resultsCount).toLocaleString()}</strong>
                      {" "}of <strong>{resultsCount.toLocaleString()}</strong> assets
                    </>
                  ) : (
                    <span className="gh-results-inline-loading">Loading catalog…</span>
                  )}
                  {resultsLoading && showLiveFacetCounts ? (
                    <span className="gh-inline-updating"> · Updating…</span>
                  ) : null}
                </div>
              </div>
              <div className="gh-discovery-command-controls">
                <label className="gh-discovery-sort-inline" htmlFor="gh-discovery-sort">
                  <span className="gh-field-label gh-field-label-inline">Sort by</span>
                  <select
                    className="gh-select gh-select-sort"
                    aria-label="Sort metadata catalog results"
                    id="gh-discovery-sort"
                    onChange={(event) =>
                      onDiscoveryStateChange((current) => ({ ...current, sortBy: event.target.value }))
                    }
                    value={filters.sortBy || "Relevance"}
                  >
                    {(() => {
                      const opts = Array.isArray(bootstrap.discovery.sortOptions)
                        ? bootstrap.discovery.sortOptions
                        : [];
                      // "Best match" is a synonym for Relevance; collapse the
                      // two so the dropdown doesn't ship both (users found
                      // that confusing). "Relevance" is the default sort
                      // when the user has no explicit pick.
                      const filtered = opts.filter((o) => !/best\s*match/i.test(String(o)));
                      const hasRelevance = filtered.some((o) => /relevance/i.test(String(o)));
                      const merged = hasRelevance ? filtered : ["Relevance", ...filtered];
                      return merged.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ));
                    })()}
                  </select>
                </label>
              </div>
            </div>

            <div className="gh-discovery-toolbar-shell">
              {/* Stack Filters trigger + density + copy-link controls deliberately
                  removed to match the target mockup's single-row command bar.
                  Filter popover is reachable via the PrimaryFacetChips "Filters"
                  launcher above, which drives the same state. */}
              {showAdvancedFilters ? (
                <div className="gh-discovery-filter-shell" id="gh-discovery-filter-popover">
                  <FiltersPopover
                    bootstrap={bootstrap}
                    facets={resultsFacets}
                    filters={filters}
                    onClose={() => setShowAdvancedFilters(false)}
                    onDiscoveryStateChange={onDiscoveryStateChange}
                    queryState={discoveryResults.queryState}
                    querySyntaxHint={queryBuilderSyntaxHint}
                    supportedQueryFields={queryBuilderFields.map((field) => field.value)}
                  />
                </div>
              ) : null}
            </div>

            {filtersApplied.length ? (
              <div className="gh-active-filter-row gh-active-filter-row-inline gh-discovery-active-row">
                {filtersApplied.map((chip) => (
                  <button
                    className="gh-chip gh-chip-soft"
                    key={chip.id || `${chip.key}-${chip.label}`}
                    onClick={() => clearFilter(filters, chip, onDiscoveryStateChange)}
                    type="button"
                  >
                    {chip.label}
                  </button>
                ))}
                <div className="gh-results-strip-actions">
                  {filters.query ? (
                    <button
                      className="gh-tertiary-button gh-inline-link-button"
                      onClick={() =>
                        onDiscoveryStateChange((current) => ({
                          ...current,
                          query: "",
                        }))
                      }
                      type="button"
                    >
                      Clear search
                    </button>
                  ) : null}
                  <button className="gh-tertiary-button gh-inline-link-button" onClick={resetBrowse} type="button">
                    Reset browse
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {navigationNotice ? (
            <InlineStatusBanner message={navigationNotice} title="Navigation limited" />
          ) : null}

          {resultsError && !hasRenderableResults ? (
            <InlineStatusBanner
              message={summarizeDiscoveryError(resultsError)}
              title="Discovery search degraded"
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
          ) : hasRenderableResults ? (
            <div className={`gh-result-list gh-discovery-card-list density-${density} gh-discovery-table`}>
              <DiscoveryActivityHome
                assetsByFqn={assetsByFqnMap}
                favorites={favorites}
                onOpen={(fqn) => {
                  handleSelectAsset(fqn);
                  openAssetRecord(fqn);
                }}
                recentlyViewed={recentlyViewed}
              />
              <DiscoveryBulkBar
                count={bulkSelection.size}
                onAddGlossary={() => alert("Bulk glossary assignment: queue this operation from the backend bulk endpoint.")}
                onAddTag={() => alert("Bulk tag assignment: queue this operation from the backend bulk endpoint.")}
                onAssignOwner={() => alert("Bulk owner assignment: queue this operation from the backend bulk endpoint.")}
                onClear={clearBulkSelection}
              />
              {/* DiscoveryResultHeader (column labels) intentionally removed:
                  we render the catalog as a card grid, not a table, so the
                  ASSET/TYPE/DOMAIN/TIER/OWNER column headers no longer apply.
                  Sort is handled by the toolbar dropdown and by bulk-select
                  actions in the DiscoveryBulkBar. */}
              {renderedDiscoveryAssets.map((asset) => (
                <DiscoveryResultCard
                  asset={asset}
                  bulkSelectionActive={bulkSelection.size > 0}
                  isBulkSelected={bulkSelection.has(asset.fqn)}
                  isFavorite={favorites.has(asset.fqn)}
                  key={asset.fqn}
                  lineageAvailable={lineageSurfaceAvailable}
                  lineageUnavailableReason={lineageSurfaceUnavailableReason}
                  onHoverEnd={handleHoverEnd}
                  onHoverPreview={handleHoverPreview}
                  onOpenAsset={openAssetRecord}
                  onOpenGovernance={openGovernanceWorkbench}
                  onOpenLineage={openLineageWorkspace}
                  onSelect={handleSelectAsset}
                  onToggleBulkSelect={toggleBulkSelect}
                  onToggleFavorite={toggleFavorite}
                  recordOpenable={
                    recordUnavailableOverrides[asset.fqn] === true
                      ? false
                      : renderedRecordAvailability[asset.fqn] ?? null
                  }
                  recordUnavailableReason={DISCOVERY_RECORD_UNAVAILABLE_REASON}
                  selected={asset.fqn === selectedAssetFqn}
                />
              ))}
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
          ) : resultsError ? (
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
              eyebrow="Discovery Unavailable"
              message={
                bootstrap.bootMessage ||
                "The search surface is reachable, but live discovery could not return results."
              }
              title={summarizeDiscoveryError(resultsError)}
              tone="bad"
            />
          ) : (
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
          )}
        </section>

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
          isFavorite={previewAsset ? favorites.has(previewAsset.fqn) : false}
          linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
          previewAvailable={previewSurfaceAvailable}
          previewUnavailableReason={previewSurfaceUnavailableReason}
          lineageAvailable={lineageSurfaceAvailable}
          lineageUnavailableReason={lineageSurfaceUnavailableReason}
          onClearSelection={() => setSelectedAssetFqn("")}
          onOpenAsset={openAssetRecord}
          onOpenGovernance={openGovernanceWorkbench}
          onOpenLinkedAsset={openLinkedAsset}
          onOpenLineage={openLineageWorkspace}
          onToggleFavorite={toggleFavorite}
          recordOpenable={selectedPreviewRecordOpenable}
          recordUnavailableReason={DISCOVERY_RECORD_UNAVAILABLE_REASON}
          visibleAssetSet={visibleAssetSet}
        />
      </section>
    </section>
  );
}
