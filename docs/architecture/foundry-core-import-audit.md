# Foundry Core Import Audit

Date: 2026-03-08
Status: Active

## Scope

This note records the first import of the customized Zulip-derived core application server into the Foundry monorepo.

- Import source: `/Users/aldrinclement/Documents/programming/ideas-space/.tmp-zulip`
- Import destination: [`services/foundry-core/app`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/services/foundry-core/app)

## Import exclusions

The import intentionally excluded repository metadata and obvious credential-bearing fixtures:

- `.git`
- `.github`
- `.claude`
- `.vscode`
- `TEAMCHAT_UI_INTEGRATION_PLAN.md`
- tracked certificate and private-key fixture files

## Publish-safety validation

The imported tree and surrounding repo were checked for:

- copied repository metadata or editor state
- tracked credential file extensions
- internal Meridian Git host defaults in product-facing code and docs
- heuristic secret-scan hits on the imported core tree
- `gitleaks` hits across the working tree after excluding ignored build artifacts and known-safe upstream fixtures/examples

## Current result

Current result is acceptable for preparing the repo for a future GitHub push:

- `services/foundry-core/app` is present in the monorepo as a sanitized snapshot
- the Meridian Git host default in `zerver/views/meridian_tasks.py` now falls back to `https://github.com`
- [`scripts/check-secrets.sh`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/scripts/check-secrets.sh) passes on the tracked repo
- [`.gitleaks.toml`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/.gitleaks.toml) is configured for known-safe upstream test/example paths, and a full working-tree `gitleaks dir` preview reports zero findings
- root `.gitignore` already ignores local env files, credential file extensions, Python caches, `.claude`, and Tauri target output

## Remaining pre-push tasks

These items still need to happen before the first public GitHub push:

1. Replace the current local Git remote with the new GitHub remote URL once it is available.
2. Decide what to do with the legacy `.forgejo/workflows/ci.yml` path as CI moves to GitHub-hosted automation.
3. Continue the Foundry rebrand inside the imported core server, where Meridian- and Zulip-era names still remain.
4. Decide how the imported core server is wired into the monorepo build, dev, and release workflows.

## Non-blocking migration debt

The imported core snapshot still contains broader product-standardization debt that is not a publish-safety failure by itself:

- Meridian-prefixed module and UI names
- generic non-GitHub integrations still present in imported code paths
- upstream Zulip documentation and examples that still need Foundry-specific review
