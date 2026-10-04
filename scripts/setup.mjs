#!/usr/bin/env node
/**
 * Installation locale en une commande : `npm run setup` (après `npm install`).
 *   1. crée .env depuis .env.example s'il n'existe pas, puis le complète
 *      (utilisateur PostgreSQL, secrets) sans écraser ce qui est renseigné ;
 *   2. crée les bases de dev et de test si `createdb` est disponible ;
 *   3. applique les migrations Prisma sur les deux bases.
 * Relançable sans risque.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { fillEnv } from "./setup-env.mjs";

const ENV = ".env";
const step = (msg) => console.log(`\n▸ ${msg}`);

step("Fichier .env");
if (!existsSync(ENV)) {
  copyFileSync(".env.example", ENV);
  console.log("  .env créé depuis .env.example");
}
const { text, changed } = fillEnv(readFileSync(ENV, "utf8"), {
  user: userInfo().username,
  secret: (bytes) => randomBytes(bytes).toString("base64"),
});
if (changed.length > 0) {
  writeFileSync(ENV, text);
  console.log(`  complété : ${changed.join(", ")}`);
} else {
  console.log("  déjà complet, rien de modifié");
}
// Secrets dedans : lisible par son seul propriétaire.
chmodSync(ENV, 0o600);

const env = Object.fromEntries(
  text
    .split("\n")
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"(.*)"$/, "$1")]),
);

step("Bases PostgreSQL");
for (const key of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
  const url = env[key];
  if (!url) {
    console.log(`  ${key} vide : à renseigner dans .env`);
    continue;
  }
  const name = new URL(url).pathname.slice(1);
  try {
    execFileSync("createdb", [name], { stdio: "pipe" });
    console.log(`  ${name} créée`);
  } catch (error) {
    const msg = String(error.stderr ?? error.message);
    if (msg.includes("already exists")) console.log(`  ${name} existe déjà`);
    else if (error.code === "ENOENT") console.log(`  createdb introuvable : créez « ${name} » vous-même`);
    else console.log(`  ${name} non créée : ${msg.trim().split("\n")[0]}`);
  }
}

step("Migrations Prisma");
try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: { ...process.env, PRISMA_DB: "test" } });
} catch {
  console.error("\n✗ Migrations impossibles : vérifiez que PostgreSQL tourne et les URL de .env.");
  process.exit(1);
}

console.log("\n✓ Prêt. Lancez « npm run dev » puis ouvrez http://localhost:3000");
console.log("  Facultatif : connexion Google, clé Anthropic, Ollama — voir .env.example.");
