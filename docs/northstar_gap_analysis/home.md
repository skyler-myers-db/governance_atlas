# Home Page North Star Gap Analysis

Target mockup: `docs/mockups/mock1.png`

Latest live evidence:

- `docs/northstar_visual_qa/home-current/home-live-1536x1024.png`
- `docs/northstar_visual_qa/home-current/home-live-1440x900.png`
- `docs/northstar_visual_qa/home-current/home-live-1280x720.png`
- `docs/northstar_visual_qa/home-current/home-live-ai-1440x900.png`
- `docs/northstar_visual_qa/home-current/home-live-side-by-side-1536x1024.png`
- `docs/northstar_visual_qa/home-current/home-live-report.json`

Supporting local recovery evidence:

- `docs/northstar_visual_qa/home-current/home-recovery-1536x1024.png`
- `docs/northstar_visual_qa/home-current/home-recovery-1440x900.png`
- `docs/northstar_visual_qa/home-current/home-recovery-1280x720.png`
- `docs/northstar_visual_qa/home-current/home-recovery-report.json`
- `docs/northstar_visual_qa/home-current/home-local-live-1536x1024.png`
- `docs/northstar_visual_qa/home-current/home-local-live-1536x1024-settled.png`
- `docs/northstar_visual_qa/home-current/home-local-live-1440x900.png`
- `docs/northstar_visual_qa/home-current/home-local-live-1280x720.png`

Status: Home live visual evidence is captured for Databricks App deployment `01f14038859e10659bbb6012b83460ca`, build `frontend-66323aca43a6`. The live screenshot matrix passes the Home first-viewport, text-overlap, routing, identity, Atlas AI, and shell-chrome gates. Remaining Home notes are truth constraints, not open must-fix visual gaps: sparse live data must stay unavailable/degraded unless backed by real signals.

## Completed In This Tranche

### Layout And Shell Fit

- [x] Replaced the narrow centered Home column with a full-width dashboard grid.
- [x] Removed the large unused horizontal gutters around the main Home content.
- [x] Anchored content to the same left grid as the product shell.
- [x] Fit the full dashboard composition in the `1536x1024` first viewport without horizontal or vertical overflow.
- [x] Fit the full dashboard composition in the `1440x900` and `1280x720` first viewports in final live Databricks evidence.
- [x] Added the shell footer row with Privacy, Terms, Support, and System Status.
- [x] Added Entrada copyright text to the side rail footer.
- [x] Hid the old floating command-shortcut control that did not exist in the reference.

### Hero And Page Header

- [x] Removed the pale personalized welcome card.
- [x] Removed the `Welcome back` headline and old CTA/chip cluster.
- [x] Rendered `Enterprise Governance Command Center`.
- [x] Rendered `Unified visibility. Trusted data. Confident decisions.`
- [x] Integrated a dark globe/network SVG into the Home background.
- [x] Fixed the globe SVG artifact that rendered as black triangular fills.
- [x] Increased globe/network richness with additional arcs, node points, and glow density while keeping it as real UI code.
- [x] Kept the hero visual as real UI code, not a screenshot background.

### KPI Row

- [x] Rendered six KPI cards across the dashboard width.
- [x] Replaced `Catalogs in scope`, `Open governance`, and `Coverage score` with the target KPI categories.
- [x] Added KPI icon chips.
- [x] Center-aligned KPI labels to their icons.
- [x] Added sparkline/progress regions where payload data supports them.
- [x] Removed implementation-detail helper copy from the visible cards.
- [x] Stopped coercing missing certified-critical, posture, domain, and heatmap values to `0`.

### Analytics And Operational Grid

- [x] Added `Governance Posture Over Time` with an empty/unavailable chart frame when live history is missing.
- [x] Added y-axis percentages, month labels, series legend, `Last 6 Months`, posture donut, and delta region.
- [x] Added `Posture by Domain` heatmap structure, Low/High legend, and `View all`.
- [x] Removed heatmap header/title overlap and preserved the heatmap panel shape in compact viewports.
- [x] Added `Top Domains` with ranked rows, progress bars, and unavailable handling.
- [x] Increased top-domain title/row spacing and compact density so the card remains readable in `1280x720`.
- [x] Replaced large white Jump In cards with compact dark action tiles.
- [x] Constrained bottom-row card heights and clamped long event copy so rich events cannot force dashboard overflow.
- [x] Added a right-side Atlas AI rail with beta pill, prompts, evidence-backed prompt/input behavior, and review disclaimer.
- [x] Aligned the Atlas AI mark and title horizontally and added the two-dot star mark.

### Truth And Provenance

- [x] Kept app-principal / workspace-scoped metadata truth visible in the shell.
- [x] Reduced the access warning to a compact status chip so it does not destroy the Home composition.
- [x] Wired Atlas AI prompt actions and the question input to the evidence-backed `/api/atlas-ai/recommendations` endpoint.
- [x] Routed the header `AI Copilot` button to the Home Atlas AI rail instead of the generic command palette.
- [x] Marked unavailable metrics as unavailable instead of inventing target values.
- [x] Stopped deriving `Overall Posture` directly from metadata coverage when posture evidence is unavailable.
- [x] Added deploy-source exclusions so local visual QA artifacts and mockup images are not uploaded with the Databricks App source.

## Remaining Visual Gaps

### Hero Visual

- [x] Visual reviewer confirmed the richer globe clears the screenshot-based visual/product-structure bar. It remains real SVG UI, not a screenshot or fake data backdrop.

### Data Density Versus Live Truth

- [x] Live data can produce sparse Home analytics: the domain posture can collapse to `Unassigned`, and trend history can be unavailable. This is accepted when the target panel structure remains intact and the state is truthful.
- [x] The reference contains rich sample values for top domains, event categories, and heatmap cells. Those are not copied into live payloads unless backed by live signals or explicit truthful metadata.
- [x] `Recent High-Priority Events` preserves the target panel shape. Live event richness is explicitly deferred unless real priority, severity, or event-category signals exist; otherwise the panel remains truthful and degraded/unavailable.

### Atlas AI Behavior

- [x] The visual rail, prompt buttons, More Suggestions control, and question input are active only through the evidence-backed Atlas AI endpoint.
- [x] Header button label is `AI Copilot` and routes to the Home Atlas AI rail.
- [x] Live interaction evidence returned `Unassigned coverage is 7.8% across 710 visible assets.` with `1` evidence record and no console/network errors.
- [x] Unsupported free-form questions return a degraded unsupported response instead of a mismatched recommendation.

### Responsive Equivalence

- [x] `1536x1024` has no horizontal or vertical page overflow.
- [x] `1440x900` has no horizontal or vertical page overflow in live Databricks evidence.
- [x] `1280x720` has no horizontal or vertical page overflow in live Databricks evidence.
- [x] Same-viewport side-by-side review against `docs/mockups/mock1.png` is complete for live Databricks evidence.

### Shell-State Difference

- [x] Live evidence is actor-scoped (`skyler@entrada.ai`, `obo-available`) and no disruptive workspace-scoped metadata banner is present. If a future workspace-scoped/provenance banner appears, it must remain truthful rather than be hidden for visual parity.
- [x] Side rail labels, including `Asset 360`, render as active navigation items in the final live screenshots.

## Current Evidence Metrics

- `1536x1024`: no console errors; no network errors; no body overflow; main content fits first viewport; no heatmap title overlap; top-domain spacing gap `14px`; no `View all` wrapping; no visible text overflow.
- `1440x900`: no console errors; no network errors; no body overflow; main content fits first viewport; no heatmap title overlap; top-domain spacing gap `8px`; no `View all` wrapping; no visible text overflow.
- `1280x720`: no console errors; no network errors; no body overflow; main content fits first viewport; no heatmap title overlap; top-domain spacing gap `6px`; no `View all` wrapping; no visible text overflow.
- Identity evidence: bootstrap state `live`; actor `skyler@entrada.ai`; auth mode `obo-available`; Atlas greeting `Hi, Skyler. I'm Atlas AI.`; no opaque numeric user-id leak.
- Atlas AI evidence: direct endpoint matrix supports coverage, recent-change, stewardship, and priority prompts with evidence; marks unavailable certification signals as degraded; and marks unsupported free-form questions as degraded/unsupported. Clicked prompt returned an evidence-backed answer with `1` evidence record.
- Input placeholder evidence: `Coverage, certs, owners...` fits the compact rail in live `1280x720` evidence.
- Evidence fixture: `live Databricks App with DEFAULT-profile bearer auth; no local Vite server and no API interception`.
- Active Databricks App deployment: `01f14038859e10659bbb6012b83460ca`.
- Live build id: `frontend-66323aca43a6`.
- Active app URL: `https://atlas-2543889327043640.aws.databricksapps.com`.

## Next Home Pass

1. Add richer but truthful event categorization only when real audit/governance priority, severity, or event-category signals exist.
2. Continue deeper Atlas AI answer quality only through evidence-backed endpoints and actor-visible metadata.
3. Continue page-by-page visual equivalence for the remaining North Star pages.
