/*
 * app-shell/AtlasAiDock.jsx — the floating Atlas AI chat + FAB (Wave B1).
 *
 * Extracted from AppFrame.jsx (~700 inlined lines) with behavior preserved:
 * drag/clamp positioning, resize re-clamping, per-route prompt copy, the
 * thinking-stage progress lines, evidence chips + the generated-SQL evidence
 * detail, the accuracy disclaimer. Refactor is intentionally gentle — the
 * only substantive changes are (a) class names move to the clean ga-ai-*
 * system prefix (styles in app-shell/shell.css), and (b) navigation goes
 * through the nav fabric: evidence asset chips open the ?peek= drawer (the
 * old drawer behavior), surface chips navigate(surfaceRef).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AtlasAiMark } from "../components/northstar/AtlasAiPanel";
import { MarkdownBlock } from "../components/primitives/MarkdownBlock";
import { useAtlasAiConversation } from "../hooks/useAtlasAiConversation";
import { readPref, writePref } from "../lib/prefs.js";
import { useAtlasNavigate, usePeek } from "../nav/useAtlasNavigate.js";

const AI_CHAT_SIZE = { width: 360, height: 432 };
const AI_CHAT_WIDE_SIZE = { width: 440, height: 640 };
// Resize bounds. Min keeps the transcript + input usable; max is clamped again
// to the viewport at drag time so the dock can never exceed the visible area.
const AI_CHAT_MIN = { width: 320, height: 360 };
const AI_CHAT_MAX = { width: 720, height: 960 };

// Per-surface grounding copy + suggested prompts, keyed by the NEW surface
// ids (nav/routes.js). Content is unchanged from AppFrame's AI_ROUTE_COPY —
// only the stewardship/glossary/evidence keys were renamed with their
// surfaces (assets = the old "entity" copy).
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
  stewardship: {
    emptyLive: "Ask about stewardship queues, review work, SLA risk, owners, and request evidence using governed metadata. I read Unity Catalog metadata only — no customer or PII row content.",
    placeholder: "Ask about queue risk, owners, or review evidence...",
    prompts: [
      "Which stewardship items need attention first?",
      "Summarize overdue owner or certification work.",
      "What evidence supports the selected request?",
      "Which lineage gaps should a steward review?",
    ],
  },
  glossary: {
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
  evidence: {
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
  assets: {
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

function resolveAiRouteCopy(surface) {
  return AI_ROUTE_COPY[surface] || DEFAULT_AI_ROUTE_COPY;
}

function assetShortName(assetFqn) {
  const text = String(assetFqn || "").trim();
  if (!text) return "";
  const parts = text.split(".");
  return parts[parts.length - 1] || text;
}

// Per-ASSET prompts: when the user is on an asset page (or has one peeked),
// the suggestions name that specific table so the click is unmistakably about
// what they're looking at. The backend also receives the FQN as context, so
// "this asset" resolves server-side even for a free-typed question.
function assetPromptsFor(assetFqn) {
  const name = assetShortName(assetFqn);
  if (!name) return null;
  return {
    emptyLive: `Ask about ${name} — ownership, certification, upstream sources, quality, and governance evidence. I read Unity Catalog metadata only — no customer or PII row content.`,
    placeholder: `Ask about ${name}...`,
    prompts: [
      `Who owns ${name} and is it certified?`,
      `What feeds ${name} and what is downstream?`,
      `What governance evidence and open work exist for ${name}?`,
      `Which quality or schema signals on ${name} need review?`,
    ],
  };
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
      target: { kind: "surface", surface: "stewardship" },
    };
  }
  if (rawType.includes("audit") || rawType.includes("event")) {
    return {
      key: `${label}-${index}`,
      label,
      routeLabel: "Open Evidence",
      target: { kind: "surface", surface: "evidence" },
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
  return { key: `${label}-${index}`, label, routeLabel: "", target: null };
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
    <section aria-label="Atlas AI query evidence" className="ga-ai-dock-evidence-detail">
      <header>
        <div>
          <span>Query Evidence</span>
          <strong>{rowCount.toLocaleString()} metadata row{rowCount === 1 ? "" : "s"} returned</strong>
        </div>
        <button aria-label="Close Atlas AI query evidence" onClick={onClose} type="button">
          x
        </button>
      </header>
      {statementId ? <p className="ga-ai-dock-evidence-statement">Statement {statementId}</p> : null}
      {sql ? (
        <pre className="ga-ai-dock-evidence-sql" data-testid="atlas-ai-query-evidence-sql">
          <code>{sql}</code>
        </pre>
      ) : (
        <p className="ga-ai-dock-evidence-empty">Generated SQL was not returned for this evidence record.</p>
      )}
      {visibleRows.length && columns.length ? (
        <div aria-label="Atlas AI query evidence rows" className="ga-ai-dock-evidence-table" role="table">
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
    <div aria-label="Atlas AI evidence" className="ga-ai-dock-evidence">
      {items.map((item) =>
        item.target ? (
          <button key={item.key} onClick={() => onOpenEvidence?.(item.target)} title={item.routeLabel} type="button">
            <span>{item.label}</span>
            <em>{item.routeLabel}</em>
          </button>
        ) : (
          <span className="ga-ai-dock-evidence-chip" key={item.key}>
            {item.label}
          </span>
        ),
      )}
    </div>
  );
}

// Progress copy while the AI provider responds. These lines describe the
// governed-metadata pipeline in general terms only — never name a specific
// table or claim a query happened, because the backend does not return a
// real execution plan and fabricated evidence violates the honesty rule.
const AI_PLAN_LINES = [
  ["Scoping the question", "governed metadata only"],
  ["Querying governed metadata", "Unity Catalog + governance store"],
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
    <div aria-live="polite" className="ga-ai-stage is-thinking" role="status">
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
                <span aria-hidden="true" className="ga-ai-stage-caret" />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AtlasAiMessageList({ messages = [], onOpenEvidence, emptyMessage }) {
  if (!messages.length) {
    return (
      <div className="ga-ai-dock-message tone-assistant is-empty" role="status">
        <strong>
          {emptyMessage ||
            "I answer questions about your governed data using Unity Catalog metadata. I read Unity Catalog metadata only — no customer or PII row content."}
        </strong>
      </div>
    );
  }
  return messages.map((item) => (
    <div
      className={`ga-ai-dock-message tone-${item.role} ${item.pending ? "is-pending" : ""} ${item.error ? "tone-warn" : ""}`.trim()}
      key={item.id}
      role={item.error ? "alert" : "status"}
    >
      <span>{item.role === "user" ? "You" : "Atlas AI"}</span>
      {item.role === "assistant" && item.pending ? (
        <AtlasAiThinkingStage />
      ) : (
        <MarkdownBlock className="ga-ai-dock-markdown" source={item.text} />
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

// Controlled component: AppShell owns `open` because the frame root must
// reflect it as data-ai-open (legacy per-surface squeeze CSS keys on it) and
// the header's Atlas AI chip opens the dock too.
export function AtlasAiDock({
  surface = "home",
  assetFqn = "",
  available = false,
  unavailableReason = "",
  open = false,
  onOpenChange = () => {},
}) {
  const navigate = useAtlasNavigate();
  const { openPeek } = usePeek();

  const setOpen = onOpenChange;
  const [position, setPosition] = useState(() => defaultAiChatPosition());
  // Persisted user size + maximize state (lib/prefs.js). width/height 0 means
  // "use the default size"; the dock stores the chosen size after a resize.
  const [size, setSize] = useState(() => {
    const stored = readPref("aiDockLayout");
    return { width: stored.width || 0, height: stored.height || 0 };
  });
  const [maximized, setMaximized] = useState(() => Boolean(readPref("aiDockLayout").maximized));
  const [infoOpen, setInfoOpen] = useState(false);
  const [evidenceDetail, setEvidenceDetail] = useState(null);
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  // Page-awareness context sent with every question so the backend can resolve
  // "this asset"/"this page" to a concrete entity. Recomputed as the user
  // navigates; memoized so the ask callbacks get a stable reference per surface.
  const aiContext = useMemo(
    () => ({ surface, assetFqn: String(assetFqn || "").trim() }),
    [surface, assetFqn],
  );
  const aiChat = useAtlasAiConversation();

  // On an asset page (or with a peeked asset), suggestions name that specific
  // table; otherwise fall back to the per-surface copy.
  const assetCopy = surface === "assets" || assetFqn ? assetPromptsFor(assetFqn) : null;
  const routeCopy = assetCopy || resolveAiRouteCopy(surface);
  const prompts = routeCopy.prompts || DEFAULT_AI_ROUTE_COPY.prompts;
  const groundingLine = available
    ? "Grounded in Unity Catalog metadata only - no customer or PII row content"
    : "Unavailable until an evidence-backed Atlas AI endpoint is configured";
  const emptyMessage = available ? routeCopy.emptyLive : unavailableReason;
  const placeholder = routeCopy.placeholder || DEFAULT_AI_ROUTE_COPY.placeholder;

  const askWithContext = useCallback(
    (prompt) => {
      setEvidenceDetail(null);
      void aiChat.ask(prompt, aiContext);
    },
    [aiChat, aiContext],
  );

  // Persist size + maximize whenever they change so the dock restores on reopen.
  useEffect(() => {
    writePref("aiDockLayout", { width: size.width, height: size.height, maximized });
  }, [size.width, size.height, maximized]);

  const toggleMaximize = useCallback(() => {
    setMaximized((current) => !current);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setInfoOpen(false);
    setEvidenceDetail(null);
    if (typeof window === "undefined") return;
    window.setTimeout?.(() => {
      const trigger = document.querySelector(".ga-ai-chip");
      if (trigger instanceof HTMLElement) trigger.focus();
    }, 0);
  }, [setOpen]);

  const openDock = useCallback(() => {
    setOpen(true);
  }, [setOpen]);

  // Whoever opens the dock (FAB here, or the header's Atlas AI chip via
  // AppShell), position clamping + input focus run on the open transition.
  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    setInfoOpen(false);
    setPosition((current) => clampAiChatPosition(current.left ? current : defaultAiChatPosition()));
    const timer = window.setTimeout(() => {
      const box = chatRef.current?.getBoundingClientRect?.();
      if (box) {
        setPosition((current) => clampAiChatPosition({ ...current, width: box.width, height: box.height }));
      }
      inputRef.current?.focus?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const openEvidence = useCallback(
    (target) => {
      if (!target) return;
      if (target.kind === "query-evidence") {
        setEvidenceDetail(target.evidence || {});
        return;
      }
      if (target.kind === "asset" && target.assetFqn) {
        // The old shell opened the Asset 360 drawer; the ?peek= binding is
        // that drawer's addressable successor — user keeps their place.
        openPeek(target.assetFqn);
        return;
      }
      if (target.kind === "surface" && target.surface) {
        close();
        navigate({ surface: target.surface });
      }
    },
    [close, navigate, openPeek],
  );

  // Lineage owns its own side panels — the dock closes when entering it
  // (same behavior as AppFrame).
  useEffect(() => {
    if (surface === "lineage") setOpen(false);
  }, [surface, setOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => {
      const box = chatRef.current?.getBoundingClientRect?.();
      setPosition((current) =>
        clampAiChatPosition({ ...current, width: box?.width, height: box?.height }),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPosition(
        clampAiChatPosition({
          left: drag.left + event.clientX - drag.x,
          top: drag.top + event.clientY - drag.y,
          width: drag.width,
          height: drag.height,
        }),
      );
    };
    const onPointerUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // Corner-handle resize. Clamps to [AI_CHAT_MIN, AI_CHAT_MAX] and to whatever
  // the viewport allows from the dock's current top/left, so the dock can never
  // grow off-screen. A resize implicitly exits the maximized state.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPointerMove = (event) => {
      const start = resizeRef.current;
      if (!start) return;
      const maxViewportW = Math.max(AI_CHAT_MIN.width, window.innerWidth - position.left - 12);
      const maxViewportH = Math.max(AI_CHAT_MIN.height, window.innerHeight - position.top - 12);
      const nextWidth = Math.min(
        Math.min(AI_CHAT_MAX.width, maxViewportW),
        Math.max(AI_CHAT_MIN.width, start.width + event.clientX - start.x),
      );
      const nextHeight = Math.min(
        Math.min(AI_CHAT_MAX.height, maxViewportH),
        Math.max(AI_CHAT_MIN.height, start.height + event.clientY - start.y),
      );
      setSize({ width: Math.round(nextWidth), height: Math.round(nextHeight) });
    };
    const onPointerUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [position.left, position.top]);

  useEffect(() => {
    if (!open || typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const node = chatRef.current;
    if (!node) return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const box = node.getBoundingClientRect();
        setPosition((current) => clampAiChatPosition({ ...current, width: box.width, height: box.height }));
      });
    });
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open]);

  // Rendered box. Maximized pins to a near-fullscreen panel on the right;
  // otherwise the persisted size (or the responsive default) at the dragged
  // position. Explicit width/height make the persisted resize visible.
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1440;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 900;
  const defaultSize = viewportW >= 2200 ? AI_CHAT_WIDE_SIZE : AI_CHAT_SIZE;
  let dockBox;
  if (maximized) {
    const width = Math.min(AI_CHAT_MAX.width, viewportW - 24);
    const height = Math.min(AI_CHAT_MAX.height, viewportH - 100);
    dockBox = { left: Math.max(12, viewportW - width - 12), top: 82, width, height };
  } else {
    dockBox = {
      left: position.left,
      top: position.top,
      width: size.width || defaultSize.width,
      height: size.height || defaultSize.height,
    };
  }

  return (
    <>
      <button
        aria-label={
          open
            ? "Atlas AI is open"
            : available
              ? "Open Atlas AI"
              : `Open Atlas AI unavailable state: ${unavailableReason}`
        }
        aria-pressed={open}
        className="ga-ai-fab"
        onClick={openDock}
        title={available ? "Open Atlas AI" : unavailableReason}
        type="button"
      >
        <AtlasAiMark />
      </button>

      {open ? (
        <section
          aria-label="Atlas AI"
          aria-modal="false"
          className={`ga-ai-dock${maximized ? " is-maximized" : ""}`}
          data-ai-maximized={maximized ? "true" : "false"}
          ref={chatRef}
          role="dialog"
          style={{
            left: `${dockBox.left}px`,
            top: `${dockBox.top}px`,
            width: `${dockBox.width}px`,
            height: `${dockBox.height}px`,
          }}
        >
          <header
            className="ga-ai-dock-header"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              if (event.target instanceof Element && event.target.closest("button")) return;
              const box = event.currentTarget.closest(".ga-ai-dock")?.getBoundingClientRect?.();
              dragRef.current = {
                x: event.clientX,
                y: event.clientY,
                left: position.left,
                top: position.top,
                width: box?.width,
                height: box?.height,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
          >
            <div>
              <AtlasAiMark />
              <span>
                <strong>Atlas AI</strong>
                <em>{groundingLine}</em>
              </span>
            </div>
            <div className="ga-ai-dock-header-actions">
              <button
                aria-label={maximized ? "Restore Atlas AI size" : "Maximize Atlas AI"}
                aria-pressed={maximized}
                className="ga-ai-dock-icon-btn"
                onClick={toggleMaximize}
                title={maximized ? "Restore" : "Maximize"}
                type="button"
              >
                {maximized ? (
                  <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
                    <path d="M6 5.5V4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1.5" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="10" height="10" rx="1" />
                  </svg>
                )}
              </button>
              <button aria-label="Close Atlas AI" className="ga-ai-dock-icon-btn" onClick={close} type="button">
                <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </header>
          <div className="ga-ai-dock-body">
            <div aria-live="polite" className="ga-ai-dock-transcript">
              <AtlasAiMessageList
                emptyMessage={emptyMessage}
                messages={aiChat.messages}
                onOpenEvidence={openEvidence}
              />
              <AtlasAiEvidenceDetail evidence={evidenceDetail} onClose={() => setEvidenceDetail(null)} />
            </div>
            <div className="ga-ai-dock-prompt-group">
              <div className="ga-ai-dock-prompt-label">TRY ASKING</div>
              <div aria-label="Atlas AI suggested prompts" className="ga-ai-dock-prompts">
                {prompts.slice(0, aiChat.messages.length ? 1 : prompts.length).map((prompt) => (
                  <button
                    disabled={!available || aiChat.loading}
                    key={prompt}
                    onClick={() => {
                      if (!available) return;
                      askWithContext(prompt);
                    }}
                    title={
                      !available
                        ? unavailableReason
                        : aiChat.loading
                          ? "Atlas AI is answering the current question."
                          : undefined
                    }
                    type="button"
                  >
                    <span aria-hidden="true" className="ga-ai-dock-prompt-icon">?</span>
                    <span>{prompt}</span>
                    <span aria-hidden="true" className="ga-ai-dock-prompt-arrow">→</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <form
            aria-busy={aiChat.loading ? "true" : "false"}
            className="ga-ai-dock-input"
            onSubmit={(event) => {
              event.preventDefault();
              if (!available) return;
              askWithContext(aiChat.draft);
            }}
          >
            <input
              disabled={!available || aiChat.loading}
              onChange={(event) => aiChat.setDraft(event.target.value)}
              placeholder={available ? placeholder : unavailableReason}
              ref={inputRef}
              type="text"
              value={aiChat.draft}
            />
            <button
              aria-label={aiChat.loading ? "Atlas AI is responding" : "Ask Atlas AI"}
              disabled={!available || aiChat.loading || !aiChat.draft.trim()}
              title={
                !available
                  ? unavailableReason
                  : aiChat.loading
                    ? "Atlas AI is answering the current question."
                    : !aiChat.draft.trim()
                      ? "Enter a prompt to ask Atlas AI."
                      : undefined
              }
              type="submit"
            >
              {aiChat.loading ? (
                <span aria-hidden="true" className="ga-ai-dock-spinner" />
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12 19 5l-5 14-3-6-6-1Z" />
                </svg>
              )}
            </button>
          </form>
          <p className="ga-ai-dock-disclaimer">
            <span>Atlas AI uses AI. Review for accuracy.</span>
            <button
              aria-expanded={infoOpen}
              aria-label="Atlas AI accuracy notice"
              onClick={() => setInfoOpen((current) => !current)}
              title="Atlas AI answers are grounded in available governance metadata and should be reviewed for accuracy."
              type="button"
            >
              i
            </button>
          </p>
          {infoOpen ? (
            <p className="ga-ai-dock-info" role="status">
              Atlas AI answers are grounded in available governance metadata and should be reviewed before action.
            </p>
          ) : null}
          {maximized ? null : (
            <div
              aria-hidden="true"
              className="ga-ai-dock-resize"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                resizeRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  width: dockBox.width,
                  height: dockBox.height,
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              title="Drag to resize"
            >
              <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M11 5 5 11M11 9l-2 2" />
              </svg>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

export default AtlasAiDock;
