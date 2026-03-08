/**
 * Tests for the event name sanitization used by supervisor and zulip-sync contexts.
 *
 * Background: Tauri event names only allow alphanumeric characters, `-`, `/`, `:`, and `_`.
 * org_ids are derived from server URLs and commonly contain dots (e.g. `chat.zulip.org`)
 * which must be replaced with underscores before use in Tauri event names.
 *
 * This was the root cause of the "Connecting to supervisor..." stuck state:
 * Tauri rejected `listen()` calls with dots in the event name, causing `Promise.all()`
 * in `setupEventListeners()` to reject, which meant `startSupervisorStream()` was
 * never called and the status remained "connecting" forever.
 *
 * Run with: bun test packages/app/src/context/supervisor.test.ts
 */
export {};
//# sourceMappingURL=supervisor.test.d.ts.map