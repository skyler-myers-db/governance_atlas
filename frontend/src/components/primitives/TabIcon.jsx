/**
 * TabIcon — small inline SVG glyphs used by SurfaceTabs to add visual
 * identity to each tab. Kept inline (no icon-library dependency) so
 * the design tokens pipeline owns every pixel.
 *
 * Pass an `id` from TAB_ICONS below. Unknown ids render nothing so
 * SurfaceTabs stays backward-compatible for tabs that don't opt in.
 */

const TAB_GLYPHS = {
  overview: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  schema: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 10h17M3.5 15h17M9 4v16" />
    </>
  ),
  activity: (
    <>
      <path d="M20.5 13.5a8 8 0 1 1-3.15-6.35" />
      <path d="M4 14l3 3 4-5" />
    </>
  ),
  sample: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9h17M9 3.5v17M15 3.5v17M3.5 15h17" />
    </>
  ),
  queries: (
    <>
      <polyline points="13 3 4 14 11 14 10 21 20 10 13 10 14 3" />
    </>
  ),
  profiler: (
    <>
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <polyline points="8 14 11 10 14 13 19 6" />
    </>
  ),
  lineage: (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M7 6c5 0 10 2 10 6M7 18c5 0 10-2 10-6" />
    </>
  ),
  quality: (
    <>
      <path d="M12 2l3.3 6.7 7.4 1-5.4 5.2 1.3 7.5-6.6-3.5-6.6 3.5 1.3-7.5L1.3 9.7l7.4-1z" />
      <path d="M8.5 12.5l2.5 2.5 5-5" />
    </>
  ),
  properties: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
};

export function TabIcon({ id = "", size = 16 }) {
  const glyph = TAB_GLYPHS[id];
  if (!glyph) return null;
  return (
    <svg
      aria-hidden="true"
      className="gh-tab-icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      style={{ flex: "0 0 auto" }}
    >
      {glyph}
    </svg>
  );
}
