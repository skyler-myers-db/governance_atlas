# Governance Hub

Governance Hub is a Databricks-native metadata workspace built on Unity Catalog.
The product goal is Governance Hub branding with OpenMetadata-class workflow depth
across discovery, entity detail, lineage, governance, tasks, and quality.

The authoritative reconstruction spec lives in
[docs/RECONSTRUCTION_PLAN.md](/Users/entrada-mac/Documents/GitHub/governance_hub/docs/RECONSTRUCTION_PLAN.md).

## Supported Runtime

The only supported app runtime path is:

```text
app.yaml -> run_app.py -> runtime_app.py -> frontend/dist generated at package time
```

`runtime_app.py` is the single backend runtime module behind the Governance Hub
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
  -> govhub/uc.py
  -> govhub/store.py
  -> govhub/services/*
  -> React frontend built to frontend/dist
```

Governance Hub reads live Unity Catalog and Databricks system metadata directly and
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
python scripts/prepare_bundle.py --output /tmp/govhub_bundle
cd /tmp/govhub_bundle
databricks bundle deploy -t dev --var="warehouse_id=<warehouse-id>"
```

### Packaging contract

- `frontend/dist` is built in CI or a predeploy packaging step
- `frontend/dist/govhub-build-manifest.json` proves the bundle matches the current frontend source tree
- `frontend/dist` is not source-controlled
- the Databricks bundle is deployed from a clean packaged directory that includes the built frontend output
- the runtime does not build frontend assets on startup

## Configuration

### Required

- `DATABRICKS_WAREHOUSE_ID`

### Runtime configuration

- `GOVHUB_CATALOG`
- `GOVHUB_SCHEMA`
- `GOVHUB_ADMIN_EMAILS`

These should be injected explicitly per deployment target. Source defaults should
remain neutral and must not encode personal emails or production-only settings.

## Governance Tables

Governance Hub currently persists governance state in Delta tables under
`<GOVHUB_CATALOG>.<GOVHUB_SCHEMA>`.

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
