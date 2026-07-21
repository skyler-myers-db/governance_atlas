import "../asset.css";
import {
  Badge,
  EntityChip,
  EmptyState,
  LoadingState,
  SectionCard,
  UnavailableState,
} from "../../../components/system";
import { firstHopNeighbors, formatUtcInstant, termRef } from "../format";

/*
 * Overview tab — meaning + first-hop impact + health at a glance
 * (PRODUCT_BLUEPRINT §3a items 2-4). Every entity mention is an EntityChip
 * (cross-linking LAW); every empty state carries its honest reason.
 */

function GlossaryChips({ asset }) {
  const links = Array.isArray(asset?.glossaryLinks) ? asset.glossaryLinks : [];
  const names = Array.isArray(asset?.glossaryTerms) ? asset.glossaryTerms : [];
  const refs = (links.length ? links : names).map(termRef).filter(Boolean);
  if (!refs.length) return null;
  return (
    <div className="ga-asset-chip-row" aria-label="Glossary terms">
      {refs.map((ref, index) => (
        <EntityChip key={`${ref.id || ref.label || index}`} entity={ref} />
      ))}
    </div>
  );
}

function MiniMapColumn({ title, nodes }) {
  return (
    <div className="ga-asset-minimap-col">
      <span className="ga-asset-minimap-col-title">{title}</span>
      {nodes.length ? (
        nodes.map((node) => (
          <EntityChip
            key={node.id}
            appearance="row"
            entity={{ kind: "asset", fqn: node.fqn, label: node.label, meta: node.apiKind || "" }}
          />
        ))
      ) : (
        <span className="ga-asset-minimap-none">None observed</span>
      )}
    </div>
  );
}

function LineageMiniMap({ fqn, graph }) {
  // A pending focus-only stub (server still walking system lineage) must
  // render as loading, not "No first-hop lineage observed" — useLineage sets
  // loading=false once ANY payload exists, so also honor warming/isPolling
  // (Wave-B verifier BLOCK).
  const stillWarming =
    !graph ||
    graph.loading ||
    graph.warming ||
    graph.isPolling ||
    String(graph.meta?.state || "").toLowerCase() === "loading";
  if (stillWarming && !(graph?.edges?.length)) {
    return <LoadingState variant="card" lines={3} />;
  }
  if (graph.error && !graph.nodes.length) {
    return (
      <UnavailableState
        title="Lineage unavailable"
        reason={graph.error}
        onRetry={graph.refresh}
      />
    );
  }
  const { focus, upstream, downstream } = firstHopNeighbors(graph);
  if (!focus || (!upstream.length && !downstream.length)) {
    return (
      <EmptyState
        title="No first-hop lineage observed"
        body={
          String(graph.meta?.emptyReason || "").trim() ||
          "System lineage tables hold no observed edges for this asset yet."
        }
      />
    );
  }
  return (
    <div className="ga-asset-minimap">
      <MiniMapColumn title={`Upstream (${upstream.length})`} nodes={upstream} />
      <div className="ga-asset-minimap-col is-focus">
        <span className="ga-asset-minimap-col-title">Focus</span>
        <span className="ga-asset-minimap-focus">{focus.label || fqn}</span>
      </div>
      <MiniMapColumn title={`Downstream (${downstream.length})`} nodes={downstream} />
    </div>
  );
}

function QualitySummary({ fqn, quality }) {
  const state = String(quality?.state || "").toLowerCase();
  if (!quality || state === "loading") return <LoadingState variant="card" lines={2} />;
  if (state !== "available") {
    return (
      <UnavailableState
        title="No quality evidence"
        reason={quality?.message || "No quality checks have run for this asset."}
      />
    );
  }
  const run = quality.latestRun || {};
  const outcomes = run.outcomes || {};
  const evidence = formatUtcInstant(quality.evidenceAt);
  return (
    <div className="ga-asset-quality-summary">
      <div className="ga-asset-chip-row">
        <Badge tone={Number(outcomes.failed) > 0 ? "bad" : "good"}>
          {Number(outcomes.failed) > 0 ? `${outcomes.failed} failed` : "All checks passed"}
        </Badge>
        {Number(outcomes.passed) > 0 ? <Badge tone="good">{outcomes.passed} passed</Badge> : null}
        {Number(outcomes.errored) > 0 ? <Badge tone="warn">{outcomes.errored} errored</Badge> : null}
      </div>
      {evidence ? (
        <p className="ga-asset-evidence-line" title={evidence.iso}>
          Evidence from {evidence.display}
        </p>
      ) : null}
      <EntityChip entity={{ kind: "quality", fqn, run: run.runId || undefined, label: "View findings in Evidence" }} />
    </div>
  );
}

function UsageSources({ usage }) {
  const sources = usage?.sources || {};
  const entries = ["downstreamAssets", "consumers", "queries"]
    .map((key) => sources[key])
    .filter(Boolean);
  if (!entries.length) {
    return <UnavailableState title="Usage unavailable" reason="No usage sources were returned." />;
  }
  return (
    <ul className="ga-asset-usage-list">
      {entries.map((source) => (
        <li key={source.source || source.label} className="ga-asset-usage-row">
          <span className="ga-asset-usage-label">
            {source.label}
            <span className="ga-asset-usage-source">({source.source})</span>
          </span>
          {String(source.state).toLowerCase() === "available" ? (
            <strong>{source.count}</strong>
          ) : (
            <span className="ga-asset-usage-reason" title={source.reason || undefined}>
              — {String(source.state).toLowerCase() === "loading" ? "loading" : "unavailable"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function OverviewTab({ fqn, asset, a360, graph, detailLoading }) {
  const description = String(asset?.description || "").trim();
  const domain = String(asset?.domain || "").trim();
  const dataProduct = String(asset?.dataProduct || "").trim();
  const openRequests = Number(asset?.openRequests);
  const related = Array.isArray(a360?.relatedAssets) ? a360.relatedAssets : [];
  const a360Ready = Boolean(a360);

  return (
    <div className="ga-asset-tab-grid">
      <SectionCard title="About" className="ga-asset-about-card">
        {detailLoading && !asset ? (
          <LoadingState variant="card" lines={3} />
        ) : (
          <>
            {description ? (
              <p className="ga-asset-description">{description}</p>
            ) : (
              <p className="ga-asset-description is-empty">
                No description has been captured for this asset yet.
              </p>
            )}
            <div className="ga-asset-chip-row">
              {domain && domain !== "Unassigned" ? (
                <EntityChip entity={{ kind: "domain", name: domain, label: `Domain: ${domain}` }} />
              ) : null}
              {dataProduct ? <Badge tone="neutral">Data product: {dataProduct}</Badge> : null}
              {Number.isFinite(openRequests) && openRequests > 0 ? (
                <EntityChip
                  entity={{
                    surface: "stewardship",
                    params: { asset: fqn },
                    label: `${openRequests} open request${openRequests === 1 ? "" : "s"}`,
                  }}
                />
              ) : Number.isFinite(openRequests) ? (
                <Badge tone="muted">No open requests</Badge>
              ) : null}
            </div>
            <GlossaryChips asset={asset} />
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Lineage at a glance"
        subtitle="First-hop upstream and downstream from the live lineage graph."
        actions={<EntityChip entity={{ kind: "lineage", fqn, label: "Open in Lineage Atlas" }} />}
      >
        <LineageMiniMap fqn={fqn} graph={graph} />
      </SectionCard>

      <SectionCard title="Quality">
        {a360Ready ? (
          <QualitySummary fqn={fqn} quality={a360.quality} />
        ) : (
          <LoadingState variant="card" lines={2} />
        )}
      </SectionCard>

      <SectionCard
        title="Usage"
        subtitle="Lifetime totals per source — no time window exists for these counts."
      >
        {a360Ready ? <UsageSources usage={a360.usage} /> : <LoadingState variant="card" lines={3} />}
      </SectionCard>

      <SectionCard title="Related assets">
        {!a360Ready ? (
          <LoadingState variant="card" lines={2} />
        ) : related.length ? (
          <div className="ga-asset-chip-row">
            {related
              .filter((item) => item?.fqn)
              .map((item) => (
                <EntityChip key={item.fqn} entity={{ kind: "asset", fqn: item.fqn }} />
              ))}
          </div>
        ) : (
          <EmptyState
            title="No related assets observed"
            body="Lineage-derived relationships appear here once observed."
          />
        )}
      </SectionCard>
    </div>
  );
}

export default OverviewTab;
