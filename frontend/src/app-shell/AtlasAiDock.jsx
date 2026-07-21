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

import { useCallback, useEffect, useRef, useState } from "react";

import { AtlasAiMark } from "../components/northstar/AtlasAiPanel";
import { MarkdownBlock } from "../components/primitives/MarkdownBlock";
import { useAtlasAiConversation } from "../hooks/useAtlasAiConversation";
import { useAtlasNavigate, usePeek } from "../nav/useAtlasNavigate.js";

const AI_CHAT_SIZE = { width: 360, height: 432 };
const AI_CHAT_WIDE_SIZE = { width: 440, height: 640 };

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
  available = false,
  unavailableReason = "",
  open = false,
  onOpenChange = () => {},
}) {
  const navigate = useAtlasNavigate();
  const { openPeek } = usePeek();

  const setOpen = onOpenChange;
  const [position, setPosition] = useState(() => defaultAiChatPosition());
  const [infoOpen, setInfoOpen] = useState(false);
  const [evidenceDetail, setEvidenceDetail] = useState(null);
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const dragRef = useRef(null);
  const aiChat = useAtlasAiConversation();

  const routeCopy = resolveAiRouteCopy(surface);
  const prompts = routeCopy.prompts || DEFAULT_AI_ROUTE_COPY.prompts;
  const groundingLine = available
    ? "Grounded in Unity Catalog metadata only - no customer or PII row content"
    : "Unavailable until an evidence-backed Atlas AI endpoint is configured";
  const emptyMessage = available ? routeCopy.emptyLive : unavailableReason;
  const placeholder = routeCopy.placeholder || DEFAULT_AI_ROUTE_COPY.placeholder;

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
          className="ga-ai-dock"
          ref={chatRef}
          role="dialog"
          style={{ left: `${position.left}px`, top: `${position.top}px` }}
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
            <button aria-label="Close Atlas AI" onClick={close} type="button">
              x
            </button>
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
                      setEvidenceDetail(null);
                      void aiChat.ask(prompt);
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
              setEvidenceDetail(null);
              void aiChat.ask(aiChat.draft);
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
        </section>
      ) : null}
    </>
  );
}

export default AtlasAiDock;
