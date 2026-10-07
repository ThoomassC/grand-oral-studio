import type { KeySource } from "@/domain/ai-providers";
import type { DeckSpec, ThemeInput } from "@/domain/schemas";
import { loadSecretBoxFromEnv } from "@/server/crypto/secret-box";
import { db } from "@/server/db/client";
import type { Logger, LogFields } from "@/server/logger";
import { saveCredential } from "@/server/repo/ai-credentials";
import { createProgram } from "@/server/repo/programs";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";

/** Logger injecté qui n'écrit rien et garde les évènements pour inspection. */
export function recordingLogger(): Logger & { events: { level: string; event: string; fields: LogFields }[] } {
  const events: { level: string; event: string; fields: LogFields }[] = [];
  const make = (): Logger & { events: typeof events } => ({
    events,
    correlationId: "test0000",
    debug: (event, fields = {}) => events.push({ level: "debug", event, fields }),
    info: (event, fields = {}) => events.push({ level: "info", event, fields }),
    warn: (event, fields = {}) => events.push({ level: "warn", event, fields }),
    error: (event, fields = {}) => events.push({ level: "error", event, fields }),
    child: () => make(),
  });
  return make();
}

export async function seedProgram(ownerId: string, name = "Programme d'essai"): Promise<string> {
  const { id } = await createProgram(ownerId, { name, description: "", brand: makeBrand(), template: makeTemplate() });
  return id;
}

/**
 * Insère des thèmes directement (positions 0..n-1) : prépare un état sans passer
 * par la fonction testée.
 */
export async function seedThemes(programId: string, themes: ThemeInput[]): Promise<string[]> {
  const rows = await db().theme.createManyAndReturn({
    data: themes.map((t, position) => ({ programId, position, ...t })),
    select: { id: true, position: true },
  });
  return [...rows].sort((a, b) => a.position - b.position).map((r) => r.id);
}

export function themeInput(name: string, keywords: string[] = [], notes = ""): ThemeInput {
  return { name, description: `Description de ${name}`, keywords, notes };
}

/** Insère un deck directement en base (préparation de cascade, sans le domaine). `themeId` null : deck final sans sujet. */
export async function seedDeck(
  programId: string,
  themeId: string | null,
  kind: "SKELETON" | "FINAL",
  spec: DeckSpec = makeConformingDeck(),
): Promise<string> {
  const row = await db().deck.create({
    data: { programId, themeId, kind, problem: kind === "FINAL" ? "Une problématique" : null, spec },
    select: { id: true },
  });
  return row.id;
}

/** Invite directement un membre dans un projet (préparation des tests de partage, sans le domaine). */
export async function seedMember(programId: string, userId: string, role: "EDITOR" | "VIEWER" = "EDITOR"): Promise<void> {
  await db().programMember.create({ data: { programId, userId, role }, select: { programId: true } });
}

/**
 * Connexion HÉRITÉE d'un fournisseur qui n'est plus proposé (Claude, OpenAI) :
 * écrite par le dépôt, comme avant la 1.2 (« Vérifier et activer » : clé chiffrée
 * ET sélection), sans passer par le service, qui refuse désormais toute nouvelle
 * connexion de ces fournisseurs. `select: null` : la clé seule, sans sélection.
 */
export async function seedLegacyCredential(
  userId: string,
  provider: "claude" | "openai",
  apiKey: string,
  env: Partial<Record<string, string | undefined>>,
  select: KeySource | null = "user",
): Promise<void> {
  await saveCredential(
    userId,
    provider,
    { apiKey, model: null, verifiedAt: new Date() },
    loadSecretBoxFromEnv(env),
    select ? { select: { engine: provider, keySource: select } } : {},
  );
}
