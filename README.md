# Governance Hub (Databricks Apps + Unity Catalog)

A **Databricks App** (Streamlit) that provides a governance portal on top of
Unity Catalog — with an **optional** connector for self-hosted OpenMetadata OSS.

No paid products or external servers are required to run the core app.

---

## What it does

| Feature | Powered by |
|---|---|
| Browse catalogs / schemas / tables | UC `SHOW` + `information_schema` |
| Table & column lineage | UC system tables (`system.access.table_lineage`, `column_lineage`) |
| Business glossary (create, search, manage terms) | UC Delta table (`glossary_terms`) |
| Data ownership tracking | UC Delta table (`data_owners`) |
| UC tags & comments editing | UC SQL DDL |
| Change-request workflow (reader → writer/admin) | UC Delta table (`change_requests`) |
| OpenMetadata search, tags, glossary, lineage | **Optional** — self-hosted OpenMetadata REST API |

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Databricks App (Streamlit)          │
│  app.py  →  govhub/                             │
│     │           ├─ auth.py          (SSO)       │
│     │           ├─ config.py        (env vars)  │
│     │           ├─ uc.py            (SQL WH)    │
│     │           ├─ store.py         (gov tables)│
│     │           ├─ openmetadata.py  (optional)  │
│     │           └─ util.py                      │
└────┬───────────────────┬────────────────────────┘
     │                   │
     ▼                   ▼ (optional)
Unity Catalog       OpenMetadata OSS
 • metadata           • cross-platform
 • lineage              lineage &
 • governance           enrichment
   tables
```

## Repository layout

```
governance_hub/
├── app.py              Streamlit entry point
├── app.yaml            Databricks Apps spec (single file)
├── requirements.txt    Python deps (single file)
├── databricks.yml      DAB bundle config
├── govhub/             Application package
│   ├── __init__.py
│   ├── auth.py
│   ├── config.py
│   ├── openmetadata.py
│   ├── store.py
│   ├── uc.py
│   └── util.py
├── sql/
│   └── bootstrap.sql   Manual DDL (if app SP lacks CREATE privileges)
└── README.md
```

**One `app.yaml`. One `requirements.txt`. No duplicates.**

## Configuration

Edit `app.yaml` before deploying:

| Variable | Required | Where to get it |
|---|---|---|
| `DATABRICKS_WAREHOUSE_ID` | **Yes** | SQL Warehouses → your warehouse → ID (in URL or detail panel) |
| `GOVHUB_CATALOG` | No (default `main`) | The UC catalog for governance tables |
| `GOVHUB_SCHEMA` | No (default `governance_hub`) | The UC schema for governance tables |
| `GOVHUB_ADMIN_EMAILS` | No | Comma-separated bootstrap admin emails |
| `OPENMETADATA_SERVER_URL` | No | Base URL of self-hosted OpenMetadata (e.g. `https://openmetadata.internal.company.com`) |
| `OPENMETADATA_JWT_TOKEN` | No | OpenMetadata bot JWT token (see OM docs → Security → Enable JWT) |

If `OPENMETADATA_SERVER_URL` / `OPENMETADATA_JWT_TOKEN` are blank, the app runs in **UC-only mode** —
all features except the "OpenMetadata Connector" page work without any external server.

## Deploy (Git-based — recommended for testing)

1. Set your `DATABRICKS_WAREHOUSE_ID` in `app.yaml`.
2. Push to GitHub.
3. In Databricks → Apps → governance-hub → set Git source to this repo / branch.
4. Click **Deploy**.

## Deploy (Databricks Asset Bundles)

```bash
# 1. Optionally store OpenMetadata secrets
databricks secrets create-scope governance_hub
databricks secrets put-secret governance_hub om_server_url
databricks secrets put-secret governance_hub om_jwt_token

# 2. Deploy
databricks bundle deploy -t dev --var warehouse_id=<WAREHOUSE_ID>

# 3. Start the app
databricks apps deploy governance-hub
```

## First run

The app auto-creates governance tables on first load.
If the app service principal lacks DDL privileges, run `sql/bootstrap.sql`
as a workspace admin first.

## App roles

| Role | Permissions |
|---|---|
| `reader` | Browse, view lineage, submit change requests |
| `writer` | All reader + edit UC metadata, manage glossary, manage OpenMetadata |
| `admin` | All writer + manage user roles |

Bootstrap admins via `GOVHUB_ADMIN_EMAILS` in `app.yaml`, or insert directly
into `main.governance_hub.user_roles`.

## About OpenMetadata

- **OpenMetadata** (open-metadata.org) is 100% open source (Apache 2.0).
- Self-host via Docker Compose or Kubernetes — single Java service + a database (MySQL / Postgres). Much lighter than alternatives that require Kafka, Elasticsearch, etc.
- Has a native **Databricks / Unity Catalog connector** for automatic ingestion of metadata, lineage, and profiling.
- If you don't have an OpenMetadata instance, leave the env vars blank. The app works fully on UC alone.

