import { chromium } from "playwright"
import { fileURLToPath } from "node:url"

const desktopUrl = process.env.FOUNDRY_DESKTOP_SCREENSHOT_URL || "http://127.0.0.1:1420/?demo"
const cloudUrl = process.env.FOUNDRY_CLOUD_SCREENSHOT_URL || "http://127.0.0.1:8090"
const cloudEmail = process.env.FOUNDRY_CLOUD_SCREENSHOT_EMAIL || "admin@foundry.test"
const cloudPassword = process.env.FOUNDRY_CLOUD_SCREENSHOT_PASSWORD || "bootstrap-password"
const screenshotDir = new URL("../docs/images/readme/", import.meta.url)

const desktopOutput = new URL("foundry-desktop-product-snapshot.png", screenshotDir)
const cloudOutput = new URL("cloud-org-dashboard.png", screenshotDir)

const browser = await chromium.launch({ headless: true })

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1520, height: 980 },
    deviceScaleFactor: 2,
  })
  const desktopPage = await desktopContext.newPage()
  await desktopPage.goto(desktopUrl, { waitUntil: "networkidle" })
  await desktopPage.waitForSelector('[data-component="app-shell"]')
  await desktopPage.screenshot({
    path: fileURLToPath(desktopOutput),
    fullPage: false,
  })
  await desktopContext.close()

  const cloudContext = await browser.newContext({
    viewport: { width: 1520, height: 1180 },
    deviceScaleFactor: 2,
  })
  const cloudPage = await cloudContext.newPage()
  await cloudPage.goto(`${cloudUrl}/login`, { waitUntil: "networkidle" })
  await cloudPage.getByLabel("Email").fill(cloudEmail)
  await cloudPage.getByLabel("Password").fill(cloudPassword)
  await cloudPage.getByRole("button", { name: "Sign in" }).click()
  await cloudPage.waitForURL((url) => url.pathname.startsWith("/cloud"), { timeout: 10_000 })

  const organizationId = await cloudPage.evaluate(async () => {
    const response = await fetch("/api/v1/cloud/organizations", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
    if (!response.ok) {
      throw new Error(`Failed to load organizations: ${response.status}`)
    }
    const payload = await response.json()
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error("No organizations found for screenshot capture.")
    }
    return payload[0].organization_id
  })

  await cloudPage.goto(`${cloudUrl}/cloud/organizations/${organizationId}`, { waitUntil: "networkidle" })
  await cloudPage.waitForLoadState("networkidle")
  await cloudPage.waitForTimeout(300)
  await cloudPage.screenshot({
    path: fileURLToPath(cloudOutput),
    fullPage: false,
  })
  await cloudContext.close()
} finally {
  await browser.close()
}
