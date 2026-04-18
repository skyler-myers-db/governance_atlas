import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchClassifications,
  fetchDomains,
  fetchDataProducts,
  fetchLogicalColumnGroups,
} from "../lib/api";
import { EmptyStateBlock, LoadingState } from "./ShellStatePrimitives";
import { SurfacePanelSection } from "./ShellLayoutPrimitives";

const TAXONOMY_TABS = [
  { key: "classifications", label: "Classifications" },
  { key: "domains", label: "Domains" },
  { key: "dataProducts", label: "Data Products" },
  { key: "columnGroups", label: "Column Groups" },
];

export default function TaxonomyWorkspace() {
  const [active, setActive] = useState("classifications");

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

  return (
    <section className="gh-taxonomy-workspace">
      <SurfacePanelSection
        title="Taxonomy"
        titleMeta={
          <span className="gh-support-copy">
            Classifications, domains, data products, and logical column groups.
            Managed by admins; referenced by policies and entity metadata.
          </span>
        }
      >
        <nav className="gh-taxonomy-tabs" role="tablist" aria-label="Taxonomy facets">
          {TAXONOMY_TABS.map((tab) => (
            <button
              aria-pressed={active === tab.key}
              className={`gh-product-tab ${active === tab.key ? "is-active" : ""}`}
              key={tab.key}
              onClick={() => setActive(tab.key)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {active === "classifications" ? (
          <TaxonomyList
            query={classifications}
            emptyTitle="No classifications defined"
            emptyMessage="Classifications declare the taxonomy for sensitive/PII/financial tagging. Admins create these in the governance catalog."
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
            emptyTitle="No domains defined"
            emptyMessage="Domains let you scope data products and policies to a business area (finance, ops, growth, …)."
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
            emptyTitle="No data products defined"
            emptyMessage="Data products bundle one or more physical assets into a governed, consumer-facing unit."
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
                  <span className="gh-chip gh-chip-soft">{row.state || "draft"}</span>
                ),
              },
            ]}
          />
        ) : null}
        {active === "columnGroups" ? (
          <TaxonomyList
            query={columnGroups}
            emptyTitle="No logical column groups defined"
            emptyMessage="Logical column groups bundle related columns across tables for bulk metadata operations."
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
      </SurfacePanelSection>
    </section>
  );
}

function TaxonomyList({ query, columns, emptyTitle, emptyMessage }) {
  if (query.isPending) return <LoadingState message="Loading…" />;
  if (query.isError) {
    return <EmptyStateBlock title="Unavailable" message={query.error?.message || "Failed to load."} />;
  }
  const rows = Array.isArray(query.data) ? query.data : [];
  if (!rows.length) return <EmptyStateBlock title={emptyTitle} message={emptyMessage} />;
  return (
    <div className="gh-taxonomy-table">
      <div className="gh-taxonomy-row gh-taxonomy-head">
        {columns.map((col) => (
          <div className={col.className || ""} key={col.key}>
            {col.label}
          </div>
        ))}
      </div>
      {rows.map((row, index) => (
        <div className="gh-taxonomy-row" key={row.classification_id || row.domain_id || row.data_product_id || row.group_id || index}>
          {columns.map((col) => (
            <div className={col.className || ""} key={col.key}>
              {col.render ? col.render(row) : row[col.key] ?? "—"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
