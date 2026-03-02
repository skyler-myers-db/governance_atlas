-- Bootstrap Governance Hub tables in Unity Catalog.
-- Run this once if the app service principal lacks DDL privileges.
CREATE SCHEMA IF NOT EXISTS prod.governance_hub;
CREATE TABLE IF NOT EXISTS prod.governance_hub.user_roles (
    email STRING NOT NULL,
    role STRING NOT NULL COMMENT 'reader | writer | admin',
    updated_at TIMESTAMP,
    updated_by STRING
) USING DELTA;
CREATE TABLE IF NOT EXISTS prod.governance_hub.glossary_terms (
    term_id STRING NOT NULL,
    name STRING NOT NULL,
    definition STRING,
    domain STRING,
    owner_email STRING,
    status STRING COMMENT 'draft | approved | deprecated',
    created_at TIMESTAMP,
    created_by STRING,
    updated_at TIMESTAMP,
    updated_by STRING
) USING DELTA;
CREATE TABLE IF NOT EXISTS prod.governance_hub.data_owners (
    uc_full_name STRING NOT NULL COMMENT 'catalog.schema.table',
    owner_email STRING NOT NULL,
    owner_type STRING COMMENT 'technical | business | steward',
    updated_at TIMESTAMP,
    updated_by STRING
) USING DELTA;
CREATE TABLE IF NOT EXISTS prod.governance_hub.asset_links (
    uc_full_name STRING NOT NULL COMMENT 'catalog.schema.table',
    om_table_fqn STRING NOT NULL COMMENT 'OpenMetadata fully-qualified table name',
    updated_at TIMESTAMP,
    updated_by STRING
) USING DELTA;
CREATE TABLE IF NOT EXISTS prod.governance_hub.change_requests (
    request_id STRING NOT NULL,
    created_at TIMESTAMP,
    created_by STRING,
    status STRING COMMENT 'pending | approved | rejected',
    uc_full_name STRING,
    new_comment STRING,
    new_uc_tags_json STRING,
    om_table_fqn STRING,
    add_om_tags_json STRING,
    add_om_glossary_terms_json STRING,
    reviewed_at TIMESTAMP,
    reviewed_by STRING,
    review_note STRING
) USING DELTA;
