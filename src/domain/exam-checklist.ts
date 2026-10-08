import { READY_MIN_DECKS, READY_MIN_REHEARSALS } from "./readiness";

/**
 * Liste de vérification avant l'épreuve : ce qui doit être prêt pour que le
 * jour J se passe sans surprise. Fonction pure, textes affichables tels quels.
 */

export interface ExamChecklistInput {
  /** Le rédacteur choisi (moteur IA connecté, ou « Sans IA ») est utilisable. */
  writerReady: boolean;
  /** Nom affichable du rédacteur (« Claude », « Sans IA »…). */
  writerLabel: string;
  templateSaved: boolean;
  /** Un export (PPTX) a déjà été tenté sur ce projet. */
  exportTried: boolean;
  /**
   * Diaporamas actifs du projet, entraînement ET jour J confondus : le même compte
   * que la règle « prêt pour le jour J » (isExamReady), pour que la liste et la
   * progression du projet ne se contredisent jamais.
   */
  decks: number;
  rehearsals: number;
}

export type ExamChecklistItemId = "writer" | "template" | "export" | "decks" | "rehearsals";

export interface ExamChecklistItem {
  id: ExamChecklistItemId;
  label: string;
  done: boolean;
  /** Ce qu'il reste à faire ; null quand c'est fait. */
  hint: string | null;
}

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function item(id: ExamChecklistItemId, label: string, done: boolean, hint: string): ExamChecklistItem {
  return { id, label, done, hint: done ? null : hint };
}

export function examChecklist(input: ExamChecklistInput): ExamChecklistItem[] {
  const decks = count(input.decks);
  const rehearsals = count(input.rehearsals);
  const writer = input.writerLabel.trim() || "non choisie";
  return [
    item(
      "writer",
      `Rédaction : ${writer}`,
      input.writerReady,
      "Vérifiez votre connexion d'IA dans votre profil, ou choisissez « Sans IA » : il fonctionne toujours.",
    ),
    item("template", "Trame enregistrée", input.templateSaved, "Relisez la trame (durée, lignes, minutage) et enregistrez-la."),
    item(
      "export",
      "Export essayé",
      input.exportTried,
      "Téléchargez un PPTX d'essai et ouvrez-le sur l'ordinateur que vous utiliserez le jour J.",
    ),
    item(
      "decks",
      `${READY_MIN_DECKS} diaporamas (entraînement ou jour J)`,
      decks >= READY_MIN_DECKS,
      `Générez un diaporama, d'entraînement ou du jour J (${decks} sur ${READY_MIN_DECKS}).`,
    ),
    item(
      "rehearsals",
      `${READY_MIN_REHEARSALS} répétitions chronométrées`,
      rehearsals >= READY_MIN_REHEARSALS,
      `Répétez à voix haute avec le chronomètre (${rehearsals} sur ${READY_MIN_REHEARSALS}).`,
    ),
  ];
}
