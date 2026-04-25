import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCdeDashboard } from "../lib/api";
import {
  DataTable,
  DegradedBanner,
  EmptyState,
  MetricCard,
  PageHero,
  RightInspector,
  SectionCard,
  StatusPill,
} from "./northstar";
import "../styles/operations-pages.css";

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function envelopeMeta(payload) {
  return payload && typeof payload === "object" ? payload.meta || {} : {};
}

function normalizeCandidate(item) {
  const fqn = item?.assetFqn || item?.fqn || item?.id || item?.name || "unknown";
  const name = item?.name || fqn.split(".").pop() || fqn;
  const domain = item?.domain || "Unassigned";
  const sensitivity = item?.sensitivity || "Unassigned";
  const criticality = item?.criticality || "Unassigned";
  const certification = item?.certification || "Unassigned";
  const coverage = Number(item?.controlCoverage);
  return {
    id: item?.id || fqn,
    fqn,
    name,
    domain,
    owner: item?.owner || "Unassigned",
    sensitivity,
    criticality,
    certification,
    controlCoverage: Number.isFinite(coverage) ? Math.round(coverage) : null,
    controlState: item?.controlState || "unavailable",
    downstreamImpact: item?.downstreamImpact || "Unavailable",
    linkedPolicies: item?.linkedPolicies ?? null,
    type: item?.type || item?.objectType || "Unity Catalog asset",
    description: item?.businessDescription || item?.description || "No business definition is available for this visible asset.",
  };
}

function groupByDomain(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = item.domain || "Unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()].map(([domain, domainItems]) => ({ domain, items: domainItems }));
}

export default function CdeWorkspace({ onOpenAsset, onOpenLineage }) {
  const [selectedId, setSelectedId] = useState("");
  const query = useQuery({
    queryKey: ["atlas", "cde-dashboard"],
    queryFn: ({ signal }) => fetchCdeDashboard({ signal }),
    staleTime: 60_000,
  });

  const dashboard = envelopeData(query.data) || {};
  const meta = envelopeMeta(query.data);
  const candidates = useMemo(() => {
    const items = Array.isArray(dashboard.items) ? dashboard.items : [];
    return items.map(normalizeCandidate);
  }, [dashboard.items]);
  const groups = useMemo(() => {
    if (Array.isArray(dashboard.groups) && dashboard.groups.length) {
      return dashboard.groups.map((group) => ({
        domain: group.domain || "Unassigned",
        items: (Array.isArray(group.items) ? group.items : []).map(normalizeCandidate),
      }));
    }
    return groupByDomain(candidates);
  }, [candidates, dashboard.groups]);
  const selected = candidates.find((item) => item.id === selectedId) || candidates[0] || null;

  const summary = dashboard.summary || {};
  const protectedCount = Number.isFinite(Number(summary.protectedCdes)) ? Number(summary.protectedCdes) : 0;
  const domainsCovered = Number.isFinite(Number(summary.domainsCovered))
    ? Number(summary.domainsCovered)
    : new Set(candidates.map((item) => item.domain)).size;
  const overdueReviews = Number.isFinite(Number(summary.overdueReviews)) ? Number(summary.overdueReviews) : null;

  if (query.isLoading) {
    return (
      <section className="ga-page ga-cde-page">
        <EmptyState title="Loading CDE registry" message="Reading visible catalog metadata for critical-data flags." />
      </section>
    );
  }

  if (query.error) {
    return (
      <section className="ga-page ga-cde-page">
        <EmptyState
          tone="bad"
          title="CDE registry unavailable"
          message={query.error.message || "Visible catalog metadata could not be loaded."}
        />
      </section>
    );
  }

  return (
    <section className="ga-page ga-cde-page">
      <PageHero
        title="Critical Data Elements Registry"
        subtitle="Visible critical data elements derived from Unity Catalog and governed metadata. Missing controls remain marked unavailable."
      />
      <DegradedBanner meta={meta} />
      <div className="ga-kpi-grid four">
        <MetricCard label="Total CDEs" value={(summary.totalCdes ?? candidates.length).toLocaleString()} />
        <MetricCard label="Certified Candidates" value={protectedCount.toLocaleString()} />
        <MetricCard
          label="Overdue Reviews"
          value={overdueReviews == null ? "Unavailable" : overdueReviews.toLocaleString()}
          delta={overdueReviews == null ? "Review dates not configured" : ""}
          deltaTone="warn"
        />
        <MetricCard label="Domains Covered" value={domainsCovered.toLocaleString()} />
      </div>
      <div className="ga-cde-layout">
        <SectionCard title="Grouped Registry">
          {candidates.length ? (
            <div className="ga-cde-groups">
              {groups.map((group) => (
                <section key={group.domain} className="ga-cde-group">
                  <h3>{group.domain} <span>{group.items.length}</span></h3>
                  <DataTable
                    columns={[
                      { key: "name", header: "CDE Name", render: (row) => (
                        <button className="ga-link-button" type="button" onClick={() => setSelectedId(row.id)}>
                          {row.name}
                        </button>
                      ) },
                      { key: "owner", header: "Owner", accessor: "owner" },
                      { key: "sensitivity", header: "Sensitivity", render: (row) => <StatusPill tone="warn">{row.sensitivity}</StatusPill> },
                      { key: "criticality", header: "Criticality", render: (row) => <StatusPill tone="bad">{row.criticality}</StatusPill> },
                      { key: "controls", header: "Controls", render: (row) => <StatusPill tone="muted">{row.controlState}</StatusPill> },
                    ]}
                    rows={group.items}
                    rowKey="id"
                  />
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No CDE candidates found"
              message="No visible assets currently carry CDE or criticality metadata. Add governed metadata in Unity Catalog or the governance store to populate this registry."
            />
          )}
        </SectionCard>
        <RightInspector title={selected?.name || "CDE Detail"} subtitle={selected?.fqn || "Select a registry row"}>
          {selected ? (
            <div className="ga-inspector-stack">
              <p>{selected.description}</p>
              <dl className="ga-detail-list">
                <div><dt>Domain</dt><dd>{selected.domain}</dd></div>
                <div><dt>Owner</dt><dd>{selected.owner}</dd></div>
                <div><dt>Source Type</dt><dd>{selected.type}</dd></div>
                <div><dt>Control Coverage</dt><dd>{selected.controlCoverage == null ? "Unavailable" : `${selected.controlCoverage}%`}</dd></div>
                <div><dt>Downstream Impact</dt><dd>{selected.downstreamImpact}</dd></div>
                <div><dt>Linked Policies</dt><dd>{selected.linkedPolicies == null ? "Unavailable" : selected.linkedPolicies}</dd></div>
              </dl>
              <div className="ga-action-row">
                <button type="button" className="ga-secondary-button" onClick={() => onOpenAsset?.(selected.fqn)}>Open Asset 360</button>
                <button type="button" className="ga-secondary-button" onClick={() => onOpenLineage?.(selected.fqn)}>Open Lineage</button>
              </div>
            </div>
          ) : (
            <EmptyState title="No CDE selected" message="Select a critical element to inspect source metadata and controls." />
          )}
        </RightInspector>
      </div>
    </section>
  );
}
