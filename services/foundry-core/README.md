# Foundry Core

This directory is the monorepo home for the renamed Zulip-derived core application server.

## Why this exists

The `foundry` monorepo now contains a sanitized import of the current customized Zulip-derived core application server under [`app/`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/services/foundry-core/app).

The imported snapshot was sourced from the current workspace state:

- `/Users/aldrinclement/Documents/programming/ideas-space/.tmp-zulip` appears to contain the customized Zulip-derived server with Meridian task and supervisor integrations.
- `/Users/aldrinclement/Documents/programming/ideas-space/.tmp-zulip-standardize` appears to contain related standardization work.

The system is still logically split across:

- `foundry/` for the product-facing monorepo and the imported core server snapshot
- `.tmp-zulip`-family directories for upstream migration and standardization work

## Import notes

The import intentionally excluded repository metadata and obvious credential-bearing fixtures:

- `.git`
- `.github`
- `.claude`
- `.vscode`
- tracked certificate and private-key fixture files

## Required next step

Before the Foundry product architecture is complete, the team still needs to:

1. finish renaming and standardizing the imported code as Foundry,
2. define its boundary relative to `services/foundry-server`,
3. remove or replace legacy Meridian-specific naming and assumptions,
4. wire it into the public GitHub-hosted build and release path.

## Intended responsibility

`services/foundry-core` contains the server that provides the core collaborative application behavior, while `services/foundry-server` remains the control-plane layer for:

- hosted auth
- billing and entitlements
- GitHub App integration
- runtime and agent settings
- workspace orchestration policy
