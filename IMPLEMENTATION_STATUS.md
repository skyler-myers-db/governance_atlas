# Implementation Status

Last updated: 2026-04-24 20:10 EDT

## Recovery Inputs Read

- `RECOVERED_CODEX_TODO.md`: not present.
- `RECOVERED_CODEX_SESSION_NOTES.md`: not present.
- `git status`: branch `feature/governance-atlas-northstar` has a large dirty worktree with Atlas rename work, North Star docs, Home/shell edits, generated QA artifacts, and new backend/frontend tests.
- `git diff`: confirms a broad GovHub-to-Atlas rename, Databricks bundle/app updates, North Star pages, Home visual parity work, shell/footer/sidebar changes, and test updates.
- Repo structure: active app code is under `atlas/` and `frontend/`; mockups live under `docs/mockups/`; Home gap and TODO tracking live under `docs/northstar_gap_analysis/`; visual evidence lives under `docs/northstar_visual_qa/`.
- `.claude/skills/*`: directories exist but no skill files are present to read.

## Completed Changes

- Preserved the recovered dirty worktree and continued from the existing Home North Star implementation instead of restarting.
- Finished functional control cleanup for Home/shell:
  - Collapse expands/collapses the side rail.
  - Home `View all` controls route deterministically.
  - Quick actions route to supported surfaces and no longer promise unsupported deep create/review/run flows.
  - `Governance Atlas` topbar product text routes Home.
  - Footer links are deterministic controls.
  - Header AI control is labeled `AI Copilot` and routes to the Home Atlas AI rail instead of the generic command palette.
  - Atlas AI prompt/chat affordances call the evidence-backed `/api/atlas-ai/recommendations` endpoint and render returned answer/evidence state.
  - Atlas AI now maps supported Home questions to distinct evidence-backed handlers for metadata coverage, critical certification gaps, recent metadata changes, stewardship/ownership, and next-priority recommendations; unsupported free-form questions return a low-confidence unsupported response instead of a mismatched answer.
- Finished requested identity/text fixes:
  - AI disclaimer reads exactly `Atlas AI uses AI. Review for accuracy.`
  - Atlas AI greeting reads `Hi, <name>. I'm Atlas AI.`
  - Topbar user control shows only avatar/initials and dropdown; name/role stay in the menu.
  - Initials fallback uses first and last name initials.
- Finished truth/provenance fixes:
  - `openStewardship` is unavailable if governance request evidence cannot be read.
  - `Overall Posture` no longer aliases metadata coverage when posture evidence is unavailable.
  - Command-center source warnings now survive the API envelope and degrade `meta.state`/`authoritative` truthfully.
  - Command-center provenance no longer overclaims quality-runner backing.
  - Footer `System Status` only shows a status dot when diagnostics state is known.
  - Live screenshot validation exposed an opaque numeric Databricks user id in the Atlas AI greeting; `_user_display_name()` now falls back to email/preferred username before using `x-forwarded-user`, and Home refuses to render long numeric ids as a greeting name.
- Finished Home visual/source fixes against the mockup for the local screenshot evidence:
  - Heatmap headers no longer overlap `Posture by Domain`.
  - Top Domains and KPI label/icon spacing are corrected.
  - Atlas AI header icon/title are inline and the mark has the two small dots.
  - Notification bell has no visible border.
  - Shell chrome, topbar, side rail, footer, collapse divider, and copyright treatment are aligned.
  - Entrada wordmark was corrected so the mark itself is the `E`, with adjusted geometry/color/scale.
  - Palette/chrome moved toward the lighter gradient navy reference.
  - Card header tooltip affordances and richer/colorful icon treatments were added.
  - Globe/network visual was enriched while staying real UI code.
  - Bottom-row density and event text clamping now fit the `1536x1024`, `1440x900`, and `1280x720` first viewport matrix locally.
  - Live screenshot review found `View all` wrapping in compact cards; `.ga-section-actions` now keeps action labels on one line.
- Updated Home docs/checklists:
  - `docs/northstar_gap_analysis/home.md`
  - `docs/northstar_gap_analysis/home_todo.md`
  - `docs/northstar_acceptance_checklist.md`
- Captured local intercepted-API Playwright evidence:
  - `docs/northstar_visual_qa/home-current/home-recovery-report.json`
  - `docs/northstar_visual_qa/home-current/home-recovery-1536x1024.png`
  - `docs/northstar_visual_qa/home-current/home-recovery-1440x900.png`
  - `docs/northstar_visual_qa/home-current/home-recovery-1280x720.png`
- Captured final live Databricks Playwright evidence for deployment `01f14038859e10659bbb6012b83460ca` and build `frontend-66323aca43a6`:
  - `docs/northstar_visual_qa/home-current/home-live-report.json`
  - `docs/northstar_visual_qa/home-current/home-live-1536x1024.png`
  - `docs/northstar_visual_qa/home-current/home-live-1440x900.png`
  - `docs/northstar_visual_qa/home-current/home-live-1280x720.png`
  - `docs/northstar_visual_qa/home-current/home-live-ai-1440x900.png`
  - `docs/northstar_visual_qa/home-current/home-live-side-by-side-1536x1024.png`

## Pending Tasks

- Keep H29/H31 as explicit truth/live-evidence deferrals:
  - H29: richer recent-event categorization needs real priority/severity/category signals.
  - H31: live actor-scoped screenshot evidence is captured; any future workspace-scoped metadata banner must remain visible and truthful.
- Continue page-by-page visual equivalence for Discovery, Asset 360, Lineage, Governance, Insights, Taxonomy, CDEs, Audit, and Admin.

## Current Step

- Complete: final `AGENT_CHANGELOG.md` entry is appended, final closeout hygiene check passed, and all final review roles signed off.
- Local Vite dev server remains stopped; final evidence is from the live Databricks App.
- Next checkpoint: continue page-by-page North Star visual equivalence for the remaining non-Home pages in a new tranche.

## Validation Status

- Focused frontend tests:
  - `npm test -- --run src/App.test.jsx src/components/HomePage.test.jsx src/components/AppFrame.test.jsx src/components/primitives/__tests__/ShellTopbarIdentity.test.jsx src/components/primitives/__tests__/SideIconRail.test.jsx`: passed, 64 tests.
  - Identity-fix focused rerun: `npm test -- --run src/components/HomePage.test.jsx src/App.test.jsx src/components/primitives/__tests__/ShellTopbarIdentity.test.jsx`: passed, 40 tests.
  - Atlas AI wiring focused rerun: `npm test -- --run src/components/HomePage.test.jsx src/App.test.jsx src/components/AppFrame.test.jsx src/components/primitives/__tests__/ShellTopbarIdentity.test.jsx src/components/primitives/__tests__/SideIconRail.test.jsx`: passed, 67 tests.
  - Atlas AI truth-fix focused rerun: `npm test -- --run src/components/HomePage.test.jsx src/App.test.jsx src/components/AppFrame.test.jsx src/components/primitives/__tests__/ShellTopbarIdentity.test.jsx src/components/primitives/__tests__/SideIconRail.test.jsx`: passed, 67 tests.
- Focused backend tests:
  - `./.venv/bin/python -m pytest -q tests/test_atlas_api.py tests/test_atlas_metrics.py tests/test_runtime_api_contracts.py`: passed, 35 tests with existing FastAPI deprecation warnings.
  - Identity-fix focused rerun: `./.venv/bin/python -m pytest -q tests/test_runtime_api_contracts.py tests/test_atlas_api.py tests/test_atlas_metrics.py`: passed, 37 tests with existing FastAPI deprecation warnings.
  - Atlas AI truth-fix focused rerun: `./.venv/bin/python -m pytest -q tests/test_atlas_metrics.py tests/test_atlas_api.py tests/test_runtime_api_contracts.py`: passed, 41 tests with existing FastAPI deprecation warnings.
- Broad frontend validation:
  - `npm run typecheck`: passed.
  - `npm run lint`: passed with 11 existing `react-hooks/exhaustive-deps` warnings.
  - `npm run build`: passed with the existing Vite large-chunk warning.
  - Live-gate rebuild: `npm run build`: passed again before bundle deploy; Vite still reported the existing large-chunk warning.
  - Atlas AI truth-fix broad frontend validation: `npm run lint` passed with the same 11 existing hook warnings; `npm run typecheck` passed after removing a stale `onOpenCommandPalette` prop; `npm run build` passed with the existing large-chunk warning and produced build `frontend-1d08ff627332`.
  - Atlas AI placeholder-fix validation: `npm test -- --run src/components/HomePage.test.jsx` passed, 10 tests; `npm run typecheck` passed; `npm run build` passed with the existing large-chunk warning and produced build `frontend-66323aca43a6`.
- Databricks-native validation:
  - `databricks bundle validate --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed.
  - `databricks bundle summary --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed; bundle target `dev`, workspace root `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev`, app resource `atlas`, Apps URL `(not deployed)` in bundle summary.
  - Earlier recovery checkpoint recorded that deploy/live screenshots were still missing; the final live-gate pass below closes that gap.
  - Live-gate rerun: `databricks bundle validate --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed with the same four non-matching sync-exclude warnings.
  - Live-gate rerun: `databricks bundle summary --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed; bundle summary still reports Apps URL `(not deployed)`.
  - Live-gate rerun: `databricks bundle deploy --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22 --auto-approve`: passed and uploaded bundle files to `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files`.
  - Live-gate app deploy: `databricks apps deploy atlas --profile DEFAULT --json @/tmp/atlas-app-deploy.json --timeout 20m`: passed; deployment `01f1402f36df133dab90c6292f3c26e5` started successfully.
  - `databricks apps get atlas --profile DEFAULT -o json`: app `RUNNING`, compute `ACTIVE`, active deployment `01f1402f36df133dab90c6292f3c26e5`.
  - `databricks apps logs atlas --profile DEFAULT --tail-lines 100 --source SYSTEM --source APP`: confirmed deployment success and app startup.
- Closeout hygiene:
  - `git diff --check`: passed after the final `IMPLEMENTATION_STATUS.md`, `AGENT_CHANGELOG.md`, and `home_todo.md` edits.
  - Identity-fix touched-file whitespace check passed for `atlas/api/identity.py`, `tests/test_runtime_api_contracts.py`, `frontend/src/components/HomePage.jsx`, `frontend/src/components/HomePage.test.jsx`, and `IMPLEMENTATION_STATUS.md`.
  - Final closeout `git diff --check`: passed after docs/status/changelog/live-evidence updates.
- Playwright local visual validation:
  - `1536x1024`: `mainScrollHeight` equals `mainClientHeight`, footer visible, no heatmap overlap, no quick-action/event clipping, notification border `0px`.
  - `1440x900`: `mainScrollHeight` equals `mainClientHeight`, footer visible, no heatmap overlap, no quick-action/event clipping, notification border `0px`.
  - `1280x720`: `mainScrollHeight` equals `mainClientHeight`, footer visible, no heatmap overlap, no quick-action/event clipping, notification border `0px`.
  - Fixture is local intercepted API, not live Databricks evidence.
- Playwright live visual validation:
  - Initial live screenshots were captured for deployment `01f1402f36df133dab90c6292f3c26e5`, but they exposed a live-only greeting defect: `Hi, 5882225431657870. I'm Atlas AI.`
  - Corrected deployment `01f1403095631fe1a4a908c2a2136dd1` fixed the greeting and produced clean live runtime/build metrics, but visual review found `View all` wrapping in compact card headers.
  - The compact-card CSS fix was deployed as `01f14031858714f1b67cf7730cf3e56a`; final evidence now needs to be refreshed after Atlas AI interaction wiring.
  - Atlas AI truth-fix deployment `01f14037185718eda96ab868e1ae1117` succeeded for build `frontend-1d08ff627332`; final screenshot review then found the scoped AI input placeholder clipped at `1280x720`, so it was shortened before closeout.
  - Final placeholder-fix deployment `01f14038859e10659bbb6012b83460ca` succeeded for build `frontend-66323aca43a6`; `databricks apps get atlas --profile DEFAULT -o json` reports app `RUNNING`, compute `ACTIVE`, and active deployment `SUCCEEDED`.
  - Final live evidence was captured for deployment `01f14038859e10659bbb6012b83460ca`, build `frontend-66323aca43a6`, actor `skyler@entrada.ai`, auth mode `obo-available`, bootstrap state `live`.
  - `1536x1024`, `1440x900`, and `1280x720`: no console errors, no network errors, no body overflow, main content fits first viewport, no heatmap title overlap, no wrapped `View all` controls, no visible text overflow, expected `Hi, Skyler. I'm Atlas AI.` greeting, and no opaque numeric user id leak.
  - Live Atlas AI question matrix: coverage, recent-change, stewardship, and priority prompts return evidence-backed answers; certification returns a degraded unavailable-signal answer; unsupported free-form returns a degraded unsupported response.
  - Live Atlas AI prompt interaction returned `Unassigned coverage is 7.8% across 710 visible assets.` with `1` evidence record and no console/network errors.
  - Live placeholder evidence confirms `Coverage, certs, owners...` fits the compact rail.
- Subagent signoff:
  - Feedback coverage: signed off after every requested item was mapped to implementation or explicit deferral.
  - Visual/product: signed off on local screenshot-based blockers after chrome/globe/density remediation.
  - Truth/provenance: signed off after command-center warning-envelope fix.
  - Regression/ripple: signed off after footer status truth and Help sign-out copy fixes.
  - Final live-gate feedback coverage: signed off for H01-H31 and V09.
  - Final live-gate visual/product: signed off with no remaining must-fix visual blockers.
  - Final live-gate regression/ripple: signed off with no remaining blockers.
  - Final live-gate truth/provenance initially blocked Atlas AI because enabled prompts/free-form input overstated backend support; blocker was fixed with intent-specific evidence-backed responses and unsupported-question degradation.
  - Post-fix live screenshot review found the scoped AI input placeholder clipped at `1280x720`; placeholder was shortened and final live evidence confirms it fits.
  - Corrected final truth/provenance review: signed off with no remaining blockers.
  - Corrected final visual/product review: signed off with no remaining blockers.
  - Corrected final regression/ripple review: signed off with no remaining blockers.
  - Corrected final feedback coverage review: signed off after this status wording reconciliation.

## Risks

- The worktree remains broad and dirty from the recovered session; unrelated edits must not be reverted.
- Live Databricks data is sparse in this workspace: several mockup-populated metrics/events render honest unavailable states or low actor-visible coverage values rather than synthetic numbers.
- Atlas AI must remain tied to the evidence-backed recommendations endpoint and must render unavailable/degraded states truthfully when evidence is sparse.
- Atlas AI broad-chat overclaim risk is mitigated by intent-specific supported responses, unsupported-question degradation, and the scoped Home input placeholder.

## Exact Next Actions

1. Continue page-by-page North Star visual equivalence for Discovery, Asset 360, Lineage, Governance, Insights, Taxonomy, CDEs, Audit, and Admin.
2. Add richer recent-event categorization only when real priority, severity, or event-category signals exist.
3. Keep Atlas AI limited to evidence-backed supported Home intents and truthful degraded/unsupported responses.
