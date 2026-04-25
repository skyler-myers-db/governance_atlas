# Governance Atlas North Star Acceptance Checklist

Status captured: 2026-04-24 19:26 EDT

## Phase 0 - Repo Safety

- [x] Created working branch `feature/atlas-northstar`.
- [x] Preserved the pre-existing dirty worktree without reverting user changes.
- [x] Recorded baseline frontend and backend validation results.
- [x] Captured current route map, CSS import order, API contract map, and feature flags.
- [x] Captured baseline static frontend screenshot at `docs/northstar_baseline_screenshots/home-1440x900.png`.
- [x] Confirmed project Databricks profile is `DEFAULT`.
- [x] Corrected project-local identity references to `skyler@entrada.ai`.
- [x] Verified no stale prior-org profile/domain references remain in project-local files outside ignored dependencies, build output, and Git internals.
- [x] Removed seeded presentation/data augmentation guidance from the implementation plan.
- [x] Excluded `docs/branding/` from staged Databricks App source bundles and removed the stale deployed workspace copy.

## Current Blockers

- [x] Restore or regenerate `docs/runtime_api_openapi_snapshot.json`.
- [x] Resolve existing frontend lint errors.
- [x] Resolve existing frontend typecheck errors.
- [x] Run Databricks-native validation with `DEFAULT` before closing any app-affecting tranche.
- [x] Run `bundle summary` with `DEFAULT` before closing any app-affecting tranche.
- [x] Resolve the existing bundle Terraform state lineage mismatch by deploying from the fresh `atlas` bundle root.
- [x] Activate the app from `${workspace.root_path}/files` instead of the old direct workspace source path.
- [x] Delete the old the old hyphenated app slug Databricks app after the `atlas` app was verified live.
- [x] Delete old app-owned workspace paths:
  - `the old direct workspace source path`
  - `the old bundle workspace root`

## North Star Delivery

- [x] Product is visibly Governance Atlas in the app shell and page headers.
- [x] Entrada logo and brand palette are applied.
- [x] All North Star pages exist and are navigable:
  - [x] Home
  - [x] Discovery
  - [x] Asset 360
  - [x] Lineage
  - [x] Governance
  - [x] Insights
  - [x] Taxonomy
  - [x] CDEs
  - [x] Audit
  - [x] Admin
- [x] All pages use the same shell.
- [ ] All pages have loading, empty, degraded, and error states.
- [ ] All write actions are role-gated.
- [x] Dashboard metrics are backed by live data or explicitly marked as unavailable/degraded for the command-center composite surface.
- [x] Composite APIs return metadata and provenance.
- [x] Existing APIs remain compatible.
- [x] Frontend unit tests pass.
- [x] Backend tests pass.
- [x] Build succeeds.
- [x] Screenshot smoke captured for all 10 pages at `1536x1024`, `1440x900`, and `1280x720`.
- [ ] Visual equivalence side-by-side review passes for each page against its North Star mockup.
- [ ] The app supports a 2-5 minute Brickbuilder-ready demo narrative without fake workflow state and with mockup-equivalent primary pages.

## Truth And Security Guardrails

- [x] Preserve actor-scoped visibility and OBO/app-principal distinction for Atlas composite endpoints.
- [x] Do not show hidden catalogs or assets the actor cannot see in Atlas asset and audit evidence endpoints.
- [x] Do not expose sample PII values in Atlas composite or AI endpoints.
- [x] Do not allow AI endpoints to bypass visibility.
- [x] Do not add synthetic workflow counters, fake tasks, fake lineage, fake governance state, or fake quality signals in Phase 5 composite payloads.
- [ ] Sanitize markdown and validate POST/PATCH payloads.
- [ ] Audit all write actions.
- [ ] Include request IDs in errors.

## Phase 5 Deploy Evidence

- [x] `databricks bundle validate --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22` passed.
- [x] `databricks bundle summary --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22` passed with workspace root `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev`.
- [x] `databricks bundle deploy --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22` passed from the prepared bundle source.
- [x] `databricks apps deploy atlas --profile DEFAULT --json @/tmp/atlas-app-deploy.json --timeout 20m` passed.
- [x] Active app deployment is `01f13fb653271e06a1ab587484d5aa65` from `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files`.
- [x] `databricks apps get atlas --profile DEFAULT` reports app `RUNNING` and compute `ACTIVE`.
- [x] App logs show the new process started successfully after deploy.
- [x] Authenticated browser screenshot smoke passed against the live Databricks App URL with DEFAULT-profile bearer auth.

## Phase 6-16 Screenshot Smoke Evidence

- [x] `docs/northstar_visual_qa/report.json` records 30 screenshots, 10 pages, 3 viewport sizes, and 0 failed smoke checks.
- [x] Home route captured.
- [x] Discovery route captured.
- [x] Asset 360 route captured for `westat_samples.retail_v2_serv.gold_customer_360`.
- [x] Lineage route captured for `westat_samples.retail_v2_serv.gold_customer_360`.
- [x] Governance route captured.
- [x] Insights route captured.
- [x] Taxonomy route captured.
- [x] CDE route captured.
- [x] Audit route captured.
- [x] Admin route captured.

## Visual Equivalence Evidence

- [x] Visual-equivalence process contract created at `docs/northstar_visual_equivalence_rules.md`.
- [x] Gap-analysis directory created at `docs/northstar_gap_analysis/`.
- [x] Home visual contract created and updated with current evidence at `docs/northstar_gap_analysis/home.md`.
- [x] Home `1536x1024` local evidence captured at `docs/northstar_visual_qa/home-current/home-local-live-1536x1024.png`.
- [x] Home `1536x1024` settled local evidence captured at `docs/northstar_visual_qa/home-current/home-local-live-1536x1024-settled.png`.
- [x] Home `1440x900` local evidence captured at `docs/northstar_visual_qa/home-current/home-local-live-1440x900.png`.
- [x] Home `1280x720` local evidence captured at `docs/northstar_visual_qa/home-current/home-local-live-1280x720.png`.
- [x] Home recovery evidence captured at `docs/northstar_visual_qa/home-current/home-recovery-1536x1024.png`, `docs/northstar_visual_qa/home-current/home-recovery-1440x900.png`, and `docs/northstar_visual_qa/home-current/home-recovery-1280x720.png`.
- [x] Home recovery browser metrics recorded at `docs/northstar_visual_qa/home-current/home-recovery-report.json` using a local intercepted API fixture.
- [x] Home live Databricks evidence captured at `docs/northstar_visual_qa/home-current/home-live-1536x1024.png`, `docs/northstar_visual_qa/home-current/home-live-1440x900.png`, `docs/northstar_visual_qa/home-current/home-live-1280x720.png`, and `docs/northstar_visual_qa/home-current/home-live-report.json`.
- [x] Home live Atlas AI interaction evidence captured at `docs/northstar_visual_qa/home-current/home-live-ai-1440x900.png`.
- [x] Home live side-by-side evidence against `docs/mockups/mock1.png` captured at `docs/northstar_visual_qa/home-current/home-live-side-by-side-1536x1024.png`.
- [x] Home first-viewport composition fits without page overflow at `1536x1024`.
- [x] Home first-viewport composition fits without page overflow at `1440x900` and `1280x720` in live Databricks evidence.
- [x] Home side-by-side review passes against `docs/mockups/mock1.png` for live Databricks evidence, with sparse live metrics rendered truthfully.
- [ ] Discovery side-by-side review passes against its mockup.
- [ ] Asset 360 side-by-side review passes against its mockup.
- [ ] Lineage side-by-side review passes against its mockup.
- [ ] Governance side-by-side review passes against its mockup.
- [ ] Insights side-by-side review passes against its mockup.
- [ ] Taxonomy side-by-side review passes against its mockup.
- [ ] CDE side-by-side review passes against its mockup.
- [ ] Audit side-by-side review passes against its mockup.
- [ ] Admin side-by-side review passes against its mockup.

## Home Visual Equivalence Tranche Evidence

- [x] Codified mockup-as-contract rules in `AGENTS.md` and `docs/northstar_visual_equivalence_rules.md`.
- [x] Replaced the old Home welcome-card structure with the reference command-center composition.
- [x] Kept missing live signals unavailable/degraded instead of copying reference numbers.
- [x] Wired Atlas AI prompt/chat controls to evidence-backed answers and unavailable/degraded states.
- [x] Compact workspace-scoped metadata banner preserves provenance without blocking the Home layout.
- [x] `npm run typecheck`: passed.
- [x] `npm run lint`: passed with existing hook-dependency warnings only.
- [x] Focused Home/shell tests passed: `HomePage`, `AppFrame`, `ShellTopbarIdentity`, `SideIconRail`, and `useCommandCenter`.
- [x] Focused Atlas backend tests passed: `tests/test_atlas_metrics.py` and `tests/test_atlas_api.py`.
- [x] `npm run build`: passed.
- [x] `databricks bundle validate --profile DEFAULT -t dev`: passed.
- [x] `databricks bundle deploy --profile DEFAULT -t dev`: passed.
- [x] `databricks apps deploy atlas --profile DEFAULT --source-code-path /Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files --mode SNAPSHOT --no-wait`: started deployment `01f1400f19921f25ac14d929fec5926d`.
- [x] Databricks App `atlas` reports `RUNNING`; active deployment `01f1400f19921f25ac14d929fec5926d` reports `SUCCEEDED`.
- [x] Home local visual evidence at `1440x900` and `1280x720` no longer requires vertical scrolling.
- [x] Home side-by-side visual reviewer signoff is complete for local intercepted-API evidence at `1536x1024`, `1440x900`, and `1280x720`.
- [x] Home globe visual received reviewer signoff against the reference richness and scale for the local screenshot evidence.
- [x] Home live Databricks screenshot evidence is captured for deployment `01f14038859e10659bbb6012b83460ca`, build `frontend-66323aca43a6`, actor `skyler@entrada.ai`, auth mode `obo-available`.
- [x] Home has evidence-backed Atlas AI interaction rather than disabled prompt affordances; the live prompt returned `1` evidence record with no console/network errors, and unsupported free-form questions degrade truthfully.
