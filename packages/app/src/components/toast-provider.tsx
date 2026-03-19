import { createContext, createSignal, useContext, For, type JSX } from "solid-js"
import { Portal } from "solid-js/web"

type ToastVariant = "success" | "error" | "info"

interface Toast {
  id: number
  message: string
  variant: ToastVariant
  exiting: boolean
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue>()

let nextId = 0

export function ToastProvider(props: { children: JSX.Element }) {
  const [toasts, setToasts] = createSignal<Toast[]>([])

  const show = (message: string, variant: ToastVariant = "info") => {
    const id = nextId++
    setToasts(t => [...t, { id, message, variant, exiting: false }])

    // Auto-dismiss after 4s
    setTimeout(() => dismiss(id), 4000)
  }

  const dismiss = (id: number) => {
    setToasts(t => t.map(toast =>
      toast.id === id ? { ...toast, exiting: true } : toast
    ))
    // Remove after exit animation
    setTimeout(() => {
      setToasts(t => t.filter(toast => toast.id !== id))
    }, 200)
  }

  const variantIcon = (variant: ToastVariant) => {
    switch (variant) {
      case "success":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="shrink-0 text-[var(--status-success)]">
            <path d="M3 7l3 3 5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        )
      case "error":
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="shrink-0 text-[var(--status-error)]">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2" />
            <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        )
      default:
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="shrink-0 text-[var(--status-info)]">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2" />
            <path d="M7 5v4M7 3.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        )
    }
  }

  const variantBorder = (variant: ToastVariant) => {
    switch (variant) {
      case "success": return "border-l-[var(--status-success)]"
      case "error": return "border-l-[var(--status-error)]"
      default: return "border-l-[var(--status-info)]"
    }
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {props.children}
      <Portal>
        <div class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
          <For each={toasts()}>
            {(toast) => (
              <div
                class={`${toast.exiting ? "toast-exit" : "toast-enter"} pointer-events-auto flex items-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--background-surface)] border border-[var(--border-default)] border-l-2 ${variantBorder(toast.variant)} shadow-md text-xs text-[var(--text-primary)] max-w-[320px] cursor-pointer`}
                onClick={() => dismiss(toast.id)}
              >
                {variantIcon(toast.variant)}
                <span class="flex-1 min-w-0">{toast.message}</span>
              </div>
            )}
          </For>
        </div>
      </Portal>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Return a no-op if used outside provider (graceful degradation)
    return { show: () => {} }
  }
  return ctx
}
