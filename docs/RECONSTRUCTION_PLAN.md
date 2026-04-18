# OpenMetadata UI Rebirth Program

Every major page/view must ship with:

* a visual north-star comp
* a loading variant
* an empty variant
* a degraded/unavailable variant
* a page-specific wow criterion
* a side-by-side OpenMetadata comparison target
* screenshot acceptance from Playwright
* interaction acceptance
* design-review sign-off with your subagents

**No page is considered rebuilt until its visual hierarchy, density, preview/drawer behavior, and enterprise polish are strong enough to impress a skeptical prospect in a live sales demo.**

[1]: https://docs.open-metadata.org/v1.12.x/how-to-guides/guide-for-data-users/data-asset-tabs?utm_source=chatgpt.com "Overview of Data Assets | Official Documentation"

## Phase 2: design system and shell replacement

### Goal

Stop looking like a prototype. Build a credible enterprise metadata shell before rebuilding surfaces.

### Design target

Governance Hub-branded, not a pixel-copy, but OpenMetadata-class in density, hierarchy, polish, and perceived quality.

OpenMetadata’s shell and asset-detail experience show a dense enterprise layout with top panels, tabs, side previews, rich metadata chips, lineage drawers, glossary hierarchy, task/activity surfaces, and quality/profile panels. Governance Hub must feel like that level of product, not a demo. ([OpenMetadata Documentation][1])

### Required primitives

Create:

```text
frontend/src/design/tokens.css
frontend/src/design/layout.css
frontend/src/design/components.css
frontend/src/components/shell/
frontend/src/components/primitives/
```

Tokens:

```css
:root {
  --gh-bg: #f7f9fc;
  --gh-surface: #ffffff;
  --gh-surface-muted: #f3f6fb;
  --gh-border: #d8dee9;
  --gh-border-strong: #b8c2d3;
  --gh-text: #14213d;
  --gh-text-muted: #5c6b82;
  --gh-accent: #5b3ff2;
  --gh-accent-soft: #eef0ff;
  --gh-danger: #b42318;
  --gh-warning: #b54708;
  --gh-success: #067647;

  --gh-radius-xs: 4px;
  --gh-radius-sm: 6px;
  --gh-radius-md: 8px;
  --gh-radius-lg: 12px;

  --gh-space-1: 4px;
  --gh-space-2: 8px;
  --gh-space-3: 12px;
  --gh-space-4: 16px;
  --gh-space-5: 20px;
  --gh-space-6: 24px;

  --gh-font: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

Build primitives:

* `AppShell`
* `GlobalHeader`
* `PrimaryNav`
* `GlobalSearch`
* `EntityHero`
* `MetadataChip`
* `Tabs`
* `RightRail`
* `Drawer`
* `DataTable`
* `EmptyState`
* `LoadingSkeleton`
* `DegradedBanner`
* `ActionButton`
* `Breadcrumbs`
* `StatusBadge`

### UX requirements

* The shell must render at common laptop widths without massive empty gray areas.
* Every route has a real header, route title, breadcrumb, and loading state.
* Drawers trap focus and close on Escape.
* Disabled buttons explain why they are disabled.
* Loading states preserve layout shape.
* Error boundaries show actionable diagnostics, not just “frontend error.”

### Exit criteria

* Design review screenshot pack for:

  * shell
  * discovery skeleton
  * entity skeleton
  * lineage skeleton
  * governance skeleton
  * degraded workspace
* No major rebuilt surface depends on the old monolithic CSS.
* Keyboard navigation and focus are visible.

---

## Phase 3: API decomposition and canonical contracts

### Goal

Make the backend clean enough to support real product work.

### Split `runtime_app.py`

Move to:

```text
govhub/api/bootstrap.py
govhub/api/discovery.py
govhub/api/assets.py
govhub/api/lineage.py
govhub/api/governance.py
govhub/api/quality.py
govhub/api/diagnostics.py
govhub/api/setup.py
govhub/api/export.py
```

Keep `runtime_app.py` as composition only:

```python
app = FastAPI(...)
app.include_router(build_bootstrap_router(...))
app.include_router(build_discovery_router(...))
...
```

### Canonical envelope

Every hot-path endpoint returns:

```json
{
  "data": {},
  "meta": {
    "entityId": null,
    "entityFqn": null,
    "source": "uc_live | control_plane | projection | mixed",
    "authoritative": true,
    "observedAt": "2026-04-16T00:00:00Z",
    "staleAfter": "2026-04-16T00:05:00Z",
    "capabilities": {},
    "allowedActions": {},
    "warnings": [],
    "degraded": false,
    "visibilityScope": "..."
  },
  "errors": []
}
```

### Contract generation

Generate OpenAPI snapshots and frontend types:

```bash
python scripts/generate_runtime_api_openapi_snapshot.py
npm run generate:api-types
npm run typecheck
```

### Exit criteria

* No rebuilt surface consumes unstable legacy payloads except through a named temporary adapter with removal ticket.
* API snapshots checked in.
* Frontend hot paths use generated types.
* Every endpoint has contract tests.

---

## Phase 4: install/setup, capabilities, diagnostics, and auth modes

### Goal

The app must know what it can safely claim in a given workspace.

### Required product modes

Define this table in code and UI:

| Auth/capability mode | Discovery                      | Preview      | Sample       | Lineage      | Query history | Export     | Governance writes          |
| -------------------- | ------------------------------ | ------------ | ------------ | ------------ | ------------- | ---------- | -------------------------- |
| OBO available        | actor-scoped                   | actor-scoped | actor-scoped | actor-scoped | if safe plane | role-gated | role-gated                 |
| App principal only   | restricted or admin diagnostic | redacted     | disabled     | degraded     | disabled      | disabled   | control-plane only if safe |
| No identity          | degraded/read-only             | redacted     | disabled     | degraded     | disabled      | disabled   | disabled                   |

### Databricks-specific requirements

Databricks Apps have app authorization and user authorization/OBO as separate models. OBO allows Databricks to enforce the user’s UC permissions on the app’s behalf; app-principal access must not silently widen user-visible data. ([Databricks Documentation][2])

Query history is Public Preview and admin-governed by default. Non-admin exposure requires a validated safe sharing path such as OBO, dynamic views, or another explicit permission model. ([Databricks Documentation][3])

### Setup wizard validates

* actor identity headers
* app principal reachability
* OBO availability and token freshness
* UC inventory access
* lineage access
* column lineage capability
* query history safe sharing path
* warehouse usability
* governance schema write access
* background runner
* export staging
* transaction eligibility
* classification recommendation source eligibility

### Exit criteria

* Setup wizard shows exact capability truth.
* Admin diagnostics page shows auth mode, capability probes, queue health, corpus freshness, export state, and remediation steps.
* No sensitive data or tokens appear in diagnostics.

---

## Phase 5: governance kernel

### Goal

Build the smallest real governance control plane.

### Tranche A: identity, registry, audit

Tables:

* `metadata_audit_log`
* `schema_migrations`
* `entities`
* `entity_aliases`
* `entity_relationships`
* `entity_versions`
* `change_events`
* `change_event_consumers`
* `change_event_consumer_offsets`
* `identity_directory_entries`
* `identity_directory_memberships`

Add a **relationship source-of-truth matrix** before implementation. Every relationship type must declare whether the specialized table or `entity_relationships` is authoritative.

### Tranche B: threads, tasks, activity

Tables:

* `threads`
* `thread_posts`
* `tasks`
* `task_assignees`
* `task_reviewers`
* `activity_events`

Task workflow must support:

* requested diff
* accepted diff
* accept as requested
* edit then accept
* reject with comment
* multiple assignees
* multiple reviewers

### Tranche C: notification inbox

Tables:

* `notifications`
* `notification_receipts`
* `notification_preferences`

Notification clicks must resolve to canonical routes or degraded target previews.

### Tranche D: glossary minimum

Tables:

* `glossaries`
* `glossary_terms`
* `glossary_term_versions`
* `glossary_reviewer_links`
* `glossary_term_links`

### Tranche E: projections

Tables:

* `entity_summary_projection`
* `governance_queue_projection`
* `glossary_summary_projection`
* `projection_watermarks`

Add a **read-after-write consistency contract**. After a mutation, the UI must either patch query cache from mutation response, wait for projection catch-up, or show “update pending.” It must not show stale counters as final truth.

---

## Phase 6: early vertical slice

### Goal

Prove the product loop before broad buildout.

Required deployed workflow:

```text
Discovery search/browse
-> entity hero
-> create thread/task
-> glossary link or review visibility
-> lineage preview or truthful unavailable state
-> quality status or truthful unavailable state
```

This must run in the deployed Databricks App, with real auth and real capability responses.

No fake counters, no synthetic workflow rows, no placeholder acceptance paths.

---

## Phase 7: Discovery v2 thin, then full

### Thin Discovery v2

Ship early:

* real search
* result cards
* right rail preview
* facets from safe source
* capability-aware unavailable states
* no export yet unless secure

### Full Discovery v2

Add:

* grouped Boolean query builder
* cursor pagination
* hierarchy browsing
* security-trimmed corpus
* autocomplete
* export
* ranking QA set
* noisy/generated object exclusion
* leakage tests

### Security-trim model

Use:

* base corpus
* scope-trimmed slices
* live permission re-checks
* fail-closed behavior if scope budget or freshness fails

If security trimming fails:

* disable security-trimmed discovery
* suppress export/autocomplete/aggregate counts
* fall back to live-only browse/search only where safe

---

## Phase 8: Entity v2

### Endpoints

```text
/assets/{fqn}/summary
/assets/{fqn}/schema
/assets/{fqn}/sample
/assets/{fqn}/activity
/assets/{fqn}/tasks
/assets/{fqn}/queries
/assets/{fqn}/usage
/assets/{fqn}/workloads
/assets/{fqn}/profile
/assets/{fqn}/quality
/assets/{fqn}/history
/assets/{fqn}/lineage-summary
/assets/{fqn}/custom-properties
```

### Requirements

* hero backed by real summary
* task/thread counts from projections
* history from `entity_versions` + audit provenance
* custom properties only from schema-driven definitions/assignments
* profile only from persisted profile snapshots or bounded live reads
* query history means observed history only, not manual saved queries
* unsupported tabs hidden or shown as capability-unavailable, never hollow

### Custom properties

Add:

* `custom_property_definitions`
* `custom_property_definition_versions`
* `custom_property_assignments`

### Profile

Add:

* `profile_runs`
* `profile_table_metrics`
* `profile_column_metrics`

---

## Phase 9: Lineage v2

### Read-only first

* direction toggle
* depth
* nodes per layer
* include columns
* focus/refocus/center
* node drawer
* edge drawer
* lineage evidence
* truncation labels
* incomplete column lineage labels
* operational vs data-lineage view separation

Unity Catalog lineage is permission-aware and can have retention and column-lineage limitations, so the UI must label masked, partial, truncated, retention-expired, or unavailable states truthfully. ([Databricks Documentation][4])

### Overrides later

Add governed lineage overrides only after read-only lineage is stable:

* add manual edge
* suppress live edge
* dispute live edge
* annotate edge
* override column mappings
* expire/supersede/restore
* approval workflow
* overlay visual distinction

---

## Phase 10: Quality core

### Tables

* `quality_test_definitions`
* `quality_test_definition_versions`
* `quality_suites`
* `quality_test_cases`
* `quality_runs`
* `quality_run_results`
* `quality_alerts`
* profile tables from Entity phase

### Quality test catalog

Minimum:

* row count
* freshness
* null count / null percentage
* uniqueness
* accepted values
* regex
* min/max/range
* schema/column presence
* custom SQL
* table comparison where feasible

### Custom SQL guardrails

* SELECT-only
* one statement only
* no semicolon chaining
* must bind to target entity or approved comparison entity
* bounded result schema
* no raw row evidence unless explicitly allowed and redacted
* row/byte/time budget
* result schema validation
* statement IDs captured

---

## Phase 11: Governance breadth and scale

### Breadth routes

* `/classifications`
* `/classifications/:classificationId`
* `/classifications/:classificationId/terms/:termId`
* `/domains`
* `/domains/:domainId`
* `/data-products`
* `/data-products/:dataProductId`
* `/governance/columns/:groupId`

Each must have:

* canonical route
* preview contract
* summary
* activity/history
* allowed actions
* provenance
* state machine
* version model
* authority cutover source

### Column bulk operations

Add:

* `logical_column_groups`
* `logical_column_group_members`

Logical groups must show:

* member count
* conflicting descriptions/tags/glossary links
* match rule
* confidence
* last reviewed
* provenance
* bulk actions

### Scale routes

* `/metrics`
* `/metrics/:metricId`
* `/contracts`
* `/contracts/:contractId`

Add reviewer/owner multiplicity for metrics/contracts, not single reviewer fields only.

---

## Phase 12: background work, export, and async safety

### Background tables

* `background_work_items`
* `background_work_runs`
* `background_dead_letters`
* `export_jobs`

### Hard rule

No raw OBO/user tokens may be persisted, queued, logged, replayed, or embedded in artifacts.

### Export

* small sync export allowed under threshold
* large export async only
* actor-scoped filter snapshot
* reauthorization before materialization and download
* artifact checksum
* expiry
* revocation
* audit
* redaction proof

---

## Phase 13: audit and compliance product surface

Add:

* audit browser
* filters by actor/entity/operation/time
* retention truth
* export/reporting
* clear distinction between audit rows and activity feed entries

---

## Phase 14: Databricks-native differentiation

Must ship real workflows, not decorative diagnostics:

* “Why can’t I access this?” with permission/capability explanation and remediation
* direct links to Catalog Explorer, Jobs, Pipelines/Lakeflow, notebooks, dashboards, and query history where allowed
* lineage evidence to statement/job/notebook/pipeline/dashboard
* system-table health dashboard
* classification recommendation -> steward review -> approved metadata -> suggested policy/remediation
* UC/Delta governance insights:

  * ownership gaps
  * policy gaps
  * freshness blind spots
  * evidence-linked incidents

Databricks classification results can include sample values and are governed by access constraints, so this recommendation workflow must be redacted and steward-gated by default. ([Databricks Documentation][5])

---

## Subagent operating model

### Primary implementation agent

Owns sequencing, integration, and final decisions. Must not delegate tightly coupled work that would cause merge conflicts. Maintains `AGENT_CHANGELOG.md`.

### Repo hygiene / branch-state reviewer

Inspects:

* runtime chain
* tracked artifacts
* deleted legacy paths
* package scripts
* frontend source completeness
* deploy artifact inventory

Blocks if:

* source tree cannot build
* stale `dist` is used as source
* runtime drift remains
* plan claims do not match branch truth

### Frontend rescue and build subagent

Owns:

* restoring source
* fixing imports
* cleaning node_modules/dist
* npm CI
* lint/type/test/build
* generated frontend types

Blocks if:

* missing components/hooks/libs/styles
* build uses stale dist
* console errors remain

### Bootstrap/performance subagent

Owns:

* minimal bootstrap
* route timings
* cold/warm load budgets
* API waterfall reduction
* no heavy first-render metadata work

Blocks if:

* blank gray screen persists
* bootstrap calls live inventory/lineage/governance summary
* shell first paint exceeds budget

### Design/polish subagent

Owns:

* tokens
* shell
* hero
* tabs
* right rail
* drawer
* skeletons
* empty/error/degraded states
* accessibility

Blocks if:

* app still looks prototype-grade
* any primary surface lacks enterprise density
* controls are visually inconsistent

### Backend truth subagent

Owns:

* API decomposition
* canonical envelope
* asset/entity truth
* UC/system table validation
* no synthetic state

Blocks if:

* UI lies about backend data
* empty states hide unavailable authority planes
* endpoint responses use bespoke wrappers

### Security/auth subagent

Owns:

* OBO/app-principal boundary
* safe query-history sharing
* sample/profile/query/export leakage
* scope trimming
* threat reviews

Blocks if:

* app-principal silently widens user-visible data
* async work persists OBO tokens
* export leaks invisible assets

### Governance/workflow subagent

Owns:

* identity directory
* registry
* audit
* tasks
* threads
* glossary
* notifications
* projections

Blocks if:

* workflow counters are synthetic
* task/thread states do not persist
* notification targets dead-end

### Lineage subagent

Owns:

* lineage correctness
* settings
* node/edge drawers
* truncation
* incomplete column-lineage labeling
* overlays later

Blocks if:

* nodes disappear
* drawers are empty/misleading
* graph implies complete column lineage when source is partial

### Quality/profiler subagent

Owns:

* profile persistence
* quality definitions
* tests/runs/results/alerts
* evidence redaction
* cost limits

Blocks if:

* profile is ad hoc only
* custom SQL unsafe
* results not persisted

### QA/reality-check subagent

Owns deployed-app validation, screenshots, truth checks, role matrix, failure modes, and dead-control inventory.

Blocks if:

* tests only run locally
* deployed app differs from branch proof
* any major surface has console/page errors
* visual polish still obviously below OpenMetadata reference

---

## Final sign-off gates

The product cannot be signed off until all are true:

1. Clean source checkout builds.
2. Clean packaged Databricks deploy works.
3. No runtime `ReferenceError`.
4. Initial shell paint meets budget.
5. Direct deep links work.
6. Browser console has no major errors.
7. Discovery/entity/lineage/governance/quality surfaces are validated in deployed app.
8. Every visible control is functional or truthfully disabled.
9. UI data agrees with backend truth checks.
10. Screenshot pack passes OpenMetadata-class review.
11. Role matrix passes.
12. Security leakage tests pass.
13. No stale compiled bundle is treated as source.
14. `AGENT_CHANGELOG.md` records every phase, reviewer decision, validation output, and unresolved deferral.

---

[1]: https://docs.open-metadata.org/v1.12.x/how-to-guides/data-discovery/details?utm_source=chatgpt.com "Detailed View of the Data Assets"
[2]: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth?utm_source=chatgpt.com "Configure authorization in a Databricks app"
[3]: https://docs.databricks.com/aws/en/admin/system-tables/query-history?utm_source=chatgpt.com "Query history system table reference | Databricks on AWS"
[4]: https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage?utm_source=chatgpt.com "View data lineage using Unity Catalog | Databricks on AWS"
[5]: https://docs.databricks.com/aws/en/admin/system-tables/?utm_source=chatgpt.com "Monitor account activity with system tables"
