import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCdeDashboard, fetchCdeDetail } from "../lib/api";
import { DegradedBanner, EmptyState, StatusPill } from "./northstar";
import "../styles/operations-pages.css";

const DETAIL_TABS = ["Overview", "Lineage", "Controls", "Linked Assets", "Activity"];
const PAGE_SIZE = 9;
const CONTROL_NAMES = ["Access Control", "Data Protection", "Data Quality", "Monitoring & Detection", "Retention & Disposal"];

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function envelopeMeta(payload) {
  return payload && typeof payload === "object" ? payload.meta || {} : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function displayName(value) {
  const raw = text(value);
  if (!raw) return "Unnamed CDE";
  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeStatus(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function statusTone(value) {
  const normalized = normalizeStatus(value);
  if (["certified", "approved", "protected", "compliant", "complete", "trusted"].includes(normalized)) return "good";
  if (["critical", "high", "restricted", "confidential"].includes(normalized)) return "bad";
  if (["medium", "in_review", "partial", "draft"].includes(normalized)) return "warn";
  if (["low", "internal"].includes(normalized)) return "info";
  return "muted";
}

function compactDate(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeAsset(value, index = 0) {
  const item = value && typeof value === "object" ? value : {};
  const fqn = text(item.assetFqn || item.fqn || item.id || value);
  const name = text(item.name || item.assetName || item.label || fqn.split(".").pop());
  return {
    id: fqn || `asset-${index}`,
    fqn,
    name: name || fqn || "Linked asset",
    type: text(item.type || item.assetType || "Asset"),
  };
}

function normalizeControl(value, index = 0) {
  const item = value && typeof value === "object" ? value : {};
  return {
    id: text(item.id || item.name) || `control-${index}`,
    name: text(item.name || CONTROL_NAMES[index]) || `Control ${index + 1}`,
    state: text(item.state || item.status || "unavailable") || "unavailable",
    coverage: numberOrNull(item.coverage),
  };
}

function normalizeCandidate(item, index = 0) {
  const value = item && typeof item === "object" ? item : {};
  const fqn = text(value.assetFqn || value.fqn || value.id || value.name) || `cde-${index}`;
  const rawName = text(value.name || fqn.split(".").pop()) || fqn;
  const controls = arrayValue(value.controls).map(normalizeControl);
  return {
    ...value,
    id: text(value.id) || fqn || rawName,
    fqn,
    rawName,
    name: displayName(rawName),
    domain: text(value.domain) || "Unassigned",
    owner: text(value.owner || value.ownerEmail) || "Unassigned",
    sensitivity: text(value.sensitivity) || "Unassigned",
    criticality: text(value.criticality) || "Unassigned",
    certification: text(value.certification) || "Unassigned",
    controlCoverage: numberOrNull(value.controlCoverage),
    controlState: text(value.controlState || "unavailable") || "unavailable",
    downstreamImpact: text(value.downstreamImpact) || "Unavailable",
    linkedPolicies: numberOrNull(value.linkedPolicies),
    type: text(value.type || value.objectType || "Unity Catalog asset"),
    description:
      text(value.businessDescription || value.description) ||
      "Business definition is unavailable for this visible CDE candidate.",
    lastReview: text(value.lastReview || value.reviewedAt || value.reviewed_at),
    lineageSnapshot: value.lineageSnapshot && typeof value.lineageSnapshot === "object" ? value.lineageSnapshot : null,
    controls,
    linkedAssets: arrayValue(value.linkedAssets).map(normalizeAsset),
    activity: arrayValue(value.activity),
  };
}

function candidatesFromDashboard(dashboard) {
  const byId = new Map();
  arrayValue(dashboard.items).forEach((item, index) => {
    const normalized = normalizeCandidate(item, index);
    byId.set(normalized.id, normalized);
  });
  arrayValue(dashboard.groups).forEach((group) => {
    arrayValue(group.items).forEach((item, index) => {
      const normalized = normalizeCandidate({ ...item, domain: item.domain || group.domain }, index);
      byId.set(normalized.id, normalized);
    });
  });
  return [...byId.values()].sort((left, right) =>
    `${left.domain} ${left.rawName}`.localeCompare(`${right.domain} ${right.rawName}`),
  );
}

function groupByDomain(items) {
  const groups = new Map();
  items.forEach((item) => {
    const domain = item.domain || "Unassigned";
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(item);
  });
  return [...groups.entries()].map(([domain, domainItems]) => ({
    domain,
    items: domainItems,
    count: domainItems.length,
  }));
}

function uniqueOptions(items, key) {
  return ["All", ...Array.from(new Set(items.map((item) => item[key]).filter(Boolean))).sort()];
}

function filterMatches(value, selected) {
  return selected === "All" || text(value) === selected;
}

function unavailableText(value, fallback = "Unavailable") {
  const raw = text(value);
  return raw || fallback;
}

function KpiCard({ icon, label, value, support, tone = "neutral" }) {
  return (
    <article className={`gh-cde-kpi is-${tone}`}>
      <div className="gh-cde-kpi-head">
        <span className="gh-cde-kpi-icon" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{support}</p>
    </article>
  );
}

function MiniBar({ value, tone = "neutral" }) {
  const safeValue = numberOrNull(value);
  return (
    <span className={`gh-cde-mini-bar is-${tone}`}>
      <span style={{ width: `${Math.max(4, Math.min(100, safeValue ?? 0))}%` }} />
    </span>
  );
}

/**
 * @param {{ onOpenAsset?: (assetFqn: string) => void, onOpenLineage?: (assetFqn: string, nextContext?: string) => void, onSurfaceReady?: (surface?: string) => void }} props
 */
export default function CdeWorkspace({
  onOpenAsset = undefined,
  onOpenLineage = undefined,
  onSurfaceReady = undefined,
} = {}) {
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("All");
  const [sensitivityFilter, setSensitivityFilter] = useState("All");
  const [criticalityFilter, setCriticalityFilter] = useState("All");
  const [certificationFilter, setCertificationFilter] = useState("All");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [density, setDensity] = useState("compact");
  const [selectionDismissed, setSelectionDismissed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(["Customer", "Finance"]));
  const [pageIndex, setPageIndex] = useState(0);
  const [detailTab, setDetailTab] = useState("Overview");

  const query = useQuery({
    queryKey: ["atlas", "cde-dashboard"],
    queryFn: ({ signal }) => fetchCdeDashboard({ signal }),
    staleTime: 60_000,
  });

  const dashboard = useMemo(() => envelopeData(query.data) || {}, [query.data]);
  const meta = envelopeMeta(query.data);
  const candidates = useMemo(() => candidatesFromDashboard(dashboard), [dashboard]);
  const selected = selectionDismissed
    ? candidates.find((item) => item.id === selectedId) || null
    : candidates.find((item) => item.id === selectedId) || candidates[0] || null;

  const detailQuery = useQuery({
    queryKey: ["atlas", "cde-detail", selected?.id || ""],
    queryFn: ({ signal }) => fetchCdeDetail(selected.id, { signal }),
    enabled: Boolean(selected?.id),
    staleTime: 60_000,
  });
  const detailPayload = normalizeCandidate({ ...selected, ...(envelopeData(detailQuery.data) || {}) });

  const domainOptions = useMemo(() => uniqueOptions(candidates, "domain"), [candidates]);
  const sensitivityOptions = useMemo(() => uniqueOptions(candidates, "sensitivity"), [candidates]);
  const criticalityOptions = useMemo(() => uniqueOptions(candidates, "criticality"), [candidates]);
  const certificationOptions = useMemo(() => uniqueOptions(candidates, "certification"), [candidates]);

  const filtered = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return candidates.filter((item) => {
      if (!filterMatches(item.domain, domainFilter)) return false;
      if (!filterMatches(item.sensitivity, sensitivityFilter)) return false;
      if (!filterMatches(item.criticality, criticalityFilter)) return false;
      if (!filterMatches(item.certification, certificationFilter)) return false;
      if (!queryText) return true;
      return [item.name, item.rawName, item.domain, item.owner, item.sensitivity, item.criticality, item.certification]
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    });
  }, [candidates, certificationFilter, criticalityFilter, domainFilter, search, sensitivityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const boundedPage = Math.min(pageIndex, totalPages - 1);
  const pageRows = filtered.slice(boundedPage * PAGE_SIZE, boundedPage * PAGE_SIZE + PAGE_SIZE);
  const pageGroups = groupByDomain(pageRows);

  const summary = dashboard.summary || {};
  const totalCdes = numberOrNull(summary.totalCdes) ?? candidates.length;
  const sensitiveCount = numberOrNull(summary.sensitiveCandidates) ?? candidates.filter((item) =>
    !["", "unassigned", "internal"].includes(normalizeStatus(item.sensitivity)),
  ).length;
  const domainsCovered = numberOrNull(summary.domainsCovered) ?? new Set(candidates.map((item) => item.domain)).size;
  const overdueReviews = numberOrNull(summary.overdueReviews);

  useEffect(() => {
    onSurfaceReady?.("cde");
  }, [onSurfaceReady]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId("");
      return;
    }
    if (selectionDismissed) return;
    if (!filtered.some((item) => item.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId, selectionDismissed]);

  useEffect(() => {
    setPageIndex(0);
    setSelectionDismissed(false);
  }, [certificationFilter, criticalityFilter, domainFilter, search, sensitivityFilter]);

  const loading = query.isLoading;
  const queryError = query.error?.message || "";
  const detail = selected ? detailPayload : null;
  const controls = detail?.controls?.length
    ? detail.controls
    : CONTROL_NAMES.map((name, index) => normalizeControl({ name, state: "unavailable" }, index));
  const linkedAssets = detail?.linkedAssets?.length ? detail.linkedAssets : detail?.fqn ? [normalizeAsset({ assetFqn: detail.fqn, type: detail.type })] : [];
  const lineage = detail?.lineageSnapshot || { state: "unavailable" };
  const lineageUnavailable = normalizeStatus(lineage.state) === "unavailable" || !lineage.state;
  const shownStart = filtered.length ? boundedPage * PAGE_SIZE + 1 : 0;
  const shownEnd = boundedPage * PAGE_SIZE + pageRows.length;
  const handleSelect = (id) => {
    setSelectionDismissed(false);
    setSelectedId(id);
    setDetailTab("Overview");
  };
  const handleClearSelection = () => {
    setSelectionDismissed(true);
    setSelectedId("");
  };

  return (
    <section className="ga-page gh-cde-ns" data-testid="cde-northstar">
      <div className="gh-cde-shell">
        <div className="gh-cde-main">
          <header className="gh-cde-hero">
            <h1>Critical Data Elements Registry</h1>
            <p>Discover, govern, and protect the data elements that drive trust and performance.</p>
          </header>

          <div className="gh-cde-kpis" aria-label="CDE metrics">
            <KpiCard icon="▦" label="Total CDEs" value={loading ? "Loading..." : queryError ? "Unavailable" : totalCdes.toLocaleString()} support={loading ? "Reading visible metadata" : `${filtered.length.toLocaleString()} visible in this view`} tone="info" />
            <KpiCard icon="◈" label="Protected CDEs" value="Unavailable" support={loading ? "Awaiting sensitivity metadata" : `${sensitiveCount.toLocaleString()} sensitive candidates`} tone="good" />
            <KpiCard icon="!" label="Overdue Reviews" value={loading ? "Loading..." : overdueReviews == null ? "Unavailable" : overdueReviews.toLocaleString()} support={overdueReviews == null ? "Review cadence not configured" : "Backed by review metadata"} tone="warn" />
            <KpiCard icon="◎" label="Domains Covered" value={loading ? "Loading..." : queryError ? "Unavailable" : domainsCovered.toLocaleString()} support="Actor-visible domains" tone="info" />
          </div>

          <DegradedBanner meta={meta} />
          {loading ? (
            <EmptyState title="Loading CDE registry" message="Reading visible catalog metadata for critical-data flags." />
          ) : queryError ? (
            <EmptyState
              tone="bad"
              title="CDE registry unavailable"
              message={queryError || "Visible catalog metadata could not be loaded."}
            />
          ) : null}

          <div className="gh-cde-toolbar" aria-label="CDE filters">
            <label className="gh-cde-search">
              <span className="gh-visually-hidden">Search CDEs</span>
              <input
                aria-label="Search CDEs"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search CDEs..."
                value={search}
              />
            </label>
            <SelectFilter label="Domain" onChange={setDomainFilter} options={domainOptions} value={domainFilter} />
            <SelectFilter label="Sensitivity" onChange={setSensitivityFilter} options={sensitivityOptions} value={sensitivityFilter} />
            <SelectFilter label="Criticality" onChange={setCriticalityFilter} options={criticalityOptions} value={criticalityFilter} />
            <SelectFilter label="Certification" onChange={setCertificationFilter} options={certificationOptions} value={certificationFilter} />
            <div className="gh-cde-menu-wrap">
              <button
                aria-expanded={moreFiltersOpen}
                className="gh-cde-toolbar-button"
                onClick={() => setMoreFiltersOpen((open) => !open)}
                type="button"
              >
                More filters
              </button>
              {moreFiltersOpen ? (
                <div className="gh-cde-menu" role="menu">
                  <button disabled type="button">Control coverage unavailable</button>
                  <button disabled type="button">Review dates unavailable</button>
                  <button disabled type="button">Policy linkage unavailable</button>
                </div>
              ) : null}
            </div>
            <button className="gh-cde-toolbar-button" disabled title="Saved views are not yet backed by a persisted user preference." type="button">
              Save view
            </button>
            <button
              aria-label="Toggle table density"
              className="gh-cde-icon-button"
              onClick={() => setDensity((value) => (value === "compact" ? "comfortable" : "compact"))}
              type="button"
            >
              ≡
            </button>
          </div>

          <RegistryTable
            density={density}
            expandedGroups={expandedGroups}
            groups={pageGroups}
            onOpenAsset={onOpenAsset}
            onSelect={handleSelect}
            selectedId={selected?.id || ""}
            setExpandedGroups={setExpandedGroups}
          />

          <footer className="gh-cde-registry-footer">
            <span>Showing {shownStart}-{shownEnd} of {filtered.length.toLocaleString()} CDEs</span>
            <button disabled title="Download export is not backed by an export job yet." type="button">Download</button>
            <div className="gh-cde-pages" aria-label="CDE pagination">
              <button disabled={boundedPage === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))} type="button">‹</button>
              {Array.from({ length: totalPages }).slice(0, 3).map((_, index) => (
                <button
                  aria-current={boundedPage === index ? "page" : undefined}
                  className={boundedPage === index ? "is-active" : ""}
                  key={index}
                  onClick={() => setPageIndex(index)}
                  type="button"
                >
                  {index + 1}
                </button>
              ))}
              <button disabled={boundedPage >= totalPages - 1} onClick={() => setPageIndex((page) => Math.min(totalPages - 1, page + 1))} type="button">›</button>
            </div>
          </footer>
        </div>

        <DetailPanel
          controls={controls}
          detail={detail}
          detailTab={detailTab}
          linkedAssets={linkedAssets}
          lineage={lineage}
          lineageUnavailable={lineageUnavailable}
          onDetailTab={setDetailTab}
          onOpenAsset={onOpenAsset}
          onOpenLineage={onOpenLineage}
          onSelectNone={handleClearSelection}
        />
      </div>
    </section>
  );
}

function SelectFilter({ label, onChange, options, value }) {
  return (
    <label className="gh-cde-select">
      <span>{label}: </span>
      <select aria-label={`${label} filter`} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function RegistryTable({ density, expandedGroups, groups, onOpenAsset, onSelect, selectedId, setExpandedGroups }) {
  if (!groups.length) {
    return (
      <section className="gh-cde-registry" aria-label="CDE registry">
        <div className="gh-cde-empty">
          <strong>No CDE candidates found</strong>
          <span>No visible assets currently carry CDE or criticality metadata.</span>
        </div>
      </section>
    );
  }

  return (
    <section className={`gh-cde-registry is-${density}`} aria-label="CDE registry">
      <div className="gh-cde-table-head">
        <span>CDE Name</span>
        <span>Domain</span>
        <span>Owner</span>
        <span>Sensitivity</span>
        <span>Criticality</span>
        <span>Control Coverage</span>
        <span>Linked Policies</span>
        <span>Downstream Impact</span>
        <span>Certification</span>
        <span>Last Review</span>
      </div>
      <div className="gh-cde-table-body">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.domain);
          return (
            <div className="gh-cde-group-block" key={group.domain}>
              <button
                aria-expanded={isExpanded}
                className="gh-cde-group-row"
                onClick={() =>
                  setExpandedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group.domain)) next.delete(group.domain);
                    else next.add(group.domain);
                    return next;
                  })
                }
                type="button"
              >
                <span>{isExpanded ? "⌄" : "›"}</span>
                {group.domain} <em>({group.count})</em>
              </button>
              {isExpanded ? (
                <div className="gh-cde-group-items">
                  {group.items.map((item) => (
                    <button
                      className={`gh-cde-row ${selectedId === item.id ? "is-selected" : ""}`}
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      type="button"
                    >
                      <span className="gh-cde-name-cell">
                        <span className="gh-cde-doc-icon" aria-hidden="true">▤</span>
                        <span>{item.name}</span>
                      </span>
                      <span>{item.domain}</span>
                      <span title={item.owner}>{item.owner}</span>
                      <span><StatusPill tone={statusTone(item.sensitivity)}>{item.sensitivity}</StatusPill></span>
                      <span><StatusPill tone={statusTone(item.criticality)}>{item.criticality}</StatusPill></span>
                      <span className="gh-cde-coverage-cell">
                        {item.controlCoverage == null ? "Unavailable" : `${item.controlCoverage}%`}
                        {item.controlCoverage == null ? <MiniBar value={0} /> : <MiniBar value={item.controlCoverage} tone="good" />}
                      </span>
                      <span>
                        {item.linkedPolicies == null ? "Unavailable" : (
                          <button className="gh-cde-inline-action" onClick={(event) => event.stopPropagation()} type="button">
                            {item.linkedPolicies}
                          </button>
                        )}
                      </span>
                      <span className="gh-cde-impact">
                        <span>{unavailableText(item.downstreamImpact)}</span>
                        <MiniBar value={item.downstreamImpact === "Unavailable" ? 0 : 50} tone="warn" />
                      </span>
                      <span><StatusPill tone={statusTone(item.certification)}>{item.certification}</StatusPill></span>
                      <span>{compactDate(item.lastReview) || "Unavailable"}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DetailPanel({
  controls,
  detail,
  detailTab,
  linkedAssets,
  lineage,
  lineageUnavailable,
  onDetailTab,
  onOpenAsset,
  onOpenLineage,
  onSelectNone,
}) {
  return (
    <aside className="gh-cde-detail" aria-label="CDE detail">
      {detail ? (
        <>
          <header className="gh-cde-detail-head">
            <div>
              <h2>{detail.name}</h2>
              <StatusPill tone={statusTone(detail.criticality)}>Critical CDE</StatusPill>
            </div>
            <button aria-label="Clear selected CDE" onClick={onSelectNone} type="button">×</button>
          </header>
          <div className="gh-cde-meta-strip">
            <div><span>Domain</span><strong>{detail.domain}</strong></div>
            <div><span>Owner</span><strong>{detail.owner}</strong></div>
            <div><span>Sensitivity</span><strong><StatusPill tone={statusTone(detail.sensitivity)}>{detail.sensitivity}</StatusPill></strong></div>
            <div><span>Criticality</span><strong><StatusPill tone={statusTone(detail.criticality)}>{detail.criticality}</StatusPill></strong></div>
          </div>
          <nav className="gh-cde-detail-tabs" aria-label="CDE detail tabs" role="tablist">
            {DETAIL_TABS.map((tab) => (
              <button
                aria-selected={detailTab === tab}
                className={detailTab === tab ? "is-active" : ""}
                key={tab}
                onClick={() => onDetailTab(tab)}
                role="tab"
                type="button"
              >
                {tab}
              </button>
            ))}
          </nav>

          {detailTab === "Overview" ? (
            <div className="gh-cde-detail-scroll">
              <DetailCard title="Business Description">
                <p>{detail.description}</p>
              </DetailCard>
              <LineageSnapshot
                detail={detail}
                lineage={lineage}
                lineageUnavailable={lineageUnavailable}
                onOpenLineage={onOpenLineage}
              />
              <ControlStatus controls={controls} detail={detail} />
              <LinkedAssets detail={detail} linkedAssets={linkedAssets} onOpenAsset={onOpenAsset} />
              <StewardshipActions />
            </div>
          ) : detailTab === "Lineage" ? (
            <div className="gh-cde-detail-scroll">
              <LineageSnapshot
                detail={detail}
                lineage={lineage}
                lineageUnavailable={lineageUnavailable}
                onOpenLineage={onOpenLineage}
              />
            </div>
          ) : detailTab === "Controls" ? (
            <div className="gh-cde-detail-scroll">
              <ControlStatus controls={controls} detail={detail} />
            </div>
          ) : detailTab === "Linked Assets" ? (
            <div className="gh-cde-detail-scroll">
              <LinkedAssets detail={detail} linkedAssets={linkedAssets} onOpenAsset={onOpenAsset} />
            </div>
          ) : (
            <div className="gh-cde-detail-scroll">
              <DetailCard title="Activity">
                {detail.activity?.length ? (
                  detail.activity.map((event, index) => (
                    <p key={event.id || index}>{event.title || event.action || "CDE activity"}</p>
                  ))
                ) : (
                  <p>CDE activity is unavailable for this visible candidate.</p>
                )}
              </DetailCard>
            </div>
          )}
        </>
      ) : (
        <div className="gh-cde-detail-empty">
          <strong>No CDE selected</strong>
          <span>Select a critical element to inspect source metadata and controls.</span>
        </div>
      )}
    </aside>
  );
}

function DetailCard({ children, title }) {
  return (
    <section className="gh-cde-detail-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function LineageSnapshot({ detail, lineage, lineageUnavailable, onOpenLineage }) {
  const sourceCount = numberOrNull(lineage.sourceSystems ?? lineage.upstreamCount);
  const downstreamCount = numberOrNull(lineage.downstreamSystems ?? lineage.downstreamCount);
  return (
    <DetailCard title="Lineage Snapshot">
      <div className="gh-cde-lineage">
        <div>
          <span>Source Systems</span>
          <strong>{lineageUnavailable || sourceCount == null ? "Unavailable" : sourceCount}</strong>
        </div>
        <span aria-hidden="true">→</span>
        <div className="is-selected">
          <span>{detail.name}</span>
          <strong>CDE</strong>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <span>Downstream Systems</span>
          <strong>{lineageUnavailable || downstreamCount == null ? "Unavailable" : downstreamCount}</strong>
        </div>
      </div>
      <button
        className="gh-cde-link-action"
        disabled={!detail.fqn}
        onClick={() => onOpenLineage?.(detail.fqn)}
        type="button"
      >
        View full lineage
      </button>
    </DetailCard>
  );
}

function ControlStatus({ controls, detail }) {
  return (
    <DetailCard title="Control Status">
      <div className="gh-cde-overall-control">
        <span>{detail.controlCoverage == null ? "Control coverage unavailable" : `${detail.controlCoverage}% Control Coverage`}</span>
        <MiniBar value={detail.controlCoverage ?? 0} tone={detail.controlCoverage == null ? "neutral" : "good"} />
      </div>
      <div className="gh-cde-controls">
        {controls.map((control) => (
          <div key={control.id}>
            <span>{control.name}</span>
            <MiniBar value={control.coverage ?? 0} tone={control.coverage == null ? "neutral" : "good"} />
            <strong>{control.coverage == null ? "Unavailable" : `${control.coverage}%`}</strong>
            <StatusPill tone={statusTone(control.state)}>{control.state}</StatusPill>
          </div>
        ))}
      </div>
    </DetailCard>
  );
}

function LinkedAssets({ detail, linkedAssets, onOpenAsset }) {
  return (
    <DetailCard title="Linked Assets">
      <div className="gh-cde-linked-summary">
        <div><span>Source Asset</span><strong>{linkedAssets.length || "Unavailable"}</strong></div>
        <div><span>Policies</span><strong>{detail.linkedPolicies == null ? "Unavailable" : detail.linkedPolicies}</strong></div>
        <div><span>Reports</span><strong>Unavailable</strong></div>
      </div>
      {linkedAssets.map((asset) => (
        <button
          className="gh-cde-asset-link"
          disabled={!asset.fqn}
          key={asset.id}
          onClick={() => onOpenAsset?.(asset.fqn)}
          type="button"
        >
          <span>{asset.name}</span>
          <small>{asset.type}</small>
        </button>
      ))}
      <button className="gh-cde-link-action" disabled title="Downstream asset rollup is unavailable." type="button">
        View all downstream assets
      </button>
    </DetailCard>
  );
}

function StewardshipActions() {
  return (
    <DetailCard title="Stewardship Actions">
      <div className="gh-cde-action-grid">
        <button disabled title="Access request workflow is not wired for CDEs yet." type="button">Request Access</button>
        <button disabled title="Issue reporting workflow is not wired for CDEs yet." type="button">Report Issue</button>
        <button disabled title="Change request workflow is not wired for CDEs yet." type="button">Suggest Change</button>
        <button disabled title="Review workflow is not wired for CDEs yet." type="button">Start Review</button>
      </div>
    </DetailCard>
  );
}
