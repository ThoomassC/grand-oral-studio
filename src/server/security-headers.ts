/**
 * En-têtes de sécurité HTTP appliqués à toutes les réponses (next.config.ts).
 *
 * CSP sans nonce (voir node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md,
 * « Without Nonces ») : un `script-src` strict à nonce imposerait le rendu
 * dynamique de toutes les pages via le proxy ; on garde donc 'unsafe-inline'
 * pour les scripts d'hydratation de Next, mais tout le reste est verrouillé
 * (origine propre uniquement, pas d'iframe, pas d'objet, pas de base ni de
 * formulaire vers l'extérieur).
 */

export interface HeaderEntry {
  key: string;
  value: string;
}

export function contentSecurityPolicy({ production }: { production: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // data: pour le logo de la charte (data URL), blob: pour le téléchargement du .pptx.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${production ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function securityHeaders({ production }: { production: boolean }): HeaderEntry[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ production }) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
    },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
  ];
}
