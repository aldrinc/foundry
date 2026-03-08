# Foundry Server

This service is the product-facing control-plane foundation for Foundry.

It is the intended home for:

- hosted auth and organization management
- billing and entitlement enforcement
- GitHub App integration
- server-backed runtime and agent settings
- workspace orchestration policy and topology
- public APIs consumed by the desktop app and the cloud web surface

It is not the full renamed core application server derived from the Zulip server.

## Current scope

This is an initial scaffold created to establish:

- the monorepo location for the server
- the confirmed launch decisions as code
- typed domain models for the first core product concepts
- a minimal FastAPI app with health and bootstrap metadata endpoints

The core application server is still outside this monorepo today and needs to be imported separately.

The existing internal orchestration implementation still lives under:

- `/Users/aldrinclement/Documents/programming/ideas-space/infra/hetzner-apps/meridian-coder-orchestrator`

That code will be migrated or absorbed into this service incrementally.

## Layout

- `src/foundry_server/app.py`: FastAPI app factory and metadata endpoints
- `src/foundry_server/config.py`: environment-backed server config
- `src/foundry_server/decisions.py`: launch decisions captured as code
- `src/foundry_server/domain/`: typed domain models for orgs, billing, GitHub, runtime, and workspaces
- `tests/`: dependency-light unit tests for config and decision defaults

## Local development

```bash
cd services/foundry-server
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn foundry_server.app:app --app-dir src --reload
```

## Example endpoints

- `GET /health`
- `GET /api/v1/meta/bootstrap`
- `GET /api/v1/meta/launch-decisions`

## Next implementation steps

1. Add organization and session persistence.
2. Add OIDC-backed auth flows for cloud and self-host modes.
3. Add GitHub App installation and repository binding APIs.
4. Add server-backed runtime and agent settings APIs.
5. Start migrating orchestration and workspace policy logic from the internal service.
