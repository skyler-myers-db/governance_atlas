import { useAssetQuality } from "../../hooks/useAssetQuality";
import { EmptyStateBlock, SkeletonBlock } from "../ShellStatePrimitives";

const OUTCOME_TONES = {
  passed: "positive",
  failed: "danger",
  errored: "danger",
  skipped: "neutral",
};

/**
 * Phase 10 — persisted quality runs + results for an asset.
 * Paints summary counts + per-result rows from /api/assets/:fqn/quality.
 */
export function QualityPanel({ assetFqn }) {
  const { loading, error, runs, results, summary, databricksMonitoring } = useAssetQuality(assetFqn);
  if (loading) {
    return <SkeletonBlock lines={4} message="Loading quality results…" />;
  }
  if (error) {
    return <EmptyStateBlock title="Quality unavailable" message={error} />;
  }
  const monitoringRows = Array.isArray(databricksMonitoring?.rows) ? databricksMonitoring.rows : [];
  const monitoringSummary = databricksMonitoring?.summary || {};
  const monitoringAvailable = databricksMonitoring?.state === "available" || monitoringRows.length > 0;
  if (!results.length && !runs.length && !monitoringAvailable) {
    return (
      <EmptyStateBlock
        title="No quality evidence recorded"
        message={databricksMonitoring?.state === "empty"
          ? "Databricks data quality monitoring returned no result rows for this table, and Atlas has no persisted quality-run results."
          : "Once Databricks monitoring or Atlas quality test cases have executed against this entity, pass/fail outcomes and redaction-gated evidence will show here."}
      />
    );
  }
  const totalCounted = (summary.passed || 0) + (summary.failed || 0) + (summary.errored || 0) + (summary.skipped || 0);
  return (
    <div className="gh-quality-panel">
      <div className="gh-quality-summary">
        <QualityBucket
          label="Databricks DQ"
          value={monitoringAvailable ? monitoringSummary.healthStatus || "Observed" : "Unavailable"}
          total={0}
          tone={monitoringTone(monitoringSummary.healthStatus)}
        />
        <QualityBucket label="Passed" value={summary.passed || 0} total={totalCounted} tone="positive" />
        <QualityBucket label="Failed" value={summary.failed || 0} total={totalCounted} tone="danger" />
        <QualityBucket label="Errored" value={summary.errored || 0} total={totalCounted} tone="danger" />
        <QualityBucket label="Skipped" value={summary.skipped || 0} total={totalCounted} tone="neutral" />
      </div>
      {monitoringAvailable ? (
        <div className="gh-quality-runs">
          <div className="gh-panel-title">Databricks monitoring</div>
          <div className="gh-quality-runs-list">
            {monitoringRows.slice(0, 5).map((row, index) => (
              <div className="gh-quality-runs-item" key={`${row.event_time || "dq"}-${index}`}>
                <div className="gh-quality-runs-ts">{row.event_time || "—"}</div>
                <div className="gh-quality-runs-trigger">
                  Freshness {row.freshness_status || "Unavailable"} · Completeness {row.completeness_status || "Unavailable"}
                </div>
                <div>
                  <span className={`gh-chip gh-chip-tone-${monitoringTone(row.status)}`}>
                    {row.status || "Unknown"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="gh-support-copy">
            Source: <code>{databricksMonitoring.source || "system.data_quality_monitoring.table_results"}</code>
          </p>
        </div>
      ) : null}
      {results.length ? (
        <div className="gh-quality-results">
          <div className="gh-panel-title">Latest results</div>
          <div className="gh-quality-results-table">
            <div className="gh-quality-results-head">
              <div>Executed</div>
              <div>Case</div>
              <div>Column</div>
              <div>Outcome</div>
              <div>Severity</div>
              <div>Metric</div>
            </div>
            {results.slice(0, 25).map((result) => {
              const outcome = String(result.outcome || "").toLowerCase();
              const tone = OUTCOME_TONES[outcome] || "neutral";
              return (
                <div className="gh-quality-results-row" key={result.result_id || result.resultId}>
                  <div className="gh-quality-ts">{result.executed_at || result.executedAt || "—"}</div>
                  <div className="gh-quality-case">{result.case_id || result.caseId || "—"}</div>
                  <div>{result.column_name || result.columnName || "—"}</div>
                  <div>
                    <span className={`gh-chip gh-chip-tone-${tone}`}>{result.outcome || "—"}</span>
                  </div>
                  <div className="gh-support-copy">{result.severity || "—"}</div>
                  <div className="gh-quality-metric">
                    {typeof result.metric_value === "number" ? result.metric_value.toFixed(3) : "—"}
                    {typeof result.threshold_value === "number" ? (
                      <span className="gh-support-copy"> vs {result.threshold_value.toFixed(3)}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {runs.length ? (
        <div className="gh-quality-runs">
          <div className="gh-panel-title">Recent runs</div>
          <div className="gh-quality-runs-list">
            {runs.slice(0, 10).map((run) => (
              <div className="gh-quality-runs-item" key={run.run_id || run.runId}>
                <div className="gh-quality-runs-ts">{run.started_at || run.startedAt || "—"}</div>
                <div className="gh-quality-runs-trigger">{run.trigger || "manual"}</div>
                <div>
                  <span className={`gh-chip gh-chip-tone-${runToneFromStatus(run.status)}`}>
                    {run.status || "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QualityBucket({ label, value, total, tone }) {
  const pct = total > 0 && typeof value === "number" ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`gh-quality-bucket gh-quality-bucket-${tone}`}>
      <div className="gh-quality-bucket-value">{value}</div>
      <div className="gh-quality-bucket-label">{label}</div>
      {total > 0 ? <div className="gh-quality-bucket-pct">{pct}%</div> : null}
    </div>
  );
}

function monitoringTone(status) {
  const text = String(status || "").toLowerCase();
  if (text === "healthy") return "positive";
  if (text === "unhealthy" || text === "error") return "danger";
  if (text === "training" || text === "unknown") return "warning";
  return "neutral";
}

function runToneFromStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "succeeded") return "positive";
  if (s === "failed") return "danger";
  if (s === "partial") return "warning";
  return "neutral";
}
