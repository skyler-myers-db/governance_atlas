import "./asset.css";
import { Badge, EntityChip } from "../../components/system";
import { formatUtcInstant, ownerRef } from "./format";

/*
 * AssetTrustHero — the trust verdict block (PRODUCT_BLUEPRINT §3a, priority
 * item 1). Rendered by BOTH the hub page and the peek drawer so the two can
 * never tell different trust stories for the same asset (the WF1
 * three-owners contradiction becomes structurally impossible).
 *
 * Order is the law's priority order: certification (strict) → governance
 * score → CDE → sensitivity → the TWO labeled freshness values → ownership.
 */

/** Strict certification semantics: only the literal "Certified" is good. */
function certificationBadge(certification, hydrating) {
  const value = String(certification || "").trim();
  if (value === "Certified") return <Badge tone="good">Certified</Badge>;
  if (value) return <Badge tone="neutral">{value}</Badge>;
  if (hydrating) return null; // unknown yet — skeleton covers it
  return <Badge tone="muted">Not certified</Badge>;
}

function FreshnessValue({ label, value, hydrating, fallbackReason }) {
  const formatted = formatUtcInstant(value);
  return (
    <div className="ga-asset-fresh-item">
      <span className="ga-asset-fresh-label">{label}</span>
      {formatted ? (
        // Absolute UTC headline, ISO in the tooltip — never a raw ISO
        // headline, never a fake sparkline (teardown P0-4).
        <time className="ga-asset-fresh-value" dateTime={formatted.iso} title={formatted.iso}>
          {formatted.display}
        </time>
      ) : hydrating ? (
        <span className="ga-sys-skeleton ga-asset-fresh-skeleton" aria-hidden="true" />
      ) : (
        <span className="ga-asset-fresh-value is-empty" title={fallbackReason || undefined}>
          —
        </span>
      )}
    </div>
  );
}

function OwnerRole({ role, entry, hydrating = false }) {
  const ref = ownerRef(entry);
  return (
    <div className="ga-asset-owner-role">
      <span className="ga-asset-owner-role-label">{role}</span>
      {ref ? (
        <EntityChip entity={ref} appearance="inline" />
      ) : hydrating ? (
        // Unknown yet — "Unassigned" is a governance claim, not a loading
        // state (Wave-B verifier BLOCK).
        <span className="ga-asset-owner-unassigned" aria-busy="true">…</span>
      ) : (
        <span className="ga-asset-owner-unassigned">Unassigned</span>
      )}
    </div>
  );
}

/**
 * @param {{
 *   asset: any,
 *   freshness: { state?: string, dataUpdatedAt?: string, lastAltered?: string,
 *                labels?: Record<string,string>, message?: string } | null,
 *   ownership: { ucOwner?: any, businessOwner?: any, steward?: any } | null,
 *   hydrating?: boolean,
 *   compact?: boolean,
 * }} props
 */
export function AssetTrustHero({ asset, freshness, ownership, ownershipPending = false, hydrating = false, compact = false }) {
  const coverage = Number(asset?.coverageScore);
  const hasCoverage = Number.isFinite(coverage) && asset?.coverageScore !== null && asset?.coverageScore !== "";
  const sensitivity = String(asset?.sensitivity || "").trim();
  const isCde = asset?.isCde === true;
  const freshnessBusy =
    hydrating || String(freshness?.state || "").toLowerCase() === "loading" || !freshness;
  // Payload-provided labels win so no surface can re-mislabel the semantics
  // (cohesion law 4); the literals below are the same two lawful words.
  const labels = freshness?.labels || {};

  return (
    <section
      className={`ga-asset-verdict ${compact ? "is-compact" : ""}`.trim()}
      aria-label="Trust verdict"
      aria-busy={hydrating || undefined}
    >
      <div className="ga-asset-verdict-chips">
        {certificationBadge(asset?.certification, hydrating)}
        <span className="ga-asset-score" title="Composite governance score from the live inventory.">
          <span className="ga-asset-score-label">Governance score</span>
          <strong className="ga-asset-score-value">
            {hasCoverage ? coverage : hydrating ? "…" : "—"}
          </strong>
        </span>
        {isCde ? (
          // Canonical CDE predicate is criticality-derived (semantics.py);
          // the subtitle must say so, never "tag-governed".
          <Badge tone="warn" className="ga-asset-cde-chip">
            CDE · Criticality-derived
          </Badge>
        ) : null}
        {sensitivity ? <Badge tone="info">{sensitivity}</Badge> : null}
      </div>

      <div className="ga-asset-fresh" aria-label="Freshness">
        <FreshnessValue
          label={labels.dataUpdatedAt || "Data updated"}
          value={freshness?.dataUpdatedAt}
          hydrating={freshnessBusy}
          fallbackReason={freshness?.message || "No data-write timestamp was reported."}
        />
        <FreshnessValue
          label={labels.lastAltered || "Metadata changed"}
          value={freshness?.lastAltered}
          hydrating={freshnessBusy}
          fallbackReason={freshness?.message || "No metadata-change timestamp was reported."}
        />
      </div>

      <div className="ga-asset-owners" aria-label="Ownership">
        <OwnerRole hydrating={hydrating || (ownershipPending && !ownership?.ucOwner)} role="Owner (Unity Catalog)" entry={ownership?.ucOwner} />
        <OwnerRole hydrating={hydrating || (ownershipPending && !ownership?.businessOwner)} role="Business owner" entry={ownership?.businessOwner} />
        <OwnerRole hydrating={hydrating || (ownershipPending && !ownership?.steward)} role="Steward" entry={ownership?.steward} />
      </div>
    </section>
  );
}

export default AssetTrustHero;
