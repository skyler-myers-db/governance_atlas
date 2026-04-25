import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchClassifications,
  fetchClassification,
  fetchDomains,
  fetchDataProducts,
  fetchLogicalColumnGroups,
  fetchLogicalColumnGroup,
  fetchTaxonomyOverview,
} from "../lib/api";
import { EmptyStateBlock, LoadingState } from "./ShellStatePrimitives";
import { SurfaceDrawer, SurfaceDrawerSection } from "./ShellLayoutPrimitives";
import {
  DataTable,
  DegradedBanner,
  EmptyState,
  MetricCard,
  PageHero,
  SectionCard,
  StatusPill,
} from "./northstar";
import "../styles/operations-pages.css";

const TAXONOMY_TABS = [
  { key: "classifications", label: "Classifications" },
  { key: "domains", label: "Domains" },
  { key: "dataProducts", label: "Data Products" },
  { key: "columnGroups", label: "Column Groups" },
];

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function envelopeMeta(payload) {
  return payload && typeof payload === "object" ? payload.meta || {} : {};
}

function queryRows(query, overview, key) {
  const overviewRows = Array.isArray(overview?.[key]) ? overview[key] : [];
  if (overviewRows.length) return overviewRows;
  return Array.isArray(query.data) ? query.data : [];
}

function rowId(row, ...keys) {
  for (const key of keys) {
    if (row?.[key]) return row[key];
  }
  return row?.display_name || row?.name || "";
}

export default function TaxonomyWorkspace() {
  const [active, setActive] = useState("classifications");
  const [selected, setSelected] = useState(null); // { kind, id, row }

  const closeDrawer = () => setSelected(null);

  const overviewQuery = useQuery({
    queryKey: ["atlas", "taxonomy-overview"],
    queryFn: ({ signal }) => fetchTaxonomyOverview({ signal }),
    staleTime: 60_000,
  });
  const classifications = useQuery({
    queryKey: ["taxonomy", "classifications"],
    queryFn: ({ signal }) => fetchClassifications({ signal }),
    enabled: active === "classifications",
  });
  const domains = useQuery({
    queryKey: ["taxonomy", "domains"],
    queryFn: ({ signal }) => fetchDomains({ signal }),
    enabled: active === "domains",
  });
  const dataProducts = useQuery({
    queryKey: ["taxonomy", "data-products"],
    queryFn: ({ signal }) => fetchDataProducts({ signal }),
    enabled: active === "dataProducts",
  });
  const columnGroups = useQuery({
    queryKey: ["taxonomy", "column-groups"],
    queryFn: ({ signal }) => fetchLogicalColumnGroups({ signal }),
    enabled: active === "columnGroups",
  });
  const overview = envelopeData(overviewQuery.data) || {};
  const meta = envelopeMeta(overviewQuery.data);
  const rowsByTab = useMemo(() => ({
    classifications: queryRows(classifications, overview, "classifications"),
    domains: queryRows(domains, overview, "domains"),
    dataProducts: queryRows(dataProducts, overview, "dataProducts"),
    columnGroups: queryRows(columnGroups, overview, "columnGroups"),
  }), [classifications.data, columnGroups.data, dataProducts.data, domains.data, overview]);
  const activeRows = rowsByTab[active] || [];

  return (
    <section className="ga-page ga-operations-page ga-taxonomy-page">
      <PageHero
        eyebrow="Taxonomy"
        title="Taxonomy Workbench"
        subtitle="Classifications, domains, data products, glossary terms, and column groups backed by the governance store."
      />
      <DegradedBanner meta={meta} />
      <div className="ga-kpi-grid four">
        <MetricCard label="Classifications" value={rowsByTab.classifications.length.toLocaleString()} />
        <MetricCard label="Domains" value={rowsByTab.domains.length.toLocaleString()} />
        <MetricCard label="Data Products" value={rowsByTab.dataProducts.length.toLocaleString()} />
        <MetricCard label="Glossary Terms" value={(overview.summary?.termCount ?? overview.glossaryTerms?.length ?? "Unavailable").toLocaleString?.() || String(overview.summary?.termCount ?? "Unavailable")} />
      </div>
      <SectionCard
        title="Governance taxonomy"
        eyebrow="Live store"
        actions={
          <nav className="ga-tab-row" role="tablist" aria-label="Taxonomy facets">
          {TAXONOMY_TABS.map((tab) => (
            <button
              aria-pressed={active === tab.key}
              className={`ga-tab-button ${active === tab.key ? "is-active" : ""}`}
              key={tab.key}
              onClick={() => {
                setActive(tab.key);
                closeDrawer();
              }}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
          </nav>
        }
      >
        {overviewQuery.isPending && !activeRows.length ? <LoadingState message="Loading taxonomy overview…" /> : null}
        {active === "classifications" ? (
          <TaxonomyList
            query={classifications}
            rows={activeRows}
            emptyTitle="No classifications defined"
            emptyMessage="Classifications declare the taxonomy for sensitive/PII/financial tagging. Admins create these in the governance catalog."
            rowKey={(row) => row.classification_id}
            onSelect={(row) => setSelected({ kind: "classification", id: row.classification_id, row })}
            columns={[
              { key: "display_name", label: "Name", className: "gh-taxonomy-name" },
              { key: "description", label: "Description", className: "gh-taxonomy-desc" },
              {
                key: "term_count",
                label: "Terms",
                className: "gh-taxonomy-count",
                render: (row) => row.term_count ?? 0,
              },
              {
                key: "is_system",
                label: "System",
                render: (row) => (row.is_system ? "Yes" : "—"),
              },
            ]}
          />
        ) : null}
        {active === "domains" ? (
          <TaxonomyList
            query={domains}
            rows={activeRows}
            emptyTitle="No domains defined"
            emptyMessage="Domains let you scope data products and policies to a business area (finance, ops, growth, …)."
            rowKey={(row) => row.domain_id}
            onSelect={(row) => setSelected({ kind: "domain", id: row.domain_id, row })}
            columns={[
              { key: "display_name", label: "Name", className: "gh-taxonomy-name" },
              { key: "description", label: "Description", className: "gh-taxonomy-desc" },
              {
                key: "parent_domain_id",
                label: "Parent",
                render: (row) => row.parent_domain_id || "—",
              },
              { key: "owner_entry_id", label: "Owner", render: (row) => row.owner_entry_id || "—" },
            ]}
          />
        ) : null}
        {active === "dataProducts" ? (
          <TaxonomyList
            query={dataProducts}
            rows={activeRows}
            emptyTitle="No data products defined"
            emptyMessage="Data products bundle one or more physical assets into a governed, consumer-facing unit."
            rowKey={(row) => row.data_product_id}
            onSelect={(row) => setSelected({ kind: "dataProduct", id: row.data_product_id, row })}
            columns={[
              { key: "display_name", label: "Name", className: "gh-taxonomy-name" },
              { key: "description", label: "Description", className: "gh-taxonomy-desc" },
              { key: "domain_id", label: "Domain", render: (row) => row.domain_id || "—" },
              {
                key: "member_count",
                label: "Assets",
                className: "gh-taxonomy-count",
                render: (row) => row.member_count ?? 0,
              },
              {
                key: "state",
                label: "State",
                render: (row) => (
                  <StatusPill tone="info">{row.state || "draft"}</StatusPill>
                ),
              },
            ]}
          />
        ) : null}
        {active === "columnGroups" ? (
          <TaxonomyList
            query={columnGroups}
            rows={activeRows}
            emptyTitle="No logical column groups defined"
            emptyMessage="Logical column groups bundle related columns across tables for bulk metadata operations."
            rowKey={(row) => row.group_id}
            onSelect={(row) => setSelected({ kind: "columnGroup", id: row.group_id, row })}
            columns={[
              { key: "display_name", label: "Name", className: "gh-taxonomy-name" },
              { key: "description", label: "Description", className: "gh-taxonomy-desc" },
              {
                key: "member_count",
                label: "Members",
                className: "gh-taxonomy-count",
                render: (row) => row.member_count ?? 0,
              },
              {
                key: "confidence",
                label: "Confidence",
                render: (row) =>
                  typeof row.confidence === "number" ? `${(row.confidence * 100).toFixed(0)}%` : "—",
              },
              {
                key: "last_reviewed_at",
                label: "Reviewed",
                render: (row) => row.last_reviewed_at || "—",
              },
            ]}
          />
        ) : null}
      </SectionCard>

      <TaxonomyDetailDrawer selected={selected} onClose={closeDrawer} />
    </section>
  );
}

function TaxonomyList({ query, rows: providedRows, columns, emptyTitle, emptyMessage, rowKey, onSelect }) {
  const rows = Array.isArray(providedRows) ? providedRows : [];
  if (query.isPending && !rows.length) return <LoadingState message="Loading…" />;
  if (query.isError) {
    return <EmptyStateBlock title="Unavailable" message={query.error?.message || "Failed to load."} />;
  }
  if (!rows.length) return <EmptyState title={emptyTitle} message={emptyMessage} />;
  return (
    <DataTable
      columns={columns.map((col) => ({
        key: col.key,
        header: col.label,
        render: (row) => {
          const value = col.render ? col.render(row) : row[col.key] ?? "—";
          if (col.key !== "display_name") return value;
          return (
            <button
              aria-label={`Open ${row.display_name || "row"}`}
              className="ga-link-button"
              onClick={() => onSelect?.(row)}
              type="button"
            >
              {value}
            </button>
          );
        },
      }))}
      rows={rows.map((row, index) => ({ ...row, __rowKey: rowKey ? rowKey(row) ?? index : rowId(row) || index }))}
      rowKey="__rowKey"
    />
  );
}

function TaxonomyDetailDrawer({ selected, onClose }) {
  const isOpen = Boolean(selected);
  const kind = selected?.kind;
  const id = selected?.id;
  const row = selected?.row;

  const classificationDetail = useQuery({
    queryKey: ["taxonomy-detail", "classification", id],
    queryFn: ({ signal }) => fetchClassification(id, { signal }),
    enabled: isOpen && kind === "classification" && Boolean(id),
  });
  const columnGroupDetail = useQuery({
    queryKey: ["taxonomy-detail", "columnGroup", id],
    queryFn: ({ signal }) => fetchLogicalColumnGroup(id, { signal }),
    enabled: isOpen && kind === "columnGroup" && Boolean(id),
  });

  const title = row?.display_name || "Details";
  const eyebrow = {
    classification: "Classification",
    domain: "Domain",
    dataProduct: "Data product",
    columnGroup: "Column group",
  }[kind] || "";

  return (
    <SurfaceDrawer
      eyebrow={eyebrow}
      title={title}
      titleMeta={row?.state ? <span className="gh-chip gh-chip-soft">{row.state}</span> : null}
      isOpen={isOpen}
      onClose={onClose}
    >
      {kind === "classification" ? (
        <ClassificationDetail row={row} query={classificationDetail} />
      ) : null}
      {kind === "domain" ? <DomainDetail row={row} /> : null}
      {kind === "dataProduct" ? <DataProductDetail row={row} /> : null}
      {kind === "columnGroup" ? (
        <ColumnGroupDetail row={row} query={columnGroupDetail} />
      ) : null}
    </SurfaceDrawer>
  );
}

function ClassificationDetail({ row, query }) {
  return (
    <>
      <SurfaceDrawerSection title="Overview">
        <DetailField label="Description" value={row?.description || "—"} />
        <DetailField label="System" value={row?.is_system ? "Yes" : "No"} />
        <DetailField label="Terms" value={row?.term_count ?? 0} />
        <DetailField label="Created" value={row?.created_at || "—"} />
      </SurfaceDrawerSection>
      <SurfaceDrawerSection title="Terms">
        {query.isPending ? (
          <LoadingState message="Loading terms…" />
        ) : query.isError ? (
          <EmptyStateBlock title="Unavailable" message={query.error?.message || "Failed to load."} />
        ) : !(query.data?.terms || []).length ? (
          <EmptyStateBlock
            title="No terms in this classification"
            message="Classification terms form the sensitivity taxonomy leaves (e.g. PII, HIPAA, internal)."
          />
        ) : (
          <ul className="gh-taxonomy-terms">
            {query.data.terms.map((term) => (
              <li className="gh-taxonomy-term" key={term.term_id}>
                <div className="gh-taxonomy-term-row">
                  <span className="gh-taxonomy-term-name">{term.display_name}</span>
                  {term.sensitivity_level ? (
                    <span className="gh-chip gh-chip-soft">{term.sensitivity_level}</span>
                  ) : null}
                </div>
                {term.description ? (
                  <div className="gh-support-copy">{term.description}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SurfaceDrawerSection>
    </>
  );
}

function DomainDetail({ row }) {
  return (
    <SurfaceDrawerSection title="Overview">
      <DetailField label="Description" value={row?.description || "—"} />
      <DetailField label="Parent" value={row?.parent_domain_id || "—"} />
      <DetailField label="Owner" value={row?.owner_entry_id || "—"} />
      <DetailField label="Color" value={row?.color || "—"} />
      <DetailField label="State" value={row?.state || "—"} />
      <DetailField label="Created" value={row?.created_at || "—"} />
    </SurfaceDrawerSection>
  );
}

function DataProductDetail({ row }) {
  return (
    <SurfaceDrawerSection title="Overview">
      <DetailField label="Description" value={row?.description || "—"} />
      <DetailField label="Domain" value={row?.domain_id || "—"} />
      <DetailField label="Owner" value={row?.owner_entry_id || "—"} />
      <DetailField label="Contact" value={row?.contact_email || "—"} />
      <DetailField label="SLO" value={row?.slo_description || "—"} />
      <DetailField label="State" value={row?.state || "—"} />
      <DetailField label="Member assets" value={row?.member_count ?? 0} />
    </SurfaceDrawerSection>
  );
}

function ColumnGroupDetail({ row, query }) {
  const members = query.data?.members || [];
  const conflictCounts = query.data?.group?.conflictCounts || {};
  return (
    <>
      <SurfaceDrawerSection title="Overview">
        <DetailField label="Description" value={row?.description || "—"} />
        <DetailField
          label="Confidence"
          value={typeof row?.confidence === "number" ? `${(row.confidence * 100).toFixed(0)}%` : "—"}
        />
        <DetailField label="Members" value={row?.member_count ?? 0} />
        <DetailField label="Last reviewed" value={row?.last_reviewed_at || "—"} />
      </SurfaceDrawerSection>
      {Object.keys(conflictCounts).length ? (
        <SurfaceDrawerSection title="Conflicts across members">
          <div className="gh-taxonomy-conflicts">
            {Object.entries(conflictCounts).map(([key, value]) => (
              <div className="gh-taxonomy-conflict" key={key}>
                <div className="gh-taxonomy-conflict-label">{key}</div>
                <div className="gh-taxonomy-conflict-value">{value}</div>
              </div>
            ))}
          </div>
        </SurfaceDrawerSection>
      ) : null}
      <SurfaceDrawerSection title={`Members (${members.length})`}>
        {query.isPending ? (
          <LoadingState message="Loading members…" />
        ) : query.isError ? (
          <EmptyStateBlock title="Unavailable" message={query.error?.message || "Failed to load."} />
        ) : !members.length ? (
          <EmptyStateBlock title="No members yet" message="Members bind concrete columns to this logical group." />
        ) : (
          <ul className="gh-taxonomy-members">
            {members.map((member) => (
              <li className="gh-taxonomy-member" key={member.membershipId}>
                <div className="gh-taxonomy-member-head">
                  <span className="gh-taxonomy-member-fqn">{member.entityFqn}</span>
                  <span className="gh-support-copy">/ {member.columnName}</span>
                </div>
                <div className="gh-support-copy">
                  {member.dataType || "—"}
                  {member.currentDescription ? ` • ${member.currentDescription}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SurfaceDrawerSection>
    </>
  );
}

function DetailField({ label, value }) {
  return (
    <div className="gh-taxonomy-detail-field">
      <div className="gh-taxonomy-detail-label">{label}</div>
      <div className="gh-taxonomy-detail-value">{value}</div>
    </div>
  );
}
