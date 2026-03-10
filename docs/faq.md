# FAQ

## Is Foundry open source?

Foundry-authored code in this repository is source-available under Elastic License 2.0. Some imported subtrees keep their upstream licenses. See [../LICENSE](../LICENSE) and [../LICENSING.md](../LICENSING.md).

## Can I self-host Foundry?

Yes, for internal use. The desktop app, control-plane service, and collaboration-core pieces are all in this repository. The server and infra story is still being standardized, so expect the self-hosting path to be more manual than a polished one-click deployment.

## Where do I download the desktop app?

Desktop artifacts are published on [GitHub Releases](https://github.com/aldrinc/foundry/releases). The current public release flow builds macOS, Windows, and Linux packages.

## How do desktop updates work?

Foundry Desktop uses signed Tauri updater metadata published through GitHub Releases. Installed clients can check for updates and apply newer desktop builds when auto-update is enabled. See [desktop-ota-updates.md](desktop-ota-updates.md).

## Where should I report bugs or security issues?

Use [../SUPPORT.md](../SUPPORT.md) for normal bug and feature routing. Use [../SECURITY.md](../SECURITY.md) for vulnerabilities.
