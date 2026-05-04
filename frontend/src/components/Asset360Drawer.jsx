import { useEffect, useMemo, useState } from "react";
import { useAsset360 } from "../hooks/useAsset360";

/**
 * Asset 360 slide-in drawer.
 *
 * Renders a right-side panel that overlays any surface so a user can inspect
 * a Unity Catalog asset without leaving Discover, Lineage, the Activity
 * stream, or the Stewardship queue. Backed by the same `useAsset360` hook
 * that the full-page EntityWorkspace uses, so payload contracts stay aligned;
 * the drawer simply renders a slimmer set of the same fields.
 *
 * The drawer is intentionally read-only in this iteration — write actions
 * (Comment, Request access, Certify) are exposed as buttons but currently
 * route the user into the full EntityWorkspace via `onExpand`, where the
 * existing audited write flows live. Wiring the drawer's footer actions
 * directly into the governance-control-plane mutation surface is a follow-up.
 */

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "columns", label: "Columns" },
  { key: "lineage", label: "Lineage" },
  { key: "quality", label: "Quality" },
  { key: "access", label: "Access" },
];

function Glyph({ name, size = 16 }) {
  // Tiny inline icon set — kept self-contained so the drawer doesn't pull a
  // heavy icon system into the lazy bundle. Names map roughly onto lucide.
  const paths = {
    x: <path d="M6 6l12 12M6 18L18 6" />,
    "external-link": (
      <>
        <path d="M14 4h6v6" />
        <path d="M10 14L21 3" />
        <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
      </>
    ),
    table: <path d="M3 5h18v14H3zM3 12h18M9 5v14M15 5v14" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    badge: <path d="M12 2l3 4 5 .5-3.5 3.7.9 5-5.4-2.6L6.6 15l.9-5L4 6.5 9 6z" />,
    shield: <path d="M12 3l8 3v6c0 4.4-3.4 8.4-8 9-4.6-.6-8-4.6-8-9V6z" />,
    key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>,
    fork: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="9" r="3" /><path d="M9 6h6a3 3 0 0 1 3 3M6 9v6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
    column: <path d="M5 4h14v16H5zM5 9h14M5 14h14" />,
    check: <path d="M5 12l5 5L20 7" />,
    quality: <><path d="M3 12h4l3-7 4 14 3-7h4" /><circle cx="12" cy="12" r="9" /></>,
  };
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name] || null}
    </svg>
  );
}

function Chip({ tone = "info", icon, children }) {
  const palette = {
    info:    { bg: "rgba(61,132,173,0.15)", color: "#a8d3e8", border: "rgba(61,132,173,0.40)" },
    good:    { bg: "rgba(52,211,153,0.12)", color: "#34d399", border: "rgba(52,211,153,0.35)" },
    warn:    { bg: "rgba(244,183,64,0.12)", color: "#f4b740", border: "rgba(244,183,64,0.35)" },
    crit:    { bg: "rgba(244,113,116,0.12)", color: "#f47174", border: "rgba(244,113,116,0.35)" },
    teal:    { bg: "rgba(92,225,230,0.10)", color: "#5ce1e6", border: "rgba(92,225,230,0.35)" },
    neutral: { bg: "rgba(178,189,194,0.10)", color: "#b2bdc2", border: "rgba(178,189,194,0.30)" },
  }[tone] || { bg: "rgba(61,132,173,0.15)", color: "#a8d3e8", border: "rgba(61,132,173,0.40)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.02,
        background: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {icon ? <Glyph name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

function summarize(asset) {
  const fqn = asset?.fullPath || asset?.fqn || asset?.fullName || "";
  const name = asset?.name || (fqn ? fqn.split(".").pop() : "Asset");
  const description = asset?.description || asset?.comment || "";
  const certification = asset?.certification || asset?.certificationStatus || "";
  const classification = asset?.classification || "";
  const isCde = Boolean(asset?.cde || asset?.isCde || asset?.criticalDataElement);
  const containsPii = Boolean(asset?.pii || asset?.containsPii);
  return { fqn, name, description, certification, classification, isCde, containsPii };
}

function OverviewBody({ data, summary }) {
  if (!data) return null;
  const owner = (data.owners || [])[0] || {};
  const steward = (data.stewards || [])[0] || {};
  const usage = data.usage || {};
  const facts = [
    {
      label: "Owner",
      value: owner.displayName || owner.name || "Owner unavailable",
      sub: owner.team || owner.email || "",
      tone: owner.displayName ? "good" : "neutral",
    },
    {
      label: "Steward team",
      value: steward.displayName || steward.team || "Steward unavailable",
      sub: steward.email || "",
      tone: steward.displayName ? "good" : "neutral",
    },
    {
      label: "Freshness",
      value: data.freshness?.message || data.freshness?.observedAt || "Freshness unavailable",
      sub: data.freshness?.state ? `Signal · ${data.freshness.state}` : "",
      tone: data.freshness?.state === "live" ? "good" : data.freshness?.state ? "warn" : "neutral",
    },
    {
      label: "Usage · 30d",
      value: usage.queries30d ? `${usage.queries30d.toLocaleString()} queries` : "Usage unavailable",
      sub: usage.uniqueUsers30d ? `${usage.uniqueUsers30d} unique users` : "",
      tone: usage.queries30d ? "info" : "neutral",
    },
  ];
  return (
    <div style={{ padding: "20px 22px" }}>
      {summary.description ? (
        <p style={{ fontSize: 14, color: "var(--ga-text)", lineHeight: 1.6, margin: "0 0 18px" }}>
          {summary.description}
        </p>
      ) : (
        <p style={{ fontSize: 13, color: "var(--ga-text-muted)", lineHeight: 1.55, margin: "0 0 18px" }}>
          No description recorded for this asset.
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        {facts.map((fact) => (
          <div
            key={fact.label}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(8, 23, 42, 0.8)",
              border: "1px solid rgba(20, 44, 70, 0.85)",
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--ga-text-subtle)",
                marginBottom: 4,
              }}
            >
              {fact.label}
            </div>
            <div
              style={{
                fontFamily: "var(--ga-font-heading, 'Hanken Grotesk', sans-serif)",
                fontSize: 16,
                fontWeight: 700,
                color: "var(--ga-text-strong, #fff)",
                lineHeight: 1.2,
              }}
            >
              {fact.value}
            </div>
            {fact.sub ? (
              <div style={{ fontSize: 11, color: "var(--ga-text-subtle)", marginTop: 2 }}>{fact.sub}</div>
            ) : null}
          </div>
        ))}
      </div>
      <div
        style={{
          background: "rgba(8, 23, 42, 0.8)",
          border: "1px solid rgba(20, 44, 70, 0.85)",
          borderRadius: 10,
          padding: 14,
          fontSize: 12.5,
          color: "var(--ga-text-muted)",
          lineHeight: 1.55,
        }}
      >
        <strong style={{ color: "var(--ga-text)" }}>Buildability note · </strong>
        Inventory and ownership are sourced from <code style={{ color: "var(--ga-bright-blue)" }}>system.information_schema.tables</code> and Unity Catalog grants;
        freshness is reported by the metadata coverage probe; usage is derived from query history when permitted.
        Drawer is read-only — open the full record to make audited changes.
      </div>
    </div>
  );
}

function ColumnsBody({ data }) {
  const cols = data?.schema || [];
  if (!cols.length) {
    return (
      <div style={{ padding: 22, color: "var(--ga-text-muted)", fontSize: 13 }}>
        Column schema unavailable for this asset.
      </div>
    );
  }
  return (
    <div style={{ padding: "12px 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: "var(--ga-text-subtle)", textAlign: "left" }}>
            <th style={{ padding: "8px 22px", fontWeight: 600, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Column</th>
            <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Type</th>
            <th style={{ padding: "8px 22px 8px 12px", fontWeight: 600, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {cols.slice(0, 40).map((col) => (
            <tr
              key={col.name || col.column || `${col.position}-${col.label}`}
              style={{ borderTop: "1px solid rgba(20, 44, 70, 0.6)" }}
            >
              <td style={{ padding: "10px 22px", fontFamily: "var(--ga-font-mono, 'JetBrains Mono', monospace)", color: "var(--ga-text-strong, #fff)", fontWeight: 600 }}>
                {col.name || col.column || col.label || "—"}
              </td>
              <td style={{ padding: "10px 12px", color: "var(--ga-bright-blue)", fontFamily: "var(--ga-font-mono, monospace)" }}>
                {col.type || col.dataType || ""}
              </td>
              <td style={{ padding: "10px 22px 10px 12px", color: "var(--ga-text-muted)" }}>
                {col.containsPii || col.pii ? <Chip tone="crit" icon="shield">PII · masked</Chip> : col.description || ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cols.length > 40 ? (
        <div style={{ padding: "12px 22px", fontSize: 12, color: "var(--ga-text-subtle)" }}>
          Showing first 40 of {cols.length} columns. Open the full record for the complete schema.
        </div>
      ) : null}
    </div>
  );
}

function PlaceholderBody({ title, message }) {
  return (
    <div style={{ padding: 22 }}>
      <div
        style={{
          padding: "24px 20px",
          borderRadius: 10,
          background: "rgba(8, 23, 42, 0.8)",
          border: "1px dashed rgba(20, 44, 70, 0.85)",
          textAlign: "center",
          color: "var(--ga-text-muted)",
        }}
      >
        <div style={{ fontWeight: 700, color: "var(--ga-text)", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13 }}>{message}</div>
      </div>
    </div>
  );
}

// Outer gate: deliberately does NOT call any hooks before deciding whether to
// render the inner drawer. This keeps Asset360DrawerInner — which uses the
// react-query backed useAsset360 — from mounting until the user explicitly
// opens an asset, so unit tests that render <App /> without a
// QueryClientProvider stay green (the drawer is only mounted lazily once the
// user actually clicks something that opens it).
export function Asset360Drawer({ assetFqn = "", onClose, onExpand, onOpenLineage }) {
  if (!assetFqn) {
    return <div aria-hidden className="ga-drawer-bg" />;
  }
  return (
    <Asset360DrawerInner
      assetFqn={assetFqn}
      onClose={onClose}
      onExpand={onExpand}
      onOpenLineage={onOpenLineage}
    />
  );
}

function Asset360DrawerInner({ assetFqn, onClose, onExpand, onOpenLineage }) {
  const open = Boolean(assetFqn);
  const [tab, setTab] = useState("overview");
  const { data, loading } = useAsset360(assetFqn, { enabled: open });

  // Reset to Overview every time a new asset is opened so each session starts
  // from the same default landing tab.
  useEffect(() => {
    if (assetFqn) setTab("overview");
  }, [assetFqn]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const summary = useMemo(() => summarize(data?.asset || { fullPath: assetFqn }), [data, assetFqn]);

  const certificationTone =
    /certified/i.test(summary.certification) ? "good" :
    /review/i.test(summary.certification) ? "warn" :
    summary.certification ? "neutral" : null;
  const classificationTone =
    /restricted/i.test(summary.classification) ? "crit" :
    /confidential/i.test(summary.classification) ? "warn" :
    summary.classification ? "info" : null;

  return (
    <>
      <div
        aria-hidden={!open}
        className={`ga-drawer-bg ${open ? "is-open" : ""}`}
        onClick={onClose}
        role="presentation"
      />
      <aside
        aria-hidden={!open}
        aria-label={`Asset 360 detail for ${summary.name || assetFqn}`}
        className={`ga-drawer ${open ? "is-open" : ""}`}
        role="dialog"
      >
        <header className="ga-drawer-head">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "rgba(8, 23, 42, 0.85)",
              display: "grid",
              placeItems: "center",
              color: "var(--ga-bright-blue)",
              flexShrink: 0,
            }}
          >
            <Glyph name="table" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
              <h2
                style={{
                  margin: 0,
                  fontFamily: "var(--ga-font-heading, 'Hanken Grotesk', sans-serif)",
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--ga-text-strong, #fff)",
                  letterSpacing: "-0.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                }}
              >
                {summary.name}
              </h2>
              {certificationTone ? <Chip tone={certificationTone} icon="badge">{summary.certification}</Chip> : null}
              {classificationTone ? <Chip tone={classificationTone} icon="shield">{summary.classification}</Chip> : null}
              {summary.isCde ? <Chip tone="teal" icon="key">CDE</Chip> : null}
              {summary.containsPii ? <Chip tone="crit" icon="shield">PII</Chip> : null}
            </div>
            <div
              style={{
                fontFamily: "var(--ga-font-mono, 'JetBrains Mono', monospace)",
                fontSize: 12,
                color: "var(--ga-text-subtle)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={summary.fqn}
            >
              {summary.fqn}
            </div>
          </div>
          <button
            aria-label="Close Asset 360"
            className="ga-drawer-tab"
            onClick={onClose}
            style={{ borderRadius: 8, padding: "8px 10px" }}
            type="button"
          >
            <Glyph name="x" />
          </button>
        </header>

        <div className="ga-drawer-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              aria-selected={tab === entry.key}
              className={`ga-drawer-tab ${tab === entry.key ? "is-active" : ""}`}
              key={entry.key}
              onClick={() => setTab(entry.key)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="ga-drawer-body" role="tabpanel">
          {loading ? (
            <PlaceholderBody title="Loading asset record" message="Fetching the live Unity Catalog metadata for this asset…" />
          ) : tab === "overview" ? (
            <OverviewBody data={data} summary={summary} />
          ) : tab === "columns" ? (
            <ColumnsBody data={data} />
          ) : tab === "lineage" ? (
            <PlaceholderBody
              title="Lineage preview"
              message="Click 'Open lineage workspace' below to inspect upstream and downstream hops."
            />
          ) : tab === "quality" ? (
            <PlaceholderBody
              title="Quality runs"
              message={data?.quality?.message || "Quality run history is not available for this asset in the current snapshot."}
            />
          ) : tab === "access" ? (
            <PlaceholderBody
              title="Access policy"
              message={data?.access?.message || "Access grants render in the full record once authoritative grant evidence is available."}
            />
          ) : null}
        </div>

        <footer className="ga-drawer-foot">
          {onOpenLineage ? (
            <button
              className="gh-tertiary-button"
              onClick={() => onOpenLineage(assetFqn)}
              type="button"
            >
              <Glyph name="fork" />
              Open lineage workspace
            </button>
          ) : null}
          <button
            className="gh-tertiary-button"
            onClick={() => onExpand?.(assetFqn)}
            type="button"
          >
            <Glyph name="external-link" />
            Open full record
          </button>
        </footer>
      </aside>
    </>
  );
}

export default Asset360Drawer;
