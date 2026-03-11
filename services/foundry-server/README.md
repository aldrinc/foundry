# Foundry Server

This service is the product-facing control-plane foundation for Foundry.

It is the intended home for:

- hosted auth and organization management
- billing and entitlement enforcement
- GitHub App integration
- server-backed runtime and agent settings
- workspace orchestration policy and topology
- public APIs consumed by the desktop app and the SolidJS cloud web surface

It is not the full renamed core application server derived from the Zulip server.

## Current scope

This is an initial scaffold created to establish:

- the monorepo location for the server
- the confirmed launch decisions as code
- typed domain models for the first core product concepts
- a minimal FastAPI app with health and bootstrap metadata endpoints
- a session-backed control plane for organization, GitHub, runtime, and workspace management

## Layout

- `src/foundry_server/app.py`: FastAPI app factory and metadata endpoints
- `src/foundry_server/config.py`: environment-backed server config
- `src/foundry_server/decisions.py`: launch decisions captured as code
- `src/foundry_server/domain/`: typed domain models for orgs, billing, GitHub, runtime, and workspaces
- `src/foundry_server/static/cloud/`: built Foundry Cloud frontend assets from `packages/cloud`
- `tests/`: dependency-light unit tests for config and decision defaults

## Local development

```bash
cd ../..
bun install
bun --cwd packages/cloud run build

cd services/foundry-server
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn foundry_server.app:app --app-dir src --reload
```

## Example endpoints

- `GET /health`
- `GET /api/v1/cloud/me`
- `GET /api/v1/organizations`

`/api/v1/meta/bootstrap` and `/api/v1/meta/launch-decisions` are restricted to authenticated platform admins.

## Demo data

To seed the Foundry control plane with a demo company that is using Foundry to
build Foundry itself:

```bash
cd services/foundry-server
python3 scripts/seed_demo_company.py
```

That provisions the `Foundry Labs` organization, five demo engineers, runtime
settings, workspace pool settings, and the matching tenant realm in Foundry
Core.

Then seed the tenant collaboration data from the core checkout:

```bash
cd services/foundry-core/app
FOUNDRY_DEMO_REALM_SUBDOMAIN=foundry-labs ./manage.py shell < tools/seed_demo_company.py
```

## Next implementation steps

1. Add OIDC-backed auth flows for cloud and self-host modes.
2. Replace the current repo-scoped bootstrap token model with short-lived workspace bootstrap credentials.
3. Add server-backed runtime and agent settings APIs for the remaining desktop settings surface.
4. Expand organization-level audit logging and security reporting.
5. Continue migrating orchestration and workspace policy logic into this service.
