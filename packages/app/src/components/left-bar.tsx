export function LeftBar(props: { darkBackground?: boolean }) {
  return (
    <div
      class="flex flex-col items-center shrink-0"
      style={{
        width: "60px",
        background: "var(--surface-left-bar)",
      }}
      data-component="left-bar"
    >
      {/* Top drag region — space for macOS traffic light buttons */}
      <div
        data-tauri-drag-region
        style={{ height: "36px", width: "100%", "flex-shrink": "0" }}
      />

      {/* App logo / home icon */}
      <button
        class={`flex items-center justify-center rounded-[var(--radius-lg)] transition-colors ${
          props.darkBackground ? "hover:bg-white/10" : "hover:bg-black/5"
        }`}
        style={{ width: "36px", height: "36px", "margin-top": "4px" }}
        title="Home"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={props.darkBackground ? "rgba(255,255,255,0.7)" : "var(--text-primary)"}
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </button>
    </div>
  )
}
