import { useCallback, useEffect, useRef, useState } from "react";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useAtlasAiConversation } from "../hooks/useAtlasAiConversation";
import { openAssetRecordSafely } from "../lib/assetRecordNavigation";
import { workspaceAccessBanner } from "../lib/capabilities";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
import { InlineStatusBanner } from "./ShellStatePrimitives";
import { PRODUCT } from "../config/product";
import { GlobalHeader } from "./primitives/GlobalHeader";
import { TopbarSearch } from "./primitives/TopbarSearch";
import { InboxPanel } from "./primitives/InboxPanel";
import { CommandPalette } from "./primitives/CommandPalette";
import { SideIconRail } from "./primitives/SideIconRail";
import { humanizeStatusLabel } from "./primitives/shellStatusLabels";
import { AtlasAiMark } from "./northstar/AtlasAiPanel";
import { MarkdownBlock } from "./primitives/MarkdownBlock";

const AI_CHAT_SIZE = { width: 360, height: 432 };
const AI_CHAT_WIDE_SIZE = { width: 440, height: 640 };
const AI_AUTO_OPEN_WIDE_MODULES = new Set(["discovery", "governance", "taxonomy", "audit", "admin"]);

const AI_ROUTE_COPY = {
  home: {
    emptyLive: "Ask about executive-facing dashboards, owner risk, freshness, and certification using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about a dashboard, owner, or risk signal...",
    prompts: [
      "What's powering a selected executive dashboard, and is anything at risk this week?",
      "Which uncertified tables are queried by executives?",
      "Summarize PII coverage for a selected customer domain.",
      "Who owns the selected critical metric and when was it last certified?",
    ],
  },
  discovery: {
    emptyLive: "Ask about search results, asset trust signals, owners, glossary coverage, or inaccessible records using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about search results, owners, or glossary coverage...",
    prompts: [
      "Which visible assets have the strongest trust signal?",
      "Show customer assets without a certified owner.",
      "Explain why a deleted or inaccessible result appears.",
      "Which upstream tables should I inspect before using the selected asset?",
    ],
  },
  governance: {
    emptyLive: "Ask about stewardship queues, review work, SLA risk, owners, and request evidence using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about queue risk, owners, or review evidence...",
    prompts: [
      "Which stewardship items need attention first?",
      "Summarize overdue owner or certification work.",
      "What evidence supports the selected request?",
      "Which lineage gaps should a steward review?",
    ],
  },
  taxonomy: {
    emptyLive: "Ask about glossary terms, CDEs, reviewers, version history, and asset associations using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about a term, CDE, reviewer, or linked asset...",
    prompts: [
      "Which CDEs are due for review?",
      "What assets are linked to the selected glossary term?",
      "Summarize reviewer status for critical CDEs.",
      "Which glossary term has the most asset coverage?",
    ],
  },
  lineage: {
    emptyLive: "Ask about lineage hops, impact, provenance, and column completeness using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about upstream, downstream, or impact...",
    prompts: [
      "Which upstream assets feed the selected table?",
      "Summarize downstream impact for a schema change.",
      "Where is column lineage incomplete?",
      "Which restricted node affects revenue consumers?",
    ],
  },
  audit: {
    emptyLive: "Ask about audit events, control evidence, grants, notebook activity, and export context using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about audit evidence, grants, or exports...",
    prompts: [
      "Summarize audit evidence for the selected window.",
      "Which high-severity events need review?",
      "What provenance backs the audit export?",
      "Show recent permission or grant activity.",
    ],
  },
  admin: {
    emptyLive: "Ask about runtime health, integrations, policy coverage, setup diagnostics, and control evidence using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about runtime jobs, integrations, or policies...",
    prompts: [
      "Which runtime job or integration needs attention?",
      "Summarize control coverage gaps.",
      "What setup diagnostic should an admin inspect first?",
      "Which policies are stale or missing evidence?",
    ],
  },
  entity: {
    emptyLive: "Ask about the selected asset's ownership, schema, usage, quality, and governance evidence. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about this asset's owner, schema, or evidence...",
    prompts: [
      "Summarize this asset's governance evidence.",
      "Who owns this asset and what changed recently?",
      "Which schema or quality signals need review?",
      "What related assets should I inspect next?",
    ],
  },
};

const DEFAULT_AI_ROUTE_COPY = AI_ROUTE_COPY.home;

function resolveAiRouteCopy(activeModule) {
  return AI_ROUTE_COPY[activeModule] || DEFAULT_AI_ROUTE_COPY;
}

function defaultAiChatPosition() {
  if (typeof window === "undefined") return { top: 128, left: 960 };
  const size = window.innerWidth >= 2200 ? AI_CHAT_WIDE_SIZE : AI_CHAT_SIZE;
  const right = 22;
  const bottom = window.innerWidth >= 2200 ? 88 : 90;
  return {
    top: Math.max(82, window.innerHeight - size.height - bottom),
    left: Math.max(12, window.innerWidth - size.width - right),
  };
}

function shouldAutoOpenAtlasAi(activeModule = "") {
  if (!AI_AUTO_OPEN_WIDE_MODULES.has(activeModule)) return false;
  if (typeof window === "undefined") return false;
  return window.innerWidth >= 2200;
}

function clampAiChatPosition(position) {
  if (typeof window === "undefined") return position;
  const padding = 12;
  const footerReserve = 64;
  const defaultSize = window.innerWidth >= 2200 ? AI_CHAT_WIDE_SIZE : AI_CHAT_SIZE;
  const width = Number(position.width) || defaultSize.width;
  const height = Number(position.height) || defaultSize.height;
  const maxLeft = Math.max(padding, window.innerWidth - width - padding);
  const maxTop = Math.max(padding, window.innerHeight - height - footerReserve);
  return {
    left: Math.min(Math.max(position.left, padding), maxLeft),
    top: Math.min(Math.max(position.top, padding), maxTop),
  };
}

function compactEvidenceValue(value) {
  if (value == null || value === "") return "Unavailable";
  if (Array.isArray(value)) return value.map((item) => compactEvidenceValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function evidenceRowsFor(item) {
  if (Array.isArray(item?.resultRows)) return item.resultRows;
  if (Array.isArray(item?.rows)) return item.rows;
  if (Array.isArray(item?.results)) return item.results;
  return [];
}

function evidenceColumnsFor(item, rows = []) {
  const explicit = Array.isArray(item?.resultColumns) ? item.resultColumns : [];
  if (explicit.length) return explicit.map((column) => String(column || "").trim()).filter(Boolean);
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row || {})))).slice(0, 8);
}

function normalizeAiEvidenceItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const rawType = String(item.type || item.kind || item.metric || "").trim().toLowerCase();
  const rawMetric = String(item.metric || "").trim().toLowerCase();
  const assetFqn = String(item.assetFqn || item.asset_fqn || item.fqn || "").trim();
  const rawLabel = String(item.label || item.title || item.name || item.id || item.statementId || assetFqn || "").trim();
  const isQueryEvidence =
    rawType.includes("genie") ||
    rawType.includes("query") ||
    rawMetric === "generatedsql" ||
    Boolean(item.sql || item.statementId || item.statement_id);
  const label = isQueryEvidence
    ? String(item.title || item.label || "Generated SQL evidence").trim()
    : rawLabel || `Evidence ${index + 1}`;
  if (!label) return null;
  if (isQueryEvidence) {
    return {
      key: `${label}-${item.statementId || item.statement_id || index}`,
      label,
      routeLabel: "Open query evidence",
      target: { kind: "query-evidence", evidence: item },
    };
  }
  if (assetFqn || rawType === "asset" || /\w+\.\w+\.\w+/.test(label)) {
    return {
      key: `${label}-${index}`,
      label,
      routeLabel: "Open asset",
      target: { kind: "asset", assetFqn: assetFqn || label },
    };
  }
  if (rawType.includes("work") || /^SI-\d+/i.test(label)) {
    return {
      key: `${label}-${index}`,
      label,
      routeLabel: "Open Stewardship",
      target: { kind: "surface", surface: "governance" },
    };
  }
  if (rawType.includes("audit") || rawType.includes("event")) {
    return {
      key: `${label}-${index}`,
      label,
      routeLabel: "Open Audit",
      target: { kind: "surface", surface: "audit" },
    };
  }
  if (rawType.includes("lineage")) {
    return {
      key: `${label}-${index}`,
      label,
      routeLabel: "Open Lineage",
      target: { kind: "surface", surface: "lineage" },
    };
  }
  return {
    key: `${label}-${index}`,
    label,
    routeLabel: "",
    target: null,
  };
}

function AtlasAiEvidenceDetail({ evidence, onClose }) {
  if (!evidence) return null;
  const rows = evidenceRowsFor(evidence);
  const columns = evidenceColumnsFor(evidence, rows);
  const visibleRows = rows.slice(0, 4);
  const rowCount = Number.isFinite(Number(evidence.rowCount ?? evidence.totalRowCount))
    ? Number(evidence.rowCount ?? evidence.totalRowCount)
    : rows.length;
  const sql = String(evidence.sql || evidence.generatedSql || "").trim();
  const statementId = String(evidence.statementId || evidence.statement_id || evidence.id || "").trim();
  return (
    <section className="gh-floating-ai-evidence-detail" aria-label="Atlas AI query evidence">
      <header>
        <div>
          <span>Query Evidence</span>
          <strong>{rowCount.toLocaleString()} metadata row{rowCount === 1 ? "" : "s"} returned</strong>
        </div>
        <button aria-label="Close Atlas AI query evidence" onClick={onClose} type="button">
          x
        </button>
      </header>
      {statementId ? <p className="gh-floating-ai-evidence-statement">Statement {statementId}</p> : null}
      {sql ? (
        <pre className="gh-floating-ai-evidence-sql" data-testid="atlas-ai-query-evidence-sql">
          <code>{sql}</code>
        </pre>
      ) : (
        <p className="gh-floating-ai-evidence-empty">Generated SQL was not returned for this evidence record.</p>
      )}
      {visibleRows.length && columns.length ? (
        <div className="gh-floating-ai-evidence-table" role="table" aria-label="Atlas AI query evidence rows">
          <div role="row">
            {columns.map((column) => (
              <span key={column} role="columnheader">{column}</span>
            ))}
          </div>
          {visibleRows.map((row, rowIndex) => (
            <div key={`evidence-row-${rowIndex}`} role="row">
              {columns.map((column) => (
                <span key={`${column}-${rowIndex}`} role="cell">{compactEvidenceValue(row?.[column])}</span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AtlasAiEvidenceList({ evidence = [], onOpenEvidence }) {
  const items = evidence
    .map((item, index) => normalizeAiEvidenceItem(item, index))
    .filter(Boolean)
    .slice(0, 4);
  if (!items.length) return null;
  return (
    <div className="gh-floating-ai-evidence" aria-label="Atlas AI evidence">
      {items.map((item) => (
        item.target ? (
          <button
            key={item.key}
            onClick={() => onOpenEvidence?.(item.target)}
            title={item.routeLabel}
            type="button"
          >
            <span>{item.label}</span>
            <em>{item.routeLabel}</em>
          </button>
        ) : (
          <span className="gh-floating-ai-evidence-chip" key={item.key}>
            {item.label}
          </span>
        )
      ))}
    </div>
  );
}

// Atlas AI thinking-stage. Renders while a question is in-flight to show
// the user that the agent is preparing a query plan against governed metadata.
// The plan lines below are illustrative of the system tables the runtime
// inspects (governance_state.*, system.access.table_lineage, etc.) and are
// rotated as the request proceeds. The real backend may return a structured
// plan in the future; until then this stage gives the operator a visible
// "How I'm answering this" affordance instead of an opaque spinner.
const AI_PLAN_LINES = [
  ["Reading governance_state.kpi_snapshot", "joined to UC inventory"],
  ["Walking system.access.table_lineage", "for citation candidates"],
  ["Filtering by actor visibility", "permission-aware metadata only"],
  ["Composing grounded answer", "no raw rows read"],
];

function AtlasAiThinkingStage() {
  const [revealed, setRevealed] = useState(1);
  useEffect(() => {
    if (revealed >= AI_PLAN_LINES.length) return undefined;
    const timeout = setTimeout(() => setRevealed((value) => Math.min(AI_PLAN_LINES.length, value + 1)), 700);
    return () => clearTimeout(timeout);
  }, [revealed]);
  return (
    <div className="ga-ai-stage is-thinking" role="status" aria-live="polite">
      <div className="ga-ai-stage-label">
        <span aria-hidden="true" className="ga-live-dot" />
        How I&rsquo;m answering this
      </div>
      {AI_PLAN_LINES.slice(0, revealed).map(([head, tail], index) => {
        const isLast = index === revealed - 1;
        return (
          <div className="ga-ai-stage-plan-line" key={head} style={{ animationDelay: `${index * 80}ms` }}>
            <span aria-hidden="true">→</span>
            <span>
              <span className="ga-ai-stage-plan-mono">{head}</span>{" "}
              <span>{tail}</span>
              {isLast && revealed < AI_PLAN_LINES.length ? (
                <span className="ga-ai-stage-caret" aria-hidden="true" />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AtlasAiMessageList({
  messages = [],
  onOpenEvidence,
  emptyMessage,
}) {
  if (!messages.length) {
    return (
      <div className="gh-floating-ai-message tone-assistant is-empty" role="status">
        <span>Atlas AI</span>
        <strong>
          {emptyMessage || "I answer questions about your governed data using Unity Catalog metadata. I read Unity Catalog metadata only — no customer or PII row content."}
        </strong>
      </div>
    );
  }
  return messages.map((item) => (
    <div
      className={`gh-floating-ai-message tone-${item.role} ${item.pending ? "is-pending" : ""} ${item.error ? "tone-warn" : ""}`.trim()}
      key={item.id}
      role={item.error ? "alert" : "status"}
    >
      <span>{item.role === "user" ? "You" : "Atlas AI"}</span>
      {item.role === "assistant" && item.pending ? (
        <AtlasAiThinkingStage />
      ) : (
        <MarkdownBlock className="gh-ai-message-markdown" source={item.text} />
      )}
      {item.role === "assistant" && !item.pending && !item.error ? (
        <>
          <AtlasAiEvidenceList evidence={item.response?.evidence || []} onOpenEvidence={onOpenEvidence} />
          <em>
            {item.evidenceCount
              ? `${item.evidenceCount} evidence record${item.evidenceCount === 1 ? "" : "s"} returned.`
              : "No evidence records returned for this question."}
          </em>
        </>
      ) : null}
    </div>
  ));
}

export default function AppFrame({
  shell,
  searchSeedAssets = [],
  visibleAssetSet = new Set(),
  workspaceAccess = null,
  activeModule,
  currentAssetFqn = "",
  diagnosticsAvailable = false,
  diagnosticsStatus = null,
  diagnosticsOpen = false,
  governanceInbox = null,
  inboxOpen = false,
  onModuleChange,
  onOpenAsset360,
  onToggleDiagnostics,
  onOpenCapabilities,
  onToggleInbox,
  onInboxItemAction,
  bootState,
  bootMessage,
  liveCatalogVisibleCount = null,
  ucCoverageScore = null,
  navigationState,
  onBrowseCatalog,
  onNavigationStateChange,
  onSearchResultSelect,
  children,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchNotice, setSearchNotice] = useState("");
  const [shellHeaderHeight, setShellHeaderHeight] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const railCollapsed = false;
  const [aiChatOpen, setAiChatOpen] = useState(() => shouldAutoOpenAtlasAi(activeModule));
  const [aiChatPosition, setAiChatPosition] = useState(() => defaultAiChatPosition());
  const [aiInfoOpen, setAiInfoOpen] = useState(false);
  const [aiEvidenceDetail, setAiEvidenceDetail] = useState(null);
  const shellHeaderRef = useRef(null);
  const searchRootRef = useRef(null);
  const aiChatRef = useRef(null);
  const aiChatInputRef = useRef(null);
  const aiChatDragRef = useRef(null);
  const aiChat = useAtlasAiConversation();
  const aiRouteCopy = resolveAiRouteCopy(activeModule);
  const aiPrompts = aiRouteCopy.prompts || DEFAULT_AI_ROUTE_COPY.prompts;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  useEffect(() => {
    if (activeModule === "lineage") {
      setAiChatOpen(false);
    }
  }, [activeModule]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKey = (event) => {
      const activeTag = document.activeElement?.tagName;
      const isTypingField = activeTag === "INPUT" || activeTag === "TEXTAREA";
      const modKey = event.metaKey || event.ctrlKey;
      if (modKey && (event.key === "k" || event.key === "K") && !isTypingField) {
        event.preventDefault();
        setCommandOpen((c) => !c);
      } else if (event.key === "/" && !isTypingField) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    // Let inner surfaces (e.g. the Discovery sub-tab Quick action button)
    // open the palette without prop drilling through the children tree.
    const onOpenPalette = () => setCommandOpen(true);
    window.addEventListener("gh:open-command-palette", onOpenPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gh:open-command-palette", onOpenPalette);
    };
  }, []);
  const hasRenderableLiveCatalog =
    (typeof liveCatalogVisibleCount === "number" && liveCatalogVisibleCount > 0) ||
    visibleAssetSet?.size > 0;
  const visibleCatalogCount =
    typeof liveCatalogVisibleCount === "number" ? liveCatalogVisibleCount : visibleAssetSet?.size || 0;
  const shellDisabled = (bootState === "unavailable" || bootState === "error") && !hasRenderableLiveCatalog;
  const shellDisabledReason = shellDisabled
    ? bootMessage
      || (bootState === "error"
        ? "The live catalog failed to load. Complete workspace setup or retry to re-enable navigation."
        : "The live catalog is not available yet. Complete workspace setup to re-enable navigation.")
    : undefined;
  const showRuntimeStatus =
    (bootState === "unavailable" || bootState === "error") && !hasRenderableLiveCatalog;
  const setupStatusState = String(diagnosticsStatus?.state || "").trim().toLowerCase();
  const showSetupStatus = Boolean(
    setupStatusState && setupStatusState !== "ready" && setupStatusState !== "complete",
  );
  const setupStatusNextStep = diagnosticsAvailable && diagnosticsStatus?.nextStep
    ? `Next step: ${humanizeStatusLabel(diagnosticsStatus.nextStep)}.`
    : diagnosticsAvailable
      ? "Setup diagnostics are being refreshed."
      : "Setup diagnostics have not loaded yet.";
  const inboxUnreadCount = Number.isFinite(Number(governanceInbox?.unreadCount))
    ? Math.max(0, Math.trunc(Number(governanceInbox.unreadCount)))
    : 0;
  const stewardshipCount = Number.isFinite(Number(governanceInbox?.stewardshipCount))
    ? Math.max(0, Math.trunc(Number(governanceInbox.stewardshipCount)))
    : null;
  // Show the inbox chrome as soon as we know who the signed-in user is,
  // and let the panel open even when the governance summary hasn't
  // arrived yet — InboxPanel renders a proper empty/degraded state.
  // Operator 2026-04-19 flagged the old "click does nothing" behavior.
  const showInbox = Boolean(
    shell?.userEmail &&
    String(shell.userEmail).trim().toLowerCase() !== "unknown",
  );
  const showInboxPanel = showInbox && inboxOpen;
  const accessBanner = workspaceAccessBanner({ workspaceAccess });
  const accessBannerMessage =
    accessBanner?.title === "Workspace-scoped metadata"
      ? "Workspace-scoped app-principal view; actor-scoped protected reads stay restricted."
      : accessBanner?.message || "";
  const searchScopeSubject =
    accessBanner?.title === "Workspace-scoped metadata"
      ? "workspace inventory"
      : accessBanner?.title === "No actor identity"
        ? "restricted workspace inventory"
        : "visible assets";
  const searchScopeLabel = hasRenderableLiveCatalog
    ? `${visibleCatalogCount.toLocaleString()} visible asset${visibleCatalogCount === 1 ? "" : "s"} in scope`
    : "Visible catalog unavailable";
  const searchScopeHint = hasRenderableLiveCatalog
    ? accessBanner?.message || ""
    : "Search is paused until the live catalog becomes available.";
  const searchEnabled = !shellDisabled && searchPanelOpen && searchQuery.trim().length >= 2;
  const shellSearch = useAssetSearch(searchQuery, searchEnabled, searchSeedAssets);

  const topDirectResult =
    searchQuery.trim() && !shellSearch.error ? shellSearch.assets?.[0] || null : null;
  const openSearchResult = (assetFqn) => {
    if (!assetFqn) return;
    setSearchNotice("");
    void openAssetRecordSafely(assetFqn, {
      onNavigationStateChange,
      onOpen: () => {
        setSearchPanelOpen(false);
        onSearchResultSelect?.(assetFqn);
      },
      onUnavailable: () => {
        setSearchPanelOpen(true);
        setSearchNotice(
          "That asset appears in search, but its metadata record is not openable with the current permissions.",
        );
      },
    });
  };
  const openHomeModule = () => {
    onModuleChange?.("home");
  };

  const openFooterDestination = (destination) => {
    if (destination === "status") {
      onOpenCapabilities?.();
      return;
    }
    onModuleChange?.("help");
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        window.location.hash = destination;
      }, 0);
    }
  };

  const handleSignOut = () => {
    if (typeof window === "undefined") return;
    const workspaceHost = String(shell?.workspaceHost || shell?.workspace?.host || "").trim();
    const signOutUrl = workspaceHost
      ? `${workspaceHost.replace(/\/+$/, "")}/login.html?action=logOut`
      : "";
    const proceed = typeof window.confirm === "function"
      ? window.confirm(
          "Sign out?\n\nGovernance Atlas uses your Databricks workspace login. Continuing opens the Databricks sign-out page in a new tab.",
        )
      : true;
    if (!proceed) return;
    if (!signOutUrl) {
      window.alert?.("Workspace sign-out is unavailable because the Databricks host was not provided by the runtime.");
      return;
    }
    window.open(signOutUrl, "_blank", "noopener,noreferrer");
  };
  const goodHealthStates = ["ready", "complete", "healthy", "available", "live"];
  // Footer/topbar status is app liveness. Setup diagnostics can be
  // attention-required while the app itself is live; those details stay in the
  // diagnostics/capability surfaces instead of turning the global chrome into
  // a setup-readiness warning.
  const shellTruthEnvelope = shell && typeof shell === "object"
    ? Object.fromEntries(Object.entries(shell).filter(([key]) => key !== "ai"))
    : {};
  const shellNonAuthoritative = isNonAuthoritativeMockEvidence(bootState, shellTruthEnvelope);
  const shellHealthState =
    bootState === "live" && !shellDisabled
      ? "live"
      : shellNonAuthoritative
        ? "unavailable"
      : bootState === "error" || bootState === "unavailable"
        ? "unavailable"
        : bootState === "degraded"
          ? "degraded"
          : bootState === "loading"
            ? "loading"
            : "";
  const hasUcCoverage = Number.isFinite(Number(ucCoverageScore));
  const footerStatusTone =
    goodHealthStates.includes(shellHealthState) && hasUcCoverage
      ? "good"
      : goodHealthStates.includes(shellHealthState) || ["attention_required", "degraded", "warning", "loading", "pending"].includes(shellHealthState)
        ? "warn"
        : ["error", "failed", "unavailable"].includes(shellHealthState)
          ? "bad"
          : "";
  const footerStatusLabel = footerStatusTone
    ? humanizeStatusLabel(shellHealthState)
    : "";
  const environmentTone = footerStatusTone;
  const aiProviderState = String(shell?.ai?.state || "").trim().toLowerCase();
  const aiProviderName = String(shell?.ai?.provider || "").trim().toLowerCase();
  const aiAvailableStates = new Set(["available", "ready", "enabled", "configured", "live"]);
  const aiProviderAuthoritative = !isNonAuthoritativeMockEvidence(shell?.ai, aiProviderName);
  const aiCopilotAvailable =
    shellHealthState === "live" &&
    aiProviderAuthoritative &&
    aiAvailableStates.has(aiProviderState);
  const aiUnavailableReason =
    typeof shell?.ai?.message === "string" && shell.ai.message.trim()
      ? shell.ai.message.trim()
      : shellHealthState !== "live"
        ? "Atlas AI is waiting for the live metadata runtime before it can answer questions."
        : "Atlas AI requires a configured evidence-backed endpoint before it can answer questions.";
  const aiDockVisible = aiChatOpen;
  const aiGroundingLine = aiCopilotAvailable
    ? "Grounded in Unity Catalog metadata only - no customer or PII row content"
    : "Unavailable until an evidence-backed Atlas AI endpoint is configured";
  const aiEmptyMessage = aiRouteCopy.emptyLive;
  const aiPlaceholder = aiRouteCopy.placeholder || DEFAULT_AI_ROUTE_COPY.placeholder;
  const closeAiCopilot = useCallback(() => {
    setAiChatOpen(false);
    setAiInfoOpen(false);
    setAiEvidenceDetail(null);
    if (typeof window === "undefined") return;
    window.setTimeout?.(() => {
      const trigger = document.querySelector(".ga-ai-chip");
      if (trigger instanceof HTMLElement) {
        trigger.focus();
      }
    }, 0);
  }, []);
  const openAiCopilot = () => {
    setCommandOpen(false);
    setAiInfoOpen(false);
    setAiChatPosition((current) => clampAiChatPosition(current.left ? current : defaultAiChatPosition()));
    setAiChatOpen(true);
    if (typeof window !== "undefined") {
      window.setTimeout?.(() => {
        const box = aiChatRef.current?.getBoundingClientRect?.();
        if (box) {
          setAiChatPosition((current) =>
            clampAiChatPosition({ ...current, width: box.width, height: box.height }),
          );
        }
        aiChatInputRef.current?.focus?.();
      }, 0);
    }
  };

  const openAiEvidence = useCallback((target) => {
    if (!target) return;
    if (target.kind === "query-evidence") {
      setAiEvidenceDetail(target.evidence || {});
      return;
    }
    if (target.kind === "asset" && target.assetFqn) {
      closeAiCopilot();
      onSearchResultSelect?.(target.assetFqn);
      return;
    }
    if (target.kind === "surface" && target.surface) {
      closeAiCopilot();
      onModuleChange?.(target.surface);
    }
  }, [closeAiCopilot, onModuleChange, onSearchResultSelect]);

  useEffect(() => {
    if (activeModule === "lineage") {
      setAiChatOpen(false);
      return;
    }
    if (shouldAutoOpenAtlasAi(activeModule)) {
      setAiChatOpen(true);
    }
  }, [activeModule]);

  useEffect(() => {
    setSearchPanelOpen(false);
    setSearchNotice("");
  }, [activeModule]);

  useEffect(() => {
    if (!diagnosticsOpen) return;
    setSearchPanelOpen(false);
    setSearchNotice("");
  }, [diagnosticsOpen]);

  useEffect(() => {
    if (!searchPanelOpen) return undefined;

    const onPointerDown = (event) => {
      if (!searchRootRef.current?.contains(event.target)) {
        setSearchPanelOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSearchPanelOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [searchPanelOpen]);

  useEffect(() => {
    if (!aiChatOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeAiCopilot();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [aiChatOpen, closeAiCopilot]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => {
      const box = aiChatRef.current?.getBoundingClientRect?.();
      setAiChatPosition((current) =>
        clampAiChatPosition({
          ...current,
          width: box?.width,
          height: box?.height,
        }),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPointerMove = (event) => {
      const drag = aiChatDragRef.current;
      if (!drag) return;
      setAiChatPosition(clampAiChatPosition({
        left: drag.left + event.clientX - drag.x,
        top: drag.top + event.clientY - drag.y,
        width: drag.width,
        height: drag.height,
      }));
    };
    const onPointerUp = () => {
      aiChatDragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (!aiChatOpen || typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const node = aiChatRef.current;
    if (!node) return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const box = node.getBoundingClientRect();
        setAiChatPosition((current) =>
          clampAiChatPosition({ ...current, width: box.width, height: box.height }),
        );
      });
    });
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [aiChatOpen]);

  useEffect(() => {
    const header = shellHeaderRef.current;
    if (!header) return undefined;

    let animationFrame = 0;
    const updateShellHeaderHeight = () => {
      const nextHeight = Math.max(
        0,
        Math.ceil(header.getBoundingClientRect?.().height || header.offsetHeight || 0),
      );
      setShellHeaderHeight((current) => (current === nextHeight ? current : nextHeight));
    };
    const scheduleShellHeaderMeasure = () => {
      if (typeof window === "undefined") {
        updateShellHeaderHeight();
        return;
      }
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateShellHeaderHeight);
    };

    scheduleShellHeaderMeasure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        scheduleShellHeaderMeasure();
      });
      observer.observe(header);
      return () => {
        if (typeof window !== "undefined") {
          window.cancelAnimationFrame(animationFrame);
        }
        observer.disconnect();
      };
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", scheduleShellHeaderMeasure);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", scheduleShellHeaderMeasure);
      }
    };
  }, [
    bootMessage,
    bootState,
    diagnosticsAvailable,
    diagnosticsOpen,
    inboxOpen,
    navigationState?.label,
    navigationState?.pending,
    searchPanelOpen,
    setupStatusNextStep,
    setupStatusState,
    shell?.role,
    shell?.userEmail,
    showInbox,
    showRuntimeStatus,
    showSetupStatus,
  ]);

  const submitSearch = () => {
    if (shellDisabled) return;
    const query = searchQuery.trim();
    if (!query) return;
    setSearchPanelOpen(false);
    onBrowseCatalog?.(query);
  };

  return (
    <div
      className="gh-app gh-app-with-rail"
      data-ai-open={aiDockVisible ? "true" : "false"}
      data-active-module={activeModule || ""}
      data-rail-collapsed={railCollapsed ? "true" : "false"}
      data-shell-sticky-ready={shellHeaderHeight > 0 ? "true" : "false"}
      style={/** @type {import("react").CSSProperties} */ ({
        "--gh-shell-header-height": `${shellHeaderHeight}px`,
      })}
    >
      <SideIconRail
        activeModule={activeModule}
        currentAssetFqn={currentAssetFqn}
        collapsed={railCollapsed}
        stewardshipCount={stewardshipCount}
        userName={shell?.userName || shell?.displayName || shell?.userEmail || ""}
        userEmail={shell?.userEmail || ""}
        userRole={shell?.role || ""}
        roleProvisional={Boolean(shell?.roleProvisional)}
        onOpenSettings={onToggleDiagnostics}
        onOpenCapabilities={onOpenCapabilities}
        onSignOut={handleSignOut}
        onModuleChange={onModuleChange}
        onOpenAsset360={onOpenAsset360}
        shellDisabled={shellDisabled}
        shellDisabledReason={shellDisabledReason}
      />
      <header className="gh-shell-header" ref={shellHeaderRef}>
        <GlobalHeader
          shell={shell}
          shellDisabled={shellDisabled}
          shellDisabledReason={shellDisabledReason}
          onOpenHome={openHomeModule}
          showInbox={showInbox}
          inboxOpen={inboxOpen}
          inboxUnreadCount={inboxUnreadCount}
          inboxState={governanceInbox?.state || ""}
          inboxMessage={governanceInbox?.message || ""}
          onToggleInbox={onToggleInbox}
          onOpenCapabilities={onOpenCapabilities}
          onOpenHelp={() => onModuleChange?.("help")}
          onOpenAiCopilot={openAiCopilot}
          aiCopilotAvailable={aiCopilotAvailable}
          environmentTone={environmentTone}
          ucCoverageScore={ucCoverageScore}
          ucStatusState={shellHealthState}
          topbarSearchSlot={(
            <TopbarSearch
              searchRootRef={searchRootRef}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchPanelOpen={searchPanelOpen}
              onSearchPanelOpenChange={setSearchPanelOpen}
              onSubmit={submitSearch}
              shellDisabled={shellDisabled}
              shellDisabledReason={shellDisabledReason}
              searchEnabled={searchEnabled}
              searchAssets={shellSearch.assets || []}
              searchError={shellSearch.error}
              searchLoading={shellSearch.loading}
              searchNotice={searchNotice}
              onSearchNoticeReset={() => setSearchNotice("")}
              onSelectAsset={(assetFqn) => {
                void openSearchResult(assetFqn);
              }}
              topDirectResult={topDirectResult}
              placeholder="Search assets, columns, glossary terms, owners..."
            />
          )}
        />
      </header>

      {showInboxPanel ? (
        <InboxPanel governanceInbox={governanceInbox} onInboxItemAction={onInboxItemAction} />
      ) : null}

      <main className="gh-main">
        {accessBanner ? (
          <InlineStatusBanner
            className="gh-shell-access-banner"
            details={accessBanner.message}
            message={accessBannerMessage}
            title={accessBanner.title}
            tone={accessBanner.tone}
          />
        ) : null}
        {children}
      </main>

      <footer className="ga-shell-footer" aria-label="Governance Atlas footer" hidden>
        <span className="ga-shell-footer-copyright">{PRODUCT.copyright}</span>
        <div className="ga-shell-footer-links">
          <button type="button" onClick={() => openFooterDestination("privacy")}>Privacy</button>
          <button type="button" onClick={() => openFooterDestination("terms")}>Terms</button>
          <button type="button" onClick={() => openFooterDestination("support")}>Support</button>
          <button
            aria-label={footerStatusLabel ? `System Status: ${footerStatusLabel}` : "System Status"}
            className={`ga-system-status ${footerStatusTone ? `tone-${footerStatusTone}` : ""}`.trim()}
            type="button"
            onClick={() => openFooterDestination("status")}
          >
            System Status
            {footerStatusTone ? <i aria-hidden="true" /> : null}
          </button>
        </div>
      </footer>

      {/* ⌘K hint pill in the bottom-right. The floating dark-mode
          toggle was removed 2026-04-19 round 3 — operator asked for
          the light cream theme to persist across all pages, and the
          moon icon was getting flagged as visual noise on an
          otherwise cream-only surface. */}
      <div className="gh-app-footer-controls">
        <button
          aria-label="Open command palette"
          className="gh-cmdk-hint-pill"
          onClick={() => setCommandOpen(true)}
          title="Open command palette (⌘K)"
          type="button"
        >
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </button>
      </div>

      <button
        aria-label={aiDockVisible ? "Atlas AI is open" : aiCopilotAvailable ? "Open Atlas AI" : `Open Atlas AI unavailable state: ${aiUnavailableReason}`}
        aria-pressed={aiDockVisible}
        className="gh-atlas-ai-fab"
        onClick={openAiCopilot}
        title={aiCopilotAvailable ? "Open Atlas AI" : aiUnavailableReason}
        type="button"
      >
        <AtlasAiMark />
      </button>

      {aiDockVisible ? (
        <section
          aria-label="Atlas AI"
          aria-modal="false"
          className="gh-floating-ai-chat"
          ref={aiChatRef}
          role="dialog"
          style={{
            left: `${aiChatPosition.left}px`,
            top: `${aiChatPosition.top}px`,
          }}
        >
          <header
            className="gh-floating-ai-header"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              if (event.target instanceof Element && event.target.closest("button")) return;
              aiChatDragRef.current = {
                x: event.clientX,
                y: event.clientY,
                left: aiChatPosition.left,
                top: aiChatPosition.top,
                width: event.currentTarget.closest(".gh-floating-ai-chat")?.getBoundingClientRect?.().width,
                height: event.currentTarget.closest(".gh-floating-ai-chat")?.getBoundingClientRect?.().height,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
          >
            <div>
              <AtlasAiMark />
              <span>
                <strong>Atlas AI</strong>
                <em>{aiGroundingLine}</em>
              </span>
            </div>
            <button aria-label="Close Atlas AI" onClick={closeAiCopilot} type="button">
              x
            </button>
          </header>
          <div className="gh-floating-ai-body">
            <div className="gh-floating-ai-transcript" aria-live="polite">
              <AtlasAiMessageList
                emptyMessage={aiCopilotAvailable ? aiEmptyMessage : aiUnavailableReason}
                messages={aiChat.messages}
                onOpenEvidence={openAiEvidence}
              />
              <AtlasAiEvidenceDetail
                evidence={aiEvidenceDetail}
                onClose={() => setAiEvidenceDetail(null)}
              />
            </div>
            <div className="gh-floating-ai-prompt-group">
              <div className="gh-floating-ai-prompt-label">TRY ASKING</div>
              <div className="gh-floating-ai-prompts" aria-label="Atlas AI suggested prompts">
                {aiPrompts.slice(0, aiChat.messages.length ? 1 : aiPrompts.length).map((prompt) => (
                  <button
                    disabled={!aiCopilotAvailable || aiChat.loading}
                    key={prompt}
                    onClick={() => {
                      if (!aiCopilotAvailable) return;
                      setAiEvidenceDetail(null);
                      void aiChat.ask(prompt);
                    }}
                    title={
                      !aiCopilotAvailable
                        ? aiUnavailableReason
                        : aiChat.loading
                          ? "Atlas AI is answering the current question."
                          : undefined
                    }
                    type="button"
                  >
                    <span aria-hidden="true" className="gh-floating-ai-prompt-icon">?</span>
                    <span>{prompt}</span>
                    <span aria-hidden="true" className="gh-floating-ai-prompt-arrow">→</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <form
            aria-busy={aiChat.loading ? "true" : "false"}
            className="gh-floating-ai-input"
            onSubmit={(event) => {
              event.preventDefault();
              if (!aiCopilotAvailable) return;
              setAiEvidenceDetail(null);
              void aiChat.ask(aiChat.draft);
            }}
          >
            <input
              disabled={!aiCopilotAvailable || aiChat.loading}
              onChange={(event) => aiChat.setDraft(event.target.value)}
              placeholder={aiCopilotAvailable ? aiPlaceholder : aiUnavailableReason}
              ref={aiChatInputRef}
              type="text"
              value={aiChat.draft}
            />
            <button
              aria-label={aiChat.loading ? "Atlas AI is responding" : "Ask Atlas AI"}
              disabled={!aiCopilotAvailable || aiChat.loading || !aiChat.draft.trim()}
              title={
                !aiCopilotAvailable
                  ? aiUnavailableReason
                  : aiChat.loading
                  ? "Atlas AI is answering the current question."
                  : !aiChat.draft.trim()
                    ? "Enter a prompt to ask Atlas AI."
                    : undefined
              }
              type="submit"
            >
              {aiChat.loading ? (
                <span className="gh-floating-ai-spinner" aria-hidden="true" />
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12 19 5l-5 14-3-6-6-1Z" />
                </svg>
              )}
            </button>
          </form>
          <p className="gh-floating-ai-disclaimer">
            <span>Atlas AI uses AI. Review for accuracy.</span>
            <button
              aria-expanded={aiInfoOpen}
              aria-label="Atlas AI accuracy notice"
              onClick={() => setAiInfoOpen((current) => !current)}
              title={
                "Atlas AI answers are grounded in available governance metadata and should be reviewed for accuracy."
              }
              type="button"
            >
              i
            </button>
          </p>
          {aiInfoOpen ? (
            <p className="gh-floating-ai-info" role="status">
              Atlas AI answers are grounded in available governance metadata and should be reviewed before action.
            </p>
          ) : null}
        </section>
      ) : null}

      {commandOpen ? (
        <CommandPalette
          assets={searchSeedAssets}
          navigate={({ surface, fqn }) => {
            setCommandOpen(false);
            if (surface === "entity" && fqn) {
              onSearchResultSelect?.(fqn);
              return;
            }
            onModuleChange?.(surface);
          }}
          onClose={() => setCommandOpen(false)}
        />
      ) : null}
    </div>
  );
}
