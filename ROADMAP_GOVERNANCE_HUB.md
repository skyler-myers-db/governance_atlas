# Governance Hub Roadmap

This roadmap translates the current product review, repo analysis, and implementation
history into a practical plan for evolving Governance Hub from a strong metadata
accelerator into a fuller governance operating platform.

The roadmap is intentionally opinionated around the standing product goal in
`AGENTS.md`:

- Discovery, Lineage, and Governance remain the center of gravity
- the app should feel like an internal enterprise metadata product in the mold of
  OpenMetadata and DataHub
- it should add clear governance value on top of Databricks rather than duplicate
  what Databricks already provides

---

## Current Position

Governance Hub is already strong in these areas:

- Databricks-native deployment via Databricks Apps and Databricks Asset Bundles
- Unity Catalog inventory, comments, and tags
- table and column lineage from Databricks system tables
- Delta-backed governance control-plane tables
- asset-centric discovery and entity pages
- glossary and stewardship workflows
- role-aware governance editing and review patterns
- optional OpenMetadata bridge

The biggest remaining gaps are:

- perceived speed and first-impression polish in the live product
- lack of a first-class policies / standards / documentation module
- lack of governance communications / updates
- missing SharePoint / Power BI / ServiceNow integration surfaces
- limited evidence-generation and operational observability for rollout/support

---

## Phase 1: Now

These are the highest-value items that materially improve usability, credibility, and
adoptability without changing the platform model.

### 1. Live-Path Performance and First-Impression Polish

**Why now**

The app's biggest strength is that it is portable, low-footprint, and live-first. The
next step should reinforce that advantage rather than dilute it. Improve responsiveness,
progressive loading, and the executive first impression before introducing heavier
operational footprint.

**Target outcome**

- Discovery feels quick even on first use
- asset pages feel immediate
- lineage workspaces feel responsive without extra infrastructure
- the app looks polished and useful in the first 30 to 60 seconds

**Implementation notes**

- Keep live Unity Catalog and system-table reads as the default operating model.
- Optimize for perceived speed first:
  - lazy-load heavy sections
  - use explicit progressive loading
  - improve filter/state handling
  - tighten the discovery-to-entity workflow
  - avoid loading expensive surfaces until the user asks for them
- Improve first-impression product framing:
  - stronger shell overview
  - high-signal focus views
  - guided walkthrough inside the actual product
  - better opening metrics and action surfaces

**Suggested repo changes**

- Refine the shell and Discovery module in [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py)
- Keep performance work inside the current app architecture before extending [databricks.yml](/Users/entrada-mac/Documents/GitHub/governance_hub/databricks.yml)
- Add lightweight runtime/status indicators only if they preserve the low-footprint install model

### 2. Policies & Standards Module

**Why now**

The current app is strongest as a metadata and stewardship product. The original story,
however, is broader: governance users need policies, standards, reference content, and
operational guidance in one place.

**Target outcome**

- governance users can find approved policy content in the same app where they work on
  assets
- the app becomes a real governance hub, not only a metadata surface

**Implementation notes**

- Add a top-level or Governance-subsection module for:
  - policies
  - standards
  - checklists
  - governance reference documents
- Begin with lightweight metadata records instead of document storage:
  - title
  - category
  - owner
  - status
  - effective date
  - source link
  - applies-to domains
- If SharePoint integration is not yet ready, use an internal record table with external links.

**Suggested repo changes**

- Extend [govhub/store.py](/Users/entrada-mac/Documents/GitHub/governance_hub/govhub/store.py) with a `governance_documents` table
- Extend [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py) Governance module with a `Policies & standards` section
- Add document-to-domain and document-to-asset linking later if useful

### 3. Stewardship Queue / Worklist

**Why now**

The app has stewardship ingredients already, but it still needs a clearer “what should I
work on next?” operating view for owners, stewards, and governance leads.

**Target outcome**

- governance users get explicit work queues
- low-governance-score assets become actionable, not just visible

**Implementation notes**

- Add queue views such as:
  - unowned assets
  - undocumented assets
  - missing glossary term
  - pending change requests
  - uncertified critical assets
- Allow scoping by role or owner identity.

**Suggested repo changes**

- Add a dedicated sub-surface under `Stewardship` in [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py)
- Reuse the rollups already computed in `_cached_asset_inventory()`

### 4. Configurable Governance Scoring

**Why now**

The current scoring logic is useful, but hardcoded. Clients will want different weights,
required fields, and maturity definitions.

**Target outcome**

- governance scoring becomes client-configurable
- the accelerator becomes more reusable without fork-heavy customization

**Implementation notes**

- Move score weights and maturity thresholds out of hardcoded logic
- Add a configuration table for:
  - score weights
  - required metadata fields
  - maturity bands
  - optional domain-specific overrides

**Suggested repo changes**

- Add a `governance_scoring_config` table in [govhub/store.py](/Users/entrada-mac/Documents/GitHub/governance_hub/govhub/store.py)
- Refactor the scoring block in `_cached_asset_inventory()` in [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py)

---

## Phase 2: Next

These are the next-tier additions that make the app a broader governance operations
surface and close more of the original story gaps.

### 5. SharePoint Integration Surface

**Why next**

SharePoint is a likely landing zone for policy documents, operating standards, templates,
and governance collateral in many enterprises. The app needs a pragmatic bridge, even if
it does not become a document-management system.

**Target outcome**

- governance users can access standards/policies/reference materials from inside the app
- governance content stays centralized from a user perspective even if storage remains
  external

**Implementation notes**

- Start with reference-link integration, not deep document sync
- Represent SharePoint content as indexed link records with metadata
- Add filters by domain/category/owner/status

**Suggested repo changes**

- Add a SharePoint connector module or loader in `govhub/`
- Add integration records to [govhub/store.py](/Users/entrada-mac/Documents/GitHub/governance_hub/govhub/store.py)
- Add a `Documents` or `Policies & standards` UI section in [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py)

### 6. Power BI Dashboard Integration

**Why next**

Governance teams often need scorecards and adoption metrics. Power BI is commonly where
those already exist. Embedding or linking them gives the app operational reach without
rebuilding reporting from scratch.

**Target outcome**

- governance users can view key governance KPIs from the same operating surface
- dashboard access becomes contextual to governance work

**Implementation notes**

- Start with catalogued dashboard links and optional embed metadata
- Later, map dashboards to governed domains and data products
- Eventually integrate downstream dashboard dependency views into lineage/impact pages

**Suggested repo changes**

- Add a `dashboard_links` or `governance_dashboards` table in [govhub/store.py](/Users/entrada-mac/Documents/GitHub/governance_hub/govhub/store.py)
- Add a `Dashboards` or `Reporting` subsection in the Governance module in [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py)

### 7. ServiceNow Change / Incident Integration

**Why next**

If governance exceptions, access issues, certification reviews, or metadata remediation
already live in ServiceNow, the app should be able to bridge users into those workflows.

**Target outcome**

- governance users can move from metadata context to operational tickets immediately
- change requests can reference enterprise workflow systems rather than remain app-local only

**Implementation notes**

- Start with simple ticket/reference links
- Later extend change requests with external ticket IDs and status synchronization

**Suggested repo changes**

- Extend `change_requests` in [govhub/store.py](/Users/entrada-mac/Documents/GitHub/governance_hub/govhub/store.py) with external workflow fields
- Add ServiceNow link support under `Integrations` in [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py)

### 8. Governance Communications / Updates

**Why next**

The original story explicitly calls for communication updates. This is still a major
product gap.

**Target outcome**

- policy changes, governance announcements, and scheduled maintenance are visible inside
  the app
- the app feels like the place governance lives, not just the place metadata gets edited

**Implementation notes**

- Add a lightweight announcement/feed model:
  - title
  - summary
  - owner
  - severity/type
  - effective date
  - related domains/assets
  - links

**Suggested repo changes**

- Add a `governance_updates` table in [govhub/store.py](/Users/entrada-mac/Documents/GitHub/governance_hub/govhub/store.py)
- Surface updates in the shell or on a home/overview panel in [app.py](/Users/entrada-mac/Documents/GitHub/governance_hub/app.py)

---

## Phase 3: Later

These are higher-ambition enhancements that can become major differentiators once the
core governance operating model is mature.

### 9. Optional Snapshot / Scale Mode

**Why later**

Snapshots are still a valid optimization pattern, but they should not become the default
architecture for the accelerator. They add install and operational complexity, and they
introduce freshness concerns. They make the most sense as an optional scale mode for
larger client environments once the live-first product is already strong.

**Target outcome**

- large environments can opt into faster inventory/lineage startup
- the default install path remains simple, portable, and live-first

**Implementation notes**

- keep snapshot mode optional and configuration-driven
- preserve direct live reads as the fallback
- clearly surface freshness when snapshot mode is enabled
- snapshot only what materially improves responsiveness

### 10. Lineage Impact Analysis

**Why later**

The current lineage workspace is already useful, but the next-level value is impact
reasoning.

**Target outcome**

- users can answer:
  - what breaks if this asset changes?
  - which critical consumers depend on this?
  - which owners need to be notified?

**Implementation notes**

- Add rollups for critical downstream assets
- Add owner/contact impact summaries
- Add dashboard/report impact once Power BI integration exists

### 11. Richer Domain Personalization

**Why later**

Once role-aware stewardship is stronger, the app can become more tailored to the person
using it.

**Target outcome**

- “my assets”
- “my pending reviews”
- “my domains”
- “my change queue”

**Implementation notes**

- Extend role model beyond global `reader / writer / admin`
- add domain steward / domain writer scopes

### 12. Semantic Discovery

**Why later**

Structured metadata, filters, and scoring should be perfected first. After that, semantic
search becomes compelling.

**Target outcome**

- more forgiving discovery
- better findability for non-technical users

**Implementation notes**

- keep as optional enhancement
- avoid introducing external complexity before the operational metadata model is solid

### 13. Automated Evidence Packaging

**Why later**

The original acceptance criteria call for screenshots, app maps, architecture, and
results documentation. This can be partially automated.

**Target outcome**

- easy generation of evidence packages for stakeholder review or project acceptance

**Implementation notes**

- add screenshot/export automation
- generate a lightweight app map and module inventory from config
- produce a review packet in markdown or PDF

---

## Cross-Cutting Engineering Work

These should happen alongside the phased roadmap, not as isolated work.

### Testing

Add focused tests around the highest-risk logic:

- asset filtering
- self-lineage exclusion
- SDP materialization suppression
- governance score calculation
- change request transitions
- tag/comment mutation preparation logic

### Observability

Add app-operational diagnostics:

- cache freshness
- snapshot freshness
- lineage availability
- OpenMetadata connectivity
- warehouse query failures

### Evidence / Enablement

Add repo artifacts that support rollout and stakeholder review:

- architecture diagram
- sitemap / app map
- screenshot pack
- demo-data / demo-config mode

---

## Recommended Execution Order

If we want the highest total product gain per unit of effort, the recommended order is:

1. Live-path performance and first-impression polish
2. Policies & standards module
3. Stewardship queue / worklist
4. Configurable governance scoring
5. SharePoint integration surface
6. Power BI integration surface
7. ServiceNow integration surface
8. Governance communications / updates
9. Optional snapshot / scale mode
10. Lineage impact analysis
11. Evidence packaging and operational diagnostics

---

## Summary

The accelerator is already strong enough to demonstrate real Databricks-native metadata
product value. The next step is not to reinvent the foundation; it is to extend the
current architecture in the places that most increase credibility as a full governance
hub:

- speed
- policy/documentation presence
- workflow depth
- integration breadth
- operational maturity

That is the path from “strong metadata accelerator” to “enterprise governance operating
surface.”
