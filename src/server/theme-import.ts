import { ThemeInputSchema, type ThemeInput } from "@/domain/schemas";
import { splitKeywords, themeNameKey } from "@/domain/theme-name";
import { THEME_IMPORT_MAX_LINES } from "./validation";

/**
 * Analyse d'un import de sujets en texte libre — fonction pure, sans base.
 *
 * Format : une ligne = un sujet, `Nom | description | mot1, mot2 | notes`.
 * Description, mots-clés et notes optionnels (les notes tiennent sur la ligne :
 * le texte après le 3e « | »). Les lignes vides et celles qui commencent par `#`
 * sont ignorées. Les doublons de nom (insensibles à la casse et aux accents) au
 * sein de l'import sont signalés en erreur.
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

/** Nom de colonne affiché devant le message d'erreur d'une ligne. */
const FIELD_LABELS: Partial<Record<string, string>> = { name: "nom", description: "description", keywords: "mots-clés", notes: "notes" };

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
    if (parts.length > 4) {
      errors.push({ line: lineNo, message: "Trop de séparateurs « | » (4 colonnes au plus)." });
      return;
    }
    const [name = "", description = "", keywords = "", notes = ""] = parts;
    const parsed = ThemeInputSchema.safeParse({ name, description, keywords: splitKeywords(keywords), notes });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const label = FIELD_LABELS[String(issue?.path[0])] ?? "mots-clés";
      errors.push({ line: lineNo, message: `${label} : ${issue?.message ?? "valeur invalide"}` });
      return;
    }
    const key = themeNameKey(parsed.data.name);
    const firstLine = names.get(key);
    if (firstLine !== undefined) {
      errors.push({ line: lineNo, message: `Doublon du sujet de la ligne ${firstLine}.` });
      return;
    }
    names.set(key, lineNo);
    themes.push(parsed.data);
  });

  if (count > THEME_IMPORT_MAX_LINES) {
    errors.push({
      line: 0,
      message: `L'import est limité à ${THEME_IMPORT_MAX_LINES} sujets (${count} lignes reçues).`,
    });
  }
  if (count === 0) {
    errors.push({ line: 0, message: "Aucun sujet trouvé dans le texte." });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, themes };
}
