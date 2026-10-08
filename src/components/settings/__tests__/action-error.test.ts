import { describe, expect, it } from "vitest";
import { failureMessage } from "@/components/settings/action-error";

// Heure locale : la page calcule l'heure dans le fuseau du navigateur.
const NOW = new Date(2026, 9, 7, 14, 30, 20);

describe("failureMessage", () => {
  it("devrait afficher tel quel un message sans attente (clé refusée, crédit épuisé)", () => {
    const error = "Votre compte Mistral n'a plus de crédit. Rechargez-le sur console.mistral.ai.";
    expect(failureMessage({ error }, NOW)).toBe(error);
    expect(failureMessage({ error, retryAfterSeconds: 0 }, NOW)).toBe(error);
  });

  it("devrait remplacer « Réessayez dans … » par l'heure, arrondie à la minute suivante", () => {
    const error = "Mistral limite le nombre de requêtes en ce moment. Réessayez dans 2 min, ou choisissez un autre rédacteur.";
    expect(failureMessage({ error, retryAfterSeconds: 120 }, NOW)).toBe(
      "Mistral limite le nombre de requêtes en ce moment. Réessayez à 14:33, ou choisissez un autre rédacteur.",
    );
  });

  it("devrait ajouter l'heure quand le message ne précise pas l'attente", () => {
    expect(failureMessage({ error: "Trop de vérifications.", retryAfterSeconds: 30 }, NOW)).toBe(
      "Trop de vérifications. Réessayez à 14:31.",
    );
  });
});
