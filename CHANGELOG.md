# Changelog

All notable user-facing Foundry changes should be tracked here.
Every desktop release must add a versioned entry here and publish the same notes on the corresponding GitHub Release.

Desktop release artifacts are published on [GitHub Releases](https://github.com/aldrinc/foundry/releases).

## Unreleased

- Public repository polish, launch checklist, support routing, and issue templates

## 0.16.3 - 2026-03-17

- Moved the conversation search bar into the top bar with a cleaner layout that keeps filtering controls visible while reading.
- Fixed message list layout shifting while conversations load so the reading position stays visually stable.
- Fixed the message action hover bar positioning so reply and copy actions stay aligned to the selected message.
- Updated the desktop application bundle metadata to version `0.16.3`.

## 0.16.2 - 2026-03-17

- Added desktop message permalinks that copy as `foundry://message` deep links and reopen the matching conversation in-app.
- Added inline message replies in conversation view, including reply previews, quoted context, and links back to the original message.
- Added smarter Zulip conversation link handling so pasted stream/topic/message links convert into markdown shortcuts and clicked same-realm links navigate inside Foundry.
- Added anchored message loading so deep-linked conversations fetch around the target message and center it in the message list.
- Added live desktop version and Tauri version details in Settings, plus manual update controls with clearer updater error messaging.
- Updated compose and supervisor composer states to use the Foundry green accent treatment across themes for active controls, drag/drop, and send actions.
- Fixed deep-link routing so sign-in callbacks and message links no longer consume each other while switching orgs or recovering a login session.
- Updated the desktop application bundle metadata to version `0.16.2`.

## 0.1.1 - 2026-03-10

- First cross-platform public desktop release workflow with signed OTA updater metadata
- Desktop packaging for macOS, Windows, and Linux through GitHub Actions
- Native desktop notification sound support and updater plumbing
