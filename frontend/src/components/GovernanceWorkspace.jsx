import { useEffect, useMemo, useState } from "react";

function governanceViews(governance) {
  const metrics = governance?.metrics || [];
  const backlog = governance?.backlog || [];
  const glossary = governance?.glossary || [];

  return {
    requests: backlog.map((item, index) => ({
      id: `request-${index}`,
      title: item.title,
      subtitle: item.asset,
      assetFqn: item.assetFqn || item.asset,
      status: item.status,
      detail: item.note,
    })),
    glossary: glossary.map((item, index) => ({
      id: `glossary-${index}`,
      title: item.term,
      subtitle: "Glossary term",
      status: "Reference",
      detail: item.definition,
    })),
    coverage: metrics.map((item, index) => ({
      id: `metric-${index}`,
      title: item.label,
      subtitle: "Workspace metric",
      status: "Signal",
      detail: `${item.value}`,
    })),
  };
}

function governanceActionTrack(asset) {
  if (!asset) return [];
  return [
    {
      label: "Owners",
      value: asset.owners?.length ? `${asset.owners.length} assigned` : "Unassigned",
      complete: Boolean(asset.owners?.length),
      note: "Confirm accountable stewards and business ownership.",
    },
    {
      label: "Domain",
      value: asset.domain || "Unassigned",
      complete: Boolean(asset.domain && asset.domain !== "Unassigned"),
      note: "Map this asset into the correct business area.",
    },
    {
      label: "Certification",
      value: asset.certification || "Unassigned",
      complete: Boolean(asset.certification && asset.certification !== "Unassigned"),
      note: "Decide whether the asset is approved for broad reuse.",
    },
    {
      label: "Sensitivity",
      value: asset.sensitivity || "Unassigned",
      complete: Boolean(asset.sensitivity && asset.sensitivity !== "Unassigned"),
      note: "Review privacy, PII, and classification posture.",
    },
  ];
}

export default function GovernanceWorkspace({
  governance,
  onOpenAsset,
  onOpenLineage,
  selectedAsset,
}) {
  const views = useMemo(() => governanceViews(governance), [governance]);
  const sections = [
    { key: "requests", label: "Backlog", count: views.requests.length },
    { key: "glossary", label: "Glossary", count: views.glossary.length },
    { key: "coverage", label: "Signals", count: views.coverage.length },
  ];
  const [view, setView] = useState("requests");
  const [selectedId, setSelectedId] = useState("");
  const items = views[view] || [];
  const assetScopedRequests =
    selectedAsset && view === "requests"
      ? items.filter((item) => item.assetFqn === selectedAsset.fqn)
      : items;
  const assetScopedEmpty =
    Boolean(selectedAsset) && view === "requests" && !assetScopedRequests.length;
  const workItems = assetScopedEmpty ? [] : assetScopedRequests;
  const selectedItem = workItems.find((item) => item.id === selectedId) || workItems[0] || null;
  const actionTrack = governanceActionTrack(selectedAsset);

  useEffect(() => {
    setSelectedId(workItems[0]?.id || "");
  }, [view, workItems]);

  return (
    <section className="gh-governance-shell">
      <header className="gh-panel gh-governance-header gh-governance-topbar">
        <div>
          <div className="gh-panel-title">Governance</div>
          <h2 className="gh-workspace-title">Stewardship workbench</h2>
        </div>
        {selectedAsset ? (
          <div className="gh-chip-stack">
            <span className="gh-chip">{selectedAsset.name}</span>
            <span className="gh-chip gh-chip-soft">
              {selectedAsset.catalog} / {selectedAsset.schema}
            </span>
          </div>
        ) : null}
      </header>

      <div className="gh-governance-layout">
        <aside className="gh-panel gh-governance-sidebar">
          {selectedAsset ? (
            <section className="gh-filter-section">
              <div className="gh-panel-title">Focused asset</div>
              <div className="gh-chip-stack">
                <span className="gh-chip">{selectedAsset.name}</span>
                <span className="gh-chip gh-chip-soft">
                  {selectedAsset.catalog} / {selectedAsset.schema}
                </span>
              </div>
              <div className="gh-action-grid">
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenAsset(selectedAsset.fqn)}
                  type="button"
                >
                  Open asset
                </button>
                <button
                  className="gh-secondary-button"
                  onClick={() => onOpenLineage(selectedAsset.fqn, "Data Lineage")}
                  type="button"
                >
                  Open lineage
                </button>
              </div>
            </section>
          ) : null}
          {actionTrack.length ? (
            <section className="gh-filter-section">
              <div className="gh-panel-title">Action track</div>
              <div className="gh-task-list">
                {actionTrack.map((item) => (
                  <div className={`gh-task-card ${item.complete ? "is-complete" : ""}`} key={item.label}>
                    <div className="gh-task-card-head">
                      <span className={`gh-status-chip tone-${item.complete ? "good" : "bad"}`}>
                        {item.complete ? "Ready" : "Needs work"}
                      </span>
                      <span className="gh-task-value">{item.value}</span>
                    </div>
                    <div className="gh-task-title">{item.label}</div>
                    <div className="gh-support-copy">{item.note}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <div className="gh-panel-title">Queues</div>
          <div className="gh-saved-view-list">
            {sections.map((section) => (
              <button
                className={`gh-category-row ${view === section.key ? "is-active" : ""}`}
                key={section.key}
                onClick={() => setView(section.key)}
                type="button"
              >
                <span>{section.label}</span>
                <span className="gh-category-count">{section.count}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="gh-panel gh-governance-list-pane">
          <div className="gh-results-head">
            <div>
              <div className="gh-panel-title">Worklist</div>
              <h2 className="gh-workspace-title">
                {sections.find((section) => section.key === view)?.label || "Worklist"}
              </h2>
              {selectedAsset && view === "requests" && !assetScopedEmpty ? (
                <div className="gh-support-copy">
                  Showing active work linked to {selectedAsset.name}.
                </div>
              ) : null}
              {selectedAsset && view === "requests" && assetScopedEmpty ? (
                <div className="gh-support-copy">
                  No active governance work is currently linked to {selectedAsset.name}.
                </div>
              ) : null}
            </div>
          </div>

          {workItems.length ? (
            <div className="gh-request-list">
              {workItems.map((item) => (
                <button
                  className={`gh-request-card gh-request-row ${selectedItem?.id === item.id ? "is-active" : ""}`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  type="button"
                >
                  <div className="gh-request-title">{item.title}</div>
                  <div className="gh-request-meta">{item.subtitle}</div>
                  <div className="gh-chip-row">
                    <span className="gh-chip gh-chip-soft">{item.status}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="gh-empty-state">
              {assetScopedEmpty
                ? "No governance backlog is currently attached to the focused asset."
                : "No items are available in this queue yet."}
            </div>
          )}
        </section>

        <aside className="gh-panel gh-governance-detail-pane">
          <div className="gh-panel-title">Detail</div>
          {selectedItem ? (
            <>
              <h2>{selectedItem.title}</h2>
              <div className="gh-support-copy">{selectedItem.subtitle}</div>
              <div className="gh-chip-stack">
                <span className="gh-chip">{selectedItem.status}</span>
              </div>
              <div className="gh-detail-section">
                <div className="gh-support-copy">{selectedItem.detail}</div>
              </div>
              {selectedItem.assetFqn ? (
                <div className="gh-action-grid">
                  <button
                    className="gh-primary-button"
                    onClick={() => onOpenAsset(selectedItem.assetFqn)}
                    type="button"
                  >
                    Open asset
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenLineage(selectedItem.assetFqn, "Data Lineage")}
                    type="button"
                  >
                    Open lineage
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="gh-empty-state">Select a governance item to inspect its details.</div>
          )}
        </aside>
      </div>
    </section>
  );
}
