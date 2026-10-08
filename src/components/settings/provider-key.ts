import { z } from "zod";
import { ANTHROPIC_KEY_MAX_LENGTH } from "@/domain/api-key";
import { PROVIDER_INFO, type SelectableProvider } from "@/domain/ai-providers";

/**
 * Contrôle de forme d'une clé saisie, AVANT tout appel serveur, pour les
 * fournisseurs proposés (Mistral, Gemini). Le motif exact de la clé reste côté
 * serveur (src/server/ai/catalog.ts) : ici, seulement « non vide » et la
 * longueur maximale, que l'action revérifie avec le motif complet.
 */

/** Même plafond que la 1.1 (256 caractères), commun à tous les fournisseurs. */
export const PROVIDER_KEY_MAX_LENGTH = ANTHROPIC_KEY_MAX_LENGTH;

export function providerKeySchema(provider: SelectableProvider): z.ZodType<{ apiKey: string }> {
  const required = `Saisissez votre clé API ${PROVIDER_INFO[provider].apiName}.`;
  return z.object({
    apiKey: z
      .string({ error: required })
      .trim()
      .min(1, required)
      .max(PROVIDER_KEY_MAX_LENGTH, "Cette clé est trop longue : vérifiez que vous n'avez copié que la clé."),
  });
}
