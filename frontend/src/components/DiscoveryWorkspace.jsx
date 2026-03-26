import { useEffect, useRef, useState } from "react";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useLineage } from "../hooks/useLineage";
import { useDiscoveryWorkspace } from "../hooks/useDiscoveryWorkspace";
import { assetPathLabel, displayObjectType } from "../lib/assetPresentation";

function statusTone(asset) {
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

function filterVisibilityCount(filters) {
  return activeFilters(filters).filter((chip) => chip.key !== "query").length;
}

function activeFilters(filters) {
  const chips = [];
  if (filters.query) chips.push({ label: `Search: ${filters.query}`, key: "query" });
  (filters.views || []).forEach((value) => chips.push({ label: value, key: "views" }));
  (filters.types || []).forEach((value) => chips.push({ label: value, key: "types" }));
  ["catalogs", "domains", "tiers", "certifications", "sensitivities"].forEach((key) => {
    (filters[key] || []).forEach((value) => chips.push({ label: value, key }));
  });
  return chips;
}

function resultMetaItems(asset) {
  return [
    `Coverage ${asset.coverageScore ?? 0}`,
    `${asset.owners?.length || 0} owners`,
    `${asset.openRequests || 0} requests`,
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

function previewSignalItems(asset, columnsCount, relatedCount, detailLoading, lineageLoading) {
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
      value: lineageLoading && !relatedCount ? "Loading lineage neighbors..." : relatedCount ? `${relatedCount} linked assets` : "No linked assets surfaced",
    },
  ];
}

function ownerLabel(owner) {
  if (!owner) return "";
  return owner.name || owner.email || owner.title || "";
}

function FilterSection({ label, options, selected, allLabel, onToggle }) {
  const hasSelection = selected.length > 0;
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
        {options
          .filter((option) => option !== allLabel)
          .map((option) => {
            const checked = selected.includes(option);
            return (
              <label className={`gh-filter-check ${checked ? "is-active" : ""}`} key={option}>
                <input checked={checked} onChange={() => onToggle(option, allLabel)} type="checkbox" />
                <span>{option}</span>
              </label>
            );
          })}
      </div>
    </section>
  );
}

function ToggleChipSection({ label, options, selected, allLabel, onToggle }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">{label}</div>
      <div className="gh-filter-choice-row">
        {options.map((option) => (
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
        ))}
      </div>
    </section>
  );
}

function SidebarSection({ title, children }) {
  return (
    <section className="gh-discovery-sidebar-section">
      <div className="gh-panel-title">{title}</div>
      {children}
    </section>
  );
}

function FiltersPopover({ bootstrap, facets, filters, onDiscoveryStateChange, onClose }) {
  return (
    <div className="gh-discovery-filter-popover">
      <div className="gh-discovery-filter-popover-head">
        <div className="gh-panel-title">Filters</div>
        <button className="gh-secondary-button" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <div className="gh-discovery-filter-popover-grid">
        <ToggleChipSection
          allLabel="All types"
          label="Asset type"
          onToggle={(value, allLabel) => toggleMulti(filters, "types", value, allLabel, onDiscoveryStateChange)}
          options={bootstrap.discovery.assetTypes}
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
          label="Catalogs"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "catalogs", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "catalogs", bootstrap.discovery.catalogs, filters.catalogs)}
          selected={filters.catalogs}
        />
        <FilterSection
          allLabel="All domains"
          label="Domains"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "domains", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "domains", bootstrap.discovery.domains, filters.domains)}
          selected={filters.domains}
        />
        <FilterSection
          allLabel="All tiers"
          label="Tiers"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "tiers", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "tiers", bootstrap.discovery.tiers, filters.tiers)}
          selected={filters.tiers}
        />
        <FilterSection
          allLabel="All certifications"
          label="Certifications"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "certifications", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(
            facets,
            "certifications",
            bootstrap.discovery.certifications,
            filters.certifications,
          )}
          selected={filters.certifications}
        />
        <FilterSection
          allLabel="All sensitivities"
          label="Sensitivities"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "sensitivities", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(
            facets,
            "sensitivities",
            bootstrap.discovery.sensitivities,
            filters.sensitivities,
          )}
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
}) {
  const owners = (asset.owners || []).map((owner) => ownerLabel(owner)).filter(Boolean).slice(0, 2);
  const metaItems = resultMetaItems(asset);
  const objectType = displayObjectType(asset);

  return (
    <article className={`gh-discovery-result-row ${selected ? "is-selected" : ""}`}>
      <button className="gh-discovery-result-hit" onClick={() => onSelect(asset.fqn)} type="button">
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
          <span className={`gh-status-chip tone-${statusTone(asset)}`}>
            {asset.governanceStatus || "Needs Work"}
          </span>
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

      <div className="gh-discovery-result-actions">
        <button className="gh-secondary-button gh-secondary-button-compact" onClick={() => onOpenAsset(asset.fqn)} type="button">
          Open record
        </button>
        <button
          className="gh-tertiary-button gh-inline-link-button"
          onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
          type="button"
        >
          Open lineage
        </button>
        <button
          className="gh-tertiary-button gh-inline-link-button"
          onClick={() => onOpenGovernance(asset.fqn)}
          type="button"
        >
          Open governance
        </button>
      </div>
    </article>
  );
}

function PreviewSection({ title, children, empty }) {
  return (
    <section className="gh-preview-section">
      <div className="gh-panel-title">{title}</div>
      {children ? children : empty ? <div className="gh-support-copy">{empty}</div> : null}
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

function SelectionPreview({
  asset,
  detailLoading,
  detailError,
  lineageLoading,
  lineageError,
  lineageGraph,
  onOpenAsset,
  onOpenLineage,
  onSelectAsset,
}) {
  if (!asset) {
    return (
      <aside className="gh-preview-panel">
        <div className="gh-panel-title">Preview</div>
        <div className="gh-empty-state">Select a result to review metadata, schema, and stewardship posture.</div>
      </aside>
    );
  }

  const columns = (asset.columns || []).slice(0, 4);
  const relatedAssets = (
    asset.relatedAssets?.length ? asset.relatedAssets : previewRelatedAssetsFromGraph(lineageGraph, asset.fqn)
  ).slice(0, 4);
  const signalItems = previewSignalItems(
    asset,
    asset.columns?.length || 0,
    relatedAssets.length,
    detailLoading,
    lineageLoading,
  );

  return (
    <aside className="gh-preview-panel">
      <div className="gh-preview-panel-head">
        <div className="gh-preview-panel-title-block">
          <div className="gh-eyebrow">Selected Asset</div>
          <div className="gh-preview-panel-title-row">
            <h3>{asset.name}</h3>
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus || "Needs Work"}
            </span>
          </div>
          <div className="gh-support-copy">{assetPathLabel(asset, true)}</div>
        </div>
      </div>

      <div className="gh-preview-panel-actions">
        <button className="gh-secondary-button" onClick={() => onOpenAsset(asset.fqn)} type="button">
          Open record
        </button>
        <button
          className="gh-tertiary-button gh-inline-link-button"
          onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
          type="button"
        >
          Open lineage
        </button>
      </div>

      {detailError ? <div className="gh-inline-alert tone-warn">{detailError}</div> : null}
      {lineageError && !relatedAssets.length ? <div className="gh-inline-alert tone-warn">{lineageError}</div> : null}
      {detailLoading || lineageLoading ? (
        <div className="gh-support-copy">Refreshing live metadata for this selection...</div>
      ) : null}

      <PreviewSection title="Definition">
        <div className="gh-support-copy">
          {asset.description || "No description is available for this asset yet."}
        </div>
      </PreviewSection>

      <PreviewSection title="Stewardship Signals">
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
        title="Related Assets"
        empty={
          lineageLoading
            ? "Loading connected lineage edges..."
            : "No connected lineage edges are surfaced for this asset yet."
        }
      >
        {relatedAssets.length ? (
          <div className="gh-lineage-linked-list">
            {relatedAssets.map((item) => (
              <button className="gh-lineage-linked-row" key={item} onClick={() => onSelectAsset(item)} type="button">
                <span>{item}</span>
                <span>Open linked asset</span>
              </button>
            ))}
          </div>
        ) : null}
      </PreviewSection>
    </aside>
  );
}

export default function DiscoveryWorkspace({
  bootstrap,
  initialQuery,
  querySeedKey,
  querySeedFresh,
  onRouteQueryChange,
  onOpenAsset,
  onOpenGovernance,
  onOpenLineage,
}) {
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedAssetFqn, setSelectedAssetFqn] = useState("");
  const filterPopoverRef = useRef(null);
  const filterCommandRef = useRef(null);
  const { filters, setFilters, results: discoveryResults } = useDiscoveryWorkspace({
    bootstrap,
    initialQuery,
    onRouteQueryChange,
    querySeedKey,
    querySeedFresh,
  });

  const selectedSeedAsset =
    discoveryResults.assets.find((asset) => asset.fqn === selectedAssetFqn) || discoveryResults.assets[0] || null;
  const previewDetail = useAssetDetail(selectedSeedAsset?.fqn || "");
  const previewLineage = useLineage(
    selectedSeedAsset?.fqn || "",
    selectedSeedAsset?.fqn ? bootstrap?.graphs?.[selectedSeedAsset.fqn] || null : null,
    Boolean(selectedSeedAsset?.fqn),
  );
  const previewAsset = previewDetail.detail || selectedSeedAsset;

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
    if (!discoveryResults.assets.length) {
      setSelectedAssetFqn("");
      return;
    }

    setSelectedAssetFqn((current) => {
      if (current && discoveryResults.assets.some((asset) => asset.fqn === current)) {
        return current;
      }
      return discoveryResults.assets[0].fqn;
    });
  }, [discoveryResults.assets]);

  const resultsCount = discoveryResults.count;
  const resultsLoading = discoveryResults.loading;
  const resultsError = discoveryResults.error;
  const resultsFacets = discoveryResults.facets;
  const filtersApplied = activeFilters(filters);
  const directFilterCount = filterVisibilityCount(filters);
  const discoverySummary = bootstrap.discovery?.summary || {};
  const assetTypeOptions = (bootstrap.discovery.assetTypes || []).filter(Boolean);
  const catalogOptions = facetValues(
    resultsFacets,
    "catalogs",
    bootstrap.discovery.catalogs,
    filters.catalogs,
  ).filter((value) => value && value !== "All catalogs");
  const onDiscoveryStateChange = (nextState) => setFilters(nextState);
  const resetBrowse = () =>
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
  const showInventoryEmptyState =
    bootstrap.bootState === "degraded" && Number(discoverySummary.visibleAssets || 0) === 0;
  const showDominantState = showInventoryEmptyState || (Boolean(resultsError) && !discoveryResults.assets.length);
  const emptyHeading = showInventoryEmptyState
    ? "No visible assets are being returned."
    : "No assets match the current scope.";
  const emptyCopy = showInventoryEmptyState
    ? bootstrap.bootMessage ||
      "The workspace can load, but the current principal is not surfacing any visible catalog assets yet."
    : "Relax the current search, saved view, or filters to widen the catalog scope.";

  return (
    <section className="gh-workspace gh-discovery-shell">
      <section className="gh-discovery-main gh-discovery-main-grid">
        {!showDominantState ? (
          <aside className="gh-panel gh-discovery-sidebar-panel">
            <div className="gh-discovery-sidebar-head">
              <div className="gh-eyebrow">Discovery Scope</div>
              <h3>Browse Asset Types and Filters</h3>
              <p>Layer asset type, saved view, catalog, and stacked filters without leaving the catalog.</p>
            </div>

            <SidebarSection title="Asset Types">
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
                    <span className="gh-category-count">{facetCount(resultsFacets, "assetTypes", option)}</span>
                  </button>
                ))}
              </div>
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
                    <span className="gh-category-count">{facetCount(resultsFacets, "views", view)}</span>
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
                    >
                      {catalog}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="gh-support-copy">Catalog scope will populate from visible inventory.</div>
              )}
            </SidebarSection>
          </aside>
        ) : null}

        <section className={`gh-results-column ${showDominantState ? "is-expanded" : ""}`}>
          <div className="gh-panel gh-discovery-command-panel">
            <div className="gh-discovery-command-topline">
              <div>
                <h2 className="gh-workspace-title">Metadata Catalog</h2>
                <div className="gh-discovery-results-copy">
                  Filter visible assets with stacked search, saved views, and facet filters.
                </div>
              </div>
              <span className="gh-results-inline-state gh-results-inline-state-bar">
                {resultsCount} {resultsCount === 1 ? "result" : "results"}
                {resultsLoading ? <span className="gh-inline-updating">Updating…</span> : null}
              </span>
            </div>

            <div className="gh-discovery-command-bar">
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
              <select
                className="gh-select"
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
              <div className="gh-discovery-command-actions" ref={filterCommandRef}>
                <button
                  className={`gh-secondary-button ${showAdvancedFilters ? "is-active" : ""}`}
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                  type="button"
                >
                  Stack Filters {directFilterCount ? `(${directFilterCount})` : ""}
                </button>
                {showAdvancedFilters ? (
                  <div ref={filterPopoverRef}>
                    <FiltersPopover
                      bootstrap={bootstrap}
                      facets={resultsFacets}
                      filters={filters}
                      onClose={() => setShowAdvancedFilters(false)}
                      onDiscoveryStateChange={onDiscoveryStateChange}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {filtersApplied.length ? (
              <div className="gh-active-filter-row gh-active-filter-row-inline gh-discovery-active-row">
                {filtersApplied.map((chip) => (
                  <button
                    className="gh-chip gh-chip-soft"
                    key={`${chip.key}-${chip.label}`}
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

          {resultsError && !showDominantState ? (
            <div className="gh-inline-alert tone-warn">
              <div className="gh-inline-alert-title">Discovery search degraded</div>
              <div>{resultsError}</div>
            </div>
          ) : null}

          {discoveryResults.assets.length ? (
            <div className="gh-result-list gh-discovery-card-list">
              {discoveryResults.assets.map((asset) => (
                <DiscoveryResultCard
                  asset={asset}
                  key={asset.fqn}
                  onOpenAsset={onOpenAsset}
                  onOpenGovernance={onOpenGovernance}
                  onOpenLineage={onOpenLineage}
                  onSelect={setSelectedAssetFqn}
                  selected={asset.fqn === selectedAssetFqn}
                />
              ))}
            </div>
          ) : resultsError ? (
            <div className="gh-panel gh-empty-state gh-discovery-empty-state">
              <div className="gh-panel-title">Discovery Unavailable</div>
              <div>{resultsError}</div>
              <div className="gh-support-copy">
                {bootstrap.bootMessage ||
                  "The search surface is reachable, but live discovery could not return results."}
              </div>
              <div className="gh-empty-state-actions">
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
              </div>
            </div>
          ) : (
            <div className="gh-panel gh-empty-state gh-discovery-empty-state">
              <div className="gh-panel-title">{showInventoryEmptyState ? "Inventory empty" : "No matching assets"}</div>
              <div>{emptyHeading}</div>
              <div className="gh-support-copy">{emptyCopy}</div>
              <div className="gh-discovery-summary-grid gh-discovery-summary-grid-inline">
                <div className="gh-discovery-summary-card">
                  <span>Visible assets</span>
                  <strong>{discoverySummary.visibleAssets || 0}</strong>
                </div>
                <div className="gh-discovery-summary-card">
                  <span>Catalogs</span>
                  <strong>{discoverySummary.catalogCount || 0}</strong>
                </div>
                <div className="gh-discovery-summary-card">
                  <span>Observed catalogs</span>
                  <strong>{discoverySummary.observedCatalogCount || 0}</strong>
                </div>
                <div className="gh-discovery-summary-card">
                  <span>Owned assets</span>
                  <strong>{discoverySummary.ownedAssets || 0}</strong>
                </div>
              </div>
              <div className="gh-empty-state-actions">
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
              </div>
            </div>
          )}
        </section>

        {!showDominantState ? (
          <SelectionPreview
            asset={previewAsset}
            detailError={previewDetail.error}
            detailLoading={previewDetail.loading}
            lineageError={previewLineage.error}
            lineageGraph={previewLineage.graph}
            lineageLoading={previewLineage.loading}
            onOpenAsset={onOpenAsset}
            onOpenLineage={onOpenLineage}
            onSelectAsset={setSelectedAssetFqn}
          />
        ) : null}
      </section>
    </section>
  );
}
