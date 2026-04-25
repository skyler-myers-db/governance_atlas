# Home Visual Equivalence Blocking TODO

Target mockup: `docs/mockups/mock1.png`

Current pass started: 2026-04-24

Rule: no item may be signed off until it is implemented, verified with functional QA where applicable, and checked in same-viewport visual evidence. Truthful unavailable states are allowed only when the data source is genuinely unavailable; the target layout still has to remain intact.

## Functional Controls

- [x] H01 Collapse button works and visibly collapses/expands the left navigation without breaking keyboard access.
- [x] H02 Home panel `View all` controls work or route to a clear destination: Posture by Domain, Top Domains, Recent Events.
- [x] H03 Governance Atlas product text in the topbar routes to Home, not Discovery.
- [x] H04 Footer links `Privacy`, `Terms`, `Support`, and `System Status` are real controls with deterministic behavior.
- [x] H05 Header `AI Copilot` opens the Home Atlas AI rail and does not open the generic command palette.
- [x] H06 Quick action tiles route to their intended surfaces, and labels must not promise unsupported deep create/review/run flows unless those flows exist.
- [x] H07 Atlas AI prompt/more/input controls work through the evidence-backed `/api/atlas-ai/recommendations` endpoint.

## Text, Spacing, And Layout

- [x] H08 Heatmap headers do not overlap with `Posture by Domain` or with each other.
- [x] H09 Section titles and first rows have enough vertical spacing; `Top Domains` cannot touch the row beneath it.
- [x] H10 KPI labels are vertically centered against their icons like the reference.
- [x] H11 Home first viewport fits at `1536x1024`, `1440x900`, and `1280x720` without incoherent clipping or overlap.

## Atlas AI Panel

- [x] H12 `Ask Atlas AI` header icon and title are horizontally aligned.
- [x] H13 Atlas AI mark matches the reference more closely, including the two small dots to the left of the star.
- [x] H14 AI disclaimer reads exactly: `Atlas AI uses AI. Review for accuracy.`
- [x] H15 AI greeting reads `Hi, <name>. I'm Atlas AI.`
- [x] H16 Header AI button says `AI Copilot`.

## Topbar And Identity

- [x] H17 Notification bell button has no visible border.
- [x] H18 User profile control shows only avatar/initials and dropdown in the topbar; name/role stay in the menu.
- [x] H19 Initials fallback uses first and last name initials, not first two letters of the first name.
- [x] H20 Entrada wordmark matches the reference: the mark itself is the E, no duplicate E, thinner/longer lettering, deeper blue, and corrected three-line E mark cutouts.

## Color And Chrome

- [x] H21 App palette is adjusted toward the reference: slightly lighter dark navy, more top/header gradient, less flat near-black.
- [x] H22 Top banner, bottom banner, and left menu share the same base background color.
- [x] H23 Sidebar copyright is visually part of the bottom banner; side/footer borders align.
- [x] H24 Collapse control has the expected divider above it.

## Tooltips And Icons

- [x] H25 Header/title tooltip affordances are present for dashboard cards where the mockup shows info icons.
- [x] H26 KPI and quick-action iconography is more colorful and closer to the reference; Policy Exceptions icon must be improved.

## Prior Open Home Gaps

- [x] H27 Globe/network background is richer and closer to the reference while remaining real UI, not a screenshot.
- [x] H28 Domain heatmap preserves target structure when live domain/category signals are sparse.
- [x] H29 Recent events panel is truthful but visually closer to the reference high-priority event list; mockup event richness is deferred unless real priority, severity, or event-category signals exist.
- Evidence note: final live evidence preserves the target panel shape and truthfully shows no high-priority events when the available live events do not carry priority/severity/event-category signals.
- [x] H30 Top Domains unavailable/sparse state is dense enough that the card does not look empty.
- [x] H31 Workspace-scoped metadata warning remains truthful without disrupting the reference Home composition, with either actor-scoped screenshot evidence or a recorded provenance-banner deferral.
- Evidence note: final live evidence is actor-scoped (`skyler@entrada.ai`, `obo-available`) and shows no disruptive workspace-scoped metadata banner. If a future deployed app surfaces a workspace-scoped metadata banner, it must remain visible and truthful.

## Verification Gates

- [x] V01 Unit tests cover changed functional controls.
- [x] V02 `npm run lint` passes or only reports pre-existing warnings.
- [x] V03 `npm run typecheck` passes.
- [x] V04 `npm test` focused Home/shell tests pass.
- [x] V05 `npm run build` passes.
- [x] V06 `git diff --check` passes.
- [x] V07 Home screenshots captured at `1536x1024`, `1440x900`, and `1280x720`.
- [x] V08 Subagent reviewers sign off or every remaining blocker is explicitly documented.
- [x] V09 Databricks bundle validate/deploy uses `DEFAULT` before tranche close.
  - Final live checkpoint: `databricks bundle validate`, `databricks bundle summary`, `databricks bundle deploy`, and `databricks apps deploy atlas` passed with `DEFAULT`; active deployment `01f14038859e10659bbb6012b83460ca`, build `frontend-66323aca43a6`.
  - Final live screenshots and report: `docs/northstar_visual_qa/home-current/home-live-report.json`, `home-live-1536x1024.png`, `home-live-1440x900.png`, `home-live-1280x720.png`, and `home-live-ai-1440x900.png`.
