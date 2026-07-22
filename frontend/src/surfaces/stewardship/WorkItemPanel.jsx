import { Badge, Button, EmptyState, EntityChip, StatusBanner, toast } from "../../components/system";
import {
  auditChipId,
  formatShortDate,
  looksLikeEmail,
  openingEvidenceFacts,
  priorityBadgeTone,
  priorityPickerValue,
  priorityShortLabel,
  slaBadgeTone,
  slaLabel,
  slaPolicyNote,
  textValue,
  workItemAuditTrail,
  workItemComments,
  workItemDisplayId,
  workItemFullId,
  workItemKind,
} from "./format.js";

/*
 * surfaces/stewardship/WorkItemPanel.jsx — the request mini-hub
 * (PRODUCT_BLUEPRINT §3c, addressable as /stewardship?item=GOV-<hex8>).
 * Answers, in order: what & why → target asset chip strip → triage
 * controls → evidence trail (diff, facts, comments with AUD EntityChips).
 */

function CopyIdButton({ item }) {
  const fullId = workItemFullId(item);
  if (!fullId || fullId === workItemDisplayId(item)) return null;
  const copy = () => {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (clipboard?.writeText) {
      clipboard
        .writeText(fullId)
        .then(() => toast("Request ID copied.", { tone: "success" }))
        .catch(() => toast(`Request ID: ${fullId}`));
    } else {
      // No clipboard API (older embeds): still surface the id so the click
      // is never a dead control.
      toast(`Request ID: ${fullId}`);
    }
  };
  return (
    <Button onClick={copy} size="sm" title={`Copy full request id ${fullId}`} variant="tertiary">
      Copy ID
    </Button>
  );
}

function EvidenceComments({ comments }) {
  if (!comments.length) {
    return (
      <p className="ga-stew-panel-muted">
        No comments recorded for this work item yet. The Comment button files a review note.
      </p>
    );
  }
  return (
    <div className="ga-stew-comments">
      {comments.map((comment, index) => {
        const commentId = textValue(comment.id);
        const author = textValue(comment.author, "Unknown actor");
        // Audit events this item generated join the Evidence ledger by
        // their stable AUD id — the id text is the anchor. The backend now
        // maps comments to `displayAuditId` where possible; AUD-shaped
        // comment ids remain the fallback for older payloads. auditChipId
        // format-checks both so a malformed id never links.
        const commentAuditId = auditChipId(comment.displayAuditId) || auditChipId(commentId);
        return (
          <div className="ga-stew-comment" key={commentId || `comment-${index}`}>
            <div className="ga-stew-comment-head">
              {looksLikeEmail(author) ? (
                <EntityChip appearance="inline" entity={{ kind: "owner", id: author }} />
              ) : (
                <span>{author}</span>
              )}
              {textValue(comment.at) ? <span>{formatShortDate(comment.at) || comment.at}</span> : null}
              {commentAuditId ? (
                <EntityChip appearance="inline" entity={{ kind: "event", id: commentAuditId }} />
              ) : null}
            </div>
            <p>{textValue(comment.text)}</p>
          </div>
        );
      })}
    </div>
  );
}

/*
 * The item's audit events, each anchored to its Evidence ledger row by the
 * backend-joined AUD display id (cross-linking LAW). Rows the backend could
 * not map to the ledger render as text — never a dead link.
 */
function AuditTrail({ trail, evidenceResolvable = true }) {
  if (!trail.length) {
    // Honest empty state — an absent `auditTrail` field (older backend) and
    // a genuinely empty trail both mean "nothing to show", not zero-padding.
    return (
      <p className="ga-stew-panel-muted">No audit events recorded for this item yet.</p>
    );
  }
  return (
    <div aria-label="Audit events" className="ga-stew-comments">
      {trail.map((row) => (
        <div className="ga-stew-comment" key={row.key}>
          <div className="ga-stew-comment-head">
            <span>{row.action}</span>
            {row.at ? <span>{formatShortDate(row.at) || row.at}</span> : null}
            {/* Evidence visibility-scopes out events about assets outside
                the visible estate — a chip there is a guaranteed dead link
                (follow-up verifier). Show the id as text with the withheld
                reason instead. */}
            {row.displayAuditId && evidenceResolvable ? (
              <EntityChip appearance="inline" entity={{ kind: "event", id: row.displayAuditId }} />
            ) : row.displayAuditId ? (
              <span
                className="ga-stew-panel-muted"
                title="Evidence for this asset is withheld outside your visible estate"
              >
                {row.displayAuditId}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkItemPanel({
  item = null,
  detailStatus = "available",
  canMutate = false,
  mutationUnavailableReason = "",
  triageBusy = false,
  triageError = "",
  onAssignToMe,
  onSetPriority,
  onComment,
  onResolve,
}) {
  if (!item) {
    return (
      <EmptyState
        className="ga-stew-panel-empty"
        title="No work item selected"
        body="Select a work item to review its evidence, target asset, and triage controls."
      />
    );
  }

  const displayId = workItemDisplayId(item);
  const fullId = workItemFullId(item);
  const canTriage = Boolean(item.requestId) && canMutate && !triageBusy;
  const disabledReason = mutationUnavailableReason || "";
  const comments = workItemComments(item);
  const diffRows = Array.isArray(item?.diff?.rows)
    ? item.diff.rows.filter((row) => textValue(row?.after) || textValue(row?.before))
    : [];
  const suggestedActions = Array.isArray(item.suggestedActions) ? item.suggestedActions : [];
  const requester = textValue(item.requester);

  return (
    <section aria-label="Work item detail" className="ga-stew-panel">
      {/* What & why ---------------------------------------------------- */}
      <header className="ga-stew-panel-head">
        <div className="ga-sys-eyebrow">Work item</div>
        <h2 className="ga-stew-panel-id" title={fullId || undefined}>{displayId}</h2>
        <p className="ga-stew-panel-kind">{workItemKind(item)}</p>
        <div className="ga-stew-panel-chips">
          <Badge size="sm" status={textValue(item.status, "Unavailable")} />
          <Badge size="sm" tone={priorityBadgeTone(item.priority)}>
            {priorityShortLabel(item.priority)}
          </Badge>
          <span title={slaPolicyNote(item) || undefined}>
            <Badge size="sm" tone={slaBadgeTone(item)}>{slaLabel(item)}</Badge>
          </span>
          <CopyIdButton item={item} />
        </div>
        <dl className="ga-stew-panel-meta">
          <div>
            <dt>Requested by</dt>
            <dd>
              {requester && looksLikeEmail(requester) ? (
                <EntityChip appearance="inline" entity={{ kind: "owner", id: requester }} />
              ) : (
                requester || "Requester unavailable"
              )}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatShortDate(item.createdAt) || "Unavailable"}</dd>
          </div>
          <div>
            <dt>Assigned</dt>
            <dd>
              {looksLikeEmail(item.assigned) ? (
                <EntityChip appearance="inline" entity={{ kind: "owner", id: item.assigned }} />
              ) : (
                textValue(item.assigned, "Unassigned")
              )}
            </dd>
          </div>
        </dl>
      </header>

      {/* Target asset chip strip -------------------------------------- */}
      <div className="ga-stew-panel-asset">
        <div className="ga-sys-eyebrow">Target asset</div>
        {item.assetFqn ? (
          <div className="ga-stew-panel-asset-chips">
            <EntityChip appearance="row" entity={{ kind: "asset", fqn: item.assetFqn }} />
            <EntityChip
              appearance="inline"
              entity={{ kind: "lineage", fqn: item.assetFqn, label: "Trace lineage" }}
            />
          </div>
        ) : (
          <p className="ga-stew-panel-muted">No target asset recorded for this work item.</p>
        )}
      </div>

      {/* Triage controls ----------------------------------------------- */}
      <div className="ga-stew-panel-triage" aria-label="Triage controls">
        {disabledReason ? <p className="ga-stew-panel-muted">{disabledReason}</p> : null}
        <div className="ga-stew-panel-triage-row">
          <Button
            disabled={!canTriage || Boolean(disabledReason)}
            loading={triageBusy}
            onClick={onAssignToMe}
            size="sm"
            title={disabledReason || "Assign this work item to yourself."}
            variant="secondary"
          >
            Assign to me
          </Button>
          <label className="ga-stew-priority-picker">
            <span>Priority</span>
            <select
              aria-label="Set work item priority"
              disabled={!canTriage || Boolean(disabledReason)}
              onChange={(event) => onSetPriority?.(event.target.value)}
              title={disabledReason || "Set the triage priority for this work item."}
              value={priorityPickerValue(item.priority)}
            >
              <option disabled value="">Unassigned</option>
              <option value="p0">P0</option>
              <option value="p1">P1</option>
              <option value="p2">P2</option>
              <option value="p3">P3</option>
            </select>
          </label>
          <Button
            disabled={!canTriage || Boolean(disabledReason)}
            onClick={onComment}
            size="sm"
            title={disabledReason || "Comment on this governance request."}
            variant="secondary"
          >
            Comment
          </Button>
          <Button
            disabled={!canTriage || Boolean(disabledReason)}
            onClick={onResolve}
            size="sm"
            title={disabledReason || "Resolve this governance request."}
            tone="success"
            variant="primary"
          >
            Resolve
          </Button>
        </div>
        {triageError ? (
          <StatusBanner message={triageError} title="Work item update failed" tone="danger" />
        ) : null}
      </div>

      {/* Evidence trail ------------------------------------------------- */}
      <div className="ga-stew-panel-evidence" aria-label="Evidence trail">
        <h3>Why this is open</h3>
        <p>
          {textValue(
            item.evidence || item.businessContext || item.detail,
            diffRows.length
              ? "This request proposes the metadata changes listed below."
              : "No opening evidence was recorded for this work item.",
          )}
        </p>
        {diffRows.length ? (
          // The request's own field diff IS the opening evidence for
          // steward-filed metadata changes. `before` renders only when the
          // backend recorded it — after-only rows stay honest.
          <dl aria-label="Requested metadata changes" className="ga-stew-evidence-grid">
            {diffRows.map((row) => (
              <div key={row.field || row.label}>
                <dt>{textValue(row.label || row.field, "Field")}</dt>
                <dd>
                  {textValue(row.before)
                    ? `${textValue(row.before)} → ${textValue(row.after, "—")}`
                    : textValue(row.after, "—")}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <dl aria-label="Opening evidence facts" className="ga-stew-evidence-grid">
          {openingEvidenceFacts(item).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {label === "Affected asset" && item.assetFqn ? (
                  <EntityChip appearance="inline" entity={{ kind: "asset", fqn: item.assetFqn }} />
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>

        {suggestedActions.length ? (
          <>
            <h3>Suggested actions</h3>
            <div className="ga-stew-suggestions">
              {suggestedActions.map((action, index) => (
                <Button
                  key={`${action.label || "action"}-${index}`}
                  onClick={() =>
                    // Visible staged intent (CLAUDE.md "no dead buttons"):
                    // the backed write lands with the workflow tranche.
                    toast(
                      `${textValue(action.label, "Suggested action")} staged for review — no metadata was changed.`,
                    )
                  }
                  size="sm"
                  title={textValue(action.detail) || "Review the work item evidence before making a metadata change."}
                  variant="tertiary"
                >
                  {textValue(action.label, "Review suggested action")}
                </Button>
              ))}
            </div>
          </>
        ) : null}

        <h3>Evidence trail</h3>
        {detailStatus === "loading" ? (
          // Hydration honesty: the trail rides the workbench detail query —
          // never show a definitive "no audit events" while it is in flight.
          <p className="ga-stew-panel-muted">Loading the audit trail…</p>
        ) : (
          <AuditTrail evidenceResolvable={item?.assetInVisibleScope !== false} trail={workItemAuditTrail(item)} />
        )}

        <h3>Comments</h3>
        {detailStatus === "loading" ? (
          <p className="ga-stew-panel-muted">Loading the comment timeline…</p>
        ) : (
          <EvidenceComments comments={comments} />
        )}
      </div>
    </section>
  );
}

export default WorkItemPanel;
