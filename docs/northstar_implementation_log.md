# Governance Atlas North Star Implementation Log

## Phase 0 - Repo safety baseline

Captured: 2026-04-24 00:04:24 EDT

### Branch and workspace state

- Working branch: `feature/atlas-northstar`.
- Created from the already-dirty local worktree. Existing user changes were preserved.
- Databricks validation and deployment profile for this project: `DEFAULT`.
- Correct operator email for local fixtures and identity snapshots: `skyler@entrada.ai`.
- Wide local search after scrub found no remaining stale prior-org profile/domain references outside ignored dependency, build, and Git internals.

### Baseline commands

Frontend:

- `cd frontend && npm ci` passed.
- `cd frontend && npm run lint` failed on existing lint issues:
  - unused imports in `DiscoveryWorkspace.identity.test.jsx`, `DiscoveryWorkspace.jsx`, `EntityWorkspace.jsx`, `InsightsWorkspace.test.jsx`, `CustomPropertiesPanel.jsx`, and `SideIconRail.test.jsx`.
  - existing React hook dependency warnings remain.
- `cd frontend && npm run typecheck` failed on existing type errors:
  - shell/App prop mismatches,
  - typed API helper option mismatches,
  - Home page estate shape assumptions,
  - several query option and component prop type gaps.
- `cd frontend && npm test` passed: 41 files, 313 tests.
- `cd frontend && npm run build` passed; Vite reported the existing large chunk warning.
- Focused identity tests passed after the email/profile scrub:
  - `npm test -- DiscoveryWorkspace.identity.test.jsx ShellTopbarIdentity.test.jsx`
  - 2 files, 18 tests.

Backend:

- `python -m pytest -q` could not run because `python` is unavailable on this machine.
- `python3 -m pytest -q` could not run because system Python does not have `pytest`.
- `./.venv/bin/python -m pytest -q` ran the suite and failed on one pre-existing contract blocker:
  - `tests/test_runtime_api_contracts.py::RuntimeApiContractsTests::test_runtime_api_openapi_snapshot_matches_committed_contract`
  - cause: `docs/runtime_api_openapi_snapshot.json` is currently deleted in the worktree.
  - result: 1 failed, 258 passed, 6 warnings.
- Focused backend audit/migration tests passed:
  - `./.venv/bin/python -m pytest -q tests/test_metadata_audit.py tests/test_migrations.py`
  - 6 passed.

Safety scripts:

- `./.venv/bin/python scripts/verify_branch_state.py` passed.
- `./.venv/bin/python scripts/validate_repo_hygiene.py` passed.

### Baseline screenshot

- Captured static frontend preview screenshot:
  - `docs/northstar_baseline_screenshots/home-1440x900.png`
- Preview server served the built frontend at `http://127.0.0.1:4173/home`.
- The static preview does not include FastAPI, so `/api/bootstrap` and `/api/runtime/status` returned 404 during screenshot capture. This is a frontend-only baseline, not a live app validation.

### Current frontend route map

Runtime client route prefixes:

- `home`
- `discovery`
- `entity`
- `lineage`
- `governance`
- `glossary`
- `audit`
- `taxonomy`
- `help`
- `inbox`
- `capabilities`
- `insights`

Frontend-rendered surfaces currently present in `App.jsx`:

- `home`
- `discovery`
- `entity`
- `lineage`
- `governance`
- `audit`
- `taxonomy`
- `help`
- `inbox`
- `capabilities`
- `insights`

Current gap against North Star navigation:

- `cde` route/surface is not currently wired.
- `admin` route/surface is not currently wired as a primary frontend workspace.

### Current CSS import order

From `frontend/src/main.jsx`:

1. `frontend/src/styles/app.css`
2. `frontend/src/styles/lineage.css`
3. `frontend/src/styles/discovery.css`
4. `frontend/src/styles/entity.css`
5. `frontend/src/styles/governance.css`
6. `frontend/src/styles/shell-rail.css`
7. `frontend/src/styles/capability-dashboard.css`
8. `frontend/src/styles/insights.css`

This order is load-bearing for the current shell and page overrides. Phase 2 token work must preserve compatibility while replacing the legacy palette.

### Current API contract map

From `SHELL_API_CONTRACT`:

- `bootstrap`: `/api/bootstrap`
- `discoverySearch`: `/api/discovery/search`
- `assetDetail`: `/api/assets/:fqn`
- `assetAvailability`: `/api/assets/availability`
- `assetMetadataUpdate`: `/api/assets/:fqn/metadata`
- `assetColumnMetadataUpdate`: `/api/assets/:fqn/columns/:column/metadata`
- `lineage`: `/api/lineage/:fqn`
- `glossary`: `/api/governance/glossary`
- `governanceRequest`: `/api/governance/requests/:id`
- `governanceNotification`: `/api/governance/notifications/:id`
- `governanceGlossaryTerm`: `/api/governance/glossary/:id`
- `runtimeStatus`: `/api/runtime/status`
- `adminBackgroundStatus`: `/api/admin/background/status`

Routers currently registered by `runtime_app.py`:

- runtime
- discovery
- catalog
- assets
- lineage
- governance
- classification
- export
- admin
- insights

### Current feature flags

From `_shell_feature_flags_payload`:

- `workspace_setup_diagnostics`
- `table_lineage_surface`
- `query_history_surface`

### Review lane findings

Feedback coverage:

- Corrected Phase 0 repo paths to use root `frontend`.
- Confirmed `DEFAULT` is the only Databricks profile to use for this work.
- Confirmed the old profile/org string and incorrect personal email had to be scrubbed from project-local state.
- Called out that CDE and Admin are target surfaces, not currently routed frontend pages.

Scope and philosophy:

- Phase 0 through Phase 3 should not introduce demo augmentation.
- Mockups are visual and IA guidance, not screenshot assets.
- The app must keep live metadata provenance and avoid synthetic workflow state.

Regression review:

- The current dirty tree includes many pre-existing deleted screenshots and the deleted OpenAPI snapshot.
- The deleted OpenAPI snapshot is the only backend suite failure in the baseline run.
- Lint and typecheck are already failing before North Star feature changes.

Ripple review:

- Route highlighting and rail behavior need full audit when adding the full North Star nav.
- Existing CSS import order and token aliases are sensitive.
- Topbar/search/shell status text must stay tied to truthful backend scope.

### Phase 1 entry gate

Feature work can start only after these baseline facts are kept visible:

- Existing lint/typecheck failures are not caused by North Star changes.
- Backend pytest is blocked by the deleted OpenAPI snapshot.
- CDE/Admin target pages need routing and API contract work, not just styling.
- All Databricks validation/deploy commands must use the `DEFAULT` profile.
- No synthetic metrics, workflow counters, lineage, governance state, or quality signals may be added.

## Phase 1 - Product Rebrand Foundation

Status captured: 2026-04-24 01:07 EDT

### Scope completed

- Added centralized frontend product constants in `frontend/src/config/product.js`.
- Added Entrada brand SVG assets under `frontend/src/assets/brand/`.
- Updated the shell header to render the Entrada mark and the shell-provided product name.
- Added product metadata to the backend shell payload:
  - `companyName`: `Entrada`
  - `productName`: `Governance Atlas`
  - `shortName`: `Atlas`
  - `aiName`: `Atlas AI`
- Replaced visible user-facing `Governance Atlas` copy in active frontend/backend surfaces with `Governance Atlas`.
- Replaced internal runtime compatibility names with `GOVAT_*`, `atlas`, `atlas`, and `X-GOVAT-*`.
- Restored and regenerated `docs/runtime_api_openapi_snapshot.json`.
- Fixed the baseline frontend lint/typecheck blockers discovered in Phase 0.
- Aligned `app.yaml` and `databricks.yml` with the `DEFAULT` app resource name `sql-warehouse`.
- Set the `DEFAULT` dev app governance store to the existing live `datapact.atlas` control plane.

### Subagent coverage

- Backend contract lane added shell product metadata and the backend contract test.
- Frontend shell lane added product constants, brand asset wiring, and header identity tests.
- Frontend copy lane rebranded visible app/page copy while leaving internal compatibility keys intact.
- Regression/ripple review identified leftover shell, script, export, and app-resource issues that were folded into the final pass.

### Validation

- `cd frontend && npm run lint`: passed with the pre-existing hook warnings only.
- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm test`: passed, 41 files and 317 tests.
- `cd frontend && npm run build`: passed with the existing large chunk warning.
- `./.venv/bin/python -m pytest -q`: passed, 259 tests.
- `databricks bundle validate --profile DEFAULT --var warehouse_id=b50e5cec5077ea22`: passed.
- `databricks bundle summary --profile DEFAULT --var warehouse_id=b50e5cec5077ea22`: passed.
- `databricks apps deploy atlas --profile DEFAULT --source-code-path /Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files --mode SNAPSHOT`: target source path for the next bundle-root deployment.
- Active `DEFAULT` app deployment: `01f13f9a1b4014a1a06453be197891af`.
- Authenticated live `/api/runtime/status`: HTTP 200, runtime `live`, governance store `live`, warehouse `b50e5cec5077ea22`.
- Authenticated live `/api/bootstrap?surface=home`: returned `shell.product.productName = Governance Atlas` and `shell.userEmail = skyler@entrada.ai`.

### Notes and blockers

- Earlier `databricks bundle deploy` attempts were blocked by a remote/local Terraform state lineage mismatch. The next deployment tranche must use the fresh `atlas` bundle root and activate from `${workspace.root_path}/files`.
- Initial deploy surfaced a real app-resource mismatch: source expected `uc_warehouse`, but the `DEFAULT` app owns `sql-warehouse`. The source now matches the deployed app resource.
- Initial runtime status surfaced a real environment mismatch: `GOVAT_CATALOG=prod` was absent in `DEFAULT`. The dev default now points at the existing `datapact.atlas` store.
- Wide stale-reference search found no stale prior-org profile/domain/email references in project-local files outside ignored dependencies, build output, and Git internals.

## Phase 1 follow-up - Truth and deployment package cleanup

Status captured: 2026-04-24 01:29 EDT

### Scope completed

- Removed the implementation-plan allowance for seeded presentation metrics and separate demo augmentation.
- Rebranded the exposed runtime version from `atlas-runtime-6` to `atlas-runtime-6`.
- Rebranded Databricks SDK product labels from `atlas` to `atlas`.
- Updated `scripts/prepare_bundle.py` so `docs/branding/` is excluded from staged Databricks App source bundles.
- Removed the stale `docs/branding/` directory from the deployed workspace source path before creating the final snapshot deployment.

### Validation

- `./.venv/bin/python -m pytest -q tests/test_runtime_api_contracts.py tests/test_uc.py tests/test_config.py tests/test_runtime_contract.py`: passed, 24 tests.
- `./.venv/bin/python -m pytest -q`: passed, 259 tests.
- `./.venv/bin/python scripts/prepare_bundle.py --output /tmp/atlas-app-bundle && test ! -e /tmp/atlas-app-bundle/docs/branding`: passed.
- `databricks bundle validate --profile DEFAULT --var warehouse_id=b50e5cec5077ea22`: passed.
- `databricks bundle summary --profile DEFAULT --var warehouse_id=b50e5cec5077ea22`: passed.
- `databricks workspace delete /Workspace/Users/skyler@entrada.ai/atlas/docs/branding --profile DEFAULT --recursive`: removed stale deployed workspace source files from the prior direct-sync path.
- `databricks apps deploy atlas --profile DEFAULT --source-code-path /Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files --mode SNAPSHOT`: target source path for the next bundle-root deployment.
- Final active `DEFAULT` app deployment: `01f13f9fe4d11b468df30f9f0bfe94f6`.
- Authenticated live `/api/runtime/status`: HTTP 200, runtime `live`, governance store `live`, warehouse `b50e5cec5077ea22`.
- Authenticated live `/api/bootstrap?surface=home`: returned `version = atlas-runtime-6`, `shell.product.productName = Governance Atlas`, and `shell.userEmail = skyler@entrada.ai`.
- Search found no stale prior-org profile/domain/email references in project-local files outside ignored dependencies, build output, and Git internals.
- Search found no removed seeded-data flag or bypass language in the implementation guidance.

## Phase 1.5 - Atlas App Slug, GOVAT Runtime Contract, And Bundle-Root Deploy

Status captured: 2026-04-24 02:40 EDT

### Scope completed

- Renamed the Python package from the old internal package to `atlas` and updated imports, tests, scripts, and runtime contract paths.
- Renamed the Databricks bundle and app resource to `atlas`.
- Replaced runtime env/header/browser-global contracts with `GOVAT_*`, `X-GOVAT-*`, and `window.__GOVAT_BOOTSTRAP__`.
- Removed legacy self-aliases and duplicate `GOVAT` fallbacks.
- Removed stale prior-org token and stale prior-workspace textual references from source-controlled text files.
- Added explicit `workspace.profile: DEFAULT` and `workspace.root_path: /Workspace/Users/${workspace.current_user.userName}/.bundle/${bundle.name}/${bundle.target}` to `databricks.yml`.
- Set the app resource `source_code_path` to `${workspace.root_path}/files`.
- Made app source defaults neutral in `app.yaml`; deployment env vars are injected from the bundle/direct deployment payload.
- Updated the GitHub workflow and README to deploy with `--profile DEFAULT` and activate the app from the bundle root.
- Hardened `scripts/prepare_bundle.py` so local agent/secrets paths and non-runtime screenshots/mockups are excluded from staged app source.
- Replaced destructive identity-purge migration v14 with a no-op migration marker.

### Subagent coverage

- Feedback coverage review found the remaining stale prior-org wording docstring, missing `DEFAULT` profile in workflow/docs, and missing bundle root path.
- Scope/philosophy review found `.claude/` would have been packaged, app env variables were not target-truthful, and migration v14 could delete current Entrada identities.
- Integration review folded those findings into the packaging, bundle, config, and migration fixes before deployment.

### Validation

- `./.venv/bin/python -m py_compile run_app.py runtime_app.py atlas/*.py atlas/api/*.py atlas/services/*.py scripts/prepare_bundle.py scripts/validate_repo_hygiene.py`: passed.
- `ruby -e "require 'yaml'; ..."` for `databricks.yml`, `app.yaml`, `.github/workflows/deploy.yml`, and `runtime_manifest.yaml`: passed.
- `./.venv/bin/python scripts/validate_repo_hygiene.py`: passed.
- `cd frontend && npm run lint`: passed with the existing hook warnings only.
- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm test`: passed, 41 files and 317 tests.
- `cd frontend && npm run build`: passed and regenerated `frontend/dist/atlas-build-manifest.json`.
- `./.venv/bin/python -m pytest -q`: passed, 262 tests.
- `./.venv/bin/python scripts/prepare_bundle.py --output /tmp/atlas-bundle-rootpath`: passed and excluded `.claude`, `docs/branding`, `docs/screenshots`, `docs/mockups`, and root screenshot PNGs.
- `databricks bundle validate --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed.
- `databricks bundle summary --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed with workspace root `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev`.
- `databricks bundle deploy --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22 --auto-approve`: deployed successfully.
- `databricks apps deploy atlas --profile DEFAULT --json @/tmp/atlas-app-deploy.json --timeout 20m`: deployed snapshot `01f13fa673941bc39e77495676172919` from `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files`.
- `databricks apps get atlas --profile DEFAULT`: app `RUNNING`, compute `ACTIVE`, URL `https://atlas-2543889327043640.aws.databricksapps.com`.
- Authenticated live `/api/runtime/status`: runtime `live`, governance store `live`, app name `atlas`, actor `skyler@entrada.ai`, build `frontend-d8793ef91c68`.
- Authenticated live `/api/bootstrap?surface=home`: boot state `live`, product `Governance Atlas`, user `skyler@entrada.ai`.
- Deleted old app-owned Databricks resources:
  - app the old hyphenated app slug
  - `the old direct workspace source path`
  - `the old bundle workspace root`

### Notes

- The new app service principal is `6cc86299-e989-42b7-9268-4f4335124812`.
- The new `datapact.atlas` schema was created by the `atlas` app principal and is the active governance store.
- `databricks bundle summary` still reports the Apps URL as `(not deployed)` because bundle deploy creates/updates the app resource, while the active snapshot deployment is created through `databricks apps deploy` from the bundle root.

## Phase 2-4 shell foundation - Entrada dark tokens, expanded navigation, and primitive baseline

Status captured: 2026-04-24 03:18 EDT

### Scope completed

- Replaced the warm light token foundation with Entrada dark `--ga-*` tokens and preserved the active `--gh-*` compatibility aliases used by existing CSS.
- Added compatibility aliases for `--gh-text`, `--gh-text-muted`, `--gh-border`, and `--gh-border-strong` so late shell/page CSS does not fall back to light colors.
- Switched the runtime shell theme pin from light to dark.
- Added reusable North Star primitives under `frontend/src/components/northstar`.
- Added `frontend/src/styles/northstar.css` for the dark shell, expanded side navigation, topbar controls, and primitive styling.
- Replaced the compact icon rail and hidden topbar nav aliases with one expanded accessible side navigation:
  - Home
  - Discovery
  - Asset 360
  - Lineage
  - Governance
  - Insights
  - Taxonomy
  - CDEs
  - Audit
  - Admin
- Reworked the topbar to show Governance Atlas, global search, a truth-backed environment chip, an Atlas AI button marked unavailable until the AI surface is enabled, real notifications from the governance inbox, and the user menu.
- Added shell metadata for environment label and Databricks workspace host.
- Fixed sign-out URL derivation so it uses the backend-provided workspace host instead of guessing from the Databricks Apps URL.
- Added a CDE route and truthful first-pass CDE workspace that derives candidates from visible discovery metadata and marks missing dedicated controls as degraded/unavailable.
- Removed stale hidden-nav accessibility aliases and the unreachable local alerts panel.
- Removed remaining stale prior-product text from tracked snapshot/mockup docs.

### Subagent coverage

- Design-system review found missing `--gh-*` aliases, stale light hardcoded shell backgrounds, and the old `data-theme="light"` pin.
- Shell/navigation review found the compact rail was hiding required modules and that Asset 360 needs asset context rather than blind `entity` routing.
- Regression review found hidden focusable nav aliases, the wrong sign-out host derivation, and command-palette navigation gaps.
- Feedback/ripple review found stale tracked snapshot/mockup references and nav label inconsistencies across the shell and command palette.

### Validation

- `cd frontend && npm run test -- AppFrame.test.jsx SideIconRail.test.jsx ShellTopbarIdentity.test.jsx tokens.test.js`: passed, 31 tests.
- `cd frontend && npm run test -- useAppRouteState.test.jsx App.test.jsx`: passed, 43 tests.
- `cd frontend && npm run lint`: passed with the existing hook warnings only.
- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm test`: passed, 42 files and 319 tests.
- `cd frontend && npm run build`: passed with the existing large chunk warning.
- `./.venv/bin/python -m pytest -q tests/test_runtime_api_contracts.py tests/test_config.py`: passed, 24 tests.
- `./.venv/bin/python scripts/validate_repo_hygiene.py`: passed.
- Search found no stale prior-product slug, prior package name, prior-org profile, prior workspace id, or stale email references in project-local files outside ignored dependencies, build output, and Git internals.

### Notes

- CDE is intentionally marked degraded where dedicated control-coverage tables are not configured; no synthetic CDE counts or control coverage are shown.
- Admin currently routes to the existing capability/control surface pending the dedicated Admin Control Center redesign.
- Atlas AI is visible as a shell affordance but not enabled until evidence-backed backend endpoints are implemented.

## Phase 5 composite Atlas API contract and deployed snapshot

Status captured: 2026-04-24 04:05 EDT

### Scope completed

- Added `atlas/api/atlas.py` with composite Atlas presentation endpoints:
  - `GET /api/atlas/command-center`
  - `GET /api/atlas/assets/{asset_fqn:path}/360`
  - `GET /api/atlas/governance/workbench`
  - `GET /api/atlas/governance/requests/{request_id}`
  - `GET /api/atlas/insights`
  - `GET /api/atlas/taxonomy/overview`
  - `GET /api/atlas/cde`
  - `GET /api/atlas/cde/{cde_id:path}`
  - `GET /api/atlas/audit/evidence`
  - `GET /api/atlas/admin/control-center`
  - `POST /api/atlas-ai/recommendations`
  - `POST /api/atlas-ai/chat`
- Added `atlas/services/atlas_metrics.py` as the pure view-model composition layer.
- Extended the shell API contract with all Atlas composite endpoint keys.
- Regenerated `docs/runtime_api_openapi_snapshot.json`.
- Added backend tests for Atlas metrics, API routing, response metadata, degraded control coverage, asset visibility, and AI evidence guardrails.
- Added frontend command-center API helpers, `useCommandCenter`, and Home route hydration from the composite endpoint with seed-preserving degraded/error behavior.
- Kept unavailable or missing signals as `null`, degraded, or omitted rather than inventing deltas, sparklines, tasks, lineage, quality, or control coverage.
- Deployed the validated snapshot from the bundle `root_path` source tree.

### Subagent coverage

- Backend contract review pushed the router toward thin runtime-helper orchestration and pure service functions.
- Frontend command-center review pushed Home to keep a seed while preserving refresh errors and degraded metadata.
- QA/ripple review identified OpenAPI snapshot, route-prefix, and live bundle validation gaps before deploy.

### Validation

- `./.venv/bin/python -m py_compile run_app.py runtime_app.py atlas/*.py atlas/api/*.py atlas/services/*.py scripts/generate_runtime_api_openapi_snapshot.py scripts/validate_repo_hygiene.py`: passed.
- `./.venv/bin/python -m pytest -q tests/test_atlas_metrics.py tests/test_atlas_api.py tests/test_runtime_api_contracts.py`: passed, 31 tests.
- `./.venv/bin/python -m pytest -q tests/test_atlas_metrics.py tests/test_atlas_api.py tests/test_runtime_api_contracts.py tests/test_insights_api.py tests/test_governance_workflow.py tests/test_admin_background_status.py`: passed, 65 tests.
- `./.venv/bin/python -m pytest -q`: passed, 273 tests.
- `./.venv/bin/python scripts/validate_repo_hygiene.py`: passed.
- `git diff --check`: passed.
- `cd frontend && npm run test -- useCommandCenter.test.jsx HomePage.test.jsx App.test.jsx`: passed, 31 tests.
- `cd frontend && npm run lint`: passed with existing hook warnings only.
- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm test`: passed, 44 files and 329 tests.
- `cd frontend && npm run build`: passed with the existing large chunk warning.
- `databricks bundle validate --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed.
- `databricks bundle summary --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed with workspace root `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev`.
- `databricks bundle deploy --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed from the prepared bundle source.
- `databricks apps deploy atlas --profile DEFAULT --json @/tmp/atlas-app-deploy.json --timeout 20m`: deployed snapshot `01f13fb175a91f10b1d00ea290916e7b` from `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files`.
- `databricks apps get atlas --profile DEFAULT`: app `RUNNING`, compute `ACTIVE`, active deployment `01f13fb175a91f10b1d00ea290916e7b`, source path `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files`.
- `databricks apps logs atlas --profile DEFAULT --source APP`: the new process started successfully after deploy.
- Workspace file checks confirmed `runtime_app.py` and `frontend/dist/atlas-build-manifest.json` exist under the bundle `root_path`.
- Stale-reference search passed for retired app/package/org/profile/workspace identifiers in project-local files outside ignored dependencies, build output, mockup binaries, and Git internals.

### Notes

- Public unauthenticated `curl` against the Databricks App URL returns Databricks auth `401`, as expected.
- The browser smoke script could not attach to an authenticated Chrome CDP session and could not decrypt a copied browser profile token, so browser visual validation remains the main unresolved verification item.
- `databricks bundle summary` still reports the Apps URL as `(not deployed)` even though `databricks apps get atlas` and App logs show the active snapshot deployment is running from the bundle `root_path`.

## Phases 6-16 integrated North Star pages, visual QA, and live deploy

Status captured: 2026-04-24 04:42 EDT

### Scope completed

- Integrated the phase-worker page passes for Home, Discovery, Asset 360, Lineage, Governance, Insights, Taxonomy, CDEs, Audit, and Admin.
- Wired Admin as a first-class route and module, including active nav state and lazy workspace loading.
- Preserved live-first data behavior across the new pages:
  - Home uses the Atlas command-center composite payload.
  - Insights uses the Atlas insights composite payload and evidence-backed recommendations.
  - Discovery continues to use the existing discovery search behavior.
  - Asset 360 safely merges same-FQN composite data without overwriting the selected live record.
  - Lineage keeps the existing lineage hook, cache behavior, and column-trace behavior while adding a selected-node inspector and real-graph path state.
  - Governance, Taxonomy, CDE, Audit, and Admin use existing live payloads plus Atlas composites where safe.
- Kept missing controls, evidence, lineage, quality, and stewardship signals as unavailable or degraded instead of inventing workflow state.
- Removed stale project-local org/app/profile/workspace identifiers from tracked source and support artifacts outside ignored dependencies, generated build output, binary mockups, and Git internals.
- Captured authenticated live visual QA screenshots for all ten pages at `1536x1024`, `1440x900`, and `1280x720` under `docs/northstar_visual_qa/`.
- Redeployed the live Databricks App from the bundle `root_path` source tree.

### Subagent coverage

- Feedback coverage found missing Admin route wiring and stale support-artifact identifiers; both were corrected.
- Home/Insights review moved Insights onto the composite API and kept unavailable metrics explicit.
- Discovery/Asset review gated composite Asset 360 merging by same FQN and removed synthetic preview task rows.
- Lineage review preserved existing fetch/cache behavior and derived inspector/path data only from visible graph state.
- Operations review used composite helpers where safe and kept unavailable evidence/control fields truthful.
- QA/ripple review pushed the final pass to run full frontend/backend tests, live API smokes, bundle deploy, and screenshot coverage.

### Validation

- `cd frontend && npm test -- --run src/App.test.jsx src/hooks/useAppRouteState.test.jsx src/components/HomePage.test.jsx src/components/EntityWorkspace.schemaFilter.test.jsx src/components/LineageGraph.test.jsx src/components/LineageStage.test.jsx`: passed, 67 tests.
- `cd frontend && npm run lint`: passed with existing hook warnings only.
- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm test`: passed, 45 files and 335 tests.
- `cd frontend && npm run build`: passed with the existing large chunk warning.
- `./.venv/bin/python -m py_compile run_app.py runtime_app.py atlas/*.py atlas/api/*.py atlas/services/*.py scripts/generate_runtime_api_openapi_snapshot.py scripts/validate_repo_hygiene.py scripts/prepare_bundle.py`: passed.
- `./.venv/bin/python scripts/validate_repo_hygiene.py`: passed.
- `./.venv/bin/python -m pytest -q`: passed, 273 tests.
- `git diff --check`: passed before final log updates.
- `databricks bundle validate --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed.
- `databricks bundle summary --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed with workspace root `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev`.
- `databricks bundle deploy --profile DEFAULT -t dev --var warehouse_id=b50e5cec5077ea22`: passed from the prepared bundle source.
- `databricks apps deploy atlas --profile DEFAULT --json @/tmp/atlas-app-deploy.json --timeout 20m`: deployed snapshot `01f13fb653271e06a1ab587484d5aa65`.
- `databricks apps get atlas --profile DEFAULT`: app `RUNNING`, compute `ACTIVE`, active deployment `01f13fb653271e06a1ab587484d5aa65`, source path `/Workspace/Users/skyler@entrada.ai/.bundle/atlas/dev/files`.
- Authenticated live API smokes passed for `/api/bootstrap?surface=home`, `/api/atlas/command-center`, `/api/atlas/insights`, `/api/atlas/cde`, `/api/atlas/admin/control-center`, and `/api/atlas/assets/westat_samples.retail_v2_serv.gold_customer_360/360`.
- Live visual QA report `docs/northstar_visual_qa/report.json`: 30 captured screenshots, 10 pages, 3 viewport sizes, 0 failed script checks.

### Notes

- CDE remains intentionally degraded when dedicated control-coverage sources are unavailable.
- The live lineage route preserved asset context during visual QA even when lineage capabilities were warming or unavailable.
- `databricks bundle summary` still reports the Apps URL as `(not deployed)` although `databricks apps get atlas`, live API smokes, and App logs show the app running from the bundle `root_path`.
