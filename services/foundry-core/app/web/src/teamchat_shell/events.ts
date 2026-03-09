import * as blueslip from "../blueslip.ts";

type TeamchatServerEventListener = (event: unknown) => void;

const server_event_listeners = new Set<TeamchatServerEventListener>();

export function subscribe_to_server_events(listener: TeamchatServerEventListener): () => void {
    server_event_listeners.add(listener);
    return () => {
        server_event_listeners.delete(listener);
    };
}

export function notify_server_event(event: unknown): void {
    for (const listener of server_event_listeners) {
        try {
            listener(event);
        } catch (error) {
            blueslip.error("Failed to process TeamChat server event listener", undefined, error);
        }
    }
}

export function clear_server_event_listeners(): void {
    server_event_listeners.clear();
}
