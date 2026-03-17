import { commands } from "@foundry/desktop/bindings"
import type {
  ExternalAuthenticationMethod,
  ServerSettings,
} from "@foundry/desktop/bindings"
import type { Platform } from "./context/platform"

export const PENDING_SSO_STORAGE_KEY = "foundry.desktop.pending-sso"
const DEEP_LINK_EVENT_NAME = "foundry:deep-link"

type StorageReader = Pick<Storage, "getItem">
type StorageWriter = Pick<Storage, "setItem" | "removeItem">
type StorageLike = StorageReader & StorageWriter

type PendingSsoRecord = {
  otp: string
  startedAt: number
}

export type SsoCallbackPayload = {
  realm: string
  email: string
  otpEncryptedApiKey: string
  userId: number | null
}

declare global {
  interface Window {
    __FOUNDRY_PENDING_DEEP_LINKS__?: string[]
  }
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ""

  try {
    const normalized = new URL(trimmed)
    normalized.hash = ""
    return normalized.toString().replace(/\/+$/, "")
  } catch {
    return trimmed.replace(/\/+$/, "")
  }
}

export function resolveServerUrl(
  inputUrl: string,
  settings?: Pick<ServerSettings, "realm_url"> | null,
): string {
  return normalizeServerUrl(settings?.realm_url || inputUrl)
}

export function supportsPasswordAuth(
  settings: Pick<ServerSettings, "authentication_methods">,
): boolean {
  const methods = settings.authentication_methods ?? {}
  return Boolean(
    methods.password || methods.ldap,
  )
}

export function usernameLabel(
  settings: Pick<ServerSettings, "require_email_format_usernames">,
): string {
  return (settings.require_email_format_usernames ?? true) ? "Email" : "Email or username"
}

export function usernamePlaceholder(
  settings: Pick<ServerSettings, "require_email_format_usernames">,
): string {
  return (settings.require_email_format_usernames ?? true)
    ? "you@example.com"
    : "you@example.com or username"
}

export function buildExternalAuthUrl(
  serverUrl: string,
  method: Pick<ExternalAuthenticationMethod, "login_url">,
  otp: string,
): string {
  const url = new URL(method.login_url, `${normalizeServerUrl(serverUrl)}/`)
  url.searchParams.set("mobile_flow_otp", otp)
  return url.toString()
}

export function generateOtpHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function decryptOtpEncryptedApiKey(otpEncryptedApiKey: string, otp: string): string {
  if (otpEncryptedApiKey.length !== otp.length) {
    throw new Error("The returned API key does not match the pending sign-in request.")
  }

  let hexEncodedApiKey = ""
  for (let index = 0; index < otpEncryptedApiKey.length; index += 1) {
    const left = Number.parseInt(otpEncryptedApiKey[index]!, 16)
    const right = Number.parseInt(otp[index]!, 16)
    if (Number.isNaN(left) || Number.isNaN(right)) {
      throw new Error("The returned API key is not valid hex data.")
    }
    hexEncodedApiKey += (left ^ right).toString(16)
  }

  return new TextDecoder().decode(Uint8Array.from(hexEncodedApiKey.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []))
}

export async function openExternalAuth(
  platform: Pick<Platform, "platform" | "openLink">,
  storage: StorageLike,
  serverUrl: string,
  method: Pick<ExternalAuthenticationMethod, "login_url">,
): Promise<void> {
  const normalizedServerUrl = normalizeServerUrl(serverUrl)
  const otp = generateOtpHex()
  const authUrl = buildExternalAuthUrl(normalizedServerUrl, method, otp)

  savePendingSso(storage, normalizedServerUrl, otp)

  try {
    if (platform.platform === "desktop") {
      const result = await commands.openExternalAuthWindow(authUrl)
      if (result.status === "error") {
        throw new Error(result.error)
      }
      return
    }

    platform.openLink(authUrl)
  } catch (error) {
    clearPendingSso(storage, normalizedServerUrl)
    throw error
  }
}

export function savePendingSso(storage: StorageLike, serverUrl: string, otp: string): void {
  const records = readPendingSso(storage)
  records[normalizeServerUrl(serverUrl)] = {
    otp,
    startedAt: Date.now(),
  }
  storage.setItem(PENDING_SSO_STORAGE_KEY, JSON.stringify(records))
}

export function clearPendingSso(storage: StorageLike, serverUrl: string): void {
  const records = readPendingSso(storage)
  delete records[normalizeServerUrl(serverUrl)]
  writePendingSso(storage, records)
}

export function completePendingSso(
  storage: StorageLike,
  callback: SsoCallbackPayload,
): { serverUrl: string; email: string; apiKey: string } {
  const records = readPendingSso(storage)
  const serverUrl = normalizeServerUrl(callback.realm)
  const pending = records[serverUrl]

  if (!pending) {
    throw new Error("No pending SSO sign-in request was found for this server.")
  }

  delete records[serverUrl]
  writePendingSso(storage, records)

  return {
    serverUrl,
    email: callback.email,
    apiKey: decryptOtpEncryptedApiKey(callback.otpEncryptedApiKey, pending.otp),
  }
}

export function parseSsoCallbackUrl(url: string): SsoCallbackPayload | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const isLoginPath = parsed.hostname === "login" || parsed.pathname === "/login"
  if (!isLoginPath) return null

  const realm = parsed.searchParams.get("realm")
  const email = parsed.searchParams.get("email")
  const otpEncryptedApiKey = parsed.searchParams.get("otp_encrypted_api_key")

  if (!realm || !email || !otpEncryptedApiKey) {
    return null
  }

  const rawUserId = parsed.searchParams.get("user_id")
  const userId = rawUserId ? Number.parseInt(rawUserId, 10) : null

  return {
    realm: normalizeServerUrl(realm),
    email,
    otpEncryptedApiKey,
    userId: Number.isNaN(userId) ? null : userId,
  }
}

export function publishDeepLinks(urls: string[]): void {
  if (typeof window === "undefined" || urls.length === 0) return
  window.__FOUNDRY_PENDING_DEEP_LINKS__ = urls
  window.dispatchEvent(
    new CustomEvent<string[]>(DEEP_LINK_EVENT_NAME, {
      detail: urls,
    }),
  )
}

export function consumePendingDeepLinks(
  matcher?: (url: string) => boolean,
): string[] {
  if (typeof window === "undefined") return []
  const urls = window.__FOUNDRY_PENDING_DEEP_LINKS__ ?? []

  if (!matcher) {
    window.__FOUNDRY_PENDING_DEEP_LINKS__ = []
    return urls
  }

  const matchingUrls: string[] = []
  const remainingUrls: string[] = []

  for (const url of urls) {
    if (matcher(url)) {
      matchingUrls.push(url)
    } else {
      remainingUrls.push(url)
    }
  }

  window.__FOUNDRY_PENDING_DEEP_LINKS__ = remainingUrls
  return matchingUrls
}

export function subscribeToDeepLinks(handler: (urls: string[]) => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<string[]>).detail
    if (Array.isArray(detail) && detail.length > 0) {
      handler(detail)
    }
  }

  window.addEventListener(DEEP_LINK_EVENT_NAME, listener)

  return () => {
    window.removeEventListener(DEEP_LINK_EVENT_NAME, listener)
  }
}

function readPendingSso(storage: StorageReader): Record<string, PendingSsoRecord> {
  const raw = storage.getItem(PENDING_SSO_STORAGE_KEY)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writePendingSso(storage: StorageWriter, records: Record<string, PendingSsoRecord>): void {
  if (Object.keys(records).length === 0) {
    storage.removeItem(PENDING_SSO_STORAGE_KEY)
    return
  }

  storage.setItem(PENDING_SSO_STORAGE_KEY, JSON.stringify(records))
}
