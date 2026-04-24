import { useEffect, useMemo, useState } from "react";
import { MetadataChip, StatusBadge } from "./primitives";
import {
  SurfaceHeader,
  SurfaceTabs,
  SurfaceWorkbench,
  SurfaceWorkbenchMain,
} from "./ShellLayoutPrimitives";
import { useGapAnalysis as defaultUseGapAnalysis } from "../hooks/useGapAnalysis";

const LANE_META = {
  ownership: {
    label: "Ownership",
    tileLabel: "Ownership gaps",
    emptyHint: "No assets missing owners — keep it up.",
    tileTone: "warn",
    tileHint: "Assets with zero owner entries",
  },
  policy: {
    label: "Policy",
    tileLabel: "Policy gaps",
    emptyHint: "Every asset carries a classification, domain, and tier.",
    tileTone: "warn",
    tileHint: "Assets missing classification + sensitivity + domain + tier",
  },
  freshness: {
    label: "Freshness",
    tileLabel: "Freshness blind spots",
    emptyHint: "All visible assets have a recent freshness signal.",
    tileTone: "warn",
    tileHint: "No last_observed_at and no recent freshness pass",
  },
  quality: {
    label: "Quality",
    tileLabel: "Quality incidents",
    emptyHint: "No failing or errored quality runs in the last 7 days.",
    tileTone: "bad",
    tileHint: "Assets with failed or errored quality runs (last 7 days)",
  },
};

const LANE_FALLBACK_ORDER = ["ownership", "policy", "freshness", "quality"];

function tileCountFor(tiles, lane) {
  const key = {
    ownership: "ownershipGaps",
    policy: "policyGaps",
    freshness: "freshnessGaps",
    quality: "qualityIncidents",
  }[lane];
  return Number(tiles?.[key] ?? 0) || 0;
}

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.max(0, Math.trunc(n)).toLocaleString();
}

function GapTile({ lane, count, total, onClick, active }) {
  const meta = LANE_META[lane] || {};
  return (
    <button
      aria-pressed={Boolean(active)}
      className={`gh-insights-tile ${active ? "is-active" : ""}`.trim()}
      onClick={onClick}
      type="button"
      data-lane={lane}
    >
      <div className="gh-insights-tile-head">
        <div className="gh-insights-tile-eyebrow">{meta.tileLabel}</div>
        {count > 0 ? (
          <StatusBadge
            ariaLabel={`${count} ${meta.tileLabel}`}
            label={String(count)}
            tone={count > 0 ? meta.tileTone || "warn" : "neutral"}
          />
        ) : (
          <StatusBadge ariaLabel="healthy" label="0" tone="good" />
        )}
      </div>
      <div className="gh-insights-tile-value">{formatCount(count)}</div>
      <div className="gh-insights-tile-hint">{meta.tileHint}</div>
      {Number.isFinite(Number(total)) && Number(total) > 0 ? (
        <div className="gh-insights-tile-total">of {formatCount(total)} visible</div>
      ) : null}
    </button>
  );
}

function GapTable({ rows, lane }) {
  const meta = LANE_META[lane] || {};
  if (!rows || rows.length === 0) {
    return (
      <div className="gh-insights-empty" role="status">
        <div className="gh-insights-empty-title">
          No current gaps in this lane
        </div>
        <div className="gh-insights-empty-hint">
          {meta.emptyHint || "Nothing to triage here right now."}
        </div>
      </div>
    );
  }
  return (
    <table
      aria-label={`${meta.label || lane} gap rows`}
      className="gh-insights-lane-table"
    >
      <thead>
        <tr>
          <th scope="col">Asset</th>
          <th scope="col">FQN</th>
          <th scope="col">Reason</th>
          <th scope="col" aria-label="Remediation">
            Action
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.assetFqn} data-lane={lane}>
            <th scope="row" className="gh-insights-lane-asset-cell">
              <div className="gh-insights-lane-asset-name">{row.assetName}</div>
              <div className="gh-insights-lane-asset-type">
                <MetadataChip
                  soft
                  label={row.objectType || "Asset"}
                  tone="neutral"
                />
              </div>
            </th>
            <td className="gh-insights-lane-fqn-cell">
              <code>{row.assetFqn}</code>
            </td>
            <td className="gh-insights-lane-reason-cell">{row.gapReason}</td>
            <td className="gh-insights-lane-action-cell">
              <a
                className="gh-insights-lane-action-link"
                href={row.remediation?.href || `/governance?lane=${lane}&asset=${encodeURIComponent(row.assetFqn)}`}
                data-action={row.remediation?.action || ""}
              >
                {row.remediation?.label || "Open"} →
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A9.5 Insights surface — 4 tiles + 4 lane tabs pulling from
 * /api/insights/gap-analysis. Keeps the shell primitives (SurfaceHeader,
 * SurfaceWorkbench, SurfaceTabs) consistent with every other surface.
 */
export function InsightsWorkspace({
  onNavigate,
  onSurfaceReady,
  limit = 200,
  initialLane = "ownership",
  /** Optional: let the parent inject a mocked hook result for tests. */
  gapAnalysisOverride = null,
  /** Optional hook override so tests can bypass the QueryClient. */
  useGapAnalysisImpl = defaultUseGapAnalysis,
}) {
  // Tests may pass `gapAnalysisOverride` to avoid mounting the
  // QueryClient. We still need to call a hook unconditionally to
  // satisfy the Rules of Hooks, so use a no-op stub when override is
  // present.
  const hookImpl = gapAnalysisOverride ? () => ({}) : useGapAnalysisImpl;
  const liveGapAnalysis = hookImpl({ enabled: !gapAnalysisOverride, limit });
  const gapAnalysis = gapAnalysisOverride || liveGapAnalysis;

  const lanesOrder = useMemo(() => {
    const order = Array.isArray(gapAnalysis?.lanesOrder) && gapAnalysis.lanesOrder.length
      ? gapAnalysis.lanesOrder
      : LANE_FALLBACK_ORDER;
    return order.filter((lane) => LANE_META[lane]);
  }, [gapAnalysis?.lanesOrder]);

  const [activeLane, setActiveLane] = useState(() =>
    lanesOrder.includes(initialLane) ? initialLane : lanesOrder[0] || "ownership",
  );

  useEffect(() => {
    if (!lanesOrder.includes(activeLane)) {
      setActiveLane(lanesOrder[0] || "ownership");
    }
  }, [activeLane, lanesOrder]);

  useEffect(() => {
    if (!gapAnalysis.isLoading) {
      onSurfaceReady?.();
    }
  }, [gapAnalysis.isLoading, onSurfaceReady]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previous = document.title;
    document.title = "Insights — Governance Hub";
    return () => {
      document.title = previous;
    };
  }, []);

  const tiles = gapAnalysis.tiles || {};
  const lanes = gapAnalysis.lanes || {};

  const surfaceState = gapAnalysis.error
    ? "error"
    : gapAnalysis.isLoading
      ? "loading"
      : "ready";

  const totalAssets = Number(tiles.totalAssets ?? 0) || 0;
  const headerMeta = [
    { key: "total", content: `${formatCount(totalAssets)} visible assets` },
  ];
  if (!gapAnalysis.qualitySignalAvailable) {
    headerMeta.push({
      key: "quality-degraded",
      content: "Quality ledger unavailable",
    });
  }

  const laneTabs = lanesOrder.map((lane) => ({
    key: lane,
    label: `${LANE_META[lane]?.label || lane} (${tileCountFor(tiles, lane)})`,
  }));

  return (
    <section
      aria-label="Governance insights"
      className="gh-workspace gh-insights-workspace"
      data-surface="insights"
      data-state={surfaceState}
    >
      <SurfaceHeader
        eyebrow="Governance insights"
        title="Gap analysis across your estate"
        meta={headerMeta}
        actions={(
          <button
            className="gh-tertiary-button gh-inline-link-button"
            onClick={() => onNavigate?.("governance")}
            type="button"
          >
            Open Governance →
          </button>
        )}
      >
        <p className="gh-support-copy">
          One pane across the four gap lanes the stewardship team works
          weekly: ownership, policy, freshness, and data-quality incidents.
          Every row deep-links into the Governance workbench with the right
          lane preselected.
        </p>
      </SurfaceHeader>

      <SurfaceWorkbench className="gh-insights-surface-workbench">
        <SurfaceWorkbenchMain className="gh-insights-main-pane" dense>
          {gapAnalysis.error ? (
            <div className="gh-insights-error" role="alert">
              <strong>Insights unavailable.</strong> {gapAnalysis.error}
            </div>
          ) : null}
          {gapAnalysis.oboScopeFallback ? (
            <div
              aria-live="polite"
              className="gh-insights-degraded-banner"
              role="status"
            >
              <div>
                <strong>Showing app-principal view.</strong>{" "}
                {gapAnalysis.oboFallbackReason ||
                  "The forwarded user token is missing the `sql` scope; insights are computed from the app-principal view of the catalog."}
              </div>
              <button
                className="gh-tertiary-button gh-inline-link-button"
                disabled={gapAnalysis.refreshing}
                onClick={() => gapAnalysis.refreshActorScope?.()}
                type="button"
              >
                {gapAnalysis.refreshing ? "Retrying…" : "Retry with actor scope"}
              </button>
            </div>
          ) : null}

          <section
            aria-label="Gap tiles"
            className="gh-insights-tiles"
            role="group"
          >
            {LANE_FALLBACK_ORDER.map((lane) => (
              <GapTile
                active={activeLane === lane}
                count={tileCountFor(tiles, lane)}
                key={lane}
                lane={lane}
                onClick={() => setActiveLane(lane)}
                total={totalAssets}
              />
            ))}
          </section>

          <section aria-label="Gap lanes" className="gh-insights-lanes">
            <SurfaceTabs
              ariaLabel="Gap lanes"
              activeKey={activeLane}
              items={laneTabs}
              onChange={(nextKey) => setActiveLane(nextKey)}
              variant="segment"
              className="gh-insights-lane-tabs"
            />
            <div
              aria-live="polite"
              className="gh-insights-lane-body"
              data-lane={activeLane}
            >
              {gapAnalysis.isLoading ? (
                <div className="gh-insights-empty" role="status">
                  <div className="gh-insights-empty-title">Loading…</div>
                  <div className="gh-insights-empty-hint">
                    Computing the cross-estate gap snapshot.
                  </div>
                </div>
              ) : (
                <GapTable
                  lane={activeLane}
                  rows={Array.isArray(lanes[activeLane]) ? lanes[activeLane] : []}
                />
              )}
            </div>
          </section>
        </SurfaceWorkbenchMain>
      </SurfaceWorkbench>
    </section>
  );
}

export default InsightsWorkspace;
