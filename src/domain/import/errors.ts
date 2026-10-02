/**
 * Fichier importé refusé (format, taille, contenu). `userMessage` est affichable
 * tel quel ; il ne recopie jamais le contenu du fichier.
 */
export class ImportFileError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "ImportFileError";
  }
}
