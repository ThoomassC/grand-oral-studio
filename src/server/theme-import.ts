import { ThemeInputSchema, type ThemeInput } from "@/domain/schemas";
import { splitKeywords, themeNameKey } from "@/domain/theme-name";
import { THEME_IMPORT_MAX_LINES } from "./validation";

/**
 * Analyse d'un import de thèmes en texte libre — fonction pure, sans base.
 *
 * Format : une ligne = un thème, `Nom | description | mot1, mot2`.
 * Description et mots-clés optionnels. Les lignes vides et celles qui
 * commencent par `#` sont ignorées. Les doublons de nom (insensibles à la casse
 * et aux accents) au sein de l'import sont signalés en erreur.
 */

export { themeNameKey };

export interface ThemeImportLineError {
  /** Numéro de ligne (1-based) dans le texte d'origine. */
  line: number;
  message: string;
}

export type ThemeImportParseResult =
  | { ok: true; themes: ThemeInput[] }
  | { ok: false; errors: ThemeImportLineError[] };

export function parseThemeImport(text: string): ThemeImportParseResult {
  const errors: ThemeImportLineError[] = [];
  const themes: ThemeInput[] = [];
  const names = new Map<string, number>();

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let count = 0;

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    count += 1;
    if (count > THEME_IMPORT_MAX_LINES) return; // signalé une seule fois plus bas

    const parts = line.split("|").map((p) => p.trim());
    if (parts.length > 3) {
      errors.push({ line: lineNo, message: "Trop de séparateurs « | » (3 colonnes au plus)." });
      return;
    }
    const [name = "", description = "", keywords = ""] = parts;
    const parsed = ThemeInputSchema.safeParse({ name, description, keywords: splitKeywords(keywords) });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[0];
      const label = field === "name" ? "nom" : field === "description" ? "description" : "mots-clés";
      errors.push({ line: lineNo, message: `${label} : ${issue?.message ?? "valeur invalide"}` });
      return;
    }
    const key = themeNameKey(parsed.data.name);
    const firstLine = names.get(key);
    if (firstLine !== undefined) {
      errors.push({ line: lineNo, message: `Doublon du thème de la ligne ${firstLine}.` });
      return;
    }
    names.set(key, lineNo);
    themes.push(parsed.data);
  });

  if (count > THEME_IMPORT_MAX_LINES) {
    errors.push({
      line: 0,
      message: `L'import est limité à ${THEME_IMPORT_MAX_LINES} thèmes (${count} lignes reçues).`,
    });
  }
  if (count === 0) {
    errors.push({ line: 0, message: "Aucun thème trouvé dans le texte." });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, themes };
}
