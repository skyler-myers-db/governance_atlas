import { useAssetCustomProperties } from "../../hooks/useAssetCustomProperties";
import { EmptyStateBlock, SkeletonBlock } from "../ShellStatePrimitives";

/**
 * Phase 8 — persisted custom property assignments for an asset.
 *
 * Complements the UC-derived `asset.customProperties` list with the
 * admin-governed typed properties stored in custom_property_assignments
 * (see migration v11).
 */
export function CustomPropertiesPanel({ assetFqn, fallback = [] }) {
  const { loading, refreshing, error, assignments } = useAssetCustomProperties(assetFqn);
  const hasPersisted = assignments.length > 0;
  if (loading) {
    return (
      <div className="gh-cp-panel">
        <SkeletonBlock lines={4} message="Loading custom properties…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="gh-cp-panel">
        <EmptyStateBlock title="Custom properties unavailable" message={error} />
      </div>
    );
  }
  if (!hasPersisted && (!fallback || fallback.length === 0)) {
    return (
      <div className="gh-cp-panel">
        <EmptyStateBlock
          title="No custom properties recorded"
          message="Custom property definitions are maintained by admins. Once assigned to this asset they will appear here."
        />
      </div>
    );
  }
  return (
    <div className="gh-cp-panel">
      {refreshing ? <div className="gh-support-copy">Refreshing…</div> : null}
      {hasPersisted ? (
        <div className="gh-cp-list">
          {assignments.map((assignment) => (
            <CustomPropertyRow key={assignment.assignment_id || assignment.assignmentId} assignment={assignment} />
          ))}
        </div>
      ) : null}
      {!hasPersisted && fallback.length ? (
        <div className="gh-cp-fallback">
          <div className="gh-support-copy gh-cp-fallback-label">UC property hints</div>
          <div className="gh-cp-list">
            {fallback.map((item, index) => {
              const label = item.name || item.key || item.label || `Property ${index + 1}`;
              return (
                <div className="gh-cp-row" key={`${label}-${index}`}>
                  <div className="gh-cp-row-label">{label}</div>
                  <div className="gh-cp-row-value">{String(item.value ?? "—")}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CustomPropertyRow({ assignment }) {
  const displayName = assignment.display_name || assignment.property_key || "Untitled property";
  const dataType = assignment.data_type || "string";
  const value = assignment.value;
  const display = Array.isArray(value)
    ? value.join(", ")
    : value === null || value === undefined
      ? "—"
      : String(value);
  return (
    <div className="gh-cp-row">
      <div className="gh-cp-row-label">
        <span>{displayName}</span>
        <span className="gh-chip gh-chip-soft">{dataType}</span>
      </div>
      <div className="gh-cp-row-value">{display}</div>
    </div>
  );
}
