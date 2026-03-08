import { createSignal, Show, onCleanup } from "solid-js";
import { useOrg } from "../context/org";
export function GearMenu(props) {
    const org = useOrg();
    const [open, setOpen] = createSignal(false);
    let menuRef;
    const handleClickOutside = (e) => {
        if (menuRef && !menuRef.contains(e.target)) {
            setOpen(false);
        }
    };
    const toggle = (e) => {
        e.stopPropagation();
        if (open()) {
            setOpen(false);
        }
        else {
            setOpen(true);
            setTimeout(() => document.addEventListener("click", handleClickOutside), 0);
        }
    };
    onCleanup(() => document.removeEventListener("click", handleClickOutside));
    const handleAction = (action) => {
        setOpen(false);
        document.removeEventListener("click", handleClickOutside);
        action();
    };
    return (<div class="relative" ref={menuRef}>
      <button class="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors" onClick={toggle} title="Settings">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>

      <Show when={open()}>
        <div class="absolute right-0 top-full mt-1 w-[200px] bg-[var(--background-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] shadow-lg z-50 py-1">
          {/* Organization */}
          <div class="px-3 py-2 border-b border-[var(--border-default)]">
            <div class="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-0.5">Organization</div>
            <div class="text-xs text-[var(--text-primary)] truncate">{org.realmName}</div>
          </div>

          {/* Actions */}
          <MenuItem label="Settings" onClick={() => handleAction(props.onOpenSettings)}/>
          <div class="my-1 border-t border-[var(--border-default)]"/>
          <div class="px-3 py-1">
            <span class="text-[10px] text-[var(--text-tertiary)]">Foundry Desktop</span>
          </div>
        </div>
      </Show>
    </div>);
}
function MenuItem(props) {
    return (<button class="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--background-elevated)] transition-colors flex items-center justify-between" onClick={props.onClick}>
      <span>{props.label}</span>
      <Show when={props.shortcut}>
        <span class="text-[10px] text-[var(--text-tertiary)]">{props.shortcut}</span>
      </Show>
    </button>);
}
