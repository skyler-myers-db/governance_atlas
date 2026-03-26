import { useEffect, useMemo, useState } from "react";
import { useAssetMetadataEditor } from "../hooks/useAssetMetadataEditor";
import { useAssetDetail } from "../hooks/useAssetDetail";
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

function postureItems(asset) {
  const managementType = displayManagementType(asset);
  const items = [
    { label: "Catalog", value: asset.catalog || "—" },
    { label: "Schema", value: asset.schema || "—" },
    { label: "Object Type", value: displayObjectType(asset) || "—" },
    { label: "Rows", value: asset.rows || "—" },
    { label: "Storage Format", value: displayStorageFormat(asset) },
    { label: "Size", value: asset.size || "—" },
    { label: "Files", value: asset.files || "—" },
    { label: "Domain", value: asset.domain || "Unassigned" },
    { label: "Tier", value: asset.tier || "Unassigned" },
    { label: "Certification", value: asset.certification || "Unassigned" },
    { label: "Sensitivity", value: asset.sensitivity || "Unassigned" },
    { label: "Criticality", value: asset.criticality || "Unassigned" },
  ];
  if (managementType !== "—") {
    items.splice(3, 0, { label: "Management", value: managementType });
  }
  return items;
}

function governancePostureSubset(asset) {
  const keep = new Set(["Domain", "Tier", "Certification", "Sensitivity", "Criticality"]);
  return postureItems(asset).filter((item) => keep.has(item.label));
}

function recordIdentitySubset(asset) {
  const keep = new Set([
    "Catalog",
    "Schema",
    "Object Type",
    "Management",
    "Rows",
    "Storage Format",
    "Size",
    "Files",
  ]);
  return postureItems(asset).filter((item) => keep.has(item.label));
}

function relatedAssetsFromGraph(graphBundle, focusFqn) {
  const { upstream, downstream } = lineageNeighborGroups(graphBundle, focusFqn);
  return [...new Set([...upstream, ...downstream])];
}

function lineageNeighborGroups(graphBundle, focusFqn) {
  const graph = graphBundle?.data || null;
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

function EntityTabs({ activeTab, onTabChange }) {
  const tabs = [
    { key: "Overview", label: "Overview" },
    { key: "Schema", label: "Schema" },
    { key: "Preview", label: "Sample Data" },
    { key: "Lineage", label: "Lineage" },
    { key: "Governance", label: "Governance" },
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
            {editor.hasContract
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

export default function EntityWorkspace({
  assetFqn,
  bootstrap,
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
  const launchAssets = (bootstrap?.assets || []).slice(0, 6);
  const seeded = useSeededAssetContext(assetFqn, bootstrap, bootstrap?.assets || [], {
    allowFallback: false,
  });
  const assetDetail = useAssetDetail(assetFqn || "");
  const lineageEnabled = activeTab === "Overview" || activeTab === "Lineage";
  const lineage = useLineage(assetFqn || "", seeded.seededGraph, lineageEnabled);
  const baseAsset = assetDetail.detail || seeded.summary;
  const asset = useMemo(
    () => (baseAsset ? { ...baseAsset, ...localOverrides } : baseAsset),
    [baseAsset, localOverrides],
  );
  const lineageBundle = lineage.graph;
  const lineageLoading = lineage.loading;
  const editor = useAssetMetadataEditor({ assetFqn: assetFqn || "", asset, bootstrap });
  const graphRelatedAssets = useMemo(
    () => relatedAssetsFromGraph(lineageBundle, asset?.fqn || assetFqn),
    [asset?.fqn, assetFqn, lineageBundle],
  );
  const lineageNeighbors = useMemo(
    () => lineageNeighborGroups(lineageBundle, asset?.fqn || assetFqn),
    [asset?.fqn, assetFqn, lineageBundle],
  );
  const relatedAssets = useMemo(
    () =>
      [...new Set([...(asset?.relatedAssets || []), ...graphRelatedAssets])]
        .filter((value) => value && value !== asset?.fqn),
    [asset?.fqn, asset?.relatedAssets, graphRelatedAssets],
  );

  useEffect(() => {
    const nextContext = consumeWorkspaceIntent("lineageContext", assetFqn, "") || "Data Lineage";
    setLocalLineageContext(nextContext);
  }, [assetFqn]);

  useEffect(() => {
    const nextTab = consumeWorkspaceIntent("entityTab", assetFqn, "Overview") || "Overview";
    setActiveTab(nextTab);
    setLocalOverrides({});
    setMetadataDirty(false);
  }, [assetFqn]);

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

  if (assetFqn && assetDetail.loading && !asset) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <div className="gh-panel gh-unavailable-panel">
          <div className="gh-panel-title">Loading Asset</div>
          <h2>Refreshing the metadata record.</h2>
          <p>Loading live schema, sample data, and lineage context for {assetFqn}.</p>
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

  const columns = asset.columns || [];
  const preview = asset.preview || [];
  const detailReady = Boolean(assetDetail.detail);
  const detailHydrating = assetDetail.loading && !detailReady;
  const detailUnavailable = Boolean(assetDetail.error) && !detailReady;
  const liveColumns = detailReady ? columns : [];
  const livePreview = detailReady ? preview : [];
  const upstreamAssets = lineageNeighbors.upstream;
  const downstreamAssets = lineageNeighbors.downstream;
  const previewKeys = livePreview[0] ? Object.keys(livePreview[0]) : [];
  const tasks = governanceTasks(asset);
  const posture = postureItems(asset);
  const objectType = displayObjectType(asset);
  const identityLine = assetPathLabel(asset);
  const lineageUnavailable = Boolean(lineage.error) && !relatedAssets.length;
  const completeness = tasks.filter((task) => task.complete).length;
  const metricTiles = [
    { label: "Coverage", value: `${asset.coverageScore ?? 0}` },
    { label: "Owners", value: `${asset.owners?.length || 0}` },
    { label: "Open Requests", value: `${asset.openRequests || 0}` },
    { label: "Connected Assets", value: `${relatedAssets.length}` },
  ];

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

    await editor.save(payload);
    setLocalOverrides((current) => ({
      ...current,
      description: description || "No description has been captured for this asset yet.",
      domain: domain || "Unassigned",
      tier: tier || "Unassigned",
      certification: certification || "Unassigned",
      sensitivity: sensitivity || "Unassigned",
    }));
    setMetadataDirty(false);
  };

  return (
    <section className="gh-workspace gh-entity-workspace">
      <section className="gh-panel gh-entity-shell gh-entity-record-shell">
        <div className="gh-entity-record-header">
          <div className="gh-entity-record-main">
            <div className="gh-entity-record-headline">
              <div className="gh-entity-record-heading-block">
                <button className="gh-tertiary-button gh-inline-link-button gh-entity-record-backlink" onClick={onBack} type="button">
                  Back to Discovery
                </button>
                <div className="gh-eyebrow">Metadata Record</div>
                <h2>{asset.name}</h2>
                <div className="gh-entity-record-fqn">{identityLine}</div>
              </div>
              <div className="gh-action-row gh-entity-action-row">
                <button className="gh-secondary-button" onClick={() => onOpenLineage(asset.fqn, "Data Lineage")} type="button">
                  Open lineage
                </button>
                <button className="gh-secondary-button" onClick={() => onOpenGovernance(asset.fqn)} type="button">
                  Open governance
                </button>
              </div>
            </div>
            <div className="gh-chip-row">
              {objectType ? <span className="gh-chip gh-chip-soft">{objectType}</span> : null}
              <span className={`gh-status-chip tone-${statusTone(asset)}`}>
                {asset.governanceStatus || "Needs Work"}
              </span>
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
            <div className="gh-support-copy gh-entity-record-summary">
              {asset.description || "No description has been captured for this asset yet."}
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
                        : lineageUnavailable
                        ? "Lineage signals are temporarily unavailable for this asset right now."
                        : relatedAssets.length
                          ? "Review upstream and downstream neighbors before changing the asset."
                          : "No connected lineage edges are surfaced for this asset yet."}
                    </div>
                  </div>
                </div>
                <div className="gh-action-grid gh-action-grid-inline">
                  <button
                    className="gh-tertiary-button gh-inline-link-button"
                    onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
                    type="button"
                  >
                    Open data lineage
                  </button>
                  <button
                    className="gh-tertiary-button gh-inline-link-button"
                    onClick={() => onOpenLineage(asset.fqn, "Operational Context")}
                    type="button"
                  >
                    Open operational context
                  </button>
                </div>
                {upstreamAssets.length || downstreamAssets.length ? (
                  <div className="gh-lineage-context-groups">
                    <div className="gh-lineage-context-group">
                      <div className="gh-lineage-context-label">
                        Upstream {upstreamAssets.length ? `(${upstreamAssets.length})` : ""}
                      </div>
                      {upstreamAssets.length ? (
                        <div className="gh-lineage-linked-list">
                          {upstreamAssets.slice(0, 4).map((item) => (
                            <button
                              className="gh-lineage-linked-row"
                              key={`up-${item}`}
                              onClick={() => {
                                setWorkspaceIntent("lineageContext", item, "Data Lineage");
                                onSelectAsset(item, "Overview");
                              }}
                              type="button"
                            >
                              <span>{item}</span>
                              <span>Open linked asset</span>
                            </button>
                          ))}
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
                          {downstreamAssets.slice(0, 4).map((item) => (
                            <button
                              className="gh-lineage-linked-row"
                              key={`down-${item}`}
                              onClick={() => {
                                setWorkspaceIntent("lineageContext", item, "Data Lineage");
                                onSelectAsset(item, "Overview");
                              }}
                              type="button"
                            >
                              <span>{item}</span>
                              <span>Open linked asset</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="gh-support-copy">No downstream assets are currently surfaced.</div>
                      )}
                    </div>
                  </div>
                ) : relatedAssets.length ? (
                  <div className="gh-lineage-linked-list">
                    {relatedAssets.slice(0, 6).map((item) => (
                      <button
                        className="gh-lineage-linked-row"
                        key={item}
                        onClick={() => {
                          setWorkspaceIntent("lineageContext", item, "Data Lineage");
                          onSelectAsset(item, "Overview");
                        }}
                        type="button"
                      >
                        <span>{item}</span>
                        <span>Open linked asset</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Schema Summary</div>
                    <div className="gh-support-copy">
                      {detailHydrating
                        ? "Loading live schema metadata for this asset."
                        : detailUnavailable
                          ? "Live schema metadata is temporarily unavailable for this asset."
                        : liveColumns.length
                          ? `${liveColumns.length} columns surfaced from the live asset definition.`
                        : "No schema metadata is available for this asset."}
                    </div>
                  </div>
                </div>
                {detailHydrating ? (
                  <div className="gh-empty-state">Loading schema metadata...</div>
                ) : detailUnavailable ? (
                  <div className="gh-empty-state">
                    {assetDetail.error || "Live schema metadata is unavailable for this asset right now."}
                  </div>
                ) : liveColumns.length ? (
                  <div className="gh-preview-column-list">
                    {liveColumns.slice(0, 8).map((column) => (
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
              </section>
            </div>

            <div className="gh-entity-record-secondary">
              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Stewardship Posture</div>
                    <div className="gh-support-copy">
                      {completeness} of {tasks.length} core governance checks are complete for this asset.
                    </div>
                  </div>
                </div>
                <AttributeList items={recordIdentitySubset(asset)} />
              </section>

              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div className="gh-panel-title">Owners</div>
                </div>
                <OwnerList owners={asset.owners} />
              </section>

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

        {activeTab === "Governance" ? (
          <div className="gh-entity-record-layout gh-entity-record-layout-governance">
            <div className="gh-entity-record-primary">
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
            </div>

            <div className="gh-entity-record-secondary">
              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div>
                    <div className="gh-panel-title">Governance Checklist</div>
                    <div className="gh-support-copy">
                      Resolve the remaining stewardship gaps for this asset from the workbench.
                    </div>
                  </div>
                </div>
                <GovernanceGapRows items={tasks} onOpenGovernance={() => onOpenGovernance(asset.fqn)} />
              </section>

              <section className="gh-panel gh-record-card">
                <div className="gh-record-card-head">
                  <div className="gh-panel-title">Operational Metadata</div>
                </div>
                <AttributeList items={governancePostureSubset(asset)} />
              </section>
            </div>
          </div>
        ) : null}

        {activeTab === "Schema" ? (
          <section className="gh-panel gh-record-card">
            <div className="gh-record-card-head">
              <div>
                <div className="gh-panel-title">Schema</div>
                <div className="gh-support-copy">Column-level metadata for the selected asset.</div>
              </div>
            </div>
            {detailHydrating ? (
              <div className="gh-empty-state">Loading schema metadata...</div>
            ) : detailUnavailable ? (
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
                  </tr>
                </thead>
                <tbody>
                  {liveColumns.map((column) => (
                    <tr key={column.name}>
                      <td>{column.name}</td>
                      <td>{column.type}</td>
                      <td>{column.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="gh-empty-state">No schema metadata is available for this asset.</div>
            )}
          </section>
        ) : null}

        {activeTab === "Preview" ? (
          <section className="gh-panel gh-record-card">
            <div className="gh-record-card-head">
              <div>
                <div className="gh-panel-title">Sample Data</div>
                <div className="gh-support-copy">Sample rows returned from the live asset preview.</div>
              </div>
            </div>
            {detailHydrating ? (
              <div className="gh-empty-state">Loading preview rows...</div>
            ) : detailUnavailable ? (
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
      </section>
    </section>
  );
}
