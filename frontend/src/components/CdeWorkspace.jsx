import { useEffect, useMemo, useState } from "react";
import { fetchCdeRegistry } from "../lib/api";
import { SurfaceHeader } from "./ShellLayoutPrimitives";
import { WorkspaceStateCard } from "./ShellStatePrimitives";

function ownerSummary(owners) {
  if (!Array.isArray(owners)) return "";
  const names = owners
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const name =
        entry.name || entry.displayName || entry.ownerEmail || entry.email || "";
      return String(name).trim();
    })
    .filter(Boolean);
  if (!names.length) return "";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

function CdeAssetCard({ asset, onOpenAsset, onOpenLineage }) {
  const owners = ownerSummary(asset.owners);
  const rationale = asset.cdeRationale;
  const coverage =
    typeof asset.coverageScore === "number" ? `${asset.coverageScore}%` : "—";
  return (
    <article className="gh-cde-card gh-panel">
      <header className="gh-cde-card-head">
        <div className="gh-cde-card-title-block">
          <div className="gh-eyebrow">
            {asset.catalog || "—"} / {asset.schema || "—"}
          </div>
          <h3 className="gh-cde-card-title">{asset.name || asset.fqn}</h3>
          <code className="gh-cde-card-fqn">{asset.fqn}</code>
        </div>
        <div className="gh-cde-card-actions">
          {onOpenAsset ? (
            <button
              className="gh-secondary-button"
              onClick={() => onOpenAsset(asset.fqn)}
              type="button"
            >
              Open asset
            </button>
          ) : null}
          {onOpenLineage ? (
            <button
              className="gh-tertiary-button"
              onClick={() => onOpenLineage(asset.fqn)}
              type="button"
            >
              View lineage
            </button>
          ) : null}
        </div>
      </header>
      <dl className="gh-cde-card-grid">
        <div>
          <dt>Tier</dt>
          <dd>{asset.tier || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Business Criticality</dt>
          <dd>{asset.businessCriticality || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Governance</dt>
          <dd>{asset.governanceStatus || "Needs Work"}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{coverage}</dd>
        </div>
        <div>
          <dt>Owners</dt>
          <dd>{owners || "—"}</dd>
        </div>
        <div>
          <dt>Glossary</dt>
          <dd>{asset.glossaryTerm || "—"}</dd>
        </div>
      </dl>
      {rationale ? (
        <div className="gh-cde-card-rationale">
          <div className="gh-eyebrow">Why it's a CDE</div>
          <p>{rationale}</p>
        </div>
      ) : null}
      {asset.description ? (
        <p className="gh-cde-card-description">{asset.description}</p>
      ) : null}
    </article>
  );
}

export default function CdeWorkspace({
  onSurfaceReady,
  onNavigationStateChange,
  onOpenAsset,
  onOpenLineage,
}) {
  const [registry, setRegistry] = useState({
    total: 0,
    domainGroups: [],
    domainFilter: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const domains = selectedDomain ? [selectedDomain] : undefined;
    fetchCdeRegistry({ domains })
      .then((payload) => {
        if (cancelled) return;
        setRegistry({
          total: Number(payload?.total || 0),
          domainGroups: Array.isArray(payload?.domainGroups)
            ? payload.domainGroups
            : [],
          domainFilter: payload?.domainFilter || null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load the CDE registry.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        onSurfaceReady?.();
      });
    return () => {
      cancelled = true;
    };
  }, [onSurfaceReady, selectedDomain]);

  useEffect(() => {
    onNavigationStateChange?.({ surface: "cde" });
  }, [onNavigationStateChange]);

  const domainOptions = useMemo(() => {
    const fromFilter = Array.isArray(registry?.domainFilter?.options)
      ? registry.domainFilter.options
      : [];
    return fromFilter.length
      ? fromFilter
      : registry.domainGroups.map((group) => group.domain);
  }, [registry]);

  const totalCopy = useMemo(() => {
    if (loading) return "Loading the CDE registry…";
    if (!registry.total)
      return "No assets are currently flagged as Critical Data Elements.";
    return `${registry.total} asset${registry.total === 1 ? "" : "s"} flagged as Critical Data Elements`;
  }, [loading, registry.total]);

  return (
    <section className="gh-cde-surface">
      <SurfaceHeader
        eyebrow="Governance"
        title="Critical Data Elements"
      >
        <p className="gh-support-copy">
          Assets flagged as Critical Data Elements, grouped by owning domain.
          Mark or unmark CDEs from any asset's Overview tab — the tag is
          round-tripped to Unity Catalog.
        </p>
      </SurfaceHeader>

      {error ? (
        <WorkspaceStateCard
          eyebrow="CDE Registry"
          message={error}
          title="We couldn't load the CDE registry"
          tone="warn"
        />
      ) : null}

      <div className="gh-cde-toolbar gh-panel">
        <div className="gh-cde-toolbar-summary">{totalCopy}</div>
        <label className="gh-cde-toolbar-filter">
          <span>Domain</span>
          <select
            className="gh-select"
            onChange={(event) => setSelectedDomain(event.target.value)}
            value={selectedDomain}
          >
            <option value="">All domains</option>
            {domainOptions.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && !registry.domainGroups.length ? (
        <div className="gh-cde-placeholder">Loading the CDE registry…</div>
      ) : null}

      {!loading && !registry.domainGroups.length ? (
        <WorkspaceStateCard
          eyebrow="Empty registry"
          message="Flag an asset as a Critical Data Element from its Overview tab. It will appear here automatically."
          title="No CDEs defined yet"
        />
      ) : null}

      <div className="gh-cde-domain-grid">
        {registry.domainGroups.map((group) => (
          <section className="gh-cde-domain-column gh-panel" key={group.domain}>
            <header className="gh-cde-domain-head">
              <div>
                <div className="gh-eyebrow">Domain</div>
                <h2>{group.domain}</h2>
              </div>
              <span className="gh-chip gh-chip-soft">{group.count}</span>
            </header>
            <div className="gh-cde-asset-list">
              {group.assets.map((asset) => (
                <CdeAssetCard
                  asset={asset}
                  key={asset.fqn}
                  onOpenAsset={onOpenAsset}
                  onOpenLineage={onOpenLineage}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
