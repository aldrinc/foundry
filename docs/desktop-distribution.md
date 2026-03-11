# Desktop Distribution

This repo can build installable Foundry desktop artifacts directly from the root workspace.

## Prerequisites

- Bun `1.3.10`
- Rust stable toolchain with `rustfmt` and `clippy`
- Platform-native Tauri prerequisites

On macOS, install Xcode Command Line Tools:

```bash
xcode-select --install
```

## Recommended Validation

Run the same checks we use before shipping the desktop branch:

```bash
bun install
bun run test
bun run typecheck
bun run lint:eslint
bun run check:rust
```

## Build Commands

Cross-platform desktop bundle for the current host OS:

```bash
bun run bundle:desktop
```

macOS `.app` and `.dmg` bundle:

```bash
bun run bundle:desktop:macos
```

Both commands call the Tauri build in `packages/desktop`, so the frontend is rebuilt before the native bundle is produced.

Because updater artifacts are enabled, the bundle step now also needs a Tauri updater signing key. The root scripts automatically use:

- `TAURI_SIGNING_PRIVATE_KEY`, if it is already set
- `TAURI_SIGNING_PRIVATE_KEY_PATH`, if it is already set
- `~/.foundry/keys/foundry-updater.key`, if present on the local machine

If none of those are available, the bundle command will exit with a clear error before building. For passwordless keys, the wrapper also sets an explicit empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` so non-interactive local builds do not hang or fail on a prompt.

## macOS Signing And Notarization

The GitHub `Desktop Release` workflow can now code sign and notarize macOS bundles when Apple credentials are configured in repository settings.

Repository variables:

- `APPLE_SIGNING_REQUIRED`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_API_KEY`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

Repository secrets:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_P8`
- `APPLE_ID`
- `APPLE_PASSWORD`

Notes:

- `APPLE_CERTIFICATE` should be a base64-encoded Developer ID Application `.p12` export.
- The workflow prefers App Store Connect API key notarization when `APPLE_API_KEY_P8`, `APPLE_API_KEY`, and `APPLE_API_ISSUER` are all configured.
- If the API key is not configured, the workflow falls back to Apple ID notarization with `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.
- Leave `APPLE_SIGNING_REQUIRED` unset or set it to `false` while the repo is still being prepared. Set it to `true` once the Apple credentials are in place and signed macOS artifacts should be mandatory on every desktop release.
- Local `bun run bundle:desktop:macos` builds remain unsigned unless you also provide the corresponding Apple signing/notarization environment variables to the local shell.

## Artifact Locations

macOS output is written under:

- `packages/desktop/src-tauri/target/release/bundle/macos/Foundry.app`
- `packages/desktop/src-tauri/target/release/bundle/dmg/Foundry_<version>_<arch>.dmg`

For internal team distribution, share the `.dmg`.

## Current Limitation

These bundles always include signed updater metadata. macOS bundles are only code signed and notarized when the Apple credentials above are configured for the release workflow, or when equivalent Apple signing environment variables are set locally.
