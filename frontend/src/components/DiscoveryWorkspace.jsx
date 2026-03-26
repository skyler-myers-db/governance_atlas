import { useEffect, useRef, useState } from "react";
import { useDiscoveryWorkspace } from "../hooks/useDiscoveryWorkspace";

function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function facetValues(facets, key, fallbackOptions = [], selected = []) {
  const entries = facets?.[key];
  const resolved = entries?.length ? entries.map((entry) => entry.value) : fallbackOptions;
  return [...new Set([...(selected || []), ...resolved])];
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
  if (chip.key === "view") {
    onDiscoveryStateChange((current) => ({ ...current, view: "All assets" }));
    return;
  }
  if (chip.key === "type") {
    onDiscoveryStateChange((current) => ({ ...current, type: "All types" }));
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
  let count = 0;
  if (filters.view && filters.view !== "All assets") count += 1;
  if (filters.type && filters.type !== "All types") count += 1;
  ["catalogs", "domains", "tiers", "certifications", "sensitivities"].forEach((key) => {
    count += (filters[key] || []).length;
  });
  return count;
}

function activeFilters(filters) {
  const chips = [];
  if (filters.query) chips.push({ label: `Search: ${filters.query}`, key: "query" });
  if (filters.view && filters.view !== "All assets") {
    chips.push({ label: filters.view, key: "view" });
  }
  if (filters.type && filters.type !== "All types") {
    chips.push({ label: filters.type, key: "type" });
  }
  ["catalogs", "domains", "tiers", "certifications", "sensitivities"].forEach((key) => {
    (filters[key] || []).forEach((value) => chips.push({ label: value, key }));
  });
  return chips;
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
              <input
                checked={checked}
                onChange={() => onToggle(option, allLabel)}
                type="checkbox"
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function ChoiceSection({ label, options, selected, onSelect }) {
  return (
    <section className="gh-filter-section">
      <div className="gh-filter-title">{label}</div>
      <div className="gh-filter-choice-row">
        {options.map((option) => (
          <button
            className={`gh-filter-chip ${selected === option ? "is-active" : ""}`}
            key={option}
            onClick={() => onSelect(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
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
        <ChoiceSection
          label="Asset type"
          onSelect={(option) =>
            onDiscoveryStateChange((current) => ({
              ...current,
              type: option,
            }))
          }
          options={bootstrap.discovery.assetTypes}
          selected={filters.type}
        />
        <ChoiceSection
          label="Saved view"
          onSelect={(option) =>
            onDiscoveryStateChange((current) => ({
              ...current,
              view: option,
            }))
          }
          options={bootstrap.discovery.views}
          selected={filters.view}
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

function ResultRow({ asset, onOpenAsset, onOpenGovernance, onOpenLineage }) {
  return (
    <article className="gh-result-row">
      <button
        className="gh-result-row-main gh-result-row-main-button"
        onClick={() => onOpenAsset(asset.fqn)}
        type="button"
      >
        <div className="gh-result-row-head">
          <div className="gh-result-row-identity">
            <span className="gh-result-row-title-button">{asset.name}</span>
            <div className="gh-result-row-context">
              {asset.catalog} / {asset.schema} · {asset.objectType}
            </div>
          </div>
        </div>

        <div className="gh-result-row-description">
          {asset.description || "No description is available for this asset yet."}
        </div>

        <div className="gh-result-row-foot">
          <div className="gh-result-metadata">
            <span>Coverage {asset.coverageScore}</span>
            <span>{asset.owners?.length || 0} owners</span>
            <span>{asset.openRequests} requests</span>
            <span>{asset.domain || "Unassigned"}</span>
          </div>
        </div>
      </button>
      <div className="gh-result-row-side">
        <div className="gh-chip-row gh-result-row-statuses">
          <span className="gh-chip gh-chip-soft">{asset.objectType}</span>
          <span className={`gh-status-chip tone-${statusTone(asset)}`}>
            {asset.governanceStatus || "Needs Work"}
          </span>
        </div>
        <div className="gh-result-row-actions gh-result-row-actions-inline">
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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const filterPopoverRef = useRef(null);
  const filterCommandRef = useRef(null);
  const { filters, setFilters, results: discoveryResults } = useDiscoveryWorkspace({
    bootstrap,
    initialQuery,
    onRouteQueryChange,
    querySeedKey,
    querySeedFresh,
  });

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

  const resultsCount = discoveryResults.count;
  const resultsLoading = discoveryResults.loading;
  const resultsError = discoveryResults.error;
  const resultsFacets = discoveryResults.facets;
  const filtersApplied = activeFilters(filters);
  const directFilterCount = filterVisibilityCount(filters);
  const onDiscoveryStateChange = (nextState) => setFilters(nextState);
  const resetBrowse = () =>
    onDiscoveryStateChange({
      query: "",
      sortBy: bootstrap.discovery.sortOptions[0],
      view: bootstrap.discovery.views[0],
      type: bootstrap.discovery.assetTypes[0],
      catalogs: [],
      domains: [],
      tiers: [],
      certifications: [],
      sensitivities: [],
    });

  return (
    <section className="gh-workspace gh-discovery-shell">
      <section className="gh-discovery-main">
        <section className="gh-results-column">
          <div className="gh-discovery-command-bar">
            <span className="gh-results-inline-state gh-results-inline-state-bar">
              {resultsCount} {resultsCount === 1 ? "result" : "results"}
              {resultsLoading ? <span className="gh-inline-updating">Updating…</span> : null}
            </span>
            <input
              className="gh-input"
              onChange={(event) =>
                onDiscoveryStateChange((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
              placeholder="Search assets, views, dashboards, owners, glossary, or governance gaps"
              value={filters.query}
            />
            <select
              className="gh-select"
              onChange={(event) => onDiscoveryStateChange((current) => ({ ...current, sortBy: event.target.value }))}
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
                Filters {directFilterCount ? `(${directFilterCount})` : ""}
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
          {filtersApplied.length || filters.query ? (
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
                {filtersApplied.length ? (
                  <button className="gh-tertiary-button gh-inline-link-button" onClick={resetBrowse} type="button">
                    Reset browse
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {resultsError ? (
            <div className="gh-inline-alert tone-warn">
              <div>{resultsError}</div>
            </div>
          ) : null}

          {discoveryResults.assets.length ? (
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
          ) : resultsError ? (
            <div className="gh-empty-state">
              <div>Live discovery results are unavailable right now.</div>
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
            <div className="gh-empty-state">
              <div>No assets match the current scope.</div>
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
      </section>
    </section>
  );
}
