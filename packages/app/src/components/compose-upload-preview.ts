import { commands } from "@foundry/desktop/bindings"
import { resolveMessageUrl, shouldFetchAuthenticatedMedia } from "./message-html"

const RELATIVE_AUTHENTICATED_MEDIA_PATHS = [
  "/user_uploads/",
  "/external_content/",
]

export type UploadedImagePreviewRequest = {
  authenticatedRequestUrl: string | null
  displayUrl: string | null
}

function isRelativeAuthenticatedMediaPath(url: string): boolean {
  return RELATIVE_AUTHENTICATED_MEDIA_PATHS.some((pathPrefix) => url.startsWith(pathPrefix))
}

export function buildUploadedImagePreviewRequest(
  uploadUrl: string,
  realmUrl?: string,
): UploadedImagePreviewRequest {
  const trimmed = uploadUrl.trim()
  if (!trimmed) {
    return {
      authenticatedRequestUrl: null,
      displayUrl: null,
    }
  }

  const resolvedUrl = resolveMessageUrl(trimmed, realmUrl)

  if (isRelativeAuthenticatedMediaPath(trimmed)) {
    return {
      authenticatedRequestUrl: resolvedUrl || trimmed,
      displayUrl: null,
    }
  }

  if (resolvedUrl && shouldFetchAuthenticatedMedia(resolvedUrl, realmUrl)) {
    return {
      authenticatedRequestUrl: resolvedUrl,
      displayUrl: null,
    }
  }

  return {
    authenticatedRequestUrl: null,
    displayUrl: resolvedUrl,
  }
}

export async function loadUploadedImagePreviewUrl(
  orgId: string,
  uploadUrl: string,
  realmUrl?: string,
): Promise<string | null> {
  const request = buildUploadedImagePreviewRequest(uploadUrl, realmUrl)

  if (!request.authenticatedRequestUrl) {
    return request.displayUrl
  }

  try {
    const result = await commands.fetchAuthenticatedMediaDataUrl(orgId, request.authenticatedRequestUrl)
    return result.status === "ok" ? result.data : null
  } catch {
    return null
  }
}
