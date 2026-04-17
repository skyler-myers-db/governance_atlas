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
    `Coverage ${asset.coverageScore == null ? "—" : asset.coverageScore}`,
    `${asset.owners?.length || 0} owners`,
    asset.openRequests == null ? "Requests —" : `${asset.openRequests} requests`,
    asset.domain || "Unassigned domain",
    asset.tier || "Unassigned tier",
    asset.certification || "Unassigned certification",
  ];
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

function FilterSection({ label, options, selected, allLabel, emptyMessage = "", onToggle }) {
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
            return (
              <label className={`gh-filter-check ${checked ? "is-active" : ""}`} key={option}>
                <input checked={checked} onChange={() => onToggle(option, allLabel)} type="checkbox" />
                <span>{option}</span>
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

function PreviewSection({ title = "", children, empty = "" }) {
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
  lineageAvailable = true,
  lineageUnavailableReason = "",
  recordOpenable = null,
  recordUnavailableReason = "",
}) {
  const owners = (asset.owners || []).map((owner) => ownerLabel(owner)).filter(Boolean).slice(0, 2);
  const metaItems = resultMetaItems(asset);
  const objectType = displayObjectType(asset);
  const recordUnavailable = recordOpenable === false;

  return (
    <article
      className={`gh-discovery-result-row ${selected ? "is-selected" : ""}`}
      data-asset-fqn={asset.fqn}
    >
      <button
        className="gh-discovery-result-hit"
        onClick={() => onSelect(asset.fqn)}
        type="button"
      >
        <div className="gh-discovery-result-head">
          <div className="gh-discovery-result-title-block">
            <div className="gh-discovery-result-title-row">
              <h3>{asset.name}</h3>
              {objectType ? <span className="gh-chip gh-chip-soft">{objectType}</span> : null}
              {asset.sensitivity && asset.sensitivity !== "Unassigned" ? (
                <span className="gh-chip gh-chip-soft">{asset.sensitivity}</span>
              ) : null}
            </div>
            <div className="gh-discovery-result-fqn">{assetPathLabel(asset)}</div>
          </div>
          {asset.governanceStatus ? (
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus}
            </span>
          ) : null}
        </div>

        <p className="gh-discovery-result-description">
          {asset.description || "No description is available for this asset yet."}
        </p>

        <div className="gh-discovery-result-meta">
          {metaItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>

        {owners.length ? (
          <div className="gh-chip-row gh-discovery-result-owner-row">
            {owners.map((owner) => (
              <span className="gh-chip gh-chip-soft" key={owner}>
                {owner}
              </span>
            ))}
          </div>
        ) : null}
      </button>

      <div className="gh-action-grid gh-discovery-action-grid">
        <button
          className="gh-secondary-button gh-secondary-button-compact"
          disabled={recordUnavailable}
          onClick={() => onOpenAsset(asset.fqn)}
          title={recordUnavailable ? recordUnavailableReason : undefined}
          type="button"
        >
          {recordUnavailable ? "Metadata record unavailable" : "Open Record"}
        </button>
        <button
          className="gh-secondary-button gh-secondary-button-compact"
          disabled={!lineageAvailable}
          onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
          title={!lineageAvailable ? lineageUnavailableReason : undefined}
          type="button"
        >
          {lineageAvailable ? "Open Lineage" : "Lineage unavailable"}
        </button>
        <button
          className="gh-secondary-button gh-secondary-button-compact"
          disabled={recordUnavailable}
          onClick={() => onOpenGovernance(asset.fqn)}
          title={recordUnavailable ? recordUnavailableReason : undefined}
          type="button"
        >
          Open Governance
        </button>
      </div>
      {recordUnavailable ? (
        <div className="gh-support-copy gh-discovery-record-state">
          {recordUnavailableReason}
        </div>
      ) : null}
    </article>
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
      {detailError ? <InlineStatusBanner message={detailError} title="Preview degraded" /> : null}
      {detailLoading ? <div className="gh-support-copy">Refreshing live header and schema metadata...</div> : null}
      {recordUnavailable ? (
        <div className="gh-support-copy gh-selection-preview-record-state">
          {recordUnavailableReason}
        </div>
      ) : null}

      <PreviewSection title="Definition">
        <div className="gh-support-copy">
          {asset.description || "No description is available for this asset yet."}
        </div>
      </PreviewSection>

      <PreviewSection>
        <PreviewProfileList items={signalItems} />
      </PreviewSection>

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
          </div>
        ) : null}
      </PreviewSection>

      <PreviewSection
        title="Connected Assets"
        empty={
          !lineageAvailable
            ? lineageUnavailableReason
            : lineage.loading || lineageProvisional
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
    </SurfaceRail>
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
  const [selectedAssetFqn, setSelectedAssetFqn] = useState("");
  const [visibleResultCount, setVisibleResultCount] = useState(DISCOVERY_RESULT_PAGE_SIZE);
  const [navigationNotice, setNavigationNotice] = useState("");
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
  const renderableDiscoveryAssets = suppressCatalogRows ? [] : discoveryResults.assets;
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
  const renderedDiscoveryAssets = useMemo(
    () => renderableDiscoveryAssets.slice(0, effectiveVisibleResultCount),
    [effectiveVisibleResultCount, renderableDiscoveryAssets],
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
          eyebrow="Discovery Scope"
          identity="Layer asset type, saved view, catalog, and stacked filters without leaving the catalog."
          title="Browse Asset Types and Filters"
          titleMeta={<span className="gh-chip gh-chip-soft">{visibleAssetsSummary} visible</span>}
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
                      <span className="gh-category-count">{facetCount(resultsFacets, "assetTypes", option)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="gh-support-copy">Asset types populate from live discovery facets.</div>
            )}
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
                    {showLiveFacetCounts ? facetCount(resultsFacets, "views", view) : "—"}
                  </span>
                </button>
              ))}
            </div>
          </SidebarSection>

          <SidebarSection title="Catalogs in Scope">
            {catalogOptions.length ? (
              <div className="gh-chip-stack">
                {catalogOptions.map((catalog) => (
                  <button
                    className={`gh-chip gh-chip-soft ${
                      filters.catalogs.includes(catalog) ? "gh-chip-selected" : ""
                    }`}
                    key={catalog}
                    onClick={() => toggleMulti(filters, "catalogs", catalog, "All catalogs", onDiscoveryStateChange)}
                    type="button"
                    title={`Filter to ${catalog}`}
                  >
                    {catalog}
                    {showLiveFacetCounts ? (
                      <span className="gh-chip-count-inline">{facetCount(resultsFacets, "catalogs", catalog)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="gh-support-copy">Catalog scope will populate from visible inventory.</div>
            )}
          </SidebarSection>
        </SurfaceRail>

        <section className="gh-results-column">
          <div className="gh-panel gh-discovery-command-panel" ref={filterCommandRef}>
            <SurfaceHeader
              actions={(
                <span className="gh-results-inline-state gh-results-inline-state-bar">
                  {showLiveFacetCounts ? (
                    <>
                      {resultsCount} {resultsCount === 1 ? "result" : "results"}
                    </>
                  ) : (
                    <span className="gh-results-inline-loading">Loading…</span>
                  )}
                  {resultsLoading && showLiveFacetCounts ? (
                    <span className="gh-inline-updating">Updating…</span>
                  ) : null}
                </span>
              )}
              className="gh-discovery-command-head"
              eyebrow="Discovery"
              variant="featured"
              title="Metadata Catalog"
            >
              <div className="gh-discovery-results-copy">
                Filter visible assets with stacked search, saved views, and facet filters.
              </div>
            </SurfaceHeader>

            <div className="gh-discovery-toolbar-shell">
              <div className="gh-discovery-toolbar">
                <input
                  className="gh-input"
                  onChange={(event) =>
                    onDiscoveryStateChange((current) => ({
                      ...current,
                      query: event.target.value,
                    }))
                  }
                  placeholder="Filter visible assets by name, schema, owner, domain, or tag"
                  value={filters.query}
                />
                <div className="gh-discovery-sort">
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
                </div>
                <div className="gh-discovery-toolbar-actions">
                  <button
                    className={`gh-secondary-button gh-discovery-stack-trigger ${showAdvancedFilters ? "is-active" : ""}`}
                    onClick={() => setShowAdvancedFilters((current) => !current)}
                    aria-controls="gh-discovery-filter-popover"
                    aria-expanded={showAdvancedFilters}
                    aria-haspopup="dialog"
                    type="button"
                  >
                    Stack Filters {directFilterCount ? `(${directFilterCount})` : ""}
                  </button>
                </div>
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
          ) : hasRenderableResults ? (
            <div className="gh-result-list gh-discovery-card-list">
              {renderedDiscoveryAssets.map((asset) => (
                <DiscoveryResultCard
                  asset={asset}
                  key={asset.fqn}
                  lineageAvailable={lineageSurfaceAvailable}
                  lineageUnavailableReason={lineageSurfaceUnavailableReason}
                  onOpenAsset={openAssetRecord}
                  onOpenGovernance={openGovernanceWorkbench}
                  onOpenLineage={openLineageWorkspace}
                  onSelect={handleSelectAsset}
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
                    type="button"
                  >
                    {loadingMoreResults ? "Loading more results…" : "Load more results"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : resultsLoading ? (
            <WorkspaceStateCard
              className="gh-discovery-empty-state"
              eyebrow="Refreshing Catalog"
              loading
              message="Search, filters, and result counts are being refreshed against the live metadata plane."
              title="Loading the latest visible assets for this scope."
            />
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
          linkedRecordUnavailableOverrides={linkedRecordUnavailableOverrides}
          previewAvailable={previewSurfaceAvailable}
          previewUnavailableReason={previewSurfaceUnavailableReason}
          lineageAvailable={lineageSurfaceAvailable}
          lineageUnavailableReason={lineageSurfaceUnavailableReason}
          onOpenAsset={openAssetRecord}
          onOpenGovernance={openGovernanceWorkbench}
          onOpenLinkedAsset={openLinkedAsset}
          onOpenLineage={openLineageWorkspace}
          recordOpenable={selectedPreviewRecordOpenable}
          recordUnavailableReason={DISCOVERY_RECORD_UNAVAILABLE_REASON}
          visibleAssetSet={visibleAssetSet}
        />
      </section>
    </section>
  );
}
