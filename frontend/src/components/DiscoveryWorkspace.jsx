import { useEffect, useState } from "react";
import { useDiscoveryWorkspace } from "../hooks/useDiscoveryWorkspace";

const DISCOVERY_UI_SESSION_KEY = "gh.discovery.ui.v1";

function discoveryUiSessionKey() {
  if (typeof window === "undefined") return DISCOVERY_UI_SESSION_KEY;
  return `${DISCOVERY_UI_SESSION_KEY}:${window.location.pathname}`;
}

function readDiscoveryUiState() {
  if (typeof window === "undefined") return { showAdvancedFilters: false };
  try {
    const raw = window.sessionStorage.getItem(discoveryUiSessionKey());
    if (!raw) return { showAdvancedFilters: false };
    const parsed = JSON.parse(raw);
    return {
      showAdvancedFilters: Boolean(parsed?.showAdvancedFilters),
    };
  } catch {
    return { showAdvancedFilters: false };
  }
}

function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function facetValues(facets, key, fallbackOptions = []) {
  const entries = facets?.[key];
  if (!entries?.length) return fallbackOptions;
  return entries.map((entry) => entry.value);
}

function facetCountMap(facets, key) {
  const entries = facets?.[key] || [];
  return entries.reduce((acc, entry) => {
    acc[entry.value] = entry.count;
    return acc;
  }, {});
}

function toggleMulti(filters, key, value, allLabel, onDiscoveryStateChange) {
  const current = filters[key] || [allLabel];
  if (value === allLabel) {
    onDiscoveryStateChange({ ...filters, [key]: [allLabel] });
    return;
  }
  const next = new Set(current.filter((item) => item !== allLabel));
  if (next.has(value)) next.delete(value);
  else next.add(value);
  onDiscoveryStateChange({
    ...filters,
    [key]: next.size ? [...next] : [allLabel],
  });
}

function clearFilter(filters, chip, onDiscoveryStateChange) {
  if (chip.key === "query") {
    onDiscoveryStateChange({ ...filters, query: "" });
    return;
  }
  if (chip.key === "view") {
    onDiscoveryStateChange({ ...filters, view: "All assets" });
    return;
  }
  if (chip.key === "type") {
    onDiscoveryStateChange({ ...filters, type: "All types" });
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
  onDiscoveryStateChange({
    ...filters,
    [chip.key]: next.length ? next : [allLabel],
  });
}

function activeFilters(filters) {
  const chips = [];
  if (filters.query) chips.push({ label: `Search: ${filters.query}`, key: "query" });
  if (filters.view && filters.view !== "All assets") chips.push({ label: filters.view, key: "view" });
  if (filters.type && filters.type !== "All types") chips.push({ label: filters.type, key: "type" });
  ["catalogs", "domains", "tiers", "certifications", "sensitivities"].forEach((key) => {
    (filters[key] || [])
      .filter((value) => !value.startsWith("All "))
      .forEach((value) => chips.push({ label: value, key }));
  });
  return chips;
}

function objectTypeIcon(type) {
  if (type === "View" || type === "Materialized View") return "◫";
  if (type === "Dashboard") return "▦";
  if (type === "Notebook") return "✦";
  if (type === "Pipeline") return "⇢";
  return "▣";
}

function FilterSection({ label, options, selected, allLabel, onToggle }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">{label}</div>
      <div className="gh-filter-chip-row">
        {options.map((option) => (
          <button
            className={`gh-filter-chip ${selected.includes(option) ? "is-active" : ""}`}
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

function CategoryRail({ assetTypes, counts, selectedType, onSelectType }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">Asset types</div>
      <div className="gh-category-list">
        {assetTypes.map((type) => {
          const active = selectedType === type;
          const count = counts[type] ?? 0;
          return (
            <button
              className={`gh-category-row ${active ? "is-active" : ""}`}
              key={type}
              onClick={() => onSelectType(type)}
              type="button"
            >
              <span>{type}</span>
              <span className="gh-category-count">{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SavedViews({ views, activeView, onSelectView }) {
  return (
    <div className="gh-discovery-view-row">
      {views.map((view) => (
        <button
          className={`gh-saved-view ${activeView === view ? "is-active" : ""}`}
          key={view}
          onClick={() => onSelectView(view)}
          type="button"
        >
          {view}
        </button>
      ))}
    </div>
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
        <FilterSection
          allLabel="All catalogs"
          label="Catalogs"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "catalogs", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "catalogs", bootstrap.discovery.catalogs)}
          selected={filters.catalogs}
        />
        <FilterSection
          allLabel="All domains"
          label="Domains"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "domains", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "domains", bootstrap.discovery.domains)}
          selected={filters.domains}
        />
        <FilterSection
          allLabel="All tiers"
          label="Tiers"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "tiers", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "tiers", bootstrap.discovery.tiers)}
          selected={filters.tiers}
        />
        <FilterSection
          allLabel="All certifications"
          label="Certifications"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "certifications", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "certifications", bootstrap.discovery.certifications)}
          selected={filters.certifications}
        />
        <FilterSection
          allLabel="All sensitivities"
          label="Sensitivities"
          onToggle={(value, allLabel) =>
            toggleMulti(filters, "sensitivities", value, allLabel, onDiscoveryStateChange)
          }
          options={facetValues(facets, "sensitivities", bootstrap.discovery.sensitivities)}
          selected={filters.sensitivities}
        />
      </div>
    </div>
  );
}

function ResultRow({ asset, onOpenAsset, onOpenGovernance, onOpenLineage }) {
  return (
    <article className="gh-result-row">
      <button className="gh-result-row-main" onClick={() => onOpenAsset(asset.fqn)} type="button">
        <div className="gh-result-row-head">
          <div className="gh-result-row-identity">
            <span className="gh-result-icon" aria-hidden="true">
              {objectTypeIcon(asset.objectType)}
            </span>
            <div>
              <div className="gh-result-row-title">{asset.name}</div>
              <div className="gh-result-row-context">
                {asset.catalog} / {asset.schema}
              </div>
            </div>
          </div>
          <div className="gh-chip-row">
            <span className="gh-chip gh-chip-soft">{asset.objectType}</span>
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus || "Needs Work"}
            </span>
          </div>
        </div>

        <div className="gh-result-row-description">{asset.description}</div>

        <div className="gh-result-metadata">
          <span>Coverage {asset.coverageScore}</span>
          <span>{asset.owners?.length || 0} owners</span>
          <span>{asset.openRequests} requests</span>
          <span>{asset.domain || "Unassigned"}</span>
        </div>
      </button>
      <div className="gh-result-row-actions">
        <button className="gh-secondary-button" onClick={() => onOpenLineage(asset.fqn, "Data Lineage")} type="button">
          Lineage
        </button>
        <button className="gh-secondary-button" onClick={() => onOpenGovernance(asset.fqn)} type="button">
          Governance
        </button>
      </div>
    </article>
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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(() => readDiscoveryUiState().showAdvancedFilters);
  const { filters, setFilters, results: discoveryResults } = useDiscoveryWorkspace({
    bootstrap,
    initialQuery,
    onRouteQueryChange,
    querySeedKey,
    querySeedFresh,
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        discoveryUiSessionKey(),
        JSON.stringify({ showAdvancedFilters }),
      );
    } catch {
      // Best-effort only; do not block the workspace.
    }
  }, [showAdvancedFilters]);

  const resultsCount = discoveryResults.count;
  const resultsLoading = discoveryResults.loading;
  const resultsError = discoveryResults.error;
  const resultsFacets = discoveryResults.facets;
  const assetTypeOptions = facetValues(resultsFacets, "assetTypes", bootstrap.discovery.assetTypes || ["All types"]);
  const typeCounts = facetCountMap(resultsFacets, "assetTypes");
  const filtersApplied = activeFilters(filters);
  const onDiscoveryStateChange = (nextState) => setFilters(nextState);
  const resetBrowse = () =>
    onDiscoveryStateChange({
      query: "",
      sortBy: bootstrap.discovery.sortOptions[0],
      view: bootstrap.discovery.views[0],
      type: bootstrap.discovery.assetTypes[0],
      catalogs: ["All catalogs"],
      domains: ["All domains"],
      tiers: ["All tiers"],
      certifications: ["All certifications"],
      sensitivities: ["All sensitivities"],
    });

  return (
    <section className="gh-workspace gh-discovery-shell">
      <div className="gh-discovery-layout">
        <aside className="gh-discovery-sidebar">
          <CategoryRail
            assetTypes={assetTypeOptions}
            counts={typeCounts}
            onSelectType={(type) => onDiscoveryStateChange({ ...filters, type })}
            selectedType={filters.type}
          />
        </aside>

        <section className="gh-discovery-main">
          <section className="gh-results-column">
            <div className="gh-discovery-command-bar">
              <input
                className="gh-input"
                onChange={(event) =>
                  onDiscoveryStateChange({
                    ...filters,
                    query: event.target.value,
                  })
                }
                placeholder="Search assets, views, dashboards, owners, glossary, or governance gaps"
                value={filters.query}
              />
              <select
                className="gh-select"
                onChange={(event) =>
                  onDiscoveryStateChange({ ...filters, sortBy: event.target.value })
                }
                value={filters.sortBy}
              >
                {bootstrap.discovery.sortOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <div className="gh-discovery-command-actions">
                <button
                  className={`gh-secondary-button ${showAdvancedFilters ? "is-active" : ""}`}
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                  type="button"
                >
                  Filters {filtersApplied.length ? `(${filtersApplied.length})` : ""}
                </button>
                {showAdvancedFilters ? (
                  <FiltersPopover
                    bootstrap={bootstrap}
                    facets={resultsFacets}
                    filters={filters}
                    onClose={() => setShowAdvancedFilters(false)}
                    onDiscoveryStateChange={onDiscoveryStateChange}
                  />
                ) : null}
              </div>
            </div>

            <SavedViews
              activeView={filters.view}
              onSelectView={(view) => onDiscoveryStateChange({ ...filters, view })}
              views={bootstrap.discovery.views}
            />

            {filtersApplied.length ? (
              <div className="gh-active-filter-row">
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
              </div>
            ) : null}

            <div className="gh-results-inline-state">
              {resultsLoading
                ? "Refreshing live results…"
                : `${resultsCount} ${resultsCount === 1 ? "result" : "results"}`}
            </div>

            {resultsError ? (
              <div className="gh-empty-state">
                <div>{resultsError}</div>
                <div className="gh-empty-state-actions">
                  <button className="gh-secondary-button" onClick={resetBrowse} type="button">
                    Reset browse
                  </button>
                </div>
              </div>
            ) : discoveryResults.assets.length ? (
              <div className="gh-result-list">
                {discoveryResults.assets.map((asset) => (
                  <ResultRow
                    asset={asset}
                    key={asset.fqn}
                    onOpenAsset={onOpenAsset}
                    onOpenGovernance={onOpenGovernance}
                    onOpenLineage={onOpenLineage}
                  />
                ))}
              </div>
            ) : (
              <div className="gh-empty-state">
                <div>No assets match the current filters. Relax the scope or clear the search.</div>
                <div className="gh-empty-state-actions">
                  {filters.query ? (
                    <button
                      className="gh-secondary-button"
                      onClick={() => onDiscoveryStateChange({ ...filters, query: "" })}
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
        </section>
      </div>
    </section>
  );
}
