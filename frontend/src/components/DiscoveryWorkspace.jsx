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

// Render an owner label (email or name) as "First Last" so it reads like a
// human avatar target label (Target uses "Namer Avatar" / "Anner Avatar"
// formatting, which is basically local-part titlecased + a trailing descriptor).
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

function SidebarSection({ title, children, empty = "" }) {
  return (
    <SurfaceRailSection className="gh-discovery-sidebar-section" empty={empty} title={title}>
      {children}
    </SurfaceRailSection>
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
  // Workflow state mapped to target copy (Published / In Review / Obsolete).
  // Certification signals map as follows:
  //   - "Certified" / explicit "Published" / "Enterprise" → PUBLISHED (green)
  //   - "Pending" / "In Review" / "Draft" → IN REVIEW (yellow)
  //   - "Deprecated" / "Retired" → OBSOLETE (red)
  //   - everything else falls through to a neutral "PUBLISHED" optimistic
  //     default so a freshly-discovered asset doesn't read as broken just
  //     because the governance workflow hasn't moved it yet.
  const rawWorkflowState = asset.governanceStatus || (gaps.length >= 3 ? "In Review" : "Published");
  const workflowLabel = /publish|enterpri|certified/i.test(rawWorkflowState)
    ? "PUBLISHED"
    : /review|pending|draft/i.test(rawWorkflowState)
      ? "IN REVIEW"
      : /deprecated|retired|obsolete/i.test(rawWorkflowState)
        ? "OBSOLETE"
        : /work|miss|gap/i.test(rawWorkflowState)
          ? "IN REVIEW"
          : "PUBLISHED";
  const workflowVariant = workflowLabel === "PUBLISHED"
    ? "published"
    : workflowLabel === "OBSOLETE"
      ? "obsolete"
      : "in-review";
  // Coverage / trust score: softer language so low-metadata catalogs don't
  // read as broken. We show "Coverage X%" with three tiered tones.
  const coverageScore = Math.round(Number(asset.coverageScore || 0));
  const coverageTone = coverageScore >= 75 ? "is-high" : coverageScore >= 40 ? "is-mid" : "is-low";
  const coverageLabel = coverageScore > 0 ? `Coverage ${coverageScore}%` : "Coverage pending";
  const viewCount = Number(asset.viewCount || asset.usage?.views || 0);
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
      onMouseEnter={() => onHoverPreview?.(asset.fqn)}
      onMouseLeave={() => onHoverEnd?.()}
      role="button"
      tabIndex={0}
    >
      <header className="gh-discovery-asset-card-head">
        <div className="gh-discovery-asset-card-kind">
          <AssetTypeIcon asset={asset} size="sm" />
          <span>{objectType || "Asset"}</span>
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
          <button
            aria-label="Open Governance"
            className="gh-discovery-asset-card-more gh-row-action"
            disabled={recordUnavailable}
            onClick={stop(() => onOpenGovernance(asset.fqn))}
            title={recordUnavailable ? recordUnavailableReason : "Open governance"}
            type="button"
          >
            ⋮
          </button>
        </div>
      </header>

      <h3 className="gh-discovery-asset-card-title" title={asset.name}>
        {asset.name}
      </h3>

      <div className="gh-discovery-asset-card-primary-meta">
        {asset.domain && asset.domain !== "Unassigned" ? (
          <span className="gh-discovery-asset-pill gh-discovery-asset-pill-domain" title={`Domain: ${asset.domain}`}>
            {String(asset.domain).toUpperCase()} DATA
          </span>
        ) : null}
        {primaryOwner ? (
          <span className="gh-discovery-asset-owner-chip" title={ownerLabels.join(", ")}>
            <OwnerAvatar owner={primaryOwner} size={22} />
            <span className="gh-discovery-asset-owner-name">{prettyOwnerName(primaryOwner)}</span>
            {ownerCount > 1 ? (
              <span className="gh-discovery-asset-owner-extra">+{ownerCount - 1}</span>
            ) : null}
          </span>
        ) : (
          <span className="gh-discovery-asset-owner-chip gh-discovery-asset-owner-chip-empty">
            <span aria-hidden="true" className="gh-discovery-asset-owner-placeholder">?</span>
            <span className="gh-discovery-asset-owner-name">No owner</span>
          </span>
        )}
      </div>

      <div className="gh-discovery-asset-card-chips">
        {visibleTags.map((tag) => (
          <span
            className="gh-discovery-asset-tag"
            data-tag={String(tag).toLowerCase()}
            key={`tag-${tag}`}
          >
            {tag}
          </span>
        ))}
        {glossaryTerms.slice(0, 1).map((term) => (
          <span className="gh-discovery-asset-tag is-glossary" key={`glo-${term}`}>
            <span aria-hidden="true">☰</span> {term}
          </span>
        ))}
        {extraTagCount > 0 ? (
          <span className="gh-discovery-asset-tag is-overflow">+{extraTagCount}</span>
        ) : null}
        <span className="gh-discovery-asset-chip-spacer" aria-hidden="true" />
        <span
          className={`gh-discovery-asset-status gh-discovery-asset-status-${workflowVariant}`}
          title={`Workflow state: ${workflowLabel}`}
        >
          {workflowLabel}
        </span>
      </div>

      <div className="gh-discovery-asset-card-usage">
        <span className="gh-discovery-asset-usage-item" title={`${notebookUsage} notebook usage`}>
          <span aria-hidden="true" className="gh-discovery-asset-usage-icon">▤</span>
          {notebookUsage} notebook usage
        </span>
        <span className="gh-discovery-asset-usage-item" title={`${viewCount} view${viewCount === 1 ? "" : "s"}`}>
          <span aria-hidden="true" className="gh-discovery-asset-usage-icon">⊙</span>
          {viewCount} view{viewCount === 1 ? "" : "s"}
        </span>
        <span className="gh-discovery-asset-chip-spacer" aria-hidden="true" />
        <span
          className={`gh-discovery-asset-trust ${coverageTone}`}
          title={`Metadata coverage: ${coverageScore}%`}
        >
          {coverageLabel}
        </span>
      </div>

      <p className="gh-discovery-asset-card-description">
        {description || "No description has been captured for this asset yet."}
      </p>

      <footer className="gh-discovery-asset-card-foot">
        <span className="gh-discovery-asset-foot-updated" title={asset.updatedAt || "Unknown"}>
          {updatedLabel ? `Updated ${updatedLabel}` : "No recent updates"}
        </span>
        <div className="gh-discovery-asset-card-foot-actions">
          <button
            aria-label={lineageAvailable ? "Open Lineage" : "Lineage unavailable"}
            className="gh-discovery-asset-foot-icon gh-row-action"
            disabled={!lineageAvailable}
            onClick={stop(() => onOpenLineage(asset.fqn, "Data Lineage"))}
            title={lineageAvailable ? "Open lineage" : lineageUnavailableReason}
            type="button"
          >
            ⇄
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
        </div>
      </footer>

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
  // Curated primary facets that mirror the target mockup: a small row of
  // asset-type-shaped pills with counts, always visible above the results.
  const primary = [
    { key: "Delta Table", label: "Tables" },
    { key: "View", label: "Views" },
    { key: "Materialized View", label: "Materialized" },
    { key: "Streaming Table", label: "Streaming" },
  ];
  const entries = primary
    .map((entry) => ({
      ...entry,
      count: Number(assetTypeCounts[entry.key] || 0),
    }))
    .filter((entry) => entry.count > 0);
  const typeFilters = Array.isArray(filters.types) ? filters.types : [];

  return (
    <div className="gh-primary-facet-row" role="group" aria-label="Quick asset-type filters">
      {entries.map((entry) => {
        const active = typeFilters.includes(entry.key);
        return (
          <button
            aria-pressed={active}
            className={`gh-primary-facet-chip ${active ? "is-active" : ""}`.trim()}
            key={entry.key}
            onClick={() =>
              onDiscoveryStateChange((current) => {
                const currentTypes = Array.isArray(current.types) ? current.types : [];
                const nextTypes = currentTypes.includes(entry.key)
                  ? currentTypes.filter((t) => t !== entry.key)
                  : [...currentTypes, entry.key];
                return { ...current, types: nextTypes };
              })
            }
            type="button"
          >
            <span className="gh-primary-facet-chip-label">{entry.label}</span>
            <span className="gh-primary-facet-chip-count">
              ({entry.count.toLocaleString()})
            </span>
            {active ? (
              <span className="gh-primary-facet-chip-x" aria-hidden="true">×</span>
            ) : null}
          </button>
        );
      })}
      {obsoleteCount > 0 ? (
        <button
          className="gh-primary-facet-chip is-ghost"
          onClick={() =>
            onDiscoveryStateChange((current) => ({
              ...current,
              certifications: ["Deprecated"],
            }))
          }
          type="button"
        >
          <span className="gh-primary-facet-chip-label">Obsolete</span>
          <span className="gh-primary-facet-chip-count">
            ({Number(obsoleteCount).toLocaleString()})
          </span>
        </button>
      ) : null}
      <div className="gh-primary-facet-spacer" />
      <button
        className="gh-primary-facet-launch"
        onClick={onOpenFilters}
        title="Open detailed filters"
        type="button"
      >
        <span aria-hidden="true" className="gh-primary-facet-launch-icon">⚲</span>
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

  if (!previewAvailable) {
    return (
      <SurfaceRail
        className="gh-selection-preview"
        data-asset-fqn={asset.fqn}
        eyebrow="Selected Asset"
        identity={assetPathLabel(asset, true)}
        title={asset.name}
        titleMeta={
          asset.governanceStatus ? (
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus}
            </span>
          ) : null
        }
        actions={previewActions}
      >
        {recordUnavailable ? (
          <div className="gh-support-copy gh-selection-preview-record-state">
            {recordUnavailableReason}
          </div>
        ) : null}
        <WorkspaceStateCard
          eyebrow="Preview unavailable"
          message={previewUnavailableReason}
          title="Live preview rows and schema are unavailable for this workspace."
        />
      </SurfaceRail>
    );
  }

  const shortDescription = String(asset.description || "").trim();
  const glossaryLabels = Array.isArray(asset.glossaryTerms)
    ? asset.glossaryTerms.map((t) => t?.label || t?.name || t).filter(Boolean)
    : [];
  const schemaChipColumns = (asset.columns || []).slice(0, 6);
  const totalColumnCount = asset.columns?.length || 0;
  const viewCount = Number(asset.viewCount || asset.usage?.views || 0);
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

  return (
    <SurfaceRail
      className="gh-selection-preview gh-selection-preview-collapsed-head"
      data-asset-fqn={asset.fqn}
      eyebrow="Selected Asset"
      identity={assetPathLabel(asset, true)}
      title={asset.name}
      titleMeta={
        asset.governanceStatus ? (
          <span className={`gh-status-chip tone-${statusTone(asset)}`}>
            {asset.governanceStatus}
          </span>
        ) : null
      }
      actions={previewActions}
    >
      {detailError ? <InlineStatusBanner message={detailError} title="Preview degraded" /> : null}
      {detailLoading ? <div className="gh-support-copy">Refreshing live header and schema metadata...</div> : null}
      {recordUnavailable ? (
        <div className="gh-support-copy gh-selection-preview-record-state">
          {recordUnavailableReason}
        </div>
      ) : null}

      <div className="gh-asset-preview">
        {/* 1 — Header row: small square icon + asset name + close X */}
        <div className="gh-asset-preview-header">
          <div className="gh-asset-preview-header-icon">
            <AssetTypeIcon asset={asset} size="sm" />
          </div>
          <div className="gh-asset-preview-header-name gh-truncate" title={asset.name}>
            {asset.name}
          </div>
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

        {/* 2 — Description block (2-line clamp) */}
        <div className="gh-asset-preview-description gh-support-copy">
          {shortDescription || "No description is available for this asset yet."}
        </div>

        {/* 3 — 2×2 action grid */}
        <div className="gh-asset-preview-action-grid">
          <button
            className="gh-primary-button"
            disabled={recordUnavailable}
            onClick={() => onOpenAsset(asset.fqn, "Overview")}
            title={recordUnavailable ? recordUnavailableReason : undefined}
            type="button"
          >
            View Details
          </button>
          <button
            className="gh-secondary-button"
            disabled={recordUnavailable}
            onClick={() => onOpenGovernance(asset.fqn)}
            title={recordUnavailable ? recordUnavailableReason : undefined}
            type="button"
          >
            Request Access
          </button>
          <button
            className="gh-secondary-button"
            disabled={!lineageAvailable}
            onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
            title={!lineageAvailable ? lineageUnavailableReason : undefined}
            type="button"
          >
            Add to Lineage
          </button>
          <button
            aria-pressed={isFavorite}
            className={`gh-secondary-button ${isFavorite ? "is-favorite" : ""}`}
            onClick={() => onToggleFavorite?.(asset.fqn)}
            type="button"
          >
            {isFavorite ? "★ Favorited" : "Mark as Favorite"}
          </button>
        </div>

        {/* 4 — Metadata label/value rows */}
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
                {asset.domain && asset.domain !== "Unassigned" ? (
                  <span className="gh-labeled-pill">{asset.domain}</span>
                ) : (
                  <span className="gh-support-copy">Unassigned</span>
                )}
              </dd>
            </div>
            <div className="gh-asset-preview-metadata-row">
              <dt>Glossary term</dt>
              <dd>
                {glossaryLabels.length ? (
                  <span className="gh-labeled-pill">{glossaryLabels[0]}</span>
                ) : (
                  <span className="gh-support-copy">No term linked</span>
                )}
              </dd>
            </div>
            <div className="gh-asset-preview-metadata-row">
              <dt>Description</dt>
              <dd className="gh-asset-preview-metadata-description">
                {shortDescription || "—"}
              </dd>
            </div>
          </dl>
        </section>

        {/* 5 — Schema overview (first 4-6 column name chips) */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title">Schema overview</div>
          {schemaChipColumns.length ? (
            <div className="gh-asset-preview-schema-chips">
              {schemaChipColumns.map((column) => (
                <span className="gh-chip gh-chip-soft" key={column.name} title={column.type || ""}>
                  {column.name}
                </span>
              ))}
              {totalColumnCount > schemaChipColumns.length ? (
                <span className="gh-chip gh-chip-soft gh-asset-preview-schema-more">
                  +{totalColumnCount - schemaChipColumns.length}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="gh-support-copy">
              {detailLoading ? "Loading live schema metadata..." : "No schema metadata surfaced."}
            </div>
          )}
        </section>

        {/* 6 — Simplified lineage preview (upstream → current) */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title">Lineage preview</div>
          {lineageAvailable ? (
            <div className="gh-lineage-mini-preview">
              <span className="gh-lineage-mini-pill" title={previewRelatedAssets[0] || "upstream"}>
                {upstreamLabel}
              </span>
              <span aria-hidden="true" className="gh-lineage-mini-arrow">→</span>
              <span className="gh-lineage-mini-pill is-current" title={asset.fqn}>
                {currentLabel}
              </span>
            </div>
          ) : (
            <div className="gh-support-copy">Lineage preview not available for this asset.</div>
          )}
        </section>

        {/* 7 — Usage metrics (two numbers side-by-side) */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title">Usage metrics</div>
          <div className="gh-asset-preview-usage-grid">
            <div className="gh-asset-preview-usage-cell">
              <div className="gh-asset-preview-usage-number">{viewCount}</div>
              <div className="gh-asset-preview-usage-label">Views</div>
            </div>
            <div className="gh-asset-preview-usage-cell">
              <div className="gh-asset-preview-usage-number">{notebookUsage}</div>
              <div className="gh-asset-preview-usage-label">Notebook usage</div>
            </div>
          </div>
        </section>

        {/* Connected assets — stewardship navigation. Keeps the
            historical .gh-lineage-linked-row button/div markup so
            existing linked-open integration tests stay green. */}
        {previewRelatedAssets.length ? (
          <section className="gh-asset-preview-section">
            <div className="gh-panel-title">Connected assets</div>
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
          </section>
        ) : null}

        {/* 8 — Associated tasks (single checkbox row) */}
        <section className="gh-asset-preview-section">
          <div className="gh-panel-title">Associated tasks</div>
          <label className="gh-asset-preview-task-row">
            <input type="checkbox" readOnly />
            <span>{associatedTask}</span>
          </label>
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
  const [selectedSchema, setSelectedSchema] = useState(null);
  const [ownerFilterText, setOwnerFilterText] = useState("");
  const [glossaryFilterText, setGlossaryFilterText] = useState("");
  const [discoverySubView, setDiscoverySubView] = useState("discovery"); // "discovery" | "navigation"
  const toggleCatalogExpanded = (catalog) => {
    setExpandedCatalogs((current) => {
      const next = new Set(current);
      if (next.has(catalog)) next.delete(catalog); else next.add(catalog);
      return next;
    });
  };
  const pickSchema = (catalog, schema) => {
    setSelectedSchema((current) => {
      if (current?.catalog === catalog && current?.schema === schema) return null;
      return { catalog, schema };
    });
  };
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
  const allDiscoveryAssets = suppressCatalogRows ? [] : discoveryResults.assets;
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
  // Build the catalog/schema tree from the full visible inventory so
  // the left rail is stable regardless of which schema is picked.
  const catalogSchemaTree = useMemo(() => {
    const counts = new Map();
    for (const entry of allDiscoveryAssets) {
      const catalog = entry?.catalog || "unknown";
      const schema = entry?.schema || "unknown";
      if (!counts.has(catalog)) counts.set(catalog, new Map());
      const schemaMap = counts.get(catalog);
      schemaMap.set(schema, (schemaMap.get(schema) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([catalog, schemaMap]) => ({
        catalog,
        count: [...schemaMap.values()].reduce((a, b) => a + b, 0),
        schemas: [...schemaMap.entries()]
          .map(([schema, count]) => ({ schema, count }))
          .sort((a, b) => a.schema.localeCompare(b.schema)),
      }))
      .sort((a, b) => a.catalog.localeCompare(b.catalog));
  }, [allDiscoveryAssets]);
  // Apply the (catalog,schema) pick + owner/glossary free-text filters as
  // client-side scopes on the result list without round-tripping through
  // the discovery search contract.
  const renderableDiscoveryAssets = useMemo(() => {
    let list = allDiscoveryAssets;
    if (selectedSchema) {
      const { catalog, schema } = selectedSchema;
      list = list.filter((entry) => entry?.catalog === catalog && entry?.schema === schema);
    }
    const ownerNeedle = ownerFilterText.trim().toLowerCase();
    if (ownerNeedle) {
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
  }, [allDiscoveryAssets, selectedSchema, ownerFilterText, glossaryFilterText]);
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
    sections: ["header", "schema"],
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
      <section className="gh-discovery-main gh-discovery-main-grid">
        <SurfaceRail
          className="gh-discovery-sidebar"
          eyebrow="Filters"
          identity={`${visibleAssetsSummary} visible`}
          title="Filters"
        >
          <SidebarSection title="Asset Types">
            {assetTypeOptions.length ? (
              <div className="gh-category-list">
                {assetTypeOptions.map((option) => (
                  <button
                    className={`gh-category-row ${
                      option === "All types" ? (!filters.types.length ? "is-active" : "") : filters.types.includes(option) ? "is-active" : ""
                    }`}
                    key={option}
                    onClick={() => toggleMulti(filters, "types", option, "All types", onDiscoveryStateChange)}
                    type="button"
                  >
                    <span>{option}</span>
                    {showLiveFacetCounts ? (
                      <span className="gh-category-count">
                        {liveAssetTypeCounts[option] ?? facetCount(resultsFacets, "assetTypes", option)}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="gh-support-copy">Asset types populate from live discovery facets.</div>
            )}
          </SidebarSection>

          {(() => {
            const domainOptions = facetValues(resultsFacets, "domains", [], filters.domains || []);
            if (!domainOptions.length) return null;
            return (
              <SidebarSection title="Domain">
                <div className="gh-category-list">
                  {domainOptions.slice(0, 8).map((option) => (
                    <button
                      className={`gh-category-row ${(filters.domains || []).includes(option) ? "is-active" : ""}`}
                      key={option}
                      onClick={() => toggleMulti(filters, "domains", option, null, onDiscoveryStateChange)}
                      type="button"
                    >
                      <span>{option}</span>
                      {showLiveFacetCounts ? (
                        <span className="gh-category-count">
                          {facetCount(resultsFacets, "domains", option)}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </SidebarSection>
            );
          })()}

          {(() => {
            const sensitivityOptions = facetValues(
              resultsFacets,
              "sensitivities",
              ["PII", "Confidential", "Internal"],
              filters.sensitivities || [],
            );
            if (!sensitivityOptions.length) return null;
            return (
              <SidebarSection title="Sensitivity">
                <div className="gh-discovery-chip-row">
                  {sensitivityOptions.slice(0, 6).map((option) => {
                    const active = (filters.sensitivities || []).includes(option);
                    return (
                      <button
                        aria-pressed={active}
                        className={`gh-chip ${active ? "gh-chip-accent" : "gh-chip-soft"}`}
                        key={option}
                        onClick={() => toggleMulti(filters, "sensitivities", option, null, onDiscoveryStateChange)}
                        title={`Toggle ${option} sensitivity filter`}
                        type="button"
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </SidebarSection>
            );
          })()}

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
                    ? "Obsolete"
                    : option;
            return (
              <SidebarSection title="Workflow State">
                <div className="gh-category-list">
                  {certOptions.slice(0, 6).map((option) => {
                    const active = (filters.certifications || []).includes(option);
                    return (
                      <button
                        className={`gh-category-row ${active ? "is-active" : ""}`}
                        key={option}
                        onClick={() => toggleMulti(filters, "certifications", option, null, onDiscoveryStateChange)}
                        type="button"
                      >
                        <span>{workflowLabelFor(option)}</span>
                        {showLiveFacetCounts ? (
                          <span className="gh-category-count">
                            {facetCount(resultsFacets, "certifications", option)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </SidebarSection>
            );
          })()}

          <SidebarSection title="Owner">
            <input
              aria-label="Filter by owner email or name"
              className="gh-sidebar-input"
              onChange={(event) => setOwnerFilterText(event.target.value)}
              placeholder="User / team email"
              type="text"
              value={ownerFilterText}
            />
          </SidebarSection>

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

          <SidebarSection title="Saved Views">
            <div className="gh-saved-view-list">
              {bootstrap.discovery.views.map((view) => (
                <button
                  className={`gh-saved-view ${
                    view === "All assets" ? (!filters.views.length ? "is-active" : "") : filters.views.includes(view) ? "is-active" : ""
                  }`}
                  key={view}
                  onClick={() => toggleMulti(filters, "views", view, "All assets", onDiscoveryStateChange)}
                  type="button"
                >
                  <span>{view}</span>
                  <span className="gh-category-count">
                    {showLiveFacetCounts
                      ? (savedViewCounts[view] ?? facetCount(resultsFacets, "views", view))
                      : "—"}
                  </span>
                </button>
              ))}
            </div>
          </SidebarSection>

          <SidebarSection title="Catalog">
            {catalogSchemaTree.length ? (
              <div className="gh-catalog-tree" role="tree" aria-label="Catalog navigation">
                {catalogSchemaTree.slice(0, 6).map((entry) => {
                  const catalogActive =
                    (filters.catalogs || []).includes(entry.catalog) ||
                    selectedSchema?.catalog === entry.catalog;
                  const expanded = expandedCatalogs.has(entry.catalog) || catalogActive;
                  return (
                    <div className="gh-catalog-tree-entry" key={entry.catalog}>
                      <label
                        className={`gh-catalog-tree-row gh-catalog-tree-catalog-row ${catalogActive ? "is-active" : ""}`.trim()}
                      >
                        <input
                          aria-label={`Filter to catalog ${entry.catalog}`}
                          checked={catalogActive}
                          className="gh-catalog-tree-checkbox"
                          onChange={() => {
                            toggleCatalogExpanded(entry.catalog);
                            toggleMulti(
                              filters,
                              "catalogs",
                              entry.catalog,
                              null,
                              onDiscoveryStateChange,
                            );
                          }}
                          type="checkbox"
                        />
                        <span className="gh-catalog-tree-label">{entry.catalog}</span>
                        <span className="gh-catalog-tree-count">({entry.count.toLocaleString()})</span>
                      </label>
                      {expanded ? (
                        <div className="gh-catalog-tree-schemas">
                          {entry.schemas.slice(0, 8).map((schemaEntry) => {
                            const active =
                              selectedSchema?.catalog === entry.catalog &&
                              selectedSchema?.schema === schemaEntry.schema;
                            return (
                              <button
                                aria-pressed={active}
                                className={`gh-catalog-tree-row gh-catalog-tree-schema-row ${active ? "is-active" : ""}`.trim()}
                                key={schemaEntry.schema}
                                onClick={() => pickSchema(entry.catalog, schemaEntry.schema)}
                                type="button"
                                title={`Filter to ${entry.catalog}.${schemaEntry.schema}`}
                              >
                                <span className="gh-catalog-tree-schema-indent" aria-hidden="true" />
                                <span className="gh-catalog-tree-label">{schemaEntry.schema}</span>
                                <span className="gh-catalog-tree-count">
                                  ({schemaEntry.count.toLocaleString()})
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {selectedSchema ? (
                  <button
                    className="gh-tertiary-button gh-catalog-tree-clear"
                    onClick={() => setSelectedSchema(null)}
                    type="button"
                  >
                    Clear schema filter
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="gh-support-copy">Catalog tree will populate from visible inventory.</div>
            )}
          </SidebarSection>
        </SurfaceRail>

        <section className="gh-results-column">
          <DiscoveryBreadcrumb
            onClear={() => setSelectedSchema(null)}
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
            onClearSchemaFilter={() => setSelectedSchema(null)}
            onDiscoveryStateChange={onDiscoveryStateChange}
            schemaFilter={selectedSchema}
          />
          <div className="gh-panel gh-discovery-command-panel" ref={filterCommandRef}>
            <div className="gh-discovery-subtabs-row" role="tablist" aria-label="Discovery view">
              <div className="gh-sub-tab-row">
                <button
                  aria-selected={discoverySubView === "discovery"}
                  className={`gh-sub-tab ${discoverySubView === "discovery" ? "is-active" : ""}`}
                  onClick={() => setDiscoverySubView("discovery")}
                  role="tab"
                  type="button"
                >
                  Discovery
                </button>
                <button
                  aria-selected={discoverySubView === "navigation"}
                  className={`gh-sub-tab ${discoverySubView === "navigation" ? "is-active" : ""}`}
                  onClick={() => setDiscoverySubView("navigation")}
                  role="tab"
                  type="button"
                >
                  Navigation
                </button>
              </div>
            </div>
            <div className="gh-discovery-command-head-v2">
              <div className="gh-discovery-command-heading">
                <h2 className="gh-discovery-command-title">
                  {discoverySubView === "navigation" ? "Navigation" : "Discovery"}
                </h2>
                <div className="gh-discovery-command-subline">
                  {showLiveFacetCounts ? (
                    <>
                      Showing <strong>{Math.min(renderedDiscoveryAssets.length, resultsCount)}</strong>
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
                    value={filters.sortBy}
                  >
                    {bootstrap.discovery.sortOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  aria-label={directFilterCount ? `Stack Filters (${directFilterCount})` : "Stack Filters"}
                  className={`gh-secondary-button gh-discovery-stack-trigger ${showAdvancedFilters ? "is-active" : ""}`}
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                  aria-controls="gh-discovery-filter-popover"
                  aria-expanded={showAdvancedFilters}
                  aria-haspopup="dialog"
                  type="button"
                >
                  <span aria-hidden="true">⚲ </span>
                  Stack Filters {directFilterCount ? `(${directFilterCount})` : ""}
                </button>
              </div>
            </div>

            <div className="gh-discovery-toolbar-shell">
              <div className="gh-discovery-toolbar gh-discovery-toolbar-simple">
                <input
                  className="gh-input gh-discovery-toolbar-search"
                  onChange={(event) =>
                    onDiscoveryStateChange((current) => ({
                      ...current,
                      query: event.target.value,
                    }))
                  }
                  placeholder="Filter visible assets by name, schema, owner, domain, or tag"
                  value={filters.query}
                />
                <div
                  aria-label="Result density"
                  className="gh-discovery-density-toggle"
                  role="group"
                >
                  {[
                    { key: "compact", label: "Compact" },
                    { key: "normal", label: "Normal" },
                    { key: "spacious", label: "Spacious" },
                  ].map((option) => (
                    <button
                      aria-pressed={density === option.key}
                      className={`gh-tertiary-button gh-discovery-density-option ${density === option.key ? "is-active" : ""}`.trim()}
                      key={option.key}
                      onClick={() => setDensity(option.key)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  aria-label="Copy a shareable link to this filtered view"
                  className="gh-secondary-button gh-secondary-button-compact"
                  onClick={async () => {
                    if (typeof window === "undefined") return;
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      setNavigationNotice("Filter link copied to clipboard.");
                      window.setTimeout(() => setNavigationNotice(""), 2200);
                    } catch {
                      setNavigationNotice("Copy not permitted by browser.");
                    }
                  }}
                  title="Copy link to this filter view"
                  type="button"
                >
                  Copy link
                </button>
              </div>
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
            <InlineStatusBanner message={resultsError} title="Discovery search degraded" />
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
          ) : discoverySubView === "navigation" ? (
            <div className="gh-navigation-grid" role="region" aria-label="Catalog navigation">
              {catalogSchemaTree.length ? (
                catalogSchemaTree.map((entry) => (
                  <div className="gh-navigation-catalog" key={entry.catalog}>
                    <div className="gh-navigation-catalog-head">
                      <span className="gh-navigation-catalog-name">{entry.catalog}</span>
                      <span className="gh-navigation-catalog-count">{entry.count} assets</span>
                    </div>
                    <div className="gh-navigation-schema-grid">
                      {entry.schemas.map((schemaEntry) => {
                        const active =
                          selectedSchema?.catalog === entry.catalog &&
                          selectedSchema?.schema === schemaEntry.schema;
                        return (
                          <button
                            aria-pressed={active}
                            className={`gh-navigation-schema-card ${active ? "is-active" : ""}`.trim()}
                            key={schemaEntry.schema}
                            onClick={() => {
                              pickSchema(entry.catalog, schemaEntry.schema);
                              setDiscoverySubView("discovery");
                            }}
                            title={`Open ${entry.catalog}.${schemaEntry.schema} in Discovery`}
                            type="button"
                          >
                            <span className="gh-navigation-schema-name">{schemaEntry.schema}</span>
                            <span className="gh-navigation-schema-count">{schemaEntry.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="gh-support-copy">
                  Navigation will populate once the catalog is live.
                </div>
              )}
            </div>
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
              title={resultsError}
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
