import { useEffect, useMemo, useRef, useState } from "react";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";

function governanceViews(governance) {
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

function stewardshipLanes(actionTrack, requestCount = 0) {
  const incomplete = actionTrack.filter((item) => !item.complete);
  return [
    { key: "open-work", label: "Open work", count: requestCount },
    { key: "ownership", label: "Ownership gaps", count: incomplete.filter((item) => item.label === "Owners").length },
    {
      key: "classification",
      label: "Classification gaps",
      count: incomplete.filter((item) => item.label === "Sensitivity").length,
    },
    {
      key: "trust",
      label: "Trust gaps",
      count: incomplete.filter((item) =>
        item.label === "Certification" || item.label === "Domain" || item.label === "Tier"
      ).length,
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
  const [mode, setMode] = useState("stewardship");
  const [selectedWorkId, setSelectedWorkId] = useState("");
  const [selectedGlossaryId, setSelectedGlossaryId] = useState("");
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [glossaryCollection, setGlossaryCollection] = useState("All terms");
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const assetSearch = useAssetSearch(assetSearchQuery, assetSearchQuery.trim().length >= 2);
  const focusCommandRef = useRef(null);

  useEffect(() => {
    const nextAssetFqn = initialAssetFqn || "";
    setFocusedAssetFqn(nextAssetFqn);
  }, [initialAssetFqn]);

  const focusAsset = (assetFqn, options = {}) => {
    const { preserveWork = false, preserveGlossary = false, syncRoute = false } = options;
    setFocusedAssetFqn(assetFqn || "");
    setAssetSearchQuery("");
    setSelectedWorkId((current) => (preserveWork ? current : ""));
    setSelectedGlossaryId((current) => (preserveGlossary ? current : ""));
    if (syncRoute) {
      onRouteAssetChange?.(assetFqn || "");
    }
  };

  const focusedAssetUnavailable = Boolean(focusedAssetFqn && assetDetail.error && !focusedAsset);
  const focusedAssetLimited = Boolean(focusedAssetFqn && assetDetail.error);

  const assetScopedRequests = focusedAssetFqn
    ? focusedAsset
      ? views.requests.filter((item) => item.assetFqn === focusedAsset.fqn)
      : focusedAssetUnavailable
        ? views.requests.filter((item) => item.assetFqn === focusedAssetFqn)
        : []
    : views.requests;
  const assetScopedEmpty =
    Boolean(focusedAssetFqn) && !assetScopedRequests.length;
  const workItems = assetScopedEmpty ? [] : assetScopedRequests;
  const selectedItem = workItems.find((item) => item.id === selectedWorkId) || null;
  const actionTrack = governanceActionTrack(focusedAsset);
  const laneSummary = stewardshipLanes(actionTrack, assetScopedRequests.length);
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
  const selectedGlossary = glossaryItems.find((item) => item.id === selectedGlossaryId) || null;
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
    setSelectedWorkId((current) => (workItems.some((item) => item.id === current) ? current : ""));
  }, [workItems]);

  useEffect(() => {
    setSelectedGlossaryId((current) => (glossaryItems.some((item) => item.id === current) ? current : ""));
  }, [glossaryItems]);

  useEffect(() => {
    if (glossaryCollectionsList.some((item) => item.key === glossaryCollection)) return;
    setGlossaryCollection("All terms");
  }, [glossaryCollection, glossaryCollectionsList]);

  useEffect(() => {
    if (!assetSearchQuery.trim()) return undefined;
    const onPointerDown = (event) => {
      if (!focusCommandRef.current?.contains(event.target)) {
        setAssetSearchQuery("");
      }
    };
    const onFocusIn = (event) => {
      if (!focusCommandRef.current?.contains(event.target)) {
        setAssetSearchQuery("");
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setAssetSearchQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [assetSearchQuery]);

  return (
    <section className="gh-governance-shell">
      <header className="gh-panel gh-governance-strip">
        <div className="gh-governance-strip-main">
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
          {focusedAsset ? (
            <div className="gh-governance-strip-context">Focused asset · {focusedAsset.name}</div>
          ) : focusedAssetLimited ? (
            <div className="gh-governance-strip-context">Focused asset · Live detail limited</div>
          ) : null}
        </div>
        <div className="gh-governance-strip-tools">
          <div className="gh-governance-focus-command" ref={focusCommandRef}>
            <input
              className="gh-input"
              onChange={(event) => setAssetSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter"
                  && !assetSearch.loading
                  && assetSearch.resolvedQuery === assetSearchQuery.trim()
                  && assetSearch.assets[0]
                ) {
                  event.preventDefault();
                  focusAsset(assetSearch.assets[0].fqn);
                }
              }}
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
            <button
              className="gh-secondary-button"
              onClick={() => focusAsset("", { preserveWork: false, preserveGlossary: false })}
              type="button"
            >
              Clear focus
            </button>
          ) : null}
        </div>
      </header>

      {mode === "stewardship" ? (
        <div className="gh-governance-flow-grid">
          {focusedAssetFqn ? (
            <div className="gh-governance-workbench gh-governance-workbench-single">
              <section className="gh-panel gh-governance-main-pane gh-governance-main-pane-dense">
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Stewardship lanes</div>
                  <div className="gh-summary-grid gh-summary-grid-tight">
                    {laneSummary.map((lane) => (
                      <div className="gh-stat-card" key={lane.key}>
                        <span className="gh-stat-label">{lane.label}</span>
                        <span className="gh-stat-value">{lane.count}</span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="gh-detail-section">
                  <div className="gh-governance-worklist-head">
                    <div className="gh-panel-title">Active work</div>
                    <span className="gh-chip gh-chip-soft">
                      {focusedAssetUnavailable ? "Access limited" : `${workItems.length} visible`}
                    </span>
                  </div>
                  {focusedAssetUnavailable ? (
                    <div className="gh-empty-state">
                      The focused asset is unavailable with the current permissions.
                    </div>
                  ) : workItems.length ? (
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
                {selectedItem ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Selected work</div>
                    <h2>{selectedItem.title}</h2>
                    <div className="gh-support-copy">{selectedItem.subtitle}</div>
                    <div className="gh-chip-stack">
                      <span className="gh-chip">{selectedItem.status}</span>
                    </div>
                    <div className="gh-support-copy">{selectedItem.detail}</div>
                    {selectedItem.assetFqn ? (
                      <div className="gh-action-grid">
                        <button
                          className="gh-primary-button"
                          onClick={() => focusAsset(selectedItem.assetFqn, { preserveWork: true })}
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
                  </section>
                ) : null}

                {focusedAssetUnavailable ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Focused asset</div>
                    <div className="gh-empty-state">
                      <div>The focused asset cannot be inspected with the current permissions.</div>
                      <div className="gh-action-grid">
                        <button
                          className="gh-secondary-button"
                          onClick={() => focusAsset("", { preserveWork: false, preserveGlossary: false })}
                          type="button"
                        >
                          Return to open work
                        </button>
                      </div>
                    </div>
                  </section>
                ) : focusedAsset ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Focused asset</div>
                    {focusedAssetLimited ? (
                      <div className="gh-support-copy">
                        Live detail is limited for this asset, but linked work can still be reviewed.
                      </div>
                    ) : null}
                    <div className="gh-governance-focus-header">
                      <div>
                        <h2>{focusedAsset.name}</h2>
                        <div className="gh-support-copy">
                          {focusedAsset.catalog} / {focusedAsset.schema}
                        </div>
                      </div>
                      <div className="gh-chip-row">
                        <span className="gh-chip gh-chip-soft">{focusedAsset.objectType}</span>
                        <span className="gh-chip">{focusedAsset.governanceStatus || "Needs Work"}</span>
                      </div>
                    </div>
                    {!focusedAssetLimited ? <AttributeList items={focusedAssetAttributes.slice(0, 4)} /> : null}
                    <div className="gh-task-list gh-task-list-compact">
                      {actionTrack.slice(0, 4).map((item) => (
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
                      {focusedAssetLimited ? (
                        <button
                          className="gh-secondary-button"
                          onClick={() => focusAsset("", { preserveWork: false, preserveGlossary: false })}
                          type="button"
                        >
                          Return to open work
                        </button>
                      ) : null}
                    </div>

                    {linkedGlossary.length ? (
                      <div className="gh-detail-section">
                        <div className="gh-panel-title">Linked glossary</div>
                        <div className="gh-governance-linked-list">
                          {linkedGlossary.map((item) => (
                            <div className="gh-governance-linked-row" key={item.id}>
                              <button
                                className="gh-filter-chip gh-chip-soft"
                                onClick={() => {
                                  setMode("glossary");
                                  setSelectedWorkId("");
                                  setSelectedGlossaryId(item.id);
                                }}
                                type="button"
                              >
                                {item.title}
                              </button>
                              <div className="gh-chip-row">
                                <span className="gh-support-copy">{item.subtitle}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <div className="gh-empty-state">
                    Select a stewardship item to inspect its details.
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="gh-governance-workbench gh-governance-workbench-single">
              <section className="gh-panel gh-governance-main-pane gh-governance-main-pane-dense">
                <div className="gh-governance-worklist-head">
                  <div className="gh-panel-title">Stewardship lanes</div>
                </div>
                <div className="gh-summary-grid gh-summary-grid-tight">
                  {[
                    { key: "open-work", label: "Open work", count: views.requests.length },
                    { key: "glossary", label: "Glossary terms", count: views.glossary.length },
                  ].map((lane) => (
                    <div className="gh-stat-card" key={lane.key}>
                      <span className="gh-stat-label">{lane.label}</span>
                      <span className="gh-stat-value">{lane.count}</span>
                    </div>
                  ))}
                </div>
                {views.requests.length ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Open work</div>
                    <div className="gh-request-list">
                      {views.requests.map((item) => (
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
                  </section>
                ) : null}
                {selectedItem ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Selected work</div>
                    <h2>{selectedItem.title}</h2>
                    <div className="gh-support-copy">{selectedItem.subtitle}</div>
                    <div className="gh-chip-row">
                      <span className="gh-chip gh-chip-soft">{selectedItem.status}</span>
                    </div>
                    <div className="gh-support-copy">{selectedItem.detail}</div>
                    {selectedItem.assetFqn ? (
                      <div className="gh-action-grid">
                        <button
                          className="gh-primary-button"
                          onClick={() => focusAsset(selectedItem.assetFqn, { preserveWork: true })}
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
                  </section>
                ) : null}
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Glossary activity</div>
                  <div className="gh-support-copy">
                    Recent linked terms and metadata definitions that need attention.
                  </div>
                {views.glossary.length ? (
                  <div className="gh-request-list">
                    {views.glossary.slice(0, 8).map((item) => (
                      <button
                        className={`gh-request-card gh-request-row ${selectedGlossary?.id === item.id ? "is-active" : ""}`}
                        key={item.id}
                        onClick={() => {
                          setMode("glossary");
                          setSelectedWorkId("");
                          setSelectedGlossaryId(item.id);
                        }}
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
                  <div className="gh-empty-state">No glossary terms are surfaced yet.</div>
                )}
                </section>
              </section>
            </div>
          )}
        </div>
      ) : (
        <div className="gh-governance-workbench gh-governance-workbench-single gh-governance-glossary-workbench">
          <section className="gh-panel gh-governance-main-pane gh-governance-main-pane-dense">
            <div className="gh-governance-glossary-toolbar">
              <input
                className="gh-input"
                onChange={(event) => setGlossaryQuery(event.target.value)}
                placeholder="Search terms, definitions, or domains"
                value={glossaryQuery}
              />
              <div className="gh-chip-stack">
                {glossaryCollectionsList.map((collection) => (
                  <button
                    className={`gh-filter-chip ${glossaryCollection === collection.key ? "is-active" : ""}`}
                    key={collection.key}
                    onClick={() => setGlossaryCollection(collection.key)}
                    type="button"
                  >
                    {collection.label} ({collection.count})
                  </button>
                ))}
              </div>
            </div>
            {selectedGlossary ? (
              <section className="gh-detail-section">
                <div className="gh-panel-title">Selected term</div>
                <div className="gh-governance-focus-header">
                  <div>
                    <h2>{selectedGlossary.title}</h2>
                    <div className="gh-support-copy">{selectedGlossary.detail}</div>
                  </div>
                  <div className="gh-chip-row">
                    <span className="gh-chip">{selectedGlossary.status}</span>
                    <span className="gh-chip gh-chip-soft">{selectedGlossary.subtitle}</span>
                    <span className="gh-chip gh-chip-soft">{selectedGlossary.ownerEmail}</span>
                  </div>
                </div>
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Linked assets</div>
                  {selectedGlossary.assets?.length ? (
                    <div className="gh-governance-linked-list">
                      {selectedGlossary.assets.map((assetFqn) => (
                        <div className="gh-governance-linked-row" key={assetFqn}>
                          <button
                            className="gh-filter-chip gh-chip-soft"
                            onClick={() => {
                              setMode("stewardship");
                              focusAsset(assetFqn);
                            }}
                            type="button"
                          >
                            {assetFqn.split(".").slice(-2).join(" / ")}
                          </button>
                          <button
                            className="gh-secondary-button gh-inline-action"
                            onClick={() => onOpenAsset(assetFqn)}
                            type="button"
                          >
                            Open asset
                          </button>
                        </div>
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
                          Open workbench
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                {selectedGlossary.assets?.length ? (
                  <div className="gh-action-grid">
                    <button
                      className="gh-primary-button"
                      onClick={() => {
                        setMode("stewardship");
                        focusAsset(selectedGlossary.assets[0]);
                      }}
                      type="button"
                    >
                      Open workbench
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
              </section>
            ) : null}
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
                    <div className="gh-support-copy">{item.detail}</div>
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
          </section>
        </div>
      )}
    </section>
  );
}
