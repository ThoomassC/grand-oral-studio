/**
 * Destination après connexion : chemin interne uniquement (pas de redirection
 * ouverte vers un autre domaine, ni `//evil.example`, ni `/\evil.example`).
 */
export function safeNextPath(raw: string | string[] | undefined, fallback = "/programmes"): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
