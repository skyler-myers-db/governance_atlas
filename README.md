# Governance Atlas

Governance Atlas is a Databricks-native metadata workspace built on Unity Catalog.
The product goal is Governance Atlas branding with OpenMetadata-class workflow depth
across discovery, entity detail, lineage, governance, tasks, and quality.

The authoritative reconstruction spec lives in
[docs/RECONSTRUCTION_PLAN.md](docs/RECONSTRUCTION_PLAN.md).

## Supported Runtime

The only supported app runtime path is:

```text
app.yaml -> run_app.py -> runtime_app.py -> frontend/dist generated at package time
```

`runtime_app.py` is the single backend runtime module behind the Governance Atlas
launcher.

There is no legacy Streamlit mode and no OpenMetadata bridge in the supported product.

## Product Direction

- Prioritize `Discovery`, `Lineage`, and `Governance`
- Stay asset-centric and search-first
- Match OpenMetadata-class workflow completeness and enterprise polish without cloning its branding
- Prefer truthful live metadata and audited control-plane state over synthetic UI affordances
- Preserve portability and low-friction deployment across Databricks workspaces

## Architecture

```text
Databricks App
  -> run_app.py
  -> backend runtime in runtime_app.py
  -> atlas/uc.py (internal compatibility package)
  -> atlas/store.py
  -> atlas/services/*
  -> React frontend built to frontend/dist
```

Governance Atlas reads live Unity Catalog and Databricks system metadata directly and
stores governance workflow state in Delta tables inside the configured governance schema.

## Local Development

### Backend prerequisites

- Python 3.11+
- dependencies from `requirements.txt`

### Frontend prerequisites

- Node 20+
- npm

### Run locally

```bash
pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
python run_app.py
```

The launcher requires a built frontend bundle at `frontend/dist/index.html`.

## Deployment

The repo is deployed as a Databricks App through Databricks Asset Bundles.

```bash
databricks auth login --host https://<workspace>.cloud.databricks.com
python scripts/prepare_bundle.py --output /tmp/atlas_bundle
cd /tmp/atlas_bundle
databricks bundle deploy --profile DEFAULT -t dev --var="warehouse_id=<warehouse-id>"
cat > /tmp/atlas-app-deploy.json <<JSON
{
  "source_code_path": "/Workspace/Users/$(databricks current-user me --profile DEFAULT -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"userName\"])')/.bundle/atlas/dev/files",
  "mode": "SNAPSHOT",
  "env_vars": [
    {"name": "DATABRICKS_WAREHOUSE_ID", "value_from": "sql-warehouse"},
    {"name": "GOVAT_CATALOG", "value": "datapact"},
    {"name": "GOVAT_SCHEMA", "value": "atlas"},
    {"name": "GOVAT_ADMIN_EMAILS", "value": ""}
  ]
}
JSON
databricks apps start atlas --profile DEFAULT --timeout 20m
databricks apps deploy atlas \
  --profile DEFAULT \
  --json @/tmp/atlas-app-deploy.json \
  --timeout 20m
```

### Packaging contract

- `frontend/dist` is built in CI or a predeploy packaging step
- `frontend/dist/atlas-build-manifest.json` proves the bundle matches the current frontend source tree; the filename is retained as a frontend-build compatibility artifact
- `frontend/dist` is not source-controlled
- the Databricks bundle is deployed from a clean packaged directory that includes the built frontend output
- the runtime does not build frontend assets on startup

## Configuration

### Required

- `DATABRICKS_WAREHOUSE_ID`

### Runtime configuration

- `GOVAT_CATALOG`
- `GOVAT_SCHEMA`
- `GOVAT_ADMIN_EMAILS`

These are injected explicitly per deployment target from `databricks.yml`.
Source defaults remain neutral and must not encode personal emails or
production-only settings.

`app.yaml` is intentionally portable source config: it defaults to
`main.atlas`, no bootstrap admin, local Atlas AI fallback, and Lakebase disabled.
Real installs should override `GOVAT_CATALOG`, `GOVAT_SCHEMA`, and
`GOVAT_ADMIN_EMAILS` per workspace. Genie and Lakebase are optional resources:
leave `GOVAT_ATLAS_AI_PROVIDER=local` and `GOVAT_LAKEBASE_ENABLED=false` for a
minimal install, or bind a curated Genie space plus Lakebase branch/database in
the bundle target. The `dev` target in `databricks.yml` is Entrada's internal
validation target and is not a portable default for customer workspaces.

## Governance Tables

Governance Atlas currently persists governance state in Delta tables under
`<GOVAT_CATALOG>.<GOVAT_SCHEMA>`.

- `user_roles`
- `glossary_terms`
- `glossary_term_reviewers`
- `glossary_term_versions`
- `data_owners`
- `change_requests`

Additional workflow, migration, lineage-override, and quality tables will be introduced
through versioned migrations rather than ad hoc schema drift.

## CI / CD Expectations

The deployment workflow is expected to:

- build and lint the frontend in a clean checkout
- run backend and migration checks
- assemble a clean bundle directory
- validate and deploy the bundle from that packaged directory

## License

Apache-2.0
