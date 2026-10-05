import type { FieldErrors } from "@/components/forms/validation";
import type { PromptTemplate, Section } from "@/domain/schemas";
import { formatSeconds, parseDurationText } from "@/domain/slides";

/**
 * Logique pure de l'éditeur de trame : plages de diapos par ligne et saisie
 * des durées. Le champ « Durée » est un texte libre (« 3:30 », « 3 min »…)
 * converti en secondes à l'enregistrement seulement : une saisie en cours
 * (« 3: ») n'est jamais perdue ni corrigée sous les doigts de l'utilisateur.
 */

/** Texte saisi dans le champ « Durée » de chaque ligne, par identifiant de ligne. */
export type DurationTexts = Record<string, string>;

export const DURATION_FORMAT_ERROR = "Durée attendue au format 3:30 (minutes:secondes).";

/**
 * Diapos couvertes par chaque ligne, la couverture étant la diapo 1 :
 * « Diapo 2 », « Diapos 2-3 ». Null pour une ligne dont le nombre de diapos
 * est illisible, et pour toutes les suivantes (le cumul n'a plus de sens).
 */
export function lineRangeLabels(sections: readonly Pick<Section, "slides">[]): (string | null)[] {
  let next = 2;
  let broken = false;
  return sections.map(({ slides }) => {
    if (broken || !Number.isInteger(slides) || slides < 1) {
      broken = true;
      return null;
    }
    const first = next;
    next += slides;
    return slides === 1 ? `Diapo ${first}` : `Diapos ${first}-${first + slides - 1}`;
  });
}

/** Texte de départ des champs « Durée » : « 3:00 », ou vide pour une ligne sans durée. */
export function durationTexts(template: PromptTemplate): DurationTexts {
  return Object.fromEntries(
    template.sections.map((s) => [s.id, s.seconds === undefined ? "" : formatSeconds(s.seconds)]),
  );
}

/** Ligne reconstruite dans l'ordre des clés du schéma, sans `seconds` si la durée est absente. */
function lineWith(section: Section, seconds: number | undefined): Section {
  const { id, title, guidance, slides } = section;
  return seconds === undefined ? { id, title, guidance, slides } : { id, title, guidance, slides, seconds };
}

/**
 * Applique les durées saisies à la trame : vide → pas de durée (clé absente),
 * lisible → secondes, illisible → erreur sur `sections.<i>.seconds` (la ligne
 * est alors renvoyée sans durée ; l'appelant n'enregistre pas).
 */
export function withDurations(
  template: PromptTemplate,
  texts: DurationTexts,
): { template: PromptTemplate; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const sections = template.sections.map((section, index) => {
    const text = (texts[section.id] ?? "").trim();
    if (text === "") return lineWith(section, undefined);
    const seconds = parseDurationText(text);
    if (seconds === null) {
      errors[`sections.${index}.seconds`] = [DURATION_FORMAT_ERROR];
      return lineWith(section, undefined);
    }
    return lineWith(section, seconds);
  });
  return { template: { ...template, sections }, errors };
}

/**
 * Empreinte d'un brouillon (trame + textes des durées), indépendante de
 * l'ordre des clés et de l'écriture d'une durée (« 3:00 » = « 3 min ») : deux
 * empreintes égales = rien à enregistrer. Une durée illisible garde son texte.
 */
export function draftSignature(template: PromptTemplate, texts: DurationTexts): string {
  return JSON.stringify([
    template.format,
    template.language,
    template.durationMinutes,
    template.tone,
    template.constraints,
    template.sections.map((s) => {
      const text = (texts[s.id] ?? "").trim();
      const seconds = text === "" ? null : (parseDurationText(text) ?? `?${text}`);
      return [s.id, s.title, s.guidance, s.slides, seconds];
    }),
  ]);
}

/**
 * Pied de la trame : somme des durées lisibles et durée de l'oral, en secondes.
 * Null quand aucune ligne n'a de durée (tout est réparti automatiquement).
 */
export function durationSummary(template: PromptTemplate, texts: DurationTexts): { fixed: number; total: number } | null {
  let fixed = 0;
  let any = false;
  for (const section of template.sections) {
    const seconds = parseDurationText(texts[section.id] ?? "");
    if (seconds === null) continue;
    fixed += seconds;
    any = true;
  }
  return any ? { fixed, total: template.durationMinutes * 60 } : null;
}
