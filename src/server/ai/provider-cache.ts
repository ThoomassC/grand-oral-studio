import { createHash } from "node:crypto";
import type { CloudProvider } from "@/domain/ai-providers";
import type { AiProvider } from "./types";

/**
 * Cache mémoire borné (LRU) de fournisseurs : un client par
 * (fournisseur, source, modèle, clé). L'index est un hash SHA-256 de la clé, jamais la clé en
 * clair ; deux utilisateurs aux clés différentes n'ont jamais le même client.
 */

export interface ProviderCacheKey {
  /** Défaut "claude" (index 1.1 inchangé). */
  provider?: CloudProvider;
  apiKey: string;
  model: string;
  source: "user" | "server";
}

export interface ProviderCache {
  get(key: ProviderCacheKey, create: () => AiProvider): AiProvider;
  readonly size: number;
  /** Index (hachés) — pour les tests. */
  keys(): string[];
  clear(): void;
}

export function createProviderCache(maxEntries = 64): ProviderCache {
  const entries = new Map<string, AiProvider>();
  const index = (k: ProviderCacheKey) =>
    `${k.provider ?? "claude"}:${k.source}:${k.model}:${createHash("sha256").update(k.apiKey).digest("base64url")}`;

  return {
    get(key, create) {
      const id = index(key);
      const hit = entries.get(id);
      if (hit) {
        // Map conserve l'ordre d'insertion : réinsérer = marquer comme récent.
        entries.delete(id);
        entries.set(id, hit);
        return hit;
      }
      const provider = create();
      entries.set(id, provider);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return provider;
    },
    get size() {
      return entries.size;
    },
    keys: () => [...entries.keys()],
    clear: () => entries.clear(),
  };
}
