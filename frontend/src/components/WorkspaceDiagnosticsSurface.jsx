import { getRuntimeDiagnostics } from "../lib/api";

function toneForState(state = "") {
  const normalized = String(state || "").trim().toLowerCase();
  if (["live", "available", "ready", "success"].includes(normalized)) return "good";
  if (["degraded", "unknown", "warning"].includes(normalized)) return "warn";
  return "bad";
}

function labelForState(state = "") {
  const normalized = String(state || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function availabilityLabel(value) {
  if (typeof value !== "boolean") return "Unknown";
  return value ? "Available" : "Blocked";
}

function SummaryCard({ label, value, state, note }) {
  return (
    <div className="gh-task-card">
      <div className="gh-task-card-head">
        <span className={`gh-status-chip tone-${toneForState(state)}`}>{labelForState(state)}</span>
        <span className="gh-task-value">{value}</span>
      </div>
      <div className="gh-task-title">{label}</div>
      {note ? <div className="gh-support-copy">{note}</div> : null}
    </div>
  );
}

function DiagnosticsList({ items = [] }) {
  return (
    <div className="gh-request-list gh-request-list-dense">
      {items.map((item, index) => (
        <div
          className="gh-request-card gh-request-row"
          key={`${item.key || item.name || item.label || "item"}:${index}`}
        >
          <div className="gh-request-card-topline">
            <div>
              <div className="gh-request-title">{item.label || item.name}</div>
              <div className="gh-request-meta">{item.summary || item.rollout || item.source || ""}</div>
            </div>
            <div className="gh-chip-row">
              {typeof item.enabled === "boolean" ? (
                <span className={`gh-chip gh-chip-soft ${item.enabled ? "" : ""}`}>
                  {item.enabled ? "Enabled" : "Disabled"}
                </span>
              ) : null}
              <span className={`gh-status-chip tone-${toneForState(item.state)}`}>
                {labelForState(item.state)}
              </span>
            </div>
          </div>
          {item.detail || item.description ? (
            <div className="gh-support-copy">{item.detail || item.description}</div>
          ) : null}
          {item.rationale ? (
            <div className="gh-support-copy">
              <strong>Rationale:</strong> {item.rationale}
            </div>
          ) : null}
          {item.proofSource ? (
            <div className="gh-support-copy">
              <strong>Proof source:</strong> {item.proofSource}
            </div>
          ) : null}
          {item.evidence ? (
            <div className="gh-support-copy">
              <strong>Evidence:</strong> {item.evidence}
            </div>
          ) : null}
          {item.effect ? (
            <div className="gh-support-copy">
              <strong>Effect:</strong> {item.effect}
            </div>
          ) : null}
          {item.remediation ? (
            <div className="gh-support-copy">
              <strong>Remediation:</strong> {item.remediation}
            </div>
          ) : null}
          {item.blockedSurfaces?.length ? (
            <div className="gh-chip-row">
              {item.blockedSurfaces.map((surface) => (
                <span className="gh-chip gh-chip-soft" key={`${item.key || item.label}:${surface}`}>
                  {surface}
                </span>
              ))}
            </div>
          ) : null}
          {item.observedAt || item.owner || item.staleAfter ? (
            <div className="gh-chip-row">
              {item.owner ? <span className="gh-chip gh-chip-soft">{item.owner}</span> : null}
              {item.kind ? <span className="gh-chip gh-chip-soft">{item.kind}</span> : null}
              {item.defaultState ? <span className="gh-chip gh-chip-soft">Default {item.defaultState}</span> : null}
              {item.rolloutPolicy ? <span className="gh-chip gh-chip-soft">{item.rolloutPolicy}</span> : null}
              {item.rollout ? <span className="gh-chip gh-chip-soft">{item.rollout}</span> : null}
              {item.truthSource ? <span className="gh-chip gh-chip-soft">{item.truthSource}</span> : null}
              {item.observedAt ? <span className="gh-chip gh-chip-soft">Observed {item.observedAt}</span> : null}
              {item.staleAfter ? <span className="gh-chip gh-chip-soft">Stale after {item.staleAfter}</span> : null}
            </div>
          ) : null}
          {item.scope || item.expiresAfter || item.removalTicket || item.rollback ? (
            <div className="gh-chip-row">
              {item.scope ? <span className="gh-chip gh-chip-soft">{item.scope}</span> : null}
              {item.expiresAfter ? <span className="gh-chip gh-chip-soft">{item.expiresAfter}</span> : null}
              {item.removalTicket ? <span className="gh-chip gh-chip-soft">{item.removalTicket}</span> : null}
              {item.rollback ? <span className="gh-chip gh-chip-soft">{item.rollback}</span> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AttributeList({ items = [] }) {
  return (
    <div className="gh-attribute-list">
      {items.map((item) => (
        <div className="gh-attribute-row" key={item.label}>
          <span className="gh-attribute-label">{item.label}</span>
          <span className="gh-attribute-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function buildReadinessSteps(status, setupSummary, setupChecks, featureFlags) {
  const primaryRolloutFlag =
    featureFlags.find((flag) => flag?.key === "workspace_setup_diagnostics") || null;
  const rolloutState = primaryRolloutFlag?.state || "unknown";
  const rolloutSummary = primaryRolloutFlag
    ? primaryRolloutFlag.summary ||
      primaryRolloutFlag.reason ||
      "Workspace setup diagnostics rollout metadata is available."
    : featureFlags.length
      ? "No workspace setup diagnostics rollout flag was returned."
      : "No feature-flag inventory has been exposed yet.";
  const rolloutDetail = primaryRolloutFlag
    ? primaryRolloutFlag.description ||
      primaryRolloutFlag.reason ||
      "The shell-owned diagnostics rollout is sourced from the named workspace diagnostics flag."
    : featureFlags.length
      ? "Feature flags were returned, but the named workspace diagnostics rollout flag is missing."
      : "No feature-flag inventory has been exposed yet.";
  return [
    {
      key: "workspace_identity",
      label: "Confirm workspace identity",
      state: status?.identity?.actorEmail && status?.config?.warehouseId ? "available" : "unknown",
      summary: [status?.identity?.actorRole || "Unknown role", status?.identity?.source || "Unknown source"]
        .filter(Boolean)
        .join(" · "),
      detail: [
        status?.identity?.actorEmail ? `Actor ${status.identity.actorEmail}` : "Actor identity is not resolved yet.",
        status?.config?.warehouseId ? `Warehouse ${status.config.warehouseId}` : "Warehouse is not configured.",
      ].join(" "),
      observedAt: status?.diagnostics?.observedAt || "",
    },
    {
      key: "authorization_plane",
      label: "Check authorization plane",
      state: status?.diagnostics?.auth?.perUserAuthorization?.state || "unknown",
      summary: status?.diagnostics?.auth?.mode || "Unknown auth mode",
      detail:
        status?.diagnostics?.auth?.perUserAuthorization?.reason ||
        "Per-user authorization status is reported by the live runtime.",
      evidence: status?.diagnostics?.auth?.perUserAuthorization?.state
        ? "Runtime auth payload"
        : "No auth check returned",
      remediation:
        status?.diagnostics?.auth?.perUserAuthorization?.state === "unavailable"
          ? "Add per-user authorization before depending on actor-scoped protected reads."
          : "",
      observedAt: status?.diagnostics?.observedAt || "",
    },
    {
      key: "runtime_health",
      label: "Inspect runtime and store health",
      state:
        status?.runtime?.state === "unavailable" || status?.store?.state === "unavailable"
          ? "unavailable"
          : status?.runtime?.state === "degraded" || status?.store?.state === "degraded"
            ? "degraded"
            : status?.runtime?.state || status?.store?.state || "unknown",
      summary: [
        status?.runtime?.state ? `Runtime ${labelForState(status.runtime.state)}` : "",
        status?.store?.state ? `Store ${labelForState(status.store.state)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      detail:
        status?.runtime?.message ||
        status?.store?.message ||
        "Runtime and governance store health are derived from the live status payload.",
      observedAt: status?.diagnostics?.observedAt || "",
    },
    {
      key: "readiness_probes",
      label: "Review readiness probes",
      state:
        setupSummary.unavailableCount
          ? "unavailable"
          : setupSummary.degradedCount
            ? "degraded"
            : setupSummary.availableCount
              ? "available"
              : "unknown",
      summary: `${setupSummary.availableCount || 0} ready, ${setupSummary.degradedCount || 0} degraded`,
      detail: `${setupSummary.unavailableCount || 0} unavailable and ${setupSummary.unknownCount || 0} unknown readiness checks.`,
      evidence: `${setupChecks.length} runtime checks`,
      observedAt: status?.diagnostics?.observedAt || "",
      staleAfter: setupChecks[0]?.staleAfter || "",
    },
    {
      key: "rollout_controls",
      label: "Review rollout controls",
      state: rolloutState,
      summary: rolloutSummary,
      detail: rolloutDetail,
      rollout: primaryRolloutFlag?.rollout || "",
      owner: primaryRolloutFlag?.owner || "",
      scope: primaryRolloutFlag?.scope || "",
      expiresAfter: primaryRolloutFlag?.expiresAfter || "",
      removalTicket: primaryRolloutFlag?.removalTicket || "",
      rollback: primaryRolloutFlag?.rollback || "",
      observedAt: status?.diagnostics?.observedAt || "",
    },
  ];
}

export default function WorkspaceDiagnosticsSurface({
  title = "Workspace Setup & Diagnostics",
  loading = false,
  error = "",
  refreshError = "",
  refreshing = false,
  onRefresh = null,
  status = null,
}) {
  const setupSummary = status?.diagnostics?.setupSummary || {};
  const setupReadiness = status?.diagnostics?.setupReadiness || status?.diagnostics?.readiness || {};
  const setupChecks = status?.diagnostics?.setupChecks || [];
  const setupSequence =
    status?.diagnostics?.setupSequence?.length ? status.diagnostics.setupSequence : buildReadinessSteps(status, setupSummary, setupChecks, status?.diagnostics?.featureFlags || []);
  const featureFlags = status?.diagnostics?.featureFlags || [];
  const workspaceAccess = status?.diagnostics?.workspaceAccess || null;
  const workspaceAccessGates = workspaceAccess?.gates || [];
  const transactionCheck = setupChecks.find((item) => item?.key === "transaction_mode") || null;
  const capabilities = Object.entries(status?.capabilities || {}).map(([key, value]) => ({
    key,
    label: key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (match) => match.toUpperCase()),
    state: value?.state || "unknown",
    summary: value?.reason || "",
  }));
  const clientDiagnostics = getRuntimeDiagnostics();
  const lastRequest = clientDiagnostics?.lastRequest || null;
  const initialNavigation = clientDiagnostics?.initialNavigation || null;
  const claimNarrowingItems = (setupReadiness.claimNarrowing || []).map((item, index) => ({
    key: item.key || `claim-${index}`,
    label: item.surface || "Claim narrowing",
    state: item.state || "unknown",
    summary: item.reason || "This surface remains narrowed until setup checks are satisfied.",
    effect: item.effect || "",
  }));

  if (loading && !status) {
    return (
      <section className="gh-panel gh-record-card">
        <div className="gh-empty-state">Loading workspace setup diagnostics...</div>
      </section>
    );
  }

  if (error && !status) {
    return (
      <section className="gh-panel gh-record-card">
        <div className="gh-empty-state">{error}</div>
      </section>
    );
  }

  return (
    <section className="gh-governance-workbench gh-governance-workbench-single">
      <section className="gh-panel gh-governance-main-pane gh-governance-main-pane-dense">
        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">{title}</div>
              <div className="gh-support-copy">
                Read-only setup truth for the current workspace, actor, and live runtime.
              </div>
            </div>
            <div className="gh-diagnostics-actions">
              {typeof onRefresh === "function" ? (
                <button
                  className="gh-tertiary-button gh-inline-link-button"
                  disabled={refreshing || loading}
                  onClick={onRefresh}
                  type="button"
                >
                  {refreshing ? "Refreshing readiness..." : "Refresh readiness"}
                </button>
              ) : null}
              {status?.diagnostics?.observedAt ? (
                <span className="gh-chip gh-chip-soft">Observed {status.diagnostics.observedAt}</span>
              ) : null}
            </div>
          </div>
          {refreshError ? (
            <div className="gh-inline-alert tone-warn">
              <div>{refreshError}</div>
            </div>
          ) : null}
          {refreshing ? (
            <div className="gh-inline-alert tone-warn">
              <div className="gh-inline-alert-title">Refreshing</div>
              <div>Rerunning the runtime status probe against the current workspace.</div>
            </div>
          ) : null}
          {setupReadiness.state && setupReadiness.state !== "ready" ? (
            <div className="gh-inline-alert tone-warn">
              <div className="gh-inline-alert-title">Claims narrowed</div>
              <div>
                {setupReadiness.nextStep
                  ? `Next step: ${labelForState(setupReadiness.nextStep)}.`
                  : "The workspace still has unresolved readiness constraints."}
              </div>
            </div>
          ) : null}
          <div className="gh-diagnostics-sequence">
            <div className="gh-governance-section-head">
              <div>
                <div className="gh-panel-title">Readiness sequence</div>
                <div className="gh-support-copy">
                  Ordered setup checks that rerun against the live runtime without leaving the shell.
                </div>
              </div>
            </div>
            <DiagnosticsList items={setupSequence} />
          </div>
          <div className="gh-task-list gh-task-list-compact">
            <SummaryCard
              label="Warehouse runtime"
              value={labelForState(status?.runtime?.state || "unknown")}
              state={status?.runtime?.state || "unknown"}
              note={status?.runtime?.message || "Live metadata runtime health."}
            />
            <SummaryCard
              label="Governance store"
              value={labelForState(status?.store?.state || "unknown")}
              state={status?.store?.state || "unknown"}
              note={status?.store?.message || "Control-plane reachability."}
            />
            <SummaryCard
              label="Setup status"
              value={labelForState(setupReadiness.state || "unknown")}
              state={
                setupReadiness.state === "blocked"
                  ? "unavailable"
                  : setupReadiness.state === "attention_required"
                    ? "degraded"
                    : setupReadiness.state || "unknown"
              }
              note={[
                `${setupSummary.availableCount || 0} ready`,
                `${setupSummary.degradedCount || 0} degraded`,
                `${setupSummary.unavailableCount || 0} unavailable`,
                `${setupSummary.unknownCount || 0} unknown`,
                setupReadiness.nextStep ? `Next ${labelForState(setupReadiness.nextStep)}` : "",
              ]
                .filter(Boolean)
                .join(", ")}
            />
            <SummaryCard
              label="Auth mode"
              value={labelForState(status?.diagnostics?.auth?.mode || status?.identity?.authMode || "unknown")}
              state={status?.diagnostics?.auth?.perUserAuthorization?.state || "unknown"}
              note={
                status?.diagnostics?.auth?.perUserAuthorization?.reason ||
                "Per-user enforcement and actor-scoped diagnostics status."
              }
            />
          </div>
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Workspace access</div>
              <div className="gh-support-copy">
                Current actor and workspace access derived from live readiness checks and capability probes.
              </div>
            </div>
            <span className="gh-chip gh-chip-soft">{workspaceAccessGates.length} gates</span>
          </div>
          <AttributeList
            items={[
              { label: "Access mode", value: labelForState(workspaceAccess?.mode || status?.diagnostics?.auth?.mode || "unknown") },
              { label: "Governance writes", value: availabilityLabel(workspaceAccess?.canWriteGovernance) },
              { label: "Lineage", value: availabilityLabel(workspaceAccess?.canUseLineage) },
              { label: "Query history", value: availabilityLabel(workspaceAccess?.canUseQueryHistory) },
              { label: "Export", value: availabilityLabel(workspaceAccess?.canExport) },
              { label: "Background work", value: availabilityLabel(workspaceAccess?.canRunBackgroundWork) },
              {
                label: "Classification recommendations",
                value: availabilityLabel(workspaceAccess?.canUseClassificationRecommendations),
              },
              {
                label: "Mutation mode",
                value:
                  workspaceAccess?.transactionMode?.summary ||
                  transactionCheck?.summary ||
                  labelForState(transactionCheck?.state || "unknown"),
              },
            ]}
          />
          {workspaceAccess?.blockedSurfaces?.length ? (
            <div className="gh-chip-row">
              {workspaceAccess.blockedSurfaces.map((surface) => (
                <span className="gh-chip gh-chip-soft" key={`blocked-surface:${surface}`}>
                  {surface}
                </span>
              ))}
            </div>
          ) : null}
          {workspaceAccessGates.length ? (
            <DiagnosticsList items={workspaceAccessGates} />
          ) : (
            <div className="gh-empty-state">No workspace access summary was returned by the runtime yet.</div>
          )}
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Claim discipline</div>
              <div className="gh-support-copy">
                Surfaces the app must narrow or hide until the relevant readiness checks turn green.
              </div>
            </div>
            <span className="gh-chip gh-chip-soft">{claimNarrowingItems.length} narrowed</span>
          </div>
          {claimNarrowingItems.length ? (
            <DiagnosticsList items={claimNarrowingItems} />
          ) : (
            <div className="gh-empty-state">No active claim narrowing is required for the current runtime payload.</div>
          )}
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Setup checks</div>
              <div className="gh-support-copy">
                Workspace readiness checks backed by the current runtime and capability probes.
              </div>
            </div>
            <span className="gh-chip gh-chip-soft">{setupChecks.length} checks</span>
          </div>
          {setupChecks.length ? (
            <DiagnosticsList items={setupChecks} />
          ) : (
            <div className="gh-empty-state">No setup checks were returned by the runtime yet.</div>
          )}
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Capability inventory</div>
              <div className="gh-support-copy">
                Actor-scoped capability hints from the live runtime.
              </div>
            </div>
            <span className="gh-chip gh-chip-soft">{capabilities.length} capabilities</span>
          </div>
          {capabilities.length ? (
            <DiagnosticsList items={capabilities} />
          ) : (
            <div className="gh-empty-state">No runtime capabilities were returned.</div>
          )}
        </section>
      </section>

      <aside className="gh-panel gh-governance-side-pane gh-governance-side-pane-dense">
        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Workspace context</div>
            </div>
          </div>
          <AttributeList
            items={[
              { label: "Actor", value: status?.identity?.actorEmail || "unknown" },
              { label: "Role", value: status?.identity?.actorRole || "Unknown" },
              { label: "Identity source", value: status?.identity?.source || "Unknown" },
              { label: "Warehouse", value: status?.config?.warehouseId || "Unconfigured" },
              { label: "Catalog", value: status?.config?.govCatalog || "Unconfigured" },
              { label: "Schema", value: status?.config?.govSchema || "Unconfigured" },
            ]}
          />
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Feature inventory</div>
              <div className="gh-support-copy">
                Runtime feature flags exposed for shell and surface gating.
              </div>
            </div>
            <span className="gh-chip gh-chip-soft">{featureFlags.length} flags</span>
          </div>
          {featureFlags.length ? (
            <DiagnosticsList items={featureFlags} />
          ) : (
            <div className="gh-empty-state">No feature-flag inventory is exposed yet.</div>
          )}
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Client diagnostics</div>
              <div className="gh-support-copy">
                Last request and initial navigation timings captured in the browser.
              </div>
            </div>
          </div>
          <AttributeList
            items={[
              {
                label: "Last request",
                value: lastRequest?.httpRequestId || lastRequest?.clientRequestId || "No requests yet",
              },
              {
                label: "Request duration",
                value: lastRequest?.clientDurationMs ? `${lastRequest.clientDurationMs} ms` : "—",
              },
              {
                label: "Initial navigation",
                value: initialNavigation?.durationMs ? `${initialNavigation.durationMs} ms` : "—",
              },
              {
                label: "Diagnostics enabled",
                value: status?.diagnostics?.diagnosticsEnabled ? "Yes" : "No",
              },
            ]}
          />
        </section>
      </aside>
    </section>
  );
}
