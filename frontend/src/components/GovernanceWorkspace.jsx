import { useEffect, useMemo, useState } from "react";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";

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

function glossaryCollections(glossaryItems) {
  const domains = new Map();
  glossaryItems.forEach((item) => {
    const key = item.subtitle || "Unassigned";
    domains.set(key, (domains.get(key) || 0) + 1);
  });

  return [
    { key: "All terms", label: "All terms", count: glossaryItems.length },
    ...[...domains.entries()].map(([label, count]) => ({
      key: label,
      label,
      count,
    })),
  ];
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

export default function GovernanceWorkspace({
  initialAssetFqn,
  bootstrap,
  governance,
  onRouteAssetChange,
  onOpenAsset,
  onOpenLineage,
}) {
  const [focusedAssetFqn, setFocusedAssetFqn] = useState(initialAssetFqn || "");
  const seeded = useSeededAssetContext(focusedAssetFqn, bootstrap, bootstrap?.assets || []);
  const assetDetail = useAssetDetail(focusedAssetFqn || "");
  const focusedAsset = assetDetail.detail || seeded.summary;
  const views = useMemo(() => governanceViews(governance), [governance]);
  const stewardshipQueues = [
    { key: "requests", label: "Open work", count: views.requests.length },
    { key: "coverage", label: "Signals", count: views.coverage.length },
  ];
  const [mode, setMode] = useState("stewardship");
  const [view, setView] = useState("requests");
  const [selectedWorkId, setSelectedWorkId] = useState("");
  const [selectedGlossaryId, setSelectedGlossaryId] = useState("");
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [glossaryCollection, setGlossaryCollection] = useState("All terms");
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const assetSearch = useAssetSearch(assetSearchQuery, assetSearchQuery.trim().length >= 2);

  useEffect(() => {
    setFocusedAssetFqn(initialAssetFqn || "");
  }, [initialAssetFqn]);

  const focusAsset = (assetFqn) => {
    const nextRequests = assetFqn
      ? views.requests.filter((item) => item.assetFqn === assetFqn)
      : views.requests;
    setFocusedAssetFqn(assetFqn || "");
    setAssetSearchQuery("");
    if (mode === "stewardship" && view === "requests" && !nextRequests.length && views.coverage.length) {
      setView("coverage");
    }
    onRouteAssetChange?.(assetFqn || "");
  };

  const items = views[view] || [];
  const assetScopedRequests =
    view === "requests"
      ? focusedAssetFqn
        ? focusedAsset
          ? items.filter((item) => item.assetFqn === focusedAsset.fqn)
          : []
        : items
      : items;
  const assetScopedEmpty =
    Boolean(focusedAssetFqn) && view === "requests" && !assetScopedRequests.length;
  const workItems = assetScopedEmpty ? [] : assetScopedRequests;
  const selectedItem = workItems.find((item) => item.id === selectedWorkId) || workItems[0] || null;
  const actionTrack = governanceActionTrack(focusedAsset);
  const linkedGlossary = useMemo(() => {
    if (!focusedAsset) return [];
    return views.glossary.filter((item) => item.assets?.includes(focusedAsset.fqn));
  }, [focusedAsset, views.glossary]);
  const glossaryCollectionsList = useMemo(() => glossaryCollections(views.glossary), [views.glossary]);
  const glossaryItems = useMemo(() => {
    const query = glossaryQuery.trim().toLowerCase();
    const scoped =
      glossaryCollection === "All terms"
        ? views.glossary
        : views.glossary.filter((item) => item.subtitle === glossaryCollection);
    if (!query) return scoped;
    return scoped.filter((item) => {
      return (
        item.title.toLowerCase().includes(query) ||
        item.detail.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query)
      );
    });
  }, [glossaryCollection, glossaryQuery, views.glossary]);
  const selectedGlossary =
    glossaryItems.find((item) => item.id === selectedGlossaryId) || glossaryItems[0] || null;
  const focusedAssetUnavailable = Boolean(focusedAssetFqn && assetDetail.error && !focusedAsset);
  const focusedAssetAttributes = focusedAsset
    ? [
        { label: "Domain", value: focusedAsset.domain || "Unassigned" },
        { label: "Tier", value: focusedAsset.tier || "Unassigned" },
        { label: "Certification", value: focusedAsset.certification || "Unassigned" },
        { label: "Sensitivity", value: focusedAsset.sensitivity || "Unassigned" },
        { label: "Coverage", value: `${focusedAsset.coverageScore ?? 0}` },
        { label: "Requests", value: `${focusedAsset.openRequests ?? 0}` },
      ]
    : [];

  useEffect(() => {
    setSelectedWorkId((current) =>
      workItems.some((item) => item.id === current) ? current : workItems[0]?.id || ""
    );
  }, [workItems]);

  useEffect(() => {
    setSelectedGlossaryId((current) =>
      glossaryItems.some((item) => item.id === current) ? current : glossaryItems[0]?.id || ""
    );
  }, [glossaryItems]);

  useEffect(() => {
    if (glossaryCollectionsList.some((item) => item.key === glossaryCollection)) return;
    setGlossaryCollection("All terms");
  }, [glossaryCollection, glossaryCollectionsList]);

  return (
    <section className="gh-governance-shell">
      <header className="gh-panel gh-governance-strip">
        <div className="gh-governance-strip-main">
          <div className="gh-panel-title">Governance</div>
          <div className="gh-chip-row">
            <span className="gh-chip gh-chip-soft">{mode === "stewardship" ? "Stewardship" : "Glossary"}</span>
            {focusedAsset ? (
              <>
                <span className="gh-chip">{focusedAsset.name}</span>
                <span className="gh-chip gh-chip-soft">
                  {focusedAsset.catalog} / {focusedAsset.schema}
                </span>
              </>
            ) : focusedAssetFqn ? (
              <span className="gh-chip gh-chip-soft">Asset unavailable</span>
            ) : null}
          </div>
        </div>
        <div className="gh-governance-strip-tools">
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
          <div className="gh-governance-focus-command">
            <input
              className="gh-input"
              onChange={(event) => setAssetSearchQuery(event.target.value)}
              placeholder={focusedAsset ? `Switch focus from ${focusedAsset.name}` : "Focus an asset"}
              value={assetSearchQuery}
            />
            {assetSearchQuery.trim().length >= 2 ? (
              <div className="gh-governance-focus-dropdown">
                {assetSearch.loading ? (
                  <div className="gh-empty-state">Searching assets…</div>
                ) : assetSearch.assets.length ? (
                  assetSearch.assets.map((asset) => (
                    <button
                      className="gh-lineage-search-row"
                      key={asset.fqn}
                      onClick={() => focusAsset(asset.fqn)}
                      type="button"
                    >
                      <span>{asset.name}</span>
                      <span>
                        {asset.catalog} / {asset.schema}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="gh-empty-state">No matching assets.</div>
                )}
              </div>
            ) : null}
          </div>
          {focusedAssetFqn ? (
            <button className="gh-secondary-button" onClick={() => focusAsset("")} type="button">
              Clear focus
            </button>
          ) : null}
        </div>
      </header>

      {mode === "stewardship" ? (
        <div className="gh-governance-flow-grid">
          <aside className="gh-panel gh-governance-lane-pane">
            <div className="gh-panel-title">Queues</div>
            <div className="gh-category-list">
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

            {focusedAsset ? (
              <section className="gh-detail-section">
                <div className="gh-panel-title">Focused asset</div>
                <div className="gh-support-copy">
                  {focusedAsset.catalog} / {focusedAsset.schema}
                </div>
                <div className="gh-chip-row">
                  <span className="gh-chip gh-chip-soft">{focusedAsset.objectType}</span>
                  <span className="gh-chip">{focusedAsset.governanceStatus || "Needs Work"}</span>
                </div>
                <div className="gh-action-grid">
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenAsset(focusedAsset.fqn)}
                    type="button"
                  >
                    Open asset
                  </button>
                  <button
                    className="gh-secondary-button"
                    onClick={() => onOpenLineage(focusedAsset.fqn, "Data Lineage")}
                    type="button"
                  >
                    Open lineage
                  </button>
                </div>
              </section>
            ) : focusedAssetUnavailable ? (
              <div className="gh-empty-state">The focused asset is unavailable with the current permissions.</div>
            ) : (
              <div className="gh-empty-state">
                Focus an asset to move from global governance signals into asset-level stewardship work.
              </div>
            )}
          </aside>

          {focusedAssetFqn ? (
            <>
              <section className="gh-panel gh-governance-list-pane">
                <div className="gh-panel-title">{view === "requests" ? "Active work" : "Signals"}</div>
                {workItems.length ? (
                  <div className="gh-request-list">
                    {workItems.map((item) => (
                      <button
                        className={`gh-request-card gh-request-row ${selectedItem?.id === item.id ? "is-active" : ""}`}
                        key={item.id}
                        onClick={() => setSelectedWorkId(item.id)}
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
                      : "No items are available in this lane yet."}
                  </div>
                )}
              </section>

              <aside className="gh-panel gh-governance-detail-pane">
                <div className="gh-panel-title">Work detail</div>
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
                          onClick={() => focusAsset(selectedItem.assetFqn)}
                          type="button"
                        >
                          Focus here
                        </button>
                        <button
                          className="gh-secondary-button"
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
                  <div className="gh-empty-state">
                    {assetScopedEmpty ? (
                      <>
                        No stewardship work is attached to the current asset.
                        <div className="gh-action-grid">
                          {focusedAsset ? (
                            <>
                              <button
                                className="gh-secondary-button"
                                onClick={() => onOpenAsset(focusedAsset.fqn)}
                                type="button"
                              >
                                Open asset
                              </button>
                              <button
                                className="gh-secondary-button"
                                onClick={() => onOpenLineage(focusedAsset.fqn, "Data Lineage")}
                                type="button"
                              >
                                Open lineage
                              </button>
                            </>
                          ) : null}
                          <button className="gh-secondary-button" onClick={() => setMode("glossary")} type="button">
                            Switch to glossary
                          </button>
                        </div>
                      </>
                    ) : (
                      "Select a stewardship item to inspect its details."
                    )}
                  </div>
                )}

                {focusedAsset ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Checklist</div>
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

                {focusedAsset ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Asset state</div>
                    <AttributeList items={focusedAssetAttributes} />
                  </section>
                ) : null}

                {linkedGlossary.length ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Glossary links</div>
                    <div className="gh-chip-stack">
                      {linkedGlossary.map((item) => (
                        <button
                          className="gh-filter-chip gh-chip-soft"
                          key={item.id}
                          onClick={() => {
                            setMode("glossary");
                            setSelectedGlossaryId(item.id);
                          }}
                          type="button"
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </aside>
            </>
          ) : (
            <section className="gh-panel gh-governance-empty-workbench">
              <div className="gh-panel-title">Stewardship workbench</div>
              <h2>Focus an asset to start stewardship work.</h2>
              <p>
                Use the asset focus command above to move from global governance signals into one asset’s ownership,
                certification, sensitivity, and glossary context.
              </p>
              <div className="gh-summary-grid gh-summary-grid-tight">
                {stewardshipQueues.map((section) => (
                  <div className="gh-stat-card" key={section.key}>
                    <span className="gh-stat-label">{section.label}</span>
                    <span className="gh-stat-value">{section.count}</span>
                  </div>
                ))}
              </div>
              <div className="gh-action-grid">
                <button className="gh-secondary-button" onClick={() => setMode("glossary")} type="button">
                  Open glossary
                </button>
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="gh-governance-flow-grid gh-governance-glossary-shell">
          <aside className="gh-panel gh-governance-lane-pane">
            <div className="gh-panel-title">Collections</div>
            <div className="gh-category-list">
              {glossaryCollectionsList.map((collection) => (
                <button
                  className={`gh-category-row ${glossaryCollection === collection.key ? "is-active" : ""}`}
                  key={collection.key}
                  onClick={() => setGlossaryCollection(collection.key)}
                  type="button"
                >
                  <span>{collection.label}</span>
                  <span className="gh-category-count">{collection.count}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="gh-panel gh-governance-list-pane">
            <div className="gh-detail-section">
              <div className="gh-panel-title">Term search</div>
              <input
                className="gh-input"
                onChange={(event) => setGlossaryQuery(event.target.value)}
                placeholder="Search terms, definitions, or domains"
                value={glossaryQuery}
              />
            </div>

            <div className="gh-detail-section">
              <div className="gh-panel-title">Terms</div>
              {glossaryItems.length ? (
                <div className="gh-request-list">
                  {glossaryItems.map((item) => (
                    <button
                      className={`gh-request-card gh-request-row ${selectedGlossary?.id === item.id ? "is-active" : ""}`}
                      key={item.id}
                      onClick={() => setSelectedGlossaryId(item.id)}
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
              )}
            </div>
          </section>

          <aside className="gh-panel gh-governance-detail-pane">
            <div className="gh-panel-title">Term detail</div>
            {selectedGlossary ? (
              <>
                <h2>{selectedGlossary.title}</h2>
                <div className="gh-support-copy">{selectedGlossary.detail}</div>
                <div className="gh-chip-stack">
                  <span className="gh-chip">{selectedGlossary.status}</span>
                  <span className="gh-chip gh-chip-soft">{selectedGlossary.subtitle}</span>
                  <span className="gh-chip gh-chip-soft">{selectedGlossary.ownerEmail}</span>
                </div>
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Linked assets</div>
                  {selectedGlossary.assets?.length ? (
                    <div className="gh-chip-stack">
                      {selectedGlossary.assets.map((assetFqn) => (
                        <button
                          className="gh-filter-chip gh-chip-soft"
                          key={assetFqn}
                          onClick={() => focusAsset(assetFqn)}
                          type="button"
                        >
                          {assetFqn.split(".").slice(-2).join(" / ")}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="gh-empty-state">
                      No linked assets are surfaced for this term yet.
                      <div className="gh-action-grid">
                        <button
                          className="gh-secondary-button"
                          onClick={() => {
                            setMode("stewardship");
                            setAssetSearchQuery(selectedGlossary.title);
                          }}
                          type="button"
                        >
                          Search matching assets
                        </button>
                        <button className="gh-secondary-button" onClick={() => setMode("stewardship")} type="button">
                          Open stewardship
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                {selectedGlossary.assets?.length ? (
                  <div className="gh-action-grid">
                    <button
                      className="gh-primary-button"
                      onClick={() => focusAsset(selectedGlossary.assets[0])}
                      type="button"
                    >
                      Focus linked asset
                    </button>
                    <button
                      className="gh-secondary-button"
                      onClick={() => onOpenLineage(selectedGlossary.assets[0], "Data Lineage")}
                      type="button"
                    >
                      Open lineage
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="gh-empty-state">Select a glossary term to inspect its definition.</div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
