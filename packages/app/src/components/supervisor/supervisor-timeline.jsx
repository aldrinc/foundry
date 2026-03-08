import { For, Show, createEffect, createSignal } from "solid-js";
import { useSupervisor } from "../../context/supervisor";
import { EventItem } from "./event-renderers";
export function SupervisorTimeline() {
    const supervisor = useSupervisor();
    let containerRef;
    const [autoScroll, setAutoScroll] = createSignal(true);
    const [showScrollBtn, setShowScrollBtn] = createSignal(false);
    // Auto-scroll on new events
    createEffect(() => {
        const _ = supervisor.store.events.length;
        if (autoScroll() && containerRef) {
            requestAnimationFrame(() => {
                containerRef.scrollTop = containerRef.scrollHeight;
            });
        }
    });
    const handleScroll = () => {
        if (!containerRef)
            return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef;
        const nearBottom = scrollHeight - scrollTop - clientHeight < 120;
        setAutoScroll(nearBottom);
        setShowScrollBtn(!nearBottom);
    };
    const scrollToBottom = () => {
        if (containerRef) {
            containerRef.scrollTop = containerRef.scrollHeight;
            setAutoScroll(true);
            setShowScrollBtn(false);
        }
    };
    // Confine scroll wheel to prevent parent scroll leak
    const handleWheel = (e) => {
        if (!containerRef)
            return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef;
        const atTop = scrollTop <= 0 && e.deltaY < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
        if (atTop || atBottom) {
            e.preventDefault();
        }
    };
    // Determine live mode
    const liveMode = () => supervisor.livePreviewMode();
    return (<div class="relative flex-1 min-h-0" data-component="supervisor-timeline">
      <div ref={containerRef} class="h-full overflow-y-auto px-3 py-2" onScroll={handleScroll} onWheel={handleWheel}>
        <Show when={supervisor.store.events.length > 0} fallback={<div class="flex items-center gap-2 py-4 px-1 text-sm text-[var(--text-tertiary)]">
              <Show when={supervisor.store.status === "connecting"}>
                <div class="w-2 h-2 rounded-full bg-[var(--status-warning)] supervisor-pulse shrink-0"/>
              </Show>
              {supervisor.store.status === "connecting"
                ? "Connecting to supervisor..."
                : "Send a message to start a conversation"}
            </div>}>
          <For each={supervisor.store.events}>
            {(event, i) => (<>
                {/* Turn separator: show between consecutive user messages */}
                <Show when={i() > 0 && event.role === "user" && event.kind === "message" && supervisor.store.events[i() - 1]?.role !== "user"}>
                  <hr class="border-[var(--border-default)] my-3"/>
                </Show>
                <EventItem event={event}/>
              </>)}
          </For>

          {/* Live indicator */}
          <Show when={liveMode()}>
            <div class="flex items-center gap-2 mt-3 py-2">
              <div class="w-2 h-2 rounded-full bg-[var(--interactive-primary)] supervisor-pulse"/>
              <span class="text-xs text-[var(--text-tertiary)] italic">
                {liveMode() === "thinking" ? "Thinking..." : "Reconnecting..."}
              </span>
            </div>
          </Show>
        </Show>
      </div>

      {/* Scroll to bottom button */}
      <Show when={showScrollBtn()}>
        <button onClick={scrollToBottom} class="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] shadow-md flex items-center justify-center hover:bg-[var(--interactive-primary-hover)] transition-colors">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 3v8M3 7l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </Show>
    </div>);
}
