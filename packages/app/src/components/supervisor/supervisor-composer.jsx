import { createSignal } from "solid-js";
import { useSupervisor } from "../../context/supervisor";
export function SupervisorComposer() {
    const supervisor = useSupervisor();
    const [text, setText] = createSignal("");
    let textareaRef;
    const handleSend = async () => {
        const msg = text().trim();
        if (!msg || supervisor.store.sendingMessage)
            return;
        setText("");
        if (textareaRef) {
            textareaRef.style.height = "auto";
        }
        await supervisor.sendMessage(msg);
        textareaRef?.focus();
    };
    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };
    const autoResize = () => {
        if (!textareaRef)
            return;
        textareaRef.style.height = "auto";
        textareaRef.style.height = Math.min(textareaRef.scrollHeight, 120) + "px";
    };
    return (<div class="border-t border-[var(--border-default)] bg-[var(--background-surface)] px-3 py-2" data-component="supervisor-composer">
      <div class="flex gap-2 items-end">
        <textarea ref={textareaRef} class="flex-1 px-2 py-1.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] text-sm resize-none focus:outline-none focus:border-[var(--interactive-primary)] transition-colors" style={{ "min-height": "34px", "max-height": "120px" }} placeholder="Message supervisor..." value={text()} onInput={(e) => {
            setText(e.currentTarget.value);
            autoResize();
        }} onKeyDown={handleKeyDown} disabled={supervisor.store.sendingMessage} rows={1}/>
        <button class="shrink-0 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--interactive-primary)] text-[var(--interactive-primary-text)] text-sm font-medium hover:bg-[var(--interactive-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleSend} disabled={supervisor.store.sendingMessage || !text().trim()}>
          {supervisor.store.sendingMessage ? "..." : "Send"}
        </button>
      </div>
    </div>);
}
