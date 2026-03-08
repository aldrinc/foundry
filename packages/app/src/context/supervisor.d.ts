import { type JSX } from "solid-js";
import type { SupervisorSession, SupervisorEvent, SupervisorTask } from "@zulip/desktop/bindings";
export interface SupervisorStore {
    active: boolean;
    topicScopeId: string | null;
    streamId: number | null;
    streamName: string;
    topicName: string;
    session: SupervisorSession | null;
    status: "idle" | "connecting" | "connected" | "disconnected";
    events: SupervisorEvent[];
    afterId: number;
    seenEventIds: Set<number>;
    sendingMessage: boolean;
    pendingUserEchoes: Map<string, number>;
    nextLocalEventId: number;
    lastThinkingPreview: string;
    lastThinkingEventMs: number;
    tasks: SupervisorTask[];
    warning: string;
    warningTone: "info" | "error";
}
export interface SupervisorContext {
    store: SupervisorStore;
    openForTopic(streamId: number, streamName: string, topic: string): void;
    close(): void;
    sendMessage(text: string): Promise<void>;
    controlTask(taskId: string, action: string): Promise<void>;
    replyToClarification(taskId: string, message: string): Promise<void>;
    isThinkingFresh(): boolean;
    livePreviewMode(): "thinking" | "reconnecting" | null;
}
export declare function SupervisorProvider(props: {
    orgId: string;
    children: JSX.Element;
}): JSX.Element;
export declare function useSupervisor(): SupervisorContext;
//# sourceMappingURL=supervisor.d.ts.map