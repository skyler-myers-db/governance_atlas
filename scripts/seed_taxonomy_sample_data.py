#!/usr/bin/env python3
"""Seed app-owned Taxonomy North Star evidence in the governance store.

The seed writes real governance-store rows with stable `ga-taxonomy-seed`
identifiers. It does not create workflow tasks, fake quality signals, fake
lineage, or frontend fixtures. Glossary terms are versioned/audited through
GovernanceStore, and taxonomy facets/memberships are persisted in the app
control-plane tables so the UI and Genie read the same evidence.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from atlas.store import GovernanceStore, _utc_now_ts
from atlas.uc import UCSQLClient
from atlas.util import sql_literal


DEFAULT_PROFILE = "DEFAULT"
DEFAULT_WAREHOUSE_ID = "da02d15a9490650b"
DEFAULT_CATALOG = "datapact"
DEFAULT_STORE_SCHEMA = "atlas"
DEFAULT_DEMO_SCHEMA = "governance_atlas_demo"
SEED_ACTOR = "taxonomy-northstar-seed@entrada.ai"
SEED_PREFIX = "ga-taxonomy-seed"


def lit(value: Any) -> str:
    if value is None:
        return "NULL"
    return sql_literal(str(value))


def ts(value: str) -> str:
    return f"timestamp({lit(value)})"


def fq(catalog: str, schema: str, table: str) -> str:
    return f"`{catalog}`.`{schema}`.`{table}`"


@dataclass(frozen=True)
class GlossaryTermSeed:
    term_id: str
    name: str
    definition: str
    domain: str
    owner_email: str
    steward_email: str
    status: str = "approved"
    parent_term_id: str = ""
    synonyms: tuple[str, ...] = ()
    reviewers: tuple[dict[str, str], ...] = field(default_factory=tuple)


TERMS: tuple[GlossaryTermSeed, ...] = (
    GlossaryTermSeed(
        "ga-taxonomy-seed-net-revenue",
        "Net Revenue",
        "Total revenue after deducting returns, refunds, discounts, and other adjustments.",
        "Finance",
        "sarah.johnson@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
        synonyms=("Net Sales", "Revenue, Net"),
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-gross-revenue",
        "Gross Revenue",
        "Total recognized revenue before refunds, discounts, and other deductions.",
        "Finance",
        "sarah.johnson@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-revenue-adjustments",
        "Revenue Adjustments",
        "Approved adjustments that reduce or reclassify recognized revenue.",
        "Finance",
        "miguel.alvarez@entrada.ai",
        "sarah.johnson@entrada.ai",
        status="draft",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-discounts",
        "Discounts",
        "Contractual or promotional reductions applied to gross revenue.",
        "Finance",
        "priya.shah@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-refunds",
        "Refunds",
        "Customer payments returned after billing or transaction reversal.",
        "Finance",
        "james.lee@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-surcharges",
        "Surcharges",
        "Incremental fees applied to billable services or transactional events.",
        "Finance",
        "miguel.alvarez@entrada.ai",
        "sarah.johnson@entrada.ai",
        status="proposed",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-service-revenue",
        "Service Revenue",
        "Revenue recognized from recurring or one-time services.",
        "Finance",
        "sarah.johnson@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-product-revenue",
        "Product Revenue",
        "Revenue recognized from product-level commercial activity.",
        "Finance",
        "andrea.rossi@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-subscription-revenue",
        "Subscription Revenue",
        "Revenue recognized from subscription contracts and renewals.",
        "Finance",
        "priya.shah@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-one-time-revenue",
        "One-Time Revenue",
        "Revenue recognized from non-recurring commercial events.",
        "Finance",
        "andrea.rossi@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-recurring-revenue",
        "Recurring Revenue",
        "Revenue expected to repeat under active customer contracts or subscriptions.",
        "Finance",
        "sarah.johnson@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-contracted-revenue",
        "Contracted Revenue",
        "Revenue governed by signed customer agreements and committed service terms.",
        "Finance",
        "andrea.rossi@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-billable-amount",
        "Billable Amount",
        "Amount eligible for invoicing after service, product, or transaction rules are applied.",
        "Finance",
        "priya.shah@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-deferred-revenue",
        "Deferred Revenue",
        "Customer consideration received before the revenue recognition criteria are satisfied.",
        "Finance",
        "miguel.alvarez@entrada.ai",
        "sarah.johnson@entrada.ai",
        status="draft",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-recognized-revenue",
        "Recognized Revenue",
        "Revenue recorded after the performance obligation and governance recognition rules are met.",
        "Finance",
        "sarah.johnson@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-revenue-forecast",
        "Revenue Forecast",
        "Forward-looking revenue estimate used by planning and executive KPI assets.",
        "Finance",
        "andrea.rossi@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-revenue-recognition-date",
        "Revenue Recognition Date",
        "Business date on which governed revenue is eligible for recognition.",
        "Finance",
        "sarah.johnson@entrada.ai",
        "sarah.johnson@entrada.ai",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-average-revenue",
        "Average Revenue",
        "Average revenue measure used for segment, market, and portfolio analysis.",
        "Finance",
        "priya.shah@entrada.ai",
        "sarah.johnson@entrada.ai",
        status="proposed",
        parent_term_id="ga-taxonomy-node-revenue",
    ),
    GlossaryTermSeed(
        "ga-customer-identifier",
        "Customer Identifier",
        "Business-approved identifier used to recognize and join customer records across governed analytics assets.",
        "Customer",
        "customer-steward@entrada.ai",
        "customer-steward@entrada.ai",
        parent_term_id="ga-taxonomy-node-customer",
        synonyms=("Customer ID", "Customer Key"),
    ),
    GlossaryTermSeed(
        "ga-taxonomy-seed-customer-segment",
        "Customer Segment",
        "Business grouping used for customer analytics and campaign segmentation.",
        "Customer",
        "emily.carter@entrada.ai",
        "customer-steward@entrada.ai",
        parent_term_id="ga-taxonomy-node-customer",
    ),
)


def term_reviewers(term: GlossaryTermSeed) -> list[dict[str, str]]:
    reviewers = [
        {"reviewerEmail": term.steward_email, "reviewerRole": "steward"},
        {"reviewerEmail": "governance-council@entrada.ai", "reviewerRole": "approver"},
    ]
    reviewers.extend(term.reviewers)
    return reviewers


def ensure_optional_columns(store: GovernanceStore) -> None:
    try:
        store.uc.execute(f"ALTER TABLE {store._fq('glossary_terms')} ADD COLUMNS (synonyms_json STRING)")
    except Exception as exc:
        message = str(exc).lower()
        if "already exists" not in message and "duplicate" not in message:
            raise


def merge_classification(store: GovernanceStore, *, classification_id: str, display_name: str, description: str, color: str) -> None:
    now = _utc_now_ts()
    store.uc.execute(
        f"""MERGE INTO {store._fq('classifications')} t
USING (SELECT
  {lit(classification_id)} AS classification_id,
  {lit(display_name)} AS display_name,
  {lit(description)} AS description,
  {lit(color)} AS color,
  FALSE AS is_system,
  'active' AS state,
  {ts(now)} AS updated_at,
  {lit(SEED_ACTOR)} AS updated_by
) s
ON t.classification_id = s.classification_id
WHEN MATCHED THEN UPDATE SET
  display_name=s.display_name, description=s.description, color=s.color,
  is_system=s.is_system, state=s.state, updated_at=s.updated_at,
  updated_by=s.updated_by, retired_at=NULL
WHEN NOT MATCHED THEN INSERT (
  classification_id, display_name, description, color, is_system, state,
  created_at, created_by, updated_at, updated_by, retired_at
) VALUES (
  s.classification_id, s.display_name, s.description, s.color, s.is_system, s.state,
  s.updated_at, s.updated_by, s.updated_at, s.updated_by, NULL
)"""
    )


def merge_classification_term(
    store: GovernanceStore,
    *,
    term_id: str,
    classification_id: str,
    display_name: str,
    description: str,
    parent_term_id: str = "",
    sensitivity_level: str = "internal",
) -> None:
    now = _utc_now_ts()
    store.uc.execute(
        f"""MERGE INTO {store._fq('classification_terms')} t
USING (SELECT
  {lit(term_id)} AS term_id,
  {lit(classification_id)} AS classification_id,
  {lit(parent_term_id or None)} AS parent_term_id,
  {lit(display_name)} AS display_name,
  {lit(description)} AS description,
  {lit(sensitivity_level)} AS sensitivity_level,
  FALSE AS is_system,
  'active' AS state,
  {ts(now)} AS updated_at,
  {lit(SEED_ACTOR)} AS updated_by
) s
ON t.term_id = s.term_id AND t.classification_id = s.classification_id
WHEN MATCHED THEN UPDATE SET
  parent_term_id=s.parent_term_id, display_name=s.display_name,
  description=s.description, sensitivity_level=s.sensitivity_level,
  is_system=s.is_system, state=s.state, updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT (
  term_id, classification_id, parent_term_id, display_name, description,
  sensitivity_level, is_system, state, created_at, created_by, updated_at, updated_by
) VALUES (
  s.term_id, s.classification_id, s.parent_term_id, s.display_name, s.description,
  s.sensitivity_level, s.is_system, s.state, s.updated_at, s.updated_by, s.updated_at, s.updated_by
)"""
    )


def merge_domain(store: GovernanceStore, *, domain_id: str, display_name: str, description: str, parent_domain_id: str = "") -> None:
    now = _utc_now_ts()
    store.uc.execute(
        f"""MERGE INTO {store._fq('domains')} t
USING (SELECT
  {lit(domain_id)} AS domain_id,
  {lit(display_name)} AS display_name,
  {lit(description)} AS description,
  {lit(parent_domain_id or None)} AS parent_domain_id,
  {lit(SEED_ACTOR)} AS owner_entry_id,
  '#29b6f6' AS color,
  'active' AS state,
  {ts(now)} AS updated_at,
  {lit(SEED_ACTOR)} AS updated_by
) s
ON t.domain_id = s.domain_id
WHEN MATCHED THEN UPDATE SET
  display_name=s.display_name, description=s.description, parent_domain_id=s.parent_domain_id,
  owner_entry_id=s.owner_entry_id, color=s.color, state=s.state,
  updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT (
  domain_id, display_name, description, parent_domain_id, owner_entry_id,
  color, state, created_at, created_by, updated_at, updated_by
) VALUES (
  s.domain_id, s.display_name, s.description, s.parent_domain_id, s.owner_entry_id,
  s.color, s.state, s.updated_at, s.updated_by, s.updated_at, s.updated_by
)"""
    )


def merge_data_product(store: GovernanceStore, *, data_product_id: str, display_name: str, description: str, domain_id: str, contact_email: str) -> None:
    now = _utc_now_ts()
    store.uc.execute(
        f"""MERGE INTO {store._fq('data_products')} t
USING (SELECT
  {lit(data_product_id)} AS data_product_id,
  {lit(display_name)} AS display_name,
  {lit(description)} AS description,
  {lit(domain_id)} AS domain_id,
  {lit(contact_email)} AS owner_entry_id,
  {lit(contact_email)} AS contact_email,
  'Reviewed monthly by the domain steward.' AS slo_description,
  'active' AS state,
  {ts(now)} AS updated_at,
  {lit(SEED_ACTOR)} AS updated_by
) s
ON t.data_product_id = s.data_product_id
WHEN MATCHED THEN UPDATE SET
  display_name=s.display_name, description=s.description, domain_id=s.domain_id,
  owner_entry_id=s.owner_entry_id, contact_email=s.contact_email,
  slo_description=s.slo_description, state=s.state,
  updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT (
  data_product_id, display_name, description, domain_id, owner_entry_id,
  contact_email, slo_description, state, created_at, created_by, updated_at, updated_by
) VALUES (
  s.data_product_id, s.display_name, s.description, s.domain_id, s.owner_entry_id,
  s.contact_email, s.slo_description, s.state, s.updated_at, s.updated_by, s.updated_at, s.updated_by
)"""
    )


def insert_data_product_members(store: GovernanceStore, *, product_id: str, assets: Iterable[str]) -> None:
    for asset in assets:
      membership_id = f"{product_id}:{asset}".replace("`", "").replace(".", ":")
      store.uc.execute(
          f"""MERGE INTO {store._fq('data_product_members')} t
USING (SELECT
  {lit(membership_id)} AS membership_id,
  {lit(product_id)} AS data_product_id,
  'asset' AS entity_kind,
  {lit(asset)} AS entity_fqn,
  'primary' AS role,
  {ts(_utc_now_ts())} AS created_at,
  {lit(SEED_ACTOR)} AS created_by
) s
ON t.membership_id = s.membership_id
WHEN MATCHED THEN UPDATE SET
  data_product_id=s.data_product_id, entity_kind=s.entity_kind,
  entity_fqn=s.entity_fqn, role=s.role
WHEN NOT MATCHED THEN INSERT (
  membership_id, data_product_id, entity_kind, entity_fqn, role, created_at, created_by
) VALUES (
  s.membership_id, s.data_product_id, s.entity_kind, s.entity_fqn, s.role, s.created_at, s.created_by
)"""
      )


def merge_column_group(store: GovernanceStore, *, group_id: str, display_name: str, description: str, pattern: str) -> None:
    now = _utc_now_ts()
    store.uc.execute(
        f"""MERGE INTO {store._fq('logical_column_groups')} t
USING (SELECT
  {lit(group_id)} AS group_id,
  {lit(display_name)} AS display_name,
  {lit(description)} AS description,
  {lit(json.dumps({'columnNameRegex': pattern}))} AS match_rule_json,
  0.92D AS confidence,
  {ts(now)} AS last_reviewed_at,
  {lit(SEED_ACTOR)} AS last_reviewed_by,
  'active' AS state,
  {ts(now)} AS updated_at,
  {lit(SEED_ACTOR)} AS updated_by
) s
ON t.group_id = s.group_id
WHEN MATCHED THEN UPDATE SET
  display_name=s.display_name, description=s.description, match_rule_json=s.match_rule_json,
  confidence=s.confidence, last_reviewed_at=s.last_reviewed_at,
  last_reviewed_by=s.last_reviewed_by, state=s.state,
  updated_at=s.updated_at, updated_by=s.updated_by
WHEN NOT MATCHED THEN INSERT (
  group_id, display_name, description, match_rule_json, confidence,
  last_reviewed_at, last_reviewed_by, state, created_at, created_by, updated_at, updated_by
) VALUES (
  s.group_id, s.display_name, s.description, s.match_rule_json, s.confidence,
  s.last_reviewed_at, s.last_reviewed_by, s.state, s.updated_at, s.updated_by, s.updated_at, s.updated_by
)"""
    )


def seed(args: argparse.Namespace) -> dict[str, Any]:
    os.environ["DATABRICKS_CONFIG_PROFILE"] = args.profile
    uc = UCSQLClient(args.warehouse_id)
    store = GovernanceStore(uc=uc, catalog=args.catalog, schema=args.store_schema)
    store.ensure_tables()
    ensure_optional_columns(store)

    for classification_id, display_name, description, color in [
        ("ga-business-taxonomy", "Business", "Business taxonomy hierarchy for governed terms.", "#2fb7ff"),
        ("ga-business-concept", "Business Concept", "Business-facing glossary concepts.", "#21d3a2"),
        ("ga-quantitative", "Quantitative", "Terms that represent numeric or measurable concepts.", "#7c8cff"),
        ("ga-additive", "Additive", "Terms that can be aggregated additively.", "#28c2ff"),
        ("ga-confidential", "Confidential", "Terms that require controlled handling.", "#f59e0b"),
    ]:
        merge_classification(store, classification_id=classification_id, display_name=display_name, description=description, color=color)

    hierarchy_terms = [
        ("ga-taxonomy-node-business", "Business", "", "Top-level governed business taxonomy."),
        ("ga-taxonomy-node-finance", "Finance", "ga-taxonomy-node-business", "Finance-owned business definitions."),
        ("ga-taxonomy-node-revenue", "Revenue", "ga-taxonomy-node-finance", "Revenue recognition and reporting terms."),
        ("ga-taxonomy-node-cost-expense", "Cost & Expense", "ga-taxonomy-node-finance", "Cost and expense reporting terms."),
        ("ga-taxonomy-node-profitability", "Profitability", "ga-taxonomy-node-finance", "Margin and profitability analytics terms."),
        ("ga-taxonomy-node-capital-management", "Capital Management", "ga-taxonomy-node-finance", "Capital allocation and liquidity terms."),
        ("ga-taxonomy-node-customer", "Customer", "ga-taxonomy-node-business", "Customer identity and profile terms."),
        ("ga-taxonomy-node-product", "Product", "ga-taxonomy-node-business", "Product analytics terms."),
        ("ga-taxonomy-node-operations", "Operations", "ga-taxonomy-node-business", "Operational process terms."),
        ("ga-taxonomy-node-risk", "Risk", "ga-taxonomy-node-business", "Risk and control terms."),
        ("ga-taxonomy-node-technology", "Technology", "ga-taxonomy-node-business", "Technology and platform terms."),
        ("ga-taxonomy-node-reference-data", "Reference Data", "ga-taxonomy-node-business", "Shared reference-data terms."),
    ]
    for term_id, label, parent, description in hierarchy_terms:
        merge_classification_term(
            store,
            term_id=term_id,
            classification_id="ga-business-taxonomy",
            display_name=label,
            description=description,
            parent_term_id=parent,
        )

    for domain_id, label in [
        ("finance", "Finance"),
        ("customer", "Customer"),
        ("product", "Product"),
        ("operations", "Operations"),
        ("risk", "Risk"),
        ("technology", "Technology"),
    ]:
        merge_domain(
            store,
            domain_id=domain_id,
            display_name=label,
            description=f"{label} domain seeded for Governance Atlas North Star taxonomy validation.",
        )

    for term in TERMS:
        store.upsert_glossary_term(
            term_id=term.term_id,
            name=term.name,
            definition=term.definition,
            domain=term.domain,
            owner_email=term.owner_email,
            status=term.status,
            updated_by=SEED_ACTOR,
            reviewers=term_reviewers(term),
            change_note="Seeded as app-owned Governance Atlas North Star taxonomy evidence.",
            actor_role="admin",
        )
        store.uc.execute(
            f"""UPDATE {store._fq('glossary_terms')}
SET parent_term_id = {lit(term.parent_term_id or None)},
    synonyms_json = {lit(json.dumps(list(term.synonyms))) if term.synonyms else 'NULL'},
    updated_by = {lit(SEED_ACTOR)}
WHERE term_id = {lit(term.term_id)}"""
        )
        for classification_id in ["ga-business-concept", "ga-quantitative"]:
            merge_classification_term(
                store,
                term_id=term.term_id,
                classification_id=classification_id,
                display_name=term.name,
                description=f"{term.name} classified from app-owned glossary seed.",
            )
        if term.name == "Net Revenue":
            for classification_id in ["ga-additive", "ga-confidential"]:
                merge_classification_term(
                    store,
                    term_id=term.term_id,
                    classification_id=classification_id,
                    display_name=term.name,
                    description=f"{term.name} classified from app-owned glossary seed.",
                )

    demo = lambda name: f"{args.catalog}.{args.demo_schema}.{name}"
    finance_assets = [
        demo("finance_portfolio_exposure"),
        demo("finance_lien_risk_summary"),
        demo("finance_exception_review"),
        demo("product_mortgage_signal"),
        demo("product_market_fit_signal"),
        demo("marketing_market_analytics"),
        demo("marketing_lien_outreach_signal"),
        demo("risk_critical_asset_monitor"),
    ]
    customer_assets = [
        demo("customer_profile_coverage"),
        demo("customer_identity_quality"),
        demo("customer_stewardship_queue"),
    ]
    for data_product_id, display_name, description, domain_id, contact, assets in [
        ("ga-financial-reporting", "Financial Reporting", "Certified revenue and finance reporting assets.", "finance", "finance-ops@entrada.ai", finance_assets),
        ("ga-executive-kpis", "Executive KPIs", "Executive finance metrics and KPI assets.", "finance", "fpna@entrada.ai", finance_assets),
        ("ga-revenue-analytics", "Revenue Analytics", "Revenue analytics assets and semantic definitions.", "finance", "revenue-ops@entrada.ai", finance_assets),
        ("ga-customer-360", "Customer 360", "Customer profile and identity assets.", "customer", "customer-steward@entrada.ai", customer_assets),
    ]:
        merge_data_product(
            store,
            data_product_id=data_product_id,
            display_name=display_name,
            description=description,
            domain_id=domain_id,
            contact_email=contact,
        )
        insert_data_product_members(store, product_id=data_product_id, assets=assets)

    merge_column_group(
        store,
        group_id="ga-revenue-columns",
        display_name="Revenue Columns",
        description="Columns matching revenue, amount, and adjustment semantics.",
        pattern="(?i)(revenue|amount|refund|discount|surcharge)",
    )
    merge_column_group(
        store,
        group_id="ga-customer-identity-columns",
        display_name="Customer Identity Columns",
        description="Columns matching customer identifier semantics.",
        pattern="(?i)(customer|owner|identifier|id)",
    )

    link_plan = {
        demo("finance_portfolio_exposure"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-gross-revenue", "sourceValue": "Gross Revenue"},
        ],
        demo("finance_lien_risk_summary"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-discounts", "sourceValue": "Discounts"},
        ],
        demo("finance_exception_review"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-revenue-adjustments", "sourceValue": "Revenue Adjustments"},
            {"termId": "ga-taxonomy-seed-refunds", "sourceValue": "Refunds"},
        ],
        demo("product_mortgage_signal"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-contracted-revenue", "sourceValue": "Contracted Revenue"},
        ],
        demo("product_market_fit_signal"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-average-revenue", "sourceValue": "Average Revenue"},
        ],
        demo("marketing_market_analytics"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-revenue-forecast", "sourceValue": "Revenue Forecast"},
        ],
        demo("marketing_lien_outreach_signal"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-billable-amount", "sourceValue": "Billable Amount"},
        ],
        demo("risk_critical_asset_monitor"): [
            {"termId": "ga-taxonomy-seed-net-revenue", "sourceValue": "Net Revenue"},
            {"termId": "ga-taxonomy-seed-recognized-revenue", "sourceValue": "Recognized Revenue"},
        ],
        demo("customer_profile_coverage"): [
            {"termId": "ga-customer-identifier", "sourceValue": "Customer Identifier"},
            {"termId": "ga-taxonomy-seed-customer-segment", "sourceValue": "Customer Segment"},
        ],
        demo("customer_identity_quality"): [
            {"termId": "ga-customer-identifier", "sourceValue": "Customer Identifier"},
        ],
    }
    for asset_fqn, refs in link_plan.items():
        store.replace_glossary_term_links(
            subject_type="asset",
            subject_fqn=asset_fqn,
            term_refs=[{**ref, "source": "northstar_seed"} for ref in refs],
            updated_by=SEED_ACTOR,
            source="northstar_seed",
        )

    for term in TERMS:
        store.refresh_glossary_summary_projection(term_id=term.term_id, updated_by=SEED_ACTOR)

    return {
        "catalog": args.catalog,
        "storeSchema": args.store_schema,
        "terms": len(TERMS),
        "classifications": 5,
        "domains": 6,
        "dataProducts": 4,
        "columnGroups": 2,
        "seedActor": SEED_ACTOR,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--warehouse-id", default=DEFAULT_WAREHOUSE_ID)
    parser.add_argument("--catalog", default=DEFAULT_CATALOG)
    parser.add_argument("--store-schema", default=DEFAULT_STORE_SCHEMA)
    parser.add_argument("--demo-schema", default=DEFAULT_DEMO_SCHEMA)
    args = parser.parse_args()
    print(json.dumps(seed(args), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
