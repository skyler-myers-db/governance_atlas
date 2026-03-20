# 🏛️ Governance Hub

> A **self-service data governance portal** that extends **Unity Catalog** —
> deployed as a native **Databricks App** via **Databricks Asset Bundles**.

Governance Hub is a **workspace-portable accelerator**: clone this repo, set
three secrets, and `databricks bundle deploy` to any Databricks workspace.

---

## Features

| Feature | Description |
|---|---|
| **UC Browser** | Browse catalogs → schemas → tables. Edit table & column comments, UC tags, and data owners. |
| **Column-level comments & tags** | Set descriptions on individual columns via `ALTER TABLE … ALTER COLUMN … COMMENT`. |
| **Table & column lineage** | Queries `system.access.table_lineage` and `column_lineage` — no external infra needed. |
| **Business glossary** | Create, search, and manage glossary terms stored in a Delta table inside your governance schema. |
| **Glossary ↔ table/column linking** | Tag any UC table or column with `glossary_term = <term_id>` to bind terms to assets. |
| **Change-request workflow** | Readers propose metadata changes; writers/admins review & approve (auto-applies to UC). |
| **OpenMetadata connector** *(optional)* | Bridge to a self-hosted [OpenMetadata](https://open-metadata.org/) instance for cross-platform governance. |
| **Role-based access** | Reader / Writer / Admin roles stored in a Delta table, bootstrapped via env var. |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│      Databricks App  (switchable launcher)          │
│  run_app.py → app.py / modern_app.py                │
│     │           ├─ auth.py          (SSO identity)   │
│     │           ├─ config.py        (env vars)       │
│     │           ├─ uc.py            (SQL Warehouse)  │
│     │           ├─ store.py         (gov Delta tbls) │
│     │           ├─ openmetadata.py  (optional)       │
│     │           └─ util.py                           │
└────┬───────────────────┬────────────────────────────┘
     │                   │
     ▼                   ▼ (optional)
 Unity Catalog      OpenMetadata OSS
```

**No Kafka, no Elasticsearch, no Docker** — just a SQL Warehouse and this
app.

---

## Quick Start (any workspace)

### Prerequisites

| Component | Minimum |
|---|---|
| Databricks workspace | Any cloud (AWS / Azure / GCP) |
| Databricks CLI | `>= 0.230` (`databricks bundle` support) |
| SQL Warehouse | Serverless or Pro — the app runs all queries through it |
| Unity Catalog | Enabled on the workspace |
| System tables | `system.access.table_lineage` & `column_lineage` enabled (for lineage) |

### 1. Clone the repo

```bash
git clone https://github.com/<org>/governance_hub.git
cd governance_hub
```

### 2. Configure your target

Edit `databricks.yml` — the `targets:` section defines environments:

```yaml
targets:
  dev:
    mode: development
    default: true
    variables:
      gov_catalog: dev            # where governance tables live
    workspace:
      host: https://adb-xxx.azuredatabricks.net
  prod:
    variables:
      gov_catalog: prod
    workspace:
      host: https://adb-xxx.azuredatabricks.net
```

Edit `app.yaml` — set `GOVHUB_ADMIN_EMAILS` to the bootstrap admin(s) for the
workspace. The app defaults to `GOVHUB_APP_MODE=legacy`, which preserves the
current Streamlit implementation. Switch to `modern` after the new frontend lands.

```yaml
env:
  - name: GOVHUB_ADMIN_EMAILS
    value: "admin1@company.com,admin2@company.com"
  - name: GOVHUB_APP_MODE
    value: legacy
```

### 3. Deploy with DAB

```bash
# Authenticate
databricks auth login --host https://adb-xxx.azuredatabricks.net

# Deploy to dev
databricks bundle deploy -t dev --var="warehouse_id=<your-warehouse-id>"

# Deploy to prod
databricks bundle deploy -t prod --var="warehouse_id=<your-warehouse-id>"
```

### 4. Grant lineage access (one-time per workspace)

The app's service principal needs `SELECT` on the system lineage tables:

```sql
GRANT SELECT ON TABLE system.access.table_lineage  TO `<app-service-principal-id>`;
GRANT SELECT ON TABLE system.access.column_lineage TO `<app-service-principal-id>`;
```

You can find the service principal application ID in the Databricks Apps UI
under the app's settings.

---

## CI/CD with GitHub Actions

The repo ships with `.github/workflows/deploy.yml`:

| Trigger | Behaviour |
|---|---|
| **Push to `main`** | Validates bundle → deploys to `dev` |
| **Pull request** | Validates bundle only (no deploy) |
| **Manual dispatch** | Pick `dev` / `staging` / `prod` from the UI |

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `DATABRICKS_HOST` | Workspace URL |
| `DATABRICKS_TOKEN` | PAT or OAuth token for the CLI |
| `DATABRICKS_WAREHOUSE_ID` | SQL Warehouse ID |

---

## Configuration Reference

### `app.yaml` environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABRICKS_WAREHOUSE_ID` | ✅ | — | SQL Warehouse for all UC queries |
| `GOVHUB_CATALOG` | — | `main` | Catalog where governance tables are stored |
| `GOVHUB_SCHEMA` | — | `governance_hub` | Schema within the catalog |
| `GOVHUB_ADMIN_EMAILS` | — | `""` | Comma-separated admin emails (bootstrap) |
| `GOVHUB_APP_MODE` | — | `legacy` | `legacy` runs Streamlit, `modern` runs `modern_app:app` via `uvicorn` |
| `OPENMETADATA_SERVER_URL` | — | `""` | OM server URL (leave blank for UC-only) |
| `OPENMETADATA_JWT_TOKEN` | — | `""` | OM JWT token |

### Governance tables (auto-created)

The app creates these Delta tables on first launch inside
`<GOVHUB_CATALOG>.<GOVHUB_SCHEMA>`:

- `user_roles` — email ↔ role mapping
- `glossary_terms` — business glossary terms
- `data_owners` — table ↔ owner associations
- `asset_links` — UC ↔ OpenMetadata table links
- `change_requests` — metadata change-request queue

---

## Installing on a New Client Workspace

1. Fork or clone this repo into the client's GitHub org.
2. Set `GOVHUB_ADMIN_EMAILS` in `app.yaml` to the client's admin(s).
3. Update `databricks.yml` targets with the client's workspace URL(s).
4. Add GitHub Secrets (`DATABRICKS_HOST`, `DATABRICKS_TOKEN`,
   `DATABRICKS_WAREHOUSE_ID`).
5. Push to `main` — GitHub Actions deploys the app automatically.
6. Grant lineage system-table access to the app's service principal.
7. (Optional) Set up a Databricks secret scope for OpenMetadata credentials.

The app auto-provisions all governance tables on first launch — no manual SQL
required.

---

## Requirements

- Python 3.11+ (Databricks Apps runtime)
- `streamlit >= 1.38`
- `pandas >= 2.0`
- `requests >= 2.31`
- `databricks-sdk >= 0.95.0`
- `fastapi >= 0.115`
- `uvicorn >= 0.30`

---

## License

Apache-2.0
