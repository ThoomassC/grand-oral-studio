import { z } from "zod";

/**
 * Format d'une clé API Anthropic saisie par l'utilisateur. Contrôle de forme
 * seulement (la validité réelle est vérifiée côté serveur auprès d'Anthropic).
 * Partagé avec le front pour une validation immédiate du champ.
 *
 * Les messages ne recopient jamais la valeur saisie.
 */

export const ANTHROPIC_KEY_PREFIX = "sk-ant-";
export const ANTHROPIC_KEY_MIN_LENGTH = 24;
export const ANTHROPIC_KEY_MAX_LENGTH = 256;

export const AnthropicApiKeySchema = z
  .string({ error: "Saisissez votre clé API Anthropic." })
  .trim()
  .min(1, "Saisissez votre clé API Anthropic.")
  .startsWith(ANTHROPIC_KEY_PREFIX, `Une clé API Anthropic commence par « ${ANTHROPIC_KEY_PREFIX} ».`)
  .min(ANTHROPIC_KEY_MIN_LENGTH, "Cette clé est trop courte : copiez-la en entier.")
  .max(ANTHROPIC_KEY_MAX_LENGTH, "Cette clé est trop longue : vérifiez que vous n'avez copié que la clé.")
  .regex(/^[A-Za-z0-9_-]+$/, "La clé ne doit contenir que des lettres, des chiffres, « - » et « _ » (pas d'espace).");

export const SaveApiKeyInputSchema = z.object({ apiKey: AnthropicApiKeySchema });
export type SaveApiKeyInput = z.input<typeof SaveApiKeyInputSchema>;

/** Seule partie de la clé qu'on montre ou qu'on stocke en clair. */
export function apiKeyLast4(apiKey: string): string {
  return apiKey.slice(-4);
}
