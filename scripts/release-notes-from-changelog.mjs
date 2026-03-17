import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const changelogPath = resolve(repoRoot, "CHANGELOG.md")

function usage() {
  console.error("Usage: bun scripts/release-notes-from-changelog.mjs <version>")
}

function extractReleaseNotes(markdown, version) {
  const normalized = markdown.replace(/\r\n/g, "\n")
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const sectionPattern = new RegExp(
    `^## ${escapedVersion} - .*$\\n([\\s\\S]*?)(?=^## |\\Z)`,
    "m",
  )

  const match = normalized.match(sectionPattern)
  if (!match) {
    throw new Error(`Could not find changelog entry for version ${version}.`)
  }

  const body = match[1]?.trim()
  if (!body) {
    throw new Error(`Changelog entry for version ${version} is empty.`)
  }

  return body
}

try {
  const version = process.argv[2]?.trim()
  if (!version) {
    throw new Error("Missing version.")
  }

  const changelog = readFileSync(changelogPath, "utf8")
  process.stdout.write(`${extractReleaseNotes(changelog, version)}\n`)
} catch (error) {
  usage()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
