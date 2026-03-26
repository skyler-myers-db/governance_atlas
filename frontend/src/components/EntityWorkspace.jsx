import { useEffect, useState } from "react";
import LineageStage from "./LineageStage";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useLineage } from "../hooks/useLineage";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { consumeWorkspaceIntent } from "../lib/workspaceIntent";

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
  return [
    { label: "Domain", value: asset.domain || "Unassigned" },
    { label: "Tier", value: asset.tier || "Unassigned" },
    { label: "Certification", value: asset.certification || "Unassigned" },
    { label: "Sensitivity", value: asset.sensitivity || "Unassigned" },
    { label: "Criticality", value: asset.criticality || "Unassigned" },
    { label: "Open requests", value: `${asset.openRequests || 0}` },
    { label: "Coverage", value: `${asset.coverageScore ?? 0}` },
    { label: "Owners", value: `${asset.owners?.length || 0}` },
  ];
}

function EntityTabs({ activeTab, onTabChange }) {
  const tabs = [
    { key: "Overview", label: "Home" },
    { key: "Lineage", label: "Lineage" },
    { key: "Governance", label: "Governance" },
    { key: "Schema", label: "Schema" },
    { key: "Preview", label: "Preview" },
  ];
  return (
    <div className="gh-subtabs">
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

export default function EntityWorkspace({
  assetFqn,
  bootstrap,
  onBack,
  onOpenGovernance,
  onOpenLineage,
  onSelectAsset,
}) {
  const [activeTab, setActiveTab] = useState(() => {
    return consumeWorkspaceIntent("entityTab", assetFqn, "Overview") || "Overview";
  });
  const [localLineageContext, setLocalLineageContext] = useState("Data Lineage");
  const launchAssets = (bootstrap?.assets || []).slice(0, 6);
  const seeded = useSeededAssetContext(assetFqn, bootstrap, bootstrap?.assets || []);
  const assetDetail = useAssetDetail(assetFqn || "");
  const lineageEnabled = activeTab === "Lineage";
  const lineage = useLineage(assetFqn || "", seeded.seededGraph, lineageEnabled);
  const asset = assetDetail.detail || seeded.summary;
  const loading = assetDetail.loading;
  const entity = assetDetail.detail || asset;
  const lineageBundle = lineage.graph;
  const lineageLoading = lineage.loading;

  useEffect(() => {
    const nextContext =
      consumeWorkspaceIntent("lineageContext", assetFqn, "") || "Data Lineage";
    setLocalLineageContext(nextContext);
  }, [assetFqn]);

  useEffect(() => {
    const nextTab = consumeWorkspaceIntent("entityTab", assetFqn, "Overview") || "Overview";
    setActiveTab(nextTab);
  }, [assetFqn]);

  if (assetFqn && !asset && !loading) {
    return (
      <section className="gh-workspace gh-entity-workspace">
        <div className="gh-panel gh-unavailable-panel">
          <div className="gh-panel-title">Asset unavailable</div>
          <h2>The selected asset could not be opened.</h2>
          <p>{assetDetail.error || "This asset is unavailable or cannot be inspected with the current permissions."}</p>
          <div className="gh-empty-state-actions">
            <button className="gh-secondary-button" onClick={onBack} type="button">
              Return to catalog
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
                Return to catalog
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

  const columns = entity.columns || [];
  const preview = entity.preview || [];
  const relatedAssets = entity.relatedAssets || [];
  const tasks = governanceTasks(asset);
  const posture = postureItems(asset);
  const lineageUnavailable = Boolean(lineage.error);
  const stewardshipSummary = tasks.filter((task) => !task.complete).slice(0, 3);

  const changeTab = (nextTab) => {
    setActiveTab(nextTab);
  };

  return (
    <section className="gh-workspace gh-entity-workspace">
      <section className="gh-panel gh-entity-shell">
        <div className="gh-entity-header gh-entity-header-flat">
          <div className="gh-entity-hero-main">
            <h2>{asset.name}</h2>
            <div className="gh-entity-context gh-entity-context-rich">
              <span>{asset.catalog} / {asset.schema}</span>
              <span>{asset.objectType}</span>
              <span className={`gh-status-chip tone-${statusTone(asset)}`}>
                {asset.governanceStatus || "Needs Work"}
              </span>
            </div>
          </div>
        </div>

        <EntityTabs activeTab={activeTab} onTabChange={changeTab} />

        {activeTab === "Overview" && (
          <div className="gh-entity-flow">
            <section className="gh-panel gh-entity-main gh-entity-main-single gh-entity-summary-shell">
              <div className="gh-entity-home-layout">
                <div className="gh-entity-home-primary">
                  <div className="gh-detail-section">
                    <div className="gh-panel-title">Lineage impact</div>
                    <div className="gh-support-copy">
                      {lineageUnavailable
                        ? "Lineage signals are temporarily unavailable for this asset right now."
                        : relatedAssets.length
                          ? "Trace upstream, downstream, and operational dependencies directly from this asset."
                          : "No connected lineage edges are surfaced for this asset yet."}
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
                    {relatedAssets.length ? (
                      <div className="gh-lineage-linked-list">
                        {relatedAssets.slice(0, 6).map((item) => (
                          <button
                            className="gh-lineage-linked-row"
                            key={item}
                            onClick={() => onSelectAsset(item)}
                            type="button"
                          >
                            <span>{item}</span>
                            <span>Open linked asset</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="gh-detail-section">
                    <div className="gh-panel-title">Stewardship priorities</div>
                    <GovernanceGapRows
                      items={stewardshipSummary.length ? stewardshipSummary : tasks.slice(0, 4)}
                      onOpenGovernance={() => onOpenGovernance(asset.fqn)}
                    />
                    <div className="gh-action-grid gh-action-grid-inline">
                      <button
                        className="gh-tertiary-button gh-inline-link-button"
                        onClick={() => onOpenGovernance(asset.fqn)}
                        type="button"
                      >
                        Open stewardship workbench
                      </button>
                    </div>
                  </div>
                </div>

                <div className="gh-entity-home-secondary">
                  <div className="gh-detail-section">
                    <div className="gh-panel-title">Definition</div>
                    <div className="gh-support-copy">
                      {entity.description || asset.description || "No description is available for this asset yet."}
                    </div>
                  </div>

                  <div className="gh-detail-section">
                    <div className="gh-panel-title">Operational metadata</div>
                    <AttributeList items={posture.slice(0, 6)} />
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === "Lineage" && (
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
            onOpenAsset={(assetFqn) => onSelectAsset(assetFqn)}
            onOpenFullGraph={(nextContext) => onOpenLineage(asset.fqn, nextContext)}
            onOpenGovernance={onOpenGovernance}
            onSelectAsset={onSelectAsset}
          />
        )}

        {activeTab === "Governance" && (
          <section className="gh-entity-flow">
            <section className="gh-panel gh-entity-main gh-entity-main-single">
              <div className="gh-entity-home-layout gh-entity-governance-layout">
                <div className="gh-entity-home-primary">
                  <div className="gh-detail-section">
                    <div className="gh-panel-title">Stewardship work</div>
                    <GovernanceGapRows items={tasks} onOpenGovernance={() => onOpenGovernance(asset.fqn)} />
                  </div>
                </div>
                <div className="gh-entity-home-secondary">
                  {relatedAssets.length ? (
                    <div className="gh-detail-section">
                      <div className="gh-panel-title">Linked assets</div>
                      <div className="gh-lineage-linked-list">
                        {relatedAssets.slice(0, 6).map((item) => (
                          <button
                            className="gh-lineage-linked-row"
                            key={item}
                            onClick={() => onSelectAsset(item)}
                            type="button"
                          >
                            <span>{item}</span>
                            <span>Open linked asset</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="gh-detail-section">
                    <div className="gh-panel-title">Continue in workbench</div>
                    <div className="gh-chip-row gh-chip-row-compact">
                      <button
                        className="gh-tertiary-button gh-inline-link-button"
                        onClick={() => onOpenGovernance(asset.fqn)}
                        type="button"
                      >
                        Open stewardship workbench
                      </button>
                      <button
                        className="gh-tertiary-button gh-inline-link-button"
                        onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
                        type="button"
                      >
                        Open lineage
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </section>
        )}

        {activeTab === "Schema" && (
          <section className="gh-detail-section">
            {loading ? (
              <div className="gh-empty-state">Loading schema metadata…</div>
            ) : columns.length ? (
              <table className="gh-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((column) => (
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
        )}

        {activeTab === "Preview" && (
          <section className="gh-detail-section">
            {loading ? (
              <div className="gh-empty-state">Loading preview rows…</div>
            ) : preview.length ? (
              <table className="gh-table">
                <thead>
                  <tr>
                    {Object.keys(preview[0]).map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, index) => (
                    <tr key={index}>
                      {Object.keys(preview[0]).map((key) => (
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
        )}
      </section>
    </section>
  );
}
