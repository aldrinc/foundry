import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

const outDir = path.resolve(
  __dirname,
  "../../services/foundry-server/src/foundry_server/static/cloud",
)

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      "@foundry/ui": path.resolve(__dirname, "../ui/src"),
      "@foundry/desktop": path.resolve(__dirname, "../desktop/src"),
    },
    extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  server: {
    port: 1430,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.names.includes("style.css")) {
            return "app.css"
          }
          return "assets/[name]-[hash][extname]"
        },
      },
    },
  },
})
