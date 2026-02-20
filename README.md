# Governance Hub (Databricks App + Unity Catalog + DataHub)

This repo is a **Databricks Asset Bundles** project that deploys a **Databricks App** (Streamlit) that:
- Browses Unity Catalog objects (catalogs/schemas/tables)
- Links UC tables to **DataHub** datasets (by URN)
- Displays and (for writers/admins) updates:
  - UC table comments + UC tags
  - DataHub dataset tags + glossary terms
- Supports a lightweight **change request** workflow (readers submit → writers/admins approve)

## Prereqs

1. **A DataHub instance** (self-hosted OSS) reachable from the Databricks Apps runtime network.
2. A DataHub **access token** with permissions to:
   - read/search datasets
   - add tags / add glossary terms
   - create glossary terms (optional)
3. A Databricks SQL Warehouse (serverless or classic) that supports Unity Catalog.
4. Databricks CLI configured + Asset Bundles enabled.

## Configure Databricks Secrets

Create a secret scope (example scope name matches bundle defaults):

```bash
databricks secrets create-scope governance_hub
```

Create secrets:

```bash
databricks secrets put-secret governance_hub datahub_gms_url
databricks secrets put-secret governance_hub datahub_token
```

- `datahub_gms_url` should be the base URL, e.g. `https://datahub.company.com`
- `datahub_token` is your DataHub API token

## Deploy

From this project folder:

```bash
databricks bundle validate
databricks bundle deploy -t dev --var warehouse_id=<SQL_WAREHOUSE_ID>
```

Databricks Apps require an extra step to deploy the app to compute:

```bash
databricks apps deploy governance-hub
```

## First Run / Bootstrap

The app will create the following UC tables (in `main.governance_hub` by default):
- `user_roles`
- `asset_links`
- `change_requests`

If the app service principal cannot create schemas/tables, run `app/sql/bootstrap.sql` once as an admin,
or pre-create the schema + tables and grant the app principal rights to read/write them.

## App Roles

The app enforces simple UI roles:
- `reader`: can browse, submit change requests
- `writer`: can update UC metadata + DataHub metadata
- `admin`: can manage roles + links

Bootstrap: set `GOVHUB_ADMIN_EMAILS` in `app.yaml` to a comma-separated list of admin emails,
or insert an admin row into `main.governance_hub.user_roles`.

