/**
 * Nom de fichier sûr pour Content-Disposition : ASCII, sans séparateur de
 * chemin, guillemet, retour ligne ni caractère de contrôle (pas d'injection
 * d'en-tête), longueur bornée. Fonction pure.
 */
export function safeFilename(raw: string, extension: string, fallback = "deck"): string {
  const base = raw
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-_ ]+|[-_ ]+$/g, "")
    .slice(0, 80)
    .trim();
  const ext = extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${base || fallback}.${ext}`;
}

/** En-tête Content-Disposition (forme ASCII ; le nom est déjà assaini). */
export function attachmentHeader(filename: string): string {
  return `attachment; filename="${filename}"`;
}
