import { useEffect, useMemo, useState } from "react";
import {
  updateAssetColumnDescription,
  updateAssetColumnMetadata,
  updateAssetColumnTags,
} from "../lib/api";
import { useAssetMetadataEditor } from "../hooks/useAssetMetadataEditor";
import { useAsset360 } from "../hooks/useAsset360";
import {
  canOpenLinkedAssetRecord,
  invalidateAssetDetail,
  isUsableAssetDetail,
  prefetchAssetAvailability,
  prefetchAssetDetail,
  primeAssetDetail,
  useAssetAvailability,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { clearAssetSearchCache } from "../hooks/useAssetSearch";
import { useLineage } from "../hooks/useLineage";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import {
  assetPathLabel,
  displayManagementType,
  displayObjectType,
  displayStorageFormat,
} from "../lib/assetPresentation";
import {
  systemInventoryAvailable,
  systemInventoryReason,
  runtimeFeatureFlagAvailable,
  runtimeFeatureFlagReason,
  tableLineageAvailable,
  tableLineageReason,
  workloadVisibilityAvailable,
  workloadVisibilityReason,
  workspaceAccessAvailable,
  workspaceAccessReason,
} from "../lib/capabilities";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { consumeWorkspaceIntent, peekWorkspaceIntent, setWorkspaceIntent } from "../lib/workspaceIntent";
import LineageStage from "./LineageStage";
import { SurfacePanelSection, SurfaceTabs } from "./ShellLayoutPrimitives";
import { EmptyStateBlock, LoadingState, SkeletonBlock, WorkspaceStateCard } from "./ShellStatePrimitives";
import { EntityHero } from "./primitives/EntityHero";
import { TabIcon } from "./primitives/TabIcon";
import { AccessExplainerBanner } from "./primitives/AccessExplainerBanner";
import { InlineEditableDescription } from "./primitives/InlineEditableDescription";
import { CustomPropertiesPanel } from "./primitives/CustomPropertiesPanel";
import { ProfilePanel } from "./primitives/ProfilePanel";
import { QualityPanel } from "./primitives/QualityPanel";

function governanceCoverageSignals(asset) {
  return [
    {
      label: "Ownership coverage",
      note: "Accountable owners are attached to the record.",
      complete: Boolean(asset.owners?.length),
      value: asset.owners?.length ? `${asset.owners.length} assigned` : "Unassigned",
    },
    {
      label: "Domain mapping",
      note: "The record is mapped into a business domain.",
      complete: Boolean(asset.domain && asset.domain !== "Unassigned"),
      value: asset.domain || "Unassigned",
    },
    {
      label: "Support tier",
      note: "Downstream consumers have a declared support tier.",
      complete: Boolean(asset.tier && asset.tier !== "Unassigned"),
      value: asset.tier || "Unassigned",
    },
    {
      label: "Certification",
      note: "Trusted-reuse status is recorded for this asset.",
      complete: Boolean(asset.certification && asset.certification !== "Unassigned"),
      value: asset.certification || "Unassigned",
    },
    {
      label: "Sensitivity review",
      note: "Privacy and classification markers are present.",
      complete: Boolean(asset.sensitivity && asset.sensitivity !== "Unassigned"),
      value: asset.sensitivity || "Unassigned",
    },
  ];
}

function loadingAwareValue(value, fallback, detailLoading = false) {
  if (
    detailLoading &&
    (value === "" ||
      value == null ||
      value === "—" ||
      value === "Unknown Object Type" ||
      value === "Unknown Data Source Format")
  ) {
    return "Loading…";
  }
  return value || fallback;
}

function postureItems(asset, detailLoading = false) {
  const managementType = displayManagementType(asset);
  const items = [
    { label: "Catalog", value: loadingAwareValue(asset.catalog, "—", detailLoading) },
    { label: "Schema", value: loadingAwareValue(asset.schema, "—", detailLoading) },
    { label: "Object Type", value: loadingAwareValue(displayObjectType(asset), "—", detailLoading) },
    { label: "Rows", value: loadingAwareValue(asset.rows, "—", detailLoading) },
    { label: "Storage Format", value: loadingAwareValue(displayStorageFormat(asset), "—", detailLoading) },
    { label: "Size", value: loadingAwareValue(asset.size, "—", detailLoading) },
    { label: "Files", value: loadingAwareValue(asset.files, "—", detailLoading) },
    { label: "Domain", value: asset.domain || "Unassigned" },
    { label: "Tier", value: asset.tier || "Unassigned" },
    { label: "Certification", value: asset.certification || "Unassigned" },
    { label: "Sensitivity", value: asset.sensitivity || "Unassigned" },
    { label: "Criticality", value: asset.criticality || "Unassigned" },
  ];
  if (managementType !== "—") {
    items.splice(3, 0, { label: "Management", value: loadingAwareValue(managementType, "—", detailLoading) });
  }
  return items;
}

function governancePostureSubset(asset, detailLoading = false) {
  const keep = new Set(["Domain", "Tier", "Certification", "Sensitivity", "Criticality"]);
  return postureItems(asset, detailLoading).filter((item) => keep.has(item.label));
}

function selectGraph(graphBundle, context = "Data Lineage") {
  if (!graphBundle) return null;
  return context === "Operational Context" ? graphBundle.operational || null : graphBundle.data || null;
}

function relatedAssetsFromGraph(graphBundle, focusFqn, context = "Data Lineage") {
  const { upstream, downstream } = lineageNeighborGroups(graphBundle, focusFqn, context);
  return [...new Set([...upstream, ...downstream])];
}

function dedupeLinkedAssets(values, focusFqn = "") {
  return [...new Set(
    (values || []).filter(
      (value) =>
        value &&
        value !== focusFqn,
    ),
  )];
}

function lineageNeighborGroups(graphBundle, focusFqn, context = "Data Lineage") {
  const graph = selectGraph(graphBundle, context);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const focusId =
    nodes.find((node) => node?.assetFqn === focusFqn)?.id ||
    nodes.find((node) => node?.role === "focus")?.id ||
    "";
  const assetFqnByNodeId = new Map(
    nodes
      .filter((node) => node?.id && node?.assetFqn)
      .map((node) => [node.id, node.assetFqn]),
  );

  const upstream = [];
  const downstream = [];
  edges.forEach((edge) => {
    if (edge.target === focusId) {
      const upstreamFqn = assetFqnByNodeId.get(edge.source);
      if (upstreamFqn && upstreamFqn !== focusFqn) upstream.push(upstreamFqn);
    }
    if (edge.source === focusId) {
      const downstreamFqn = assetFqnByNodeId.get(edge.target);
      if (downstreamFqn && downstreamFqn !== focusFqn) downstream.push(downstreamFqn);
    }
  });

  return {
    upstream: [...new Set(upstream)],
    downstream: [...new Set(downstream)],
  };
}

function toDraftValue(value) {
  if (!value || value === "Unassigned" || value === "No description has been captured for this asset yet.") {
    return "";
  }
  return value;
}

const STRUCTURED_TAG_KEYS = new Set([
  "domain",
  "tier",
  "certification",
  "sensitivity",
  "criticality",
  "glossary_term",
  "data_product",
]);

function freeformTagDraftValue(asset) {
  const tagEntries = Array.isArray(asset?.tagEntries) ? asset.tagEntries : [];
  return tagEntries
    .filter((entry) => entry?.name && !STRUCTURED_TAG_KEYS.has(String(entry.name).trim().toLowerCase()))
    .map((entry) => entry.label)
    .join(", ");
}

function metadataDraftFromAsset(asset) {
  return {
    description: toDraftValue(asset?.description),
    domain: toDraftValue(asset?.domain),
    tier: toDraftValue(asset?.tier),
    certification: toDraftValue(asset?.certification),
    sensitivity: toDraftValue(asset?.sensitivity),
    criticality: toDraftValue(asset?.criticality),
    dataProduct: toDraftValue(asset?.data_product || asset?.dataProduct),
    freeformTags: freeformTagDraftValue(asset),
  };
}

function detailSectionsForTab(activeTab, previewAvailable = true, workloadAvailable = true) {
  switch (activeTab) {
    case "Overview":
      return ["header"];
    case "Activity":
      return ["header", "activity"];
    case "Schema":
      return ["header", "activity", "schema"];
    case "SampleData":
      return previewAvailable ? ["header", "activity", "preview"] : ["header", "activity"];
    case "Queries":
      return workloadAvailable ? ["header", "activity", "operational"] : ["header", "activity"];
    case "Profiler": {
      const sections = ["header", "activity", "schema"];
      if (previewAvailable) sections.push("preview");
      if (workloadAvailable) sections.push("operational");
      sections.push("profiler");
      return sections;
    }
    case "CustomProperties":
      return ["header", "activity", "properties"];
    default:
      return ["header", "activity"];
  }
}

function entityTabs(previewAvailable = true, lineageAvailable = true, workloadAvailable = true) {
  return [
    { key: "Overview", label: "Overview", iconId: "overview" },
    { key: "Schema", label: "Schema", iconId: "schema" },
    { key: "Activity", label: "Activity & Tasks", iconId: "activity" },
    ...(previewAvailable ? [{ key: "SampleData", label: "Sample Data", iconId: "sample" }] : []),
    ...(workloadAvailable ? [{ key: "Queries", label: "Usage & Workloads", iconId: "queries" }] : []),
    { key: "Profiler", label: "Profiler & Evidence", iconId: "profiler" },
    { key: "Quality", label: "Quality", iconId: "quality" },
    ...(lineageAvailable ? [{ key: "Lineage", label: "Lineage", iconId: "lineage" }] : []),
    { key: "CustomProperties", label: "Custom Properties", iconId: "properties" },
  ];
}

function resolvedEntityTab(
  requestedTab,
  previewAvailable = true,
  lineageAvailable = true,
  workloadAvailable = true,
) {
  const allowedTabKeys = new Set(
    entityTabs(previewAvailable, lineageAvailable, workloadAvailable).map((tab) => tab.key),
  );
  return allowedTabKeys.has(requestedTab) ? requestedTab : "Overview";
}

function AttributeList({ items }) {
  return (
    <div className="gh-attribute-list">
      {items.map((item) => (
        <div className="gh-attribute-row" key={item.label}>
          <span className="gh-attribute-label">{item.label}</span>
          <span className="gh-attribute-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function CoverageSignalRows({ items, onOpenGovernance }) {
  return (
    <div className="gh-attribute-list">
      {items.map((signal) => (
        <div className="gh-attribute-row gh-coverage-row" key={signal.label}>
          <div className="gh-coverage-row-main">
            <div className="gh-panel-title">{signal.label}</div>
            <div className="gh-support-copy">{signal.note}</div>
            <button
              className="gh-tertiary-button gh-inline-link-button"
              onClick={onOpenGovernance}
              type="button"
            >
              Review in Governance
            </button>
          </div>
          <div className="gh-coverage-row-status">
            <span className={`gh-status-chip tone-${signal.complete ? "good" : "warn"}`}>
              {signal.complete ? "Covered" : "Needs review"}
            </span>
            <span className="gh-attribute-value">{signal.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricTile({ label, value, hint = "", tone = "" }) {
  const toneClass = tone ? ` tone-${tone}` : "";
  return (
    <div className={`gh-preview-stat-card gh-entity-metric-card${toneClass}`} title={hint || undefined}>
      <span className="gh-entity-metric-label">{label}</span>
      <strong className="gh-entity-metric-value">{value}</strong>
      {hint ? <span className="gh-entity-metric-hint">{hint}</span> : null}
    </div>
  );
}

function EntityRecordSection({
  title,
  description = "",
  titleMeta = null,
  actions = null,
  children = null,
  className = "",
}) {
  return (
    <SurfacePanelSection
      className={`gh-record-card gh-entity-record-section ${className}`.trim()}
      actions={actions}
      titleMeta={titleMeta}
      title={title}
    >
      {description ? <div className="gh-support-copy">{description}</div> : null}
      {children}
    </SurfacePanelSection>
  );
}

function OwnerList({ owners }) {
  if (!owners?.length) {
    return <div className="gh-support-copy">No owners are assigned to this asset yet.</div>;
  }

  return (
    <div className="gh-preview-owner-list">
      {owners.map((owner) => (
        <div className="gh-preview-owner-row" key={`${owner.name || owner.email || owner.title}`}>
          <strong>{owner.name || owner.email || "Owner"}</strong>
          <span>{owner.title || "Owner"}</span>
        </div>
      ))}
    </div>
  );
}

function MetadataEditorPanel({
  asset,
  bootstrap,
  editor,
  draft,
  dirty,
  onChange,
  onReset,
  onSave,
}) {
  const fields = editor.config?.fields || [];

  return (
    <EntityRecordSection
      className="gh-entity-record-editor-section"
      title="Metadata Controls"
      description="Update the record description and governance classifications when the backend edit surface is available."
      titleMeta={editor.available ? <span className="gh-state-pill">Writable</span> : null}
    >
      {editor.loading ? <div className="gh-support-copy">Checking metadata edit capability...</div> : null}
      {editor.error ? <div className="gh-inline-alert tone-warn">{editor.error}</div> : null}
      {editor.submitError ? <div className="gh-inline-alert tone-warn">{editor.submitError}</div> : null}
      {editor.submitSuccess ? <div className="gh-inline-alert">{editor.submitSuccess}</div> : null}

      {editor.available && fields.length ? (
        <form
          className="gh-metadata-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          {fields.map((field) => (
            <label className="gh-metadata-edit-field" key={field.key}>
              <span>{field.label}</span>
              {field.type === "textarea" ? (
                <textarea
                  className="gh-input gh-textarea"
                  onChange={(event) => onChange(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  rows={5}
                  value={draft[field.key] ?? ""}
                />
              ) : field.type === "text" ? (
                <>
                  <input
                    className="gh-input"
                    list={field.options.length ? `gh-metadata-${field.key}` : undefined}
                    onChange={(event) => onChange(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    value={draft[field.key] ?? ""}
                  />
                  {field.options.length ? (
                    <datalist id={`gh-metadata-${field.key}`}>
                      {field.options.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  ) : null}
                </>
              ) : (
                <select
                  className="gh-select"
                  onChange={(event) => onChange(field.key, event.target.value)}
                  value={draft[field.key] ?? ""}
                >
                  <option value="">{field.placeholder || `Select ${field.label.toLowerCase()}`}</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
              {field.helpText ? <small>{field.helpText}</small> : null}
            </label>
          ))}

          <div className="gh-record-form-actions">
            <button
              className="gh-primary-button"
              disabled={editor.submitting || !dirty}
              title={
                editor.submitting
                  ? "Saving metadata — please wait."
                  : !dirty
                    ? "No unsaved metadata changes to save."
                    : undefined
              }
              type="submit"
            >
              {editor.submitting ? "Saving..." : "Save metadata"}
            </button>
            <button
              className="gh-secondary-button"
              disabled={editor.submitting || !dirty}
              onClick={onReset}
              title={
                editor.submitting
                  ? "Saving metadata — please wait before resetting."
                  : !dirty
                    ? "No unsaved metadata changes to reset."
                    : undefined
              }
              type="button"
            >
              Reset
            </button>
          </div>
        </form>
      ) : (
        <div className="gh-record-readonly-note">
          <div className="gh-support-copy">
            {editor.config?.message
              ? editor.config.message
              : editor.hasContract
                ? "The backend did not return a usable metadata editor for this asset."
                : "Metadata editing is not currently exposed by the backend. The record remains read only."}
          </div>
          <AttributeList items={governancePostureSubset(asset)} />
        </div>
      )}
    </EntityRecordSection>
  );
}

function AuditFeed({ items = [], title }) {
  if (!items?.length) {
    return null;
  }

  return (
    <section className="gh-panel gh-record-card">
      <div className="gh-record-card-head">
        <div className="gh-panel-title">{title}</div>
      </div>
      <div className="gh-task-list gh-task-list-rows">
        {items.map((item) => (
          <div className="gh-task-row" key={item.id || `${item.action}-${item.createdAt}`}>
            <div className="gh-task-row-main">
              <div className="gh-task-row-head">
                <span className="gh-task-title">{item.action || "Metadata change"}</span>
                <span className="gh-status-chip tone-good">{item.status || "Success"}</span>
              </div>
              <div className="gh-support-copy">
                {item.detail || item.entityType || "Metadata audit entry"}
              </div>
              <div className="gh-support-copy">
                {item.actorEmail || "Unknown"}
                {item.createdAt ? ` • ${item.createdAt}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityFeed({ items, auditItems, onOpenGovernance }) {
  if (!items?.length) {
    return (
      <div className="gh-entity-record-primary">
        <div className="gh-empty-state">
          No governance activity is recorded for this asset yet.
          <div className="gh-empty-state-actions">
            <button className="gh-secondary-button" onClick={onOpenGovernance} type="button">
              Open governance workbench
            </button>
          </div>
        </div>
        <AuditFeed items={auditItems} title="Metadata changes" />
      </div>
    );
  }

  return (
    <div className="gh-entity-record-primary">
      <div className="gh-task-list gh-task-list-rows">
        {items.map((item) => (
          <div className="gh-task-row" key={item.id || `${item.title}-${item.createdAt}`}>
            <div className="gh-task-row-main">
              <div className="gh-task-row-head">
                <span className="gh-task-title">{item.title}</span>
                <span className={`gh-status-chip tone-${item.status === "Approved" ? "good" : item.status === "Rejected" ? "bad" : "warn"}`}>
                  {item.status}
                </span>
              </div>
              <div className="gh-support-copy">{item.detail}</div>
              <div className="gh-support-copy">
                {item.createdBy || "Unknown"}{item.createdAt ? ` • ${item.createdAt}` : ""}
              </div>
              {item.reviewNote ? <div className="gh-support-copy">{item.reviewNote}</div> : null}
            </div>
          </div>
        ))}
      </div>
      <AuditFeed items={auditItems} title="Metadata changes" />
    </div>
  );
}

function workloadDisplayName(item) {
  const explicitName = String(item?.name || "").trim();
  const identifier = String(item?.statementId || item?.entityId || item?.runId || "").trim();
  const entityLabel = String(item?.entityLabel || "Workload").trim();
  const relatedAsset = String(item?.relatedAssets?.[0] || "").trim();
  const relatedAssetLabel = relatedAsset ? relatedAsset.split(".").slice(-2).join(" / ") : "";
  if (explicitName && explicitName !== identifier) return explicitName;
  if (explicitName && explicitName.length <= 32 && !/^[0-9a-f]{8,}(-[0-9a-f]{4,}){0,}$/i.test(explicitName)) {
    return explicitName;
  }
  if (relatedAssetLabel) return relatedAssetLabel;
  if (entityLabel && identifier) return `${entityLabel} ${identifier.slice(0, 8)}`;
  return explicitName || entityLabel || "Workload";
}

function workloadIdentifier(item) {
  return String(item?.statementId || item?.entityId || item?.runId || "").trim();
}

function QueryRecords({
  producers = [],
  consumers = [],
  onOpenAssetReference,
}) {
  const sections = [
    { key: "producers", label: "Producing Workloads", items: producers },
    { key: "consumers", label: "Consuming Workloads", items: consumers },
  ];

  return (
    <div className="gh-entity-record-primary">
      {sections.map((section) => (
        <section className="gh-panel gh-record-card" key={section.key}>
          <div className="gh-record-card-head">
            <div>
              <div className="gh-panel-title">{section.label}</div>
              <div className="gh-support-copy">
                Jobs, queries, dashboards, and pipelines linked through Unity Catalog lineage.
              </div>
            </div>
          </div>
          {section.items.length ? (
            <div className="gh-task-list gh-task-list-rows">
              {section.items.map((item) => (
                <div className="gh-task-row" key={item.key}>
                  <div className="gh-task-row-main">
                    <div className="gh-task-row-head">
                      <span className="gh-task-title">{workloadDisplayName(item)}</span>
                      <span className="gh-chip gh-chip-soft">{item.entityLabel}</span>
                    </div>
                    {workloadIdentifier(item) ? (
                      <div className="gh-support-copy">{workloadIdentifier(item)}</div>
                    ) : null}
                    {item.relatedAssets?.length ? (
                      <div className="gh-chip-row">
                        {item.relatedAssets.slice(0, 4).map((assetFqn) => {
                          return (
                            <button
                              className="gh-chip gh-chip-soft"
                              data-asset-fqn={assetFqn}
                              key={`${item.key}-${assetFqn}`}
                              onClick={() => {
                                onOpenAssetReference?.(assetFqn, {
                                  fallbackContext: "Operational Context",
                                  loadingLabel: "Opening linked asset…",
                                  nextTab: "Overview",
                                });
                              }}
                              title={assetFqn}
                              type="button"
                            >
                              {assetFqn.split(".").slice(-2).join(" / ")}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="gh-empty-state">No workload usage was surfaced for this direction.</div>
          )}
        </section>
      ))}
    </div>
  );
}

function ProfilerCards({ cards = [] }) {
  if (!cards.length) {
    return <div className="gh-empty-state">No profiler or live evidence signals are available yet.</div>;
  }

  return (
    <div className="gh-preview-stat-grid gh-entity-record-metrics">
      {cards.map((card) => (
        <div className="gh-preview-stat-card gh-entity-metric-card" key={card.title}>
          <span>{card.title}</span>
          <strong>{card.value}</strong>
          <span className={`gh-status-chip tone-${card.status === "good" ? "good" : card.status === "missing" ? "warn" : card.status === "bad" ? "bad" : "warn"}`}>
            {card.status === "good" ? "Available" : card.status === "missing" ? "Missing" : "Needs work"}
          </span>
          <div className="gh-support-copy">{card.note}</div>
        </div>
      ))}
    </div>
  );
}

function PropertyList({ title, items = [], renderValue = (item) => item.value, className = "" }) {
  return (
    <EntityRecordSection className={`gh-entity-record-property-section ${className}`.trim()} title={title}>
      {items.length ? (
        <div className="gh-attribute-list">
          {items.map((item) => (
            <div className="gh-attribute-row" key={item.key || item.name}>
              <span className="gh-attribute-label">{item.key || item.name}</span>
              <span className="gh-attribute-value">{renderValue ? renderValue(item) : item.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="gh-empty-state">No values were surfaced for this section.</div>
      )}
    </EntityRecordSection>
  );
}

function statusText(value, fallback = "Unavailable") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function Asset360Panel({ data, loading = false, refreshing = false, error = "" }) {
  if (loading && !data) {
    return (
      <EntityRecordSection
        className="gh-entity-record-asset360-section"
        description="Loading the composite Asset 360 payload for this record."
        title="Asset 360"
      >
        <SkeletonBlock lines={4} message="Loading Asset 360…" />
      </EntityRecordSection>
    );
  }

  if (!data) {
    return (
      <EntityRecordSection
        className="gh-entity-record-asset360-section"
        description={error || "The composite Asset 360 payload is not available for this asset yet."}
        title="Asset 360"
      >
        <div className="gh-empty-state">
          {error || "Asset 360 is unavailable for this asset right now."}
        </div>
      </EntityRecordSection>
    );
  }

  const governance = data.governance || {};
  const usage = data.usage || {};
  const quality = data.quality || {};
  const freshness = data.freshness || {};
  const openActivity = Array.isArray(governance.openActivity) ? governance.openActivity.length : 0;
  const activityCount = Array.isArray(data.activity) ? data.activity.length : 0;
  const dashboardCount = Array.isArray(data.downstreamDashboards) ? data.downstreamDashboards.length : 0;
  const stewardCount = Array.isArray(data.stewards) ? data.stewards.length : 0;
  const schemaCount = Array.isArray(data.schema) ? data.schema.length : 0;
  const loadedSections = Array.isArray(data.loadedSections) ? data.loadedSections : [];
  const facts = [
    { label: "Composite state", value: refreshing ? "Refreshing…" : "Loaded" },
    { label: "Loaded sections", value: loadedSections.length ? loadedSections.join(", ") : "—" },
    { label: "Schema", value: schemaCount ? `${schemaCount} columns` : "No columns surfaced" },
    { label: "Stewards", value: stewardCount ? `${stewardCount}` : "None assigned" },
    { label: "Governance activity", value: openActivity || activityCount ? `${openActivity || activityCount}` : "None recorded" },
    { label: "Downstream dashboards", value: dashboardCount ? `${dashboardCount}` : "None surfaced" },
    {
      label: "Usage",
      value:
        usage.queryCount || usage.downstreamConsumerCount || usage.downstreamAssetCount
          ? [
              usage.queryCount ? `${usage.queryCount} queries` : null,
              usage.downstreamConsumerCount ? `${usage.downstreamConsumerCount} consumers` : null,
              usage.downstreamAssetCount ? `${usage.downstreamAssetCount} related` : null,
            ].filter(Boolean).join(" · ")
          : "No usage surfaced",
    },
    { label: "Freshness", value: freshness.message || statusText(freshness.state) },
    { label: "Quality", value: quality.message || statusText(quality.state) },
  ];

  return (
    <EntityRecordSection
      className="gh-entity-record-asset360-section"
      description="Composite live context returned by the Atlas Asset 360 endpoint for the selected record."
      title="Asset 360"
      titleMeta={refreshing ? <span className="gh-state-pill">Refreshing</span> : null}
    >
      {error ? <div className="gh-inline-alert tone-warn">{error}</div> : null}
      {data.badges?.length ? (
        <div className="gh-chip-row">
          {data.badges.slice(0, 8).map((badge) => (
            <span className="gh-chip gh-chip-soft" key={badge}>{badge}</span>
          ))}
        </div>
      ) : null}
      <AttributeList items={facts} />
    </EntityRecordSection>
  );
}

export default function EntityWorkspace({
  assetFqn,
  bootstrap,
  contextSeedAssets = [],
  onNavigationStateChange,
  onSurfaceReady,
  sharedVisibleAssetSet,
  onGovernanceChange,
  onBack,
  onOpenGovernance,
  onOpenLineage,
  onSelectAsset,
  runtimeFeatureFlags = [],
  workspaceAccess = null,
}) {
  const previewAvailable = systemInventoryAvailable(bootstrap);
  const previewUnavailableReason = systemInventoryReason(bootstrap);
  const lineageAvailable = tableLineageAvailable(bootstrap);
  const lineageUnavailableReason = tableLineageReason(bootstrap);
  const workloadAvailable = workloadVisibilityAvailable(bootstrap);
  const workloadUnavailableReason = workloadVisibilityReason(bootstrap);
  const workspacePreviewAvailable = workspaceAccessAvailable(workspaceAccess, "canUseAssetPreview", false);
  const workspaceLineageAvailable = workspaceAccessAvailable(workspaceAccess, "canUseLineage", false);
  const workspaceWorkloadAvailable = workspaceAccessAvailable(workspaceAccess, "canUseQueryHistory", false);
  const lineageRolloutAvailable = runtimeFeatureFlagAvailable(
    runtimeFeatureFlags,
    "table_lineage_surface",
  );
  const workloadRolloutAvailable = runtimeFeatureFlagAvailable(
    runtimeFeatureFlags,
    "query_history_surface",
  );
  const workspaceAccessResolved = Boolean(
    workspaceAccess &&
      (
        workspaceAccess.mode ||
        workspaceAccess.observedAt ||
        Array.isArray(workspaceAccess.gates) ||
        typeof workspaceAccess.canUseAssetPreview === "boolean" ||
        typeof workspaceAccess.canUseLineage === "boolean" ||
        typeof workspaceAccess.canUseQueryHistory === "boolean"
      ),
  );
  const previewTabAvailable = previewAvailable && (!workspaceAccessResolved || workspacePreviewAvailable);
  const lineageTabAvailable =
    lineageAvailable && lineageRolloutAvailable && (!workspaceAccessResolved || workspaceLineageAvailable);
  const workloadTabAvailable =
    workloadAvailable && workloadRolloutAvailable && (!workspaceAccessResolved || workspaceWorkloadAvailable);
  const previewAccessPending = previewAvailable && !workspaceAccessResolved;
  const lineageAccessPending = lineageAvailable && lineageRolloutAvailable && !workspaceAccessResolved;
  const workloadAccessPending = workloadAvailable && workloadRolloutAvailable && !workspaceAccessResolved;
  const lineageSurfaceAvailable =
    lineageAvailable && lineageRolloutAvailable && workspaceAccessResolved && workspaceLineageAvailable;
  const previewSurfaceAvailable = previewAvailable && workspaceAccessResolved && workspacePreviewAvailable;
  const workloadSurfaceAvailable =
    workloadAvailable && workloadRolloutAvailable && workspaceAccessResolved && workspaceWorkloadAvailable;
  const lineageRolloutUnavailableReason =
    "Table lineage rollout is not available in this workspace right now.";
  const workloadRolloutUnavailableReason =
    "Query and workload surfaces are not available in this workspace right now.";
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
  const workloadSurfaceUnavailableReason = !workspaceWorkloadAvailable
    ? workspaceAccessReason(workspaceAccess, "workload_visibility", workloadUnavailableReason)
    : workloadAvailable
    ? workloadRolloutAvailable
      ? workloadUnavailableReason
      : runtimeFeatureFlagReason(
          runtimeFeatureFlags,
          "query_history_surface",
          workloadRolloutUnavailableReason,
        )
    : workloadUnavailableReason;
  const previewSurfaceUnavailableReason = !workspacePreviewAvailable
    ? workspaceAccessReason(workspaceAccess, "asset_preview", previewUnavailableReason)
    : previewUnavailableReason ||
      "Live preview rows are not available in this workspace right now.";
  const [activeTab, setActiveTab] = useState(() => {
    return resolvedEntityTab(
      peekWorkspaceIntent("entityTab", assetFqn, "Overview") || "Overview",
      previewTabAvailable,
      lineageTabAvailable,
      workloadTabAvailable,
    );
  });
  const [localLineageContext, setLocalLineageContext] = useState(() =>
    peekWorkspaceIntent("lineageContext", assetFqn, "Data Lineage") || "Data Lineage",
  );
  const [localOverrides, setLocalOverrides] = useState({});
  const [metadataDraft, setMetadataDraft] = useState(metadataDraftFromAsset(null));
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [selectedColumnName, setSelectedColumnName] = useState("");
  const [schemaColumnFilter, setSchemaColumnFilter] = useState("");
  const [columnDraft, setColumnDraft] = useState({ description: "", tags: "" });
  const [columnMutation, setColumnMutation] = useState({
    loading: false,
    error: "",
    success: "",
  });
  const [linkNotice, setLinkNotice] = useState("");
  const [linkedRecordUnavailableOverrides, setLinkedRecordUnavailableOverrides] = useState({});
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const launchAssets = seedAssets.slice(0, 6);
  const tabs = useMemo(
    () => entityTabs(previewTabAvailable, lineageTabAvailable, workloadTabAvailable),
    [lineageTabAvailable, previewTabAvailable, workloadTabAvailable],
  );
  const visibleAssetSet = useMemo(() => {
    if (sharedVisibleAssetSet?.size) return new Set(sharedVisibleAssetSet);
    return new Set(seedAssets.map((candidate) => candidate?.fqn).filter(Boolean));
  }, [seedAssets, sharedVisibleAssetSet]);
  const seeded = useSeededAssetContext(assetFqn, bootstrap, seedAssets, {
    allowFallback: false,
  });
  const requestedDetailSections = useMemo(
    () => detailSectionsForTab(activeTab, previewSurfaceAvailable, workloadSurfaceAvailable),
    [activeTab, previewSurfaceAvailable, workloadSurfaceAvailable],
  );
  const assetDetail = useAssetDetail(assetFqn || "", { sections: requestedDetailSections });
  const usableDetail = isUsableAssetDetail(assetDetail.detail) ? assetDetail.detail : null;
  const baseAsset = usableDetail || seeded.summary;
  const asset360 = useAsset360(assetFqn || "", {
    enabled: Boolean(assetFqn && baseAsset?.fqn === assetFqn),
  });
  const asset360Data =
    asset360.data?.sameAsset && asset360.data?.asset?.fqn === assetFqn ? asset360.data : null;
  const compositeBaseAsset = useMemo(() => {
    if (!baseAsset || !asset360Data?.asset) return baseAsset;
    const mergedUsage = {
      ...(baseAsset.usage || {}),
      ...(asset360Data.asset.usage || {}),
      ...(asset360Data.usage || {}),
    };
    const mergedColumns =
      Array.isArray(asset360Data.schema) && asset360Data.schema.length
        ? asset360Data.schema
        : asset360Data.asset.columns || baseAsset.columns;
    return {
      ...baseAsset,
      ...asset360Data.asset,
      usage: mergedUsage,
      columns: mergedColumns,
      activity: Array.isArray(asset360Data.activity) && asset360Data.activity.length
        ? asset360Data.activity
        : asset360Data.asset.activity || baseAsset.activity,
      relatedAssets: Array.isArray(asset360Data.relatedAssets) && asset360Data.relatedAssets.length
        ? asset360Data.relatedAssets
        : asset360Data.asset.relatedAssets || baseAsset.relatedAssets,
      loadedSections: Array.isArray(asset360Data.loadedSections) && asset360Data.loadedSections.length
        ? [...new Set([...(baseAsset.loadedSections || []), ...asset360Data.loadedSections])]
        : baseAsset.loadedSections,
    };
  }, [asset360Data, baseAsset]);
  const asset = useMemo(
    () => (compositeBaseAsset ? { ...compositeBaseAsset, ...localOverrides } : compositeBaseAsset),
    [compositeBaseAsset, localOverrides],
  );
  const loadedSections = useMemo(
    () => new Set(assetDetail.detail?.loadedSections || []),
    [assetDetail.detail?.loadedSections],
  );
  const schemaLoaded = loadedSections.has("schema");
  const previewLoaded = loadedSections.has("preview");
  const operationalLoaded = loadedSections.has("operational") || loadedSections.has("profiler");
  const propertiesLoaded = loadedSections.has("properties");
  const profilerLoaded = loadedSections.has("profiler");
  const activityLoaded = loadedSections.has("activity");
  const [overviewLineageWarm, setOverviewLineageWarm] = useState(false);
  const lineageEnabled =
    lineageSurfaceAvailable &&
    (activeTab === "Lineage" ||
      (workloadSurfaceAvailable && activeTab === "Queries") ||
      (activeTab === "Overview" &&
        overviewLineageWarm &&
        Boolean(asset?.fqn) &&
        loadedSections.has("header")));
  const lineage = useLineage(assetFqn || "", lineageEnabled);
  const lineageBundle = lineage.graph;
  const lineageAuthoritative = lineage.authoritative;
  const lineageProvisional = lineage.provisional;
  const authoritativeLineageBundle = lineageAuthoritative ? lineageBundle : null;
  const lineagePayload = lineage.payload;
  const lineageLoading = lineage.loading;
  const editor = useAssetMetadataEditor({ assetFqn: assetFqn || "", asset, bootstrap });
  const focusAssetFqn = asset?.fqn || assetFqn || "";
  const graphRelatedAssets = useMemo(
    () =>
      dedupeLinkedAssets(
        relatedAssetsFromGraph(authoritativeLineageBundle, focusAssetFqn, localLineageContext),
        focusAssetFqn,
      ),
    [authoritativeLineageBundle, focusAssetFqn, localLineageContext],
  );
  const lineageNeighbors = useMemo(
    () => lineageNeighborGroups(authoritativeLineageBundle, focusAssetFqn, localLineageContext),
    [authoritativeLineageBundle, focusAssetFqn, localLineageContext],
  );
  const relatedAssets = useMemo(
    () =>
      lineageSurfaceAvailable
        ? dedupeLinkedAssets([...(asset?.relatedAssets || []), ...graphRelatedAssets], asset?.fqn)
        : [],
    [asset?.fqn, asset?.relatedAssets, graphRelatedAssets, lineageSurfaceAvailable],
  );
  const columns = asset?.columns || [];
  const preview = asset?.preview || [];
  const detailLoading = assetDetail.loading;
  const detailReady = Boolean(usableDetail);
  const detailHydrating = detailLoading && !asset;
  const detailUnavailable = Boolean(assetDetail.error) && !detailReady;
  const schemaUnavailable = Boolean(assetDetail.error) && !schemaLoaded;
  const previewUnavailable = !previewSurfaceAvailable || (Boolean(assetDetail.error) && !previewLoaded);
  const operationalUnavailable = Boolean(assetDetail.error) && !operationalLoaded;
  const propertiesUnavailable = Boolean(assetDetail.error) && !propertiesLoaded;
  const profilerUnavailable = Boolean(assetDetail.error) && !profilerLoaded;
  const columnMetadataEditable = editor.available;
  const columnMetadataReadOnlyMessage =
    editor.config?.message ||
    "Column metadata editing is not available for this asset type right now.";
  const liveColumns = detailReady && schemaLoaded ? columns : [];
  const filteredLiveColumns = useMemo(() => {
    const term = schemaColumnFilter.trim().toLowerCase();
    if (!term) return liveColumns;
    return liveColumns.filter((column) => {
      const name = (column?.name || "").toLowerCase();
      const description = (column?.description || "").toLowerCase();
      return name.includes(term) || description.includes(term);
    });
  }, [liveColumns, schemaColumnFilter]);
  const livePreview = detailReady && previewSurfaceAvailable && previewLoaded ? preview : [];
  const upstreamAssets = useMemo(
    () => dedupeLinkedAssets(lineageNeighbors.upstream, focusAssetFqn),
    [focusAssetFqn, lineageNeighbors.upstream],
  );
  const downstreamAssets = useMemo(
    () => dedupeLinkedAssets(lineageNeighbors.downstream, focusAssetFqn),
    [focusAssetFqn, lineageNeighbors.downstream],
  );

  useEffect(() => {
    if (!assetFqn) return;
    if (asset?.fqn === assetFqn && (!detailLoading || usableDetail?.fqn === assetFqn)) {
      onSurfaceReady?.();
    }
  }, [asset?.fqn, assetFqn, detailLoading, onSurfaceReady, usableDetail?.fqn]);

  useEffect(() => {
    setLinkNotice("");
  }, [assetFqn]);
  useEffect(() => {
    setLinkedRecordUnavailableOverrides({});
  }, [assetFqn]);
  const linkedAssetCandidates = useMemo(
    () => [...new Set([...upstreamAssets, ...downstreamAssets, ...relatedAssets])],
    [downstreamAssets, relatedAssets, upstreamAssets],
  );
  const linkedAssetAvailability = useAssetAvailability(linkedAssetCandidates, visibleAssetSet, {
    strict: true,
    requireRenderableDetail: false,
  });
  const renderableUpstreamAssets = useMemo(
    () => upstreamAssets.filter((item) => linkedAssetAvailability[item] === true),
    [linkedAssetAvailability, upstreamAssets],
  );
  const renderableDownstreamAssets = useMemo(
    () => downstreamAssets.filter((item) => linkedAssetAvailability[item] === true),
    [downstreamAssets, linkedAssetAvailability],
  );
  const renderableRelatedAssets = useMemo(
    () => relatedAssets.filter((item) => linkedAssetAvailability[item] === true),
    [linkedAssetAvailability, relatedAssets],
  );
  const connectedAssetCount = useMemo(
    () => new Set([...upstreamAssets, ...downstreamAssets, ...relatedAssets]).size,
    [downstreamAssets, relatedAssets, upstreamAssets],
  );
  const previewKeys = livePreview[0] ? Object.keys(livePreview[0]) : [];
  const postureChecks = governanceCoverageSignals(asset || {});
  const objectType = asset ? displayObjectType(asset) || (detailHydrating ? "Loading…" : "") : "";
  const identityLine = asset ? assetPathLabel(asset) : assetFqn;
  const lineageUnavailable =
    Boolean(lineage.error) &&
    !lineageAuthoritative &&
    !upstreamAssets.length &&
    !downstreamAssets.length &&
    !relatedAssets.length;
  const liveDetailStatus = detailHydrating
    ? "Loading live detail…"
    : detailLoading
      ? "Refreshing live detail…"
      : "";
  const schemaPending = activeTab === "Schema" && detailLoading && !schemaLoaded;
  const previewPending = activeTab === "SampleData" && previewSurfaceAvailable && detailLoading && !previewLoaded;
  const operationalPending = activeTab === "Queries" && detailLoading && !operationalLoaded;
  const propertiesPending = activeTab === "CustomProperties" && detailLoading && !propertiesLoaded;
  const profilerPending = activeTab === "Profiler" && detailLoading && !profilerLoaded;
  const profilerCards = useMemo(
    () =>
      (asset?.profiler?.cards || []).filter((card) => {
        const title = String(card?.title || "").trim().toLowerCase();
        if (!previewSurfaceAvailable && title === "sample data") return false;
        if (!lineageSurfaceAvailable && title === "lineage context") return false;
        if (!workloadSurfaceAvailable && title === "operational usage") return false;
        return true;
      }),
    [asset?.profiler?.cards, lineageSurfaceAvailable, previewSurfaceAvailable, workloadSurfaceAvailable],
  );
  const profilerSummary = asset?.profiler?.summary || {};
  const coverageScore = Number(asset?.coverageScore ?? NaN);
  const coverageTone = Number.isFinite(coverageScore)
    ? coverageScore >= 75
      ? "good"
      : coverageScore >= 40
        ? "warn"
        : "bad"
    : "";
  const ownersCount = asset?.owners?.length || 0;
  const ownersTone = ownersCount > 0 ? "good" : "bad";
  const openRequests = Number(asset?.openRequests ?? NaN);
  const openRequestsTone = Number.isFinite(openRequests)
    ? openRequests === 0
      ? "good"
      : openRequests > 3
        ? "warn"
        : ""
    : "";
  const metricTiles = [
    {
      label: "Coverage",
      value: asset?.coverageScore == null ? "—" : `${asset.coverageScore}`,
      tone: coverageTone,
      hint: Number.isFinite(coverageScore) ? `${coverageScore}/100 governance signals` : "",
    },
    {
      label: "Owners",
      value: `${ownersCount}`,
      tone: ownersTone,
      hint: ownersCount === 0 ? "No owner assigned" : `${ownersCount} owner${ownersCount === 1 ? "" : "s"} on file`,
    },
    {
      label: "Open Requests",
      value: asset?.openRequests == null ? "—" : `${asset.openRequests}`,
      tone: openRequestsTone,
    },
    {
      label: "Workloads",
      value: workloadAccessPending
        ? "Checking access..."
        : !workloadSurfaceAvailable
        ? "Unavailable"
        : operationalLoaded
          ? `${(asset?.usage?.producerCount || 0) + (asset?.usage?.consumerCount || 0)}`
          : detailLoading
            ? "Loading…"
            : "—",
    },
    {
      label: "Connected Assets",
      value: lineageAccessPending
        ? "Checking access..."
        : !lineageSurfaceAvailable
        ? "Unavailable"
        : (lineageLoading || lineageProvisional) && !connectedAssetCount
          ? "Loading…"
          : `${connectedAssetCount}`,
    },
  ];

  useEffect(() => {
    const nextContext = consumeWorkspaceIntent("lineageContext", assetFqn, "") || "Data Lineage";
    setLocalLineageContext(nextContext);
  }, [assetFqn]);

  useEffect(() => {
    const nextTab = (
      workspaceAccessResolved
        ? consumeWorkspaceIntent("entityTab", assetFqn, "Overview")
        : peekWorkspaceIntent("entityTab", assetFqn, "Overview")
    ) || "Overview";
    setActiveTab(
      resolvedEntityTab(
        nextTab,
        workspaceAccessResolved ? previewSurfaceAvailable : previewTabAvailable,
        workspaceAccessResolved ? lineageSurfaceAvailable : lineageTabAvailable,
        workspaceAccessResolved ? workloadSurfaceAvailable : workloadTabAvailable,
      ),
    );
    setLocalOverrides({});
    setMetadataDirty(false);
    setSelectedColumnName("");
    setSchemaColumnFilter("");
    setColumnDraft({ description: "", tags: "" });
    setColumnMutation({ loading: false, error: "", success: "" });
  }, [
    assetFqn,
    lineageSurfaceAvailable,
    lineageTabAvailable,
    previewSurfaceAvailable,
    previewTabAvailable,
    workloadSurfaceAvailable,
    workloadTabAvailable,
    workspaceAccessResolved,
  ]);

  useEffect(() => {
    if (!workspaceAccessResolved) return;
    if (!previewSurfaceAvailable && activeTab === "SampleData") {
      setActiveTab("Overview");
    }
    if (!lineageSurfaceAvailable && activeTab === "Lineage") {
      setActiveTab("Overview");
    }
    if (!workloadSurfaceAvailable && activeTab === "Queries") {
      setActiveTab("Overview");
    }
  }, [activeTab, lineageSurfaceAvailable, previewSurfaceAvailable, workloadSurfaceAvailable, workspaceAccessResolved]);

  useEffect(() => {
    if (!assetFqn) return;
    setWorkspaceIntent("entityTab", assetFqn, activeTab);
  }, [activeTab, assetFqn]);

  useEffect(() => {
    if (!asset || metadataDirty) return;
    setMetadataDraft(metadataDraftFromAsset(asset));
  }, [
    asset?.description,
    asset?.domain,
    asset?.tier,
    asset?.certification,
    asset?.sensitivity,
    asset?.criticality,
    asset?.data_product,
    asset?.dataProduct,
    asset?.tagEntries,
    asset?.fqn,
    metadataDirty,
  ]);

  useEffect(() => {
    if (!selectedColumnName) return;
    const selectedColumn = (asset?.columns || []).find((column) => column.name === selectedColumnName);
    if (!selectedColumn) {
      setSelectedColumnName("");
      setColumnDraft({ description: "", tags: "" });
      return;
    }
    setColumnDraft({
      description:
        selectedColumn.description && selectedColumn.description !== "No description"
          ? selectedColumn.description
          : "",
      tags: (selectedColumn.tags || [])
        .map((tag) => {
          const key = tag?.name || "";
          const value = tag?.value || "";
          return value ? `${key}=${value}` : key;
        })
        .filter(Boolean)
        .join(", "),
    });
  }, [asset?.columns, selectedColumnName]);

  useEffect(() => {
    if (selectedColumnName || !liveColumns.length) return;
    setSelectedColumnName(liveColumns[0].name);
  }, [liveColumns, selectedColumnName]);

  useEffect(() => {
    if (!lineageSurfaceAvailable) {
      setOverviewLineageWarm(false);
      return undefined;
    }
    if (activeTab === "Lineage" || activeTab === "Queries") {
      setOverviewLineageWarm(true);
      return undefined;
    }
    if (activeTab !== "Overview" || !asset?.fqn || !loadedSections.has("header")) {
      setOverviewLineageWarm(false);
      return undefined;
    }
    let timeoutId = 0;
    let idleId = 0;
    setOverviewLineageWarm(false);
    const enableOverviewLineage = () => {
      setOverviewLineageWarm(true);
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(enableOverviewLineage, { timeout: 1400 });
    } else if (typeof window !== "undefined") {
      timeoutId = window.setTimeout(enableOverviewLineage, 360);
    } else {
      enableOverviewLineage();
    }
    return () => {
      if (typeof window !== "undefined" && idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (typeof window !== "undefined" && timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeTab, asset?.fqn, lineageSurfaceAvailable, loadedSections]);

  useEffect(() => {
    if (activeTab !== "Overview" || !assetFqn || !loadedSections.has("header") || detailLoading) return undefined;
    const firstWaveSections = ["activity", "schema"].filter((section) => !loadedSections.has(section));
    const secondWaveSections = [
      ...(previewSurfaceAvailable ? ["preview"] : []),
      ...(workloadSurfaceAvailable ? ["operational"] : []),
    ].filter((section) => !loadedSections.has(section));
    const thirdWaveSections = ["profiler", "properties"].filter((section) => !loadedSections.has(section));
    if (!firstWaveSections.length && !secondWaveSections.length && !thirdWaveSections.length) return undefined;
    let cancelled = false;
    let firstWaveTimeoutId = 0;
    let secondWaveTimeoutId = 0;
    let thirdWaveTimeoutId = 0;
    let idleId = 0;
    const warmFirstWave = () => {
      if (cancelled) return;
      if (firstWaveSections.length) {
        void prefetchAssetDetail(assetFqn, { sections: firstWaveSections });
      }
    };
    const warmSecondWave = () => {
      if (cancelled || !secondWaveSections.length) return;
      void prefetchAssetDetail(assetFqn, { sections: secondWaveSections });
    };
    const warmThirdWave = () => {
      if (cancelled || !thirdWaveSections.length) return;
      void prefetchAssetDetail(assetFqn, { sections: thirdWaveSections });
    };

    if (typeof window !== "undefined") {
      firstWaveTimeoutId = window.setTimeout(warmFirstWave, 1100);
      if (secondWaveSections.length && typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(warmSecondWave, { timeout: 4200 });
      } else if (secondWaveSections.length) {
        secondWaveTimeoutId = window.setTimeout(warmSecondWave, 2800);
      }
      if (thirdWaveSections.length) {
        thirdWaveTimeoutId = window.setTimeout(warmThirdWave, 5600);
      }
    } else {
      warmFirstWave();
      warmSecondWave();
      warmThirdWave();
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (typeof window !== "undefined" && firstWaveTimeoutId) {
        window.clearTimeout(firstWaveTimeoutId);
      }
      if (typeof window !== "undefined" && secondWaveTimeoutId) {
        window.clearTimeout(secondWaveTimeoutId);
      }
      if (typeof window !== "undefined" && thirdWaveTimeoutId) {
        window.clearTimeout(thirdWaveTimeoutId);
      }
    };
  }, [activeTab, assetFqn, detailLoading, loadedSections, previewSurfaceAvailable, workloadSurfaceAvailable]);

  if (assetFqn && assetDetail.loading && !asset) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <WorkspaceStateCard
          eyebrow="Loading Asset"
          loading
          message={`Loading the record header and recent activity for ${assetFqn}.`}
          title="Refreshing the metadata record."
        />
      </section>
    );
  }

  if (assetFqn && !asset && !assetDetail.loading) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <WorkspaceStateCard
          actions={(
            <button className="gh-secondary-button" onClick={onBack} type="button">
              Return to Catalog
            </button>
          )}
          eyebrow="Asset Unavailable"
          message={
            assetDetail.error ||
            "This asset appears in lineage or linked navigation, but it is not currently visible in the live catalog with the current permissions."
          }
          title="The selected asset could not be opened."
          tone="bad"
        >
          {launchAssets.length ? (
            <div className="gh-chip-stack">
              {launchAssets.map((candidate) => (
                <button
                  className="gh-filter-chip gh-chip-soft"
                  key={candidate.fqn}
                  onClick={() => onSelectAsset(candidate.fqn)}
                  type="button"
                >
                  {candidate.name}
                </button>
              ))}
            </div>
          ) : null}
        </WorkspaceStateCard>
      </section>
    );
  }

  if (!asset) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <WorkspaceStateCard eyebrow="Asset" title="Select an asset to inspect its metadata.">
          <EmptyStateBlock
            actions={(
              <button className="gh-secondary-button" onClick={onBack} type="button">
                Return to Catalog
              </button>
            )}
            message="Select an asset from discovery to inspect its metadata."
          >
            {launchAssets.length ? (
              <div className="gh-chip-stack">
                {launchAssets.map((candidate) => (
                  <button
                    className="gh-filter-chip gh-chip-soft"
                    key={candidate.fqn}
                    onClick={() => onSelectAsset(candidate.fqn)}
                    type="button"
                  >
                    {candidate.name}
                  </button>
                ))}
              </div>
            ) : null}
          </EmptyStateBlock>
        </WorkspaceStateCard>
      </section>
    );
  }

  const handleMetadataChange = (key, value) => {
    setMetadataDirty(true);
    setMetadataDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const resetMetadataDraft = () => {
    setMetadataDraft(metadataDraftFromAsset(asset));
    setMetadataDirty(false);
  };

  const saveMetadata = async () => {
    const description = metadataDraft.description.trim();
    const domain = metadataDraft.domain.trim();
    const tier = metadataDraft.tier.trim();
    const certification = metadataDraft.certification.trim();
    const sensitivity = metadataDraft.sensitivity.trim();
    const criticality = metadataDraft.criticality.trim();
    const dataProduct = metadataDraft.dataProduct.trim();
    const freeformTags = metadataDraft.freeformTags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .reduce((acc, entry) => {
        const [rawKey, ...valueParts] = entry.split("=");
        const key = rawKey.trim();
        const value = valueParts.join("=").trim();
        if (key && value) acc[key] = value;
        return acc;
      }, {});
    const payload = {
      assetFqn: asset.fqn,
      description,
      domain: domain || null,
      tier: tier || null,
      certification: certification || null,
      sensitivity: sensitivity || null,
      criticality: criticality || null,
      dataProduct: dataProduct || null,
      freeformTags,
    };

    const response = await editor.save(payload);
    const nextAsset = response?.asset || null;
    if (nextAsset?.fqn) {
      primeAssetDetail(nextAsset.fqn, nextAsset);
      clearAssetSearchCache();
      setLocalOverrides({});
    } else {
      invalidateAssetDetail(asset.fqn);
      const refreshedAsset = await prefetchAssetDetail(asset.fqn, {
        force: true,
        sections: ["header", "activity"],
      }).catch(() => null);
      if (refreshedAsset?.fqn) {
        setLocalOverrides({});
      } else {
        setLocalOverrides((current) => ({
          ...current,
          description: description || "No description has been captured for this asset yet.",
          domain: domain || "Unassigned",
          tier: tier || "Unassigned",
          certification: certification || "Unassigned",
          sensitivity: sensitivity || "Unassigned",
          criticality: criticality || "Unassigned",
          dataProduct: dataProduct || "Unassigned",
          tagEntries: Object.entries(freeformTags).map(([name, value]) => ({
            name,
            value,
            label: value ? `${name}=${value}` : name,
          })),
        }));
      }
    }
    if (response?.governance) {
      onGovernanceChange?.(response.governance);
    }
    setMetadataDirty(false);
  };

  const saveColumnMetadata = async () => {
    if (!asset?.fqn || !selectedColumnName) return;
    const description = columnDraft.description.trim();
    const tags = columnDraft.tags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .reduce((acc, entry) => {
        const [rawKey, ...valueParts] = entry.split("=");
        const key = rawKey.trim();
        const value = valueParts.join("=").trim();
        if (key) acc[key] = value;
        return acc;
      }, {});

    setColumnMutation({ loading: true, error: "", success: "" });
    try {
      let response = null;
      try {
        response = await updateAssetColumnMetadata(asset.fqn, selectedColumnName, {
          description,
          tags,
        });
      } catch (error) {
        if (![404, 405, 501].includes(error?.status)) {
          throw error;
        }
        const descriptionResponse = await updateAssetColumnDescription(
          asset.fqn,
          selectedColumnName,
          description,
        );
        const tagsResponse = await updateAssetColumnTags(asset.fqn, selectedColumnName, tags);
        response = tagsResponse || descriptionResponse;
      }
      const nextAsset = response?.asset || null;
      if (nextAsset?.fqn) {
        primeAssetDetail(nextAsset.fqn, nextAsset);
        clearAssetSearchCache();
        setLocalOverrides({});
      } else {
        invalidateAssetDetail(asset.fqn);
        const refreshedAsset = await prefetchAssetDetail(asset.fqn, {
          force: true,
          sections: ["header", "schema", "activity"],
        }).catch(() => null);
        if (refreshedAsset?.fqn) {
          setLocalOverrides({});
        }
      }
      onGovernanceChange?.(response?.governance || null);
      const warning = String(response?.warning || "").trim();
      setColumnMutation({
        loading: false,
        error: warning,
        success: warning ? "Column metadata saved with warning." : "Column metadata saved.",
      });
    } catch (error) {
      setColumnMutation({
        loading: false,
        error: error?.message || "Unable to save column metadata.",
        success: "",
      });
    }
  };

  const openAssetReference = async (
    nextAssetFqn,
    {
      fallbackContext = localLineageContext,
      loadingLabel = "Opening linked metadata record…",
      markUnavailableOnFailure = false,
      nextTab = "Overview",
    } = {},
  ) => {
    if (!nextAssetFqn) return;
    setLinkNotice("");
    return openAssetRecordSafely(nextAssetFqn, {
      loadingLabel,
      sections: ["header", "activity"],
      canOpen: canOpenLinkedAssetRecord,
      onNavigationStateChange,
      beforeOpen: () => {
        setWorkspaceIntent("lineageContext", nextAssetFqn, fallbackContext);
      },
      onOpen: () => {
        if (markUnavailableOnFailure) {
          setLinkedRecordUnavailableOverrides((current) => {
            if (!current[nextAssetFqn]) return current;
            const next = { ...current };
            delete next[nextAssetFqn];
            return next;
          });
        }
        onSelectAsset(nextAssetFqn, nextTab);
      },
      onUnavailable: ({ availability = null, detail = null, error = null } = {}) => {
        const explicitUnavailable =
          markUnavailableOnFailure &&
          !error &&
          (
            availability?.openable === false ||
            availability?.visible === false ||
            availability?.exists === false ||
            Boolean(detail?.fqn)
          );
        if (explicitUnavailable) {
          setLinkedRecordUnavailableOverrides((current) =>
            current[nextAssetFqn] ? current : { ...current, [nextAssetFqn]: true });
        }
        setLinkNotice(
          "That linked asset is surfaced by live lineage, but its metadata record is not openable with the current permissions.",
        );
      },
    });
  };

  const renderLinkedAssetRow = (item, keyPrefix) => {
    const availabilityState =
      linkedRecordUnavailableOverrides[item] === true ? false : linkedAssetAvailability[item];
    if (availabilityState === false) {
      return (
        <div className="gh-lineage-linked-row is-readonly" key={`${keyPrefix}-${item}`}>
          <span>{item}</span>
          <span>Metadata record unavailable</span>
        </div>
      );
    }
    return (
      <button
        className="gh-lineage-linked-row is-asset-link"
        key={`${keyPrefix}-${item}`}
        onClick={() => {
          void openAssetReference(item, {
            fallbackContext: localLineageContext,
            loadingLabel: "Opening linked metadata record…",
            markUnavailableOnFailure: true,
            nextTab: "Overview",
          });
        }}
        onMouseEnter={() => {
          prefetchAssetAvailability([item]);
          prefetchAssetDetail(item, { sections: ["header"] });
        }}
        type="button"
      >
        <span>{item}</span>
        <span>{availabilityState === null ? "Checking access..." : "Open Record"}</span>
      </button>
    );
  };

  const selectedColumn =
    liveColumns.find((column) => column.name === selectedColumnName) || liveColumns[0] || null;
  const operationalContext =
    operationalLoaded && asset.operationalContext
      ? asset.operationalContext
      : { producers: [], consumers: [] };
  const lineageStats = lineagePayload?.stats || {};
  const columnLineage = lineagePayload?.columnLineage || { upstream: [], downstream: [] };
  const selectedColumnUpstream =
    columnLineage.upstream.find((entry) => entry.column === selectedColumn?.name)?.sources || [];
  const selectedColumnDownstream =
    columnLineage.downstream.find((entry) => entry.column === selectedColumn?.name)?.targets || [];
  const profilerLineageMeta = (() => {
    const upstreamCount = Number.isFinite(lineageStats.upstreamCount) ? lineageStats.upstreamCount : null;
    const downstreamCount = Number.isFinite(lineageStats.downstreamCount) ? lineageStats.downstreamCount : null;
    if (!lineageSurfaceAvailable || (!lineageAuthoritative && upstreamCount == null && downstreamCount == null)) {
      return [];
    }
    return [
      upstreamCount == null ? null : `${upstreamCount} upstream`,
      downstreamCount == null ? null : `${downstreamCount} downstream`,
    ].filter(Boolean);
  })();
  const recordFacts = [
    {
      label: "Management",
      value: displayManagementType(asset) || (detailLoading ? "Loading…" : "—"),
    },
    { label: "Rows", value: asset.rows || (detailLoading ? "Loading…" : "—") },
    { label: "Storage Format", value: displayStorageFormat(asset) || (detailLoading ? "Loading…" : "—") },
    { label: "Size", value: asset.size || (detailLoading ? "Loading…" : "—") },
    { label: "Files", value: asset.files || (detailLoading ? "Loading…" : "—") },
    { label: "Owners", value: `${asset.ownerAssignments?.length || asset.owners?.length || 0}` },
    {
      label: "Workloads",
      value: workloadAccessPending
        ? "Checking access..."
        : !workloadSurfaceAvailable
        ? "Unavailable"
        : operationalLoaded
          ? `${(asset?.usage?.producerCount || 0) + (asset?.usage?.consumerCount || 0)}`
          : detailLoading
            ? "Loading…"
            : "—",
    },
    {
      label: "Connected Assets",
      value: lineageAccessPending
        ? "Checking access..."
        : !lineageSurfaceAvailable
        ? "Unavailable"
        : (lineageLoading || lineageProvisional) && !connectedAssetCount
          ? "Loading…"
          : `${connectedAssetCount}`,
    },
  ];

  return (
    <section className="gh-workspace gh-entity-workspace">
      <section className="gh-panel gh-entity-shell gh-entity-record-shell">
        <EntityHero
          asset={asset}
          identityLine={identityLine}
          objectType={objectType}
          liveDetailStatus={liveDetailStatus}
          detailUnavailable={detailUnavailable}
          assetDetail={assetDetail}
          linkNotice={linkNotice}
          lineageSurfaceAvailable={lineageSurfaceAvailable}
          lineageAccessPending={lineageAccessPending}
          lineageSurfaceUnavailableReason={lineageSurfaceUnavailableReason}
          onOpenLineage={onOpenLineage}
          onOpenGovernance={onOpenGovernance}
          onNavigationStateChange={onNavigationStateChange}
          onBack={onBack}
        />

        <div className="gh-preview-stat-grid gh-entity-record-metrics">
          {metricTiles.map((item) => (
            <MetricTile
              key={item.label}
              label={item.label}
              value={item.value}
              hint={item.hint || ""}
              tone={item.tone || ""}
            />
          ))}
        </div>

        <SurfaceTabs
          activeKey={activeTab}
          ariaLabel="Entity sections"
          className="gh-entity-record-tabs"
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            icon: tab.iconId ? <TabIcon id={tab.iconId} /> : null,
          }))}
          onChange={setActiveTab}
        />

        {activeTab === "Overview" ? (
          <div className="gh-entity-record-layout">
            <div className="gh-entity-record-primary">
              <AccessExplainerBanner assetFqn={asset.fqn} />
              <EntityRecordSection title="Definition">
                <InlineEditableDescription
                  assetFqn={asset.fqn}
                  description={asset.description}
                  onSaved={() => invalidateAssetDetail?.(asset.fqn)}
                />
              </EntityRecordSection>

              <EntityRecordSection
                description={
                  lineageAccessPending
                    ? "Checking actor-scoped lineage access for this asset."
                    : !lineageSurfaceAvailable
                    ? lineageSurfaceUnavailableReason
                    : lineageProvisional && !lineageAuthoritative
                    ? "Refreshing live lineage context for this asset."
                    : lineageLoading && !relatedAssets.length
                    ? "Loading connected lineage context for this asset."
                    : upstreamAssets.length || downstreamAssets.length
                    ? "Review upstream and downstream neighbors before changing the asset."
                    : lineageUnavailable
                    ? "Lineage signals are temporarily unavailable for this asset right now."
                    : relatedAssets.length
                      ? "Review connected lineage neighbors before changing the asset."
                      : "No connected lineage edges are surfaced for this asset yet."
                }
                title="Lineage Context"
              >
                {lineageAccessPending ? (
                  <LoadingState message="Checking lineage access..." />
                ) : lineageSurfaceAvailable ? (
                  <>
                    <SurfaceTabs
                      activeKey={localLineageContext}
                      ariaLabel="Entity lineage context"
                      className="gh-lineage-context-toggle"
                      items={["Data Lineage", "Operational Context"].map((option) => ({
                        key: option,
                        label: option,
                      }))}
                      onChange={setLocalLineageContext}
                    />
                    {upstreamAssets.length || downstreamAssets.length ? (
                      <div className="gh-lineage-context-groups">
                        <div className="gh-lineage-context-group">
                          <div className="gh-lineage-context-label">
                            Upstream {upstreamAssets.length ? `(${upstreamAssets.length})` : ""}
                          </div>
                          {upstreamAssets.length ? (
                            <div className="gh-lineage-linked-list">
                              {upstreamAssets.slice(0, 4).map((item) => renderLinkedAssetRow(item, "up"))}
                            </div>
                          ) : (
                            <div className="gh-support-copy">No upstream assets are currently surfaced.</div>
                          )}
                        </div>
                        <div className="gh-lineage-context-group">
                          <div className="gh-lineage-context-label">
                            Downstream {downstreamAssets.length ? `(${downstreamAssets.length})` : ""}
                          </div>
                          {downstreamAssets.length ? (
                            <div className="gh-lineage-linked-list">
                              {downstreamAssets.slice(0, 4).map((item) => renderLinkedAssetRow(item, "down"))}
                            </div>
                          ) : (
                            <div className="gh-support-copy">No downstream assets are currently surfaced.</div>
                          )}
                        </div>
                      </div>
                    ) : relatedAssets.length ? (
                      <div className="gh-lineage-linked-list">
                        {relatedAssets.slice(0, 6).map((item) => renderLinkedAssetRow(item, "related"))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="gh-empty-state">{lineageSurfaceUnavailableReason}</div>
                )}
              </EntityRecordSection>

              <EntityRecordSection
                description="Change requests and review events tied to this record."
                title="Recent Activity"
              >
                {!activityLoaded && !asset.activity?.length && !asset.metadataAudit?.length ? (
                  <SkeletonBlock lines={4} message="Loading activity feed…" />
                ) : (
                  <ActivityFeed
                    items={(asset.activity || []).slice(0, 4)}
                    auditItems={(asset.metadataAudit || []).slice(0, 6)}
                    onOpenGovernance={() => onOpenGovernance(asset.fqn)}
                  />
                )}
              </EntityRecordSection>
            </div>

            <div className="gh-entity-record-secondary">
              <EntityRecordSection
                description={
                  workloadSurfaceAvailable
                    ? "Storage shape, workload usage, and connected-record context."
                    : "Storage shape and connected-record context."
                }
                title="Live Record Signals"
              >
                <AttributeList items={recordFacts} />
              </EntityRecordSection>

              <Asset360Panel
                data={asset360Data}
                error={asset360.error}
                loading={asset360.loading}
                refreshing={asset360.refreshing}
              />

              {livePreview.length ? (
                <EntityRecordSection
                  actions={
                    <button
                      className="gh-tertiary-button gh-inline-link-button"
                      onClick={() => setActiveTab("SampleData")}
                      type="button"
                    >
                      See all rows
                    </button>
                  }
                  className="gh-entity-record-overview-preview"
                  description={`First ${Math.min(livePreview.length, 3)} row${livePreview.length === 1 ? "" : "s"} returned from the live asset preview.`}
                  title="Live Preview"
                >
                  <div className="gh-entity-overview-preview-scroll">
                    <table className="gh-table gh-entity-overview-preview-table">
                      <thead>
                        <tr>
                          {previewKeys.slice(0, 5).map((key) => (
                            <th key={key}>{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {livePreview.slice(0, 3).map((row, index) => (
                          <tr key={`${asset.fqn}-overview-preview-${index}`}>
                            {previewKeys.slice(0, 5).map((key) => (
                              <td key={key}>{row[key]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </EntityRecordSection>
              ) : null}

              <EntityRecordSection title="Owners">
                <OwnerList owners={asset.owners} />
              </EntityRecordSection>

              <MetadataEditorPanel
                asset={asset}
                bootstrap={bootstrap}
                dirty={metadataDirty}
                draft={metadataDraft}
                editor={editor}
                onChange={handleMetadataChange}
                onReset={resetMetadataDraft}
                onSave={saveMetadata}
              />

              <EntityRecordSection
                description="These signals summarize where core governance metadata is present and where steward review is still needed."
                title="Governance coverage"
              >
                <CoverageSignalRows items={postureChecks.slice(0, 4)} onOpenGovernance={() => onOpenGovernance(asset.fqn)} />
              </EntityRecordSection>
            </div>
          </div>
        ) : null}

        {activeTab === "Lineage" ? (
          !workspaceAccessResolved ? (
            <EntityRecordSection
              className="gh-entity-record-lineage-section"
              description="Actor-scoped lineage access is still being resolved for this route."
              title="Lineage"
            >
              <LoadingState message="Checking lineage access..." />
            </EntityRecordSection>
          ) : (
            <LineageStage
              asset={asset}
              allowRefocus={false}
              assetSearchLoading={false}
              assetSearchQuery=""
              assetSearchResults={[]}
              assetSearchResolvedQuery=""
              context={localLineageContext}
              embedded
              error={lineage.error}
              graphBundle={lineageBundle}
              lineagePayload={lineagePayload}
              loading={lineageLoading}
              authoritative={lineageAuthoritative}
              provisional={lineageProvisional}
              onAssetSearchQueryChange={() => {}}
              onContextChange={setLocalLineageContext}
              onOpenAsset={(nextAssetFqn) => {
                setWorkspaceIntent("lineageContext", nextAssetFqn, localLineageContext);
                onSelectAsset(nextAssetFqn, "Overview");
              }}
              onOpenGovernance={onOpenGovernance}
              onSelectAsset={(nextAssetFqn) => {
                setWorkspaceIntent("lineageContext", nextAssetFqn, localLineageContext);
                onSelectAsset(nextAssetFqn, "Overview");
              }}
            />
          )
        ) : null}

        {activeTab === "Schema" ? (
          <div className="gh-entity-record-layout gh-entity-record-layout-governance">
            <EntityRecordSection
              className="gh-entity-record-schema-section"
              description="Column descriptions, tags, and glossary linkage."
              title="Schema"
            >
              {schemaPending ? (
                <LoadingState message="Loading schema metadata..." />
              ) : schemaUnavailable ? (
                <div className="gh-empty-state">
                  {assetDetail.error || "Live schema metadata is unavailable for this asset right now."}
                </div>
              ) : liveColumns.length ? (
                <>
                  <div className="gh-schema-toolbar">
                    <input
                      aria-label="Filter columns"
                      className="gh-schema-column-search"
                      onChange={(event) => setSchemaColumnFilter(event.target.value)}
                      placeholder="Filter columns by name or description..."
                      type="search"
                      value={schemaColumnFilter}
                    />
                    {schemaColumnFilter ? (
                      <span className="gh-schema-toolbar-count">
                        {filteredLiveColumns.length} of {liveColumns.length}
                      </span>
                    ) : null}
                  </div>
                  <table className="gh-table gh-schema-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Tags</th>
                        <th>Nullable</th>
                        <th>Default</th>
                        <th>Constraints</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLiveColumns.length === 0 ? (
                        <tr className="gh-schema-empty-row">
                          <td colSpan={7}>
                            No columns match &ldquo;{schemaColumnFilter}&rdquo;
                          </td>
                        </tr>
                      ) : (
                        filteredLiveColumns.map((column) => {
                          const nullableLabel =
                            column.nullable === true
                              ? "Yes"
                              : column.nullable === false
                                ? "No"
                                : "—";
                          const nullableToneClass =
                            column.nullable === true
                              ? "gh-chip-tone-neutral"
                              : column.nullable === false
                                ? "gh-chip-tone-warning"
                                : "gh-chip-tone-neutral";
                          const defaultValue = column.defaultValue || "";
                          const constraintChips = column.constraints || [];
                          return (
                            <tr
                              className={selectedColumn?.name === column.name ? "is-active" : ""}
                              key={column.name}
                              onClick={() => setSelectedColumnName(column.name)}
                            >
                              <td>{column.name}</td>
                              <td>{column.type}</td>
                              <td>{column.description}</td>
                              <td>{column.tagLabels?.join(", ") || "—"}</td>
                              <td>
                                {column.nullable === null || column.nullable === undefined ? (
                                  <span className="gh-schema-placeholder">—</span>
                                ) : (
                                  <span className={`gh-chip gh-chip-soft ${nullableToneClass}`}>
                                    {nullableLabel}
                                  </span>
                                )}
                              </td>
                              <td>
                                {defaultValue ? (
                                  <code className="gh-schema-default">{defaultValue}</code>
                                ) : (
                                  <span className="gh-schema-placeholder">—</span>
                                )}
                              </td>
                              <td>
                                {constraintChips.length ? (
                                  <div className="gh-schema-constraint-chips">
                                    {constraintChips.map((constraint) => (
                                      <span
                                        className="gh-chip gh-chip-soft gh-schema-constraint-chip"
                                        key={`${column.name}-${constraint.type}-${constraint.name}`}
                                        title={constraint.name}
                                      >
                                        {constraint.type}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="gh-schema-placeholder">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </>
              ) : (
                <div className="gh-empty-state">No schema metadata is available for this asset.</div>
              )}
            </EntityRecordSection>

            <aside className="gh-entity-record-secondary">
              <EntityRecordSection
                className="gh-entity-record-selected-column-section"
                description={
                  columnMetadataEditable
                    ? "Update descriptions and tags directly against Unity Catalog."
                    : "Column descriptions and tags are read only for this asset type right now."
                }
                title="Selected Column"
              >
                {selectedColumn ? (
                  <div className="gh-metadata-edit-form">
                    {columnMetadataEditable ? (
                      <>
                        <label className="gh-metadata-edit-field">
                          <span>Description</span>
                          <textarea
                            className="gh-input gh-textarea"
                            onChange={(event) => setColumnDraft((current) => ({ ...current, description: event.target.value }))}
                            rows={4}
                            value={columnDraft.description}
                          />
                        </label>
                        <label className="gh-metadata-edit-field">
                          <span>Tags</span>
                          <input
                            className="gh-input"
                            onChange={(event) => setColumnDraft((current) => ({ ...current, tags: event.target.value }))}
                            placeholder="domain=Finance, sensitivity=PII"
                            value={columnDraft.tags}
                          />
                          <small>Comma-separated `key=value` pairs.</small>
                        </label>
                        {columnMutation.error ? <div className="gh-inline-alert tone-warn">{columnMutation.error}</div> : null}
                        {columnMutation.success ? <div className="gh-inline-alert">{columnMutation.success}</div> : null}
                        <div className="gh-record-form-actions">
                          <button
                            className="gh-primary-button"
                            disabled={columnMutation.loading}
                            onClick={saveColumnMetadata}
                            title={columnMutation.loading ? "Saving column metadata — please wait." : undefined}
                            type="button"
                          >
                            {columnMutation.loading ? "Saving..." : "Save column"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="gh-record-readonly-note">
                        <div className="gh-support-copy">{columnMetadataReadOnlyMessage}</div>
                        <div className="gh-attribute-list">
                          <div className="gh-attribute-row">
                            <span className="gh-attribute-label">Description</span>
                            <span className="gh-attribute-value">{selectedColumn.description || "No description"}</span>
                          </div>
                          <div className="gh-attribute-row">
                            <span className="gh-attribute-label">Glossary</span>
                            <span className="gh-attribute-value">
                              {selectedColumn.glossaryTerms?.length
                                ? selectedColumn.glossaryTerms.join(", ")
                                : selectedColumn.glossaryTerm || "—"}
                            </span>
                          </div>
                          <div className="gh-attribute-row">
                            <span className="gh-attribute-label">Tags</span>
                            <span className="gh-attribute-value">{selectedColumn.tagLabels?.join(", ") || "—"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="gh-detail-section">
                      <div className="gh-panel-title">Column Lineage</div>
                      {lineageAccessPending ? (
                        <LoadingState message="Checking lineage access..." />
                      ) : !lineageSurfaceAvailable ? (
                        <div className="gh-empty-state">{lineageSurfaceUnavailableReason}</div>
                      ) : selectedColumnUpstream.length || selectedColumnDownstream.length ? (
                        <div className="gh-lineage-linked-list">
                          {selectedColumnUpstream.map((item) => {
                            const availabilityState =
                              linkedRecordUnavailableOverrides[item.assetFqn] === true
                                ? false
                                : linkedAssetAvailability[item.assetFqn];
                            const lineageLabel = `${item.column} → ${selectedColumn.name}`;
                            const primaryLabel = `${item.assetFqn} · ${lineageLabel}`;
                            return availabilityState === false ? (
                              <div
                                className="gh-lineage-linked-row is-readonly"
                                key={`up-${selectedColumn.name}-${item.assetFqn}-${item.column}`}
                              >
                                <span>{primaryLabel}</span>
                                <span>Metadata record unavailable</span>
                              </div>
                            ) : (
                              <button
                                className="gh-lineage-linked-row is-asset-link"
                                key={`up-${selectedColumn.name}-${item.assetFqn}-${item.column}`}
                                onClick={() => {
                                  void openAssetReference(item.assetFqn, {
                                    fallbackContext: localLineageContext,
                                    loadingLabel: "Opening linked metadata record…",
                                    markUnavailableOnFailure: true,
                                    nextTab: "Overview",
                                  });
                                }}
                                onMouseEnter={() => {
                                  prefetchAssetAvailability([item.assetFqn]);
                                  prefetchAssetDetail(item.assetFqn, { sections: ["header"] });
                                }}
                                type="button"
                              >
                                <span>{primaryLabel}</span>
                                <span>{availabilityState === null ? "Checking access..." : "Open Record"}</span>
                              </button>
                            );
                          })}
                          {selectedColumnDownstream.map((item) => {
                            const availabilityState =
                              linkedRecordUnavailableOverrides[item.assetFqn] === true
                                ? false
                                : linkedAssetAvailability[item.assetFqn];
                            const lineageLabel = `${selectedColumn.name} → ${item.column}`;
                            const primaryLabel = `${item.assetFqn} · ${lineageLabel}`;
                            return availabilityState === false ? (
                              <div
                                className="gh-lineage-linked-row is-readonly"
                                key={`down-${selectedColumn.name}-${item.assetFqn}-${item.column}`}
                              >
                                <span>{primaryLabel}</span>
                                <span>Metadata record unavailable</span>
                              </div>
                            ) : (
                              <button
                                className="gh-lineage-linked-row is-asset-link"
                                key={`down-${selectedColumn.name}-${item.assetFqn}-${item.column}`}
                                onClick={() => {
                                  void openAssetReference(item.assetFqn, {
                                    fallbackContext: localLineageContext,
                                    loadingLabel: "Opening linked metadata record…",
                                    markUnavailableOnFailure: true,
                                    nextTab: "Overview",
                                  });
                                }}
                                onMouseEnter={() => {
                                  prefetchAssetAvailability([item.assetFqn]);
                                  prefetchAssetDetail(item.assetFqn, { sections: ["header"] });
                                }}
                                type="button"
                              >
                                <span>{primaryLabel}</span>
                                <span>{availabilityState === null ? "Checking access..." : "Open Record"}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="gh-empty-state">No column-level lineage was surfaced for this column.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="gh-empty-state">Select a column to inspect and edit it.</div>
                )}
              </EntityRecordSection>
            </aside>
          </div>
        ) : null}

        {activeTab === "Activity" ? (
          <EntityRecordSection
            className="gh-entity-record-activity-section"
            title="Activity & Tasks"
            description="Review governance requests and approval activity for this asset."
          >
            <ActivityFeed
              items={asset.activity || []}
              auditItems={asset.metadataAudit || []}
              onOpenGovernance={() => onOpenGovernance(asset.fqn)}
            />
          </EntityRecordSection>
        ) : null}

        {activeTab === "SampleData" ? (
          <EntityRecordSection
            className="gh-entity-record-sample-section"
            title="Sample Data"
            description="Sample rows returned from the live asset preview."
          >
            {!workspaceAccessResolved ? (
              <LoadingState message="Checking preview access..." />
            ) : !previewSurfaceAvailable ? (
              <div className="gh-empty-state">
                {previewSurfaceUnavailableReason}
              </div>
            ) : previewPending ? (
              <SkeletonBlock lines={6} message="Loading preview rows…" />
            ) : previewUnavailable ? (
              <div className="gh-empty-state">
                {assetDetail.error || "Live preview rows are unavailable for this asset right now."}
              </div>
            ) : livePreview.length ? (
              <table className="gh-table">
                <thead>
                  <tr>
                    {previewKeys.map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {livePreview.map((row, index) => (
                    <tr key={`${asset.fqn}-preview-${index}`}>
                      {previewKeys.map((key) => (
                        <td key={key}>{row[key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="gh-empty-state">No preview rows are available for this asset.</div>
            )}
          </EntityRecordSection>
        ) : null}

        {activeTab === "Queries" ? (
          <EntityRecordSection
            className="gh-entity-record-queries-section"
            title="Usage & Workloads"
          >
            {!workspaceAccessResolved ? (
              <LoadingState message="Checking workload access..." />
            ) : workloadSurfaceAvailable ? (
              operationalPending ? (
                <LoadingState message="Loading workload and operational context..." />
              ) : operationalUnavailable ? (
                <div className="gh-empty-state">
                  {assetDetail.error ||
                    "Live workload and operational context are unavailable for this asset right now."}
                </div>
              ) : (
                <QueryRecords
                  consumers={operationalContext.consumers || []}
                  onOpenAssetReference={openAssetReference}
                  producers={operationalContext.producers || []}
                />
              )
            ) : (
              <div className="gh-empty-state">
                {workloadSurfaceUnavailableReason ||
                  "Operational query and workload visibility is not available in this workspace right now."}
              </div>
            )}
          </EntityRecordSection>
        ) : null}

        {activeTab === "Profiler" ? (
          <EntityRecordSection
            className="gh-entity-record-profiler-section"
            description="Live evidence currently surfaced from schema, preview, workload, and lineage reads. Persisted quality tests and runs are not available in this workspace yet."
            title="Profiler & Evidence"
            titleMeta={(
              <div className="gh-chip-row">
                {profilerLineageMeta.map((label) => (
                  <span className="gh-chip gh-chip-soft" key={label}>{label}</span>
                ))}
                {workloadSurfaceAvailable ? (
                  <span className="gh-chip gh-chip-soft">{profilerSummary.producerCount || 0} producers</span>
                ) : null}
                {workloadSurfaceAvailable ? (
                  <span className="gh-chip gh-chip-soft">{profilerSummary.consumerCount || 0} consumers</span>
                ) : null}
              </div>
            )}
          >
            {profilerPending ? (
              <LoadingState message="Loading profiler and live evidence signals..." />
            ) : profilerUnavailable ? (
              <div className="gh-empty-state">
                {assetDetail.error || "Live profiler and evidence signals are unavailable for this asset right now."}
              </div>
            ) : (
              <>
                <ProfilerCards cards={profilerCards} />
                <ProfilePanel assetFqn={asset.fqn} />
              </>
            )}
          </EntityRecordSection>
        ) : null}

        {activeTab === "CustomProperties" ? (
          propertiesPending ? (
            <EntityRecordSection
              className="gh-entity-record-properties-section"
              description="Custom metadata fields and structural constraints surfaced from the live record."
              title="Custom Properties"
            >
              <LoadingState message="Loading custom properties and constraints..." />
            </EntityRecordSection>
          ) : (
            <div className="gh-entity-record-layout gh-entity-record-layout-governance">
              <EntityRecordSection
                className="gh-entity-record-properties-section"
                description="Governed, typed custom properties assigned to this asset by admins."
                title="Custom Properties"
              >
                <CustomPropertiesPanel assetFqn={asset.fqn} fallback={asset.customProperties || []} />
              </EntityRecordSection>
              <EntityRecordSection
                className="gh-entity-record-properties-section"
                description="UC-surfaced structural constraints (primary/foreign keys, check constraints)."
                title="Constraints"
              >
                <PropertyList
                  title=""
                  items={asset.constraints || []}
                  renderValue={(item) => item.columns?.length ? `${item.type} • ${item.columns.join(", ")}` : item.type}
                />
              </EntityRecordSection>
            </div>
          )
        ) : null}

        {activeTab === "Quality" ? (
          <EntityRecordSection
            className="gh-entity-record-quality-section"
            description="Persisted quality runs, per-case outcomes, and redaction-gated evidence."
            title="Quality"
          >
            <QualityPanel assetFqn={asset.fqn} />
          </EntityRecordSection>
        ) : null}
      </section>
    </section>
  );
}
