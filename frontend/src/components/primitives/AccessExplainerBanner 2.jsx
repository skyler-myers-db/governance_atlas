import { useAccessExplain } from "../../hooks/useAccessExplain";

/**
 * Phase 14 — "Why can't I access this?" inline surface.
 *
 * Only renders when remediation steps are present (i.e. the actor
 * hits an OBO gap or has no identity). On a fully-authorized session
 * returns null so it doesn't clutter the hero.
 */
export function AccessExplainerBanner({ assetFqn = "" }) {
  const { loading, data } = useAccessExplain(assetFqn, { enabled: true });
  if (loading) return null;
  const remediation = Array.isArray(data?.remediation) ? data.remediation : [];
  if (!remediation.length) return null;
  const deepLinks = data?.deepLinks || {};
  return (
    <div className="gh-access-explainer" role="status" aria-live="polite">
      <div className="gh-access-explainer-head">
        <div className="gh-access-explainer-title">Why you might be missing data here</div>
        <div className="gh-access-explainer-mode">
          <span className="gh-chip gh-chip-soft">{data?.authMode || "unknown mode"}</span>
          <span className="gh-chip gh-chip-soft">{data?.visibilityScope || "unknown scope"}</span>
        </div>
      </div>
      <ul className="gh-access-explainer-list">
        {remediation.map((item) => (
          <li className="gh-access-explainer-item" key={item.label}>
            <div className="gh-access-explainer-label">{item.label}</div>
            <div className="gh-access-explainer-detail">{item.detail}</div>
          </li>
        ))}
      </ul>
      {(deepLinks.catalogExplorer || deepLinks.jobs || deepLinks.queryHistory) ? (
        <div className="gh-access-explainer-links">
          {deepLinks.catalogExplorer ? (
            <a className="gh-inline-link" href={deepLinks.catalogExplorer} rel="noreferrer" target="_blank">
              Open in Catalog Explorer
            </a>
          ) : null}
          {deepLinks.jobs ? (
            <a className="gh-inline-link" href={deepLinks.jobs} rel="noreferrer" target="_blank">
              View Jobs
            </a>
          ) : null}
          {deepLinks.queryHistory ? (
            <a className="gh-inline-link" href={deepLinks.queryHistory} rel="noreferrer" target="_blank">
              Query history
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
