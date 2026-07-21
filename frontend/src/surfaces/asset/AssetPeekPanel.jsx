import "./asset.css";
import { useMemo } from "react";
import { Badge, Button, Drawer, EntityChip } from "../../components/system";
import { useAsset360 } from "../../hooks/useAsset360";
import { useAssetDetail } from "../../hooks/useAssetDetail";
import { useAtlasNavigate } from "../../nav/useAtlasNavigate";
import { AssetTrustHero } from "./AssetTrustHero";

/*
 * AssetPeekPanel — the ?peek=<fqn> quick preview (teardown item 11 / P3-15).
 * Identity + the SAME trust-verdict component the hub renders (so drawer and
 * page can never contradict each other) + a few honest key facts + one door:
 * "Open full record". No dead tabs, no developer "Buildability note" copy.
 *
 * The shell binds ?peek= via nav/usePeek and mounts this with {fqn, open,
 * onClose}; the panel owns its own data (same two parallel queries as the
 * hub, header sections only).
 */

const PEEK_SECTIONS = ["header"];

function fact(label, value) {
  const text = value == null || value === "" ? "—" : String(value);
  return { label, text };
}

export function AssetPeekPanel({ fqn = "", open = true, onClose = null }) {
  const active = Boolean(fqn) && open;
  const detail = useAssetDetail(fqn, { sections: PEEK_SECTIONS, enabled: active });
  const a360 = useAsset360(fqn, { enabled: active });
  const navigate = useAtlasNavigate();

  const asset = detail.detail || (a360.data?.sameAsset ? a360.data.asset : null) || null;
  const freshness = a360.data?.freshness || null;
  const ownership = a360.data?.ownership || null;

  const facts = useMemo(
    () => [
      fact("Type", asset?.objectType),
      fact("Rows", asset?.rows),
      fact("Size", asset?.size),
      fact("Format", asset?.storageFormat || asset?.format),
    ],
    [asset],
  );

  const openFullRecord = () => {
    onClose?.();
    navigate({ kind: "asset", fqn });
  };

  return (
    <Drawer
      open={active}
      onClose={onClose}
      title={asset?.name || fqn}
      className="ga-asset-peek"
      footer={
        <div className="ga-asset-peek-footer">
          <Button variant="primary" tone="accent" onClick={openFullRecord}>
            Open full record
          </Button>
        </div>
      }
    >
      <p className="ga-asset-peek-fqn" title={fqn}>
        {fqn}
      </p>

      <AssetTrustHero
        asset={asset}
        freshness={freshness}
        ownership={ownership}
        hydrating={!asset && (detail.loading || a360.loading)}
        compact
      />

      <dl className="ga-asset-facts ga-asset-peek-facts">
        {facts.map((item) => (
          <div key={item.label} className="ga-asset-fact">
            <dt>{item.label}</dt>
            <dd>{item.text}</dd>
          </div>
        ))}
        {asset?.domain && asset.domain !== "Unassigned" ? (
          <div className="ga-asset-fact">
            <dt>Domain</dt>
            <dd>
              <EntityChip appearance="inline" entity={{ kind: "domain", name: asset.domain }} />
            </dd>
          </div>
        ) : null}
      </dl>

      {detail.error && !asset ? (
        <Badge tone="bad">{detail.error}</Badge>
      ) : null}
    </Drawer>
  );
}

export default AssetPeekPanel;
