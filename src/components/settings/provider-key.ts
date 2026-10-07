import { z } from "zod";
import { ANTHROPIC_KEY_MAX_LENGTH, SaveApiKeyInputSchema } from "@/domain/api-key";
import { PROVIDER_INFO, type CloudProvider } from "@/domain/ai-providers";

/**
 * Contrôle de forme d'une clé saisie, AVANT tout appel serveur. Claude reprend
 * le schéma partagé avec le serveur (src/domain/api-key.ts) ; pour les autres
 * fournisseurs, le motif exact de la clé reste côté serveur
 * (src/server/ai/catalog.ts) : ici, seulement « non vide » et la longueur
 * maximale, que l'action revérifie avec le motif complet.
 */

export const PROVIDER_KEY_MAX_LENGTH = ANTHROPIC_KEY_MAX_LENGTH;

export function providerKeySchema(provider: CloudProvider): z.ZodType<{ apiKey: string }> {
  if (provider === "claude") return SaveApiKeyInputSchema;
  const required = `Saisissez votre clé API ${PROVIDER_INFO[provider].apiName}.`;
  return z.object({
    apiKey: z
      .string({ error: required })
      .trim()
      .min(1, required)
      .max(PROVIDER_KEY_MAX_LENGTH, "Cette clé est trop longue : vérifiez que vous n'avez copié que la clé."),
  });
}
