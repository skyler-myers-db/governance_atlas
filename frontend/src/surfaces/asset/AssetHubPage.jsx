import "./asset.css";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  EntityChip,
  PageShell,
  TabStrip,
} from "../../components/system";
import { useAsset360 } from "../../hooks/useAsset360";
import { invalidateAssetDetail, useAssetDetail } from "../../hooks/useAssetDetail";
import { useAssetMetadataEditor } from "../../hooks/useAssetMetadataEditor";
import { useLineageGraphV2 } from "../../components/lineage-v2/useLineageGraphV2";
import { useAtlasNavigate } from "../../nav/useAtlasNavigate";
import { useSurfaceParams } from "../../nav/useSurfaceParams";
import { AssetHeaderActions } from "./AssetHeaderActions";
import { AssetTrustHero } from "./AssetTrustHero";
import { AccessTab } from "./tabs/AccessTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { ColumnsTab } from "./tabs/ColumnsTab";
import { LineageTab } from "./tabs/LineageTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { QualityTab } from "./tabs/QualityTab";

/*
 * AssetHubPage — the Asset 360 hub, rebuilt on the system kit (Wave B2,
 * FRONTEND_BLUEPRINT §10 / ASSET360_TEARDOWN rebuild spec).
 *
 * Data contract: TWO PARALLEL queries — useAssetDetail(sections-per-tab) and
 * useAsset360 — replacing the old 4-stage waterfall. The 360 composite never
 * waits on detail; whichever answers first seeds the record header, and the
 * header persists across tab switches with per-section skeletons only
 * (teardown P0-2: the whole-page shell regression is structurally impossible
 * here because nothing gates the frame on a per-request pending flag).
 */

// Sections requested per tab. The canonical detail cache merges across
// requests, so switching tabs only fetches what is missing.
const SECTIONS_BY_TAB = {
  overview: ["header"],
  columns: ["header", "schema"],
  quality: ["header"],
  access: ["header"],
  activity: ["header", "activity"],
  lineage: ["header"],
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "columns", label: "Columns" },
  { key: "quality", label: "Quality" },
  { key: "access", label: "Access" },
  { key: "activity", label: "Activity" },
  { key: "lineage", label: "Lineage" },
];

// Matches nav/routes.js `/assets/:fqn` paramsSchema (tab + col); module-level
// constant so useSurfaceParams normalizes it once.
const PARAMS_SCHEMA = {
  tab: { type: "string", default: "overview" },
  col: { type: "string" },
};

function decodeFqnParam(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // malformed escapes degrade to the raw path segment
  }
}

/**
 * Freshness model: prefer the /360 freshness block (payload labels, split
 * fields — Wave A4); before it lands, derive an equivalent block from the
 * detail record's split fields so the hero never waits on the composite.
 */
function resolveFreshness(a360Data, asset) {
  const composite = a360Data?.freshness || null;
  const compositeState = String(composite?.state || "").toLowerCase();
  if (composite && compositeState === "available") return composite;
  const dataUpdatedAt = String(asset?.dataUpdatedAt || "").trim();
  const lastAltered = String(asset?.lastAltered || "").trim();
  if (dataUpdatedAt || lastAltered) {
    return {
      state: "available",
      dataUpdatedAt,
      lastAltered,
      labels: { dataUpdatedAt: "Data updated", lastAltered: "Metadata changed" },
      message: "",
    };
  }
  return composite; // loading / degraded / unavailable — or null while waiting
}

/**
 * Ownership model: the /360 `ownership` block carries exact-title role picks
 * (no regex shadowing — teardown P2-10). Until it lands, the detail record's
 * flat role fields (base_asset_payload) provide the same distinct roles.
 */
function resolveOwnership(a360Data, asset) {
  const roles = a360Data?.ownership || null;
  if (roles && (roles.ucOwner || roles.businessOwner || roles.steward)) return roles;
  if (!asset) return roles;
  const entry = (value) => {
    const name = String(value || "").trim();
    return name ? { name } : null;
  };
  const fallback = {
    ucOwner: entry(asset.ucOwner),
    businessOwner: entry(asset.businessOwner),
    technicalOwner: entry(asset.technicalOwner),
    steward: entry(asset.steward),
  };
  if (fallback.ucOwner || fallback.businessOwner || fallback.steward) return fallback;
  return roles;
}

export function AssetHubPage() {
  const routeParams = useParams();
  const fqn = decodeFqnParam(routeParams.fqn ?? routeParams["*"]);
  const [params, setParams] = useSurfaceParams(PARAMS_SCHEMA);
  const navigate = useAtlasNavigate();

  const tab = TABS.some((entry) => entry.key === params.tab) ? params.tab : "overview";
  const sections = SECTIONS_BY_TAB[tab] || SECTIONS_BY_TAB.overview;

  // --- The two PARALLEL queries (never sequenced). -----------------------
  const detail = useAssetDetail(fqn, { sections });
  const a360 = useAsset360(fqn);
  // Lineage feeds the Overview mini-map, the Lineage tab canvas AND the
  // header button label from ONE query, so they can never disagree.
  const lineageActive = tab === "overview" || tab === "lineage";
  const graph = useLineageGraphV2(fqn, { enabled: Boolean(fqn) && lineageActive });
  const editor = useAssetMetadataEditor({ assetFqn: fqn, asset: detail.detail, bootstrap: null });

  // Optimistic certification badge: shown immediately after a successful
  // write, cleared once the refetched record confirms (or the asset changes).
  const [certOverride, setCertOverride] = useState(null);
  useEffect(() => {
    setCertOverride(null);
  }, [fqn]);

  const baseAsset =
    detail.detail || (a360.data?.sameAsset ? a360.data.asset : null) || null;
  useEffect(() => {
    if (certOverride !== null && String(baseAsset?.certification ?? "") === certOverride) {
      setCertOverride(null);
    }
  }, [baseAsset?.certification, certOverride]);

  const asset = useMemo(() => {
    if (!baseAsset) return null;
    return certOverride !== null ? { ...baseAsset, certification: certOverride } : baseAsset;
  }, [baseAsset, certOverride]);

  const freshness = resolveFreshness(a360.data, asset);
  const ownership = resolveOwnership(a360.data, asset);
  const heroHydrating = !asset && (detail.loading || a360.loading);

  // Failure contract (PRODUCT §3a): the hub never collapses to a dead end —
  // the frame + retry stay up, and only the failing sections go honest-empty.
  const pageStatus =
    detail.error && !asset
      ? { status: "error", reason: detail.error, refresh: detail.retry }
      : null;

  const tabDefs = useMemo(() => {
    const columnCount = Array.isArray(asset?.columns) && asset.columns.length
      ? asset.columns.length
      : Number(asset?.columnCount) || 0;
    return TABS.map((entry) =>
      entry.key === "columns" && columnCount
        ? { ...entry, badge: String(columnCount) }
        : entry,
    );
  }, [asset]);

  const afterWrite = () => {
    // Re-sync both parallel sources after any governance write so the badge,
    // open-request chip and activity feed reflect persisted truth.
    invalidateAssetDetail(fqn);
    a360.refetch();
  };

  const title = asset?.name || fqn.split(".").pop() || "Asset";
  const identity = [asset?.objectType, asset?.catalog && asset?.schema ? `${asset.catalog}.${asset.schema}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageShell
      className="ga-asset-page"
      eyebrow="Asset 360"
      title={title}
      subtitle={identity || fqn}
      status={pageStatus}
      onRetry={detail.retry}
      breadcrumbs={
        <span className="ga-asset-breadcrumbs">
          {asset?.catalog ? (
            <EntityChip appearance="inline" entity={{ kind: "catalog", name: asset.catalog }} />
          ) : null}
          <span className="ga-asset-breadcrumb-fqn" title={fqn}>
            {fqn}
          </span>
        </span>
      }
      actions={
        fqn ? (
          <AssetHeaderActions
            fqn={fqn}
            editor={editor}
            access={a360.data?.access || null}
            graph={graph}
            onCertified={(value) => setCertOverride(value)}
            onAfterWrite={afterWrite}
          />
        ) : null
      }
      tabs={
        <TabStrip
          ariaLabel="Asset record sections"
          tabs={tabDefs}
          param={{ value: tab, set: (key) => setParams({ tab: key }) }}
        />
      }
    >
      <AssetTrustHero
        asset={asset}
        freshness={freshness}
        ownership={ownership}
        hydrating={heroHydrating}
      />

      {tab === "overview" ? (
        <OverviewTab
          fqn={fqn}
          asset={asset}
          a360={a360.data}
          graph={graph}
          detailLoading={detail.loading}
        />
      ) : null}
      {tab === "columns" ? (
        <ColumnsTab asset={asset} loading={detail.loading} highlightCol={params.col} />
      ) : null}
      {tab === "quality" ? <QualityTab fqn={fqn} quality={a360.data?.quality || null} /> : null}
      {tab === "access" ? <AccessTab access={a360.data?.access || null} /> : null}
      {tab === "activity" ? <ActivityTab a360={a360.data} a360Loading={a360.loading} /> : null}
      {tab === "lineage" ? (
        <LineageTab
          fqn={fqn}
          graph={graph}
          onFocusChange={(nextFqn) =>
            // Re-anchoring inside the embed opens that asset's own record,
            // staying on the lineage view (hub-and-spoke law).
            navigate({ kind: "asset", fqn: nextFqn }, { params: { tab: "lineage" } })
          }
        />
      ) : null}
    </PageShell>
  );
}

export default AssetHubPage;
