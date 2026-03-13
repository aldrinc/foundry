import type { SavedServer } from "@foundry/desktop/bindings"

export const PREFERRED_SERVER_STORAGE_KEY = "foundry.desktop.preferred-server-id"

export interface SavedServerLoginSeed {
  email: string
  serverUrl: string
}

type StorageReader = Pick<Storage, "getItem">
type StorageWriter = Pick<Storage, "setItem" | "removeItem">

export function getPreferredServerId(storage: StorageReader): string | null {
  const value = storage.getItem(PREFERRED_SERVER_STORAGE_KEY)?.trim()
  return value ? value : null
}

export function setPreferredServerId(storage: StorageWriter, serverId: string): void {
  storage.setItem(PREFERRED_SERVER_STORAGE_KEY, serverId)
}

export function clearPreferredServerId(storage: StorageWriter): void {
  storage.removeItem(PREFERRED_SERVER_STORAGE_KEY)
}

export function getAutoLoginServer(
  servers: SavedServer[],
  preferredServerId: string | null,
): SavedServer | null {
  if (servers.length === 0) return null
  return servers.find((server) => server.id === preferredServerId) ?? servers[0] ?? null
}

export function getSavedServerLoginSeed(
  servers: SavedServer[],
  preferredServerId: string | null,
): SavedServerLoginSeed | null {
  const server = getAutoLoginServer(servers, preferredServerId)
  if (!server) {
    return null
  }

  return {
    email: server.email,
    serverUrl: server.url,
  }
}
