import { useState } from "react";
import { patchAssetDescription } from "../../lib/api";
import { MarkdownBlock } from "./MarkdownBlock";

/**
 * Inline-editable description with hover-edit + save/cancel.
 *
 * UX target: OpenMetadata lets stewards hover a description to see a
 * pencil icon, click to edit in place with a textarea, save with
 * Cmd/Ctrl+Enter, cancel with Escape. We mirror that.
 */
export function InlineEditableDescription({ assetFqn, description, onSaved, canEdit = true }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startEdit = () => {
    setDraft(description || "");
    setError("");
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError("");
  };
  const save = async () => {
    if (!assetFqn) return;
    setBusy(true);
    setError("");
    try {
      await patchAssetDescription(assetFqn, draft);
      setEditing(false);
      onSaved?.(draft);
    } catch (err) {
      // 403 from the permission-denied path surfaces a user-friendly
      // message; other 4xx/5xx fall back to the raw detail.
      const status = err?.status;
      const msg =
        status === 403
          ? err?.message || "You don't have write access to this asset. Ask a steward with MODIFY privilege."
          : err?.message || "Failed to save description.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="gh-inline-edit">
        <textarea
          aria-label="Edit description"
          autoFocus
          className="gh-input gh-inline-edit-textarea"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder="Describe the asset (markdown supported — bold / italic / lists / links)."
          rows={Math.min(12, Math.max(4, draft.split("\n").length))}
          value={draft}
        />
        {error ? <div className="gh-inline-edit-error">{error}</div> : null}
        <div className="gh-inline-edit-actions">
          <button className="gh-primary-button" disabled={busy} onClick={save} type="button">
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="gh-secondary-button" disabled={busy} onClick={cancel} type="button">
            Cancel
          </button>
          <span className="gh-support-copy gh-inline-edit-hint">
            ⌘⏎ to save, Esc to cancel
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="gh-inline-edit-view">
      <MarkdownBlock
        className="gh-entity-description"
        source={description}
        fallback={
          <div className="gh-support-copy">
            No description is available for this asset yet.
          </div>
        }
      />
      {canEdit ? (
        <button
          aria-label="Edit description"
          className="gh-inline-edit-pencil"
          onClick={startEdit}
          title="Edit description"
          type="button"
        >
          ✎
        </button>
      ) : null}
    </div>
  );
}
