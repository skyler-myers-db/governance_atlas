from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from .util import quote_ident, sql_literal


def _utc_now_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    statements: tuple[str, ...] = ()


DEFAULT_MIGRATIONS: tuple[Migration, ...] = (
    Migration(version=1, name="baseline_governance_schema"),
    Migration(
        version=2,
        name="metadata_audit_log",
        statements=(
            """CREATE TABLE IF NOT EXISTS {table} (
                audit_id     STRING NOT NULL,
                entity_type  STRING NOT NULL COMMENT 'asset | column | glossary_term | change_request | owner_assignment',
                entity_id    STRING,
                entity_fqn   STRING,
                column_name  STRING,
                action       STRING NOT NULL,
                source       STRING COMMENT 'api | store | uc',
                status       STRING COMMENT 'success | rejected | failed',
                before_json  STRING,
                after_json   STRING,
                request_id   STRING,
                actor_email  STRING,
                actor_role   STRING,
                detail       STRING,
                created_at   TIMESTAMP,
                created_by   STRING,
                updated_at   TIMESTAMP,
                updated_by   STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=3,
        name="glossary_term_links",
        statements=(
            """CREATE TABLE IF NOT EXISTS {glossary_links_table} (
                link_id STRING NOT NULL,
                term_id STRING,
                subject_type STRING NOT NULL COMMENT 'asset | column',
                subject_fqn STRING NOT NULL COMMENT 'catalog.schema.table',
                column_name STRING,
                is_primary BOOLEAN,
                source STRING COMMENT 'manual | uc_tag | migration',
                source_value STRING,
                resolution_state STRING COMMENT 'resolved | unresolved | removed',
                created_at TIMESTAMP,
                created_by STRING,
                updated_at TIMESTAMP,
                updated_by STRING,
                removed_at TIMESTAMP,
                removed_by STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=4,
        name="identity_directory_and_entity_registry",
        statements=(
            """CREATE TABLE IF NOT EXISTS {identity_directory_table} (
                entry_id       STRING NOT NULL,
                external_key   STRING NOT NULL,
                principal_type STRING NOT NULL COMMENT 'user | group',
                display_name   STRING,
                email          STRING,
                is_active      BOOLEAN,
                source         STRING,
                attributes_json STRING,
                synced_at      TIMESTAMP,
                created_at     TIMESTAMP,
                created_by     STRING,
                updated_at     TIMESTAMP,
                updated_by     STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {entity_registry_table} (
                entity_id              STRING NOT NULL,
                entity_kind            STRING NOT NULL,
                entity_fqn             STRING,
                source_system          STRING,
                source_entity_id      STRING,
                reconciliation_state   STRING COMMENT 'matched | ambiguous | orphaned',
                reconciliation_confidence DOUBLE,
                observed_at            TIMESTAMP,
                created_at             TIMESTAMP,
                created_by             STRING,
                updated_at             TIMESTAMP,
                updated_by             STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {entity_aliases_table} (
                alias_id     STRING NOT NULL,
                entity_id    STRING NOT NULL,
                alias_type   STRING NOT NULL COMMENT 'fqn | name | location | external_id',
                alias_value  STRING NOT NULL,
                source       STRING,
                created_at   TIMESTAMP,
                created_by   STRING,
                updated_at   TIMESTAMP,
                updated_by   STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=5,
        name="governance_threads_tasks_activity",
        statements=(
            """CREATE TABLE IF NOT EXISTS {threads_table} (
                thread_id            STRING NOT NULL,
                entity_id            STRING,
                entity_fqn_snapshot  STRING,
                column_name          STRING,
                thread_type          STRING COMMENT 'task_request | conversation',
                status               STRING COMMENT 'open | resolved | rejected',
                created_by_entry_id  STRING,
                created_at           TIMESTAMP,
                updated_at           TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {thread_posts_table} (
                post_id               STRING NOT NULL,
                thread_id             STRING NOT NULL,
                body_markdown         STRING,
                diff_json             STRING,
                created_by_entry_id   STRING,
                created_at            TIMESTAMP,
                edited_at             TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {tasks_table} (
                task_id                STRING NOT NULL,
                thread_id              STRING NOT NULL,
                entity_id              STRING,
                entity_fqn_snapshot    STRING,
                column_name            STRING,
                task_type              STRING COMMENT 'description_change | tag_change | glossary_link_change | metadata_change_request',
                diff_before_json       STRING,
                diff_after_json        STRING,
                requested_payload_json STRING,
                assignee_entry_id      STRING,
                reviewer_entry_id      STRING,
                due_at                 TIMESTAMP,
                status                 STRING COMMENT 'open | acknowledged | in_progress | blocked | resolved | closed | rejected',
                resolution_code        STRING,
                resolved_payload_json  STRING,
                expected_version       BIGINT,
                created_at             TIMESTAMP,
                updated_at             TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {activity_events_table} (
                event_id              STRING NOT NULL,
                event_type            STRING NOT NULL,
                entity_id             STRING,
                entity_fqn_snapshot   STRING,
                column_name           STRING,
                actor_entry_id        STRING,
                thread_id             STRING,
                task_id               STRING,
                payload_json          STRING,
                created_at            TIMESTAMP
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=6,
        name="governance_notification_inbox",
        statements=(
            """CREATE TABLE IF NOT EXISTS {notifications_table} (
                notification_id STRING NOT NULL,
                event_id        STRING NOT NULL,
                channel         STRING NOT NULL COMMENT 'in_app | email',
                delivery_state  STRING COMMENT 'new | delivered | failed',
                payload_json    STRING,
                created_at      TIMESTAMP,
                sent_at         TIMESTAMP,
                failed_at       TIMESTAMP,
                retry_count     BIGINT
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {notification_receipts_table} (
                notification_id    STRING NOT NULL,
                recipient_entry_id STRING NOT NULL,
                inbox_state        STRING COMMENT 'new | seen | read | dismissed',
                seen_at            TIMESTAMP,
                read_at            TIMESTAMP,
                dismissed_at       TIMESTAMP,
                delivered_at       TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {notification_preferences_table} (
                entry_id      STRING NOT NULL,
                event_family  STRING NOT NULL,
                channel       STRING NOT NULL,
                muted_until   TIMESTAMP,
                scope_json    STRING,
                updated_at    TIMESTAMP
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=7,
        name="governance_summary_projections",
        statements=(
            """CREATE TABLE IF NOT EXISTS {governance_queue_projection_table} (
                scope_key        STRING NOT NULL,
                lane_counts_json STRING,
                open_task_count  BIGINT,
                observed_at      TIMESTAMP,
                stale_after      TIMESTAMP,
                created_at       TIMESTAMP,
                created_by       STRING,
                updated_at       TIMESTAMP,
                updated_by       STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {glossary_summary_projection_table} (
                term_id         STRING NOT NULL,
                asset_count     BIGINT,
                child_count     BIGINT,
                reviewer_count  BIGINT,
                observed_at     TIMESTAMP,
                stale_after     TIMESTAMP,
                created_at      TIMESTAMP,
                created_by      STRING,
                updated_at      TIMESTAMP,
                updated_by      STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=8,
        name="change_events_and_entity_versions",
        statements=(
            # Phase 5 Tranche A: change_events — append-only event stream
            # capturing every governance-relevant mutation for projections,
            # notifications, and compliance audit consumers.
            """CREATE TABLE IF NOT EXISTS {change_events_table} (
                event_id       STRING NOT NULL,
                event_type     STRING NOT NULL COMMENT 'asset.metadata.updated | column.tags.updated | glossary.term.upserted | request.approved | owner.assigned | ...',
                entity_kind    STRING COMMENT 'asset | column | glossary_term | change_request | owner_assignment',
                entity_id      STRING,
                entity_fqn     STRING,
                column_name    STRING,
                actor_email    STRING,
                actor_role     STRING,
                before_json    STRING,
                after_json     STRING,
                detail         STRING,
                source         STRING COMMENT 'api | store | uc | system',
                status         STRING COMMENT 'emitted | suppressed | failed',
                request_id     STRING,
                occurred_at    TIMESTAMP NOT NULL,
                recorded_at    TIMESTAMP
            ) USING DELTA""",
            # change_event_consumers + offsets: lets projection builders and
            # notification fan-out resume from a known watermark.
            """CREATE TABLE IF NOT EXISTS {change_event_consumers_table} (
                consumer_id       STRING NOT NULL,
                consumer_kind     STRING NOT NULL COMMENT 'projection | notification | audit',
                display_name      STRING,
                is_active         BOOLEAN,
                created_at        TIMESTAMP,
                updated_at        TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {change_event_consumer_offsets_table} (
                consumer_id       STRING NOT NULL,
                last_event_id     STRING,
                last_occurred_at  TIMESTAMP,
                lag_seconds       BIGINT,
                updated_at        TIMESTAMP
            ) USING DELTA""",
            # entity_versions: point-in-time snapshots of governed metadata so
            # the audit surface + entity history tab can answer "what did this
            # record look like on <date>?" without replaying change_events.
            """CREATE TABLE IF NOT EXISTS {entity_versions_table} (
                version_id      STRING NOT NULL,
                entity_kind     STRING NOT NULL,
                entity_id       STRING,
                entity_fqn      STRING,
                version_number  BIGINT,
                snapshot_json   STRING,
                change_event_id STRING,
                recorded_by     STRING,
                recorded_at     TIMESTAMP NOT NULL
            ) USING DELTA""",
            # entity_relationships: catch-all for relationship kinds that
            # don't yet have a specialized table. Paired with the
            # Relationship Source-of-Truth Matrix in code (Phase 5 Tranche A
            # authority-column rule) — see atlas/services/registry.py.
            """CREATE TABLE IF NOT EXISTS {entity_relationships_table} (
                relationship_id       STRING NOT NULL,
                relationship_kind     STRING NOT NULL,
                source_entity_id      STRING NOT NULL,
                source_entity_kind    STRING,
                target_entity_id      STRING NOT NULL,
                target_entity_kind    STRING,
                authority_source      STRING COMMENT 'registry | uc | audit_log | override',
                evidence_json         STRING,
                state                 STRING COMMENT 'active | superseded | suppressed',
                created_at            TIMESTAMP,
                created_by            STRING,
                updated_at            TIMESTAMP,
                updated_by            STRING,
                superseded_at         TIMESTAMP,
                superseded_by         STRING
            ) USING DELTA""",
            # identity_directory_memberships: group membership for the
            # identity directory. Enables role/group-aware visibility checks
            # once SCIM sync lands.
            """CREATE TABLE IF NOT EXISTS {identity_directory_memberships_table} (
                membership_id   STRING NOT NULL,
                member_entry_id STRING NOT NULL COMMENT 'identity_directory_entries.entry_id',
                group_entry_id  STRING NOT NULL COMMENT 'identity_directory_entries.entry_id',
                role            STRING,
                source          STRING,
                synced_at       TIMESTAMP,
                created_at      TIMESTAMP,
                created_by      STRING,
                updated_at      TIMESTAMP,
                updated_by      STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=9,
        name="export_jobs",
        statements=(
            # Phase 4 Tranche 2 / Phase 12 — export_jobs tracks every
            # governed-metadata export so the admin diagnostics surface
            # can answer "what's been exported, by whom, when, and is it
            # still downloadable?" No raw OBO tokens are stored;
            # token_captured_at is a timestamp we compare against the
            # 55-minute stale-auth threshold before materializing or
            # re-downloading an export.
            """CREATE TABLE IF NOT EXISTS {export_jobs_table} (
                job_id                STRING NOT NULL,
                actor_email           STRING NOT NULL,
                actor_role            STRING,
                asset_fqns            ARRAY<STRING>,
                filter_snapshot_json  STRING,
                format                STRING COMMENT 'csv | json',
                mode                  STRING COMMENT 'sync | async',
                status                STRING COMMENT 'queued | materializing | ready | stale_auth | failed | expired',
                requested_at          TIMESTAMP NOT NULL,
                token_captured_at     TIMESTAMP COMMENT 'UTC when the request OBO token was captured; null for app-principal exports',
                materialized_at       TIMESTAMP,
                expires_at            TIMESTAMP,
                download_url          STRING,
                row_count             BIGINT,
                byte_count            BIGINT,
                checksum               STRING,
                error_detail          STRING,
                created_at            TIMESTAMP,
                created_by            STRING,
                updated_at            TIMESTAMP,
                updated_by            STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=10,
        name="background_work_and_dead_letters",
        statements=(
            # Phase 12 — background work queue. Async work items are
            # materialized by a runner that polls this table; no raw
            # tokens are persisted. actor_email + token_captured_at are
            # the only identity bridge back to the requester; the runner
            # uses app-principal auth to actually execute the work.
            """CREATE TABLE IF NOT EXISTS {background_work_items_table} (
                work_id              STRING NOT NULL,
                work_kind            STRING NOT NULL COMMENT 'export | profile | classification_probe | projection_rebuild',
                priority             BIGINT,
                status               STRING COMMENT 'queued | running | succeeded | failed | cancelled',
                payload_json         STRING,
                dependency_work_id   STRING,
                actor_email          STRING,
                actor_role           STRING,
                token_captured_at    TIMESTAMP,
                scheduled_for        TIMESTAMP,
                claimed_at           TIMESTAMP,
                claimed_by           STRING,
                started_at           TIMESTAMP,
                finished_at          TIMESTAMP,
                attempt_count        BIGINT,
                max_attempts         BIGINT,
                last_error           STRING,
                result_json          STRING,
                created_at           TIMESTAMP,
                created_by           STRING,
                updated_at           TIMESTAMP,
                updated_by           STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {background_work_runs_table} (
                run_id          STRING NOT NULL,
                work_id         STRING NOT NULL,
                attempt_number  BIGINT,
                status          STRING COMMENT 'started | succeeded | failed | abandoned',
                started_at      TIMESTAMP NOT NULL,
                finished_at     TIMESTAMP,
                error_detail    STRING,
                stats_json      STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {background_dead_letters_table} (
                dead_letter_id  STRING NOT NULL,
                work_id         STRING,
                work_kind       STRING,
                payload_json    STRING,
                error_detail    STRING,
                recorded_at     TIMESTAMP NOT NULL,
                retried_at      TIMESTAMP,
                resolution      STRING COMMENT 'pending | retried | abandoned'
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=11,
        name="custom_properties_and_profile",
        statements=(
            # Phase 8 — custom properties schema + versioning + assignments.
            # Definitions are typed (string/number/boolean/date/enum) and
            # versioned so that renaming/retyping a property preserves
            # historical assignment validity.
            """CREATE TABLE IF NOT EXISTS {custom_property_definitions_table} (
                definition_id    STRING NOT NULL,
                entity_kind      STRING NOT NULL COMMENT 'asset | column | glossary_term',
                property_key     STRING NOT NULL,
                display_name     STRING,
                description      STRING,
                data_type        STRING NOT NULL COMMENT 'string | number | boolean | date | enum | markdown',
                enum_values_json STRING,
                is_required      BOOLEAN,
                is_multi         BOOLEAN,
                scope_json       STRING COMMENT 'optional scope restrictions (catalog/schema patterns)',
                state            STRING COMMENT 'active | retired',
                created_at       TIMESTAMP,
                created_by       STRING,
                updated_at       TIMESTAMP,
                updated_by       STRING,
                retired_at       TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {custom_property_definition_versions_table} (
                version_id       STRING NOT NULL,
                definition_id    STRING NOT NULL,
                version_number   BIGINT NOT NULL,
                snapshot_json    STRING NOT NULL,
                change_summary   STRING,
                recorded_by      STRING,
                recorded_at      TIMESTAMP NOT NULL
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {custom_property_assignments_table} (
                assignment_id       STRING NOT NULL,
                definition_id       STRING NOT NULL,
                definition_version  BIGINT,
                entity_kind         STRING NOT NULL,
                entity_id           STRING,
                entity_fqn          STRING,
                column_name         STRING,
                value_json          STRING,
                source              STRING COMMENT 'manual | import | rule',
                created_at          TIMESTAMP,
                created_by          STRING,
                updated_at          TIMESTAMP,
                updated_by          STRING,
                removed_at          TIMESTAMP,
                removed_by          STRING
            ) USING DELTA""",
            # Phase 8 — profile persistence. profile_runs is the per-run
            # envelope; the two metric tables are a star-schema children.
            """CREATE TABLE IF NOT EXISTS {profile_runs_table} (
                profile_run_id     STRING NOT NULL,
                entity_kind        STRING NOT NULL,
                entity_id          STRING,
                entity_fqn         STRING,
                trigger            STRING COMMENT 'manual | scheduled | system',
                status             STRING COMMENT 'running | succeeded | failed | partial',
                sample_strategy    STRING COMMENT 'full | approx | sampled',
                sample_rows        BIGINT,
                started_at         TIMESTAMP NOT NULL,
                finished_at        TIMESTAMP,
                error_detail       STRING,
                notes              STRING,
                created_at         TIMESTAMP,
                created_by         STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {profile_table_metrics_table} (
                metric_id         STRING NOT NULL,
                profile_run_id    STRING NOT NULL,
                entity_fqn        STRING NOT NULL,
                row_count         BIGINT,
                size_bytes        BIGINT,
                partition_count   BIGINT,
                distinct_keys     BIGINT,
                observed_at       TIMESTAMP NOT NULL,
                detail_json       STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {profile_column_metrics_table} (
                metric_id         STRING NOT NULL,
                profile_run_id    STRING NOT NULL,
                entity_fqn        STRING NOT NULL,
                column_name       STRING NOT NULL,
                data_type         STRING,
                null_count        BIGINT,
                null_fraction     DOUBLE,
                distinct_count    BIGINT,
                distinct_fraction DOUBLE,
                min_value         STRING,
                max_value         STRING,
                mean_value        DOUBLE,
                stddev_value      DOUBLE,
                quantiles_json    STRING,
                top_values_json   STRING COMMENT 'redaction-gated top-k values; omit for classified-sensitive',
                observed_at       TIMESTAMP NOT NULL,
                detail_json       STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=12,
        name="quality_core",
        statements=(
            # Phase 10 — quality definitions + suites + runs + alerts.
            # quality_test_definitions declares the contract; versions
            # preserve history; suites bundle tests; test_cases bind a
            # suite entry to a concrete entity; runs record executions;
            # run_results hold per-case outcomes; alerts fan out from
            # failing runs.
            """CREATE TABLE IF NOT EXISTS {quality_test_definitions_table} (
                definition_id     STRING NOT NULL,
                test_key          STRING NOT NULL COMMENT 'row_count | freshness | null_count | null_fraction | unique | accepted_values | regex | min_max | schema_column_presence | custom_sql | table_comparison',
                display_name      STRING,
                description       STRING,
                parameters_schema_json STRING,
                severity_default  STRING COMMENT 'info | warn | error | critical',
                state             STRING COMMENT 'active | retired',
                created_at        TIMESTAMP,
                created_by        STRING,
                updated_at        TIMESTAMP,
                updated_by        STRING,
                retired_at        TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {quality_test_definition_versions_table} (
                version_id     STRING NOT NULL,
                definition_id  STRING NOT NULL,
                version_number BIGINT NOT NULL,
                snapshot_json  STRING NOT NULL,
                change_summary STRING,
                recorded_by    STRING,
                recorded_at    TIMESTAMP NOT NULL
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {quality_suites_table} (
                suite_id      STRING NOT NULL,
                display_name  STRING NOT NULL,
                description   STRING,
                owner_entry_id STRING,
                state         STRING COMMENT 'active | paused | retired',
                created_at    TIMESTAMP,
                created_by    STRING,
                updated_at    TIMESTAMP,
                updated_by    STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {quality_test_cases_table} (
                case_id          STRING NOT NULL,
                suite_id         STRING NOT NULL,
                definition_id    STRING NOT NULL,
                definition_version BIGINT,
                entity_kind      STRING,
                entity_fqn       STRING NOT NULL,
                column_name      STRING,
                parameters_json  STRING,
                severity         STRING,
                is_enabled       BOOLEAN,
                created_at       TIMESTAMP,
                created_by       STRING,
                updated_at       TIMESTAMP,
                updated_by       STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {quality_runs_table} (
                run_id           STRING NOT NULL,
                suite_id         STRING,
                trigger          STRING COMMENT 'manual | scheduled | pipeline',
                status           STRING COMMENT 'running | succeeded | partial | failed',
                started_at       TIMESTAMP NOT NULL,
                finished_at      TIMESTAMP,
                row_budget       BIGINT,
                byte_budget      BIGINT,
                time_budget_ms   BIGINT,
                error_detail     STRING,
                summary_json     STRING,
                created_at       TIMESTAMP,
                created_by       STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {quality_run_results_table} (
                result_id         STRING NOT NULL,
                run_id            STRING NOT NULL,
                case_id           STRING NOT NULL,
                entity_fqn        STRING,
                column_name       STRING,
                outcome           STRING COMMENT 'passed | failed | errored | skipped',
                severity          STRING,
                metric_value      DOUBLE,
                threshold_value   DOUBLE,
                evidence_json     STRING COMMENT 'redaction-gated evidence; no raw row samples unless allowed',
                statement_id      STRING,
                row_bytes_scanned BIGINT,
                executed_at       TIMESTAMP NOT NULL,
                detail            STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {quality_alerts_table} (
                alert_id       STRING NOT NULL,
                run_id         STRING,
                case_id        STRING,
                entity_fqn     STRING,
                column_name    STRING,
                severity       STRING,
                state          STRING COMMENT 'new | acknowledged | resolved | muted',
                acknowledged_by STRING,
                acknowledged_at TIMESTAMP,
                resolved_by    STRING,
                resolved_at    TIMESTAMP,
                detail         STRING,
                created_at     TIMESTAMP NOT NULL,
                updated_at     TIMESTAMP
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=13,
        name="breadth_classifications_domains_products",
        statements=(
            # Phase 11 — classifications: multi-level taxonomy for
            # sensitive/PII/financial categorization. Terms are the leaf
            # entries; classifications are the grouping.
            """CREATE TABLE IF NOT EXISTS {classifications_table} (
                classification_id STRING NOT NULL,
                display_name     STRING NOT NULL,
                description      STRING,
                color            STRING,
                is_system        BOOLEAN,
                state            STRING COMMENT 'active | retired',
                created_at       TIMESTAMP,
                created_by       STRING,
                updated_at       TIMESTAMP,
                updated_by       STRING,
                retired_at       TIMESTAMP
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {classification_terms_table} (
                term_id          STRING NOT NULL,
                classification_id STRING NOT NULL,
                parent_term_id   STRING,
                display_name     STRING NOT NULL,
                description      STRING,
                sensitivity_level STRING COMMENT 'public | internal | confidential | restricted',
                is_system        BOOLEAN,
                state            STRING,
                created_at       TIMESTAMP,
                created_by       STRING,
                updated_at       TIMESTAMP,
                updated_by       STRING
            ) USING DELTA""",
            # Phase 11 — domains + data products.
            """CREATE TABLE IF NOT EXISTS {domains_table} (
                domain_id     STRING NOT NULL,
                display_name  STRING NOT NULL,
                description   STRING,
                parent_domain_id STRING,
                owner_entry_id STRING,
                color         STRING,
                state         STRING,
                created_at    TIMESTAMP,
                created_by    STRING,
                updated_at    TIMESTAMP,
                updated_by    STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {data_products_table} (
                data_product_id STRING NOT NULL,
                display_name    STRING NOT NULL,
                description     STRING,
                domain_id       STRING,
                owner_entry_id  STRING,
                contact_email   STRING,
                slo_description STRING,
                state           STRING COMMENT 'draft | active | deprecated',
                created_at      TIMESTAMP,
                created_by      STRING,
                updated_at      TIMESTAMP,
                updated_by      STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {data_product_members_table} (
                membership_id   STRING NOT NULL,
                data_product_id STRING NOT NULL,
                entity_kind     STRING COMMENT 'asset | model | metric | contract',
                entity_fqn      STRING NOT NULL,
                role            STRING COMMENT 'primary | consumer | derived',
                created_at      TIMESTAMP,
                created_by      STRING
            ) USING DELTA""",
            # Phase 11 — logical column groups + members for bulk operations.
            """CREATE TABLE IF NOT EXISTS {logical_column_groups_table} (
                group_id         STRING NOT NULL,
                display_name     STRING NOT NULL,
                description      STRING,
                match_rule_json  STRING COMMENT 'declarative match rule — column-name regex + type filter',
                confidence       DOUBLE,
                last_reviewed_at TIMESTAMP,
                last_reviewed_by STRING,
                state            STRING,
                created_at       TIMESTAMP,
                created_by       STRING,
                updated_at       TIMESTAMP,
                updated_by       STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {logical_column_group_members_table} (
                membership_id   STRING NOT NULL,
                group_id        STRING NOT NULL,
                entity_fqn      STRING NOT NULL,
                column_name     STRING NOT NULL,
                column_data_type STRING,
                current_description STRING,
                current_tags_json STRING,
                current_glossary_term_id STRING,
                match_confidence DOUBLE,
                last_seen_at    TIMESTAMP,
                created_at      TIMESTAMP,
                created_by      STRING
            ) USING DELTA""",
            # Phase 11 — metrics + contracts (scale routes).
            """CREATE TABLE IF NOT EXISTS {metrics_table} (
                metric_id       STRING NOT NULL,
                display_name    STRING NOT NULL,
                description     STRING,
                definition_sql  STRING,
                unit            STRING,
                owner_entry_id  STRING,
                reviewer_entry_ids_json STRING COMMENT 'array of reviewer entry ids',
                data_product_id STRING,
                state           STRING COMMENT 'draft | active | deprecated',
                created_at      TIMESTAMP,
                created_by      STRING,
                updated_at      TIMESTAMP,
                updated_by      STRING
            ) USING DELTA""",
            """CREATE TABLE IF NOT EXISTS {contracts_table} (
                contract_id     STRING NOT NULL,
                display_name    STRING NOT NULL,
                description     STRING,
                contract_kind   STRING COMMENT 'schema | freshness | quality | availability',
                entity_fqn      STRING,
                version_number  BIGINT,
                owner_entry_id  STRING,
                reviewer_entry_ids_json STRING,
                data_product_id STRING,
                terms_json      STRING,
                state           STRING COMMENT 'draft | active | superseded | retired',
                effective_from  TIMESTAMP,
                effective_until TIMESTAMP,
                created_at      TIMESTAMP,
                created_by      STRING,
                updated_at      TIMESTAMP,
                updated_by      STRING
            ) USING DELTA""",
        ),
    ),
    Migration(
        version=14,
        name="reserved_identity_cleanup_noop",
        statements=(),
    ),
    Migration(
        version=15,
        name="classification_recommendations",
        statements=(
            # A9.4 — Classification Recommendation Workflow.
            # Steward-reviewed queue of suggested column classifications
            # with evidence. On approve, the approved classification is
            # written as a Databricks column tag via the existing UC tag
            # API; this table is the source of truth for the review
            # lifecycle and audit trail. Remediation suggestions are
            # informational only — no auto-policy writes.
            """CREATE TABLE IF NOT EXISTS {classification_recommendations_table} (
                recommendation_id STRING NOT NULL,
                asset_fqn STRING NOT NULL,
                column_name STRING NOT NULL,
                suggested_sensitivity STRING,
                suggested_tier STRING,
                suggested_certification STRING,
                evidence_json STRING COMMENT 'JSON array of evidence objects (source, pattern|tag|comment|glossary, confidence)',
                sample_redacted BOOLEAN,
                sample_values_json STRING COMMENT 'JSON array of sample values; empty/masked when sample_redacted=true',
                status STRING COMMENT 'pending | approved | rejected | deferred',
                remediation_suggestions_json STRING COMMENT 'JSON array of informational remediation suggestions',
                review_note STRING,
                reviewed_by STRING,
                reviewed_at TIMESTAMP,
                created_at TIMESTAMP,
                created_by STRING,
                updated_at TIMESTAMP,
                updated_by STRING
            ) USING DELTA""",
        ),
    ),
)


def _fq_schema(catalog: str, schema: str) -> str:
    return f"{quote_ident(catalog)}.{quote_ident(schema)}"


def _fq_table(catalog: str, schema: str, table: str) -> str:
    return f"{_fq_schema(catalog, schema)}.{quote_ident(table)}"


def ensure_schema_migrations_table(uc, catalog: str, schema: str) -> None:
    uc.execute(f"CREATE SCHEMA IF NOT EXISTS {_fq_schema(catalog, schema)}")
    uc.execute(
        f"""CREATE TABLE IF NOT EXISTS {_fq_table(catalog, schema, "schema_migrations")} (
            version BIGINT NOT NULL,
            name STRING NOT NULL,
            applied_at TIMESTAMP NOT NULL
        ) USING DELTA"""
    )


def applied_versions(uc, catalog: str, schema: str) -> set[int]:
    ensure_schema_migrations_table(uc, catalog, schema)
    try:
        frame = uc.query_df(
            f"SELECT version FROM {_fq_table(catalog, schema, 'schema_migrations')} ORDER BY version"
        )
    except Exception:
        return set()
    if frame is None or frame.empty:
        return set()
    versions: set[int] = set()
    for value in frame["version"].tolist():
        try:
            versions.add(int(value))
        except (TypeError, ValueError):
            continue
    return versions


def apply_migrations(
    uc,
    catalog: str,
    schema: str,
    migrations: Sequence[Migration] | None = None,
) -> list[int]:
    ensure_schema_migrations_table(uc, catalog, schema)
    completed = applied_versions(uc, catalog, schema)
    applied: list[int] = []
    for migration in migrations or DEFAULT_MIGRATIONS:
        if migration.version in completed:
            continue
        for statement in migration.statements:
            sql = statement.format(
                catalog=quote_ident(catalog),
                schema=quote_ident(schema),
                schema_fq=_fq_schema(catalog, schema),
                table=_fq_table(catalog, schema, "metadata_audit_log"),
                metadata_audit_table=_fq_table(catalog, schema, "metadata_audit_log"),
                data_owners_table=_fq_table(catalog, schema, "data_owners"),
                glossary_links_table=_fq_table(catalog, schema, "glossary_term_links"),
                identity_directory_table=_fq_table(catalog, schema, "identity_directory_entries"),
                entity_registry_table=_fq_table(catalog, schema, "entity_registry"),
                entity_aliases_table=_fq_table(catalog, schema, "entity_aliases"),
                threads_table=_fq_table(catalog, schema, "threads"),
                thread_posts_table=_fq_table(catalog, schema, "thread_posts"),
                tasks_table=_fq_table(catalog, schema, "tasks"),
                activity_events_table=_fq_table(catalog, schema, "activity_events"),
                notifications_table=_fq_table(catalog, schema, "notifications"),
                notification_receipts_table=_fq_table(catalog, schema, "notification_receipts"),
                notification_preferences_table=_fq_table(catalog, schema, "notification_preferences"),
                governance_queue_projection_table=_fq_table(catalog, schema, "governance_queue_projection"),
                glossary_summary_projection_table=_fq_table(catalog, schema, "glossary_summary_projection"),
                change_events_table=_fq_table(catalog, schema, "change_events"),
                change_event_consumers_table=_fq_table(catalog, schema, "change_event_consumers"),
                change_event_consumer_offsets_table=_fq_table(catalog, schema, "change_event_consumer_offsets"),
                entity_versions_table=_fq_table(catalog, schema, "entity_versions"),
                entity_relationships_table=_fq_table(catalog, schema, "entity_relationships"),
                identity_directory_memberships_table=_fq_table(catalog, schema, "identity_directory_memberships"),
                export_jobs_table=_fq_table(catalog, schema, "export_jobs"),
                background_work_items_table=_fq_table(catalog, schema, "background_work_items"),
                background_work_runs_table=_fq_table(catalog, schema, "background_work_runs"),
                background_dead_letters_table=_fq_table(catalog, schema, "background_dead_letters"),
                custom_property_definitions_table=_fq_table(catalog, schema, "custom_property_definitions"),
                custom_property_definition_versions_table=_fq_table(catalog, schema, "custom_property_definition_versions"),
                custom_property_assignments_table=_fq_table(catalog, schema, "custom_property_assignments"),
                profile_runs_table=_fq_table(catalog, schema, "profile_runs"),
                profile_table_metrics_table=_fq_table(catalog, schema, "profile_table_metrics"),
                profile_column_metrics_table=_fq_table(catalog, schema, "profile_column_metrics"),
                quality_test_definitions_table=_fq_table(catalog, schema, "quality_test_definitions"),
                quality_test_definition_versions_table=_fq_table(catalog, schema, "quality_test_definition_versions"),
                quality_suites_table=_fq_table(catalog, schema, "quality_suites"),
                quality_test_cases_table=_fq_table(catalog, schema, "quality_test_cases"),
                quality_runs_table=_fq_table(catalog, schema, "quality_runs"),
                quality_run_results_table=_fq_table(catalog, schema, "quality_run_results"),
                quality_alerts_table=_fq_table(catalog, schema, "quality_alerts"),
                classifications_table=_fq_table(catalog, schema, "classifications"),
                classification_terms_table=_fq_table(catalog, schema, "classification_terms"),
                domains_table=_fq_table(catalog, schema, "domains"),
                data_products_table=_fq_table(catalog, schema, "data_products"),
                data_product_members_table=_fq_table(catalog, schema, "data_product_members"),
                logical_column_groups_table=_fq_table(catalog, schema, "logical_column_groups"),
                logical_column_group_members_table=_fq_table(catalog, schema, "logical_column_group_members"),
                metrics_table=_fq_table(catalog, schema, "metrics"),
                contracts_table=_fq_table(catalog, schema, "contracts"),
                classification_recommendations_table=_fq_table(
                    catalog, schema, "classification_recommendations"
                ),
            ).strip()
            if sql:
                uc.execute(sql)
        uc.execute(
            f"""INSERT INTO {_fq_table(catalog, schema, "schema_migrations")} (
    version, name, applied_at
) VALUES (
    {migration.version},
    {sql_literal(migration.name)},
    timestamp({sql_literal(_utc_now_ts())})
)"""
        )
        applied.append(migration.version)
    return applied
