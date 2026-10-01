import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { loadEnv } from "vite";
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config";

/**
 * Deux familles de tests :
 *  - unitaires (`npm test`) : projets « node » (*.test.ts) et « dom » (*.test.tsx), sans base ;
 *  - intégration (`npm run test:int`) : projet « integration » (*.int.test.ts) contre la
 *    vraie base PostgreSQL de test. Il n'est déclaré que si VITEST_INTEGRATION=1, si bien
 *    qu'un `vitest run` nu ne touche jamais à une base.
 */

const INTEGRATION_GLOB = "src/**/*.int.test.ts";
const DEFAULT_TEST_DATABASE_URL = "postgresql://thomascaron@localhost:5432/grand_oral_test";

function integrationProject(): TestProjectInlineConfiguration {
  const env = loadEnv("test", process.cwd(), "");
  const url = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Tests d'intégration refusés : la base « ${dbName} » n'est pas une base de test (suffixe _test attendu).`);
  }
  return {
    extends: true,
    test: {
      name: "integration",
      environment: "node",
      include: [INTEGRATION_GLOB],
      // Une seule base partagée : les fichiers ne tournent jamais en parallèle.
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 30_000,
      env: { DATABASE_URL: url, AI_QUOTA_PER_HOUR: "80" },
    },
  };
}

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [INTEGRATION_GLOB, "node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
        },
      },
      ...(process.env.VITEST_INTEGRATION === "1" ? [integrationProject()] : []),
    ],
  },
});
