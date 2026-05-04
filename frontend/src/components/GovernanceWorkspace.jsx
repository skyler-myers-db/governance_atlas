import { useEffect, useMemo, useRef, useState } from "react";
import {
  canOpenAssetRecord,
  invalidateAssetDetail,
  prefetchAssetDetail,
  primeAssetDetail,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { useGovernanceAuditTimeline } from "../hooks/useGovernanceAuditTimeline";
import { useGovernanceGlossaryTerm } from "../hooks/useGovernanceGlossaryTerm";
import { clearAssetSearchCache, useAssetSearch } from "../hooks/useAssetSearch";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
import {
  createGovernanceRequest,
  fetchGovernanceRequestDetail,
  fetchGovernanceWorkbench,
  normalizeGovernancePayload,
  updateGovernanceGlossaryTerm,
  updateGovernanceRequest,
  upsertGovernanceGlossaryTerm,
  upsertGovernanceOwner,
} from "../lib/api";
import { atlasQueryClient } from "../lib/queryClient";
import {
  SurfaceHeader,
  SurfacePanelSection,
  SurfaceRail,
  SurfaceRailSection,
  SurfaceTabs,
  SurfaceWorkbench,
  SurfaceWorkbenchMain,
} from "./ShellLayoutPrimitives";
import { EmptyStateBlock, InlineStatusBanner, LoadingState } from "./ShellStatePrimitives";
import { MetricCard } from "./northstar";
import { AuditTimelineDrawer } from "./primitives/AuditTimelineDrawer";
import { ClassificationEvidenceDrawer } from "./primitives/ClassificationEvidenceDrawer";
import {
  useClassificationRecommendation,
  useClassificationRecommendations,
  useClassificationReview,
} from "../hooks/useClassificationRecommendations";
import "../styles/operations-pages.css";

const GLOSSARY_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "deprecated", label: "Deprecated" },
];

const NORTHSTAR_DETAIL_CLOSED = "__governance_detail_closed__";

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

function normalizeGlossaryReviewer(entry, index) {
  if (typeof entry === "string") {
    const email = entry.trim();
    return {
      id: email || `reviewer-${index}`,
      email,
      role: "Reviewer",
      state: "active",
      reviewedAt: "",
      note: "",
    };
  }

  const value = entry && typeof entry === "object" ? entry : {};
  const email = String(value.email || value.ownerEmail || value.reviewerEmail || value.reviewedBy || "").trim();
  return {
    id: value.id || email || `reviewer-${index}`,
    email,
    role: String(value.role || value.reviewerRole || "Reviewer").trim() || "Reviewer",
    state: String(value.state || value.status || "active").trim() || "active",
    reviewedAt: String(value.reviewedAt || value.updatedAt || "").trim(),
    note: String(value.note || value.reviewNote || "").trim(),
  };
}

function normalizeGlossaryHistory(entry, index) {
  if (typeof entry === "string") {
    const note = entry.trim();
    return {
      id: `history-${index}`,
      version: `v${index + 1}`,
      title: note || "Term update",
      changedAt: "",
      changedBy: "",
      status: "",
      note,
    };
  }

  const value = entry && typeof entry === "object" ? entry : {};
  return {
    id: value.id || value.versionId || value.requestId || value.termVersionId || `history-${index}`,
    version:
      String(
        value.version ||
          value.versionLabel ||
          value.revision ||
          value.label ||
          (value.versionNumber ? `v${value.versionNumber}` : "")
      ).trim() || `v${index + 1}`,
    title: String(value.title || value.name || value.action || "Term update").trim(),
    changedAt: String(value.changedAt || value.createdAt || value.updatedAt || "").trim(),
    changedBy: String(value.changedBy || value.createdBy || value.updatedBy || value.reviewedBy || "").trim(),
    status: String(value.status || value.state || "").trim(),
    note: String(value.note || value.changeNote || value.detail || value.reviewNote || value.description || "").trim(),
  };
}

function formatGlossaryReviewerText(entries = []) {
  return (entries || [])
    .map((entry) => {
      const reviewer = normalizeGlossaryReviewer(entry, 0);
      if (!reviewer.email) return "";
      const role = String(reviewer.role || "").trim();
      return role && role.toLowerCase() !== "reviewer"
        ? `${reviewer.email}:${role.toLowerCase()}`
        : reviewer.email;
    })
    .filter(Boolean)
    .join("\n");
}

function parseGlossaryReviewers(value = "") {
  return String(value || "")
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [email, role] = entry.split(":").map((part) => part.trim());
      return {
        reviewerEmail: email || "",
        reviewerRole: role || "reviewer",
      };
    })
    .filter((entry) => entry.reviewerEmail);
}

function formatMetricValue(metric) {
  if (!metric || metric.value == null || metric.state === "unavailable") return "Unavailable";
  return Number.isFinite(Number(metric.value)) ? Number(metric.value).toLocaleString() : String(metric.value);
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
      associationSource: item.associationSource || "",
      assetCount: item.assetCount || 0,
      childCount: item.childCount || 0,
      reviewerCount:
        item.reviewerCount == null
          ? (item.reviewerRoster || item.reviewerAssignments || item.reviewers || []).length
          : item.reviewerCount,
      summarySource: item.summarySource || "live",
      summaryObservedAt: item.summaryObservedAt || "",
      summaryStaleAfter: item.summaryStaleAfter || "",
      assets: item.assets || [],
      createdAt: item.createdAt || "",
      createdBy: item.createdBy || "",
      updatedAt: item.updatedAt || "",
      updatedBy: item.updatedBy || "",
      requestCount: item.requestCount || 0,
      pendingRequestCount: item.pendingRequestCount || 0,
      approvedRequestCount: item.approvedRequestCount || 0,
      rejectedRequestCount: item.rejectedRequestCount || 0,
      reviewers: (item.reviewers || [])
        .map((reviewer) => {
          if (typeof reviewer === "string") return reviewer.trim();
          return String(
            reviewer.email ||
              reviewer.ownerEmail ||
              reviewer.reviewerEmail ||
              reviewer.name ||
              reviewer.reviewedBy ||
              "",
          ).trim();
        })
        .filter(Boolean),
      reviewerRoster: (item.reviewerRoster || item.reviewerAssignments || item.reviewers || []).map(
        (reviewer, reviewerIndex) => normalizeGlossaryReviewer(reviewer, reviewerIndex),
      ),
      assetPreview: item.assetPreview || [],
      recentRequests: item.recentRequests || [],
      termHistory: (item.termHistory || item.versionHistory || item.history || item.recentRequests || []).map(
        (entry, entryIndex) => normalizeGlossaryHistory(entry, entryIndex),
      ),
      currentVersion:
        item.currentVersion ||
        item.version ||
        (item.latestVersion?.versionNumber ? `v${item.latestVersion.versionNumber}` : ""),
      reviewState: item.reviewState || item.status || "Draft",
    })),
  };
}

function mergeGlossaryWorkspaceItem(summaryItem, detailItem) {
  if (!summaryItem) return null;
  if (!detailItem) return summaryItem;
  return {
    ...summaryItem,
    termId: detailItem.termId || summaryItem.termId,
    title: detailItem.term || summaryItem.title,
    subtitle: detailItem.domain || summaryItem.subtitle,
    status: detailItem.status || summaryItem.status,
    detail: detailItem.definition || summaryItem.detail,
    ownerEmail: detailItem.ownerEmail || summaryItem.ownerEmail,
    associationSource: detailItem.associationSource || summaryItem.associationSource,
    assetCount:
      detailItem.assetCount == null ? summaryItem.assetCount : detailItem.assetCount,
    childCount:
      detailItem.childCount == null ? summaryItem.childCount : detailItem.childCount,
    reviewerCount:
      detailItem.reviewerCount == null ? summaryItem.reviewerCount : detailItem.reviewerCount,
    summarySource: detailItem.summarySource || summaryItem.summarySource,
    summaryObservedAt: detailItem.summaryObservedAt || summaryItem.summaryObservedAt,
    summaryStaleAfter: detailItem.summaryStaleAfter || summaryItem.summaryStaleAfter,
    assets: Array.isArray(detailItem.assets) ? detailItem.assets : summaryItem.assets,
    createdAt: detailItem.createdAt || summaryItem.createdAt,
    createdBy: detailItem.createdBy || summaryItem.createdBy,
    updatedAt: detailItem.updatedAt || summaryItem.updatedAt,
    updatedBy: detailItem.updatedBy || summaryItem.updatedBy,
    requestCount:
      detailItem.requestCount == null ? summaryItem.requestCount : detailItem.requestCount,
    pendingRequestCount:
      detailItem.pendingRequestCount == null
        ? summaryItem.pendingRequestCount
        : detailItem.pendingRequestCount,
    approvedRequestCount:
      detailItem.approvedRequestCount == null
        ? summaryItem.approvedRequestCount
        : detailItem.approvedRequestCount,
    rejectedRequestCount:
      detailItem.rejectedRequestCount == null
        ? summaryItem.rejectedRequestCount
        : detailItem.rejectedRequestCount,
    reviewers: Array.isArray(detailItem.reviewers) ? detailItem.reviewers : summaryItem.reviewers,
    reviewerRoster: Array.isArray(detailItem.reviewerRoster)
      ? detailItem.reviewerRoster
      : summaryItem.reviewerRoster,
    assetPreview: Array.isArray(detailItem.assetPreview)
      ? detailItem.assetPreview
      : summaryItem.assetPreview,
    recentRequests: Array.isArray(detailItem.recentRequests)
      ? detailItem.recentRequests
      : summaryItem.recentRequests,
    termHistory: Array.isArray(detailItem.termHistory)
      ? detailItem.termHistory
      : summaryItem.termHistory,
    currentVersion: detailItem.currentVersion || summaryItem.currentVersion,
    reviewState: detailItem.reviewState || summaryItem.reviewState,
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

function governanceLaneTone(key, count) {
  const n = Number(count || 0);
  if (n === 0) return "neutral";
  if (key === "trust") return "bad";
  if (key === "ownership") return "warn";
  if (key === "classification") return "info";
  return "accent";
}

function workLanes(requests = []) {
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
    { key: "ownership", label: "Ownership work", count: laneCounts.ownership },
    {
      key: "classification",
      label: "Classification work",
      count: laneCounts.classification,
    },
    {
      key: "trust",
      label: "Trust work",
      count: laneCounts.trust,
    },
  ];
}

function authoritativeQueueLanes(queue = {}) {
  const laneCounts = queue?.laneCounts || {};
  return [
    { key: "open-work", label: "Open work", count: Number(laneCounts["open-work"] || 0) },
    { key: "ownership", label: "Ownership work", count: Number(laneCounts.ownership || 0) },
    {
      key: "classification",
      label: "Classification work",
      count: Number(laneCounts.classification || 0),
    },
    {
      key: "trust",
      label: "Trust work",
      count: Number(laneCounts.trust || 0),
    },
  ];
}

function displayMetricValue(value) {
  if (value === 0) return "0";
  return value == null || value === "" ? "—" : String(value);
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

function GovernanceGlyph({ icon = "inbox" }) {
  const glyphs = {
    inbox: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M4 12h4l2 3h4l2-3h4" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3l9 16H3z" />
        <path d="M12 8v5" />
        <path d="M12 17h.01" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3l7 3v5c0 4.5-2.7 7.9-7 10-4.3-2.1-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-5" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19h16" />
        <path d="M7 16v-5" />
        <path d="M12 16V7" />
        <path d="M17 16v-8" />
        <path d="M6 9l4-4 4 4 5-6" />
      </>
    ),
    filter: (
      <>
        <path d="M4 5h16" />
        <path d="M7 12h10" />
        <path d="M10 19h4" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
        <path d="M16 3.1a4 4 0 0 1 0 7.8" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    "user-plus": (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21a7 7 0 0 1 14 0" />
        <path d="M19 8v6" />
        <path d="M16 11h6" />
      </>
    ),
    table: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M4 10h16" />
        <path d="M10 5v14" />
      </>
    ),
    chevron: (
      <path d="M9 18l6-6-6-6" />
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </>
    ),
    check: (
      <path d="M5 12l4 4L19 6" />
    ),
    archive: (
      <>
        <path d="M21 8v13H3V8" />
        <path d="M1 3h22v5H1z" />
        <path d="M10 12h4" />
      </>
    ),
    sparkles: (
      <>
        <path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8z" />
        <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
      </>
    ),
    badge: (
      <>
        <path d="M12 3l3 2 3.5-.5.5 3.5 2 3-2 3-.5 3.5-3.5-.5-3 2-3-2-3.5.5L5 14l-2-3 2-3 .5-3.5L9 5z" />
        <path d="M8.5 12l2.2 2.2 4.8-5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.9-1.1L14.3 3h-4.6l-.4 2.9A7 7 0 0 0 7.4 7L5 6 3 9.4l2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.1l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.9 1.1l.4 2.9h4.6l.4-2.9a7 7 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1.1z" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      {glyphs[icon] || glyphs.inbox}
    </svg>
  );
}

function textValue(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeCurrentUser(value = {}) {
  /** @type {{ email?: string, userEmail?: string, actorEmail?: string, name?: string, userName?: string, actorName?: string, displayName?: string, role?: string, actorRole?: string }} */
  const user = value && typeof value === "object" ? value : {};
  const email = textValue(user.email || user.userEmail || user.actorEmail).toLowerCase();
  const name = textValue(user.name || user.userName || user.actorName || user.displayName).toLowerCase();
  const role = textValue(user.role || user.actorRole);
  const aliases = new Set();
  if (email) {
    aliases.add(email);
    aliases.add(email.split("@")[0]);
  }
  if (name) {
    aliases.add(name);
    name.split(/\s+/).filter(Boolean).forEach((part) => aliases.add(part));
  }
  return { email, name, role, aliases: [...aliases].filter((item) => item.length >= 3) };
}

function governanceMutationRole(currentUser = {}, bootstrap = {}) {
  return textValue(
    currentUser?.role ||
      currentUser?.actorRole ||
      bootstrap?.shell?.role ||
      bootstrap?.shell?.actorRole ||
      "",
  );
}

function canMutateGovernanceRequests(currentUser = {}, bootstrap = {}) {
  return /\b(?:admin|steward)\b/i.test(governanceMutationRole(currentUser, bootstrap));
}

function assetNameFromFqn(value = "") {
  const parts = String(value || "").split(".").filter(Boolean);
  return parts[parts.length - 1] || "Unassigned asset";
}

function assetDomainFromRequest(request = {}) {
  return textValue(request.domain, "Unassigned");
}

function requestTypeLabel(request = {}) {
  return textValue(request.type || request.requestType || request.category, "");
}

function requestPriority(request = {}) {
  return textValue(request.priority, "Unassigned");
}

function priorityTone(priority = "") {
  const value = String(priority || "").toLowerCase();
  if (value.includes("p1") || value.includes("crit") || value.includes("high")) return "high";
  if (value.includes("p2") || value.includes("medium")) return "medium";
  if (value.includes("p3") || value.includes("low")) return "low";
  return "unassigned";
}

function priorityShortLabel(priority = "") {
  const value = String(priority || "").toLowerCase();
  if (value.includes("p1") || value.includes("crit") || value.includes("high")) return "P1";
  if (value.includes("p2") || value.includes("medium")) return "P2";
  if (value.includes("p3") || value.includes("low")) return "P3";
  return textValue(priority, "—");
}

function priorityDisplayLabel(priority = "") {
  const value = textValue(priority, "Unassigned");
  return value === "Unassigned" ? "Priority unassigned" : `${value} Priority`;
}

function formatShortDate(value = "") {
  const text = textValue(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dueLabel(request = {}) {
  const due = formatShortDate(request.dueAt);
  return due ? `Due ${due}` : "Due not set";
}

function slaTone(request = {}) {
  const state = String(request.slaState || "").toLowerCase();
  if (["crit", "critical", "overdue", "breach"].some((term) => state.includes(term))) return "crit";
  if (["warn", "warning", "today"].some((term) => state.includes(term))) return "warn";
  if (["good", "ok", "healthy"].some((term) => state.includes(term))) return "good";
  const dueAt = request.dueAt ? new Date(request.dueAt).getTime() : Number.NaN;
  if (Number.isFinite(dueAt)) {
    const hours = (dueAt - Date.now()) / 36e5;
    if (hours < 0) return "crit";
    if (hours <= 24) return "warn";
    return "good";
  }
  return "muted";
}

function slaLabel(request = {}) {
  return textValue(request.sla || request.slaLabel || request.dueLabel, dueLabel(request));
}

function hasSlaEvidence(request = {}) {
  return Boolean(
    textValue(request.sla || request.slaLabel || request.dueLabel || request.slaState || request.dueAt),
  );
}

function hasNonAuthoritativeWorkItemMarker(...values) {
  const haystack = values.map((value) => {
    if (value == null) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (_error) {
        return "";
      }
    }
    return String(value);
  }).join(" ").toLowerCase();
  return /prototype|mock|fixture|validation[_\s-]*seed|validation sample|home[_\s-]*northstar[_\s-]*seed|home[_\s-]*evidence[_\s-]*plane|ga[_\s-]*home[_\s-]*seed/.test(haystack);
}

function openingEvidenceFacts(request = {}) {
  if (!request) return [];
  const source = customerSafeEvidenceSource(textValue(
      request.source ||
      request.evidenceSource ||
      request.provenance?.source ||
      request.meta?.source,
    "Unavailable",
  ));
  const observedAt = textValue(
    request.observedAt ||
      request.evidenceObservedAt ||
      request.createdAt ||
      request.updatedAt,
    "Timestamp unavailable",
  );
  return [
    ["Trigger", workItemKind(request)],
    ["Source", source],
    ["Observed", formatShortDate(observedAt) || observedAt],
    ["Affected asset", textValue(request.assetFqn || request.assetName, "Asset unavailable")],
  ];
}

function workItemKind(request = {}) {
  return textValue(request.kind || request.issue || request.rawTitle || request.title, "Governance work item");
}

function workItemAssigned(request = {}) {
  return textValue(request.assigned || request.assignee || request.assignedTo || request.team || request.ownerTeam || request.requester, "Unassigned");
}

function isValidationWorkItem(request = {}) {
  if (!request || typeof request !== "object") return false;
  const requestId = textValue(request.requestId || request.id).toLowerCase();
  const source = textValue(request.source || request.provenance?.source || request.meta?.source).toLowerCase();
  return request.validationSample === true || hasNonAuthoritativeWorkItemMarker(requestId, source, request);
}

function workItemDisplayId(request = {}) {
  const requestId = textValue(request.requestId || request.id, "—");
  const evidenceMatch = requestId.match(/^(?:ga-home-evidence|GOV-HOME-EVIDENCE)-request-(\d+)$/i);
  if (evidenceMatch) return `GOV-${evidenceMatch[1]}`;
  return requestId.length > 14 ? `${requestId.slice(0, 11)}…` : requestId;
}

function customerSafeEvidenceSource(source = "") {
  const text = textValue(source, "Unavailable");
  if (/home-evidence-plane|home-northstar-seed|seed|fixture|prototype|mock/i.test(text)) {
    return "Evidence source unavailable";
  }
  if (/metadata_audit|metadata audit/i.test(text)) return "Governance audit log";
  return text;
}

function isP1WorkItem(request = {}) {
  return priorityTone(request.priority) === "high";
}

function isOverdueWorkItem(request = {}) {
  return slaTone(request) === "crit";
}

function isAssignedToCurrentUser(request = {}, currentUser = {}) {
  const assigned = workItemAssigned(request).toLowerCase();
  if (!assigned || assigned === "unassigned") return false;
  if (request.assignedToMe === true) return true;
  const identity = normalizeCurrentUser(currentUser);
  if (!identity.aliases.length) return false;
  return identity.aliases.some((alias) => assigned.includes(alias));
}

function queueFilterMatches(request = {}, filter = "all", currentUser = {}) {
  if (filter === "p1") return isP1WorkItem(request);
  if (filter === "overdue") return isOverdueWorkItem(request);
  if (filter === "mine") return isAssignedToCurrentUser(request, currentUser);
  return true;
}

function queueFilterCounts(requests = [], currentUser = {}) {
  return {
    all: requests.length,
    p1: requests.filter(isP1WorkItem).length,
    overdue: requests.filter(isOverdueWorkItem).length,
    mine: requests.filter((request) => isAssignedToCurrentUser(request, currentUser)).length,
  };
}

function suggestedActionsFor(request = {}) {
  const actions = Array.isArray(request.suggestedActions) ? request.suggestedActions : [];
  return actions.filter((action) => action && !hasNonAuthoritativeWorkItemMarker(action));
}

function finiteMetricValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeNorthstarRequest(request = {}, index = 0) {
  const requestId = textValue(request.requestId || request.id);
  const assetFqn = textValue(request.assetFqn || request.asset);
  const kind = workItemKind(request);
  return {
    ...request,
    requestId,
    id: requestId,
    title: textValue(request.title || kind, "Governance work item"),
    rawTitle: textValue(request.rawTitle || request.title || kind, "Governance work item"),
    kind,
    typeLabel: requestTypeLabel(request),
    detail: textValue(request.detail || request.note || request.newComment),
    priority: requestPriority(request),
    status: textValue(request.status, "Unavailable"),
    requester: textValue(request.requester || request.createdBy, "Requester unavailable"),
    createdAt: textValue(request.createdAt),
    dueAt: textValue(request.dueAt),
    assetFqn,
    assetName: assetNameFromFqn(assetFqn),
    domain: assetDomainFromRequest(request),
    assigned: workItemAssigned(request),
    sla: textValue(request.sla || request.slaLabel || request.dueLabel),
    slaState: textValue(request.slaState),
    age: textValue(request.age),
    evidence: textValue(request.evidence || request.businessContext || request.detail || request.note),
    suggestedActions: Array.isArray(request.suggestedActions) ? request.suggestedActions : [],
    implementation: textValue(request.implementation),
    validationSample: isValidationWorkItem(request),
  };
}

export default function GovernanceWorkspace({
  initialAssetFqn,
  bootstrap,
  contextSeedAssets = [],
  currentUser = null,
  governance,
  onNavigationStateChange,
  onSurfaceReady,
  onGovernanceChange,
  onRouteAssetChange,
  onOpenAsset,
  onOpenLineage,
  runtimeFeatureFlags = [],
}) {
  const [focusedAssetFqn, setFocusedAssetFqn] = useState(initialAssetFqn || "");
  const [liveGovernance, setLiveGovernance] = useState(governance);
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const seeded = useSeededAssetContext(focusedAssetFqn, bootstrap, seedAssets, { allowFallback: false });
  const assetDetail = useAssetDetail(focusedAssetFqn || "", { sections: ["header", "activity"] });
  const [focusedAssetSnapshot, setFocusedAssetSnapshot] = useState(null);
  const focusedAsset = focusedAssetSnapshot || assetDetail.detail || seeded.summary;
  const views = useMemo(() => governanceViews(liveGovernance), [liveGovernance]);
  const governanceWarnings = Array.isArray(liveGovernance?.provenance?.warnings)
    ? liveGovernance.provenance.warnings.filter(Boolean)
    : [];
  const governanceAuthoritative = liveGovernance?.authoritative === true;
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
  const [glossaryReviewerText, setGlossaryReviewerText] = useState("");
  const [glossaryChangeNote, setGlossaryChangeNote] = useState("");
  const [glossaryDraft, setGlossaryDraft] = useState({
    name: "",
    definition: "",
    domain: "",
    ownerEmail: "",
    status: "draft",
    reviewersText: "",
    changeNote: "",
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
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const auditTimeline = useGovernanceAuditTimeline(focusedAssetFqn, {
    enabled: auditDrawerOpen,
  });
  // A9.4 — classification recommendations + drawer state.
  const classificationRecommendations = useClassificationRecommendations({
    status: "pending",
    assetFqn: focusedAssetFqn,
  });
  const pendingClassificationCount =
    classificationRecommendations.data?.pendingCount ??
    classificationRecommendations.data?.count ??
    0;
  const [northstarWorkbench, setNorthstarWorkbench] = useState(null);
  const [northstarLoading, setNorthstarLoading] = useState(false);
  const [northstarError, setNorthstarError] = useState("");
  const [northstarSelectedRequestId, setNorthstarSelectedRequestId] = useState("");
  const [northstarDetail, setNorthstarDetail] = useState(null);
  const [northstarQueueFilter, setNorthstarQueueFilter] = useState("all");
  const [northstarMenu, setNorthstarMenu] = useState("");
  const [northstarPage, setNorthstarPage] = useState(1);
  const [northstarActionMessage, setNorthstarActionMessage] = useState("");
  const [northstarActionPanel, setNorthstarActionPanel] = useState(null);
  // Toast-style status surface for staged actions (New work item, etc.).
  // Cleared on next action panel open or after a 6s timeout.
  const [statusMessage, setStatusMessage] = useState("");
  useEffect(() => {
    if (!statusMessage) return undefined;
    const handle = window.setTimeout(() => setStatusMessage(""), 6000);
    return () => window.clearTimeout(handle);
  }, [statusMessage]);
  const workbenchMetrics = useMemo(() => ([
    { key: "requests", label: "Governance Requests", value: views.requests.length },
    { key: "glossary", label: "Glossary Terms", value: views.glossary.length },
    { key: "focusedAsset", label: "Focused Asset", value: focusedAssetFqn ? 1 : 0 },
    {
      key: "classificationReviews",
      label: "Classification Reviews",
      value: pendingClassificationCount,
    },
  ]), [focusedAssetFqn, pendingClassificationCount, views.glossary.length, views.requests.length]);
  const [classificationDrawerOpen, setClassificationDrawerOpen] = useState(false);
  const [activeClassificationId, setActiveClassificationId] = useState("");
  const activeClassification = useClassificationRecommendation(activeClassificationId, {
    enabled: classificationDrawerOpen && Boolean(activeClassificationId),
  });
  const classificationReview = useClassificationReview();
  const openClassificationDrawer = (recommendationId = "") => {
    const list = classificationRecommendations.data?.recommendations || [];
    const fallback = list[0]?.recommendationId || "";
    setActiveClassificationId(recommendationId || fallback);
    setClassificationDrawerOpen(true);
  };
  const closeClassificationDrawer = () => {
    setClassificationDrawerOpen(false);
  };
  const handleClassificationReview = async ({ recommendationId, decision, note }) => {
    try {
      await classificationReview.review({ recommendationId, decision, note });
      classificationRecommendations.refresh?.();
      setClassificationDrawerOpen(false);
    } catch {
      // Error surfaces via classificationReview.error; drawer stays open.
    }
  };

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
    if (!focusedAssetFqn) {
      onSurfaceReady?.();
      return;
    }
    if (focusedAsset?.fqn === focusedAssetFqn && (!assetDetail.loading || assetDetail.detail?.fqn === focusedAssetFqn)) {
      onSurfaceReady?.();
    }
  }, [
    assetDetail.detail?.fqn,
    assetDetail.loading,
    focusedAsset?.fqn,
    focusedAssetFqn,
    onSurfaceReady,
  ]);

  useEffect(() => {
    setLiveGovernance(governance);
  }, [governance]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setNorthstarLoading(true);
    setNorthstarError("");
    fetchGovernanceWorkbench({ signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        setNorthstarWorkbench(payload);
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") return;
        setNorthstarError(error?.message || "Unable to load governance workbench.");
      })
      .finally(() => {
        if (!cancelled) setNorthstarLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const focusAsset = (assetFqn, options = {}) => {
    const {
      preserveWork = false,
      preserveGlossary = mode === "glossary",
      preserveLane = false,
      syncRoute = false,
    } = options;
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
  const queueSource = String(liveGovernance?.queue?.source || "").trim().toLowerCase();
  const openGlossaryWorkbench = () => {
    const firstGlossaryTermId = views.glossary[0]?.id || "";
    setMode("glossary");
    setSelectedWorkId("");
    setNorthstarMenu("");
    setNorthstarActionMessage("");
    setSelectedGlossaryId((current) => {
      if (current && views.glossary.some((item) => item.id === current)) return current;
      return firstGlossaryTermId;
    });
  };

  const workItems = useMemo(() => {
    if (!focusedAssetFqn) return views.requests;
    if (focusedAsset) {
      return views.requests.filter((item) => item.assetFqn === focusedAsset.fqn);
    }
    if (focusedAssetUnavailable) {
      return views.requests.filter((item) => item.assetFqn === focusedAssetFqn);
    }
    return [];
  }, [focusedAsset, focusedAssetFqn, focusedAssetUnavailable, views.requests]);
  const assetScopedEmpty = Boolean(focusedAssetFqn) && !workItems.length;
  const visibleWorkItems = useMemo(() => {
    if (selectedLaneKey === "open-work") return workItems;
    return workItems.filter((item) => requestLane(item) === selectedLaneKey);
  }, [selectedLaneKey, workItems]);
  const selectedItem = visibleWorkItems.find((item) => item.id === selectedWorkId) || null;
  const actionTrack = governanceActionTrack(focusedAsset);
  const laneSummary = focusedAssetFqn
    ? workLanes(workItems)
    : authoritativeQueueLanes(liveGovernance?.queue);
  const lanePanelTitle = focusedAssetFqn ? "Visible work filters" : "Work lanes";
  const lanePanelMeta = focusedAssetFqn
    ? `${visibleWorkItems.length} visible`
    : queueSource === "projection"
      ? "Authoritative queue"
      : "Live queue";
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
    const filtered = !query
      ? scoped
      : scoped.filter((item) => {
          return (
            item.title.toLowerCase().includes(query) ||
            item.detail.toLowerCase().includes(query) ||
            item.subtitle.toLowerCase().includes(query)
          );
        });
    // Phase 5 Tranche D — depth-first order so children appear directly beneath
    // their parent term. Depth drives the left-indent rendering in the list so
    // stewards see the glossary hierarchy instead of a flat 50-term wall.
    const byTermId = new Map();
    filtered.forEach((item) => {
      const termId = String(item.termId || item.id || "");
      if (termId) byTermId.set(termId, item);
    });
    const childrenByParent = new Map();
    const roots = [];
    filtered.forEach((item) => {
      const parentId = String(item.parentTermId || "");
      if (parentId && byTermId.has(parentId)) {
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(item);
      } else {
        roots.push(item);
      }
    });
    const ordered = [];
    const walk = (node, depth) => {
      ordered.push({ ...node, _depth: depth });
      const children = childrenByParent.get(String(node.termId || node.id || "")) || [];
      children.forEach((child) => walk(child, depth + 1));
    };
    roots.forEach((root) => walk(root, 0));
    return ordered;
  }, [glossaryCollection, glossaryQuery, views.glossary]);
  const selectedGlossarySummary = views.glossary.find((item) => item.id === selectedGlossaryId) || null;
  const glossaryTermDetail = useGovernanceGlossaryTerm(selectedGlossarySummary?.termId || "", {
    enabled: mode === "glossary" && Boolean(selectedGlossarySummary?.termId),
    seedTerm: selectedGlossarySummary,
  });
  const selectedGlossary = useMemo(
    () =>
      mergeGlossaryWorkspaceItem(
        selectedGlossarySummary,
        glossaryTermDetail.term,
      ),
    [glossaryTermDetail.term, selectedGlossarySummary],
  );
  const selectedGlossaryReviewers = selectedGlossary?.reviewerRoster || [];
  const selectedGlossaryHistory = selectedGlossary?.termHistory || selectedGlossary?.recentRequests || [];
  const focusedAssetAttributes = focusedAsset
    ? [
        { label: "Domain", value: focusedAsset.domain || "Unassigned" },
        { label: "Tier", value: focusedAsset.tier || "Unassigned" },
        { label: "Certification", value: focusedAsset.certification || "Unassigned" },
        { label: "Sensitivity", value: focusedAsset.sensitivity || "Unassigned" },
        { label: "Coverage", value: displayMetricValue(focusedAsset.coverageScore) },
        { label: "Requests", value: displayMetricValue(focusedAsset.openRequests) },
      ]
    : [];
  const selectedGlossaryAttributes = selectedGlossary
    ? [
        { label: "Domain", value: selectedGlossary.subtitle || "Unassigned" },
        { label: "Owner", value: selectedGlossary.ownerEmail || "Unassigned" },
        { label: "Status", value: selectedGlossary.reviewState || selectedGlossary.status || "Draft" },
        { label: "Association", value: selectedGlossary.associationSource || "tags" },
        { label: "Version", value: selectedGlossary.currentVersion || "—" },
        { label: "Assets", value: `${selectedGlossary.assetCount || 0}` },
        { label: "Child terms", value: `${selectedGlossary.childCount || 0}` },
        { label: "Requests", value: `${selectedGlossary.requestCount || 0}` },
        { label: "Reviewers", value: `${selectedGlossary.reviewerCount || 0}` },
        { label: "History", value: `${selectedGlossary.termHistory?.length || 0}` },
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
      if (views.glossary.some((item) => item.id === current)) return current;
      return "";
    });
  }, [views.glossary]);

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
        reviewersText: "",
        changeNote: "",
      });
      return;
    }
    setGlossaryDraft({
      name: selectedGlossary.title || "",
      definition: selectedGlossary.detail || "",
      domain: selectedGlossary.subtitle || "",
      ownerEmail: selectedGlossary.ownerEmail && selectedGlossary.ownerEmail !== "Unassigned" ? selectedGlossary.ownerEmail : "",
      status: String(selectedGlossary.status || "draft").toLowerCase(),
      reviewersText: formatGlossaryReviewerText(selectedGlossary.reviewerRoster || []),
      changeNote: "",
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
    setGlossaryReviewerText("");
    setGlossaryChangeNote("");
    setMutationState({ kind: "", loading: false, error: "", success: "" });
  }, [focusedAssetFqn]);

  const runGovernanceMutation = async (kind, executor, success) => {
    setMutationState({ kind, loading: true, error: "", success: "" });
    try {
      const next = await executor();
      if (next?.asset?.fqn) {
        primeAssetDetail(next.asset.fqn, next.asset);
        if (next.asset.fqn === focusedAssetFqn) {
          setFocusedAssetSnapshot(null);
        }
      } else if (focusedAssetFqn) {
        invalidateAssetDetail(focusedAssetFqn);
        await prefetchAssetDetail(focusedAssetFqn, {
          force: true,
          sections: ["header", "activity"],
        }).catch(() => null);
        setFocusedAssetSnapshot(null);
      }
      clearAssetSearchCache();
      const hasGovernanceEnvelope =
        next && typeof next === "object" && Object.prototype.hasOwnProperty.call(next, "governance");
      const nextGovernance = hasGovernanceEnvelope
        ? (next.governance ? normalizeGovernancePayload(next.governance) : null)
        : normalizeGovernancePayload(next);
      if (selectedGlossary?.termId) {
        void atlasQueryClient.invalidateQueries({
          queryKey: ["governanceGlossaryTerm", selectedGlossary.termId],
        });
      }
      if (next?.termId && next?.term) {
        atlasQueryClient.setQueryData(
          ["governanceGlossaryTerm", next.termId],
          next.term,
        );
      }
      if (nextGovernance) {
        setLiveGovernance(nextGovernance);
        onGovernanceChange?.(nextGovernance);
      }
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
    return openAssetRecordSafely(assetFqn, {
      loadingLabel: "Opening metadata record…",
      sections: ["header", "activity"],
      canOpen: canOpenAssetRecord,
      onNavigationStateChange,
      onOpen: () => {
        onOpenAsset(assetFqn);
      },
    });
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
          reviewers: parseGlossaryReviewers(glossaryDraft.reviewersText),
          changeNote: glossaryDraft.changeNote.trim(),
        }),
      "Glossary term updated.",
    );
  };

  const governanceModeItems = [
    { key: "stewardship", label: "Stewardship" },
    { key: "glossary", label: "Glossary" },
  ];

  const governanceHeaderIdentity = focusedAsset
    ? `${focusedAsset.name} · ${focusedAsset.catalog} / ${focusedAsset.schema}`
    : focusedAssetLimited
      ? "Live detail limited"
      : "Review governance work, glossary terms, and asset stewardship state.";

  const governanceHeaderMeta = [
    governanceAuthoritative ? "Control plane live" : "Control plane degraded",
    focusedAssetFqn ? "Focused asset" : "Open work view",
  ];

  const glossaryCollectionTabs = glossaryCollectionsList.map((collection) => ({
    key: collection.key,
    label: `${collection.label} (${collection.count})`,
  }));

  const northstarUseBootstrapFallback = Boolean(
    northstarError && !Array.isArray(northstarWorkbench?.requests),
  );
  const northstarWorkbenchEvidenceEnvelope = northstarWorkbench
    ? {
        authoritative: northstarWorkbench.authoritative,
        evidenceKind: northstarWorkbench.evidenceKind,
        meta: northstarWorkbench.meta,
        mockApi: northstarWorkbench.mockApi,
        provenance: northstarWorkbench.provenance,
        source: northstarWorkbench.source,
        state: northstarWorkbench.state,
        warnings: northstarWorkbench.warnings,
      }
    : null;
  const northstarPrototypeEvidence = isNonAuthoritativeMockEvidence(northstarWorkbenchEvidenceEnvelope);
  const northstarQueueUniverse = useMemo(() => {
    const rawRequests = Array.isArray(northstarWorkbench?.requests)
      ? northstarWorkbench.requests
      : northstarUseBootstrapFallback
        ? views.requests
        : [];
    const normalized = rawRequests.map((item, index) => normalizeNorthstarRequest(item, index));
    const trustworthyRows = northstarPrototypeEvidence
      ? []
      : normalized.filter((item) => !isValidationWorkItem(item));
    return focusedAssetFqn
      ? trustworthyRows.filter((item) => item.assetFqn === focusedAssetFqn)
      : trustworthyRows;
  }, [focusedAssetFqn, northstarPrototypeEvidence, northstarUseBootstrapFallback, northstarWorkbench?.requests, views.requests]);

  const northstarQueueCounts = useMemo(
    () => queueFilterCounts(northstarQueueUniverse, currentUser || {}),
    [currentUser, northstarQueueUniverse],
  );

  const northstarRequests = useMemo(() => {
    const filtered = northstarQueueUniverse.filter((item) => queueFilterMatches(item, northstarQueueFilter, currentUser || {}));
    return [...filtered].sort((a, b) => {
      const explicitA = Number(a.sortOrder);
      const explicitB = Number(b.sortOrder);
      if (Number.isFinite(explicitA) && Number.isFinite(explicitB) && explicitA !== explicitB) {
        return explicitA - explicitB;
      }
      const order = { high: 0, medium: 1, low: 2 };
      const priorityDelta = (order[priorityTone(a.priority)] ?? 3) - (order[priorityTone(b.priority)] ?? 3);
      if (priorityDelta) return priorityDelta;
      const aDue = new Date(a.dueAt || "9999-12-31").getTime();
      const bDue = new Date(b.dueAt || "9999-12-31").getTime();
      return aDue - bDue;
    });
  }, [currentUser, northstarQueueFilter, northstarQueueUniverse]);

  const northstarPageSize = 8;
  const northstarPageCount = Math.max(1, Math.ceil(northstarRequests.length / northstarPageSize));
  const northstarVisibleRequests = northstarRequests.slice(
    (northstarPage - 1) * northstarPageSize,
    northstarPage * northstarPageSize,
  );
  const activeNorthstarRequest =
    northstarSelectedRequestId === NORTHSTAR_DETAIL_CLOSED
      ? null
      : northstarRequests.find((item) => item.id === northstarSelectedRequestId) ||
        northstarRequests[0] ||
        null;

  useEffect(() => {
    if (northstarPage > northstarPageCount) setNorthstarPage(northstarPageCount);
  }, [northstarPage, northstarPageCount]);

  useEffect(() => {
    setNorthstarPage(1);
  }, [northstarQueueFilter]);

  useEffect(() => {
    if (!northstarRequests.length) {
      setNorthstarSelectedRequestId("");
      return;
    }
    if (northstarSelectedRequestId === NORTHSTAR_DETAIL_CLOSED) return;
    if (northstarRequests.some((item) => item.id === northstarSelectedRequestId)) return;
    setNorthstarSelectedRequestId(northstarRequests[0].id);
  }, [northstarRequests, northstarSelectedRequestId]);

  useEffect(() => {
    if (!activeNorthstarRequest?.requestId) {
      setNorthstarDetail(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    fetchGovernanceRequestDetail(activeNorthstarRequest.requestId, { signal: controller.signal })
      .then((payload) => {
        if (!cancelled) setNorthstarDetail(payload);
      })
      .catch((error) => {
        if (!cancelled && error?.name !== "AbortError") setNorthstarDetail(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeNorthstarRequest?.requestId]);

  const northstarSelectedDetail = activeNorthstarRequest
    ? northstarDetail?.requestId === activeNorthstarRequest.requestId
      ? { ...activeNorthstarRequest, ...northstarDetail }
      : activeNorthstarRequest
    : null;

  const showNorthstarActionPanel = (panel) => {
    setNorthstarMenu("");
    setNorthstarActionMessage("");
    setNorthstarActionPanel(panel);
  };

  const showBulkAssignPanel = () => {
    showNorthstarActionPanel({
      kind: "bulk",
      title: "Bulk assignment requires a backed workflow",
      eyebrow: "Bulk assign",
      body: `${northstarRequests.length} visible work item${northstarRequests.length === 1 ? "" : "s"} can be reviewed here. Assignment writes are unavailable until the governance workbench exposes an assignee mutation.`,
      facts: [
        ["Visible items", northstarRequests.length.toLocaleString()],
        ["Current filter", queueTabs.find((tab) => tab.key === northstarQueueFilter)?.label || "All"],
        ["Write state", "Unavailable"],
      ],
      disabledAction: "Submit assignment unavailable",
    });
  };

  const showNewWorkItemPanel = () => {
    showNorthstarActionPanel({
      kind: "new",
      title: "New work item creation is unavailable",
      eyebrow: "New work item",
      body: "Work item creation requires a backed governance request mutation. No local draft or synthetic task was created.",
      facts: [
        ["Focused asset", focusedAssetFqn || "No asset selected"],
        ["Submit target", "Governance request API"],
        ["Write state", "Unavailable"],
      ],
      disabledAction: "Create work item unavailable",
    });
  };

  const showSuggestedActionPanel = (action) => {
    showNorthstarActionPanel({
      kind: "suggested",
      title: action.label || "Suggested action",
      eyebrow: "Suggested action review",
      body: action.detail || "Review the work item evidence before making a metadata change.",
      facts: [
        ["Work item", northstarSelectedDetail ? workItemDisplayId(northstarSelectedDetail) : "No selected item"],
        ["Mutation", "Not performed"],
        ["Evidence", northstarSelectedDetail?.evidence ? "Recorded" : "Unavailable"],
      ],
      disabledAction: "Run suggested action unavailable",
    });
  };

  const updateNorthstarRequestStatus = async (status, reviewNote) => {
    if (!northstarSelectedDetail?.requestId) return;
    setNorthstarActionPanel(null);
    await runGovernanceMutation(
      "request-status",
      () =>
        updateGovernanceRequest(northstarSelectedDetail.requestId, {
          status: status === "commented" ? northstarSelectedDetail.status : status,
          reviewNote,
        }, { fast: true }),
      status === "approved" ? "Request approved." : "Request updated.",
    );
    setNorthstarWorkbench((current) => {
      if (!current?.requests) return current;
      const statusLabel =
        status === "approved" ? "Approved" :
        status === "rejected" ? "Rejected" :
        status === "resolved" ? "Resolved" :
        northstarSelectedDetail.status;
      return {
        ...current,
        requests: current.requests.map((item) =>
          (item.requestId || item.id) === northstarSelectedDetail.requestId
            ? { ...item, status: statusLabel, reviewNote }
            : item,
        ),
      };
    });
    setNorthstarActionMessage(
      (status === "approved" ? "Request approved." :
        status === "rejected" ? "Request changes requested." :
        status === "resolved" ? "Work item resolved." :
        "Comment recorded."),
    );
  };

  const commentOnNorthstarRequest = async () => {
    await updateNorthstarRequestStatus(
      "commented",
      "Comment recorded from Stewardship Workbench.",
    );
  };

  const resolveNorthstarRequest = async () => {
    await updateNorthstarRequestStatus(
      "resolved",
      "Resolved from Stewardship Workbench.",
    );
  };

  const openWorkItemCount = finiteMetricValue(null, northstarQueueUniverse.length);
  const northstarHasPrototypeSlaSummary = false;
  const slaBreachCount = finiteMetricValue(
    null,
    northstarQueueCounts.overdue,
  );
  const northstarSlaEvidenceAvailable =
    northstarHasPrototypeSlaSummary || northstarQueueUniverse.some((request) => hasSlaEvidence(request));
  const northstarSlaSummary = northstarSlaEvidenceAvailable
    ? `${slaBreachCount.toLocaleString()} SLA breaches`
    : "SLA evidence unavailable";
  const northstarQueueSortLabel = northstarSlaEvidenceAvailable
      ? "backed SLA risk"
      : "available work-item evidence";
  const queueTabs = [
    { key: "all", label: "All", count: northstarQueueCounts.all },
    { key: "p1", label: "P1 critical", count: northstarQueueCounts.p1 },
    { key: "overdue", label: "Overdue", count: northstarQueueCounts.overdue },
    { key: "mine", label: "Assigned to me", count: northstarQueueCounts.mine },
  ];
  const selectedSuggestedActions = northstarSelectedDetail
    ? suggestedActionsFor(northstarSelectedDetail)
    : [];
  const selectedImplementation = northstarSelectedDetail?.implementation ||
    "Items materialize from policy violations and steward-filed requests into the governance control plane. Resolution writes request state and audit evidence when the backend supports the mutation.";
  const northstarCanMutate = canMutateGovernanceRequests(currentUser || {}, bootstrap || {});
  const northstarMutationRole = governanceMutationRole(currentUser || {}, bootstrap || {}) || "Reader";
  const northstarMutationUnavailable = Boolean(northstarSelectedDetail) && (
    northstarPrototypeEvidence || !northstarCanMutate
  );
  const northstarMutationUnavailableReason = northstarPrototypeEvidence
    ? "These work items are unavailable until live governance request evidence is loaded."
    : !northstarCanMutate
      ? `Comment and resolve require Steward or Admin role. Current actor role: ${northstarMutationRole}.`
      : "";
  if (mode === "stewardship") {
    return (
      <section className="gh-governance-ns ga-page" data-testid="governance-northstar-workbench">
        <header className="gh-governance-ns-hero">
          <div>
            <span className="gh-governance-ns-eyebrow">Stewardship Workbench</span>
            <h1>
              {`${openWorkItemCount.toLocaleString()} open work items · ${northstarSlaSummary}`}
            </h1>
            <p>
              {northstarPrototypeEvidence
                ? "Non-authoritative stewardship payloads were rejected. Live governance request, assignment, and SLA evidence is unavailable for this route."
                : "Auto-generated and human-filed governance work. Items are routed to teams by domain ownership; SLA timers use backed due-date and queue signals when available."}
            </p>
          </div>
          <div className="gh-governance-ns-hero-actions">
            <button
              aria-expanded={northstarMenu === "settings"}
              className={`gh-governance-ns-settings ${northstarMenu === "settings" ? "is-active" : ""}`}
              onClick={() => setNorthstarMenu((current) => (current === "settings" ? "" : "settings"))}
              type="button"
            >
              <span className="gh-governance-ns-settings-icon"><GovernanceGlyph icon="filter" /></span>
              Filter
            </button>
            <button
              className="gh-governance-ns-settings"
              onClick={showBulkAssignPanel}
              type="button"
            >
              <span className="gh-governance-ns-settings-icon"><GovernanceGlyph icon="users" /></span>
              Bulk assign
            </button>
            <button
              className="gh-governance-ns-settings is-primary"
              onClick={showNewWorkItemPanel}
              type="button"
            >
              <span className="gh-governance-ns-settings-icon"><GovernanceGlyph icon="plus" /></span>
              New work item
            </button>
          </div>
        </header>

        {northstarError ? (
          <InlineStatusBanner
            className="gh-governance-status-banner"
            message={northstarError}
            title="Governance workbench degraded"
          />
        ) : null}

        {northstarMenu === "settings" ? (
          <div className="gh-governance-ns-settings-panel" role="region" aria-label="Work queue filter controls">
            <div>
              <strong>Filter work queue</strong>
              <span>Counts come from visible governance workbench rows. SLA and due-date fields remain unavailable when the store has not recorded them.</span>
            </div>
            <div className="gh-governance-ns-filter-menu">
              {queueTabs.map((tab) => (
                <button
                  aria-pressed={northstarQueueFilter === tab.key}
                  className={northstarQueueFilter === tab.key ? "is-active" : ""}
                  key={tab.key}
                  onClick={() => {
                    setNorthstarQueueFilter(tab.key);
                    setNorthstarActionPanel(null);
                  }}
                  type="button"
                >
                  {tab.label} <span>({tab.count})</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {statusMessage ? (
          <div
            aria-live="polite"
            className="gh-discovery-preview-action-toast"
            role="status"
            style={{ marginBottom: 12 }}
          >
            <span aria-hidden="true" className="gh-discovery-preview-action-toast-icon">✓</span>
            <span>{statusMessage}</span>
            <button
              aria-label="Dismiss notice"
              className="gh-discovery-preview-action-toast-close"
              onClick={() => setStatusMessage("")}
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}
        {northstarActionPanel ? (
          <section className="gh-governance-ns-action-panel" aria-label={`${northstarActionPanel.eyebrow} status`}>
            <div>
              <span className="gh-governance-ns-eyebrow">{northstarActionPanel.eyebrow}</span>
              <h2>{northstarActionPanel.title}</h2>
              <p>{northstarActionPanel.body}</p>
            </div>
            <dl>
              {northstarActionPanel.facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="gh-governance-ns-action-panel-controls">
              {northstarActionPanel.stagedAction ? (
                <button
                  onClick={() => {
                    // Stage the action locally + surface a status message
                    // so the click is visibly responsive. Backed write
                    // lands with the workflow tranche.
                    setStatusMessage(
                      northstarActionPanel.stagedConfirmation
                        || `${northstarActionPanel.eyebrow} staged.`,
                    );
                    setNorthstarActionPanel(null);
                  }}
                  title={
                    northstarActionPanel.stagedConfirmation
                      || "Stage this work item; backed write lands with the create-flow tranche."
                  }
                  type="button"
                >
                  {northstarActionPanel.stagedAction}
                </button>
              ) : (
                <button
                  disabled
                  title="This workflow is visible but not backed by a write path yet."
                  type="button"
                >
                  {northstarActionPanel.disabledAction}
                </button>
              )}
              <button onClick={() => setNorthstarActionPanel(null)} type="button">
                Dismiss
              </button>
            </div>
          </section>
        ) : null}

        <div className="gh-governance-ns-filter-pills" aria-label="Work queue filters">
          {queueTabs.map((tab) => (
            <button
              aria-pressed={northstarQueueFilter === tab.key}
              className={northstarQueueFilter === tab.key ? "is-active" : ""}
              key={tab.key}
              onClick={() => setNorthstarQueueFilter(tab.key)}
              type="button"
            >
              {tab.label} <span>{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="gh-governance-ns-layout">
          <section className="gh-governance-ns-requests" aria-label="Work queue">
            <div className="gh-governance-ns-panel-head">
              <div>
                <h2>Work queue</h2>
              <span>{northstarRequests.length} item{northstarRequests.length === 1 ? "" : "s"} · sorted by {northstarQueueSortLabel}</span>
              </div>
            </div>

            <div className="gh-governance-ns-table" role="table" aria-label="Work queue table">
              <div className="gh-governance-ns-table-row is-head" role="row">
                <span>ID</span>
                <span>Item</span>
                <span>Asset</span>
                <span>Assigned</span>
                <span>SLA</span>
                <span>Priority</span>
              </div>
              {northstarLoading && !northstarVisibleRequests.length ? (
                <div className="gh-governance-ns-empty">Loading stewardship queue...</div>
              ) : northstarVisibleRequests.length ? (
                northstarVisibleRequests.map((item) => (
                  <button
                    className={`gh-governance-ns-table-row ${northstarSelectedDetail?.id === item.id ? "is-selected" : ""}`}
                    key={item.id}
                    onClick={() => {
                      setNorthstarSelectedRequestId(item.id);
                    }}
                    role="row"
                    type="button"
                  >
                    <span className="is-mono" title={workItemDisplayId(item)}>
                      {workItemDisplayId(item)}
                    </span>
                    <span>
                      <strong>{workItemKind(item)}</strong>
                      <small>
                        {item.age ? `Age ${item.age}` : item.createdAt ? `Created ${formatShortDate(item.createdAt)}` : "Age unavailable"}
                      </small>
                    </span>
                    <span className="is-mono">{item.assetFqn || item.assetName}</span>
                    <span>{workItemAssigned(item)}</span>
                    <span className={`gh-governance-ns-sla tone-${slaTone(item)}`}><GovernanceGlyph icon="clock" />{slaLabel(item)}</span>
                    <span className={`gh-governance-ns-priority tone-${priorityTone(item.priority)}`}>{priorityShortLabel(item.priority)}</span>
                  </button>
                ))
              ) : (
                <div className="gh-governance-ns-table-row is-unavailable" role="row">
                  <span className="is-mono">--</span>
                  <span>
                    <strong>{focusedAssetFqn ? "No actor-visible work items" : "No work items in this filter"}</strong>
                    <small>Queue shape retained; no synthetic `SI-*` request row is created.</small>
                  </span>
                  <span className="is-mono">{focusedAssetFqn || "Workspace scope"}</span>
                  <span>Assignee unavailable</span>
                  <span className="gh-governance-ns-sla tone-muted"><GovernanceGlyph icon="clock" />Evidence unavailable</span>
                  <span className="gh-governance-ns-priority">--</span>
                </div>
              )}
            </div>

            {northstarPageCount > 1 ? (
              <div className="gh-governance-ns-pagination">
                <span>
                  {northstarRequests.length
                    ? `${(northstarPage - 1) * northstarPageSize + 1}-${Math.min(northstarPage * northstarPageSize, northstarRequests.length)} of ${northstarRequests.length}`
                    : "0 of 0"}
                </span>
                <div>
                  {Array.from({ length: Math.min(3, northstarPageCount) }, (_, index) => index + 1).map((page) => (
                    <button
                      className={page === northstarPage ? "is-active" : ""}
                      key={page}
                      onClick={() => setNorthstarPage(page)}
                      type="button"
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    aria-label="Next page"
                    disabled={northstarPage >= northstarPageCount}
                    onClick={() => setNorthstarPage((page) => Math.min(northstarPageCount, page + 1))}
                    title={
                      northstarPage >= northstarPageCount
                        ? "All visible work items are shown for the current filter."
                        : "Show the next page of work items."
                    }
                    type="button"
                  >
                    &gt;
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <aside className="gh-governance-ns-detail" aria-label="Selected governance request">
            {northstarSelectedDetail ? (
              <>
                <div className="gh-governance-ns-detail-head">
                  <div>
                    <h2 className="gh-governance-ns-detail-id">{workItemDisplayId(northstarSelectedDetail)}</h2>
                    <p>{workItemKind(northstarSelectedDetail)}</p>
                    <div className="gh-governance-ns-request-id">
                      <span className={`gh-governance-ns-priority tone-${priorityTone(northstarSelectedDetail.priority)}`}>
                        {priorityShortLabel(northstarSelectedDetail.priority)} · {priorityDisplayLabel(northstarSelectedDetail.priority).replace(" Priority", "")}
                      </span>
                      <span className={`gh-governance-ns-sla tone-${slaTone(northstarSelectedDetail)}`}>
                        <GovernanceGlyph icon="clock" />{slaLabel(northstarSelectedDetail)}
                      </span>
                      <span className="gh-governance-ns-team-chip">
                        <GovernanceGlyph icon="users" />{workItemAssigned(northstarSelectedDetail)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="gh-governance-ns-affected">
                  <div className="gh-governance-ns-eyebrow">Affected asset</div>
                  <button onClick={() => openAssetSafely(northstarSelectedDetail.assetFqn)} type="button">
                    <span>{northstarSelectedDetail.assetFqn || northstarSelectedDetail.assetName}</span>
                  </button>
                </div>

                <section className="gh-governance-ns-subpanel is-wide">
                  <h3>Why this is open</h3>
                  <p>
                    {textValue(northstarSelectedDetail.evidence || northstarSelectedDetail.businessContext || northstarSelectedDetail.detail, "No opening evidence was recorded for this work item.")}
                  </p>
                  <dl className="gh-governance-ns-evidence-grid" aria-label="Opening evidence facts">
                    {openingEvidenceFacts(northstarSelectedDetail).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="gh-governance-ns-suggestions">
                  <h3>Suggested actions</h3>
                  {selectedSuggestedActions.length ? selectedSuggestedActions.map((action, index) => (
                    <button
                      key={`${action.label || "action"}-${index}`}
                      onClick={() => showSuggestedActionPanel(action)}
                      type="button"
                    >
                      <GovernanceGlyph icon={action.icon || "check"} />
                      <span>
                        <strong>{action.label || "Review suggested action"}</strong>
                        {action.detail ? <small>{action.detail}</small> : null}
                      </span>
                      <GovernanceGlyph icon="chevron" />
                    </button>
                  )) : (
                    <p className="gh-governance-ns-empty">No backed suggested actions were returned for this work item.</p>
                  )}
                </section>

                <div className="gh-governance-ns-actions">
                  {northstarMutationUnavailableReason ? (
                    <span className="gh-governance-ns-mutation-note">
                      {northstarMutationUnavailableReason}
                    </span>
                  ) : null}
                  <button
                    className="tone-comment"
                    disabled={!northstarSelectedDetail.requestId || mutationState.loading || northstarMutationUnavailable}
                    onClick={commentOnNorthstarRequest}
                    title={northstarMutationUnavailableReason || "Comment on this governance request."}
                    type="button"
                  >
                    <GovernanceGlyph icon="message" /> Comment
                  </button>
                  <button
                    className="tone-approve"
                    disabled={!northstarSelectedDetail.requestId || mutationState.loading || northstarMutationUnavailable}
                    onClick={resolveNorthstarRequest}
                    title={northstarMutationUnavailableReason || "Resolve this governance request."}
                    type="button"
                  >
                    <GovernanceGlyph icon="check" /> Resolve
                  </button>
                </div>
                {mutationState.error ? (
                  <InlineStatusBanner message={mutationState.error} title="Request update failed" />
                ) : null}
                {mutationState.success || northstarActionMessage ? (
                  <div className="gh-governance-ns-action-message" role="status">
                    {northstarActionMessage || mutationState.success}
                  </div>
                ) : null}
                <div className="gh-governance-ns-implementation">
                  <div className="gh-governance-ns-eyebrow">Implementation</div>
                  <p>{selectedImplementation}</p>
                </div>
              </>
            ) : (
              <div className="gh-governance-ns-empty is-detail">
                Select a work item to review evidence, affected asset, suggested actions, and resolution controls.
              </div>
            )}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="gh-governance-shell">
      <SurfaceHeader
        actions={
          focusedAssetFqn ? (
            <div className="gh-action-row">
              <button
                aria-pressed={auditDrawerOpen}
                className="gh-secondary-button"
                onClick={() => setAuditDrawerOpen((v) => !v)}
                type="button"
              >
                {auditDrawerOpen ? "Hide audit history" : "View audit history"}
              </button>
              <button
                className="gh-secondary-button"
                onClick={() => focusAsset("", { preserveWork: false, preserveGlossary: false, syncRoute: true })}
                type="button"
              >
                Clear focus
              </button>
            </div>
          ) : null
        }
        className="gh-governance-shell-header"
        eyebrow="Governance"
        identity={governanceHeaderIdentity}
        meta={governanceHeaderMeta}
        title={mode === "stewardship" ? "Stewardship workbench" : "Glossary workbench"}
      >
        <div className="gh-governance-shell-header-tools">
          <SurfaceTabs
            activeKey={mode}
            ariaLabel="Governance mode"
            items={governanceModeItems}
            onChange={setMode}
            variant="segment"
          />
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
                  <LoadingState message="Searching assets…" />
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
        </div>
      </SurfaceHeader>

      {!governanceAuthoritative && governanceWarnings.length ? (
        <InlineStatusBanner
          className="gh-governance-status-banner"
          message={governanceWarnings[0]}
          title="Governance plane degraded"
        />
      ) : null}

      {workbenchMetrics.length ? (
        <div className="ga-kpi-grid four gh-governance-northstar-metrics" aria-label="Governance workbench metrics">
          {workbenchMetrics.slice(0, 4).map((metric) => (
            <MetricCard
              key={metric.key || metric.label}
              label={metric.label}
              value={formatMetricValue(metric)}
              delta={metric.state === "unavailable" ? "Signal not configured" : ""}
              deltaTone="warn"
            />
          ))}
        </div>
      ) : null}

      {mode === "stewardship" ? (
        focusedAssetFqn ? (
          <SurfaceWorkbench>
            <SurfaceWorkbenchMain className="gh-governance-main-pane" dense>
                <SurfacePanelSection
                  actions={
                    <div className="gh-chip-row">
                      <span className="gh-chip gh-chip-soft">{lanePanelMeta}</span>
                      {pendingClassificationCount > 0 ? (
                        <button
                          className="gh-chip gh-chip-tone-info"
                          data-testid="governance-classification-open-drawer"
                          onClick={() => openClassificationDrawer()}
                          type="button"
                        >
                          {pendingClassificationCount} classification review
                          {pendingClassificationCount === 1 ? "" : "s"}
                        </button>
                      ) : null}
                    </div>
                  }
                  title={lanePanelTitle}
                >
                  <div className="gh-governance-lane-rail">
                    {laneSummary.map((lane) => (
                      <button
                        aria-pressed={selectedLaneKey === lane.key}
                        className={`gh-governance-lane-chip tone-${governanceLaneTone(lane.key, lane.count)} ${selectedLaneKey === lane.key ? "is-active" : ""}`.trim()}
                        key={lane.key}
                        onClick={() => setSelectedLaneKey(lane.key)}
                        type="button"
                      >
                        <strong className="gh-governance-lane-count">{lane.count}</strong>
                        <span className="gh-governance-lane-label">{lane.label}</span>
                      </button>
                    ))}
                  </div>
                </SurfacePanelSection>
                <SurfacePanelSection
                  actions={(
                    <span className="gh-chip gh-chip-soft">
                      {focusedAssetUnavailable ? "Access limited" : `${visibleWorkItems.length} visible`}
                    </span>
                  )}
                  title="Active work"
                >
                  {focusedAssetUnavailable ? (
                    <EmptyStateBlock
                      message="The focused asset is unavailable with the current permissions."
                      title="Focused asset unavailable"
                    />
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
                    <EmptyStateBlock
                      message={
                        assetScopedEmpty
                          ? "No governance backlog is currently attached to the focused asset."
                          : "No items are available in this lane yet."
                      }
                      title="No active work in this lane"
                    />
                  )}
                </SurfacePanelSection>
                {selectedItem ? (
                  <SurfacePanelSection
                    title="Selected work"
                    titleMeta={<span className="gh-chip gh-chip-soft">{selectedItem.status}</span>}
                  >
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
                          title={!selectedItem.requestId ? "This item is not backed by a governance request, so there is nothing to approve." : undefined}
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
                          title={!selectedItem.requestId ? "This item is not backed by a governance request, so there is nothing to reject." : undefined}
                          type="button"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </SurfacePanelSection>
                ) : null}
            </SurfaceWorkbenchMain>

            <SurfaceRail
                actions={
                  focusedAsset ? (
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
                  ) : null
                }
                className="gh-surface-workbench-side gh-governance-side-pane gh-governance-side-pane-dense"
                eyebrow="Governance"
                identity={
                  focusedAsset
                    ? `${focusedAsset.name} · ${focusedAsset.catalog} / ${focusedAsset.schema}`
                    : focusedAssetUnavailable
                      ? "Focused asset unavailable with current permissions."
                      : "Review metadata posture and create follow-up governance work."
                }
                title="Focused stewardship"
                titleMeta={
                  mutationState.loading ? (
                    <span className="gh-chip gh-chip-soft">Saving…</span>
                  ) : mutationState.success ? (
                    <span className="gh-chip gh-chip-soft">Updated</span>
                  ) : null
                }
              >
                {focusedAssetFqn ? (
                  <SurfaceRailSection title="Stewardship posture">
                    {mutationState.error ? (
                      <InlineStatusBanner message={mutationState.error} title="Mutation failed" />
                    ) : null}
                    {mutationState.success ? (
                      <div className="gh-support-copy gh-success-copy">{mutationState.success}</div>
                    ) : null}
                    <div className="gh-support-copy">
                      These cards reflect metadata posture only; persisted governance work appears in the work lanes above.
                    </div>
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
                            title={
                              mutationState.loading
                                ? "Saving governance mutation — please wait."
                                : !ownerEmail.trim()
                                  ? "Enter an owner email before saving."
                                  : undefined
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
                              ).then((next) => {
                                const nextRequestId = String(next?.requestId || next?.id || "").trim();
                                setSelectedLaneKey("open-work");
                                if (nextRequestId) {
                                  setSelectedWorkId(nextRequestId);
                                }
                                setRequestTitle("");
                                setRequestNote("");
                              })
                            }
                          title={
                            mutationState.loading
                              ? "Saving governance mutation — please wait."
                              : !requestTitle.trim()
                                ? "Enter a request title before submitting."
                                : undefined
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
                          <select
                            className="gh-input"
                            onChange={(event) => setGlossaryStatus(event.target.value)}
                            value={glossaryStatus}
                          >
                            {GLOSSARY_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <textarea
                            className="gh-input gh-textarea"
                            onChange={(event) => setGlossaryReviewerText(event.target.value)}
                            placeholder={"Initial reviewers\nauthor@company.com\napprover@company.com:approver"}
                            rows={3}
                            value={glossaryReviewerText}
                          />
                          <textarea
                            className="gh-input gh-textarea"
                            onChange={(event) => setGlossaryChangeNote(event.target.value)}
                            placeholder="Optional creation note"
                            rows={2}
                            value={glossaryChangeNote}
                          />
                          <button
                            className="gh-secondary-button gh-secondary-button-compact"
                            disabled={!glossaryName.trim() || mutationState.loading}
                            title={
                              mutationState.loading
                                ? "Saving governance mutation — please wait."
                                : !glossaryName.trim()
                                  ? "Enter a term name before creating."
                                  : undefined
                            }
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
                                    reviewers: parseGlossaryReviewers(glossaryReviewerText),
                                    changeNote: glossaryChangeNote.trim(),
                                  }),
                                "Glossary term saved.",
                              ).then((next) => {
                                setGlossaryName("");
                                setGlossaryDefinition("");
                                setGlossaryDomain("");
                                setGlossaryOwnerEmail("");
                                setGlossaryStatus("draft");
                                setGlossaryReviewerText("");
                                setGlossaryChangeNote("");
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
                  </SurfaceRailSection>
                ) : null}

                <SurfaceRailSection
                  actions={<span className="gh-chip gh-chip-soft">{linkedGlossary.length} terms</span>}
                  title="Linked glossary"
                >
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
                    <EmptyStateBlock
                      message="No glossary terms are linked to this asset yet."
                      title="No linked glossary terms"
                    />
                  )}
                </SurfaceRailSection>
            </SurfaceRail>
          </SurfaceWorkbench>
        ) : (
          <SurfaceWorkbench>
            <SurfaceWorkbenchMain className="gh-governance-main-pane" dense>
                <SurfacePanelSection
                  actions={
                    <div className="gh-chip-row">
                      <span className="gh-chip gh-chip-soft">{lanePanelMeta}</span>
                      {pendingClassificationCount > 0 ? (
                        <button
                          className="gh-chip gh-chip-tone-info"
                          data-testid="governance-classification-open-drawer"
                          onClick={() => openClassificationDrawer()}
                          type="button"
                        >
                          {pendingClassificationCount} classification review
                          {pendingClassificationCount === 1 ? "" : "s"}
                        </button>
                      ) : null}
                    </div>
                  }
                  title={lanePanelTitle}
                >
                  <div className="gh-governance-lane-rail">
                    {laneSummary.map((lane) => (
                      <button
                        aria-pressed={selectedLaneKey === lane.key}
                        className={`gh-governance-lane-chip tone-${governanceLaneTone(lane.key, lane.count)} ${selectedLaneKey === lane.key ? "is-active" : ""}`.trim()}
                        key={lane.key}
                        onClick={() => setSelectedLaneKey(lane.key)}
                        type="button"
                      >
                        <strong className="gh-governance-lane-count">{lane.count}</strong>
                        <span className="gh-governance-lane-label">{lane.label}</span>
                      </button>
                    ))}
                  </div>
                </SurfacePanelSection>
                <SurfacePanelSection
                  actions={<span className="gh-chip gh-chip-soft">{views.requests.length} requests</span>}
                  title="Open work"
                >
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
                      <EmptyStateBlock
                        message="No items are available in this lane yet."
                        title="No work in this lane"
                      />
                    )
                  ) : (
                    <EmptyStateBlock
                      message="No governance requests are surfaced yet."
                      title="No open work"
                    />
                  )}
                </SurfacePanelSection>
                {selectedItem ? (
                  <SurfacePanelSection
                    title="Selected work"
                    titleMeta={<span className="gh-chip gh-chip-soft">{selectedItem.status}</span>}
                  >
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
                          title={!selectedItem.requestId ? "This item is not backed by a governance request, so there is nothing to approve." : undefined}
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
                          title={!selectedItem.requestId ? "This item is not backed by a governance request, so there is nothing to reject." : undefined}
                          type="button"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </SurfacePanelSection>
                ) : null}
            </SurfaceWorkbenchMain>

            <SurfaceRail
                className="gh-surface-workbench-side gh-governance-side-pane gh-governance-side-pane-dense"
                eyebrow="Governance"
                identity="Track glossary coverage while triaging governance backlog."
                title="Glossary snapshot"
              >
                <SurfaceRailSection
                  actions={<span className="gh-chip gh-chip-soft">{views.glossary.length} terms</span>}
                  title="Glossary terms"
                >
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
                    <EmptyStateBlock
                      message="No glossary terms are surfaced yet."
                      title="No glossary terms"
                    />
                  )}
                </SurfaceRailSection>
            </SurfaceRail>
          </SurfaceWorkbench>
        )
      ) : (
        <SurfaceWorkbench variant="glossary">
          <SurfaceWorkbenchMain className="gh-governance-main-pane" dense>
            <SurfacePanelSection title="Glossary filters">
              <div className="gh-governance-glossary-toolbar">
                <input
                  className="gh-input"
                  onChange={(event) => setGlossaryQuery(event.target.value)}
                  placeholder="Search terms, definitions, or domains"
                  value={glossaryQuery}
                />
                <SurfaceTabs
                  activeKey={glossaryCollection}
                  ariaLabel="Glossary collection"
                  className="gh-governance-glossary-tabs"
                  items={glossaryCollectionTabs}
                  onChange={setGlossaryCollection}
                />
              </div>
            </SurfacePanelSection>
            <SurfacePanelSection
              actions={<span className="gh-chip gh-chip-soft">{glossaryItems.length} visible</span>}
              title="Glossary index"
            >
              <div className="gh-support-copy">Terms are grouped by domain and filtered by search.</div>
              {glossaryItems.length ? (
                <div className="gh-request-list gh-request-list-dense gh-governance-glossary-list">
                  {glossaryItems.map((item) => {
                    const depth = Math.max(0, Math.min(6, Number(item._depth) || 0));
                    return (
                      <button
                        className={`gh-request-card gh-request-row gh-governance-glossary-item depth-${depth} ${selectedGlossary?.id === item.id ? "is-active" : ""}`.trim()}
                        key={item.id}
                        onClick={() => setSelectedGlossaryId(item.id)}
                        style={depth > 0 ? { marginLeft: `${depth * 14}px` } : undefined}
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
                            {Number(item.childCount) > 0 ? (
                              <span className="gh-chip gh-chip-soft" title={`${item.childCount} child terms`}>
                                {item.childCount} children
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="gh-support-copy">{item.detail}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyStateBlock
                  message="No glossary terms match the current search."
                  title="No glossary results"
                />
              )}
            </SurfacePanelSection>
          </SurfaceWorkbenchMain>

          <SurfaceRail
            actions={
              selectedGlossary?.assets?.length ? (
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
              ) : null
            }
            className="gh-surface-workbench-side gh-governance-side-pane gh-governance-side-pane-dense"
            eyebrow="Glossary"
            identity={
              selectedGlossary
                ? `${selectedGlossary.subtitle} · ${selectedGlossary.ownerEmail}`
                : "Select a term to inspect reviewer, history, and linked asset context."
            }
            title={selectedGlossary ? "Term detail" : "Glossary detail"}
            titleMeta={
              selectedGlossary ? <span className="gh-chip gh-chip-soft">{selectedGlossary.assetCount} assets</span> : null
            }
          >
            {selectedGlossary ? (
              <>
                <SurfaceRailSection title="Selected term">
                  <div className="gh-governance-focus-header">
                    <div>
                      <h2>{selectedGlossary.title}</h2>
                      <div className="gh-support-copy">{selectedGlossary.detail}</div>
                      {glossaryTermDetail.refreshing ? (
                        <div className="gh-support-copy">Refreshing persisted term detail…</div>
                      ) : null}
                      {glossaryTermDetail.refreshError ? (
                        <div className="gh-support-copy">
                          Persisted term detail is temporarily limited. Showing the governance snapshot.
                        </div>
                      ) : null}
                    </div>
                    <div className="gh-chip-row">
                      <span className="gh-chip">{selectedGlossary.reviewState || selectedGlossary.status}</span>
                      {selectedGlossary.currentVersion ? (
                        <span className="gh-chip gh-chip-soft">{selectedGlossary.currentVersion}</span>
                      ) : null}
                      <span className="gh-chip gh-chip-soft">{selectedGlossary.subtitle}</span>
                      <span className="gh-chip gh-chip-soft">{selectedGlossary.ownerEmail}</span>
                    </div>
                  </div>
                  <AttributeList items={selectedGlossaryAttributes} />
                </SurfaceRailSection>
                {selectedGlossaryReviewers.length ? (
                  <SurfaceRailSection title="Reviewer roster">
                    <div className="gh-governance-reviewer-grid">
                      {selectedGlossaryReviewers.map((reviewer) => (
                        <div className="gh-governance-reviewer-card" key={reviewer.id}>
                          <div className="gh-governance-reviewer-card-head">
                            <div className="gh-governance-reviewer-email">{reviewer.email || "Unassigned"}</div>
                            <span className="gh-chip gh-chip-soft">{reviewer.role || "Reviewer"}</span>
                          </div>
                          <div className="gh-governance-reviewer-meta">
                            <span className={`gh-status-chip tone-${String(reviewer.state || "").toLowerCase().includes("active") ? "good" : "warn"}`}>
                              {reviewer.state || "active"}
                            </span>
                            {reviewer.reviewedAt ? <span className="gh-support-copy">Reviewed {reviewer.reviewedAt}</span> : null}
                          </div>
                          {reviewer.note ? <div className="gh-support-copy">{reviewer.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  </SurfaceRailSection>
                ) : null}
                <SurfaceRailSection title="Edit term">
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
                      <select
                        className="gh-input"
                        onChange={(event) =>
                          setGlossaryDraft((current) => ({ ...current, status: event.target.value }))
                        }
                        value={glossaryDraft.status}
                      >
                        {GLOSSARY_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="gh-metadata-edit-field">
                      <span>Reviewer roster</span>
                      <textarea
                        className="gh-input gh-textarea"
                        onChange={(event) =>
                          setGlossaryDraft((current) => ({ ...current, reviewersText: event.target.value }))
                        }
                        placeholder={"reviewer@company.com\napprover@company.com:approver"}
                        rows={4}
                        value={glossaryDraft.reviewersText}
                      />
                    </label>
                    <label className="gh-metadata-edit-field">
                      <span>Change note</span>
                      <textarea
                        className="gh-input gh-textarea"
                        onChange={(event) =>
                          setGlossaryDraft((current) => ({ ...current, changeNote: event.target.value }))
                        }
                        placeholder="Summarize what changed in this glossary revision"
                        rows={3}
                        value={glossaryDraft.changeNote}
                      />
                    </label>
                    {mutationState.error ? (
                      <InlineStatusBanner message={mutationState.error} title="Glossary update failed" />
                    ) : null}
                    {mutationState.success && mutationState.kind === "glossary-update" ? (
                      <div className="gh-support-copy gh-success-copy">{mutationState.success}</div>
                    ) : null}
                    <div className="gh-record-form-actions">
                      <button
                        className="gh-primary-button"
                        disabled={!selectedGlossary.termId || mutationState.loading || !glossaryDraft.name.trim()}
                        onClick={saveSelectedGlossaryTerm}
                        title={
                          mutationState.loading
                            ? "Saving governance mutation — please wait."
                            : !selectedGlossary.termId
                              ? "No glossary term is selected to save."
                              : !glossaryDraft.name.trim()
                                ? "Enter a term name before saving."
                                : undefined
                        }
                        type="button"
                      >
                        {mutationState.kind === "glossary-update" && mutationState.loading ? "Saving..." : "Save term"}
                      </button>
                    </div>
                  </div>
                </SurfaceRailSection>
                <SurfaceRailSection title="Term history">
                  {selectedGlossaryHistory.length ? (
                    <div className="gh-governance-timeline">
                      {selectedGlossaryHistory.map((entry) => (
                        <div className="gh-governance-timeline-row" key={entry.id || `${entry.version}-${entry.changedAt}`}>
                          <div className="gh-governance-timeline-mark">
                            <span className="gh-chip gh-chip-soft">{entry.version || "v1"}</span>
                          </div>
                          <div className="gh-governance-timeline-copy">
                            <div className="gh-governance-timeline-head">
                              <div className="gh-governance-timeline-title">{entry.title || "Term update"}</div>
                              {entry.status ? <span className="gh-chip gh-chip-soft">{entry.status}</span> : null}
                            </div>
                            <div className="gh-support-copy">
                              {(entry.changedAt || "Unknown time") +
                                (entry.changedBy ? ` · ${entry.changedBy}` : "")}
                            </div>
                            {entry.note ? <div className="gh-support-copy">{entry.note}</div> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyStateBlock
                      message="No version history is linked to this term yet."
                      title="No term history"
                    />
                  )}
                </SurfaceRailSection>
                <SurfaceRailSection title="Linked assets">
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
                            {asset.governanceStatus ? (
                              <span className="gh-chip gh-chip-soft">{asset.governanceStatus}</span>
                            ) : null}
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
                    <EmptyStateBlock
                      message="No linked assets are surfaced for this term yet."
                      title="No linked assets"
                    />
                  )}
                </SurfaceRailSection>
              </>
            ) : (
              <EmptyStateBlock
                message="Select a glossary term to inspect reviewer, history, and linked asset context."
                title="Select a glossary term"
              />
            )}
          </SurfaceRail>
        </SurfaceWorkbench>
      )}
      <AuditTimelineDrawer
        assetFqn={focusedAssetFqn}
        entries={auditTimeline.entries}
        loading={auditTimeline.loading}
        refreshing={auditTimeline.refreshing}
        error={auditTimeline.error}
        total={auditTimeline.total}
        isOpen={auditDrawerOpen && Boolean(focusedAssetFqn)}
        onClose={() => setAuditDrawerOpen(false)}
        onRefresh={() => auditTimeline.refresh()}
      />
      <ClassificationEvidenceDrawer
        isOpen={classificationDrawerOpen}
        onClose={closeClassificationDrawer}
        recommendation={activeClassification.data}
        onReview={handleClassificationReview}
        submitting={classificationReview.submitting}
        reviewError={classificationReview.error || activeClassification.error}
      />
    </section>
  );
}
