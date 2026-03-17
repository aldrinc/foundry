# Desktop OTA Updates

Foundry Desktop now uses Tauri's updater flow with GitHub Releases as the update feed.

## What is configured in-repo

- Updater artifacts are enabled in `packages/desktop/src-tauri/tauri.conf.json`.
- The committed updater endpoint should point to the GitHub Releases feed for the public Foundry repository:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

- The GitHub Actions release workflow lives at `.github/workflows/release-desktop.yml`.

## Signing key

The updater public key is committed in `tauri.conf.json`.

The private key is intentionally not in the repo. By default, local bundle scripts look for:

```text
$HOME/.foundry/keys/foundry-updater.key
```

The local root bundle scripts (`bun run bundle:desktop` and `bun run bundle:desktop:macos`) automatically use that path if no signing env vars are set.

Add the private key contents to the GitHub repository secret:

- `TAURI_SIGNING_PRIVATE_KEY`

If you later rotate to a password-protected key, also set:

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Release process

1. Bump the desktop version before releasing:

   ```bash
   bun run version:desktop -- 0.1.2
   ```

   That command updates and keeps aligned:
   - `packages/desktop/src-tauri/tauri.conf.json`
   - `packages/desktop/src-tauri/Cargo.toml`
   - `packages/desktop/src-tauri/Cargo.lock`
   - `packages/desktop/package.json`
   If Apple signing secrets are not configured yet, you can programmatically load them into GitHub Actions with:

   ```bash
   bun run configure:desktop:apple-signing -- ...
   ```
2. Update `CHANGELOG.md` with a dated entry for the release version.
   The changelog entry is required before release, and the same notes should be published in the GitHub Release entry.
3. Push the release branch or merged commit to GitHub.
4. Run the `Desktop Release` workflow from GitHub Actions, or push a `desktop-v*` tag.
5. The workflow builds desktop bundles, uploads signed updater metadata, and publishes release assets to GitHub Releases.
6. Publish the GitHub Release with the matching changelog text so the release page and the repo changelog stay in sync.
7. Installed apps with auto-update enabled will check the GitHub feed and prompt the user to install the new version.

The release workflow now verifies that all desktop version files agree, and that a pushed `desktop-v*` tag matches the app version exactly.

## Notes

- The current feed is a stable channel only. The `betaUpdates` setting is stored locally, but it does not yet map to a separate beta release feed.
- GitHub Releases OTA works well for internal distribution as long as your team can access the GitHub repo and release assets.
