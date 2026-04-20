import { useEffect, useState } from "react";

import { SurfaceHeader } from "../ShellLayoutPrimitives";
import { InlineStatusBanner } from "../ShellStatePrimitives";
import { AssetTypeIcon } from "./AssetTypeIcon";
import { Breadcrumbs } from "./Breadcrumbs";
import { OwnerAvatar } from "./OwnerAvatar";
import { OwnerAvatarStack } from "./OwnerAvatarStack";

function readPinnedSet() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage?.getItem?.("gh-pinned-assets");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter(Boolean));
  } catch {
    /* corrupted — start fresh */
  }
  return new Set();
}

function writePinnedSet(set) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.("gh-pinned-assets", JSON.stringify([...set]));
  } catch {
    /* localStorage may be unavailable */
  }
}

function statusTone(asset) {
  if (!asset?.governanceStatus) return "neutral";
  if (asset?.governanceStatus === "Enterprise Ready") return "good";
  if (asset?.governanceStatus === "Operational") return "warn";
  return "bad";
}

// Owners on the asset payload come in two flavours: bare strings (email) from
// the discovery bootstrap, or { name, email } objects from the governance
// service. Normalise to { label, title } so the hero chip row renders the
// same regardless of source.
function primaryOwnerFromAsset(asset) {
  const owners = Array.isArray(asset?.owners) ? asset.owners : [];
  if (!owners.length) return null;
  const first = owners[0];
  if (!first) return null;
  if (typeof first === "string") {
    return { label: first, title: first };
  }
  const label = first.name || first.email || first.ownerEmail || first.title || "";
  if (!label) return null;
  return { label, title: first.email || first.ownerEmail || label };
}

// Humanize an email-y owner label for inline rendering next to the avatar
// (so "ada.lovelace@example.com" becomes "Ada Lovelace" but "Ada Lovelace"
// stays "Ada Lovelace"). Mirrors DiscoveryWorkspace.prettyOwnerName.
function prettyOwnerLabel(label = "") {
  const raw = String(label || "").trim();
  if (!raw) return "";
  const local = raw.includes("@") ? raw.split("@")[0] : raw;
  const parts = local.split(/[\s._+-]+/).filter(Boolean);
  if (!parts.length) return raw;
  return parts
    .slice(0, 2)
    .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function EntityHero({
  asset,
  identityLine,
  objectType,
  liveDetailStatus,
  detailUnavailable,
  assetDetail,
  linkNotice,
  lineageSurfaceAvailable,
  lineageAccessPending,
  lineageSurfaceUnavailableReason,
  onOpenLineage,
  onOpenGovernance,
  onNavigationStateChange,
  onBack,
}) {
  // Phase 2-i.8 — hero share-link + pin toggle.
  // Share copies the current URL to the clipboard and flashes a short
  // "Copied" label on the button. Pin persists asset.fqn under a local
  // "pinned assets" set so stewards can find recently-touched records
  // without re-searching. Server-side pinning / subscribe notifications
  // are explicitly deferred — those need a Phase 5 notification hook.
  const [shareLabel, setShareLabel] = useState("Share link");
  const [pinned, setPinned] = useState(() => {
    const set = readPinnedSet();
    return set.has(asset?.fqn || "");
  });
  useEffect(() => {
    const set = readPinnedSet();
    setPinned(set.has(asset?.fqn || ""));
  }, [asset?.fqn]);
  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = window.location?.href || "";
    if (!url) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement("textarea");
        el.value = url;
        el.setAttribute("readonly", "");
        el.style.position = "absolute";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setShareLabel("Link copied");
    } catch {
      setShareLabel("Copy failed");
    }
    setTimeout(() => setShareLabel("Share link"), 1800);
  };
  const handlePinToggle = () => {
    const fqn = asset?.fqn || "";
    if (!fqn) return;
    const set = readPinnedSet();
    if (set.has(fqn)) {
      set.delete(fqn);
      setPinned(false);
    } else {
      set.add(fqn);
      setPinned(true);
    }
    writePinnedSet(set);
  };

  const heroTitle = (
    <span className="gh-entity-hero-title">
      <AssetTypeIcon asset={asset} size="xl" />
      <span>{asset.name}</span>
    </span>
  );
  // Breadcrumbs show the containing path only — the asset name is already the
  // hero title below. Rendering it here too would duplicate it (and break
  // getByText queries). End the trail at the schema.
  const breadcrumbItems = [
    {
      key: "discovery",
      label: "Discovery",
      onClick: () => {
        onNavigationStateChange?.(true, "Returning to discovery…");
        onBack();
      },
    },
    asset?.catalog ? { key: "catalog", label: asset.catalog } : null,
    asset?.schema ? { key: "schema", label: asset.schema } : null,
  ].filter(Boolean);
  return (
    <div className="gh-entity-record-header">
      <Breadcrumbs className="gh-entity-record-breadcrumbs" items={breadcrumbItems} />
      <SurfaceHeader
        className="gh-entity-record-main"
        eyebrow="Metadata Record"
        identity={identityLine}
        title={heroTitle}
        variant="featured"
        actions={(
          <div className="gh-action-row gh-entity-action-row">
            {Array.isArray(asset.owners) && asset.owners.length ? (
              <OwnerAvatarStack owners={asset.owners} className="gh-entity-owner-stack" />
            ) : null}
            <button
              aria-pressed={pinned}
              className={`gh-tertiary-button gh-entity-hero-utility gh-entity-pin-toggle ${pinned ? "is-pinned" : ""}`.trim()}
              onClick={handlePinToggle}
              title={pinned ? "Unpin this asset from your pinned list" : "Pin this asset to your pinned list"}
              type="button"
            >
              {pinned ? "★ Pinned" : "☆ Pin"}
            </button>
            <button
              className="gh-tertiary-button gh-entity-hero-utility"
              onClick={handleShare}
              title="Copy a direct link to this record to your clipboard"
              type="button"
            >
              {shareLabel}
            </button>
            <button
              className="gh-secondary-button"
              disabled={!lineageSurfaceAvailable}
              onClick={() => {
                onNavigationStateChange?.(true, "Opening lineage…");
                onOpenLineage(asset.fqn, "Data Lineage");
              }}
              title={
                lineageAccessPending
                  ? "Checking actor-scoped lineage access for this route."
                  : !lineageSurfaceAvailable
                    ? lineageSurfaceUnavailableReason
                    : undefined
              }
              type="button"
            >
              {lineageAccessPending
                ? "Checking lineage access..."
                : lineageSurfaceAvailable
                  ? "Open Lineage"
                  : "Lineage unavailable"}
            </button>
            <button
              className="gh-secondary-button"
              onClick={() => {
                onNavigationStateChange?.(true, "Opening governance…");
                onOpenGovernance(asset.fqn);
              }}
              type="button"
            >
              Open Governance
            </button>
          </div>
        )}
      >
        <button
          className="gh-tertiary-button gh-inline-link-button gh-entity-record-backlink"
          onClick={() => {
            onNavigationStateChange?.(true, "Returning to discovery…");
            onBack();
          }}
          type="button"
        >
          Back to Discovery
        </button>
        <div className="gh-chip-row">
          {objectType ? <span className="gh-chip gh-chip-soft">{objectType}</span> : null}
          {asset.governanceStatus ? (
            <span className={`gh-status-chip tone-${statusTone(asset)}`}>
              {asset.governanceStatus}
            </span>
          ) : null}
          {liveDetailStatus ? <span className="gh-chip gh-chip-soft">{liveDetailStatus}</span> : null}
          {asset.domain && asset.domain !== "Unassigned" ? (
            <span className="gh-chip gh-chip-soft">{asset.domain}</span>
          ) : null}
          {asset.certification && asset.certification !== "Unassigned" ? (
            <span className="gh-chip gh-chip-soft">{asset.certification}</span>
          ) : null}
          {asset.sensitivity && asset.sensitivity !== "Unassigned" ? (
            <span className="gh-chip gh-chip-soft">{asset.sensitivity}</span>
          ) : null}
        </div>
        <EntityHeroChipRow asset={asset} />

        {detailUnavailable ? (
          <div className="gh-support-copy">
            {assetDetail.error ||
              "Live record details could not be refreshed right now. Schema, preview, and lineage sections may be incomplete."}
          </div>
        ) : assetDetail.loading ? (
          <div className="gh-support-copy">Refreshing live record details...</div>
        ) : null}
        {linkNotice ? <InlineStatusBanner message={linkNotice} title="Navigation limited" /> : null}
      </SurfaceHeader>
    </div>
  );
}

// A4.1 — compact identity chip strip rendered directly under the hero title
// so stewards can read domain / tier / owner / usage / environment at a
// glance without scanning the right-hand "Live Record Signals" panel. Each
// chip is optional — we render only the fields actually present on the
// asset payload. The right panel still owns the complete detail view.
export function EntityHeroChipRow({ asset }) {
  if (!asset) return null;
  const owner = primaryOwnerFromAsset(asset);
  const domain = asset.domain && asset.domain !== "Unassigned" ? asset.domain : "";
  const tier = asset.tier && asset.tier !== "Unassigned" ? asset.tier : "";
  const usageLabel = asset.usageLabel || asset.usage_label || "";
  const environment = asset.environment || asset.env || "";

  const hasAnything = Boolean(owner || domain || tier || usageLabel || environment);
  if (!hasAnything) return null;

  return (
    <div className="gh-entity-hero-chips" data-testid="gh-entity-hero-chips">
      {domain ? (
        <span className="gh-chip gh-chip-soft gh-entity-hero-chip" title={`Domain: ${domain}`}>
          <span className="gh-chip-label">Domain</span>
          <span className="gh-chip-separator">{" · "}</span>
          <span className="gh-chip-value">{domain}</span>
        </span>
      ) : null}
      {tier ? (
        <span className="gh-chip gh-chip-soft gh-entity-hero-chip" title={`Tier: ${tier}`}>
          <span className="gh-chip-label">Tier</span>
          <span className="gh-chip-separator">{" · "}</span>
          <span className="gh-chip-value">{tier}</span>
        </span>
      ) : null}
      {owner ? (
        <span className="gh-chip gh-chip-soft gh-entity-hero-chip gh-entity-hero-chip-owner" title={`Owner: ${owner.title}`}>
          <OwnerAvatar owner={owner.label} size={18} />
          <span className="gh-chip-value">{prettyOwnerLabel(owner.label)}</span>
        </span>
      ) : null}
      {usageLabel ? (
        <span className="gh-chip gh-chip-soft gh-entity-hero-chip" title={`Usage: ${usageLabel}`}>
          <span className="gh-chip-label">Usage</span>
          <span className="gh-chip-separator">{" · "}</span>
          <span className="gh-chip-value">{usageLabel}</span>
        </span>
      ) : null}
      {environment ? (
        <span className="gh-chip gh-chip-soft gh-entity-hero-chip" title={`Environment: ${environment}`}>
          <span className="gh-chip-label">Env</span>
          <span className="gh-chip-separator">{" · "}</span>
          <span className="gh-chip-value">{environment}</span>
        </span>
      ) : null}
    </div>
  );
}
