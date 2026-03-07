# Foundry

Foundry is a Tauri desktop client for Zulip with Meridian supervisor integration.

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

## Safe Publishing

Before pushing this repository to a remote:

```bash
git config core.hooksPath .githooks
./scripts/check-secrets.sh
```

The repo is configured to keep build output, local tool state, `.env` files, and common credential file types out of version control. The pre-push hook runs the same secret check script.

## Remote Setup

When you are ready to publish to Meridian Forgejo:

```bash
git remote add origin https://git.meridian.cv/<org-or-user>/foundry.git
git push -u origin <branch>
```
