import { useQuery } from "@tanstack/react-query";
import { fetchAdminControlCenter } from "../lib/api";
import {
  BarList,
  DataTable,
  EmptyState,
  MetricCard,
  PageHero,
  SectionCard,
  StatusPill,
} from "./northstar";
import "../styles/operations-pages.css";

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function integrationTone(state) {
  const value = String(state || "").toLowerCase();
  if (value === "connected" || value === "available") return "good";
  if (value === "unavailable") return "warn";
  return "muted";
}

export default function AdminWorkspace() {
  const query = useQuery({
    queryKey: ["atlas", "admin-control-center"],
    queryFn: ({ signal }) => fetchAdminControlCenter({ signal }),
    retry: false,
    staleTime: 60_000,
  });

  const dashboard = envelopeData(query.data) || {};
  const coverage = dashboard.coverage || {};
  const integrations = Array.isArray(dashboard.integrations) ? dashboard.integrations : [];
  const activity = Array.isArray(dashboard.recentAdminActivity) ? dashboard.recentAdminActivity : [];
  const system = dashboard.system || {};
  const byDomain = Array.isArray(coverage.byDomain) ? coverage.byDomain : [];

  if (query.isLoading) {
    return (
      <section className="ga-page ga-operations-page ga-admin-page">
        <EmptyState title="Loading admin control center" message="Reading runtime diagnostics and governance-store status." />
      </section>
    );
  }

  if (query.error) {
    return (
      <section className="ga-page ga-operations-page ga-admin-page">
        <EmptyState
          tone="bad"
          title="Admin control center unavailable"
          message={query.error?.message || "Runtime diagnostics could not be loaded."}
        />
      </section>
    );
  }

  return (
    <section className="ga-page ga-operations-page ga-admin-page">
      <PageHero
        eyebrow="Admin"
        title="Admin Control Center"
        subtitle="Runtime, governance-store, and metadata coverage controls from live diagnostic payloads."
      />
      <div className="ga-kpi-grid four">
        <MetricCard
          label="Metadata Coverage"
          value={coverage.metadataCoverage == null ? "Unavailable" : `${coverage.metadataCoverage}%`}
          progress={typeof coverage.metadataCoverage === "number" ? coverage.metadataCoverage : undefined}
        />
        <MetricCard label="Integrations" value={integrations.length.toLocaleString()} />
        <MetricCard label="Recent Admin Events" value={activity.length.toLocaleString()} />
        <MetricCard label="Bulk Import" value={dashboard.bulkImport?.state || "Unavailable"} />
      </div>
      <div className="ga-operations-two-column">
        <SectionCard title="Integration health" eyebrow="Configured systems">
          <DataTable
            columns={[
              { key: "label", header: "System", accessor: "label" },
              { key: "state", header: "State", render: (row) => <StatusPill tone={integrationTone(row.state)}>{row.state || "Unavailable"}</StatusPill> },
            ]}
            rows={integrations}
            rowKey="key"
            emptyMessage="No integration health records are available."
          />
        </SectionCard>
        <SectionCard title="Coverage by domain" eyebrow="Metadata posture">
          {byDomain.length ? (
            <BarList items={byDomain.map((item) => ({ ...item, score: item.score ?? item.value ?? 0 }))} valueKey="score" />
          ) : (
            <EmptyState title="No domain coverage" message="Domain coverage is unavailable for the current runtime snapshot." />
          )}
        </SectionCard>
      </div>
      <div className="ga-operations-two-column">
        <SectionCard title="Runtime snapshot" eyebrow="Databricks app">
          <dl className="ga-detail-list">
            {Object.entries(system).slice(0, 10).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "Unavailable")}</dd>
              </div>
            ))}
            {!Object.keys(system).length ? (
              <div>
                <dt>Status</dt>
                <dd>Unavailable</dd>
              </div>
            ) : null}
          </dl>
        </SectionCard>
        <SectionCard title="Recent admin activity" eyebrow="Metadata audit">
          <DataTable
            columns={[
              { key: "createdAt", header: "Time", accessor: "createdAt" },
              { key: "actorEmail", header: "Actor", accessor: "actorEmail" },
              { key: "title", header: "Action", render: (row) => <StatusPill tone={row.tone || "info"}>{row.title || "Metadata event"}</StatusPill> },
              { key: "detail", header: "Detail", accessor: "detail" },
            ]}
            rows={activity}
            rowKey="id"
            emptyMessage="No recent admin activity is available."
          />
        </SectionCard>
      </div>
    </section>
  );
}
