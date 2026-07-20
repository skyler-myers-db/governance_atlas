import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminControlCenter, fetchAdminTruthCheck } from "../lib/api";
import { isNonAuthoritativeMockEvidence } from "../lib/nonAuthoritativeEvidence";
import { EmptyState, StatusPill } from "./northstar";
import { SkeletonBlock } from "./ShellStatePrimitives";
import "../styles/operations-pages.css";

const EMPTY_DASHBOARD = Object.freeze({});

function envelopeData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}

function envelopeHydrating(payload) {
  const meta = payload && typeof payload === "object" ? payload.meta || {} : {};
  const capabilities = meta.capabilities && typeof meta.capabilities === "object"
    ? meta.capabilities
    : {};
  return text(meta.state || payload?.state).toLowerCase() === "loading" || capabilities.hydrating === true;
}

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function label(value, fallback = "Unavailable") {
  return text(value) || fallback;
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : "Unavailable";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function percentValue(value) {
  const numeric = numberOrNull(value);
  if (numeric == null) return "Unavailable";
  // App-wide percent convention (matches topbar badge + Command Center):
  // integers stay whole, fractional values keep one decimal — never round
  // 95.5% up to 96% or the same value diverges across surfaces.
  return Number.isInteger(numeric) ? `${numeric.toFixed(0)}%` : `${numeric.toFixed(1)}%`;
}

/**
 * Human-readable timestamp for backend ISO strings. Raw ISO ("2026-07-19T22:04:11Z")
 * reads as machine output on an operator surface; fall back to the raw text when
 * the value doesn't parse so we never fabricate a date.
 */
function humanTimestamp(value) {
  const raw = text(value);
  if (!raw) return "Unavailable";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function statusTone(state) {
  const value = text(state).toLowerCase();
  if (["ok", "connected", "available", "healthy", "active", "enabled", "live"].includes(value)) return "good";
  if (["slow", "degraded", "warning", "unavailable"].includes(value)) return "warn";
  if (["failed", "error"].includes(value)) return "bad";
  return "muted";
}

function stateText(state) {
  const value = text(state);
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Unavailable";
}

function controlIconName(value = "") {
  const normalized = text(value).toLowerCase();
  if (/unity|catalog|database/.test(normalized)) return "database";
  if (/warehouse|sql/.test(normalized)) return "warehouse";
  if (/model|serving|classifier/.test(normalized)) return "model";
  if (/slack|alert/.test(normalized)) return "chat";
  if (/pager|duty|p1|notification/.test(normalized)) return "bell";
  if (/lakeflow|job|pipeline|lineage|policy|quality|sweeper|trust/.test(normalized)) return "pipeline";
  return "control";
}

function ControlIcon({ name = "control" }) {
  const paths = {
    bell: <path d="M8 17h8M10 17a2 2 0 0 0 4 0M5.5 14.5h13l-1.6-2.1V9a4.9 4.9 0 0 0-9.8 0v3.4L5.5 14.5Z" />,
    chat: <path d="M5.5 7.5h13v7h-7l-3.7 3v-3H5.5v-7Z" />,
    control: <path d="M5 8h14M7 15h10M9 5v6M15 12v6" />,
    database: <path d="M6 7c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5S6 8.4 6 7Zm0 0v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7M6 12v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" />,
    model: <path d="M12 4.5v15M6.5 9.5a3 3 0 0 1 5.5-1.7 3 3 0 0 1 5.5 1.7M6.5 14.5a3 3 0 0 0 5.5 1.7 3 3 0 0 0 5.5-1.7M4.5 12h15" />,
    pipeline: <path d="M5.5 7.5h5v5h-5v-5Zm8 4h5v5h-5v-5ZM10.5 10h3M8 12.5v2a2 2 0 0 0 2 2h3.5" />,
    warehouse: <path d="M5 8.5h14M6.5 5.5h11v14h-11v-14Zm3 3v11M14.5 8.5v11M6.5 13h11" />,
  };
  return (
    <span aria-hidden="true" className="gh-admin-control-icon">
      <svg viewBox="0 0 24 24" focusable="false">
        {paths[name] || paths.control}
      </svg>
    </span>
  );
}

function responseStatus(error) {
  if (!error || typeof error !== "object") return 0;
  return Number(
    Object.prototype.hasOwnProperty.call(error, "status")
      ? /** @type {{ status?: number | string }} */ (error).status
      : 0,
  );
}

function roleSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function adminRoleAllowed(shell) {
  if (!shell) return true;
  const email = roleSlug(shell.userEmail || shell.actorEmail);
  if (!email || email === "unknown") return false;
  const role = roleSlug(shell.role || shell.actorRole);
  if (!role) return Boolean(shell.roleProvisional);
  return role.includes("admin");
}

function isNonAuthoritativeWarning(warning) {
  return isNonAuthoritativeMockEvidence(String(warning || ""));
}

function normalizeJobs(dashboard) {
  const candidates =
    dashboard.scheduledJobs ||
    dashboard.jobs ||
    dashboard.runtimeSummary?.scheduledJobs ||
    dashboard.runtime?.scheduledJobs ||
    [];
  if (!Array.isArray(candidates)) return [];
  const rows = candidates.map((job, index) => ({
    id: label(job.id || job.key || job.name, `job-${index}`),
    name: label(job.name || job.label || job.job),
    schedule: label(job.schedule || job.cron || job.frequency),
    lastRun: label(job.lastRun || job.last_run || job.relativeTime || job.updatedAt),
    status: label(job.status || job.state, "unavailable"),
    url: text(job.url || job.runUrl || job.jobUrl),
  }));
  return rows;
}

function normalizeIntegrations(dashboard) {
  // The backend's rows ARE the source of truth. The previous fixed-slot
  // regex mapping silently DROPPED real backend rows that matched no slot
  // (aiCopilot: connected, lineageService) while rendering fabricated
  // "Unavailable" placeholders for products the runtime never probes
  // (Model Serving, Incident management) — the worst kind of trust bug.
  const candidates = Array.isArray(dashboard.integrations) ? dashboard.integrations : [];
  return candidates.map((item, index) => ({
    id: label(item.key || item.id || item.label, `integration-${index}`),
    label: label(item.label || item.name),
    subtitle: label(item.subtitle || item.description || item.reason, "Runtime signal"),
    status: label(item.status || item.state, "unavailable"),
    reason: text(item.reason),
    url: text(item.url || item.configUrl || item.workspaceUrl),
  }));
}

function normalizeActivity(dashboard) {
  const candidates = Array.isArray(dashboard.recentAdminActivity) ? dashboard.recentAdminActivity : [];
  return candidates.map((row, index) => ({
    id: label(row.id, `activity-${index}`),
    title: label(row.title, "Governance event"),
    detail: text(row.detail),
    createdAt: text(row.createdAt),
    actorEmail: text(row.actorEmail),
    tone: text(row.tone),
    status: text(row.status),
  }));
}

function normalizePolicies(dashboard) {
  const policy = dashboard.policyCoverage || dashboard.policy || dashboard.policyRequirements || {};
  const candidates = policy.rules || policy.coverage || policy.rows || [];
  if (Array.isArray(candidates) && candidates.length) {
    return candidates.map((item, index) => ({
      id: label(item.key || item.id || item.label || item.name, `policy-${index}`),
      label: label(item.label || item.name || item.domain),
      value: item.value ?? item.coverage ?? item.score,
      status: label(item.status || item.state, "unavailable"),
    }));
  }
  const byDomain = Array.isArray(policy.byDomain) ? policy.byDomain : [];
  // byDomain rows carry METADATA coverage (coverageKind: "metadata"), not
  // policy-enforcement coverage — surface the real number and let the panel
  // retitle itself instead of rendering disabled "Unavailable" rows while
  // the payload holds 100/97.8/… in metadataCoverage.
  const rows = byDomain.map((item, index) => {
    const coverage = item.coverage ?? item.metadataCoverage;
    return {
      id: label(item.domain || item.label, `domain-policy-${index}`),
      label: label(item.domain || item.label),
      value: coverage,
      coverageKind: text(item.coverageKind) || (item.metadataCoverage != null ? "metadata" : ""),
      note: text(item.reason),
      status: coverage === null || coverage === undefined ? "unavailable" : "available",
    };
  });
  if (rows.length) return rows;
  return [];
}

function UnavailableRow({ message }) {
  return (
    <div className="gh-admin-control-unavailable">
      <strong>Unavailable</strong>
      <span>{message}</span>
    </div>
  );
}

function JobTable({ activeId = "", emptyMessage = "", hydrating = false, jobs, onSelect }) {
  return (
    <section className="gh-admin-control-card gh-admin-control-jobs" aria-label="Scheduled jobs">
      <header>
        <div>
          <h2>Scheduled jobs</h2>
          <p>{jobs.some((job) => !job.unavailable) ? "Backed scheduled-job inventory" : "Scheduled-job inventory unavailable"}</p>
        </div>
      </header>
      <div className="gh-admin-control-job-head" role="row">
        <span>Job</span>
        <span>Schedule</span>
        <span>Last run</span>
        <span>Status</span>
        <span aria-hidden="true" />
      </div>
      <div className="gh-admin-control-job-body">
        {/* While diagnostics hydrate, show skeletons — an "Unavailable" wall
            during a background warm-up reads as a broken product. */}
        {!jobs.length && hydrating ? (
          <SkeletonBlock lines={4} message="Loading scheduled jobs" />
        ) : jobs.length ? jobs.map((job) => (
          <button
            aria-disabled={job.unavailable || undefined}
            aria-current={activeId === job.id ? "true" : undefined}
            className={`${job.unavailable ? "gh-admin-control-job-row is-unavailable" : "gh-admin-control-job-row"} ${activeId === job.id ? "is-selected" : ""}`.trim()}
            key={job.id}
            onClick={() => onSelect(job)}
            title={job.unavailable ? "Open unavailable scheduled-job diagnostics" : undefined}
            type="button"
          >
            <span className="gh-admin-job-name"><ControlIcon name={controlIconName(job.name)} /><strong>{job.name}</strong></span>
            <span>{job.schedule}</span>
            <span>{job.lastRun}</span>
            <StatusPill tone={statusTone(job.status)}>
              {stateText(job.status)}
            </StatusPill>
            <span aria-hidden="true" className="gh-admin-row-chevron" />
          </button>
        )) : (
          <UnavailableRow message={emptyMessage || "No backed scheduled-job inventory is available yet."} />
        )}
      </div>
    </section>
  );
}

function IntegrationList({ activeId = "", hydrating = false, integrations, onSelect }) {
  return (
    <section className="gh-admin-control-card gh-admin-control-integrations" aria-label="Integrations">
      <header>
        <h2>Integrations</h2>
      </header>
      <div>
        {!integrations.length && hydrating ? (
          <SkeletonBlock lines={4} message="Loading integrations" />
        ) : integrations.length ? integrations.map((item) => (
          <button
            aria-current={activeId === item.id ? "true" : undefined}
            className={`${item.unavailable ? "gh-admin-control-integration is-unavailable" : "gh-admin-control-integration"} ${activeId === item.id ? "is-selected" : ""}`.trim()}
            disabled={item.unavailable}
            key={item.id}
            onClick={() => onSelect(item)}
            title={item.unavailable ? "Integration state is unavailable because diagnostics did not report this row." : undefined}
            type="button"
          >
            <ControlIcon name={controlIconName(`${item.id} ${item.label}`)} />
            <div>
              <strong>{item.label}</strong>
              <small>{item.subtitle}</small>
            </div>
            <StatusPill tone={statusTone(item.status)}>
              {stateText(item.status)}
            </StatusPill>
            <span aria-hidden="true" className="gh-admin-row-chevron" />
          </button>
        )) : (
          <UnavailableRow message="Runtime signal unavailable" />
        )}
      </div>
    </section>
  );
}

function PolicyCoverage({ activeId = "", hydrating = false, onSelect, policies }) {
  // When every row carries metadata coverage (no policy-enforcement source
  // exists), retitle the panel honestly instead of implying enforcement data.
  const metadataScoped = policies.length > 0 && policies.every((policy) => policy.coverageKind === "metadata");
  const panelTitle = metadataScoped ? "Metadata coverage by domain" : "Policy coverage";
  return (
    <section className="gh-admin-control-card gh-admin-control-policy" aria-label={panelTitle}>
      <header>
        <h2>{panelTitle}</h2>
        <p>
          {metadataScoped
            ? "Metadata completeness per domain — not policy-enforcement coverage"
            : policies.some((policy) => !policy.unavailable && numberOrNull(policy.value) !== null)
              ? "Coverage reported by diagnostics"
              : "Policy coverage unavailable"}
        </p>
      </header>
      <div>
        {!policies.length && hydrating ? (
          <SkeletonBlock lines={4} message="Loading coverage rows" />
        ) : policies.length ? policies.map((policy) => {
          const numeric = numberOrNull(policy.value);
          const available = numeric != null;
          const unavailable = policy.unavailable || !available;
          const displayLabel = policy.label;
          const displayValue = available
            ? percentValue(numeric)
            : stateText(policy.status);
          return (
            <button
              aria-label={`${displayLabel} ${displayValue}`}
              aria-disabled={unavailable}
              aria-current={activeId === policy.id ? "true" : undefined}
              className={`${unavailable ? "gh-admin-control-policy-row is-unavailable" : "gh-admin-control-policy-row"} ${activeId === policy.id ? "is-selected" : ""}`.trim()}
              disabled={unavailable}
              key={policy.id}
              onClick={() => onSelect(policy)}
              title={unavailable ? "Policy coverage is unavailable because diagnostics did not report this check." : undefined}
              type="button"
            >
              <span>{displayLabel}</span>
              <strong>{displayValue}</strong>
              <span aria-hidden="true" className="gh-admin-row-chevron" />
              <i aria-hidden="true"><b style={{ width: available ? `${Math.max(0, Math.min(100, numeric))}%` : "0%" }} /></i>
            </button>
          );
        }) : (
          <UnavailableRow message="No backed policy-coverage rows are available yet." />
        )}
      </div>
    </section>
  );
}

/**
 * OperationsSummary — headline strip for the Operations tab, built ONLY from
 * fields already present in the control-center payload (runtimeSummary,
 * access, coverage, environment, role). No new backend work; it just stops
 * discarding rich data the API already ships.
 */
function OperationsSummary({ dashboard, hydrating = false }) {
  const runtime = dashboard.runtimeSummary || dashboard.system || {};
  const access = dashboard.access || {};
  const coverage = dashboard.coverage || {};
  const environment = dashboard.environment || {};
  const role = dashboard.role || {};
  const hasSignal = [
    runtime.state,
    coverage.metadataCoverage,
    access.users?.value,
    environment.catalog,
    role.label,
  ].some((value) => value !== null && value !== undefined && value !== "");
  const namespace = [text(environment.catalog), text(environment.schema)].filter(Boolean).join(".");
  const users = numberOrNull(access.users?.value);
  const roles = numberOrNull(access.roles?.value);
  return (
    <section className="gh-admin-control-card" aria-label="Runtime summary">
      <header>
        <div>
          <h2>Runtime summary</h2>
          <p>Live diagnostics reported by the app runtime</p>
        </div>
      </header>
      {hydrating && !hasSignal ? (
        <SkeletonBlock lines={3} message="Loading runtime summary" />
      ) : (
        <div className="gh-admin-truth-check-totals" role="group" aria-label="Runtime summary tiles">
          <div>
            <small>Runtime</small>
            <strong>{stateText(runtime.state)}</strong>
            <span>{text(runtime.host) || text(runtime.authMode) || "workspace client"}</span>
          </div>
          <div>
            <small>Catalogs</small>
            <strong>{numberValue(runtime.catalogCount)}</strong>
            <span>visible to runtime</span>
          </div>
          <div>
            <small>SQL warehouse</small>
            <strong>{label(runtime.warehouseId || environment.warehouseId)}</strong>
            <span>bound warehouse</span>
          </div>
          <div>
            <small>Metadata coverage</small>
            <strong>{percentValue(coverage.metadataCoverage)}</strong>
            <span>across visible assets</span>
          </div>
          <div>
            <small>Access</small>
            <strong>{users == null ? "Unavailable" : `${users.toLocaleString()} users`}</strong>
            <span>{roles == null ? "roles unavailable" : `${roles.toLocaleString()} roles`}</span>
          </div>
          <div>
            <small>Environment</small>
            <strong>{label(namespace)}</strong>
            <span>{text(environment.target) || "target unreported"}</span>
          </div>
          <div>
            <small>Your role</small>
            <strong>{label(role.label)}</strong>
            <span>acting permissions</span>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * ActivityFeed — renders recentAdminActivity, which the payload has always
 * shipped but the Operations tab never consumed. The backend filters
 * internal bookkeeping rows (identity-directory mirroring etc.) before
 * this list, so what lands here is real governance activity.
 */
function ActivityFeed({ events, hydrating = false }) {
  return (
    <section className="gh-admin-control-card gh-admin-activity" aria-label="Recent admin activity">
      <header>
        <h2>Recent admin activity</h2>
      </header>
      {!events.length && hydrating ? (
        <SkeletonBlock lines={4} message="Loading admin activity" />
      ) : events.length ? (
        <div className="gh-admin-activity-list">
          {events.map((event) => (
            <article key={event.id}>
              <b aria-hidden="true">{(event.title || "?").charAt(0).toUpperCase()}</b>
              <div>
                <strong>{event.title}</strong>
                <span>{event.detail || event.actorEmail || event.status || "No detail recorded"}</span>
              </div>
              <time dateTime={event.createdAt || undefined}>{humanTimestamp(event.createdAt)}</time>
            </article>
          ))}
        </div>
      ) : (
        <UnavailableRow message="No governance activity has been recorded in the audit stream yet." />
      )}
    </section>
  );
}

function ControlDetail({ detail, onOpen }) {
  if (!detail) {
    return (
      <aside className="gh-admin-control-detail is-empty" aria-label="Selected control detail">
        <strong>Select a control row to inspect diagnostics</strong>
        <span>Job, integration, and policy rows open backed details here. Missing URLs stay unavailable instead of linking to unsupported configuration.</span>
      </aside>
    );
  }
  return (
    <aside className="gh-admin-control-detail" aria-label="Selected control detail">
      <header>
        <div>
          <span>{detail.kind}</span>
          <h2>{detail.title}</h2>
          <p>{detail.subtitle}</p>
        </div>
        <StatusPill tone={statusTone(detail.status)}>
          {stateText(detail.status)}
        </StatusPill>
      </header>
      <dl>
        {detail.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value || "Unavailable"}</dd>
          </div>
        ))}
      </dl>
      <div className="gh-admin-control-actions">
        <button
          disabled={!detail.url}
          title={
            detail.url
              ? "Open the backed Databricks resource URL reported by diagnostics."
              : "No backed Databricks resource URL was reported for this row."
          }
          onClick={() => onOpen(detail)}
          type="button"
        >
          Open linked resource
        </button>
        <span>
          {detail.url
            ? "Backed URL reported by diagnostics."
            : "No backed URL reported by diagnostics."}
        </span>
      </div>
    </aside>
  );
}

/**
 * TruthCheckPanel — Metastore truth check tab.
 *
 * Calls /api/admin/truth-check and renders a side-by-side comparison of
 * what `system.information_schema` reports (catalog/schema/table counts
 * per discovery catalog) versus what the inventory + visible-asset
 * pipelines that drive the UI actually surfaced. Drift columns highlight
 * gaps so admins can act on stale caches, missing scopes, or
 * overly-aggressive visibility filters without reaching for a notebook.
 */
function deltaTone(delta) {
  if (delta === 0 || delta === null || delta === undefined) return "muted";
  if (Math.abs(delta) <= 2) return "warn";
  return "bad";
}

function deltaLabel(delta) {
  if (delta === null || delta === undefined) return "Unavailable";
  const numeric = Number(delta);
  if (!Number.isFinite(numeric)) return "Unavailable";
  if (numeric === 0) return "0";
  return numeric > 0 ? `+${numeric.toLocaleString()}` : numeric.toLocaleString();
}

function TruthCheckPanel({ canReadAdmin }) {
  const [showSql, setShowSql] = useState(false);
  const query = useQuery({
    queryKey: ["atlas", "admin-truth-check"],
    queryFn: ({ signal }) => fetchAdminTruthCheck({ signal }),
    enabled: canReadAdmin,
    retry: false,
    staleTime: 60_000,
  });
  const payload = query.data || null;
  const data = envelopeData(payload) || {};
  const meta = payload?.meta || {};
  const loading = canReadAdmin && query.isLoading;
  const queryError = canReadAdmin
    ? query.error?.message || ""
    : "Metastore truth check requires platform admin permissions.";
  const forbidden = !canReadAdmin || responseStatus(query.error) === 403;

  if (loading) {
    return (
      <EmptyState
        title="Running metastore truth check"
        message="Counting catalogs, schemas, and tables in system.information_schema and comparing against the visible-asset pipeline."
      />
    );
  }
  if (queryError) {
    return (
      <EmptyState
        tone={forbidden ? "warn" : "bad"}
        title={forbidden ? "Metastore truth check is admin-only" : "Truth check unavailable"}
        message={forbidden ? "Ask a workspace admin to grant administration access." : queryError}
      />
    );
  }

  const metastore = data.metastore || {};
  const ui = data.ui || {};
  const drift = data.drift || {};
  const perCatalog = Array.isArray(metastore.perCatalog) ? metastore.perCatalog : [];
  const queries = Array.isArray(data.queries) ? data.queries : [];
  const warnings = Array.isArray(drift.warnings) ? drift.warnings : [];
  const observedAt = humanTimestamp(data.observedAt);
  const discoveryCatalogs = Array.isArray(data.discoveryCatalogs) ? data.discoveryCatalogs : [];

  return (
    <div className="gh-admin-truth-check">
      <header className="gh-admin-truth-check-hero">
        <div>
          <span className="gh-admin-control-eyebrow">Metastore truth check</span>
          <h2>Unity Catalog ground truth vs. surfaced inventory</h2>
          <p>
            Authoritative <code>SELECT COUNT(*)</code> against{" "}
            <code>system.information_schema.&#123;catalogs, schemata, tables&#125;</code>{" "}
            compared to what Atlas&rsquo;s inventory and visibility pipeline reports.
            Use this to detect drift between the metastore and the surfaced product.
          </p>
        </div>
        <div className="gh-admin-truth-check-totals" role="group" aria-label="Totals">
          <div>
            <small>Catalogs</small>
            <strong>{numberValue(metastore.catalogTotal)}</strong>
            <span>in metastore (excl. hidden)</span>
          </div>
          <div>
            <small>Schemas</small>
            <strong>{numberValue(metastore.schemaTotalForDiscovery)}</strong>
            <span>across discovery catalogs</span>
          </div>
          <div>
            <small>Tables</small>
            <strong>{numberValue(metastore.tableTotalForDiscovery)}</strong>
            <span>across discovery catalogs</span>
          </div>
          <div>
            <small>UI inventory</small>
            <strong>{numberValue(ui.inventoryTotal)}</strong>
            <span>before visibility filters</span>
          </div>
          <div>
            <small>UI visible</small>
            <strong>{numberValue(ui.visibleTotal)}</strong>
            <span>after visibility filters</span>
          </div>
          <div>
            <small>Drift</small>
            <strong className={`gh-admin-truth-check-delta tone-${deltaTone(drift.inventoryDelta)}`}>
              {deltaLabel(drift.inventoryDelta)}
            </strong>
            <span>metastore − inventory</span>
          </div>
        </div>
      </header>

      {/* Render every warning: drift explanations ride alongside query
          failures, and showing only the first hid the drift context. */}
      {warnings.map((warning) => (
        <div className="gh-admin-warning" key={warning}>{warning}</div>
      ))}

      <div className="gh-admin-truth-check-meta">
        <span>
          Observed <strong>{observedAt}</strong>
        </span>
        <span>
          Discovery catalogs:{" "}
          {discoveryCatalogs.length ? (
            discoveryCatalogs.map((catalog) => <code key={catalog}>{catalog}</code>)
          ) : (
            <em>none configured</em>
          )}
        </span>
        <button
          className="gh-tertiary-button"
          onClick={() => query.refetch({ throwOnError: false })}
          type="button"
        >
          Re-run truth check
        </button>
      </div>

      <div className="gh-admin-truth-check-table-wrap">
        <table className="gh-admin-truth-check-table">
          <thead>
            <tr>
              <th scope="col">Catalog</th>
              <th scope="col">Configured</th>
              <th scope="col">Metastore schemas</th>
              <th scope="col">Metastore tables</th>
              <th scope="col">UI inventory</th>
              <th scope="col">UI visible</th>
              <th scope="col">Inventory drift</th>
              <th scope="col">Hidden by visibility</th>
            </tr>
          </thead>
          <tbody>
            {perCatalog.length ? (
              perCatalog.map((row) => {
                const meta_ = row.metastore || {};
                const ui_ = row.ui || {};
                const drift_ = row.drift || {};
                return (
                  <tr key={row.catalog}>
                    <th scope="row">
                      <code>{row.catalog}</code>
                      {/* All-zero catalogs are ambiguous (empty vs. missing
                          grants); badge them so the zeros don't read as a
                          broken pipeline. */}
                      {text(row.state) === "empty-or-unauthorized" ? (
                        <span title={text(row.stateReason) || undefined}>
                          <StatusPill tone="muted">No objects visible to app principal</StatusPill>
                        </span>
                      ) : null}
                    </th>
                    <td>
                      <StatusPill tone={row.configured ? "good" : "muted"}>
                        {row.configured ? "Configured" : "Not configured"}
                      </StatusPill>
                    </td>
                    <td>{numberValue(meta_.schemaCount)}</td>
                    <td>{numberValue(meta_.tableCount)}</td>
                    <td>{numberValue(ui_.inventoryAssetCount)}</td>
                    <td>{numberValue(ui_.visibleAssetCount)}</td>
                    <td>
                      <span className={`gh-admin-truth-check-delta tone-${deltaTone(drift_.inventoryDelta)}`}>
                        {deltaLabel(drift_.inventoryDelta)}
                      </span>
                    </td>
                    <td>
                      <span className={`gh-admin-truth-check-delta tone-${deltaTone(drift_.hiddenByVisibility)}`}>
                        {deltaLabel(drift_.hiddenByVisibility)}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    tone="muted"
                    title="No catalog rows reported"
                    message="The truth-check returned an empty per-catalog breakdown. Configure GOVAT_DISCOVERY_CATALOGS or grant the app principal access to system.information_schema."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="gh-admin-truth-check-queries" open={showSql} onToggle={(event) => setShowSql(event.currentTarget.open)}>
        <summary>SQL probes ({queries.length})</summary>
        <ul>
          {queries.map((entry, index) => (
            <li key={`${entry.label || "query"}-${index}`}>
              <header>
                <strong>{label(entry.label, "Query")}</strong>
                <span>
                  {/* `== null` (not truthiness): a legit 0 ms probe must
                      render "0 ms", not "elapsed unavailable". */}
                  {entry.elapsedMs == null ? "elapsed unavailable" : `${entry.elapsedMs} ms`} ·{" "}
                  rowCount {numberValue(entry.rowCount)}
                </span>
              </header>
              <pre>{entry.sql || ""}</pre>
              {entry.error ? <p className="gh-admin-truth-check-query-error">{entry.error}</p> : null}
            </li>
          ))}
        </ul>
      </details>

      <p className="gh-admin-truth-check-note" data-state={text(meta.state)}>
        Truth-check state:{" "}
        <strong>{stateText(meta.state || "available")}</strong>
        {meta.reason ? <span> · {meta.reason}</span> : null}
      </p>
    </div>
  );
}

const ADMIN_TABS = [
  { id: "operations", label: "Operations" },
  { id: "truth-check", label: "Metastore truth check" },
];

/**
 * @param {{ onNavigate?: (surfaceKey: string) => void, shell?: Record<string, any> | null }} props
 */
export default function AdminWorkspace({ shell = null } = {}) {
  const [status, setStatus] = useState("");
  const [selectedControl, setSelectedControl] = useState(null);
  const [activeTab, setActiveTab] = useState("operations");
  const canReadAdmin = adminRoleAllowed(shell);
  const query = useQuery({
    queryKey: ["atlas", "admin-control-center"],
    queryFn: ({ signal }) => fetchAdminControlCenter({ signal }),
    enabled: canReadAdmin,
    retry: false,
    staleTime: 60_000,
    refetchInterval: (currentQuery) => envelopeHydrating(currentQuery?.state?.data) ? 3_000 : false,
  });

  const dashboard = envelopeData(query.data) || {};
  const rawWarnings = [
    ...(Array.isArray(query.data?.warnings) ? query.data.warnings : []),
    ...(Array.isArray(query.data?.meta?.warnings) ? query.data.meta.warnings : []),
    ...(Array.isArray(dashboard.warnings) ? dashboard.warnings : []),
    ...(Array.isArray(dashboard.meta?.warnings) ? dashboard.meta.warnings : []),
  ];
  const nonAuthoritativeDiagnosticPayload = isNonAuthoritativeMockEvidence(
    query.data,
    query.data?.meta,
    dashboard,
    dashboard.meta,
    rawWarnings,
  );
  const safeDashboard = nonAuthoritativeDiagnosticPayload ? EMPTY_DASHBOARD : dashboard;
  const jobs = useMemo(() => normalizeJobs(safeDashboard), [safeDashboard]);
  const integrations = useMemo(() => normalizeIntegrations(safeDashboard), [safeDashboard]);
  const policies = useMemo(() => normalizePolicies(safeDashboard), [safeDashboard]);
  const activity = useMemo(() => normalizeActivity(safeDashboard), [safeDashboard]);
  // Hydrating = the backend is still warming its payload (meta.state
  // "loading" / capabilities.hydrating) or the first fetch is in flight.
  // In that window panels render skeletons — never "Unavailable" rows,
  // which would misreport a temporary warm-up as missing capability.
  const hydrating =
    (canReadAdmin && query.isLoading) ||
    (!nonAuthoritativeDiagnosticPayload && envelopeHydrating(query.data));
  // Genuinely-empty jobs table explains itself with the backend's own
  // jobsReason instead of a generic shrug.
  const jobsEmptyMessage = text(safeDashboard.jobsReason);
  const warnings = Array.isArray(rawWarnings)
    ? [
        ...rawWarnings.filter((warning) => !isNonAuthoritativeWarning(warning)),
        ...(nonAuthoritativeDiagnosticPayload ? ["Non-authoritative Control Center diagnostics were rejected. Live diagnostics are required for populated runtime, integration, and policy rows."] : []),
      ]
    : [];
  const loading = canReadAdmin && query.isLoading;
  const queryError = canReadAdmin ? query.error?.message || "" : "Control Center requires platform admin permissions.";
  const forbidden = !canReadAdmin || responseStatus(query.error) === 403;
  const handleJobSelect = (job) => {
    setSelectedControl({
      kind: "Scheduled job",
      id: job.id,
      title: job.name,
      subtitle: job.unavailable ? "Runtime job inventory has not reported this job." : "Runtime job diagnostics",
      status: job.status,
      url: job.url,
      rows: [
        { label: "Schedule", value: job.schedule },
        { label: "Last run", value: job.lastRun },
        { label: "Status", value: stateText(job.status) },
        { label: "Evidence", value: job.unavailable ? "No backed scheduled-job row was reported by diagnostics." : "Admin diagnostics payload" },
      ],
    });
    setStatus(`${job.name} diagnostics selected.`);
  };
  const handleIntegrationSelect = (item) => {
    setSelectedControl({
      kind: "Integration",
      id: item.id,
      title: item.label,
      subtitle: item.subtitle,
      status: item.status,
      url: item.url,
      rows: [
        { label: "Connection state", value: stateText(item.status) },
        { label: "Signal", value: item.subtitle },
        { label: "Evidence", value: item.unavailable ? "Integration not reported by diagnostics" : "Admin diagnostics payload" },
      ],
    });
    setStatus(`${item.label} integration diagnostics selected.`);
  };
  const handlePolicySelect = (policy) => {
    const coverage = percentValue(policy.value);
    // Metadata-scoped rows must say so — presenting metadata completeness
    // as policy-enforcement coverage would fabricate a capability.
    const coverageNoun = policy.coverageKind === "metadata" ? "metadata coverage" : "coverage";
    setSelectedControl({
      kind: "Policy coverage",
      id: policy.id,
      title: policy.label,
      subtitle: coverage === "Unavailable" ? "Coverage is unavailable in diagnostics." : `${coverage} ${coverageNoun} from diagnostics.`,
      status: policy.status,
      url: policy.url || "",
      rows: [
        { label: policy.coverageKind === "metadata" ? "Metadata coverage" : "Coverage", value: coverage },
        { label: "State", value: stateText(policy.status) },
        ...(policy.note ? [{ label: "Note", value: policy.note }] : []),
        { label: "Evidence", value: policy.unavailable ? "Policy coverage not reported" : "Policy diagnostics payload" },
      ],
    });
    setStatus(
      `${policy.label}: ${coverage === "Unavailable" ? "coverage unavailable" : `${coverage} ${coverageNoun}`} from policy diagnostics.`,
    );
  };
  const openSelectedControl = (detail) => {
    if (detail.url && typeof window !== "undefined") {
      window.open(detail.url, "_blank", "noopener,noreferrer");
      setStatus(`${detail.title} linked resource opened.`);
      return;
    }
    setStatus(`${detail.title}: no backed URL was reported by diagnostics.`);
  };
  return (
    <section className="ga-page gh-admin-ns gh-admin-control" data-testid="admin-northstar">
      <div className={`gh-admin-shell gh-admin-control-shell ${warnings.length ? "has-warning" : ""}`}>
        <header className="gh-admin-control-hero">
          <div>
            <span className="gh-admin-control-eyebrow">Control Center</span>
            <h1>Atlas runtime, integrations, and policy</h1>
            <p>
              Review runtime diagnostics for jobs, integrations, and policy coverage reported by the app. Unsupported controls stay marked unavailable.
            </p>
          </div>
        </header>

        <div className="gh-admin-tabstrip" role="tablist" aria-label="Control Center sections">
          {ADMIN_TABS.map((tab) => (
            <button
              aria-controls={`admin-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              className={`gh-admin-tabstrip-tab ${activeTab === tab.id ? "is-active" : ""}`}
              data-testid={`admin-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "operations" ? (
          <div id="admin-tab-operations" role="tabpanel">
            {loading ? (
              <EmptyState title="Loading control center" message="Reading runtime diagnostics, jobs, integrations, and policy coverage." />
            ) : queryError ? (
              <EmptyState
                tone={forbidden ? "warn" : "bad"}
                title={forbidden ? "Control Center is admin-only" : "Control Center unavailable"}
                message={forbidden ? "Ask a workspace admin to grant administration access." : (queryError || "Runtime diagnostics could not be loaded.")}
              />
            ) : null}

            {warnings.length ? (
              <div className="gh-admin-warning">{warnings[0]}</div>
            ) : null}

            <OperationsSummary dashboard={safeDashboard} hydrating={hydrating} />

            <div className="gh-admin-control-layout">
              <JobTable
                activeId={selectedControl?.kind === "Scheduled job" ? selectedControl.id : ""}
                emptyMessage={jobsEmptyMessage}
                hydrating={hydrating}
                jobs={jobs}
                onSelect={handleJobSelect}
              />
              <div className="gh-admin-control-side">
                <IntegrationList
                  activeId={selectedControl?.kind === "Integration" ? selectedControl.id : ""}
                  hydrating={hydrating}
                  integrations={integrations}
                  onSelect={handleIntegrationSelect}
                />
                <PolicyCoverage
                  activeId={selectedControl?.kind === "Policy coverage" ? selectedControl.id : ""}
                  hydrating={hydrating}
                  policies={policies}
                  onSelect={handlePolicySelect}
                />
              </div>
            </div>
            <ActivityFeed events={activity} hydrating={hydrating} />
            {selectedControl ? <ControlDetail detail={selectedControl} onOpen={openSelectedControl} /> : null}
          </div>
        ) : (
          <div id="admin-tab-truth-check" role="tabpanel">
            <TruthCheckPanel canReadAdmin={canReadAdmin} />
          </div>
        )}

        <div className="gh-admin-status-line" aria-live="polite">{status}</div>
      </div>
    </section>
  );
}
