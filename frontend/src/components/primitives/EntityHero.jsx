import { SurfaceHeader } from "../ShellLayoutPrimitives";
import { InlineStatusBanner } from "../ShellStatePrimitives";
import { AssetTypeIcon } from "./AssetTypeIcon";
import { OwnerAvatarStack } from "./OwnerAvatarStack";

function statusTone(asset) {
  if (!asset?.governanceStatus) return "neutral";
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

export function EntityHero({
  asset,
  identityLine,
  objectType,
  liveDetailStatus,
  detailUnavailable,
  assetDetail,
  linkNotice,
  lineageSurfaceAvailable,
  lineageAccessPending,
  lineageSurfaceUnavailableReason,
  onOpenLineage,
  onOpenGovernance,
  onNavigationStateChange,
  onBack,
}) {
  const heroTitle = (
    <span className="gh-entity-hero-title">
      <AssetTypeIcon asset={asset} size="xl" />
      <span>{asset.name}</span>
    </span>
  );
  return (
    <div className="gh-entity-record-header">
      <SurfaceHeader
        className="gh-entity-record-main"
        eyebrow="Metadata Record"
        identity={identityLine}
        title={heroTitle}
        variant="featured"
        actions={(
          <div className="gh-action-row gh-entity-action-row">
            {Array.isArray(asset.owners) && asset.owners.length ? (
              <OwnerAvatarStack owners={asset.owners} className="gh-entity-owner-stack" />
            ) : null}
            <button
              className="gh-secondary-button"
              disabled={!lineageSurfaceAvailable}
              onClick={() => {
                onNavigationStateChange?.(true, "Opening lineage…");
                onOpenLineage(asset.fqn, "Data Lineage");
              }}
              title={
                lineageAccessPending
                  ? "Checking actor-scoped lineage access for this route."
                  : !lineageSurfaceAvailable
                    ? lineageSurfaceUnavailableReason
                    : undefined
              }
              type="button"
            >
              {lineageAccessPending
                ? "Checking lineage access..."
                : lineageSurfaceAvailable
                  ? "Open Lineage"
                  : "Lineage unavailable"}
            </button>
            <button
              className="gh-secondary-button"
              onClick={() => {
                onNavigationStateChange?.(true, "Opening governance…");
                onOpenGovernance(asset.fqn);
              }}
              type="button"
            >
              Open Governance
            </button>
          </div>
        )}
      >
        <button
          className="gh-tertiary-button gh-inline-link-button gh-entity-record-backlink"
          onClick={() => {
            onNavigationStateChange?.(true, "Returning to discovery…");
            onBack();
          }}
          type="button"
        >
          Back to Discovery
        </button>
        <div className="gh-chip-row">
          {objectType ? <span className="gh-chip gh-chip-soft">{objectType}</span> : null}
          {asset.governanceStatus ? (
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus}
            </span>
          ) : null}
          {liveDetailStatus ? <span className="gh-chip gh-chip-soft">{liveDetailStatus}</span> : null}
          {asset.domain && asset.domain !== "Unassigned" ? (
            <span className="gh-chip gh-chip-soft">{asset.domain}</span>
          ) : null}
          {asset.certification && asset.certification !== "Unassigned" ? (
            <span className="gh-chip gh-chip-soft">{asset.certification}</span>
          ) : null}
          {asset.sensitivity && asset.sensitivity !== "Unassigned" ? (
            <span className="gh-chip gh-chip-soft">{asset.sensitivity}</span>
          ) : null}
        </div>
        {detailUnavailable ? (
          <div className="gh-support-copy">
            {assetDetail.error ||
              "Live record details could not be refreshed right now. Schema, preview, and lineage sections may be incomplete."}
          </div>
        ) : assetDetail.loading ? (
          <div className="gh-support-copy">Refreshing live record details...</div>
        ) : null}
        {linkNotice ? <InlineStatusBanner message={linkNotice} title="Navigation limited" /> : null}
      </SurfaceHeader>
    </div>
  );
}
