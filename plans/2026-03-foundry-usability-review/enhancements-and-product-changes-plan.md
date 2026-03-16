# Foundry Enhancements and Product Changes Plan

Date: 2026-03-15
Status: Investigation complete, implementation not started
Owner: Product + desktop + mobile workstreams

## Purpose

This document covers the non-bug product changes requested in the review. These items either introduce new UX patterns or require a deeper product decision than a direct regression fix.

The four enhancement tracks are:

1. Attachment and image handling redesign
2. Tray/nav bar drop-down redesign
3. Topic creation without requiring a custom first message
4. Mobile app rebuild plan informed by the official open-source Zulip mobile app

## Enhancement 1: Attachment and Image Handling Redesign

### Goal

Users should experience attachments as attachments, not as raw markdown links. The compose experience should show thumbnails or attachment chips, and the message view should avoid exposing bare URLs when the UI can render a richer attachment presentation.

### Current State

- `packages/app/src/components/compose-box.tsx`
  - Uploading a file inserts raw markdown into the textarea: `[filename](url)`.
  - There is no attachment model in compose state.
  - There is no pre-send attachment chip, thumbnail, or remove/retry affordance.
  - Upload completion mutates the live draft text, which is why active typing can be disrupted while an upload finishes.
- `packages/app/src/components/file-attachment-card.ts`
  - Message rendering already upgrades many file links into structured cards.
  - The download action still uses a direct anchor open model.
- `packages/app/src/components/message-html.ts`
  - Images can already render inline and multi-image groups can open in a lightbox.

### Product Direction

Foundry should treat uploads as structured compose entities and structured message attachments.

Desired UI behavior:

- In compose:
  - show thumbnail cards for images
  - show file chips/cards for non-images
  - allow remove, retry, and upload-progress states
  - keep markdown/source representation internal
- In messages:
  - show inline image or file card
  - show a `Download` action and optional overflow menu
  - hide raw upload URLs unless the user explicitly requests copy/open behavior

### Recommended Architecture

Add an attachment layer to composer state instead of writing markdown directly into the text body.

Proposed model:

- compose text
- pending attachments
- uploaded attachments with metadata:
  - server URL
  - filename
  - media type
  - thumbnail URL or local preview
  - upload status

Message sending should compile the final wire format from structured compose state rather than from the user manually editing raw links.

### Implementation Plan

Phase 1: Compose attachment model

- Add structured attachment state to `packages/app/src/components/compose-box.tsx`.
- Keep uploads visible as attachment chips/cards instead of writing markdown into the textarea.
- Support:
  - image preview
  - filename display
  - remove attachment
  - upload progress
  - upload failure and retry

Phase 2: Send pipeline

- At send time, serialize attachments into the final server-compatible message content.
- Keep the serialization internal so the user is not forced to see the generated links.

Phase 3: Message presentation cleanup

- Continue using inline image rendering and file cards.
- Remove visible raw upload URLs from the default rendered experience.
- Add explicit actions such as:
  - Download
  - Open in browser
  - Copy link

Phase 4: Consistency pass

- Make image behavior consistent between:
  - compose previews
  - sent messages
  - message viewer/lightbox
  - file downloads

### Acceptance Criteria

- Uploading an image in compose shows an image thumbnail, not a raw URL.
- Uploading a file in compose shows a file attachment chip/card, not a raw URL.
- Sent messages show rich attachment UI without exposing raw upload links by default.
- Users can still download, open in browser, or copy a link intentionally.

## Enhancement 2: Tray/Nav Bar Drop-Down Redesign

### Goal

The Foundry tray/menu bar icon should act as a real quick-access surface, not just a minimal show/quit launcher.

### Current State

- `packages/desktop/src-tauri/src/lib.rs`
  - Tray menu currently exposes:
    - `Show Foundry`
    - `Quit Foundry`
  - Left click already attempts to show/unminimize/focus the main window.
- There is no tray-level access to settings, account/server switching, notification status, or desktop preferences.

### Product Direction

The tray should support two levels of behavior:

1. Fast open behavior
2. Quick actions and settings

Recommended menu structure:

- Open Foundry
- Open Inbox
- Open Recent Topics
- Separator
- New message or quick compose
- Mark all visible notifications read
- Separator
- Settings
- Notification preferences
- Connected servers
- Separator
- Restart
- Quit

### Technical Plan

Phase 1: Foregrounding and baseline menu cleanup

- Keep `Open Foundry` as the default action.
- Add `Settings`.
- Add `Connected servers`.

Phase 2: Navigation-aware quick actions

- Expose tray actions that can route the main app to:
  - Inbox
  - Recent Topics
  - Starred
- Use app events or a small native-to-webview command bridge.

Phase 3: Desktop control actions

- Add tray toggles or submenus for:
  - show in tray
  - launch at login
  - notification pause or DND

Phase 4: Context-aware status

- Optionally show:
  - unread badge count
  - connected organization name
  - disconnected/error status

### UX Notes

- Do not overload the tray with deep administrative actions.
- Keep account/server switching available, but secondary to open/settings.
- Match platform conventions:
  - macOS menu bar style on macOS
  - system tray style on Windows/Linux

### Acceptance Criteria

- Clicking the tray icon opens Foundry in front.
- The tray menu includes `Settings` and other quick actions.
- Quick actions route the already-running app to the requested screen.
- Users can reach the most important desktop controls without first opening the settings modal manually.

## Enhancement 3: Topic Creation Without Requiring a Separate Message Draft

### Goal

Users should be able to create a topic intentionally, without the current experience feeling blocked by the requirement to invent a separate initial message body.

### Current State

- `packages/app/src/components/compose-box.tsx`
  - Sending is blocked if the body is empty.
  - Topics are only materialized through `sendMessage(...)`.
- `packages/app/src/components/topic-picker.tsx`
  - The UI supports typing a new topic name.
- `packages/app/src/components/stream-sidebar.tsx`
  - `New topic` currently routes to the stream composer and focuses the topic input.
- Topic data in the desktop client is message-derived through topic caches and `max_id`, not topic-record-derived.

### Product Constraint

The current server/client model is message-centric. A topic becomes real because the first message in that topic exists.

### Recommended Direction

Do not attempt to invent a fake empty topic object as the initial implementation. Instead, implement one of these two explicit models:

Option A: Seed message model

- User creates a topic.
- Foundry sends a default first message generated from the topic name.
- User can edit/add more content immediately after.

Option B: Draft topic model

- User creates a local draft topic in the client.
- The draft appears in the sidebar with draft state.
- The topic becomes a real server topic only after first send.

### Recommendation

Start with Option A for speed and clarity.

Suggested default seed message:

- same as topic title
- or a short templated opening line

This matches the user’s stated preference that using the same text by default is acceptable.

### Implementation Plan

Phase 1: Product rule

- Decide the default first-message behavior.
- Add explanatory text in the create-topic flow so the user knows what will happen.

Phase 2: Sidebar and composer UX

- Turn `New topic` into an explicit create flow.
- Pre-fill:
  - topic name
  - initial message with the selected default behavior

Phase 3: Message/topic synchronization

- After send:
  - add the topic to the local topic cache
  - navigate directly into the new topic

### Acceptance Criteria

- A user can intentionally create a new topic from the stream UI without friction.
- The first message behavior is predictable and visible before send.
- The created topic appears in the sidebar immediately after creation.

## Enhancement 4: Mobile App Rebuild Plan

### Goal

Create a mobile plan that learns from the official open-source Zulip mobile app, but rebuilds Foundry mobile around Foundry branding, Foundry product priorities, and a maintainable architecture.

### Key Investigation Findings

Official upstream references:

- Official mobile repo: `https://github.com/zulip/zulip-flutter`
- Official launch post: `https://blog.zulip.com/2025/06/17/flutter-mobile-app-launched/`
- Official real-time events API docs: `https://zulip.com/api/real-time-events`
- Official mobile push notification docs: `https://zulip.readthedocs.io/en/latest/production/mobile-push-notifications.html`

Foundry-local backend readiness:

- `services/foundry-core/app/zproject/urls.py`
  - retains mobile auth compatibility endpoints
  - retains mobile server settings and API key flows
  - retains push registration endpoints
  - retains `register` and events infrastructure needed by mobile clients
- `services/foundry-core/app/zerver/views/push_notifications.py`
  - still supports APNS and FCM token registration/removal

### Recommendation

Build Foundry Mobile as a native mobile app, not as a thin mobile wrapper around the existing desktop Tauri UI.

Recommended client stack:

- Flutter for the mobile app shell and UI
- shared typed API/domain contracts extracted from Foundry server behavior where practical
- Foundry-specific design system and feature modules layered on top

### Why Not Reuse the Current Desktop Tauri App for Mobile

The current desktop app is not a good mobile foundation even though the native Rust layer contains a `mobile_entry_point` attribute.

Reasons:

- `packages/desktop` is built around desktop-only concerns such as tray behavior, shell opening, window state, and process integration.
- `packages/app` uses desktop/webview-oriented DOM hydration patterns for message rendering and media handling.
- the current UI assumes desktop layout density, desktop input, and desktop navigation structure
- there is no established iOS/Android product shell, release pipeline, or mobile design system in the repo today

Recommendation:

- reuse backend protocol knowledge
- reuse product behavior and data-model lessons
- do not reuse the current desktop UI runtime as the mobile product shell

### Why Flutter Is the Best Starting Point

- The official current Zulip mobile client is Flutter, not the old React Native app.
- The upstream Flutter app proves the viability of:
  - event-driven sync
  - multi-account login
  - attachment handling
  - push notification workflows
  - mobile-specific navigation patterns
- Foundry can learn from that architecture without inheriting Zulip branding or product decisions wholesale.

### Rebuild Principles

1. Rebuild the product experience, not the legacy web UI.
2. Keep the server protocol close to Foundry Core and Zulip-compatible behavior where that reduces backend risk.
3. Avoid a fork that becomes permanently unmergeable with useful upstream mobile lessons.
4. Make multi-account, offline tolerance, and authenticated media first-class from day one.
5. Keep Foundry-specific functionality modular so the core messaging shell remains stable.

### Proposed Mobile Architecture

Core layers:

- Presentation layer
  - Flutter screens, navigation, design system, accessibility, responsive mobile layouts
- Domain layer
  - conversations
  - topics
  - messages
  - uploads
  - notifications
  - account/session handling
- Data layer
  - register and event queue sync
  - message fetching
  - authenticated media fetching
  - push device registration
  - local cache/storage

Foundry-specific modules:

- inbox prioritization surfaces
- Foundry assistant entry points
- supervisor workflows, if they belong on mobile

Shared-code extraction targets:

- narrow parsing and conversation identity rules
- message/topic/user types generated from server contracts where practical
- attachment metadata parsing
- notification preference models
- URL resolution rules for uploads and authenticated media

### MVP Scope

Mobile MVP should include:

1. multi-account login
2. inbox, channel, topic, and DM navigation
3. message compose and send
4. image/file upload
5. inline image viewing
6. push notifications
7. basic message actions
8. settings for notifications and account/session management

Do not put these in MVP:

- full admin settings parity
- every desktop-only system preference
- advanced supervisor controls unless a concrete mobile use case exists

### Delivery Plan

Phase 0: Product definition and backend audit

- Confirm mobile MVP and non-goals.
- Audit any server-side brand leaks or auth flows that would surface in mobile webviews/login pages.

Phase 1: Foundational client

- Create app shell, navigation, theming, auth, account switcher, and base sync layer.
- Reuse proven register/events patterns from the upstream Zulip mobile architecture.

Phase 2: Messaging parity

- Implement inbox, channel/topic, DM views, compose, uploads, reactions, and message actions.
- Add authenticated media support and image viewer parity.

Phase 3: Mobile-specific reliability

- Add push notifications, background reconnect behavior, offline cache, and deep links.

Phase 4: Foundry differentiation

- Add Foundry-specific inbox intelligence and assistant surfaces that make sense on a phone.

Phase 5: Hardening and rollout

- Internal dogfood
- TestFlight/internal Android distribution
- staged tenant rollout

### Build-vs-Fork Recommendation

Recommended approach:

- Rebuild the app codebase cleanly in Flutter under Foundry ownership.
- Study the upstream Zulip Flutter repo for:
  - account model
  - event sync model
  - message list rendering strategies
  - notification lifecycle
  - testing patterns
- Avoid a direct product fork unless there is a strong merge strategy and a dedicated maintainer for upstream rebases.

### Success Criteria

- Mobile users can complete the same core messaging tasks as desktop users.
- Mobile auth, push, and media flows do not leak users into Zulip-branded server pages.
- Foundry branding is consistent across splash, auth, notifications, and message UI.
- The architecture supports steady delivery rather than a one-time port.

## Recommended Delivery Order

1. Attachment and image handling redesign
2. Tray/nav bar menu enhancement
3. Topic creation flow
4. Mobile app discovery and architecture phase

The mobile plan should begin only after the branding/migration work in the companion migration plan is underway, because otherwise the mobile auth and browser fallback surfaces will inherit the same mixed-brand experience.
