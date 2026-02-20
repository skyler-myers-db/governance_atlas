-- Bootstrap Governance Hub tables in Unity Catalog.
-- Run this once using a SQL Warehouse that has Unity Catalog enabled.

CREATE CATALOG IF NOT EXISTS main;

CREATE SCHEMA IF NOT EXISTS main.governance_hub;

-- Simple role table to control app UI permissions.
CREATE TABLE IF NOT EXISTS main.governance_hub.user_roles (
  email STRING NOT NULL,
  role  STRING NOT NULL COMMENT 'reader | writer | admin',
  updated_at TIMESTAMP,
  updated_by STRING
) USING DELTA;

-- Optional mapping of UC tables to DataHub dataset URNs.
CREATE TABLE IF NOT EXISTS main.governance_hub.asset_links (
  uc_full_name STRING NOT NULL COMMENT 'catalog.schema.table',
  datahub_urn   STRING NOT NULL,
  updated_at    TIMESTAMP,
  updated_by    STRING
) USING DELTA;

-- Change request workflow (optional).
CREATE TABLE IF NOT EXISTS main.governance_hub.change_requests (
  request_id STRING NOT NULL,
  created_at TIMESTAMP,
  created_by STRING,
  status     STRING COMMENT 'pending | approved | rejected',

  uc_full_name STRING COMMENT 'catalog.schema.table',
  new_comment  STRING,
  new_uc_tags_json STRING COMMENT 'JSON map of {tag_key: tag_value}',

  datahub_dataset_urn STRING,
  add_datahub_tag_urns_json  STRING COMMENT 'JSON list of tag URNs',
  add_datahub_term_urns_json STRING COMMENT 'JSON list of glossary term URNs',

  reviewed_at TIMESTAMP,
  reviewed_by STRING,
  review_note STRING
) USING DELTA;
