import { EntityChip, LoadingState, SectionCard, UnavailableState } from "../../../components/system";
import { numberOrNull, numberValue, percentValue, stateText } from "../adminPresentation";

/*
 * Control Center · Policy tab (Wave C6). Renders the backed policy-exceptions
 * signal (an AVAILABLE zero when sources respond — consistent with the
 * Command Center, never "Unavailable") plus the API's honest-unavailable
 * policy library/enforcement cards with their own reason strings. Coverage
 * rows that carry METADATA coverage retitle the panel honestly instead of
 * implying policy-enforcement data exists.
 */

function PolicyRequirementCards({ cards, hydrating }) {
  return (
    <SectionCard
      className="ga-admin-card"
      subtitle={
        cards.some((card) => card.state === "available")
          ? "Backed policy signals; unsupported checks stay marked unavailable"
          : "Policy diagnostics unavailable"
      }
      title="Policy"
    >
      {!cards.length && hydrating ? (
        <LoadingState label="Loading policy diagnostics" variant="tile" />
      ) : cards.length ? (
        <div aria-label="Policy requirement cards" className="ga-admin-policy-grid" role="group">
          {cards.map((card) => (
            <article
              className={`ga-admin-policy-card ${card.state === "available" ? "" : "is-unavailable"}`.trim()}
              key={card.id}
            >
              <small>{card.label}</small>
              <strong>{card.state === "available" ? numberValue(card.value) : "Unavailable"}</strong>
              {card.reason ? <span>{card.reason}</span> : null}
            </article>
          ))}
        </div>
      ) : (
        <UnavailableState
          reason="No policy diagnostics were reported by the control-center payload."
          title="Policy diagnostics unavailable"
        />
      )}
    </SectionCard>
  );
}

function CoveragePanel({ policies, hydrating }) {
  // When every row carries metadata coverage (no policy-enforcement source
  // exists), retitle the panel honestly instead of implying enforcement data.
  const metadataScoped = policies.length > 0 && policies.every((policy) => policy.coverageKind === "metadata");
  const panelTitle = metadataScoped ? "Metadata coverage by domain" : "Policy coverage";
  return (
    <SectionCard
      className="ga-admin-card"
      subtitle={
        metadataScoped
          ? "Metadata completeness per domain — not policy-enforcement coverage"
          : policies.some((policy) => numberOrNull(policy.value) != null)
            ? "Coverage reported by diagnostics"
            : "Policy coverage unavailable"
      }
      title={panelTitle}
    >
      {metadataScoped ? (
        // Audit G4: make the enforcement gap explicit for auditors instead of
        // leaving it implied by the subtitle. There is no policy-enforcement
        // data source in the workspace, so we do NOT fabricate "control X was
        // enforced" evidence — we show metadata completeness and point to the
        // real, immutable control/audit evidence.
        <p className="ga-admin-coverage-note">
          Policy-enforcement evidence is not yet wired to a source, so this shows
          metadata completeness per domain — not proof a control was enforced.
          For enforced-control and grant evidence, see the Evidence surface.
        </p>
      ) : null}
      {!policies.length && hydrating ? (
        <LoadingState label="Loading coverage rows" variant="card" />
      ) : policies.length ? (
        <ul aria-label={`${panelTitle} rows`} className="ga-admin-coverage-list">
          {policies.map((policy) => {
            const numeric = numberOrNull(policy.value);
            const available = numeric != null;
            return (
              <li className={available ? "" : "is-unavailable"} key={policy.id}>
                <span className="ga-admin-coverage-label">
                  {/* Domain mentions are real anchors into Discover (LAW);
                      non-domain rule rows stay labeled text. */}
                  {policy.domain ? (
                    <EntityChip appearance="inline" entity={{ kind: "domain", name: policy.domain, label: policy.label }} />
                  ) : (
                    policy.label
                  )}
                </span>
                <strong>{available ? percentValue(numeric) : stateText(policy.status)}</strong>
                {policy.note ? <em className="ga-admin-coverage-note">{policy.note}</em> : null}
                <i aria-hidden="true" className="ga-admin-coverage-bar">
                  <b style={{ width: available ? `${Math.max(0, Math.min(100, numeric))}%` : "0%" }} />
                </i>
              </li>
            );
          })}
        </ul>
      ) : (
        <UnavailableState
          reason="No backed policy-coverage rows are available yet."
          title="Coverage rows unavailable"
        />
      )}
    </SectionCard>
  );
}

export function PolicyTab({ policyCards, policies, hydrating }) {
  return (
    <div className="ga-admin-tab-body" id="ga-admin-panel-policy" role="tabpanel">
      <PolicyRequirementCards cards={policyCards} hydrating={hydrating} />
      <CoveragePanel hydrating={hydrating} policies={policies} />
    </div>
  );
}

export default PolicyTab;
