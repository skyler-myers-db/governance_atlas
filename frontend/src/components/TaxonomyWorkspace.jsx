import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCdeDashboard, fetchTaxonomyOverview } from "../lib/api";
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

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function envelopeMeta(payload) {
  return payload && typeof payload === "object" ? payload.meta || {} : {};
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

function prototypeLabel(value, fallback = "Unavailable") {
  return titleFromValue(value) || fallback;
}

function prototypeFixtureLabel(value, fallback = "Unavailable") {
  const label = prototypeLabel(value, fallback);
  if (!label || /^unavailable$/i.test(label) || /^fixture\b/i.test(label)) return label;
  return `Fixture ${label}`;
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
  return {
    ...value,
    id,
    name: text(value.name || value.term || value.title) || "Unnamed CDE",
    column: text(value.column || value.sourceColumn || value.source_of_record_column),
    owner: text(value.owner || value.ownerEmail || value.steward || value.stewardEmail) || "Unassigned",
    recert: text(value.recert || value.recertAge || value.reviewAge || value.lastReview) || "Unavailable",
    status: text(value.status || value.health || value.state) || "Unavailable",
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
  return parts.length >= 4 ? parts.slice(0, -1).join(".") : "";
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
    name: displayCdeName(rawName),
    column: sourceColumn,
    owner,
    recert:
      text(value.recert || value.recertAge || value.reviewAge || value.reviewWindow || value.lastReview) ||
      "Unavailable",
    status:
      text(value.status || value.health || value.controlState || value.certification || value.state) ||
      "Unavailable",
    recertEvidence: evidenceText(value.recertEvidence, value.recertSource, value.recertWorkflow, value.reviewEvidence),
    healthEvidence: evidenceText(value.healthEvidence, value.qualityEvidence, value.testRun, value.qualityRunId),
    sox: Boolean(value.sox || value.soxRelevant || value.tags?.includes?.("SOX")),
  };
}

function termSourceSummary(term = {}) {
  return text(term.summarySource || term.source || term.associationSource) || "Prototype fixture provenance";
}

function termAssociationSummary(term = {}) {
  const count = Number(term.assetCount || 0);
  if (count > 0) return `${count.toLocaleString()} prototype linked asset${count === 1 ? "" : "s"} - actor visibility not verified`;
  return "Association evidence unavailable";
}

function termReviewSummary(term = {}) {
  const status = text(term.status);
  if (term.reviewedAt) return `Reviewed ${compactDate(term.reviewedAt) || term.reviewedAt}`;
  if (term.reviewers?.length) {
    return `${term.reviewers.length} reviewer${term.reviewers.length === 1 ? "" : "s"} assigned`;
  }
  return status ? "Status fixture; review n/a" : "Reviewer evidence unavailable";
}

function cdeRecertEvidenceSummary(cde = {}) {
  return text(cde.recertEvidence) || "Recertification workflow evidence unavailable";
}

function cdeHealthEvidenceSummary(cde = {}) {
  return text(cde.healthEvidence) || "Quality/test-run evidence unavailable";
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

function sortTermsForDisplay(terms) {
  return [...terms].sort((left, right) => {
    const leftPriority = TERM_PRIORITY.indexOf(left.term.toLowerCase());
    const rightPriority = TERM_PRIORITY.indexOf(right.term.toLowerCase());
    const leftRank = leftPriority >= 0 ? leftPriority : TERM_PRIORITY.length;
    const rightRank = rightPriority >= 0 ? rightPriority : TERM_PRIORITY.length;
    if (leftRank !== rightRank) return leftRank - rightRank;
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
  const prototypeMode = true;
  const [registryTab, setRegistryTab] = useState(initialRegistryTabFromLocation);
  const [prototypeActionMessage, setPrototypeActionMessage] = useState("");
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
    enabled: !taxonomyOverride,
  });
  const cdeDashboardQuery = useQuery({
    queryKey: ["atlas", "taxonomy-cde-dashboard"],
    queryFn: ({ signal }) => fetchCdeDashboard({ signal }),
    staleTime: 60_000,
    enabled: prototypeMode && !taxonomyOverride,
  });

  const payload = taxonomyOverride || overviewQuery.data;
  const overview = useMemo(() => normalizeOverview(payload), [payload]);
  const prototypeCdes = useMemo(() => {
    if (overview.cdes.length) return overview.cdes;
    return cdesFromDashboardPayload(cdeDashboardQuery.data);
  }, [cdeDashboardQuery.data, overview.cdes]);
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
    if (!overviewQuery.isPending && (!prototypeMode || !cdeDashboardQuery.isPending)) onSurfaceReady?.();
  }, [cdeDashboardQuery.isPending, onSurfaceReady, overviewQuery.isPending, prototypeMode]);

  const meta = overview.meta || {};
  const loading = overviewQuery.isPending && !taxonomyOverride;
  const cdeLoading = cdeDashboardQuery.isPending && !taxonomyOverride && !overview.cdes.length;
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
    setPrototypeActionMessage("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (normalized === "cdes") url.searchParams.set("tab", "cdes");
      else url.searchParams.delete("tab");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  if (prototypeMode) {
    return (
      <PrototypeGlossaryCdeRegistry
        cdes={prototypeCdes}
        error={error || cdeError}
        loading={activeRegistryTabLoading(registryTab, loading, cdeLoading, overview.glossaryTerms, prototypeCdes)}
        meta={meta}
        onActionMessage={setPrototypeActionMessage}
        onOpenAsset={onOpenAsset}
        onOpenLineage={onOpenLineage}
        onTabChange={changeRegistryTab}
        statusMessage={prototypeActionMessage}
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

function PrototypeGlossaryCdeRegistry({
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
  const visibleTerms = terms.slice(0, 4);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedCdeId, setSelectedCdeId] = useState("");
  const [associationBrowserTermId, setAssociationBrowserTermId] = useState("");
  const selectedTerm = terms.find((term) => term.termId === selectedTermId) || null;
  const selectedCde = cdes.find((cde) => cde.id === selectedCdeId) || null;
  const filteredCdes = useMemo(
    () => [...cdes].sort((left, right) =>
      cdePriorityRank(left) - cdePriorityRank(right) || text(left.name).localeCompare(text(right.name)),
    ),
    [cdes],
  );
  const visibleCdes = filteredCdes.slice(0, 5);
  const termLookup = useMemo(
    () => new Map(terms.map((term) => [term.termId, term])),
    [terms],
  );
  const hierarchyRows = visibleTerms.map((term) => {
    const parent = term.parentTermId ? termLookup.get(term.parentTermId)?.term || term.parentTermId : "Root term";
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
    if (!terms.length) {
      if (selectedTermId) setSelectedTermId("");
      return;
    }
    if (selectedTermId && !terms.some((term) => term.termId === selectedTermId)) {
      setSelectedTermId("");
      setAssociationBrowserTermId("");
    }
  }, [selectedTermId, terms]);
  useEffect(() => {
    if (!cdes.length) {
      if (selectedCdeId) setSelectedCdeId("");
      return;
    }
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
                onActionMessage("New CDE request is unavailable until a backed CDE registry workflow is configured.");
                return;
              }
              onActionMessage("New term request is unavailable until a backed glossary workflow is configured.");
            }}
            type="button"
          >
            + New term
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
            <div className="gh-taxonomy-prototype-count gh-visually-hidden">
              Showing {visibleTerms.length} of {glossaryCount} governed glossary terms
            </div>
          <div className="gh-taxonomy-prototype-hierarchy" aria-label="Glossary hierarchy">
            <div className="gh-taxonomy-prototype-hierarchy-head">
              <span>Hierarchy</span>
              <strong>{terms.length ? `${visibleTerms.length} visible terms` : "Unavailable"}</strong>
            </div>
            <div className="gh-taxonomy-prototype-hierarchy-grid">
              {hierarchyRows.length ? (
                hierarchyRows.map((row) => (
                  <div key={row.id}>
                    <span>{row.parent}</span>
                    <strong>{row.term}</strong>
                    <small>{row.children}</small>
                  </div>
                ))
              ) : (
                Array.from({ length: 4 }, (_, index) => (
                  <div className="is-unavailable" key={`hierarchy-unavailable-${index}`}>
                    <span>Hierarchy unavailable</span>
                    <strong>Term evidence unavailable</strong>
                    <small>No parent or child relationship was returned.</small>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="gh-taxonomy-prototype-card-grid" aria-label="Glossary cards">
            {terms.length ? (
              visibleTerms.map((term) => (
                <article
                  className={`gh-taxonomy-prototype-card ${selectedTerm?.termId === term.termId ? "is-selected" : ""}`}
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
                      <span>{term.domain} · {term.stewardEmail || term.ownerEmail || "Unassigned steward"}</span>
                    </div>
                    <StatusPill tone={statusTone(term.status)}>
                      {prototypeLabel(term.status, "Draft")}
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
                      disabled={!term.assets[0]?.fqn}
                      onClick={(event) => {
                        event.stopPropagation();
                        openTermDetail(term, { showAssociations: true });
                      }}
                      title={term.assets[0]?.fqn ? "Browse associated assets" : "No associated asset FQN is available for this term"}
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
                      title={term.assets[0]?.fqn ? "Prototype linked-asset lineage preview; not live UC lineage proof" : "Lineage requires at least one associated asset"}
                      type="button"
                    >
                      Preview lineage -&gt;
                    </button>
                  </div>
                </article>
              ))
            ) : (
              Array.from({ length: 4 }, (_, index) => (
                <article className="gh-taxonomy-prototype-card is-unavailable" key={`term-unavailable-${index}`}>
                  <div className="gh-taxonomy-prototype-card-head">
                    <div>
                      <h2>Glossary term unavailable</h2>
                      <span>Source and owner unavailable</span>
                    </div>
                    <StatusPill tone="neutral">Unavailable</StatusPill>
                  </div>
                  <p>Term, hierarchy, reviewer, and association evidence was not returned for this scope.</p>
                  <dl className="gh-taxonomy-prototype-card-proof">
                    <div><dt>Source</dt><dd>Unavailable</dd></div>
                    <div><dt>Associations</dt><dd>Unavailable</dd></div>
                    <div><dt>Review</dt><dd>Unavailable</dd></div>
                  </dl>
                </article>
              ))
            )}
          </div>
          {selectedTerm ? (
            <PrototypeTermDetail
              associationBrowserOpen={associationBrowserTermId === selectedTerm.termId}
              onActionMessage={onActionMessage}
              onClose={() => setSelectedTermId("")}
              onOpenAsset={onOpenAsset}
              onOpenLineage={onOpenLineage}
              term={selectedTerm}
            />
          ) : null}
          </div>
        ) : (
          <div className="gh-taxonomy-prototype-section">
            <div className="gh-taxonomy-prototype-count gh-visually-hidden">
              Showing {visibleCdes.length} of {filteredCdes.length} CDE registry rows
            </div>
          <div className="gh-taxonomy-prototype-cde-table" role="table" aria-label="CDE registry table">
            <div className="gh-taxonomy-prototype-cde-head" role="row">
              <span role="columnheader">CDE</span>
              <span role="columnheader">Source-of-record column</span>
              <span role="columnheader">Owner</span>
              <span role="columnheader">Recert</span>
              <span role="columnheader">Status</span>
            </div>
            {visibleCdes.length ? (
              visibleCdes.map((cde) => (
                <div
                  className={`gh-taxonomy-prototype-cde-row ${selectedCde?.id === cde.id ? "is-selected" : ""}`}
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
                  <span role="cell" className="is-mono">{cde.column || "Source column unavailable"}</span>
                  <span role="cell">{cde.owner}</span>
                  <span
                    aria-label={`Recertification ${prototypeFixtureLabel(cde.recert)}. ${cdeRecertEvidenceSummary(cde)}`}
                    role="cell"
                    title={cdeRecertEvidenceSummary(cde)}
                  >
                    <span className="gh-taxonomy-prototype-recert-pill">{prototypeFixtureLabel(cde.recert)}</span>
                  </span>
                  <span
                    aria-label={`Status ${prototypeFixtureLabel(cde.status)}. ${cdeHealthEvidenceSummary(cde)}`}
                    role="cell"
                    title={cdeHealthEvidenceSummary(cde)}
                  >
                    <StatusPill tone={statusTone(cde.status)}>{prototypeFixtureLabel(cde.status)}</StatusPill>
                  </span>
                </div>
              ))
            ) : (
              Array.from({ length: 5 }, (_, index) => (
                <div className="gh-taxonomy-prototype-cde-row is-unavailable" key={`cde-unavailable-${index}`} role="row">
                  <span role="cell">
                    <i aria-hidden="true" className="gh-taxonomy-prototype-key-icon" />
                    <strong>CDE evidence unavailable</strong>
                  </span>
                  <span role="cell" className="is-mono">Source column unavailable</span>
                  <span role="cell">Owner unavailable</span>
                  <span
                    aria-label="Recertification unavailable. Recertification workflow evidence unavailable"
                    role="cell"
                    title="Recertification workflow evidence unavailable"
                  >
                    <span className="gh-taxonomy-prototype-recert-pill">Unavailable</span>
                  </span>
                  <span
                    aria-label="Status unavailable. Quality/test-run evidence unavailable"
                    role="cell"
                    title="Quality/test-run evidence unavailable"
                  >
                    <StatusPill tone="neutral">Unavailable</StatusPill>
                  </span>
                </div>
              ))
            )}
          </div>
          <p className="gh-taxonomy-prototype-cde-provenance gh-visually-hidden">
            Status and recertification are prototype registry fixtures - not live Unity Catalog, quality test-run, or recertification workflow proof.
          </p>
          {selectedCde ? (
            <PrototypeCdeDetail
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
    </section>
  );
}

function PrototypeDetailShell({ children, onClose, title }) {
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

function PrototypeTermDetail({ associationBrowserOpen = false, onActionMessage, onClose, onOpenAsset, onOpenLineage, term }) {
  const [showAssociations, setShowAssociations] = useState(Boolean(associationBrowserOpen));
  const firstAsset = term.assets[0] || null;
  const reviewers = term.reviewers.length ? term.reviewers : [];
  const history = term.termHistory.length ? term.termHistory : [];
  useEffect(() => {
    setShowAssociations(Boolean(associationBrowserOpen));
  }, [associationBrowserOpen, term.termId]);
  return (
    <PrototypeDetailShell onClose={onClose} title={term.term}>
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
            <div><dt>Status</dt><dd>{prototypeLabel(term.status)}</dd></div>
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
              <div><dt>Parent</dt><dd>{term.parentTermId || "Root term"}</dd></div>
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
          disabled={!term.assets.length}
          onClick={() => setShowAssociations((current) => !current)}
          title={term.assets.length ? "Browse all linked assets for this term" : "No linked assets are recorded for this term"}
          type="button"
        >
          {showAssociations ? "Hide associations" : "Browse all associations"}
        </button>
        <button
          onClick={() => onActionMessage(`${term.term} reviewer workflow is unavailable on this route; no glossary mutation was submitted.`)}
          type="button"
        >
          Show reviewer workflow note
        </button>
      </div>
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
    </PrototypeDetailShell>
  );
}

function PrototypeCdeDetail({ cde, onActionMessage, onClose, onOpenAsset, onOpenLineage }) {
  const sourceAssetFqn = sourceAssetFqnForCde(cde);
  return (
    <PrototypeDetailShell onClose={onClose} title={cde.name}>
      <div className="gh-taxonomy-prototype-detail-grid">
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Source-of-record column</h3>
          <p className="is-mono">{cde.column || "Source column unavailable"}</p>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Ownership</h3>
          <dl>
            <div><dt>Owner</dt><dd>{cde.owner || "Unassigned"}</dd></div>
            <div><dt>Recertification</dt><dd>{prototypeFixtureLabel(cde.recert)}</dd></div>
            <div><dt>Status</dt><dd>{prototypeFixtureLabel(cde.status)}</dd></div>
            <div><dt>SOX</dt><dd>{cde.sox ? "SOX-relevant" : "Not marked SOX"}</dd></div>
          </dl>
          <p className="gh-taxonomy-prototype-detail-note">
            Prototype fixture - not live quality, recertification, or Unity Catalog proof.
          </p>
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
          <h3>Reviewer workflow</h3>
          <p>Reviewer and recertification mutations are unavailable on this route until a backed CDE workflow is configured.</p>
        </section>
        <section className="gh-taxonomy-prototype-detail-card">
          <h3>Association source</h3>
          <p>{sourceAssetFqn ? sourceAssetFqn : "No source asset FQN can be derived from this registry row."}</p>
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
          disabled
          title="Recertification workflow is not backed on this route yet."
          type="button"
        >
          Request recertification unavailable
        </button>
        <button
          onClick={() => onActionMessage(`${cde.name} owner workflow is unavailable on this route; no CDE owner mutation was submitted.`)}
          type="button"
        >
          Show owner workflow note
        </button>
        <button
          onClick={() => onActionMessage(`${cde.name} recertification workflow is unavailable on this route; no CDE mutation was submitted.`)}
          type="button"
        >
          Show recertification note
        </button>
      </div>
    </PrototypeDetailShell>
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
