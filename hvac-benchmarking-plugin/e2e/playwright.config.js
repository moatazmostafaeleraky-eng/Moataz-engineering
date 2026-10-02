import { defineConfig } from "@playwright/test";

const PORT = 5057;

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/app/`,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
  webServer: {
    command: `/tmp/hvac-venv/bin/python app.py`,
    cwd: "../",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 20000,
    env: {
      HVAC_BENCHMARK_DB: "/tmp/hvac-e2e.db",
      PORT: String(PORT),
    },
  },
});
