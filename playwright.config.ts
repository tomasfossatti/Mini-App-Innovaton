import { defineConfig, devices } from "@playwright/test";

// E2E contra un build de producción (`pnpm build` antes) y una base exclusiva innovaton_e2e.
const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://innovaton:innovaton@localhost:5432/innovaton_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-AR",
    timezoneId: "America/Argentina/Cordoba",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      COOKIE_SECURE: "false",
      DEFAULT_EVENT_SLUG: "innovaton-demo",
      DEFAULT_PHONE_COUNTRY: "AR",
      PUBLIC_BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
