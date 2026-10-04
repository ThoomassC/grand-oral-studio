import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * Tests E2E contre le serveur de développement déjà lancé (`npm run dev`) :
 * pas de `webServer`. Un seul worker : la base de dev est partagée et les
 * limites de débit (inscription, IA) sont globales.
 *
 * Le .env est chargé comme pour le serveur : la suite voit la même configuration
 * (OLLAMA_BASE_URL, DATABASE_URL) que l'application qu'elle teste.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // En CI : rapport HTML en plus, publié en artefact si la suite échoue.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
