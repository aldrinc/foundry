import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const env = { ...process.env }
const fallbackKeyPath = join(homedir(), ".foundry", "keys", "foundry-updater.key")
const configuredKeyPath = env.TAURI_SIGNING_PRIVATE_KEY_PATH || (existsSync(fallbackKeyPath) ? fallbackKeyPath : undefined)

if (!env.TAURI_SIGNING_PRIVATE_KEY && configuredKeyPath) {
  // Tauri accepts TAURI_SIGNING_PRIVATE_KEY as either the raw key content or a key file path.
  env.TAURI_SIGNING_PRIVATE_KEY = configuredKeyPath
}

if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
  // Passwordless keys still need an explicit empty password in non-interactive builds.
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
}

if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error(
    "No Tauri updater signing key configured. Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH.",
  )
  process.exit(1)
}

const child = spawn(
  "bun",
  ["--cwd", "packages/desktop", "tauri", "build", ...process.argv.slice(2)],
  {
    env,
    stdio: "inherit",
  },
)

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
