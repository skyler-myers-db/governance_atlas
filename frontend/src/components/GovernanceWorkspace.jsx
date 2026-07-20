import { useEffect, useMemo, useState } from "react";
import {
  canOpenAssetRecord,
  invalidateAssetDetail,
  prefetchAssetDetail,
  primeAssetDetail,
  useAssetDetail,
} from "../hooks/useAssetDetail";
import { clearAssetSearchCache } from "../hooks/useAssetSearch";
import { useSeededAssetContext } from "../hooks/useSeededAssetContext";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
import {
  createGovernanceRequest,
  fetchGovernanceRequestDetail,
  fetchGovernanceWorkbench,
  normalizeGovernancePayload,
  updateGovernanceRequest,
} from "../lib/api";
import { InlineStatusBanner } from "./ShellStatePrimitives";
import "../styles/operations-pages.css";

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
      reviewerRoster: (item.reviewerRoster || item.reviewerAssignments || item.reviewers || []).map(
        (reviewer, reviewerIndex) => normalizeGlossaryReviewer(reviewer, reviewerIndex),
      ),
      termHistory: (item.termHistory || item.versionHistory || item.history || item.recentRequests || []).map(
        (entry, entryIndex) => normalizeGlossaryHistory(entry, entryIndex),
      ),
    })),
  };
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

// New work items can be filed by writers too — the backend create endpoint
// only requires can-mutate (writer+), while approve/reject stays steward+.
function canFileGovernanceWorkItems(currentUser = {}, bootstrap = {}) {
  return /\b(?:admin|steward|writer)\b/i.test(governanceMutationRole(currentUser, bootstrap));
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

// Tooltip explaining a derived SLA. Only present when the backend flags the
// value as coming from the default 7-day policy — never for recorded SLAs.
function slaPolicyNote(request = {}) {
  return textValue(request.slaPolicy) === "default_7d"
    ? "Default 7-day SLA derived from created_at; no explicit due date is recorded for this request."
    : "";
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
  // No requester fallback: showing the requester as the assignee made
  // "Assigned to me" counts false and painted unassigned work as owned.
  // Only real assignment fields count; everything else is "Unassigned".
  return textValue(
    request.assigned || request.assignee || request.assignedTo || request.team || request.ownerTeam,
    "Unassigned",
  );
}

function isValidationWorkItem(request = {}) {
  if (!request || typeof request !== "object") return false;
  const requestId = textValue(request.requestId || request.id).toLowerCase();
  const source = textValue(request.source || request.provenance?.source || request.meta?.source).toLowerCase();
  return request.validationSample === true || hasNonAuthoritativeWorkItemMarker(requestId, source, request);
}

function workItemFullId(request = {}) {
  return textValue(request.requestId || request.id);
}

function workItemDisplayId(request = {}) {
  const requestId = textValue(request.requestId || request.id, "—");
  const evidenceMatch = requestId.match(/^(?:ga-home-evidence|GOV-HOME-EVIDENCE)-request-(\d+)$/i);
  if (evidenceMatch) return `GOV-${evidenceMatch[1]}`;
  if (requestId.length > 14) {
    // Long store ids (UUID-shaped) compress to GOV-XXXXXXXX from the first
    // eight hex characters. The full id stays reachable via the row tooltip
    // and the detail panel's Copy ID affordance.
    const hex = requestId.replace(/[^0-9a-f]/gi, "");
    if (hex.length >= 8) return `GOV-${hex.slice(0, 8).toUpperCase()}`;
    return `${requestId.slice(0, 11)}…`;
  }
  return requestId;
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
    slaPolicy: textValue(request.slaPolicy),
    age: textValue(request.age),
    evidence: textValue(request.evidence || request.businessContext || request.detail || request.note),
    suggestedActions: Array.isArray(request.suggestedActions) ? request.suggestedActions : [],
    implementation: textValue(request.implementation),
    validationSample: isValidationWorkItem(request),
  };
}

// Comment timeline for the selected work item. The backend detail payload
// carries `comments` (review notes + request-linked audit events); when it
// doesn't, fall back to the record's own reviewNote so a just-written
// comment is never invisible.
function workItemComments(detail = null) {
  const list = Array.isArray(detail?.comments)
    ? detail.comments.filter((comment) => textValue(comment?.text))
    : [];
  if (list.length) return list;
  const reviewNote = textValue(detail?.reviewNote);
  if (!reviewNote) return [];
  return [
    {
      id: "review-note-local",
      author: textValue(detail?.reviewedBy),
      at: textValue(detail?.reviewedAt),
      text: reviewNote,
      kind: "review-note",
    },
  ];
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
  onOpenLineage, // eslint-disable-line no-unused-vars -- route contract parity with other workspaces
  runtimeFeatureFlags = [], // eslint-disable-line no-unused-vars -- route contract parity with other workspaces
}) {
  const [focusedAssetFqn, setFocusedAssetFqn] = useState(initialAssetFqn || "");
  const [liveGovernance, setLiveGovernance] = useState(governance);
  const seedAssets = contextSeedAssets?.length ? contextSeedAssets : bootstrap?.assets || [];
  const seeded = useSeededAssetContext(focusedAssetFqn, bootstrap, seedAssets, { allowFallback: false });
  const assetDetail = useAssetDetail(focusedAssetFqn || "", { sections: ["header", "activity"] });
  const [focusedAssetSnapshot, setFocusedAssetSnapshot] = useState(null);
  const focusedAsset = focusedAssetSnapshot || assetDetail.detail || seeded.summary;
  const views = useMemo(() => governanceViews(liveGovernance), [liveGovernance]);
  const [mutationState, setMutationState] = useState({
    kind: "",
    loading: false,
    error: "",
    success: "",
  });
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
  // New-work-item draft. Filed through the REAL governance request create
  // API — this panel used to be a hardcoded "unavailable" placard even
  // though the same actor could create requests from other surfaces.
  const [newWorkDraft, setNewWorkDraft] = useState({ assetFqn: "", title: "", note: "" });
  const [newWorkSubmitting, setNewWorkSubmitting] = useState(false);
  const [newWorkError, setNewWorkError] = useState("");
  // Toast-style status surface for staged actions (New work item, etc.).
  // Cleared on next action panel open or after a 6s timeout.
  const [statusMessage, setStatusMessage] = useState("");
  useEffect(() => {
    if (!statusMessage) return undefined;
    const handle = window.setTimeout(() => setStatusMessage(""), 6000);
    return () => window.clearTimeout(handle);
  }, [statusMessage]);

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

  useEffect(() => {
    setMutationState({ kind: "", loading: false, error: "", success: "" });
  }, [focusedAssetFqn]);

  const refreshNorthstarWorkbench = () => {
    fetchGovernanceWorkbench({})
      .then((payload) => setNorthstarWorkbench(payload))
      .catch(() => null);
  };

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

  // "Bulk assign" was removed: the governance request PATCH endpoint has no
  // assignee write path, and a permanently disabled control is a dead
  // control. Reintroduce it only alongside a backed assignment mutation.

  const showNewWorkItemPanel = () => {
    setNewWorkDraft({ assetFqn: focusedAssetFqn || "", title: "", note: "" });
    setNewWorkError("");
    showNorthstarActionPanel({
      kind: "new-work-item",
      title: "File a governance work item",
      eyebrow: "New work item",
      body: "Creates a real governance request for the asset you name. It lands in this queue and in the governance audit trail.",
    });
  };

  const submitNewWorkItem = async () => {
    const assetFqn = newWorkDraft.assetFqn.trim();
    const title = newWorkDraft.title.trim();
    if (!assetFqn || !title || newWorkSubmitting) return;
    setNewWorkSubmitting(true);
    setNewWorkError("");
    try {
      const response = await createGovernanceRequest(
        { assetFqn, title, note: newWorkDraft.note.trim() },
        { fast: true },
      );
      setNorthstarActionPanel(null);
      const createdId = textValue(response?.requestId);
      setStatusMessage(
        createdId
          ? `Work item created (${workItemDisplayId({ requestId: createdId })}).`
          : "Work item created.",
      );
      // Pull the fresh queue so the new request appears without a reload.
      refreshNorthstarWorkbench();
    } catch (error) {
      setNewWorkError(error?.message || "Unable to create the work item right now.");
    } finally {
      setNewWorkSubmitting(false);
    }
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
    // Re-fetch the detail so the just-written review note lands in the
    // Comments timeline immediately (the store persists it as review_note).
    fetchGovernanceRequestDetail(northstarSelectedDetail.requestId)
      .then((payload) => setNorthstarDetail(payload))
      .catch(() => null);
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

  const copySelectedFullId = () => {
    const fullId = workItemFullId(northstarSelectedDetail || {});
    if (!fullId) return;
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (clipboard?.writeText) {
      clipboard
        .writeText(fullId)
        .then(() => setStatusMessage(`Copied full request id ${fullId}.`))
        .catch(() => setStatusMessage(`Full request id: ${fullId}`));
    } else {
      // No clipboard API (older embeds): still surface the id so the click
      // is never a dead control.
      setStatusMessage(`Full request id: ${fullId}`);
    }
  };

  const openWorkItemCount = finiteMetricValue(null, northstarQueueUniverse.length);
  const slaBreachCount = finiteMetricValue(
    null,
    northstarQueueCounts.overdue,
  );
  // The hero only claims "SLA evidence unavailable" when the queue's
  // requests genuinely lack any SLA basis (no sla/due fields AND no
  // created_at to derive the default 7-day policy from). Requests with
  // created_at now carry a backend-derived default SLA.
  const northstarSlaEvidenceAvailable = northstarQueueUniverse.some(
    (request) => hasSlaEvidence(request) || textValue(request.createdAt),
  );
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
  const selectedComments = workItemComments(northstarSelectedDetail);
  const selectedDiffRows = Array.isArray(northstarSelectedDetail?.diff?.rows)
    ? northstarSelectedDetail.diff.rows.filter((row) => textValue(row?.after) || textValue(row?.before))
    : [];
  const northstarCanMutate = canMutateGovernanceRequests(currentUser || {}, bootstrap || {});
  const northstarCanFileWorkItems = canFileGovernanceWorkItems(currentUser || {}, bootstrap || {});
  const northstarMutationRole = governanceMutationRole(currentUser || {}, bootstrap || {}) || "Reader";
  const northstarMutationUnavailable = Boolean(northstarSelectedDetail) && (
    northstarPrototypeEvidence || !northstarCanMutate
  );
  const northstarMutationUnavailableReason = northstarPrototypeEvidence
    ? "These work items are unavailable until live governance request evidence is loaded."
    : !northstarCanMutate
      ? `Comment and resolve require Steward or Admin role. Current actor role: ${northstarMutationRole}.`
      : "";
  const newWorkItemDisabledReason = !northstarCanFileWorkItems
    ? `Creating work items requires Writer, Steward, or Admin role. Current actor role: ${northstarMutationRole}.`
    : !newWorkDraft.assetFqn.trim() || !newWorkDraft.title.trim()
      ? "Enter an asset FQN and a title to create the work item."
      : "";

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
          {northstarActionPanel.kind === "new-work-item" ? (
            <div className="gh-form-stack">
              <label className="gh-metadata-edit-field">
                <span>Asset FQN</span>
                <input
                  aria-label="New work item asset FQN"
                  className="gh-input"
                  onChange={(event) =>
                    setNewWorkDraft((current) => ({ ...current, assetFqn: event.target.value }))
                  }
                  placeholder="catalog.schema.table"
                  value={newWorkDraft.assetFqn}
                />
              </label>
              <label className="gh-metadata-edit-field">
                <span>Title</span>
                <input
                  aria-label="New work item title"
                  className="gh-input"
                  onChange={(event) =>
                    setNewWorkDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="What needs to happen?"
                  value={newWorkDraft.title}
                />
              </label>
              <label className="gh-metadata-edit-field">
                <span>Note</span>
                <textarea
                  aria-label="New work item note"
                  className="gh-input gh-textarea"
                  onChange={(event) =>
                    setNewWorkDraft((current) => ({ ...current, note: event.target.value }))
                  }
                  placeholder="Optional context for the steward who picks this up"
                  rows={3}
                  value={newWorkDraft.note}
                />
              </label>
              {newWorkError ? (
                <InlineStatusBanner message={newWorkError} title="Work item creation failed" />
              ) : null}
              <div className="gh-governance-ns-action-panel-controls">
                <button
                  disabled={Boolean(newWorkItemDisabledReason) || newWorkSubmitting}
                  onClick={submitNewWorkItem}
                  title={newWorkItemDisabledReason || "File this as a real governance request."}
                  type="button"
                >
                  {newWorkSubmitting ? "Creating…" : "Create work item"}
                </button>
                <button onClick={() => setNorthstarActionPanel(null)} type="button">
                  Dismiss
                </button>
              </div>
            </div>
          ) : (
            <>
              {Array.isArray(northstarActionPanel.facts) && northstarActionPanel.facts.length ? (
                <dl>
                  {northstarActionPanel.facts.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
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
            </>
          )}
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
                  <span className="is-mono" title={workItemFullId(item) || workItemDisplayId(item)}>
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
                  <span
                    className={`gh-governance-ns-sla tone-${slaTone(item)}`}
                    title={slaPolicyNote(item) || undefined}
                  >
                    <GovernanceGlyph icon="clock" />{slaLabel(item)}
                  </span>
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
                  <h2
                    className="gh-governance-ns-detail-id"
                    title={workItemFullId(northstarSelectedDetail) || undefined}
                  >
                    {workItemDisplayId(northstarSelectedDetail)}
                  </h2>
                  <p>{workItemKind(northstarSelectedDetail)}</p>
                  <div className="gh-governance-ns-request-id">
                    <span className={`gh-governance-ns-priority tone-${priorityTone(northstarSelectedDetail.priority)}`}>
                      {priorityShortLabel(northstarSelectedDetail.priority)} · {priorityDisplayLabel(northstarSelectedDetail.priority).replace(" Priority", "")}
                    </span>
                    <span
                      className={`gh-governance-ns-sla tone-${slaTone(northstarSelectedDetail)}`}
                      title={slaPolicyNote(northstarSelectedDetail) || undefined}
                    >
                      <GovernanceGlyph icon="clock" />{slaLabel(northstarSelectedDetail)}
                    </span>
                    <span className="gh-governance-ns-team-chip">
                      <GovernanceGlyph icon="users" />{workItemAssigned(northstarSelectedDetail)}
                    </span>
                    {workItemFullId(northstarSelectedDetail) &&
                      workItemFullId(northstarSelectedDetail) !== workItemDisplayId(northstarSelectedDetail) ? (
                      <button
                        className="gh-tertiary-button gh-inline-link-button"
                        onClick={copySelectedFullId}
                        title={`Copy full request id ${workItemFullId(northstarSelectedDetail)}`}
                        type="button"
                      >
                        Copy ID
                      </button>
                    ) : null}
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
                  {textValue(
                    northstarSelectedDetail.evidence || northstarSelectedDetail.businessContext || northstarSelectedDetail.detail,
                    selectedDiffRows.length
                      ? "This request proposes the metadata changes listed below."
                      : "No opening evidence was recorded for this work item.",
                  )}
                </p>
                {selectedDiffRows.length ? (
                  // The request's own field diff IS the opening evidence for
                  // steward-filed metadata changes; render it instead of the
                  // empty "no evidence" claim. `before` renders only when the
                  // backend recorded it — after-only rows stay honest.
                  <dl className="gh-governance-ns-evidence-grid" aria-label="Requested metadata changes">
                    {selectedDiffRows.map((rowItem) => (
                      <div key={rowItem.field || rowItem.label}>
                        <dt>{textValue(rowItem.label || rowItem.field, "Field")}</dt>
                        <dd>
                          {textValue(rowItem.before)
                            ? `${textValue(rowItem.before)} → ${textValue(rowItem.after, "—")}`
                            : textValue(rowItem.after, "—")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
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

              <section className="gh-governance-ns-subpanel is-wide" aria-label="Work item comments">
                <h3>Comments</h3>
                {selectedComments.length ? (
                  <div className="gh-governance-ns-comments">
                    {selectedComments.map((comment, index) => (
                      <div className="gh-governance-ns-comment" key={comment.id || `comment-${index}`}>
                        <div className="gh-governance-ns-eyebrow">
                          {textValue(comment.author, "Unknown actor")}
                          {textValue(comment.at) ? ` · ${formatShortDate(comment.at) || comment.at}` : ""}
                        </div>
                        <p>{textValue(comment.text)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="gh-governance-ns-empty">
                    No comments recorded for this work item yet. The Comment button files a review note.
                  </p>
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
