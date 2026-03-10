# Contributing

## Before you start

- Read `LICENSE` and `LICENSING.md` so you understand the mixed-license layout.
- Keep changes scoped. Avoid bundling refactors, product changes, and repo
  hygiene work into one PR.
- Do not commit credentials, `.env` files, local databases, private keys, or
  deployment state.

## Development

From the repo root:

```bash
bun install
bun run test
bun run typecheck
bun run build
bun run check:rust
cd services/foundry-server && pytest
```

Run `./scripts/check-secrets.sh` before opening a PR if your changes touch docs,
infra, release, or configuration files.

## Pull requests

- Describe the user-facing impact and the risk of the change.
- Update tests and docs when behavior changes.
- Call out any licensing implications if you touch imported or third-party
  derived code.
