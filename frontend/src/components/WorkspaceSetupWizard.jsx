import { useMemo, useState } from "react";
import {
  SurfaceHeader,
  SurfaceRail,
  SurfaceRailSection,
  SurfaceWorkbench,
  SurfaceWorkbenchMain,
} from "./ShellLayoutPrimitives";
import { EmptyStateBlock, InlineStatusBanner, WorkspaceStateCard } from "./ShellStatePrimitives";
import WorkspaceDiagnosticsSurface from "./WorkspaceDiagnosticsSurface";

function toneForState(state = "") {
  const normalized = String(state || "").trim().toLowerCase();
  if (["live", "available", "ready", "success"].includes(normalized)) return "good";
  if (["degraded", "warning", "attention_required"].includes(normalized)) return "warn";
  return "bad";
}

function labelForState(state = "") {
  const normalized = String(state || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatAvailability(value) {
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

function SetupList({ items = [] }) {
  return (
    <div className="gh-request-list gh-request-list-dense">
      {items.map((item, index) => (
        <div
          className="gh-request-card gh-request-row"
          key={`${item.key || item.label || item.surface || "item"}:${index}`}
        >
          <div className="gh-request-card-topline">
            <div>
              <div className="gh-request-title">{item.label || item.surface || "Step"}</div>
              <div className="gh-request-meta">{item.summary || item.reason || "No summary available."}</div>
            </div>
            <span className={`gh-status-chip tone-${toneForState(item.state)}`}>
              {labelForState(item.state)}
            </span>
          </div>
          {item.detail || item.effect ? (
            <div className="gh-support-copy">{item.detail || item.effect}</div>
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
          {item.observedAt || item.staleAfter ? (
            <div className="gh-chip-row">
              {item.observedAt ? <span className="gh-chip gh-chip-soft">Observed {item.observedAt}</span> : null}
              {item.staleAfter ? <span className="gh-chip gh-chip-soft">Stale after {item.staleAfter}</span> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function WorkspaceSetupWizard({
  title = "Workspace setup",
  loading = false,
  error = "",
  refreshError = "",
  refreshing = false,
  onRefresh = null,
  status = null,
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const diagnostics = status?.diagnostics || {};
  const setupSummary = diagnostics.setupSummary || diagnostics.summary || {};
  const setupReadiness = diagnostics.setupReadiness || diagnostics.readiness || {};
  const setupSequence = Array.isArray(diagnostics.setupSequence) ? diagnostics.setupSequence : [];
  const claimNarrowing = Array.isArray(setupReadiness.claimNarrowing) ? setupReadiness.claimNarrowing : [];
  const workspaceAccess = diagnostics.workspaceAccess || {};
  const workspaceAccessGates = Array.isArray(workspaceAccess.gates) ? workspaceAccess.gates : [];
  const safeSharingPath = workspaceAccess.queryHistorySharingPath || {};
  const acceptedSharingPaths = Array.isArray(safeSharingPath.acceptedPaths)
    ? safeSharingPath.acceptedPaths
    : [];
  const workloadGate = workspaceAccessGates.find((item) => item?.key === "workload_visibility") || null;
  const blockedSurfaces = Array.isArray(workspaceAccess.blockedSurfaces) ? workspaceAccess.blockedSurfaces : [];
  const featureFlags = Array.isArray(diagnostics.featureFlags) ? diagnostics.featureFlags : [];
  const observedAt = diagnostics.observedAt || workspaceAccess.observedAt || "";
  const readyCount = Number(setupSummary.availableCount || 0);
  const degradedCount = Number(setupSummary.degradedCount || 0);
  const unavailableCount = Number(setupSummary.unavailableCount || 0);
  const unknownCount = Number(setupSummary.unknownCount || 0);
  const validatedSharingPath = String(safeSharingPath.validatedPath || "").trim();
  const sharingState = safeSharingPath.state || "unknown";
  const nextStep = setupReadiness.nextStep || "";
  const readinessNote = useMemo(() => {
    const parts = [
      `${readyCount} ready`,
      `${degradedCount} degraded`,
      `${unavailableCount} unavailable`,
      `${unknownCount} unknown`,
    ];
    if (nextStep) parts.push(`Next ${labelForState(nextStep)}`);
    return parts.join(", ");
  }, [degradedCount, nextStep, readyCount, unavailableCount, unknownCount]);

  if (loading && !status) {
    return (
      <WorkspaceStateCard
        eyebrow="Workspace setup"
        loading
        message="Rerunning setup checks, claim narrowing, and operational-sharing validation for the current workspace."
        title="Loading workspace setup guidance..."
      />
    );
  }

  if (error && !status) {
    return (
      <WorkspaceStateCard
        eyebrow="Workspace setup"
        message={error}
        title="Workspace setup guidance could not be loaded."
        tone="bad"
      />
    );
  }

  return (
    <SurfaceWorkbench className="gh-governance-workbench gh-governance-workbench-single">
      <SurfaceWorkbenchMain className="gh-governance-main-pane" dense>
        <section className="gh-detail-section">
          <SurfaceHeader
            actions={(
              <>
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
                <button
                  className="gh-tertiary-button gh-inline-link-button"
                  onClick={() => setShowDiagnostics((current) => !current)}
                  type="button"
                >
                  {showDiagnostics ? "Hide full diagnostics" : "Show full diagnostics"}
                </button>
              </>
            )}
            className="gh-diagnostics-surface-header"
            eyebrow="Workspace setup"
            identity="Shell-owned readiness truth for the current actor, workspace, and safe operational-sharing path."
            meta={[
              {
                key: "setup-state",
                content: (
                  <span className={`gh-status-chip tone-${toneForState(setupReadiness.state || "unknown")}`}>
                    {labelForState(setupReadiness.state || "unknown")}
                  </span>
                ),
              },
              observedAt ? `Observed ${observedAt}` : null,
            ]}
            title={title}
          >
            <div className="gh-support-copy">
              Use this guide to confirm readiness, understand claim narrowing, and verify how protected
              operational surfaces are shared before widening product claims.
            </div>
          </SurfaceHeader>
          {refreshError ? <InlineStatusBanner message={refreshError} title="Refresh incomplete" /> : null}
          {refreshing ? (
            <InlineStatusBanner
              message="Rerunning runtime setup checks and capability probes against the current workspace."
              title="Refreshing"
            />
          ) : null}
          {setupReadiness.state && setupReadiness.state !== "ready" ? (
            <InlineStatusBanner
              message={
                nextStep
                  ? `Next step: ${labelForState(nextStep)}. Claim-narrowed surfaces stay hidden or explicitly unavailable until this check improves.`
                  : "Claim-narrowed surfaces stay hidden or explicitly unavailable until readiness improves."
              }
              title="Claims narrowed"
            />
          ) : null}

          <div className="gh-task-list gh-task-list-compact">
            <SummaryCard
              label="Setup status"
              note={readinessNote}
              state={
                setupReadiness.state === "attention_required"
                  ? "degraded"
                  : setupReadiness.state === "blocked"
                    ? "unavailable"
                    : setupReadiness.state || "unknown"
              }
              value={labelForState(setupReadiness.state || "unknown")}
            />
            <SummaryCard
              label="Auth mode"
              note={
                diagnostics.auth?.perUserAuthorization?.reason ||
                "The live runtime decides whether actor-scoped protected reads are available."
              }
              state={diagnostics.auth?.perUserAuthorization?.state || "unknown"}
              value={labelForState(diagnostics.auth?.mode || status?.identity?.authMode || "unknown")}
            />
            <SummaryCard
              label="Operational sharing"
              note={
                validatedSharingPath
                  ? `Validated path: ${validatedSharingPath}.`
                  : "Queries, usage, and workload surfaces remain narrowed until one accepted sharing path is validated."
              }
              state={sharingState}
              value={validatedSharingPath || "Required"}
            />
            <SummaryCard
              label="Governance writes"
              note={
                workspaceAccess.canWriteGovernance
                  ? "Governed mutations are available for the current actor and workspace."
                  : "Writes remain disabled until identity, runtime, and governance-store checks are green."
              }
              state={workspaceAccess.canWriteGovernance ? "available" : "unavailable"}
              value={formatAvailability(workspaceAccess.canWriteGovernance)}
            />
          </div>
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Readiness sequence</div>
              <div className="gh-support-copy">
                Ordered setup checks sourced from the live runtime. This is the shell-owned checklist for the
                current workspace, not a second readiness store.
              </div>
            </div>
            <span className="gh-chip gh-chip-soft">{setupSequence.length} steps</span>
          </div>
          {setupSequence.length ? (
            <SetupList items={setupSequence} />
          ) : (
            <EmptyStateBlock
              message="No ordered setup sequence was returned by the runtime yet."
              title="Readiness sequence pending"
            />
          )}
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Safe operational-sharing path</div>
              <div className="gh-support-copy">
                Queries, usage, and workload surfaces stay narrowed until one accepted sharing path is validated.
              </div>
            </div>
            <span className={`gh-status-chip tone-${toneForState(sharingState)}`}>
              {labelForState(sharingState)}
            </span>
          </div>
          {validatedSharingPath ? (
            <InlineStatusBanner
              message={`Validated path: ${validatedSharingPath}.`}
              title="Operational sharing verified"
              tone="good"
            />
          ) : (
            <InlineStatusBanner
              message="No safe-sharing path is validated yet. Queries, usage, and workload surfaces must remain hidden or explicitly unavailable."
              title="Operational sharing required"
            />
          )}
          <AttributeList
            items={[
              { label: "Validated path", value: validatedSharingPath || "Not validated" },
              { label: "Query history", value: formatAvailability(workspaceAccess.canUseQueryHistory) },
              {
                label: "Blocked surfaces",
                value: blockedSurfaces.includes("Queries, usage, and workloads")
                  ? "Queries, usage, and workloads"
                  : blockedSurfaces.length
                    ? blockedSurfaces.join(", ")
                    : "None",
              },
            ]}
          />
          {acceptedSharingPaths.length ? (
            <div className="gh-chip-row">
              {acceptedSharingPaths.map((path) => (
                <span className="gh-chip gh-chip-soft" key={path}>
                  {path}
                </span>
              ))}
            </div>
          ) : null}
          {workloadGate ? <SetupList items={[workloadGate]} /> : null}
        </section>

        <section className="gh-detail-section">
          <div className="gh-governance-section-head">
            <div>
              <div className="gh-panel-title">Claim discipline</div>
              <div className="gh-support-copy">
                Surfaces that must remain narrowed until setup checks turn green.
              </div>
            </div>
            <span className="gh-chip gh-chip-soft">{claimNarrowing.length} narrowed</span>
          </div>
          {claimNarrowing.length ? (
            <SetupList items={claimNarrowing} />
          ) : (
            <EmptyStateBlock
              message="No active claim narrowing is required for the current runtime payload."
              title="Claims at full breadth"
            />
          )}
        </section>

        {showDiagnostics ? (
          <section className="gh-detail-section">
            <div className="gh-governance-section-head">
              <div>
                <div className="gh-panel-title">Full diagnostics</div>
                <div className="gh-support-copy">
                  Raw setup checks, workspace access gates, capability inventory, and client diagnostics.
                </div>
              </div>
            </div>
            <WorkspaceDiagnosticsSurface
              error={error}
              loading={loading}
              refreshError=""
              refreshing={false}
              status={status}
              title="Workspace diagnostics"
            />
          </section>
        ) : null}
      </SurfaceWorkbenchMain>

      <SurfaceRail
        className="gh-governance-side-pane gh-governance-side-pane-dense"
        identity="Current actor, deployment context, and rollout scope for this setup session."
        title="Workspace context"
      >
        <SurfaceRailSection title="Identity">
          <AttributeList
            items={[
              { label: "Actor", value: status?.identity?.actorEmail || "unknown" },
              { label: "Role", value: status?.identity?.actorRole || "Unknown" },
              { label: "Identity source", value: status?.identity?.source || "Unknown" },
            ]}
          />
        </SurfaceRailSection>

        <SurfaceRailSection title="Configuration">
          <AttributeList
            items={[
              { label: "Warehouse", value: status?.config?.warehouseId || "Unconfigured" },
              { label: "Catalog", value: status?.config?.govCatalog || "Unconfigured" },
              { label: "Schema", value: status?.config?.govSchema || "Unconfigured" },
            ]}
          />
        </SurfaceRailSection>

        <SurfaceRailSection title="Scope">
          <AttributeList
            items={[
              { label: "Lineage", value: formatAvailability(workspaceAccess.canUseLineage) },
              { label: "Export", value: formatAvailability(workspaceAccess.canExport) },
              { label: "Background work", value: formatAvailability(workspaceAccess.canRunBackgroundWork) },
              {
                label: "Classification recommendations",
                value: formatAvailability(workspaceAccess.canUseClassificationRecommendations),
              },
            ]}
          />
        </SurfaceRailSection>

        <SurfaceRailSection empty="No blocked surfaces are reported right now." title="Blocked surfaces">
          {blockedSurfaces.length ? (
            <div className="gh-chip-row">
              {blockedSurfaces.map((surface) => (
                <span className="gh-chip gh-chip-soft" key={surface}>
                  {surface}
                </span>
              ))}
            </div>
          ) : null}
        </SurfaceRailSection>

        <SurfaceRailSection title="Feature inventory">
          <div className="gh-support-copy">
            {featureFlags.length
              ? `${featureFlags.length} runtime feature flags are exposed for setup and surface gating.`
              : "No feature-flag inventory is exposed yet."}
          </div>
        </SurfaceRailSection>
      </SurfaceRail>
    </SurfaceWorkbench>
  );
}
