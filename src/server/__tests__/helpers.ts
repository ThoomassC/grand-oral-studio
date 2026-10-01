import type { DeckSpec, ThemeInput } from "@/domain/schemas";
import { db } from "@/server/db/client";
import type { Logger, LogFields } from "@/server/logger";
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

export function themeInput(name: string, keywords: string[] = []): ThemeInput {
  return { name, description: `Description de ${name}`, keywords };
}

/** Insère un deck directement en base (préparation de cascade, sans le domaine). */
export async function seedDeck(
  programId: string,
  themeId: string,
  kind: "SKELETON" | "FINAL",
  spec: DeckSpec = makeConformingDeck(),
): Promise<string> {
  const row = await db().deck.create({
    data: { programId, themeId, kind, problem: kind === "FINAL" ? "Une problématique" : null, spec },
    select: { id: true },
  });
  return row.id;
}
