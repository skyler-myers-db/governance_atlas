import { useMemo } from "react";

/**
 * LineageNodeCard — design-faithful card used by LineageCanvasV2.
 *
 * Two variants:
 *  - compact: header + footer only, ~210x86, used for non-table nodes (jobs,
 *    pipelines, dashboards, models, restricted boundary nodes).
 *  - tall: full schema preview with up to 5 columns, ~220x220, used for
 *    table / view nodes where useLineageGraphV2 surfaces column metadata.
 *
 * The component takes a single `node` from useLineageGraphV2's normalized
 * shape — no payload reading happens here. State classes (focus / hover /
 * traced / dimmed) are passed via props so the parent canvas can drive
 * hover-trace highlight behavior with a single React Flow selector.
 */

const KIND_ACCENT = {
  table: { color: "#66c5ff", bg: "rgba(102, 197, 255, 0.10)" },
  pipeline: { color: "#5ce1e6", bg: "rgba(92, 225, 230, 0.10)" },
  job: { color: "#5ce1e6", bg: "rgba(92, 225, 230, 0.10)" },
  notebook: { color: "#f4b740", bg: "rgba(244, 183, 64, 0.10)" },
  "saved-query": { color: "#a8d3e8", bg: "rgba(168, 211, 232, 0.10)" },
  dashboard: { color: "#cfefff", bg: "rgba(207, 239, 255, 0.10)" },
  model: { color: "#a8d3e8", bg: "rgba(168, 211, 232, 0.10)" },
  udf: { color: "#b2bdc2", bg: "rgba(178, 189, 194, 0.10)" },
  volume: { color: "#66c5ff", bg: "rgba(102, 197, 255, 0.10)" },
  restricted: { color: "#f4b740", bg: "rgba(244, 183, 64, 0.10)" },
};

function KindGlyph({ kind, size = 14 }) {
  // Inline SVG glyphs so we don't pull lucide into the canvas bundle.
  const stroke = { stroke: "currentColor", strokeWidth: 1.6, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    table: <><rect x="3" y="4" width="18" height="16" rx="1" {...stroke} /><path d="M3 9h18M3 14h18M9 4v16M15 4v16" {...stroke} /></>,
    pipeline: <><circle cx="6" cy="6" r="2.4" {...stroke} /><circle cx="18" cy="6" r="2.4" {...stroke} /><circle cx="6" cy="18" r="2.4" {...stroke} /><circle cx="18" cy="18" r="2.4" {...stroke} /><path d="M8.4 6h7.2M8.4 18h7.2M6 8.4v7.2M18 8.4v7.2" {...stroke} /></>,
    job: <><circle cx="12" cy="12" r="9" {...stroke} /><path d="M12 7v5l3 2" {...stroke} /></>,
    notebook: <><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4z" {...stroke} /><path d="M9 8h7M9 12h7M9 16h4" {...stroke} /></>,
    "saved-query": <><circle cx="11" cy="11" r="6.5" {...stroke} /><path d="M21 21l-5-5" {...stroke} /></>,
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="1" {...stroke} /><rect x="13" y="3" width="8" height="5" rx="1" {...stroke} /><rect x="13" y="10" width="8" height="11" rx="1" {...stroke} /><rect x="3" y="13" width="8" height="8" rx="1" {...stroke} /></>,
    model: <><circle cx="12" cy="12" r="3" {...stroke} /><circle cx="12" cy="4" r="2" {...stroke} /><circle cx="12" cy="20" r="2" {...stroke} /><circle cx="4" cy="12" r="2" {...stroke} /><circle cx="20" cy="12" r="2" {...stroke} /><path d="M12 6v3M12 15v3M6 12h3M15 12h3" {...stroke} /></>,
    udf: <><path d="M4 7h2c1 0 2 1 2 2v6c0 1-1 2-2 2H4M20 7h-2c-1 0-2 1-2 2v6c0 1 1 2 2 2h2" {...stroke} /></>,
    volume: <><ellipse cx="12" cy="6" rx="8" ry="3" {...stroke} /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" {...stroke} /></>,
    restricted: <><rect x="5" y="11" width="14" height="9" rx="1" {...stroke} /><path d="M8 11V8a4 4 0 0 1 8 0v3" {...stroke} /></>,
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      {paths[kind] || paths.table}
    </svg>
  );
}

function CertifiedBadge() {
  return (
    <span
      aria-label="Certified by data steward"
      className="ga-lineage-v2-card-cert"
      title="Certified by data steward"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11">
        <path
          d="M12 2l2.5 2.4 3.4-.5.6 3.4 3 1.7-1.5 3.1 1.5 3.1-3 1.7-.6 3.4-3.4-.5L12 22l-2.5-2.4-3.4.5-.6-3.4-3-1.7L4 12 2.5 8.9l3-1.7.6-3.4 3.4.5z"
          fill="rgba(52, 211, 153, 0.18)"
          stroke="#34d399"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M9 12l2 2 4-4" fill="none" stroke="#34d399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function PiiBadge() {
  return (
    <span
      aria-label="Contains PII"
      className="ga-lineage-v2-card-pii"
      title="Contains PII"
    >
      PII
    </span>
  );
}

function ClassificationBadge({ classification }) {
  if (!classification) return null;
  const lower = classification.toLowerCase();
  const tone =
    lower.includes("restricted") ? "crit" :
    lower.includes("confidential") ? "warn" :
    lower.includes("internal") ? "info" : "neutral";
  return (
    <span
      className={`ga-lineage-v2-card-class tone-${tone}`}
      title={`Sensitivity: ${classification}`}
    >
      {classification}
    </span>
  );
}

function FootStat({ glyph, label, title }) {
  return (
    <span className="ga-lineage-v2-card-footstat" title={title || undefined}>
      {glyph}
      <span>{label}</span>
    </span>
  );
}

export function LineageNodeCard({
  node,
  variant = "compact",
  isFocus = false,
  isHovered = false,
  isTraced = true,
  isDimmed = false,
  onClick,
}) {
  const accent = KIND_ACCENT[node?.kind] || KIND_ACCENT.table;
  const visibleColumns = Array.isArray(node?.columns) ? node.columns.slice(0, 5) : [];
  const totalColumns = Number(node?.totalColumns) || visibleColumns.length;
  const hiddenColumns = Math.max(0, totalColumns - visibleColumns.length);

  const stateClass = useMemo(() => {
    if (isDimmed) return "is-dimmed";
    if (isFocus) return "is-focus";
    if (isHovered) return "is-hovered";
    if (!isTraced) return "is-untraced";
    return "";
  }, [isDimmed, isFocus, isHovered, isTraced]);

  const navigable = node?.isOpenable !== false && !isFocus;

  const handleClick = (event) => {
    if (!onClick) return;
    if (event.target.closest?.(".ga-lineage-v2-card-col")) return;
    onClick(node);
  };

  return (
    <div
      aria-current={isFocus ? "true" : undefined}
      className={`ga-lineage-v2-card ga-lineage-v2-card-${variant} ${stateClass}`.trim()}
      data-node-fqn={node?.fqn || undefined}
      data-node-kind={node?.kind || undefined}
      data-navigable={navigable ? "true" : "false"}
      onClick={handleClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(node);
        }
      }}
    >
      <header className="ga-lineage-v2-card-head">
        <span
          aria-hidden="true"
          className="ga-lineage-v2-card-glyph"
          style={{ color: accent.color, background: accent.bg }}
        >
          <KindGlyph kind={node?.kind || "table"} />
        </span>
        <span className="ga-lineage-v2-card-title-wrap">
          {node?.kicker ? (
            <span className="ga-lineage-v2-card-kicker">{node.kicker}</span>
          ) : null}
          <span className="ga-lineage-v2-card-title" title={node?.label || node?.fqn || ""}>
            {node?.label || "Unknown"}
          </span>
          <span className="ga-lineage-v2-card-path">{node?.subtitle || ""}</span>
        </span>
        {node?.isCertified ? <CertifiedBadge /> : null}
      </header>

      {variant === "tall" && visibleColumns.length ? (
        <div className="ga-lineage-v2-card-cols">
          {visibleColumns.map((col) => (
            <div className="ga-lineage-v2-card-col" key={col.name}>
              <span className="ga-lineage-v2-card-col-name">{col.name}</span>
              <span className="ga-lineage-v2-card-col-type">
                {String(col.type || "").toUpperCase()}
              </span>
            </div>
          ))}
          {hiddenColumns > 0 ? (
            <div className="ga-lineage-v2-card-col-more">
              +{hiddenColumns} more {hiddenColumns === 1 ? "column" : "columns"}
            </div>
          ) : null}
        </div>
      ) : null}

      {(node?.classification || node?.containsPii) && variant === "tall" ? (
        <div className="ga-lineage-v2-card-chiprow">
          {node?.containsPii ? <PiiBadge /> : null}
          {node?.classification ? <ClassificationBadge classification={node.classification} /> : null}
        </div>
      ) : null}

      <footer className="ga-lineage-v2-card-foot">
        {/*
          The lineage payload doesn't carry rows/freshness/owners — those
          live on the asset-detail endpoint, not on system.access lineage
          tables. So we render the pre-formatted `foot` strings the API
          actually returned (e.g. "Table", "Metadata unavailable") and
          fall through to row/freshness/owner stats only when the v2
          adapter could derive them from a richer payload (asset 360
          enrichment).
        */}
        {node?.rowCount ? (
          <FootStat
            glyph={
              <svg aria-hidden="true" viewBox="0 0 24 24" width="10" height="10">
                <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            }
            label={`${node.rowCount} rows`}
            title={`${node.rowCount} rows reported by Unity Catalog`}
          />
        ) : null}
        {node?.freshness ? (
          <FootStat
            glyph={
              <svg aria-hidden="true" viewBox="0 0 24 24" width="10" height="10">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            }
            label={node.freshness}
            title={`Freshness: ${node.freshnessRaw || node.freshness}`}
          />
        ) : null}
        {node?.ownerCount ? (
          <FootStat
            glyph={
              <svg aria-hidden="true" viewBox="0 0 24 24" width="10" height="10">
                <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M5 21a7 7 0 0 1 14 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            }
            label={node.ownerCount === 1 ? "1 owner" : `${node.ownerCount} owners`}
            title={node.owners?.map((o) => o?.displayName || o?.email).filter(Boolean).join(", ")}
          />
        ) : null}
        {node?.recentActivityCount ? (
          <FootStat
            glyph={
              <svg aria-hidden="true" viewBox="0 0 24 24" width="10" height="10">
                <path d="M3 12h4l3-7 4 14 3-7h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            label={
              node.recentActivityCount === 1 ? "1 recent" : `${node.recentActivityCount} recent`
            }
            title={`${node.recentActivityCount} recent lineage events`}
          />
        ) : null}
        {!node?.rowCount &&
        !node?.freshness &&
        !node?.ownerCount &&
        !node?.recentActivityCount ? (
          // No derived metadata — surface the pre-formatted lineage-payload
          // foot strings the API gave us. They're already honest copy
          // ("Table" for visible nodes; "Metadata unavailable" when the
          // asset is lineage-only). Falls back to the original "Metadata
          // pending" only when the API gave us literally nothing.
          (node?.foot || []).length ? (
            (node.foot || []).slice(0, 2).map((line, idx) => (
              <span
                className={`ga-lineage-v2-card-footstat ${
                  /unavailable|pending/i.test(line) ? "is-empty" : ""
                }`.trim()}
                key={`${line}-${idx}`}
                title={line}
              >
                {line}
              </span>
            ))
          ) : (
            <span className="ga-lineage-v2-card-footstat is-empty">Metadata pending</span>
          )
        ) : null}
      </footer>
    </div>
  );
}

export default LineageNodeCard;
