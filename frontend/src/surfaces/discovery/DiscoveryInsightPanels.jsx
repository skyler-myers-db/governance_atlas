import "./discovery.css";
import { Button, EntityChip, SectionCard } from "../../components/system";
import { coveragePercent } from "./discoveryPresentation";

/*
 * Discover accelerator band (Wave C1 port of the legacy bottom panels):
 * Governance Views (live saved-view drills with real client-side counts),
 * High Coverage Assets, and the Atlas AI recommendations card (evidence-
 * backed only — non-authoritative responses are rejected upstream in
 * useDiscoveryAi and never rendered).
 */

const GOVERNANCE_VIEWS = [
  { label: "Needs Owner", view: "Needs owner" },
  { label: "Needs Certification", view: "Needs certification" },
  { label: "Certified Data", view: "Certified" },
  { label: "High Coverage Assets", view: "High coverage" },
];

export function savedViewCountsFor(assets = []) {
  const counts = {
    "All assets": assets.length,
    "Needs attention": 0,
    "Needs owner": 0,
    "Needs certification": 0,
    Certified: 0,
    "High coverage": 0,
  };
  for (const entry of assets) {
    const noOwner = !entry?.owners?.length;
    const noCert = !entry?.certification || entry.certification === "Unassigned";
    const score = Number(entry?.coverageScore || 0);
    if (noOwner) counts["Needs owner"] += 1;
    if (noCert) counts["Needs certification"] += 1;
    if (!noCert) counts.Certified += 1;
    if (score >= 80) counts["High coverage"] += 1;
    if (noOwner || noCert || score < 50) counts["Needs attention"] += 1;
  }
  return counts;
}

export function DiscoveryInsightPanels({
  assets = [],
  savedViewCounts = {},
  onApplyView,
  onPreview,
  ai,
  onAskAtlas,
  atlasAiAvailable = true,
  atlasAiUnavailableReason = "",
}) {
  const highCoverageAssets = [...assets]
    .filter((asset) => coveragePercent(asset) !== null)
    .sort((a, b) => (coveragePercent(b) || 0) - (coveragePercent(a) || 0))
    .slice(0, 3);

  return (
    <div className="ga-disc-insights">
      <SectionCard
        actions={
          <Button onClick={() => onApplyView?.([])} title="Clear live governance filters" variant="tertiary">
            Clear
          </Button>
        }
        title="Governance Views"
      >
        <div className="ga-disc-insight-list">
          {GOVERNANCE_VIEWS.map((view) => (
            <button
              key={view.label}
              onClick={() => onApplyView?.(view.view ? [view.view] : [])}
              type="button"
            >
              <span>{view.label}</span>
              <small>{Number(savedViewCounts[view.view] || 0).toLocaleString()} visible</small>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        actions={
          <Button
            onClick={() => onApplyView?.(["High coverage"])}
            title="Apply the live high-coverage filter"
            variant="tertiary"
          >
            Filter all
          </Button>
        }
        title="High Coverage Assets"
      >
        {highCoverageAssets.length ? (
          <div className="ga-disc-insight-list">
            {highCoverageAssets.map((asset) => (
              <button key={asset.fqn} onClick={() => onPreview?.(asset.fqn)} type="button">
                <span className="ga-disc-insight-asset">
                  <strong>{asset.name}</strong>
                  <small>{asset.domain && asset.domain !== "Unassigned" ? asset.domain : asset.fqn}</small>
                </span>
                <b>{coveragePercent(asset)}%</b>
              </button>
            ))}
          </div>
        ) : (
          <p className="ga-disc-support-copy">
            High-coverage assets appear after live coverage evidence is available.
          </p>
        )}
      </SectionCard>

      <SectionCard
        actions={
          <Button
            aria-label="Run Atlas AI recommendations"
            disabled={ai.loading || !atlasAiAvailable}
            onClick={() => onAskAtlas?.()}
            title={!atlasAiAvailable ? atlasAiUnavailableReason : undefined}
            variant="tertiary"
          >
            {ai.loading ? "Running" : "View all"}
          </Button>
        }
        eyebrow="Beta"
        title="Atlas AI Recommendations"
      >
        {ai.error ? <p className="ga-disc-support-copy">{ai.error}</p> : null}
        {ai.recommendations.length ? (
          <div className="ga-disc-insight-list ga-disc-ai-list">
            {ai.recommendations.slice(0, 3).map((recommendation, index) => {
              const evidence = Array.isArray(recommendation.evidence)
                ? recommendation.evidence[0]
                : null;
              const evidenceId = evidence?.id || "";
              const asset = evidenceId
                ? assets.find((candidate) => candidate.fqn === evidenceId)
                : null;
              const provider =
                recommendation.provider ||
                ai.response?.recommendationsProvider ||
                ai.response?.provider ||
                "AI";
              const authorityLabel =
                ai.response?.authoritative === false || /local-evidence|prototype/i.test(String(provider))
                  ? "Recommendation unavailable without live Genie proof"
                  : "Evidence-backed recommendation from Atlas AI";
              return (
                <div className="ga-disc-ai-recommendation" key={`${recommendation.title || "recommendation"}-${index}`}>
                  <strong>{recommendation.title || "Governance recommendation"}</strong>
                  <small>
                    {recommendation.detail ? `${authorityLabel}: ${recommendation.detail}` : authorityLabel}
                  </small>
                  <span className="ga-disc-ai-recommendation-foot">
                    {asset ? (
                      <EntityChip
                        appearance="inline"
                        entity={{ kind: "asset", fqn: asset.fqn, label: asset.name }}
                      />
                    ) : null}
                    <em>{provider}</em>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ga-disc-support-copy">
            {!atlasAiAvailable
              ? atlasAiUnavailableReason ||
                "Atlas AI recommendations require a configured evidence-backed endpoint."
              : ai.nonAuthoritative
                ? "Atlas AI recommendations unavailable until live evidence-backed provider returns results."
                : ai.unavailableMessage
                  ? ai.unavailableMessage
                  : ai.loading
                    ? "Atlas AI is gathering governed metadata evidence."
                    : "Run Atlas AI to generate evidence-backed recommendations for this result set."}
          </p>
        )}
      </SectionCard>
    </div>
  );
}

export default DiscoveryInsightPanels;
