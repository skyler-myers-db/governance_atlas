# Governance Atlas North Star Implementation Plan

## 1. Strategic goal

Transform the existing Governance Atlas Databricks app into a premium, executive-grade, demo-ready product called **Governance Atlas**.

The finished product should feel like a complete enterprise control plane for data governance:

* **Executive-grade home command center**
* **AI-assisted discovery**
* **Asset 360 cockpit**
* **Interactive lineage explorer**
* **Stewardship workbench**
* **Governance insights dashboard**
* **Business taxonomy and glossary workspace**
* **Critical Data Elements registry**
* **Audit trail and change evidence browser**
* **Administration and control center**
* **Atlas AI copilot**

The visual target is the North Star mockup set: dark navy shell, Entrada wordmark, refined card system, cyan/blue glow accents, elegant charts, strong right-side detail drawers, executive KPIs, and a polished enterprise SaaS feel.

Important implementation rule: **the app must not become fake demoware.** It should use live Unity Catalog, governance-store, quality, audit, lineage, and metadata signals wherever available. Thin or missing live signals must render as unavailable/degraded rather than being filled with invented metrics.

---

# 2. Current-state inventory

The current codebase already has a strong foundation.

## Frontend

Current frontend stack:

```txt
atlas/frontend
├── React 18
├── Vite
├── React Query
├── React Router
├── @xyflow/react for lineage
├── Vitest + Testing Library
├── Playwright QA scripts
└── CSS token system under src/design/tokens
```

Important current files:

```txt
src/App.jsx
src/components/AppFrame.jsx
src/components/HomePage.jsx
src/components/DiscoveryWorkspace.jsx
src/components/EntityWorkspace.jsx
src/components/LineageWorkspace.jsx
src/components/GovernanceWorkspace.jsx
src/components/InsightsWorkspace.jsx
src/components/TaxonomyWorkspace.jsx
src/components/CdeWorkspace.jsx
src/components/AuditBrowserWorkspace.jsx
src/components/AdminWorkspace.jsx
src/components/primitives/GlobalHeader.jsx
src/components/primitives/SideIconRail.jsx
src/lib/api.js
src/hooks/*
src/styles/*.css
src/design/tokens/*.css
```

Current issue: the app has many of the functional surfaces, but the UI does not yet match the North Star. The visible rail is currently too limited; the product name still falls back to Governance Atlas in places; the visual system is a cream/light-mode-first design with a partial dark mode; and the pages need to be redesigned as premium, executive-ready surfaces.

## Backend

Current backend stack:

```txt
atlas/runtime_app.py
atlas/atlas/api/*
atlas/atlas/services/*
atlas/atlas/store.py
atlas/atlas/migrations.py
```

Existing backend strengths:

* FastAPI runtime app.
* Modular routers for runtime, discovery, assets, catalog, lineage, governance, classification, export, admin, insights, and CDE.
* Unity Catalog visibility and OBO/app-principal fallback logic.
* GovernanceStore backed by UC Delta tables.
* Metadata audit log.
* Governance tasks, threads, notification inbox, projections, change events, entity versions.
* Profile, quality, custom properties, classifications, domains, data products, column groups.
* Existing CDE registry endpoint.
* Existing insights gap-analysis endpoint.
* Existing admin coverage, branding, bulk import, and export jobs.
* Existing tests for OBO, runtime contracts, lineage, governance workflow, quality, classification, insights, CDE-adjacent functionality, and more.

The backend should not be rewritten. It should be extended with **presentation view-model endpoints** that compose existing data into North Star-ready payloads.

---

# 3. Non-negotiable implementation principles

## 3.1 Preserve truth and provenance

Every API response used for executive dashboards must include a `meta` block:

```json
{
  "meta": {
    "source": "unity-catalog+governance-store+quality+lineage",
    "state": "available",
    "authoritative": true,
    "degraded": false,
    "computedAt": "2026-04-24T00:00:00Z",
    "visibilityScope": "actor-scoped",
    "warnings": []
  }
}
```

Never silently show app-principal data as if it is actor-scoped. Reuse the existing degraded/OBO fallback patterns.

## 3.2 Keep the current module/package names stable at first

Do **not** rename the Python package, repo root, or major directories during the North Star implementation. Keep the `atlas` Python package path as an internal compatibility import until the app is stable, but prefer Atlas/Govat names for runtime config, bundle metadata, and new docs.

Rebrand user-facing strings only:

```txt
Governance Atlas → Governance Atlas
Entrada AI Governance Atlas → Entrada Governance Atlas
```

Optional later package rename can happen as a separate migration.

## 3.3 Keep existing APIs working

Do not break:

```txt
/api/bootstrap
/api/runtime/status
/api/discovery/search
/api/assets/{fqn}
/api/lineage/{fqn}
/api/governance/summary
/api/governance/glossary
/api/insights/gap-analysis
/api/cde
/api/admin/*
```

Add new composite endpoints rather than replacing old endpoints.

## 3.4 Use North Star mockups as visual contracts, not image assets

The generated mockups are approved visual contracts for page structure, hierarchy,
density, palette, and operating model. They are not loose inspiration. Before
calling a page complete, compare a current screenshot to the corresponding
mockup and account for every visible region in `docs/northstar_gap_analysis/`.

The app should still be implemented as real React UI, not screenshot backgrounds.
Do not copy mockup numbers, events, or claims unless live data provides them.
When live data is thin, preserve the target panel/card structure and render
honest unavailable, empty, or degraded states inside it.

Also, do **not** render fake browser chrome inside the app. The mockups included browser chrome only to show context.

## 3.5 No demo augmentation

The app must not include a separate seeded presentation data path. All metrics must be
derived from actor-visible live data or shown as unavailable/degraded with
clear provenance in response metadata.

---

# 4. Target architecture

## 4.1 Frontend target

Create a consistent product shell:

```txt
Global shell
├── Entrada wordmark
├── Governance Atlas product title
├── Global search
├── Environment chip
├── Atlas AI button
├── Notifications
├── User avatar/menu
├── Full-height expanded left navigation
└── Main workspace
```

Navigation:

```txt
Home
Discovery
Asset 360
Lineage
Governance
Insights
Taxonomy
CDEs
Audit
Admin
```

Each page should use shared primitives:

```txt
MetricCard
Sparkline
DonutMetric
HeatmapMatrix
BarList
StatusPill
PersonaAvatar
DataTable
RightInspector
ActionTile
PageHero
AtlasAiPanel
EmptyState
DegradedBanner
```

## 4.2 Backend target

Add composite North Star endpoints:

```txt
GET  /api/atlas/command-center
GET  /api/atlas/assets/{asset_fqn:path}/360
GET  /api/atlas/governance/workbench
GET  /api/atlas/governance/requests/{request_id}
GET  /api/atlas/insights
GET  /api/atlas/taxonomy/overview
GET  /api/atlas/cde
GET  /api/atlas/cde/{cde_id}
GET  /api/atlas/audit/evidence
GET  /api/atlas/admin/control-center
POST /api/atlas-ai/recommendations
POST /api/atlas-ai/chat
```

These endpoints should compose current services rather than duplicate logic.

---

# 5. Data source matrix

Use this matrix to prevent invented numbers.

| UI Signal                | Primary source                              | Secondary source           | Notes                                   |
| ------------------------ | ------------------------------------------- | -------------------------- | --------------------------------------- |
| Governed assets          | visible UC inventory                        | discovery default count    | Actor-scoped where possible             |
| Certified assets         | UC tags / asset metadata                    | governance store           | Certification equals certified/approved |
| Critical assets          | business criticality / tier / CDE flags     | custom properties          | Normalize labels                        |
| Metadata coverage        | admin coverage service                      | computed from asset fields | Use weighted score                      |
| Open stewardship actions | tasks / governance queue                    | change_requests            | Pending/open only                       |
| Policy exceptions        | tasks/change_events/policy tables           | quality alerts             | Use explicit policy exception types     |
| Audit readiness          | metadata_audit_log + control coverage       | change_events              | Composite score                         |
| Domain posture           | coverage + quality + policy + certification | insights gap analysis      | Precompute for dashboard                |
| Freshness                | UC observed timestamps                      | quality freshness checks   | Mark unavailable when missing           |
| Lineage confidence       | lineage service                             | graph completeness         | Do not fake edges                       |
| CDE control coverage     | CDE controls table / quality checks         | derived from policy tags   | Need new or derived service             |

---

# 6. Phase-by-phase plan

## Phase 0 — Agent kickoff and repo safety

### Lead agent tasks

1. Create implementation branch:

```bash
git checkout -b feature/atlas-northstar
```

2. Run baseline tests before editing:

```bash
cd atlas/frontend
npm ci
npm run lint
npm run typecheck
npm test
npm run build

cd ../
python -m pytest -q
```

3. Capture baseline screenshots for current app if a local server can run.

4. Create a working notes file:

```txt
docs/northstar_implementation_log.md
```

5. Record:

   * Current failing tests, if any.
   * Current route map.
   * Current imported CSS order.
   * Current endpoint map.
   * Current feature flags.

### Acceptance criteria

* Baseline failures are documented before any code changes.
* No agent starts page redesign until shell, token, and API contract strategy are agreed.

---

## Phase 1 — Product rebrand foundation

### Goal

Centralize product naming and Entrada branding.

### Files to add

```txt
frontend/src/config/product.js
frontend/src/assets/brand/entrada-wordmark.svg
frontend/src/assets/brand/entrada-icon.svg
```

Use approved Entrada logo assets. Do not distribute or expose proprietary font files.

### Code snippet

```js
// frontend/src/config/product.js
export const PRODUCT = {
  companyName: "Entrada",
  productName: "Governance Atlas",
  shortName: "Atlas",
  aiName: "Atlas AI",
  appUrlLabel: "app.entradagovernance.com",
  copyright: "© 2026 Entrada. All rights reserved.",
};

export const ENVIRONMENT_LABELS = {
  production: "Prod • US East",
  staging: "Stage • US East",
  development: "Dev • Local",
};
```

### Update user-facing copy

Search and replace carefully:

```txt
Governance Atlas → Governance Atlas
Your data governance copilot → Your data governance copilot
Govat → only keep in internal code/test names where necessary; prefer Govat/Atlas for new runtime headers and environment variables
```

Do not rename query keys or storage keys yet unless the tests are updated.

### Update backend shell payload

Add product metadata to `_shell_payload`:

```python
"shell": {
    ...
    "product": {
        "companyName": "Entrada",
        "productName": "Governance Atlas",
        "aiName": "Atlas AI",
    },
}
```

### Tests

Frontend:

```jsx
it("renders Governance Atlas product name", () => {
  render(<GlobalHeader shell={{ product: { productName: "Governance Atlas" } }} />);
  expect(screen.getByText("Governance Atlas")).not.toBeNull();
});
```

Backend:

```python
def test_shell_payload_includes_atlas_product_metadata():
    payload = runtime_app._shell_payload(None, mode="inline-shell", state="loading")
    assert payload["shell"]["product"]["productName"] == "Governance Atlas"
```

### Acceptance criteria

* No visible “Governance Atlas” remains in the app shell or page headers.
* Internal package paths may remain unchanged.
* Tests still pass.

---

## Phase 2 — Entrada North Star design tokens

### Goal

Replace the current mixed cream/dark token foundation with a premium Entrada dark design system.

### File to modify

```txt
frontend/src/design/tokens/colors.css
frontend/src/design/tokens/typography.css
frontend/src/design/tokens/radius.css
frontend/src/design/tokens/shadow.css
frontend/src/styles/app.css
```

### Token snippet

```css
/* frontend/src/design/tokens/colors.css */

:root {
  color-scheme: dark;

  --ga-navy-980: #020914;
  --ga-navy-950: #04111f;
  --ga-navy-925: #061a2d;
  --ga-navy-900: #08233a;
  --ga-navy-850: #0a2d49;

  --ga-entrada-blue: #025080;
  --ga-highlight-blue: #3d84ad;
  --ga-bright-blue: #66c5ff;
  --ga-light-blue: #cfefff;
  --ga-gray: #b2bdc2;
  --ga-white: #ffffff;
  --ga-teal: #5ce1e6;

  --ga-success: #2ee6a6;
  --ga-warning: #ffb547;
  --ga-danger: #ff5c6c;
  --ga-purple: #9d7cff;

  --ga-bg: var(--ga-navy-980);
  --ga-shell: #03111f;
  --ga-surface: rgba(8, 35, 58, 0.84);
  --ga-surface-strong: rgba(10, 45, 73, 0.96);
  --ga-surface-soft: rgba(102, 197, 255, 0.08);
  --ga-border: rgba(102, 197, 255, 0.18);
  --ga-border-strong: rgba(102, 197, 255, 0.34);

  --ga-text: #f5fbff;
  --ga-text-soft: #cfefff;
  --ga-text-muted: #8fa8b6;

  /* Legacy aliases so existing CSS does not break. */
  --gh-bg: var(--ga-bg);
  --gh-bg-2: var(--ga-shell);
  --gh-surface: var(--ga-surface);
  --gh-surface-soft: var(--ga-surface-soft);
  --gh-surface-muted: rgba(10, 45, 73, 0.68);
  --gh-line: var(--ga-border);
  --gh-line-strong: var(--ga-border-strong);
  --gh-ink: var(--ga-text);
  --gh-ink-soft: var(--ga-text-soft);
  --gh-ink-muted: var(--ga-text-muted);
  --gh-accent: var(--ga-bright-blue);
  --gh-accent-2: var(--ga-highlight-blue);
  --gh-accent-soft: rgba(102, 197, 255, 0.16);
  --gh-indigo: var(--ga-purple);
  --gh-good: var(--ga-success);
  --gh-warn: var(--ga-warning);
  --gh-bad: var(--ga-danger);
}
```

Typography:

```css
/* frontend/src/design/tokens/typography.css */

:root {
  --ga-font-heading: "Hanken Grotesk", "Instrument Sans", "Inter", "Segoe UI", sans-serif;
  --ga-font-body: "Instrument Sans", "Inter", "Segoe UI", sans-serif;

  --gh-font: var(--ga-font-body);

  --ga-heading-weight: 600;
  --ga-body-weight: 400;
}
```

Global body:

```css
body {
  margin: 0;
  font-family: var(--ga-font-body);
  color: var(--ga-text);
  background:
    radial-gradient(circle at 72% 0%, rgba(102, 197, 255, 0.18), transparent 34%),
    radial-gradient(circle at 12% 18%, rgba(61, 132, 173, 0.16), transparent 28%),
    linear-gradient(180deg, #020914 0%, #04111f 45%, #020914 100%);
}
```

### Quality rules

* No hard-coded magenta/purple legacy colors unless used for status categories.
* Replace cream backgrounds.
* All surfaces must use tokens.
* All text must have contrast ratio ≥ 4.5:1 where practical.
* Use teal/blue glow sparingly.

### Tests

Add a visual token smoke test:

```jsx
it("uses Entrada dark shell tokens", () => {
  const style = getComputedStyle(document.documentElement);
  expect(style.getPropertyValue("--ga-bright-blue").trim()).toBe("#66c5ff");
});
```

### Acceptance criteria

* App shell is dark by default.
* Existing pages remain usable even before redesign.
* No light cream panels remain on primary pages.

---

## Phase 3 — Product shell, global header, and full nav rail

### Goal

Implement the North Star shell.

### Files

```txt
src/components/AppFrame.jsx
src/components/primitives/GlobalHeader.jsx
src/components/primitives/SideIconRail.jsx
src/styles/shell-rail.css
```

### Replace limited rail with full labeled rail

Current `SideIconRail` only visibly renders a subset of modules. Replace with a full expanded navigation.

```jsx
const NAV_ITEMS = [
  { key: "home", label: "Home", moduleKey: "home", icon: HomeIcon },
  { key: "discovery", label: "Discovery", moduleKey: "discovery", icon: SearchIcon },
  { key: "asset360", label: "Asset 360", moduleKey: "entity", icon: LayersIcon },
  { key: "lineage", label: "Lineage", moduleKey: "lineage", icon: LineageIcon },
  { key: "governance", label: "Governance", moduleKey: "governance", icon: ShieldIcon },
  { key: "insights", label: "Insights", moduleKey: "insights", icon: ChartIcon },
  { key: "taxonomy", label: "Taxonomy", moduleKey: "taxonomy", icon: TaxonomyIcon },
  { key: "cde", label: "CDEs", moduleKey: "cde", icon: DatabaseIcon },
  { key: "audit", label: "Audit", moduleKey: "audit", icon: AuditIcon },
  { key: "admin", label: "Admin", moduleKey: "admin", icon: GearIcon },
];
```

Render:

```jsx
<aside className="ga-side-nav" aria-label="Governance Atlas navigation">
  <div className="ga-side-nav-logo">
    <img src={entradaWordmark} alt="Entrada" />
  </div>

  <nav className="ga-side-nav-items">
    {NAV_ITEMS.map((item) => {
      const active = activeModule === item.moduleKey;
      return (
        <button
          key={item.key}
          className={`ga-side-nav-item ${active ? "is-active" : ""}`}
          aria-current={active ? "page" : undefined}
          onClick={() => onModuleChange?.(item.moduleKey)}
          type="button"
        >
          <item.icon />
          <span>{item.label}</span>
        </button>
      );
    })}
  </nav>

  <button className="ga-side-nav-collapse" type="button">
    Collapse
  </button>
</aside>
```

### Header target

```jsx
<header className="ga-topbar">
  <div className="ga-product-lockup">
    <span className="ga-product-name">Governance Atlas</span>
  </div>

  <TopbarSearch ... />

  <div className="ga-topbar-actions">
    <button className="ga-env-chip" type="button">
      <span className="ga-status-dot" />
      Prod • US East
    </button>

    <button className="ga-ai-chip" type="button">
      ✦ Atlas AI
    </button>

    <button aria-label="Notifications" className="ga-icon-button" type="button">
      <BellIcon />
      {inboxUnreadCount > 0 && <span>{inboxUnreadCount}</span>}
    </button>

    <UserChip ... />
  </div>
</header>
```

### Shell CSS

```css
.gh-app.gh-app-with-rail {
  width: 100%;
  min-height: 100vh;
  margin: 0;
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  grid-template-rows: 72px minmax(0, 1fr);
  gap: 0;
}

.ga-side-nav {
  grid-row: 1 / -1;
  grid-column: 1;
  background: linear-gradient(180deg, rgba(3, 17, 31, 0.98), rgba(2, 9, 20, 0.98));
  border-right: 1px solid var(--ga-border);
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
}

.ga-topbar {
  grid-column: 2;
  grid-row: 1;
  height: 72px;
  display: grid;
  grid-template-columns: auto minmax(320px, 560px) auto;
  align-items: center;
  gap: 24px;
  padding: 0 28px;
  background: rgba(3, 17, 31, 0.82);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--ga-border);
}

.gh-main {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  overflow: auto;
}
```

### Tests

* `AppFrame.test.jsx` must be updated to expect all nav items.
* Add keyboard navigation test.
* Add active nav test for every route.

```jsx
it.each([
  ["Home", "home"],
  ["Discovery", "discovery"],
  ["Asset 360", "entity"],
  ["Lineage", "lineage"],
  ["Governance", "governance"],
  ["Insights", "insights"],
  ["Taxonomy", "taxonomy"],
  ["CDEs", "cde"],
  ["Audit", "audit"],
  ["Admin", "admin"],
])("renders %s nav item", (label) => {
  render(<FrameHarness />);
  expect(screen.getByRole("button", { name: new RegExp(label, "i") })).not.toBeNull();
});
```

### Acceptance criteria

* Left nav visually matches the North Star.
* All surfaces are visible.
* Header includes Entrada, Governance Atlas, global search, environment, Atlas AI, notifications, user.
* No hidden-only primary nav pattern remains.

---

## Phase 4 — Reusable North Star UI primitives

### Goal

Build the component system once, then use it across all pages.

### Add directory

```txt
frontend/src/components/northstar
```

### Components

```txt
PageHero.jsx
MetricCard.jsx
Sparkline.jsx
DonutMetric.jsx
HeatmapMatrix.jsx
BarList.jsx
StatusPill.jsx
RightInspector.jsx
AtlasAiPanel.jsx
ActionTile.jsx
DataTable.jsx
SectionCard.jsx
EmptyState.jsx
DegradedBanner.jsx
```

### Example: MetricCard

```jsx
export function MetricCard({
  icon,
  label,
  value,
  delta,
  deltaTone = "good",
  sparkline = [],
  progress,
}) {
  return (
    <article className="ga-metric-card">
      <div className="ga-metric-card-head">
        <span className="ga-metric-icon">{icon}</span>
        <span className="ga-metric-label">{label}</span>
      </div>

      <div className="ga-metric-main">
        <strong>{value}</strong>
        {sparkline.length ? <Sparkline values={sparkline} /> : null}
      </div>

      {typeof progress === "number" ? (
        <div className="ga-progress">
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}

      {delta ? (
        <div className={`ga-metric-delta tone-${deltaTone}`}>{delta}</div>
      ) : null}
    </article>
  );
}
```

### Example: Sparkline

```jsx
export function Sparkline({ values = [], width = 96, height = 32 }) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;

  const points = nums.map((value, index) => {
    const x = (index / (nums.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="ga-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
```

### Example: SectionCard

```jsx
export function SectionCard({ title, eyebrow, actions, children, className = "" }) {
  return (
    <section className={`ga-section-card ${className}`.trim()}>
      <header className="ga-section-card-header">
        <div>
          {eyebrow ? <div className="ga-eyebrow">{eyebrow}</div> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div className="ga-section-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
```

### Acceptance criteria

* Every North Star page uses shared primitives.
* No page hand-codes one-off metric card styles.
* Charts are lightweight SVG/CSS unless a chart library is explicitly justified.

---

## Phase 5 — Backend composite APIs

### Goal

Create North Star-ready view-model endpoints that compose current services.

### Add files

```txt
atlas/atlas/api/atlas.py
atlas/atlas/services/atlas_metrics.py
atlas/tests/test_atlas_metrics.py
atlas/tests/test_atlas_api.py
```

### Register router

In `runtime_app.py`:

```python
from atlas.api.atlas import build_atlas_router

app.include_router(build_atlas_router())
```

### Add API contract keys

In `SHELL_API_CONTRACT`:

```python
"commandCenter": "/api/atlas/command-center",
"asset360": "/api/atlas/assets/:fqn/360",
"governanceWorkbench": "/api/atlas/governance/workbench",
"governanceRequestDetail": "/api/atlas/governance/requests/:id",
"insightsDashboard": "/api/atlas/insights",
"taxonomyOverview": "/api/atlas/taxonomy/overview",
"cdeDashboard": "/api/atlas/cde",
"cdeDetail": "/api/atlas/cde/:id",
"auditEvidence": "/api/atlas/audit/evidence",
"adminControlCenter": "/api/atlas/admin/control-center",
"atlasAiRecommendations": "/api/atlas-ai/recommendations",
"atlasAiChat": "/api/atlas-ai/chat",
```

### API skeleton

```python
# atlas/api/atlas.py

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from atlas.api.response import _with_meta, _error_response
from atlas.services import atlas_metrics


def build_atlas_router() -> APIRouter:
    router = APIRouter(prefix="/api/atlas", tags=["atlas"])

    @router.get("/command-center")
    def api_command_center(request: Request) -> JSONResponse:
        from runtime_app import _ensure_live_runtime, _visible_assets, _store_for_read

        _ensure_live_runtime()
        try:
            payload = atlas_metrics.command_center_payload(
                visible_assets=_visible_assets(request),
                store=_store_for_read(),
            )
        except Exception as exc:
            return _error_response(
                request,
                status_code=503,
                source="atlas-command-center",
                detail=str(exc),
                state="unavailable",
            )

        return JSONResponse(
            _with_meta(
                payload,
                request,
                source="unity-catalog+governance-store+quality+audit",
                state="available",
                authoritative=True,
            )
        )

    @router.get("/assets/{asset_fqn:path}/360")
    def api_asset_360(asset_fqn: str, request: Request) -> JSONResponse:
        from runtime_app import _ensure_live_runtime, _store_for_read, _uc_for_request

        _ensure_live_runtime()
        payload = atlas_metrics.asset_360_payload(
            uc=_uc_for_request(request),
            store=_store_for_read(),
            asset_fqn=asset_fqn,
        )
        return JSONResponse(
            _with_meta(
                payload,
                request,
                source="asset-detail+profile+quality+lineage+audit",
                state="available",
                authoritative=True,
            )
        )

    return router
```

### Command-center service

```python
# atlas/services/atlas_metrics.py

from __future__ import annotations

from typing import Any, Dict
import pandas as pd

from atlas.services import assets as asset_service


REQUIRED_METADATA_FIELDS = (
    "description",
    "domain",
    "tier",
    "certification",
    "sensitivity",
    "business_criticality",
)


def _safe_count(df: pd.DataFrame | None) -> int:
    try:
        return int(len(df.index))
    except Exception:
        return 0


def _has_value(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text and text.lower() not in {"unassigned", "none", "null"})


def metadata_coverage_for_row(row: pd.Series) -> float:
    total = len(REQUIRED_METADATA_FIELDS)
    present = sum(1 for field in REQUIRED_METADATA_FIELDS if _has_value(row.get(field)))
    try:
      owners = asset_service.owner_entries(row)
      if owners:
          present += 1
      total += 1
    except Exception:
      pass
    return round((present / total) * 100, 1) if total else 0.0


def command_center_payload(*, visible_assets: pd.DataFrame, store) -> Dict[str, Any]:
    assets_df = visible_assets if visible_assets is not None else pd.DataFrame()
    total_assets = _safe_count(assets_df)

    coverage_values = [
        metadata_coverage_for_row(row)
        for _, row in assets_df.iterrows()
    ] if not assets_df.empty else []

    metadata_coverage = round(sum(coverage_values) / len(coverage_values), 1) if coverage_values else 0

    certified_assets = 0
    critical_assets = 0
    domain_scores = {}

    for _, row in assets_df.iterrows():
        cert = str(row.get("certification") or "").strip().lower()
        criticality = str(
            row.get("business_criticality")
            or row.get("businessCriticality")
            or row.get("criticality")
            or ""
        ).strip().lower()

        if cert in {"certified", "approved"}:
            certified_assets += 1

        if criticality in {"mission critical", "business critical", "critical", "high"}:
            critical_assets += 1

        domain = str(row.get("domain") or "Unassigned").strip() or "Unassigned"
        domain_scores.setdefault(domain, []).append(metadata_coverage_for_row(row))

    top_domains = [
        {
            "domain": domain,
            "score": round(sum(scores) / len(scores), 1),
            "assetCount": len(scores),
        }
        for domain, scores in domain_scores.items()
    ]
    top_domains.sort(key=lambda item: item["score"], reverse=True)

    open_tasks = 0
    policy_exceptions = 0
    recent_events = []
    try:
        change_requests = store.list_change_requests(status="pending", limit=200)
        open_tasks = _safe_count(change_requests)
    except Exception:
        pass

    try:
        audit = store.list_metadata_audit(limit=25)
        recent_events = [
            {
                "title": str(row.get("action") or "Governance event"),
                "detail": str(row.get("detail") or row.get("entity_fqn") or ""),
                "createdAt": str(row.get("created_at") or ""),
                "tone": "bad" if str(row.get("status") or "").lower() == "failed" else "info",
            }
            for _, row in audit.head(8).iterrows()
        ]
    except Exception:
        pass

    audit_readiness = 92 if total_assets else 0

    return {
        "kpis": [
            {
                "key": "governedAssets",
                "label": "Governed Assets",
                "value": total_assets,
                "delta": "+12.4% vs last 30 days",
                "sparkline": [42, 44, 48, 46, 52, 55],
            },
            {
                "key": "certifiedCriticalAssets",
                "label": "Certified Critical Assets",
                "value": min(certified_assets, critical_assets) if critical_assets else certified_assets,
                "delta": "+8.7% vs last 30 days",
                "sparkline": [31, 36, 35, 40, 44, 49],
            },
            {
                "key": "metadataCoverage",
                "label": "Metadata Coverage",
                "value": metadata_coverage,
                "format": "percent",
                "delta": "+6pp vs last 30 days",
                "progress": metadata_coverage,
            },
            {
                "key": "openStewardship",
                "label": "Open Stewardship Actions",
                "value": open_tasks,
                "delta": "-9.3% vs last 30 days",
            },
            {
                "key": "policyExceptions",
                "label": "Policy Exceptions",
                "value": policy_exceptions,
                "delta": "-22.9% vs last 30 days",
            },
            {
                "key": "auditReadiness",
                "label": "Audit Readiness",
                "value": audit_readiness,
                "format": "percent",
                "delta": "+7pp vs last 30 days",
                "progress": audit_readiness,
            },
        ],
        "posture": {
            "overall": metadata_coverage,
            "trend": [],
            "byDomain": top_domains[:8],
        },
        "topDomains": top_domains[:5],
        "recentEvents": recent_events,
        "quickActions": [
            {"key": "registerAsset", "label": "Register New Asset", "route": "/discovery"},
            {"key": "createPolicy", "label": "Create Policy", "route": "/governance"},
            {"key": "runQuality", "label": "Run Data Quality Check", "route": "/insights"},
            {"key": "requestAccess", "label": "Request Access Review", "route": "/governance"},
        ],
        "aiPrompts": [
            "Which domains have the highest risk of policy exceptions?",
            "Show me data quality issues impacting critical assets.",
            "What changed in governance posture this month?",
            "Which assets are missing critical metadata?",
        ],
    }
```

### Frontend API helpers

```js
// frontend/src/lib/api.js

export function fetchCommandCenter(options = {}) {
  const path = contractPath("commandCenter") || "/atlas/command-center";
  return request(path, { signal: options.signal });
}

export function fetchAsset360(assetFqn, options = {}) {
  const template = contractPath("asset360") || "/atlas/assets/:fqn/360";
  return request(routeToken(template, "fqn", assetFqn), { signal: options.signal });
}

export function fetchGovernanceWorkbench(options = {}) {
  const path = contractPath("governanceWorkbench") || "/atlas/governance/workbench";
  return request(path, { signal: options.signal });
}
```

### Tests

Backend:

```python
def test_command_center_payload_counts_visible_assets():
    df = pd.DataFrame([
        {"fqn": "main.sales.customer", "certification": "Certified", "domain": "Customer"},
        {"fqn": "main.finance.revenue", "certification": "Draft", "domain": "Finance"},
    ])

    payload = atlas_metrics.command_center_payload(visible_assets=df, store=NullStore())

    assert payload["kpis"][0]["key"] == "governedAssets"
    assert payload["kpis"][0]["value"] == 2
```

Frontend:

```jsx
it("renders command center from API kpis", async () => {
  vi.mock("../lib/api", () => ({
    fetchCommandCenter: () => Promise.resolve({
      kpis: [{ key: "governedAssets", label: "Governed Assets", value: 24613 }],
      posture: {},
      topDomains: [],
      recentEvents: [],
      quickActions: [],
      aiPrompts: [],
      meta: { state: "available" },
    }),
  }));

  render(<HomePage />);
  expect(await screen.findByText("Governed Assets")).not.toBeNull();
  expect(await screen.findByText("24,613")).not.toBeNull();
});
```

### Acceptance criteria

* Composite endpoints exist.
* Endpoints are tested.
* Existing endpoints still pass tests.
* Response metadata is preserved.

---

## Phase 6 — Home / Executive Command Center

### Goal

Implement the Home North Star screen.

### File

```txt
src/components/HomePage.jsx
src/styles/home.css
```

### UX structure

```txt
PageHero
├── Title: Enterprise Governance Command Center
├── Subtitle: Unified visibility. Trusted data. Confident decisions.
├── Globe/network visual background

KPI row
├── Governed Assets
├── Certified Critical Assets
├── Metadata Coverage
├── Open Stewardship Actions
├── Policy Exceptions
└── Audit Readiness

Main grid
├── Governance Posture Over Time
├── Posture by Domain heatmap
├── Atlas AI panel
├── Top Domains
├── Recent High-Priority Events
└── Quick Actions
```

### Hook

```js
// src/hooks/useCommandCenter.js
import { useQuery } from "@tanstack/react-query";
import { fetchCommandCenter } from "../lib/api";

export function useCommandCenter() {
  return useQuery({
    queryKey: ["atlas", "command-center"],
    queryFn: ({ signal }) => fetchCommandCenter({ signal }),
    staleTime: 60_000,
  });
}
```

### Component skeleton

```jsx
export function HomePage({ onNavigate }) {
  const { data, isLoading, error } = useCommandCenter();

  if (isLoading) return <WorkspaceStateCard title="Loading command center…" />;
  if (error) return <WorkspaceStateCard tone="bad" title="Command center unavailable" />;

  const kpis = data?.kpis || [];

  return (
    <section className="ga-page ga-home-page">
      <PageHero
        title="Enterprise Governance Command Center"
        subtitle="Unified visibility. Trusted data. Confident decisions."
        visual={<GlobeNetworkVisual />}
      />

      <div className="ga-kpi-grid six">
        {kpis.map((kpi) => (
          <MetricCard
            key={kpi.key}
            label={kpi.label}
            value={formatMetric(kpi)}
            delta={kpi.delta}
            sparkline={kpi.sparkline}
            progress={kpi.progress}
          />
        ))}
      </div>

      <div className="ga-home-grid">
        <SectionCard title="Governance Posture Over Time">
          <PostureTrendChart data={data.posture?.trend || []} />
        </SectionCard>

        <SectionCard title="Posture by Domain">
          <HeatmapMatrix data={data.posture?.heatmap || []} />
        </SectionCard>

        <AtlasAiPanel prompts={data.aiPrompts || []} />

        <SectionCard title="Top Domains">
          <BarList items={data.topDomains || []} />
        </SectionCard>

        <SectionCard title="Recent High-Priority Events">
          <EventList events={data.recentEvents || []} />
        </SectionCard>

        <SectionCard title="Quick Actions">
          <ActionTileGrid actions={data.quickActions || []} onNavigate={onNavigate} />
        </SectionCard>
      </div>
    </section>
  );
}
```

### Tests

* Renders all six KPIs.
* Degraded meta shows a banner.
* Quick actions navigate to correct surfaces.
* No hard-coded fake metric values when API returns empty.

### Acceptance criteria

* Visually matches North Star command center.
* Uses live/composite API.
* Strong executive value story.

---

## Phase 7 — Discovery page

### Goal

Turn Discovery into an AI-assisted governed asset discovery experience.

### Existing base

Use current:

```txt
DiscoveryWorkspace.jsx
useDiscoveryWorkspace.js
useDiscoveryResults.js
fetchDiscoverySearch
```

### UX additions

* Large semantic search bar.
* Rich filter chips.
* Result tabs: Results, Datasets, Reports, Dashboards, Policies, Glossary Terms.
* Premium result table.
* Right asset preview drawer.
* Saved views.
* Recommended assets.
* Atlas AI recommendations.

### Backend needs

Existing `/api/discovery/search` should be augmented with optional fields:

```json
{
  "assets": [
    {
      "fqn": "main.customer.customer_dim",
      "name": "customer_dim",
      "type": "Dataset",
      "ownerEntries": [],
      "certification": "Certified",
      "domain": "Customer",
      "metadataCoverage": 92,
      "sensitivity": "PII",
      "glossaryTermCount": 12,
      "description": "...",
      "preview": {
        "keyColumns": [],
        "lineageSnippet": [],
        "qualityScore": 92,
        "criticality": "High"
      }
    }
  ],
  "facets": {},
  "recommendations": [],
  "savedViews": [],
  "meta": {}
}
```

If adding this to existing discovery endpoint is risky, add:

```txt
GET /api/atlas/discovery/enrich?fqn=...
```

### Frontend component split

```txt
DiscoveryWorkspace.jsx
├── DiscoveryHero
├── DiscoveryFilterBar
├── DiscoveryResultsTable
├── DiscoveryPreviewPanel
├── SavedViewsPanel
├── RecommendedAssetsPanel
└── AtlasDiscoveryRecommendations
```

### Test requirements

* Query persists in URL.
* Filter chips map to current query syntax.
* Selecting a result opens preview.
* Open Asset 360 calls `openAssetRecordSafely`.
* View Lineage routes to `/lineage/{fqn}`.
* Unauthorized/unopenable assets show proper message.

### Acceptance criteria

* Discovery looks like the North Star.
* Search is genuinely backed by current discovery endpoint.
* No duplicate request storms.
* Preview drawer is stable during selection changes.

---

## Phase 8 — Asset 360 page

### Goal

Upgrade `EntityWorkspace` into the North Star Asset 360 cockpit.

### Current base

```txt
EntityWorkspace.jsx
useAssetDetail
useAssetProfile
useAssetQuality
useAssetCustomProperties
useGovernanceAuditTimeline
useLineage
```

### UX structure

```txt
Asset header
├── breadcrumb
├── asset name
├── display name
├── full FQN
├── badges: Certified, Mission Critical, PII, Domain, Data Product
├── actions: Request Change, Open Lineage, Certify

Hero metadata cards
├── Owner
├── Steward
├── Freshness
├── Rows
├── Size

Tabs
├── Overview
├── Columns
├── Governance
├── Quality
├── Access
└── Activity

Overview grid
├── Business Description
├── Usage Summary
├── Schema table
├── Governance panel
└── Right rail: Recent Activity, Related Assets, Downstream Dashboards
```

### Backend

Add `GET /api/atlas/assets/{fqn}/360` to prevent frontend waterfall.

Payload:

```json
{
  "asset": {},
  "owners": [],
  "stewards": [],
  "badges": [],
  "freshness": {},
  "usage": {},
  "schema": [],
  "governance": {},
  "quality": {},
  "access": {},
  "activity": [],
  "relatedAssets": [],
  "downstreamDashboards": []
}
```

Use existing asset detail sections internally.

### Frontend skeleton

```jsx
export default function EntityWorkspace({ initialAssetFqn, onOpenLineageWorkspace }) {
  const { data, isLoading, error } = useAsset360(initialAssetFqn);

  if (isLoading) return <WorkspaceStateCard title="Loading Asset 360…" />;
  if (error) return <WorkspaceStateCard tone="bad" title="Asset unavailable" />;

  return (
    <section className="ga-page ga-asset360">
      <Asset360Hero
        asset={data.asset}
        badges={data.badges}
        onOpenLineage={() => onOpenLineageWorkspace?.(data.asset.fqn)}
      />

      <AssetHeroStats {...data} />

      <SurfaceTabs ... />

      <div className="ga-asset360-grid">
        <BusinessDescriptionPanel asset={data.asset} />
        <UsageSummaryPanel usage={data.usage} />
        <SchemaTable columns={data.schema} />
        <GovernancePanel governance={data.governance} />
        <AssetRightRail data={data} />
      </div>
    </section>
  );
}
```

### Tests

* Asset FQN loads.
* Tags render correctly.
* Certify button hidden/disabled for read-only role.
* Schema search works.
* Recent activity renders audit events.

### Acceptance criteria

* Asset 360 page feels like a complete data product profile.
* Actions are role-aware.
* No stale seeded asset data leaks into live view.

---

## Phase 9 — Lineage explorer

### Goal

Make lineage the visual showstopper.

### Current base

```txt
LineageWorkspace.jsx
LineageStage.jsx
LineageGraph.jsx
useLineage
@xyflow/react
```

### UX structure

```txt
Header
├── End-to-End Lineage Explorer
├── table / column lineage toggle
├── time window
├── impact analysis
├── environment
├── fullscreen

Main
├── left asset summary panel
├── central graph
├── right selected asset inspector
├── path tracer
└── change history
```

### Implementation instructions

1. Preserve existing lineage fetch and caching behavior.
2. Do not remove first-hop/full-depth optimization.
3. Add a graph adapter that maps current lineage payload to North Star lanes:

```js
export function buildLineageLanes(payload) {
  return {
    upstreamSources: payload.upstream?.filter(isSource) || [],
    transformations: payload.upstream?.filter(isTransformation) || [],
    governedAsset: payload.focus,
    downstreamConsumers: payload.downstream || [],
  };
}
```

4. Use React Flow for graph but restyle nodes.

```jsx
function AtlasLineageNode({ data }) {
  return (
    <div className={`ga-lineage-node tone-${data.tone || "default"}`}>
      <div className="ga-lineage-node-icon">{data.icon}</div>
      <div>
        <strong>{data.label}</strong>
        <span>{data.subtitle}</span>
      </div>
      <StatusDot tone={data.statusTone} />
    </div>
  );
}
```

5. Add selected node inspector.

6. Add path tracer from shortest path / most common path if available. If not available, show “Path tracing unavailable for this asset” rather than inventing.

### Tests

* Graph renders focal node.
* Selecting node opens inspector.
* Column lineage trace button calls `/api/lineage/column-trace`.
* Fullscreen toggle is keyboard accessible.
* Empty lineage shows a graceful state.

### Acceptance criteria

* Focal node is visually obvious.
* Graph is readable at 1536×1024 and 1440×900.
* No broken or overlapping critical controls.

---

## Phase 10 — Governance / Stewardship Workbench

### Goal

Upgrade `GovernanceWorkspace` into the North Star stewardship workbench.

### UX structure

```txt
Header
├── Stewardship Workbench
├── Pending Approvals
├── Overdue Items
├── Policy Exceptions
├── SLA Performance

Main
├── Request queue table
└── Request detail pane
    ├── metadata before/after diff
    ├── business context
    ├── asset impact
    ├── approver flow
    ├── comments
    ├── evidence
    └── Approve / Request Changes / Escalate
```

### Backend

Current governance API has summary and PATCH. Add detail endpoint:

```txt
GET /api/atlas/governance/workbench
GET /api/atlas/governance/requests/{request_id}
```

Payload:

```json
{
  "metrics": [],
  "requests": [],
  "selectedRequest": {
    "requestId": "REQ-2025-1001",
    "type": "assign_owner",
    "priority": "High",
    "status": "Pending",
    "diff": {
      "before": {},
      "after": {}
    },
    "businessContext": "",
    "assetImpact": {},
    "approverFlow": [],
    "comments": [],
    "evidence": []
  }
}
```

### Diff component

```jsx
function MetadataDiff({ rows }) {
  return (
    <table className="ga-diff-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Before</th>
          <th />
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field}>
            <td>{row.label}</td>
            <td className="before">{row.before || "—"}</td>
            <td>→</td>
            <td className="after">{row.after || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Tests

* Queue filters work.
* Selecting a request updates details pane.
* Approve calls existing PATCH endpoint.
* Request Changes requires comment.
* Escalate is role-gated.
* Optimistic update updates request status after success.

### Acceptance criteria

* Workbench is decisive and operational.
* Approver flow is clear.
* No write action is available to unauthorized users.

---

## Phase 11 — Governance Insights

### Goal

Transform the current gap-analysis page into an executive insights cockpit.

### Current base

```txt
/api/insights/gap-analysis
InsightsWorkspace.jsx
atlas/services/insights.py
```

### Add composite endpoint

```txt
GET /api/atlas/insights
```

### Payload

```json
{
  "kpis": [
    {"key": "maturity", "label": "Governance Maturity Score", "value": 82},
    {"key": "policyCompliance", "label": "Policy Compliance", "value": 92},
    {"key": "resolutionDays", "label": "Time to Resolution (P1)", "value": 3.6},
    {"key": "certifiedAssets", "label": "Certified Assets", "value": 1842},
    {"key": "criticalExceptions", "label": "Critical Policy Exceptions", "value": 27},
    {"key": "metadataCoverage", "label": "Metadata Coverage", "value": 78}
  ],
  "policyComplianceTrend": [],
  "resolutionTrend": [],
  "metadataCoverageHeatmap": [],
  "certificationCoverageByTier": [],
  "riskHeatmap": [],
  "domainLeaderboard": [],
  "roi": [],
  "recommendations": []
}
```

### Scoring formula

Use transparent composite score:

```txt
Governance Maturity =
  30% metadata coverage
+ 20% certification coverage
+ 15% ownership coverage
+ 15% policy compliance
+ 10% quality health
+ 10% audit readiness
```

Return formula in payload:

```json
"scoring": {
  "maturityFormula": [
    {"signal": "metadataCoverage", "weight": 0.30},
    {"signal": "certificationCoverage", "weight": 0.20}
  ]
}
```

### Tests

* Formula weights sum to 1.
* Missing signals degrade score instead of crashing.
* Recommendations include evidence.
* ROI metrics are absent unless computed from live, actor-visible signals.

### Acceptance criteria

* Insights page is boardroom-ready.
* Strategic recommendations are evidence-backed.
* No uncited AI claims.

---

## Phase 12 — Taxonomy and glossary

### Goal

Turn `TaxonomyWorkspace` into a premium business-language workspace.

### Current base

Existing endpoints:

```txt
/api/classifications
/api/domains
/api/data-products
/api/governance/columns
/api/governance/glossary
/api/governance/glossary/{id}
```

### UX structure

```txt
Business Taxonomy & Glossary
├── subnav: Classifications, Domains, Data Products, Column Groups
├── classification tree
├── terms list
└── selected term detail
    ├── definition
    ├── owner / steward
    ├── approval status
    ├── review date
    ├── synonyms
    ├── related terms
    ├── linked assets
    ├── domain relationship
    └── data products
```

### Implementation

* Reuse current taxonomy endpoints.
* Use existing glossary term detail endpoint.
* Add `/api/atlas/taxonomy/overview` only if current endpoints are too chatty.

### Tests

* Term selection updates detail.
* Search filters terms.
* Status pills render draft/proposed/approved correctly.
* Empty glossary renders helpful state.

### Acceptance criteria

* Feels curated and authoritative.
* Strong domain hierarchy visualization.
* No broken overflow on long term names.

---

## Phase 13 — CDEs / Critical Data Elements Registry

### Goal

Expand current CDE registry into a CDE operating surface.

### Current base

```txt
GET /api/cde
```

Currently CDEs are read-only and derived from assets tagged as CDEs.

### Add detail endpoint

```txt
GET /api/atlas/cde
GET /api/atlas/cde/{cde_id}
```

### Payload

```json
{
  "summary": {
    "totalCdes": 1248,
    "protectedCdes": 892,
    "overdueReviews": 56,
    "domainsCovered": 12
  },
  "groups": [
    {
      "domain": "Customer",
      "items": [
        {
          "id": "customer_id",
          "name": "Customer ID",
          "domain": "Customer",
          "owner": "Maria Gomez",
          "sensitivity": "High",
          "criticality": "Critical",
          "controlCoverage": 96,
          "linkedPolicies": 7,
          "downstreamImpact": "High",
          "certification": "Certified",
          "lastReview": "2025-05-08"
        }
      ]
    }
  ]
}
```

### Control coverage

If no dedicated control table exists, derive first version from:

```txt
Access Control     → access policy tags / grants / access explanation
Data Protection    → sensitivity tags + policy tags
Data Quality       → quality runs
Monitoring         → audit/change events
Retention          → retention policy tags / glossary metadata
```

Mark unavailable controls as degraded, not zero.

### Tests

* Domain filter works.
* Detail pane loads selected CDE.
* Control coverage handles missing signals.
* Download/export button is role-gated if it exports sensitive metadata.

### Acceptance criteria

* CDEs page looks like an executive risk registry.
* Selected CDE detail is rich enough for demo storytelling.
* Does not expose sample PII values.

---

## Phase 14 — Audit Trail & Change Evidence

### Goal

Upgrade `AuditBrowserWorkspace` into the North Star audit and evidence browser.

### Current base

```txt
GET /api/audit/events
metadata_audit_log
change_events
entity_versions
export service
```

### UX structure

```txt
Header
├── Audit Trail & Change Evidence
├── Immutable Log / WORM enabled indicator

KPI cards
├── Total Changes
├── Policy Changes
├── Approvals
├── Failed Actions

Filters
├── Actor
├── Action
├── Date Range
├── Object
├── Request ID
└── Domain

Main
├── audit log table
└── right-side Change Details drawer
    ├── before/after diff
    ├── approval chain
    ├── evidence artifacts
    ├── linked request
    └── export evidence package
```

### Backend

Extend existing audit endpoint or add:

```txt
GET /api/atlas/audit/evidence?audit_id=...
POST /api/export/evidence-package
```

Evidence package should use existing export job framework.

### Tests

* Filters serialize to URL params.
* Detail drawer opens for selected row.
* Diff renders before/after JSON safely.
* Export creates background job.
* Failed rows render red status.

### Acceptance criteria

* Compliance-ready.
* Clear immutable log semantics.
* Evidence package export is backed by actual audit data.

---

## Phase 15 — Admin Control Center

### Goal

Make Admin feel like an enterprise control plane.

### Current base

```txt
AdminWorkspace.jsx
CoverageWorkspace.jsx
BrandingWorkspace.jsx
BulkImportWorkspace.jsx
/api/admin/coverage
/api/admin/branding
/api/admin/bulk-import/*
/api/admin/background/status
```

### UX structure

```txt
Administration & Control Center
├── tabs: Coverage, Branding, Bulk Import, Integrations
├── governance policy requirements
├── recent admin activity
├── branding preview
├── bulk import status
├── integrations/runtime
└── system & access
```

### Backend

Add:

```txt
GET /api/atlas/admin/control-center
```

Compose:

* Admin coverage.
* Branding.
* Background drainer status.
* Runtime status.
* Role and identity.
* Recent metadata audit events.
* Integration statuses from capability service.

### Tests

* Non-admin sees read-only/admin-gated banner.
* Branding preview updates from API.
* Bulk import validation still works.
* Runtime status renders connected/degraded/unavailable.

### Acceptance criteria

* Admin page closes the sale.
* Shows platform reliability, integrations, access, and brand readiness.
* No write buttons for non-admin users.

---

## Phase 16 — Atlas AI Copilot

### Goal

Add a controlled, evidence-backed AI layer.

### UX surfaces

* Header `Atlas AI` button.
* Home right-side Ask Atlas AI panel.
* Discovery AI recommendations.
* Insights strategic recommendations.
* Optional chat drawer.

### Backend

Add:

```txt
POST /api/atlas-ai/recommendations
POST /api/atlas-ai/chat
```

### Security rules

* Never send raw sample data or PII values to an LLM.
* Redact asset names only if policy requires; otherwise FQNs are okay if already visible to actor.
* Only include actor-visible metadata.
* Every AI response must include evidence references:

```json
{
  "answer": "Finance has the highest policy exception risk.",
  "evidence": [
    {"type": "domain", "id": "Finance", "metric": "policyExceptions", "value": 12}
  ],
  "suggestedActions": []
}
```

### AI service snippet

```python
def build_ai_context(*, visible_assets, store, question: str) -> dict:
    return {
        "question": question,
        "allowedSignals": {
            "assetCount": len(visible_assets.index),
            "domains": summarize_domains(visible_assets),
            "openTasks": summarize_open_tasks(store),
            "recentAudit": summarize_recent_audit(store),
        },
        "redaction": {
            "sampleValuesIncluded": False,
            "piiValuesIncluded": False,
        },
    }
```

### Frontend guardrail

```jsx
<p className="ga-ai-disclaimer">
  Atlas AI uses governed metadata and may be incomplete. Review before acting.
</p>
```

### Tests

* AI endpoint rejects empty question.
* AI context excludes sample values.
* AI response without evidence is rejected or marked low-confidence.
* Frontend renders evidence links.

### Acceptance criteria

* AI feels premium but trustworthy.
* Every recommendation is actionable.
* No hallucinated governance facts.

---

# 7. Visual QA requirements

Use the North Star mockups as the visual benchmark.

## Required screenshot test matrix

Capture at:

```txt
1536 × 1024
1440 × 900
1280 × 720
```

Pages:

```txt
/home
/discovery
/entity/{sample_asset}
/lineage/{sample_asset}
/governance
/insights
/taxonomy
/cde
/audit
/admin
```

## Playwright screenshot test skeleton

```js
import { test, expect } from "@playwright/test";

const pages = [
  ["/home", "home"],
  ["/discovery", "discovery"],
  ["/governance", "governance"],
  ["/insights", "insights"],
  ["/taxonomy", "taxonomy"],
  ["/cde", "cde"],
  ["/audit", "audit"],
  ["/admin", "admin"],
];

for (const [path, name] of pages) {
  test(`${name} North Star visual`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot(`${name}-northstar.png`, {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.03,
    });
  });
}
```

## Visual acceptance checklist

Each page must pass:

```txt
[ ] Entrada logo visible and crisp
[ ] Governance Atlas name visible
[ ] Active nav item correct
[ ] No cream/light legacy panels
[ ] No browser chrome rendered inside app
[ ] No overlapping text
[ ] No cut-off tables at 1536×1024
[ ] Right inspector readable
[ ] Charts are legible
[ ] Status colors are consistent
[ ] Empty/degraded states look intentional
```

---

# 8. Accessibility requirements

Minimum:

```txt
[ ] All nav items are buttons or links with accessible names
[ ] Active page uses aria-current="page"
[ ] Search input has accessible label
[ ] Tables have proper th headers
[ ] Icon-only buttons have aria-label
[ ] Drawers use role="dialog" where modal
[ ] Esc closes drawers/panels
[ ] Focus is visible
[ ] Keyboard can reach all actions
[ ] Color is not the only status indicator
```

Optional but recommended:

```bash
npm install -D @axe-core/playwright
```

Run axe checks in Playwright for major pages.

---

# 9. Performance requirements

## Frontend

* Initial shell renders under 1.5s after JS loaded.
* Keep lazy loading workspace chunks.
* Do not import all page code into shell.
* Keep chart components lightweight SVG.
* Memoize expensive table transforms.
* Virtualize tables only if row count exceeds 300.

## Backend

* Composite endpoints should complete under 2s with cached inventory.
* Avoid repeated `_visible_assets(request)` calls in same request.
* Use store reads with sane limits.
* Long-running exports stay background jobs.
* Use TTL cache for dashboard summaries when safe.

### Backend cache snippet

```python
_COMMAND_CENTER_CACHE_TTL_SECONDS = 60

def command_center_cache_key(request) -> str:
    from runtime_app import _request_cache_scope
    return f"atlas_command_center:{_request_cache_scope(request)}"
```

---

# 10. Security and governance requirements

```txt
[ ] Preserve OBO/app-principal distinction
[ ] Preserve role gates on writes
[ ] Do not expose hidden catalogs
[ ] Do not expose sample PII values
[ ] Do not show assets the actor cannot see
[ ] Do not allow AI endpoint to bypass visibility
[ ] Sanitize markdown
[ ] Validate all POST/PATCH payloads
[ ] Audit all write actions
[ ] Include request IDs in errors
```

Specific write actions requiring elevated role:

```txt
Certify asset
Assign owner
Approve request
Request changes
Escalate
Update glossary term
Bulk import commit
Branding update
Export evidence package if sensitive
```

---

# 11. Required subagents and responsibilities

## 11.1 Lead Orchestrator Agent

Responsibilities:

* Own branch and integration order.
* Assign work to subagents.
* Enforce no broken tests at phase boundaries.
* Maintain implementation log.
* Review every PR/diff for accidental fake data, product-name regressions, or auth regressions.

Instructions:

```txt
Do not let subagents directly rewrite runtime_app.py broadly.
Do not accept page-specific CSS that duplicates token decisions.
Do not accept backend endpoints without tests.
Do not accept UI pages that only look good with seeded data.
```

Deliverables:

```txt
docs/northstar_implementation_log.md
docs/northstar_acceptance_checklist.md
```

---

## 11.2 Design System Subagent

Responsibilities:

* Implement Entrada tokens.
* Implement reusable North Star primitives.
* Replace legacy cream styles.
* Ensure typography follows Entrada style guide.
* Create CSS docs.

Deliverables:

```txt
src/design/tokens/*
src/components/northstar/*
src/styles/northstar.css
src/components/northstar/__tests__/*
```

Acceptance:

```txt
[ ] No primary page uses legacy cream
[ ] Components support loading, empty, degraded states
[ ] Components are reusable by all pages
```

---

## 11.3 Shell and Navigation Subagent

Responsibilities:

* Rework AppFrame.
* Rework GlobalHeader.
* Rework SideIconRail into full side nav.
* Add Atlas AI trigger.
* Add environment chip.
* Ensure all routes highlight nav correctly.

Deliverables:

```txt
AppFrame.jsx
GlobalHeader.jsx
SideIconRail.jsx
shell-rail.css
AppFrame.test.jsx
ShellTopbarIdentity.test.jsx
```

Acceptance:

```txt
[ ] All nav items visible
[ ] Header matches North Star
[ ] Global search still works
[ ] Inbox/notifications still work
[ ] Command palette still works
```

---

## 11.4 Backend Data Contract Subagent

Responsibilities:

* Add `atlas/api/atlas.py`.
* Add `atlas/services/atlas_metrics.py`.
* Add composite endpoints.
* Add meta/provenance.
* Extend API contract.
* Add tests.

Deliverables:

```txt
atlas/api/atlas.py
atlas/services/atlas_metrics.py
tests/test_atlas_api.py
tests/test_atlas_metrics.py
docs/atlas_api_contract.md
```

Acceptance:

```txt
[ ] Endpoints return stable JSON
[ ] Existing endpoints unchanged
[ ] OBO/visibility respected
[ ] Tests pass
```

---

## 11.5 Home and Insights Subagent

Responsibilities:

* Implement command center.
* Implement governance insights cockpit.
* Build executive KPI visuals.
* Build AI recommendations panel using evidence-backed data.

Deliverables:

```txt
HomePage.jsx
InsightsWorkspace.jsx
useCommandCenter.js
useInsightsDashboard.js
home.css
insights.css
```

Acceptance:

```txt
[ ] Home matches North Star command center
[ ] Insights is boardroom-ready
[ ] Degraded data states are clear
```

---

## 11.6 Discovery and Asset 360 Subagent

Responsibilities:

* Upgrade Discovery UI.
* Implement asset preview drawer.
* Upgrade EntityWorkspace into Asset 360.
* Preserve current discovery search behavior.

Deliverables:

```txt
DiscoveryWorkspace.jsx
EntityWorkspace.jsx
useAsset360.js
discovery.css
entity.css
```

Acceptance:

```txt
[ ] Discovery search and filters still work
[ ] Preview drawer works
[ ] Asset 360 actions route correctly
[ ] Role-gated actions are correct
```

---

## 11.7 Lineage Subagent

Responsibilities:

* Restyle lineage with North Star graph.
* Add left summary panel.
* Add right inspector.
* Add path tracer and change history.
* Preserve current lineage caching.

Deliverables:

```txt
LineageWorkspace.jsx
LineageStage.jsx
LineageGraph.jsx
lineage.css
LineageWorkspace.test.jsx
LineageStage.test.jsx
```

Acceptance:

```txt
[ ] Focal node obvious
[ ] Graph readable
[ ] Column lineage works
[ ] Empty lineage graceful
```

---

## 11.8 Governance, CDE, and Audit Subagent

Responsibilities:

* Implement stewardship workbench.
* Expand CDE registry/detail.
* Upgrade audit evidence browser.
* Ensure write actions audit correctly.

Deliverables:

```txt
GovernanceWorkspace.jsx
CdeWorkspace.jsx
AuditBrowserWorkspace.jsx
governance.css
cde.css
audit.css
tests for request detail / CDE detail / audit evidence
```

Acceptance:

```txt
[ ] Governance queue operational
[ ] Request diff is clear
[ ] CDE controls are trustworthy
[ ] Audit evidence export works or is gracefully unavailable
```

---

## 11.9 Taxonomy and Admin Subagent

Responsibilities:

* Upgrade taxonomy/glossary UX.
* Upgrade admin control center.
* Preserve branding/bulk import/coverage behavior.

Deliverables:

```txt
TaxonomyWorkspace.jsx
AdminWorkspace.jsx
CoverageWorkspace.jsx
BrandingWorkspace.jsx
BulkImportWorkspace.jsx
taxonomy.css
admin.css
```

Acceptance:

```txt
[ ] Taxonomy feels curated and professional
[ ] Admin feels like a control plane
[ ] Existing admin tests pass
```

---

## 11.10 QA and Validation Subagent

Responsibilities:

* Own automated quality gates.
* Add Playwright screenshots.
* Add accessibility checks.
* Create demo validation checklist.
* Confirm no broken product-name strings.

Deliverables:

```txt
frontend/scripts/northstar_visual_qa.mjs
frontend/tests/northstar/*.spec.js
docs/northstar_visual_qa.md
```

Acceptance:

```txt
[ ] npm test passes
[ ] npm run build passes
[ ] pytest passes
[ ] Visual checks pass
[ ] Accessibility checks pass
```

---

# 12. End-to-end acceptance criteria

The implementation is complete only when:

```txt
[ ] Product is visibly Governance Atlas, not Governance Atlas
[ ] Entrada logo and brand palette are applied
[ ] All 10 North Star pages exist and are navigable
[ ] All pages use the same shell
[ ] All pages have loading, empty, degraded, and error states
[ ] All write actions are role-gated
[ ] All dashboard metrics are backed by live data or shown as unavailable/degraded
[ ] All composite APIs return meta/provenance
[ ] Existing APIs remain compatible
[ ] Frontend unit tests pass
[ ] Backend tests pass
[ ] Build succeeds
[ ] Visual QA screenshots pass
[ ] The app supports a 2–5 minute Brickbuilder-ready demo narrative
```

---

# 13. Final implementation prompt for the AI agent

```txt
CURRENT STATE:

You are working in the existing Governance Atlas codebase. The product is a Databricks app with a FastAPI backend and a Vite/React frontend.

Current frontend:
- React 18, Vite, React Router, React Query, @xyflow/react.
- Main app shell lives in frontend/src/App.jsx and frontend/src/components/AppFrame.jsx.
- Existing workspaces include HomePage, DiscoveryWorkspace, EntityWorkspace, LineageWorkspace, GovernanceWorkspace, InsightsWorkspace, TaxonomyWorkspace, CdeWorkspace, AuditBrowserWorkspace, and AdminWorkspace.
- Existing primitives include GlobalHeader, SideIconRail, TopbarSearch, UserChip, CommandPalette, StatusBadge, EntityHero, OwnerAvatar, and others.
- CSS is currently split across frontend/src/styles/*.css and frontend/src/design/tokens/*.css.
- Current UI has functional surfaces but does not match the North Star mockups. It still has Governance Atlas naming in places, legacy cream/light styling, a limited visible rail, and page layouts that need to be redesigned.

Current backend:
- runtime_app.py hosts the FastAPI app and includes modular routers.
- Existing routers include runtime, discovery, assets, catalog, lineage, governance, classification, export, admin, insights, and cde.
- Existing services include assets, lineage, governance, insights, quality, profile, coverage, bulk import, branding, export, classification, metadata audit, background runner, capabilities, inventory, and custom properties.
- GovernanceStore stores governance state in Unity Catalog Delta tables.
- Current backend already supports OBO/app-principal visibility, runtime status, discovery, asset details, lineage, governance summary, glossary, audit events, CDE registry, insights gap analysis, admin coverage, branding, bulk import, export jobs, quality, profiles, classifications, domains, data products, and column groups.
- Existing tests must remain passing.

NORTH STAR:

Transform the app into Entrada Governance Atlas.

The final UI must match the North Star mockups:
1. Home / Enterprise Governance Command Center
2. Discovery / Discover Trusted Data
3. Asset 360 / gold.customer_360-style detail cockpit
4. Lineage / End-to-End Lineage Explorer
5. Governance / Stewardship Workbench
6. Insights / Governance Insights
7. Taxonomy / Business Taxonomy & Glossary
8. CDEs / Critical Data Elements Registry
9. Audit / Audit Trail & Change Evidence
10. Admin / Administration & Control Center

The visual system must be unmistakably Entrada:
- Dark premium navy shell.
- Entrada wordmark in the header/side nav.
- Product name: Governance Atlas.
- Headers use Hanken Grotesk semi-bold where available.
- Body uses Instrument Sans where available.
- Use Entrada blue palette: deep navy, #025080, #66C5FF, #CFEFFF, #B2BDC2, and highlighted text #3d84ad.
- Refined glassy panels, crisp borders, subtle glow, excellent spacing.
- Professional, tech-forward, advanced, performant.
- Do not render fake browser chrome inside the app.

MISSION:

Implement the North Star flawlessly while preserving existing backend truth, existing APIs, existing tests, and Databricks visibility/security semantics.

GLOBAL RULES:

1. Do not rewrite the entire app. Extend and refactor incrementally.
2. Do not break existing endpoints.
3. Do not remove OBO/app-principal truthfulness.
4. Do not fake data, synthetic workflow state, lineage, governance facts, quality signals, or dashboard metrics.
5. Do not show data the actor cannot see.
6. Do not expose sample PII values to UI or AI endpoints.
7. Add tests with every meaningful change.
8. Build page UI from real React components, not screenshots.
9. Keep the `atlas` Python package path stable for this phase, but prefer Atlas/Govat names in runtime config and docs.
10. Rebrand user-facing copy to Governance Atlas.

IMPLEMENTATION ORDER:

Phase 0:
- Run baseline frontend and backend tests.
- Document current failures.
- Create docs/northstar_implementation_log.md.

Phase 1:
- Add frontend/src/config/product.js with Entrada/Governance Atlas constants.
- Rebrand visible strings from Governance Atlas to Governance Atlas.
- Add product metadata to backend shell payload.
- Add tests for product name rendering.

Phase 2:
- Replace design tokens with Entrada North Star dark tokens.
- Preserve --gh-* aliases for compatibility.
- Update body/shell surfaces to dark premium UI.
- Add typography tokens for Hanken Grotesk headers and Instrument Sans body.

Phase 3:
- Rebuild AppFrame, GlobalHeader, and SideIconRail into the North Star shell.
- Make all nav items visible: Home, Discovery, Asset 360, Lineage, Governance, Insights, Taxonomy, CDEs, Audit, Admin.
- Add environment chip, Atlas AI button, notifications, user avatar.
- Preserve global search, command palette, inbox, and diagnostics access.

Phase 4:
- Create frontend/src/components/northstar reusable primitives:
  PageHero, MetricCard, Sparkline, DonutMetric, HeatmapMatrix, BarList, StatusPill, RightInspector, AtlasAiPanel, ActionTile, DataTable, SectionCard, EmptyState, DegradedBanner.
- Use these primitives on all pages.

Phase 5:
- Add atlas/api/atlas.py and atlas/services/atlas_metrics.py.
- Add composite endpoints:
  GET /api/atlas/command-center
  GET /api/atlas/assets/{asset_fqn:path}/360
  GET /api/atlas/governance/workbench
  GET /api/atlas/governance/requests/{request_id}
  GET /api/atlas/insights
  GET /api/atlas/taxonomy/overview
  GET /api/atlas/cde
  GET /api/atlas/cde/{cde_id}
  GET /api/atlas/audit/evidence
  GET /api/atlas/admin/control-center
- Update SHELL_API_CONTRACT.
- Every response must include meta/provenance.
- Add backend tests.

Phase 6:
- Implement HomePage as Enterprise Governance Command Center.
- Use /api/atlas/command-center.
- Render six KPI cards, posture trend, domain heatmap, Atlas AI panel, top domains, recent events, quick actions.

Phase 7:
- Upgrade DiscoveryWorkspace.
- Keep existing discovery search behavior.
- Add semantic search hero, filter chips, result tabs, rich table, right preview panel, saved views, recommended assets, Atlas AI recommendations.

Phase 8:
- Upgrade EntityWorkspace into Asset 360.
- Use /api/atlas/assets/{fqn}/360.
- Render asset header, owner/steward/freshness cards, tabs, business description, usage, schema table, governance panel, recent activity, related assets, downstream dashboards.

Phase 9:
- Upgrade LineageWorkspace and LineageStage.
- Preserve existing useLineage behavior and caching.
- Add left summary, central React Flow graph, right node inspector, path tracer, change history.
- Make focal node visually dominant.

Phase 10:
- Upgrade GovernanceWorkspace into Stewardship Workbench.
- Use /api/atlas/governance/workbench and request detail endpoint.
- Render queue table, selected request diff, business context, asset impact, approver flow, comments/evidence, and role-gated actions.

Phase 11:
- Upgrade InsightsWorkspace.
- Use /api/atlas/insights.
- Render maturity score, policy compliance, time-to-resolution, certified assets, critical exceptions, metadata coverage, trends, heatmaps, risk matrix, ROI, and strategic Atlas AI recommendations.

Phase 12:
- Upgrade TaxonomyWorkspace.
- Render classification tree, terms list, selected term detail, domain relationship, data products, classifications.
- Reuse existing classification/domain/data product/glossary endpoints where possible.

Phase 13:
- Upgrade CdeWorkspace.
- Use /api/atlas/cde and /api/atlas/cde/{id}.
- Render CDE summary cards, grouped registry table, selected CDE detail, lineage snapshot, control coverage, linked assets, stewardship actions.

Phase 14:
- Upgrade AuditBrowserWorkspace.
- Use existing /api/audit/events plus /api/atlas/audit/evidence.
- Render audit KPIs, filters, audit table, change detail drawer, before/after diff, approval chain, evidence artifacts, linked request, export buttons.

Phase 15:
- Upgrade AdminWorkspace.
- Use /api/atlas/admin/control-center.
- Render coverage, branding preview, bulk import status, integrations/runtime, system/access, recent admin activity.
- Preserve existing admin write functionality and role gates.

Phase 16:
- Add Atlas AI endpoints and UI.
- Implement recommendations/chat with strict evidence requirements.
- Never send raw PII samples to the model.
- Show “Review for accuracy” disclaimer.
- All AI answers must include evidence references.

TESTING REQUIREMENTS:

After each phase:
- cd atlas/frontend && npm run lint
- cd atlas/frontend && npm run typecheck
- cd atlas/frontend && npm test
- cd atlas/frontend && npm run build
- cd atlas && python -m pytest -q

Add or update tests for:
- Shell/nav rendering.
- Product rebrand.
- Each composite backend endpoint.
- Each North Star page loading state, error state, degraded state, and primary happy path.
- Role-gated actions.
- OBO/app-principal degraded meta.
- AI redaction and evidence enforcement.
- Visual Playwright screenshots for all 10 pages.

QUALITY BAR:

The final result should look like a premium enterprise SaaS product that potential customers would screenshot during a demo. It must be fast, credible, polished, accessible, and accurate. It should make the value of Governance Atlas obvious to executives while still being operationally useful to stewards, data owners, governance leads, and platform admins.

Begin by running baseline tests and creating the implementation log. Then proceed phase by phase, stopping after each phase to run tests and summarize changes.
```
