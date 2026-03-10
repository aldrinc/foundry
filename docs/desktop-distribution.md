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

## Artifact Locations

macOS output is written under:

- `packages/desktop/src-tauri/target/release/bundle/macos/Foundry.app`
- `packages/desktop/src-tauri/target/release/bundle/dmg/Foundry_<version>_<arch>.dmg`

For internal team distribution, share the `.dmg`.

## Current Limitation

These bundles include signed updater metadata, but the app bundle itself is still unsigned. They are suitable for internal testing and distribution, but they are not yet code signed or notarized for friction-free public macOS installation.
