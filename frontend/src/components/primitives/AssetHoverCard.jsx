import { useEffect, useRef, useState } from "react";
import { AssetTypeIcon } from "./AssetTypeIcon";
import { OwnerAvatarStack } from "./OwnerAvatar";

/**
 * AssetHoverCard — hover the asset icon to see a compact inline
 * preview (description + owners + top 3 columns) without navigating.
 *
 * Uses the existing useAssetDetail cache so the first hover is free if
 * the catalog row has already primed the detail.
 */

export function AssetHoverCard({ asset, anchorRef, onClose }) {
  const cardRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const cardH = 260;
    const cardW = 360;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + 8;
    let left = rect.left;
    if (top + cardH > vh) top = Math.max(10, rect.top - cardH - 8);
    if (left + cardW > vw) left = Math.max(10, vw - cardW - 14);
    setPosition({ top, left });
  }, [anchorRef]);

  const columns = (asset?.columns || []).slice(0, 4);
  const owners = (asset?.owners || []).map((o) => o?.email || o?.name || o).filter(Boolean);

  return (
    <div
      className="gh-asset-hover-card"
      onMouseLeave={onClose}
      ref={cardRef}
      role="tooltip"
      style={{ top: position.top, left: position.left }}
    >
      <div className="gh-asset-hover-head">
        <AssetTypeIcon asset={asset} size="md" />
        <div className="gh-asset-hover-title-block">
          <div className="gh-asset-hover-title" title={asset?.name || asset?.fqn}>
            {asset?.name || asset?.fqn}
          </div>
          <div className="gh-asset-hover-path" title={asset?.fqn}>{asset?.fqn}</div>
        </div>
      </div>
      {asset?.description ? (
        <div className="gh-asset-hover-desc">{asset.description}</div>
      ) : (
        <div className="gh-asset-hover-desc gh-asset-hover-desc-empty">No description yet.</div>
      )}
      <div className="gh-asset-hover-meta">
        <div className="gh-asset-hover-meta-row">
          <span className="gh-asset-hover-meta-label">Owners</span>
          <span className="gh-asset-hover-meta-value">
            {owners.length ? <OwnerAvatarStack owners={owners} size={18} limit={3} /> : "—"}
          </span>
        </div>
        <div className="gh-asset-hover-meta-row">
          <span className="gh-asset-hover-meta-label">Tier</span>
          <span className="gh-asset-hover-meta-value">{asset?.tier || "—"}</span>
        </div>
        <div className="gh-asset-hover-meta-row">
          <span className="gh-asset-hover-meta-label">Domain</span>
          <span className="gh-asset-hover-meta-value">{asset?.domain || "—"}</span>
        </div>
      </div>
      {columns.length ? (
        <div className="gh-asset-hover-cols">
          <div className="gh-asset-hover-cols-label">Top columns</div>
          {columns.map((c) => (
            <div className="gh-asset-hover-col" key={c.name}>
              <span className="gh-asset-hover-col-name">{c.name}</span>
              <span className="gh-asset-hover-col-type">{c.type}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Wraps an anchor + shows the hover card after a 250ms delay. */
export function WithAssetHoverCard({ asset, children }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef(null);

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), 250);
  };
  const handleLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  return (
    <span
      className="gh-asset-hover-anchor"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      ref={anchorRef}
    >
      {children}
      {open ? <AssetHoverCard anchorRef={anchorRef} asset={asset} onClose={handleLeave} /> : null}
    </span>
  );
}
