export const SPECIAL_NARROWS = ["starred", "all-messages", "recent-topics"];
export function narrowToFilters(narrow) {
    const filters = [];
    if (narrow.startsWith("stream:")) {
        const rest = narrow.slice(7);
        const topicSep = rest.indexOf("/topic:");
        if (topicSep >= 0) {
            filters.push({ operator: "stream", operand: rest.slice(0, topicSep) });
            filters.push({ operator: "topic", operand: rest.slice(topicSep + 7) });
        }
        else {
            filters.push({ operator: "stream", operand: rest });
        }
    }
    else if (narrow.startsWith("dm:")) {
        const ids = narrow.slice(3).split(",").map(Number);
        filters.push({ operator: "dm", operand: ids });
    }
    else if (narrow === "starred") {
        filters.push({ operator: "is", operand: "starred" });
    }
    else if (narrow === "all-messages") {
        // Empty filters = all messages
    }
    else if (narrow.startsWith("search:")) {
        const query = narrow.slice(7);
        filters.push({ operator: "search", operand: query });
    }
    return filters;
}
export function parseNarrow(narrow) {
    if (narrow.startsWith("stream:")) {
        const rest = narrow.slice(7);
        const topicSep = rest.indexOf("/topic:");
        if (topicSep >= 0) {
            return {
                type: "topic",
                streamId: parseInt(rest.slice(0, topicSep), 10),
                topic: rest.slice(topicSep + 7),
            };
        }
        return { type: "stream", streamId: parseInt(rest, 10) };
    }
    else if (narrow.startsWith("dm:")) {
        const ids = narrow.slice(3).split(",").map(Number);
        return { type: "dm", userIds: ids };
    }
    else if (narrow === "starred") {
        return { type: "starred" };
    }
    else if (narrow === "all-messages") {
        return { type: "all-messages" };
    }
    else if (narrow === "recent-topics") {
        return { type: "recent-topics" };
    }
    else if (narrow.startsWith("search:")) {
        return { type: "search", query: narrow.slice(7) };
    }
    return null;
}
export function isSpecialNarrow(narrow) {
    return SPECIAL_NARROWS.includes(narrow) || narrow.startsWith("search:");
}
