# Foundry

Foundry is a cross-platform desktop app plus a hosted or self-hosted control plane for GitHub-backed coding workflows. This repo contains the desktop app, shared UI packages, the control-plane service, and an imported snapshot of the standardized core collaboration server.

## Workspace

- `packages/app`: shared SolidJS application code
- `packages/desktop`: Tauri desktop shell and native bridge
- `packages/ui`: shared UI primitives
- `services/foundry-server`: product-facing control-plane scaffold for orgs, auth, billing, GitHub, runtime, and workspace domains
- `services/foundry-core`: imported core application server snapshot under `app/`
- `docs`: release, packaging, and repository guidance

## Development

```bash
bun install
bun test
bun run build
bun run bundle:desktop
```

The control-plane service lives under `services/foundry-server`. See its local README for setup and run instructions.

The imported core application server snapshot lives under `services/foundry-core/app`. The boundary between `foundry-core` and `foundry-server` is documented in `services/foundry-core/README.md`.

## Code Quality

Foundry uses a mixed repo-hygiene setup:

- `pre-commit` runs fast local checks for secrets, file hygiene, typos, Solid ESLint, and Rust formatting. Biome and `mdformat` remain available as manual cleanup hooks while the imported core snapshot is still being standardized.
- `.githooks/pre-push` keeps the existing publish-safety secret scan and adds the heavier TypeScript, Rust lint, and Rust compile checks.
- The current CI workflow file lives in `.github/workflows/ci.yml` and runs on GitHub Actions.

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

The full step-by-step packaging notes live in `docs/desktop-distribution.md`.

For over-the-air desktop updates through GitHub Releases, see `docs/desktop-ota-updates.md`.

## Safe Publishing

The repo is configured to keep build output, local tool state, `.env` files, and common credential file types out of version control. The secret scan lives in `scripts/check-secrets.sh`, with `gitleaks` configuration in `.gitleaks.toml`, and is reused both locally and in CI.

## License

Foundry-authored code in this repository is released under Elastic License 2.0, with additional component-level notices for imported third-party code. See `LICENSE` and `LICENSING.md`.

## Publishing Note

This project is being prepared for public GitHub hosting. Any remaining internal publishing references should be treated as migration debt and removed before release.
