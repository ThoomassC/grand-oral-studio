import pg from "pg";

/** Base de développement utilisée par le serveur `npm run dev` (jamais une base de prod). */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://localhost:5432/grand_oral_dev";

export const E2E_EMAIL_LIKE = "e2e-%@example.test";

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Supprime les comptes de test (cascade : sessions, projets, thèmes, decks, réglages). */
export function deleteE2eUsers(): Promise<number> {
  return withClient(async (c) => {
    const res = await c.query(`delete from "user" where email like $1`, [E2E_EMAIL_LIKE]);
    return res.rowCount ?? 0;
  });
}

export function countTestUsers(): Promise<number> {
  return withClient(async (c) => {
    const res = await c.query(`select count(*)::int as n from "user" where email like '%@example.test'`);
    return res.rows[0].n as number;
  });
}

/**
 * Remet à zéro les compteurs de débit de Better Auth (table rateLimit) pour
 * l'inscription et la connexion par e-mail : la suite crée plus de comptes que
 * la limite de 10 inscriptions/heure/IP. Mesure propre au harnais de test.
 */
export function resetAuthRateLimit(): Promise<void> {
  return withClient(async (c) => {
    await c.query(`delete from "rateLimit" where key like '%/sign-up/email' or key like '%/sign-in/email'`);
  });
}

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return withClient(async (c) => (await c.query(sql, params)).rows as T[]);
}
