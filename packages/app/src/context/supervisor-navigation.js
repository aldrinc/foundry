import { parseNarrow } from "./navigation-utils";
export function shouldKeepSupervisorOpenForNarrow(narrow, streamId, topicName) {
    if (!narrow)
        return false;
    const parsed = parseNarrow(narrow);
    return parsed?.type === "topic" && parsed.streamId === streamId && parsed.topic === topicName;
}
