/**
 * Comparaison et découpage des noms de thèmes — fonctions pures partagées par
 * l'import texte (serveur), l'analyse d'un prompt (domaine) et le dépôt
 * (idempotence par nom).
 */

/** Clé de comparaison de noms : minuscules, sans accents, espaces normalisés. */
export function themeNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** « a, b; a » → ["a", "b"] : découpe sur , et ;, retire les vides et les doublons (casse et accents ignorés). */
export function splitKeywords(raw: string): string[] {
  return dedupeKeywords(raw.split(/[,;]/));
}

/** Mots-clés nettoyés : espaces de bord retirés, vides et doublons (casse et accents ignorés) écartés. */
export function dedupeKeywords(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of values) {
    const kw = part.trim();
    if (!kw) continue;
    const key = themeNameKey(kw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}
