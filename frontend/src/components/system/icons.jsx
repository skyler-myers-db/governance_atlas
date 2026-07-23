/*
 * Inline glyph set for the system kit. The kit's dependency rule is
 * "dependencies point inward only" (FRONTEND_BLUEPRINT §6) — it may not
 * import from components/primitives (AssetTypeIcon et al.), so the entity
 * kind glyphs live here as self-contained SVGs. All stroke `currentColor`
 * so they inherit chip/button text color.
 */

const BASE = /** @type {import('react').SVGProps<SVGSVGElement>} */ ({
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
});

export const KIND_ICONS = {
  asset: (
    <svg {...BASE}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12M6.5 6.5V13" />
    </svg>
  ),
  column: (
    <svg {...BASE}>
      <rect x="6" y="2" width="4" height="12" rx="1" />
      <path d="M2.5 4v8M13.5 4v8" />
    </svg>
  ),
  term: (
    <svg {...BASE}>
      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H13v10.5H4.5A1.5 1.5 0 0 0 3 14z" />
      <path d="M3 12.5A1.5 1.5 0 0 1 4.5 11H13" />
    </svg>
  ),
  cde: (
    <svg {...BASE}>
      <path d="M8 2l2.7 3.1L14 8l-3.3 2.9L8 14l-2.7-3.1L2 8l3.3-2.9z" />
    </svg>
  ),
  owner: (
    <svg {...BASE}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c.8-2.6 2.6-3.9 5-3.9s4.2 1.3 5 3.9" />
    </svg>
  ),
  request: (
    <svg {...BASE}>
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </svg>
  ),
  event: (
    <svg {...BASE}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  ),
  domain: (
    <svg {...BASE}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 1.8 2 10.2 0 12M8 2c-2 1.8-2 10.2 0 12" />
    </svg>
  ),
  catalog: (
    <svg {...BASE}>
      <ellipse cx="8" cy="4" rx="5.5" ry="2" />
      <path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" />
      <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
    </svg>
  ),
  lineage: (
    <svg {...BASE}>
      <circle cx="3.5" cy="8" r="1.8" />
      <circle cx="12.5" cy="3.5" r="1.8" />
      <circle cx="12.5" cy="12.5" r="1.8" />
      <path d="M5.2 7.2l5.6-2.9M5.2 8.8l5.6 2.9" />
    </svg>
  ),
  quality: (
    <svg {...BASE}>
      <path d="M8 2l5 2v4c0 3.2-2 5.3-5 6-3-.7-5-2.8-5-6V4z" />
      <path d="M5.8 8.2l1.6 1.6 2.8-3" />
    </svg>
  ),
};

export const CloseIcon = (
  <svg {...BASE} width={12} height={12}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const SortIcon = (
  <svg {...BASE} width={10} height={10}>
    <path d="M8 3v10M4.5 6.5L8 3l3.5 3.5" />
  </svg>
);
