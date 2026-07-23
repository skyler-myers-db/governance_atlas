import { Badge } from "../../components/system";
import { refHref } from "../../nav/refs.js";
import { useAtlasNavigate } from "../../nav/useAtlasNavigate.js";
import { useDataPactOverview, useDataPactStatus } from "../../hooks/useDataPact";

/*
 * DataPactQualityBand — surfaces the sibling DataPact product's validation
 * trust inside GA's Evidence › Quality findings tab, so the two products'
 * quality signals live side by side. It is additive and self-detecting: when
 * DataPact isn't installed it renders nothing (the tab is unchanged). It never
 * fabricates — every number comes from the live DataPact control plane.
 */

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trustStatus(score) {
  const n = num(score);
  if (n === null) return "loading";
  if (n >= 90) return "available";
  if (n >= 75) return "pending";
  if (n >= 50) return "degraded";
  return "unavailable";
}

export function DataPactQualityBand() {
  const status = useDataPactStatus();
  const overview = useDataPactOverview({ enabled: status.detected });
  const navigate = useAtlasNavigate();

  // Self-detecting: render nothing at all unless DataPact is present. Never
  // show a broken/empty band on workspaces without DataPact.
  if (!status.detected) return null;

  const rollup = overview.rollup;
  const trust = num(rollup?.trustScore);
  const target = { surface: "datapact", params: {} };
  const href = refHref(target);

  const stats = [
    { key: "trust", label: "Portfolio trust", value: trust === null ? "—" : trust.toFixed(1), status: trustStatus(trust) },
    { key: "failing", label: "Jobs failing", value: rollup ? String(rollup.failingJobCount ?? 0) : "—", danger: (rollup?.failingJobCount ?? 0) > 0 },
    { key: "cutover", label: "Cutover blockers", value: rollup ? String(rollup.cutoverBlockers ?? 0) : "—", danger: (rollup?.cutoverBlockers ?? 0) > 0 },
    { key: "jobs", label: "Active jobs", value: rollup ? String(rollup.jobCount ?? 0) : "—" },
  ];

  return (
    <section className="ga-evid-datapact" aria-label="DataPact validation trust">
      <div className="ga-evid-datapact-lead">
        <Badge status={status.status?.state === "available" ? "available" : "degraded"}>DataPact</Badge>
        <span>Validation trust from the DataPact control plane, alongside Atlas quality findings.</span>
      </div>
      <div className="ga-evid-datapact-stats">
        {stats.map((stat) => (
          <div key={stat.key} className="ga-evid-datapact-stat">
            <span className="ga-evid-datapact-label">{stat.label}</span>
            <strong className={stat.danger ? "is-danger" : stat.status ? `is-${stat.status}` : ""}>{stat.value}</strong>
          </div>
        ))}
      </div>
      <a
        className="ga-evid-datapact-link"
        href={href}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          navigate(target);
        }}
      >
        Open Control Center ↗
      </a>
    </section>
  );
}

export default DataPactQualityBand;
