import { describe, expect, test } from "bun:test";
import { buildSupervisorDelegateContextFromDelegates, getProviderConnectionStatus, unwrapSupervisorMessageWithDelegates, wrapSupervisorMessageWithDelegates, } from "./agent-runtime";
function createDelegate(overrides = {}) {
    return {
        id: "researcher",
        name: "Researcher",
        emoji: "R",
        purpose: "Collect implementation context before work starts.",
        theme: "thorough",
        soul: "You are a research delegate.",
        enabled: true,
        delegateEligible: true,
        scopeMode: "all_topics",
        streamIds: [],
        inheritRuntimePreset: true,
        inheritProviders: true,
        inheritMcp: true,
        inheritChannels: true,
        inheritSkills: true,
        providerOverride: null,
        preferredModel: "",
        createdAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
        ...overrides,
    };
}
describe("agents helpers", () => {
    test("maps live Foundry provider payloads to a usable connection status", () => {
        const provider = {
            provider: "codex",
            display_name: "Codex",
            auth_modes: ["oauth"],
            oauth_configured: false,
            connected: true,
        };
        expect(getProviderConnectionStatus(provider)).toBe("connected");
    });
    test("builds a supervisor delegate manifest only from enabled delegateable agents", () => {
        const manifest = buildSupervisorDelegateContextFromDelegates([
            createDelegate(),
            createDelegate({
                id: "reviewer",
                name: "Reviewer",
                delegateEligible: false,
            }),
        ]);
        expect(manifest).toContain("<foundry_delegate_manifest>");
        expect(manifest).toContain("\"id\": \"researcher\"");
        expect(manifest).not.toContain("\"id\": \"reviewer\"");
    });
    test("wraps outbound supervisor messages with delegate context", () => {
        const wrapped = wrapSupervisorMessageWithDelegates("Please review the rollout plan.", "<foundry_delegate_manifest>\n{}\n</foundry_delegate_manifest>");
        expect(wrapped).toContain("<user_message>");
        expect(wrapped).toContain("Please review the rollout plan.");
    });
    test("leaves outbound supervisor messages unchanged without delegate context", () => {
        expect(wrapSupervisorMessageWithDelegates("Ship it.", null)).toBe("Ship it.");
    });
    test("unwraps inbound supervisor user events back to the original message", () => {
        const wrapped = wrapSupervisorMessageWithDelegates("Please review the rollout plan.", "<foundry_delegate_manifest>\n{}\n</foundry_delegate_manifest>");
        expect(unwrapSupervisorMessageWithDelegates(wrapped)).toBe("Please review the rollout plan.");
    });
});
