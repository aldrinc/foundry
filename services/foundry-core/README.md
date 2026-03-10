# Foundry Core

This directory is the monorepo home for the imported core collaboration server.

## Why this exists

The `foundry` monorepo contains an imported snapshot of the current standardized core server under `app/`.

The imported code is still being standardized and rebranded for public release. It remains a separate boundary from the product-facing control plane in `services/foundry-server`.

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
3. remove or replace remaining legacy naming and assumptions,
4. wire it into the public GitHub-hosted build and release path.

## Intended responsibility

`services/foundry-core` contains the server that provides the core collaborative application behavior, while `services/foundry-server` remains the control-plane layer for:

- hosted auth
- billing and entitlements
- GitHub App integration
- runtime and agent settings
- workspace orchestration policy
