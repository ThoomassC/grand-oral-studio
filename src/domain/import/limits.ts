/**
 * Limites d'import d'apparence (.pptx, .potx, .thmx), partagées par le client
 * (contrôle avant envoi), le serveur (contrôle au bord) et next.config.ts
 * (corps maximal d'une Server Action).
 *
 * 4 Mo : un hébergeur comme Vercel coupe les corps de requête au-delà de
 * 4,5 Mo, avant même l'application. Une présentation d'exemple dépasse
 * rarement cette taille une fois ses images compressées, et le logo seul
 * suffit à reprendre l'identité visuelle.
 */
export const BRAND_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** Message affiché quand le fichier dépasse BRAND_FILE_MAX_BYTES (client et serveur). */
export const BRAND_FILE_TOO_LARGE_MESSAGE =
  "Le fichier dépasse 4 Mo. Allégez-le (images compressées) ou importez seulement le logo.";

/** Texte d'aide de la zone de dépôt. */
export const BRAND_FILE_SIZE_HINT = "4 Mo au plus";

/** Vrai si le fichier dépasse la limite d'import d'apparence. */
export function isBrandFileTooLarge(sizeBytes: number): boolean {
  return sizeBytes > BRAND_FILE_MAX_BYTES;
}
