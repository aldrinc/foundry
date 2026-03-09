import { describe, expect, test } from "bun:test";
import { DEFAULT_MESSAGE_QUICK_REACTIONS, getQuickReactionEntriesByName, } from "./emoji-quick-reactions";
describe("emoji picker quick reactions", () => {
    test("uses the requested default message reactions in order", () => {
        expect(DEFAULT_MESSAGE_QUICK_REACTIONS.map(({ name, code, char }) => ({ name, code, char }))).toEqual([
            { name: "+1", code: "1f44d", char: "👍" },
            { name: "check_mark", code: "2705", char: "✅" },
            { name: "joy", code: "1f602", char: "😂" },
            { name: "raised_hands", code: "1f64c", char: "🙌" },
        ]);
    });
    test("ignores unknown quick reaction names", () => {
        expect(getQuickReactionEntriesByName(["+1", "missing", "joy"]).map(emoji => emoji.name)).toEqual([
            "+1",
            "joy",
        ]);
    });
});
