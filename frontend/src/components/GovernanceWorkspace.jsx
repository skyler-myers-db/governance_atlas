import { useEffect, useMemo, useRef, useState } from "react";
import {
  canOpenAssetRecord,
  prefetchAssetAvailability,
  prefetchAssetDetail,
  primeAssetDetail,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { clearAssetSearchCache, useAssetSearch } from "../hooks/useAssetSearch";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import {
  createGovernanceRequest,
  updateGovernanceGlossaryTerm,
  updateGovernanceRequest,
  upsertGovernanceGlossaryTerm,
  upsertGovernanceOwner,
} from "../lib/api";

function governanceIdentityPrefix(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requestIdentity(item, index) {
  const requestId = String(item?.requestId || "").trim();
  if (requestId) return requestId;
  const basis = [item?.assetFqn || item?.asset || "", item?.title || "", item?.status || ""]
    .map((value) => governanceIdentityPrefix(value))
    .filter(Boolean)
    .join("-");
  return basis ? `request-${basis}` : `request-${index}`;
}

function glossaryIdentity(item, index) {
  const termId = String(item?.termId || "").trim();
  if (termId) return termId;
  const basis = [item?.title || "", item?.subtitle || ""]
    .map((value) => governanceIdentityPrefix(value))
    .filter(Boolean)
    .join("-");
  return basis ? `glossary-${basis}` : `glossary-${index}`;
}

function governanceViews(governance) {
  const backlog = governance?.backlog || [];
  const glossary = governance?.glossary || [];

  return {
    requests: backlog.map((item, index) => ({
      id: requestIdentity(item, index),
      requestId: item.requestId || "",
      title: item.title,
      subtitle: item.asset,
      assetFqn: item.assetFqn || item.asset,
      status: item.status,
      detail: item.note,
      createdAt: item.createdAt || "",
      createdBy: item.createdBy || "",
      reviewedAt: item.reviewedAt || "",
      reviewedBy: item.reviewedBy || "",
      reviewNote: item.reviewNote || "",
    })),
    glossary: glossary.map((item, index) => ({
      id: glossaryIdentity(item, index),
      termId: item.termId,
      title: item.term,
      subtitle: item.domain || "Unassigned",
      status: item.status || "Draft",
      detail: item.definition,
      ownerEmail: item.ownerEmail || "Unassigned",
      assetCount: item.assetCount || 0,
      assets: item.assets || [],
      createdAt: item.createdAt || "",
      createdBy: item.createdBy || "",
      updatedAt: item.updatedAt || "",
      updatedBy: item.updatedBy || "",
      requestCount: item.requestCount || 0,
      pendingRequestCount: item.pendingRequestCount || 0,
      approvedRequestCount: item.approvedRequestCount || 0,
      rejectedRequestCount: item.rejectedRequestCount || 0,
      reviewers: item.reviewers || [],
      assetPreview: item.assetPreview || [],
      recentRequests: item.recentRequests || [],
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

function requestLane(item) {
  const text = `${item.title || ""} ${item.subtitle || ""} ${item.detail || ""} ${item.status || ""}`.toLowerCase();
  if (text.includes("owner")) return "ownership";
  if (text.includes("cert") || text.includes("classif") || text.includes("sensit") || text.includes("privacy")) {
    return "classification";
  }
  if (text.includes("domain") || text.includes("tier") || text.includes("trust")) return "trust";
  return "open-work";
}

function stewardshipLanes(actionTrack, requests = []) {
  const incomplete = actionTrack.filter((item) => !item.complete);
  const laneCounts = requests.reduce(
    (acc, item) => {
      const lane = requestLane(item);
      acc[lane] = (acc[lane] || 0) + 1;
      return acc;
    },
    { "open-work": 0, ownership: 0, classification: 0, trust: 0 }
  );
  return [
    { key: "open-work", label: "Open work", count: laneCounts["open-work"] },
    { key: "ownership", label: "Ownership gaps", count: Math.max(laneCounts.ownership, incomplete.filter((item) => item.label === "Owners").length) },
    {
      key: "classification",
      label: "Classification gaps",
      count: Math.max(laneCounts.classification, incomplete.filter((item) => item.label === "Sensitivity").length),
    },
    {
      key: "trust",
      label: "Trust gaps",
      count: Math.max(
        laneCounts.trust,
        incomplete.filter((item) => item.label === "Certification" || item.label === "Domain" || item.label === "Tier").length
      ),
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
  contextSeedAssets = [],
  governance,
  onGovernanceChange,
  onRouteAssetChange,
  onOpenAsset,
  onOpenLineage,
}) {
  const [focusedAssetFqn, setFocusedAssetFqn] = useState(initialAssetFqn || "");
  const [liveGovernance, setLiveGovernance] = useState(governance);
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const seeded = useSeededAssetContext(focusedAssetFqn, bootstrap, seedAssets);
  const assetDetail = useAssetDetail(focusedAssetFqn || "", { sections: ["header", "activity"] });
  const [focusedAssetSnapshot, setFocusedAssetSnapshot] = useState(null);
  const focusedAsset = focusedAssetSnapshot || assetDetail.detail || seeded.summary;
  const views = useMemo(() => governanceViews(liveGovernance), [liveGovernance]);
  const [mode, setMode] = useState("stewardship");
  const [selectedLaneKey, setSelectedLaneKey] = useState("open-work");
  const [selectedWorkId, setSelectedWorkId] = useState("");
  const [selectedGlossaryId, setSelectedGlossaryId] = useState("");
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [glossaryCollection, setGlossaryCollection] = useState("All terms");
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [requestTitle, setRequestTitle] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [glossaryName, setGlossaryName] = useState("");
  const [glossaryDefinition, setGlossaryDefinition] = useState("");
  const [glossaryDomain, setGlossaryDomain] = useState("");
  const [glossaryOwnerEmail, setGlossaryOwnerEmail] = useState("");
  const [glossaryStatus, setGlossaryStatus] = useState("draft");
  const [glossaryDraft, setGlossaryDraft] = useState({
    name: "",
    definition: "",
    domain: "",
    ownerEmail: "",
    status: "draft",
  });
  const [mutationState, setMutationState] = useState({
    kind: "",
    loading: false,
    error: "",
    success: "",
  });
  const assetSearch = useAssetSearch(
    assetSearchQuery,
    assetSearchQuery.trim().length >= 2,
    seedAssets,
  );
  const focusCommandRef = useRef(null);

  useEffect(() => {
    const nextAssetFqn = initialAssetFqn || "";
    setFocusedAssetFqn(nextAssetFqn);
  }, [initialAssetFqn]);

  useEffect(() => {
    setFocusedAssetSnapshot(null);
  }, [focusedAssetFqn]);

  useEffect(() => {
    if (assetDetail.detail?.fqn && assetDetail.detail?.fqn === focusedAssetFqn) {
      setFocusedAssetSnapshot(assetDetail.detail);
    }
  }, [assetDetail.detail, focusedAssetFqn]);

  useEffect(() => {
    setLiveGovernance(governance);
  }, [governance]);

  const focusAsset = (assetFqn, options = {}) => {
    const { preserveWork = false, preserveGlossary = false, preserveLane = false, syncRoute = false } = options;
    setFocusedAssetFqn(assetFqn || "");
    setAssetSearchQuery("");
    setSelectedWorkId((current) => (preserveWork ? current : ""));
    setSelectedGlossaryId((current) => (preserveGlossary ? current : ""));
    setSelectedLaneKey((current) => (preserveLane ? current : "open-work"));
    setMutationState({ kind: "", loading: false, error: "", success: "" });
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
  const visibleWorkItems = useMemo(() => {
    if (selectedLaneKey === "open-work") return workItems;
    return workItems.filter((item) => requestLane(item) === selectedLaneKey);
  }, [selectedLaneKey, workItems]);
  const selectedItem = visibleWorkItems.find((item) => item.id === selectedWorkId) || null;
  const actionTrack = governanceActionTrack(focusedAsset);
  const laneSummary = stewardshipLanes(actionTrack, workItems);
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
  const selectedGlossaryRequests = selectedGlossary?.recentRequests || [];
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
  const selectedGlossaryAttributes = selectedGlossary
    ? [
        { label: "Domain", value: selectedGlossary.subtitle || "Unassigned" },
        { label: "Owner", value: selectedGlossary.ownerEmail || "Unassigned" },
        { label: "Status", value: selectedGlossary.status || "Draft" },
        { label: "Assets", value: `${selectedGlossary.assetCount || 0}` },
        { label: "Requests", value: `${selectedGlossary.requestCount || 0}` },
        { label: "Reviewers", value: `${selectedGlossary.reviewers?.length || 0}` },
        { label: "Created", value: selectedGlossary.createdAt || "—" },
        { label: "Updated", value: selectedGlossary.updatedAt || "—" },
      ]
    : [];

  useEffect(() => {
    setSelectedWorkId((current) => {
      if (visibleWorkItems.some((item) => item.id === current)) return current;
      return "";
    });
  }, [visibleWorkItems]);

  useEffect(() => {
    setSelectedGlossaryId((current) => {
      if (glossaryItems.some((item) => item.id === current)) return current;
      return "";
    });
  }, [glossaryItems]);

  useEffect(() => {
    if (glossaryCollectionsList.some((item) => item.key === glossaryCollection)) return;
    setGlossaryCollection("All terms");
  }, [glossaryCollection, glossaryCollectionsList]);

  useEffect(() => {
    if (!selectedGlossary) {
      setGlossaryDraft({
        name: "",
        definition: "",
        domain: "",
        ownerEmail: "",
        status: "draft",
      });
      return;
    }
    setGlossaryDraft({
      name: selectedGlossary.title || "",
      definition: selectedGlossary.detail || "",
      domain: selectedGlossary.subtitle || "",
      ownerEmail: selectedGlossary.ownerEmail && selectedGlossary.ownerEmail !== "Unassigned" ? selectedGlossary.ownerEmail : "",
      status: String(selectedGlossary.status || "draft").toLowerCase(),
    });
  }, [selectedGlossary]);

  useEffect(() => {
    if (!assetSearchQuery.trim()) return undefined;
    const onPointerDown = (event) => {
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
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [assetSearchQuery]);

  useEffect(() => {
    setOwnerEmail("");
    setRequestTitle("");
    setRequestNote("");
    setGlossaryName("");
    setGlossaryDefinition("");
    setGlossaryDomain("");
    setGlossaryOwnerEmail("");
    setGlossaryStatus("draft");
    setMutationState({ kind: "", loading: false, error: "", success: "" });
  }, [focusedAssetFqn]);

  const runGovernanceMutation = async (kind, executor, success) => {
    setMutationState({ kind, loading: true, error: "", success: "" });
    try {
      const next = await executor();
      if (next?.asset?.fqn) {
        primeAssetDetail(next.asset.fqn, next.asset);
        if (next.asset.fqn === focusedAssetFqn) {
          setFocusedAssetSnapshot(next.asset);
        }
      }
      clearAssetSearchCache();
      const nextGovernance = next?.governance || next;
      setLiveGovernance(nextGovernance);
      onGovernanceChange?.(nextGovernance);
      setMutationState({ kind, loading: false, error: "", success });
      return next;
    } catch (error) {
      setMutationState({
        kind,
        loading: false,
        error: error?.message || "Unable to update governance right now.",
        success: "",
      });
      throw error;
    }
  };

  const openAssetSafely = async (assetFqn) => {
    if (!assetFqn) return;
    try {
      const [availabilityMap, detail] = await Promise.all([
        prefetchAssetAvailability([assetFqn], { force: true }),
        prefetchAssetDetail(assetFqn, {
          force: true,
          sections: ["header", "activity"],
        }),
      ]);
      const availability = availabilityMap?.[assetFqn] || null;
      if (!canOpenAssetRecord(detail, availability)) return;
      onOpenAsset(assetFqn);
    } catch {
      return;
    }
  };

  const saveSelectedGlossaryTerm = async () => {
    if (!selectedGlossary?.termId) return;
    await runGovernanceMutation(
      "glossary-update",
      () =>
        updateGovernanceGlossaryTerm(selectedGlossary.termId, {
          termId: selectedGlossary.termId,
          name: glossaryDraft.name.trim(),
          definition: glossaryDraft.definition.trim(),
          domain: glossaryDraft.domain.trim(),
          ownerEmail: glossaryDraft.ownerEmail.trim(),
          status: String(glossaryDraft.status || "draft").trim().toLowerCase() || "draft",
        }),
      "Glossary term updated.",
    );
  };

  return (
    <section className="gh-governance-shell">
      <header className="gh-governance-toolbar">
        <div className="gh-governance-toolbar-main">
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
            <span className="gh-chip gh-chip-soft">{focusedAsset.name}</span>
          ) : focusedAssetLimited ? (
            <span className="gh-chip gh-chip-soft">Live detail limited</span>
          ) : null}
        </div>
        <div className="gh-governance-toolbar-tools">
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
                  focusAsset(assetSearch.assets[0].fqn, { syncRoute: true });
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
                      onClick={() => focusAsset(asset.fqn, { syncRoute: true })}
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
              onClick={() => focusAsset("", { preserveWork: false, preserveGlossary: false, syncRoute: true })}
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
                  <div className="gh-governance-section-head">
                    <div>
                      <div className="gh-panel-title">Stewardship lanes</div>
                    </div>
                    <span className="gh-chip gh-chip-soft">{visibleWorkItems.length} visible</span>
                  </div>
                  <div className="gh-governance-lane-rail">
                    {laneSummary.map((lane) => (
                      <button
                        className={`gh-governance-lane-chip ${selectedLaneKey === lane.key ? "is-active" : ""}`}
                        key={lane.key}
                        onClick={() => setSelectedLaneKey(lane.key)}
                        type="button"
                      >
                        <span>{lane.label}</span>
                        <strong>{lane.count}</strong>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="gh-detail-section">
                  <div className="gh-governance-worklist-head">
                    <div className="gh-panel-title">Active work</div>
                    <span className="gh-chip gh-chip-soft">
                      {focusedAssetUnavailable ? "Access limited" : `${visibleWorkItems.length} visible`}
                    </span>
                  </div>
                  {focusedAssetUnavailable ? (
                    <div className="gh-empty-state">
                      The focused asset is unavailable with the current permissions.
                    </div>
                  ) : visibleWorkItems.length ? (
                    <div className="gh-request-list gh-request-list-dense">
                      {visibleWorkItems.map((item) => (
                        <button
                          className={`gh-request-card gh-request-row ${selectedItem?.id === item.id ? "is-active" : ""}`}
                          key={item.id}
                          onClick={() => setSelectedWorkId(item.id)}
                          type="button"
                        >
                          <div className="gh-request-card-topline">
                            <div>
                              <div className="gh-request-title">{item.title}</div>
                              <div className="gh-request-meta">{item.subtitle}</div>
                            </div>
                            <div className="gh-chip-row">
                              <span className="gh-chip gh-chip-soft">{requestLane(item).replace("-", " ")}</span>
                              <span className="gh-chip gh-chip-soft">{item.status}</span>
                            </div>
                          </div>
                          <div className="gh-support-copy">{item.detail}</div>
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
                      <div className="gh-governance-section-head">
                        <div>
                          <div className="gh-panel-title">Selected work</div>
                        </div>
                        <span className="gh-chip gh-chip-soft">{selectedItem.status}</span>
                      </div>
                    <h2>{selectedItem.title}</h2>
                    <div className="gh-support-copy">{selectedItem.subtitle}</div>
                    <div className="gh-support-copy">{selectedItem.detail}</div>
                    <div className="gh-chip-row">
                      {selectedItem.createdAt ? <span className="gh-chip gh-chip-soft">Created {selectedItem.createdAt}</span> : null}
                      {selectedItem.createdBy ? <span className="gh-chip gh-chip-soft">By {selectedItem.createdBy}</span> : null}
                      {selectedItem.reviewedAt ? <span className="gh-chip gh-chip-soft">Reviewed {selectedItem.reviewedAt}</span> : null}
                      {selectedItem.reviewedBy ? <span className="gh-chip gh-chip-soft">By {selectedItem.reviewedBy}</span> : null}
                    </div>
                    {selectedItem.reviewNote ? (
                      <div className="gh-support-copy">{selectedItem.reviewNote}</div>
                    ) : null}
                    {selectedItem.assetFqn ? (
                      <div className="gh-action-grid">
                        <button
                          className="gh-primary-button"
                          onClick={() =>
                            focusAsset(selectedItem.assetFqn, {
                              preserveWork: true,
                              preserveLane: true,
                              syncRoute: true,
                            })
                          }
                          type="button"
                        >
                          Focus here
                        </button>
                        <button
                          className="gh-secondary-button"
                          onClick={() => openAssetSafely(selectedItem.assetFqn)}
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
              </section>

              <aside className="gh-panel gh-governance-side-pane gh-governance-side-pane-dense">
                {focusedAssetFqn ? (
                  <section className="gh-detail-section">
                    <div className="gh-governance-section-head">
                      <div>
                        <div className="gh-panel-title">Stewardship actions</div>
                        {focusedAsset ? (
                          <div className="gh-support-copy">
                            {focusedAsset.name} · {focusedAsset.catalog} / {focusedAsset.schema}
                          </div>
                        ) : focusedAssetUnavailable ? (
                          <div className="gh-support-copy">Focused asset unavailable with current permissions.</div>
                        ) : null}
                      </div>
                      {mutationState.loading ? (
                        <span className="gh-chip gh-chip-soft">Saving…</span>
                      ) : mutationState.success ? (
                        <span className="gh-chip gh-chip-soft">Updated</span>
                      ) : null}
                    </div>
                    {mutationState.error ? (
                      <div className="gh-inline-alert tone-warn">
                        <div>{mutationState.error}</div>
                      </div>
                    ) : null}
                    {mutationState.success ? (
                      <div className="gh-support-copy gh-success-copy">{mutationState.success}</div>
                    ) : null}
                    <div className="gh-task-list gh-task-list-compact">
                      {actionTrack.slice(0, 4).map((item) => (
                        <button
                          className={`gh-task-card ${item.complete ? "is-complete" : ""}`}
                          key={item.label}
                          onClick={() => {
                            if (item.label === "Owners") setSelectedLaneKey("ownership");
                            if (item.label === "Sensitivity") setSelectedLaneKey("classification");
                            if (item.label === "Certification" || item.label === "Domain" || item.label === "Tier") {
                              setSelectedLaneKey("trust");
                            }
                          }}
                          type="button"
                        >
                          <div className="gh-task-card-head">
                            <span className={`gh-status-chip tone-${item.complete ? "good" : "bad"}`}>
                              {item.complete ? "Ready" : "Needs work"}
                            </span>
                            <span className="gh-task-value">{item.value}</span>
                          </div>
                          <div className="gh-task-title">{item.label}</div>
                          <div className="gh-support-copy">{item.note}</div>
                        </button>
                      ))}
                    </div>
                    <div className="gh-form-stack">
                      <div className="gh-form-block gh-form-block-compact">
                        <div className="gh-panel-title">Assign owner</div>
                        <div className="gh-form-inline">
                          <input
                            className="gh-input"
                            onChange={(event) => setOwnerEmail(event.target.value)}
                            placeholder="Assign owner email"
                            value={ownerEmail}
                          />
                          <button
                            className="gh-secondary-button gh-secondary-button-compact"
                            disabled={!ownerEmail.trim() || mutationState.loading}
                            onClick={() =>
                              runGovernanceMutation(
                                "owner",
                                () =>
                                  upsertGovernanceOwner({
                                    assetFqn: focusedAssetFqn,
                                    ownerEmail: ownerEmail.trim(),
                                    ownerType: "business",
                                  }),
                                "Owner assignment saved.",
                              ).then(() => setOwnerEmail(""))
                            }
                            type="button"
                          >
                            Save owner
                          </button>
                        </div>
                      </div>
                      <div className="gh-form-block gh-form-block-compact">
                        <div className="gh-panel-title">Create request</div>
                        <div className="gh-form-inline gh-form-inline-stacked">
                          <input
                            className="gh-input"
                            onChange={(event) => setRequestTitle(event.target.value)}
                            placeholder="Request title"
                            value={requestTitle}
                          />
                          <textarea
                            className="gh-input gh-textarea"
                            onChange={(event) => setRequestNote(event.target.value)}
                            placeholder="Optional note"
                            rows={3}
                            value={requestNote}
                          />
                          <button
                            className="gh-secondary-button gh-secondary-button-compact"
                            disabled={!requestTitle.trim() || mutationState.loading}
                            onClick={() =>
                              runGovernanceMutation(
                                "request",
                                () =>
                                  createGovernanceRequest({
                                    assetFqn: focusedAssetFqn,
                                    title: requestTitle.trim(),
                                    note: requestNote.trim(),
                                  }),
                                "Governance request created.",
                              ).then(() => {
                                setRequestTitle("");
                                setRequestNote("");
                              })
                            }
                            type="button"
                          >
                            Create request
                          </button>
                        </div>
                      </div>
                      <div className="gh-form-block gh-form-block-compact">
                        <div className="gh-panel-title">Create glossary term</div>
                        <div className="gh-form-inline gh-form-inline-stacked">
                          <input
                            className="gh-input"
                            onChange={(event) => setGlossaryName(event.target.value)}
                            placeholder="Term name"
                            value={glossaryName}
                          />
                          <textarea
                            className="gh-input gh-textarea"
                            onChange={(event) => setGlossaryDefinition(event.target.value)}
                            placeholder="Definition"
                            rows={3}
                            value={glossaryDefinition}
                          />
                          <div className="gh-form-inline">
                            <input
                              className="gh-input"
                              onChange={(event) => setGlossaryDomain(event.target.value)}
                              placeholder="Domain"
                              value={glossaryDomain}
                            />
                            <input
                              className="gh-input"
                              onChange={(event) => setGlossaryOwnerEmail(event.target.value)}
                              placeholder="Owner email"
                              value={glossaryOwnerEmail}
                            />
                          </div>
                          <input
                            className="gh-input"
                            onChange={(event) => setGlossaryStatus(event.target.value)}
                            placeholder="draft"
                            value={glossaryStatus}
                          />
                          <button
                            className="gh-secondary-button gh-secondary-button-compact"
                            disabled={!glossaryName.trim() || mutationState.loading}
                            onClick={() =>
                              runGovernanceMutation(
                                "glossary",
                                () =>
                                  upsertGovernanceGlossaryTerm({
                                    name: glossaryName.trim(),
                                    definition: glossaryDefinition.trim(),
                                    domain: glossaryDomain.trim(),
                                    ownerEmail: glossaryOwnerEmail.trim(),
                                    status: String(glossaryStatus || "draft").trim().toLowerCase() || "draft",
                                  }),
                                "Glossary term saved.",
                              ).then((next) => {
                                setGlossaryName("");
                                setGlossaryDefinition("");
                                setGlossaryDomain("");
                                setGlossaryOwnerEmail("");
                                setGlossaryStatus("draft");
                                if (next?.termId) {
                                  setMode("glossary");
                                  setSelectedGlossaryId(next.termId);
                                }
                              })
                            }
                            type="button"
                          >
                            Create term
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                <section className="gh-detail-section">
                  <div className="gh-governance-section-head">
                    <div>
                      <div className="gh-panel-title">Linked glossary</div>
                    </div>
                    <span className="gh-chip gh-chip-soft">{linkedGlossary.length} terms</span>
                  </div>
                  {linkedGlossary.length ? (
                    <div className="gh-governance-linked-list">
                      {linkedGlossary.map((item) => (
                        <div className="gh-governance-linked-row" key={item.id}>
                          <button
                            className="gh-filter-chip gh-chip-soft"
                            onClick={() => {
                              setMode("glossary");
                              setSelectedWorkId("");
                              setSelectedGlossaryId(item.id);
                              if (item.assets?.[0]) {
                                focusAsset(item.assets[0], { preserveGlossary: true, syncRoute: true });
                              }
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
                  ) : (
                    <div className="gh-empty-state">
                      No glossary terms are linked to this asset yet.
                    </div>
                  )}
                </section>

                <div className="gh-action-grid">
                  {focusedAsset ? (
                    <>
                      <button className="gh-secondary-button" onClick={() => openAssetSafely(focusedAsset.fqn)} type="button">
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
                          onClick={() => focusAsset("", { preserveWork: false, preserveGlossary: false, syncRoute: true })}
                          type="button"
                        >
                          Return to open work
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </aside>
            </div>
          ) : (
            <div className="gh-governance-workbench">
              <section className="gh-panel gh-governance-main-pane gh-governance-main-pane-dense">
                <section className="gh-detail-section">
                  <div className="gh-governance-section-head">
                    <div>
                      <div className="gh-panel-title">Stewardship lanes</div>
                    </div>
                    <span className="gh-chip gh-chip-soft">{visibleWorkItems.length} visible</span>
                  </div>
                  <div className="gh-governance-lane-rail">
                    {laneSummary.map((lane) => (
                      <button
                        className={`gh-governance-lane-chip ${selectedLaneKey === lane.key ? "is-active" : ""}`}
                        key={lane.key}
                        onClick={() => setSelectedLaneKey(lane.key)}
                        type="button"
                      >
                        <span>{lane.label}</span>
                        <strong>{lane.count}</strong>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="gh-detail-section">
                  <div className="gh-governance-worklist-head">
                    <div className="gh-panel-title">Open work</div>
                    <span className="gh-chip gh-chip-soft">{views.requests.length} requests</span>
                  </div>
                  {views.requests.length ? (
                    visibleWorkItems.length ? (
                      <div className="gh-request-list gh-request-list-dense">
                        {visibleWorkItems.map((item) => (
                          <button
                            className={`gh-request-card gh-request-row ${selectedItem?.id === item.id ? "is-active" : ""}`}
                            key={item.id}
                            onClick={() => setSelectedWorkId(item.id)}
                            type="button"
                          >
                            <div className="gh-request-card-topline">
                              <div>
                                <div className="gh-request-title">{item.title}</div>
                                <div className="gh-request-meta">{item.subtitle}</div>
                              </div>
                              <div className="gh-chip-row">
                                <span className="gh-chip gh-chip-soft">{requestLane(item).replace("-", " ")}</span>
                                <span className="gh-chip gh-chip-soft">{item.status}</span>
                              </div>
                            </div>
                            <div className="gh-support-copy">{item.detail}</div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="gh-empty-state">No items are available in this lane yet.</div>
                    )
                  ) : null}
                </section>
                {selectedItem ? (
                  <section className="gh-detail-section">
                    <div className="gh-governance-section-head">
                      <div>
                        <div className="gh-panel-title">Selected work</div>
                      </div>
                      <span className="gh-chip gh-chip-soft">{selectedItem.status}</span>
                    </div>
                    <h2>{selectedItem.title}</h2>
                    <div className="gh-support-copy">{selectedItem.subtitle}</div>
                    <div className="gh-support-copy">{selectedItem.detail}</div>
                    {selectedItem.assetFqn ? (
                      <div className="gh-action-grid">
                        <button
                          className="gh-primary-button"
                          onClick={() => focusAsset(selectedItem.assetFqn, { preserveWork: true, syncRoute: true })}
                          type="button"
                        >
                          Focus here
                        </button>
                        <button
                          className="gh-secondary-button"
                          onClick={() => openAssetSafely(selectedItem.assetFqn)}
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
                        <button
                          className="gh-secondary-button"
                          disabled={!selectedItem.requestId}
                          onClick={() =>
                            runGovernanceMutation(
                              "request-status",
                              () =>
                                updateGovernanceRequest(selectedItem.requestId, {
                                  status: "approved",
                                  reviewNote: "Approved from governance workbench.",
                                }),
                              "Request approved.",
                            )
                          }
                          type="button"
                        >
                          Approve
                        </button>
                        <button
                          className="gh-secondary-button"
                          disabled={!selectedItem.requestId}
                          onClick={() =>
                            runGovernanceMutation(
                              "request-status",
                              () =>
                                updateGovernanceRequest(selectedItem.requestId, {
                                  status: "rejected",
                                  reviewNote: "Rejected from governance workbench.",
                                }),
                              "Request rejected.",
                            )
                          }
                          type="button"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </section>

              <aside className="gh-panel gh-governance-side-pane gh-governance-side-pane-dense">
                <section className="gh-detail-section">
                  <div className="gh-governance-section-head">
                    <div>
                      <div className="gh-panel-title">Glossary terms</div>
                    </div>
                    <span className="gh-chip gh-chip-soft">{views.glossary.length} terms</span>
                  </div>
                  {views.glossary.length ? (
                    <div className="gh-request-list gh-request-list-dense gh-governance-glossary-list">
                      {views.glossary.slice(0, 6).map((item) => (
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
                          <div className="gh-request-card-topline">
                            <div>
                              <div className="gh-request-title">{item.title}</div>
                              <div className="gh-request-meta">{item.subtitle}</div>
                            </div>
                            <div className="gh-chip-row">
                              <span className="gh-chip gh-chip-soft">{item.status}</span>
                              <span className="gh-chip gh-chip-soft">{item.assetCount} assets</span>
                            </div>
                          </div>
                          <div className="gh-support-copy">{item.detail}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="gh-empty-state">No glossary terms are surfaced yet.</div>
                  )}
                </section>
              </aside>
            </div>
          )}
        </div>
      ) : (
        <div className="gh-governance-workbench gh-governance-glossary-workbench">
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
            <section className="gh-detail-section">
              <div className="gh-governance-section-head">
                <div>
                  <div className="gh-panel-title">Glossary index</div>
                  <div className="gh-support-copy">Terms are grouped by domain and filtered by search.</div>
                </div>
                <span className="gh-chip gh-chip-soft">{glossaryItems.length} visible</span>
              </div>
              {glossaryItems.length ? (
                <div className="gh-request-list gh-request-list-dense gh-governance-glossary-list">
                  {glossaryItems.map((item) => (
                    <button
                      className={`gh-request-card gh-request-row ${selectedGlossary?.id === item.id ? "is-active" : ""}`}
                      key={item.id}
                      onClick={() => setSelectedGlossaryId(item.id)}
                      type="button"
                    >
                      <div className="gh-request-card-topline">
                        <div>
                          <div className="gh-request-title">{item.title}</div>
                          <div className="gh-request-meta">{item.subtitle}</div>
                        </div>
                        <div className="gh-chip-row">
                          <span className="gh-chip gh-chip-soft">{item.status}</span>
                          <span className="gh-chip gh-chip-soft">{item.assetCount} assets</span>
                        </div>
                      </div>
                      <div className="gh-support-copy">{item.detail}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="gh-empty-state">No glossary terms match the current search.</div>
              )}
            </section>
          </section>

          <aside className="gh-panel gh-governance-side-pane gh-governance-side-pane-dense">
            {selectedGlossary ? (
              <section className="gh-detail-section">
                <div className="gh-governance-section-head">
                  <div>
                    <div className="gh-panel-title">Selected term</div>
                  </div>
                  <span className="gh-chip gh-chip-soft">{selectedGlossary.assetCount} assets</span>
                </div>
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
                <AttributeList items={selectedGlossaryAttributes} />
                {selectedGlossary.reviewers?.length ? (
                  <section className="gh-detail-section">
                    <div className="gh-panel-title">Recent reviewers</div>
                    <div className="gh-chip-row">
                      {selectedGlossary.reviewers.map((reviewer) => (
                        <span className="gh-chip gh-chip-soft" key={reviewer}>
                          {reviewer}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Edit term</div>
                  <div className="gh-form-stack">
                    <label className="gh-metadata-edit-field">
                      <span>Term name</span>
                      <input
                        className="gh-input"
                        onChange={(event) => setGlossaryDraft((current) => ({ ...current, name: event.target.value }))}
                        value={glossaryDraft.name}
                      />
                    </label>
                    <label className="gh-metadata-edit-field">
                      <span>Definition</span>
                      <textarea
                        className="gh-input gh-textarea"
                        onChange={(event) =>
                          setGlossaryDraft((current) => ({ ...current, definition: event.target.value }))
                        }
                        rows={4}
                        value={glossaryDraft.definition}
                      />
                    </label>
                    <div className="gh-form-inline">
                      <label className="gh-metadata-edit-field">
                        <span>Domain</span>
                        <input
                          className="gh-input"
                          onChange={(event) =>
                            setGlossaryDraft((current) => ({ ...current, domain: event.target.value }))
                          }
                          value={glossaryDraft.domain}
                        />
                      </label>
                      <label className="gh-metadata-edit-field">
                        <span>Owner email</span>
                        <input
                          className="gh-input"
                          onChange={(event) =>
                            setGlossaryDraft((current) => ({ ...current, ownerEmail: event.target.value }))
                          }
                          value={glossaryDraft.ownerEmail}
                        />
                      </label>
                    </div>
                    <label className="gh-metadata-edit-field">
                      <span>Status</span>
                      <input
                        className="gh-input"
                        onChange={(event) =>
                          setGlossaryDraft((current) => ({ ...current, status: event.target.value }))
                        }
                        placeholder="draft"
                        value={glossaryDraft.status}
                      />
                    </label>
                    {mutationState.error ? (
                      <div className="gh-inline-alert tone-warn">
                        <div>{mutationState.error}</div>
                      </div>
                    ) : null}
                    {mutationState.success && mutationState.kind === "glossary-update" ? (
                      <div className="gh-support-copy gh-success-copy">{mutationState.success}</div>
                    ) : null}
                    <div className="gh-record-form-actions">
                      <button
                        className="gh-primary-button"
                        disabled={!selectedGlossary.termId || mutationState.loading || !glossaryDraft.name.trim()}
                        onClick={saveSelectedGlossaryTerm}
                        type="button"
                      >
                        {mutationState.kind === "glossary-update" && mutationState.loading ? "Saving..." : "Save term"}
                      </button>
                    </div>
                  </div>
                </section>
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Recent activity</div>
                  {selectedGlossaryRequests.length ? (
                    <div className="gh-request-list gh-request-list-dense gh-governance-glossary-list">
                      {selectedGlossaryRequests.map((request) => (
                        <div className="gh-request-card gh-request-row is-readonly" key={request.requestId || request.createdAt || request.title}>
                          <div className="gh-request-card-topline">
                            <div>
                              <div className="gh-request-title">{request.title}</div>
                              <div className="gh-request-meta">
                                {request.createdAt || "Unknown time"} · {request.createdBy || "Unknown author"}
                              </div>
                            </div>
                            <div className="gh-chip-row">
                              <span className="gh-chip gh-chip-soft">{request.status}</span>
                              {request.reviewedBy ? <span className="gh-chip gh-chip-soft">{request.reviewedBy}</span> : null}
                            </div>
                          </div>
                          <div className="gh-support-copy">{request.reviewNote || request.detail}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="gh-empty-state">No recent requests are linked to this term yet.</div>
                  )}
                </section>
                <section className="gh-detail-section">
                  <div className="gh-panel-title">Linked assets</div>
                  {selectedGlossary.assetPreview?.length ? (
                    <div className="gh-governance-linked-list">
                      {selectedGlossary.assetPreview.map((asset) => (
                        <div className="gh-governance-linked-row" key={asset.fqn}>
                          <div>
                            <button
                              className="gh-filter-chip gh-chip-soft"
                              onClick={() => {
                                setMode("stewardship");
                                focusAsset(asset.fqn, { syncRoute: true });
                              }}
                              type="button"
                            >
                              {asset.name || asset.fqn?.split(".").slice(-1)[0]}
                            </button>
                            <div className="gh-support-copy">
                              {asset.catalog} / {asset.schema} · {asset.domain || "Unassigned"} · {asset.tier || "Unassigned"}
                            </div>
                          </div>
                          <div className="gh-chip-row">
                            <span className="gh-chip gh-chip-soft">{asset.governanceStatus || "Needs Work"}</span>
                            <button
                              className="gh-secondary-button gh-inline-action"
                              onClick={() => openAssetSafely(asset.fqn)}
                              type="button"
                            >
                              Open asset
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : selectedGlossary.assets?.length ? (
                    <div className="gh-governance-linked-list">
                      {selectedGlossary.assets.map((assetFqn) => (
                        <div className="gh-governance-linked-row" key={assetFqn}>
                          <button
                            className="gh-filter-chip gh-chip-soft"
                            onClick={() => {
                              setMode("stewardship");
                              focusAsset(assetFqn, { syncRoute: true });
                            }}
                            type="button"
                          >
                            {assetFqn.split(".").slice(-2).join(" / ")}
                          </button>
                          <button
                            className="gh-secondary-button gh-inline-action"
                            onClick={() => openAssetSafely(assetFqn)}
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
                    </div>
                  )}
                </section>
                {selectedGlossary.assets?.length ? (
                  <div className="gh-action-grid">
                    <button
                      className="gh-primary-button"
                      onClick={() => {
                        setMode("stewardship");
                        focusAsset(selectedGlossary.assets[0], { syncRoute: true });
                      }}
                      type="button"
                    >
                      Open stewardship
                    </button>
                  </div>
                ) : null}
              </section>
            ) : (
              <div className="gh-empty-state">Select a glossary term to inspect it.</div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
