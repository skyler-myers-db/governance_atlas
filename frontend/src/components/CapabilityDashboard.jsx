import { useEffect } from "react";
import { SurfaceHeader, SurfaceWorkbench } from "./ShellLayoutPrimitives";
import { InlineStatusBanner, WorkspaceStateCard } from "./ShellStatePrimitives";
import { MetadataChip, StatusBadge } from "./primitives";
import { useCapabilityDashboard } from "../hooks/useCapabilityDashboard";

const CAPABILITY_ROWS = [
  { key: "governanceWrite", label: "Governance write" },
  { key: "governanceApproval", label: "Governance approval" },
  { key: "systemInventoryRead", label: "System inventory read" },
  { key: "tableLineage", label: "Table lineage" },
  { key: "columnLineage", label: "Column lineage" },
  { key: "workloadVisibility", label: "Workload visibility" },
  { key: "qualityRunEligibility", label: "Quality run eligibility" },
  { key: "exportAllowed", label: "Export allowed" },
  { key: "manualLineageOverrides", label: "Manual lineage overrides" },
];

const SYSTEM_TABLE_ROWS = [
  {
    key: "systemInventoryRead",
    label: "system.information_schema.tables / columns",
  },
  { key: "tableLineage", label: "system.access.table_lineage" },
  { key: "workloadVisibility", label: "system.query.history" },
];

function toneForState(state = "") {
  const normalized = String(state || "").trim().toLowerCase();
  if (["live", "available", "ready", "success"].includes(normalized)) return "good";
  if (["degraded", "warn", "warning", "unknown", "loading", "skipped"].includes(normalized)) return "warn";
  if (["unavailable", "error", "bad"].includes(normalized)) return "bad";
  return "neutral";
}

function toneForAvailability(value, state) {
  if (state === "degraded" || state === "unknown") return "warn";
  if (value === true) return "good";
  if (value === false) return "bad";
  return "neutral";
}

function availabilityLabel(value, state) {
  if (state === "degraded") return "Degraded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "Unknown";
}

function readableState(state = "") {
  const normalized = String(state || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function Section({ title, description = "", children, className = "" }) {
  return (
    <section
      aria-label={title}
      className={`gh-capability-section ${className}`.trim()}
    >
      <header className="gh-capability-section-head">
        <h2 className="gh-capability-section-title">{title}</h2>
        {description ? (
          <p className="gh-capability-section-description">{description}</p>
        ) : null}
      </header>
      <div className="gh-capability-section-body">{children}</div>
    </section>
  );
}

function KeyValueRow({ label, value, tone = "neutral", hint = "" }) {
  return (
    <div className="gh-capability-kv">
      <span className="gh-capability-kv-label">{label}</span>
      <span className="gh-capability-kv-value">
        {typeof value === "string" || typeof value === "number" ? (
          <StatusBadge tone={tone} label={String(value)} />
        ) : value}
      </span>
      {hint ? <span className="gh-capability-kv-hint">{hint}</span> : null}
    </div>
  );
}

function CapabilityRow({ rowKey, label, flag }) {
  const resolvedFlag = flag || {};
  const state = resolvedFlag.state || "unknown";
  const available = resolvedFlag.available;
  const reason = resolvedFlag.reason || "";
  const visibilityScope = resolvedFlag.visibilityScope || "";
  const source = resolvedFlag.source || "";
  const protectedRead = resolvedFlag.protectedRead === true;
  return (
    <tr data-row-key={rowKey} className="gh-capability-row">
      <th scope="row" className="gh-capability-row-label">
        {label}
      </th>
      <td>
        <StatusBadge
          tone={toneForAvailability(available, state)}
          label={availabilityLabel(available, state)}
        />
      </td>
      <td>
        <StatusBadge tone={toneForState(state)} label={readableState(state)} />
      </td>
      <td className="gh-capability-row-reason">{reason || "—"}</td>
      <td>
        {visibilityScope ? (
          <MetadataChip label="scope" value={visibilityScope} />
        ) : (
          "—"
        )}
      </td>
      <td>{source || "—"}</td>
      <td>
        {protectedRead ? (
          <StatusBadge tone="warn" label="Protected" />
        ) : (
          <StatusBadge tone="good" label="Open" />
        )}
      </td>
    </tr>
  );
}

function IdentitySection({ identity, capabilities }) {
  const actorEmail = identity?.actorEmail || "unknown";
  const authMode = identity?.authMode || "no-identity";
  const visibilityScope = identity?.visibilityScope || "";
  const authenticated = identity?.authenticatedUserPresent === true;
  // OBO scope-fallback is surfaced by the runtime when the UC client
  // latched onto the app-principal path because the forwarded OBO
  // token lacked the `sql` scope. capabilities.systemInventoryRead.source
  // reflects which plane served the read, which is the closest honest
  // signal we have without adding a bespoke field.
  const systemInventoryRead = capabilities?.systemInventoryRead || {};
  const scopeFallbackTriggered =
    authMode === "obo-available" &&
    systemInventoryRead.source === "unity-catalog-app-principal";

  return (
    <Section
      title="Identity and auth"
      description="Forwarded user, authorization mode, and read-path visibility scope."
    >
      <div className="gh-capability-kv-grid">
        <KeyValueRow label="Actor email" value={actorEmail} tone="neutral" />
        <KeyValueRow
          label="Authenticated user"
          value={authenticated ? "Yes" : "No"}
          tone={authenticated ? "good" : "warn"}
        />
        <KeyValueRow
          label="Auth mode"
          value={authMode}
          tone={
            authMode === "obo-available"
              ? "good"
              : authMode === "app-principal-only"
                ? "warn"
                : "bad"
          }
        />
        <KeyValueRow
          label="Visibility scope"
          value={visibilityScope || "unknown"}
          tone={visibilityScope ? "neutral" : "warn"}
        />
        <KeyValueRow
          label="OBO scope fallback"
          value={scopeFallbackTriggered ? "Triggered" : "Not triggered"}
          tone={scopeFallbackTriggered ? "warn" : "good"}
          hint={
            scopeFallbackTriggered
              ? "The forwarded user token lacks the sql scope; reads are served by the app-principal."
              : ""
          }
        />
      </div>
    </Section>
  );
}

function RuntimeSection({ runtime, store, config }) {
  const runtimeState = runtime?.state || "unknown";
  const runtimeMessage = runtime?.message || "";
  const storeState = store?.state || "unknown";
  const storeMessage = store?.message || "";
  const client = runtime?.client || {};
  return (
    <Section
      title="Runtime and store"
      description="Live Databricks SQL runtime, governance control-plane, and UC client metadata."
    >
      <div className="gh-capability-kv-grid">
        <KeyValueRow
          label="Runtime state"
          value={readableState(runtimeState)}
          tone={toneForState(runtimeState)}
          hint={runtimeMessage}
        />
        <KeyValueRow
          label="Store state"
          value={readableState(storeState)}
          tone={toneForState(storeState)}
          hint={storeMessage}
        />
        <KeyValueRow
          label="Warehouse id"
          value={config?.warehouseId || client?.warehouseId || "—"}
        />
        <KeyValueRow
          label="Workspace host"
          value={client?.host || client?.workspaceHost || "—"}
        />
        <KeyValueRow
          label="OAuth mode"
          value={client?.authMode || client?.authType || "—"}
        />
        <KeyValueRow
          label="Gov catalog / schema"
          value={`${config?.govCatalog || "—"} / ${config?.govSchema || "—"}`}
        />
      </div>
    </Section>
  );
}

function CapabilityFlagsSection({ capabilities }) {
  return (
    <Section
      title="Capability flags"
      description="The nine capability truth flags the runtime computes per request."
    >
      <div className="gh-capability-table-wrapper">
        <table className="gh-capability-table">
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Available</th>
              <th scope="col">State</th>
              <th scope="col">Reason</th>
              <th scope="col">Visibility scope</th>
              <th scope="col">Source</th>
              <th scope="col">Read plane</th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_ROWS.map((row) => (
              <CapabilityRow
                key={row.key}
                rowKey={row.key}
                label={row.label}
                flag={capabilities?.[row.key] || null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function BackgroundSection({ background, error }) {
  if (error) {
    return (
      <Section title="Background work health">
        <InlineStatusBanner
          title="Background status unavailable"
          message={error}
          tone="warn"
        />
      </Section>
    );
  }
  if (!background) {
    return (
      <Section title="Background work health">
        <InlineStatusBanner
          title="Not yet observed"
          message="The background drainer has not reported a tick yet. If the app just started, refresh in a few seconds; the first drain pass runs on the 30-second interval."
          tone="warn"
        />
      </Section>
    );
  }
  const drainer = background.drainer || {};
  const queue = background.queue || {};
  const running = drainer.running === true;
  const processedTotal = Number.isFinite(Number(drainer.processedTotal))
    ? Number(drainer.processedTotal)
    : 0;
  const lastDrainAt = drainer.lastDrainAt || "";
  const lastError = drainer.lastError || "";

  return (
    <Section
      title="Background work health"
      description="In-process drainer that claims queued work items every 30 seconds."
    >
      <div className="gh-capability-kv-grid">
        <KeyValueRow
          label="Drainer running"
          value={running ? "Yes" : "No"}
          tone={running ? "good" : "bad"}
        />
        <KeyValueRow
          label="Last drain at"
          value={lastDrainAt || "Not yet observed"}
          tone={lastDrainAt ? "good" : "warn"}
        />
        <KeyValueRow
          label="Processed total"
          value={String(processedTotal)}
          tone="neutral"
        />
        <KeyValueRow
          label="Queue depth hint"
          value={
            queue.depthHint === null || queue.depthHint === undefined
              ? "Not observed"
              : String(queue.depthHint)
          }
          tone={
            queue.depthHint === null || queue.depthHint === undefined
              ? "warn"
              : "neutral"
          }
        />
        <KeyValueRow
          label="Last error"
          value={lastError || "None"}
          tone={lastError ? "bad" : "good"}
        />
        <KeyValueRow
          label="Envelope state"
          value={readableState(background.state || "unknown")}
          tone={toneForState(background.state || "unknown")}
          hint={background.reason}
        />
      </div>
    </Section>
  );
}

function SystemTableHealthSection({ capabilities }) {
  return (
    <Section
      title="System-table health"
      description="Reachability of the Databricks system tables that power discovery, lineage, and workload surfaces."
    >
      <div className="gh-capability-table-wrapper">
        <table className="gh-capability-table">
          <thead>
            <tr>
              <th scope="col">System table</th>
              <th scope="col">Reachable</th>
              <th scope="col">State</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {SYSTEM_TABLE_ROWS.map((row) => {
              const flag = capabilities?.[row.key] || {};
              const state = flag.state || "unknown";
              const available = flag.available;
              return (
                <tr key={row.key}>
                  <th scope="row" className="gh-capability-row-label">
                    {row.label}
                  </th>
                  <td>
                    <StatusBadge
                      tone={toneForAvailability(available, state)}
                      label={availabilityLabel(available, state)}
                    />
                  </td>
                  <td>
                    <StatusBadge
                      tone={toneForState(state)}
                      label={readableState(state)}
                    />
                  </td>
                  <td className="gh-capability-row-reason">
                    {flag.reason || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function CapabilityDashboard({ onBack = null }) {
  const dashboard = useCapabilityDashboard();

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previous = document.title;
    document.title = "Capabilities — Governance Atlas";
    return () => {
      document.title = previous;
    };
  }, []);

  const {
    loading,
    refreshing,
    runtimeError,
    backgroundError,
    identity,
    runtime,
    store,
    config,
    capabilities,
    background,
    lastRefreshedAt,
    refetch,
  } = dashboard;

  const handleRefresh = () => {
    void refetch();
  };

  return (
    <section
      aria-label="Capability dashboard"
      className="gh-workspace gh-capability-dashboard"
    >
      <SurfaceHeader
        eyebrow="Operator diagnostics"
        title="Capability dashboard"
        actions={(
          <div className="gh-capability-header-actions">
            {onBack ? (
              <button
                className="gh-tertiary-button"
                onClick={onBack}
                type="button"
              >
                ← Back
              </button>
            ) : null}
            <button
              aria-label="Refresh capability snapshot"
              className="gh-primary-button"
              disabled={refreshing}
              onClick={handleRefresh}
              type="button"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}
      >
        <div className="gh-support-copy">
          Read-only snapshot of what the live runtime says the app can do,
          sourced from <code>/api/runtime/status</code> and
          {" "}<code>/api/admin/background/status</code>. Every value here is a
          truthful mirror of a server-side signal — no synthesized metrics.
        </div>
        {lastRefreshedAt ? (
          <div className="gh-support-copy gh-capability-refreshed">
            Last refreshed at {lastRefreshedAt}.
          </div>
        ) : null}
      </SurfaceHeader>

      <SurfaceWorkbench className="gh-capability-dashboard-body">
        {loading ? (
          <WorkspaceStateCard
            eyebrow="Capabilities"
            loading
            message="Fetching runtime capability truth and background drainer health."
            title="Loading capability snapshot…"
          />
        ) : (
          <div className="gh-capability-sections">
            {runtimeError ? (
              <InlineStatusBanner
                title="Runtime status unavailable"
                message={runtimeError}
                tone="bad"
              />
            ) : null}
            <IdentitySection
              identity={identity}
              capabilities={capabilities || {}}
            />
            <RuntimeSection
              runtime={runtime}
              store={store}
              config={config}
            />
            <CapabilityFlagsSection capabilities={capabilities || {}} />
            <BackgroundSection
              background={background}
              error={backgroundError}
            />
            <SystemTableHealthSection capabilities={capabilities || {}} />
          </div>
        )}
      </SurfaceWorkbench>
    </section>
  );
}

export default CapabilityDashboard;
