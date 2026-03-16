# Foundry Bugs and Issues Remediation Plan

Date: 2026-03-15
Status: Investigation complete, implementation not started
Owner: Foundry desktop + Foundry Core team

## Purpose

This document covers the items that should be treated as product bugs, regressions, or user-facing correctness issues. The goal is to restore expected behavior in the shipping Foundry experience, not to redesign the product.

The investigation covered three layers of the repo:

- `packages/app`: the custom SolidJS desktop UI.
- `packages/desktop`: the Tauri shell, tray behavior, and native integrations.
- `services/foundry-core/app`: the server/web layer inherited from Zulip and still used for browser auth, uploads, and public/spectator flows.

## Executive Summary

The major usability bugs fall into seven clusters:

1. Image clicks still escape to the external browser in cases where Foundry already has enough infrastructure to render the image in-app.
2. The notification bot still uses Zulip-branded avatar assets.
3. The channel sidebar behavior regressed from expected chat-app behavior: channel rows do not collapse on second click, and channel settings do not open a channel-scoped view.
4. The desktop composer is missing several actions that exist in the legacy Zulip web experience and that users consider core.
5. Completing an upload while the user is actively typing can interfere with the current cursor position and compose flow.
6. Large-file uploads can fail with a raw nginx `413 Request Entity Too Large` error instead of a Foundry-level validation message.
7. Tray foregrounding is partially implemented in native code, but needs verification and hardening to guarantee the main window actually comes to the front on macOS and Windows.

## Bug 1: Image Click Should Open in Foundry by Default

### User Problem

When a user clicks an image attachment, the default behavior should be an in-app viewer inside Foundry. Opening the system browser should be an explicit secondary action, not the primary path.

### Current State Evidence

- `packages/app/src/components/message-item.tsx`
  - `handleContentClick` intercepts `a[href]` inside rendered message content.
  - It prevents default browser navigation and calls `platform.openLink(...)`.
  - For many `/user_uploads/` links it also prefers the explicit download URL path before opening externally.
  - `platform.openLink(...)` is the desktop abstraction for external browser opening.
- `packages/desktop/src/index.tsx`
  - `openLink(url)` delegates to Tauri shell opening, which is an external browser/system handler.
- `packages/app/src/components/message-html.ts`
  - Foundry already has an in-app image gallery/lightbox implementation: `hydrateMessageImageCarousels(...)`.
  - That lightbox already includes an explicit `Open in browser` action, which matches the requested secondary behavior.
  - Authenticated image loading is already supported through `hydrateAuthenticatedMessageImages(...)` and `commands.fetchAuthenticatedMediaDataUrl(...)`.

### Root Cause

Foundry has two conflicting image behaviors:

- Multi-image blocks can be enhanced into an in-app gallery/lightbox.
- Generic link clicks in rendered message HTML are still routed to `platform.openLink(...)`.

Single-image messages and many inline image cases never get upgraded into the existing lightbox flow, so the generic external-open path wins.

When that external-open path targets an authenticated upload and the user is not already logged into the browser, Foundry Core redirects to the legacy browser login flow. That is why this bug feels like both an image bug and a migration bug.

### Recommended Fix

Make the message renderer image-aware before the generic anchor handler runs.

Implementation approach:

1. Detect whether the clicked anchor wraps an image or points to an image upload.
2. Route image clicks to an in-app viewer entry point.
3. Keep `Open in browser` inside the viewer as the explicit secondary action.
4. Preserve external open behavior for non-image files and true external links.

### Technical Plan

Phase 1: Normalize media click routing

- Add a message-level media click resolver in `packages/app/src/components/message-item.tsx`.
- Distinguish:
  - inline images
  - gallery items
  - authenticated image uploads
  - non-image upload files
  - external links

Phase 2: Extend the existing lightbox implementation

- Expand `packages/app/src/components/message-html.ts` so single-image blocks can use the same viewer overlay as multi-image groups.
- Reuse the existing authenticated image pipeline instead of creating a second media fetch path.
- Add a small entry-point API so `message-item.tsx` can ask the renderer to open the current image in the viewer.

Phase 3: Clean browser fallback behavior

- Keep browser open for:
  - explicit `Open in browser`
  - modifier-click behavior if desired
  - non-image external URLs
  - non-image file downloads

### Acceptance Criteria

- Clicking an image in a message opens the image inside Foundry.
- The in-app viewer works for single images and grouped images.
- Authenticated uploads open without requiring an external browser login session.
- The viewer includes a visible `Open in browser` action.
- Clicking a PDF or non-image file still follows the intended download/open path.
- Behavior is validated in a deployed dev build, not only in local development.

### Risks and Dependencies

- The current lightbox logic is DOM-hydration based, so event ordering between renderer hydration and click handling must be tested carefully.
- Authenticated image URLs must continue to work when the image viewer swaps from thumbnail to original media.

## Bug 2: Notification Bot Still Uses the Zulip Icon

### User Problem

The notification bot should present as Foundry, not as Zulip.

### Current State Evidence

- `services/foundry-core/app/zerver/lib/avatar.py`
  - The system bot avatar map still points `notification-bot` to static avatar assets.
- `services/foundry-core/app/static/images/static_avatars/notification-bot.png`
- `services/foundry-core/app/static/images/static_avatars/notification-bot-medium.png`

The current static assets are Zulip-branded.

### Root Cause

The bot avatar is not driven by the desktop app icon; it is driven by server-side static assets in Foundry Core. Those assets were inherited from Zulip and never rebranded.

### Recommended Fix

Replace the notification bot static avatar assets with Foundry-branded assets and audit adjacent system-bot defaults that remain Zulip-branded.

### Technical Plan

Phase 1: Replace assets

- Replace:
  - `services/foundry-core/app/static/images/static_avatars/notification-bot.png`
  - `services/foundry-core/app/static/images/static_avatars/notification-bot-medium.png`

Phase 2: Audit system bot presentation

- Review:
  - `services/foundry-core/app/zproject/default_settings.py`
  - any bot profile defaults shown in admin/bot settings UIs
- Decide whether bot email addresses remain Zulip-derived internally or are also rebranded in user-visible surfaces.

### Acceptance Criteria

- Existing and newly displayed notification bot messages show the Foundry avatar.
- Bot avatar displays correctly in desktop, web, and any server-rendered message history views.
- No Zulip icon remains in the notification bot’s visible profile surfaces.

### Risks and Dependencies

- Some avatar URLs may be cached aggressively by browser or CDN layers.
- If bot avatar metadata is persisted separately from static fallback assets in some environments, a cache-busting or profile refresh step may be required.

## Bug 3: Clicking a Channel Again Does Not Collapse It

### User Problem

Users expect a second click on an already open channel row to collapse the topic list. Today only the narrow arrow path collapses it.

### Current State Evidence

- `packages/app/src/components/stream-sidebar.tsx`
  - Clicking the stream row always calls `props.onClick()` and then expands if needed.
  - If the item is already expanded, clicking the row does not collapse it.
  - Collapse currently exists only in the separate arrow handler `toggleExpand(...)`.

### Root Cause

The stream row and the stream disclosure control are modeled as different interactions. That is inconsistent with user expectation and with prior chat-app behavior.

### Recommended Fix

Unify the click contract so the main row toggles expansion state when the user is interacting with the currently active/open stream.

### Technical Plan

1. Update stream row click semantics in `packages/app/src/components/stream-sidebar.tsx`.
2. Preserve direct navigation into the stream narrow on first click.
3. If the row is already active and already expanded, a second click should collapse it.
4. Keep a dedicated expand affordance if desired, but make the row itself symmetric.

### Acceptance Criteria

- First click opens the channel.
- Second click on the same open channel collapses the topic list.
- Clicking the arrow still works.
- Topic fetching is not re-triggered unnecessarily on collapse/re-expand.

## Bug 4: “Channel Settings” Opens Generic Settings Instead of That Channel

### User Problem

When a user opens the three-dot menu for a specific channel and selects `Channel settings`, the app should open the settings view for that exact channel. Today it opens the generic settings modal with no channel context.

### Current State Evidence

- `packages/app/src/components/stream-sidebar.tsx`
  - The context menu action calls `props.onOpenSettings?.()` with no channel identifier.
- `packages/app/src/app.tsx`
  - Settings opening is section-based, not entity-based.
- `packages/app/src/views/settings.tsx`
  - `SettingsView` supports only broad sections such as `"channels"`.
- `packages/app/src/views/settings-channels.tsx`
  - The channel settings UI is a generic list with optional inline expansion, not a deep-linked single-channel experience.

### Root Cause

The settings architecture only supports section routing. It does not support contextual routing or a selected channel payload.

### Recommended Fix

Extend the settings modal contract to accept channel context, then land the user directly on that channel’s editable settings.

### Technical Plan

Phase 1: Extend settings state

- Add a settings route payload type, not just a section enum.
- Example shape:
  - section: `"channels"`
  - entity type: `"channel"`
  - entity id: stream id

Phase 2: Thread channel context through openers

- Update the stream sidebar context menu to pass the selected channel.
- Update app-level `openSettings(...)` to accept a richer payload.

Phase 3: Make channel settings land in the right place

- Update `packages/app/src/views/settings-channels.tsx` to:
  - auto-select the requested stream
  - scroll it into view
  - open the edit panel immediately

### Acceptance Criteria

- Choosing `Channel settings` from a channel menu opens the settings modal directly to that channel.
- The modal title or breadcrumb makes it clear which channel is being edited.
- The user can immediately change that channel’s settings without searching again.

## Bug 5: Core Compose Actions Regressed from Prior Zulip Experience

### User Problem

Users are missing compose actions that existed in the prior Zulip-based experience and are considered core: video call, voice call, GIF, saved snippet, global time, poll, and to-do insertion.

### Current State Evidence

- `packages/app/src/components/compose-box.tsx`
  - Current desktop compose actions are limited to upload, formatting toggle, emoji, options, and send.
- `services/foundry-core/app/web/templates/compose_control_buttons.hbs`
  - The legacy Zulip web composer includes:
    - upload
    - video call
    - voice call
    - emoji
    - global time
    - GIF
    - saved snippets
    - poll
    - to-do list
    - formatting help
    - supervisor AI entry

### Root Cause

The Foundry desktop rewrite rebuilt the composer UI without carrying forward feature parity from the legacy Zulip compose control surface.

### Recommended Fix

Treat these missing compose actions as parity bugs rather than optional future enhancements, and restore them in descending order of operational importance.

### Technical Plan

Priority order:

1. Video call
2. Voice call
3. Saved snippets
4. GIF picker
5. Global time
6. Poll insertion
7. To-do insertion

Implementation steps:

1. Inventory backend/server dependencies already present in Foundry Core.
2. Map each legacy action to:
  - available server support
  - available API endpoints
  - desktop UI work needed
3. Implement the compose action strip in `packages/app/src/components/compose-box.tsx`.
4. Reuse upstream interaction patterns where possible instead of inventing new syntax.

### Acceptance Criteria

- The compose surface restores the missing core actions.
- Actions insert or launch the expected content/workflow.
- If a feature is unavailable for the connected organization, the button state explains why rather than silently disappearing.

### Risks and Dependencies

- Some features depend on organization/server configuration, not just client UI.
- Video/voice behavior needs parity with the configured provider model in Foundry Core.

## Bug 6: Upload Completion Interferes With Active Typing and Cursor Flow

### User Problem

If a user is typing while an image upload is still in progress, the completed upload can interfere with the current compose flow. Instead of behaving like a separate attachment, the uploaded image is inserted into the draft in a way that disrupts where the user is typing.

### Current State Evidence

- `packages/app/src/components/compose-box.tsx`
  - `uploadSingleFile(...)` waits for the upload to finish and then mutates the compose text directly.
  - The upload is represented as markdown inserted into the textarea content: `[filename](url)`.
  - The compose model does not separate attachment state from typed message-body state.

### Root Cause

The upload system treats attachments as text mutations rather than as first-class compose entities. When an upload completes, it updates the same controlled textarea state the user is actively editing. That makes uploads race with normal typing and cursor/selection state.

### Recommended Fix

Apply an immediate behavior fix and then fold the permanent solution into the structured-attachments redesign.

Immediate behavior fix:

1. Never insert upload markdown relative to the live caret.
2. If raw insertion still exists temporarily, append it at the end of the draft without stealing cursor focus or selection.
3. Prefer showing an upload chip/thumbnail outside the textarea as soon as practical.

Permanent behavior fix:

- move uploads out of the textarea model entirely and into attachment UI state

### Technical Plan

Phase 1: Stop interfering with typing

- Update `packages/app/src/components/compose-box.tsx` so upload completion does not disrupt active typing or move the user’s effective insertion point.
- Preserve the current selection if the textarea value must still be updated.

Phase 2: Remove raw-text attachment insertion from the compose experience

- Replace upload-as-markdown mutation with structured attachment UI.
- Use the send pipeline to serialize attachments later, instead of mutating the user-visible draft mid-typing.

Phase 3: Validate concurrent typing behavior

- Test:
  - typing at the end of a draft during upload
  - typing in the middle of a draft during upload
  - multiple uploads completing in sequence
  - drag/drop, picker upload, and paste upload flows

### Acceptance Criteria

- Completing an upload does not hijack or disrupt the user’s current typing flow.
- The user’s cursor position and selection remain stable while typing.
- Uploads appear at the end of the draft only as a temporary fallback, or preferably as separate attachment UI.
- Multiple uploads do not scramble message text.

### Risks and Dependencies

- A partial fix that still mutates textarea content may remain fragile until the attachment model is separated from compose text.
- This bug overlaps directly with the attachment redesign in the enhancements document and should be solved in a compatible way.

## Bug 7: Large-File Uploads Fail With Raw `413 Request Entity Too Large`

### User Problem

Uploading a file around 101 MB produced a raw HTML rejection message instead of a usable Foundry error. The user sees server/proxy internals rather than a clear explanation of the actual upload limit.

### Current State Evidence

- `packages/desktop/src-tauri/src/zulip/api.rs`
  - `upload_file(...)` returns `Err(format!("Upload failed: {}", body))` when the HTTP response is not successful.
  - If the upstream response body is HTML, that raw HTML is forwarded as the error string.
- `packages/app/src/components/compose-box.tsx`
  - `uploadError` is rendered directly to the user.
- `packages/app/src/components/supervisor/supervisor-composer.tsx`
  - uses the same upload pattern and would surface the same class of raw error.
- `services/foundry-core/app/zerver/views/upload.py`
  - if the request reaches the app layer, oversized uploads are rejected with a structured, user-readable JSON error describing the configured max upload size.
- `services/foundry-core/app/zproject/default_settings.py`
  - the inherited server default is `MAX_FILE_UPLOAD_SIZE = 20 * 1024`, which is far above 101 MB.
- `services/foundry-core/app/docs/production/reverse-proxies.md`
  - explicitly notes that if `client_max_body_size` is not configured correctly, large uploads will fail at nginx/proxy level.

### Root Cause

This failure indicates a layered problem:

1. The deployed reverse proxy or ingress is rejecting the request before Foundry Core handles it.
2. The desktop client has no preflight size validation using the server’s configured upload limit.
3. The desktop UI surfaces the raw HTML response body instead of translating it into a product-level error.

### Recommended Fix

Treat this as both a deployment-alignment bug and a desktop error-handling bug.

Implementation goals:

1. Align proxy/body-size limits with the intended Foundry upload limit.
2. Expose the effective upload limit to the desktop client.
3. Preflight oversized uploads before network submission where possible.
4. Convert upstream `413` and similar proxy responses into a clear Foundry error message.

### Technical Plan

Phase 1: Deployment and infrastructure alignment

- Audit the active reverse proxy/ingress configuration for the Foundry deployment.
- Ensure request body limits match the intended product upload ceiling.
- Verify alignment between:
  - proxy body-size limit
  - Foundry Core `MAX_FILE_UPLOAD_SIZE`
  - any tenant/plan-specific file limits

Phase 2: Desktop preflight validation

- Expose the effective upload limit to the desktop app.
- Add size checks before upload starts in:
  - `packages/app/src/components/compose-box.tsx`
  - `packages/app/src/components/supervisor/supervisor-composer.tsx`
- Show a clear error before attempting the request when the file is too large.

Phase 3: Friendly error mapping

- Update `packages/desktop/src-tauri/src/zulip/api.rs` to inspect status codes and map common failures.
- For `413`, return a product-level message such as:
  - `This file is larger than the current upload limit.`
- Avoid surfacing raw HTML bodies in desktop error UI.

Phase 4: UX refinement

- Show the allowed max upload size in the error when known.
- Consider showing the limit in the upload picker/help text so the user does not discover it only after failure.

### Acceptance Criteria

- A file larger than the allowed limit is rejected with a clear Foundry error message.
- The UI never displays raw HTML from nginx or another proxy as the user-facing upload error.
- If the effective max size is known, the user sees that size in the error copy.
- The deployed proxy/body-size config and app-level upload limits are aligned and documented.

### Risks and Dependencies

- The real cap may differ across environments if ingress, CDN, or load balancer settings are inconsistent.
- The desktop app currently does not consume upload-limit metadata in the compose flow, so this fix may require plumbing additional settings through the login/register contract.

## Bug 8: Tray Icon Foregrounding Needs Verification and Hardening

### User Problem

When the user clicks the Foundry tray icon, Foundry should reliably appear in the foreground. It should not remain behind other windows.

### Current State Evidence

- `packages/desktop/src-tauri/src/lib.rs`
  - Tray left click calls `show_main_window(...)`.
  - `show_main_window(...)` calls:
    - `window.show()`
    - `window.unminimize()`
    - `window.set_focus()`

This means foregrounding is already intended, but the current implementation may still be insufficient on some OS/window-manager combinations.

### Root Cause

The code is trying to foreground the window, but native window activation rules are platform-specific. On macOS in particular, `show + focus` is not always equivalent to full app activation from a tray/menu bar context.

### Recommended Fix

Keep the existing foreground logic, but harden it with platform-specific verification and, if needed, native activation steps.

### Technical Plan

1. Validate current behavior on:
  - macOS with multiple Spaces
  - macOS with another app fullscreen
  - Windows with minimized app
  - Linux with the supported desktop environments
2. If macOS still fails, add native app activation behavior in the tray-open path.
3. Add regression coverage around:
  - second-instance focus
  - tray click focus
  - close-to-tray reopen

### Acceptance Criteria

- Clicking the tray icon brings the Foundry main window to the front.
- Reopening from tray works after close-to-tray and minimize-to-tray flows.
- Behavior is verified in the dev deployment path used for user testing.

## Recommended Delivery Sequence

Sequence the bug work in this order:

1. Image opening default behavior
2. Channel collapse and channel-scoped settings
3. Compose parity restoration for call actions first
4. Upload/typing interference fix
5. Large-upload limit handling and friendly `413` errors
6. Notification bot avatar
7. Tray foreground hardening

## Verification Requirements

Per repository policy, each bug fix should not be considered complete until:

- the change ships through the primary codebase
- automated tests pass with a 100% pass rate
- a dev build/dev URL is available for manual validation
- the affected flow is manually exercised in the product UI
- the user confirms the result is satisfactory
