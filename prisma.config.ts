import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Configuration CLI Prisma 7. Le runtime n'utilise pas ce fichier : le client est
 * instancié avec l'adaptateur pg dans src/server/db/client.ts.
 *
 * PRISMA_DB=test cible TEST_DATABASE_URL (cf. script npm `db:test:migrate`).
 */
const target = process.env.PRISMA_DB === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env(target),
  },
});
