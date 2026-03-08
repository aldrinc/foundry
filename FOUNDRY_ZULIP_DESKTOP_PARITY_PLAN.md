# Foundry Zulip Desktop Parity Plan

## Goal

Bring Foundry to parity with the Zulip desktop baseline for:

- the Settings experience
- the channel stream sidebar
- the topic list and topic actions
- the server-backed admin/settings surfaces that those workflows depend on

This document should be treated as Phase 2 of the broader Foundry parity program.

Phase 1 parity work is already underway. Phase 2 narrows the focus to the settings surface, the channel and topic sidebars, and the admin/settings pages they depend on.

This is not a backend-only plan. It is a full delivery plan with the work separated into:

- backend work
- frontend work

The purpose of that split is staffing and distribution. Backend owners can close the remaining contract, capability, and event-consistency gaps while frontend owners drive the visible parity work.

Current planning assumption:

- core backend parity foundations are substantially complete
- most remaining product work is frontend parity
- the remaining backend work is targeted gap closure and hardening, not a fresh backend program

## Definition of Done

A parity item is only complete when:

- the behavior exists in the primary codebase
- the behavior is backed by real desktop or server logic, not placeholder state
- tests for the affected area pass
- the behavior is deployed to a dev environment
- the workflow works in the real UI
- the user validates the workflow

## Verified Current Gaps

### Settings

- Theme selection updates local state and sets `data-theme`, but the desktop CSS still follows `prefers-color-scheme` rather than `data-theme`.
- Font size selection updates `--font-size-base`, but the app does not consume that variable broadly enough for the change to affect real UI text.
- Several controls in Settings are stored but have no observable effect, or are only partially wired.
- Several admin/settings pages are still local-state shells rather than server-backed surfaces.

### Channel Sidebar

- Channel rows do not expose the Zulip-style hover ellipsis affordance.
- Current channel menu coverage is minimal.
- The existing mute flow is still effectively local-store behavior rather than a fully server-backed mutation path.
- Channel-level user preference mutations exist in backend bindings but are not surfaced coherently in the UI.

### Topic Sidebar

- Topic rows do not expose the Zulip-style hover ellipsis affordance.
- Topic menu coverage is minimal.
- Topic follow or mute behavior has backend support, but the UI does not expose it properly.
- Topic move and resolve workflows are not yet available through a stable desktop command surface.

### Settings and Admin Surfaces

- `Channels`, `Users`, `Groups`, `Bots`, `Linkifiers`, `Emoji`, and `Org Permissions` are not at parity as full operational surfaces.
- Some of these already have backend contracts; others still need desktop command completion or clearer role-aware gating.

## Phase 2 Delivery Model

### Distribution Strategy

Phase 2 should be staffed as two coordinated workstreams:

- backend workstream:
  - close the remaining command and contract gaps
  - harden event reconciliation
  - capability-gate unsupported features
  - support frontend implementation with stable mutation paths
- frontend workstream:
  - deliver the visible parity work in settings, channels, and topics
  - remove placeholder UI
  - stop shipping controls that do not produce real behavior

This plan does not require the frontend to wait on backend work that is already complete. It does require the frontend to avoid building over any area still marked as contract-incomplete.

### Backend Status Assumption

Backend parity is already well advanced. For this phase, backend work should be treated as:

- validation of what is already done
- filling the remaining gaps
- exposing unsupported features honestly
- supporting frontend parity with stable typed behavior

### Authority Model

Every setting and sidebar action must be explicitly assigned to one authority:

- renderer-local
- server-synced Zulip preference
- native desktop setting
- admin or organization setting
- unsupported

If the authority is unclear, the feature is not ready for frontend parity work.

## Backend Workstream

## BE-0: Freeze the Parity Matrix

### Objective

Create a backend-owned parity matrix for every relevant settings row and every channel/topic action so frontend implementation can be distributed safely.

### Scope

- Enumerate every control in the current Settings navigation.
- Enumerate every channel action required for Zulip parity.
- Enumerate every topic action required for Zulip parity.
- Mark each item as:
  - `working`
  - `partial`
  - `missing contract`
  - `unsupported`
- Mark the source of truth for each item:
  - local renderer
  - desktop runtime
  - Zulip user setting
  - Zulip admin setting
  - server event stream

### Required Output

- A settings parity matrix
- A channel action matrix
- A topic action matrix
- A capability map showing which actions must be hidden or disabled if unsupported

### Acceptance Criteria

- No frontend parity task proceeds in an area without a mapped backend authority.
- No item remains in the ambiguous state of “UI exists, backend unknown.”

## BE-1: Clean Up the Settings Contract

### Objective

Make every settings control fall into one of two valid states:

- fully backed by real behavior
- explicitly unsupported and capability-gated

### Current State

The platform contract already includes:

- `getDesktopSettings`
- `setDesktopSettings`
- `getDesktopCapabilities`
- server-backed user settings sync for several Zulip preferences

But the actual runtime behavior is uneven:

- start-at-login is real
- tray visibility is real
- quit-on-close and start-minimized are real
- proxy rules are mostly real
- PAC URLs are stored but not applied
- custom CSS is real
- spellcheck is stored but not verified as runtime-applied
- auto-update and beta updates are stored but not validated as policy-enforced
- download location is selected but not clearly used by downloads
- theme and font size are frontend regressions, not backend gaps

### Tasks

- Classify every existing setting in `General`, `Notifications`, `Account`, `App`, `Network`, and `Servers`.
- Split settings into four buckets:
  - renderer-only settings
  - Zulip-synced user settings
  - native desktop settings
  - unsupported or deferred settings
- Tighten `DesktopCapabilities` so unsupported settings are capability-gated rather than silently saved.
- Confirm which of these are true native behaviors and which are currently just persistence:
  - `autoUpdate`
  - `betaUpdates`
  - `spellcheck`
  - `downloadLocation`
  - `pacUrl`
- For any partial setting, choose one path:
  - implement fully
  - mark unsupported and hide or disable

### Specific Backend Decisions Needed

- PAC URL support:
  - either implement PAC application in the native client
  - or capability-gate the PAC UI as unsupported
- Spellcheck:
  - verify whether the webview compose surface actually consumes the setting
  - if not, add the runtime bridge or capability-gate the setting
- Download location:
  - ensure file download flows read from the configured location
  - otherwise capability-gate the control
- Auto-update and beta updates:
  - either connect them to a real updater policy path
  - or disable them until updater configuration is production-ready

### Acceptance Criteria

- Every settings row has a real authority and a real effect, or is visibly unsupported.
- No desktop-facing setting remains a silent no-op.

## BE-2: Close Channel Sidebar Backend Gaps

### Objective

Provide a complete backend mutation surface for Zulip-style channel actions.

### Current State

The desktop bindings already expose:

- `markStreamAsRead`
- `unsubscribeStream`
- `updateSubscriptionProperties`

The subscription schema already carries:

- `is_muted`
- `pin_to_top`
- `color`
- `desktop_notifications`
- `audible_notifications`
- `push_notifications`
- `email_notifications`
- `wildcard_mentions_notify`
- `in_home_view`

This means a large part of the channel backend contract already exists. The remaining work is to standardize semantics, event reconciliation, and any missing stream-level operations.

### Tasks

- Standardize channel preference mutation through `updateSubscriptionProperties` only.
- Remove reliance on local-only store toggles for mute or pin behavior.
- Define the channel actions the backend must fully support for parity:
  - mark channel as read
  - mute or unmute channel
  - pin or unpin channel
  - notification override changes
  - unsubscribe
  - channel settings entry point
- Audit whether “channel settings” needs:
  - only a deep link into Foundry settings
  - or true stream metadata mutation support such as name, description, and privacy
- If stream metadata editing is required for parity, add a typed command surface for it instead of relying on ad hoc UI-only handling.

### Acceptance Criteria

- Every channel menu action required for parity has a stable desktop command path.
- Channel preference changes survive reload and multi-org reconnect.
- Event handling converges local state back to server truth.

## BE-3: Close Topic Sidebar Backend Gaps

### Objective

Provide a complete backend mutation surface for Zulip-style topic actions.

### Current State

The desktop bindings already expose:

- `markTopicAsRead`
- `updateTopicVisibilityPolicy`

This covers read-state and follow or mute policy, but not the full topic lifecycle needed for parity.

### Tasks

- Define the topic actions the backend must fully support for parity:
  - mark topic as read
  - follow or unfollow topic
  - mute or unmute topic where distinct from follow semantics
  - move or rename topic
  - resolve or unresolve topic
- Keep copy-link out of backend scope; that is a frontend navigation concern.
- Add typed desktop commands for topic lifecycle actions that are currently missing:
  - rename or move topic
  - resolve or unresolve topic
- Do not let the frontend fake these through ad hoc message editing batches without an explicit backend contract.
- Ensure topic state changes reconcile against `user_topic` events and any relevant message or topic update events.

### Acceptance Criteria

- Topic follow state is server-backed and event-driven.
- Topic move and resolve actions have first-class backend commands.
- No topic lifecycle action depends on local-only UI state.

## BE-4: Finish the Settings and Admin Backend Surface

### Objective

Make every parity-scoped settings or admin page depend on real data and real mutations.

### Current State

Several useful backend/admin contracts already exist for:

- users
- invites
- user groups
- linkifiers
- custom emoji
- bots
- channel subscription property updates

The main gap is that large parts of the frontend still run on placeholder state.

### Tasks

- Confirm and harden the existing backend contracts for:
  - users and invites
  - groups
  - linkifiers
  - emoji
  - bots
  - channels
- Add missing typed contracts where required for:
  - organization profile editing
  - organization permissions editing
  - stream metadata editing if needed for channel settings parity
- Ensure role and permission failures are explicit, structured, and surfaced in a way the frontend can present cleanly.
- Ensure every admin mutation returns enough data for the UI to update without refreshing the entire app state blindly.

### Acceptance Criteria

- Every parity-scoped settings page can be implemented against real contracts.
- Placeholder CRUD is eliminated from the parity scope.
- Permission errors are not silent.

## BE-5: Sync and Event Consistency

### Objective

Make channel, topic, unread, notification, and settings state converge to server truth after mutations and reconnects.

### Tasks

- Audit event handling for:
  - subscription changes
  - user topic changes
  - update message events
  - unread or flag changes
- Ensure optimistic updates are only used where the backend contract is stable and reconciled afterward.
- Ensure topic visibility changes reconcile from event streams rather than only from immediate local mutation.
- Ensure multi-org isolation is correct for:
  - settings sync
  - unread state
  - recent topics
  - notification routing

### Acceptance Criteria

- Reloads and reconnects do not revert parity-scoped actions.
- Multi-org state isolation is correct.
- Local state no longer masquerades as durable server truth.

## BE-6: Backend Validation and Support Gate

### Objective

Refuse frontend parity signoff until backend behavior is verifiably complete.

### Tasks

- Add tests for every new desktop command and backend mutation path.
- Add tests for capability gating and unsupported-setting behavior.
- Validate parity-scoped behavior in a real Tauri runtime, not only unit tests.
- Deploy backend changes to the dev environment before frontend signoff work starts for the affected area.

### Acceptance Criteria

- Backend parity matrices are green for the scoped settings and sidebar actions.
- Dev deployment exists and is testable while frontend closure work is in flight.

## Frontend Workstream

Frontend parity should proceed immediately against the backend surface that is already stable. For any area still marked incomplete in the backend matrix, frontend work should either:

- wait for the missing contract
- or render the feature as unsupported instead of faking behavior

## FE-1: Fix Pure Renderer Regressions in Settings

### Objective

Remove the most visible broken settings behavior immediately once frontend parity work starts.

### Scope

- Theme selection
- Font size selection
- Any other renderer-only setting that already has a correct authority model

### Tasks

- Make theme tokens respond to `data-theme` rather than only `prefers-color-scheme`.
- Push `--font-size-base` into the message list, compose box, sidebars, and settings UI.
- Wire `enterSends` into compose behavior if it remains in scope; otherwise disable it until implemented.
- Hide or disable any renderer-only setting that still has no defined behavior.

### Acceptance Criteria

- Theme changes are visible immediately.
- Font size changes are visible immediately across the core chat UI.
- No general-settings control remains visibly broken.

## FE-2: Settings UI Parity

### Objective

Turn the settings surface into a trustworthy interface where every visible control has a real effect.

### Scope

- General
- Notifications
- Account and Privacy
- App
- Network
- Servers

### Tasks

- Bind each settings row to the backend authority established in `BE-1`.
- Show capability-gated disabled states with explanation where the backend says a feature is unsupported.
- Remove misleading UI for unsupported features instead of preserving inert toggles.
- Ensure restart-required settings are clearly labeled and actually take effect after restart.

### Acceptance Criteria

- Users can tell which settings are live, unsupported, or restart-required.
- No settings row silently does nothing.

## FE-3: Channel Sidebar Parity

### Objective

Match the expected Zulip-style channel affordances in the sidebar.

### Scope

- hover ellipsis affordance on channel rows
- right-click parity where appropriate
- menu actions backed by the stable backend contract

### Required Channel Actions

- mark channel as read
- mute or unmute channel
- pin or unpin channel
- notification overrides
- unsubscribe
- channel settings entry point
- copy link if included in the target parity set

### Tasks

- Add the hover ellipsis affordance to every channel row.
- Preserve right-click as a secondary access path.
- Replace current local mute behavior with backend-backed mutations.
- Add permission and error feedback for actions that fail.
- Ensure visual state updates correctly after server confirmation and after event reconciliation.

### Acceptance Criteria

- Hovering a channel exposes the expected overflow affordance.
- Channel actions persist across reload.
- The sidebar reflects true server-backed state.

## FE-4: Topic Sidebar Parity

### Objective

Match the expected Zulip-style topic affordances in the sidebar.

### Required Topic Actions

- mark topic as read
- follow or unfollow topic
- mute or unmute topic if distinct in the final parity model
- move or rename topic
- resolve or unresolve topic
- copy link

### Tasks

- Add the hover ellipsis affordance to topic rows.
- Bind follow or mute controls to `updateTopicVisibilityPolicy`.
- Bind move and resolve actions to the new backend contract from `BE-3`.
- Provide clear error handling for permission or server failures.

### Acceptance Criteria

- Hovering a topic exposes the expected overflow affordance.
- Topic actions are durable and server-backed.
- Follow and resolve state are visible and accurate after reload.

## FE-5: Replace Placeholder Settings and Admin Pages

### Objective

Use the backend work from `BE-4` to eliminate local-state placeholder pages inside parity scope.

### Priority Order

1. Channels
2. Users and invites
3. Groups
4. Linkifiers
5. Emoji
6. Bots
7. Organization profile
8. Organization permissions

### Tasks

- Replace local arrays and local `createSignal` placeholder state with real data loading.
- Replace placeholder buttons with real mutations or remove them from the UI.
- Add permission-aware rendering where admin or owner roles are required.
- Make the `Channels` settings page the same source of truth as sidebar channel actions.

### Acceptance Criteria

- No parity-scoped page remains a mock UI.
- Buttons either work or are not shown.

## FE-6: QA, Dev Deployment, and User Validation

### Objective

Close parity work through real product validation, not code-complete declarations.

### Tasks

- Build a manual parity checklist for:
  - every visible settings row
  - every channel menu action
  - every topic menu action
- Verify parity behavior in the dev deployment.
- Verify parity behavior in the actual desktop runtime.
- Run exploratory testing for multi-org, reconnect, permission failure, and restart-required settings.
- Hand the dev deployment to the user for validation after each milestone.

### Acceptance Criteria

- The user can test the workflow from the dev environment.
- The user confirms the behavior is satisfactory.

## Recommended Phase 2 Distribution

### Backend Ownership

1. `BE-0` parity matrix and authority map
2. `BE-1` settings contract cleanup and capability gating
3. `BE-2` remaining channel command completion
4. `BE-3` remaining topic command completion
5. `BE-4` admin and settings contract completion
6. `BE-5` sync and event hardening
7. `BE-6` support gate, tests, and dev deployment

### Frontend Ownership

1. `FE-1` theme and font size renderer fixes
2. `FE-2` settings UI parity against stable contracts
3. `FE-3` channel sidebar parity
4. `FE-4` topic sidebar parity
5. `FE-5` placeholder page replacement
6. `FE-6` QA, dev validation, and user signoff

### Suggested Practical Sequencing

This is the suggested way to distribute work efficiently rather than a hard dependency chain:

1. Backend owner finishes `BE-0` and confirms the remaining contract gaps.
2. Frontend owner starts `FE-1` immediately because theme and font size are renderer-local.
3. Frontend owner starts `FE-2`, `FE-3`, and `FE-5` in any area where the backend matrix is already green.
4. Backend owner closes the remaining gaps in `BE-1` through `BE-5` for the blocked areas, especially topic lifecycle actions and unsupported settings.
5. Frontend owner closes `FE-4` and any blocked settings/admin pages as those backend gaps land.
6. Both sides converge on `FE-6` and `BE-6` for dev deployment and user validation.

## Immediate Next Step

The first concrete Phase 2 step should be to update the existing parity tracking artifact with a backend-owned matrix for:

- every row in the current Settings nav
- every required channel overflow action
- every required topic overflow action

That document should become the gating artifact for the rest of this plan.
