import { useEffect, useState } from "react";
import LineageStage from "./LineageStage";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useLineage } from "../hooks/useLineage";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";

function statusTone(asset) {
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

function lineageCounts(graph) {
  if (!graph?.nodes?.length) {
    return { upstream: 0, downstream: 0, nodes: 0, edges: 0 };
  }
  return {
    upstream: graph.nodes.filter((node) => node.role === "source").length,
    downstream: graph.nodes.filter((node) => node.role === "target").length,
    nodes: graph.nodes.length,
    edges: graph.edges?.length || 0,
  };
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

function EntityTabs({ activeTab, onTabChange }) {
  const tabs = ["Overview", "Lineage", "Governance", "Schema", "Preview"];
  return (
    <div className="gh-subtabs">
      {tabs.map((tab) => (
        <button
          className={`gh-subtab ${activeTab === tab ? "is-active" : ""}`}
          key={tab}
          onClick={() => onTabChange(tab)}
          type="button"
        >
          {tab}
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

export default function EntityWorkspace({
  assetFqn,
  bootstrap,
  initialTab,
  onBack,
  onTabRouteChange,
  onOpenGovernance,
  onOpenLineage,
  onSelectAsset,
}) {
  const [activeTab, setActiveTab] = useState(initialTab || "Overview");
  const [localLineageContext, setLocalLineageContext] = useState("Data Lineage");
  const launchAssets = (bootstrap?.assets || []).slice(0, 6);
  const seeded = useSeededAssetContext(assetFqn, bootstrap, bootstrap?.assets || []);
  const assetDetail = useAssetDetail(assetFqn || "");
  const lineage = useLineage(assetFqn || "", seeded.seededGraph);
  const asset = assetDetail.detail || seeded.summary;
  const loading = assetDetail.loading;
  const entity = assetDetail.detail || asset;
  const lineageBundle = lineage.graph;
  const lineageLoading = lineage.loading;

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
  const dataCounts = lineageCounts(lineageBundle?.data);
  const operationalCounts = lineageCounts(lineageBundle?.operational);
  const relatedAssets = entity.relatedAssets || [];
  const tasks = governanceTasks(asset);
  const postureItems = [
    { label: "Domain", value: asset.domain || "Unassigned" },
    { label: "Tier", value: asset.tier || "Unassigned" },
    { label: "Certification", value: asset.certification || "Unassigned" },
    { label: "Sensitivity", value: asset.sensitivity || "Unassigned" },
    { label: "Criticality", value: asset.criticality || "Unassigned" },
    { label: "Open requests", value: `${asset.openRequests || 0}` },
  ];
  const lineageUnavailable = Boolean(lineage.error);
  const stewardshipSummary = tasks.filter((task) => !task.complete).slice(0, 3);

  useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [activeTab, initialTab]);

  useEffect(() => {
    setLocalLineageContext("Data Lineage");
  }, [assetFqn]);

  const changeTab = (nextTab) => {
    setActiveTab(nextTab);
    onTabRouteChange?.(nextTab);
  };

  return (
    <section className="gh-workspace gh-entity-workspace">
      <section className="gh-panel gh-entity-shell">
        <div className="gh-entity-toolbar">
          <button className="gh-tertiary-button" onClick={onBack} type="button">
            Catalog
          </button>
          <span className="gh-entity-toolbar-separator">/</span>
          <span className="gh-entity-toolbar-context">
            {asset.catalog} / {asset.schema}
          </span>
          <div className="gh-chip-row">
            <span className="gh-chip gh-chip-soft">{asset.objectType}</span>
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus || "Needs Work"}
            </span>
          </div>
        </div>

        <div className="gh-entity-header gh-entity-header-flat">
          <div className="gh-entity-hero-main">
            <h2>{asset.name}</h2>
            <div className="gh-entity-context gh-entity-context-rich">
              <span>{asset.catalog} / {asset.schema}</span>
              <span>{asset.objectType}</span>
              <span>Coverage {asset.coverageScore ?? 0}</span>
              <span>{asset.owners?.length || 0} owners</span>
              <span>{asset.openRequests || 0} requests</span>
              <span>{asset.domain || "Unassigned domain"}</span>
              <span>{asset.tier || "Unassigned tier"}</span>
            </div>
          </div>
          <div className="gh-action-grid gh-entity-header-actions">
            <button
              className="gh-primary-button"
              onClick={() => onOpenLineage(asset.fqn, localLineageContext)}
              type="button"
            >
              Open lineage
            </button>
            <button className="gh-secondary-button" onClick={() => onOpenGovernance(asset.fqn)} type="button">
              Open stewardship
            </button>
          </div>
        </div>

        <div className="gh-support-copy">
          {entity.description || asset.description || "No description is available for this asset yet."}
        </div>

        <EntityTabs activeTab={activeTab} onTabChange={changeTab} />

        {activeTab === "Overview" && (
          <div className="gh-entity-flow">
            <section className="gh-panel gh-entity-main gh-entity-main-single">
              <div className="gh-detail-section">
                <div className="gh-panel-title">Stewardship</div>
                <div className="gh-task-list gh-task-list-compact">
                  {(stewardshipSummary.length ? stewardshipSummary : tasks).map((task) => (
                    <div className={`gh-task-card ${task.complete ? "is-complete" : ""}`} key={task.label}>
                      <div className="gh-task-card-head">
                        <span className={`gh-status-chip tone-${task.complete ? "good" : "bad"}`}>
                          {task.complete ? "Ready" : "Needs work"}
                        </span>
                        <span className="gh-task-value">{task.value}</span>
                      </div>
                      <div className="gh-task-title">{task.label}</div>
                      <div className="gh-support-copy">{task.action}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="gh-detail-section">
                <div className="gh-panel-title">Lineage reach</div>
                {lineageUnavailable ? (
                  <div className="gh-empty-state">Lineage signals are temporarily unavailable.</div>
                ) : (
                  <div className="gh-chip-stack">
                    <span className="gh-chip gh-chip-soft">
                      Data upstream {lineageLoading ? "…" : dataCounts.upstream}
                    </span>
                    <span className="gh-chip gh-chip-soft">
                      Data downstream {lineageLoading ? "…" : dataCounts.downstream}
                    </span>
                    <span className="gh-chip gh-chip-soft">
                      Operational upstream {lineageLoading ? "…" : operationalCounts.upstream}
                    </span>
                    <span className="gh-chip gh-chip-soft">
                      Operational downstream {lineageLoading ? "…" : operationalCounts.downstream}
                    </span>
                  </div>
                )}
                <div className="gh-action-grid">
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenLineage(asset.fqn, "Data Lineage")}
                    type="button"
                  >
                    Data lineage
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenLineage(asset.fqn, "Operational Context")}
                    type="button"
                  >
                    Operational context
                  </button>
                </div>
              </div>

              <div className="gh-detail-section">
                <div className="gh-panel-title">Metadata</div>
                <AttributeList items={postureItems} />
              </div>

              <div className="gh-detail-section">
                <div className="gh-panel-title">Schema highlights</div>
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
                      {columns.slice(0, 8).map((column) => (
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
              </div>

              {relatedAssets.length ? (
                <div className="gh-detail-section">
                  <div className="gh-panel-title">Linked assets</div>
                  <div className="gh-chip-stack">
                    {relatedAssets.slice(0, 8).map((item) => (
                      <button
                        className="gh-filter-chip"
                        key={item}
                        onClick={() => onSelectAsset(item)}
                        type="button"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
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
              <div className="gh-panel-title">Asset workflow</div>
              <div className="gh-task-list gh-task-list-compact">
                {tasks.map((task) => (
                  <div className={`gh-task-card ${task.complete ? "is-complete" : ""}`} key={task.label}>
                    <div className="gh-task-card-head">
                      <span className={`gh-status-chip tone-${task.complete ? "good" : "bad"}`}>
                        {task.complete ? "Ready" : "Needs work"}
                      </span>
                      <span className="gh-task-value">{task.value}</span>
                    </div>
                    <div className="gh-task-title">{task.label}</div>
                    <div className="gh-support-copy">{task.action}</div>
                  </div>
                ))}
              </div>

              <div className="gh-detail-section">
                <div className="gh-panel-title">Metadata posture</div>
                <AttributeList items={postureItems} />
              </div>

              <div className="gh-action-grid">
                <button className="gh-primary-button" onClick={() => onOpenGovernance(asset.fqn)} type="button">
                  Open workbench
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenLineage(asset.fqn, "Operational Context")}
                  type="button"
                >
                  Inspect operational context
                </button>
              </div>

              {relatedAssets.length ? (
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Linked assets</div>
                  <div className="gh-chip-stack">
                    {relatedAssets.slice(0, 8).map((item) => (
                      <button
                        className="gh-filter-chip"
                        key={item}
                        onClick={() => onSelectAsset(item)}
                        type="button"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
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
