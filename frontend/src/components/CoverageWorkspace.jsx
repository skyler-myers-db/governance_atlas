import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAdminCoverage, fetchAdminCoverageDrilldown } from "../lib/api";
import { WorkspaceStateCard } from "./ShellStatePrimitives";

const ALL_FIELDS = [
  { key: "owner", label: "Owner" },
  { key: "domain", label: "Domain" },
  { key: "tier", label: "Tier" },
  { key: "business_criticality", label: "Business Criticality" },
  { key: "sensitivity", label: "Sensitivity" },
  { key: "certification", label: "Certification" },
  { key: "description", label: "Description" },
  { key: "cde", label: "CDE flag" },
];

const DEFAULT_FIELDS = [
  "owner",
  "domain",
  "tier",
  "business_criticality",
  "sensitivity",
  "description",
];

function toneForPct(pct) {
  if (pct >= 90) return "good";
  if (pct >= 60) return "warn";
  return "bad";
}

function PctChip({ pct }) {
  const tone = toneForPct(pct);
  return (
    <span className={`gh-coverage-pct tone-${tone}`}>
      {typeof pct === "number" ? pct.toFixed(1) : "0.0"}%
    </span>
  );
}

export default function CoverageWorkspace({ bootstrap, onSurfaceReady }) {
  const [coverage, setCoverage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requiredFields, setRequiredFields] = useState(DEFAULT_FIELDS);
  const [drilldown, setDrilldown] = useState(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const shellRole = String(bootstrap?.shell?.role || "").trim();
  const isElevated = /admin|steward/i.test(shellRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchAdminCoverage({ requiredFields });
      setCoverage(payload);
    } catch (err) {
      setError(err?.message || "Failed to load coverage.");
    } finally {
      setLoading(false);
      onSurfaceReady?.();
    }
  }, [onSurfaceReady, requiredFields]);

  useEffect(() => {
    if (isElevated) {
      load();
    }
  }, [load, isElevated]);

  const openDrilldown = useCallback(
    async ({ tier, domain, missingField }) => {
      setDrilldownLoading(true);
      setDrilldown({ filter: { tier, domain, missingField }, items: [], limit: 200 });
      try {
        const payload = await fetchAdminCoverageDrilldown({
          requiredFields,
          tier,
          domain,
          missingField,
          limit: 200,
        });
        setDrilldown({ filter: { tier, domain, missingField }, ...payload });
      } catch (err) {
        setError(err?.message || "Drilldown failed.");
      } finally {
        setDrilldownLoading(false);
      }
    },
    [requiredFields],
  );

  const toggleField = useCallback((key) => {
    setRequiredFields((current) =>
      current.includes(key)
        ? current.filter((field) => field !== key)
        : [...current, key],
    );
  }, []);

  const overall = coverage?.overall;
  const byField = coverage?.byField || [];
  const byTier = coverage?.byTier || [];
  const byDomain = coverage?.byDomain || [];

  const drilldownTitle = useMemo(() => {
    if (!drilldown) return "";
    const { missingField, tier, domain } = drilldown.filter;
    if (missingField) return `Missing ${missingField.replace(/_/g, " ")}`;
    if (tier) return `Tier ${tier}`;
    if (domain) return `Domain ${domain}`;
    return "All non-compliant";
  }, [drilldown]);

  if (!isElevated) {
    return (
      <WorkspaceStateCard
        eyebrow="Restricted"
        title="Coverage dashboard is admin-only"
        message="Sign in as an admin or steward to view per-tier and per-domain metadata completeness."
        tone="warn"
      />
    );
  }

  return (
    <section className="gh-coverage-surface">
      {error ? <div className="gh-inline-alert tone-warn">{error}</div> : null}

      <section className="gh-panel gh-coverage-policy">
        <div className="gh-record-card-head">
          <div>
            <div className="gh-eyebrow">Policy</div>
            <h2 className="gh-panel-title">Required metadata fields</h2>
          </div>
          <button className="gh-secondary-button" onClick={load} type="button">
            Refresh
          </button>
        </div>
        <p className="gh-support-copy">
          An asset is "fully compliant" only when every required field below is
          populated. Toggle fields to stress-test compliance under different
          policies.
        </p>
        <fieldset className="gh-coverage-policy-fields">
          <legend className="gh-visually-hidden">Required metadata fields</legend>
          {ALL_FIELDS.map((field) => (
            <label className="gh-coverage-field-toggle" key={field.key}>
              <input
                checked={requiredFields.includes(field.key)}
                onChange={() => toggleField(field.key)}
                type="checkbox"
              />
              <span>{field.label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      {loading && !coverage ? (
        <div className="gh-coverage-placeholder">Computing coverage…</div>
      ) : null}

      {overall ? (
        <section className="gh-panel gh-coverage-summary">
          <div className="gh-record-card-head">
            <div>
              <div className="gh-eyebrow">Overall</div>
              <h2 className="gh-panel-title">
                {overall.compliant} of {overall.total} assets fully compliant
              </h2>
            </div>
            <div className="gh-coverage-hero">
              <PctChip pct={overall.compliancePct} />
            </div>
          </div>
          <div className="gh-coverage-field-grid">
            {byField.map((entry) => (
              <button
                aria-label={`Drill into ${entry.field}: ${entry.missing} missing`}
                className={`gh-coverage-field-card tone-${toneForPct(entry.coveragePct)}`}
                key={entry.field}
                onClick={() => openDrilldown({ missingField: entry.field })}
                type="button"
              >
                <div className="gh-eyebrow">{entry.field.replace(/_/g, " ")}</div>
                <div className="gh-coverage-field-card-pct">
                  {entry.coveragePct.toFixed(1)}%
                </div>
                <div className="gh-coverage-field-card-meta">
                  {entry.missing} missing · {entry.present} populated
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {byTier.length ? (
        <section className="gh-panel gh-coverage-grid">
          <div className="gh-record-card-head">
            <div>
              <div className="gh-eyebrow">By tier</div>
              <h2 className="gh-panel-title">Coverage by tier</h2>
            </div>
          </div>
          <table className="gh-coverage-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Assets</th>
                <th>Compliant</th>
                <th>Coverage</th>
                <th>Drill-down</th>
              </tr>
            </thead>
            <tbody>
              {byTier.map((row) => (
                <tr key={row.tier}>
                  <td>{row.tier}</td>
                  <td>{row.total}</td>
                  <td>{row.compliant}</td>
                  <td>
                    <PctChip pct={row.compliancePct} />
                  </td>
                  <td>
                    <button
                      className="gh-tertiary-button"
                      onClick={() => openDrilldown({ tier: row.tier })}
                      type="button"
                    >
                      {row.total - row.compliant} non-compliant →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {byDomain.length ? (
        <section className="gh-panel gh-coverage-grid">
          <div className="gh-record-card-head">
            <div>
              <div className="gh-eyebrow">By domain</div>
              <h2 className="gh-panel-title">Coverage by domain</h2>
            </div>
          </div>
          <table className="gh-coverage-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Assets</th>
                <th>Compliant</th>
                <th>Coverage</th>
                <th>Drill-down</th>
              </tr>
            </thead>
            <tbody>
              {byDomain.map((row) => (
                <tr key={row.domain}>
                  <td>{row.domain}</td>
                  <td>{row.total}</td>
                  <td>{row.compliant}</td>
                  <td>
                    <PctChip pct={row.compliancePct} />
                  </td>
                  <td>
                    <button
                      className="gh-tertiary-button"
                      onClick={() => openDrilldown({ domain: row.domain })}
                      type="button"
                    >
                      {row.total - row.compliant} non-compliant →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {drilldown ? (
        <section className="gh-panel gh-coverage-drilldown">
          <div className="gh-record-card-head">
            <div>
              <div className="gh-eyebrow">Drill-down</div>
              <h2 className="gh-panel-title">{drilldownTitle}</h2>
            </div>
            <button
              aria-label="Close drill-down panel"
              className="gh-tertiary-button"
              onClick={() => setDrilldown(null)}
              type="button"
            >
              Close
            </button>
          </div>
          {drilldownLoading ? (
            <div className="gh-support-copy">Loading matches…</div>
          ) : null}
          {!drilldownLoading && drilldown.items?.length === 0 ? (
            <div className="gh-support-copy">
              No non-compliant assets match this slice.
            </div>
          ) : null}
          {drilldown.items?.length ? (
            <table className="gh-coverage-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Tier</th>
                  <th>Domain</th>
                  <th>Business Criticality</th>
                  <th>Missing fields</th>
                </tr>
              </thead>
              <tbody>
                {drilldown.items.map((asset) => (
                  <tr key={asset.fqn}>
                    <td>
                      <div>{asset.name || asset.fqn}</div>
                      <code className="gh-coverage-fqn">{asset.fqn}</code>
                    </td>
                    <td>{asset.tier}</td>
                    <td>{asset.domain}</td>
                    <td>{asset.businessCriticality}</td>
                    <td>
                      <div className="gh-coverage-missing-list">
                        {asset.missingFields.map((field) => (
                          <span className="gh-chip tone-bad" key={field}>
                            {field.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
