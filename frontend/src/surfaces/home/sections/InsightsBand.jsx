import { Link } from "react-router-dom";
import { LoadingState, SectionCard, UnavailableState, hrefForRef } from "../../../components/system";
import { numericValue } from "../format.js";

/*
 * InsightsBand (Wave C2) — the three widgets ABSORBED from the killed
 * Insights surface (COHESION surface map: "Absorbs Insights' three backed
 * widgets"): Risk Heatmap (with evidence date), Metadata-Coverage-by-Domain
 * matrix, and Certification-by-Tier. Everything else Insights rendered —
 * Policy Compliance Trend, Time-to-Resolution trend, Governance ROI tiles,
 * the duplicate KPI grid, empty AI recommendation slots — dies with the
 * surface (kill list §7.1).
 */

const RISK_COLUMNS = ["Very Low", "Low", "Medium", "High", "Very High"];
const RISK_ROWS = ["Very High", "High", "Medium", "Low", "Very Low"];

function evidenceStampLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function riskTone(row, column, value) {
  if (!value) return "empty";
  const score = RISK_ROWS.length - RISK_ROWS.indexOf(row) + RISK_COLUMNS.indexOf(column);
  if (score >= 8) return "critical";
  if (score >= 6) return "high";
  if (score >= 4) return "medium";
  return "low";
}

export function RiskHeatmapCard({ cells, evidenceAt }) {
  const values = new Map();
  (Array.isArray(cells) ? cells : []).forEach((cell) => {
    const row = cell.row || cell.impact || "Medium";
    const column = cell.column || cell.likelihood || "Medium";
    values.set(`${row}::${column}`, numericValue(cell.value ?? cell.count) ?? 0);
  });
  const hasData = values.size > 0;
  const stamp = evidenceStampLabel(evidenceAt);
  return (
    <SectionCard
      className="ga-home-riskmap-card"
      title="Risk heatmap"
      subtitle="Risk counts from live criticality and metadata-gap evidence"
      tooltip="Counts come from recorded criticality and metadata-gap evidence; empty cells mean no recorded findings."
    >
      {/* Date-stamp quality-derived evidence so stale runs never masquerade
          as today's signal. */}
      {stamp ? <p className="ga-home-evidence-stamp">{`Evidence from ${stamp} (UTC)`}</p> : null}
      {hasData ? (
        <div className="ga-home-riskmap" role="table" aria-label="Governance risk heatmap">
          {RISK_ROWS.map((row) => (
            <div className="ga-home-riskmap-row" role="row" key={row}>
              <strong role="rowheader">{row}</strong>
              {RISK_COLUMNS.map((column) => {
                const value = values.get(`${row}::${column}`) || 0;
                return (
                  <span
                    className={`tone-${riskTone(row, column, value)}`}
                    key={column}
                    role="cell"
                    title={`${row} impact, ${column} likelihood: ${value}`}
                  >
                    {value || ""}
                  </span>
                );
              })}
            </div>
          ))}
          <div className="ga-home-riskmap-axis" aria-hidden="true">
            {RISK_COLUMNS.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
        </div>
      ) : (
        <UnavailableState title="Risk evidence unavailable" reason="No recorded risk findings for the current scope." />
      )}
    </SectionCard>
  );
}

export function CoverageMatrixCard({ cells }) {
  const byRow = new Map();
  for (const cell of Array.isArray(cells) ? cells : []) {
    const rowName = cell.row || cell.domain || cell.label || "Unassigned";
    const column = cell.column || cell.metric || "Coverage";
    const current = byRow.get(rowName) || { domain: rowName, values: {} };
    current.values[column] = cell.value;
    byRow.set(rowName, current);
  }
  const rows = Array.from(byRow.values());
  const columns = Array.from(
    new Set((Array.isArray(cells) ? cells : []).map((cell) => cell.column || cell.metric || "Coverage")),
  );
  const tone = (value) => (value >= 85 ? "high" : value >= 65 ? "mid" : value > 0 ? "low" : "empty");
  return (
    <SectionCard
      className="ga-home-matrix-card"
      title="Metadata coverage by domain"
      subtitle="Coverage dimensions computed from visible asset metadata"
      tooltip="Each cell is the domain's completeness for one governance metadata dimension."
    >
      {rows.length && columns.length ? (
        <div
          className="ga-home-matrix"
          role="table"
          aria-label="Metadata coverage by domain"
          style={{ "--ga-home-matrix-columns": columns.length }}
        >
          <div className="ga-home-matrix-row is-header" role="row">
            <span role="columnheader" />
            {columns.map((column) => (
              <span key={column} role="columnheader">
                {column}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <div className="ga-home-matrix-row" key={row.domain} role="row">
              <strong role="rowheader">{row.domain}</strong>
              {columns.map((column) => {
                const value = numericValue(row.values[column]) ?? 0;
                return (
                  <span
                    aria-label={`${row.domain} ${column} ${Math.round(value)} percent`}
                    className={`tone-${tone(value)}`}
                    key={column}
                    role="cell"
                    title={`${column}: ${Math.round(value)}%`}
                  />
                );
              })}
            </div>
          ))}
          <div className="ga-home-matrix-scale" aria-hidden="true">
            <span>Low</span>
            <i />
            <span>High</span>
          </div>
        </div>
      ) : (
        <UnavailableState
          title="Coverage matrix unavailable"
          reason="Domain coverage dimensions are unavailable for the current scope."
        />
      )}
    </SectionCard>
  );
}

export function CertificationTierCard({ rows }) {
  const items = (Array.isArray(rows) ? rows : []).map((item) => ({
    label: item.label || item.tier || "Unassigned tier",
    value: Math.max(0, Math.min(100, numericValue(item.value ?? item.coverage ?? item.percent) ?? 0)),
  }));
  return (
    <SectionCard
      className="ga-home-tier-card"
      title="Certification coverage by tier"
      subtitle="Certified asset share by live tier metadata"
      tooltip='Share of each tier whose assets are strictly certified (certification == "Certified").'
    >
      {items.length ? (
        <div className="ga-home-tier-rows">
          {items.map((item) => (
            <div className="ga-home-tier-row" key={item.label}>
              <span>{item.label}</span>
              <i>
                <b style={{ width: `${item.value}%` }} />
              </i>
              <strong>{Math.round(item.value)}%</strong>
            </div>
          ))}
        </div>
      ) : (
        <UnavailableState
          title="Tier certification unavailable"
          reason="Tier certification coverage is unavailable for the current live scope."
        />
      )}
    </SectionCard>
  );
}

/*
 * Atlas AI recommendations: ONLY evidence-backed rows render — one card per
 * recommendation, ZERO cards render nothing at all (kill list §7.1: the
 * "No additional evidence-backed recommendation" filler slots die).
 */
export function RecommendationsCard({ recommendations }) {
  const rows = (Array.isArray(recommendations) ? recommendations : []).filter(
    (item) => item && (item.title || item.detail),
  );
  if (!rows.length) return null;
  return (
    <SectionCard
      className="ga-home-recs-card"
      title="Atlas AI recommendations"
      subtitle="Evidence-backed recommendations only"
      tooltip="Each recommendation cites live governance evidence; slots without evidence render nothing."
    >
      <ul className="ga-home-rec-list">
        {rows.map((item) => (
          <li key={item.key || item.title}>
            <Link className="ga-home-rec" to={hrefForRef({ surface: "stewardship" })}>
              <strong>{item.title || "Evidence-backed recommendation"}</strong>
              <small>{item.detail || ""}</small>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* The band wrapper: absorbed widgets render under one "Risk & quality"
 * heading; the Insights query has its own status handling so a slow insights
 * endpoint never blocks the command-center payload above it. */
export function InsightsBand({ insights }) {
  const data = insights.data || {};
  if (insights.loading) {
    return (
      <section className="ga-home-insights-band" aria-label="Risk and quality" aria-busy="true">
        <h2 className="ga-home-band-title">Risk &amp; quality</h2>
        <LoadingState variant="card" label="Loading risk and quality widgets" />
      </section>
    );
  }
  if (insights.error) {
    return (
      <section className="ga-home-insights-band" aria-label="Risk and quality">
        <h2 className="ga-home-band-title">Risk &amp; quality</h2>
        <UnavailableState
          title="Risk and quality widgets unavailable"
          reason={insights.error}
          onRetry={insights.refresh}
        />
      </section>
    );
  }
  return (
    <section className="ga-home-insights-band" aria-label="Risk and quality">
      <h2 className="ga-home-band-title">Risk &amp; quality</h2>
      <div className="ga-home-insights-grid">
        <RiskHeatmapCard
          cells={data.riskHeatmap}
          evidenceAt={data.riskEvidenceAt || data.qualityEvidenceAt}
        />
        <CoverageMatrixCard cells={data.metadataCoverageHeatmap} />
        <CertificationTierCard rows={data.certificationCoverageByTier} />
      </div>
      <RecommendationsCard recommendations={data.recommendations} />
    </section>
  );
}

export default InsightsBand;
