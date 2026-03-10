import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@foundry/app": path.resolve(__dirname, "../app/src"),
      "@foundry/ui": path.resolve(__dirname, "../ui/src"),
      "@foundry/desktop": path.resolve(__dirname, "./src"),
    },
    // Prefer workspace TypeScript sources over stale generated .js artifacts.
    extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
})
