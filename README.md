# Foundry

Foundry is a source-available desktop client and control-plane stack for GitHub-backed coding workflows. This repository includes the cross-platform desktop app, shared UI packages, the Foundry control-plane service, and the imported collaboration-core snapshot that backs the product.

## Why Foundry

- Cross-platform desktop client with native integrations, packaging, and OTA update support
- GitHub-backed workflow model for org setup, repositories, runtime coordination, and workspace automation
- Shared application and UI packages for shipping the same product surface across desktop targets
- Self-hosting path for teams that want to run Foundry inside their own environment

## Project Status

Foundry is in an early public release phase.

- Desktop release artifacts are published through [GitHub Releases](https://github.com/aldrinc/foundry/releases).
- The desktop updater path is wired through signed Tauri updater metadata.
- The server and infra layers are usable, but they are still being standardized for a cleaner public self-hosting experience.
- Foundry-authored code is source-available under Elastic License 2.0, not an OSI open-source license. See [LICENSE](LICENSE) and [LICENSING.md](LICENSING.md).

## Get Foundry

Download the latest desktop builds from [GitHub Releases](https://github.com/aldrinc/foundry/releases).

Current release targets:

- macOS Apple Silicon and Intel
- Windows x64
- Linux `.deb` and `.rpm`

Build and updater details:

- [docs/desktop-distribution.md](docs/desktop-distribution.md)
- [docs/desktop-ota-updates.md](docs/desktop-ota-updates.md)
- [docs/faq.md](docs/faq.md)
- [docs/README.md](docs/README.md)
- [CHANGELOG.md](CHANGELOG.md)

## Quickstart

From the repo root:

```bash
bun install
bun run test
bun run typecheck
bun run build
bun run bundle:desktop
```

Additional useful commands:

```bash
bun run lint:eslint
bun run check:rust
bun run bundle:desktop:macos
cd services/foundry-server && pytest
```

If you want local hooks enabled:

```bash
python3 -m pip install --user pre-commit
git config core.hooksPath .githooks
pre-commit install --hook-type pre-commit
```

## Repository Guide

- `packages/app`: shared SolidJS application code
- `packages/desktop`: Tauri shell, native bridge, desktop packaging, and updater integration
- `packages/ui`: shared UI primitives
- `services/foundry-server`: Foundry control-plane service for orgs, auth, GitHub, runtime, and workspace domains
- `services/foundry-core`: imported collaboration-core snapshot under `app/`
- `docs`: packaging, release, and repository guidance

Component-specific setup notes:

- [docs/README.md](docs/README.md)
- [services/foundry-server/README.md](services/foundry-server/README.md)
- [services/foundry-core/README.md](services/foundry-core/README.md)

## Quality and Release Safety

Foundry uses layered repo hygiene checks before code ships:

- `pre-commit` for secrets, file hygiene, typos, Solid linting, and Rust formatting
- `.githooks/pre-push` for the heavier secret, TypeScript, and Rust checks
- GitHub Actions CI in [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Signed desktop release publishing in [.github/workflows/release-desktop.yml](.github/workflows/release-desktop.yml)

The secret scan lives in [scripts/check-secrets.sh](scripts/check-secrets.sh), with additional configuration in [.gitleaks.toml](.gitleaks.toml).

## Community

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SUPPORT.md](SUPPORT.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Public Launch Checklist

The remaining launch work is tracked in [docs/public-launch-checklist.md](docs/public-launch-checklist.md).

## License

Foundry-authored code in this repository is released under Elastic License 2.0, with component-level exceptions for imported third-party code. See [LICENSE](LICENSE) and [LICENSING.md](LICENSING.md).
