import "./lineage.css";
import { EntityChip, PageShell } from "../../components/system";
import { usePaletteSearch } from "../../hooks/usePaletteSearch";
import { useLineageRecommendations } from "../../hooks/useLineageRecommendations";
import { useSurfaceParams } from "../../nav/useSurfaceParams";
import { LineageRecommendations } from "./LineageRecommendations.jsx";

/*
 * surfaces/lineage/LineagePicker.jsx — bare /lineage (Wave C7).
 *
 * COHESION law: /lineage/<fqn> is canonical; bare /lineage is a search-first
 * asset picker. This replaces BOTH legacy behaviors of the old landing: the
 * jargon empty-hero (system.access.table_lineage copy + node-type legend)
 * AND the silent auto-redirect to the top ranked recommendation — the user
 * now picks an anchor deliberately. Every candidate is an EntityChip
 * (a real <a href="/lineage/<fqn>">), so anchors are middle-clickable and
 * shareable. ?q= keeps the search addressable/restorable.
 */

// Mirrors the nav/routes.js bare-lineage paramsSchema; module-level so
// useSurfaceParams normalizes it once.
const PICKER_PARAMS_SCHEMA = {
  q: { type: "string" },
};

function assetPathMeta(candidate) {
  return (
    [candidate.catalogName, candidate.schemaName].filter(Boolean).join(" / ") ||
    candidate.fqn ||
    ""
  );
}

export function LineagePicker() {
  const [params, setParams] = useSurfaceParams(PICKER_PARAMS_SCHEMA);
  const query = params.q || "";
  const search = usePaletteSearch(query);
  const recommendations = useLineageRecommendations({ enabled: true, limit: 8 });
  const items = (recommendations.items || [])
    .filter((item) => item.fqn)
    .sort((left, right) => Number(right.edgeCount || 0) - Number(left.edgeCount || 0));
  const recommendationsDegraded = Boolean(
    recommendations.degraded ||
      recommendations.authoritative === false ||
      String(recommendations.visibilityScope || "").includes("workspace-app-principal"),
  );

  return (
    <PageShell
      className="ga-lin-page"
      eyebrow="Knowledge & Proof"
      title="Lineage Atlas"
      subtitle="Pick a governed asset to open its permission-aware lineage graph — upstream sources through to permitted downstream consumers."
    >
      <div className="ga-lin-picker">
        <div className="ga-lin-picker-search">
          <label className="ga-lin-picker-label" htmlFor="ga-lin-picker-input">
            Search for an asset
          </label>
          <input
            autoFocus
            className="ga-lin-search-input"
            id="ga-lin-picker-input"
            onChange={(event) => setParams({ q: event.target.value })}
            placeholder="Search for an asset"
            type="search"
            value={query}
          />
          <div className="ga-lin-picker-results">
            {search.searching ? (
              <div className="ga-lin-picker-status" role="status">Searching assets…</div>
            ) : search.searchError ? (
              <div className="ga-lin-picker-status">{search.searchError}</div>
            ) : search.assets.length ? (
              search.assets.slice(0, 8).map((candidate) => (
                <EntityChip
                  appearance="row"
                  className="ga-lin-rec-row"
                  entity={{
                    kind: "lineage",
                    fqn: candidate.fqn,
                    label: candidate.name || candidate.fqn,
                    meta: assetPathMeta(candidate),
                  }}
                  key={candidate.fqn}
                />
              ))
            ) : query.trim() ? (
              <div className="ga-lin-picker-status">No matching assets.</div>
            ) : (
              <div className="ga-lin-picker-status">Start typing to find an asset, or open a ranked candidate below.</div>
            )}
          </div>
        </div>
        <div className="ga-lin-picker-recommendations">
          <div className="ga-lineage-v2-section-title">
            <span>High-lineage assets</span>
            <small>
              {recommendationsDegraded
                ? "Ranked from degraded Databricks lineage evidence"
                : "Ranked from the Unity Catalog lineage you can see"}
            </small>
          </div>
          <LineageRecommendations
            degraded={recommendationsDegraded}
            error={recommendations.error}
            loading={recommendations.loading}
            recommendations={items}
          />
        </div>
      </div>
    </PageShell>
  );
}

export default LineagePicker;
