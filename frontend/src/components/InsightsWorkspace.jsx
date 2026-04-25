import { useEffect, useState } from "react";
import {
  BarList,
  DataTable,
  DegradedBanner,
  EmptyState,
  HeatmapMatrix,
  MetricCard,
  PageHero,
  SectionCard,
  StatusPill,
} from "./northstar";
import { useInsightsDashboard as defaultUseInsightsDashboard } from "../hooks/useInsightsDashboard";

function formatValue(value, format = "") {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const n = Number(value);
  if (!Number.isFinite(n)) return "Unavailable";
  if (format === "percent") return `${Math.round(n)}%`;
  if (format === "score") return String(Math.round(n));
  return Math.max(0, Math.trunc(n)).toLocaleString();
}

function metricTone(kpi) {
  if (kpi?.state === "unavailable" || kpi?.value === null || kpi?.value === undefined) return "muted";
  if (String(kpi?.key || "").toLowerCase().includes("exception")) return Number(kpi.value) > 0 ? "warn" : "good";
  return "info";
}

function heatmapRows(cells = []) {
  const byRow = new Map();
  for (const cell of cells) {
    const rowName = cell.row || cell.domain || cell.label || "Unassigned";
    const column = cell.column || cell.metric || "Coverage";
    const current = byRow.get(rowName) || { domain: rowName, values: {} };
    current.values[column] = cell.value;
    byRow.set(rowName, current);
  }
  return Array.from(byRow.values());
}

/**
 * Insights surface backed by the Phase 5 Atlas composite API.
 */
export function InsightsWorkspace({
  onNavigate,
  onSurfaceReady,
  insightsOverride = null,
  gapAnalysisOverride = null,
  useInsightsDashboardImpl = defaultUseInsightsDashboard,
}) {
  const override = insightsOverride || gapAnalysisOverride;
  const hookImpl = override ? () => ({}) : useInsightsDashboardImpl;
  const liveInsights = hookImpl({ enabled: !override });
  const insights = override || liveInsights;
  const data = insights.data || insights;
  const [showFormula, setShowFormula] = useState(false);

  useEffect(() => {
    if (!insights.loading && !insights.isLoading) {
      onSurfaceReady?.();
    }
  }, [insights.isLoading, insights.loading, onSurfaceReady]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previous = document.title;
    document.title = "Insights — Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  const meta = {
    ...(data.meta || {}),
    degraded: insights.degraded || data.meta?.state === "degraded",
    warnings: insights.refreshError
      ? [insights.refreshError]
      : Array.isArray(data.meta?.warnings)
        ? data.meta.warnings
        : [],
  };
  const kpis = Array.isArray(data.kpis) ? data.kpis : [];
  const heatmap = heatmapRows(data.metadataCoverageHeatmap);
  const heatmapColumns = Array.from(
    new Set((data.metadataCoverageHeatmap || []).map((cell) => cell.column || cell.metric || "Coverage")),
  );
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
  const surfaceState = insights.error
    ? "error"
    : insights.loading || insights.isLoading
      ? "loading"
      : meta.degraded
        ? "degraded"
        : "ready";

  return (
    <section
      aria-label="Governance insights"
      className="gh-workspace gh-insights-workspace ga-page"
      data-surface="insights"
      data-state={surfaceState}
    >
      <PageHero
        eyebrow="Governance Atlas"
        title="Gap analysis across your estate"
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
          Live maturity, coverage, and remediation signals from the Atlas composite insights API.
          Empty trends or missing quality data stay explicitly unavailable.
        </p>
      </PageHero>

      {insights.error ? (
        <EmptyState
          tone="danger"
          title="Insights unavailable."
          message={insights.error}
          actions={insights.refresh ? (
            <button className="gh-tertiary-button gh-inline-link-button" type="button" onClick={() => insights.refresh()}>
              Retry
            </button>
          ) : null}
        />
      ) : null}

      <DegradedBanner meta={meta} title="Insights data is partially available" />

      <section className="gh-insights-tiles ga-kpi-grid six" aria-label="Insights metrics">
        {kpis.length ? (
          kpis.map((kpi) => (
            <MetricCard
              key={kpi.key || kpi.label}
              label={kpi.label || kpi.key}
              value={formatValue(kpi.value, kpi.format)}
              progress={typeof kpi.progress === "number" ? kpi.progress : undefined}
              meta={kpi.state === "unavailable" ? "Unavailable in current live scope" : ""}
              delta={kpi.state === "unavailable" ? "Unavailable" : "Live"}
              deltaTone={metricTone(kpi)}
            />
          ))
        ) : (
          <EmptyState title="No insight metrics available" message="The composite insights API returned no KPI rows for the current visibility scope." />
        )}
      </section>

      <div className="gh-insights-grid">
        <SectionCard title="Metadata coverage by domain" eyebrow="Coverage">
          <HeatmapMatrix data={heatmap} columns={heatmapColumns} />
        </SectionCard>

        <SectionCard title="Domain leaderboard" eyebrow="Visible estate">
          <BarList items={data.domainLeaderboard || []} labelKey="domain" valueKey="score" />
        </SectionCard>

        <SectionCard
          title="Evidence-backed recommendations"
          eyebrow="Remediation"
          actions={(
            <button className="gh-tertiary-button gh-inline-link-button" type="button" onClick={() => onNavigate?.("governance")}>
              Open Governance →
            </button>
          )}
        >
          <DataTable
            columns={[
              { key: "title", header: "Recommendation", render: (row) => row.title || "Unavailable" },
              { key: "detail", header: "Evidence", render: (row) => row.detail || "Unavailable" },
              {
                key: "source",
                header: "Source",
                render: (row) => {
                  const evidence = Array.isArray(row.evidence) ? row.evidence[0] : null;
                  return evidence ? `${evidence.type || "signal"}:${evidence.id || evidence.metric || "unknown"}` : "Unavailable";
                },
              },
            ]}
            rows={recommendations}
            rowKey="key"
            emptyMessage="No evidence-backed recommendations are available from the current live signals."
          />
        </SectionCard>

        <SectionCard
          title="Maturity scoring inputs"
          eyebrow="Provenance"
          actions={(
            <button className="gh-tertiary-button gh-inline-link-button" type="button" onClick={() => setShowFormula((value) => !value)}>
              {showFormula ? "Hide formula" : "Show formula"}
            </button>
          )}
        >
          {showFormula ? (
            <DataTable
              columns={[
                { key: "signal", header: "Signal", render: (row) => row.signal || "Unavailable" },
                { key: "weight", header: "Weight", render: (row) => formatValue(Number(row.weight) * 100, "percent") },
                {
                  key: "state",
                  header: "State",
                  render: (row) => (
                    <StatusPill tone={(data.scoring?.availableSignals || []).includes(row.signal) ? "good" : "muted"}>
                      {(data.scoring?.availableSignals || []).includes(row.signal) ? "Available" : "Unavailable"}
                    </StatusPill>
                  ),
                },
              ]}
              rows={data.scoring?.maturityFormula || []}
              rowKey="signal"
              emptyMessage="No scoring formula was returned by the composite API."
            />
          ) : (
            <EmptyState title="Scoring formula hidden" message="Open the formula to inspect which returned signals are included in the current score." />
          )}
        </SectionCard>
      </div>
    </section>
  );
}

export default InsightsWorkspace;
