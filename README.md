# Foundry

Foundry is evolving into a cross-platform desktop app plus a hosted or self-hosted control plane for GitHub-backed coding workflows. The current repo contains the desktop app, shared UI packages, the initial control-plane scaffold, and a sanitized imported snapshot of the renamed core application server.

## Workspace

- `packages/app`: shared SolidJS application code
- `packages/desktop`: Tauri desktop shell and native bridge
- `packages/ui`: shared UI primitives
- `services/foundry-server`: product-facing control-plane scaffold for orgs, auth, billing, GitHub, runtime, and workspace domains
- `services/foundry-core`: imported Zulip-derived core application server snapshot under `app/`, plus migration notes for standardizing it as Foundry
- `docs/architecture`: architecture notes and launch-foundation docs

## Development

```bash
bun install
bun test
bun run build
bun run bundle:desktop
```

The control-plane scaffold lives under [`services/foundry-server`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/services/foundry-server). See its local README for setup and run instructions.

The imported core application server snapshot lives under [`services/foundry-core/app`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/services/foundry-core/app). The migration notes and boundary between `foundry-core` and `foundry-server` are documented in [`services/foundry-core/README.md`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/services/foundry-core/README.md).

## Code Quality

Foundry uses a mixed repo-hygiene setup:

- `pre-commit` runs fast local checks for secrets, file hygiene, typos, Solid ESLint, and Rust formatting. Biome and `mdformat` remain available as manual cleanup hooks while the imported core snapshot is still being standardized.
- `.githooks/pre-push` keeps the existing publish-safety secret scan and adds the heavier TypeScript, Rust lint, and Rust compile checks.
- The current CI workflow file lives in [`.github/workflows/ci.yml`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/.github/workflows/ci.yml) and runs on GitHub Actions.

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
bun run bundle:desktop
bun run bundle:desktop:macos
```

## Desktop Distribution

Foundry can now be packaged locally from the repo root into installable desktop artifacts.

```bash
bun install
bun run test
bun run typecheck
bun run lint:eslint
bun run check:rust
bun run bundle:desktop
```

On macOS, `bun run bundle:desktop:macos` produces:

- `packages/desktop/src-tauri/target/release/bundle/macos/Foundry.app`
- `packages/desktop/src-tauri/target/release/bundle/dmg/Foundry_<version>_<arch>.dmg`

The root bundle commands now expect a Tauri updater signing key. They will automatically use `~/.foundry/keys/foundry-updater.key` on this machine, or you can set `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PATH` explicitly.

Use the `.dmg` for internal team distribution. The updater metadata is signed, but the app bundle itself is still unsigned and not notarized, so macOS Gatekeeper hardening is still a follow-up if you want friction-free installs outside the team.

The full step-by-step packaging notes live in [`docs/desktop-distribution.md`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/docs/desktop-distribution.md).

For over-the-air desktop updates through GitHub Releases, see [`docs/desktop-ota-updates.md`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/docs/desktop-ota-updates.md).

## Safe Publishing

The repo is configured to keep build output, local tool state, `.env` files, and common credential file types out of version control. The secret scan lives in [`scripts/check-secrets.sh`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/scripts/check-secrets.sh), with `gitleaks` configuration in [`.gitleaks.toml`](/Users/aldrinclement/Documents/programming/ideas-space/foundry/.gitleaks.toml), and is reused both locally and in CI.

## Publishing Note

This project is being prepared for public GitHub hosting. Any remaining internal publishing references should be treated as migration debt and removed before release.
