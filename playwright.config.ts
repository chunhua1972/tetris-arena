import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const node = `"${process.execPath}"`;
const localChrome =
  process.platform === "win32" &&
  existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { ...(localChrome ? { channel: "chrome" } : {}) },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: [
    {
      command: `${node} --experimental-strip-types tests/e2e/fixture-server.ts`,
      url: "http://127.0.0.1:54329/health",
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command: `${node} node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174`,
      url: "http://127.0.0.1:5174",
      timeout: 60000,
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "http://127.0.0.1:54329",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_e2e_fixture",
      },
    },
  ],
});
