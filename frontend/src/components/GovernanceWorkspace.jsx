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

export default function GovernanceWorkspace({
  governance,
  onOpenAsset,
  onOpenLineage,
  selectedAsset,
}) {
  const metrics = governance?.metrics || [];
  const views = useMemo(() => governanceViews(governance), [governance]);
  const sections = [
    { key: "requests", label: "Requests", count: views.requests.length },
    { key: "glossary", label: "Glossary", count: views.glossary.length },
    { key: "coverage", label: "Coverage", count: views.coverage.length },
  ];
  const [view, setView] = useState("requests");
  const [selectedId, setSelectedId] = useState("");
  const items = views[view] || [];
  const selectedItem = items.find((item) => item.id === selectedId) || items[0] || null;

  useEffect(() => {
    setSelectedId(items[0]?.id || "");
  }, [view, items]);

  return (
    <section className="gh-governance-shell">
      <header className="gh-panel gh-governance-header">
        <div>
          <div className="gh-panel-title">Governance</div>
          <h2 className="gh-workspace-title">Stewardship queues and glossary context</h2>
          <div className="gh-support-copy">
            Review open work, inspect glossary definitions, and monitor governance posture from one workspace.
          </div>
        </div>
        <div className="gh-summary-grid gh-governance-metrics">
          {metrics.slice(0, 4).map((metric) => (
            <div className="gh-stat-card" key={metric.label}>
              <span className="gh-stat-label">{metric.label}</span>
              <span className="gh-stat-value">{metric.value}</span>
            </div>
          ))}
        </div>
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
            </div>
          </div>

          {items.length ? (
            <div className="gh-request-list">
              {items.map((item) => (
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
            <div className="gh-empty-state">No items are available in this queue yet.</div>
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
