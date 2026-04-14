import { useEffect, useMemo, useState } from "react";
import {
  updateAssetColumnDescription,
  updateAssetColumnMetadata,
  updateAssetColumnTags,
} from "../lib/api";
import { useAssetMetadataEditor } from "../hooks/useAssetMetadataEditor";
import {
  isUsableAssetDetail,
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
import { consumeWorkspaceIntent, peekWorkspaceIntent, setWorkspaceIntent } from "../lib/workspaceIntent";
import LineageStage from "./LineageStage";

function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function governanceTasks(asset) {
  return [
    {
      label: "Ownership",
      action: "Assign accountable owners",
      complete: Boolean(asset.owners?.length),
      value: asset.owners?.length ? `${asset.owners.length} assigned` : "Unassigned",
    },
    {
      label: "Domain",
      action: "Map the asset to a business domain",
      complete: Boolean(asset.domain && asset.domain !== "Unassigned"),
      value: asset.domain || "Unassigned",
    },
    {
      label: "Tier",
      action: "Set a support tier for downstream use",
      complete: Boolean(asset.tier && asset.tier !== "Unassigned"),
      value: asset.tier || "Unassigned",
    },
    {
      label: "Certification",
      action: "Confirm whether the asset is approved for trusted reuse",
      complete: Boolean(asset.certification && asset.certification !== "Unassigned"),
      value: asset.certification || "Unassigned",
    },
    {
      label: "Sensitivity",
      action: "Review privacy and classification posture",
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

function metadataDraftFromAsset(asset) {
  return {
    description: toDraftValue(asset?.description),
    domain: toDraftValue(asset?.domain),
    tier: toDraftValue(asset?.tier),
    certification: toDraftValue(asset?.certification),
    sensitivity: toDraftValue(asset?.sensitivity),
  };
}

function detailSectionsForTab(activeTab) {
  switch (activeTab) {
    case "Overview":
      return ["header"];
    case "Activity":
      return ["header", "activity"];
    case "Schema":
      return ["header", "activity", "schema"];
    case "SampleData":
      return ["header", "activity", "preview"];
    case "Queries":
      return ["header", "activity", "operational"];
    case "Profiler":
      return ["header", "activity", "schema", "preview", "operational", "profiler"];
    case "CustomProperties":
      return ["header", "activity", "properties"];
    default:
      return ["header", "activity"];
  }
}

function EntityTabs({ activeTab, onTabChange }) {
  const tabs = [
    { key: "Overview", label: "Overview" },
    { key: "Schema", label: "Schema" },
    { key: "Activity", label: "Activity & Tasks" },
    { key: "SampleData", label: "Sample Data" },
    { key: "Queries", label: "Usage & Workloads" },
    { key: "Profiler", label: "Profiler & Data Quality" },
    { key: "Lineage", label: "Lineage" },
    { key: "CustomProperties", label: "Custom Properties" },
  ];

  return (
    <div className="gh-subtabs gh-entity-record-tabs">
      {tabs.map((tab) => (
        <button
          className={`gh-subtab ${activeTab === tab.key ? "is-active" : ""}`}
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
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

function canNavigateLinkedAsset(assetFqn, availabilityMap = {}) {
  return availabilityMap?.[assetFqn] === true;
}

function GovernanceGapRows({ items, onOpenGovernance }) {
  return (
    <div className="gh-task-list gh-task-list-rows">
      {items.map((task) => (
        <button
          className={`gh-task-row ${task.complete ? "is-complete" : ""}`}
          key={task.label}
          onClick={onOpenGovernance}
          type="button"
        >
          <div className="gh-task-row-main">
            <div className="gh-task-row-head">
              <span className="gh-task-title">{task.label}</span>
              <span className={`gh-status-chip tone-${task.complete ? "good" : "bad"}`}>
                {task.complete ? "Ready" : "Needs work"}
              </span>
            </div>
            <div className="gh-support-copy">{task.action}</div>
          </div>
          <div className="gh-task-row-value">{task.value}</div>
        </button>
      ))}
    </div>
  );
}

function MetricTile({ label, value }) {
  return (
    <div className="gh-preview-stat-card gh-entity-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
    <section className="gh-panel gh-record-card">
      <div className="gh-record-card-head">
        <div>
          <div className="gh-panel-title">Metadata Controls</div>
          <div className="gh-support-copy">
            Update the record description and governance classifications when the backend edit
            surface is available.
          </div>
        </div>
        {editor.available ? <span className="gh-chip gh-chip-soft">Editable</span> : null}
      </div>

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
            <button className="gh-primary-button" disabled={editor.submitting || !dirty} type="submit">
              {editor.submitting ? "Saving..." : "Save metadata"}
            </button>
            <button className="gh-secondary-button" disabled={editor.submitting || !dirty} onClick={onReset} type="button">
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

      <div className="gh-chip-row">
        {(bootstrap?.discovery?.domains || []).slice(1, 4).map((domain) => (
          <span className="gh-chip gh-chip-soft" key={domain}>
            {domain}
          </span>
        ))}
      </div>
    </section>
  );
}

function ActivityFeed({ items, onOpenGovernance }) {
  if (!items?.length) {
    return (
      <div className="gh-empty-state">
        No governance activity is recorded for this asset yet.
        <div className="gh-empty-state-actions">
          <button className="gh-secondary-button" onClick={onOpenGovernance} type="button">
            Open governance workbench
          </button>
        </div>
      </div>
    );
  }

  return (
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
  );
}

function workloadDisplayName(item) {
  const explicitName = String(item?.name || "").trim();
  const identifier = String(item?.statementId || item?.entityId || item?.runId || "").trim();
  const entityLabel = String(item?.entityLabel || "Workload").trim();
  if (explicitName && explicitName !== identifier) return explicitName;
  if (explicitName && explicitName.length <= 32) return explicitName;
  if (entityLabel && identifier) return `${entityLabel} ${identifier.slice(0, 8)}`;
  return explicitName || entityLabel || "Workload";
}

function workloadIdentifier(item) {
  return String(item?.statementId || item?.entityId || item?.runId || "").trim();
}

function QueryRecords({
  producers = [],
  consumers = [],
  linkedAssetAvailability = {},
  onOpenLinkedAsset,
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
                        {item.relatedAssets.slice(0, 4).map((assetFqn) => (
                          <button
                            className={`gh-chip gh-chip-soft ${linkedAssetAvailability[assetFqn] === true ? "" : "gh-chip-link-pending"}`}
                            key={`${item.key}-${assetFqn}`}
                            onClick={() => onOpenLinkedAsset?.(assetFqn)}
                            type="button"
                          >
                            {assetFqn.split(".").slice(-2).join(" / ")}
                          </button>
                        ))}
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
    return <div className="gh-empty-state">No profiler or metadata quality signals are available yet.</div>;
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

function PropertyList({ title, items = [], renderValue }) {
  return (
    <section className="gh-panel gh-record-card">
      <div className="gh-record-card-head">
        <div className="gh-panel-title">{title}</div>
      </div>
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
    </section>
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
}) {
  const [activeTab, setActiveTab] = useState(() => {
    return peekWorkspaceIntent("entityTab", assetFqn, "Overview") || "Overview";
  });
  const [localLineageContext, setLocalLineageContext] = useState(() =>
    peekWorkspaceIntent("lineageContext", assetFqn, "Data Lineage") || "Data Lineage",
  );
  const [localOverrides, setLocalOverrides] = useState({});
  const [metadataDraft, setMetadataDraft] = useState(metadataDraftFromAsset(null));
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [selectedColumnName, setSelectedColumnName] = useState("");
  const [columnDraft, setColumnDraft] = useState({ description: "", tags: "" });
  const [columnMutation, setColumnMutation] = useState({
    loading: false,
    error: "",
    success: "",
  });
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const launchAssets = seedAssets.slice(0, 6);
  const visibleAssetSet = useMemo(() => {
    if (sharedVisibleAssetSet?.size) return new Set(sharedVisibleAssetSet);
    return new Set(seedAssets.map((candidate) => candidate?.fqn).filter(Boolean));
  }, [seedAssets, sharedVisibleAssetSet]);
  const seeded = useSeededAssetContext(assetFqn, bootstrap, seedAssets, {
    allowFallback: false,
  });
  const requestedDetailSections = useMemo(() => detailSectionsForTab(activeTab), [activeTab]);
  const assetDetail = useAssetDetail(assetFqn || "", { sections: requestedDetailSections });
  const usableDetail = isUsableAssetDetail(assetDetail.detail) ? assetDetail.detail : null;
  const baseAsset = usableDetail || seeded.summary;
  const asset = useMemo(
    () => (baseAsset ? { ...baseAsset, ...localOverrides } : baseAsset),
    [baseAsset, localOverrides],
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
  const [overviewLineageWarm, setOverviewLineageWarm] = useState(false);
  const lineageEnabled =
    activeTab === "Lineage" ||
    activeTab === "Queries" ||
    (activeTab === "Overview" &&
      overviewLineageWarm &&
      Boolean(asset?.fqn) &&
      loadedSections.has("header"));
  const lineage = useLineage(assetFqn || "", seeded.seededGraph, lineageEnabled);
  const lineageBundle = lineage.graph;
  const lineagePayload = lineage.payload;
  const lineageLoading = lineage.loading;
  const editor = useAssetMetadataEditor({ assetFqn: assetFqn || "", asset, bootstrap });
  const focusAssetFqn = asset?.fqn || assetFqn || "";
  const graphRelatedAssets = useMemo(
    () =>
      dedupeLinkedAssets(
        relatedAssetsFromGraph(lineageBundle, focusAssetFqn, localLineageContext),
        focusAssetFqn,
      ),
    [focusAssetFqn, lineageBundle, localLineageContext],
  );
  const lineageNeighbors = useMemo(
    () => lineageNeighborGroups(lineageBundle, focusAssetFqn, localLineageContext),
    [focusAssetFqn, lineageBundle, localLineageContext],
  );
  const relatedAssets = useMemo(
    () => dedupeLinkedAssets([...(asset?.relatedAssets || []), ...graphRelatedAssets], asset?.fqn),
    [asset?.fqn, asset?.relatedAssets, graphRelatedAssets],
  );
  const columns = asset?.columns || [];
  const preview = asset?.preview || [];
  const detailLoading = assetDetail.loading;
  const detailReady = Boolean(usableDetail);
  const detailHydrating = detailLoading && !asset;
  const detailUnavailable = Boolean(assetDetail.error) && !detailReady;
  const schemaUnavailable = Boolean(assetDetail.error) && !schemaLoaded;
  const previewUnavailable = Boolean(assetDetail.error) && !previewLoaded;
  const operationalUnavailable = Boolean(assetDetail.error) && !operationalLoaded;
  const propertiesUnavailable = Boolean(assetDetail.error) && !propertiesLoaded;
  const profilerUnavailable = Boolean(assetDetail.error) && !profilerLoaded;
  const columnMetadataEditable = editor.available;
  const columnMetadataReadOnlyMessage =
    editor.config?.message ||
    "Column metadata editing is not available for this asset type right now.";
  const liveColumns = detailReady && schemaLoaded ? columns : [];
  const livePreview = detailReady && previewLoaded ? preview : [];
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
  const tasks = governanceTasks(asset || {});
  const objectType = asset ? displayObjectType(asset) || (detailHydrating ? "Loading…" : "") : "";
  const identityLine = asset ? assetPathLabel(asset) : assetFqn;
  const lineageUnavailable =
    Boolean(lineage.error) && !upstreamAssets.length && !downstreamAssets.length && !relatedAssets.length;
  const completeness = tasks.filter((task) => task.complete).length;
  const liveDetailStatus = detailHydrating
    ? "Loading live detail…"
    : detailLoading
      ? "Refreshing live detail…"
      : "";
  const schemaPending = activeTab === "Schema" && detailLoading && !schemaLoaded;
  const previewPending = activeTab === "SampleData" && detailLoading && !previewLoaded;
  const operationalPending = activeTab === "Queries" && detailLoading && !operationalLoaded;
  const propertiesPending = activeTab === "CustomProperties" && detailLoading && !propertiesLoaded;
  const profilerPending = activeTab === "Profiler" && detailLoading && !profilerLoaded;
  const metricTiles = [
    { label: "Coverage", value: `${asset?.coverageScore ?? 0}` },
    { label: "Owners", value: `${asset?.owners?.length || 0}` },
    { label: "Open Requests", value: `${asset?.openRequests || 0}` },
    {
      label: "Workloads",
      value: operationalLoaded
        ? `${(asset?.usage?.producerCount || 0) + (asset?.usage?.consumerCount || 0)}`
        : detailLoading
          ? "Loading…"
          : "—",
    },
    {
      label: "Connected Assets",
      value: lineageLoading && !connectedAssetCount ? "Loading…" : `${connectedAssetCount}`,
    },
  ];

  useEffect(() => {
    const nextContext = consumeWorkspaceIntent("lineageContext", assetFqn, "") || "Data Lineage";
    setLocalLineageContext(nextContext);
  }, [assetFqn]);

  useEffect(() => {
    const nextTab = consumeWorkspaceIntent("entityTab", assetFqn, "Overview") || "Overview";
    const allowedTabs = new Set([
      "Overview",
      "Schema",
      "Activity",
      "SampleData",
      "Queries",
      "Profiler",
      "Lineage",
      "CustomProperties",
    ]);
    setActiveTab(allowedTabs.has(nextTab) ? nextTab : "Overview");
    setLocalOverrides({});
    setMetadataDirty(false);
    setSelectedColumnName("");
    setColumnDraft({ description: "", tags: "" });
    setColumnMutation({ loading: false, error: "", success: "" });
  }, [assetFqn]);

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
  }, [activeTab, asset?.fqn, loadedSections]);

  useEffect(() => {
    if (activeTab !== "Overview" || !assetFqn || !loadedSections.has("header") || detailLoading) return undefined;
    const firstWaveSections = ["activity", "schema"].filter((section) => !loadedSections.has(section));
    const secondWaveSections = ["preview", "operational"].filter((section) => !loadedSections.has(section));
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
      firstWaveTimeoutId = window.setTimeout(warmFirstWave, 420);
      if (secondWaveSections.length && typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(warmSecondWave, { timeout: 2600 });
      } else if (secondWaveSections.length) {
        secondWaveTimeoutId = window.setTimeout(warmSecondWave, 1800);
      }
      if (thirdWaveSections.length) {
        thirdWaveTimeoutId = window.setTimeout(warmThirdWave, 4200);
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
  }, [activeTab, assetFqn, detailLoading, loadedSections]);

  if (assetFqn && assetDetail.loading && !asset) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <div className="gh-panel gh-unavailable-panel">
          <div className="gh-panel-title">Loading Asset</div>
          <h2>Refreshing the metadata record.</h2>
          <p>Loading the record header and recent activity for {assetFqn}.</p>
        </div>
      </section>
    );
  }

  if (assetFqn && !asset && !assetDetail.loading) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <div className="gh-panel gh-unavailable-panel">
          <div className="gh-panel-title">Asset Unavailable</div>
          <h2>The selected asset could not be opened.</h2>
          <p>
            {assetDetail.error ||
              "This asset appears in lineage or linked navigation, but it is not currently visible in the live catalog with the current permissions."}
          </p>
          <div className="gh-empty-state-actions">
            <button className="gh-secondary-button" onClick={onBack} type="button">
              Return to Catalog
            </button>
          </div>
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
        </div>
      </section>
    );
  }

  if (!asset) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <div className="gh-panel gh-unavailable-panel">
          <div className="gh-panel-title">Asset</div>
          <div className="gh-empty-state">
            Select an asset from discovery to inspect its metadata.
            <div className="gh-empty-state-actions">
              <button className="gh-secondary-button" onClick={onBack} type="button">
                Return to Catalog
              </button>
            </div>
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
          </div>
        </div>
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
    const payload = {
      assetFqn: asset.fqn,
      description,
      domain: domain || null,
      tier: tier || null,
      certification: certification || null,
      sensitivity: sensitivity || null,
    };

    const response = await editor.save(payload);
    const nextAsset = response?.asset || null;
    if (nextAsset?.fqn) {
      primeAssetDetail(nextAsset.fqn, nextAsset);
      clearAssetSearchCache();
      setLocalOverrides(nextAsset);
    } else {
      setLocalOverrides((current) => ({
        ...current,
        description: description || "No description has been captured for this asset yet.",
        domain: domain || "Unassigned",
        tier: tier || "Unassigned",
        certification: certification || "Unassigned",
        sensitivity: sensitivity || "Unassigned",
      }));
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
        setLocalOverrides(nextAsset);
      }
      onGovernanceChange?.(response?.governance || null);
      setColumnMutation({ loading: false, error: "", success: "Column metadata saved." });
    } catch (error) {
      setColumnMutation({
        loading: false,
        error: error?.message || "Unable to save column metadata.",
        success: "",
      });
    }
  };

  const openRelatedAsset = (nextAssetFqn) => {
    if (!nextAssetFqn) return;
    onNavigationStateChange?.(true, "Opening linked metadata record…");
    setWorkspaceIntent("lineageContext", nextAssetFqn, localLineageContext);
    onSelectAsset(nextAssetFqn, "Overview");
  };

  const renderLinkedAssetRow = (item, keyPrefix) => {
    const availabilityState = linkedAssetAvailability[item];
    return (
      <button
        className={`gh-lineage-linked-row ${availabilityState === true ? "" : "is-readonly"}`}
        key={`${keyPrefix}-${item}`}
        onClick={() => openRelatedAsset(item)}
        type="button"
      >
        <span>{item}</span>
        <span>{availabilityState === null ? "Loading record" : "Open Record"}</span>
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
      value: operationalLoaded
        ? `${(asset?.usage?.producerCount || 0) + (asset?.usage?.consumerCount || 0)}`
        : detailLoading
          ? "Loading…"
          : "—",
    },
    {
      label: "Connected Assets",
      value: lineageLoading && !connectedAssetCount ? "Loading…" : `${connectedAssetCount}`,
    },
  ];

  return (
    <section className="gh-workspace gh-entity-workspace">
      <section className="gh-panel gh-entity-shell gh-entity-record-shell">
        <div className="gh-entity-record-header">
          <div className="gh-entity-record-main">
            <div className="gh-entity-record-headline">
              <div className="gh-entity-record-heading-block">
                <button
                  className="gh-tertiary-button gh-inline-link-button gh-entity-record-backlink"
                  onClick={() => {
                    onNavigationStateChange?.(true, "Returning to discovery…");
                    onBack();
                  }}
                  type="button"
                >
                  Back to Discovery
                </button>
                <div className="gh-eyebrow">Metadata Record</div>
                <h2>{asset.name}</h2>
                <div className="gh-entity-record-fqn">{identityLine}</div>
              </div>
              <div className="gh-action-row gh-entity-action-row">
                <button
                  className="gh-secondary-button"
                  onClick={() => {
                    onNavigationStateChange?.(true, "Opening lineage…");
                    onOpenLineage(asset.fqn, "Data Lineage");
                  }}
                  type="button"
                >
                  Open Lineage
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => {
                    onNavigationStateChange?.(true, "Opening governance…");
                    onOpenGovernance(asset.fqn);
                  }}
                  type="button"
                >
                  Open Governance
                </button>
              </div>
            </div>
            <div className="gh-chip-row">
              {objectType ? <span className="gh-chip gh-chip-soft">{objectType}</span> : null}
              <span className={`gh-status-chip tone-${statusTone(asset)}`}>
                {asset.governanceStatus || "Needs Work"}
              </span>
              {liveDetailStatus ? <span className="gh-chip gh-chip-soft">{liveDetailStatus}</span> : null}
              {asset.domain && asset.domain !== "Unassigned" ? (
                <span className="gh-chip gh-chip-soft">{asset.domain}</span>
              ) : null}
              {asset.certification && asset.certification !== "Unassigned" ? (
                <span className="gh-chip gh-chip-soft">{asset.certification}</span>
              ) : null}
              {asset.sensitivity && asset.sensitivity !== "Unassigned" ? (
                <span className="gh-chip gh-chip-soft">{asset.sensitivity}</span>
              ) : null}
            </div>
            {detailUnavailable ? (
              <div className="gh-support-copy">
                {assetDetail.error ||
                  "Live record details could not be refreshed right now. Schema, preview, and lineage sections may be incomplete."}
              </div>
            ) : assetDetail.loading ? (
              <div className="gh-support-copy">Refreshing live record details...</div>
            ) : null}
          </div>
        </div>

        <div className="gh-preview-stat-grid gh-entity-record-metrics">
          {metricTiles.map((item) => (
            <MetricTile key={item.label} label={item.label} value={item.value} />
          ))}
        </div>

        <EntityTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "Overview" ? (
          <div className="gh-entity-record-layout">
            <div className="gh-entity-record-primary">
              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div className="gh-panel-title">Definition</div>
                </div>
                <div className="gh-support-copy">
                  {asset.description || "No description is available for this asset yet."}
                </div>
              </section>

              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Lineage Context</div>
                    <div className="gh-support-copy">
                      {lineageLoading && !relatedAssets.length
                        ? "Loading connected lineage context for this asset."
                        : upstreamAssets.length || downstreamAssets.length
                        ? "Review upstream and downstream neighbors before changing the asset."
                        : lineageUnavailable
                        ? "Lineage signals are temporarily unavailable for this asset right now."
                        : relatedAssets.length
                          ? "Review connected lineage neighbors before changing the asset."
                          : "No connected lineage edges are surfaced for this asset yet."}
                    </div>
                  </div>
                </div>
                <div className="gh-subtabs gh-lineage-context-toggle">
                  {["Data Lineage", "Operational Context"].map((option) => (
                    <button
                      className={`gh-subtab ${localLineageContext === option ? "is-active" : ""}`}
                      key={option}
                      onClick={() => setLocalLineageContext(option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
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
              </section>

              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Recent Activity</div>
                    <div className="gh-support-copy">
                      Change requests and review events tied to this record.
                    </div>
                  </div>
                </div>
                <ActivityFeed items={(asset.activity || []).slice(0, 4)} onOpenGovernance={() => onOpenGovernance(asset.fqn)} />
              </section>
            </div>

            <div className="gh-entity-record-secondary">
              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Live Record Signals</div>
                    <div className="gh-support-copy">Storage shape, workload usage, and connected-record context.</div>
                  </div>
                </div>
                <AttributeList items={recordFacts} />
              </section>

              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div className="gh-panel-title">Owners</div>
                </div>
                <OwnerList owners={asset.owners} />
              </section>

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

              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Stewardship Priorities</div>
                    <div className="gh-support-copy">
                      Open the governance workspace to resolve ownership, trust, and classification gaps.
                    </div>
                  </div>
                </div>
                <GovernanceGapRows items={tasks.slice(0, 4)} onOpenGovernance={() => onOpenGovernance(asset.fqn)} />
              </section>
            </div>
          </div>
        ) : null}

        {activeTab === "Lineage" ? (
          <LineageStage
            asset={asset}
            allowRefocus={false}
            assetSearchLoading={false}
            assetSearchQuery=""
            assetSearchResults={[]}
            context={localLineageContext}
            embedded
            error={lineage.error}
            graphBundle={lineageBundle}
            lineagePayload={lineagePayload}
            loading={lineageLoading}
            onAssetSearchQueryChange={() => {}}
            onContextChange={setLocalLineageContext}
            onOpenAsset={(nextAssetFqn) => {
              setWorkspaceIntent("lineageContext", nextAssetFqn, localLineageContext);
              onSelectAsset(nextAssetFqn, "Lineage");
            }}
            onOpenFullGraph={(nextContext) => onOpenLineage(asset.fqn, nextContext)}
            onOpenGovernance={onOpenGovernance}
            onSelectAsset={(nextAssetFqn) => {
              setWorkspaceIntent("lineageContext", nextAssetFqn, localLineageContext);
              onSelectAsset(nextAssetFqn, "Lineage");
            }}
          />
        ) : null}

        {activeTab === "Schema" ? (
          <div className="gh-entity-record-layout gh-entity-record-layout-governance">
            <section className="gh-panel gh-record-card">
              <div className="gh-record-card-head">
                <div>
                  <div className="gh-panel-title">Schema</div>
                  <div className="gh-support-copy">Column descriptions, tags, and glossary linkage.</div>
                </div>
              </div>
              {schemaPending ? (
                <div className="gh-empty-state">Loading schema metadata...</div>
              ) : schemaUnavailable ? (
                <div className="gh-empty-state">
                  {assetDetail.error || "Live schema metadata is unavailable for this asset right now."}
                </div>
              ) : liveColumns.length ? (
                <table className="gh-table">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveColumns.map((column) => (
                      <tr
                        className={selectedColumn?.name === column.name ? "is-active" : ""}
                        key={column.name}
                        onClick={() => setSelectedColumnName(column.name)}
                      >
                        <td>{column.name}</td>
                        <td>{column.type}</td>
                        <td>{column.description}</td>
                        <td>{column.tagLabels?.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="gh-empty-state">No schema metadata is available for this asset.</div>
              )}
            </section>

            <aside className="gh-entity-record-secondary">
              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Selected Column</div>
                    <div className="gh-support-copy">
                      {columnMetadataEditable
                        ? "Update descriptions and tags directly against Unity Catalog."
                        : "Column descriptions and tags are read only for this asset type right now."}
                    </div>
                  </div>
                </div>
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
                          <button className="gh-primary-button" disabled={columnMutation.loading} onClick={saveColumnMetadata} type="button">
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
                            <span className="gh-attribute-label">Tags</span>
                            <span className="gh-attribute-value">{selectedColumn.tagLabels?.join(", ") || "—"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="gh-detail-section">
                      <div className="gh-panel-title">Column Lineage</div>
                      {selectedColumnUpstream.length || selectedColumnDownstream.length ? (
                        <div className="gh-lineage-linked-list">
                          {selectedColumnUpstream.map((item) => {
                            const openable = canNavigateLinkedAsset(item.assetFqn, linkedAssetAvailability);
                            return (
                              <button
                                className={`gh-lineage-linked-row ${openable ? "" : "is-readonly"}`}
                                key={`up-${selectedColumn.name}-${item.assetFqn}-${item.column}`}
                                onClick={() => {
                                  if (openable) {
                                    void openRelatedAsset(item.assetFqn);
                                    return;
                                  }
                                  onNavigationStateChange?.(true, "Opening lineage…");
                                  onOpenLineage(item.assetFqn, localLineageContext);
                                }}
                                type="button"
                              >
                                <span>{item.assetFqn}</span>
                                <span>{item.column} → {selectedColumn.name}</span>
                              </button>
                            );
                          })}
                          {selectedColumnDownstream.map((item) => {
                            const openable = canNavigateLinkedAsset(item.assetFqn, linkedAssetAvailability);
                            return (
                              <button
                                className={`gh-lineage-linked-row ${openable ? "" : "is-readonly"}`}
                                key={`down-${selectedColumn.name}-${item.assetFqn}-${item.column}`}
                                onClick={() => {
                                  if (openable) {
                                    void openRelatedAsset(item.assetFqn);
                                    return;
                                  }
                                  onNavigationStateChange?.(true, "Opening lineage…");
                                  onOpenLineage(item.assetFqn, localLineageContext);
                                }}
                                type="button"
                              >
                                <span>{item.assetFqn}</span>
                                <span>{selectedColumn.name} → {item.column}</span>
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
              </section>
            </aside>
          </div>
        ) : null}

        {activeTab === "Activity" ? (
          <section className="gh-panel gh-record-card">
            <div className="gh-record-card-head">
              <div>
                <div className="gh-panel-title">Activity & Tasks</div>
                <div className="gh-support-copy">Review governance requests and approval activity for this asset.</div>
              </div>
            </div>
            <ActivityFeed items={asset.activity || []} onOpenGovernance={() => onOpenGovernance(asset.fqn)} />
          </section>
        ) : null}

        {activeTab === "SampleData" ? (
          <section className="gh-panel gh-record-card">
            <div className="gh-record-card-head">
              <div>
                <div className="gh-panel-title">Sample Data</div>
                <div className="gh-support-copy">Sample rows returned from the live asset preview.</div>
              </div>
            </div>
            {previewPending ? (
              <div className="gh-empty-state">Loading preview rows...</div>
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
          </section>
        ) : null}

        {activeTab === "Queries" ? (
          operationalPending ? (
            <section className="gh-panel gh-record-card">
              <div className="gh-empty-state">Loading workload and operational context...</div>
            </section>
          ) : operationalUnavailable ? (
            <section className="gh-panel gh-record-card">
              <div className="gh-empty-state">
                {assetDetail.error || "Live workload and operational context are unavailable for this asset right now."}
              </div>
            </section>
          ) : (
            <QueryRecords
              consumers={operationalContext.consumers || []}
              linkedAssetAvailability={linkedAssetAvailability}
              onOpenLinkedAsset={openRelatedAsset}
              producers={operationalContext.producers || []}
            />
          )
        ) : null}

        {activeTab === "Profiler" ? (
          <section className="gh-panel gh-record-card">
            <div className="gh-record-card-head">
              <div>
                <div className="gh-panel-title">Profiler & Data Quality</div>
                <div className="gh-support-copy">
                  Live metadata quality signals derived from schema coverage, sample data, lineage, and governance posture.
                </div>
              </div>
            <div className="gh-chip-row">
              <span className="gh-chip gh-chip-soft">{lineageStats.upstreamCount || 0} upstream</span>
              <span className="gh-chip gh-chip-soft">{lineageStats.downstreamCount || 0} downstream</span>
              <span className="gh-chip gh-chip-soft">{asset.profiler?.summary?.producerCount || 0} producers</span>
              <span className="gh-chip gh-chip-soft">{asset.profiler?.summary?.consumerCount || 0} consumers</span>
            </div>
            </div>
            {profilerPending ? (
              <div className="gh-empty-state">Loading profiler and metadata quality signals...</div>
            ) : profilerUnavailable ? (
              <div className="gh-empty-state">
                {assetDetail.error || "Live profiler and metadata quality signals are unavailable for this asset right now."}
              </div>
            ) : (
              <ProfilerCards cards={asset.profiler?.cards || []} />
            )}
          </section>
        ) : null}

        {activeTab === "CustomProperties" ? (
          propertiesPending ? (
            <section className="gh-panel gh-record-card">
              <div className="gh-empty-state">Loading custom properties and constraints...</div>
            </section>
          ) : propertiesUnavailable ? (
            <section className="gh-panel gh-record-card">
              <div className="gh-empty-state">
                {assetDetail.error || "Live custom properties are unavailable for this asset right now."}
              </div>
            </section>
          ) : (
            <div className="gh-entity-record-layout gh-entity-record-layout-governance">
              <PropertyList title="Custom Properties" items={asset.customProperties || []} />
              <PropertyList
                title="Constraints"
                items={asset.constraints || []}
                renderValue={(item) => item.columns?.length ? `${item.type} • ${item.columns.join(", ")}` : item.type}
              />
            </div>
          )
        ) : null}
      </section>
    </section>
  );
}
