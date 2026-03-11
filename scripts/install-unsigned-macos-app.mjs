import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, extname, join, resolve } from "node:path"

function usage() {
  console.error(
    "Usage: bun scripts/install-unsigned-macos-app.mjs [--dest <path>] [--no-open] <source.app|source.dmg>",
  )
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  })
}

function parseArgs(argv) {
  let source = ""
  let dest = ""
  let openApp = true

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dest") {
      dest = argv[index + 1] ?? ""
      index += 1
      continue
    }
    if (arg === "--no-open") {
      openApp = false
      continue
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`)
    }
    if (source) {
      throw new Error("Only one source path may be provided.")
    }
    source = arg
  }

  if (!source) {
    throw new Error("A source .app or .dmg path is required.")
  }

  return {
    source: resolve(source),
    dest: dest ? resolve(dest) : "",
    openApp,
  }
}

function defaultInstallRoot() {
  return join(homedir(), "Applications")
}

function resolveDestination(inputPath, overridePath) {
  if (overridePath) {
    return overridePath.endsWith(".app") ? overridePath : join(overridePath, basename(inputPath))
  }
  return join(defaultInstallRoot(), basename(inputPath))
}

function findMountedApp(mountPoint) {
  const entries = readdirSync(mountPoint, { withFileTypes: true })
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
  if (!appEntry) {
    throw new Error(`No .app bundle found in mounted image: ${mountPoint}`)
  }
  return join(mountPoint, appEntry.name)
}

function prepareFromDmg(dmgPath) {
  const mountPoint = join(tmpdir(), `foundry-unsigned-${process.pid}-${Date.now()}`)
  mkdirSync(mountPoint, { recursive: true })
  run("hdiutil", ["attach", dmgPath, "-nobrowse", "-readonly", "-mountpoint", mountPoint])
  return {
    appPath: findMountedApp(mountPoint),
    cleanup() {
      try {
        run("hdiutil", ["detach", mountPoint])
      } catch (error) {
        console.warn(`Warning: failed to detach ${mountPoint}: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    throw new Error("This helper only works on macOS.")
  }
}

function stageAppBundle(sourceAppPath, destinationAppPath) {
  mkdirSync(dirname(destinationAppPath), { recursive: true })
  if (existsSync(destinationAppPath)) {
    rmSync(destinationAppPath, { recursive: true, force: true })
  }
  run("ditto", [sourceAppPath, destinationAppPath])
}

function repairUnsignedBundle(appPath) {
  run("codesign", ["--force", "--deep", "--sign", "-", appPath])
  run("xattr", ["-dr", "com.apple.quarantine", appPath])
}

function openAppBundle(appPath) {
  run("open", ["-na", appPath], { stdio: "inherit" })
}

function main() {
  ensureMacOS()

  let mounted = null
  try {
    const { source, dest, openApp } = parseArgs(process.argv.slice(2))
    const sourceExt = extname(source).toLowerCase()
    let sourceAppPath = source

    if (sourceExt === ".dmg") {
      mounted = prepareFromDmg(source)
      sourceAppPath = mounted.appPath
    } else if (!source.endsWith(".app")) {
      throw new Error("Source must be a .app bundle or .dmg image.")
    }

    const destinationAppPath = resolveDestination(sourceAppPath, dest)
    stageAppBundle(sourceAppPath, destinationAppPath)
    repairUnsignedBundle(destinationAppPath)

    console.log(`Prepared unsigned app for local use: ${destinationAppPath}`)
    if (openApp) {
      openAppBundle(destinationAppPath)
    } else {
      console.log("Skipping launch because --no-open was provided.")
    }
  } finally {
    mounted?.cleanup()
  }
}

try {
  main()
} catch (error) {
  usage()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
