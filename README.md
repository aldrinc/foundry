# Foundry

Foundry is a Tauri desktop client for Zulip with Foundry supervisor integration.

## Workspace

- `packages/app`: shared SolidJS application code
- `packages/desktop`: Tauri desktop shell and native bridge
- `packages/ui`: shared UI primitives

## Development

```bash
bun install
bun test
cd packages/desktop
bun run build
```

## Code Quality

Foundry uses a mixed repo-hygiene setup:

- `pre-commit` runs fast local checks for secrets, file hygiene, docs, typos, Biome formatting, Solid ESLint, and Rust formatting.
- `.githooks/pre-push` keeps the existing publish-safety secret scan and adds the heavier TypeScript, Rust lint, and Rust compile checks.
- Forgejo CI reruns the same checks remotely from [`.forgejo/workflows/ci.yml`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/.forgejo/workflows/ci.yml).

Install the local hooks once per clone:

```bash
python3 -m pip install --user pre-commit
git config core.hooksPath .githooks
pre-commit install --hook-type pre-commit
```

Useful local commands:

```bash
bun run lint
bun run typecheck
bun run check:rust
bun run verify
```

## Safe Publishing

The repo is configured to keep build output, local tool state, `.env` files, and common credential file types out of version control. The secret scan lives in [`scripts/check-secrets.sh`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/scripts/check-secrets.sh) and is reused both locally and in CI.

## Remote Setup

When you are ready to publish to Meridian Forgejo:

```bash
git remote add origin https://git.meridian.cv/<org-or-user>/foundry.git
git push -u origin <branch>
```
