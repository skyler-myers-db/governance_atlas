import "../asset.css";
import { Badge, LoadingState, SectionCard, UnavailableState } from "../../../components/system";

/*
 * Access tab = access content ONLY (teardown P1-8 killed the "Composite
 * state / Loaded sections" developer-telemetry panel). Everything here comes
 * from the /360 access block, which shares its core with /access-explain so
 * the two can never disagree: auth mode, visibility scope, honest grants
 * unavailability WITH the reason, remediation steps, and real deep links.
 */

export function AccessTab({ access }) {
  const state = String(access?.state || "").toLowerCase();
  if (!access || state === "loading") {
    return (
      <SectionCard title="Access">
        <LoadingState variant="card" lines={3} />
      </SectionCard>
    );
  }
  if (state !== "available") {
    return (
      <SectionCard title="Access">
        <UnavailableState
          title="Access context unavailable"
          reason={access?.message || "No access context was returned for this asset."}
        />
      </SectionCard>
    );
  }

  const remediation = Array.isArray(access.remediation) ? access.remediation : [];
  const deepLinks = access.deepLinks || {};
  const grants = access.grants || {};

  return (
    <div className="ga-asset-tab-grid">
      <SectionCard title="Authorization">
        <dl className="ga-asset-facts">
          <div className="ga-asset-fact">
            <dt>Auth mode</dt>
            <dd>
              <Badge tone={access.authMode === "obo" ? "good" : "info"}>{access.authMode || "unknown"}</Badge>
            </dd>
          </div>
          <div className="ga-asset-fact">
            <dt>Visibility scope</dt>
            <dd>{access.visibilityScope || "—"}</dd>
          </div>
          <div className="ga-asset-fact">
            <dt>Acting identity</dt>
            <dd>{access.actorEmail || "—"}</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="Grants">
        {String(grants.state || "").toLowerCase() === "available" ? (
          // No grants source exists today; this branch is future-proofing for
          // a real grants payload — never an empty fabricated table.
          <p className="ga-asset-description">{grants.summary || ""}</p>
        ) : (
          <UnavailableState
            title="Grants not collected"
            reason={
              grants.reason ||
              "Per-principal Unity Catalog grants are not collected by the app; grant truth lives in Catalog Explorer."
            }
          />
        )}
        {deepLinks.catalogExplorer ? (
          <p className="ga-asset-deeplink-row">
            <a
              className="ga-asset-deeplink"
              href={deepLinks.catalogExplorer}
              target="_blank"
              rel="noreferrer"
            >
              Open in Catalog Explorer
            </a>
          </p>
        ) : null}
      </SectionCard>

      {remediation.length ? (
        <SectionCard title="Remediation" subtitle="Steps to widen the current access scope.">
          <ul className="ga-asset-remediation-list">
            {remediation.map((item, index) => (
              <li key={item.label || index}>
                <strong>{item.label}</strong>
                {item.detail ? <p>{item.detail}</p> : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}

export default AccessTab;
