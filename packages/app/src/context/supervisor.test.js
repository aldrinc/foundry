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
import { describe, test, expect } from "bun:test";
import { sanitizeEventId } from "../tauri-event-utils";
/** Tauri event name validation: only alphanumeric, `-`, `/`, `:`, `_` */
function isValidTauriEventName(name) {
    return /^[a-zA-Z0-9\-/:_]+$/.test(name);
}
describe("sanitizeEventId", () => {
    test("replaces dots with underscores", () => {
        expect(sanitizeEventId("chat.zulip.org")).toBe("chat_zulip_org");
    });
    test("handles IP-based org_ids (sslip.io style)", () => {
        expect(sanitizeEventId("chat-dev.203.0.113.10.sslip.io")).toBe("chat-dev_203_0_113_10_sslip_io");
    });
    test("preserves already-valid characters", () => {
        expect(sanitizeEventId("my-org_123")).toBe("my-org_123");
    });
    test("handles no dots", () => {
        expect(sanitizeEventId("localhost")).toBe("localhost");
    });
    test("handles consecutive dots", () => {
        expect(sanitizeEventId("a..b...c")).toBe("a__b___c");
    });
    test("handles empty string", () => {
        expect(sanitizeEventId("")).toBe("");
    });
    test("output never contains dots", () => {
        const inputs = [
            "chat.zulip.org",
            "192.168.1.1",
            "a.b.c.d.e.f",
            "no-dots-here",
            "",
            "single.",
            ".leading",
            "...",
        ];
        for (const input of inputs) {
            const result = sanitizeEventId(input);
            expect(result).not.toContain(".");
        }
    });
});
describe("supervisor event name format", () => {
    const orgIds = [
        "chat.zulip.org",
        "chat-dev.203.0.113.10.sslip.io",
        "localhost",
        "my-company.zulipchat.com",
    ];
    const supervisorEventSuffixes = ["events", "session", "connected", "disconnected"];
    const zulipEventSuffixes = [
        "message", "typing", "reaction", "subscription",
        "update_message", "delete_message", "update_message_flags",
        "resync", "disconnected", "connection_error",
    ];
    for (const orgId of orgIds) {
        test(`supervisor events for "${orgId}" are valid Tauri event names`, () => {
            const eventId = sanitizeEventId(orgId);
            for (const suffix of supervisorEventSuffixes) {
                const eventName = `supervisor:${eventId}:${suffix}`;
                expect(isValidTauriEventName(eventName)).toBe(true);
            }
        });
        test(`zulip events for "${orgId}" are valid Tauri event names`, () => {
            const eventId = sanitizeEventId(orgId);
            for (const suffix of zulipEventSuffixes) {
                const eventName = `zulip:${eventId}:${suffix}`;
                expect(isValidTauriEventName(eventName)).toBe(true);
            }
        });
    }
});
describe("unsanitized org_ids with dots produce invalid Tauri event names", () => {
    test("demonstrates the bug that was fixed", () => {
        // This test documents the exact failure mode:
        // When org_id contains dots, the event name is invalid for Tauri
        const orgId = "chat-dev.203.0.113.10.sslip.io";
        const unsanitizedEventName = `supervisor:${orgId}:connected`;
        // The unsanitized name is INVALID (contains dots)
        expect(isValidTauriEventName(unsanitizedEventName)).toBe(false);
        // The sanitized name is VALID
        const sanitizedEventName = `supervisor:${sanitizeEventId(orgId)}:connected`;
        expect(isValidTauriEventName(sanitizedEventName)).toBe(true);
    });
});
