# Governance Hub Reconstruction Plan

## Goal

Governance Hub remains Governance Hub-branded and Databricks-native, but the
product target is OpenMetadata-class workflow completeness, truthfulness, and
enterprise polish across discovery, entity detail, lineage, governance,
collaboration, and quality.

Guiding rule:

- no surface may ship with synthetic workflow state, ambiguous provenance, or
  unverified backend truth
- no phase may introduce a second source of truth for history, identity,
  authorization, or visibility without an explicit derivation contract and
  deprecation path for the first

## Claim Discipline

- v1 may claim OpenMetadata-class discovery, entity, lineage, and governance
  control-plane core only where the shipped workflow is real, persisted,
  role-tested, and limited to shipped entity classes plus supported workspace
  modes
- discovery breadth, lineage breadth, and operational-surface parity claims
  apply only to the shipped entity classes and supported workspace modes that
  are proven in the current phase
- governance-breadth and governance-scale claims remain gated until their
  corresponding phases land or the claim is explicitly narrowed
- until metrics and data contracts are real, external positioning stays at
  `OM-class catalog/governance core` rather than full governance supremacy
- no full `OpenMetadata killer` or governance-supremacy claim is valid until
  metrics, data contracts, security-trimmed discovery, export, and privileged
  operational surfaces are implemented or formally excluded with narrower
  product positioning
- no parity claim is valid for a surface until its persistence model,
  background-work model, and branch-state proof all exist in the shipping
  branch
- collaboration positioning remains `workflow collaboration core` rather than
  full mention-parity until `@user/team` and `#asset` mentions are real,
  persisted, and role-tested
- no governance breadth entity may ship without a canonical route, preview
  contract, state machine, version model, and cutover-safe authority source

## Branch-State Verification Gate

- no plan item may be described as `already landed`, `kept green`, or
  otherwise complete unless the current shipping branch proves it
- proof channels are explicit:
  - CI branch-state hygiene and build/test gates
  - deploy-time packaging/runtime verification where the claim touches the live
    app artifact
  - diagnostics/setup truth only for runtime capabilities, not as a substitute
    for branch-state proof
- required proof categories before sign-off on any supposedly landed item:
  - source-file presence or absence where route/runtime ownership changed
  - repo hygiene checks for removed legacy and OM runtime/config refs
  - script/package evidence for lint, typecheck, router, query, and other
    foundational contracts
  - targeted regression tests for prior P0 or contract-critical failures
- required automated proofs are explicit, not narrative-only:
  - runtime-entrypoint assertions must follow the declared current
    architecture, not a rename in isolation:
    - assert only one supported runtime entrypoint chain exists
    - assert removed legacy runtime/config paths are absent
    - assert the packaged app still launches through the declared entrypoint
  - current-branch runtime assertions are:
    - `rg` or equivalent checks for `runtime_app.py`, `run_app.py`,
      `app.yaml`, and absence of `modern_app.py`
    - file-chain assertions proving the currently declared runtime chain:
      `app.yaml -> run_app.py -> runtime_app.py`
  - `frontend/package.json` script and dependency assertions for:
    - `lint`
    - `test`
    - `typecheck`
    - `build`
    - `react-router-dom`
    - `@tanstack/react-query`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - targeted import-regression proof for the `EntityWorkspace.jsx`
    missing-import crash path
  - deploy-artifact inventory checks proving:
    - `frontend/dist` is not tracked in git
    - packaged bundles exclude removed legacy/runtime artifacts
  - Databricks `bundle validate` and `bundle summary` proof for the shipping
    branch using profile `tristate`
- if the branch and the plan disagree, the branch truth wins until the plan or
  implementation is corrected

## Phase 0 Hotfix Gate

These items are already landed in code and must remain green before any broader
reconstruction work continues:

- `EntityWorkspace.jsx` must import and use `prefetchAssetAvailability`
  correctly
- `EntityWorkspace.jsx` must import and use
  `canOpenLinkedAssetRecord` correctly
- ESLint `no-undef`, unused-import detection, and hooks rules must run in CI
  before larger frontend refactors
- no known runtime `ReferenceError` may remain on discovery, entity, lineage,
  or governance routes

Phase 0 exit:

- no known P0 runtime crash path remains
- the lint gate would fail if the same missing-import regression reappears
- branch-state verification proves the claimed landed hotfixes on the shipping
  branch rather than only in plan narrative

## Deviation Register

### Required parity behavior

- grouped advanced search with AND/OR logic, deleted/inaccessible disposition,
  truthful totals/facets/cards/preview/export, and stable back/forward behavior
- entity hero with source, owner, tier, type, usage, description, copy-link,
  share, task/thread counts, backed version history, and no dead counters
- glossary hierarchy with glossaries, term detail tabs, reviewers, approvals,
  versions, and linked assets
- real conversation threads and tasks around asset descriptions, tags, column
  descriptions, and glossary changes
- lineage settings, preview drawer, edge provenance, truncation visibility, and
  truthful column-lineage completeness
- queries, usage/workloads, profile, and quality as first-class entity surfaces
  only in supported workspace modes where the required operational and quality
  planes are real
- quality phase 1 with on-demand tests, persisted runs, alerts, and entity
  quality/profile surfaces

### Governance Hub-specific replacements

- manual lineage editing becomes governed `lineage_overrides` with approval,
  audit trail, and visually distinct overlay edges
- activity feeds become threaded asset conversations plus audited metadata
  change events instead of a literal social-feed clone

### Intentional omissions in v1

- follower/following model
- deleted-asset read-only browsing until a tombstone retention plane exists
- full `@user/team` and `#asset` mention parity; collaboration claims remain
  at `workflow collaboration core` until mentions are real

### Later-phase extensions

- announcements with a non-follower delivery model
- broader health dashboard and incident workflow
- basic `@user/team` and `#asset` mentions, then richer mention/reaction
  network
- admin/compliance audit-log browser, filters, retention visibility, and export
- external notifications and chat/tool integrations:
  - email
  - webhooks
  - Slack or Teams-class delivery

## Governance Breadth Decisions

- Classification taxonomy is first-class governance scope, not just a set of
  editable tag fields.
  - introduce classification entities, taxonomy pages, usage counts, request
    and update workflows, and policy-facing semantics
  - classification browse, usage, and request flows must be real before the
    product can claim OM-class governance breadth
- Domains and data products graduate from compatibility tags to governed
  entities.
  - each needs owner, reviewer, description, asset collections, history, and
    browse/grouping surfaces
  - UC tag values are a transition path only, not the final authority model
  - the authority cutover from UC tags to governed entities is phase-bounded
    and may not remain an open-ended hybrid truth model
  - governed domain and data-product entities require explicit version/history
    support before governance-depth claims are valid
- Glossary semantic depth extends beyond hierarchy and links.
  - required semantics:
    - synonyms
    - related terms
    - references/URLs
    - glossary-term tags
    - glossary-level owner/reviewer inheritance
    - import/export
    - explicit version numbering semantics
    - term-to-asset tag propagation policy
- Column bulk operations are required governance depth, not optional polish.
  - repeated logical-column governance, cross-table grouping, bulk apply, bulk
    review, and column-specific queues are planned explicitly
- Metrics are not silently omitted.
  - parity decision: defer from v1 parity core, but keep a first-class planned
    entity in Governance depth and scale
- Data contracts are not silently omitted.
  - parity decision: explicit post-parity phase unless product direction moves
    them into Governance depth and scale earlier
- Databricks classification results are treated as a recommendation source,
  not silent background truth.
  - capability-gated recommendation flows may propose sensitivity or
    classification updates from Databricks classification detections
  - a steward or other authorized actor must explicitly accept a recommendation
    before it becomes authoritative metadata
  - classification recommendation ingestion is a privileged background-work
    source, not a normal live metadata read
  - recommendation evidence, raw findings, and any sample-derived fields are
    redacted by default and hidden unless the current actor is explicitly
    authorized to view them
  - classification taxonomy edits and term changes require explicit
    version/history support before taxonomy-governance claims are valid
  - Databricks-native governance differentiation includes an explicit
    recommendation-to-policy loop:
    - classification result
    - steward review
    - approved metadata or classification change
    - suggested policy or remediation action
    - no policy action is auto-applied without an explicit later-phase policy
      contract
- Governance-breadth parity claim rule:
  - no OpenMetadata-class governance-breadth claim is valid until metrics and
    data contracts are implemented or formally excluded with the claim narrowed
    accordingly
- breadth and scale entities do not ship as hidden rows inside a generic
  governance shell:
  - classifications
  - domains
  - data products
  - metrics
  - data contracts
  each require canonical routes, previews, detail surfaces, and workflow
  contracts before their claims expand

## Governance Kernel / Breadth / Scale Boundaries

- Governance kernel is the smallest shippable control-plane core:
  - identity directory
  - entity registry
  - audit log
  - threaded conversations
  - task workflows and diffs
  - glossary minimum
  - notification inbox model
  - activity events
  - summary projections
- Governance breadth is where OM-class surface area is earned:
  - classification taxonomy
  - domains and data products
  - glossary deep semantics
  - column bulk operations
  - Databricks classification recommendations
- Governance scale is where broader governance operating power lands:
  - metrics
  - data contracts
  - bulk governance workflows
  - larger operator and steward throughput surfaces

Execution boundary rules:

- kernel may not absorb classifications, domains, data products, glossary deep
  semantics, metrics, data contracts, or generic bulk-governance workflows
  except for forward-compatible foreign-key stubs that do not expose those
  features early
- breadth depends on phase-4 shell primitives, phase-5 contract/schema lock,
  and the kernel identity/audit/thread/task/glossary/notification/projection
  foundations
- scale depends on breadth entities and may not block Discovery v2 or Entity v2
  exits
- any breadth- or scale-only feature remains hidden or explicitly degraded
  until its own phase lands; earlier phases may not fake the missing depth with
  synthetic placeholders
- governance kernel ships in deployed tranches, not as one blocking drop:
  - tranche A:
    - identity directory
    - entity registry
    - audit log
  - tranche B:
    - threads
    - tasks
    - activity events
  - tranche C:
    - notification inbox model
  - tranche D:
    - glossary minimum
  - tranche E:
    - projections
- breadth and scale work may not start until the earlier integrated loop demo
  gate proves that the product can carry one polished workflow end to end

## Phase Order

1. Phase 0 hotfix gate and lint/runtime guardrails
2. Foundation deletions, packaging, route-serving, mutation authz, and app
   observability guardrails
3. Frontend foundation narrow cut
   - router ownership
   - abortable transport
   - query provider and query primitives
   - no broad consumer rewrite before contracts stabilize
4. Design system / shell phase
   - shell, hero, tabs, drawers, rails, tokens, and degraded/loading states
   - no rebuilt major surface lands on the old giant CSS foundation
5. API decomposition, migrations, generated contracts, canonical entity
   identity, workspace capability detection, background work-plane contract,
   install/setup wizard, feature-flag scaffolding, and physical schema lock
6. Governance kernel tranche A
   - identity directory
   - entity registry
   - audit log
7. Governance kernel tranche B
   - threads
   - tasks
   - activity events
8. Governance kernel tranche C
   - notification inbox model
9. Governance kernel tranche D
   - glossary minimum
10. Governance kernel tranche E
   - summary projections and queue read models
11. Early vertical slice hardening
   - discovery browse to entity hero
   - task request and thread flow
   - glossary link flow
   - lineage preview or truthful unavailable state
   - quality status badge or truthful unavailable state
   - may use temporary adapters only where removal tickets and demo acceptance
     are explicit
12. Quality core
   - identity directory
   - test library
   - profile and quality contracts
   - alert model
   - entity-facing projections
13. Lineage v2 read-only core
   - provenance
   - drawer and preview contract
   - summary projections
14. Discovery v2
15. Entity v2 including capability-gated queries/usage/profile/quality/history
16. Governance breadth
   - classification taxonomy
   - domains and data products
   - glossary deep semantics
   - column bulk operations
   - Databricks classification recommendations
17. Governance scale
   - metrics
   - data contracts
   - bulk governance workflows
18. Lineage overrides
19. Quality scheduling and broader health/incident flows
20. Audit log browser/export and compliance reporting
21. Post-parity Databricks differentiation
22. Final polish, accessibility, visual regression, role-matrix QA, and live
   sign-off

Rules:

- phase-4 shell work is limited to tokens, layout primitives, route containers,
  shared interaction patterns, and degraded/loading/error states; it must not
  take a durable dependency on provisional backend payload contracts
- phases 6 through 8 may ship user-facing UI only on phase-4 shell primitives;
  otherwise the tranche remains backend/API-only until the shell contract is
  ready
- no rebuilt major surface may consume unstable legacy payloads unless it uses
  an explicitly temporary adapter with a removal ticket and defined exit point
- every non-trivial app tranche closes with Databricks-native validation and
  `bundle summary` through the Databricks MCP/CLI path using profile
  `tristate`; these checks are required even when no deploy occurs
- destructive Databricks actions in the production workspace require explicit
  user approval unless they are limited to app-owned development-cycle
  resources for this project

## Phase Exit Criteria

- Phase 0:
  - P0 import crash fixed and kept green
  - ESLint `no-undef` and hooks rules active
  - no known runtime console crash remains on major routes
- Foundation:
  - one runtime only
  - clean packaged deploy from a clean checkout
  - request/correlation IDs and slow-route logging live
  - runtime/config/deploy materials contain no live legacy or OM bridge refs
  - branch-state verification proves the shipping runtime file, packaging path,
    and repo hygiene claims
  - benchmark, QA, and screenshot-reference materials may still mention
    OpenMetadata explicitly as comparison input
- Frontend data layer:
  - canonical routing uses `react-router-dom`
  - all new server state uses TanStack Query
  - fetches are abortable
  - hook-owned canonical Maps/event buses are removed from hot paths
- Design system / shell:
  - shell, hero, tabs, drawers, states, and density tokens are defined
  - rebuilt surfaces use the new shell primitives rather than the old giant CSS
    foundation
- API/contracts and schema lock:
  - routers split by surface
  - JSON schema/OpenAPI snapshots generated
  - generated frontend types wired into hot-path consumers
  - canonical entity identity and rename handling live in control-plane writes
  - minimal bootstrap contract is explicit, tested, and limited to shell
    identity, actor context, capabilities, route hints, and safe diagnostics
    metadata rather than seeded heavy surface data
  - install/setup validation exists for required workspace capabilities before
    first-use claims are shown
  - install/setup explicitly validates the safe non-admin operational sharing
    path for queries/usage/workloads:
    - actor-scoped OBO
    - validated dynamic-view plane
    - warehouse `CAN VIEW` plus downstream data-visibility model
    - or hard disable of the surface
  - background work-plane contract, ownership, and retry/idempotency rules are
    explicit before async export, corpus rebuild, or quality scheduling begins
  - no async work persists or replays raw OBO tokens
  - feature-flag and temporary-adapter inventory is explicit and auditable
  - physical schema / DDL appendix is complete for every new table family
  - no table family begins implementation before API and UX acceptance
    criteria are locked alongside the DDL
  - no rebuilt surface consumes unstable legacy payloads except behind a
    temporary adapter with an explicit removal ticket
  - custom properties, persisted profile models, and governed-entity version
    models are defined before those surfaces claim parity
- Governance kernel tranche A:
  - identity directory works
  - entity registry mints durable IDs or maps stable source IDs truthfully
  - audit log is real and persisted
- Governance kernel tranche B:
  - threads/tasks/activity are real and persisted
  - task diff and accept/edit/reject workflows are real
- Governance kernel tranche C:
  - notification inbox, receipts, and unread counts are real and persisted
- Governance kernel tranche D:
  - identity directory works
  - glossary minimum is real and persisted
  - top-level glossaries, reviewer inheritance, and reviewer-policy
    fulfillment are modeled explicitly enough to avoid schema invention during
    coding
- Governance kernel tranche E:
  - summary projections back hero counts, governance queue counts, and glossary
    counts
- Early vertical slice:
  - one deployed workflow proves discovery to entity to task/thread to
    glossary link to lineage preview and quality status end to end, with
    truthful unavailable or degraded states accepted until those capability
    planes land
  - any temporary adapter used in the slice has an explicit removal ticket and
    exit phase
- Quality core:
  - reusable tests, persisted profile snapshots, normalized runs, alerts, and
    entity projections are real
- Lineage read-only core:
  - graph truth matches backend probes
  - truncation and provenance are visible
  - masked and incomplete column-lineage states are labeled truthfully
  - drawer content is never empty or misleading
- Discovery:
  - grouped search works
  - counts/facets/cards/preview/export agree
  - performance budget met
  - parity claims are limited to shipped entity classes only
- Entity:
  - capability-driven tabs only
  - hero, history, share/copy-link, queries/usage/profile/quality are real
    only when the required workspace capability plane exists
  - queries parity in v1 means observed history only unless a saved-query model
    is explicitly added later
  - when the operational plane is unavailable, queries/usage/workloads/profile
    surfaces show explicit capability-unavailable states instead of empty truth
  - mutations survive hard refresh
- Governance breadth:
  - classification, domains/data products, glossary deep semantics, and column
    bulk operations are implemented
  - no OM-class governance-breadth claim is made until metrics and data
    contracts are implemented or formally excluded
- Governance scale:
  - metrics, data contracts, and bulk governance workflows are implemented or
    formally excluded with the product claims narrowed accordingly
- Lineage overrides:
  - overlay state machine, audit trail, and approval path are real
- Quality scheduling and health:
  - scheduled execution, stale state, and health/incident views are real
- Databricks differentiation:
  - UC- and Databricks-native enhancements are real and gated by workspace
    capability detection
- Final sign-off:
  - role-matrix E2E passes
  - deployed Databricks App validation passes
  - screenshot pack, truth-check pack, latency pack, and regression pack pass

## Milestone Demo Gates

Each milestone demo must run in the real deployed Databricks App, not only in a
local Vite/FastAPI preflight.

1. Clean deploy plus lint/build/package gates.
2. Install/setup wizard, feature flags, admin diagnostics, and background
   work-plane baseline.
3. New shell plus canonical routing.
4. Governance kernel tranche A: identity directory, entity registry, and audit.
5. Governance kernel tranche B: conversations, tasks, and activity.
6. Governance kernel tranche C: inbox behavior and unread counts.
7. Governance kernel tranche D: glossary minimum.
8. Governance kernel tranche E: queue and hero projections.
9. Early vertical slice: discovery to entity to task request to glossary link
   to lineage preview or truthful unavailable state to quality status or
   truthful unavailable state.
10. Quality core and entity-facing quality/profile surfaces.
11. Lineage read-only correctness and preview/drawer contract.
12. Discovery v2 against the security-trimmed corpus.
13. Entity hero plus capability-driven tabs.
14. Governance breadth: classifications, domains/data products, glossary deep
   semantics, and column bulk operations.
15. Governance scale and claim-expansion: metrics, data contracts, and broader
    bulk governance workflows.
16. Audit/compliance surface: audit-log browser, filtering, export, and
    retention truth.
17. Databricks-native differentiation: capability dashboard, permission
    explanations, deep links, and evidence-linked diagnostics.
18. Branch-state verification: the current shipping branch proves every
    previously claimed landed prerequisite and no stale plan claim survives.

## Early Vertical Slice Demo Contract

- the first integrated polished workflow must land before broad breadth/scale
  build-out continues
- required slice:
  - discovery browse or search
  - entity hero open
  - thread plus task request
  - glossary link creation or review visibility
  - lineage preview or drawer truth, or a truthful unavailable/degraded state
  - quality status badge or panel, or a truthful unavailable/degraded state
- the slice must run in the deployed Databricks App with real auth and real
  capability responses
- if a workspace lacks query, workload, lineage, or quality capabilities, the
  slice must prove truthful unavailable states instead of skipping the proof
- no synthetic workflow rows, placeholder counters, or fake acceptance paths
  may be used in the slice
- any temporary adapter used in the slice must name:
  - the adapter boundary
  - the removal ticket
  - the exit phase
  - the deployed demo it is allowed to unblock

## Deployment Tenancy / Scope Contract

- one Governance Hub deployment owns one Databricks workspace as its primary
  control-plane, export, and operator-diagnostics boundary
- the deployment may observe broader source facts, but only with explicit scope
  attribution:
  - workspace-scoped facts
  - metastore-scoped facts
  - account-region-scoped facts
- metastore- or account-region-scoped source facts may inform discovery,
  lineage, diagnostics, or recommendations only as attributed evidence inside
  that deployment; they do not create shared governance state across separate
  Governance Hub deployments by default
- persisted governance state attaches to the deployment boundary first:
  - entity registry
  - glossary links
  - tasks and threads
  - projections
  - exports
  - diagnostics snapshots
- every persisted model that can carry broader source facts must record:
  - deployment scope
  - source workspace scope where applicable
  - source metastore scope where applicable
  - source account-region scope where applicable
- discovery corpus slices, export jobs, and background work may not widen
  beyond the deployment scope unless a later-phase cross-workspace projection
  contract explicitly allows it and labels the source scope truthfully
- cross-workspace operational facts may appear only as redacted, attributed
  evidence unless the deployment's authority contract explicitly grants a
  broader read-only projection mode

## Metadata Authority Matrix

| Field | Authority | Read path | Write path | Audit path | Invalidation / UI label |
|---|---|---|---|---|---|
| Description | UC table and column comments | asset hero, schema, previews | UC comment mutation endpoints | `metadata_audit_log` plus request/task link | invalidate asset, discovery, lineage, governance; label `UC comment` |
| Owners | `data_owners` Delta table | asset hero, governance summary, backlog | owner CRUD APIs only | row `updated_*` plus audit log | invalidate asset/governance/bootstrap; label `Control plane` |
| Domain | UC tag until governance-breadth cutover, then governed entity authority | discovery facets, entity hero | metadata/tag patch API until cutover, then domain entity APIs | audit log tag snapshot plus governed-entity audit rows | invalidate discovery facets and asset caches; label `UC tag` until cutover, then `Governed entity` |
| Tier | UC tag for now | discovery facets, entity hero | metadata/tag patch API | audit log tag snapshot | same as domain |
| Certification | UC tag for now | discovery facets, entity hero | metadata/tag patch API | audit log tag snapshot | same as domain |
| Sensitivity | UC tag for now | discovery facets, entity hero | metadata/tag patch API | audit log tag snapshot | same as domain |
| Criticality | UC tag for now | entity hero, governance rollups | metadata/tag patch API | audit log tag snapshot | same as domain |
| Data product | UC tag until governance-breadth cutover, then governed entity authority | entity hero and discovery filters | metadata/tag patch API until cutover, then data-product APIs | audit log tag snapshot plus governed-entity audit rows | same as domain |
| Custom properties | `custom_property_definitions` plus `custom_property_assignments` | custom-properties tab, entity detail, eligible discovery filters | custom-property definition and assignment APIs only | definition versions plus audit log | invalidate entity/discovery/preview; label `Schema-driven custom property` |
| Glossary associations | `glossary_term_links` Delta table | entity chips, glossary assets rail, column rows | link attach/detach APIs | association rows with actor/timestamps | invalidate asset, governance, discovery, lineage; label `Manual` or `Migrated tag` |
| Tasks / thread counts | `threads` and `tasks` | entity activity, governance queue | thread/task APIs only | post and state rows | invalidate asset/governance/entity summary; never derive from posture gaps |
| Lineage | live UC/system lineage plus approved overlays | lineage graph, drawer, entity summary | read-only live first; overlays later | overlay rows and approvals | invalidate lineage/entity; label live vs overlay provenance |
| Quality | `quality_tests`, `quality_runs`, `quality_alerts` | profile and quality tabs | test CRUD and run APIs | run rows with SQL/template, params, actor, evidence | invalidate quality/entity/governance; mark stale |
| Sample / profile / usage numbers | live query outputs plus persisted `profile_*` and workload observations where available | sample, queries, usage, profile tabs | no direct write path | provenance plus profile/workload snapshots | TTL plus explicit stale label |

Rules:

- no field may display as authoritative without a declared authority row
- every mutable or derived payload returns provenance and stale bounds
- if the authority plane is unavailable, the API returns degraded/unavailable
  state, not empty truth

Authority-matrix completion rules before sign-off:

- every shipped field in hero cards, discovery cards, preview rails, drawers,
  activity/history, lineage summary, governance queue, and quality/profile
  views must have an authority row before sign-off
- required row families still to be enumerated during implementation:
  - generic classification tags beyond the named governance tags
  - constraints, defaults, nullability, and schema truth
  - row counts, file counts, storage metrics, and storage-management fields
  - lineage-summary counts and adjacency totals
  - preview trust, coverage, and freshness indicators
  - glossary semantic fields
  - task SLA, due-date, and assignee/reviewer badges
  - query, usage, and workload counts
  - recently-updated sort source
  - completeness and coverage score inputs

## Authority Cutover Contract

- no compatibility-tag field may stay in indefinite hybrid truth after its
  governed-entity replacement lands
- every authority cutover declares:
  - pre-cutover authority
  - migration-phase dual-read rules
  - whether dual-write is allowed, for how long, and under what removal ticket
  - the cutover phase where the governed entity becomes authoritative
  - when the legacy field becomes read-only provenance rather than editable
    truth
  - backfill, remediation, and steward-review handling for unresolved rows

| Surface | Pre-cutover authority | Transitional read/write rules | Post-cutover authority | Provenance treatment |
|---|---|---|---|---|
| Domain | UC tag | dual-read allowed during governance breadth; dual-write allowed only during a bounded migration window with a removal ticket | governed `domains` entity plus membership links | legacy UC tag becomes read-only provenance after cutover |
| Data product | UC tag | dual-read allowed during governance breadth; dual-write allowed only during a bounded migration window with a removal ticket | governed `data_products` entity plus membership links | legacy UC tag becomes read-only provenance after cutover |
| Classification assignments | UC tags and manual sensitivity labels | recommendation flows and assignment links may dual-read raw detections and controlled assignments during migration only | governed classification assignment rows plus approved recommendation decisions | raw detections and legacy labels become provenance, not direct write truth |

## Platform Core Model

- Governance Hub must build on a small shared metadata platform core rather
  than proliferating one-off table families for every entity type
- required cross-entity platform primitives:
  - `entities`
  - `entity_aliases`
  - `entity_relationships`
  - `entity_versions`
  - `change_events`
- platform-core responsibilities:
  - durable cross-surface identity
  - typed relationships and alias tracking
  - append-only change capture for projections and notifications
  - generic version history scaffolding
  - reconciliation across live Databricks/UC observations and control-plane
    state
- typed extension tables are allowed only when:
  - the entity has materially different workflow/state requirements
  - the entity needs a different retention/indexing strategy
  - the generic relationship or version model would create hot-path read or
    write inefficiency
- every new entity family must declare:
  - the platform-core `entity_kind`
  - the required typed extension table, if any
  - which relationships stay generic vs specialized
  - which changes emit `change_events`
  - how the entity participates in search, history, and audit surfaces
- APIs stay resource-first:
  - every new entity binds to one canonical resource envelope before bespoke UI
    tabs or workflows are added
- projections, notifications, and background fanout consume `change_events`
  instead of scraping many bespoke tables ad hoc

## Canonical Resource Envelope

- every hot-path API returns one canonical response envelope, even when the
  inner `data` shape differs by resource
- minimum envelope shape:
  - `data`
  - `meta`
  - `errors`
- `meta` must carry, where applicable:
  - `entityId`
  - `entityFqn`
  - `source`
  - `authoritative`
  - `observedAt`
  - `staleAfter`
  - `capabilities`
  - `allowedActions`
  - `warnings`
  - `degraded`
  - `visibilityScope`
- surface-specific payloads may extend the envelope, but they may not invent
  bespoke degraded-state, provenance, or capability wrappers on hot paths

## Event / History Derivation Contract

- the plan uses one explicit derivation map to avoid duplicated or
  contradictory history/state
- authoritative and derived stores are separated as follows:
  - `metadata_audit_log`:
    - immutable compliance-grade write and security-operation ledger
  - `entity_versions`:
    - version snapshot and diff store for user-facing history and rollback
      context
  - `change_events`:
    - append-only machine fanout bus emitted after a successful authoritative
      write
    - every event carries an explicit `event_schema_version`
  - `activity_events`:
    - user-facing feed projection derived from `change_events` plus thread/task
      state transitions; it is not independently authored in parallel
  - `thread_posts`:
    - collaboration content only
  - `notifications` and `notification_receipts`:
    - delivery state derived from `change_events` and routing rules
  - projections:
    - read models rebuilt from `change_events` plus authoritative source rows,
      never from notifications
- user-facing history surfaces compose `entity_versions`, `activity_events`,
  and collaboration content with explicit provenance labels; they do not treat
  one store as a silent substitute for another

## Change Event Consumer State Model

- every `change_events` consumer persists:
  - consumer key
  - scope or workspace key where applicable
  - last acknowledged event ID
  - last acknowledged event timestamp
  - replay cursor
  - dedupe window key
  - poison-event status
  - last success and failure timestamps
- consumer rules:
  - consumers are idempotent and safe to replay
  - out-of-order handling is explicit by `created_at + change_event_id`
  - poison events move to dead-letter or operator-acknowledged holding state;
    they do not silently block unrelated consumers forever
  - replay tooling must support one-consumer replay without rewinding unrelated
    consumers
  - every event declares an `event_schema_version`
  - every consumer family declares:
    - owner
    - supported event families
    - delivery semantics:
      - exactly-once where proven
      - otherwise at-least-once with idempotent replay
    - replay guarantee and retention window
    - schema-compatibility policy
    - poison-event acknowledgement workflow
  - schema evolution may add backward-compatible fields, but incompatible
    changes require a new `event_schema_version` and an explicit consumer
    migration plan

## Entity Registry / Alias Reconciliation

- Governance Hub owns a durable entity registry even when Databricks/UC source
  IDs are missing, unstable, or inconsistent across sources
- the registry must:
  - mint a surrogate `entity_id` when no trustworthy source identifier exists
  - record observed Databricks or UC identifiers when they do exist
  - retain FQN aliases, prior names, and prior locations
  - track reconciliation confidence and ambiguity state
  - preserve rename/move continuity for history, tasks, glossary links,
    notifications, and future override artifacts
- reconciliation rules:
  - prefer high-confidence live source identifiers when present
  - merge aliases only when deterministic evidence exists
  - when deterministic reconciliation is unavailable, preserve prior links and
    mark the entity or column for steward review instead of silently
    reattaching state
- registry rows are the durable anchor for:
  - discovery corpus documents
  - workflow state
  - projections
  - export snapshots
  - audit and notification routing

## Canonical Entity Identity Contract

- control-plane rows must persist the Governance Hub registry `entity_id`
  regardless of whether a stable Databricks or UC source ID is available
- when the Databricks or UC runtime exposes a stable source identifier, the
  registry stores it as an observed external identity rather than replacing the
  canonical Governance Hub `entity_id`
- routes remain FQN-based for readability, but persisted rows store both
  `entity_id` and the latest `entity_fqn` snapshot
- glossary links, threads, tasks, history, quality artifacts, and future
  lineage overrides must all migrate to `entity_id + current_fqn_snapshot`
- the entity registry records:
  - current FQN
  - prior FQN aliases
  - observed external IDs
  - source system
  - reconciliation confidence
  - reconciliation status
- column identity uses `entity_id + normalized_column_name` when a stable column
  identifier is unavailable
- asset rename or move:
  - preserve history, tasks, glossary links, and approvals by registry
    `entity_id`
  - update current FQN snapshot
  - append an audit event, alias record, and reconciliation record
- column rename:
  - preserve history and glossary links only when reconciliation can prove a
    deterministic mapping
  - otherwise mark links/tasks as needing steward review instead of silently
    reattaching them

## Glossary Association Model

- use `glossary_term_links` as the normalized link table for both assets and
  columns
- required v1 fields:
  `link_id`, `term_id`, `subject_type`, `subject_fqn`, `column_name`,
  `is_primary`, `source`, `source_value`, `resolution_state`, `created_at`,
  `created_by`, `updated_at`, `updated_by`, `removed_at`, `removed_by`
- required v2 identity extension:
  - `subject_entity_id`
  - `subject_fqn_snapshot`
- allow multiple terms per asset or column
- support one optional primary link for display order only
- support column-scoped links
- do not treat freeform `glossary_term` tag values as authoritative after
  migration

Migration policy:

- scan current asset and column `glossary_term` tags
- resolve tag value to `term_id` by stable name/alias mapping
- persist resolved links with `source='uc_tag'`
- keep unresolved tag values as unresolved link rows for steward cleanup
- read path prefers `glossary_term_links`; raw tags become provenance only

Mutual exclusivity:

- term-level exclusivity is a glossary-term attribute and is enforced at write
  time, not by hiding conflicting existing links

## Glossary Parity Acceptance Criteria

- glossary import/export ships with explicit CSV templates and validation rules
- term detail includes a version diff view, not just a version list
- approved-term edits create a staged draft or `in_review` version; they do not
  silently mutate the live approved snapshot in place
- term creation, material edits, approval, rejection, and deprecation require
  explicit reviewer semantics, comment-bearing transitions where policy
  requires, and version history continuity
- deprecated terms show deprecation state, replacement guidance, and read-only
  behavior where required
- deprecating a linked term preserves historical links, makes replacement or
  no-replacement behavior explicit, and has acceptance tests for linked-asset
  behavior
- mutually exclusive term enforcement has explicit write-path tests
- term-to-asset tag propagation policy has explicit acceptance tests
- glossary owner/reviewer inheritance and explicit override behavior have
  acceptance tests
- the term assets tab supports right-rail asset preview instead of only a flat
  link list

## Glossary Reviewer Policy Contract

- glossary-level reviewer assignments are explicit link rows
- term-level reviewer assignments may:
  - inherit from the glossary
  - add reviewers
  - override the inherited set where policy allows
- `reviewer_policy_json` is not opaque by convention; its schema must declare:
  - fulfillment mode:
    - `all`
    - `any`
    - quorum count
  - whether glossary-level reviewers are inherited
  - whether term-level overrides replace or extend the inherited set
  - comment requirement on approval or rejection
- reviewer-policy fulfillment, inheritance, and override behavior must be
  tested before glossary approval flows claim parity
- reviewer policy uses a typed schema rather than opaque JSON-only conventions:
  - fulfillment mode
  - quorum count where applicable
  - inheritance mode
  - override mode
  - comment requirement
  - inactive-reviewer handling
  - no-qualified-reviewer escalation behavior
- evaluator semantics are deterministic for:
  - reviewer-set changes while a review is in flight
  - inactive or removed reviewers
  - quorum recalculation
  - glossary-level vs term-level inheritance changes

## Deleted Asset Strategy

- deleted-asset parity is not claimed in v1 under the current live-first
  architecture
- Governance Hub v1 surfaces current live assets only
- read-only deleted browsing moves into scope only after a tombstone retention
  plane exists, with explicit `deleted_at`, `deleted_from`, and read-only UI
  treatment

## Entity-Type Capability Matrix

| Entity type | Sample | Profile | Quality | Lineage | Queries | Usage | Workloads | Delivery phase |
|---|---|---|---|---|---|---|---|---|
| Table | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Parity core |
| View | Yes, read-only | No in v1 | No in v1 | Yes | Yes | Yes | Yes | Parity core |
| Materialized view | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Parity core |
| Streaming table | Limited preview only | Limited, later phase | Limited, later phase | Yes | Yes | Yes | Yes | Parity core |
| Job | No in parity core | No in parity core | No in parity core | Later | No in parity core | Later | Later | Post-parity Databricks differentiation |
| Pipeline / DLT / Lakeflow | No in parity core | Later | Later | Later | No in parity core | Later | Later | Post-parity Databricks differentiation |
| Notebook | No in parity core | No in parity core | No in parity core | Operational-context later | No in parity core | Later | Later | Post-parity Databricks differentiation |
| Dashboard | No in parity core | No in parity core | No in parity core | Later | No in parity core | Later | Later | Post-parity Databricks differentiation |
| Function | No in parity core | No in parity core | No in parity core | Later | No in parity core | No in parity core | No in parity core | Post-parity Databricks differentiation |
| Volume | No in parity core | No in parity core | No in parity core | No in parity core | No in parity core | No in parity core | Later | Post-parity Databricks differentiation |
| Registered model / ML asset | No in parity core | Later | Later | Later | No in parity core | Later | Later | Post-parity Databricks differentiation |

Rules:

- UI tabs render only for capabilities that are real for the selected entity
  type
- unsupported tabs are hidden, not shown as hollow placeholders
- capability decisions are returned by the backend, not rederived ad hoc in the
  browser
- `queries`, `usage`, and `workloads` are parity-core only when the workspace
  exposes a safe operational plane for the current actor; otherwise the app
  shows explicit capability-unavailable states or hides the tab according to
  surface policy
- non-tabular Databricks-native entities are explicit scope, not silent omission

## Workspace Capability Matrix

Bootstrap must return explicit capability flags for the current workspace and
current actor.

| Capability | Detection source | Affected surfaces | Gating rule |
|---|---|---|---|
| Per-user Databricks authorization available | Databricks Apps user-auth/OBO probe plus token freshness | security-trimmed discovery, preview, export, lineage visibility, actor-scoped metadata reads | narrow claims and return explicit unavailable or degraded states when absent |
| Governance control-plane writable | governance store health plus role | governance writes, glossary changes, tasks, overlays, quality admin | hide or disable writes with degraded explanation |
| System tables / UC inventory readable | live metadata probes | discovery, entity summary, counts, sample/profile/usage | return degraded or unavailable, not empty truth |
| Table lineage available | system lineage probes | lineage graph, lineage summary, discovery preview | hide lineage affordances or show degraded messaging |
| Column lineage available | lineage capability probe | column mode, lineage drawers, entity schema lineage | disable column mode explicitly |
| Workload / query visibility | operational-plane probe plus actor auth plus validated safe sharing path | queries, usage, workloads, preview snippets | hide or redact query/workload evidence unless OBO, a validated dynamic-view plane, or warehouse `CAN VIEW` plus downstream visibility rules are proven |
| Classification recommendation source available | classification system-table probe plus serverless/admin policy checks | Databricks classification recommendations and evidence | hide recommendation flows or restrict them to admin-safe diagnostics until eligible |
| Profile and quality run eligibility | warehouse + role + policy checks | profile tab, quality tab, run buttons | show read-only history or disable run actions |
| Export allowed | actor auth + surface policy | discovery export, detail export | hide or disable export with policy message |
| Manual lineage override support | governance write support + steward/admin role | lineage override actions | hide override affordances until eligible |
| Streaming preview eligibility | entity type + workspace probe | sample/preview tabs | show unsupported copy instead of dead tabs |

Rules:

- bootstrap capabilities are the only authority for surface gating
- the browser must not infer missing capabilities from empty payloads
- capability flags are actor-scoped and workspace-scoped

## Capability Enforcement Contract

- bootstrap capability flags are UX hints only; they are not the security
  boundary
- every mutation re-checks capability and authorization server-side per request
- every sensitive read re-checks capability and authorization server-side per
  request
- capability or role changes after bootstrap must yield truthful `403`,
  `degraded`, or `unavailable` responses rather than stale success paths
- server caches must key by actor visibility scope where capability affects the
  response shape
- hidden or disabled frontend affordances never replace server-side enforcement

## Databricks Authorization / OBO Contract

- Databricks app authorization and Databricks user authorization are separate
  runtime modes and must be detected, logged, and surfaced explicitly
- install/setup validation must probe:
  - forwarded actor identity headers
  - app service-principal reachability
  - user-authorization/OBO token presence
  - token freshness and expiry behavior
  - whether OBO reads successfully respect Unity Catalog and system-table
    permissions for the active actor
- authorization mode rules:
  - app-principal auth may power app-owned control-plane reads and writes,
    install/setup probes, admin diagnostics, and background-work execution
  - actor-scoped discovery, preview, export, lineage, sample, query, workload,
    and other permission-sensitive metadata reads prefer user authorization/OBO
    or another equivalent per-user enforcement plane
  - non-admin query, usage, and workload surfaces require one validated safe
    sharing path before the capability may turn `available`:
    - actor-scoped OBO reads
    - a validated dynamic-view plane
    - warehouse `CAN VIEW` plus the downstream data-visibility model
    - otherwise the surface stays disabled or explicitly unavailable
  - if OBO is unavailable, expired, or misconfigured, the product must narrow
    claims and return explicit unavailable or degraded states instead of
    implying per-user-trimmed truth
- fallback behavior:
  - token absence or expiry yields truthful re-auth, `401`, `403`, or degraded
    states depending on the affected surface
  - service-principal-only sessions remain read-only and may not claim
    user-authoritative visibility trimming
  - no user-facing surface may silently fall back from OBO to broad
    app-principal reads when that would widen visibility
- async-work guardrail:
  - no background work family may persist, replay, serialize, or otherwise
    retain raw OBO/user tokens outside the live request boundary
  - allowed async patterns are limited to:
    - app principal on safe shared data
    - actor-scoped pre-trimmed input universes
    - delivery-time reauthorization
    - feature disabled until a safe model exists
- audit rules:
  - audit rows capture actor identity, auth mode, and any app-principal
    execution context needed for operator traceability
  - control-plane writes never trust client-provided impersonation
- capability and auth changes after bootstrap must take effect on the next
  request, not on the next hard refresh

## Operational Data Source Contract

- Queries:
  - source: Databricks operational lineage and workload metadata, with query
    text only when the source plane exposes it safely
  - safe shared-plane contract:
    - raw query-history source existence is not sufficient
    - install/setup must validate which safe sharing path, if any, exists for
      non-admin exposure:
      - actor-scoped OBO
      - validated dynamic-view plane
      - warehouse `CAN VIEW` plus downstream data-visibility rules
    - if no safe sharing path is proven, the capability remains unavailable and
      the product may not infer a general-facing query-history surface from the
      raw source alone
  - v1 disposition:
    - observed workload/query history only
    - saved or manually-authored query objects are explicitly out of scope
      until a dedicated persistence, audit, and authorization model lands
  - default freshness window: last 30 days or source retention window,
    whichever is smaller
  - query-history caveat:
    - query-history access is preview- and admin-governed today, so the app
      must capability-gate query text and sometimes the entire surface
    - when query history is unavailable, the UI must show `not available in
      this workspace` or `not authorized`, not an empty truthful history
    - queries, usage, and workload tabs are parity-core only in workspaces
      where a safe operational plane exists; otherwise they render explicit
      capability-unavailable states or stay hidden according to surface policy
- Usage:
  - source: aggregated workload/query observations over the configured time
    window
  - default aggregation windows: 7-day and 30-day summaries
- Workloads:
  - source: jobs, pipelines, notebooks, and statement execution identifiers
    inferred from the operational lineage plane
  - retention and masking follow the same operational-plane rules as lineage
- Profile:
  - source: persisted profile snapshots plus bounded live-on-demand profile
    queries where policy and cost ceilings allow them
  - profile parity requires durable table-profile and column-profile models; it
    may not be implied by ad hoc live reads alone
- system-table tolerance rules:
  - ingestion and downstream projections must tolerate additive schema changes
    and unknown fields
  - region-, account-, metastore-, and workspace-scope columns are preserved in
    stored models where the source exposes them
  - system-table-backed surfaces must label freshness as `updated throughout
    the day` or another truthful non-real-time window when the source is not
    real-time
  - schema contract tests may reject removed or incompatible fields, but they
    must allow additive fields where the source plane documents additive
    evolution
- Lineage and workload caveats:
  - Unity Catalog lineage retention is expected to be bounded to roughly one
    year or the source-system retention window, whichever is stricter
  - lineage and workload history may age out before governance history does
  - jobs, notebooks, dashboards, and similar operational objects may appear
    only when the source plane and viewer permissions allow them
  - some workspace-object details may be masked or absent based on permissions
  - the UI must distinguish `retained but masked`, `not authorized`, `not
    collected`, and `retention expired`
  - rename or move events may break source continuity for some lineage
    histories; the UI must label `rename continuity unavailable` rather than
    implying preserved continuity
  - rolled-back source transactions may still emit lineage events; the UI must
    label `rollback observed in source lineage` when the source plane provides
    that caveat
  - some job or run references may not be linkable from the source plane; the
    UI must label `job reference unavailable` instead of implying that the job
    does not exist
  - cross-workspace or region masking must render as an explicit masking state,
    not as an empty neighbor or evidence set
  - column lineage fidelity is not universal:
    - path-based references
    - some UDF paths
    - unresolved transformations
    - source-plane truncation
    may yield incomplete or missing column mappings
  - the UI must label incomplete, partial, truncated, or unavailable column
    lineage explicitly rather than implying perfect fidelity
- permission model:
  - the UI must not leak query text, workload owner identity, or profiled values
    when the viewer lacks access
- masking:
  - sensitive query text, sample values, and profile evidence follow the data
    exposure policy
- stale rules:
  - every operational surface returns `observedAt`, `staleAfter`, and source
    provenance

## Preview Contract Matrix

| Surface | Container | Required fields | Unavailable behavior | Notes |
|---|---|---|---|---|
| Discovery result preview | Right rail | identity, source/object type, owners, tier/domain, usage/workload highlights, schema preview, lineage summary, quality/profile summary, provenance | degraded banner; no silent empty panel | preview never exceeds search authority |
| Glossary term preview | Right rail | definition, reviewers, synonyms, related terms, child-term counts, asset counts, version, provenance | degraded banner or empty-state with explicit cause | assets previewed from the term rail |
| Domain preview | Right rail | description, owners, reviewers, asset counts, data-product counts, status, provenance | degraded banner or empty-state with explicit cause | opens `/domains/:domainId` |
| Data product preview | Right rail | description, domain, owners, reviewers, asset counts, quality or contract indicators, status, provenance | degraded banner or empty-state with explicit cause | opens `/data-products/:dataProductId` |
| Classification preview | Right rail | taxonomy summary, owners, term counts, usage counts, recommendation state, provenance | degraded banner or empty-state with explicit cause | opens `/classifications/:classificationId` |
| Metric preview | Right rail or drawer | definition summary, owners, related assets, status, version, provenance | degraded banner or empty-state with explicit cause | opens `/metrics/:metricId` |
| Data contract preview | Right rail or drawer | owner, status, version, assertion counts, last run summary, provenance | degraded banner or empty-state with explicit cause | opens `/contracts/:contractId` |
| Lineage node preview | Drawer | identity, neighbors, schema summary, provenance, quality/profile summary, open actions | unavailable badge plus allowed actions only | must distinguish operational vs data lineage context |
| Task inbox item / notification target preview | Inbox tray or rail | target type, target identity, event family, actor, timestamp, reason, unread state, next action, canonical target route | degraded banner; no silent dead link | notification clicks resolve to canonical target route or explicit degraded target state |
| Inaccessible asset preview | Right rail or drawer | redacted identity only, reason, supported next action | no leaked metadata | counts may remain aggregated only |
| Degraded preview | Match parent surface | stale timestamp, warning, retry affordance, preserved layout shell | do not collapse layout | preview may show last-good data only with stale label |
| Deleted asset preview | Later phase | tombstone metadata, deleted source, read-only badge | n/a until tombstones exist | out of v1 core |

## Entity Surface Contract

Entity routes must expose first-class endpoints for:

- `/summary`
- `/schema`
- `/sample`
- `/activity`
- `/tasks`
- `/queries`
- `/usage`
- `/workloads`
- `/profile`
- `/quality`
- `/history`
- `/lineage-summary`
- `/custom-properties`

Rules:

- `queries`, `usage`, `workloads`, `profile`, and `quality` are not folded back
  into a single synthetic asset-detail blob
- `/queries` means observed history only until a dedicated saved-query model
  exists; the product may not imply OM-style manual query authoring before that
  persistence model ships
- `/profile` is real only when backed by persisted profile snapshots or an
  explicitly typed profile subtype, not only ad hoc live SQL
- `/custom-properties` is real only when backed by schema-driven definitions,
  applicability rules, assignments, audit, and version history
- version history composes `entity_versions` with audit provenance from
  `metadata_audit_log`
- share/copy-link are real actions, not decorative icons
- announcement behavior is later-phase and depends on an explicit delivery rule
- tab visibility is driven by the entity-type capability matrix, not frontend
  guesswork
- if the safe operational/query plane is unavailable, the entity surface must
  render truthful capability-unavailable states rather than an empty history or
  zero-usage implication

## Governance Entity Surface Contract

Governance breadth and scale entities are first-class product surfaces, not
opaque rows under a generic governance page.

| Entity | Canonical route | Required detail surfaces | History / activity rule |
|---|---|---|---|
| Classification taxonomy | `/classifications/:classificationId` | summary, terms, usage, recommendations, history | render `entity_versions`, reviewer decisions, and recommendation activity with provenance |
| Classification term | `/classifications/:classificationId/terms/:termId` | summary, linked assets, recommendation evidence state, history | show term versions, assignment changes, review decisions, and provenance |
| Domain | `/domains/:domainId` | summary, assets, data products, activity, history | render version history, reviewer or owner changes, and asset-membership activity |
| Data product | `/data-products/:dataProductId` | summary, assets, quality or contract signals, activity, history | render version history, reviewer changes, asset-membership activity, and related governance events |
| Metric | `/metrics/:metricId` | summary, definition, related assets, activity, history | render metric versions, approval decisions, and usage or relationship changes with provenance |
| Data contract | `/contracts/:contractId` | summary, spec sections, assertions, runs, history | render contract versions, approval decisions, run history summaries, and provenance |
| Logical column group | `/governance/columns/:groupId` | summary, grouped members, bulk actions, history | render grouping changes, steward decisions, and bulk-operation activity with provenance |

Rules:

- no breadth or scale entity may ship without:
  - canonical route
  - preview contract
  - summary surface
  - activity/history surface
  - allowed actions contract
  - provenance labels
- user-facing history for breadth/scale entities composes:
  - `entity_versions`
  - `activity_events`
  - reviewer or approval decisions
  with explicit provenance labels
- notification targets, queue rows, and related-entity links must open these
  canonical routes or a degraded preview that preserves the target identity and
  reason
- detail tabs may stay hidden until their backing plane is real, but the route
  contract and tab vocabulary must be locked before the entity claims parity

## Custom Properties Contract

- custom properties are schema-driven metadata, not freeform opaque JSON
- required models:
  - definition rows
  - version/history for definitions
  - assignment/value rows
  - applicability rules for entity kinds and columns
- validation rules are explicit:
  - scalar type
  - enum set
  - cardinality
  - nullability
  - default handling
  - coercion or rejection behavior
- audit and version rules:
  - definition edits append version history and audit rows
  - assignment edits append audit rows and current-value snapshots
- discovery and entity rules:
  - only explicitly indexed custom properties may participate in discovery
    filters, ranking, or preview
  - custom properties inherit the same provenance, stale-bound, and masking
    requirements as other metadata fields

## Profile Persistence Contract

- table profile and column profile are first-class persisted models, not only
  derived views over quality runs
- required persisted concepts:
  - profile run envelope
  - table-level metric snapshots
  - column-level metric snapshots
- minimum metric families:
  - row count
  - column count
  - null count / null percentage
  - distinct count / uniqueness ratio
  - min/max/range
  - completeness
  - freshness or observation window where applicable
- profile tabs may combine persisted snapshots with bounded live reads, but the
  persisted snapshot model is the authoritative parity surface

## Parity Surface Disposition Matrix

| Surface | v1 disposition | Claim rule |
|---|---|---|
| Rename from the app | Source-only rename in v1; Governance Hub preserves continuity through registry aliases and history | no in-app rename parity claim until a source-authoritative rename workflow exists |
| Delete from the app | Source-only delete in v1; deleted browsing remains out of scope until tombstones exist | no delete parity claim in v1 |
| Manual/saved queries | Observed workload/query history only in v1 | no OM-style `add query` parity claim until a saved-query model lands |
| `@user/team` and `#asset` mentions | Deferred from parity-core collaboration in v1 | collaboration claims stay at `workflow collaboration core` until mention support lands |
| External notifications | In-app inbox in kernel; email/webhook/chat delivery later-phase only | external notification parity is deferred until that phase lands |
| Non-tabular discovery breadth | limited to shipped entity classes in v1 | discovery parity claims stay limited to shipped entity classes until broader support is real |

## Column-Level Parity Contract

Column v2 stays in scope for:

- description edits
- tag edits
- glossary associations
- conversation threads
- tasks
- column lineage
- profile and quality signals
- wide-schema virtualization
- column-level truth checks

Rules:

- column tasks/threads are not implied by asset-level tasks
- column glossary links use the same normalized association model
- wide schemas must virtualize row rendering before deeper feature work lands
- incomplete or source-limited column lineage must render as partial or
  unavailable with truthful provenance rather than implying complete mapping

## Logical Column Grouping Contract

- column bulk operations are powered by durable logical column groups, not only
  ad hoc batch rows
- grouping requires explicit persisted models for:
  - logical group identity
  - member columns
  - steward-approved aliases or synonym handling
  - match rule or confidence
- grouping rules:
  - exact normalized column-name matching is the default starting point
  - heuristic grouping may propose candidates, but heuristic membership is not
    authoritative until it is accepted or materialized into the group model
  - steward-approved aliases may widen a group beyond exact-match naming
  - no fuzzy auto-merge may silently create authoritative bulk-governance scope
- aggregation rules:
  - cross-asset grouping must preserve source asset identity and scope
  - grouped views surface consistency gaps, not only bulk-apply actions
  - preview and detail surfaces for a logical group must show:
    - canonical group name
    - member count
    - conflicting descriptions, tags, or glossary links
    - last reviewed time
    - provenance and match rule
- logical column groups open through `/governance/columns/:groupId` and may not
  remain a hidden backend-only construct once column bulk operations claim
  parity value

## Discovery Contract

Required search capabilities:

- grouped Boolean logic with AND/OR
- field/operator/value builder
- deleted disposition explicitly marked out of scope until tombstones exist
- inaccessible assets distinguished from zero-result searches

Canonical sort matrix:

- Best match
- Recently updated
- Coverage score
- Name A-Z
- Open workflow count

Pagination contract:

- cursor-based API
- consistent totals/facets/cards/preview/export across pages
- stable URL state for search, filters, sort, cursor, and preview selection

Additional rules:

- keep hierarchy browsing as a first-class mode
- add export API with the same filters/sort/cursor scope as the visible result
- keep noisy/system-generated asset exclusion rules explicit and testable
- OM-class discovery claims apply only to shipped entity classes until broader
  entity support is implemented and proven

Noisy asset exclusion policy:

- hidden catalogs stay excluded by default
- generated/system materialization objects must be excluded by explicit filter
  rules, not by ad hoc UI hiding

## Discovery Index / Search Corpus Strategy

- discovery is hybrid, not raw-live-only:
  - live UC remains the authority plane
  - search cards/facets/cursors come from a lightweight search corpus
  - preview and entity open paths remain authoritative live reads
- refresh model:
  - bootstrap and discovery reuse the most recent valid corpus snapshot
  - mutations invalidate affected assets and facet buckets explicitly
  - reconciliation jobs or on-demand rebuilds detect corpus drift
- inaccessible assets:
  - counts may include inaccessible assets only in redacted aggregate form
  - cards and preview must not leak sensitive detail for assets the user cannot
    open
  - autocomplete, ranking, and export must not leak invisible asset identity
- corpus storage model:
  - normalized search documents keyed by
    `deployment_scope + entity_id/current_fqn_snapshot`
  - separate facet aggregates and ranking metadata
- corpus schema must include:
  - identity fields
  - browse hierarchy fields
  - governed labels and glossary links
  - ranking fields such as recency, workflow counts, and coverage inputs
  - visibility metadata required for redacted counts
- refresh ownership:
  - define the corpus builder path explicitly
  - support full rebuild and partial rebuild for touched assets
- stale-corpus behavior:
  - show stale timestamp and warning
  - do not silently treat stale counts as live truth
- ranking and relevance:
  - document weighting rules, synonym handling, and tie-breaking
  - maintain a discovery QA set with expected result rankings
- query parser contract:
  - grouped Boolean logic, field/operator/value parsing, and invalid-query
    handling must be deterministic
- export scope definition:
  - v1 export means all filtered matches in the current authenticated scope,
    not just the visible page and not widened or narrowed by preview selection
- security trimming and leakage tests:
  - aggregate count leakage
  - autocomplete leakage
  - export leakage
  - stale corpus after privilege change
  - reader vs admin search deltas
  - privilege-aware source differences between `information_schema` and other
    metadata/system tables must be covered explicitly
- exclusion rules:
  - autocomplete indexes only names, aliases, and tokens from scope-visible
    documents
  - unauthorized documents never contribute ranking, suggestion, or facet
    features; they are excluded rather than merely downranked
  - counts, facets, autocomplete, ranking, and export derive from the same
    scope-trimmed corpus snapshot
  - privilege changes must invalidate or mark stale any affected scope snapshot
    before the next user-visible search response

## Security Trim Design

- discovery uses a hybrid trimming model rather than a naive per-user full
  corpus clone
- required layers:
  - a canonical base corpus keyed by deployment scope, entity identity, and
    safe source facts
  - scope-trimmed search slices keyed by `visibility_scope_hash`
  - live permission re-checks on preview, entity open, and export delivery
- `visibility_scope_hash` rules:
  - it represents the normalized permission inputs that affect visibility for a
    search surface
  - actors with identical effective visibility may share one scope hash
  - when visibility cannot be safely collapsed to a shared scope, the system
    falls back to an actor-specific scope hash
- scope-slice budget rules:
  - each workspace declares a bounded maximum number of active shared scope
    hashes and actor-specific hashes before security-trimmed discovery is
    enabled
  - default budget unless an explicit workspace override is approved:
    - up to 256 shared scope hashes
    - up to 64 actor-specific scope hashes
    - stale TTL of 15 minutes
    - idle eviction after 60 minutes
    - materialized scope-slice storage capped at the lower of 5 GiB or 3x the
      base-corpus footprint for that workspace
  - shared scope hashes are preferred only when normalized visibility inputs
    are identical
  - actor-specific scope hashes are required when visibility depends on
    user-specific dynamic views, grants, or other inputs that cannot be safely
    collapsed
  - slices declare:
    - stale TTL
    - idle eviction policy
    - rebuild priority
    - storage budget
    - memory budget
  - rebuild priority order is:
    - interactive live search scopes
    - active export scopes
    - operator-requested refresh scopes
    - background reconciliation scopes
  - privilege-revoked or superseded slices are evicted or marked stale before
    any later user-visible result can widen scope
- leakage-prevention rules:
  - hidden entities never contribute names, aliases, facets, counts,
    autocomplete terms, ranking features, or export rows
  - autocomplete, counts, ranking, preview selection, and export scope must all
    read from the same scope-trimmed result universe
  - live preview and export delivery re-check permissions before returning the
    payload or artifact
  - if visibility is uncertain, the system excludes the document instead of
    widening scope optimistically
- privilege-change handling:
  - permission or group-membership changes invalidate affected scope hashes or
    mark them stale before the next user-visible response
  - in-flight export jobs are revalidated before artifact materialization and
    again before download
  - stale scope slices may show a warning but may not widen visibility while
    waiting for rebuild
- overload and failure fallback:
  - if scope-slice budgets are exceeded, freshness cannot be maintained
    safely, or slice rebuild correctness is uncertain, the affected workspace
    mode must fail closed
  - fail-closed behavior means:
    - disable security-trimmed discovery for that workspace mode
    - narrow claims immediately
    - fall back to live-only browse/search with reduced features where safe
    - suppress export, autocomplete, and aggregated counts until safe trimming
      recovers
  - no overload fallback may widen visibility, silently stale-serve unsafe
    counts, or revert to broad app-principal reads
- model constraints:
  - the base corpus may store non-sensitive search facts, but security-trimmed
    slices are the only source for counts, ranking, autocomplete, and export
  - preview, entity detail, and export payloads are authoritative live reads,
    not cached guesses from stale corpus rows
  - scope-slice materialization may not grow without an explicit workspace
    budget, eviction policy, and operator diagnostics for slice pressure

## Summary Read Models / Projections

Hot UI surfaces must not compute all counts live from raw workflow tables.

Required projections:

- entity hero task and thread counts
- governance queue summaries and lane counts
- glossary asset counts and reviewer counts
- open-workflow counts used by discovery sort and cards
- quality alert summaries
- homepage or governance summary metrics

Rules:

- projections are refreshed by explicit invalidation on writes and reconciliation
  on drift
- projections carry provenance and stale bounds
- projections are read models only; source mutations still go through the
  authoritative control plane

## Projection / Corpus Read-Switch Contract

- no hot surface may switch from live reads to projection- or corpus-backed
  reads until all of the following are proven:
  - initial backfill or bootstrap materialization completed
  - the relevant `projection_watermarks` or corpus watermark caught up to the
    latest required event boundary
  - measured drift is below the declared tolerance for that surface
  - read-after-write invalidation is verified
  - operator diagnostics for the projection or corpus are healthy
- cutover is surface-specific:
  - entity hero counters
  - governance queue counts
  - glossary counts
  - discovery facets and ranking
  each declare their own readiness gate before becoming projection-backed
- if a cutover gate fails after launch, the surface must:
  - fall back to live reads where safe, or
  - render degraded projection truth with stale labels and diagnostics
  but it may not silently continue as `mostly right`

## Background Work Plane

- durable asynchronous work may not depend on incidental FastAPI request
  execution
- the default durable runner is a Databricks Job or other explicitly managed
  workflow runner; the app process may only:
  - validate and enqueue work
  - perform bounded synchronous reads or writes needed for the current request
  - poll or display work status
- background-work families include:
  - discovery corpus rebuilds
  - scope-trimmed corpus refreshes
  - projection refreshes
  - reconciliation and drift detection
  - quality runs and scheduled quality health checks
  - notification fanout
  - classification recommendation ingestion
  - export materialization
  - migration rehearsal and verification probes where applicable
- required work-plane primitives:
  - durable work-item table
  - run-attempt table
  - idempotency and dedupe keys
  - retry with bounded backoff
  - lease and cancellation semantics
  - dead-letter handling
  - operator diagnostics and queue visibility
  - per-work-family cost ceilings
- execution rules:
  - request paths may not perform full corpus rebuilds, wide export generation,
    notification fanout, or scheduled quality execution inline
  - every background work family declares:
    - owner
    - trigger source
    - retry policy
    - timeout class
    - cancellation behavior
    - dead-letter threshold
    - cost ceiling
    - surfaced operator diagnostics
- portability rule:
  - the plan assumes the background work plane is installable in the target
    Databricks workspace without bespoke sidecar services outside the supported
    deployment model

## Background Work Principal Model

- every async work family declares the principal model it is allowed to use:
  - app principal
  - user-authorized/OBO request context
  - app-principal execution over a pre-trimmed actor-scoped input universe
  - disabled because no safe principal model exists yet
- principal rules by work family:
  - discovery base-corpus rebuild:
    - app principal is allowed only for safe non-sensitive source facts
  - scope-trimmed slice refresh:
    - app principal is allowed only when the slice inputs are already
      normalized and safe to share; otherwise actor-specific scope material may
      not be widened
  - async export:
    - export jobs may materialize only from an actor-scoped result universe
      captured at request time and reauthorized before artifact delivery
  - query, usage, and workload materialization:
    - app principal may not widen access to admin-only system data; dynamic
      views or another safe shared plane are required before general exposure
  - quality runs:
    - the execution principal and evidence visibility policy must be explicit
      per run family before scheduling is enabled
  - classification recommendation ingestion:
    - app principal may ingest privileged detections, but evidence remains
      redacted and operator- or steward-scoped until approval policy allows
      exposure
- no background work family may silently fall back from actor-scoped reads to a
  broader app-principal read if that would widen visibility
- raw OBO/user tokens may never be persisted, replayed, queued, or embedded in
  background-work payloads, logs, or artifacts

## Background Work Operational Contract

- every work family declares:
  - SLO
  - duplicate-suppression window
  - output retention
  - queue priority
  - starvation prevention rule
  - poison-event replay policy
  - operator acknowledgement flow for dead letters
  - manual replay tooling
- no background work family may be required for core read-path correctness if
  the app cannot truthfully explain:
  - the last successful run
  - the current staleness window
  - the current failure or backlog state when stale

## Physical Schema / DDL Appendix

Implementation-lock rules:

- no new table family begins implementation until its SQL DDL and schema
  contract tests exist
- every control-plane table declares identity columns, optimistic-locking
  column, actor/timestamp fields, retention/compaction policy, and
  application-level uniqueness rules where Delta does not enforce them
- every persisted table family declares the deployment tenancy boundary
  explicitly:
  - `deployment_scope` for the Governance Hub deployment that owns the row
  - source workspace, metastore, and account-region scope columns where the
    source fact can exceed one workspace
- every entity-bound table stores `entity_id` plus
  `entity_fqn_snapshot` where applicable
- every table that reads, stores, or fans out account-, metastore-, region-, or
  workspace-scoped facts declares the required scope columns explicitly
- system-table-backed ingestion, staging, and projection schemas must tolerate
  additive source fields and preserve unknown additive columns safely until
  downstream consumers are updated
- every corpus or projection table stores provenance, `observed_at`, and
  `stale_after`
- every migration spec records primary key, uniqueness rules, secondary
  indexes or clustering strategy, retention or compaction policy, and
  dependent surfaces before the first production use of a table
- API and UX acceptance criteria lock with the DDL; the appendix may not become
  implementation before the consuming contracts and user-facing truth rules are
  explicit
- phase ownership is explicit:
  - kernel tables cannot smuggle breadth or scale scope into earlier phases
    beyond nullable forward-compatible columns
  - breadth and scale tables cannot become hidden prerequisites for kernel,
    Discovery v2, or Entity v2 exits

### Platform Core Tables

| Table | Required columns | Notes |
|---|---|---|
| `metadata_audit_log` | `audit_id`, `entity_id`, `entity_fqn_snapshot`, `operation_family`, `operation_type`, `actor_entry_id`, `auth_mode`, `request_id`, `payload_json`, `created_at` | Immutable compliance-grade audit ledger |
| `schema_migrations` | `version`, `applied_at`, `applied_by`, `artifact_version`, `notes` | Migration ledger and branch-state proof anchor |
| `entities` | `entity_id`, `entity_kind`, `source_system`, `source_entity_id`, `current_fqn_snapshot`, `display_name`, `canonical_status`, `reconciliation_confidence`, `reconciliation_status`, `first_seen_at`, `last_seen_at`, `updated_at` | Canonical entity registry; Governance Hub may mint `entity_id` even when source IDs are absent |
| `entity_aliases` | `alias_id`, `entity_id`, `alias_type`, `alias_value`, `source_system`, `is_current`, `confidence`, `observed_at`, `updated_at` | Tracks FQN aliases, prior names, observed external IDs, and location history |
| `entity_relationships` | `relationship_id`, `from_entity_id`, `to_entity_id`, `relationship_type`, `source`, `payload_json`, `observed_at`, `updated_at`, `removed_at` | Generic relationship core for extensibility; hot-path entity families may still project specialized relationship tables |
| `entity_versions` | `entity_version_id`, `entity_id`, `version_kind`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at` | Generic version/history scaffold for entity resources |
| `change_events` | `change_event_id`, `entity_id`, `event_family`, `event_schema_version`, `source`, `payload_json`, `actor_entry_id`, `request_id`, `created_at` | Append-only change stream for projections, notifications, exports, and operator diagnostics |
| `change_event_consumers` | `consumer_key`, `consumer_family`, `owner_entry_id`, `supported_event_families_json`, `delivery_semantics`, `schema_compatibility_policy`, `poison_ack_policy_json`, `created_at`, `updated_at` | Consumer registry and compatibility contract for `change_events` |
| `change_event_consumer_offsets` | `consumer_key`, `scope_key`, `last_change_event_id`, `last_change_event_at`, `replay_cursor_json`, `dedupe_window_key`, `poison_state`, `last_succeeded_at`, `last_failed_at`, `updated_at` | Per-consumer watermark, replay, and poison-event tracking |
| `projection_watermarks` | `projection_key`, `scope_key`, `last_change_event_id`, `last_rebuilt_at`, `stale_after`, `updated_at` | Projection rebuild checkpoints and staleness truth |
| `capability_probe_runs` | `probe_run_id`, `workspace_scope`, `probe_family`, `auth_mode`, `outcome`, `summary_json`, `observed_at`, `created_at` | Setup/diagnostic history for capability probes |

### Background Work / Export / Rollout Tables

| Table | Required columns | Notes |
|---|---|---|
| `background_work_items` | `work_item_id`, `workspace_scope`, `metastore_scope`, `visibility_scope_hash`, `work_type`, `principal_mode`, `dedupe_key`, `payload_json`, `requested_by_entry_id`, `priority`, `status`, `scheduled_for`, `retention_until`, `created_at`, `updated_at` | Durable queued work with explicit scope and execution-principal contract; `work_type + dedupe_key + status(active)` must prevent duplicate active work |
| `background_work_runs` | `work_run_id`, `work_item_id`, `runner_type`, `runner_principal_mode`, `job_run_id`, `attempt`, `lease_expires_at`, `started_at`, `finished_at`, `outcome`, `cost_json`, `error_json` | Attempt history, cancellation, retries, operator visibility, and principal traceability |
| `background_dead_letters` | `dead_letter_id`, `work_item_id`, `last_run_id`, `failure_class`, `payload_json`, `created_at`, `resolved_at`, `resolved_by_entry_id` | Terminal failures and remediation tracking |
| `export_jobs` | `export_job_id`, `workspace_scope`, `scope_hash`, `requested_by_entry_id`, `delivery_principal_mode`, `export_type`, `filter_snapshot_json`, `status`, `row_limit`, `redaction_policy_json`, `artifact_uri`, `artifact_size_bytes`, `artifact_checksum`, `materialized_at`, `revoked_at`, `expires_at`, `created_at`, `updated_at` | Async export materialization and delivery contract with revocation and artifact-integrity proof |
| `feature_flags` | `flag_key`, `flag_type`, `description`, `owner_entry_id`, `default_state`, `rollout_json`, `expires_at`, `removal_ticket`, `updated_at` | Partial-route migrations, kill switches, and risky-phase rollout controls |

### Metadata Extension Tables

| Table | Required columns | Notes |
|---|---|---|
| `custom_property_definitions` | `definition_id`, `name`, `display_name`, `description`, `data_type`, `cardinality`, `allowed_values_json`, `default_value_json`, `applies_to_json`, `validation_json`, `status`, `expected_version`, `created_at`, `updated_at` | Schema-driven custom-property definitions and applicability rules |
| `custom_property_definition_versions` | `definition_version_id`, `definition_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Version history for custom-property definitions |
| `custom_property_assignments` | `assignment_id`, `definition_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `value_json`, `coercion_state`, `created_at`, `updated_at`, `removed_at` | Entity- and column-scoped assignments with validation/coercion outcome tracking |

### Governance Kernel Tables

| Table | Required columns | Notes |
|---|---|---|
| `identity_directory_entries` | `entry_id`, `external_key`, `principal_type`, `display_name`, `email`, `is_active`, `source`, `attributes_json`, `synced_at`, `updated_at` | Users and groups share one directory surface; `external_key + source` must be unique |
| `identity_directory_memberships` | `membership_id`, `parent_entry_id`, `child_entry_id`, `membership_role`, `source`, `synced_at`, `updated_at` | Team/group inheritance and pickers; `parent_entry_id + child_entry_id + membership_role` must be unique |
| `data_owners` | `owner_link_id`, `entity_id`, `entity_fqn_snapshot`, `owner_entry_id`, `owner_role`, `is_primary`, `source`, `created_at`, `updated_at`, `removed_at` | Explicit owner-link model backing the owners authority plane |
| `glossaries` | `glossary_id`, `name`, `display_name`, `description`, `owner_entry_id`, `reviewer_policy_json`, `status`, `created_at`, `updated_at` | Top-level glossary resource required before term rows can be schema-complete |
| `glossary_reviewer_links` | `reviewer_link_id`, `glossary_id`, `term_id`, `reviewer_entry_id`, `reviewer_role`, `inherits_from_glossary`, `created_at`, `updated_at`, `removed_at` | Explicit glossary-level and term-level reviewer assignments plus inheritance overrides |
| `glossary_terms` | `term_id`, `glossary_id`, `parent_term_id`, `name`, `display_name`, `definition`, `status`, `owner_entry_id`, `reviewer_policy_json`, `mutually_exclusive`, `tags_json`, `references_json`, `related_terms_json`, `synonyms_json`, `version`, `created_at`, `updated_at` | Kernel requires identity, hierarchy, definition, reviewer policy, and versioning; `mutually_exclusive`, `tags_json`, `references_json`, `related_terms_json`, and `synonyms_json` are breadth-extension fields gated to phase 16 |
| `glossary_term_versions` | `term_version_id`, `term_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Diffable version history |
| `glossary_term_links` | `link_id`, `term_id`, `subject_type`, `subject_entity_id`, `subject_fqn_snapshot`, `column_name`, `is_primary`, `source`, `source_value`, `resolution_state`, `created_at`, `created_by`, `updated_at`, `updated_by`, `removed_at`, `removed_by` | Normalized asset/column links; active-link uniqueness must be enforced per `term_id + subject_entity_id + column_name + removed_at IS NULL` |
| `threads` | `thread_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `thread_type`, `status`, `created_by_entry_id`, `created_at`, `updated_at` | Task-linked and conversation-only threads; index `entity_id + column_name + status` |
| `thread_posts` | `post_id`, `thread_id`, `body_markdown`, `diff_json`, `created_by_entry_id`, `created_at`, `edited_at` | Comment stream and edit flow; retention/compaction policy must preserve audit fidelity |
| `tasks` | `task_id`, `thread_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `task_type`, `diff_before_json`, `diff_after_json`, `requested_payload_json`, `due_at`, `status`, `resolution_code`, `resolved_payload_json`, `expected_version`, `created_at`, `updated_at` | Description/tag/glossary review tasks with accept/edit flows; assignment multiplicity lives in link tables rather than only on the task row |
| `task_assignees` | `task_assignee_id`, `task_id`, `entry_id`, `assignee_type`, `created_at`, `updated_at`, `removed_at` | Multi-assignee task model for users and teams |
| `task_reviewers` | `task_reviewer_id`, `task_id`, `entry_id`, `reviewer_type`, `created_at`, `updated_at`, `removed_at` | Multi-reviewer task model and policy fulfillment anchor |
| `activity_events` | `event_id`, `change_event_id`, `event_type`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `actor_entry_id`, `thread_id`, `task_id`, `payload_json`, `created_at` | Derived user-facing activity feed projection, not a second independently-authored source of truth |
| `notifications` | `notification_id`, `event_id`, `channel`, `delivery_state`, `payload_json`, `created_at`, `sent_at`, `failed_at`, `retry_count` | Delivery attempts; `event_id + channel` must be idempotent where fanout is retried |
| `notification_receipts` | `notification_id`, `recipient_entry_id`, `inbox_state`, `seen_at`, `read_at`, `dismissed_at`, `delivered_at` | Read/unread and badge state; `notification_id + recipient_entry_id` must be unique and indexed for unread counts |
| `notification_preferences` | `entry_id`, `event_family`, `channel`, `muted_until`, `scope_json`, `updated_at` | Suppression and preferences |

### Governance Breadth Tables

| Table | Required columns | Notes |
|---|---|---|
| `classifications` | `classification_id`, `name`, `description`, `owner_entry_id`, `status`, `source`, `created_at`, `updated_at` | Taxonomy roots |
| `classification_versions` | `classification_version_id`, `classification_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Version history for taxonomy-level edits |
| `classification_terms` | `classification_term_id`, `classification_id`, `parent_term_id`, `name`, `display_name`, `description`, `sensitivity_rank`, `recommendation_source`, `status`, `version`, `created_at`, `updated_at` | Supports Databricks-derived recommendations plus manual approval |
| `classification_term_versions` | `classification_term_version_id`, `classification_term_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Reviewable version history for taxonomy terms |
| `classification_assignments` | `assignment_id`, `classification_term_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `source`, `status`, `created_at`, `updated_at`, `removed_at` | Explicit classification assignment truth for assets and columns |
| `classification_recommendations` | `recommendation_id`, `classification_term_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `source`, `evidence_redaction_state`, `evidence_json`, `status`, `created_at`, `updated_at` | Privileged recommendation rows; evidence stays redacted by default |
| `classification_recommendation_reviews` | `review_id`, `recommendation_id`, `reviewer_entry_id`, `decision`, `comment`, `created_at` | Acceptance or rejection history for recommendations |
| `domains` | `domain_id`, `name`, `description`, `owner_entry_id`, `reviewer_entry_id`, `status`, `source`, `created_at`, `updated_at` | Governed entity, not just a UC tag |
| `domain_versions` | `domain_version_id`, `domain_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Versioned change context for domains |
| `domain_asset_links` | `domain_asset_link_id`, `domain_id`, `entity_id`, `entity_fqn_snapshot`, `created_at`, `updated_at`, `removed_at` | Domain membership and browse grouping |
| `data_products` | `data_product_id`, `domain_id`, `name`, `description`, `owner_entry_id`, `reviewer_entry_id`, `lifecycle_state`, `source`, `created_at`, `updated_at` | Governed entity with collections |
| `data_product_versions` | `data_product_version_id`, `data_product_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Versioned change context for data products |
| `data_product_asset_links` | `data_product_asset_link_id`, `data_product_id`, `entity_id`, `entity_fqn_snapshot`, `created_at`, `updated_at`, `removed_at` | Data-product membership and browse grouping |
| `logical_column_groups` | `group_id`, `canonical_name`, `display_name`, `match_rule`, `scope_json`, `status`, `created_by_entry_id`, `created_at`, `updated_at` | Durable logical-column grouping key for bulk governance surfaces |
| `logical_column_group_members` | `group_member_id`, `group_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `membership_source`, `confidence`, `created_at`, `updated_at`, `removed_at` | Steward-approved or heuristically proposed group membership; authoritative bulk scope comes from active members only |
| `governance_bulk_batches` | `batch_id`, `batch_type`, `created_by_entry_id`, `scope_json`, `status`, `created_at`, `updated_at` | Phase 16 launches batch types needed for column bulk operations; later phases expand allowed batch families |
| `governance_bulk_items` | `batch_item_id`, `batch_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `requested_payload_json`, `status`, `resolution_json`, `updated_at` | Bulk review and apply items; unique active item rule must be enforced per `batch_id + entity_id + column_name` |

### Discovery Corpus and Projection Tables

| Table | Required columns | Notes |
|---|---|---|
| `discovery_documents` | `document_id`, `entity_id`, `current_fqn_snapshot`, `entity_type`, `title`, `catalog`, `schema_name`, `tags_json`, `glossary_terms_json`, `workflow_counts_json`, `ranking_features_json`, `observed_at`, `stale_after`, `updated_at` | Canonical base corpus row; one row per entity/source snapshot |
| `discovery_scope_documents` | `scope_hash`, `entity_id`, `search_tokens_json`, `suggest_terms_json`, `ranking_weight`, `observed_at`, `stale_after`, `updated_at` | Scope-trimmed visibility slice; `scope_hash + entity_id` must be unique |
| `discovery_facet_aggregates` | `facet_key`, `facet_value`, `scope_hash`, `count`, `observed_at`, `stale_after`, `updated_at` | Scope-trimmed counts; keyed by `facet_key + facet_value + scope_hash` |
| `discovery_autocomplete_terms` | `term`, `scope_hash`, `weight`, `entity_id`, `observed_at`, `stale_after`, `updated_at` | Autocomplete without leakage; keyed by `term + scope_hash + entity_id` |
| `entity_summary_projection` | `entity_id`, `entity_fqn_snapshot`, `task_count`, `thread_count`, `lineage_summary_json`, `quality_summary_json`, `observed_at`, `stale_after`, `updated_at` | Mandatory input for hero counters, lineage summary chips, and quality badges |
| `governance_queue_projection` | `scope_key`, `lane_counts_json`, `open_task_count`, `observed_at`, `stale_after`, `updated_at` | Mandatory input for governance queue lanes |
| `glossary_summary_projection` | `term_id`, `asset_count`, `child_count`, `reviewer_count`, `observed_at`, `stale_after`, `updated_at` | Mandatory input for glossary browser counts and term preview |
| `quality_alert_projection` | `entity_id`, `entity_fqn_snapshot`, `open_alert_count`, `failing_test_count`, `observed_at`, `stale_after`, `updated_at` | Mandatory input for alert rollups and entity quality summaries |
| `homepage_summary_projection` | `scope_key`, `metrics_json`, `observed_at`, `stale_after`, `updated_at` | Top-level metrics |

### Lineage Tables

| Table | Required columns | Notes |
|---|---|---|
| `lineage_overrides` | `override_id`, `entity_id`, `entity_fqn_snapshot`, `source_entity_id`, `target_entity_id`, `operation_type`, `annotation`, `diff_json`, `status`, `submitted_by_entry_id`, `approved_by_entry_id`, `active_from`, `active_to`, `expected_version`, `created_at`, `updated_at` | Table-level override lifecycle |
| `lineage_override_column_mappings` | `mapping_id`, `override_id`, `source_column_name`, `target_column_name`, `provenance_json`, `conflict_state`, `created_at`, `updated_at` | Column parity for overrides; unique mapping rule must be enforced per `override_id + source_column_name + target_column_name` |
| `lineage_override_approvals` | `approval_id`, `override_id`, `actor_entry_id`, `decision`, `comment`, `created_at` | Approval history |

### Quality Tables

| Table | Required columns | Notes |
|---|---|---|
| `quality_test_definitions` | `definition_id`, `name`, `display_name`, `description`, `definition_type`, `sql_template`, `parameter_schema_json`, `result_schema_json`, `default_severity`, `status`, `owner_entry_id`, `expected_version`, `created_at`, `updated_at` | Persisted reusable quality test library entry |
| `quality_test_definition_versions` | `definition_version_id`, `definition_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Version history for reusable quality definitions |
| `profile_runs` | `profile_run_id`, `entity_id`, `entity_fqn_snapshot`, `triggered_by_entry_id`, `trigger_type`, `execution_state`, `observed_at`, `started_at`, `finished_at`, `cost_json`, `statement_ids_json`, `stale_after` | Durable envelope for table and column profile collection |
| `profile_table_metrics` | `profile_table_metric_id`, `profile_run_id`, `entity_id`, `metric_family`, `metric_value_json`, `observed_at`, `created_at` | Persisted table-profile metric snapshots |
| `profile_column_metrics` | `profile_column_metric_id`, `profile_run_id`, `entity_id`, `column_name`, `metric_family`, `metric_value_json`, `redaction_state`, `observed_at`, `created_at` | Persisted column-profile metric snapshots |
| `quality_suites` | `suite_id`, `entity_id`, `entity_fqn_snapshot`, `scope_type`, `name`, `description`, `owner_entry_id`, `created_at`, `updated_at` | Suite/group container |
| `quality_test_cases` | `test_case_id`, `suite_id`, `definition_id`, `entity_id`, `entity_fqn_snapshot`, `column_name`, `params_json`, `threshold_json`, `severity`, `enabled`, `expected_version`, `created_at`, `updated_at` | Parameterized applications of reusable test definitions; natural-key uniqueness must be defined per suite/entity/column/definition |
| `quality_runs` | `run_id`, `suite_id`, `entity_id`, `entity_fqn_snapshot`, `triggered_by_entry_id`, `trigger_type`, `execution_state`, `observed_at`, `started_at`, `finished_at`, `cost_json`, `statement_ids_json`, `stale_after` | Execution envelope |
| `quality_run_results` | `result_id`, `run_id`, `test_case_id`, `entity_id`, `column_name`, `status`, `metric_value_json`, `evidence_json`, `redaction_state`, `created_at` | Renderable quality results; profile persistence lives in the dedicated `profile_*` tables rather than as an implicit subtype only |
| `quality_alerts` | `alert_id`, `entity_id`, `entity_fqn_snapshot`, `test_case_id`, `run_id`, `severity`, `status`, `dedupe_key`, `opened_at`, `acknowledged_at`, `resolved_at`, `actor_entry_id` | Alert state machine; active-alert dedupe key must be unique among open alerts |

### Governance Scale Tables

| Table | Required columns | Notes |
|---|---|---|
| `governance_metrics` | `metric_id`, `name`, `description`, `domain_id`, `data_product_id`, `owner_entry_id`, `definition_json`, `status`, `expected_version`, `created_at`, `updated_at` | Governed metrics catalog |
| `governance_metric_versions` | `metric_version_id`, `metric_id`, `version`, `snapshot_json`, `diff_json`, `changed_by_entry_id`, `changed_at`, `change_note` | Versioned metric definitions |
| `data_contracts` | `contract_id`, `entity_id`, `entity_fqn_snapshot`, `name`, `status`, `owner_entry_id`, `reviewer_entry_id`, `expected_version`, `created_at`, `updated_at` | Contract header and approval state |
| `data_contract_versions` | `contract_version_id`, `contract_id`, `version`, `spec_json`, `diff_json`, `change_note`, `created_by_entry_id`, `created_at` | Versioned contract specs |
| `data_contract_assertions` | `assertion_id`, `contract_id`, `entity_id`, `column_name`, `assertion_type`, `params_json`, `severity`, `created_at`, `updated_at` | Assertions and compatibility checks |
| `data_contract_runs` | `contract_run_id`, `contract_id`, `entity_id`, `entity_fqn_snapshot`, `trigger_type`, `triggered_by_entry_id`, `status`, `observed_at`, `started_at`, `finished_at`, `created_at` | Contract execution history and replayable validation context |
| `data_contract_results` | `contract_result_id`, `contract_run_id`, `assertion_id`, `status`, `evidence_json`, `redaction_state`, `created_at` | Renderable contract validation results with redaction semantics |

### Required keys, retention, and dependency rules

- directory tables:
  - retain inactive and renamed identities for audit continuity
  - never hard-delete identities that still appear in tasks, threads, history,
    approvals, or notifications
- workflow tables:
  - `threads`, `thread_posts`, `tasks`, `task_assignees`, `task_reviewers`,
    `activity_events`, and notification tables index by entity and actor paths
    needed for entity history, queue views, and inbox surfaces
  - retention may compact payload bodies only when audit fidelity remains
- platform-core tables:
  - `entities` plus `entity_aliases` are the durable rename-safe registry
    anchor for typed extension tables
  - `change_events` is the canonical fanout source for projections,
    notifications, and other background consumers
  - `metadata_audit_log` remains the immutable compliance ledger; consumers may
    not substitute `activity_events` or notifications for audit truth
- metadata extension tables:
  - custom-property definitions and assignments preserve schema-driven
    validation, version history, and audit continuity
- corpus/projection tables:
  - `entity_summary_projection` is the required read model for entity hero
    workflow counters
  - `governance_queue_projection` is the required read model for governance
    queue lanes
  - `glossary_summary_projection` is the required read model for glossary
    browser counts and term-preview counts
  - `quality_alert_projection` is the required read model for entity alert
    badges and summary chips
- quality tables:
  - `quality_test_definitions` and
    `quality_test_definition_versions` are the durable reusable-test library
    contract; test cases may not collapse the library into per-asset rows
  - `profile_runs`, `profile_table_metrics`, and `profile_column_metrics` are
    the durable profile-snapshot contract for the profile tab
  - `quality_runs` and `quality_run_results` define retention/compaction and
    evidence redaction policy before first production run
- governance breadth tables:
  - `logical_column_groups` and `logical_column_group_members` are the durable
    grouping contract for column bulk operations and inconsistency review
- background-work and export tables:
  - export artifacts expire and require download re-authorization
  - work items, runs, and dead letters must preserve enough payload context for
    operator diagnosis without leaking protected evidence
  - consumer offsets, watermarks, and dead-letter state are required before a
    `change_events` consumer can be considered production-ready
- governance scale tables:
  - metric and contract version tables preserve history; current rows cannot
    overwrite prior approved snapshots in place

## No-Synthetic Degraded State Rule

- if UC is unavailable, return `unavailable` with provenance and warnings
- if the governance plane is unavailable, return `degraded` with provenance and
  warnings
- do not return empty backlog, glossary, owner, task, or workflow state as
  though it is truthful when the authority plane is down
- do not derive posture gaps into real tasks or workflow counters

## Degraded-State UX Contract

- degraded or unavailable sections show banners, not silent empty content
- writes are disabled with a reason when the write authority plane is degraded
- retry affordances are explicit
- stale timestamps are always visible
- preview rails, cards, and drawers never silently omit unavailable metadata as
  though it never existed
- degraded sections preserve layout density and do not collapse the page into a
  broken shell

## Source-of-Truth / Route / Deploy Contract

### Route serving

- FastAPI serves the SPA shell for all non-API, non-static client routes
- direct open, refresh, and back/forward must work for canonical routes
- old query-param URLs remain readable during migration and are canonicalized by
  the client until the React Router migration is complete

### Canonical routes

- `/discovery`
- `/entity/:fqn`
- `/lineage/:fqn`
- `/governance`
- `/classifications`
- `/classifications/:classificationId`
- `/classifications/:classificationId/terms/:termId`
- `/domains`
- `/domains/:domainId`
- `/data-products`
- `/data-products/:dataProductId`
- `/metrics`
- `/metrics/:metricId`
- `/contracts`
- `/contracts/:contractId`
- `/governance/columns/:groupId`
- `/glossary/:glossaryId`
- `/glossary/:glossaryId/terms/:termId`

Rules:

- breadth and scale routes are declared now to lock the information
  architecture even when the backing surfaces land in later phases
- no governance-breadth or governance-scale entity may remain reachable only
  through a generic `/governance` list or modal once its phase claims are
  expanded
- inbox items, notifications, and right-rail actions must resolve to one
  canonical target route or an explicitly degraded target preview; they may not
  invent ad hoc destination patterns per surface

### Config injection

- no personal emails in repo defaults
- no production catalog/schema defaults in source
- deployment targets inject catalog/schema/admin config explicitly
- OpenMetadata env/config is removed permanently
- the no-legacy/no-OM grep gate applies to runtime, config, packaging, and
  deploy materials only
- QA benchmark packs, screenshot comparisons, and reference materials may still
  mention OpenMetadata explicitly as comparison input

### Identity source

- actor identity comes from Databricks App forwarded user identity headers
- absent user identity means read-only mode
- mutation endpoints require a real actor identity and a non-reader role
- service-principal-only sessions are read-only unless an explicit future policy
  is introduced
- app-principal and user-authorized/OBO execution modes are logged and surfaced
  explicitly in diagnostics; the app may not silently widen visibility by
  falling back from user authorization to broad app-principal reads

### Cache scope

- cache keys must encode payload type, visibility scope, asset/route identity,
  and authority plane
- permission denied, not found, timeout, and unavailable are distinct cache
  states
- mutations invalidate all dependent read models explicitly

### Packaging

- frontend is built in CI or predeploy packaging only
- `frontend/dist` is never tracked
- packaged bundle excludes `.git`, `.github`, `.databricks`, `.vscode`,
  `__MACOSX`, `.DS_Store`, `.venv`, `node_modules`, `__pycache__`, test caches,
  and removed legacy folders

## Bootstrap v2 Contract

- bootstrap is a shell and capability contract, not a hidden page-data API
- bootstrap may include only:
  - shell identity and actor context
  - role and workspace capability flags
  - build ID and safe diagnostics metadata
  - canonical route hints and API contract hints
  - feature-flag inventory needed to render the shell truthfully
  - bounded first-render defaults that are explicitly safe and lightweight
- bootstrap may not become the transport for:
  - heavy discovery result sets
  - governance summaries
  - seeded lineage graphs
  - quality/profile evidence
  - request-scoped runtime data that would make the payload non-shareable
  - large live counts that violate the bootstrap budget
- if a surface needs first-render seed data beyond the shell contract, that
  seed must be explicitly justified, bounded, removable, and separately tested
  against the bootstrap budget

## Install / Setup Wizard

- first-run setup must validate the workspace before the product claims any
  capability it cannot actually sustain
- required checks:
  - governance catalog/schema existence and write reachability
  - warehouse selection and usability
  - app service-principal permissions
  - Databricks user authorization/OBO availability
  - Unity Catalog inventory and lineage readability
  - operational-plane/query-history availability where claimed
  - validated safe sharing path for non-admin query, usage, and workload
    surfaces:
    - actor-scoped OBO
    - validated dynamic-view plane
    - warehouse `CAN VIEW` plus downstream visibility rules
    - or explicit disable
  - background work runner availability
  - export staging and artifact-delivery prerequisites
  - transaction eligibility probe
  - classification recommendation source eligibility, including serverless and
    admin restrictions, when that feature is enabled
- each check returns:
  - status
  - evidence summary
  - remediation hint
  - last-checked timestamp
  - operator-safe diagnostics only
- failed checks do not block the whole app unless the affected phase requires
  them, but they must narrow claims and gate dependent surfaces immediately
- the setup wizard must be rerunnable after remediation and must not require
  code edits to refresh capability status

## Admin Diagnostics and Remediation

- the app exposes an operator-safe diagnostics page for admins and stewards
- required diagnostics coverage:
  - current auth mode and OBO status
  - workspace capability probe results
  - validated operational sharing path or explicit absence for non-admin query
    and workload surfaces
  - governance store health
  - background work queue depth, failures, retries, and dead letters
  - corpus freshness and invalidation status
  - export backlog and expiry status
  - lineage/query/classification source health
  - transaction mode currently in use
  - remediation steps for failed checks
- diagnostics must show truthful degraded reasons without exposing secrets,
  tokens, or protected evidence values
- diagnostics may surface build ID, request IDs, and recent probe timestamps,
  but not raw credential material

## Audit Log Product Surface

- `metadata_audit_log` is not storage-only forever; post-parity admin and
  compliance workflows require a real audit surface
- planned surface capabilities:
  - browser with filtering by actor, entity, operation family, and time window
  - retention and export visibility
  - operator-safe export/report generation
  - provenance labels that distinguish audit rows from activity feed entries
- audit-log browsing/export is not parity-core, but it is required before
  enterprise auditability claims expand beyond storage semantics alone

## Feature Flag / Rollout Model

- partially rebuilt routes, risky migrations, async exports, and other
  high-risk phases must ship behind explicit rollout controls when needed
- required flag families:
  - route migration flags
  - feature exposure flags
  - kill switches
  - adapter retirement flags
  - workspace allowlist flags, only when unavoidable and time-bounded
- every flag declares:
  - owner
  - rationale
  - default state
  - rollout policy
  - expiry date
  - removal ticket
  - rollback behavior
- flags may narrow exposure, but they may not excuse synthetic data or broken
  truth contracts on the surfaces that remain enabled
- no long-lived hidden feature may survive without a dated removal or decision
  point in the plan

## Frontend Data Layer Contract

- canonical navigation uses `react-router-dom`
- server state uses TanStack Query only
- local component state and router state remain local; they do not become
  browser-owned shadow copies of server truth
- every fetch is abortable through `AbortController`
- `frontend/src/lib/api.js` must preserve raw payload shapes while supporting
  abort signals and correlation headers
- hook-owned canonical Maps, in-flight registries, and event buses in
  `useAssetDetail`, `useLineage`, `useDiscoveryResults`, and related hooks must
  be retired from hot paths
- query keys and invalidation rules must align with the metadata authority
  matrix
- request cancellation must not break shared consumers; no shared-request
  cancellation scheme may be introduced without ownership and dedupe rules

## Design System / Shell Phase

- replace `frontend/src/styles/app.css`
- establish tokens for spacing, typography, borders, semantic colors, focus,
  hover, pressed, disabled, and degraded states
- rebuild shell, header, nav, hero, tabs, drawers, side rails, loading, empty,
  and error states before Discovery v2 and Entity v2 ship
- define responsive breakpoints, density rules, and route-level skeleton
  patterns
- accessibility, contrast, reduced-motion, and focus behavior are part of the
  design-system contract, not end-phase polish
- shell primitives stay data-shape-agnostic; they do not take durable
  dependencies on provisional surface-specific payload contracts

## Identity and RBAC Contract

Roles:

- `reader`
- `writer`
- `steward`
- `admin`

Rules:

- reads are allowed to all visible users
- metadata edits require `writer`, `steward`, or `admin`
- glossary approvals, lineage overrides, and quality administration require
  `steward` or `admin`
- every mutation persists actor identity into audit rows
- impersonation is not trusted from arbitrary client input
- parity-core ships with these four global roles, but governance breadth and
  scale must plan for scoped stewardship and approval grants rather than
  relying on global roles forever
- likely phase-16+ scoped permission families include:
  - domain stewardship
  - data-product review
  - glossary review
  - classification stewardship
  - contract approval
  - export approval
  - quality administration

## Identity Directory Contract

- define the authoritative directory source for:
  - users
  - teams/groups
  - owner pickers
  - reviewer pickers
  - assignee pickers
- selector APIs return:
  - stable identity key
  - display name
  - email when applicable
  - active/inactive state
  - team vs individual type
- inheritance rules are explicit for:
  - glossary to term owner and reviewer defaults
  - future domain/data-product ownership inheritance where applicable
- inactive or renamed identities:
  - remain visible historically
  - are marked inactive in selectors and audit/history
  - do not silently disappear from workflow records
- team ownership and individual ownership are both first-class; UI must not
  collapse them into plain email strings

## Workflow State Machines

### Tasks

- states:
  - `open`
  - `acknowledged`
  - `in_progress`
  - `blocked`
  - `resolved`
  - `closed`
  - `rejected`
- transitions:
  - writers can create and comment
  - stewards/admins can reassign, close, reject, or reopen
  - assignee changes and terminal transitions create audit rows
- due dates, assignees, and blockers are first-class fields
- tasks support multiple assignees and multiple reviewers through explicit link
  tables; any singular fields on the task row are summary or convenience
  mirrors, not the only source of workflow participation truth
- task types at minimum:
  - description change
  - tag change
  - glossary link change
  - column description change
  - column tag change
- request tasks are thread-linked workflows, not isolated tickets:
  - every task links to a backing thread
  - every task stores requested diff and accepted diff
  - assignee sets can accept as requested, edit then accept, or reject with
    comment according to the reviewer policy
  - comments and acceptance edits append to the same thread history

### Glossary terms

- states:
  - `draft`
  - `in_review`
  - `approved`
  - `rejected`
  - `deprecated`
- reviewer approval/rejection requires a comment
- approved-term edits create a new staged version for review; they do not
  overwrite the last approved snapshot in place
- deprecating a term with linked assets requires explicit replacement or
  no-replacement handling and a visible history entry
- state changes append version history and audit entries automatically
- glossary-level and term-level reviewer assignments are explicit rows, not
  only opaque JSON
- reviewer inheritance, override, and quorum or approval-mode fulfillment must
  be modeled explicitly and tested

### Classification taxonomies and terms

- taxonomy roots:
  - `draft`
  - `active`
  - `deprecated`
  - `archived`
- taxonomy terms:
  - `draft`
  - `in_review`
  - `approved`
  - `rejected`
  - `deprecated`
- material taxonomy or term edits append version history, audit rows, and
  activity events
- recommendation accept or reject decisions append review history with actor,
  comment, evidence state, and resulting metadata effect
- reviewer or steward semantics must be explicit before classification
  browse/detail surfaces claim parity breadth

### Domains and data products

- lifecycle states:
  - `draft`
  - `in_review`
  - `active`
  - `deprecated`
  - `archived`
- owner, reviewer, asset-membership, and state changes append version and
  activity history automatically
- material edits do not silently overwrite the last approved snapshot in place
- previews and detail surfaces render owner, reviewer, membership counts,
  history, and provenance as first-class workflow state

### Metrics

- states:
  - `draft`
  - `in_review`
  - `approved`
  - `deprecated`
  - `superseded`
- metric version promotion requires reviewer approval semantics and preserves
  prior approved definitions
- metric detail and history surfaces render definition changes, related assets,
  owner or reviewer changes, and provenance

### Data contracts

- states:
  - `draft`
  - `in_review`
  - `approved`
  - `active`
  - `superseded`
  - `deprecated`
- contract versions preserve:
  - schema section
  - semantic section
  - quality section
  - SLA or expectation section
- contract approval, activation, supersession, and deprecation append version,
  audit, and activity history automatically
- contract run outcomes render as execution history tied to the active or
  historical contract version; they do not silently mutate contract state

### Lineage overrides

- states:
  - `draft`
  - `pending_approval`
  - `approved`
  - `active`
  - `rejected`
  - `deactivated`
- only stewards/admins can approve, reject, activate, or deactivate
- every transition is auditable and visible on the asset history feed

### Quality alerts

- states:
  - `open`
  - `acknowledged`
  - `resolved`
  - `suppressed`
- acknowledgement, suppression, and resolution require actor identity and audit
  rows

## Notification and Activity Event Taxonomy

Required activity and notification events:

- `comment_created`
- `comment_edited`
- `task_created`
- `task_reassigned`
- `task_state_changed`
- `description_updated`
- `tag_added`
- `tag_removed`
- `glossary_link_added`
- `glossary_link_removed`
- `owner_changed`
- `lineage_override_submitted`
- `lineage_override_approved`
- `quality_alert_opened`
- `quality_alert_resolved`
- `profile_run_completed`

Rules:

- activity feed and history define which event families render where
- notifications define recipients for:
  - assignee
  - reviewer
  - owner
  - steward/admin
  - thread participants
- every event stores actor, timestamp, affected entity identity, and any
  required comment or review note
- parity-core collaboration claims stop at workflow collaboration core:
  `@user/team` and `#asset` mention parity are explicitly deferred until later
  phases

## Notification Model

- required tables:
  - `notifications`
  - `notification_receipts`
  - `notification_preferences`
- recipient resolution must be explicit per event family and may target:
  - assignees
  - reviewers
  - owners
  - stewards/admins
  - thread participants
- delivery channels:
  - in-app inbox is required in kernel
  - external notification phase later adds email, webhooks, and chat/tool
    delivery channels such as Slack or Teams where policy allows
- event-to-recipient routing minimum:
  - `task_created` and `task_reassigned` notify assignee and reviewer
  - `comment_created` and `comment_edited` notify thread participants plus the
    current task assignee/reviewer when a workflow thread exists
  - description, tag, and glossary request events notify asset owners plus
    assigned reviewers or stewards as policy requires
  - lineage override submission and approval events notify submitter, approver
    set, and impacted owners or stewards
  - quality alert open and resolve events notify owners, active assignees, and
    stewards/admins according to severity policy
- read/unread and badge behavior:
  - inbox state, seen state, read state, and dismissal are persisted
  - badge counts derive from unread receipts, not from raw event totals
- target resolution:
  - every inbox or notification item stores the canonical target route or an
    explicit degraded target reference
  - notification clicks may not dead-end on a generic governance shell when a
    first-class target route exists
- suppression and preferences:
  - recipients can mute by event family and scope where policy allows
  - suppression never drops required audit/event rows
- precedence rules:
  - direct assignee or reviewer notifications outrank optional participant
    notifications
  - mandatory workflow notifications ignore user mute where policy requires
  - duplicate deliveries may collapse to one receipt per
    event-family/entity/recipient window when safe, but audit events are never
    dropped
- retry behavior:
  - delivery attempts are bounded, auditable, and idempotent
  - permanent failure yields visible operator diagnostics instead of silent loss

## Lineage Override Operation Model

Supported override operations:

- add manual edge
- suppress live edge
- mark live edge disputed
- annotate edge
- override column mappings
- expire override
- supersede override
- restore previously suppressed live edge

Rules:

- merge precedence between live lineage and overlays is explicit
- conflict UI must surface live-vs-overlay disagreement, not silently merge it
- overrides require diff and audit visibility in history and lineage drawers
- override coverage indicators surface in entity history and lineage preview
- column-level parity acceptance:
  - column anchor interactions exist in the graph and drawer
  - column mapping diffs are visible before approval
  - column-level provenance is visible per mapping
  - column-level conflicts are surfaced explicitly, not collapsed into a
    table-level generic warning

## Cache and Query Hardening

Backend cache contract must define:

- key composition
- TTL by payload type
- force-refresh semantics
- mutation fan-out invalidation
- stale/partial merge rules
- behavior differences for permission denied vs not found vs unavailable

Databricks query-layer hardening must add:

- statement ID capture
- timeout classification
- user-facing distinction between timed out, truncated, permission denied, and
  not found
- long-running query cancellation where supported
- row, column, sample, and graph breadth budgets

## Mutation Safety Contract

- mutation APIs use idempotency keys for retries and duplicate-submit
  protection
- write ordering is explicit for every multi-plane mutation
- partial-failure handling is defined:
  - UC write success + control-plane failure
  - control-plane success + audit failure
  - retry after timeout with unknown final state
- compensation rules are documented and implemented where safe
- UI receives clear outcome codes:
  - `success`
  - `partial_success`
  - `rejected_conflict`
  - `retryable_failure`
  - `fatal_failure`
- transport-level request IDs are not reused as governance business request IDs

## Transaction Strategy

- portability assumes the idempotent fallback path by default; multi-statement
  transactions are an optimization only after install/setup proves transaction
  eligibility in the target workspace
- use multi-statement transactions for control-plane writes where the target
  tables and workspace capabilities support them
- maintain a transaction-eligibility matrix for:
  - governance kernel tables
  - lineage override tables
  - notification tables
  - quality tables
- multi-table atomic units, where supported:
  - task, thread, post, activity-event, and notification fanout writes
  - glossary term state/version/link mutations plus audit/activity/notification
    writes
  - lineage override, column-mapping, approval, and history writes
  - quality run, result, and alert transitions
- single-row or idempotent units:
  - notification preference changes
  - identity-directory sync upserts
  - projection refresh rows keyed by one entity or scope
- when transactions are unsupported or preview-limited:
  - serialize write order explicitly
  - rely on idempotency keys plus optimistic locking
  - persist compensating audit/error records
  - surface partial-failure outcomes truthfully to the UI
- fallback write order, unless a mutation family declares a stricter variant:
  1. authoritative state rows
  2. version, audit, and activity rows
  3. notification and projection fanout
  4. operator diagnostics for any incomplete downstream fanout
- install/setup must record whether the workspace is:
  - transaction eligible for the relevant table family
  - fallback only
  - unknown and therefore treated as fallback only
- transaction and fallback behavior must be tested for:
  - happy-path commit
  - partial failure
  - retry after timeout
  - duplicate submit

## Optimistic Locking

Write APIs for glossary terms, tasks, lineage overrides, quality definitions,
and other control-plane state must carry either:

- `expectedVersion`, or
- `updatedAt` preconditions

Stale-write behavior:

- reject on version mismatch
- preserve server truth
- surface conflict messaging in the UI

## Performance Budgets and Instrumentation

Hard sign-off budgets:

- warm bootstrap usable under 2s
- cold bootstrap usable under 4s
- discovery refresh under 700ms warm
- entity hero under 1.5s warm
- secondary tabs under 2s warm
- lineage usable under 3s warm
- mutation feedback under 500ms
- route chunk and bundle budgets enforced in CI
- no long-running query without timeout classification
- no background work family may exceed its declared cost ceiling without
  emitting operator diagnostics and degraded behavior

Instrumentation requirements:

- frontend route timing instrumentation for initial load and client-route
  transitions
- backend endpoint duration logging
- Databricks statement timing capture when available
- screenshot packs include loading states, not just final settled renders
- benchmark fixtures include:
  - correctness fixture workspace
  - scale fixture workspace with thousands of assets, wide schemas, dense
    lineage, deep glossary trees, many tasks/threads, and degraded conditions
- benchmark environment contract defines:
  - warehouse size
  - browser/device matrix
  - warm vs cold definitions
  - concurrency assumptions
  - acceptable variance bounds
- cost budgets are explicit for:
  - discovery corpus rebuilds
  - scope-trimmed corpus refreshes
  - quality runs
  - profile/sample execution
  - classification recommendation ingestion
  - export jobs

## App Observability and Correlation IDs

- every HTTP response carries a transport request/correlation ID
- frontend actions send a client request ID header
- backend logs correlate:
  - frontend client request ID
  - server HTTP request ID
  - route and asset
  - actor email
  - duration
  - outcome
  - Databricks statement ID when available
- audit rows may store `httpRequestId` only where explicitly needed; they do
  not overload governance `requestId`
- runtime diagnostics expose safe metadata only:
  - build ID
  - diagnostics enabled
  - last request timing headers
  - runtime health
- no request-scoped diagnostics may be inserted into shared cached bootstrap
  payloads

## Migration, Backfill, and Retention

- backfill `change_requests` into `threads` and `tasks`
- backfill glossary tag links into `glossary_term_links`
- remove OM payload fields from APIs and persisted rows
- start `metadata_audit_log` on migration date if older diffs do not exist
- define retention and compaction for `thread_posts`, `quality_runs`,
  `quality_alerts`, and audit rows
- implement application-level uniqueness/integrity checks where Delta does not
  enforce them
- control-plane tables that currently use FQN-only links must receive
  `entity_id/current_fqn_snapshot` migration work before rename-safe sign-off
- every non-trivial migration requires a rehearsal against cloned governance
  tables before live rollout
- rehearsal results must record:
  - row counts before and after
  - idempotency outcome
  - timing and cost
  - rollback readiness
  - any manual remediation steps

## Migration Rehearsal

- every material migration must be rehearsed against cloned governance tables
  before live rollout
- rehearsal scope includes:
  - schema changes
  - backfills
  - idempotent re-run behavior
  - rollback verification
  - read-model rebuild impact
- deployment may not proceed when rehearsal leaves unresolved data drift,
  excessive cost, or incomplete rollback instructions

## Reconciliation / Drift Detection

- detect external UC tag/comment changes
- detect orphaned glossary links
- detect tasks tied to missing assets
- detect lineage overrides on deleted or renamed assets
- detect unresolved migrated glossary links
- reconcile cached discovery corpus against live inventory
- surface drift warnings in the UI and operator diagnostics
- no automatic reconciliation may silently drop user-entered governance state

## Quality Test Definition Library Contract

- the reusable quality test library is a persisted, administrable entity set,
  not only a code-backed template catalog
- required persisted concepts:
  - quality test definitions
  - version history for definitions
  - parameter schema
  - result schema
  - default severity or execution hints
- test cases bind entities or columns to reusable definitions; suites group
  test cases, not the other way around
- quality-definition admin surfaces require canonical routes and history before
  the library may be described as user-managed
- if a future implementation chooses a code-backed-only catalog instead, the
  product claim must narrow explicitly and the persisted library language must
  be removed

## Quality Core Contract

- reusable test-definition library with explicit template types and parameter
  rules
- table profile and column profile are distinct first-class persisted surfaces,
  not only derived views over quality results
- suite/group model for table and column tests
- threshold semantics and pass/warn/fail normalization
- normalized result model for entity quality/profile rendering
- clear precedence rules between live profile observations and persisted profile
  snapshots
- explicit alert-generation rules from failed tests and stale profile state
- entity/profile/quality tabs consume the same normalized result contract, not
  parallel bespoke payloads
- minimum shipped test catalog:
  - row count
  - freshness
  - null count / null percentage
  - uniqueness
  - accepted values
  - regex
  - min/max/range
  - schema / column presence
  - custom SQL
  - table comparison when feasible
- parity-core launch minimum by surface:
  - table surfaces must ship row count, freshness, schema or column presence,
    and custom SQL
  - column surfaces must ship null percentage, uniqueness, accepted values,
    regex, and min/max/range checks
  - table comparison ships only where capability and cost budgets allow;
    otherwise it is explicitly deferred rather than implied
- generic test definitions and parameterized test cases stay distinct so table
  and column tests share one library without collapsing their inputs

## Quality Guardrails

- tests are SELECT-only
- SQL templates and parameters are validated before execution
- query timeout and scan budgets are enforced
- max sample/evidence rows are capped
- sensitive evidence is redacted or masked when required
- alerts dedupe and support acknowledgement / resolution semantics
- create/edit/run/resolve permissions are role-gated
- quality execution cost and timeout tests are part of QA, not optional soak work

## Data Exposure Policy

- sample rows, profile evidence, query text, and workload identifiers follow
  the same authorization and masking contract as quality evidence
- classification recommendation evidence follows the same authorization and
  masking policy and may be hidden even when a high-level recommendation label
  is visible
- sensitive columns may return:
  - masked values
  - redacted histograms
  - `not authorized to preview`
- the UI distinguishes `not authorized` from `no data`
- exports inherit the same authorization and masking policy as on-screen data

## Security and Threat Review Gate

- before any new sensitive read, export, or evidence surface ships, the pass
  must include a threat review covering:
  - export leakage
  - preview/sample leakage
  - query-text leakage
  - classification-evidence leakage
  - corpus/autocomplete/facet leakage
  - auth-mode fallback widening
  - stale privilege snapshots after revocation
- each threat review records:
  - actors considered
  - surfaces reviewed
  - redaction rules
  - audit coverage
  - unresolved risks or explicit deferrals
- threat review is blocking when it finds a path that widens visibility,
  mislabels unavailable data as absent, or bypasses server-side authorization

## Share and Export Contract

- share in v1 means copy deep link only
- export in v1 means all filtered matches in the current authenticated result
  scope, not just the current page
- supported export formats in v1:
  - CSV for discovery results
  - JSON for selected record/detail payloads where allowed
- small exports may complete synchronously, but larger exports must switch to an
  async export job model with truthful progress and cancellation
- export size limits, row limits, auth rules, and redaction policies are
  enforced server-side
- preview selection must never silently widen or narrow export scope

## Export Job Model

- export above the synchronous threshold becomes an async, background-work
  export job
- required export-job behavior:
  - actor-scoped filter snapshot at request time
  - progress reporting
  - cancellation
  - bounded expiry
  - audit rows
  - row caps
  - redaction proof
  - artifact size and checksum recording
  - artifact revocation when privileges change or the artifact expires
  - download-time re-authorization
- exports are materialized from the same scope-trimmed result universe used for
  on-screen discovery, then revalidated before artifact delivery
- expired, cancelled, failed, or privilege-revoked exports must not remain
  downloadable
- role-matrix QA must include export leakage and redaction tests for sync and
  async paths

## Lineage Interaction Contract

- required graph interactions:
  - focus
  - refocus
  - set as focus
  - return to prior focus
  - center in graph
- required settings:
  - upstream/downstream direction
  - depth
  - nodes per layer
  - include columns
- selection persistence rules are explicit in URL or local state
- edge drawer required fields:
  - provenance
  - truncation status
  - source and target
  - evidence fields when available
- node drawer required fields:
  - identity
  - metadata summary
  - open actions
  - lineage role and adjacency summary
- operational-context and data-lineage views must switch cleanly without
  misleadingly merging the two

## Frontend Contract Safety

- generate frontend API types from backend schema/OpenAPI snapshots
- use generated types on route/api hot paths
- add CI contract-drift checks
- `tsc --checkJs` is an interim guard, not the final contract boundary

## Frontend Component Test Matrix

- advanced query builder
- entity hero actions
- task state transitions
- glossary term review flow
- degraded/unavailable banners
- lineage settings drawer
- wide-schema virtualization
- optimistic-lock conflict modals

Rules:

- each rebuilt surface ships with component tests in the same phase, not at the
  end

## QA and Sign-Off

Add a deterministic fixture workspace with:

- canonical table
- view
- materialized view
- streaming table
- lineage chain
- glossary-linked asset
- task-linked asset
- quality-tested asset

Validation also requires:

- golden screenshots per viewport
- screenshot-diff thresholds
- side-by-side OpenMetadata reference-pack comparison for:
  - discovery shell and cards
  - preview sidecar
  - entity hero and schema density
  - lineage graph and drawer
  - glossary browser and term detail
  - governance queue
- accessibility checks for keyboard navigation, focus visibility, drawer focus
  trapping, escape behavior, contrast, and reduced-motion sanity
- mutation truth checks and failure-mode tests
- branch-state verification pack proving all supposed `already landed` items on
  the shipping branch
- schema contract tests for every new Delta table
- search leakage tests across roles
- notification delivery tests
- transaction and partial-failure tests
- corpus rebuild and stale-corpus tests
- control-plane migration idempotency tests
- quality test cost/timeout tests
- lineage retention and masking tests
- column-lineage limitation tests for path-based references, UDF-obscured
  mappings, and source-plane truncation labels
- explicit OpenMetadata reference screenshot review by surface before final
  sign-off
- explicit interaction comparison against OpenMetadata reference flows for
  discovery, entity, lineage, glossary, and task workflows
- install/setup wizard validation in the deployed app
- admin diagnostics validation for degraded capability scenarios
- background work plane tests for retries, cancellation, and dead-letter paths
- async export job tests including cancellation, expiry, revocation, and audit
- security/threat review sign-off for export, sample, query text,
  classification evidence, and corpus leakage
- dead-control inventory:
  - every visible button
  - every hover affordance
  - every badge interaction
  - every tab
  - every drawer action
  - every breadcrumb and link
- local Vite/FastAPI runs are preflight only
- sign-off runs against the real deployed Databricks App, real warehouse, and
  fixture workspace
- fixture automation:
  - seed script
  - reset/teardown script
  - deterministic expected outputs
  - validation SQL pack
  - versioned screenshot baseline
- concurrent-user workflow testing:
  - optimistic-lock conflicts
  - cross-session invalidation
  - task reassignment races
  - glossary approval races
  - lineage override approval races
  - quality-alert acknowledgement races
  - notification read/unread races
  - export cancel-vs-download races

Mandatory role-matrix E2E:

- `reader`
- `writer`
- `steward`
- `admin`
- no-identity read-only session
- service-principal read-only session

For each role validate:

- visible actions
- hidden and disabled actions
- 403 behavior
- audit identity
- mutation prevention where required

## Execution Model / Review Swarms

Required reviewer roles:

- feedback coverage reviewer
- scope/philosophy reviewer
- regression reviewer
- ripple reviewer
- lineage specialist
- design/polish reviewer
- performance reviewer
- QA/reality-check reviewer

Execution rules:

- assign reviewers before substantive work starts, not only after code lands
- reviewers are blocking, not advisory, when they find a contract-level
  mismatch, truthfulness regression, or scope violation
- use local work instead of delegation when the next critical-path task is too
  coupled to hand off cleanly
- stop parallel work and integrate whenever a reviewer finds a contract-level
  mismatch
- each reviewer returns:
  - surfaces inspected
  - concrete findings
  - required changes or explicit deferrals
- reviewer ownership defaults:
  - feedback coverage: user comments, plan deltas, changelog completeness
  - scope/philosophy: `AGENTS.md`, plan contracts, product-shape drift
  - regression: behavioral changes and prior approved paths
  - ripple: adjacent routes, shared hooks, shared styling, route/state effects
  - lineage specialist: lineage data, preview, and drawer correctness
  - design/polish: shell, hierarchy, density, focus/hover/empty states
  - performance: budgets, chunking, request churn, cache invalidation
  - QA/reality-check: deployed-app validation, fixtures, and failure modes
- each reviewer must provide evidence:
  - files or surfaces inspected
  - exact findings
  - whether the finding blocks the pass
- every non-trivial pass appends the findings and resulting decisions to
  `AGENT_CHANGELOG.md`

## Workstream Ownership and Done Criteria

Rules:

- phase order and phase exit criteria are the canonical sequencing and claim
  gates; workstream ownership sections may add implementation detail but may
  not widen or relax those gates

Master backlog rules:

- every task must name:
  - likely files
  - dependency prerequisites
  - validation command or probe
  - rollback concern
  - ripple-risk surfaces
  - primary owner and reviewer lane
- integration order is explicit; parallel tasks stop before overlapping write
  scopes

### Foundation

- likely files:
  - `run_app.py`
  - `runtime_app.py`
  - `app.yaml`
  - `databricks.yml`
  - `scripts/*`
- done when:
  - deploy is packaged and reproducible
  - request IDs and route-serving contracts are live

### Frontend data layer

- likely files:
  - `frontend/src/lib/api.js`
  - `frontend/src/hooks/useBootstrap.js`
  - `frontend/src/hooks/useAssetDetail.js`
  - `frontend/src/hooks/useLineage.js`
  - `frontend/src/hooks/useDiscoveryResults.js`
- ripple risks:
  - stale shared caches
  - request cancellation collisions
- done when:
  - server state has one canonical ownership model

### Design system / shell

- likely files:
  - `frontend/src/styles/*`
  - `frontend/src/components/AppFrame.jsx`
  - shared shell components
- rollback concern:
  - do not strand surfaces between old and new shell primitives

### API / contracts / schema lock

- likely files:
  - `govhub/services/*`
  - `govhub/store.py`
  - `govhub/migrations.py`
  - generated schema/OpenAPI snapshots
  - docs DDL/spec appendix
- done when:
  - hot-path APIs have stable contracts
  - generated frontend types can bind to those contracts
  - every new table family has locked schema specs and contract tests
  - platform-core entities/aliases/relationships/versions/change-events are
    defined before new typed entity sprawl begins

### Background work plane / rollout controls

- likely files:
  - background work services and job runners
  - export services
  - diagnostics and feature-flag services
  - setup/install validation services
- done when:
  - durable work items, runs, retries, dead letters, and export jobs are real
  - diagnostics and setup validation expose truthful remediation steps
  - feature flags can narrow rollout without weakening truth contracts

### Discovery

- likely files:
  - `govhub/services/assets.py`
  - discovery hooks/components
- done when:
  - grouped search, cursoring, preview, export, security trimming, and
    performance gates pass

### Entity

- likely files:
  - `govhub/services/assets.py`
  - `frontend/src/components/EntityWorkspace.jsx`
- done when:
  - hero, capability-driven tabs, truthful unavailable states for operational
    surfaces, history, and mutation truth checks pass

### Governance kernel

- likely files:
  - `govhub/store.py`
  - `govhub/services/governance.py`
  - governance/glossary UI components
  - thread/task/notification/activity APIs and projections
- done when:
  - glossary minimum, threads/tasks/history, notifications, and projections are
    real

### Governance breadth

- likely files:
  - `govhub/store.py`
  - `govhub/services/governance.py`
  - governance/glossary/classification/domain/data-product UI components
- done when:
  - classification, domains/data products, glossary deep semantics, and column
    bulk operations are real

### Governance scale

- likely files:
  - governance metrics/contracts/bulk workflow services
  - projection and batch-processing surfaces
- done when:
  - metrics, data contracts, and bulk governance workflows are real or formally
    excluded with narrowed claims

### Audit and compliance

- likely files:
  - audit-log services and admin routes
  - operator/compliance UI surfaces
  - export/report tooling
- done when:
  - audit-log browser, filtering, retention truth, and export are real
  - auditability claims are backed by product surfaces, not only storage

### Lineage

- likely files:
  - `govhub/services/lineage.py`
  - lineage UI components
- done when:
  - read-only truth and interaction contract pass before overlays ship

### Quality

- likely files:
  - quality routers/services
  - entity quality/profile UI
- done when:
  - the minimum test catalog, runs, alerts, staleness, and privacy controls
    pass

### Databricks differentiation

- likely files:
  - workspace capability services
  - Databricks-native entity routers and UI
  - deep-link and diagnostics surfaces
- done when:
  - non-tabular Databricks-native entities and diagnostics deliver value beyond
    OM-class parity without breaking portability

## Post-Parity Databricks Differentiation

After OM-class parity, the product must add Databricks-native value that OM
does not provide out of the box.

Candidate differentiation scope:

- Unity Catalog-specific entity types:
  - functions
  - volumes
  - registered models
- Databricks operational entities:
  - jobs
  - pipelines / DLT / Lakeflow
  - notebooks
  - dashboards
- direct deep links into Databricks assets and evidence surfaces
- direct links to Catalog Explorer, Jobs, Pipelines/Lakeflow, notebooks,
  dashboards, and query history where allowed
- workspace capability diagnostics and remediation hints
- workspace capability dashboard with remediation steps
- UC permissions and policy visibility where safe
- why-can't-I-access-this explanations when permission or capability blocks a
  surface
- system-table health diagnostics
- data classification recommendations from Databricks classification results
- lineage evidence with statement, job, notebook, or dashboard links where
  allowed
- governance insights specific to Unity Catalog and Delta
- Delta/UC-specific stewardship insights such as policy gaps, ownership gaps,
  freshness blind spots, and evidence-linked incidents

Required first post-parity differentiators:

- workspace capability dashboard with remediation steps and operator-safe
  diagnostics
- permission explanations for blocked previews, queries, lineage, and quality
  surfaces
- direct deep links into Databricks assets and operational evidence surfaces
  where policy allows
- lineage evidence linking to statement, job, notebook, pipeline, or dashboard
  sources where the runtime exposes them
- system-table health diagnostics for operational and metadata planes
- capability-gated classification recommendations sourced from Databricks
  classification detections
- classification result to steward review to approved metadata to suggested
  policy or remediation action loop, with policy actions remaining explicit and
  non-automatic until their own contract lands
- Delta/UC-specific governance insights that surface ownership, policy,
  freshness, and evidence gaps

Release-lock rules:

- each differentiator declares its capability gate, fallback or degraded
  behavior, source of truth, and proof surface before implementation starts
- no differentiator ships as decorative diagnostics without at least one
  concrete operator or steward action path

## Release Safety and Rollback Strategy

- take Delta snapshot or clone backups before migrations
- define a post-migration verification script and stop-deploy conditions
- packaged deploys must support rollback to the prior artifact
- unfinished route migrations or rebuilt surfaces must ship behind explicit
  rollout controls where needed
- if migration verification fails, deployment stops before the new app is marked
  healthy

## Operator Runbooks

Required docs/runbooks:

- deploy runbook
- migration runbook
- rollback runbook
- fixture workspace setup
- QA execution guide
- RBAC test guide
- troubleshooting guide for warehouse, lineage, governance-plane, and degraded
  state failures

## Announcement Dependency

Announcements are later-phase and depend on a declared delivery rule because v1
omits followers. The delivery model must be explicit before implementation:

- owners only
- assignees only
- stewards/admins only
- domain-scoped audience
