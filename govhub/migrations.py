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
            # authority-column rule) — see govhub/services/registry.py.
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
