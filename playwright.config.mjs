/**
 * Playwright configuration (§23.3).
 *
 * The point of this file is the `projects` list. R1's exit gate and §25.3's
 * baseline both require Chrome *and* Firefox *and* Safari; under the old
 * Python-CDP plan that meant implementing two more protocols or running the
 * prototype by hand forever. Here it is three lines, which is what turns the
 * gate from a standing manual task into a CI job.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",

  use: {
    baseURL: `http://localhost:${process.env.PORT || 8080}`,
    trace: "on-first-retry"
  },

  webServer: {
    command: "node tools/serve.mjs",
    url: `http://localhost:${process.env.PORT || 8080}/test/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  },

  /** The §25.3 baseline: Chrome/Edge 111+, Firefox 113+, Safari 16.4+. */
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ]
});
