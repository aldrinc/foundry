import { describe, expect, test } from "bun:test"

import { createDemoLoginResult } from "./demo-login"

describe("demo login result", () => {
  test("does not hardcode a desktop upload limit", () => {
    expect(createDemoLoginResult().max_file_upload_size_mib).toBeNull()
  })
})
