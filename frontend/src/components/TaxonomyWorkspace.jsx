import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createGovernanceRequest,
  fetchCdeDashboard,
  fetchTaxonomyOverview,
  updateAssetMetadata,
  upsertGovernanceGlossaryTerm,
  upsertGovernanceOwner,
} from "../lib/api";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
import { EmptyStateBlock, LoadingState } from "./ShellStatePrimitives";
import { DegradedBanner, StatusPill } from "./northstar";
import "../styles/operations-pages.css";

const TAXONOMY_CONTEXTS = [
  { key: "classifications", label: "Classifications", singular: "Classification" },
  { key: "domains", label: "Domains", singular: "Domain" },
  { key: "dataProducts", label: "Data Products", singular: "Data Product" },
  { key: "columnGroups", label: "Column Groups", singular: "Column Group" },
];

const DETAIL_TABS = [
  { key: "overview", label: "Overview" },
  { key: "technical", label: "Technical" },
  { key: "history", label: "History" },
  { key: "related", label: "Related" },
];

const STATUS_OPTIONS = ["all", "approved", "draft", "in_review", "proposed", "rejected", "deprecated"];
const TERM_PRIORITY = [
  "net revenue",
  "gross revenue",
  "revenue adjustments",
  "discounts",
  "refunds",
  "surcharges",
  "service revenue",
  "product revenue",
  "subscription revenue",
  "one-time revenue",
  "recurring revenue",
  "contracted revenue",
  "billable amount",
  "deferred revenue",
  "recognized revenue",
  "revenue forecast",
  "revenue recognition date",
  "average revenue",
];
const CDE_PRIORITY = [
  "net revenue usd",
  "net revenue (usd)",
  "customer id",
  "lifetime value usd",
  "lifetime value (usd)",
  "compensation band",
  "order total usd",
  "order total (usd)",
];
// The old UNAVAILABLE_GLOSSARY_TERMS / UNAVAILABLE_CDES fixtures rendered
// FAKE "evidence unavailable" records whenever the payload was empty —
// including during the cold-cache hydration window, when real data was
// seconds away. They were deleted (G6): a hydrating envelope now renders
// skeleton placeholders, and a genuinely empty registry renders an honest
// empty state instead of fabricated rows.

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function envelopeMeta(payload) {
  return payload && typeof payload === "object" ? payload.meta || {} : {};
}

function hydratingEnvelope(payload) {
  const meta = envelopeMeta(payload);
  const capabilities = meta.capabilities && typeof meta.capabilities === "object"
    ? meta.capabilities
    : {};
  const state = text(meta.state || payload?.state).toLowerCase();
  return state === "loading" || capabilities.hydrating === true;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cssVars(value) {
  return /** @type {import("react").CSSProperties} */ (value);
}

function jsonArrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function titleFromValue(value) {
  const normalized = text(value).replace(/[_-]+/g, " ").trim();
  if (!normalized) return "";
  return normalized.replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && text(value) !== "");
}

function evidenceText(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const parts = [
        value.source,
        value.system,
        value.runId || value.workflowId || value.requestId,
        value.observedAt || value.updatedAt || value.reviewedAt,
      ].map(text).filter(Boolean);
      if (parts.length) return parts.join(" · ");
      continue;
    }
    const plain = text(value);
    if (plain) return plain;
  }
  return "";
}

function normalizeStatus(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function compactDate(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusTone(status) {
  const normalized = normalizeStatus(status);
  if (["approved", "certified", "active", "trusted", "healthy"].includes(normalized)) return "good";
  if (normalized.includes("recert") || normalized.includes("due")) return "warn";
  if (["proposed", "in_review", "review", "pending"].includes(normalized)) return "warn";
  if (["rejected", "deprecated", "retired"].includes(normalized)) return "bad";
  return "neutral";
}

function registryLabel(value, fallback = "Unavailable") {
  return titleFromValue(value) || fallback;
}

function registryEvidenceLabel(value, fallback = "Unavailable") {
  return registryLabel(value, fallback);
}

function customerSafeTaxonomySource(value = "") {
  const source = text(value);
  if (!source) return "Governance metadata provenance unavailable";
  if (/^(live|tags)$/i.test(source)) return "Unity Catalog and governance store";
  if (/prototype|mock|fixture|seed/i.test(source)) return "Reference source unavailable";
  return source;
}

function normalizeReviewer(entry, index) {
  if (typeof entry === "string") {
    return {
      id: entry || `reviewer-${index}`,
      email: entry,
      role: "Reviewer",
      state: "active",
    };
  }
  const value = entry && typeof entry === "object" ? entry : {};
  const email = text(
    value.email ||
      value.ownerEmail ||
      value.reviewerEmail ||
      value.reviewedBy ||
      value.name,
  );
  return {
    id: text(value.id) || email || `reviewer-${index}`,
    email,
    role: text(value.role || value.reviewerRole || "Reviewer") || "Reviewer",
    state: text(value.state || value.status || "active") || "active",
    reviewedAt: text(value.reviewedAt || value.updatedAt || value.createdAt),
    note: text(value.note || value.reviewNote),
  };
}

function normalizeAsset(entry, index) {
  const value = entry && typeof entry === "object" ? entry : {};
  const fqn = text(value.assetFqn || value.subjectFqn || value.fqn || value.name || entry);
  const label = text(value.assetLabel || value.label || value.name || fqn.split(".").pop());
  return {
    id: fqn || `asset-${index}`,
    fqn,
    label: label || fqn || "Linked asset",
    type: text(value.assetType || value.type || value.objectType || "Asset"),
    platform: text(value.platform || value.source || value.catalog || ""),
  };
}

function normalizeHistory(entry, index) {
  const value = entry && typeof entry === "object" ? entry : {};
  return {
    id: text(value.id || value.versionId || value.requestId) || `history-${index}`,
    version: text(value.version || value.versionLabel || value.revision || value.label) || `v${index + 1}`,
    title: text(value.title || value.name || value.action) || "Term update",
    changedAt: text(value.changedAt || value.createdAt || value.updatedAt),
    changedBy: text(value.changedBy || value.createdBy || value.updatedBy || value.reviewedBy),
    status: text(value.status || value.state),
    note: text(value.note || value.changeNote || value.detail || value.reviewNote || value.description),
  };
}

function normalizeTerm(item, index) {
  const value = item && typeof item === "object" ? item : {};
  const termId = text(value.termId || value.term_id || value.id) || `term-${index}`;
  const term = text(value.term || value.name || value.title || value.display_name) || "Untitled term";
  const reviewers = arrayValue(value.reviewerRoster || value.reviewerAssignments || value.reviewers).map(
    normalizeReviewer,
  );
  const explicitSteward = reviewers.find((reviewer) =>
    ["steward", "data_steward"].includes(normalizeStatus(reviewer.role)),
  );
  const explicitReview = reviewers.find((reviewer) =>
    ["approver", "reviewer", "steward", "data_steward"].includes(normalizeStatus(reviewer.role)),
  );
  const assets = [
    ...arrayValue(value.assetPreview),
    ...arrayValue(value.assets),
    ...arrayValue(value.linkedAssets),
  ].map(normalizeAsset);
  const uniqueAssets = Array.from(new Map(assets.map((asset) => [asset.id, asset])).values());
  const synonyms = Array.from(
    new Set(
      [
        ...arrayValue(value.synonyms).map(text),
        ...jsonArrayValue(value.synonyms_json).map(text),
      ].filter(Boolean),
    ),
  );
  return {
    ...value,
    termId,
    term,
    parentTermId: text(value.parentTermId || value.parent_term_id),
    definition: text(value.definition || value.description || value.def),
    domain: text(value.domain) || "Unassigned",
    status: normalizeStatus(value.reviewState || value.status || "draft") || "draft",
    synonyms,
    ownerEmail: text(value.ownerEmail || value.owner_email),
    stewardEmail:
      text(value.stewardEmail || value.steward_email || value.steward) ||
      explicitSteward?.email ||
      "",
    reviewedAt:
      text(value.reviewedAt || value.reviewed_at || value.approvedAt || value.approved_at) ||
      explicitReview?.reviewedAt ||
      "",
    reviewers,
    assets: uniqueAssets,
    assetCount:
      Number.isFinite(Number(firstPresent(value.assetCount, value.linkedAssetCount, value.linkedAssets)))
        ? Number(firstPresent(value.assetCount, value.linkedAssetCount, value.linkedAssets))
        : uniqueAssets.length,
    childCount: Number.isFinite(Number(value.childCount)) ? Number(value.childCount) : 0,
    currentVersion: text(value.currentVersion || value.version),
    createdAt: text(value.createdAt || value.created_at),
    createdBy: text(value.createdBy || value.created_by),
    updatedAt: text(value.updatedAt || value.updated_at),
    updatedBy: text(value.updatedBy || value.updated_by),
    termHistory: arrayValue(value.termHistory || value.versionHistory || value.history || value.recentRequests).map(
      normalizeHistory,
    ),
    associationSource: evidenceText(value.associationSource, value.assetAssociationSource, value.summarySource),
    summarySource: evidenceText(value.summarySource, value.source, value.provenance),
  };
}

function normalizeCde(item, index) {
  const value = item && typeof item === "object" ? item : {};
  const id = text(value.id || value.cdeId || value.name) || `cde-${index}`;
  const column = text(value.column || value.sourceColumn || value.source_of_record_column);
  return {
    ...value,
    id,
    name: text(value.name || value.term || value.title) || "Unnamed CDE",
    column,
    // G9: dashboard rows carry the asset FQN as their id; keep it usable.
    assetFqn: text(value.assetFqn || value.fqn) || (id.split(".").filter(Boolean).length >= 3 ? id : ""),
    domain: text(value.domain) || "Unassigned",
    owner: text(value.owner || value.ownerEmail || value.steward || value.stewardEmail) || "Unassigned",
    recert: text(value.recert || value.recertAge || value.reviewAge) || "Unavailable",
    lastReview: text(value.lastReview),
    certification: text(value.certification),
    status: text(value.certification || value.status || value.health || value.state) || "Unavailable",
    sourceBacked: value.sourceBacked === true || Boolean(column),
    recertEvidence: evidenceText(value.recertEvidence, value.recertSource, value.recertWorkflow, value.reviewEvidence),
    healthEvidence: evidenceText(value.healthEvidence, value.qualityEvidence, value.testRun, value.qualityRunId),
    sox: Boolean(value.sox || value.soxRelevant || value.tags?.includes?.("SOX")),
  };
}

function displayCdeName(value) {
  const raw = text(value);
  if (!raw) return "Unnamed CDE";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\busd\b/i, "(USD)")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("(Usd)", "(USD)");
}

function sourceAssetFqnForCde(cde = {}) {
  const explicit = text(cde.assetFqn || cde.fqn || cde.sourceAssetFqn || cde.tableFqn);
  if (explicit) return explicit;
  const column = text(cde.column || cde.sourceColumn || cde.sourceOfRecordColumn);
  const parts = column.split(".").filter(Boolean);
  if (parts.length >= 4) return parts.slice(0, -1).join(".");
  // G9: dashboard rows use the asset FQN itself as the row id. Falling back
  // to it here keeps "Open source asset"/"Open lineage" enabled instead of
  // claiming "no source asset FQN can be derived" for rows that carry one.
  const id = text(cde.id);
  return id.split(".").filter(Boolean).length >= 3 ? id : "";
}

function normalizeDashboardCde(item, index) {
  const value = item && typeof item === "object" ? item : {};
  const fqn = text(value.assetFqn || value.fqn || value.id || value.name) || `cde-${index}`;
  const rawName = text(value.name || value.rawName || fqn.split(".").pop()) || fqn;
  const owner = text(value.owner || value.ownerEmail || value.steward || value.stewardEmail) || "Unassigned";
  const sourceColumn = text(
    value.sourceColumn ||
      value.sourceOfRecordColumn ||
      value.source_of_record_column ||
      value.column ||
      value.columnFqn,
  );
  return {
    id: text(value.id) || fqn || `cde-${index}`,
    // G9: keep the asset FQN on the normalized row — dropping it here is what
    // disabled "Open source asset"/"Open lineage" in the detail panel.
    assetFqn: text(value.assetFqn || value.fqn) || (fqn.includes(".") ? fqn : ""),
    name: displayCdeName(rawName),
    column: sourceColumn,
    domain: text(value.domain) || "Unassigned",
    owner,
    recert:
      text(value.recert || value.recertAge || value.reviewAge || value.reviewWindow) ||
      "Unavailable",
    lastReview: text(value.lastReview),
    certification: text(value.certification),
    // Prefer the real certification over the legacy conflated status field.
    status:
      text(value.certification || value.status || value.health || value.controlState || value.state) ||
      "Unavailable",
    sourceBacked: value.sourceBacked === true || Boolean(sourceColumn),
    recertEvidence: evidenceText(value.recertEvidence, value.recertSource, value.recertWorkflow, value.reviewEvidence),
    healthEvidence: evidenceText(value.healthEvidence, value.qualityEvidence, value.testRun, value.qualityRunId),
    sox: Boolean(value.sox || value.soxRelevant || value.tags?.includes?.("SOX")),
  };
}

function termSourceSummary(term = {}) {
  return customerSafeTaxonomySource(term.summarySource || term.source || term.associationSource);
}

function termAssociationSummary(term = {}) {
  // G10/G11: plain counts — the old "actor visibility not verified" and
  // "Association evidence unavailable" hedges read as system errors.
  const count = Number(term.assetCount || 0);
  if (count > 0) return `${count.toLocaleString()} linked asset${count === 1 ? "" : "s"}`;
  return "No assets linked yet";
}

function termReviewSummary(term = {}) {
  if (term.reviewedAt) return `Reviewed ${compactDate(term.reviewedAt) || term.reviewedAt}`;
  // G12: derive review recency from the latest version row when no explicit
  // reviewedAt exists. Only call it "Reviewed" when that row actually
  // carries an approved/reviewed status — otherwise it's just an update.
  const latest = arrayValue(term.termHistory).find((entry) => text(entry?.changedAt));
  if (latest) {
    const approved = ["approved", "reviewed", "certified"].includes(normalizeStatus(latest.status));
    return `${approved ? "Reviewed" : "Updated"} ${compactDate(latest.changedAt) || latest.changedAt}`;
  }
  if (term.reviewers?.length) {
    return `${term.reviewers.length} reviewer${term.reviewers.length === 1 ? "" : "s"} assigned`;
  }
  return "Not yet reviewed";
}

function cdeRecertEvidenceSummary(cde = {}) {
  return text(cde.recertEvidence) || "Recertification workflow evidence unavailable";
}

function cdeHealthEvidenceSummary(cde = {}) {
  return text(cde.healthEvidence) || "Quality/test-run evidence unavailable";
}

function cdeSourceSummary(cde = {}) {
  // G4/G13: source backing is its own signal now — not conflated into the
  // certification status. Untagged rows get actionable copy, not a dead pill.
  return cde.sourceBacked || cde.column
    ? "Source: tagged column"
    : "Source: not tagged — tag cde_source_column on the asset";
}

function cdeLastReviewSummary(cde = {}) {
  const raw = text(cde.lastReview);
  if (!raw || raw.toLowerCase() === "unavailable") return "No review recorded yet";
  return `Reviewed ${compactDate(raw) || raw}`;
}

function cdesFromDashboardPayload(payload) {
  const dashboard = envelopeData(payload) || {};
  const byId = new Map();
  arrayValue(dashboard.items).forEach((item, index) => {
    const normalized = normalizeDashboardCde(item, index);
    byId.set(normalized.id, normalized);
  });
  arrayValue(dashboard.groups).forEach((group) => {
    arrayValue(group.items).forEach((item, index) => {
      const normalized = normalizeDashboardCde({ ...item, domain: item.domain || group.domain }, index);
      byId.set(normalized.id, normalized);
    });
  });
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function cdePriorityRank(cde) {
  const normalizedName = text(cde.name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedColumn = text(cde.column).toLowerCase();
  const exactRank = CDE_PRIORITY.indexOf(normalizedName);
  if (exactRank >= 0) return exactRank;
  const containsRank = CDE_PRIORITY.findIndex((label) => normalizedName.includes(label.replace(/[()]/g, "").trim()));
  if (containsRank >= 0) return containsRank;
  if (normalizedColumn.includes("net_revenue")) return 0;
  if (normalizedColumn.includes("customer_id")) return 1;
  if (normalizedColumn.includes("lifetime_value")) return 2;
  if (normalizedColumn.includes("compensation_band")) return 3;
  if (normalizedColumn.includes("gross_total") || normalizedColumn.includes("order_total")) return 4;
  return CDE_PRIORITY.length;
}

function activeRegistryTabLoading(tab, glossaryLoading, cdeLoading, terms, cdes) {
  if (tab === "cdes") return Boolean(cdeLoading && !cdes.length);
  return Boolean(glossaryLoading && !terms.length);
}

function normalizeRow(item, index, keys) {
  const value = item && typeof item === "object" ? item : {};
  const id = text(keys.map((key) => value[key]).find(Boolean)) || `row-${index}`;
  const count = firstPresent(value.term_count, value.member_count, value.asset_count);
  return {
    ...value,
    id,
    label: text(value.display_name || value.displayName || value.name || value.title) || id,
    description: text(value.description),
    count: Number.isFinite(Number(count))
      ? Number(count)
      : null,
    parentId: text(value.parent_domain_id || value.parentTermId || value.parent_term_id),
    state: text(value.state),
  };
}

function normalizeOverview(payload) {
  const overview = envelopeData(payload) || {};
  const terms = arrayValue(overview.glossaryTerms).map(normalizeTerm);
  return {
    classifications: arrayValue(overview.classifications).map((row, index) =>
      normalizeRow(row, index, ["classification_id", "classificationId", "id"]),
    ),
    domains: arrayValue(overview.domains).map((row, index) =>
      normalizeRow(row, index, ["domain_id", "domainId", "id"]),
    ),
    dataProducts: arrayValue(overview.dataProducts).map((row, index) =>
      normalizeRow(row, index, ["data_product_id", "dataProductId", "id"]),
    ),
    columnGroups: arrayValue(overview.columnGroups).map((row, index) =>
      normalizeRow(row, index, ["group_id", "groupId", "id"]),
    ),
    classificationTerms: arrayValue(overview.classificationTerms).map((row, index) =>
      normalizeRow(row, index, ["term_id", "termId", "id"]),
    ),
    cdes: arrayValue(overview.cdes || overview.criticalDataElements || overview.criticalDataElementRegistry).map(
      normalizeCde,
    ),
    glossaryTerms: terms,
    summary: overview.summary || { termCount: terms.length },
    meta: envelopeMeta(payload),
  };
}

function termStatusRank(term = {}) {
  // G2: approved/linked terms lead the registry so leftover draft/test rows
  // (e.g. "Atlas Test Term") never occupy the first card slot.
  const normalized = normalizeStatus(term.status);
  if (["approved", "certified", "active"].includes(normalized)) return 0;
  if (["in_review", "proposed", "review", "pending"].includes(normalized)) return 1;
  if (normalized === "draft") return 2;
  return 3;
}

function sortTermsForDisplay(terms) {
  return [...terms].sort((left, right) => {
    const leftPriority = TERM_PRIORITY.indexOf(left.term.toLowerCase());
    const rightPriority = TERM_PRIORITY.indexOf(right.term.toLowerCase());
    const leftRank = leftPriority >= 0 ? leftPriority : TERM_PRIORITY.length;
    const rightRank = rightPriority >= 0 ? rightPriority : TERM_PRIORITY.length;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const statusDelta = termStatusRank(left) - termStatusRank(right);
    if (statusDelta) return statusDelta;
    const linkedDelta = Number(Boolean(right.assetCount)) - Number(Boolean(left.assetCount));
    if (linkedDelta) return linkedDelta;
    return left.term.localeCompare(right.term);
  });
}

function initials(value) {
  const email = text(value);
  if (!email) return "NA";
  const local = email.split("@")[0] || email;
  const parts = local.split(/[._\-\s]+/).filter(Boolean);
  return (parts[0]?.[0] || local[0] || "N") + (parts[1]?.[0] || parts[0]?.[1] || "A");
}

function termMatchesContext(term, activeContext, selectedNode) {
  if (!term) return false;
  if (!selectedNode || selectedNode.kind === "all") return true;
  if (activeContext === "classifications") {
    const explicitTaxonomyIds = new Set(arrayValue(selectedNode.taxonomyTermIds).map(text).filter(Boolean));
    if (!explicitTaxonomyIds.size) return false;
    return explicitTaxonomyIds.has(term.parentTermId);
  }
  const nodeLabel = selectedNode.label.toLowerCase();
  const nodeDomain = text(selectedNode.domainLabel).toLowerCase();
  if (activeContext === "domains") return term.domain.toLowerCase() === nodeLabel;
  if (activeContext === "dataProducts") {
    return term.assets.some((asset) => asset.label.toLowerCase().includes(nodeLabel));
  }
  if (activeContext === "columnGroups") return false;
  return (nodeDomain && term.domain.toLowerCase() === nodeDomain) || term.domain.toLowerCase() === nodeLabel;
}

function buildTreeItems(overview, activeContext) {
  if (activeContext === "classifications" && overview.classificationTerms.length) {
    const hierarchyClassification =
      overview.classifications.find((classification) => /taxonomy|business/i.test(classification.id)) ||
      overview.classifications[0];
    const hierarchyClassificationId = hierarchyClassification?.id || "";
    const termRows = hierarchyClassificationId
      ? overview.classificationTerms.filter((row) =>
          text(row.classification_id || row.classificationId).toLowerCase() === hierarchyClassificationId.toLowerCase(),
        )
      : overview.classificationTerms;
    const childLookup = new Map();
    for (const row of termRows) {
      const parent = text(row.parentTermId || row.parent_term_id) || "__root__";
      if (!childLookup.has(parent)) childLookup.set(parent, []);
      childLookup.get(parent).push(row);
    }
    const descendantIdsFor = (rootId) => {
      const ids = new Set();
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop();
        if (!id || ids.has(id)) continue;
        ids.add(id);
        for (const child of childLookup.get(id) || []) {
          stack.push(child.id);
        }
      }
      return Array.from(ids);
    };
    const countFor = (taxonomyTermIds) => {
      const ids = new Set(taxonomyTermIds);
      return overview.glossaryTerms.filter((term) => ids.has(term.parentTermId)).length;
    };
    const output = [];
    const visit = (row, depth, domainLabel = "") => {
      const nextDomainLabel = depth === 1 ? row.label : domainLabel;
      const taxonomyTermIds = descendantIdsFor(row.id);
      const count = countFor(taxonomyTermIds);
      const children = childLookup.get(row.id) || [];
      output.push({
        id: row.id,
        label: row.label,
        description: row.description,
        count,
        kind: activeContext,
        live: true,
        depth,
        domainLabel,
        taxonomyTermIds,
        preferred: row.label.toLowerCase() === "revenue",
      });
      for (const child of children) {
        visit(child, depth + 1, nextDomainLabel);
      }
    };
    for (const root of childLookup.get("__root__") || []) {
      visit(root, 0, "");
    }
    return output;
  }

  const sourceRows = overview[activeContext] || [];
  if (sourceRows.length) {
    return sourceRows.map((row) => ({
      id: row.id,
      label: row.label,
      description: row.description,
      count: row.count,
      kind: activeContext,
      live: true,
    }));
  }

  const domains = Array.from(
    new Map(
      overview.glossaryTerms
        .filter((term) => term.domain && term.domain !== "Unassigned")
        .map((term) => [term.domain.toLowerCase(), term.domain]),
    ).values(),
  );
  if (activeContext === "domains" && domains.length) {
    return domains.map((domain) => ({
      id: `derived-domain-${domain}`,
      label: domain,
      count: overview.glossaryTerms.filter((term) => term.domain === domain).length,
      kind: "domains",
      live: true,
      derived: true,
    }));
  }

  return [];
}

function initialRegistryTabFromLocation() {
  if (typeof window === "undefined") return "glossary";
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("tab") === "cdes" ? "cdes" : "glossary";
  } catch {
    return "glossary";
  }
}

export default function TaxonomyWorkspace({
  onOpenAsset = undefined,
  onOpenLineage = undefined,
  onSurfaceReady = undefined,
  taxonomyOverride = null,
}) {
  const useRegistryWorkspace = true;
  const [registryTab, setRegistryTab] = useState(initialRegistryTabFromLocation);
  const [registryActionMessage, setRegistryActionMessage] = useState("");
  const [activeContext, setActiveContext] = useState("classifications");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedTermId, setSelectedTermId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");

  const overviewQuery = useQuery({
    queryKey: ["atlas", "taxonomy-overview"],
    queryFn: ({ signal }) => fetchTaxonomyOverview({ signal }),
    staleTime: 60_000,
    refetchInterval: (query) => hydratingEnvelope(query?.state?.data) ? 3_000 : false,
    enabled: !taxonomyOverride,
  });
  const cdeDashboardQuery = useQuery({
    queryKey: ["atlas", "taxonomy-cde-dashboard"],
    queryFn: ({ signal }) => fetchCdeDashboard({ signal }),
    staleTime: 60_000,
    refetchInterval: (query) => hydratingEnvelope(query?.state?.data) ? 3_000 : false,
    enabled: !taxonomyOverride,
  });

  const payload = taxonomyOverride || overviewQuery.data;
  const nonAuthoritativeTaxonomyPayload = isNonAuthoritativeMockEvidence(payload, payload?.meta, payload?.warnings);
  const nonAuthoritativeCdePayload = isNonAuthoritativeMockEvidence(
    cdeDashboardQuery.data,
    cdeDashboardQuery.data?.meta,
    cdeDashboardQuery.data?.warnings,
  );
  const overview = useMemo(
    () =>
      nonAuthoritativeTaxonomyPayload
        ? normalizeOverview({
            data: {},
            meta: {
              state: "non_authoritative",
              warnings: ["Non-authoritative glossary and taxonomy payload rejected."],
            },
          })
        : normalizeOverview(payload),
    [nonAuthoritativeTaxonomyPayload, payload],
  );
  const registryCdes = useMemo(() => {
    if (overview.cdes.length) return overview.cdes;
    if (nonAuthoritativeCdePayload) return [];
    return cdesFromDashboardPayload(cdeDashboardQuery.data);
  }, [cdeDashboardQuery.data, nonAuthoritativeCdePayload, overview.cdes]);
  const treeItems = useMemo(
    () => buildTreeItems(overview, activeContext),
    [activeContext, overview],
  );
  const preferredTreeItem = useMemo(
    () => treeItems.find((item) => item.preferred) || treeItems.find((item) => item.count > 0) || treeItems[0],
    [treeItems],
  );
  const selectedNode = useMemo(() => {
    if (selectedNodeId === "all" || !treeItems.length) {
      return { id: "all", label: "All Terms", kind: "all", count: overview.glossaryTerms.length };
    }
    return treeItems.find((item) => item.id === selectedNodeId) || preferredTreeItem || {
      id: "all",
      label: "All Terms",
      kind: "all",
      count: overview.glossaryTerms.length,
    };
  }, [overview.glossaryTerms.length, preferredTreeItem, selectedNodeId, treeItems]);

  const contextTerms = useMemo(
    () => overview.glossaryTerms.filter((term) => termMatchesContext(term, activeContext, selectedNode)),
    [activeContext, overview.glossaryTerms, selectedNode],
  );
  const filteredTerms = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = contextTerms.filter((term) => {
      if (statusFilter !== "all" && term.status !== statusFilter) return false;
      if (!query) return true;
      return [term.term, term.definition, term.domain, term.ownerEmail, term.stewardEmail]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    return sortTermsForDisplay(matches);
  }, [contextTerms, search, statusFilter]);

  const selectedTerm = useMemo(
    () =>
      filteredTerms.find((term) => term.termId === selectedTermId) ||
      contextTerms.find((term) => term.termId === selectedTermId) ||
      filteredTerms.find((term) => term.term.toLowerCase() === "net revenue") ||
      contextTerms.find((term) => term.term.toLowerCase() === "net revenue") ||
      filteredTerms[0] ||
      contextTerms[0] ||
      null,
    [contextTerms, filteredTerms, selectedTermId],
  );

  useEffect(() => {
    if (!treeItems.length) {
      setSelectedNodeId("all");
      return;
    }
    if (!treeItems.some((item) => item.id === selectedNodeId)) {
      setSelectedNodeId((preferredTreeItem || treeItems[0]).id);
    }
  }, [preferredTreeItem, selectedNodeId, treeItems]);

  useEffect(() => {
    if (selectedTerm?.termId && selectedTerm.termId !== selectedTermId) {
      setSelectedTermId(selectedTerm.termId);
    }
  }, [selectedTerm, selectedTermId]);

  useEffect(() => {
    if (!overviewQuery.isPending && (!useRegistryWorkspace || !cdeDashboardQuery.isPending)) onSurfaceReady?.();
  }, [cdeDashboardQuery.isPending, onSurfaceReady, overviewQuery.isPending, useRegistryWorkspace]);

  const meta = {
    ...(overview.meta || {}),
    warnings: [
      ...arrayValue(overview.meta?.warnings),
      ...(nonAuthoritativeCdePayload ? ["Non-authoritative CDE dashboard payload rejected."] : []),
    ],
  };
  // G6: a cold cache returns a real envelope with meta.state === "loading"
  // (hydrating). isPending alone misses that window, which used to flip the
  // registry into fake "evidence unavailable" records while data was seconds
  // away. Treat the hydrating envelope as loading.
  const loading = (overviewQuery.isPending && !taxonomyOverride) || hydratingEnvelope(payload);
  // The CDE list can arrive on either envelope (overview.cdes or the CDE
  // dashboard), so a hydrating overview also counts as CDE loading.
  const cdeLoading =
    ((cdeDashboardQuery.isPending && !taxonomyOverride) ||
      hydratingEnvelope(cdeDashboardQuery.data) ||
      hydratingEnvelope(payload)) &&
    !overview.cdes.length;
  const error = overviewQuery.error?.message || "";
  const cdeError = cdeDashboardQuery.error?.message || "";
  const sourceUnavailable = {
    classifications: !overview.classifications.length,
    domains: !overview.domains.length,
    dataProducts: !overview.dataProducts.length,
    columnGroups: !overview.columnGroups.length,
  };
  const changeRegistryTab = (nextTab) => {
    const normalized = nextTab === "cdes" ? "cdes" : "glossary";
    setRegistryTab(normalized);
    setRegistryActionMessage("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (normalized === "cdes") url.searchParams.set("tab", "cdes");
      else url.searchParams.delete("tab");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  if (useRegistryWorkspace) {
    return (
      <GlossaryCdeRegistry
        cdes={registryCdes}
        error={error || cdeError}
        loading={activeRegistryTabLoading(registryTab, loading, cdeLoading, overview.glossaryTerms, registryCdes)}
        meta={meta}
        onActionMessage={setRegistryActionMessage}
        onOpenAsset={onOpenAsset}
        onOpenLineage={onOpenLineage}
        onTabChange={changeRegistryTab}
        statusMessage={registryActionMessage}
        tab={registryTab}
        terms={overview.glossaryTerms}
      />
    );
  }

  return (
    <section className="ga-page gh-taxonomy-ns" data-testid="taxonomy-northstar">
      <div className="gh-taxonomy-ns-inner">
        <header className="gh-taxonomy-ns-hero">
          <h1>Business Taxonomy &amp; Glossary</h1>
          <p>Organize and govern the business language of your organization.</p>
        </header>
        <DegradedBanner meta={meta} />
        {error ? (
          <EmptyStateBlock title="Taxonomy unavailable" message={error} />
        ) : null}
        {loading ? (
          <LoadingState message="Loading taxonomy overview..." />
        ) : null}
        <div className="gh-taxonomy-ns-layout">
          <TaxonomyRail
            activeContext={activeContext}
            onContextChange={(nextContext) => {
              setActiveContext(nextContext);
              setSelectedNodeId("");
              setSearch("");
              setStatusFilter("all");
            }}
            overview={overview}
            selectedNode={selectedNode}
            setSelectedNodeId={setSelectedNodeId}
            sourceUnavailable={sourceUnavailable}
            treeItems={treeItems}
          />
          <TermsPanel
            contextLabel={selectedNode.label}
            filterOpen={filterOpen}
            filteredTerms={filteredTerms}
            onFilterOpen={setFilterOpen}
            onSearch={setSearch}
            onSelectTerm={(termId) => setSelectedTermId(termId)}
            onStatusFilter={setStatusFilter}
            search={search}
            selectedTermId={selectedTerm?.termId || ""}
            statusFilter={statusFilter}
            totalTerms={contextTerms.length}
          />
          <TermDetailPanel
            activeContext={activeContext}
            allTerms={overview.glossaryTerms}
            classifications={overview.classifications}
            classificationTerms={overview.classificationTerms}
            dataProducts={overview.dataProducts}
            domains={overview.domains}
            onOpenAsset={onOpenAsset}
            detailTab={detailTab}
            onDetailTab={setDetailTab}
            selectedNode={selectedNode}
            selectedTerm={selectedTerm}
          />
        </div>
      </div>
    </section>
  );
}

function GlossaryCdeRegistry({
  cdes,
  error,
  loading,
  meta,
  onActionMessage,
  onOpenAsset,
  onOpenLineage,
  onTabChange,
  statusMessage,
  tab,
  terms,
}) {
  const glossaryCount = terms.length;
  const cdeCount = cdes.length;
  const activeTab = tab === "cdes" ? "cdes" : "glossary";
  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedCdeId, setSelectedCdeId] = useState("");
  const [associationBrowserTermId, setAssociationBrowserTermId] = useState("");
  // G1: render every governed term (the payload already carries them all —
  // the old `terms.slice(0, 4)` silently hid 17 of 21) with a client-side
  // search over name/definition/domain.
  const [termQuery, setTermQuery] = useState("");
  // G3: full CDE registry with a client-side domain filter.
  const [cdeDomainFilter, setCdeDomainFilter] = useState("all");
  // New-term modal state. The glossary backend (POST /governance/glossary)
  // accepts a draft directly — there's no workflow gate. The previous
  // "unavailable until configured" placeholder was misleading.
  const [newTermOpen, setNewTermOpen] = useState(false);
  const [newTermDraft, setNewTermDraft] = useState({
    name: "",
    definition: "",
    domain: "",
    ownerEmail: "",
  });
  const [newTermSaving, setNewTermSaving] = useState(false);
  const [newTermError, setNewTermError] = useState("");
  // G7: "+ New CDE" flags an asset via the asset-metadata PATCH path
  // (AssetMetadataPatch.isCde / cdeRationale) — see atlas/api/cde.py.
  const [newCdeOpen, setNewCdeOpen] = useState(false);
  const [newCdeDraft, setNewCdeDraft] = useState({ assetFqn: "", rationale: "" });
  const [newCdeSaving, setNewCdeSaving] = useState(false);
  const [newCdeError, setNewCdeError] = useState("");
  const queryClient = useQueryClient();

  const handleSubmitNewTerm = async (event) => {
    event.preventDefault();
    if (newTermSaving) return;
    const name = String(newTermDraft.name || "").trim();
    if (!name) {
      setNewTermError("Term name is required.");
      return;
    }
    setNewTermSaving(true);
    setNewTermError("");
    try {
      await upsertGovernanceGlossaryTerm({
        termId: "",
        name,
        definition: String(newTermDraft.definition || "").trim(),
        domain: String(newTermDraft.domain || "").trim(),
        ownerEmail: String(newTermDraft.ownerEmail || "").trim(),
        status: "draft",
      });
      // Invalidate the taxonomy + glossary queries so the new term appears.
      // Key must match the useQuery key above (["atlas", "taxonomy-overview"]);
      // the old ["taxonomyOverview"] key never matched anything.
      queryClient.invalidateQueries({ queryKey: ["atlas", "taxonomy-overview"] });
      queryClient.invalidateQueries({ queryKey: ["governance", "glossary"] });
      onActionMessage(`Glossary term “${name}” created with status Draft.`);
      setNewTermDraft({ name: "", definition: "", domain: "", ownerEmail: "" });
      setNewTermOpen(false);
    } catch (err) {
      const message = err?.message || "Failed to create term — please try again.";
      setNewTermError(message);
    } finally {
      setNewTermSaving(false);
    }
  };
  const handleSubmitNewCde = async (event) => {
    event.preventDefault();
    if (newCdeSaving) return;
    const assetFqn = String(newCdeDraft.assetFqn || "").trim();
    // Minimal shape check: a Unity Catalog asset FQN is catalog.schema.table.
    if (assetFqn.split(".").filter(Boolean).length < 3) {
      setNewCdeError("Enter a full asset FQN (catalog.schema.table).");
      return;
    }
    setNewCdeSaving(true);
    setNewCdeError("");
    try {
      await updateAssetMetadata(assetFqn, {
        isCde: true,
        cdeRationale: String(newCdeDraft.rationale || "").trim(),
      });
      // Refresh both registry sources so the newly flagged CDE appears.
      queryClient.invalidateQueries({ queryKey: ["atlas", "taxonomy-cde-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["atlas", "taxonomy-overview"] });
      onActionMessage(`${assetFqn} flagged as a Critical Data Element.`);
      setNewCdeDraft({ assetFqn: "", rationale: "" });
      setNewCdeOpen(false);
    } catch (err) {
      setNewCdeError(err?.message || "Failed to flag the asset as a CDE — please try again.");
    } finally {
      setNewCdeSaving(false);
    }
  };
  const sortedTerms = useMemo(() => sortTermsForDisplay(terms), [terms]);
  const visibleTerms = useMemo(() => {
    const query = termQuery.trim().toLowerCase();
    if (!query) return sortedTerms;
    return sortedTerms.filter((term) =>
      [term.term, term.definition, term.domain].join(" ").toLowerCase().includes(query),
    );
  }, [sortedTerms, termQuery]);
  const filteredCdes = useMemo(
    () => [...cdes].sort((left, right) =>
      cdePriorityRank(left) - cdePriorityRank(right) || text(left.name).localeCompare(text(right.name)),
    ),
    [cdes],
  );
  const cdeDomains = useMemo(
    () => Array.from(new Set(filteredCdes.map((cde) => text(cde.domain) || "Unassigned"))).sort(),
    [filteredCdes],
  );
  const visibleCdes = useMemo(
    () =>
      cdeDomainFilter === "all"
        ? filteredCdes
        : filteredCdes.filter((cde) => (text(cde.domain) || "Unassigned") === cdeDomainFilter),
    [cdeDomainFilter, filteredCdes],
  );
  const displayTerms = visibleTerms;
  const displayCdes = visibleCdes;
  const selectedTerm = terms.find((term) => term.termId === selectedTermId) || null;
  const selectedCde = cdes.find((cde) => cde.id === selectedCdeId) || null;
  const termLookup = useMemo(
    () => new Map(terms.map((term) => [term.termId, term])),
    [terms],
  );
  const hierarchyRows = visibleTerms.map((term) => {
    // G10: show the real parent term name when the lookup resolves; fall
    // back to the raw parent id rather than the vague "Parent term recorded".
    const parent = term.parentTermId
      ? termLookup.get(term.parentTermId)?.term || term.parentTermId
      : "Root term";
    const children = Number(term.childCount || 0);
    return {
      id: term.termId,
      term: term.term,
      parent,
      children: children ? `${children.toLocaleString()} child term${children === 1 ? "" : "s"}` : "No child terms recorded",
    };
  });
  const openTermDetail = (term, options = {}) => {
    setSelectedTermId(term.termId);
    setAssociationBrowserTermId(options.showAssociations ? term.termId : "");
    onActionMessage(`${term.term} selected. Review source, ownership, associations, and lineage.`);
  };
  const openCdeDetail = (cde) => {
    setSelectedCdeId(cde.id);
    onActionMessage(`${cde.name} selected. Review source-of-record column, owner, recertification, and status.`);
  };
  useEffect(() => {
    if (selectedTermId && !terms.some((term) => term.termId === selectedTermId)) {
      setSelectedTermId("");
      setAssociationBrowserTermId("");
    }
  }, [selectedTermId, terms]);
  useEffect(() => {
    if (selectedCdeId && !cdes.some((cde) => cde.id === selectedCdeId)) {
      setSelectedCdeId("");
    }
  }, [selectedCdeId, cdes]);
  return (
    <section className="ga-page gh-taxonomy-ns gh-taxonomy-prototype" data-testid="taxonomy-northstar">
      <div className="gh-taxonomy-prototype-shell">
        <header className="gh-taxonomy-prototype-hero">
          <div>
            <span className="gh-taxonomy-prototype-eyebrow">Glossary &amp; CDE Registry</span>
            <h1>Shared business meaning, anchored to data</h1>
            <p>Glossary terms link to source-of-record assets. Critical Data Elements have stricter ownership, certification, and lineage requirements.</p>
          </div>
          <button
            className="gh-taxonomy-prototype-new"
            onClick={() => {
              if (activeTab === "cdes") {
                // G7: flag an asset as a CDE through the backed
                // asset-metadata PATCH path instead of a dead toast.
                setNewCdeError("");
                setNewCdeOpen(true);
                return;
              }
              setNewTermError("");
              setNewTermOpen(true);
            }}
            title={
              activeTab === "cdes"
                ? "Flag an asset as a Critical Data Element"
                : "Open the New term form"
            }
            type="button"
          >
            + {activeTab === "cdes" ? "New CDE" : "New term"}
          </button>
        </header>

        <DegradedBanner meta={meta} />
        {error ? <EmptyStateBlock title="Glossary registry unavailable" message={error} /> : null}
        {loading ? <LoadingState message="Loading glossary registry..." /> : null}
        {statusMessage ? (
          <div className="gh-taxonomy-prototype-status" role="status">
            {statusMessage}
          </div>
        ) : null}

        <div className="gh-taxonomy-prototype-tabs" role="tablist" aria-label="Glossary and CDE registry">
          <button
            aria-selected={activeTab === "glossary"}
            className={activeTab === "glossary" ? "is-active" : ""}
            onClick={() => onTabChange("glossary")}
            role="tab"
            type="button"
          >
            Glossary <span>{glossaryCount}</span>
          </button>
          <button
            aria-selected={activeTab === "cdes"}
            className={activeTab === "cdes" ? "is-active" : ""}
            onClick={() => onTabChange("cdes")}
            role="tab"
            type="button"
          >
            CDE Registry <span>{cdeCount}</span>
          </button>
        </div>

        {activeTab === "glossary" ? (
          <div className="gh-taxonomy-prototype-section">
            <label className="gh-taxonomy-search">
              <span aria-hidden="true" />
              <input
                aria-label="Search glossary terms"
                onChange={(event) => setTermQuery(event.target.value)}
                placeholder="Search terms by name, definition, or domain..."
                type="search"
                value={termQuery}
              />
            </label>
            <p className="gh-taxonomy-prototype-cde-provenance" role="status">
              Showing {visibleTerms.length} of {glossaryCount} governed glossary terms
            </p>
          {hierarchyRows.length ? (
            <div className="gh-taxonomy-prototype-hierarchy" aria-label="Glossary hierarchy">
              <div className="gh-taxonomy-prototype-hierarchy-head">
                <span>Hierarchy</span>
                <strong>{`${visibleTerms.length} visible terms`}</strong>
              </div>
              <div className="gh-taxonomy-prototype-hierarchy-grid">
                {hierarchyRows.map((row) => (
                  <div key={row.id}>
                    <span>{row.parent}</span>
                    <strong>{row.term}</strong>
                    <small>{row.children}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {loading && !terms.length ? (
            /* G6: hydrating envelope → skeleton placeholders, never fake
               "evidence unavailable" records. */
            <div aria-busy="true" aria-label="Loading glossary terms" className="gh-taxonomy-prototype-card-grid">
              {Array.from({ length: 4 }, (_, index) => (
                <article aria-hidden="true" className="gh-taxonomy-prototype-card is-unavailable" key={`term-skeleton-${index}`}>
                  <div className="gh-taxonomy-prototype-card-head">
                    <div>
                      <h2>Loading…</h2>
                      <span>Fetching glossary terms</span>
                    </div>
                  </div>
                  <p>Glossary evidence is loading from the governance store.</p>
                </article>
              ))}
            </div>
          ) : !displayTerms.length ? (
            <EmptyStateBlock
              title={terms.length ? "No terms match this search" : "No glossary terms yet"}
              message={
                terms.length
                  ? "Adjust or clear the search to see all governed terms."
                  : "Create the first governed term with + New term."
              }
            />
          ) : (
          <div className="gh-taxonomy-prototype-card-grid" aria-label="Glossary cards">
            {displayTerms.map((term) => (
                <article
                  className={`gh-taxonomy-prototype-card ${selectedTerm?.termId === term.termId ? "is-selected" : ""}`.trim()}
                  key={term.termId}
                  onClick={() => {
                    openTermDetail(term);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openTermDetail(term);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="gh-taxonomy-prototype-card-head">
                    <div>
                      <h2>{term.term}</h2>
                      <span>{`${term.domain} · ${term.stewardEmail || term.ownerEmail || "Unassigned steward"}`}</span>
                    </div>
                    <StatusPill tone={statusTone(term.status)}>
                      {registryLabel(term.status, "Draft")}
                    </StatusPill>
                  </div>
                  <p>{term.definition || "No live definition recorded for this term."}</p>
                  <dl className="gh-taxonomy-prototype-card-proof" aria-label={`${term.term} provenance`}>
                    <div><dt>Source</dt><dd>{termSourceSummary(term)}</dd></div>
                    <div><dt>Associations</dt><dd>{termAssociationSummary(term)}</dd></div>
                    <div><dt>Review</dt><dd>{termReviewSummary(term)}</dd></div>
                  </dl>
                  <div className="gh-taxonomy-prototype-card-foot">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        openTermDetail(term, { showAssociations: true });
                      }}
                      title={term.assets[0]?.fqn ? "Browse associated assets" : "Open association detail; no linked assets are recorded for this term"}
                      type="button"
                    >
                      {term.assetCount || 0} assets
                    </button>
                    <button
                      disabled={!term.assets[0]?.fqn}
                      onClick={(event) => {
                        event.stopPropagation();
                        const target = term.assets[0]?.fqn;
                        if (target && onOpenLineage) onOpenLineage(target, "Data Lineage");
                        else if (target) onOpenAsset?.(target, "Lineage");
                      }}
                      title={term.assets[0]?.fqn ? "Open lineage for the first linked asset" : "Lineage requires at least one associated asset"}
                      type="button"
                    >
                      Preview lineage -&gt;
                    </button>
                  </div>
                </article>
              ))}
          </div>
          )}
          {selectedTerm ? (
            <TermRegistryDetail
              associationBrowserOpen={associationBrowserTermId === selectedTerm.termId}
              onActionMessage={onActionMessage}
              onClose={() => setSelectedTermId("")}
              onOpenAsset={onOpenAsset}
              onOpenLineage={onOpenLineage}
              term={selectedTerm}
              termLookup={termLookup}
            />
          ) : null}
          </div>
        ) : (
          <div className="gh-taxonomy-prototype-section">
            {cdeDomains.length > 1 ? (
              <div className="gh-taxonomy-prototype-tabs" role="group" aria-label="Filter CDEs by domain">
                <button
                  aria-pressed={cdeDomainFilter === "all"}
                  className={cdeDomainFilter === "all" ? "is-active" : ""}
                  onClick={() => setCdeDomainFilter("all")}
                  type="button"
                >
                  All domains <span>{filteredCdes.length}</span>
                </button>
                {cdeDomains.map((domain) => (
                  <button
                    aria-pressed={cdeDomainFilter === domain}
                    className={cdeDomainFilter === domain ? "is-active" : ""}
                    key={domain}
                    onClick={() => setCdeDomainFilter(domain)}
                    type="button"
                  >
                    {domain} <span>{filteredCdes.filter((cde) => (text(cde.domain) || "Unassigned") === domain).length}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="gh-taxonomy-prototype-cde-provenance" role="status">
              Showing {visibleCdes.length} of {filteredCdes.length} CDE registry rows
            </p>
          <div className="gh-taxonomy-prototype-cde-table" role="table" aria-label="CDE registry table">
            <div className="gh-taxonomy-prototype-cde-head" role="row">
              <span role="columnheader">CDE</span>
              <span role="columnheader">Source-of-record column</span>
              <span role="columnheader">Owner</span>
              <span role="columnheader">Recert</span>
              <span role="columnheader">Certification</span>
            </div>
            {loading && !cdes.length ? (
              /* G6: hydrating envelope → skeleton rows, never fake records. */
              Array.from({ length: 5 }, (_, index) => (
                <div
                  aria-hidden="true"
                  className="gh-taxonomy-prototype-cde-row is-unavailable"
                  key={`cde-skeleton-${index}`}
                >
                  <span role="cell">
                    <i aria-hidden="true" className="gh-taxonomy-prototype-key-icon" />
                    <strong>Loading…</strong>
                  </span>
                  <span role="cell" className="is-mono">Fetching CDE registry rows</span>
                  <span role="cell" />
                  <span role="cell" />
                  <span role="cell" />
                </div>
              ))
            ) : !displayCdes.length ? (
              <EmptyStateBlock
                title={cdes.length ? "No CDEs in this domain" : "No Critical Data Elements yet"}
                message={
                  cdes.length
                    ? "Choose another domain or All domains to see the full registry."
                    : "Flag an asset as a CDE with + New CDE to start the registry."
                }
              />
            ) : (
              displayCdes.map((cde) => {
                // G4/G13: the certification pill shows the real certification;
                // missing source tags surface as actionable copy instead of a
                // dead "Unavailable"/"Source unavailable" verdict.
                const statusLabel = registryEvidenceLabel(cde.status, "Certification pending");
                const statusEvidence = `${cdeSourceSummary(cde)}. ${cdeHealthEvidenceSummary(cde)}`;
                return (
                  <div
                    className={`gh-taxonomy-prototype-cde-row ${selectedCde?.id === cde.id ? "is-selected" : ""}`.trim()}
                    key={cde.id}
                    onClick={() => {
                      openCdeDetail(cde);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openCdeDetail(cde);
                      }
                    }}
                    role="row"
                    tabIndex={0}
                  >
                    <span role="cell">
                      <i aria-hidden="true" className="gh-taxonomy-prototype-key-icon" />
                      <strong>{cde.name}</strong>
                      {cde.sox ? <em>SOX</em> : null}
                    </span>
                    <span role="cell" className="is-mono" title={cdeSourceSummary(cde)}>
                      {cde.column || "Tag cde_source_column on the asset"}
                    </span>
                    <span role="cell">{cde.owner}</span>
                    <span
                      aria-label={`Recertification ${registryEvidenceLabel(cde.recert)}. ${cdeRecertEvidenceSummary(cde)}`}
                      role="cell"
                      title={cdeRecertEvidenceSummary(cde)}
                    >
                      <span className="gh-taxonomy-prototype-recert-pill">{registryEvidenceLabel(cde.recert)}</span>
                    </span>
                    <span
                      aria-label={`Certification ${statusLabel}. ${statusEvidence}`}
                      role="cell"
                      title={statusEvidence}
                    >
                      <StatusPill tone={statusTone(cde.status)}>{statusLabel}</StatusPill>
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <p className="gh-taxonomy-prototype-cde-provenance">
            Status and recertification are registry metadata values. Quality test-run or recertification workflow proof appears only when backed evidence is returned.
          </p>
          {selectedCde ? (
            <CdeRegistryDetail
              cde={selectedCde}
              onActionMessage={onActionMessage}
              onClose={() => setSelectedCdeId("")}
              onOpenAsset={onOpenAsset}
              onOpenLineage={onOpenLineage}
            />
          ) : null}
          </div>
        )}
      </div>

      {newTermOpen ? (
        <div className="gh-taxonomy-newterm-scrim" role="dialog" aria-modal="true" aria-labelledby="gh-newterm-title">
          <form className="gh-taxonomy-newterm-modal" onSubmit={handleSubmitNewTerm}>
            <header className="gh-taxonomy-newterm-head">
              <h2 id="gh-newterm-title">New glossary term</h2>
              <button
                aria-label="Close"
                className="gh-taxonomy-newterm-close"
                disabled={newTermSaving}
                onClick={() => setNewTermOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <p className="gh-taxonomy-newterm-help">
              Drafts are saved with status <strong>Draft</strong>. Stewards can promote them to Proposed or Approved later.
            </p>
            <label className="gh-taxonomy-newterm-field">
              <span>Term name *</span>
              <input
                autoFocus
                className="gh-input"
                disabled={newTermSaving}
                onChange={(event) =>
                  setNewTermDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="e.g. Net Revenue (USD)"
                required
                type="text"
                value={newTermDraft.name}
              />
            </label>
            <label className="gh-taxonomy-newterm-field">
              <span>Definition</span>
              <textarea
                className="gh-input"
                disabled={newTermSaving}
                onChange={(event) =>
                  setNewTermDraft((current) => ({ ...current, definition: event.target.value }))
                }
                placeholder="Plain-language description used by analysts and stewards…"
                rows={4}
                value={newTermDraft.definition}
              />
            </label>
            <div className="gh-taxonomy-newterm-row">
              <label className="gh-taxonomy-newterm-field">
                <span>Domain</span>
                <input
                  className="gh-input"
                  disabled={newTermSaving}
                  onChange={(event) =>
                    setNewTermDraft((current) => ({ ...current, domain: event.target.value }))
                  }
                  placeholder="e.g. Finance"
                  type="text"
                  value={newTermDraft.domain}
                />
              </label>
              <label className="gh-taxonomy-newterm-field">
                <span>Owner email</span>
                <input
                  className="gh-input"
                  disabled={newTermSaving}
                  onChange={(event) =>
                    setNewTermDraft((current) => ({ ...current, ownerEmail: event.target.value }))
                  }
                  placeholder="steward@your-company.ai"
                  type="email"
                  value={newTermDraft.ownerEmail}
                />
              </label>
            </div>
            {newTermError ? (
              <p className="gh-taxonomy-newterm-error" role="alert">{newTermError}</p>
            ) : null}
            <div className="gh-taxonomy-newterm-actions">
              <button
                className="gh-tertiary-button"
                disabled={newTermSaving}
                onClick={() => setNewTermOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="gh-primary-button"
                disabled={newTermSaving || !newTermDraft.name.trim()}
                type="submit"
              >
                {newTermSaving ? "Creating…" : "Create term"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {newCdeOpen ? (
        <div className="gh-taxonomy-newterm-scrim" role="dialog" aria-modal="true" aria-labelledby="gh-newcde-title">
          <form className="gh-taxonomy-newterm-modal" onSubmit={handleSubmitNewCde}>
            <header className="gh-taxonomy-newterm-head">
              <h2 id="gh-newcde-title">Flag asset as CDE</h2>
              <button
                aria-label="Close"
                className="gh-taxonomy-newterm-close"
                disabled={newCdeSaving}
                onClick={() => setNewCdeOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <p className="gh-taxonomy-newterm-help">
              Flags the asset as a Critical Data Element via the governed asset-metadata write path. The registry
              refreshes once the write lands.
            </p>
            <label className="gh-taxonomy-newterm-field">
              <span>Asset FQN *</span>
              <input
                autoFocus
                className="gh-input"
                disabled={newCdeSaving}
                onChange={(event) =>
                  setNewCdeDraft((current) => ({ ...current, assetFqn: event.target.value }))
                }
                placeholder="catalog.schema.table"
                required
                type="text"
                value={newCdeDraft.assetFqn}
              />
            </label>
            <label className="gh-taxonomy-newterm-field">
              <span>Rationale</span>
              <textarea
                className="gh-input"
                disabled={newCdeSaving}
                onChange={(event) =>
                  setNewCdeDraft((current) => ({ ...current, rationale: event.target.value }))
                }
                placeholder="Why this element is critical to the business…"
                rows={3}
                value={newCdeDraft.rationale}
              />
            </label>
            {newCdeError ? (
              <p className="gh-taxonomy-newterm-error" role="alert">{newCdeError}</p>
            ) : null}
            <div className="gh-taxonomy-newterm-actions">
              <button
                className="gh-tertiary-button"
                disabled={newCdeSaving}
                onClick={() => setNewCdeOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="gh-primary-button"
                disabled={newCdeSaving || !newCdeDraft.assetFqn.trim()}
                type="submit"
              >
                {newCdeSaving ? "Flagging…" : "Flag as CDE"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function RegistryDetailShell({ children, onClose, title }) {
  return (
    <aside className="gh-taxonomy-prototype-detail" aria-label={`${title} detail`}>
      <div className="gh-taxonomy-prototype-detail-head">
        <div>
          <span>Selected detail</span>
          <h2>{title}</h2>
        </div>
        <button aria-label={`Close ${title} detail`} onClick={onClose} type="button">
          x
        </button>
      </div>
      {children}
    </aside>
  );
}

function TermRegistryDetail({ associationBrowserOpen = false, onActionMessage, onClose, onOpenAsset, onOpenLineage, term, termLookup = null }) {
  const [showAssociations, setShowAssociations] = useState(Boolean(associationBrowserOpen));
  // G8: reviewer assignment is backed by POST /governance/glossary
  // (GlossaryTermUpsert.reviewers), so the old permanently disabled
  // "Reviewer workflow unavailable" button became a real inline form.
  const [reviewerFormOpen, setReviewerFormOpen] = useState(false);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [reviewerSaving, setReviewerSaving] = useState(false);
  const queryClient = useQueryClient();
  const firstAsset = term.assets[0] || null;
  const reviewers = term.reviewers.length ? term.reviewers : [];
  const history = term.termHistory.length ? term.termHistory : [];
  // G10: resolve the parent term's real name; fall back to the raw id.
  const parentTermName = term.parentTermId
    ? termLookup?.get?.(term.parentTermId)?.term || term.parentTermId
    : "";
  useEffect(() => {
    setShowAssociations(Boolean(associationBrowserOpen));
    setReviewerFormOpen(false);
    setReviewerEmail("");
  }, [associationBrowserOpen, term.termId]);
  const handleAssignReviewer = async (event) => {
    event.preventDefault();
    const email = reviewerEmail.trim();
    if (!email || reviewerSaving) return;
    setReviewerSaving(true);
    try {
      // The upsert overwrites term fields, so replay the term's current
      // values alongside the extended reviewer roster.
      await upsertGovernanceGlossaryTerm({
        termId: term.termId,
        name: term.term,
        definition: term.definition || "",
        domain: term.domain === "Unassigned" ? "" : term.domain || "",
        ownerEmail: term.ownerEmail || "",
        status: term.status || "draft",
        reviewers: [
          ...term.reviewers.map((reviewer) => ({
            email: reviewer.email,
            role: reviewer.role || "Reviewer",
            state: reviewer.state || "active",
          })),
          { email, role: "Reviewer", state: "active" },
        ],
        changeNote: `Reviewer ${email} assigned from the glossary registry.`,
      });
      queryClient.invalidateQueries({ queryKey: ["atlas", "taxonomy-overview"] });
      onActionMessage(`Reviewer ${email} assigned to ${term.term}.`);
      setReviewerEmail("");
      setReviewerFormOpen(false);
    } catch (error) {
      onActionMessage(error?.message || "Reviewer assignment failed — please try again.");
    } finally {
      setReviewerSaving(false);
    }
  };
  return (
    <RegistryDetailShell onClose={onClose} title={term.term}>
      <div className="gh-taxonomy-prototype-detail-grid">
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Definition</h3>
          <p>{term.definition || "No live definition recorded for this term."}</p>
          <p className="gh-taxonomy-prototype-detail-note">
            Source: {termSourceSummary(term)}.
          </p>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Ownership and review</h3>
          <dl>
            <div><dt>Domain</dt><dd>{term.domain || "Unassigned"}</dd></div>
            <div><dt>Owner</dt><dd>{term.ownerEmail || term.stewardEmail || "Unassigned steward"}</dd></div>
            <div><dt>Status</dt><dd>{registryLabel(term.status)}</dd></div>
            <div><dt>Version</dt><dd>{term.currentVersion || "No backed version label"}</dd></div>
            <div><dt>Review evidence</dt><dd>{termReviewSummary(term)}</dd></div>
          </dl>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Reviewer workflow</h3>
          {reviewers.length ? (
            <ul>
              {reviewers.slice(0, 4).map((reviewer) => (
                <li key={reviewer.id || reviewer.email}>
                  <strong>{reviewer.email || "Reviewer"}</strong>
                  <span>{reviewer.role || "Reviewer"} · {reviewer.state || "active"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No reviewer assignments are recorded for this term.</p>
          )}
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Version history</h3>
          {history.length ? (
            <ul>
              {history.slice(0, 3).map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.version} · {entry.title}</strong>
                  <span>{entry.changedAt ? compactDate(entry.changedAt) : "Timestamp unavailable"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No version history is recorded for this term.</p>
          )}
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Hierarchy</h3>
          {term.parentTermId || term.childCount ? (
            <dl>
              <div><dt>Parent</dt><dd>{parentTermName || "Root term"}</dd></div>
              <div><dt>Child terms</dt><dd>{Number(term.childCount || 0).toLocaleString()} links</dd></div>
              <div><dt>Source</dt><dd>{termSourceSummary(term)}</dd></div>
            </dl>
          ) : (
            <p>No nested child terms are recorded for this term.</p>
          )}
        </section>
      </div>
      <div className="gh-taxonomy-prototype-detail-actions">
        <button
          disabled={!firstAsset?.fqn}
          onClick={() => firstAsset?.fqn && onOpenAsset?.(firstAsset.fqn, "Overview")}
          title={firstAsset?.fqn ? "Open the first linked asset" : "No linked asset FQN is available"}
          type="button"
        >
          Open first asset
        </button>
        <button
          disabled={!firstAsset?.fqn}
          onClick={() => {
            const target = firstAsset?.fqn;
            if (target && onOpenLineage) onOpenLineage(target, "Data Lineage");
            else if (target) onOpenAsset?.(target, "Lineage");
          }}
          title={firstAsset?.fqn ? "Open lineage for the first linked asset" : "Lineage requires a linked asset FQN"}
          type="button"
        >
          Open lineage
        </button>
        <button
          onClick={() => setShowAssociations((current) => !current)}
          title={term.assets.length ? "Browse all linked assets for this term" : "Show association availability; no linked assets are recorded for this term"}
          type="button"
        >
          {showAssociations ? "Hide associations" : "Browse all associations"}
        </button>
        <button
          onClick={() => setReviewerFormOpen((current) => !current)}
          title="Assign a reviewer through the governed glossary upsert workflow"
          type="button"
        >
          {reviewerFormOpen ? "Cancel reviewer assignment" : "Assign reviewer"}
        </button>
      </div>
      {reviewerFormOpen ? (
        <form
          className="gh-taxonomy-prototype-detail-card"
          aria-label={`Assign reviewer to ${term.term}`}
          onSubmit={handleAssignReviewer}
        >
          <h3>Assign reviewer</h3>
          <label className="gh-taxonomy-newterm-field">
            <span>Reviewer email</span>
            <input
              className="gh-input"
              disabled={reviewerSaving}
              onChange={(event) => setReviewerEmail(event.target.value)}
              placeholder="reviewer@your-company.ai"
              required
              type="email"
              value={reviewerEmail}
            />
          </label>
          <div className="gh-taxonomy-newterm-actions">
            <button
              className="gh-primary-button"
              disabled={reviewerSaving || !reviewerEmail.trim()}
              type="submit"
            >
              {reviewerSaving ? "Assigning…" : "Assign reviewer"}
            </button>
          </div>
        </form>
      ) : null}
      {showAssociations ? (
        <section className="gh-taxonomy-prototype-detail-card gh-taxonomy-prototype-associations" aria-label={`${term.term} associated assets`}>
          <h3>Associated assets</h3>
          <p className="gh-taxonomy-prototype-detail-note">{termAssociationSummary(term)}</p>
          {term.assets.length ? (
            <div className="gh-taxonomy-linked-assets">
              {term.assets.map((asset) => (
                <button
                  disabled={!asset.fqn}
                  key={asset.id || asset.fqn || asset.label}
                  onClick={() => asset.fqn && onOpenAsset?.(asset.fqn, "Overview")}
                  title={asset.fqn ? "Open associated asset" : "Associated asset FQN unavailable"}
                  type="button"
                >
                  <span className="gh-taxonomy-asset-icon" aria-hidden="true" />
                  <span>
                    <strong>{asset.label || asset.fqn || "Associated asset"}</strong>
                    <small>{asset.fqn || "FQN unavailable"}</small>
                    <small>{[asset.type, asset.platform].filter(Boolean).join(" - ") || "Source metadata unavailable"}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p>No linked assets are recorded for this term.</p>
          )}
        </section>
      ) : null}
    </RegistryDetailShell>
  );
}

function CdeRegistryDetail({ cde, onActionMessage, onClose, onOpenAsset, onOpenLineage }) {
  const sourceAssetFqn = sourceAssetFqnForCde(cde);
  // G8: "Request recertification" routes through the same governance-request
  // creation path Lineage uses (POST /governance/requests).
  const [recertSaving, setRecertSaving] = useState(false);
  // G8: owner assignment is backed by POST /governance/owners.
  const [ownerFormOpen, setOwnerFormOpen] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerSaving, setOwnerSaving] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    setOwnerFormOpen(false);
    setOwnerEmail("");
  }, [cde.id]);
  const handleRequestRecertification = async () => {
    if (!sourceAssetFqn || recertSaving) return;
    setRecertSaving(true);
    try {
      const response = await createGovernanceRequest(
        {
          assetFqn: sourceAssetFqn,
          title: `Recertification requested: ${cde.name}`,
          note: `Recertification requested from the CDE registry for ${cde.name} (${sourceAssetFqn}).`,
        },
        { fast: true },
      );
      const requestId = response?.requestId || response?.id || "";
      onActionMessage(
        requestId
          ? `Recertification request ${requestId} created for ${cde.name}.`
          : `Recertification request created for ${cde.name}.`,
      );
    } catch (error) {
      onActionMessage(error?.message || "Recertification request failed — please try again.");
    } finally {
      setRecertSaving(false);
    }
  };
  const handleAssignOwner = async (event) => {
    event.preventDefault();
    const email = ownerEmail.trim();
    if (!email || !sourceAssetFqn || ownerSaving) return;
    setOwnerSaving(true);
    try {
      await upsertGovernanceOwner({ assetFqn: sourceAssetFqn, ownerEmail: email, ownerType: "steward" });
      queryClient.invalidateQueries({ queryKey: ["atlas", "taxonomy-cde-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["atlas", "taxonomy-overview"] });
      onActionMessage(`Owner ${email} assigned to ${sourceAssetFqn}.`);
      setOwnerEmail("");
      setOwnerFormOpen(false);
    } catch (error) {
      onActionMessage(error?.message || "Owner assignment failed — please try again.");
    } finally {
      setOwnerSaving(false);
    }
  };
  return (
    <RegistryDetailShell onClose={onClose} title={cde.name}>
      <div className="gh-taxonomy-prototype-detail-grid">
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Source-of-record column</h3>
          <p className="is-mono">{cde.column || "Not tagged — tag cde_source_column on the asset"}</p>
          <p className="gh-taxonomy-prototype-detail-note">{cdeSourceSummary(cde)}</p>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Ownership</h3>
          <dl>
            <div><dt>Owner</dt><dd>{cde.owner || "Unassigned"}</dd></div>
            <div><dt>Recertification</dt><dd>{registryEvidenceLabel(cde.recert)}</dd></div>
            <div><dt>Last review</dt><dd>{cdeLastReviewSummary(cde)}</dd></div>
            <div><dt>Certification</dt><dd>{registryEvidenceLabel(cde.status, "Certification pending")}</dd></div>
            <div><dt>SOX</dt><dd>{cde.sox ? "SOX-relevant" : "Not marked SOX"}</dd></div>
          </dl>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Recertification evidence</h3>
          <p>{cdeRecertEvidenceSummary(cde)}</p>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Quality evidence</h3>
          <p>{cdeHealthEvidenceSummary(cde)}</p>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Association source</h3>
          <p>{sourceAssetFqn ? sourceAssetFqn : "No source asset FQN is recorded on this registry row."}</p>
        </section>
      </div>
      <div className="gh-taxonomy-prototype-detail-actions">
        <button
          disabled={!sourceAssetFqn}
          onClick={() => sourceAssetFqn && onOpenAsset?.(sourceAssetFqn, "Overview")}
          title={sourceAssetFqn ? "Open source asset" : "Source asset FQN unavailable"}
          type="button"
        >
          Open source asset
        </button>
        <button
          disabled={!sourceAssetFqn}
          onClick={() => {
            if (sourceAssetFqn && onOpenLineage) onOpenLineage(sourceAssetFqn, "Data Lineage");
            else if (sourceAssetFqn) onOpenAsset?.(sourceAssetFqn, "Lineage");
          }}
          title={sourceAssetFqn ? "Open source asset lineage" : "Lineage requires a source asset FQN"}
          type="button"
        >
          Open lineage
        </button>
        <button
          disabled={!sourceAssetFqn || recertSaving}
          onClick={handleRequestRecertification}
          title={
            sourceAssetFqn
              ? "Create a governance request asking stewards to recertify this CDE"
              : "Recertification requests require a source asset FQN"
          }
          type="button"
        >
          {recertSaving ? "Requesting…" : "Request recertification"}
        </button>
        <button
          disabled={!sourceAssetFqn}
          onClick={() => setOwnerFormOpen((current) => !current)}
          title={
            sourceAssetFqn
              ? "Assign a steward owner to the source asset"
              : "Owner assignment requires a source asset FQN"
          }
          type="button"
        >
          {ownerFormOpen ? "Cancel owner assignment" : "Assign owner"}
        </button>
      </div>
      {ownerFormOpen ? (
        <form
          className="gh-taxonomy-prototype-detail-card"
          aria-label={`Assign owner for ${cde.name}`}
          onSubmit={handleAssignOwner}
        >
          <h3>Assign owner</h3>
          <label className="gh-taxonomy-newterm-field">
            <span>Owner email</span>
            <input
              className="gh-input"
              disabled={ownerSaving}
              onChange={(event) => setOwnerEmail(event.target.value)}
              placeholder="steward@your-company.ai"
              required
              type="email"
              value={ownerEmail}
            />
          </label>
          <div className="gh-taxonomy-newterm-actions">
            <button
              className="gh-primary-button"
              disabled={ownerSaving || !ownerEmail.trim()}
              type="submit"
            >
              {ownerSaving ? "Assigning…" : "Assign owner"}
            </button>
          </div>
        </form>
      ) : null}
    </RegistryDetailShell>
  );
}

function TaxonomyRail({
  activeContext,
  onContextChange,
  overview,
  selectedNode,
  setSelectedNodeId,
  sourceUnavailable,
  treeItems,
}) {
  return (
    <aside className="gh-taxonomy-panel gh-taxonomy-rail" aria-label="Taxonomy navigation">
      <div className="gh-taxonomy-panel-label">Taxonomy</div>
      <div className="gh-taxonomy-contexts" role="tablist" aria-label="Taxonomy facets">
        {TAXONOMY_CONTEXTS.map((context) => (
          <button
            aria-pressed={activeContext === context.key}
            className={activeContext === context.key ? "is-active" : ""}
            key={context.key}
            onClick={() => onContextChange(context.key)}
            type="button"
          >
            <span className="gh-taxonomy-context-icon" aria-hidden="true" />
            {context.label}
          </button>
        ))}
      </div>
      <div className="gh-taxonomy-rail-divider" />
      <div className="gh-taxonomy-panel-label">
        {TAXONOMY_CONTEXTS.find((context) => context.key === activeContext)?.singular || "Taxonomy"} Root
      </div>
      <div className="gh-taxonomy-tree" role="tree">
        <button
          className={selectedNode?.id === "all" ? "is-selected" : ""}
          onClick={() => setSelectedNodeId("all")}
          type="button"
        >
          <span className="gh-taxonomy-tree-marker" aria-hidden="true" />
          All Terms
          <span>{overview.glossaryTerms.length}</span>
        </button>
        {treeItems.map((item) => (
          <button
            className={selectedNode?.id === item.id ? "is-selected" : ""}
            key={item.id}
            onClick={() => setSelectedNodeId(item.id)}
            style={item.depth ? cssVars({ "--taxonomy-depth": String(item.depth) }) : undefined}
            type="button"
          >
            <span className="gh-taxonomy-tree-marker" aria-hidden="true" />
            {item.label}
            {item.count != null ? <span>{item.count}</span> : null}
          </button>
        ))}
      </div>
      {sourceUnavailable[activeContext] ? (
        <div className="gh-taxonomy-source-state">
          <strong>No live {TAXONOMY_CONTEXTS.find((context) => context.key === activeContext)?.label.toLowerCase()} defined</strong>
          <span>The panel shape is preserved, but this source has no records in the governance store.</span>
        </div>
      ) : null}
    </aside>
  );
}

function TermsPanel({
  contextLabel,
  filterOpen,
  filteredTerms,
  onFilterOpen,
  onSearch,
  onSelectTerm,
  onStatusFilter,
  search,
  selectedTermId,
  statusFilter,
  totalTerms,
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [rowsMenuOpen, setRowsMenuOpen] = useState(false);
  const totalPages = Math.max(1, Math.ceil(filteredTerms.length / rowsPerPage));
  const boundedPageIndex = Math.min(pageIndex, totalPages - 1);
  const startIndex = boundedPageIndex * rowsPerPage;
  const pageRows = filteredTerms.slice(startIndex, startIndex + rowsPerPage);

  useEffect(() => {
    setPageIndex(0);
  }, [contextLabel, filteredTerms.length, rowsPerPage, search, statusFilter]);

  useEffect(() => {
    if (pageIndex >= totalPages) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

  return (
    <section className="gh-taxonomy-panel gh-taxonomy-terms-panel" aria-label="Glossary terms">
      <div className="gh-taxonomy-panel-head">
        <h2>Terms in {contextLabel}</h2>
        <span className="gh-taxonomy-count">{totalTerms}</span>
      </div>
      <div className="gh-taxonomy-term-tools">
        <label className="gh-taxonomy-search">
          <span aria-hidden="true" />
          <input
            aria-label={`Search terms in ${contextLabel}`}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={`Search terms in ${contextLabel}...`}
            type="search"
            value={search}
          />
        </label>
        <div className="gh-taxonomy-filter-wrap">
          <button
            aria-expanded={filterOpen}
            aria-label="Filter terms by status"
            className="gh-taxonomy-icon-button"
            onClick={() => onFilterOpen(!filterOpen)}
            type="button"
          >
            <span className="gh-taxonomy-filter-glyph" aria-hidden="true" />
          </button>
          {filterOpen ? (
            <div className="gh-taxonomy-filter-menu" role="menu">
              {STATUS_OPTIONS.map((status) => (
                <button
                  aria-pressed={statusFilter === status}
                  key={status}
                  onClick={() => {
                    onStatusFilter(status);
                    onFilterOpen(false);
                  }}
                  type="button"
                >
                  {status === "all" ? "All statuses" : titleFromValue(status)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="gh-taxonomy-table" role="table" aria-label="Terms">
        <div className="gh-taxonomy-table-head" role="row">
          <span role="columnheader">Term</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Steward</span>
        </div>
        <div className="gh-taxonomy-table-body">
          {pageRows.length ? (
            pageRows.map((term) => (
              <div
                className={`gh-taxonomy-table-row ${term.termId === selectedTermId ? "is-selected" : ""}`}
                key={term.termId}
                role="row"
              >
                <button
                  className="gh-taxonomy-term-row-main"
                  onClick={() => onSelectTerm(term.termId)}
                  type="button"
                >
                  <span className="gh-taxonomy-term-cell" role="cell">
                    <span className="gh-taxonomy-book" aria-hidden="true" />
                    {term.term}
                  </span>
                  <span role="cell">
                    <StatusPill tone={statusTone(term.status)}>{titleFromValue(term.status) || "Draft"}</StatusPill>
                  </span>
                  <span className="gh-taxonomy-steward-cell" role="cell">
                    <Avatar email={term.stewardEmail || term.ownerEmail} />
                    <span>{term.stewardEmail || term.ownerEmail || "Unassigned"}</span>
                  </span>
                </button>
                <button
                  aria-label={`Term actions unavailable for ${term.term}`}
                  className="gh-taxonomy-row-action"
                  disabled
                  title="Term row actions require a persisted action source."
                  type="button"
                >
                  ...
                </button>
              </div>
            ))
          ) : (
            <div className="gh-taxonomy-table-empty">
              <strong>No live terms match this view</strong>
              <span>Adjust search or choose another taxonomy context.</span>
            </div>
          )}
        </div>
      </div>
      <div className="gh-taxonomy-pagination">
        <span>
          {pageRows.length
            ? `${startIndex + 1}-${startIndex + pageRows.length} of ${filteredTerms.length}`
            : "0 of 0"}
        </span>
        <div>
          <button
            aria-label="Previous page"
            disabled={boundedPageIndex === 0}
            onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
            type="button"
          >
            {"<"}
          </button>
          <button
            aria-label="Next page"
            disabled={boundedPageIndex >= totalPages - 1}
            onClick={() => setPageIndex((value) => Math.min(totalPages - 1, value + 1))}
            type="button"
          >
            {">"}
          </button>
        </div>
        <div className="gh-taxonomy-page-size">
          <button
            aria-expanded={rowsMenuOpen}
            aria-label="Rows per page"
            onClick={() => setRowsMenuOpen((value) => !value)}
            type="button"
          >
            {rowsPerPage} per page
          </button>
          {rowsMenuOpen ? (
            <div className="gh-taxonomy-page-size-menu" role="menu">
              {[10, 20].map((size) => (
                <button
                  aria-pressed={rowsPerPage === size}
                  key={size}
                  onClick={() => {
                    setRowsPerPage(size);
                    setRowsMenuOpen(false);
                    setPageIndex(0);
                  }}
                  type="button"
                >
                  {size} per page
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TermDetailPanel({
  activeContext,
  allTerms,
  classifications,
  classificationTerms,
  dataProducts,
  domains,
  detailTab,
  onDetailTab,
  onOpenAsset,
  selectedNode,
  selectedTerm,
}) {
  const relatedTerms = selectedTerm
    ? allTerms
        .filter(
          (term) =>
            term.termId !== selectedTerm.termId &&
            ((term.parentTermId && term.parentTermId === selectedTerm.termId) ||
              (selectedTerm.parentTermId && term.termId === selectedTerm.parentTermId) ||
              (selectedTerm.parentTermId && term.parentTermId === selectedTerm.parentTermId)),
        )
        .slice(0, 6)
    : [];
  const domainIds = selectedTerm
    ? domains
        .filter((domain) => domain.label.toLowerCase() === selectedTerm.domain.toLowerCase())
        .map((domain) => domain.id.toLowerCase())
    : [];
  const dataProductsForTerm = selectedTerm
    ? dataProducts.filter((product) => domainIds.includes(text(product.domain_id || product.domainId).toLowerCase()))
    : [];
  const classificationIds = selectedTerm
    ? new Set(
        classificationTerms
          .filter((term) => text(term.term_id || term.termId || term.id) === selectedTerm.termId)
          .map((term) => text(term.classification_id || term.classificationId).toLowerCase())
          .filter(Boolean),
      )
    : new Set();
  const classificationMatches = selectedTerm
    ? classifications.filter((classification) => classificationIds.has(classification.id.toLowerCase()))
    : [];
  const breadcrumbItems = selectedTerm
    ? [
        selectedNode && selectedNode.id !== "all" && selectedNode.live ? selectedNode.label : "All Terms",
        selectedTerm.domain,
        selectedTerm.term,
      ].filter(Boolean)
    : [];

  return (
    <section className="gh-taxonomy-panel gh-taxonomy-detail" aria-label="Glossary term detail">
      {selectedTerm ? (
        <>
          <div className="gh-taxonomy-detail-head">
            <div>
              <div className="gh-taxonomy-title-row">
                <h2>{selectedTerm.term}</h2>
                <button
                  aria-label="Favorite unavailable for glossary terms"
                  disabled
                  title="Glossary term favorites require a persisted preference source."
                  type="button"
                >
                  *
                </button>
                <button
                  aria-label="More term actions unavailable"
                  disabled
                  title="More term actions require a persisted action source."
                  type="button"
                >
                  ...
                </button>
              </div>
              <div className="gh-taxonomy-breadcrumbs">
                {breadcrumbItems.map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
            <StatusPill tone={statusTone(selectedTerm.status)}>
              {titleFromValue(selectedTerm.status) || "Draft"}
            </StatusPill>
          </div>
          <div className="gh-taxonomy-detail-tabs" role="tablist" aria-label="Term detail tabs">
            {DETAIL_TABS.map((tab) => (
              <button
                aria-selected={detailTab === tab.key}
                className={detailTab === tab.key ? "is-active" : ""}
                key={tab.key}
                onClick={() => onDetailTab(tab.key)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="gh-taxonomy-detail-grid">
            <div className="gh-taxonomy-detail-main">
              {detailTab === "overview" ? (
                <OverviewTab
                  onOpenAsset={onOpenAsset}
                  relatedTerms={relatedTerms}
                  selectedTerm={selectedTerm}
                />
              ) : null}
              {detailTab === "technical" ? <TechnicalTab selectedTerm={selectedTerm} /> : null}
              {detailTab === "history" ? <HistoryTab selectedTerm={selectedTerm} /> : null}
              {detailTab === "related" ? (
                <RelatedTab
                  onOpenAsset={onOpenAsset}
                  relatedTerms={relatedTerms}
                  selectedTerm={selectedTerm}
                />
              ) : null}
            </div>
            <div className="gh-taxonomy-detail-side">
              <DomainRelationshipCard selectedTerm={selectedTerm} relatedTerms={relatedTerms} />
              <DataProductCard dataProducts={dataProductsForTerm} />
              <ClassificationCard classifications={classificationMatches} />
            </div>
          </div>
        </>
      ) : (
        <div className="gh-taxonomy-detail-empty">
          <strong>No live glossary term selected</strong>
          <span>Term details will appear when the governance store has glossary terms in scope.</span>
        </div>
      )}
    </section>
  );
}

function OverviewTab({ onOpenAsset, relatedTerms, selectedTerm }) {
  return (
    <>
      <section className="gh-taxonomy-detail-card gh-taxonomy-definition">
        <h3>Definition</h3>
        <p>{selectedTerm.definition || "No live definition recorded for this term."}</p>
      </section>
      <section className="gh-taxonomy-detail-card gh-taxonomy-owner-grid">
        <OwnerBlock label="Owner" email={selectedTerm.ownerEmail} />
        <OwnerBlock label="Steward" email={selectedTerm.stewardEmail} />
        <div>
          <h3>Approval Status</h3>
          <StatusPill tone={statusTone(selectedTerm.status)}>
            {titleFromValue(selectedTerm.status) || "Draft"}
          </StatusPill>
          <p>{selectedTerm.reviewedAt ? `Approved on ${compactDate(selectedTerm.reviewedAt)}` : "No approval timestamp recorded."}</p>
        </div>
        <div>
          <h3>Review Date</h3>
          <p>{compactDate(selectedTerm.reviewedAt) || "Unavailable"}</p>
          <span>{selectedTerm.reviewedAt ? "Last explicit review update" : "No reviewer timestamp recorded"}</span>
        </div>
      </section>
      <TagsCard
        title="Synonyms"
        empty="No live synonyms recorded."
        items={arrayValue(selectedTerm.synonyms).map(text).filter(Boolean)}
      />
      <TagsCard
        title="Related Terms"
        empty="No related live terms recorded."
        items={relatedTerms.map((term) => term.term)}
        previewLimit={4}
      />
      <LinkedAssetsCard
        assets={selectedTerm.assets}
        assetCount={selectedTerm.assetCount}
        onOpenAsset={onOpenAsset}
      />
    </>
  );
}

function TechnicalTab({ selectedTerm }) {
  return (
    <section className="gh-taxonomy-detail-card gh-taxonomy-technical">
      <h3>Technical Metadata</h3>
      <dl>
        <div><dt>Term ID</dt><dd>{selectedTerm.termId}</dd></div>
        <div><dt>Parent term</dt><dd>{selectedTerm.parentTermId || "None recorded"}</dd></div>
        <div><dt>Domain</dt><dd>{selectedTerm.domain}</dd></div>
        <div><dt>Version</dt><dd>{selectedTerm.currentVersion || "Unavailable"}</dd></div>
        <div><dt>Created</dt><dd>{compactDate(selectedTerm.createdAt) || "Unavailable"}</dd></div>
        <div><dt>Updated</dt><dd>{compactDate(selectedTerm.updatedAt) || "Unavailable"}</dd></div>
      </dl>
    </section>
  );
}

function HistoryTab({ selectedTerm }) {
  return (
    <section className="gh-taxonomy-detail-card gh-taxonomy-history">
      <h3>History</h3>
      {selectedTerm.termHistory.length ? (
        <ol>
          {selectedTerm.termHistory.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.title}</strong>
              <span>{entry.version} {entry.changedAt ? `- ${compactDate(entry.changedAt)}` : ""}</span>
              {entry.note ? <p>{entry.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p>No version history is recorded for this term.</p>
      )}
    </section>
  );
}

function RelatedTab({ onOpenAsset, relatedTerms, selectedTerm }) {
  return (
    <>
      <TagsCard
        title="Related Terms"
        empty="No related live terms recorded."
        items={relatedTerms.map((term) => term.term)}
      />
      <LinkedAssetsCard
        assets={selectedTerm.assets}
        assetCount={selectedTerm.assetCount}
        onOpenAsset={onOpenAsset}
      />
    </>
  );
}

function OwnerBlock({ label, email }) {
  return (
    <div>
      <h3>{label}</h3>
      {email ? (
        <div className="gh-taxonomy-person">
          <Avatar email={email} />
          <span>{email}</span>
        </div>
      ) : (
        <p>Unassigned</p>
      )}
    </div>
  );
}

function TagsCard({ empty, items, previewLimit = undefined, title }) {
  const visibleItems = Number.isFinite(previewLimit) ? items.slice(0, previewLimit) : items;
  const remaining = Math.max(0, items.length - visibleItems.length);
  return (
    <section className="gh-taxonomy-detail-card">
      <h3>{title}</h3>
      {items.length ? (
        <div className="gh-taxonomy-tags">
          {visibleItems.map((item) => <span key={item}>{item}</span>)}
          {remaining > 0 ? <span>+{remaining}</span> : null}
        </div>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  );
}

function LinkedAssetsCard({ assets, assetCount, onOpenAsset }) {
  const [showAll, setShowAll] = useState(false);
  const previewLimit = 3;
  const rows = showAll ? assets : assets.slice(0, previewLimit);
  const remaining = Math.max(0, Number(assetCount || 0) - rows.length);
  return (
    <section className="gh-taxonomy-detail-card">
      <div className="gh-taxonomy-section-head">
        <h3>Linked Assets <span>{Number(assetCount || 0)}</span></h3>
        <button
          disabled={assets.length <= previewLimit}
          onClick={() => setShowAll((value) => !value)}
          title={assets.length <= previewLimit ? "No additional linked assets are available." : ""}
          type="button"
        >
          {showAll ? "Show less" : "View all"}
        </button>
      </div>
      {rows.length ? (
        <div className="gh-taxonomy-linked-assets">
          {rows.map((asset) => (
            <button
              disabled={!asset.fqn}
              key={asset.id}
              onClick={() => asset.fqn && onOpenAsset?.(asset.fqn, "Overview")}
              type="button"
            >
              <span className="gh-taxonomy-asset-icon" aria-hidden="true" />
              <span>
                <strong>{asset.label}</strong>
                <small>{[asset.type, asset.platform].filter(Boolean).join(" - ") || asset.fqn}</small>
              </span>
            </button>
          ))}
          {remaining > 0 ? <span className="gh-taxonomy-more-assets">+{remaining} more assets</span> : null}
        </div>
      ) : (
        <p>No linked assets are recorded for this term.</p>
      )}
    </section>
  );
}

function DomainRelationshipCard({ relatedTerms, selectedTerm }) {
  return (
    <section className="gh-taxonomy-side-card">
      <h3>Domain Relationship</h3>
      <div className="gh-taxonomy-relationship">
        <span>{selectedTerm.domain}</span>
        <span className="is-selected">{selectedTerm.term}</span>
        {relatedTerms.slice(0, 3).map((term) => <span key={term.termId}>{term.term}</span>)}
      </div>
    </section>
  );
}

function DataProductCard({ dataProducts }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? dataProducts : dataProducts.slice(0, 4);
  return (
    <section className="gh-taxonomy-side-card">
      <div className="gh-taxonomy-section-head">
        <h3>Data Products <span>{dataProducts.length}</span></h3>
        <button
          disabled={dataProducts.length <= 4}
          onClick={() => setShowAll((value) => !value)}
          title={dataProducts.length <= 4 ? "No additional data products are available." : ""}
          type="button"
        >
          {showAll ? "Show less" : "View all"}
        </button>
      </div>
      {dataProducts.length ? (
        <div className="gh-taxonomy-side-list">
          {rows.map((product) => (
            <div key={product.id}>
              <strong>{product.label}</strong>
              <span>{product.description || "Live data product"}</span>
            </div>
          ))}
        </div>
      ) : (
        <p>No live data products are linked to this term's domain.</p>
      )}
    </section>
  );
}

function ClassificationCard({ classifications }) {
  return (
    <section className="gh-taxonomy-side-card">
      <h3>Classifications</h3>
      {classifications.length ? (
        <div className="gh-taxonomy-tags">
          {classifications.map((classification) => (
            <span key={classification.id}>{classification.label}</span>
          ))}
        </div>
      ) : (
        <p>No live classifications are associated with this term.</p>
      )}
    </section>
  );
}

function Avatar({ email }) {
  return <span className="gh-taxonomy-avatar" aria-hidden="true">{initials(email).toUpperCase()}</span>;
}
