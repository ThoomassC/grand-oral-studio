/**
 * Remplit un .env à partir du modèle, sans jamais écraser une valeur renseignée :
 *  - « USER » dans les URL de base devient l'utilisateur de la machine ;
 *  - BETTER_AUTH_SECRET et SETTINGS_ENCRYPTION_KEY vides reçoivent un secret aléatoire.
 * Fonction pure (dépendances injectées) : testée dans src/test/setup-env.test.ts.
 */

/** Secrets générés quand ils sont vides, avec leur taille en octets. */
const SECRETS = { BETTER_AUTH_SECRET: 48, SETTINGS_ENCRYPTION_KEY: 32 };
const DB_KEYS = new Set(["DATABASE_URL", "TEST_DATABASE_URL"]);

/**
 * @param {string} text contenu du .env (ou du modèle)
 * @param {{ user: string, secret: (bytes: number) => string }} deps
 * @returns {{ text: string, changed: string[] }}
 */
export function fillEnv(text, { user, secret }) {
  const changed = [];
  const lines = text.split("\n").map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) return line;
    const [, key, value] = m;
    if (DB_KEYS.has(key) && value.includes("://USER@")) {
      changed.push(key);
      return `${key}=${value.replace("://USER@", `://${user}@`)}`;
    }
    if (key in SECRETS && value.trim() === "") {
      changed.push(key);
      return `${key}=${secret(SECRETS[key])}`;
    }
    return line;
  });
  return { text: lines.join("\n"), changed };
}
