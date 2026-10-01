import type { ClassificationResult, RankedTheme, ThemeRef } from "./contracts";
import type { Classification } from "./schemas";

const MAX_RANKED = 3;

function clampConfidence(value: number): number {
  const bounded = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return Math.round(bounded * 100) / 100;
}

/**
 * Normalise la réponse brute de l'IA :
 * - écarte les themeId inconnus du programme ;
 * - dédoublonne en gardant la confiance maximale ;
 * - borne la confiance dans [0, 1], arrondie à 2 décimales ;
 * - trie par confiance décroissante et garde 3 candidats.
 * Si un thème a été annoncé avec la problématique (et qu'il existe), il est
 * placé en tête, ajouté au besoin, sans dépasser 3 candidats.
 */
export function normalizeClassification(
  raw: Classification,
  themes: ThemeRef[],
  hintedThemeId?: string | null,
): ClassificationResult {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const best = new Map<string, RankedTheme>();

  for (const c of raw.candidates) {
    const theme = byId.get(c.themeId);
    if (!theme) continue;
    const confidence = clampConfidence(c.confidence);
    const current = best.get(theme.id);
    if (!current || confidence > current.confidence) {
      best.set(theme.id, { themeId: theme.id, themeName: theme.name, confidence, rationale: c.rationale });
    }
  }

  // Tri stable : à confiance égale, l'ordre proposé par l'IA est conservé.
  let ranked = [...best.values()].sort((a, b) => b.confidence - a.confidence);

  const hinted = hintedThemeId ? byId.get(hintedThemeId) : undefined;
  if (hinted) {
    const existing = ranked.find((r) => r.themeId === hinted.id);
    const head: RankedTheme = existing ?? {
      themeId: hinted.id,
      themeName: hinted.name,
      confidence: 0,
      rationale: "Thème annoncé avec la problématique.",
    };
    ranked = [head, ...ranked.filter((r) => r.themeId !== hinted.id)];
  }

  return { reformulatedProblem: raw.reformulatedProblem, ranked: ranked.slice(0, MAX_RANKED) };
}
