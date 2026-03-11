import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")

const files = {
  desktopPackageJson: resolve(repoRoot, "packages/desktop/package.json"),
  tauriConfig: resolve(repoRoot, "packages/desktop/src-tauri/tauri.conf.json"),
  cargoToml: resolve(repoRoot, "packages/desktop/src-tauri/Cargo.toml"),
  cargoLock: resolve(repoRoot, "packages/desktop/src-tauri/Cargo.lock"),
}

function usage() {
  console.error("Usage:")
  console.error("  bun scripts/desktop-version.mjs check [--expect <version>]")
  console.error("  bun scripts/desktop-version.mjs set <version>")
}

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function readCargoTomlVersion() {
  const text = readFileSync(files.cargoToml, "utf8")
  const match = text.match(/^version = "([^"]+)"$/m)
  if (!match) {
    throw new Error(`Could not find package version in ${files.cargoToml}`)
  }
  return match[1]
}

function writeCargoTomlVersion(version) {
  const text = readFileSync(files.cargoToml, "utf8")
  const next = text.replace(/^version = "([^"]+)"$/m, `version = "${version}"`)
  if (next === text) {
    throw new Error(`Could not update package version in ${files.cargoToml}`)
  }
  writeFileSync(files.cargoToml, next)
}

function readCargoLockVersion() {
  const text = readFileSync(files.cargoLock, "utf8")
  const match = text.match(/\[\[package\]\]\nname = "foundry-desktop"\nversion = "([^"]+)"/)
  if (!match) {
    throw new Error(`Could not find foundry-desktop version in ${files.cargoLock}`)
  }
  return match[1]
}

function writeCargoLockVersion(version) {
  const text = readFileSync(files.cargoLock, "utf8")
  const next = text.replace(
    /(\[\[package\]\]\nname = "foundry-desktop"\nversion = ")([^"]+)(")/,
    `$1${version}$3`,
  )
  if (next === text) {
    throw new Error(`Could not update foundry-desktop version in ${files.cargoLock}`)
  }
  writeFileSync(files.cargoLock, next)
}

function readVersions() {
  return {
    "packages/desktop/package.json": readJson(files.desktopPackageJson).version,
    "packages/desktop/src-tauri/tauri.conf.json": readJson(files.tauriConfig).version,
    "packages/desktop/src-tauri/Cargo.toml": readCargoTomlVersion(),
    "packages/desktop/src-tauri/Cargo.lock": readCargoLockVersion(),
  }
}

function printVersions(versions) {
  for (const [path, version] of Object.entries(versions)) {
    console.log(`${path}: ${version}`)
  }
}

function checkVersions(expectedVersion = "") {
  const versions = readVersions()
  const uniqueVersions = [...new Set(Object.values(versions))]

  if (uniqueVersions.length !== 1) {
    printVersions(versions)
    throw new Error("Desktop version metadata is out of sync.")
  }

  const [currentVersion] = uniqueVersions
  if (expectedVersion && currentVersion !== expectedVersion) {
    printVersions(versions)
    throw new Error(`Desktop version ${currentVersion} does not match expected ${expectedVersion}.`)
  }

  printVersions(versions)
}

function setVersions(version) {
  if (!isValidVersion(version)) {
    throw new Error(`Invalid version: ${version}`)
  }

  const desktopPackage = readJson(files.desktopPackageJson)
  desktopPackage.version = version
  writeJson(files.desktopPackageJson, desktopPackage)

  const tauriConfig = readJson(files.tauriConfig)
  tauriConfig.version = version
  writeJson(files.tauriConfig, tauriConfig)

  writeCargoTomlVersion(version)
  writeCargoLockVersion(version)

  checkVersions(version)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!command) {
    throw new Error("Missing command.")
  }

  if (command === "check") {
    if (rest.length === 0) {
      return { command }
    }
    if (rest[0] === "--expect" && rest[1] && rest.length === 2) {
      return { command, expectedVersion: rest[1] }
    }
    throw new Error("Invalid arguments for check.")
  }

  if (command === "set") {
    if (rest.length === 1) {
      return { command, version: rest[0] }
    }
    throw new Error("Invalid arguments for set.")
  }

  throw new Error(`Unknown command: ${command}`)
}

try {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === "check") {
    checkVersions(args.expectedVersion)
  } else {
    setVersions(args.version)
  }
} catch (error) {
  usage()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
