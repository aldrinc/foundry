import { describe, expect, test } from "bun:test";
import { shouldKeepSupervisorOpenForNarrow } from "./supervisor-navigation";
describe("shouldKeepSupervisorOpenForNarrow", () => {
    test("keeps the supervisor open for the active topic", () => {
        expect(shouldKeepSupervisorOpenForNarrow("stream:4/topic:incident", 4, "incident")).toBe(true);
    });
    test("closes the supervisor when navigating to the stream root", () => {
        expect(shouldKeepSupervisorOpenForNarrow("stream:4", 4, "incident")).toBe(false);
    });
    test("closes the supervisor when switching topics in the same stream", () => {
        expect(shouldKeepSupervisorOpenForNarrow("stream:4/topic:follow-up", 4, "incident")).toBe(false);
    });
    test("closes the supervisor when switching to a different stream", () => {
        expect(shouldKeepSupervisorOpenForNarrow("stream:8/topic:incident", 4, "incident")).toBe(false);
    });
    test("closes the supervisor for non-topic narrows", () => {
        expect(shouldKeepSupervisorOpenForNarrow("dm:1,2", 4, "incident")).toBe(false);
        expect(shouldKeepSupervisorOpenForNarrow("all-messages", 4, "incident")).toBe(false);
        expect(shouldKeepSupervisorOpenForNarrow(null, 4, "incident")).toBe(false);
    });
});
