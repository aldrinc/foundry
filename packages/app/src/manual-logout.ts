export const MANUAL_LOGOUT_STORAGE_KEY = "foundry.desktop.manual-logout"

type StorageReader = Pick<Storage, "getItem">
type StorageWriter = Pick<Storage, "setItem" | "removeItem">

export function shouldSkipAutoLogin(storage: StorageReader): boolean {
  return storage.getItem(MANUAL_LOGOUT_STORAGE_KEY) === "true"
}

export function markManualLogout(storage: StorageWriter): void {
  storage.setItem(MANUAL_LOGOUT_STORAGE_KEY, "true")
}

export function clearManualLogout(storage: StorageWriter): void {
  storage.removeItem(MANUAL_LOGOUT_STORAGE_KEY)
}
