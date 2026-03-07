/**
 * Utilities for working with Tauri event names.
 *
 * Tauri event names only allow alphanumeric characters, `-`, `/`, `:`, and `_`.
 * org_ids are derived from server URLs and commonly contain dots (e.g. `chat.zulip.org`)
 * which are NOT allowed and must be replaced.
 */

/** Sanitize org_id for use in Tauri event names.
 * Replaces dots with underscores so event names like
 * `supervisor:chat.zulip.org:connected` become
 * `supervisor:chat_zulip_org:connected`. */
export function sanitizeEventId(orgId: string): string {
  return orgId.replace(/\./g, "_");
}
