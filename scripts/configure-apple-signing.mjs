import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const githubApiBase = "https://api.github.com"
const require = createRequire(import.meta.url)
const sodium = require("libsodium-wrappers-sumo")

function usage() {
  console.error("Usage:")
  console.error(
    "  bun scripts/configure-apple-signing.mjs --github-token <token> --team-id <TEAMID> --signing-identity <identity> --certificate-p12 <path> --certificate-password <password> [--repo <owner/repo>] [--api-key-id <key-id> --api-issuer <issuer> --api-key-p8 <path>] [--apple-id <email> --apple-app-password <password>] [--signing-required <true|false>] [--make-public <true|false>]",
  )
  console.error("")
  console.error("Exactly one notarization mode is required:")
  console.error("  App Store Connect API key: --api-key-id, --api-issuer, --api-key-p8")
  console.error("  Apple ID: --apple-id, --apple-app-password")
  console.error("")
  console.error("Secrets can also be provided via env vars:")
  console.error("  GITHUB_TOKEN, APPLE_TEAM_ID, APPLE_SIGNING_IDENTITY, APPLE_CERTIFICATE_P12, APPLE_CERTIFICATE_BASE64, APPLE_CERTIFICATE_PASSWORD")
  console.error("  APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_P8, APPLE_ID, APPLE_PASSWORD")
}

function parseBoolean(value, flagName) {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${flagName} must be true or false.`)
}

function parseArgs(argv) {
  const options = {
    repo: "",
    githubToken: process.env.GITHUB_TOKEN ?? "",
    teamId: process.env.APPLE_TEAM_ID ?? "",
    signingIdentity: process.env.APPLE_SIGNING_IDENTITY ?? "",
    certificateP12: process.env.APPLE_CERTIFICATE_P12 ?? "",
    certificateBase64: process.env.APPLE_CERTIFICATE_BASE64 ?? "",
    certificatePassword: process.env.APPLE_CERTIFICATE_PASSWORD ?? "",
    apiKeyId: process.env.APPLE_API_KEY ?? "",
    apiIssuer: process.env.APPLE_API_ISSUER ?? "",
    apiKeyP8: process.env.APPLE_API_KEY_P8 ?? "",
    appleId: process.env.APPLE_ID ?? "",
    appleAppPassword: process.env.APPLE_PASSWORD ?? "",
    signingRequired: true,
    makePublic: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--help" || arg === "-h") {
      return { help: true }
    }

    const value = argv[index + 1] ?? ""
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`)
    }

    switch (arg) {
      case "--repo":
        options.repo = value
        break
      case "--github-token":
        options.githubToken = value
        break
      case "--team-id":
        options.teamId = value
        break
      case "--signing-identity":
        options.signingIdentity = value
        break
      case "--certificate-p12":
        options.certificateP12 = value
        break
      case "--certificate-base64":
        options.certificateBase64 = value
        break
      case "--certificate-password":
        options.certificatePassword = value
        break
      case "--api-key-id":
        options.apiKeyId = value
        break
      case "--api-issuer":
        options.apiIssuer = value
        break
      case "--api-key-p8":
        options.apiKeyP8 = value
        break
      case "--apple-id":
        options.appleId = value
        break
      case "--apple-app-password":
        options.appleAppPassword = value
        break
      case "--signing-required":
        options.signingRequired = parseBoolean(value, arg)
        break
      case "--make-public":
        options.makePublic = parseBoolean(value, arg)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }

    index += 1
  }

  return options
}

function readTextOrFile(value, description) {
  if (!value) {
    return ""
  }

  const resolved = resolve(value)
  if (existsSync(resolved)) {
    return readFileSync(resolved, "utf8")
  }

  return value
}

function readBase64Certificate(options) {
  if (options.certificateBase64) {
    return readTextOrFile(options.certificateBase64, "certificate").trim()
  }

  if (!options.certificateP12) {
    throw new Error("Provide --certificate-p12 or --certificate-base64.")
  }

  const certificatePath = resolve(options.certificateP12)
  if (!existsSync(certificatePath)) {
    throw new Error(`Certificate file not found: ${certificatePath}`)
  }

  return readFileSync(certificatePath).toString("base64")
}

function parseRepoFromRemote(remoteUrl) {
  const httpsMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/)
  if (!httpsMatch) {
    throw new Error(`Could not parse GitHub repo from remote URL: ${remoteUrl}`)
  }

  return httpsMatch[1]
}

function detectRepo() {
  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim()
    return parseRepoFromRemote(remoteUrl)
  } catch (error) {
    throw new Error(
      `Could not infer repo from git remote. Pass --repo <owner/repo>. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function requireValue(label, value) {
  if (!value) {
    throw new Error(`Missing required value: ${label}`)
  }
  return value
}

function resolveNotarizationMode(options) {
  const hasApiKeyMode = Boolean(options.apiKeyId || options.apiIssuer || options.apiKeyP8)
  const hasAppleIdMode = Boolean(options.appleId || options.appleAppPassword)

  if (hasApiKeyMode && hasAppleIdMode) {
    throw new Error("Choose either App Store Connect API key mode or Apple ID mode, not both.")
  }

  if (hasApiKeyMode) {
    requireValue("--api-key-id", options.apiKeyId)
    requireValue("--api-issuer", options.apiIssuer)
    requireValue("--api-key-p8", options.apiKeyP8)
    return "api-key"
  }

  if (hasAppleIdMode) {
    requireValue("--apple-id", options.appleId)
    requireValue("--apple-app-password", options.appleAppPassword)
    return "apple-id"
  }

  throw new Error("Missing notarization credentials. Provide API key or Apple ID values.")
}

async function githubRequest(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${githubApiBase}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const details = data?.message || text || response.statusText
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${details}`)
  }

  return data
}

async function encryptSecret(secret, publicKey) {
  await sodium.ready

  const messageBytes = sodium.from_string(secret)
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL)
  const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes)

  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL)
}

async function upsertVariable({ owner, repo, token, name, value }) {
  const path = `/repos/${owner}/${repo}/actions/variables/${name}`

  try {
    await githubRequest(path, {
      method: "PATCH",
      token,
      body: { name, value },
    })
    console.log(`Updated variable ${name}`)
    return
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("(404)")) {
      throw error
    }
  }

  await githubRequest(`/repos/${owner}/${repo}/actions/variables`, {
    method: "POST",
    token,
    body: { name, value },
  })
  console.log(`Created variable ${name}`)
}

async function deleteVariable({ owner, repo, token, name }) {
  const path = `/repos/${owner}/${repo}/actions/variables/${name}`

  try {
    await githubRequest(path, {
      method: "DELETE",
      token,
    })
    console.log(`Deleted variable ${name}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) {
      return
    }
    throw error
  }
}

async function putSecret({ owner, repo, token, publicKeyId, publicKey, name, value }) {
  const encryptedValue = await encryptSecret(value, publicKey)

  await githubRequest(`/repos/${owner}/${repo}/actions/secrets/${name}`, {
    method: "PUT",
    token,
    body: {
      encrypted_value: encryptedValue,
      key_id: publicKeyId,
    },
  })
  console.log(`Configured secret ${name}`)
}

async function deleteSecret({ owner, repo, token, name }) {
  try {
    await githubRequest(`/repos/${owner}/${repo}/actions/secrets/${name}`, {
      method: "DELETE",
      token,
    })
    console.log(`Deleted secret ${name}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) {
      return
    }
    throw error
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }

  const repoSlug = options.repo || detectRepo()
  const repoMatch = repoSlug.match(/^([^/]+)\/([^/]+)$/)
  if (!repoMatch) {
    throw new Error(`Invalid repo value: ${repoSlug}`)
  }

  const [, owner, repo] = repoMatch
  const token = requireValue("--github-token or GITHUB_TOKEN", options.githubToken)
  const teamId = requireValue("--team-id or APPLE_TEAM_ID", options.teamId)
  const signingIdentity = requireValue(
    "--signing-identity or APPLE_SIGNING_IDENTITY",
    options.signingIdentity,
  )
  const certificatePassword = requireValue(
    "--certificate-password or APPLE_CERTIFICATE_PASSWORD",
    options.certificatePassword,
  )
  const certificateBase64 = readBase64Certificate(options)
  const notarizationMode = resolveNotarizationMode(options)

  const repoInfo = await githubRequest(`/repos/${owner}/${repo}`, { token })
  console.log(`Configuring Apple signing for ${repoInfo.full_name}`)
  console.log(`Repo visibility: ${repoInfo.private ? "private" : "public"}`)
  if (repoInfo.private && !options.makePublic) {
    console.warn("Warning: this repo is private. GitHub release assets and latest.json will not be publicly accessible for OTA.")
  }

  if (repoInfo.private && options.makePublic) {
    await githubRequest(`/repos/${owner}/${repo}`, {
      method: "PATCH",
      token,
      body: { private: false },
    })
    console.log(`Updated ${owner}/${repo} visibility to public`)
  }

  const publicKey = await githubRequest(`/repos/${owner}/${repo}/actions/secrets/public-key`, { token })

  const variableEntries = [
    ["APPLE_SIGNING_REQUIRED", options.signingRequired ? "true" : "false"],
    ["APPLE_SIGNING_IDENTITY", signingIdentity],
    ["APPLE_TEAM_ID", teamId],
  ]

  const secretEntries = [
    ["APPLE_CERTIFICATE", certificateBase64],
    ["APPLE_CERTIFICATE_PASSWORD", certificatePassword],
  ]

  if (notarizationMode === "api-key") {
    variableEntries.push(["APPLE_API_KEY", options.apiKeyId])
    variableEntries.push(["APPLE_API_ISSUER", options.apiIssuer])
    secretEntries.push(["APPLE_API_KEY_P8", readTextOrFile(options.apiKeyP8, "App Store Connect API key").trimEnd()])
  } else {
    secretEntries.push(["APPLE_ID", options.appleId])
    secretEntries.push(["APPLE_PASSWORD", options.appleAppPassword])
  }

  for (const [name, value] of variableEntries) {
    await upsertVariable({ owner, repo, token, name, value })
  }

  for (const [name, value] of secretEntries) {
    await putSecret({
      owner,
      repo,
      token,
      publicKeyId: publicKey.key_id,
      publicKey: publicKey.key,
      name,
      value,
    })
  }

  if (notarizationMode === "api-key") {
    await deleteSecret({ owner, repo, token, name: "APPLE_ID" })
    await deleteSecret({ owner, repo, token, name: "APPLE_PASSWORD" })
  } else {
    await deleteVariable({ owner, repo, token, name: "APPLE_API_KEY" })
    await deleteVariable({ owner, repo, token, name: "APPLE_API_ISSUER" })
    await deleteSecret({ owner, repo, token, name: "APPLE_API_KEY_P8" })
  }

  console.log("Apple signing configuration complete.")
  console.log("Next: run `bun run version:desktop -- <version>`, push, and publish a `desktop-v<version>` tag.")
}

try {
  await main()
} catch (error) {
  usage()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
