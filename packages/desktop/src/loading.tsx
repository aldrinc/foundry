import { render } from "solid-js/web"
import "./styles.css"

function LoadingScreen() {
  return (
    <div class="h-screen w-screen flex flex-col items-center justify-center bg-[var(--background-base)]">
      <div class="flex flex-col items-center gap-4">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          class="animate-pulse opacity-50"
        >
          <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2" fill="none" />
          <text
            x="24"
            y="30"
            text-anchor="middle"
            fill="currentColor"
            font-size="20"
            font-weight="bold"
          >
            Z
          </text>
        </svg>
        <p class="text-sm text-[var(--text-secondary)] animate-pulse">Loading...</p>
      </div>
    </div>
  )
}

const root = document.getElementById("root")
if (root) {
  render(() => <LoadingScreen />, root)
}
