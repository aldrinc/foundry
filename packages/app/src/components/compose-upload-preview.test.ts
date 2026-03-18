import { describe, expect, test } from "bun:test"
import { buildUploadedImagePreviewRequest } from "./compose-upload-preview"

describe("buildUploadedImagePreviewRequest", () => {
  test("routes relative Zulip uploads through authenticated fetching", () => {
    expect(
      buildUploadedImagePreviewRequest("/user_uploads/1/files/image.png", "https://chat.example.invalid"),
    ).toEqual({
      authenticatedRequestUrl: "https://chat.example.invalid/user_uploads/1/files/image.png",
      displayUrl: null,
    })
  })

  test("keeps public absolute image urls as direct previews", () => {
    expect(
      buildUploadedImagePreviewRequest("https://cdn.example.invalid/image.png", "https://chat.example.invalid"),
    ).toEqual({
      authenticatedRequestUrl: null,
      displayUrl: "https://cdn.example.invalid/image.png",
    })
  })

  test("still requests auth for relative uploads when the realm url is unavailable", () => {
    expect(
      buildUploadedImagePreviewRequest("/user_uploads/1/files/image.png"),
    ).toEqual({
      authenticatedRequestUrl: "/user_uploads/1/files/image.png",
      displayUrl: null,
    })
  })

  test("returns no preview request for blank input", () => {
    expect(buildUploadedImagePreviewRequest("   ")).toEqual({
      authenticatedRequestUrl: null,
      displayUrl: null,
    })
  })
})
