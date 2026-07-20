import { useEffect, useMemo, useState } from "react";
import { LineageCanvasV2 } from "./lineage-v2/LineageCanvasV2";
import { useLineageGraphV2 } from "./lineage-v2/useLineageGraphV2";
import { useLineageNodeHeaders } from "./lineage-v2/useLineageNodeHeaders";
import { useAssetDetail } from "../hooks/useAssetDetail";
import { useAssetDatabricksEvidence } from "../hooks/useAssetDatabricksEvidence";
import { useAssetQuality } from "../hooks/useAssetQuality";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useAccessExplain } from "../hooks/useAccessExplain";
import { useColumnLineageTrace } from "../hooks/useColumnLineageTrace";
import { useLineageRecommendations } from "../hooks/useLineageRecommendations";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { assetPathLabel } from "../lib/assetPresentation";
import { createGovernanceRequest } from "../lib/api";
import {
  runtimeFeatureFlagAvailable,
  runtimeFeatureFlagReason,
  tableLineageAvailable,
  tableLineageReason,
  workspaceAccessAvailable,
  workspaceAccessReason,
} from "../lib/capabilities";
import { consumeWorkspaceIntent, peekWorkspaceIntent, setWorkspaceIntent } from "../lib/workspaceIntent";

/**
 * LineageWorkspace — full-page lineage surface.
 *
 * Hosts the rebuilt LineageCanvasV2 plus a slim chrome layer:
 *   - Page hero (Lineage Atlas eyebrow, focus FQN, evidence chips)
 *   - Empty-state hero (centered search + node-type legend) when no
 *     asset is selected
 *   - Right-side LINEAGE DETAILS rail showing focus metadata, sources,
 *     consumers, recent activity (when an asset is selected)
 *   - Asset search overlay for re-anchoring focus
 *
 * Replaces the legacy NorthStarLineageExplorer / LineageStage. The
 * canvas itself is built on React Flow with BFS-from-focus column
 * layout, docked controls, separated zoom/pan, hover-trace dimming,
 * and full-metadata node cards.
 */

function compactCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  return Math.max(0, Math.trunc(number)).toLocaleString();
}

function displayCount(value) {
  if (value == null || value === "") return "Unavailable";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Math.max(0, Math.trunc(number)).toLocaleString();
}

function isUcAssetFqn(value) {
  const parts = String(value || "").split(".").filter(Boolean);
  return parts.length === 3 && parts.every((part) => part.trim());
}

function ownerLabel(asset, fallbackNode) {
  const owners = Array.isArray(asset?.owners) && asset.owners.length
    ? asset.owners
    : Array.isArray(fallbackNode?.owners)
      ? fallbackNode.owners
      : [];
  const first = owners[0] || {};
  return (
    asset?.ownerDisplayName ||
    asset?.owner ||
    asset?.steward ||
    first.displayName ||
    first.email ||
    first.name ||
    ""
  );
}

function buildColumnDirectLineage(columnLineage, selectedColumn, focusFqn) {
  const columnName = selectedColumn?.columnName || "";
  if (!columnName || selectedColumn?.assetFqn !== focusFqn) {
    return { upstream: [], downstream: [], appliesToFocus: false };
  }
  const upstreamEntry = (columnLineage?.upstream || []).find((entry) => entry.column === columnName);
  const downstreamEntry = (columnLineage?.downstream || []).find((entry) => entry.column === columnName);
  return {
    upstream: upstreamEntry?.sources || [],
    downstream: downstreamEntry?.targets || [],
    appliesToFocus: true,
  };
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function firstMeaningful(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function buildEvidenceRecords({
  accessExplain,
  columnLineageCount,
  databricksEvidence,
  focusedAsset,
  graph,
  quality,
}) {
  const graphSource = graph?.payload?.source || graph?.meta?.source || "unity-catalog-lineage";
  const graphAuthoritative = graph?.payload?.authoritative === true || graph?.meta?.authoritative === true;
  const graphVisibility = graph?.meta?.visibilityScope || graph?.meta?.capabilities?.visibilityScope || "";
  const graphDegraded = graph?.meta?.degraded === true || graph?.meta?.authoritative === false;
  const columnMeta = graph?.columnLineage?.meta || {};
  const columnAvailable = columnLineageCount > 0 || (
    Object.keys(columnMeta).length > 0 &&
    columnMeta.deferred !== true
  );
  const governanceAvailable = Boolean(
    focusedAsset &&
      (
        focusedAsset.openRequests != null ||
        arrayValue(focusedAsset.glossaryTerms).length ||
        focusedAsset.isCde != null ||
        firstMeaningful(focusedAsset.certification, focusedAsset.sensitivity, focusedAsset.criticality)
      ),
  );
  const qualityAvailable = Boolean(
    quality?.summaryBacked ||
      arrayValue(quality?.runs).length ||
      arrayValue(quality?.results).length ||
      evidenceState(quality?.databricksMonitoring) === "available" ||
      evidenceState(databricksEvidence?.qualityMonitoring) === "available",
  );
  const accessAvailable = Boolean(accessExplain?.data && !accessExplain?.error);
  const dqm = databricksEvidence?.qualityMonitoring || quality?.databricksMonitoring || {};
  const profileMetrics = databricksEvidence?.profileMetrics || {};
  const lakeflow = databricksEvidence?.lakeflow || {};
  const pipelineEvents = databricksEvidence?.pipelineEvents || {};
  return [
    {
      source: graphSource,
      status: graphDegraded ? "degraded" : "available",
      detail: graphAuthoritative
        ? `Actor-scoped lineage${graphVisibility ? ` (${graphVisibility})` : ""}.`
        : `Lineage returned without actor-scoped authority${graphVisibility ? ` (${graphVisibility})` : ""}.`,
    },
    {
      source: "system.access.table_lineage",
      status: graph?.edges?.length || graph?.stats?.progressive?.tableLineageDeferred === false ? "available" : "unavailable",
      detail: graph?.edges?.length
        ? `${graph.edges.length} visible graph edge(s) loaded.`
        : "No table-lineage edges are loaded for this focus.",
    },
    {
      source: "system.access.column_lineage",
      status: columnAvailable ? "available" : "unavailable",
      detail: columnAvailable
        ? `${columnLineageCount} direct column lineage path(s) loaded.`
        : "Column lineage did not return backed paths for the current focus/selection.",
    },
    {
      source: "governance-store",
      status: governanceAvailable ? "available" : "unavailable",
      detail: governanceAvailable
        ? "Governance fields or request counts are present on the asset record."
        : "Governance request/control rows are not available for this asset in the current payload.",
    },
    {
      source: "quality-runner+databricks-dqm",
      status: qualityAvailable ? "available" : "unavailable",
      detail: qualityAvailable
        ? `${arrayValue(quality?.runs).length} Atlas quality run(s), ${arrayValue(quality?.results).length} result row(s), Databricks DQM ${evidenceState(dqm) || "unavailable"}.`
        : quality?.error || "No backed quality or Databricks monitoring evidence is available for this asset.",
    },
    {
      source: dqm?.source || "system.data_quality_monitoring.table_results",
      status: sourceStateToEvidenceStatus(evidenceState(dqm)),
      detail: dqm?.summary?.healthStatus
        ? `Health ${dqm.summary.healthStatus}; freshness ${dqm.summary.freshnessStatus || "Unavailable"}; completeness ${dqm.summary.completenessStatus || "Unavailable"}.`
        : (arrayValue(dqm?.warnings)[0] || "No Databricks data quality monitoring rows returned."),
    },
    {
      source: profileMetrics?.source || "databricks-data-profiling",
      status: sourceStateToEvidenceStatus(evidenceState(profileMetrics)),
      detail: evidenceState(profileMetrics) === "available"
        ? `${evidenceRows(profileMetrics).length} metric table row(s); lookup ${profileMetrics?.summary?.lookupMethod || "unknown"}.`
        : (arrayValue(profileMetrics?.warnings)[0] || "No Databricks profile metric tables returned."),
    },
    {
      source: lakeflow?.source || "system.lakeflow",
      status: sourceStateToEvidenceStatus(evidenceState(lakeflow)),
      detail: evidenceState(lakeflow) === "available"
        ? `${evidenceRows(lakeflow, "jobs").length} job run(s), ${evidenceRows(lakeflow, "pipelines").length} pipeline update(s) joined from lineage.`
        : (arrayValue(lakeflow?.warnings)[0] || "No Lakeflow workflow rows returned for this asset."),
    },
    {
      source: pipelineEvents?.source || "event_log",
      status: sourceStateToEvidenceStatus(evidenceState(pipelineEvents)),
      detail: evidenceState(pipelineEvents) === "available"
        ? `${evidenceRows(pipelineEvents).length} pipeline event-log row(s) returned.`
        : (arrayValue(pipelineEvents?.warnings)[0] || "No pipeline event-log rows returned."),
    },
    {
      source: "access-explain",
      status: accessAvailable ? "available" : "unavailable",
      detail: accessAvailable
        ? accessExplain.data?.visibilityScope || accessExplain.data?.authMode || "Access explainer payload returned."
        : accessExplain?.error || "Access-grant detail is not available in this payload.",
    },
  ].filter((record) => record.source);
}

function collectSqlSnippets(edgeDetails, selectedColumn) {
  if (!selectedColumn?.columnName || !edgeDetails || typeof edgeDetails !== "object") return [];
  const columnName = String(selectedColumn.columnName).trim().toLowerCase();
  return Object.entries(edgeDetails)
    .map(([edgeId, detail]) => ({ edgeId, detail }))
    .filter(({ detail }) => {
      const snippet = firstMeaningful(detail?.sqlSnippet, detail?.sql);
      if (!snippet) return false;
      const mappings = arrayValue(detail?.columnMappings);
      if (!mappings.length) return true;
      return mappings.some((mapping) =>
        String(mapping?.sourceColumn || "").trim().toLowerCase() === columnName ||
        String(mapping?.targetColumn || "").trim().toLowerCase() === columnName,
      );
    })
    .slice(0, 3)
    .map(({ edgeId, detail }) => ({
      edgeId,
      sourceAssetFqn: detail?.sourceAssetFqn || "",
      targetAssetFqn: detail?.targetAssetFqn || "",
      sqlSnippet: firstMeaningful(detail?.sqlSnippet, detail?.sql),
    }));
}

function evidenceSourceNames(records) {
  return [
    ...new Set(
      arrayValue(records)
        .filter((record) => record.status === "available" || record.status === "degraded")
        .map((record) => record.source)
        .filter(Boolean),
    ),
  ];
}

function evidenceState(section) {
  return String(section?.state || "").trim().toLowerCase();
}

function evidenceRows(section, key = "rows") {
  return Array.isArray(section?.[key]) ? section[key] : [];
}

function sourceStateToEvidenceStatus(state) {
  const normalized = String(state || "").toLowerCase();
  if (normalized === "available") return "available";
  if (normalized === "empty") return "unavailable";
  if (normalized === "loading") return "loading";
  if (normalized === "degraded") return "degraded";
  if (normalized === "unavailable" || normalized === "not_authorized" || normalized === "timeout") return "unavailable";
  return normalized || "unavailable";
}

function downloadImpactPacket(packet) {
  if (typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(packet, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeFqn = String(packet?.assetFqn || "lineage-impact")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 120);
  link.href = url;
  link.download = `atlas-impact-brief-${safeFqn}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function RecommendationList({
  recommendations,
  loading,
  error,
  onSelect,
  compact = false,
  degraded = false,
  visibilityScope = "",
  relationshipVisibilityScope = "",
}) {
  if (loading) {
    return <p className="ga-lineage-v2-rail-empty">Loading ranked lineage assets from system.access.table_lineage...</p>;
  }
  if (error) {
    return <p className="ga-lineage-v2-rail-empty">{error}</p>;
  }
  if (!recommendations?.length) {
    return (
      <p className="ga-lineage-v2-rail-empty">
        No ranked high-lineage assets were returned for the current visibility scope.
      </p>
    );
  }
  return (
    <div className={`ga-lineage-recommendations ${compact ? "is-compact" : ""}`.trim()}>
      {degraded ? (
        <p className="ga-lineage-v2-rail-empty">
          Ranked from degraded Databricks lineage evidence. Candidate assets were verified openable
          {visibilityScope ? ` for ${visibilityScope}` : ""}, but edge counts may include relationships outside the actor-openable endpoint set
          {relationshipVisibilityScope ? ` (${relationshipVisibilityScope})` : ""}.
        </p>
      ) : null}
      {recommendations.slice(0, compact ? 4 : 6).map((item) => (
        <button
          className="ga-lineage-recommendation-row"
          key={item.fqn}
          onClick={() => onSelect?.(item.fqn)}
          type="button"
        >
          <span>
            <strong>{item.name}</strong>
            <small>{[item.catalogName, item.schemaName].filter(Boolean).join(" / ") || item.fqn}</small>
          </span>
          <em>
            {compactCount(item.edgeCount)} edges
            <small>{compactCount(item.upstreamCount)} up / {compactCount(item.downstreamCount)} down</small>
          </em>
        </button>
      ))}
    </div>
  );
}

function LineageHeroEmpty({
  onSearch,
  query,
  onQueryChange,
  results,
  loading,
  recommendations,
  recommendationsLoading,
  recommendationsError,
  recommendationsDegraded = false,
  recommendationsVisibilityScope = "",
  recommendationsRelationshipVisibilityScope = "",
}) {
  return (
    <section className="ga-lineage-explorer ga-lineage-explorer-empty" data-testid="lineage-northstar-explorer">
      <div className="ga-lineage-empty-hero">
        <div className="ga-lineage-empty-card">
          <span className="ga-lineage-eyebrow">Lineage Atlas</span>
          <h1>Trace the path of any governed asset</h1>
          <p>
            Search for a Unity Catalog asset to open its lineage graph. Atlas
            walks <code>system.access.table_lineage</code> outward from the focus
            node and preserves capped depth, visibility, and truncation limits.
          </p>
          <div className="ga-lineage-empty-search">
            <input
              autoFocus
              className="gh-input"
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results?.[0]) {
                  event.preventDefault();
                  onSearch(results[0].fqn);
                }
              }}
              placeholder="Search for an asset"
              value={query}
            />
            <div className="ga-lineage-empty-search-list">
              {loading ? (
                <div className="ga-lineage-empty-search-status">Searching assets…</div>
              ) : results?.length ? (
                results.slice(0, 8).map((candidate) => (
                  <button
                    className="gh-lineage-search-row"
                    key={candidate.fqn}
                    onClick={() => onSearch(candidate.fqn)}
                    type="button"
                  >
                    <span>{candidate.name}</span>
                    <span>{assetPathLabel(candidate)}</span>
                  </button>
                ))
              ) : query ? (
                <div className="ga-lineage-empty-search-status">No matching assets.</div>
              ) : (
                <div className="ga-lineage-empty-search-status">Start typing to load a graph.</div>
              )}
            </div>
          </div>
          <div className="ga-lineage-empty-legend" aria-label="Node types">
            <strong>Node types</strong>
            {[
              ["table", "Table"],
              ["pipeline", "Pipeline"],
              ["job", "Job"],
              ["notebook", "Notebook"],
              ["saved-query", "Saved query"],
              ["dashboard", "Dashboard"],
              ["model", "Model"],
              ["udf", "UDF"],
              ["volume", "Volume"],
              ["restricted", "Restricted"],
            ].map(([type, label]) => (
              <span data-node-type={type} key={type}>{label}</span>
            ))}
          </div>
          <div className="ga-lineage-empty-recommendations">
            <div className="ga-lineage-v2-section-title">
              <span>High-lineage assets</span>
              <small>
                {recommendationsDegraded ? "Ranked from degraded Databricks lineage evidence" : "Ranked from actor-visible Unity Catalog lineage"}
              </small>
            </div>
            <RecommendationList
              compact
              degraded={recommendationsDegraded}
              error={recommendationsError}
              loading={recommendationsLoading}
              onSelect={onSearch}
              recommendations={recommendations}
              relationshipVisibilityScope={recommendationsRelationshipVisibilityScope}
              visibilityScope={recommendationsVisibilityScope}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FocusChip({ tone, children, title = "" }) {
  return (
    <span className={`ga-lineage-v2-chip tone-${tone || "neutral"}`} title={title || undefined}>
      {children}
    </span>
  );
}

function LineageHero({ asset, focusFqn, focus, hydrating, edgeCount, onClear }) {
  // Source the chips from the asset detail when available — the
  // lineage payload's `focus` node is a thin stub from
  // system.access.table_lineage and doesn't carry freshness / owner /
  // certification by itself. The asset detail (already fetched by the
  // workspace via useAssetDetail) is the authoritative source for
  // these fields, matching what the rail and the focus card show.
  const certified =
    asset?.certification === "Certified" ||
    asset?.isCertified ||
    focus?.isCertified;
  const classification = asset?.sensitivity || focus?.classification || "";
  const ownerEntry =
    (Array.isArray(asset?.owners) && asset.owners[0]) ||
    (Array.isArray(focus?.owners) && focus.owners[0]) ||
    null;
  const owner =
    ownerEntry?.displayName ||
    ownerEntry?.email ||
    ownerEntry?.name ||
    "";
  // Freshness derived from updatedAt the same way the rail does, so
  // hero and rail stay consistent.
  const updatedAtIso =
    asset?.updatedAt ||
    asset?.lastRefresh ||
    asset?.refreshedAt ||
    "";
  const freshness = (() => {
    if (!updatedAtIso) return asset?.freshness || focus?.freshness || "";
    const ts = Date.parse(updatedAtIso);
    if (!Number.isFinite(ts)) return asset?.freshness || focus?.freshness || "";
    const deltaMs = Date.now() - ts;
    if (deltaMs < 0) return "future";
    const minutes = Math.round(deltaMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.round(days / 365);
    return `${years}y ago`;
  })();
  return (
    <header className="ga-lineage-v2-hero">
      <div>
        <span className="ga-lineage-eyebrow">Lineage Atlas</span>
        <h1>{focusFqn}</h1>
        <p>Permission-aware lineage from actor-visible upstream assets through to permitted downstream consumers.</p>
        <div className="ga-lineage-v2-hero-chips">
          <FocusChip tone={certified ? "good" : "neutral"}>
            {certified ? "Certified" : "Certification unavailable"}
          </FocusChip>
          <FocusChip tone={freshness ? "info" : "neutral"}>
            {freshness ? `Freshness · ${freshness}` : "Freshness unavailable"}
          </FocusChip>
          <FocusChip tone={classification ? "warn" : "neutral"} title={classification}>
            {classification || "Sensitivity unavailable"}
          </FocusChip>
          <FocusChip tone={owner ? "info" : "neutral"} title={owner}>
            {owner ? `Owner · ${owner}` : "Owner unavailable"}
          </FocusChip>
          {edgeCount !== null ? (
            <FocusChip tone="info">
              {edgeCount} {edgeCount === 1 ? "edge" : "edges"}
            </FocusChip>
          ) : null}
          {hydrating ? <FocusChip tone="info">Hydrating…</FocusChip> : null}
        </div>
      </div>
      {focusFqn ? (
        <button className="gh-tertiary-button" onClick={onClear} type="button">
          ← Clear lineage focus
        </button>
      ) : null}
    </header>
  );
}

function ImpactFact({ label, value, detail, tone = "neutral" }) {
  return (
    <div className={`ga-lineage-impact-fact tone-${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function LineageRows({ items, empty, onSelectAsset }) {
  if (!items?.length) return <p className="ga-lineage-v2-rail-empty">{empty}</p>;
  return (
    <ul>
      {items.map((node) => (
        <li key={node.id}>
          <button
            className="ga-lineage-v2-rail-row"
            disabled={node.isOpenable === false}
            onClick={() => node.isOpenable !== false && onSelectAsset(node.fqn)}
            type="button"
          >
            <strong>{node.label}</strong>
            <span>{node.subtitle}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ColumnTracePath({ title, trace, directItems, error }) {
  const nodes = Array.isArray(trace?.nodes) ? trace.nodes : [];
  const truncated = Boolean(trace?.meta?.truncated);
  return (
    <div className="ga-lineage-column-trace-card">
      <header>
        <span>{title}</span>
        <strong>{trace ? `${Math.max(0, nodes.length - 1)} traced` : `${directItems.length} direct`}</strong>
      </header>
      {trace ? (
        <>
          <div className="ga-lineage-column-path-list">
            {nodes.slice(1, 6).map((node) => (
              <div key={node.id || `${node.assetFqn}-${node.column}`}>
                <strong>{node.column}</strong>
                <span>{node.assetFqn}</span>
              </div>
            ))}
            {nodes.length <= 1 ? <p>No multi-hop column paths returned.</p> : null}
          </div>
          {truncated ? <p className="ga-lineage-v2-rail-empty">Trace truncated by bounded fan-out limits.</p> : null}
        </>
      ) : error ? (
        <p className="ga-lineage-v2-rail-empty">{error}</p>
      ) : directItems.length ? (
        <div className="ga-lineage-column-path-list">
          {directItems.slice(0, 6).map((item) => (
            <div key={`${item.assetFqn}-${item.column}`}>
              <strong>{item.column}</strong>
              <span>{item.assetFqn}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="ga-lineage-v2-rail-empty">No column paths returned for this direction.</p>
      )}
    </div>
  );
}

function LineageDetailRail({
  graph,
  focus,
  asset,
  selectedNode,
  selectedColumn,
  columnTrace,
  quality,
  databricksEvidence,
  accessExplain,
  impactRequestState,
  onCreateImpactRequest,
  onExportImpactBrief,
  onOpenAsset,
  onSelectAsset,
  onReAnchor,
  isFocusSelected,
}) {
  const [activeTab, setActiveTab] = useState("impact");
  const subject = selectedNode || focus;
  const subjectId = subject?.id;
  const sources = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.target === subjectId)
        .map((edge) => graph.nodes.find((node) => node.id === edge.source))
        .filter(Boolean),
    [graph.edges, graph.nodes, subjectId],
  );
  const consumers = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.source === subjectId)
        .map((edge) => graph.nodes.find((node) => node.id === edge.target))
        .filter(Boolean),
    [graph.edges, graph.nodes, subjectId],
  );
  const focusedAsset = isFocusSelected ? asset : null;
  const RAIL_PLACEHOLDERS = new Set([
    "—",
    "-",
    "–",
    "n/a",
    "na",
    "unknown",
    "unassigned",
    "unavailable",
    "none",
    "null",
  ]);
  const railMeaningful = (value) => {
    if (value == null) return "";
    const trimmed = String(value).trim();
    if (!trimmed) return "";
    if (RAIL_PLACEHOLDERS.has(trimmed.toLowerCase())) return "";
    return trimmed;
  };
  const updatedAtIso =
    focusedAsset?.updatedAt ||
    focusedAsset?.lastRefresh ||
    focusedAsset?.refreshedAt ||
    focusedAsset?.detail?.updatedAt ||
    "";
  const updatedAtRelative = (() => {
    if (!updatedAtIso) return "";
    const ts = Date.parse(updatedAtIso);
    if (!Number.isFinite(ts)) return "";
    const deltaMs = Date.now() - ts;
    if (deltaMs < 0) return "future";
    const minutes = Math.round(deltaMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.round(days / 365);
    return `${years}y ago`;
  })();
  const detailFreshness =
    updatedAtRelative ||
    focusedAsset?.lastRefreshDisplay ||
    focusedAsset?.freshness ||
    focusedAsset?.lastRefresh ||
    focusedAsset?.refreshedAt ||
    focusedAsset?.detail?.freshness ||
    "";
  const detailRowCount = focusedAsset?.rowCountDisplay || focusedAsset?.rowCount || focusedAsset?.rows;
  const detailOwner = ownerLabel(focusedAsset, subject);
  const detailSize = railMeaningful(focusedAsset?.size);
  const detailFiles = railMeaningful(focusedAsset?.files);
  const detailType =
    [railMeaningful(focusedAsset?.managementType), railMeaningful(focusedAsset?.objectType)]
      .filter(Boolean)
      .join(" · ") || "";
  const detailActivity = Array.isArray(focusedAsset?.recentActivity)
    ? focusedAsset.recentActivity
    : Array.isArray(focusedAsset?.activity)
      ? focusedAsset.activity
      : [];
  const recentActivity = detailActivity.length ? detailActivity : subject?.recentActivity || [];
  const recentActivityCount = recentActivity.length || subject?.recentActivityCount || 0;
  const columnLineageCount = Array.isArray(graph.columnEdges) ? graph.columnEdges.length : 0;
  const downstreamDashboards = consumers.filter((node) => node.kind === "dashboard");
  const downstreamJobs = consumers.filter((node) => node.kind === "job");
  const linkedPolicies = arrayValue(focusedAsset?.policies || focusedAsset?.linkedPolicies);
  const linkedControls = arrayValue(focusedAsset?.controls || focusedAsset?.linkedControls);
  const accessGrants = arrayValue(accessExplain?.data?.grants || accessExplain?.data?.permissions);
  const approvalBlockers = arrayValue(focusedAsset?.approvalBlockers || focusedAsset?.requiredApprovals);
  const directColumnLineage = buildColumnDirectLineage(
    graph.columnLineage,
    selectedColumn,
    focus?.fqn,
  );
  const qualityRuns = arrayValue(quality?.runs).length;
  const qualityResults = arrayValue(quality?.results).length;
  const dqm = databricksEvidence?.qualityMonitoring || quality?.databricksMonitoring || {};
  const dqmRows = evidenceRows(dqm);
  const dqmSummary = dqm?.summary || {};
  const profileMetrics = databricksEvidence?.profileMetrics || {};
  const profileMetricRows = evidenceRows(profileMetrics);
  const lakeflow = databricksEvidence?.lakeflow || {};
  const lakeflowJobs = evidenceRows(lakeflow, "jobs");
  const lakeflowPipelines = evidenceRows(lakeflow, "pipelines");
  const pipelineEvents = databricksEvidence?.pipelineEvents || {};
  const pipelineEventRows = evidenceRows(pipelineEvents);
  const qualityAvailable = Boolean(
    quality?.summaryBacked ||
      qualityRuns ||
      qualityResults ||
      evidenceState(dqm) === "available",
  );
  const failedQuality = qualityAvailable
    ? Number(quality?.summary?.failed || 0) + Number(quality?.summary?.errored || 0)
    : null;
  const truncated = graph.stats?.truncated || {};
  const progressive = graph.stats?.progressive || {};
  const evidenceRecords = buildEvidenceRecords({
    accessExplain,
    columnLineageCount,
    databricksEvidence,
    focusedAsset,
    graph,
    quality,
  });
  const evidenceSources = evidenceSourceNames(evidenceRecords);
  const sqlSnippets = collectSqlSnippets(graph.edgeDetails, selectedColumn);
  const impactPacket = {
    generatedAt: new Date().toISOString(),
    assetFqn: subject?.fqn || focus?.fqn || "",
    selectedColumn: selectedColumn || null,
    lineage: {
      edgeCount: graph.edges.length,
      upstreamCount: sources.length,
      downstreamCount: consumers.length,
      stats: graph.stats || {},
      truncated,
      progressive,
      source: graph.payload?.source || graph.meta?.source || "unity-catalog-lineage",
      authoritative: graph.payload?.authoritative === true || graph.meta?.authoritative === true,
      visibilityScope: graph.meta?.visibilityScope || graph.meta?.capabilities?.visibilityScope || "",
    },
    sources: sources.map((node) => ({ fqn: node.fqn, label: node.label, kind: node.kind })),
    consumers: consumers.map((node) => ({ fqn: node.fqn, label: node.label, kind: node.kind })),
    columnLineage: {
      directUpstream: directColumnLineage.upstream,
      directDownstream: directColumnLineage.downstream,
      upstreamTrace: columnTrace?.upstream || null,
      downstreamTrace: columnTrace?.downstream || null,
      upstreamError: columnTrace?.upstreamError || "",
      downstreamError: columnTrace?.downstreamError || "",
    },
    governance: {
      owner: detailOwner || "",
      certification: focusedAsset?.certification || subject?.raw?.details?.certification || "",
      sensitivity: focusedAsset?.sensitivity || subject?.classification || "",
      openRequests: focusedAsset?.openRequests ?? null,
      glossaryTerms: focusedAsset?.glossaryTerms || [],
      cde: focusedAsset?.isCde ?? null,
    },
    quality: {
      runs: quality?.runs || [],
      summary: qualityAvailable ? quality?.summary || null : null,
      databricksMonitoring: dqm,
      available: qualityAvailable,
      error: quality?.error || "",
    },
    databricksEvidence: {
      qualityMonitoring: dqm,
      profileMetrics,
      lakeflow,
      pipelineEvents,
      provenance: databricksEvidence?.provenance || [],
    },
    access: accessExplain?.data || null,
    evidenceSources,
    evidenceRecords,
  };
  const createNote = [
    `Asset: ${impactPacket.assetFqn}`,
    selectedColumn?.columnName ? `Selected column: ${selectedColumn.columnName}` : "",
    `Visible lineage edges: ${graph.edges.length}`,
    `Downstream consumers in current graph: ${consumers.length}`,
    qualityAvailable
      ? `Quality failures/errors returned: ${failedQuality}`
      : "Quality evidence unavailable in the current payload.",
    `Evidence records: ${evidenceRecords.map((record) => `${record.source} (${record.status})`).join(", ")}`,
  ].filter(Boolean).join("\n");

  return (
    <aside className="ga-lineage-v2-rail">
      <div className="ga-lineage-v2-rail-head">
        <span className="ga-lineage-eyebrow">{isFocusSelected ? "Impact Inspector" : "Selected Node"}</span>
        <h2>{subject?.label || "Lineage Details"}</h2>
        {subject?.subtitle ? <small>{subject.subtitle}</small> : null}
        {!isFocusSelected && subject?.fqn ? (
          <button
            className="ga-lineage-v2-rail-reanchor"
            onClick={() => onReAnchor?.(subject.fqn)}
            title="Re-anchor the canvas on this node"
            type="button"
          >
            Re-anchor lineage
          </button>
        ) : null}
      </div>

      <div className="ga-lineage-v2-rail-tabs" role="tablist" aria-label="Lineage inspector tabs">
        {[
          ["impact", "Impact Brief"],
          ["details", "Details"],
          ["columns", "Columns"],
          ["evidence", "Evidence"],
        ].map(([key, label]) => (
          <button
            aria-selected={activeTab === key}
            className={activeTab === key ? "is-active" : ""}
            key={key}
            onClick={() => setActiveTab(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "impact" ? (
        <div className="ga-lineage-impact-panel">
          <div className="ga-lineage-impact-grid">
            <ImpactFact label="Downstream" value={compactCount(consumers.length)} detail="visible graph consumers" tone={consumers.length ? "warn" : "neutral"} />
            <ImpactFact label="Column paths" value={compactCount(columnLineageCount)} detail="direct UC column links" tone={columnLineageCount ? "info" : "neutral"} />
            <ImpactFact
              label="Quality issues"
              value={qualityAvailable ? compactCount(failedQuality) : "Unavailable"}
              detail={qualityAvailable ? `${qualityRuns} Atlas run(s) · DQM ${dqmSummary.healthStatus || evidenceState(dqm) || "unavailable"}` : "quality evidence unavailable"}
              tone={failedQuality ? "crit" : "neutral"}
            />
            <ImpactFact
              label="DQM health"
              value={dqmSummary.healthStatus || (evidenceState(dqm) === "available" ? "Observed" : "Unavailable")}
              detail={dqmRows.length ? `${dqmRows.length} monitoring row(s)` : "system.data_quality_monitoring"}
              tone={String(dqmSummary.healthStatus || "").toLowerCase() === "healthy" ? "good" : String(dqmSummary.healthStatus || "").toLowerCase() === "unhealthy" ? "crit" : "neutral"}
            />
            <ImpactFact label="Open requests" value={focusedAsset?.openRequests ?? "Unavailable"} detail="governance store" tone={Number(focusedAsset?.openRequests) ? "warn" : "neutral"} />
            <ImpactFact label="Dashboards" value={compactCount(downstreamDashboards.length)} detail="downstream dashboard nodes" tone={downstreamDashboards.length ? "info" : "neutral"} />
            <ImpactFact label="Jobs" value={compactCount(Math.max(downstreamJobs.length, lakeflowJobs.length))} detail={lakeflowJobs.length ? "Lakeflow job runs" : "downstream job nodes"} tone={downstreamJobs.length || lakeflowJobs.length ? "warn" : "neutral"} />
            <ImpactFact label="Pipelines" value={compactCount(lakeflowPipelines.length)} detail={pipelineEventRows.length ? `${pipelineEventRows.length} event-log row(s)` : "Lakeflow updates"} tone={lakeflowPipelines.length ? "info" : "neutral"} />
          </div>
          <div className="ga-lineage-v2-rail-section">
            <header><span>Decision packet</span></header>
            <ul className="ga-lineage-impact-list">
              <li>Owners: {detailOwner || "Unavailable"}</li>
              <li>Sensitivity: {focusedAsset?.sensitivity || subject?.classification || "Unavailable"}</li>
              <li>Access scope: {accessExplain?.data?.visibilityScope || graph.meta?.visibilityScope || "Unavailable"}</li>
              <li>Access grants: {accessGrants.length ? `${accessGrants.length} grant row(s) returned` : "Unavailable: no access-grant rows returned"}</li>
              <li>Policies: {linkedPolicies.length ? linkedPolicies.map((policy) => firstMeaningful(policy?.name, policy?.title, policy?.id, policy)).slice(0, 3).join(", ") : "Unavailable: no linked policy records returned"}</li>
              <li>Controls affected: {linkedControls.length ? `${linkedControls.length} linked control(s)` : "Unavailable: no control coverage records returned"}</li>
              <li>Databricks DQM: {dqmSummary.healthStatus ? `${dqmSummary.healthStatus} · freshness ${dqmSummary.freshnessStatus || "Unavailable"} · completeness ${dqmSummary.completenessStatus || "Unavailable"}` : "Unavailable: no DQM status returned"}</li>
              <li>Databricks profile: {profileMetricRows.length ? `${profileMetricRows.length} metric table row(s)` : profileMetrics?.monitor?.profileMetricsTableName ? "Monitor configured; metric table visibility unavailable" : "Unavailable: no profile monitor or metric tables returned"}</li>
              <li>Lakeflow: {lakeflowJobs.length || lakeflowPipelines.length ? `${lakeflowJobs.length} job run(s), ${lakeflowPipelines.length} pipeline update(s)` : "Unavailable: no Lakeflow workflow rows joined from lineage"}</li>
              <li>Required approvals: {focusedAsset?.openRequests == null ? "Unavailable" : Number(focusedAsset.openRequests) ? `${focusedAsset.openRequests} open request(s)` : "No open approval requests returned"}</li>
              <li>Approval blockers: {approvalBlockers.length ? approvalBlockers.map((item) => firstMeaningful(item?.title, item?.name, item?.id, item)).join(", ") : "Unavailable: no approval-blocker records returned"}</li>
              <li>Truncation: {Object.values(truncated).some(Boolean) ? "One or more lineage limits were reached" : "No truncation flag returned"}</li>
              <li>Hydration: {Object.values(progressive).some(Boolean) ? "Progressive lineage state is active" : "Full profile currently displayed"}</li>
            </ul>
          </div>
          <div className="ga-lineage-v2-rail-section">
            <header>
              <span>Downstream consumers</span>
              <span className="ga-lineage-v2-rail-count">{consumers.length}</span>
            </header>
            <LineageRows items={consumers.slice(0, 5)} empty="No downstream consumers returned for this asset." onSelectAsset={onSelectAsset} />
          </div>
          <div className="ga-lineage-v2-rail-section">
            <header>
              <span>Downstream dashboards</span>
              <span className="ga-lineage-v2-rail-count">{downstreamDashboards.length}</span>
            </header>
            <LineageRows items={downstreamDashboards.slice(0, 4)} empty="No downstream dashboard nodes returned." onSelectAsset={onSelectAsset} />
          </div>
          <div className="ga-lineage-v2-rail-section">
            <header>
              <span>Downstream jobs</span>
              <span className="ga-lineage-v2-rail-count">{Math.max(downstreamJobs.length, lakeflowJobs.length)}</span>
            </header>
            <LineageRows items={downstreamJobs.slice(0, 4)} empty="No downstream job nodes returned." onSelectAsset={onSelectAsset} />
            {lakeflowJobs.length ? (
              <ul className="ga-lineage-impact-list">
                {lakeflowJobs.slice(0, 3).map((job, index) => (
                  <li key={`${job.job_id || "job"}-${job.run_id || index}`}>
                    <strong>{job.job_name || job.job_id || "Lakeflow job"}</strong>
                    <span>{job.result_state || "Result unavailable"} · {job.period_start_time || job.last_lineage_event || "time unavailable"}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="ga-lineage-v2-rail-actions">
            <button
              className="gh-tertiary-button"
              onClick={() => onExportImpactBrief?.(impactPacket)}
              type="button"
            >
              Export packet
            </button>
            <button
              className="gh-tertiary-button"
              disabled={!impactPacket.assetFqn || impactRequestState?.loading}
              onClick={() =>
                onCreateImpactRequest?.({
                  assetFqn: impactPacket.assetFqn,
                  title: `Lineage impact review: ${subject?.label || impactPacket.assetFqn}`,
                  note: createNote,
                })
              }
              title={!impactPacket.assetFqn ? "Select an openable asset before creating a request." : undefined}
              type="button"
            >
              {impactRequestState?.loading ? "Creating request..." : "Create request"}
            </button>
          </div>
          {impactRequestState?.message ? <p className="ga-lineage-request-status">{impactRequestState.message}</p> : null}
          {impactRequestState?.error ? <p className="ga-lineage-request-status tone-error">{impactRequestState.error}</p> : null}
        </div>
      ) : null}

      {activeTab === "details" ? (
        <>
          {subject ? (
            <div className="ga-lineage-v2-rail-stats">
              <div><span>Last refresh</span><strong>{detailFreshness || subject.freshness || "Unavailable"}</strong></div>
              <div><span>Rows</span><strong>{detailRowCount != null && detailRowCount !== "" ? displayCount(detailRowCount) : subject.rowCount || "Unavailable"}</strong></div>
              <div><span>Owner</span><strong>{detailOwner || "Unavailable"}</strong></div>
              {detailType ? <div><span>Type</span><strong>{detailType}</strong></div> : null}
              {detailSize ? <div><span>Size</span><strong>{detailSize}{detailFiles ? ` · ${detailFiles} files` : ""}</strong></div> : null}
            </div>
          ) : null}
          <div className="ga-lineage-v2-rail-section">
            <header><span>Sources</span><span className="ga-lineage-v2-rail-count">{sources.length}</span></header>
            <LineageRows items={sources} empty="No source-system details returned." onSelectAsset={onSelectAsset} />
          </div>
          <div className="ga-lineage-v2-rail-section">
            <header><span>Recent activity</span><span className="ga-lineage-v2-rail-count">{recentActivityCount}</span></header>
            {recentActivity.length ? (
              <ul>
                {recentActivity.slice(0, 5).map((event, index) => (
                  <li key={`${event.id || event.kind || "event"}-${index}`}>
                    <strong>{event.kind || event.title || event.action || "Activity"}</strong>
                    <span>{event.timestamp || event.observedAt || event.at || ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ga-lineage-v2-rail-empty">No recent lineage activity returned.</p>
            )}
          </div>
          {focus?.fqn ? (
            <div className="ga-lineage-v2-rail-actions">
              <button className="gh-tertiary-button" onClick={() => onOpenAsset?.(focus.fqn, "Overview")} type="button">
                Open asset record
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === "columns" ? (
        <div className="ga-lineage-column-panel">
          <div className="ga-lineage-v2-rail-section">
            <header>
              <span>{selectedColumn?.columnName ? "Selected column" : "Column lineage"}</span>
              <span className="ga-lineage-v2-rail-count">{columnLineageCount}</span>
            </header>
            <p className="ga-lineage-v2-rail-empty">
              {selectedColumn?.columnName
                ? `${selectedColumn.columnName} on ${selectedColumn.assetFqn}`
                : "Select a column on a table card to trace column-level impact."}
            </p>
          </div>
          {selectedColumn?.columnName ? (
            <>
              <ColumnTracePath
                directItems={directColumnLineage.upstream}
                error={columnTrace?.upstreamError}
                title="Upstream"
                trace={columnTrace?.upstream}
              />
              <ColumnTracePath
                directItems={directColumnLineage.downstream}
                error={columnTrace?.downstreamError}
                title="Downstream"
                trace={columnTrace?.downstream}
              />
              <div className="ga-lineage-sql-placeholder">
                <strong>Transformation SQL</strong>
                {sqlSnippets.length ? (
                  <div className="ga-lineage-sql-snippets">
                    {sqlSnippets.map((snippet) => (
                      <pre key={snippet.edgeId}>{snippet.sqlSnippet}</pre>
                    ))}
                  </div>
                ) : (
                  <span>Unity Catalog column lineage did not return transformation SQL for this path. SQL remains unavailable unless a backed query, view, job, or pipeline source supplies it.</span>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {activeTab === "evidence" ? (
        <div className="ga-lineage-evidence-panel">
          <div className="ga-lineage-v2-rail-section">
            <header><span>Evidence sources</span></header>
            <ul className="ga-lineage-impact-list">
              {evidenceRecords.map((record) => (
                <li key={record.source}>
                  <strong>{record.source}</strong> · {record.status}
                  <span>{record.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="ga-lineage-v2-rail-section">
            <header><span>Atlas AI evidence boundary</span></header>
            <p className="ga-lineage-v2-rail-empty">
              The impact packet is generated from the currently loaded lineage, governance, access, and quality evidence. Atlas AI should answer from this packet and returned evidence records; if the AI provider is unavailable, the exported packet remains the backed artifact.
            </p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export default function LineageWorkspace({
  initialAssetFqn,
  bootstrap,
  contextSeedAssets = [],
  onNavigationStateChange,
  onSurfaceReady,
  onRouteAssetChange,
  onOpenGovernance,
  onOpenAsset,
  runtimeFeatureFlags = [],
  sharedVisibleAssetSet = null,
  workspaceAccess = null,
  userEmail = "",
}) {
  const focusAssetFqn = initialAssetFqn || "";
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [selectedColumn, setSelectedColumn] = useState(null);
  const [impactRequestState, setImpactRequestState] = useState({
    loading: false,
    message: "",
    error: "",
  });
  const [defaultRouteSuppressed, setDefaultRouteSuppressed] = useState(false);
  // selectedNodeFqn is CLIENT-SIDE state — it tracks which node the user
  // last clicked on the canvas. It is NOT the URL focus. The URL focus
  // (focusAssetFqn) drives the lineage HTTP query; selectedNodeFqn drives
  // ONLY the rail's "subject" and a visual highlight on the card.
  // Decoupling these two means clicking a node no longer triggers a
  // refetch — the user perceives an instant highlight + rail update
  // instead of a full graph reload. To genuinely re-anchor the lineage
  // (refetch the canvas centered on a different node), the user must
  // explicitly click the "Re-anchor lineage on this node" button in the
  // rail, which calls handleReAnchor below and DOES change the URL.
  const [selectedNodeFqn, setSelectedNodeFqn] = useState(focusAssetFqn);
  // Once we've successfully rendered a canvas with at least one node, keep
  // the workspace in canvas mode for the rest of the session. Without this,
  // a focus-switch click triggers a brief moment where the new asset's
  // payload hasn't returned yet AND bootstrap.capabilities.tableLineage is
  // marked unavailable — the workspace would flip to the "Lineage
  // unavailable" error UI mid-transition, unmount the canvas, then remount
  // when nodes arrive. The user perceives this as a full reload. We pin
  // the canvas open so the only thing that swaps is the graph data inside.
  const [canvasEverRendered, setCanvasEverRendered] = useState(false);

  const lineageAvailable = tableLineageAvailable(bootstrap);
  const lineageUnavailableReason = tableLineageReason(bootstrap);
  const workspaceLineageAvailable = workspaceAccessAvailable(workspaceAccess, "canUseLineage", false);
  const lineageRolloutAvailable = runtimeFeatureFlagAvailable(
    runtimeFeatureFlags,
    "table_lineage_surface",
  );
  const workspaceAccessResolved = Boolean(
    workspaceAccess &&
      (
        workspaceAccess.mode ||
        workspaceAccess.observedAt ||
        Array.isArray(workspaceAccess.gates) ||
        typeof workspaceAccess.canUseLineage === "boolean"
      ),
  );
  const lineageSurfaceAvailable =
    lineageAvailable &&
    lineageRolloutAvailable &&
    (!workspaceAccessResolved || workspaceLineageAvailable);
  const lineageRolloutUnavailableReason =
    "Table lineage rollout is not available in this workspace right now.";
  const lineageSurfaceUnavailableReason = workspaceAccessResolved && !workspaceLineageAvailable
    ? workspaceAccessReason(workspaceAccess, "table_lineage", lineageUnavailableReason)
    : lineageAvailable
    ? lineageRolloutAvailable
      ? lineageUnavailableReason
      : runtimeFeatureFlagReason(
          runtimeFeatureFlags,
          "table_lineage_surface",
          lineageRolloutUnavailableReason,
        )
    : lineageUnavailableReason;
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const seeded = useSeededAssetContext(focusAssetFqn, bootstrap, seedAssets, {
    allowFallback: false,
  });
  const assetDetail = useAssetDetail(focusAssetFqn || "", { sections: ["header"] });
  // Always try to fetch when we have a focused asset — bootstrap can
  // under-report capability (e.g. when its workspace-wide check hasn't
  // hydrated) even though /api/lineage will return real edges. The API
  // itself is the authoritative source of "is this asset openable"; we
  // gate the canvas on bootstrap only as a fallback when we have nothing.
  const lineageEnabled = Boolean(focusAssetFqn);

  const graph = useLineageGraphV2(focusAssetFqn || "", { enabled: lineageEnabled });
  const lineageRecommendations = useLineageRecommendations({ enabled: true, limit: 8 });
  const recommendedAssets = useMemo(
    () =>
      (lineageRecommendations.items || [])
        .filter((item) => item.fqn && item.fqn !== focusAssetFqn)
        .sort((left, right) => Number(right.edgeCount || 0) - Number(left.edgeCount || 0)),
    [focusAssetFqn, lineageRecommendations.items],
  );
  const recommendationsDegraded = Boolean(
    lineageRecommendations.degraded ||
      lineageRecommendations.authoritative === false ||
      String(lineageRecommendations.visibilityScope || "").includes("workspace-app-principal"),
  );
  const recommendationsVisibilityScope = lineageRecommendations.visibilityScope || "";
  const recommendationsRelationshipVisibilityScope = lineageRecommendations.relationshipVisibilityScope || "";
  const assetHeaderHydrated = Boolean(assetDetail.detail?.fqn) && !assetDetail.loading && !assetDetail.detail?.error;
  const focusAssetHasQualityVisibility = Boolean(
    focusAssetFqn &&
      sharedVisibleAssetSet &&
      typeof sharedVisibleAssetSet.has === "function" &&
      sharedVisibleAssetSet.has(focusAssetFqn),
  );
  const quality = useAssetQuality(focusAssetFqn || "", {
    enabled: Boolean(focusAssetFqn && assetHeaderHydrated && focusAssetHasQualityVisibility),
  });
  const databricksEvidence = useAssetDatabricksEvidence(focusAssetFqn || "", {
    enabled: Boolean(focusAssetFqn && assetHeaderHydrated && focusAssetHasQualityVisibility),
  });
  const accessExplain = useAccessExplain(focusAssetFqn || "", { enabled: Boolean(focusAssetFqn) });
  const columnTrace = useColumnLineageTrace(
    selectedColumn?.assetFqn || "",
    selectedColumn?.columnName || "",
    {
      enabled: Boolean(selectedColumn?.assetFqn && selectedColumn?.columnName),
      depth: 3,
    },
  );
  // Batch-fetch bounded card headers from visible inventory. This enriches
  // the first visible cards without turning a lineage render into N full
  // asset-detail requests.
  const lineageNodeFqns = useMemo(
    () => (graph.nodes || [])
      .map((node) => node.fqn)
      .filter((fqn) => isUcAssetFqn(fqn) && fqn !== focusAssetFqn),
    [focusAssetFqn, graph.nodes],
  );
  const { headers: nodeHeaders } = useLineageNodeHeaders(lineageNodeFqns);
  const asset =
    assetDetail.detail ||
    (focusAssetFqn && assetDetail.loading ? seeded.summary : null);
  const assetSearch = useAssetSearch(
    assetSearchQuery,
    assetSearchQuery.trim().length >= 2,
    seedAssets,
  );

  // Persist + restore the user's "lineage context" (Data Lineage / Operational
  // Context) across navigations using the workspaceIntent helper, matching
  // the legacy LineageWorkspace contract that other surfaces relied on.
  useEffect(() => {
    setAssetSearchQuery("");
    setSelectedColumn(null);
    setImpactRequestState({ loading: false, message: "", error: "" });
    if (focusAssetFqn) {
      setDefaultRouteSuppressed(false);
    }
    // When the URL focus changes (e.g. user re-anchored or navigated in),
    // reset the locally selected node back to the URL focus so the rail
    // and highlight start aligned with the new graph.
    setSelectedNodeFqn(focusAssetFqn);
  }, [focusAssetFqn]);

  useEffect(() => {
    if (
      focusAssetFqn ||
      defaultRouteSuppressed ||
      assetSearchQuery.trim() ||
      lineageRecommendations.loading ||
      !recommendedAssets[0]?.fqn
    ) {
      return;
    }
    onRouteAssetChange?.(recommendedAssets[0].fqn, "Data Lineage");
  }, [
    assetSearchQuery,
    defaultRouteSuppressed,
    focusAssetFqn,
    lineageRecommendations.loading,
    onRouteAssetChange,
    recommendedAssets,
    recommendationsDegraded,
  ]);

  useEffect(() => {
    if (initialAssetFqn) {
      const ctx = peekWorkspaceIntent("lineageContext", initialAssetFqn, "Data Lineage");
      consumeWorkspaceIntent("lineageContext", initialAssetFqn, "Data Lineage");
      // Echo the consumed intent back into session storage so a refresh
      // restores the same context.
      setWorkspaceIntent("lineageContext", initialAssetFqn, ctx);
    }
  }, [initialAssetFqn]);

  useEffect(() => {
    if (!focusAssetFqn) {
      onSurfaceReady?.();
      return;
    }
    if (!workspaceAccessResolved) return;
    if (!graph.loading && (!assetDetail.loading || assetDetail.detail?.fqn === focusAssetFqn)) {
      onSurfaceReady?.();
    }
  }, [
    assetDetail.detail?.fqn,
    assetDetail.loading,
    focusAssetFqn,
    graph.loading,
    onSurfaceReady,
    workspaceAccessResolved,
  ]);

  // Click handler for in-canvas node selection. The user wants UC-style
  // seamless navigation: clicking a node should INSTANTLY shift the
  // visual focus + rail subject (no waiting), AND fetch that node's
  // lineage in the background to ADD any new neighbors to the canvas.
  // The canvas's accumulatedGraph state merges incoming payloads with
  // the existing visible set instead of replacing — so the graph
  // extends outward as the user explores rather than blanking and
  // rebuilding on every click.
  //
  // Both effects fire together:
  //   1. setSelectedNodeFqn — instant visual focus shift + rail update
  //   2. onRouteAssetChange — URL change → useLineage refetches the
  //      new fqn → canvas merges new nodes/edges into accumulatedGraph
  const handleNodeSelect = (nextNodeFqn) => {
    if (!nextNodeFqn) return;
    setSelectedNodeFqn(nextNodeFqn);
    if (nextNodeFqn !== focusAssetFqn) {
      onRouteAssetChange?.(nextNodeFqn, "Data Lineage");
    }
  };

  // Kept for the rail's explicit "Re-anchor lineage on this node"
  // button as a backup affordance when the user wants to force a
  // fresh fetch (e.g. cache-bust). Identical to handleNodeSelect now
  // that click does both selection + URL change.
  const handleReAnchor = (nextNodeFqn) => {
    if (!nextNodeFqn) return;
    setSelectedNodeFqn(nextNodeFqn);
    onRouteAssetChange?.(nextNodeFqn, "Data Lineage");
  };

  // Used by the empty-state hero search — first-time anchor, no
  // current focus to be smooth about.
  const handleSelectAsset = (nextAssetFqn) => {
    onRouteAssetChange?.(nextAssetFqn, "Data Lineage");
  };

  const handleColumnSelect = (node, column) => {
    if (!node?.fqn || !column?.name) return;
    setSelectedNodeFqn(node.fqn);
    setSelectedColumn({
      assetFqn: node.fqn,
      columnName: column.name,
      type: column.type || "",
    });
  };

  const handleClearFocus = () => {
    setAssetSearchQuery("");
    setSelectedColumn(null);
    setDefaultRouteSuppressed(true);
    onRouteAssetChange?.("", "Data Lineage");
  };

  const handleExportImpactBrief = (packet) => {
    downloadImpactPacket(packet);
    setImpactRequestState({
      loading: false,
      message: "Impact packet exported from the current loaded evidence.",
      error: "",
    });
  };

  const handleCreateImpactRequest = async (payload) => {
    if (!payload?.assetFqn || impactRequestState.loading) return;
    setImpactRequestState({ loading: true, message: "", error: "" });
    try {
      const response = await createGovernanceRequest(payload, { fast: true });
      const requestId = response?.requestId || response?.id || "";
      setImpactRequestState({
        loading: false,
        message: requestId
          ? `Governance request created: ${requestId}`
          : "Governance request created.",
        error: "",
      });
    } catch (error) {
      setImpactRequestState({
        loading: false,
        message: "",
        error: error?.message || "Governance request creation is unavailable.",
      });
    }
  };

  // Track whether we've ever shown a populated canvas this session. Once
  // true, never fall back to the error UI — the canvas's own sticky-graph
  // logic carries us across the transition. This kills the "click =
  // full reload" perception the user reported.
  // CRITICAL: this hook MUST run on every render including the no-focus
  // empty state below — putting it after an early return causes React
  // error #310 ("Rendered fewer hooks than expected") whenever the user
  // navigates from the empty state to a focused asset, because the hook
  // count would change between renders.
  useEffect(() => {
    if (graph.nodes.length > 0 && !canvasEverRendered) {
      setCanvasEverRendered(true);
    }
  }, [graph.nodes.length, canvasEverRendered]);

  if (!focusAssetFqn) {
    return (
      <section className="gh-lineage-shell">
        <LineageHeroEmpty
          loading={assetSearch.loading}
          onQueryChange={setAssetSearchQuery}
          onSearch={handleSelectAsset}
          query={assetSearchQuery}
          recommendations={recommendedAssets}
          recommendationsDegraded={recommendationsDegraded}
          recommendationsError={lineageRecommendations.error}
          recommendationsLoading={lineageRecommendations.loading}
          recommendationsRelationshipVisibilityScope={recommendationsRelationshipVisibilityScope}
          recommendationsVisibilityScope={recommendationsVisibilityScope}
          results={assetSearch.assets}
        />
      </section>
    );
  }

  // Bootstrap can report lineage "unavailable" (e.g. "No lineage-observed
  // catalogs are detected yet") for an asset that the live /api/lineage
  // endpoint *does* return real edges for — the capability check uses a
  // narrower workspace-wide signal than the per-asset query. So if we
  // actually have nodes back from the API, render the canvas regardless
  // of bootstrap pessimism. Only block when both capability is off AND
  // the API returned nothing AND we've never rendered the canvas before.
  if (!lineageSurfaceAvailable && !graph.nodes.length && !canvasEverRendered) {
    return (
      <section className="gh-lineage-shell">
        <LineageHero
          asset={asset}
          edgeCount={null}
          focus={null}
          focusFqn={focusAssetFqn}
          hydrating={false}
          onClear={handleClearFocus}
        />
        <div className="ga-lineage-v2-canvas-state ga-lineage-v2-canvas-state-error">
          <strong>Lineage unavailable</strong>
          <span>{lineageSurfaceUnavailableReason}</span>
        </div>
      </section>
    );
  }

  const zeroEdgeLoaded = Boolean(
    focusAssetFqn &&
      !graph.loading &&
      !graph.hydrating &&
      !graph.error &&
      graph.nodes.length <= 1 &&
      graph.edges.length === 0,
  );
  const visibilityScope = String(
    graph.meta?.visibilityScope ||
      graph.meta?.capabilities?.visibilityScope ||
      graph.payload?.meta?.visibilityScope ||
      "",
  );
  const lineageScopeLabel = visibilityScope.includes("workspace-app-principal")
    ? "workspace-scoped"
    : "actor-visible";

  return (
    <section className="gh-lineage-shell" data-testid="lineage-northstar-explorer">
      <LineageHero
        asset={asset}
        edgeCount={graph.edges.length}
        focus={graph.focus}
        focusFqn={focusAssetFqn}
        hydrating={graph.hydrating}
        onClear={handleClearFocus}
      />
      <div className="ga-lineage-v2-workbench">
        <div className="ga-lineage-v2-workbench-canvas">
          {zeroEdgeLoaded ? (
            <div className="ga-lineage-zero-state" role="status">
              <div>
                <span className="ga-lineage-eyebrow">
                  {lineageScopeLabel === "workspace-scoped" ? "No Workspace-Scoped Lineage" : "No Actor-Visible Lineage"}
                </span>
                <strong>No {lineageScopeLabel} lineage edges returned for this asset.</strong>
                <p>
                  Unity Catalog did not return upstream or downstream table-lineage edges
                  for the selected focus. Open a ranked high-lineage asset below, or keep
                  this asset selected to inspect its unavailable evidence boundaries.
                </p>
              </div>
              <RecommendationList
                compact
                degraded={recommendationsDegraded}
                error={lineageRecommendations.error}
                loading={lineageRecommendations.loading}
                onSelect={handleSelectAsset}
                recommendations={recommendedAssets}
                relationshipVisibilityScope={recommendationsRelationshipVisibilityScope}
                visibilityScope={recommendationsVisibilityScope}
              />
            </div>
          ) : null}
          <LineageCanvasV2
            error={graph.error}
            focusId={focusAssetFqn}
            graph={graph}
            hydrating={graph.hydrating}
            nodeHeaders={nodeHeaders}
            onColumnSelect={handleColumnSelect}
            onFocusChange={handleNodeSelect}
            selectedColumn={selectedColumn}
            selectedNodeFqn={selectedNodeFqn}
          />
        </div>
        <LineageDetailRail
          accessExplain={accessExplain}
          asset={asset}
          columnTrace={columnTrace}
          graph={graph}
          focus={graph.focus}
          impactRequestState={impactRequestState}
          isFocusSelected={!selectedNodeFqn || selectedNodeFqn === focusAssetFqn}
          onCreateImpactRequest={handleCreateImpactRequest}
          onExportImpactBrief={handleExportImpactBrief}
          selectedNode={
            selectedNodeFqn
              ? graph.nodes.find((n) => n.fqn === selectedNodeFqn) || null
              : null
          }
          selectedColumn={selectedColumn}
          quality={quality}
          databricksEvidence={databricksEvidence}
          onOpenAsset={onOpenAsset}
          onReAnchor={handleReAnchor}
          onSelectAsset={handleNodeSelect}
        />
      </div>
    </section>
  );
}
