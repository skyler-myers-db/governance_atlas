import { useAssetProfile } from "../../hooks/useAssetProfile";
import { EmptyStateBlock, SkeletonBlock } from "../ShellStatePrimitives";

/**
 * Phase 8 — persisted profile + column metrics for an asset.
 * Paints the most recent profile_run from /api/assets/:fqn/profile.
 */
export function ProfilePanel({ assetFqn }) {
  const { loading, error, run, tableMetric, columnMetrics, databricksProfile } = useAssetProfile(assetFqn);
  if (loading) {
    return <SkeletonBlock lines={5} message="Loading profile metrics…" />;
  }
  if (error) {
    return <EmptyStateBlock title="Profile unavailable" message={error} />;
  }
  const metricRows = Array.isArray(databricksProfile?.rows) ? databricksProfile.rows : [];
  const monitor = databricksProfile?.monitor || {};
  const hasConfiguredMonitor = monitor.configured === true || Boolean(monitor.profileMetricsTableName || monitor.driftMetricsTableName);
  const hasDatabricksProfile = databricksProfile?.state === "available" && (metricRows.length > 0 || hasConfiguredMonitor);
  if (!run && !hasDatabricksProfile) {
    return (
      <EmptyStateBlock
        title="No profile runs recorded"
        message={databricksProfile?.state === "empty"
          ? "Databricks did not return a data profiling monitor or default metric tables for this table, and Atlas has no persisted profile run."
          : "Once a profile run has been recorded for this entity, row counts, null fractions, distinct-value estimates, and column-level metrics will show here."}
      />
    );
  }
  return (
    <div className="gh-profile-panel">
      <div className="gh-profile-summary">
        <ProfileStat
          label="Databricks profile"
          value={hasDatabricksProfile ? monitor.status || "Observed" : "Unavailable"}
        />
        <ProfileStat
          label="Rows"
          value={tableMetric?.row_count ?? tableMetric?.rowCount ?? "—"}
        />
        <ProfileStat
          label="Bytes"
          value={formatBytes(tableMetric?.size_bytes ?? tableMetric?.sizeBytes)}
        />
        <ProfileStat
          label="Partitions"
          value={tableMetric?.partition_count ?? tableMetric?.partitionCount ?? "—"}
        />
        <ProfileStat
          label="Distinct keys"
          value={tableMetric?.distinct_keys ?? tableMetric?.distinctKeys ?? "—"}
        />
        <ProfileStat label="Status" value={run?.status || "—"} />
        <ProfileStat label="Started" value={run?.startedAt || "—"} />
      </div>

      {hasDatabricksProfile ? (
        <div className="gh-profile-columns">
          <div className="gh-panel-title">Databricks metric tables</div>
          <div className="gh-profile-columns-table">
            <div className="gh-profile-columns-head">
              <div>Table</div>
              <div>Schema</div>
              <div>Type</div>
              <div>Owner</div>
              <div>Last altered</div>
            </div>
            {metricRows.length ? (
              metricRows.map((metric) => (
                <div className="gh-profile-columns-row" key={`${metric.table_catalog}.${metric.table_schema}.${metric.table_name}`}>
                  <div className="gh-profile-col-name">{metric.table_name || "—"}</div>
                  <div>{[metric.table_catalog, metric.table_schema].filter(Boolean).join(".") || "—"}</div>
                  <div>{metric.table_type || "—"}</div>
                  <div>{metric.table_owner || "—"}</div>
                  <div className="gh-profile-col-range">{metric.last_altered || metric.created || "—"}</div>
                </div>
              ))
            ) : (
              <div className="gh-profile-columns-row">
                <div className="gh-profile-col-name">{monitor.profileMetricsTableName || "Monitor configured"}</div>
                <div>{monitor.driftMetricsTableName || "Metric table visibility unavailable"}</div>
                <div>Monitor</div>
                <div>{monitor.status || "Configured"}</div>
                <div className="gh-profile-col-range">{monitor.latestMonitorFailureMessage || "Metric table rows not visible to this actor."}</div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {columnMetrics.length ? (
        <div className="gh-profile-columns">
          <div className="gh-panel-title">Columns</div>
          <div className="gh-profile-columns-table">
            <div className="gh-profile-columns-head">
              <div>Column</div>
              <div>Type</div>
              <div>Nulls</div>
              <div>Distinct</div>
              <div>Range</div>
            </div>
            {columnMetrics.map((metric) => (
              <ProfileColumnRow key={metric.metric_id || metric.metricId || metric.column_name} metric={metric} />
            ))}
          </div>
        </div>
      ) : (
        <EmptyStateBlock
          title="No column metrics recorded"
          message="The latest profile run recorded no column-level metrics."
        />
      )}
    </div>
  );
}

function ProfileStat({ label, value }) {
  return (
    <div className="gh-profile-stat">
      <div className="gh-profile-stat-label">{label}</div>
      <div className="gh-profile-stat-value">{value ?? "—"}</div>
    </div>
  );
}

function ProfileColumnRow({ metric }) {
  const nullFraction = metric.null_fraction ?? metric.nullFraction;
  const distinctFraction = metric.distinct_fraction ?? metric.distinctFraction;
  const fmt = (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");
  const rangeParts = [metric.min_value ?? metric.minValue, metric.max_value ?? metric.maxValue].filter(Boolean);
  return (
    <div className="gh-profile-columns-row">
      <div className="gh-profile-col-name">{metric.column_name || metric.columnName || "—"}</div>
      <div className="gh-profile-col-type">{metric.data_type || metric.dataType || "—"}</div>
      <div>{fmt(nullFraction)}</div>
      <div>{fmt(distinctFraction)}</div>
      <div className="gh-profile-col-range">{rangeParts.length ? rangeParts.join(" – ") : "—"}</div>
    </div>
  );
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
