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
      termId: item.termId,
      title: item.term,
      subtitle: item.domain || "Unassigned",
      status: item.status || "Draft",
      detail: item.definition,
      ownerEmail: item.ownerEmail || "Unassigned",
      assetCount: item.assetCount || 0,
      assets: item.assets || [],
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
  const stewardshipQueues = [
    { key: "requests", label: "Backlog", count: views.requests.length },
    { key: "coverage", label: "Signals", count: views.coverage.length },
  ];
  const [mode, setMode] = useState(selectedAsset ? "stewardship" : "glossary");
  const [view, setView] = useState("requests");
  const [selectedId, setSelectedId] = useState("");
  const [glossaryQuery, setGlossaryQuery] = useState("");
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
  const glossaryItems = useMemo(() => {
    const query = glossaryQuery.trim().toLowerCase();
    if (!query) return views.glossary;
    return views.glossary.filter((item) => {
      return (
        item.title.toLowerCase().includes(query) ||
        item.detail.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query)
      );
    });
  }, [glossaryQuery, views.glossary]);
  const selectedGlossary =
    glossaryItems.find((item) => item.id === selectedId) || glossaryItems[0] || null;

  useEffect(() => {
    if (mode === "glossary") {
      setSelectedId(glossaryItems[0]?.id || "");
      return;
    }
    setSelectedId(workItems[0]?.id || "");
  }, [glossaryItems, mode, view, workItems]);

  useEffect(() => {
    if (selectedAsset) {
      setMode("stewardship");
    }
  }, [selectedAsset?.fqn]);

  return (
    <section className="gh-governance-shell">
      <header className="gh-panel gh-governance-header gh-governance-topbar">
        <div>
          <div className="gh-panel-title">Governance</div>
          <h2 className="gh-workspace-title">Stewardship workbench</h2>
        </div>
        <div className="gh-segment-row">
          <button
            className={`gh-segment-button ${mode === "stewardship" ? "is-active" : ""}`}
            onClick={() => setMode("stewardship")}
            type="button"
          >
            Stewardship
          </button>
          <button
            className={`gh-segment-button ${mode === "glossary" ? "is-active" : ""}`}
            onClick={() => setMode("glossary")}
            type="button"
          >
            Glossary
          </button>
        </div>
      </header>

      <div className="gh-governance-layout">
        <aside className="gh-panel gh-governance-sidebar">
          {mode === "stewardship" ? (
            <>
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
              <div className="gh-panel-title">Stewardship lanes</div>
              <div className="gh-saved-view-list">
                {stewardshipQueues.map((section) => (
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
            </>
          ) : (
            <>
              <section className="gh-filter-section">
                <div className="gh-panel-title">Glossary search</div>
                <input
                  className="gh-input"
                  onChange={(event) => setGlossaryQuery(event.target.value)}
                  placeholder="Search terms, definitions, or domains"
                  value={glossaryQuery}
                />
              </section>
              <section className="gh-filter-section">
                <div className="gh-panel-title">Reference scope</div>
                <div className="gh-chip-stack">
                  <span className="gh-chip gh-chip-soft">{views.glossary.length} terms</span>
                  <span className="gh-chip gh-chip-soft">{views.requests.length} active requests</span>
                </div>
              </section>
            </>
          )}
        </aside>

        <section className="gh-panel gh-governance-list-pane">
          <div className="gh-results-head">
            <div>
              <div className="gh-panel-title">{mode === "stewardship" ? "Worklist" : "Glossary terms"}</div>
              <h2 className="gh-workspace-title">
                {mode === "stewardship"
                  ? stewardshipQueues.find((section) => section.key === view)?.label || "Worklist"
                  : "Shared language"}
              </h2>
              {mode === "stewardship" && selectedAsset && view === "requests" && !assetScopedEmpty ? (
                <div className="gh-support-copy">
                  Showing active work linked to {selectedAsset.name}.
                </div>
              ) : null}
              {mode === "stewardship" && selectedAsset && view === "requests" && assetScopedEmpty ? (
                <div className="gh-support-copy">
                  No active governance work is currently linked to {selectedAsset.name}.
                </div>
              ) : null}
              {mode === "glossary" ? (
                <div className="gh-support-copy">
                  Maintain terms, owners, and domain language in the same workspace as asset stewardship.
                </div>
              ) : null}
            </div>
          </div>

          {mode === "stewardship" ? (
            workItems.length ? (
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
            )
          ) : (
            glossaryItems.length ? (
              <div className="gh-request-list">
                {glossaryItems.map((item) => (
                  <button
                    className={`gh-request-card gh-request-row ${selectedGlossary?.id === item.id ? "is-active" : ""}`}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    type="button"
                  >
                    <div className="gh-request-title">{item.title}</div>
                    <div className="gh-request-meta">{item.subtitle}</div>
                    <div className="gh-chip-row">
                      <span className="gh-chip gh-chip-soft">{item.status}</span>
                      <span className="gh-chip gh-chip-soft">{item.assetCount} assets</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="gh-empty-state">No glossary terms match the current search.</div>
            )
          )}
        </section>

        <aside className="gh-panel gh-governance-detail-pane">
          <div className="gh-panel-title">{mode === "stewardship" ? "Detail" : "Term detail"}</div>
          {mode === "stewardship" && selectedItem ? (
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
          ) : mode === "glossary" && selectedGlossary ? (
            <>
              <h2>{selectedGlossary.title}</h2>
              <div className="gh-support-copy">{selectedGlossary.detail}</div>
              <div className="gh-chip-stack">
                <span className="gh-chip">{selectedGlossary.status}</span>
                <span className="gh-chip gh-chip-soft">{selectedGlossary.subtitle}</span>
                <span className="gh-chip gh-chip-soft">{selectedGlossary.ownerEmail}</span>
              </div>
              <div className="gh-detail-section">
                <div className="gh-panel-title">Linked assets</div>
                {selectedGlossary.assets?.length ? (
                  <div className="gh-chip-stack">
                    {selectedGlossary.assets.map((assetFqn) => (
                      <button
                        className="gh-filter-chip gh-chip-soft"
                        key={assetFqn}
                        onClick={() => onOpenAsset(assetFqn)}
                        type="button"
                      >
                        {assetFqn.split(".").slice(-2).join(" / ")}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="gh-empty-state">No linked assets are surfaced for this term yet.</div>
                )}
              </div>
            </>
          ) : (
            <div className="gh-empty-state">
              {mode === "stewardship"
                ? "Select a stewardship item to inspect its details."
                : "Select a glossary term to inspect its definition and linked assets."}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
